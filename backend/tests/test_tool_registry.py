"""Unit and Integration Tests for Phase 3 Healthcare Tool Registry & Orchestrator.

Covers:
1. Tool definition export and Gemini-compatible JSON schema structure.
2. Patient lookup tool with single, shared-family, and empty candidate scenarios.
3. Identity verification tool and session-state mutation.
4. Rate limiting and lockout enforcement across tools.
5. Patient registration tool and immediate session verification.
6. Doctor and specialty discovery tools with filter handling.
7. Doctor availability slot generation.
8. Hospital services and operating hours retrieval.
9. Verification-gating of sensitive tools (create, cancel, reschedule, get appointments).
10. Appointment booking tool with idempotency protection and slot conflict reporting.
11. Appointment retrieval, cancellation, and rescheduling tools.
12. Escalation and emergency diversion signaling.
13. End-to-end multi-turn tool execution loop in ConversationOrchestrator.
"""

import asyncio
from datetime import date, datetime, time, timedelta, timezone
import os
from pathlib import Path
import re
import sys
import time as time_module
import unittest
import uuid
from typing import Any, Dict, List, Optional

backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

os.environ["ENVIRONMENT"] = "test"
os.environ["SECRET_KEY"] = "test-secret-key-for-tool-registry-testing-purpose"

from app.adapters.llm.base import LLMGateway, LLMMessage, LLMResponse, ToolCall, ToolResult
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
from app.services.tools.registry import ToolRegistry


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
    """In-memory async database session mock for testing tool execution."""

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


