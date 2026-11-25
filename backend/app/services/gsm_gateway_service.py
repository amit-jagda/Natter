"""Android GSM Gateway & SIM Telephony Service.

Enables an Android smartphone running a local gateway app with a physical SIM card
(e.g., Hospital SIM 9328291692) to act as a cellular telecom gateway.
Coordinates:
- Device heartbeat & pairing
- Outbound dialing command dispatch
- Call lifecycle tracking (dialing, ringing, answered, ended)
- Audio bridging between the phone call and the Voice AI Orchestrator
"""

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

from app.services.session_store import session_store
from app.services.voice_orchestrator import voice_orchestrator

logger = logging.getLogger(__name__)


@dataclass
class GsmDevice:
    """Connected Android phone acting as GSM Gateway."""
    device_id: str
    device_name: str
    sim_number: str
    battery_level: int = 100
    is_charging: bool = False
    status: str = "online"  # "online" | "in_call" | "offline"
    last_seen: float = field(default_factory=time.time)


@dataclass
class GsmCallRecord:
    """Ongoing or completed GSM call record."""
    call_id: str
    hospital_phone: str
    patient_phone: str
    patient_name: str
    status: str = "queued"  # "queued" | "dialing" | "ringing" | "connected" | "ended"
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    duration_sec: int = 0
    transcript: List[Dict[str, str]] = field(default_factory=list)


class GsmGatewayService:
    """Coordinates physical Android phone SIM calling and AI voice bridge."""

    def __init__(self) -> None:
        self._devices: Dict[str, GsmDevice] = {}
        self._calls: Dict[str, GsmCallRecord] = {}
        self._pending_commands: Dict[str, List[Dict[str, Any]]] = {}

        # Pre-seed default paired hospital gateway for local operation
        default_dev_id = "hospital_gateway_01"
        self._devices[default_dev_id] = GsmDevice(
            device_id=default_dev_id,
            device_name="Hospital Android Phone (Samsung/Pixel)",
            sim_number="9328291692",
            status="online",
        )
        self._pending_commands[default_dev_id] = []

    def get_device_status(self, device_id: Optional[str] = None) -> Dict[str, Any]:
        """Returns the status of connected GSM Gateway devices."""
        dev = None
        if device_id and device_id in self._devices:
            dev = self._devices[device_id]
        elif self._devices:
            dev = list(self._devices.values())[0]

        if not dev:
            return {
                "paired": False,
                "status": "offline",
                "message": "No Android Gateway device connected yet.",
            }

        return {
            "paired": True,
            "device_id": dev.device_id,
            "device_name": dev.device_name,
            "sim_number": dev.sim_number,
            "status": dev.status,
            "battery_level": dev.battery_level,
            "is_charging": dev.is_charging,
            "last_seen_sec_ago": int(time.time() - dev.last_seen),
        }

    def register_device_heartbeat(
        self,
        device_id: str,
        device_name: str,
        sim_number: str,
        battery: int = 100,
        charging: bool = False,
    ) -> Dict[str, Any]:
        """Registers or refreshes heartbeat from the Android gateway app."""
        self._devices[device_id] = GsmDevice(
            device_id=device_id,
            device_name=device_name,
            sim_number=sim_number,
            battery_level=battery,
            is_charging=charging,
            status="online",
            last_seen=time.time(),
        )
        if device_id not in self._pending_commands:
            self._pending_commands[device_id] = []

        # Return any queued dialing commands for this phone
        commands = list(self._pending_commands[device_id])
        self._pending_commands[device_id].clear()

        return {
            "status": "ok",
            "pending_commands": commands,
        }

    def initiate_gsm_call(
        self,
        hospital_phone: str,
        patient_phone: str,
        patient_name: str,
        tenant_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Queues an outbound cellular phone call to be dialed by the hospital's SIM card."""
        call_id = f"gsm_{uuid.uuid4().hex[:10]}"

        clean_patient_phone = "".join(filter(lambda c: c.isdigit() or c == "+", patient_phone))
        clean_hospital_phone = "".join(filter(lambda c: c.isdigit() or c == "+", hospital_phone))

        record = GsmCallRecord(
            call_id=call_id,
            hospital_phone=clean_hospital_phone,
            patient_phone=clean_patient_phone,
            patient_name=patient_name,
            status="dialing",
        )
        self._calls[call_id] = record

        # Pre-seed session in session store with greeting
        hospital_display = tenant_name or "Hospital"
        initial_greeting = (
            f"Hello {patient_name}, this is the Voice AI receptionist calling from {hospital_display} "
            f"regarding your healthcare consultation. How can I assist you today?"
        )
        session = session_store.get_or_create_session(call_id)
        session.add_message("assistant", initial_greeting)
        record.transcript.append({"sender": "bot", "text": initial_greeting})

        # Queue dial command for the Android gateway device
        dial_command = {
            "action": "dial",
            "call_id": call_id,
            "target_number": clean_patient_phone,
            "hospital_sim": clean_hospital_phone,
            "timestamp": time.time(),
        }

        # Queue command for all paired devices
        for dev_id in self._pending_commands:
            self._pending_commands[dev_id].append(dial_command)
            if dev_id in self._devices:
                self._devices[dev_id].status = "in_call"

        logger.info(
            f"GSM Call enqueued: {call_id} | From SIM: {clean_hospital_phone} | To: {clean_patient_phone}"
        )

        return {
            "call_id": call_id,
            "status": "dialing",
            "hospital_phone": clean_hospital_phone,
            "patient_phone": clean_patient_phone,
            "patient_name": patient_name,
            "initial_greeting": initial_greeting,
            "device": self.get_device_status(),
        }

    def update_call_status(
        self,
        call_id: str,
        status: str,
        duration_sec: int = 0,
    ) -> bool:
        """Updates call lifecycle from Android gateway event."""
        if call_id in self._calls:
            self._calls[call_id].status = status
            if duration_sec > 0:
                self._calls[call_id].duration_sec = duration_sec

            if status in ("ended", "failed", "busy"):
                for dev in self._devices.values():
                    dev.status = "online"
            return True
        return False

    def get_call(self, call_id: str) -> Optional[GsmCallRecord]:
        return self._calls.get(call_id)


gsm_gateway_service = GsmGatewayService()
