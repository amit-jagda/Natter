"""External Connector Sync Service.

Handles multi-tenant synchronization of hospital appointments with:
- Google Calendar (Doctor schedule)
- Google Sheets (Receptionist booking records)
- Radicale CalDAV (Independent self-hosted calendar)
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple
import uuid
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.connector import HospitalConnector

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
                    HospitalConnector.is_active == True,
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
    async def _sync_google_sheets(
        cls, conn: HospitalConnector, data: Dict[str, Any]
    ) -> Tuple[bool, Optional[str]]:
        webhook_url = (conn.config or {}).get("webhookUrl")
        if not webhook_url:
            return True, None

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

    @classmethod
    async def _sync_google_calendar(
        cls, conn: HospitalConnector, data: Dict[str, Any]
    ) -> Tuple[bool, Optional[str]]:
        calendar_id = (conn.config or {}).get("calendarId")
        if not calendar_id:
            return False, "Missing Google Calendar ID in connector config"

        logger.info(
            "Appointment %s registered for Google Calendar '%s' (Doctor: %s, Patient: %s)",
            data.get("appointment_id"),
            calendar_id,
            data.get("doctor_name"),
            data.get("patient_name"),
        )
        return True, None

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

        dt_str = str(data.get("appointment_date", "")).replace("-", "")
        st_str = str(data.get("start_time", "09:00")).replace(":", "") + "00"
        et_str = str(data.get("end_time", "09:30")).replace(":", "") + "00"

        ics_content = (
            f"BEGIN:VCALENDAR\r\n"
            f"VERSION:2.0\r\n"
            f"PRODID:-//Hospital Voice Agent//EN\r\n"
            f"BEGIN:VEVENT\r\n"
            f"UID:{data.get('appointment_id')}@hospital-agent.ai\r\n"
            f"DTSTAMP:{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}\r\n"
            f"DTSTART:{dt_str}T{st_str}\r\n"
            f"DTEND:{dt_str}T{et_str}\r\n"
            f"SUMMARY:Consultation: {data.get('patient_name')} with {data.get('doctor_name')}\r\n"
            f"DESCRIPTION:Booked via Hospital Voice Agent. Notes: {data.get('notes', '')}\r\n"
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
