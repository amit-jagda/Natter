"""Telephony & LiveKit Calling API Router.

Provides endpoints to initiate outbound hospital calls to patients,
accept inbound calls from callers, generate LiveKit room tokens,
and handle conversational turns with interruption (barge-in).
"""

import logging
import uuid
from typing import Any, Dict, Optional
from urllib.parse import quote_plus

from app.adapters.llm.factory import get_llm_gateway
from app.api.deps import get_current_tenant, get_current_user
from app.core.config import settings
from app.models.tenant import Tenant
from app.models.user import User
from app.services.exotel_service import exotel_service
from app.services.livekit_service import livekit_telephony_service
from app.services.session_store import session_store
from app.services.twilio_service import twilio_service
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/telephony", tags=["Telephony & LiveKit Calling"])


class OutboundCallRequest(BaseModel):
    patient_name: str = Field(..., description="Full name of the patient")
    patient_phone: str = Field(..., description="Mobile number of the patient")
    patient_id: Optional[str] = Field(None, description="Patient record ID if available")
    hospital_phone: Optional[str] = Field(None, description="Hospital caller ID phone number")


class InboundCallRequest(BaseModel):
    caller_phone: Optional[str] = Field(None, description="Incoming caller phone number")
    hospital_phone: Optional[str] = Field(None, description="Hospital phone number dialed")


class EndCallRequest(BaseModel):
    call_id: str = Field(..., description="Active call session identifier")


class ChatTurnRequest(BaseModel):
    call_id: str = Field(..., description="Active call session identifier")
    message: str = Field(..., description="Spoken transcript or text message from caller/patient")


class PhoneCallDispatchRequest(BaseModel):
    patient_name: str = Field(..., description="Full name of the patient")
    patient_phone: str = Field(..., description="Mobile number of the patient")
    patient_id: Optional[str] = Field(None, description="Patient record ID if available")
    hospital_phone: Optional[str] = Field(None, description="Hospital caller ID phone number")


@router.post(
    "/phone-dispatch",
    summary="Dispatch direct phone dial to physical phone with Caller ID validation",
    status_code=status.HTTP_200_OK,
)
async def dispatch_phone_call(
    payload: PhoneCallDispatchRequest,
    tenant: Tenant = Depends(get_current_tenant),
) -> Dict[str, Any]:
    """Prepares and validates direct phone calling from hospital mobile to patient phone."""
    hospital_number = (payload.hospital_phone or tenant.phone_number or "").strip()
    if not hospital_number:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Hospital phone number is not configured in Hospital Profile. Please configure your hospital phone number in Hospital Profile before making calls.",
        )

    clean_patient_phone = "".join(filter(lambda c: c.isdigit() or c == "+", payload.patient_phone))
    clean_hospital_phone = "".join(filter(lambda c: c.isdigit() or c == "+", hospital_number))

    call_id = f"phone_{uuid.uuid4().hex[:10]}"
    app_session = session_store.get_or_create_session(call_id)
    app_session.add_message(
        "system",
        f"Direct Phone Call dispatched from Hospital Phone ({clean_hospital_phone}) to Patient {payload.patient_name} ({clean_patient_phone}).",
    )

    tenant_name = tenant.name or "Hospital"
    wa_msg = quote_plus(f"Hello {payload.patient_name}, this is from {tenant_name}. We called you regarding your medical consultation.")

    return {
        "call_id": call_id,
        "status": "dispatched",
        "hospital_phone": hospital_number,
        "patient_phone": clean_patient_phone,
        "patient_name": payload.patient_name,
        "tel_uri": f"tel:{clean_patient_phone}",
        "whatsapp_uri": f"https://wa.me/{clean_patient_phone.replace('+', '')}?text={wa_msg}",
    }


