"""Unit tests for Speech-to-Text (STT) Adapters and Factory."""

import pytest
from app.adapters.stt.base import MockSTTAdapter, STTResult
from app.adapters.stt.factory import get_stt_provider, reset_stt_provider_cache
from app.adapters.stt.google import GoogleSTTAdapter
from app.core.exceptions import (
    ProviderConfigurationError,
    SpeechToTextError,
)


@pytest.mark.asyncio
async def test_mock_stt_success():
    """Test MockSTTAdapter successfully transcribes audio bytes."""
    adapter = MockSTTAdapter(default_transcript="Test transcription text")
    dummy_audio = b"RIFF" + b"\x00" * 150

    result = await adapter.transcribe(dummy_audio, content_type="audio/wav", language="en")
    assert isinstance(result, STTResult)
    assert result.transcript == "Test transcription text"
    assert result.language == "en"
    assert result.confidence == 0.98


@pytest.mark.asyncio
async def test_mock_stt_empty_audio():
    """Test MockSTTAdapter raises SpeechToTextError on empty audio."""
    adapter = MockSTTAdapter()
    with pytest.raises(SpeechToTextError):
        await adapter.transcribe(b"", content_type="audio/wav")

    with pytest.raises(SpeechToTextError):
        await adapter.transcribe(b"too_short", content_type="audio/wav")


@pytest.mark.asyncio
async def test_google_stt_empty_audio_rejection():
    """Test GoogleSTTAdapter rejects empty audio payloads before calling API."""
    adapter = GoogleSTTAdapter(api_key="valid-dummy-test-key-32charslong")
    with pytest.raises(SpeechToTextError, match="empty or too short"):
        await adapter.transcribe(b"", content_type="audio/wav")

    with pytest.raises(SpeechToTextError, match="empty or too short"):
        await adapter.transcribe(b"\x00" * 40, content_type="audio/wav")


@pytest.mark.asyncio
async def test_google_stt_missing_api_key():
    """Test GoogleSTTAdapter raises ProviderConfigurationError when API key is missing."""
    adapter = GoogleSTTAdapter(api_key=None)
    # Ensure no fallback key resolves
    adapter._explicit_api_key = None
    adapter._resolve_api_key = lambda: None

    dummy_audio = b"RIFF" + b"\x00" * 200
    with pytest.raises(ProviderConfigurationError, match="Google API key not configured"):
        await adapter.transcribe(dummy_audio, content_type="audio/wav")


def test_google_stt_mime_normalization():
    """Test GoogleSTTAdapter normalizes various audio MIME strings."""
    adapter = GoogleSTTAdapter()
    assert adapter._normalize_mime("audio/webm;codecs=opus") == "audio/webm"
    assert adapter._normalize_mime("audio/x-wav") == "audio/wav"
    assert adapter._normalize_mime("audio/wav") == "audio/wav"
    assert adapter._normalize_mime("audio/mp3") == "audio/mpeg"
    assert adapter._normalize_mime(None) == "audio/wav"


def test_stt_factory():
    """Test STT provider factory resolves mock and rejects unsupported names."""
    reset_stt_provider_cache()
    mock_p = get_stt_provider("mock")
    assert isinstance(mock_p, MockSTTAdapter)
    assert mock_p.name == "mock"

    # Same instance returned from cache
    assert get_stt_provider("mock") is mock_p

    with pytest.raises(ProviderConfigurationError, match="Unsupported STT provider"):
        get_stt_provider("unsupported_vendor_xyz")
    reset_stt_provider_cache()

