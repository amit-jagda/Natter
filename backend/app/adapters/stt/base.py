"""Speech-to-Text (STT) Adapter Interface.

Decouples transcription engines (Google Gemini, Deepgram, Whisper) from business logic.
Reuses proven interface patterns from virtual-buddy-backend without legacy coupling.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional

from app.core.exceptions import SpeechToTextError


@dataclass(frozen=True)
class STTResult:
    """Standardized speech transcription result."""
    transcript: str
    language: Optional[str] = None
    duration: Optional[float] = None
    confidence: Optional[float] = None


class STTProvider(ABC):
    """Abstract interface for speech-to-text providers."""

    name: str

    @abstractmethod
    async def transcribe(
        self,
        audio: bytes,
        *,
        content_type: str = "audio/wav",
        language: Optional[str] = None,
    ) -> STTResult:
        """Transcribe raw audio bytes into text."""
        pass


class MockSTTAdapter(STTProvider):
    """Mock STT provider for unit tests and local development."""

    name = "mock"

    def __init__(self, default_transcript: str = "Hello, I am interested in your service.") -> None:
        self.default_transcript = default_transcript

    async def transcribe(
        self,
        audio: bytes,
        *,
        content_type: str = "audio/wav",
        language: Optional[str] = None,
    ) -> STTResult:
        if not audio or len(audio) < 10:
            raise SpeechToTextError("Audio data is empty or too short for transcription.")
        return STTResult(
            transcript=self.default_transcript,
            language=language or "en",
            confidence=0.98,
        )

