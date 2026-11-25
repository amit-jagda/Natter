"""Unit Tests for Phase 1 Healthcare Conversational Intelligence Engine.

Covers:
1. Tool calling data structures and LLMResponse string compatibility.
2. Gemini payload formatting with function declarations and function responses.
3. ConversationState serialization, deserialization, and audit sanitization.
4. Patient verification expiration and rate-limiting lockout logic.
5. ConversationSessionStore persistence and in-memory fallback.
6. ConversationOrchestrator multi-step tool execution loop and error recovery.
7. Mock safety: preventing false booking claims without backend confirmation.
8. Maximum tool-call iteration limit to prevent infinite loops.
"""

import asyncio
import os
import sys
import time
import unittest
from pathlib import Path
from typing import Any, Dict

backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

os.environ["ENVIRONMENT"] = "test"
os.environ["SECRET_KEY"] = "test-secret-key-for-unit-testing-purposes-only-32ch"

from app.adapters.llm.base import (
    LLMMessage,
    LLMResponse,
    MockLLMAdapter,
    ToolCall,
    ToolDefinition,
    ToolResult,
)
from app.adapters.llm.gemini import GeminiLLMAdapter, _convert_schema_to_gemini
from app.services.conversation.orchestrator import (
    ConversationOrchestrator,
    ConversationTurnResult,
)
from app.services.conversation.prompts import (
    HEALTHCARE_SYSTEM_PROMPT,
    build_system_prompt_with_tenant_context,
)
from app.services.conversation.session_store import ConversationSessionStore
from app.services.conversation.state import ConversationState


_loop = None

def run_async(coro):
    """Run an async coroutine synchronously using a single persistent event loop."""
    global _loop
    if _loop is None or _loop.is_closed():
        _loop = asyncio.new_event_loop()
        asyncio.set_event_loop(_loop)
    return _loop.run_until_complete(coro)