@router.post(
    "/outbound-call",
    summary="Initiate an outbound call from hospital to patient via LiveKit",
    status_code=status.HTTP_200_OK,
)
async def initiate_outbound_call(
    payload: OutboundCallRequest,
    tenant: Tenant = Depends(get_current_tenant),
    user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Initiate an outbound call to a patient.

    Uses the hospital's registered phone number as Caller ID,
    creates a secure LiveKit room, and connects the call to the Voice AI agent.
    """
    hospital_number = (payload.hospital_phone or tenant.phone_number or "").strip()
    if not hospital_number:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Hospital phone number is not configured in Hospital Profile. Please save your hospital phone number in Hospital Profile before placing calls.",
        )

    result = livekit_telephony_service.initiate_outbound_call(
        hospital_phone=hospital_number,
        patient_phone=payload.patient_phone,
        patient_name=payload.patient_name,
        patient_id=payload.patient_id,
        tenant_name=tenant.name,
    )

    logger.info(
        f"Outbound call initiated: {result['call_id']} | From: {hospital_number} | To: {payload.patient_phone}"
    )
    return result


@router.post(
    "/inbound-call",
    summary="Simulate or connect an inbound caller into the Hospital Voice Agent",
    status_code=status.HTTP_200_OK,
)
async def initiate_inbound_call(
    payload: InboundCallRequest,
    tenant: Tenant = Depends(get_current_tenant),
) -> Dict[str, Any]:
    """Accept an inbound call from a patient to the hospital AI agent."""
    hospital_number = (payload.hospital_phone or tenant.phone_number or "").strip()
    if not hospital_number:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Hospital phone number is not configured in Hospital Profile. Please configure your hospital phone number in Hospital Profile before accepting inbound calls.",
        )

    result = livekit_telephony_service.initiate_inbound_call(
        patient_phone=payload.caller_phone,
        hospital_phone=hospital_number,
        tenant_name=tenant.name,
    )

    logger.info(f"Inbound call connected: {result['call_id']} | Caller: {payload.caller_phone}")
    return result


@router.post(
    "/end-call",
    summary="Terminate or hang up an active call session",
    status_code=status.HTTP_200_OK,
)
async def end_call(
    payload: EndCallRequest,
) -> Dict[str, Any]:
    """Terminates an ongoing call session."""
    success = livekit_telephony_service.end_call(payload.call_id)
    return {"call_id": payload.call_id, "status": "ended" if success else "not_found"}


@router.post(
    "/chat-turn",
    summary="Process conversational turn with AI assistant during call",
    status_code=status.HTTP_200_OK,
)
async def process_telephony_turn(
    payload: ChatTurnRequest,
) -> Dict[str, Any]:
    """Processes speech transcript from patient or caller, queries LLM, and returns assistant reply."""
    session = session_store.get_or_create_session(payload.call_id)
    session.add_message("user", payload.message)

    try:
        llm = get_llm_gateway()
        llm_res = await llm.generate_response(session.get_messages())
        bot_reply = llm_res.text.strip()
    except Exception as exc:
        logger.warning(f"Telephony LLM fallback triggered: {exc}")
        msg_lower = payload.message.lower()
        if "appointment" in msg_lower or "book" in msg_lower:
            bot_reply = "I would be happy to help you schedule an appointment. Which doctor or department would you like to consult?"
        elif "timing" in msg_lower or "time" in msg_lower or "available" in msg_lower:
            bot_reply = "Our OPD operates Monday through Saturday from 9:00 AM to 5:00 PM. Would you like to check doctor schedules?"
        elif "emergency" in msg_lower or "urgent" in msg_lower:
            bot_reply = "If this is a medical emergency, please reach out to our emergency casualty wing or dial 108 immediately."
        else:
            bot_reply = f"Thank you for sharing that. I have noted: '{payload.message}'. How else may I assist you with your hospital visit?"

    session.add_message("assistant", bot_reply)
    return {"call_id": payload.call_id, "reply": bot_reply}


class TwilioCallRequest(BaseModel):
    patient_name: str = Field(..., description="Full name of the patient")
    patient_phone: str = Field(..., description="Mobile number of the patient")
    hospital_phone: Optional[str] = Field(None, description="Hospital caller ID phone number")


@router.get("/twilio/config-status", summary="Check Twilio configuration status")
async def get_twilio_status() -> Dict[str, Any]:
    """Checks whether Twilio credentials are configured in the environment."""
    return {
        "configured": twilio_service.is_configured,
        "account_sid_present": bool(twilio_service.account_sid),
        "auth_token_present": bool(twilio_service.auth_token),
        "phone_number": twilio_service.default_phone or "Not configured (will use hospital SIM caller ID)",
    }


@router.post("/twilio/call", summary="Dispatch real outbound phone call via Twilio to patient")
async def dispatch_twilio_call(
    payload: TwilioCallRequest,
    request: Request,
    tenant: Tenant = Depends(get_current_tenant),
) -> Dict[str, Any]:
    """Places an outbound telephone call to the patient's real phone via Twilio."""
    hospital_number = (payload.hospital_phone or tenant.phone_number or "").strip()
    if not hospital_number:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Hospital phone number is not configured in Hospital Profile. Please configure your hospital phone number before making calls.",
        )

    base_url = str(request.base_url).rstrip("/")
    result = await twilio_service.initiate_outbound_call(
        to_phone=payload.patient_phone,
        from_phone=hospital_number,
        patient_name=payload.patient_name,
        hospital_name=tenant.name or "Hospital",
        callback_base_url=base_url,
    )
    return result


@router.post("/twilio/twiml", summary="Twilio initial greeting TwiML webhook")
async def get_initial_twiml(
    request: Request,
    call_id: str = Query(...),
    patient_name: str = Query("Patient"),
    hospital_name: str = Query("Hospital"),
) -> Response:
    """Provides initial TwiML greeting with speech gather when patient answers the call."""
    base_url = str(request.base_url).rstrip("/")
    xml_content = twilio_service.generate_initial_twiml(
        call_id=call_id,
        patient_name=patient_name,
        hospital_name=hospital_name,
        callback_base_url=base_url,
    )
    return Response(content=xml_content, media_type="application/xml")


