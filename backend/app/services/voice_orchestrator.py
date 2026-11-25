"""Voice Turn Orchestration Service.

Coordinates the end-to-end voice pipeline:
Audio Input -> STT -> Session Context -> LLM Reasoning -> TTS Audio -> Structured Turn Result.
Provides precise latency profiling and decoupled error containment.
"""

import base64
import logging
import re
import time
from dataclasses import asdict, dataclass
from typing import Any, AsyncGenerator, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession

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
from app.services.conversation.orchestrator import conversation_orchestrator
from app.services.session_store import session_store
from app.services.tools.healthcare_tools import healthcare_tool_registry
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
        tenant_id: Optional[str] = None,
        db: Optional[AsyncSession] = None,
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

        # 3. Stage 2: Conversation Context & LLM Reasoning (with Healthcare Tools when DB & tenant exist)
        llm_start = time.perf_counter()
        if db is not None and tenant_id is not None:
            try:
                conv_result = await conversation_orchestrator.execute_turn(
                    transcript=transcript,
                    session_id=effective_session_id,
                    tenant_id=tenant_id,
                    language=language or "en",
                    tool_registry=healthcare_tool_registry,
                    db=db,
                )
                clean_response = conv_result.response_text.strip()
                llm_ms = (time.perf_counter() - llm_start) * 1000.0
            except Exception as exc:
                logger.error(f"Conversational Orchestrator Stage failed for session {effective_session_id}: {exc}")
                raise
        else:
            session.add_message("user", transcript)
            context_messages = session.get_context_messages()

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

    async def execute_turn_stream(
        self,
        audio_bytes: bytes,
        *,
        content_type: str = "audio/wav",
        session_id: Optional[str] = None,
        language: Optional[str] = "en",
        prefix_transcript: Optional[str] = None,
        tenant_id: Optional[str] = None,
        db: Optional[AsyncSession] = None,
        stt_name: Optional[str] = None,
        llm_name: Optional[str] = None,
        tts_name: Optional[str] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Execute a turn and yield sentence-level audio chunks via SSE for low-latency playback."""
        if not audio_bytes or len(audio_bytes) < 50:
            raise BadRequestException("Audio payload is empty or invalid (< 50 bytes).")

        stt, llm, tts = self._get_providers(stt_name, llm_name, tts_name)
        session = session_store.get_or_create_session(session_id)
        effective_session_id = session.session_id

        overall_start = time.perf_counter()

        # 1. Stage 1: Speech-to-Text
        stt_start = time.perf_counter()
        stt_result = await stt.transcribe(
            audio_bytes,
            content_type=content_type,
            language=language,
        )
        stt_ms = (time.perf_counter() - stt_start) * 1000.0
        transcript = stt_result.transcript.strip()
        if prefix_transcript and prefix_transcript.strip():
            transcript = f"{prefix_transcript.strip()} {transcript}".strip()
        if not transcript:
            raise SpeechToTextError("Speech transcription returned empty text.")

        yield {
            "type": "transcript",
            "session_id": effective_session_id,
            "transcript": transcript,
            "stt_ms": round(stt_ms, 2),
        }

        # 2. Stage 2: Conversation Context & LLM Reasoning with Tools
        # 2. Stage 2 & 3: True Streamed LLM Sentences -> Immediate Piper TTS Chunks
        llm_start = time.perf_counter()
        tts_ms = 0.0
        audio_error: Optional[str] = None
        clean_response = ""
        chunk_idx = 0

        if db is not None and tenant_id is not None:
            async for event in conversation_orchestrator.execute_turn_stream(
                transcript=transcript,
                session_id=effective_session_id,
                tenant_id=tenant_id,
                language=language or "en",
                tool_registry=healthcare_tool_registry,
                db=db,
            ):
                if event["type"] == "sentence":
                    sentence = event["text"]
                    t0 = time.perf_counter()
                    try:
                        tts_result = await tts.synthesize(sentence, language=language)
                        tts_ms += (time.perf_counter() - t0) * 1000.0
                        b64 = base64.b64encode(tts_result.audio).decode("ascii")
                        yield {
                            "type": "audio_chunk",
                            "index": chunk_idx,
                            "text": sentence,
                            "audio_base64": b64,
                            "audio_mime_type": tts_result.content_type,
                        }
                    except Exception as exc:
                        tts_ms += (time.perf_counter() - t0) * 1000.0
                        logger.warning(f"TTS chunk {chunk_idx} failed for session {effective_session_id}: {exc}")
                        audio_error = str(exc)
                        yield {
                            "type": "text_chunk",
                            "index": chunk_idx,
                            "text": sentence,
                        }
                    chunk_idx += 1
                elif event["type"] == "complete":
                    clean_response = event["response_text"]

            llm_ms = max(0.0, ((time.perf_counter() - llm_start) * 1000.0) - tts_ms)
        else:
            session.add_message("user", transcript)
            context_messages = session.get_context_messages()
            response_text = await llm.complete(context_messages)
            clean_response = response_text.strip()
            if not clean_response:
                raise LLMGenerationError("Language model generated an empty response.")
            session.add_message("assistant", clean_response)
            llm_ms = (time.perf_counter() - llm_start) * 1000.0

            clean_tts_text = sanitize_text_for_tts(clean_response)
            sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", clean_tts_text) if s.strip()] or [clean_tts_text]
            tts_start = time.perf_counter()
            for idx, sentence in enumerate(sentences):
                try:
                    tts_result = await tts.synthesize(sentence, language=language)
                    b64 = base64.b64encode(tts_result.audio).decode("ascii")
                    yield {
                        "type": "audio_chunk",
                        "index": idx,
                        "text": sentence,
                        "audio_base64": b64,
                        "audio_mime_type": tts_result.content_type,
                    }
                except Exception as exc:
                    audio_error = str(exc)
                    yield {"type": "text_chunk", "index": idx, "text": sentence}
            tts_ms = (time.perf_counter() - tts_start) * 1000.0

        total_ms = (time.perf_counter() - overall_start) * 1000.0

        yield {
            "type": "done",
            "session_id": effective_session_id,
            "transcript": transcript,
            "response_text": clean_response,
            "audio_error": audio_error,
            "timings": {
                "stt_ms": round(stt_ms, 2),
                "llm_ms": round(llm_ms, 2),
                "tts_ms": round(tts_ms, 2),
                "total_ms": round(total_ms, 2),
            },
            "providers": {
                "stt": stt.name,
                "llm": llm.name,
                "tts": tts.name,
            },
        }


voice_orchestrator = VoiceOrchestrator()

