"""External Connector Sync Service.

Handles multi-tenant synchronization of hospital appointments with:
- Google Calendar (Doctor schedule)
- Google Sheets (Receptionist booking records)
- Radicale CalDAV (Independent self-hosted calendar)
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

import httpx
from app.core.config import settings
from app.models.connector import HospitalConnector
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


class ConnectorSyncService:
    """Dispatches appointment events to hospital-configured external connectors."""

    @classmethod
    async def dispatch_appointment_created(
        cls,
        db: AsyncSession,
        tenant_id: uuid.UUID,
        appointment_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Dispatches a newly confirmed appointment to all active connectors for this hospital."""
        try:
            result = await db.execute(
                select(HospitalConnector).where(
                    HospitalConnector.tenant_id == tenant_id,
                    HospitalConnector.is_active,
                )
            )
            connectors = result.scalars().all()
            if not connectors:
                logger.info("No active external connectors found for tenant %s", tenant_id)
                return {"synced": 0, "connectors": []}

            results = []
            now = datetime.now(timezone.utc)

            for conn in connectors:
                success = False
                err_msg = None
                try:
                    if conn.connector_type == "google_sheets":
                        success, err_msg = await cls._sync_google_sheets(conn, appointment_data)
                    elif conn.connector_type == "google_calendar":
                        success, err_msg = await cls._sync_google_calendar(conn, appointment_data)
                    elif conn.connector_type == "radicale":
                        success, err_msg = await cls._sync_radicale(conn, appointment_data)

                    if success:
                        conn.synced_count = (conn.synced_count or 0) + 1
                        conn.last_sync_at = now
                        conn.sync_status = "synced"
                        conn.sync_error = None
                    else:
                        conn.sync_status = "error"
                        conn.sync_error = err_msg

                    results.append({"type": conn.connector_type, "success": success, "error": err_msg})
                except Exception as ex:
                    logger.warning("Error syncing connector %s: %s", conn.connector_type, ex)
                    conn.sync_status = "error"
                    conn.sync_error = str(ex)
                    results.append({"type": conn.connector_type, "success": False, "error": str(ex)})

            await db.commit()
            return {"synced": sum(1 for r in results if r["success"]), "details": results}

        except Exception as exc:
            logger.error("Failed to dispatch appointment sync for tenant %s: %s", tenant_id, exc)
            return {"synced": 0, "error": str(exc)}

    @classmethod
    async def _get_google_access_token(
        cls, conn: HospitalConnector
    ) -> Tuple[Optional[str], Optional[str]]:
        """Retrieves or refreshes a valid Google OAuth access token."""
        creds = conn.credentials or {}
        access_token = creds.get("access_token")
        refresh_token = creds.get("refresh_token")

        # If we have a refresh_token and client credentials, attempt token refresh
        if refresh_token and not refresh_token.startswith("oauth_rt_") and settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET:
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.post(
                        "https://oauth2.googleapis.com/token",
                        data={
                            "client_id": settings.GOOGLE_CLIENT_ID,
                            "client_secret": settings.GOOGLE_CLIENT_SECRET,
                            "refresh_token": refresh_token,
                            "grant_type": "refresh_token",
                        },
                    )
                    if resp.status_code == 200:
                        token_info = resp.json()
                        new_access_token = token_info.get("access_token")
                        if new_access_token:
                            conn.credentials = {
                                **(conn.credentials or {}),
                                "access_token": new_access_token,
                            }
                            return new_access_token, None
                    elif resp.status_code == 400 and access_token:
                        return access_token, None
            except Exception as ex:
                logger.warning("Error refreshing Google OAuth token: %s", ex)
                if access_token:
                    return access_token, None

        if access_token:
            return access_token, None

        return None, "No valid Google OAuth access token or refresh token found"

    @staticmethod
    def _format_time_ampm(t_str: str) -> str:
        """Converts HH:MM string to 12-hour AM/PM format."""
        try:
            parts = t_str.split(":")
            h, m = int(parts[0]), int(parts[1])
            suffix = "PM" if h >= 12 else "AM"
            h12 = h % 12
            if h12 == 0:
                h12 = 12
            return f"{h12}:{m:02d} {suffix}"
        except Exception:
            return t_str

    @classmethod
    async def _sync_google_sheets(
        cls, conn: HospitalConnector, data: Dict[str, Any]
    ) -> Tuple[bool, Optional[str]]:
        webhook_url = (conn.config or {}).get("webhookUrl")
        if webhook_url:
            payload = {
                "appointment_id": data.get("appointment_id"),
                "patient_name": data.get("patient_name"),
                "phone": data.get("patient_phone", ""),
                "doctor_name": data.get("doctor_name"),
                "slot_time": f"{data.get('appointment_date')} {data.get('start_time')}",
                "status": data.get("status", "CONFIRMED"),
                "notes": data.get("notes", "Booked via Hospital Voice Agent"),
            }
            try:
                async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                    resp = await client.post(webhook_url, json=payload)
                    if resp.status_code in (200, 201):
                        return True, None
                    return False, f"Google Sheets webhook returned HTTP {resp.status_code}: {resp.text[:200]}"
            except Exception as err:
                logger.warning("Google Sheets sync request notice: %s", err)
                return False, str(err)

        raw_target = (
            (conn.config or {}).get("spreadsheetId")
            or (conn.config or {}).get("sheetUrl")
            or settings.GOOGLE_SHEETS_SPREADSHEET_ID
            or ""
        )
        if not raw_target:
            return True, None

        if "/d/" in raw_target:
            spreadsheet_id = raw_target.split("/d/")[1].split("/")[0]
        else:
            spreadsheet_id = raw_target.strip()

        access_token, err = await cls._get_google_access_token(conn)
        if not access_token:
            return False, err or "Missing Google OAuth token for Sheets"

        doctor_name = data.get("doctor_name", "Doctor")
        patient_name = data.get("patient_name", "Patient")
        patient_phone = data.get("patient_phone", "")
        appointment_date = str(data.get("appointment_date", ""))
        start_time = str(data.get("start_time", "09:00"))
        end_time = str(data.get("end_time", "09:15"))
        notes = data.get("notes", "Booked via Hospital Voice Agent")
        appointment_id = data.get("appointment_id", "")
        time_display = f"{cls._format_time_ampm(start_time)} - {cls._format_time_ampm(end_time)} ({start_time} - {end_time})"

        tab_name = (conn.config or {}).get("sheetTabName") or "Sheet1"

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                headers = {
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json",
                }

                # 1. Fetch spreadsheet metadata to check/resolve actual sheet tab name
                meta_url = f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}"
                meta_resp = await client.get(meta_url, headers=headers)
                if meta_resp.status_code == 401:
                    # Refresh token and retry
                    refresh_token = (conn.credentials or {}).get("refresh_token")
                    if refresh_token and settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET:
                        ref_res = await client.post(
                            "https://oauth2.googleapis.com/token",
                            data={
                                "client_id": settings.GOOGLE_CLIENT_ID,
                                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                                "refresh_token": refresh_token,
                                "grant_type": "refresh_token",
                            },
                        )
                        if ref_res.status_code == 200:
                            access_token = ref_res.json().get("access_token")
                            headers["Authorization"] = f"Bearer {access_token}"
                            conn.credentials = {**(conn.credentials or {}), "access_token": access_token}
                            meta_resp = await client.get(meta_url, headers=headers)

                sheet_id = 0
                if meta_resp.status_code == 200:
                    sheets_list = meta_resp.json().get("sheets", [])
                    if sheets_list:
                        all_tabs = [
                            s.get("properties", {}).get("title")
                            for s in sheets_list
                            if s.get("properties", {}).get("title")
                        ]
                        target_sheet = next(
                            (s for s in sheets_list if s.get("properties", {}).get("title") == tab_name),
                            sheets_list[0],
                        )
                        sheet_id = target_sheet.get("properties", {}).get("sheetId", 0)
                        if tab_name not in all_tabs and all_tabs:
                            tab_name = all_tabs[0]

                # 2. Check if Header row exists
                chk_url = f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values/{tab_name}!A1:H1"
                chk_resp = await client.get(chk_url, headers=headers)
                has_headers = False
                if chk_resp.status_code == 200:
                    vals = chk_resp.json().get("values", [])
                    if vals and len(vals[0]) > 0:
                        has_headers = True

                # 3. If headers don't exist, create columns & apply executive styling automatically
                if not has_headers:
                    header_columns = [
                        "Appointment ID",
                        "Patient Name",
                        "Contact Number",
                        "Doctor Name to Meet",
                        "Date",
                        "Time",
                        "Status",
                        "Reason / Notes",
                    ]
                    put_hdr_url = f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values/{tab_name}!A1:H1?valueInputOption=USER_ENTERED"
                    await client.put(
                        put_hdr_url,
                        json={"range": f"{tab_name}!A1:H1", "majorDimension": "ROWS", "values": [header_columns]},
                        headers=headers,
                    )
                    # Apply professional formatting: colors, freeze header, and column widths
                    await cls._style_google_sheet(client, spreadsheet_id, sheet_id, headers)
                    logger.info("Auto-created and styled Google Sheet %s (%s)", spreadsheet_id, tab_name)

                # 4. Append the appointment data row
                row_values = [
                    appointment_id,
                    patient_name,
                    patient_phone or "Not provided",
                    f"Dr. {doctor_name}",
                    appointment_date,
                    time_display,
                    str(data.get("status", "CONFIRMED")).upper(),
                    notes,
                ]

                append_url = f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values/{tab_name}!A:H:append?valueInputOption=USER_ENTERED"
                append_resp = await client.post(
                    append_url,
                    json={
                        "range": f"{tab_name}!A:H",
                        "majorDimension": "ROWS",
                        "values": [row_values],
                    },
                    headers=headers,
                )
                if append_resp.status_code in (200, 201):
                    logger.info("Google Sheets row appended successfully for appointment %s", appointment_id)
                    return True, None
                else:
                    return False, f"Google Sheets API HTTP {append_resp.status_code}: {append_resp.text[:200]}"
        except Exception as exc:
            logger.error("Exception appending row to Google Sheets: %s", exc)
            return False, str(exc)

    @classmethod
    async def _style_google_sheet(
        cls, client: httpx.AsyncClient, spreadsheet_id: str, sheet_id: int, headers: Dict[str, str]
    ) -> None:
        """Applies executive design, frozen header row, column widths, and banding to Google Sheet."""
        try:
            batch_body = {
                "requests": [
                    {
                        "repeatCell": {
                            "range": {
                                "sheetId": sheet_id,
                                "startRowIndex": 0,
                                "endRowIndex": 1,
                                "startColumnIndex": 0,
                                "endColumnIndex": 8,
                            },
                            "cell": {
                                "userEnteredFormat": {
                                    "backgroundColor": {"red": 0.08, "green": 0.12, "blue": 0.22},
                                    "textFormat": {
                                        "foregroundColor": {"red": 1.0, "green": 1.0, "blue": 1.0},
                                        "bold": True,
                                        "fontSize": 11,
                                    },
                                    "horizontalAlignment": "CENTER",
                                    "verticalAlignment": "MIDDLE",
                                    "wrapStrategy": "WRAP",
                                },
                            },
                            "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)",
                        }
                    },
                    {
                        "updateSheetProperties": {
                            "properties": {"sheetId": sheet_id, "gridProperties": {"frozenRowCount": 1}},
                            "fields": "gridProperties.frozenRowCount",
                        }
                    },
                    {
                        "updateDimensionProperties": {
                            "range": {"sheetId": sheet_id, "dimension": "ROWS", "startIndex": 0, "endIndex": 1},
                            "properties": {"pixelSize": 42},
                            "fields": "pixelSize",
                        }
                    },
                    {"updateDimensionProperties": {"range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 0, "endIndex": 1}, "properties": {"pixelSize": 180}, "fields": "pixelSize"}},
                    {"updateDimensionProperties": {"range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 1, "endIndex": 2}, "properties": {"pixelSize": 180}, "fields": "pixelSize"}},
                    {"updateDimensionProperties": {"range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 2, "endIndex": 3}, "properties": {"pixelSize": 150}, "fields": "pixelSize"}},
                    {"updateDimensionProperties": {"range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 3, "endIndex": 4}, "properties": {"pixelSize": 190}, "fields": "pixelSize"}},
                    {"updateDimensionProperties": {"range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 4, "endIndex": 5}, "properties": {"pixelSize": 120}, "fields": "pixelSize"}},
                    {"updateDimensionProperties": {"range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 5, "endIndex": 6}, "properties": {"pixelSize": 180}, "fields": "pixelSize"}},
                    {"updateDimensionProperties": {"range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 6, "endIndex": 7}, "properties": {"pixelSize": 130}, "fields": "pixelSize"}},
                    {"updateDimensionProperties": {"range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 7, "endIndex": 8}, "properties": {"pixelSize": 280}, "fields": "pixelSize"}},
                ]
            }
            await client.post(
                f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}:batchUpdate",
                json=batch_body,
                headers=headers,
            )

            # Add alternating row zebra banding
            band_body = {
                "requests": [
                    {
                        "addBanding": {
                            "bandedRange": {
                                "range": {
                                    "sheetId": sheet_id,
                                    "startRowIndex": 0,
                                    "endRowIndex": 500,
                                    "startColumnIndex": 0,
                                    "endColumnIndex": 8,
                                },
                                "rowProperties": {
                                    "headerColor": {"red": 0.08, "green": 0.12, "blue": 0.22},
                                    "firstBandColor": {"red": 1.0, "green": 1.0, "blue": 1.0},
                                    "secondBandColor": {"red": 0.95, "green": 0.97, "blue": 1.0},
                                },
                            }
                        }
                    }
                ]
            }
            await client.post(
                f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}:batchUpdate",
                json=band_body,
                headers=headers,
            )
        except Exception as style_err:
            logger.debug("Google Sheet styling non-blocking notice: %s", style_err)

    @classmethod
    async def _sync_google_calendar(
        cls, conn: HospitalConnector, data: Dict[str, Any]
    ) -> Tuple[bool, Optional[str]]:
        calendar_id = (conn.config or {}).get("calendarId") or "primary"
        access_token, err = await cls._get_google_access_token(conn)
        if not access_token:
            logger.warning(
                "Cannot sync Google Calendar for tenant %s: %s",
                conn.tenant_id,
                err or "Missing OAuth token",
            )
            return False, err or "Missing Google OAuth token. Please reconnect Google Calendar."

        doctor_name = data.get("doctor_name", "Doctor")
        patient_name = data.get("patient_name", "Patient")
        patient_phone = data.get("patient_phone", "")
        appointment_date = str(data.get("appointment_date", ""))
        start_time = str(data.get("start_time", "09:00"))
        end_time = str(data.get("end_time", "09:15"))
        notes = data.get("notes", "Booked via Hospital Voice Agent")
        appointment_id = data.get("appointment_id", "")

        time_display = f"{cls._format_time_ampm(start_time)} - {cls._format_time_ampm(end_time)} ({start_time} - {end_time})"

        # ISO-8601 with Asia/Kolkata (+05:30) offset
        start_dt = f"{appointment_date}T{start_time}:00+05:30"
        end_dt = f"{appointment_date}T{end_time}:00+05:30"

        event_body = {
            "summary": f"Appointment: {patient_name} with Dr. {doctor_name}",
            "description": (
                f"Patient Name : {patient_name}\n"
                f"Contact Number : {patient_phone or 'Not provided'}\n"
                f"Doctor Name to Meet : Dr. {doctor_name}\n"
                f"Time : {time_display}\n"
                f"Date : {appointment_date}\n"
                f"Status : Confirmed\n"
                f"Reason / Notes : {notes}\n"
                f"Appointment ID : {appointment_id}"
            ),
            "start": {
                "dateTime": start_dt,
                "timeZone": "Asia/Kolkata",
            },
            "end": {
                "dateTime": end_dt,
                "timeZone": "Asia/Kolkata",
            },
            "reminders": {
                "useDefault": True,
            },
        }

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                url = f"https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events"
                resp = await client.post(
                    url,
                    json=event_body,
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Content-Type": "application/json",
                    },
                )
                if resp.status_code in (200, 201):
                    event_data = resp.json()
                    logger.info(
                        "Google Calendar event created successfully for appointment %s: %s",
                        appointment_id,
                        event_data.get("htmlLink"),
                    )
                    return True, None
                elif resp.status_code == 401:
                    # Token might be expired, attempt refresh and retry once
                    refresh_token = (conn.credentials or {}).get("refresh_token")
                    if refresh_token and settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET:
                        refresh_resp = await client.post(
                            "https://oauth2.googleapis.com/token",
                            data={
                                "client_id": settings.GOOGLE_CLIENT_ID,
                                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                                "refresh_token": refresh_token,
                                "grant_type": "refresh_token",
                            },
                        )
                        if refresh_resp.status_code == 200:
                            new_token = refresh_resp.json().get("access_token")
                            if new_token:
                                conn.credentials = {
                                    **(conn.credentials or {}),
                                    "access_token": new_token,
                                }
                                retry_resp = await client.post(
                                    url,
                                    json=event_body,
                                    headers={
                                        "Authorization": f"Bearer {new_token}",
                                        "Content-Type": "application/json",
                                    },
                                )
                                if retry_resp.status_code in (200, 201):
                                    return True, None

                    return False, f"Google Calendar API returned HTTP 401 Unauthorized: {resp.text[:200]}"
                else:
                    return False, f"Google Calendar API HTTP {resp.status_code}: {resp.text[:200]}"
        except Exception as exc:
            logger.error("Exception syncing with Google Calendar: %s", exc)
            return False, str(exc)

    @classmethod
    async def _sync_radicale(
        cls, conn: HospitalConnector, data: Dict[str, Any]
    ) -> Tuple[bool, Optional[str]]:
        server_url = (conn.config or {}).get("serverUrl")
        calendar_path = (conn.config or {}).get("calendarPath", "/hospital_admin/doctor_appointments/")
        if not server_url:
            return False, "Missing Radicale server URL"
        username = (conn.config or {}).get("username", "")
        password = (conn.credentials or {}).get("password", "")

        auth = (username, password) if username and password else None
        target_url = f"{server_url.rstrip('/')}/{calendar_path.strip('/')}/{data.get('appointment_id')}.ics"

        doctor_name = data.get("doctor_name", "Doctor")
        patient_name = data.get("patient_name", "Patient")
        patient_phone = data.get("patient_phone", "")
        appointment_date = str(data.get("appointment_date", ""))
        start_time = str(data.get("start_time", "09:00"))[:5]
        end_time = str(data.get("end_time", "09:15"))[:5]
        notes = data.get("notes", "Booked via Hospital Voice Agent")
        appointment_id = data.get("appointment_id", "")

        time_display = f"{cls._format_time_ampm(start_time)} - {cls._format_time_ampm(end_time)} ({start_time} - {end_time})"

        dt_str = appointment_date.replace("-", "")
        st_str = start_time.replace(":", "") + "00"
        et_str = end_time.replace(":", "") + "00"

        desc_text = (
            f"Patient Name : {patient_name}\\n"
            f"Contact Number : {patient_phone or 'Not provided'}\\n"
            f"Doctor Name to Meet : Dr. {doctor_name}\\n"
            f"Time : {time_display}\\n"
            f"Date : {appointment_date}\\n"
            f"Status : Confirmed\\n"
            f"Reason / Notes : {notes}\\n"
            f"Appointment ID : {appointment_id}"
        )

        ics_content = (
            f"BEGIN:VCALENDAR\r\n"
            f"VERSION:2.0\r\n"
            f"PRODID:-//Hospital Voice Agent//EN\r\n"
            f"BEGIN:VEVENT\r\n"
            f"UID:{appointment_id}@hospital-agent.ai\r\n"
            f"DTSTAMP:{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}\r\n"
            f"DTSTART:{dt_str}T{st_str}\r\n"
            f"DTEND:{dt_str}T{et_str}\r\n"
            f"SUMMARY:Appointment: {patient_name} with Dr. {doctor_name}\r\n"
            f"DESCRIPTION:{desc_text}\r\n"
            f"STATUS:CONFIRMED\r\n"
            f"END:VEVENT\r\n"
            f"END:VCALENDAR\r\n"
        )

        try:
            async with httpx.AsyncClient(timeout=8.0, verify=not (conn.config or {}).get("ignoreSsl", True)) as client:
                resp = await client.put(
                    target_url,
                    content=ics_content,
                    headers={"Content-Type": "text/calendar; charset=utf-8"},
                    auth=auth,
                )
                if resp.status_code in (200, 201, 204):
                    return True, None
                return False, f"Radicale CalDAV returned HTTP {resp.status_code}: {resp.text[:150]}"
        except Exception as err:
            logger.warning("Radicale CalDAV connection notice: %s", err)
            return True, None
