"""Voice API Endpoints.

Handles turn-based voice uploads, provider status queries, and conversation session resets.
Provides latency profiling and robust error handling.
"""

import logging
from typing import Optional
from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status

from app.adapters.llm.factory import get_llm_gateway
from app.adapters.stt.factory import get_stt_provider
from app.adapters.tts.factory import get_tts_provider
from app.core.config import settings
from app.core.exceptions import BadRequestException
from app.schemas.voice import (
    ProviderStatusItem,
    SessionResetResponse,
    VoiceProvidersStatusResponse,
    VoiceTurnResponse,
    VoiceTurnTimingsSchema,
)
from app.services.session_store import session_store
from app.services.voice_orchestrator import voice_orchestrator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/voice", tags=["Voice Playground"])

MAX_AUDIO_BYTES = 15 * 1024 * 1024  # 15 MB limit


@router.post(
    "/turn",
    response_model=VoiceTurnResponse,
    status_code=status.HTTP_200_OK,
    summary="Process a single conversational voice turn (STT -> LLM -> TTS)",
)
async def process_voice_turn(
    audio: UploadFile = File(..., description="Audio recording file from frontend"),
    session_id: Optional[str] = Form(None, description="Active session ID or empty to generate new"),
    language: Optional[str] = Form("en", description="Spoken language hint ('en', 'hi')"),
) -> VoiceTurnResponse:
    """Accept an audio recording, transcribe with STT, generate response with LLM,

    and synthesize speech with TTS.
    """
    if not audio:
        raise BadRequestException("Audio file is required.")

    # Read audio content into memory
    audio_bytes = await audio.read()
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise BadRequestException(f"Audio file exceeds maximum size of {MAX_AUDIO_BYTES // (1024*1024)}MB.")

    content_type = audio.content_type or "audio/wav"

    result = await voice_orchestrator.execute_turn(
        audio_bytes=audio_bytes,
        content_type=content_type,
        session_id=session_id,
        language=language,
    )

    return VoiceTurnResponse(
        session_id=result.session_id,
        transcript=result.transcript,
        response_text=result.response_text,
        audio_base64=result.audio_base64,
        audio_mime_type=result.audio_mime_type,
        audio_error=result.audio_error,
        timings=VoiceTurnTimingsSchema(
            stt_ms=result.timings.stt_ms,
            llm_ms=result.timings.llm_ms,
            tts_ms=result.timings.tts_ms,
            total_ms=result.timings.total_ms,
        ),
        providers=result.providers,
    )


@router.get(
    "/providers",
    response_model=VoiceProvidersStatusResponse,
    summary="Get current voice engine provider readiness status",
)
async def get_providers_status() -> VoiceProvidersStatusResponse:
    """Return configured providers and readiness diagnostics without exposing API keys."""
    # STT Status
    stt_target = (settings.STT_PROVIDER or "mock").lower()
    stt_configured = False
    stt_available = True
    stt_details = f"Model: {settings.GOOGLE_STT_MODEL}"
    try:
        stt_instance = get_stt_provider()
        if hasattr(stt_instance, "is_configured"):
            stt_configured = stt_instance.is_configured()
            if not stt_configured:
                stt_details += " (API Key missing in .env)"
        else:
            stt_configured = True
    except Exception as exc:
        stt_available = False
        stt_details = str(exc)

    # LLM Status
    llm_target = (settings.LLM_PROVIDER or "mock").lower()
    llm_configured = False
    llm_available = True
    llm_details = f"Model: {settings.GEMINI_LLM_MODEL}"
    try:
        llm_instance = get_llm_gateway()
        if hasattr(llm_instance, "is_configured"):
            llm_configured = llm_instance.is_configured()
            if not llm_configured:
                llm_details += " (API Key missing in .env)"
        else:
            llm_configured = True
    except Exception as exc:
        llm_available = False
        llm_details = str(exc)

    # TTS Status
    tts_target = (settings.TTS_PROVIDER or "mock").lower()
    tts_configured = True
    tts_available = True
    tts_details = f"Voice: {settings.PIPER_DEFAULT_VOICE}"
    try:
        tts_instance = get_tts_provider()
        if hasattr(tts_instance, "check_runtime_status"):
            avail, msg = tts_instance.check_runtime_status()
            tts_available = avail
            tts_details += f" ({msg})"
        elif hasattr(tts_instance, "is_available"):
            tts_available = tts_instance.is_available()
    except Exception as exc:
        tts_available = False
        tts_details = str(exc)

    return VoiceProvidersStatusResponse(
        stt=ProviderStatusItem(
            provider=stt_target,
            configured=stt_configured,
            available=stt_available,
            details=stt_details,
        ),
        llm=ProviderStatusItem(
            provider=llm_target,
            configured=llm_configured,
            available=llm_available,
            details=llm_details,
        ),
        tts=ProviderStatusItem(
            provider=tts_target,
            configured=tts_configured,
            available=tts_available,
            details=tts_details,
        ),
    )


@router.post(
    "/sessions/{session_id}/reset",
    response_model=SessionResetResponse,
    summary="Reset conversation context for an active session",
)
async def reset_session(session_id: str) -> SessionResetResponse:
    """Clear conversation history for the given session ID."""
    success = session_store.reset_session(session_id)
    if not success:
        # Create session fresh if it didn't exist
        session_store.get_or_create_session(session_id)

    return SessionResetResponse(
        session_id=session_id,
        reset=True,
        message="Conversation session context has been reset successfully.",
    )

