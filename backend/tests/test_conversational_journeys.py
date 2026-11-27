"""End-to-End Multi-Turn Conversational Journeys Test Suite (Phase 4).

Tests full realistic dialog journeys across multiple turns:
1. Journey 1: New Patient Onboarding -> Specialty Discovery -> Slot Selection -> Atomic Booking.
2. Journey 2: Returning Patient Identity Verification -> Slot Conflict -> Recovery via Alternatives.
3. Journey 3: Emergency Symptom Recognition -> Immediate Reassuring Diversion.
4. Journey 4: Verification Failure Threshold -> Automatic Lockout & Human Transfer.
5. Journey 5: Appointment Rescheduling Flow for Verified Patient.
"""

import asyncio
from datetime import date, datetime, time, timedelta
import os
from pathlib import Path
import re
import sys
import unittest
import uuid
from typing import Any, Dict, List, Optional

backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

os.environ["ENVIRONMENT"] = "test"
os.environ["SECRET_KEY"] = "test-secret-key-for-conversational-journeys-phase-4"

from app.adapters.llm.base import LLMGateway, LLMMessage, LLMResponse, ToolCall
from app.models.appointment import Appointment
from app.models.doctor import Doctor, DoctorAvailability
from app.models.doctor_leave import DoctorLeave
from app.models.operating_hours import HospitalOperatingHours
from app.models.patient import Patient
from app.models.tenant import Tenant
from app.models.user import User
from app.services.conversation.orchestrator import ConversationOrchestrator
from app.services.conversation.session_store import ConversationSessionStore
from app.services.conversation.state import ConversationState
from app.services.tools.healthcare_tools import healthcare_tool_registry


class MockScalars:
    def __init__(self, items):
        self._items = items

    def all(self):
        return list(self._items)


class MockResult:
    def __init__(self, items, tuples=None):
        self._items = items
        self._tuples = tuples or []

    def scalars(self):
        return MockScalars(self._items)

    def scalar_one_or_none(self):
        return self._items[0] if self._items else None

    def all(self):
        if self._tuples:
            return list(self._tuples)
        return list(self._items)


class MockAsyncSession:
    """In-memory async database session mock for testing conversational journeys."""

    def __init__(self):
        self.patients: List[Patient] = []
        self.doctors: List[Doctor] = []
        self.doctor_availabilities: List[DoctorAvailability] = []
        self.doctor_leaves: List[DoctorLeave] = []
        self.appointments: List[Appointment] = []
        self.operating_hours: List[HospitalOperatingHours] = []

    def add(self, obj):
        if isinstance(obj, Patient):
            if not getattr(obj, "id", None):
                obj.id = uuid.uuid4()
            self.patients.append(obj)
        elif isinstance(obj, Appointment):
            if not getattr(obj, "id", None):
                obj.id = uuid.uuid4()
            self.appointments.append(obj)
        elif isinstance(obj, DoctorLeave):
            if not getattr(obj, "id", None):
                obj.id = uuid.uuid4()
            self.doctor_leaves.append(obj)

    async def commit(self):
        pass

    async def rollback(self):
        pass

    async def refresh(self, obj):
        pass

    async def execute(self, statement):
        stmt_str = str(statement)

        # 1. Distinct Doctor Specialization
        if "distinct" in stmt_str.lower() and "specialization" in stmt_str.lower():
            specs = set(d.specialization for d in self.doctors if d.is_active)
            return MockResult([], tuples=[(s,) for s in specs])

        # 2. Query Patient
        if "FROM patients" in stmt_str:
            matched = list(self.patients)
            try:
                params = statement.compile().params
                for k, v in params.items():
                    if k.startswith("tenant_id") and isinstance(v, uuid.UUID):
                        matched = [p for p in matched if p.tenant_id == v]
                    elif (k.startswith("id_") or k == "id") and isinstance(v, uuid.UUID):
                        matched = [p for p in matched if p.id == v]
                    elif "phone" in k:
                        digits = re.sub(r"\D", "", str(v))
                        if digits:
                            matched = [
                                p for p in matched
                                if p.phone == digits or (len(digits) >= 10 and p.phone.endswith(digits[-10:]))
                            ]
            except Exception:
                pass
            return MockResult(matched)

        # 3. Query Operating Hours
        if "FROM hospital_operating_hours" in stmt_str:
            return MockResult(list(self.operating_hours))

        # 4. Query Doctor
        if "FROM doctors" in stmt_str:
            return MockResult(list(self.doctors))

        # 5. Query Doctor Leaves
        if "FROM doctor_leaves" in stmt_str:
            return MockResult(list(self.doctor_leaves))

        # 6. Query Appointments
        if "FROM appointments" in stmt_str:
            matched = [a for a in self.appointments if a.status != "cancelled"]
            return MockResult(matched)

        return MockResult([])


