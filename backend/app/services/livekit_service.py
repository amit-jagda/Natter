"""LiveKit WebRTC & Telephony Call Service.

Handles LiveKit JWT access token generation, room allocation,
outbound/inbound call session management, and conversational turn bridging.
"""

import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional
import jwt

from app.core.config import settings
from app.services.session_store import session_store
from app.services.voice_orchestrator import voice_orchestrator

logger = logging.getLogger(__name__)


@dataclass
class ActiveCallSession:
    """Active live call session representation."""
    call_id: str
    room_name: str
    direction: str  # "outbound" | "inbound"
    hospital_phone: str
    patient_phone: str
    patient_name: str
    patient_id: Optional[str] = None
    status: str = "initiated"  # "initiated" | "ringing" | "connected" | "ended"
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    messages: List[Dict[str, str]] = field(default_factory=list)


class LiveKitTelephonyService:
    """Service for managing LiveKit WebRTC and Telephony call sessions."""

    def __init__(self) -> None:
        self._active_calls: Dict[str, ActiveCallSession] = {}

    def create_token(
        self,
        room_name: str,
        participant_identity: str,
        participant_name: str,
        can_publish: bool = True,
        can_subscribe: bool = True,
        ttl_seconds: int = 3600,
    ) -> str:
        """Create a signed LiveKit access token with room permissions."""
        now = int(time.time())
        payload = {
            "iss": settings.LIVEKIT_API_KEY,
            "sub": participant_identity,
            "name": participant_name,
            "nbf": now - 5,
            "exp": now + ttl_seconds,
            "video": {
                "room": room_name,
                "roomJoin": True,
                "canPublish": can_publish,
                "canSubscribe": can_subscribe,
                "canPublishData": True,
            },
        }
        return jwt.encode(payload, settings.LIVEKIT_API_SECRET, algorithm="HS256")

    def initiate_outbound_call(
        self,
        *,
        hospital_phone: str,
        patient_phone: str,
        patient_name: str,
        patient_id: Optional[str] = None,
        tenant_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Initiate an outbound call from the hospital to a patient.

        Returns LiveKit connection credentials and session context.
        """
        call_id = f"call_{uuid.uuid4().hex[:10]}"
        room_name = f"room_{call_id}"

        # Token for the human participant (patient / operator)
        token = self.create_token(
            room_name=room_name,
            participant_identity=f"user_{uuid.uuid4().hex[:6]}",
            participant_name=patient_name or "Patient",
        )

        session = ActiveCallSession(
            call_id=call_id,
            room_name=room_name,
            direction="outbound",
            hospital_phone=hospital_phone or "+91 98765 43210",
            patient_phone=patient_phone,
            patient_name=patient_name or "Patient",
            patient_id=patient_id,
            status="connected",
        )
        self._active_calls[call_id] = session

        # Pre-seed session in session_store with hospital AI receptionist prompt
        app_session = session_store.get_or_create_session(call_id)
        hospital_display = tenant_name or "City Care Hospital"
        greeting = (
            f"Hello {patient_name}, this is the automated Voice AI Assistant calling from {hospital_display} "
            f"regarding your consultation records and upcoming doctor schedule. How can I assist you today?"
        )
        app_session.add_message("assistant", greeting)

        return {
            "call_id": call_id,
            "room_name": room_name,
            "token": token,
            "server_url": settings.LIVEKIT_URL,
            "direction": "outbound",
            "hospital_phone": session.hospital_phone,
            "patient_phone": session.patient_phone,
            "patient_name": session.patient_name,
            "initial_greeting": greeting,
            "status": "connected",
        }

    def initiate_inbound_call(
        self,
        *,
        patient_phone: Optional[str] = None,
        hospital_phone: Optional[str] = None,
        tenant_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Initiate an incoming patient call to the hospital AI agent."""
        call_id = f"inbound_{uuid.uuid4().hex[:10]}"
        room_name = f"room_{call_id}"

        token = self.create_token(
            room_name=room_name,
            participant_identity=f"caller_{uuid.uuid4().hex[:6]}",
            participant_name="Inbound Caller",
        )

        session = ActiveCallSession(
            call_id=call_id,
            room_name=room_name,
            direction="inbound",
            hospital_phone=hospital_phone or "+91 98765 43210",
            patient_phone=patient_phone or "Caller",
            patient_name="Inbound Patient",
            status="connected",
        )
        self._active_calls[call_id] = session

        hospital_display = tenant_name or "City Care Hospital"
        greeting = (
            f"Welcome to {hospital_display} reception. I am the Voice AI Agent. "
            f"I can help you check doctor timings, book an appointment, or answer hospital queries. How may I help?"
        )
        app_session = session_store.get_or_create_session(call_id)
        app_session.add_message("assistant", greeting)

        return {
            "call_id": call_id,
            "room_name": room_name,
            "token": token,
            "server_url": settings.LIVEKIT_URL,
            "direction": "inbound",
            "hospital_phone": session.hospital_phone,
            "patient_phone": session.patient_phone,
            "initial_greeting": greeting,
            "status": "connected",
        }

    def get_call(self, call_id: str) -> Optional[ActiveCallSession]:
        return self._active_calls.get(call_id)

    def end_call(self, call_id: str) -> bool:
        if call_id in self._active_calls:
            self._active_calls[call_id].status = "ended"
            return True
        return False


livekit_telephony_service = LiveKitTelephonyService()