@router.post("/twilio/turn", summary="Twilio Speech gathering turn webhook")
async def process_twilio_turn(
    request: Request,
    call_id: str = Query(...),
) -> Response:
    """Processes spoken speech from patient, queries LLM, and responds with audio via TwiML."""
    base_url = str(request.base_url).rstrip("/")
    form_data = await request.form()
    speech_result = str(form_data.get("SpeechResult", "")).strip()

    session = session_store.get_or_create_session(call_id)
    if speech_result:
        session.add_message("user", speech_result)

    try:
        llm = get_llm_gateway()
        llm_res = await llm.generate_response(session.get_messages())
        bot_reply = llm_res.text.strip()
    except Exception as exc:
        logger.warning(f"Twilio LLM fallback triggered: {exc}")
        bot_reply = "Thank you for sharing your feedback with our hospital care team. Is there anything else we can assist you with?"

    session.add_message("assistant", bot_reply)
    is_closing = any(w in speech_result.lower() for w in ["bye", "thank you", "thanks", "done", "no"])
    xml_content = twilio_service.generate_turn_twiml(
        call_id=call_id,
        bot_reply=bot_reply,
        callback_base_url=base_url,
        is_closing=is_closing,
    )
    return Response(content=xml_content, media_type="application/xml")


@router.post("/twilio/status-callback", summary="Twilio call status updates")
async def twilio_status_callback(
    request: Request,
    call_id: str = Query(...),
) -> Dict[str, Any]:
    """Captures Twilio call lifecycle events (initiated, ringing, answered, completed)."""
    form_data = await request.form()
    call_status = str(form_data.get("CallStatus", "unknown"))
    twilio_service.update_call_status(call_id, call_status)
    logger.info(f"Twilio status callback: Call {call_id} -> {call_status}")
    return {"status": "ok", "call_id": call_id, "call_status": call_status}


class UnifiedCallRequest(BaseModel):
    patient_name: str = Field(..., description="Full name of the patient")
    patient_phone: str = Field(..., description="Mobile number of the patient")
    hospital_phone: Optional[str] = Field(None, description="Hospital caller ID phone number")
    provider: Optional[str] = Field(None, description="Optional override provider ('twilio' or 'exotel')")


@router.get("/provider-status", summary="Get status of all configured telephony providers")
async def get_telephony_providers_status() -> Dict[str, Any]:
    """Returns active calling provider and readiness of Twilio and Exotel."""
    active_prov = settings.ACTIVE_CALLING_PROVIDER
    return {
        "active_provider": active_prov,
        "calling_provider_setting": settings.CALLING_PROVIDER or settings.TELEPHONY_PROVIDER,
        "twilio": {
            "configured": twilio_service.is_configured,
            "account_sid_present": bool(twilio_service.account_sid),
            "phone_number": twilio_service.default_phone or "Will use hospital caller ID",
        },
        "exotel": {
            "configured": exotel_service.is_configured,
            "api_key_present": bool(exotel_service.api_key),
            "subdomain": exotel_service.subdomain or "Not set",
            "caller_id": exotel_service.caller_id or "Will use hospital caller ID",
        },
    }


@router.post("/dispatch-call", summary="Dispatch outbound call via active provider (Twilio or Exotel)")
async def dispatch_unified_call(
    payload: UnifiedCallRequest,
    request: Request,
    tenant: Tenant = Depends(get_current_tenant),
) -> Dict[str, Any]:
    """Dynamically routes call to Twilio or Exotel based on CALLING_PROVIDER in .env."""
    hospital_number = (payload.hospital_phone or tenant.phone_number or "").strip()
    if not hospital_number:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Hospital phone number is not configured in Hospital Profile. Please configure your hospital phone number before making calls.",
        )

    base_url = str(request.base_url).rstrip("/")
    target_provider = (payload.provider or settings.ACTIVE_CALLING_PROVIDER).strip().lower()

    if target_provider == "exotel":
        logger.info(f"Routing outbound call to Exotel for patient {payload.patient_name} ({payload.patient_phone})")
        return await exotel_service.initiate_outbound_call(
            to_phone=payload.patient_phone,
            from_phone=hospital_number,
            patient_name=payload.patient_name,
            hospital_name=tenant.name or "Hospital",
            callback_base_url=base_url,
        )
    else:
        logger.info(f"Routing outbound call to Twilio for patient {payload.patient_name} ({payload.patient_phone})")
        return await twilio_service.initiate_outbound_call(
            to_phone=payload.patient_phone,
            from_phone=hospital_number,
            patient_name=payload.patient_name,
            hospital_name=tenant.name or "Hospital",
            callback_base_url=base_url,
        )


@router.post("/exotel/status-callback", summary="Exotel call status webhook")
async def exotel_status_callback(
    request: Request,
    call_id: str = Query(...),
) -> Dict[str, Any]:
    """Captures Exotel call lifecycle callbacks."""
    form_data = await request.form()
    call_status = str(form_data.get("Status", form_data.get("CallStatus", "unknown")))
    exotel_service.update_call_status(call_id, call_status)
    logger.info(f"Exotel status callback: Call {call_id} -> {call_status}")
    return {"status": "ok", "call_id": call_id, "exotel_status": call_status}

