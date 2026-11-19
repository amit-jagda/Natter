"""Voice Turn Orchestration Service.

Coordinates the end-to-end voice pipeline:
Audio Input -> STT -> Session Context -> LLM Reasoning -> TTS Audio -> Structured Turn Result.
Provides precise latency profiling and decoupled error containment.
"""

import base64
import logging
import time
from dataclasses import asdict, dataclass
from typing import Any, Dict, Optional

from app.adapters.llm.base import LLMGateway
from app.adapters.llm.factory import get_llm_gateway
from app.adapters.stt.base import STTProvider
from app.adapters.stt.factory import get_stt_provider
from app.adapters.tts.base import TTSProvider
from app.adapters.tts.factory import get_tts_provider
from app.core.exceptions import (
    BadRequestException,
    LLMGenerationError,
    SpeechToTextError,
)
from app.services.session_store import session_store
from app.utils.audio_processing import sanitize_text_for_tts

logger = logging.getLogger(__name__)


@dataclass
class VoiceTurnTimings:
    """Latency breakdown for individual turn processing stages in milliseconds."""
    stt_ms: float
    llm_ms: float
    tts_ms: float
    total_ms: float

    def to_dict(self) -> Dict[str, float]:
        return {
            "stt_ms": round(self.stt_ms, 2),
            "llm_ms": round(self.llm_ms, 2),
            "tts_ms": round(self.tts_ms, 2),
            "total_ms": round(self.total_ms, 2),
        }


@dataclass
class VoiceTurnResult:
    """Standardized result returned after executing a full voice turn."""
    session_id: str
    transcript: str
    response_text: str
    audio_base64: Optional[str]
    audio_mime_type: Optional[str]
    audio_error: Optional[str]
    timings: VoiceTurnTimings
    providers: Dict[str, str]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "session_id": self.session_id,
            "transcript": self.transcript,
            "response_text": self.response_text,
            "audio_base64": self.audio_base64,
            "audio_mime_type": self.audio_mime_type,
            "audio_error": self.audio_error,
            "timings": self.timings.to_dict(),
            "providers": self.providers,
        }


class VoiceOrchestrator:
    """Coordinates turn-based voice processing."""

    def __init__(
        self,
        stt_provider: Optional[STTProvider] = None,
        llm_gateway: Optional[LLMGateway] = None,
        tts_provider: Optional[TTSProvider] = None,
    ) -> None:
        self._stt = stt_provider
        self._llm = llm_gateway
        self._tts = tts_provider

    def _get_providers(
        self,
        stt_name: Optional[str] = None,
        llm_name: Optional[str] = None,
        tts_name: Optional[str] = None,
    ):
        stt = self._stt or get_stt_provider(stt_name)
        llm = self._llm or get_llm_gateway(llm_name)
        tts = self._tts or get_tts_provider(tts_name)
        return stt, llm, tts

    async def execute_turn(
        self,
        audio_bytes: bytes,
        *,
        content_type: str = "audio/wav",
        session_id: Optional[str] = None,
        language: Optional[str] = "en",
        stt_name: Optional[str] = None,
        llm_name: Optional[str] = None,
        tts_name: Optional[str] = None,
    ) -> VoiceTurnResult:
        """Execute a full turn: Speech-to-Text -> LLM reasoning -> Text-to-Speech.

        Args:
            audio_bytes: Raw audio bytes recorded by frontend.
            content_type: Audio MIME type (e.g. 'audio/webm;codecs=opus' or 'audio/wav').
            session_id: Conversation session identifier.
            language: Spoken language hint ('en', 'hi', or None).
            stt_name: Optional override for STT provider.
            llm_name: Optional override for LLM provider.
            tts_name: Optional override for TTS provider.

        Returns:
            VoiceTurnResult containing transcript, response, audio, timings, and metadata.
        """
        if not audio_bytes or len(audio_bytes) < 50:
            raise BadRequestException("Audio payload is empty or invalid (< 50 bytes).")

        stt, llm, tts = self._get_providers(stt_name, llm_name, tts_name)

        # 1. Retrieve or create session context
        session = session_store.get_or_create_session(session_id)
        effective_session_id = session.session_id

        overall_start = time.perf_counter()

        # 2. Stage 1: Speech-to-Text
        stt_start = time.perf_counter()
        try:
            stt_result = await stt.transcribe(
                audio_bytes,
                content_type=content_type,
                language=language,
            )
            stt_ms = (time.perf_counter() - stt_start) * 1000.0
        except Exception as exc:
            logger.error(f"STT Stage failed for session {effective_session_id}: {exc}")
            raise

        transcript = stt_result.transcript.strip()
        if not transcript:
            raise SpeechToTextError("Speech transcription returned empty text.")

        # 3. Stage 2: Conversation Context & LLM Reasoning
        session.add_message("user", transcript)
        context_messages = session.get_context_messages()

        llm_start = time.perf_counter()
        try:
            response_text = await llm.complete(context_messages)
            llm_ms = (time.perf_counter() - llm_start) * 1000.0
        except Exception as exc:
            logger.error(f"LLM Stage failed for session {effective_session_id}: {exc}")
            raise

        clean_response = response_text.strip()
        if not clean_response:
            raise LLMGenerationError("Language model generated an empty response.")

        session.add_message("assistant", clean_response)

        # 4. Stage 3: Text-to-Speech Audio Generation
        # Sanitize text so markdown, emojis, asterisks are not spoken by TTS
        clean_tts_text = sanitize_text_for_tts(clean_response)

        audio_base64: Optional[str] = None
        audio_mime_type: Optional[str] = None
        audio_error: Optional[str] = None

        tts_start = time.perf_counter()
        try:
            tts_result = await tts.synthesize(
                clean_tts_text,
                language=language,
            )
            audio_base64 = base64.b64encode(tts_result.audio).decode("ascii")
            audio_mime_type = tts_result.content_type
        except Exception as exc:
            # Preserve transcript and text response when TTS fails!
            logger.warning(
                f"TTS Stage failed for session {effective_session_id} ({exc}). "
                "Preserving transcript and LLM response."
            )
            audio_error = str(exc)

        tts_ms = (time.perf_counter() - tts_start) * 1000.0
        total_ms = (time.perf_counter() - overall_start) * 1000.0

        timings = VoiceTurnTimings(
            stt_ms=stt_ms,
            llm_ms=llm_ms,
            tts_ms=tts_ms,
            total_ms=total_ms,
        )

        providers = {
            "stt": stt.name,
            "llm": llm.name,
            "tts": tts.name,
        }

        logger.info(
            f"Voice turn completed for session {effective_session_id} in {total_ms:.1f}ms "
            f"(STT: {stt_ms:.1f}ms, LLM: {llm_ms:.1f}ms, TTS: {tts_ms:.1f}ms) | Providers: {providers}"
        )

        return VoiceTurnResult(
            session_id=effective_session_id,
            transcript=transcript,
            response_text=clean_response,
            audio_base64=audio_base64,
            audio_mime_type=audio_mime_type,
            audio_error=audio_error,
            timings=timings,
            providers=providers,
        )


voice_orchestrator = VoiceOrchestrator()

