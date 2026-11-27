"""Call Session Logging Service.

Ensures every voice turn, playground interaction, or telephony conversation
is captured in the PostgreSQL `call_sessions` table with analysis_status='pending'.
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from app.models.analytics import CallSession
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


async def record_or_update_session(
    db: AsyncSession,
    session_id: str,
    tenant_id: str,
    transcript: str,
    caller_phone: Optional[str] = None,
    dialed_number: Optional[str] = None,
    channel: str = "voice_playground",
    status: str = "completed",
    duration_seconds: Optional[int] = None,
    call_metadata: Optional[Dict[str, Any]] = None,
) -> CallSession:
    """Insert or update a CallSession record for analytics tracking."""
    if not db or not hasattr(db, "add") or not hasattr(db, "execute"):
        return None

    try:
        tenant_uuid = uuid.UUID(tenant_id) if isinstance(tenant_id, str) else tenant_id
    except Exception:
        logger.error(f"Invalid tenant_id format: {tenant_id}")
        return None  # type: ignore

    clean_sid = (session_id or "").strip()
    if not clean_sid:
        clean_sid = f"sess_{uuid.uuid4().hex[:12]}"

    # Check for existing record
    stmt = select(CallSession).where(CallSession.session_id == clean_sid)
    res = await db.execute(stmt)
    existing_session = res.scalar_one_or_none()

    now = datetime.now(timezone.utc)

    if existing_session:
        # Update existing record
        if transcript and transcript.strip():
            existing_session.transcript = transcript.strip()
        if caller_phone:
            existing_session.caller_phone = caller_phone
        if dialed_number:
            existing_session.dialed_number = dialed_number
        if duration_seconds is not None and duration_seconds > 0:
            existing_session.duration_seconds = max(existing_session.duration_seconds, duration_seconds)
        else:
            # Approximate duration from start time
            diff = int((now - existing_session.started_at).total_seconds())
            if diff > 0:
                existing_session.duration_seconds = max(existing_session.duration_seconds, diff)
        existing_session.status = status
        existing_session.ended_at = now
        if call_metadata:
            meta = dict(existing_session.call_metadata or {})
            meta.update(call_metadata)
            existing_session.call_metadata = meta
        await db.commit()
        await db.refresh(existing_session)
        return existing_session
    else:
        # Create new record
        new_session = CallSession(
            id=uuid.uuid4(),
            tenant_id=tenant_uuid,
            session_id=clean_sid,
            caller_phone=caller_phone,
            dialed_number=dialed_number,
            channel=channel,
            started_at=now,
            ended_at=now,
            duration_seconds=duration_seconds or 15,
            status=status,
            analysis_status="pending",
            transcript=transcript.strip() if transcript else "",
            call_metadata=call_metadata or {},
        )
        db.add(new_session)
        await db.commit()
        await db.refresh(new_session)
        return new_session
