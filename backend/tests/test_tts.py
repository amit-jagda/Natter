"""Unit tests for Text-to-Speech (TTS) Adapters and Factory."""

import pytest
from app.adapters.tts.base import MockTTSAdapter, TTSResult
from app.adapters.tts.factory import get_tts_provider, reset_tts_provider_cache
from app.adapters.tts.piper import PiperTTSAdapter
from app.core.exceptions import (
    ProviderConfigurationError,
    ProviderUnavailableError,
    TextToSpeechError,
)


@pytest.mark.asyncio
async def test_mock_tts_success():
    """Test MockTTSAdapter produces valid WAV audio with standard RIFF header."""
    adapter = MockTTSAdapter()
    result = await adapter.synthesize("Hello world, this is a test speech synthesis.")

    assert isinstance(result, TTSResult)
    assert result.content_type == "audio/wav"
    assert result.format == "wav"
    assert len(result.audio) > 44
    assert result.audio.startswith(b"RIFF")


@pytest.mark.asyncio
async def test_mock_tts_empty_text():
    """Test MockTTSAdapter raises TextToSpeechError on empty input text."""
    adapter = MockTTSAdapter()
    with pytest.raises(TextToSpeechError, match="Text cannot be empty"):
        await adapter.synthesize("")

    with pytest.raises(TextToSpeechError, match="Text cannot be empty"):
        await adapter.synthesize("   ")


@pytest.mark.asyncio
async def test_piper_missing_runtime_handling():
    """Test PiperTTSAdapter raises ProviderUnavailableError when runtime is not installed."""
    adapter = PiperTTSAdapter()
    # Force check_runtime_status to report unavailable
    adapter.check_runtime_status = lambda: (False, "Piper is not installed on this test host.")

    with pytest.raises(ProviderUnavailableError, match="Piper TTS runtime is not available"):
        await adapter.synthesize("Test text for Piper")


def test_piper_voice_resolution():
    """Test Piper voice model name resolution across languages."""
    adapter = PiperTTSAdapter(default_voice="en_US-lessac-medium")
    assert adapter._resolve_voice_name(None, "hi") == "hi_IN-pratham-medium"
    assert adapter._resolve_voice_name(None, "en") == "en_US-lessac-medium"
    assert adapter._resolve_voice_name("custom-voice", None) == "en_US-lessac-medium"
    assert adapter._resolve_voice_name("en_US-ryan-medium", None) == "en_US-ryan-medium"


def test_tts_factory():
    """Test TTS provider factory resolves mock and rejects unsupported names."""
    reset_tts_provider_cache()
    mock_p = get_tts_provider("mock")
    assert isinstance(mock_p, MockTTSAdapter)
    assert mock_p.name == "mock"

    assert get_tts_provider("mock") is mock_p

    with pytest.raises(ProviderConfigurationError, match="Unsupported TTS provider"):
        get_tts_provider("unsupported_tts_engine")
    reset_tts_provider_cache()


def test_gtts_gujarati_mapping():
    """Test GTTSAdapter maps Gujarati language keys correctly."""
    from app.adapters.tts.gtts import LANG_MAP
    assert LANG_MAP.get("gu") == "gu"
    assert LANG_MAP.get("gujarati") == "gu"
    assert LANG_MAP.get("gu-in") == "gu"
    assert LANG_MAP.get("hi") == "hi"
    assert LANG_MAP.get("en") == "en"


def test_smart_hybrid_tts_routing():
    """Test VoiceOrchestrator._resolve_tts_provider routes Gujarati directly to gTTS."""
    from app.services.voice_orchestrator import VoiceOrchestrator
    orchestrator = VoiceOrchestrator()

    # Gujarati should route primary to gTTS
    gu_primary, _ = orchestrator._resolve_tts_provider(language="gu")
    assert gu_primary.name == "gtts"

    gu_in_primary, _ = orchestrator._resolve_tts_provider(language="gu-IN")
    assert gu_in_primary.name == "gtts"

    # Explicit override should be respected
    mock_primary, _ = orchestrator._resolve_tts_provider(language="en", tts_name="mock")
    assert mock_primary.name == "mock"

