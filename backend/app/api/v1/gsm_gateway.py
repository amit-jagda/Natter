"""GSM Gateway & SIM Telephony API Router.

Provides endpoints for:
- Querying Android phone gateway status (SIM number, online/offline, battery)
- Polling / dispatching outbound dialing commands to the Android phone
- Synchronizing call state transitions (dialing -> ringing -> connected -> ended)
- Processing AI conversational turns during active cellular phone calls
"""

import logging
from typing import Any, Dict, Optional

from app.adapters.llm.factory import get_llm_gateway
from app.api.deps import get_current_tenant, get_current_user
from app.models.tenant import Tenant
from app.models.user import User
from app.services.gsm_gateway_service import gsm_gateway_service
from app.services.session_store import session_store
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/gsm", tags=["GSM Gateway & Physical SIM Telephony"])


class GsmDialRequest(BaseModel):
    patient_name: str = Field(..., description="Full name of the patient")
    patient_phone: str = Field(..., description="Mobile number of the patient to dial")
    patient_id: Optional[str] = Field(None, description="Patient record ID if available")
    hospital_phone: Optional[str] = Field(None, description="Hospital SIM number from Hospital Profile")


class GsmHeartbeatRequest(BaseModel):
    device_id: str = Field(..., description="Android device ID")
    device_name: str = Field("Android Phone", description="Device model name")
    sim_number: str = Field(..., description="Phone number of the physical SIM in the phone")
    battery_level: int = Field(100, description="Battery percentage 0-100")
    is_charging: bool = Field(False, description="Whether device is connected to charger")


class GsmEventRequest(BaseModel):
    call_id: str = Field(..., description="Call session identifier")
    event: str = Field(..., description="Event name: dialing | ringing | connected | ended | failed")
    duration_sec: int = Field(0, description="Call duration in seconds if ended")


class GsmChatTurnRequest(BaseModel):
    call_id: str = Field(..., description="Active GSM call identifier")
    message: str = Field(..., description="Speech transcript from patient on phone")


@router.get(
    "/status",
    summary="Get status of paired Android GSM Gateway device",
    status_code=status.HTTP_200_OK,
)
async def get_gateway_status() -> Dict[str, Any]:
    """Returns whether the hospital's Android phone gateway is connected and ready."""
    return gsm_gateway_service.get_device_status()


@router.post(
    "/heartbeat",
    summary="Android Phone Gateway Heartbeat & Command Polling",
    status_code=status.HTTP_200_OK,
)
async def phone_heartbeat(payload: GsmHeartbeatRequest) -> Dict[str, Any]:
    """Android phone app calls this to report status and retrieve queued dial commands."""
    return gsm_gateway_service.register_device_heartbeat(
        device_id=payload.device_id,
        device_name=payload.device_name,
        sim_number=payload.sim_number,
        battery=payload.battery_level,
        charging=payload.is_charging,
    )


@router.post(
    "/dial",
    summary="Dispatch outbound call command to hospital Android phone SIM",
    status_code=status.HTTP_200_OK,
)
async def dispatch_gsm_dial(
    payload: GsmDialRequest,
    tenant: Tenant = Depends(get_current_tenant),
    user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Initiates an outbound call from the hospital's physical SIM to the patient's phone."""
    hospital_number = (payload.hospital_phone or tenant.phone_number or "").strip()
    if not hospital_number:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Hospital phone number is not configured in Hospital Profile. Please configure your hospital phone number in Hospital Profile before placing calls.",
        )

    result = gsm_gateway_service.initiate_gsm_call(
        hospital_phone=hospital_number,
        patient_phone=payload.patient_phone,
        patient_name=payload.patient_name,
        tenant_name=tenant.name,
    )
    return result


@router.post(
    "/event",
    summary="Report call state transition from Android gateway app",
    status_code=status.HTTP_200_OK,
)
async def report_gsm_event(payload: GsmEventRequest) -> Dict[str, Any]:
    """Receives events from the Android phone when call rings, is answered, or ends."""
    success = gsm_gateway_service.update_call_status(
        call_id=payload.call_id,
        status=payload.event,
        duration_sec=payload.duration_sec,
    )
    return {"call_id": payload.call_id, "updated": success, "event": payload.event}


@router.post(
    "/chat-turn",
    summary="Process conversational turn between patient and AI during active GSM call",
    status_code=status.HTTP_200_OK,
)
async def process_gsm_chat_turn(payload: GsmChatTurnRequest) -> Dict[str, Any]:
    """Processes speech input from patient and returns the Voice AI agent response."""
    session = session_store.get_or_create_session(payload.call_id)
    session.add_message("user", payload.message)

    try:
        llm = get_llm_gateway()
        llm_res = await llm.generate_response(session.get_messages())
        bot_reply = llm_res.text.strip()
    except Exception as exc:
        logger.warning(f"GSM LLM fallback triggered: {exc}")
        msg_lower = payload.message.lower()
        if "appointment" in msg_lower or "book" in msg_lower:
            bot_reply = "I would be happy to help you schedule an appointment. Which doctor or department would you like to consult?"
        elif "timing" in msg_lower or "time" in msg_lower:
            bot_reply = "Our hospital OPD is open Monday to Saturday from 9:00 AM to 5:00 PM. How can I assist you with doctor schedules?"
        else:
            bot_reply = f"Thank you for sharing that. I have noted: '{payload.message}'. How else may I assist you with your hospital visit?"

    session.add_message("assistant", bot_reply)
    return {"call_id": payload.call_id, "reply": bot_reply}