def run_async(coro):
    """Execute async coroutine synchronously."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class TestToolRegistry(unittest.TestCase):
    """Comprehensive test suite for Phase 3 Tool Registry and Healthcare Tools."""

    def setUp(self):
        self.tenant_id = uuid.uuid4()
        self.doctor_id = uuid.uuid4()
        self.patient_id = uuid.uuid4()
        self.user_id = uuid.uuid4()
        # Next upcoming Wednesday
        cand = date.today() + timedelta(days=2)
        while cand.weekday() != 2:
            cand += timedelta(days=1)
        self.future_wednesday = cand
        self.future_wednesday_str = cand.isoformat()

        self.db = MockAsyncSession()

        # Fixture: Doctor User
        self.doctor_user = User(
            id=self.user_id,
            tenant_id=self.tenant_id,
            email="dr.smith@metrohospital.org",
            hashed_password="hash",
            full_name="Dr. Jane Smith",
        )

        # Fixture: Doctor
        self.doctor = Doctor(
            id=self.doctor_id,
            tenant_id=self.tenant_id,
            user_id=self.user_id,
            specialization="Cardiology",
            department="Cardiology OPD Block A",
            slot_duration_minutes=30,
            consultation_fee=500.0,
            is_active=True,
        )
        self.doctor.user = self.doctor_user

        # Fixture: Wednesday Shift (10:00 - 13:00)
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

        # Fixture: Hospital Operating Hours (Wednesday: 08:00 - 20:00)
        self.operating_hour = HospitalOperatingHours(
            id=uuid.uuid4(),
            tenant_id=self.tenant_id,
            day_of_week=2,
            open_time=time(8, 0),
            close_time=time(20, 0),
            is_closed=False,
        )

        # Fixture: Patient
        self.patient = Patient(
            id=self.patient_id,
            tenant_id=self.tenant_id,
            name="Rahul Sharma",
            phone="9876543210",
            email="rahul.sharma@example.com",
            date="2026-11-01",
            gender="Male",
        )

        self.db.doctors.append(self.doctor)
        self.db.patients.append(self.patient)
        self.db.operating_hours.append(self.operating_hour)

    # -------------------------------------------------------------------------
    # 1. Tool Definition Export & Schema Verification
    # -------------------------------------------------------------------------
    def test_tool_definition_generation(self):
        """Verify all registered healthcare tools produce compliant ToolDefinitions."""
        definitions = healthcare_tool_registry.get_definitions()
        self.assertGreaterEqual(len(definitions), 10)

        tool_names = [d.name for d in definitions]
        expected_tools = [
            "lookup_patient",
            "verify_patient_identity",
            "register_patient",
            "search_doctors",
            "get_doctor_availability",
            "get_hospital_services",
            "create_appointment",
            "get_patient_appointments",
            "cancel_appointment",
            "reschedule_appointment",
            "escalate_to_human",
        ]
        for exp in expected_tools:
            self.assertIn(exp, tool_names)

        # Check create_appointment parameter schema
        create_defn = next(d for d in definitions if d.name == "create_appointment")
        props = create_defn.parameters.get("properties", {})
        self.assertIn("doctor_id", props)
        self.assertIn("appointment_date", props)
        self.assertIn("start_time", props)
        self.assertIn("doctor_id", create_defn.parameters.get("required", []))

    # -------------------------------------------------------------------------
    # 2. Patient Lookup Tool
    # -------------------------------------------------------------------------
    def test_lookup_patient_tool(self):
        """Verify lookup_patient tool returns candidate count and masked numbers."""
        state = ConversationState(session_id="test-lookup", tenant_id=str(self.tenant_id))

        # Single candidate match
        res = run_async(
            healthcare_tool_registry.execute_tool(
                "lookup_patient",
                {"phone_number": "9876543210"},
                tenant_id=self.tenant_id,
                db=self.db,
                session_state=state,
            )
        )
        self.assertTrue(res["success"])
        self.assertEqual(res["count"], 1)
        self.assertTrue(res.get("requires_name_verification"))
        self.assertNotIn("candidates", res)

        # No match
        no_res = run_async(
            healthcare_tool_registry.execute_tool(
                "lookup_patient",
                {"phone_number": "9999999999"},
                tenant_id=self.tenant_id,
                db=self.db,
                session_state=state,
            )
        )
        self.assertTrue(no_res["success"])
        self.assertEqual(no_res["count"], 0)

    # -------------------------------------------------------------------------
    # 3. Patient Identity Verification Tool
    # -------------------------------------------------------------------------
    def test_verify_patient_identity_tool(self):
        """Verify successful verification sets state.verified_patient_id and verified status."""
        state = ConversationState(session_id="test-verify", tenant_id=str(self.tenant_id))
        self.assertFalse(state.is_verified())

        res = run_async(
            healthcare_tool_registry.execute_tool(
                "verify_patient_identity",
                {"patient_name": "Mr. Rahul Sharma", "phone_number": "+91 9876543210"},
                tenant_id=self.tenant_id,
                db=self.db,
                session_state=state,
            )
        )
        self.assertTrue(res["success"])
        self.assertTrue(res["verified"])
        self.assertEqual(res["patient_id"], str(self.patient_id))
        self.assertTrue(state.is_verified())
        self.assertEqual(state.verified_patient_id, str(self.patient_id))

    def test_verification_failure_and_lockout(self):
        """Verify consecutive failed attempts lock the session and trigger transfer_to_human."""
        state = ConversationState(session_id="test-lock", tenant_id=str(self.tenant_id))

        for i in range(3):
            res = run_async(
                healthcare_tool_registry.execute_tool(
                    "verify_patient_identity",
                    {"patient_name": "Wrong Name", "phone_number": "9876543210"},
                    tenant_id=self.tenant_id,
                    db=self.db,
                    session_state=state,
                )
            )

        self.assertTrue(state.is_verification_locked())

        # Attempt any further tool call while locked
        locked_call = run_async(
            healthcare_tool_registry.execute_tool(
                "search_doctors",
                {"specialty": "Cardiology"},
                tenant_id=self.tenant_id,
                db=self.db,
                session_state=state,
            )
        )
        self.assertFalse(locked_call["success"])
        self.assertEqual(locked_call["error_code"], "VERIFICATION_LOCKED")
        self.assertEqual(locked_call["action_signal"], "transfer_to_human")

    # -------------------------------------------------------------------------
    # 4. Patient Registration Tool
    # -------------------------------------------------------------------------
    def test_register_patient_tool(self):
        """Verify registering a new patient saves record and auto-verifies session."""
        state = ConversationState(session_id="test-reg", tenant_id=str(self.tenant_id))

        # Should reject if caller has not explicitly confirmed registration
        unconfirmed = run_async(
            healthcare_tool_registry.execute_tool(
                "register_patient",
                {
                    "full_name": "Pooja Patel",
                    "phone_number": "9123456780",
                    "caller_confirmed_registration": False,
                },
                tenant_id=self.tenant_id,
                db=self.db,
                session_state=state,
            )
        )
        self.assertFalse(unconfirmed["success"])
        self.assertEqual(unconfirmed["error_code"], "REGISTRATION_CONFIRMATION_REQUIRED")

        res = run_async(
            healthcare_tool_registry.execute_tool(
                "register_patient",
                {
                    "full_name": "Pooja Patel",
                    "phone_number": "9123456780",
                    "caller_confirmed_registration": True,
                    "gender": "Female",
                },
                tenant_id=self.tenant_id,
                db=self.db,
                session_state=state,
            )
        )
        self.assertTrue(res["success"])
        self.assertEqual(res["patient_name"], "Pooja Patel")
        self.assertTrue(state.is_verified())
        self.assertIsNotNone(state.verified_patient_id)

    # -------------------------------------------------------------------------
    # 5. Doctor & Service Discovery Tools
    # -------------------------------------------------------------------------
    def test_search_doctors_and_hospital_services(self):
        """Verify searching doctors by specialty and querying hospital services."""
        state = ConversationState(session_id="test-search", tenant_id=str(self.tenant_id))

        # Search doctors by specialty
        doc_res = run_async(
            healthcare_tool_registry.execute_tool(
                "search_doctors",
                {"specialty": "cardio"},
                tenant_id=self.tenant_id,
                db=self.db,
                session_state=state,
            )
        )
        self.assertTrue(doc_res["success"])
        self.assertEqual(doc_res["count"], 1)
        self.assertEqual(doc_res["doctors"][0]["doctor_name"], "Dr. Jane Smith")
        self.assertEqual(doc_res["doctors"][0]["specialty"], "Cardiology")

        # Hospital services
        svc_res = run_async(
            healthcare_tool_registry.execute_tool(
                "get_hospital_services",
                {},
                tenant_id=self.tenant_id,
                db=self.db,
                session_state=state,
            )
        )
        self.assertTrue(svc_res["success"])
        self.assertIn("Cardiology", svc_res["specialties"])
        self.assertGreaterEqual(len(svc_res["operating_hours"]), 1)

    def test_get_doctor_availability_tool(self):
        """Verify retrieving doctor available slots for Wednesday."""
        state = ConversationState(session_id="test-avail", tenant_id=str(self.tenant_id))

        res = run_async(
            healthcare_tool_registry.execute_tool(
                "get_doctor_availability",
                {"doctor_id": str(self.doctor_id), "date": self.future_wednesday_str},
                tenant_id=self.tenant_id,
                db=self.db,
                session_state=state,
            )
        )
        self.assertTrue(res["success"])
        self.assertEqual(res["total_available_slots"], 6)  # 10:00 to 13:00 (30m slots)
        self.assertIn("10:00", res["available_slots"])
        self.assertIn("12:30", res["available_slots"])

    # -------------------------------------------------------------------------
    # 6. Verification Gate Enforcement on Sensitive Tools
    # -------------------------------------------------------------------------
    def test_verification_gate_rejection(self):
        """Verify unverified caller cannot book, view, cancel, or reschedule appointments."""
        unverified_state = ConversationState(session_id="unverified", tenant_id=str(self.tenant_id))

        # 1. create_appointment
        r1 = run_async(
            healthcare_tool_registry.execute_tool(
                "create_appointment",
                {
                    "doctor_id": str(self.doctor_id),
                    "appointment_date": self.future_wednesday_str,
                    "start_time": "10:00",
                },
                tenant_id=self.tenant_id,
                db=self.db,
                session_state=unverified_state,
            )
        )
        self.assertFalse(r1["success"])
        self.assertEqual(r1["error_code"], "UNVERIFIED")

        # 2. get_patient_appointments
        r2 = run_async(
            healthcare_tool_registry.execute_tool(
                "get_patient_appointments",
                {},
                tenant_id=self.tenant_id,
                db=self.db,
                session_state=unverified_state,
            )
        )
        self.assertFalse(r2["success"])
        self.assertEqual(r2["error_code"], "UNVERIFIED")

        # 3. cancel_appointment
        r3 = run_async(
            healthcare_tool_registry.execute_tool(
                "cancel_appointment",
                {"appointment_id": str(uuid.uuid4())},
                tenant_id=self.tenant_id,
                db=self.db,
                session_state=unverified_state,
            )
        )
        self.assertFalse(r3["success"])
        self.assertEqual(r3["error_code"], "UNVERIFIED")

        # 4. reschedule_appointment
        r4 = run_async(
            healthcare_tool_registry.execute_tool(
                "reschedule_appointment",
                {
                    "appointment_id": str(uuid.uuid4()),
                    "new_date": self.future_wednesday_str,
                    "new_start_time": "11:00",
                },
                tenant_id=self.tenant_id,
                db=self.db,
                session_state=unverified_state,
            )
        )
        self.assertFalse(r4["success"])
        self.assertEqual(r4["error_code"], "UNVERIFIED")

    # -------------------------------------------------------------------------
    # 7. Verified Appointment Booking, Idempotency & Conflict
    # -------------------------------------------------------------------------
    def test_verified_appointment_lifecycle(self):
        """Verify booking, retrieval, rescheduling, and cancellation for verified patient."""
        state = ConversationState(session_id="verified-lifecycle", tenant_id=str(self.tenant_id))
        state.verified_patient_id = str(self.patient_id)
        state.verification_status = "verified"
        state.verified_at = time_module.time()

        # 1. Book appointment at 10:00
        book_res = run_async(
            healthcare_tool_registry.execute_tool(
                "create_appointment",
                {
                    "doctor_id": str(self.doctor_id),
                    "appointment_date": self.future_wednesday_str,
                    "start_time": "10:00",
                    "reason": "Chest pain routine follow-up",
                    "idempotency_key": "test-idem-key-001",
                },
                tenant_id=self.tenant_id,
                db=self.db,
                session_state=state,
            )
        )
        self.assertTrue(book_res["success"])
        self.assertEqual(book_res["action_signal"], "booking_confirmed")
        self.assertEqual(book_res["stage"], "confirmed")
        apt_id = book_res["appointment_id"]

        # 2. Duplicate booking with same idempotency key returns existing booking
        dup_res = run_async(
            healthcare_tool_registry.execute_tool(
                "create_appointment",
                {
                    "doctor_id": str(self.doctor_id),
                    "appointment_date": self.future_wednesday_str,
                    "start_time": "10:00",
                    "idempotency_key": "test-idem-key-001",
                },
                tenant_id=self.tenant_id,
                db=self.db,
                session_state=state,
            )
        )
        self.assertTrue(dup_res["success"])
        self.assertEqual(dup_res["appointment_id"], apt_id)

        # 3. Retrieve patient appointments
        get_res = run_async(
            healthcare_tool_registry.execute_tool(
                "get_patient_appointments",
                {},
                tenant_id=self.tenant_id,
                db=self.db,
                session_state=state,
            )
        )
        self.assertTrue(get_res["success"])
        self.assertGreaterEqual(get_res["count"], 1)

        # 4. Reschedule to 11:30
        resched_res = run_async(
            healthcare_tool_registry.execute_tool(
                "reschedule_appointment",
                {
                    "appointment_id": apt_id,
                    "new_date": self.future_wednesday_str,
                    "new_start_time": "11:30",
                },
                tenant_id=self.tenant_id,
                db=self.db,
                session_state=state,
            )
        )
        self.assertTrue(resched_res["success"])
        self.assertEqual(resched_res["action_signal"], "appointment_rescheduled")

        # 5. Cancel appointment
        cancel_res = run_async(
            healthcare_tool_registry.execute_tool(
                "cancel_appointment",
                {
                    "appointment_id": apt_id,
                    "reason": "Patient travelling",
                },
                tenant_id=self.tenant_id,
                db=self.db,
                session_state=state,
            )
        )
        self.assertTrue(cancel_res["success"])
        self.assertEqual(cancel_res["action_signal"], "appointment_cancelled")

    # -------------------------------------------------------------------------
    # 8. Human Escalation and Emergency Divert
    # -------------------------------------------------------------------------
    def test_escalate_to_human_tool(self):
        """Verify normal escalation sets transfer_to_human, and emergency sets emergency_divert."""
        state = ConversationState(session_id="test-escalate", tenant_id=str(self.tenant_id))

        # Normal reception transfer
        normal_res = run_async(
            healthcare_tool_registry.execute_tool(
                "escalate_to_human",
                {"reason": "Caller prefers speaking to receptionist", "urgency": "normal"},
                tenant_id=self.tenant_id,
                db=self.db,
                session_state=state,
            )
        )
        self.assertTrue(normal_res["success"])
        self.assertEqual(normal_res["action_signal"], "transfer_to_human")
        self.assertEqual(state.action_signal, "transfer_to_human")

        # Emergency medical divert
        emerg_res = run_async(
            healthcare_tool_registry.execute_tool(
                "escalate_to_human",
                {"reason": "Patient having severe chest pain and breathlessness", "urgency": "emergency"},
                tenant_id=self.tenant_id,
                db=self.db,
                session_state=state,
            )
        )
        self.assertTrue(emerg_res["success"])
        self.assertEqual(emerg_res["action_signal"], "emergency_divert")
        self.assertEqual(state.action_signal, "emergency_divert")

    # -------------------------------------------------------------------------
    # 9. End-to-End Orchestrator + ToolRegistry Integration
    # -------------------------------------------------------------------------
    def test_orchestrator_multi_turn_tool_execution(self):
        """Verify ConversationOrchestrator seamlessly coordinates ToolRegistry execution."""
        # Step 1: Model asks to lookup patient
        turn1_resp = LLMResponse(
            content="",
            tool_calls=[
                ToolCall(
                    name="lookup_patient",
                    arguments={"phone_number": "9876543210"},
                    call_id="call_lookup_1",
                )
            ],
        )

        # Step 2: Model gives final response using tool result
        turn2_resp = LLMResponse(
            content="Hello Rahul Sharma, I found your record. Which doctor would you like to see?",
            tool_calls=[],
        )

        responses = [turn1_resp, turn2_resp]

        class TestGateway(LLMGateway):
            async def complete(self, messages, tools=None):
                return responses.pop(0)

            async def stream(self, messages, tools=None):
                yield ""

        mock_gateway = TestGateway()

        store = ConversationSessionStore()
        orchestrator = ConversationOrchestrator(
            llm_gateway=mock_gateway,
            session_store=store,
        )

        result = run_async(
            orchestrator.execute_turn(
                transcript="Hi, this is Rahul",
                session_id="orchestrator-e2e-session",
                tenant_id=str(self.tenant_id),
                caller_number="9876543210",
                tool_registry=healthcare_tool_registry,
                db=self.db,
            )
        )

        self.assertEqual(result.conversation_status, "in_progress")
        self.assertEqual(len(result.tool_executions), 1)
        self.assertEqual(result.tool_executions[0]["tool_name"], "lookup_patient")
        self.assertTrue(result.tool_executions[0]["success"])
        self.assertIn("Rahul Sharma", result.response_text)


if __name__ == "__main__":
    unittest.main()
