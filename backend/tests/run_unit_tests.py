"""Self-Contained Test Runner for Voice Pipeline Components.

Executes all STT, LLM, TTS, Session Store, and Orchestration pipeline tests
using Python's standard library with zero external dependencies.
"""

import os
import sys
import unittest
from pathlib import Path

backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

os.environ["ENVIRONMENT"] = "test"
os.environ["SECRET_KEY"] = "test-secret-key-for-unit-testing-purposes-only-32ch"

from app.adapters.stt.base import MockSTTAdapter, STTResult
from app.adapters.stt.google import GoogleSTTAdapter
from app.adapters.stt.factory import get_stt_provider, reset_stt_provider_cache
from app.adapters.llm.base import MockLLMAdapter, LLMMessage
from app.adapters.llm.gemini import GeminiLLMAdapter
from app.adapters.llm.factory import get_llm_gateway, reset_llm_gateway_cache
from app.adapters.tts.base import MockTTSAdapter, TTSResult
from app.adapters.tts.piper import PiperTTSAdapter
from app.adapters.tts.factory import get_tts_provider, reset_tts_provider_cache
from app.core.exceptions import (
    SpeechToTextError,
    TextToSpeechError,
    LLMGenerationError,
    ProviderConfigurationError,
    ProviderUnavailableError,
    UnauthorizedException,
)
from app.core.config import settings
from app.core.security import (
    hash_password,
    verify_password,
    create_access_token,
    decode_access_token,
    create_refresh_token,
    decode_refresh_token,
)
from datetime import timedelta
from app.services.session_store import InMemorySessionStore, ConversationSession
from app.services.voice_orchestrator import VoiceOrchestrator


def sync_await(coro):
    """Execute a coroutine synchronously without requiring an active event loop/socket."""
    try:
        coro.send(None)
    except StopIteration as exc:
        return exc.value


def sync_aiter(agen):
    """Consume an async generator synchronously."""
    items = []
    while True:
        try:
            val = sync_await(agen.__anext__())
            items.append(val)
        except StopAsyncIteration:
            break
    return items


passed = 0
failed = 0


def report(name: str, success: bool, msg: str = ""):
    global passed, failed
    if success:
        passed += 1
        print(f"  [PASS] {name}", flush=True)
    else:
        failed += 1
        print(f"  [FAIL] {name}: {msg}", flush=True)


