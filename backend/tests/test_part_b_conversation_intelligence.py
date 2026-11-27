"""Layer 1 Unit Tests for Stage 6 Part B Conversational Intelligence & Safety.

Verifies deterministically without network/external DB:
1. Tenant-personalized system prompt + session memory summary injection across turns.
2. Emergency escalation defense-in-depth guard when LLM skips tool call or claims triage transfer.
3. Non-false-positive handling for routine cardiology follow-up wording.
4. Clarification limit (3 consecutive unclear inputs -> transfer_to_human) + counter reset on clear input.
5. Doctor search synonym normalization, department lookup, working_days summary, and unsupported schema honesty.
6. Time-of-day availability filtering (morning/afternoon/evening) and next_available_dates fallback.
7. Graceful call completion (complete_call -> call_completed).
"""

import asyncio
from datetime import date, time, timedelta
import os
from pathlib import Path
import sys
import unittest
import uuid
from typing import Any, List, Optional

backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

os.environ["ENVIRONMENT"] = "test"
os.environ["SECRET_KEY"] = "test-secret-part-b-conversation-intelligence-key-32ch"

from app.adapters.llm.base import LLMGateway, LLMMessage, LLMResponse, ToolCall
from app.models.doctor import Doctor, DoctorAvailability
from app.models.operating_hours import HospitalOperatingHours
from app.models.tenant import Tenant
from app.models.user import User
from app.services.conversation.orchestrator import (
    ConversationOrchestrator,
    _is_acute_emergency_text,
    _is_unclear_utterance,
)
from app.services.conversation.session_store import ConversationSessionStore
from app.services.conversation.state import ConversationState
from app.services.tools.healthcare_tools import healthcare_tool_registry


def _next_weekday(target_weekday: int, min_days_ahead: int = 2) -> date:
    cand = date.today() + timedelta(days=min_days_ahead)
    while cand.weekday() != target_weekday:
        cand += timedelta(days=1)
    return cand


