"""Text-to-Speech (TTS) Adapter Interface.

Decouples audio synthesis providers (Piper, ElevenLabs, Deepgram, gTTS) from business logic.
Reuses proven interface patterns from virtual-buddy-backend.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class TTSResult:
    """Standardized text-to-speech synthesis result."""
    audio: bytes
    content_type: str = "audio/wav"
    format: str = "wav"
    duration: Optional[float] = None
    language: Optional[str] = None


class TTSProvider(ABC):
    """Abstract interface for text-to-speech providers."""

    name: str

    @abstractmethod
    async def synthesize(
        self,
        text: str,
        *,
        language: Optional[str] = None,
        voice: Optional[str] = None,
        **kwargs,
    ) -> TTSResult:
        """Synthesize text into raw audio bytes."""
        pass


class MockTTSAdapter(TTSProvider):
    """Mock TTS provider returning stub audio bytes for tests and development."""

    name = "mock"

    async def synthesize(
        self,
        text: str,
        *,
        language: Optional[str] = None,
        voice: Optional[str] = None,
        **kwargs,
    ) -> TTSResult:
        # Generate minimal valid WAV header (44 bytes) + silent PCM payload
        sample_rate = 16000
        num_channels = 1
        bytes_per_sample = 2
        data_size = sample_rate * bytes_per_sample  # 1 second of silence
        wav_header = (
            b"RIFF"
            + (data_size + 36).to_bytes(4, "little")
            + b"WAVEfmt "
            + (16).to_bytes(4, "little")  # Subchunk1Size
            + (1).to_bytes(2, "little")   # AudioFormat (PCM)
            + num_channels.to_bytes(2, "little")
            + sample_rate.to_bytes(4, "little")
            + (sample_rate * num_channels * bytes_per_sample).to_bytes(4, "little")
            + (num_channels * bytes_per_sample).to_bytes(2, "little")
            + (bytes_per_sample * 8).to_bytes(2, "little")
            + b"data"
            + data_size.to_bytes(4, "little")
        )
        audio = wav_header + b"\x00" * data_size

        return TTSResult(
            audio=audio,
            content_type="audio/wav",
            format="wav",
            duration=1.0,
            language=language or "en",
        )

