"""Twilio Cloud Telephony Service for Real-World Outbound Patient Calling.

Enables placing cellular phone calls to patients without requiring any Android app,
connecting answered calls directly to the Voice AI Bot using TwiML Speech Gathering,
and displaying the hospital's registered phone number as Caller ID.
"""

import logging
import uuid
from typing import Any, Dict, Optional
from urllib.parse import quote_plus
import httpx

from app.core.config import settings
from app.services.session_store import session_store

logger = logging.getLogger(__name__)


def format_e164(phone: str, default_country_code: str = "+91") -> str:
    """Formats phone number to standard E.164 international format (+91XXXXXXXXXX)."""
    digits = "".join(filter(str.isdigit, phone))
    if phone.startswith("+"):
        return f"+{digits}"
    if len(digits) == 10:
        return f"{default_country_code}{digits}"
    if len(digits) == 12 and digits.startswith("91"):
        return f"+{digits}"
    return f"+{digits}" if digits else phone


class TwilioTelephonyService:
    """Manages Twilio outbound calls, TwiML generation, and speech turn routing."""

    def __init__(self) -> None:
        self.account_sid = settings.TWILIO_ACCOUNT_SID
        self.auth_token = settings.TWILIO_AUTH_TOKEN
        self.default_phone = settings.TWILIO_PHONE_NUMBER
        self._active_calls: Dict[str, Dict[str, Any]] = {}

    @property
    def is_configured(self) -> bool:
        """Check if Twilio account credentials are present."""
        return bool(self.account_sid and self.auth_token)

    async def initiate_outbound_call(
        self,
        to_phone: str,
        from_phone: str,
        patient_name: str,
        hospital_name: str = "Hospital",
        callback_base_url: str = "http://localhost:8000",
    ) -> Dict[str, Any]:
        """Dispatches an outbound phone call via Twilio to the patient."""
        call_id = f"tw_{uuid.uuid4().hex[:10]}"
        to_e164 = format_e164(to_phone)
        from_e164 = format_e164(self.default_phone or from_phone)

        # Store session
        app_session = session_store.get_or_create_session(call_id)
        app_session.add_message(
            "system",
            f"Twilio outbound call to {patient_name} ({to_e164}) from Hospital ({from_e164}).",
        )

        initial_greeting = (
            f"Hello {patient_name}, this is the Voice AI receptionist calling from {hospital_name} "
            f"regarding your healthcare consultation. How can I assist you today?"
        )
        app_session.add_message("assistant", initial_greeting)

        call_record = {
            "call_id": call_id,
            "patient_name": patient_name,
            "patient_phone": to_e164,
            "hospital_phone": from_e164,
            "status": "queued",
            "initial_greeting": initial_greeting,
        }
        self._active_calls[call_id] = call_record

        if not self.is_configured:
            logger.warning("Twilio is not fully configured with TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env")
            return {
                **call_record,
                "configured": False,
                "provider": "twilio_unconfigured",
                "message": (
                    "Twilio credentials (TWILIO_ACCOUNT_SID & TWILIO_AUTH_TOKEN) need to be configured in .env. "
                    "Call simulation is ready."
                ),
            }

        # Dispatch real phone call to Twilio REST API
        twilio_url = f"https://api.twilio.com/2010-04-01/Accounts/{self.account_sid}/Calls.json"
        twiml_url = (
            f"{callback_base_url}/api/v1/telephony/twilio/twiml?"
            f"call_id={call_id}&patient_name={quote_plus(patient_name)}&hospital_name={quote_plus(hospital_name)}"
        )

        data = {
            "To": to_e164,
            "From": from_e164,
            "Url": twiml_url,
            "Method": "POST",
            "StatusCallback": f"{callback_base_url}/api/v1/telephony/twilio/status-callback?call_id={call_id}",
        }

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                res = await client.post(
                    twilio_url,
                    data=data,
                    auth=(self.account_sid, self.auth_token),
                )
                if res.status_code in (200, 201):
                    json_data = res.json()
                    twilio_call_sid = json_data.get("sid", "")
                    call_record["twilio_sid"] = twilio_call_sid
                    call_record["status"] = json_data.get("status", "queued")
                    logger.info(f"Twilio call successfully queued: {twilio_call_sid} to {to_e164}")
                    return {
                        **call_record,
                        "configured": True,
                        "provider": "twilio",
                        "twilio_sid": twilio_call_sid,
                    }
                else:
                    error_msg = res.text
                    try:
                        err_json = res.json()
                        error_msg = err_json.get("message", error_msg)
                    except Exception:
                        pass

                    logger.error(f"Twilio API Error ({res.status_code}): {error_msg}")
                    return {
                        **call_record,
                        "configured": True,
                        "status": "failed",
                        "error": error_msg,
                        "status_code": res.status_code,
                    }
                    logger.error(f"Twilio API Error ({res.status_code}): {error_msg}")
                    return {
                        **call_record,
                        "configured": True,
                        "status": "failed",
                        "error": error_msg,
                        "message": error_msg,
                        "status_code": res.status_code,
                    }
        except Exception as exc:
            logger.error(f"Failed to communicate with Twilio: {exc}")
            return {
                **call_record,
                "configured": True,
                "status": "error",
                "error": str(exc),
                "message": str(exc),
            }

    def generate_initial_twiml(
        self,
        call_id: str,
        patient_name: str,
        hospital_name: str,
        callback_base_url: str,
    ) -> str:
        """Returns TwiML for the initial greeting and speech gathering with real-time barge-in."""
        greeting = (
            f"Hello {patient_name}, this is the Voice AI receptionist calling from {hospital_name}. "
            f"How was your healthcare consultation today?"
        )
        turn_action_url = f"{callback_base_url}/api/v1/telephony/twilio/turn?call_id={call_id}"

        return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather input="speech" action="{turn_action_url}" method="POST" speechTimeout="auto" language="en-IN" bargeIn="true">
        <Say voice="Polly.Aditi" language="en-IN">{greeting}</Say>
    </Gather>
    <Say voice="Polly.Aditi" language="en-IN">We could not hear your response. Thank you from {hospital_name}. Goodbye.</Say>
</Response>"""

    def generate_turn_twiml(
        self,
        call_id: str,
        bot_reply: str,
        callback_base_url: str,
        is_closing: bool = False,
    ) -> str:
        """Returns TwiML with the Voice AI's spoken reply and next speech gather with barge-in."""
        turn_action_url = f"{callback_base_url}/api/v1/telephony/twilio/turn?call_id={call_id}"

        if is_closing:
            return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Aditi" language="en-IN">{bot_reply}</Say>
    <Hangup/>
</Response>"""

        return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather input="speech" action="{turn_action_url}" method="POST" speechTimeout="auto" language="en-IN" bargeIn="true">
        <Say voice="Polly.Aditi" language="en-IN">{bot_reply}</Say>
    </Gather>
    <Say voice="Polly.Aditi" language="en-IN">Thank you for your valuable time. Have a healthy day ahead.</Say>
</Response>"""

    def update_call_status(self, call_id: str, new_status: str) -> None:
        """Updates status of active call."""
        if call_id in self._active_calls:
            self._active_calls[call_id]["status"] = new_status


twilio_service = TwilioTelephonyService()