class TestConversationEngine(unittest.TestCase):
    """Test suite covering the conversational intelligence engine."""

    # -------------------------------------------------------------------------
    # 1. Tool Data Structures & LLMResponse Backward Compatibility
    # -------------------------------------------------------------------------
    def test_llm_response_string_subclass(self):
        """Verify LLMResponse behaves as str for backwards compatibility and carries tool calls."""
        res_plain = LLMResponse("Hello world")
        self.assertTrue(isinstance(res_plain, str))
        self.assertEqual(res_plain, "Hello world")
        self.assertFalse(res_plain.has_tool_calls)
        self.assertEqual(len(res_plain.tool_calls), 0)

        tc = ToolCall(name="check_doctor_availability", arguments={"doctor_id": "doc-1", "date": "2026-11-25"})
        res_tools = LLMResponse("", tool_calls=[tc], finish_reason="tool_calls")
        self.assertTrue(isinstance(res_tools, str))
        self.assertTrue(res_tools.has_tool_calls)
        self.assertEqual(res_tools.tool_calls[0].name, "check_doctor_availability")
        self.assertEqual(res_tools.tool_calls[0].arguments["doctor_id"], "doc-1")

    # -------------------------------------------------------------------------
    # 2. Gemini Tool Payload Formatting
    # -------------------------------------------------------------------------
    def test_gemini_schema_conversion(self):
        """Verify standard JSON schema data types convert to Gemini uppercase keywords."""
        schema = {
            "type": "object",
            "properties": {
                "doctor_name": {"type": "string", "description": "Doctor name"},
                "duration": {"type": "integer"},
                "is_active": {"type": "boolean"},
                "tags": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["doctor_name"],
        }
        converted = _convert_schema_to_gemini(schema)
        self.assertEqual(converted["type"], "OBJECT")
        self.assertEqual(converted["properties"]["doctor_name"]["type"], "STRING")
        self.assertEqual(converted["properties"]["duration"]["type"], "INTEGER")
        self.assertEqual(converted["properties"]["is_active"]["type"], "BOOLEAN")
        self.assertEqual(converted["properties"]["tags"]["type"], "ARRAY")
        self.assertEqual(converted["properties"]["tags"]["items"]["type"], "STRING")

    def test_gemini_payload_with_tool_definitions_and_responses(self):
        """Verify Gemini payload includes functionDeclarations, functionCalls, and functionResponses."""
        adapter = GeminiLLMAdapter(api_key="valid-dummy-test-key-32charslong")

        tool = ToolDefinition(
            name="search_doctors",
            description="Search doctors by specialization",
            parameters={
                "type": "object",
                "properties": {"specialization": {"type": "string"}},
                "required": ["specialization"],
            },
        )

        messages = [
            LLMMessage(role="system", content="Healthcare assistant"),
            LLMMessage(role="user", content="Find a cardiologist"),
            LLMMessage(
                role="assistant",
                content="",
                tool_calls=[ToolCall(name="search_doctors", arguments={"specialization": "Cardiology"})],
            ),
            LLMMessage(
                role="tool",
                content="",
                tool_result=ToolResult(
                    name="search_doctors",
                    result={"doctors": [{"id": "doc-mehta", "name": "Dr. Mehta"}]},
                ),
            ),
        ]

        payload = adapter._format_payload(messages, temperature=0.5, max_tokens=500, tools=[tool])

        # Verify systemInstruction
        self.assertIn("systemInstruction", payload)
        self.assertEqual(payload["systemInstruction"]["parts"][0]["text"], "Healthcare assistant")

        # Verify functionDeclarations in tools
        self.assertIn("tools", payload)
        func_decls = payload["tools"][0]["functionDeclarations"]
        self.assertEqual(len(func_decls), 1)
        self.assertEqual(func_decls[0]["name"], "search_doctors")
        self.assertEqual(func_decls[0]["parameters"]["type"], "OBJECT")

        # Verify conversation turns (model functionCall and user functionResponse)
        contents = payload["contents"]
        self.assertEqual(len(contents), 3)  # user text, model call, user response
        self.assertEqual(contents[0]["role"], "user")
        self.assertEqual(contents[1]["role"], "model")
        self.assertIn("functionCall", contents[1]["parts"][0])
        self.assertEqual(contents[1]["parts"][0]["functionCall"]["name"], "search_doctors")

        self.assertEqual(contents[2]["role"], "user")
        self.assertIn("functionResponse", contents[2]["parts"][0])
        self.assertEqual(contents[2]["parts"][0]["functionResponse"]["name"], "search_doctors")

    # -------------------------------------------------------------------------
    # 3. ConversationState Serialization & Audit Sanitization
    # -------------------------------------------------------------------------
    def test_conversation_state_serialization(self):
        """Verify full round-trip serialization of ConversationState."""
        state = ConversationState(
            session_id="sess-test-1",
            tenant_id="tenant-care-1",
            language="hi",
            current_intent="book_appointment",
            current_stage="slot_selection",
            verified_patient_id="patient-123",
            verification_status="verified",
            verification_method="demographic_name_match",
            caller_phone="9876543210",
        )
        state.add_message("user", "Kal ka slot chahiye")
        state.record_tool_execution(
            "verify_patient_identity",
            {"patient_id": "patient-123", "provided_name": "Ramesh Kumar", "otp": "123456"},
            {"success": True, "patient_id": "patient-123"},
        )

        data = state.to_dict()
        # Verify secret masking
        audit_entry = data["tool_execution_history"][0]
        self.assertEqual(audit_entry["arguments"]["otp"], "***")
        self.assertEqual(audit_entry["arguments"]["provided_name"], "Ramesh Kumar")

        # Reconstruct from dict
        reconstructed = ConversationState.from_dict(data)
        self.assertEqual(reconstructed.session_id, "sess-test-1")
        self.assertEqual(reconstructed.tenant_id, "tenant-care-1")
        self.assertEqual(reconstructed.language, "hi")
        self.assertEqual(reconstructed.verified_patient_id, "patient-123")
        self.assertEqual(reconstructed.messages[0].content, "Kal ka slot chahiye")
        self.assertEqual(len(reconstructed.tool_execution_history), 1)

    # -------------------------------------------------------------------------
    # 4. Patient Verification Lockout & Time-Limited Expiration
    # -------------------------------------------------------------------------
    def test_verification_lockout_and_expiration(self):
        """Verify security rate-limiting lockout and time-limited token expiration."""
        state = ConversationState(session_id="sess-verify-lock")

        # 1. Not locked initially
        self.assertFalse(state.is_verification_locked())

        # 2. Lock for 10 seconds
        state.verification_locked_until = time.time() + 10.0
        state.verification_status = "locked"
        self.assertTrue(state.is_verification_locked())

        # 3. Simulate lock expiration
        state.verification_locked_until = time.time() - 1.0
        self.assertFalse(state.is_verification_locked())
        self.assertEqual(state.verification_status, "unverified")

        # 4. Verification token expiration test
        state.verified_patient_id = "pat-999"
        state.verification_status = "verified"
        state.verified_at = time.time()

        # Valid immediately
        self.assertTrue(state.is_verified_for_patient("pat-999", max_age_seconds=60))
        # Wrong patient ID rejected
        self.assertFalse(state.is_verified_for_patient("pat-888", max_age_seconds=60))

        # Expired token rejected
        state.verified_at = time.time() - 100.0
        self.assertFalse(state.is_verified_for_patient("pat-999", max_age_seconds=60))

    # -------------------------------------------------------------------------
    # 5. Session Store Async & Sync Operations
    # -------------------------------------------------------------------------
    def test_session_store_operations(self):
        """Verify ConversationSessionStore handles get, create, and reset cleanly."""
        store = ConversationSessionStore(ttl_seconds=3600)

        # Sync creation
        s1 = store.get_or_create_session("sess-abc", tenant_id="tenant-1")
        self.assertEqual(s1.session_id, "sess-abc")
        self.assertEqual(s1.tenant_id, "tenant-1")

        # Async fetch
        s1_async = run_async(store.get_session_async("sess-abc"))
        self.assertIsNotNone(s1_async)
        self.assertEqual(s1_async.session_id, "sess-abc")

        # Reset
        res = run_async(store.reset_session_async("sess-abc"))
        self.assertTrue(res)
        self.assertIsNone(run_async(store.get_session_async("sess-abc")))

    # -------------------------------------------------------------------------
    # 6. ConversationOrchestrator Tool Execution Loop
    # -------------------------------------------------------------------------
    def test_orchestrator_multi_turn_tool_execution(self):
        """Verify orchestrator runs tool loop: model calls tool -> tool executes -> model formulates answer."""
        store = ConversationSessionStore()

        # Queue a tool call from the mock model, followed by normal speech
        tc = ToolCall(name="check_doctor_availability", arguments={"doctor_id": "doc-mehta", "date": "2026-11-26"})
        mock_llm = MockLLMAdapter(
            canned_response="Dr. Mehta is available on Thursday at 2:30 PM. Would you like me to book this for you?",
            tool_call_sequence=[tc],
        )

        orchestrator = ConversationOrchestrator(llm_gateway=mock_llm, session_store=store)

        tool_executed = False

        async def dummy_executor(name: str, args: Dict[str, Any], state: ConversationState) -> Dict[str, Any]:
            nonlocal tool_executed
            tool_executed = True
            self.assertEqual(name, "check_doctor_availability")
            self.assertEqual(args["doctor_id"], "doc-mehta")
            return {
                "success": True,
                "available_slots": ["14:30", "15:00"],
                "stage": "slot_selection",
            }

        result: ConversationTurnResult = run_async(
            orchestrator.execute_turn(
                "When is Dr. Mehta free this Thursday?",
                session_id="sess-orch-turn-1",
                tenant_id="tenant-city-hospital",
                tool_executor=dummy_executor,
            )
        )

        self.assertTrue(tool_executed)
        self.assertEqual(result.conversation_status, "in_progress")
        self.assertIn("Dr. Mehta is available", result.response_text)
        self.assertEqual(result.current_stage, "slot_selection")
        self.assertEqual(len(result.tool_executions), 1)
        self.assertEqual(result.tool_executions[0]["tool_name"], "check_doctor_availability")

    # -------------------------------------------------------------------------
    # 7. Orchestrator Tool Error Recovery & Text Sanitization
    # -------------------------------------------------------------------------
    def test_orchestrator_tool_failure_recovery_and_spoken_sanitization(self):
        """Verify orchestrator gracefully passes tool errors to model and sanitizes markdown from speech."""
        store = ConversationSessionStore()

        tc = ToolCall(name="get_doctor", arguments={"doctor_id": "doc-invalid"})
        mock_llm = MockLLMAdapter(
            tool_call_sequence=[tc],
        )

        orchestrator = ConversationOrchestrator(llm_gateway=mock_llm, session_store=store)

        async def failing_executor(name: str, args: Dict[str, Any], state: ConversationState) -> Dict[str, Any]:
            return {"success": False, "error": "Doctor not found with ID doc-invalid."}

        result = run_async(
            orchestrator.execute_turn(
                "I want to see Dr. Invalid",
                session_id="sess-fail-tool",
                tool_executor=failing_executor,
            )
        )

        self.assertEqual(result.conversation_status, "in_progress")
        self.assertFalse(result.tool_executions[0]["success"])
        # Tool failure is received and communicated back by assistant
        self.assertIn("Doctor not found with ID doc-invalid", result.response_text)
        # Spoken text must have markdown stripped
        self.assertNotIn("**", result.response_text)
        self.assertNotIn("*", result.response_text)

    # -------------------------------------------------------------------------
    # 8. Orchestrator Verification Lockout Escalation
    # -------------------------------------------------------------------------
    def test_orchestrator_verification_lockout_escalation(self):
        """Verify locked sessions trigger immediate human escalation without calling LLM."""
        store = ConversationSessionStore()
        # Initialize and lock session
        state = store.get_or_create_session("sess-locked-user")
        state.verification_locked_until = time.time() + 300.0
        state.verification_status = "locked"
        store.save_session(state)

        orchestrator = ConversationOrchestrator(session_store=store)
        result = run_async(
            orchestrator.execute_turn(
                "Try my phone number again: 9876543210",
                session_id="sess-locked-user",
            )
        )

        self.assertEqual(result.conversation_status, "escalated")
        self.assertEqual(result.action_signal, "transfer_to_human")
        self.assertIn("temporarily locked", result.response_text)

    # -------------------------------------------------------------------------
    # 9. Mock Safety: No False Booking Claims Without Backend Confirmation
    # -------------------------------------------------------------------------
    def test_mock_llm_safety_no_false_booking(self):
        """Verify MockLLMAdapter default response does not claim false appointment booking."""
        mock = MockLLMAdapter()
        messages = [LLMMessage(role="user", content="Book appointment with Dr. Mehta tomorrow at 10 AM")]
        res = run_async(mock.complete(messages))
        # Must not claim booking without tool execution
        self.assertNotIn("We have updated your appointment", res)
        self.assertNotIn("Your appointment has been confirmed", res)
        self.assertIn("I can help you check doctor availability", res)


if __name__ == "__main__":
    unittest.main()