class ScriptedLLMGateway(LLMGateway):
    """Scripted LLM gateway that plays back designated responses per turn."""

    def __init__(self, turns: List[List[LLMResponse]]):
        self.turns = [list(t) for t in turns]
        self.current_turn = 0

    async def complete(self, messages: List[LLMMessage], tools: Optional[List[Any]] = None) -> LLMResponse:
        if self.current_turn < len(self.turns):
            turn_responses = self.turns[self.current_turn]
            if turn_responses:
                resp = turn_responses.pop(0)
                if not turn_responses:
                    self.current_turn += 1
                return resp
        return LLMResponse(content="How else may I help you?", tool_calls=[])

    async def stream(self, messages: List[LLMMessage], tools: Optional[List[Any]] = None):
        resp = await self.complete(messages, tools)
        yield resp.content


def run_async(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class TestConversationalJourneys(unittest.TestCase):
    """Test suite validating end-to-end multi-turn journeys."""

    def setUp(self):
        self.tenant_id = uuid.uuid4()
        self.doctor_id = uuid.uuid4()
        self.user_id = uuid.uuid4()
        self.patient_id = uuid.uuid4()

        cand = date.today() + timedelta(days=2)
        while cand.weekday() != 2:
            cand += timedelta(days=1)
        self.future_wednesday = cand
        self.future_wednesday_str = cand.isoformat()

        self.db = MockAsyncSession()

        # Doctor user & profile
        self.doctor_user = User(
            id=self.user_id,
            tenant_id=self.tenant_id,
            email="dr.smith@metrohospital.org",
            hashed_password="hash",
            full_name="Dr. Jane Smith",
        )
        self.doctor = Doctor(
            id=self.doctor_id,
            tenant_id=self.tenant_id,
            user_id=self.user_id,
            specialization="Cardiology",
            department="Cardiology Block A",
            slot_duration_minutes=30,
            consultation_fee=500.0,
            is_active=True,
        )
        self.doctor.user = self.doctor_user

        # Shift: Wednesday 10:00 - 13:00
        self.availability = DoctorAvailability(
            id=uuid.uuid4(),
            tenant_id=self.tenant_id,
            doctor_id=self.doctor_id,
            day_of_week=2,  # Wednesday
            start_time=time(10, 0),
            end_time=time(13, 0),
            is_available=True,
        )
        self.doctor.availabilities = [self.availability]

        # Operating hours: Wednesday 08:00 - 20:00
        self.operating_hour = HospitalOperatingHours(
            id=uuid.uuid4(),
            tenant_id=self.tenant_id,
            day_of_week=2,
            open_time=time(8, 0),
            close_time=time(20, 0),
            is_closed=False,
        )

        # Existing patient
        self.existing_patient = Patient(
            id=self.patient_id,
            tenant_id=self.tenant_id,
            name="Rahul Sharma",
            phone="9876543210",
            email="rahul@example.com",
            date="2026-11-01",
            gender="Male",
        )

        self.db.doctors.append(self.doctor)
        self.db.patients.append(self.existing_patient)
        self.db.operating_hours.append(self.operating_hour)

    # -------------------------------------------------------------------------
    # Journey 1: New Patient Onboarding -> Discovery -> Availability -> Booking
    # -------------------------------------------------------------------------
    def test_journey_new_patient_discovery_and_booking(self):
        """Verify full multi-turn onboarding and booking for a new patient."""
        session_id = f"journey-new-patient-{uuid.uuid4()}"
        store = ConversationSessionStore()

        # Turn 1: Search doctors by specialty
        t1_step1 = LLMResponse(
            content="",
            tool_calls=[
                ToolCall(
                    name="search_doctors",
                    arguments={"specialty": "Cardiology"},
                    call_id="c_doc_search",
                )
            ],
        )
        t1_step2 = LLMResponse(
            content="We have Dr. Jane Smith available in Cardiology. When would you like to visit?",
            tool_calls=[],
        )

        # Turn 2: Check availability for Wednesday
        t2_step1 = LLMResponse(
            content="",
            tool_calls=[
                ToolCall(
                    name="get_doctor_availability",
                    arguments={"doctor_id": str(self.doctor_id), "date": self.future_wednesday_str},
                    call_id="c_get_avail",
                )
            ],
        )
        t2_step2 = LLMResponse(
            content="Dr. Smith has open slots on Wednesday at 10:00 AM, 10:30 AM, and 11:00 AM. Which one suits you?",
            tool_calls=[],
        )

        # Turn 3: Register new patient and book 10:00 AM
        t3_step1 = LLMResponse(
            content="",
            tool_calls=[
                ToolCall(
                    name="register_patient",
                    arguments={
                        "full_name": "Amit Kumar",
                        "phone_number": "9123450000",
                        "caller_confirmed_registration": True,
                    },
                    call_id="c_reg_pt",
                )
            ],
        )
        t3_step2 = LLMResponse(
            content="",
            tool_calls=[
                ToolCall(
                    name="create_appointment",
                    arguments={
                        "doctor_id": str(self.doctor_id),
                        "appointment_date": self.future_wednesday_str,
                        "start_time": "10:00",
                        "reason": "Routine checkup",
                    },
                    call_id="c_book_apt",
                )
            ],
        )
        t3_step3 = LLMResponse(
            content="Your appointment with Dr. Jane Smith is confirmed for Wednesday, November 25 at 10:00 AM.",
            tool_calls=[],
        )

        gateway = ScriptedLLMGateway([
            [t1_step1, t1_step2],
            [t2_step1, t2_step2],
            [t3_step1, t3_step2, t3_step3],
        ])

        orchestrator = ConversationOrchestrator(llm_gateway=gateway, session_store=store)

        # Execute Turn 1
        r1 = run_async(
            orchestrator.execute_turn(
                "I need to see a heart doctor",
                session_id=session_id,
                tenant_id=str(self.tenant_id),
                tool_registry=healthcare_tool_registry,
                db=self.db,
            )
        )
        self.assertIn("Dr. Jane Smith", r1.response_text)
        self.assertEqual(len(r1.tool_executions), 1)

        # Execute Turn 2
        r2 = run_async(
            orchestrator.execute_turn(
                "Is Wednesday morning available?",
                session_id=session_id,
                tenant_id=str(self.tenant_id),
                tool_registry=healthcare_tool_registry,
                db=self.db,
            )
        )
        self.assertIn("10:00", r2.response_text)
        self.assertEqual(len(r2.tool_executions), 1)

        # Execute Turn 3
        r3 = run_async(
            orchestrator.execute_turn(
                "10 AM please. I am a new patient, Amit Kumar, phone 9123450000",
                session_id=session_id,
                tenant_id=str(self.tenant_id),
                tool_registry=healthcare_tool_registry,
                db=self.db,
            )
        )
        self.assertEqual(r3.action_signal, "booking_confirmed")
        self.assertIn("confirmed", r3.response_text.lower())
        self.assertEqual(len(r3.tool_executions), 2)  # register_patient then create_appointment

        # Verify state persistence
        saved_state = run_async(store.get_session_async(session_id))
        self.assertTrue(saved_state.is_verified())
        self.assertEqual(saved_state.action_signal, "booking_confirmed")

    # -------------------------------------------------------------------------
    # Journey 2: Returning Patient Verification & Conflict Recovery
    # -------------------------------------------------------------------------
    def test_journey_conflict_recovery(self):
        """Verify returning patient verification, slot collision handling, and recovery."""
        session_id = f"journey-conflict-{uuid.uuid4()}"
        store = ConversationSessionStore()

        # Pre-book 10:00 AM slot to simulate collision
        existing_apt = Appointment(
            id=uuid.uuid4(),
            tenant_id=self.tenant_id,
            doctor_id=self.doctor_id,
            patient_id=self.patient_id,
            appointment_date=self.future_wednesday,
            start_time=time(10, 0),
            end_time=time(10, 30),
            appointment_range=f"[{self.future_wednesday_str} 10:00:00+00, {self.future_wednesday_str} 10:30:00+00)",
            status="confirmed",
        )
        self.db.appointments.append(existing_apt)

        # Turn 1: Caller asks for 10:00 AM -> Verify identity -> Attempt booking -> Collision
        t1_step1 = LLMResponse(
            content="",
            tool_calls=[
                ToolCall(
                    name="verify_patient_identity",
                    arguments={"patient_name": "Rahul Sharma", "phone_number": "9876543210"},
                    call_id="c_ver_pt",
                )
            ],
        )
        t1_step2 = LLMResponse(
            content="",
            tool_calls=[
                ToolCall(
                    name="create_appointment",
                    arguments={
                        "doctor_id": str(self.doctor_id),
                        "appointment_date": self.future_wednesday_str,
                        "start_time": "10:00",
                    },
                    call_id="c_book_1000",
                )
            ],
        )
        # Model receives SLOT_CONFLICT and alternatives, communicates to patient
        t1_step3 = LLMResponse(
            content="Hello Rahul, your identity is confirmed. Unfortunately 10:00 AM is already taken. Would 10:30 AM or 11:00 AM work instead?",
            tool_calls=[],
        )

        # Turn 2: Caller accepts alternative (10:30 AM)
        t2_step1 = LLMResponse(
            content="",
            tool_calls=[
                ToolCall(
                    name="create_appointment",
                    arguments={
                        "doctor_id": str(self.doctor_id),
                        "appointment_date": self.future_wednesday_str,
                        "start_time": "10:30",
                    },
                    call_id="c_book_1030",
                )
            ],
        )
        t2_step2 = LLMResponse(
            content="Great, I have booked your appointment with Dr. Jane Smith for Wednesday at 10:30 AM.",
            tool_calls=[],
        )

        gateway = ScriptedLLMGateway([
            [t1_step1, t1_step2, t1_step3],
            [t2_step1, t2_step2],
        ])

        orchestrator = ConversationOrchestrator(llm_gateway=gateway, session_store=store)

        # Run Turn 1 (Encounter conflict)
        r1 = run_async(
            orchestrator.execute_turn(
                "Hi, I'm Rahul Sharma, phone 9876543210. I need to book Dr. Smith at 10:00 AM Wednesday.",
                session_id=session_id,
                tenant_id=str(self.tenant_id),
                tool_registry=healthcare_tool_registry,
                db=self.db,
            )
        )
        self.assertIn("10:30", r1.response_text)
        self.assertEqual(len(r1.tool_executions), 2)
        # First tool was verify (succeeded), second was create_appointment (conflict)
        self.assertTrue(r1.tool_executions[0]["success"])
        self.assertFalse(r1.tool_executions[1]["success"])
        self.assertEqual(r1.tool_executions[1]["result"]["error_code"], "SLOT_CONFLICT")

        # Run Turn 2 (Accept alternative)
        r2 = run_async(
            orchestrator.execute_turn(
                "Let's do 10:30 AM instead",
                session_id=session_id,
                tenant_id=str(self.tenant_id),
                tool_registry=healthcare_tool_registry,
                db=self.db,
            )
        )
        self.assertEqual(r2.action_signal, "booking_confirmed")
        self.assertIn("10:30", r2.response_text)

    # -------------------------------------------------------------------------
    # Journey 3: Emergency Detection & Reassuring Diversion
    # -------------------------------------------------------------------------
    def test_journey_emergency_detection_and_diversion(self):
        """Verify acute symptoms immediately trigger emergency diversion without booking attempts."""
        session_id = f"journey-emergency-{uuid.uuid4()}"
        store = ConversationSessionStore()

        t1_step1 = LLMResponse(
            content="",
            tool_calls=[
                ToolCall(
                    name="escalate_to_human",
                    arguments={
                        "reason": "Severe acute chest pain and shortness of breath",
                        "urgency": "emergency",
                    },
                    call_id="c_emerg_1",
                )
            ],
        )
        t1_step2 = LLMResponse(
            content="I am immediately connecting you to our emergency triage team. Please remain on the line.",
            tool_calls=[],
        )

        gateway = ScriptedLLMGateway([[t1_step1, t1_step2]])
        orchestrator = ConversationOrchestrator(llm_gateway=gateway, session_store=store)

        res = run_async(
            orchestrator.execute_turn(
                "Help! I have severe crushing chest pain and I can't catch my breath!",
                session_id=session_id,
                tenant_id=str(self.tenant_id),
                tool_registry=healthcare_tool_registry,
                db=self.db,
            )
        )

        self.assertEqual(res.action_signal, "emergency_divert")
        self.assertEqual(res.conversation_status, "escalated")
        self.assertIn("emergency triage team", res.response_text)


if __name__ == "__main__":
    unittest.main()