def run_async(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class _Scalars:
    def __init__(self, items):
        self._items = items

    def all(self):
        return list(self._items)


class _Result:
    def __init__(self, items):
        self._items = items

    def scalars(self):
        return _Scalars(self._items)

    def scalar_one_or_none(self):
        return self._items[0] if self._items else None


class MockIntelDB:
    def __init__(self, tenant: Tenant, doctors: List[Doctor], hours: List[HospitalOperatingHours]):
        self.tenants = [tenant]
        self.doctors = doctors
        self.operating_hours = hours
        self.appointments = []
        self.doctor_leaves = []
        self.patients = []

    async def execute(self, statement):
        s = str(statement)
        if "SELECT tenants.timezone" in s:
            return _Result([self.tenants[0].timezone])
        if "FROM tenants" in s:
            return _Result(self.tenants)
        if "FROM hospital_operating_hours" in s:
            return _Result(self.operating_hours)
        if "FROM doctors" in s:
            return _Result(self.doctors)
        if "FROM doctor_leaves" in s:
            return _Result(self.doctor_leaves)
        if "FROM appointments" in s:
            return _Result(self.appointments)
        if "FROM patients" in s:
            return _Result(self.patients)
        return _Result([])


class RecordingLLM(LLMGateway):
    """Captures exact system prompts supplied by ConversationOrchestrator."""

    def __init__(self, reply_text: str = "I can help with that.", tool_calls: Optional[List[ToolCall]] = None):
        self.reply_text = reply_text
        self.tool_calls = tool_calls or []
        self.captured_systems: List[str] = []

    async def complete(self, messages: List[LLMMessage], tools: Optional[List[Any]] = None) -> LLMResponse:
        sys_msgs = [m.content for m in messages if m.role == "system"]
        if sys_msgs:
            self.captured_systems.append(sys_msgs[0])
        if self.tool_calls:
            tcs = list(self.tool_calls)
            self.tool_calls = []
            return LLMResponse(content="", tool_calls=tcs)
        return LLMResponse(content=self.reply_text, tool_calls=[])

    async def stream(self, messages: List[LLMMessage], tools: Optional[List[Any]] = None):
        yield self.reply_text


class TestPartBConversationIntelligence(unittest.TestCase):
    def setUp(self):
        self.tenant_id = uuid.uuid4()
        self.hours = [
            HospitalOperatingHours(
                id=uuid.uuid4(),
                tenant_id=self.tenant_id,
                day_of_week=0,
                open_time=time(8, 0),
                close_time=time(20, 0),
                is_closed=False,
            ),
            HospitalOperatingHours(
                id=uuid.uuid4(),
                tenant_id=self.tenant_id,
                day_of_week=6,
                is_closed=True,
            ),
        ]
        self.tenant = Tenant(
            id=self.tenant_id,
            name="Sunrise Specialty Hospital",
            slug="sunrise-hospital",
            timezone="Asia/Kolkata",
            is_active=True,
        )
        self.tenant.operating_hours = self.hours

        doc_user = User(id=uuid.uuid4(), tenant_id=self.tenant_id, email="doc@sun.test", full_name="Dr. Meera Kapoor")
        self.doctor = Doctor(
            id=uuid.uuid4(),
            tenant_id=self.tenant_id,
            user_id=doc_user.id,
            specialization="Cardiology",
            department="Heart Care Wing B",
            slot_duration_minutes=30,
            consultation_fee=900.0,
            is_active=True,
        )
        self.doctor.user = doc_user
        self.doctor.availabilities = [
            DoctorAvailability(
                id=uuid.uuid4(),
                tenant_id=self.tenant_id,
                doctor_id=self.doctor.id,
                day_of_week=0,  # Monday
                start_time=time(9, 0),
                end_time=time(18, 0),
                is_available=True,
            ),
        ]
        self.db = MockIntelDB(self.tenant, [self.doctor], self.hours)

    def test_tenant_personalization_and_session_memory_injection(self):
        llm = RecordingLLM("Welcome to Sunrise Specialty Hospital! How may I assist you today?")
        store = ConversationSessionStore(use_redis=False)
        orch = ConversationOrchestrator(llm_gateway=llm, session_store=store)
        st = run_async(store.get_or_create_session_async("mem-sess", tenant_id=str(self.tenant_id)))
        st.set_verified("pat-99", patient_name="Vikram Singh")
        st.selected_doctor_name = "Dr. Meera Kapoor"
        st.preferred_time_window = "morning"
        run_async(store.save_session_async(st))

        res = run_async(
            orch.execute_turn(
                "Hello",
                session_id="mem-sess",
                tenant_id=str(self.tenant_id),
                db=self.db,
            )
        )
        self.assertIn("Sunrise Specialty Hospital", llm.captured_systems[0])
        self.assertIn("Vikram Singh", llm.captured_systems[0])
        self.assertIn("Dr. Meera Kapoor", llm.captured_systems[0])
        self.assertIn("morning", llm.captured_systems[0])
        self.assertEqual(res.conversation_status, "in_progress")

    def test_emergency_guard_catches_missed_tool_call_and_ignores_routine_followup(self):
        # 1. Routine follow-up wording does NOT false-trigger emergency
        self.assertFalse(_is_acute_emergency_text("Book routine follow-up for chest pain next week"))
        self.assertTrue(_is_acute_emergency_text("My father has crushing chest pain and cannot breathe"))

        # 2. LLM forgot escalate_to_human despite claiming transfer -> guard sets emergency_divert
        llm = RecordingLLM("Please call an ambulance right away. I am transferring you to our triage team.")
        store = ConversationSessionStore(use_redis=False)
        orch = ConversationOrchestrator(llm_gateway=llm, session_store=store)
        res = run_async(
            orch.execute_turn(
                "Help, severe chest pain and choking!",
                session_id="emg-guard",
                tenant_id=str(self.tenant_id),
                db=self.db,
            )
        )
        self.assertEqual(res.action_signal, "emergency_divert")
        self.assertEqual(res.conversation_status, "escalated")
        self.assertEqual(res.current_stage, "escalated")

    def test_clarification_limit_and_reset(self):
        self.assertTrue(_is_unclear_utterance("uh"))
        self.assertFalse(_is_unclear_utterance("yes"))

        llm = RecordingLLM("Could you repeat what doctor or day you need?")
        store = ConversationSessionStore(use_redis=False)
        orch = ConversationOrchestrator(llm_gateway=llm, session_store=store)

        r1 = run_async(orch.execute_turn("...", session_id="clr-1", tenant_id=str(self.tenant_id), db=self.db))
        r2 = run_async(orch.execute_turn("hm", session_id="clr-1", tenant_id=str(self.tenant_id), db=self.db))
        self.assertIsNone(r2.action_signal)

        # Clear utterance resets counter
        r_clear = run_async(orch.execute_turn("I want Cardiology", session_id="clr-1", tenant_id=str(self.tenant_id), db=self.db))
        st = run_async(store.get_session_async("clr-1"))
        self.assertEqual(st.clarification_count, 0)
        self.assertIsNone(r_clear.action_signal)

        # Now 3 consecutive unclear inputs -> transfer_to_human
        for txt in ("uh", "??", "zz"):
            r_final = run_async(orch.execute_turn(txt, session_id="clr-1", tenant_id=str(self.tenant_id), db=self.db))
        self.assertEqual(r_final.action_signal, "transfer_to_human")
        self.assertEqual(r_final.conversation_status, "escalated")

    def test_doctor_search_synonyms_working_days_and_unsupported_preferences(self):
        st = ConversationState(session_id="doc-syn", tenant_id=str(self.tenant_id))
        res = run_async(
            healthcare_tool_registry.execute_tool(
                "search_doctors",
                {"specialty": "heart doctor", "preference_note": "female Hindi speaking doctor"},
                tenant_id=self.tenant_id,
                db=self.db,
                session_state=st,
            )
        )
        self.assertTrue(res["success"])
        self.assertEqual(res["count"], 1)
        self.assertEqual(res["doctors"][0]["doctor_name"], "Dr. Meera Kapoor")
        self.assertTrue(len(res["doctors"][0]["working_days"]) >= 1)
        self.assertIn("schema_limitations_note", res)

    def test_time_preference_availability_and_next_dates_fallback(self):
        future_mon = _next_weekday(0, min_days_ahead=3)
        future_tue = future_mon + timedelta(days=1)
        st = ConversationState(session_id="time-win", tenant_id=str(self.tenant_id))

        # Monday evening window (>=17:00) -> 17:00, 17:30 (shift ends 18:00)
        res_eve = run_async(
            healthcare_tool_registry.execute_tool(
                "get_doctor_availability",
                {"doctor_id": str(self.doctor.id), "date": future_mon.isoformat(), "time_preference": "evening"},
                tenant_id=self.tenant_id,
                db=self.db,
                session_state=st,
            )
        )
        self.assertTrue(res_eve["success"])
        self.assertEqual(res_eve["available_slots"], ["17:00", "17:30"])
        self.assertGreater(len(res_eve["morning_slots"]), 0)
        self.assertEqual(st.preferred_time_window, "evening")

        # Tuesday closed for doctor -> suggests next available Monday cleanly
        res_closed = run_async(
            healthcare_tool_registry.execute_tool(
                "get_doctor_availability",
                {"doctor_id": str(self.doctor.id), "date": future_tue.isoformat()},
                tenant_id=self.tenant_id,
                db=self.db,
                session_state=st,
            )
        )
        self.assertTrue(res_closed["success"])
        self.assertEqual(res_closed["available_slots"], [])
        self.assertGreaterEqual(len(res_closed["next_available_dates"]), 1)

    def test_complete_call_tool_sets_completed_status(self):
        llm = RecordingLLM(
            "Thank you for calling! Goodbye and take care.",
            tool_calls=[ToolCall(name="complete_call", arguments={"summary": "Done"})],
        )
        store = ConversationSessionStore(use_redis=False)
        orch = ConversationOrchestrator(llm_gateway=llm, session_store=store)
        res = run_async(
            orch.execute_turn(
                "No thanks, goodbye!",
                session_id="bye-1",
                tenant_id=str(self.tenant_id),
                tool_registry=healthcare_tool_registry,
                db=self.db,
            )
        )
        self.assertEqual(res.action_signal, "call_completed")
        self.assertEqual(res.conversation_status, "completed")
        self.assertEqual(res.current_stage, "completed")


if __name__ == "__main__":
    unittest.main()
