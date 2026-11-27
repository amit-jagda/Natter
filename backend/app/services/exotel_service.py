"""Exotel India Cloud Telephony Service for Real-World Outbound Patient Calling.

Enables placing real cellular phone calls to Indian patients (+91) via Exotel's
TRAI-certified telecom network, connecting calls to the Voice AI Assistant,
and using the hospital's Exotel virtual number or verified caller ID.
"""

import logging
import uuid
from typing import Any, Dict

import httpx
from app.core.config import settings
from app.services.session_store import session_store

logger = logging.getLogger(__name__)


def format_exotel_phone(phone: str) -> str:
    """Formats phone number for Exotel Indian calling.

    Exotel typically expects Indian mobile numbers formatted with leading 0 or +91.
    e.g. '8980616264' -> '08980616264' (or '+918980616264').
    """
    digits = "".join(filter(str.isdigit, phone))
    if len(digits) == 10:
        return f"0{digits}"
    if len(digits) == 12 and digits.startswith("91"):
        return f"0{digits[2:]}"
    if phone.startswith("+"):
        return phone
    return f"0{digits}" if digits else phone


class ExotelTelephonyService:
    """Manages Exotel outbound calls and webhook turn routing for India."""

    def __init__(self) -> None:
        self.api_key = settings.EXOTEL_API_KEY
        self.api_token = settings.EXOTEL_API_TOKEN
        self.subdomain = settings.EXOTEL_SUBDOMAIN
        self.caller_id = settings.EXOTEL_CALLER_ID
        self._active_calls: Dict[str, Dict[str, Any]] = {}

    @property
    def is_configured(self) -> bool:
        """Check if Exotel API credentials are set in .env."""
        return bool(self.api_key and self.api_token and self.subdomain)

    async def initiate_outbound_call(
        self,
        to_phone: str,
        from_phone: str,
        patient_name: str,
        hospital_name: str = "Hospital",
        callback_base_url: str = "http://localhost:8000",
    ) -> Dict[str, Any]:
        """Dispatches an outbound phone call via Exotel to the patient."""
        call_id = f"exo_{uuid.uuid4().hex[:10]}"
        to_formatted = format_exotel_phone(to_phone)
        caller_id_val = self.caller_id or format_exotel_phone(from_phone)

        # Create session in memory
        app_session = session_store.get_or_create_session(call_id)
        app_session.add_message(
            "system",
            f"Exotel outbound call to {patient_name} ({to_formatted}) from Caller ID ({caller_id_val}).",
        )

        initial_greeting = (
            f"Hello {patient_name}, this is the Voice AI receptionist calling from {hospital_name} "
            f"regarding your healthcare consultation. How can I assist you today?"
        )
        app_session.add_message("assistant", initial_greeting)

        call_record = {
            "call_id": call_id,
            "patient_name": patient_name,
            "patient_phone": to_formatted,
            "hospital_phone": caller_id_val,
            "status": "queued",
            "provider": "exotel",
            "initial_greeting": initial_greeting,
        }
        self._active_calls[call_id] = call_record

        if not self.is_configured:
            logger.warning("Exotel is not configured with EXOTEL_API_KEY, EXOTEL_API_TOKEN, EXOTEL_SUBDOMAIN in .env")
            return {
                **call_record,
                "configured": False,
                "provider": "exotel_unconfigured",
                "message": (
                    "Exotel credentials (EXOTEL_API_KEY, EXOTEL_API_TOKEN, EXOTEL_SUBDOMAIN, EXOTEL_CALLER_ID) "
                    "need to be configured in .env."
                ),
            }

        # Exotel API: https://<api_key>:<api_token>@api.exotel.com/v1/Accounts/<subdomain>/Calls/connect.json
        exotel_url = f"https://api.exotel.com/v1/Accounts/{self.subdomain}/Calls/connect.json"
        status_callback_url = f"{callback_base_url}/api/v1/telephony/exotel/status-callback?call_id={call_id}"

        from_formatted = format_exotel_phone(from_phone)
        data = {
            "From": from_formatted,
            "To": to_formatted,
            "CallerId": caller_id_val,
            "CallType": "trans",
            "StatusCallback": status_callback_url,
            "CustomField": call_id,
        }

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                res = await client.post(
                    exotel_url,
                    data=data,
                    auth=(self.api_key, self.api_token),
                )
                if res.status_code in (200, 201):
                    json_data = res.json()
                    call_obj = json_data.get("Call", {})
                    call_sid = call_obj.get("Sid", "")
                    call_status = call_obj.get("Status", "in-progress")

                    call_record["exotel_sid"] = call_sid
                    call_record["status"] = call_status
                    logger.info(f"Exotel call successfully initiated: {call_sid} to {to_formatted}")
                    return {
                        **call_record,
                        "configured": True,
                        "status": call_status,
                        "exotel_sid": call_sid,
                    }
                else:
                    error_msg = res.text
                    try:
                        err_json = res.json()
                        rest_exc = err_json.get("RestException", {})
                        if isinstance(rest_exc, dict):
                            error_msg = rest_exc.get("Message", error_msg)
                        elif isinstance(rest_exc, list) and rest_exc:
                            error_msg = rest_exc[0].get("Message", error_msg)
                    except Exception:
                        pass

                    logger.error(f"Exotel API Error ({res.status_code}): {error_msg}")
                    return {
                        **call_record,
                        "configured": True,
                        "status": "failed",
                        "error": error_msg,
                        "message": error_msg,
                        "status_code": res.status_code,
                    }
        except Exception as exc:
            logger.error(f"Failed to communicate with Exotel: {exc}")
            return {
                **call_record,
                "configured": True,
                "status": "error",
                "error": str(exc),
                "message": str(exc),
            }

    def update_call_status(self, call_id: str, new_status: str) -> None:
        """Updates status of active Exotel call."""
        if call_id in self._active_calls:
            self._active_calls[call_id]["status"] = new_status


exotel_service = ExotelTelephonyService()
