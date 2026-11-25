"""Voice API Endpoints.

Handles turn-based voice uploads, provider status queries, and conversation session resets.
Provides latency profiling and robust error handling.
"""

import json
import logging
import re
from typing import Optional
import uuid

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.llm.factory import get_llm_gateway
from app.adapters.stt.factory import get_stt_provider
from app.adapters.tts.factory import get_tts_provider
from app.api.deps import bearer_scheme
from app.core.config import settings
from app.core.exceptions import BadRequestException
from app.core.security import decode_access_token
from app.database.session import get_db
from app.models.tenant import Tenant
from app.schemas.voice import (
    ChatTurnRequest,
    ChatTurnResponse,
    ProviderStatusItem,
    SessionResetResponse,
    VoiceProvidersStatusResponse,
    VoiceTurnResponse,
    VoiceTurnTimingsSchema,
)
from app.services.conversation.orchestrator import conversation_orchestrator
from app.services.conversation.session_store import conversation_session_store
from app.services.session_store import session_store
from app.services.tools.healthcare_tools import healthcare_tool_registry
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
    db: AsyncSession = Depends(get_db),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> VoiceTurnResponse:
    """Accept an audio recording, transcribe with STT, generate response with LLM + Healthcare Tools,
    and synthesize speech with TTS.
    """
    if not audio:
        raise BadRequestException("Audio file is required.")

    # Read audio content into memory
    audio_bytes = await audio.read()
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise BadRequestException(f"Audio file exceeds maximum size of {MAX_AUDIO_BYTES // (1024*1024)}MB.")

    content_type = audio.content_type or "audio/wav"

    # Resolve tenant_id from authenticated JWT or default active hospital tenant for playground
    resolved_tenant_id: Optional[str] = None
    if credentials and credentials.credentials:
        try:
            payload = decode_access_token(credentials.credentials)
            resolved_tenant_id = payload.get("tenant_id")
        except Exception:
            pass

    if not resolved_tenant_id:
        t_res = await db.execute(select(Tenant).where(Tenant.is_active.is_(True)).limit(1))
        active_tenant = t_res.scalar_one_or_none()
        if active_tenant:
            resolved_tenant_id = str(active_tenant.id)

    result = await voice_orchestrator.execute_turn(
        audio_bytes=audio_bytes,
        content_type=content_type,
        session_id=session_id,
        language=language,
        tenant_id=resolved_tenant_id,
        db=db,
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


@router.post(
    "/turn/stream",
    status_code=status.HTTP_200_OK,
    summary="Stream a conversational voice turn as sentence-level SSE audio chunks",
)
async def process_voice_turn_stream(
    audio: UploadFile = File(..., description="Audio recording file from frontend"),
    session_id: Optional[str] = Form(None, description="Active session ID or empty to generate new"),
    language: Optional[str] = Form("en", description="Spoken language hint ('en', 'hi')"),
    prefix_transcript: Optional[str] = Form(None, description="Optional carried-over transcript from interrupted clause"),
    db: AsyncSession = Depends(get_db),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> StreamingResponse:
    """Stream STT transcript, sentence-level text chunks, and Piper TTS audio chunks via SSE."""
    if not audio:
        raise BadRequestException("Audio file is required.")

    audio_bytes = await audio.read()
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise BadRequestException(f"Audio file exceeds maximum size of {MAX_AUDIO_BYTES // (1024*1024)}MB.")

    content_type = audio.content_type or "audio/wav"

    resolved_tenant_id: Optional[str] = None
    if credentials and credentials.credentials:
        try:
            payload = decode_access_token(credentials.credentials)
            resolved_tenant_id = payload.get("tenant_id")
        except Exception:
            pass

    if not resolved_tenant_id:
        t_res = await db.execute(select(Tenant).where(Tenant.is_active.is_(True)).limit(1))
        active_tenant = t_res.scalar_one_or_none()
        if active_tenant:
            resolved_tenant_id = str(active_tenant.id)

    async def event_generator():
        try:
            async for event in voice_orchestrator.execute_turn_stream(
                audio_bytes=audio_bytes,
                content_type=content_type,
                session_id=session_id,
                language=language,
                prefix_transcript=prefix_transcript,
                tenant_id=resolved_tenant_id,
                db=db,
            ):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as exc:
            logger.error("Voice stream error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'error': str(exc)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post(
    "/chat-turn",
    response_model=ChatTurnResponse,
    status_code=status.HTTP_200_OK,
    summary="Execute a conversational turn for live telephony / external calling systems",
)
async def process_chat_turn(
    payload: ChatTurnRequest,
    db: AsyncSession = Depends(get_db),
    x_service_api_key: Optional[str] = Header(None, alias="X-Service-API-Key"),
) -> ChatTurnResponse:
    """Provider-independent conversational turn endpoint for telephony integration.

    1. Enforces service-to-service authentication when configured.
    2. Authoritatively resolves tenant_id from dialed hospital DID or authenticated caller.
    3. Executes the multi-turn conversational intelligence engine with registered healthcare tools.
    4. Returns sanitized spoken response text with explicit external action signals.
    """
    # 1. Service-to-service auth check (if API key is configured or in production)
    expected_key = getattr(settings, "SERVICE_API_KEY", None)
    if expected_key and x_service_api_key != expected_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized calling service. Invalid or missing X-Service-API-Key.",
        )

    # 2. Authoritative Tenant Resolution
    resolved_tenant_id: Optional[str] = None

    if payload.dialed_number:
        clean_did = re.sub(r"\D", "", payload.dialed_number)
        if clean_did:
            did_query = (
                select(Tenant)
                .where(
                    (Tenant.phone_number == clean_did)
                    | (Tenant.phone_number.endswith(clean_did[-10:]))
                    | (Tenant.emergency_contact == clean_did)
                )
                .where(Tenant.is_active.is_(True))
            )
            res = await db.execute(did_query)
            matched_tenant = res.scalar_one_or_none()
            if matched_tenant:
                resolved_tenant_id = str(matched_tenant.id)

    # Fallback to direct tenant_id if provided by authenticated caller
    if not resolved_tenant_id and payload.tenant_id:
        try:
            tid_uuid = uuid.UUID(payload.tenant_id.strip())
            t_query = select(Tenant).where(Tenant.id == tid_uuid, Tenant.is_active.is_(True))
            t_res = await db.execute(t_query)
            t_obj = t_res.scalar_one_or_none()
            if t_obj:
                resolved_tenant_id = str(t_obj.id)
        except (ValueError, AttributeError):
            pass

    if not resolved_tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to resolve active hospital tenant. Please provide a valid dialed_number (DID) or tenant_id.",
        )

    # 3. Execute conversational turn
    turn_result = await conversation_orchestrator.execute_turn(
        transcript=payload.transcript,
        session_id=payload.session_id,
        tenant_id=resolved_tenant_id,
        caller_number=payload.caller_phone,
        language=payload.language or "en",
        tool_registry=healthcare_tool_registry,
        db=db,
    )

    return ChatTurnResponse(
        session_id=turn_result.session_id,
        response_text=turn_result.response_text,
        conversation_status=turn_result.conversation_status,
        action_signal=turn_result.action_signal,
        action_payload=turn_result.action_payload,
        current_stage=turn_result.current_stage,
        verified_patient_id=turn_result.verified_patient_id,
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

    await conversation_session_store.reset_session_async(session_id)

    return SessionResetResponse(
        session_id=session_id,
        reset=True,
        message="Conversation session context has been reset successfully.",
    )