def run_tests():
    print("=" * 60, flush=True)
    print("Starting Voice Engine Test Suite (Zero-Dependency Runner)", flush=True)
    print("=" * 60, flush=True)

    # 1. STT Tests
    print("\n--- Testing STT Adapters ---", flush=True)
    try:
        adapter = MockSTTAdapter(default_transcript="Test transcription text")
        res = sync_await(adapter.transcribe(b"RIFF" + b"\x00" * 150))
        assert res.transcript == "Test transcription text"
        assert res.confidence == 0.98
        report("MockSTTAdapter success", True)
    except Exception as e:
        report("MockSTTAdapter success", False, str(e))

    try:
        adapter = MockSTTAdapter()
        raised = False
        try:
            sync_await(adapter.transcribe(b""))
        except SpeechToTextError:
            raised = True
        assert raised, "Expected SpeechToTextError on empty audio"
        report("MockSTTAdapter empty audio rejection", True)
    except Exception as e:
        report("MockSTTAdapter empty audio rejection", False, str(e))

    try:
        google_stt = GoogleSTTAdapter(api_key="valid-dummy-key-32charslong")
        raised = False
        try:
            sync_await(google_stt.transcribe(b"\x00" * 20))
        except SpeechToTextError:
            raised = True
        assert raised
        report("GoogleSTTAdapter empty audio validation", True)
    except Exception as e:
        report("GoogleSTTAdapter empty audio validation", False, str(e))

    try:
        google_stt = GoogleSTTAdapter(api_key=None, timeout=0.1)
        google_stt._resolve_api_key = lambda: None
        raised = False
        try:
            sync_await(google_stt.transcribe(b"RIFF" + b"\x00" * 200))
        except ProviderConfigurationError:
            raised = True
        assert raised
        report("GoogleSTTAdapter missing API key detection", True)
    except Exception as e:
        report("GoogleSTTAdapter missing API key detection", False, str(e))

    try:
        reset_stt_provider_cache()
        mock_p = get_stt_provider("mock")
        assert isinstance(mock_p, MockSTTAdapter)
        reset_stt_provider_cache()
        report("STT Factory Mock resolution", True)
    except Exception as e:
        report("STT Factory Mock resolution", False, str(e))

    # 2. LLM Tests
    print("\n--- Testing LLM Adapters ---", flush=True)
    try:
        mock_llm = MockLLMAdapter()
        msgs = [
            LLMMessage(role="system", content="System"),
            LLMMessage(role="user", content="Hello"),
        ]
        resp = sync_await(mock_llm.complete(msgs))
        assert len(resp) > 5
        report("MockLLMAdapter complete response", True)
    except Exception as e:
        report("MockLLMAdapter complete response", False, str(e))

    try:
        mock_llm = MockLLMAdapter()
        chunks = sync_aiter(mock_llm.stream([LLMMessage(role="user", content="Hi")]))
        assert len(chunks) > 0
        report("MockLLMAdapter streaming tokens", True)
    except Exception as e:
        report("MockLLMAdapter streaming tokens", False, str(e))

    try:
        gemini = GeminiLLMAdapter()
        thought_test = "<thought>private thoughts</thought>Clean answer!"
        assert gemini._clean_response_text(thought_test) == "Clean answer!"
        report("GeminiLLMAdapter thought scrubbing", True)
    except Exception as e:
        report("GeminiLLMAdapter thought scrubbing", False, str(e))

    try:
        reset_llm_gateway_cache()
        mock_g = get_llm_gateway("mock")
        assert isinstance(mock_g, MockLLMAdapter)
        reset_llm_gateway_cache()
        report("LLM Factory Mock resolution", True)
    except Exception as e:
        report("LLM Factory Mock resolution", False, str(e))

    # 3. TTS Tests
    print("\n--- Testing TTS Adapters ---", flush=True)
    try:
        mock_tts = MockTTSAdapter()
        tts_res = sync_await(mock_tts.synthesize("Hello world"))
        assert tts_res.audio.startswith(b"RIFF")
        assert tts_res.content_type == "audio/wav"
        report("MockTTSAdapter audio generation", True)
    except Exception as e:
        report("MockTTSAdapter audio generation", False, str(e))

    try:
        mock_tts = MockTTSAdapter()
        raised = False
        try:
            sync_await(mock_tts.synthesize(""))
        except TextToSpeechError:
            raised = True
        assert raised
        report("MockTTSAdapter empty text rejection", True)
    except Exception as e:
        report("MockTTSAdapter empty text rejection", False, str(e))

    try:
        piper = PiperTTSAdapter()
        piper.check_runtime_status = lambda: (False, "Piper not installed")
        raised = False
        try:
            sync_await(piper.synthesize("Test text"))
        except ProviderUnavailableError:
            raised = True
        assert raised
        report("PiperTTSAdapter missing runtime diagnostic", True)
    except Exception as e:
        report("PiperTTSAdapter missing runtime diagnostic", False, str(e))

    # 4. Session Store Tests
    print("\n--- Testing Session Store ---", flush=True)
    try:
        store = InMemorySessionStore()
        s_a = store.get_or_create_session("sess-a")
        s_b = store.get_or_create_session("sess-b")
        s_a.add_message("user", "Msg A")
        s_b.add_message("user", "Msg B")
        assert s_a.messages[1].content == "Msg A"
        assert s_b.messages[1].content == "Msg B"
        report("Session Store isolation", True)
    except Exception as e:
        report("Session Store isolation", False, str(e))

    try:
        store = InMemorySessionStore()
        s = store.get_or_create_session("sess-reset")
        s.add_message("user", "Hello")
        s.add_message("assistant", "Hi")
        store.reset_session("sess-reset")
        reset_s = store.get_session("sess-reset")
        assert len(reset_s.messages) == 1
        assert reset_s.messages[0].role == "system"
        report("Session Store reset functionality", True)
    except Exception as e:
        report("Session Store reset functionality", False, str(e))

    # 5. Voice Orchestrator Pipeline Tests
    print("\n--- Testing Complete Pipeline Orchestration ---", flush=True)
    try:
        stt = MockSTTAdapter(default_transcript="I want an appointment")
        llm = MockLLMAdapter()
        tts = MockTTSAdapter()
        orchestrator = VoiceOrchestrator(stt_provider=stt, llm_gateway=llm, tts_provider=tts)

        result = sync_await(orchestrator.execute_turn(
            b"RIFF" + b"\x00" * 200,
            session_id="pipeline-success-sess",
        ))
        assert result.transcript == "I want an appointment"
        assert "Thank you" in result.response_text
        assert result.audio_base64 is not None
        assert result.timings.total_ms >= 0
        report("Full STT -> LLM -> TTS pipeline execution", True)
    except Exception as e:
        report("Full STT -> LLM -> TTS pipeline execution", False, str(e))

    try:
        class FailingSTT(MockSTTAdapter):
            async def transcribe(self, audio, **kwargs):
                raise SpeechToTextError("STT Failed")

        class SpyLLM(MockLLMAdapter):
            def __init__(self):
                super().__init__()
                self.called = False
            async def complete(self, messages, **kwargs):
                self.called = True
                return "text"

        stt_f = FailingSTT()
        llm_spy = SpyLLM()
        orchestrator = VoiceOrchestrator(stt_provider=stt_f, llm_gateway=llm_spy, tts_provider=MockTTSAdapter())

        raised = False
        try:
            sync_await(orchestrator.execute_turn(b"RIFF" + b"\x00" * 200))
        except SpeechToTextError:
            raised = True
        assert raised
        assert llm_spy.called is False
        report("STT failure halts execution before LLM", True)
    except Exception as e:
        report("STT failure halts execution before LLM", False, str(e))

    try:
        class FailingTTS(MockTTSAdapter):
            async def synthesize(self, text, **kwargs):
                raise TextToSpeechError("TTS model failure")

        orchestrator = VoiceOrchestrator(
            stt_provider=MockSTTAdapter(default_transcript="Preserve me"),
            llm_gateway=MockLLMAdapter(),
            tts_provider=FailingTTS(),
        )

        result = sync_await(orchestrator.execute_turn(b"RIFF" + b"\x00" * 200))
        assert result.transcript == "Preserve me"
        assert len(result.response_text) > 0
        assert result.audio_base64 is None
        assert "TTS model failure" in str(result.audio_error)
        report("TTS failure preserves transcript and LLM response", True)
    except Exception as e:
        report("TTS failure preserves transcript and LLM response", False, str(e))

    # 6. Phase 1 Conversational Intelligence Engine Tests
    print("\n--- Testing Conversational Intelligence Engine ---", flush=True)
    try:
        from app.adapters.llm.base import ToolCall, ToolDefinition, ToolResult, LLMResponse
        from app.services.conversation.state import ConversationState
        from app.services.conversation.session_store import ConversationSessionStore
        from app.services.conversation.orchestrator import ConversationOrchestrator

        # Test state serialization & secret masking
        s = ConversationState(session_id="test-run-unit", tenant_id="t-1")
        s.record_tool_execution("verify", {"otp": "1234"}, {"success": True})
        assert s.tool_execution_history[0]["arguments"]["otp"] == "***"
        report("ConversationState creation and audit secret masking", True)

        # Test session store
        c_store = ConversationSessionStore(use_redis=False)
        st = c_store.get_or_create_session("sess-test-unit", tenant_id="t-1")
        assert st.session_id == "sess-test-unit"
        report("ConversationSessionStore in-memory session persistence", True)

        # Test tool calling in orchestrator
        tc = ToolCall(name="check_availability", arguments={"doctor_id": "doc-shah", "date": "2026-11-26"})
        mock_ai = MockLLMAdapter(
            canned_response="Dr. Shah is available at 10 AM.",
            tool_call_sequence=[tc],
        )
        orch = ConversationOrchestrator(llm_gateway=mock_ai, session_store=c_store)

        executed = False
        async def dummy_tool(name, args, state):
            nonlocal executed
            executed = True
            return {"success": True, "slots": ["10:00"]}

        turn_res = sync_await(orch.execute_turn("Check Shah", session_id="sess-test-unit", tool_executor=dummy_tool))
        assert executed is True
        assert "Dr. Shah is available" in turn_res.response_text
        report("ConversationOrchestrator tool-call execution loop", True)
    except Exception as e:
        report("Phase 1 Conversational Engine Tests", False, str(e))

    # 7. Phase 2 Healthcare Backend Foundations
    print("\n--- Testing Phase 2 Healthcare Backend Services ---", flush=True)
    try:
        from tests.test_healthcare_services import TestHealthcareBackendServices
        suite = unittest.TestLoader().loadTestsFromTestCase(TestHealthcareBackendServices)
        runner = unittest.TextTestRunner(verbosity=0)
        res = runner.run(suite)
        if res.wasSuccessful():
            report(f"TestHealthcareBackendServices ({res.testsRun} tests)", True)
        else:
            report(f"TestHealthcareBackendServices ({len(res.failures)} failures, {len(res.errors)} errors)", False)
    except Exception as e:
        report("Phase 2 Healthcare Backend Services", False, str(e))

    # 8. Phase 3 Healthcare Tool Registry & Execution
    print("\n--- Testing Phase 3 Healthcare Tool Registry & Integration ---", flush=True)
    try:
        from tests.test_tool_registry import TestToolRegistry
        suite = unittest.TestLoader().loadTestsFromTestCase(TestToolRegistry)
        runner = unittest.TextTestRunner(verbosity=0)
        res = runner.run(suite)
        if res.wasSuccessful():
            report(f"TestToolRegistry ({res.testsRun} tests)", True)
        else:
            report(f"TestToolRegistry ({len(res.failures)} failures, {len(res.errors)} errors)", False)
    except Exception as e:
        report("Phase 3 Healthcare Tool Registry & Integration", False, str(e))

    # 9. Phase 4 Multi-Turn Conversational Journeys
    print("\n--- Testing Phase 4 Multi-Turn Conversational Journeys ---", flush=True)
    try:
        from tests.test_conversational_journeys import TestConversationalJourneys
        suite = unittest.TestLoader().loadTestsFromTestCase(TestConversationalJourneys)
        runner = unittest.TextTestRunner(verbosity=0)
        res = runner.run(suite)
        if res.wasSuccessful():
            report(f"TestConversationalJourneys ({res.testsRun} tests)", True)
        else:
            report(f"TestConversationalJourneys ({len(res.failures)} failures, {len(res.errors)} errors)", False)
    except Exception as e:
        report("Phase 4 Multi-Turn Conversational Journeys", False, str(e))

    # 10. Phase 5 Inbound Calling API Boundary
    print("\n--- Testing Phase 5 Inbound Calling API Boundary ---", flush=True)
    try:
        from tests.test_inbound_calling_api import TestInboundCallingAPI
        suite = unittest.TestLoader().loadTestsFromTestCase(TestInboundCallingAPI)
        runner = unittest.TextTestRunner(verbosity=0)
        res = runner.run(suite)
        if res.wasSuccessful():
            report(f"TestInboundCallingAPI ({res.testsRun} tests)", True)
        else:
            report(f"TestInboundCallingAPI ({len(res.failures)} failures, {len(res.errors)} errors)", False)
    except Exception as e:
        report("Phase 5 Inbound Calling API Boundary", False, str(e))

    print("\n" + "=" * 60, flush=True)
    print(f"Results: {passed} passed, {failed} failed", flush=True)
    print("=" * 60, flush=True)

    if failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    run_tests()
