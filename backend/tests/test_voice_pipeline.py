"""End-to-End and Integration tests for Voice Orchestrator and Turn API."""

import io
import pytest
from app.adapters.llm.base import MockLLMAdapter
from app.adapters.stt.base import MockSTTAdapter
from app.adapters.tts.base import MockTTSAdapter
from app.core.exceptions import LLMGenerationError, SpeechToTextError, TextToSpeechError
from app.services.session_store import session_store
from app.services.voice_orchestrator import VoiceOrchestrator


@pytest.mark.asyncio
async def test_orchestrator_complete_success():
    """Test full STT -> LLM -> TTS pipeline turn succeeds with correct structure."""
    stt = MockSTTAdapter(default_transcript="Hello, I want to book an appointment.")
    llm = MockLLMAdapter()
    tts = MockTTSAdapter()

    orchestrator = VoiceOrchestrator(stt_provider=stt, llm_gateway=llm, tts_provider=tts)

    dummy_audio = b"RIFF" + b"\x00" * 200
    result = await orchestrator.execute_turn(
        audio_bytes=dummy_audio,
        content_type="audio/wav",
        session_id="test-session-pipeline",
        language="en",
    )

    assert result.session_id == "test-session-pipeline"
    assert result.transcript == "Hello, I want to book an appointment."
    assert "Thank you" in result.response_text
    assert result.audio_base64 is not None
    assert result.audio_mime_type == "audio/wav"
    assert result.audio_error is None

    # Verify timings are present and non-negative
    assert result.timings.stt_ms >= 0
    assert result.timings.llm_ms >= 0
    assert result.timings.tts_ms >= 0
    assert result.timings.total_ms >= 0

    assert result.providers["stt"] == "mock"
    assert result.providers["llm"] == "mock"
    assert result.providers["tts"] == "mock"


@pytest.mark.asyncio
async def test_orchestrator_stt_failure_prevents_llm():
    """Test STT failure aborts pipeline and does not call LLM."""
    class FailingSTT(MockSTTAdapter):
        async def transcribe(self, audio, **kwargs):
            raise SpeechToTextError("Simulated STT failure")

    class SpyLLM(MockLLMAdapter):
        def __init__(self):
            super().__init__()
            self.called = False

        async def complete(self, messages, **kwargs):
            self.called = True
            return "Should not be reached"

    stt = FailingSTT()
    llm = SpyLLM()
    tts = MockTTSAdapter()

    orchestrator = VoiceOrchestrator(stt_provider=stt, llm_gateway=llm, tts_provider=tts)

    with pytest.raises(SpeechToTextError, match="Simulated STT failure"):
        await orchestrator.execute_turn(
            audio_bytes=b"RIFF" + b"\x00" * 200,
            session_id="test-session-stt-fail",
        )

    assert llm.called is False


@pytest.mark.asyncio
async def test_orchestrator_llm_failure_prevents_tts():
    """Test LLM failure aborts pipeline and does not call TTS."""
    class FailingLLM(MockLLMAdapter):
        async def complete(self, messages, **kwargs):
            raise LLMGenerationError("Simulated LLM reasoning timeout")

    class SpyTTS(MockTTSAdapter):
        def __init__(self):
            super().__init__()
            self.called = False

        async def synthesize(self, text, **kwargs):
            self.called = True
            return await super().synthesize(text, **kwargs)

    stt = MockSTTAdapter()
    llm = FailingLLM()
    tts = SpyTTS()

    orchestrator = VoiceOrchestrator(stt_provider=stt, llm_gateway=llm, tts_provider=tts)

    with pytest.raises(LLMGenerationError, match="Simulated LLM reasoning timeout"):
        await orchestrator.execute_turn(
            audio_bytes=b"RIFF" + b"\x00" * 200,
            session_id="test-session-llm-fail",
        )

    assert tts.called is False


@pytest.mark.asyncio
async def test_orchestrator_tts_failure_preserves_transcript_and_text():
    """Test TTS failure preserves user transcript and LLM response text."""
    class FailingTTS(MockTTSAdapter):
        async def synthesize(self, text, **kwargs):
            raise TextToSpeechError("Simulated TTS voice model error")

    stt = MockSTTAdapter(default_transcript="Patient inquiry")
    llm = MockLLMAdapter()
    tts = FailingTTS()

    orchestrator = VoiceOrchestrator(stt_provider=stt, llm_gateway=llm, tts_provider=tts)

    result = await orchestrator.execute_turn(
        audio_bytes=b"RIFF" + b"\x00" * 200,
        session_id="test-session-tts-fail",
    )

    # Transcript and text MUST be preserved!
    assert result.transcript == "Patient inquiry"
    assert "Thank you" in result.response_text
    # Audio is None, error is captured
    assert result.audio_base64 is None
    assert "Simulated TTS voice model error" in str(result.audio_error)


@pytest.mark.asyncio
async def test_voice_api_endpoints(client):
    """Test HTTP API endpoints: /api/v1/voice/turn, /providers, /sessions/reset."""
    # 1. Test /api/v1/voice/providers
    resp = await client.get("/api/v1/voice/providers")
    assert resp.status_code == 200
    providers_data = resp.json()
    assert "stt" in providers_data
    assert "llm" in providers_data
    assert "tts" in providers_data

    # 2. Test /api/v1/voice/turn (using Mock providers)
    from app.core.config import settings
    prev_stt = settings.STT_PROVIDER
    prev_llm = settings.LLM_PROVIDER
    prev_tts = settings.TTS_PROVIDER

    settings.STT_PROVIDER = "mock"
    settings.LLM_PROVIDER = "mock"
    settings.TTS_PROVIDER = "mock"

    try:
        audio_content = b"RIFF" + b"\x00" * 300
        files = {"audio": ("test.wav", io.BytesIO(audio_content), "audio/wav")}
        data = {"session_id": "api-test-session-1", "language": "en"}

        turn_resp = await client.post("/api/v1/voice/turn", files=files, data=data)
        assert turn_resp.status_code == 200
        turn_data = turn_resp.json()
        assert turn_data["session_id"] == "api-test-session-1"
        assert len(turn_data["transcript"]) > 0
        assert len(turn_data["response_text"]) > 0
        assert turn_data["audio_base64"] is not None
        assert "stt_ms" in turn_data["timings"]

        # 3. Test /api/v1/voice/sessions/{session_id}/reset
        reset_resp = await client.post("/api/v1/voice/sessions/api-test-session-1/reset")
        assert reset_resp.status_code == 200
        assert reset_resp.json()["reset"] is True
    finally:
        settings.STT_PROVIDER = prev_stt
        settings.LLM_PROVIDER = prev_llm
        settings.TTS_PROVIDER = prev_tts

