"""Call Analytics and Business Intelligence Data Models.

Stores call session records, granular LLM evaluation analyses,
and structured entity requests for fast aggregation and performance tracking.
"""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any, Dict, List, Optional

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.tenant import Tenant


class CallSession(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Voice, telephony, or chat call session record."""

    __tablename__ = "call_sessions"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    session_id: Mapped[str] = mapped_column(
        String(128),
        unique=True,
        index=True,
        nullable=False,
        comment="Unique session ID across voice playground or telephony providers",
    )
    caller_phone: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True,
        index=True,
    )
    dialed_number: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True,
    )
    channel: Mapped[str] = mapped_column(
        String(32),
        default="voice_playground",
        nullable=False,
        comment="Channel source: voice_playground, telephony, gsm_gateway, etc.",
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    ended_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    duration_seconds: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        String(32),
        default="completed",
        nullable=False,
        comment="Call lifecycle: in_progress, completed, escalated, dropped",
    )
    analysis_status: Mapped[str] = mapped_column(
        String(32),
        default="pending",
        nullable=False,
        index=True,
        comment="Intelligence processing: pending, completed, failed",
    )
    transcript: Mapped[str] = mapped_column(
        Text,
        default="",
        nullable=False,
        comment="Full speaker-labeled dialogue transcript",
    )
    call_metadata: Mapped[Dict[str, Any]] = mapped_column(
        JSONB,
        default=dict,
        nullable=False,
        server_default="{}",
    )

    # Relationships
    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="call_sessions")
    analysis: Mapped[Optional["CallAnalysis"]] = relationship(
        "CallAnalysis",
        back_populates="call_session",
        uselist=False,
        cascade="all, delete-orphan",
    )
    requests: Mapped[List["CallRequest"]] = relationship(
        "CallRequest",
        back_populates="call_session",
        cascade="all, delete-orphan",
    )


class CallAnalysis(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Deep-dive LLM intelligence and evaluation analysis for a single call session."""

    __tablename__ = "call_analyses"

    call_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("call_sessions.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
        index=True,
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    summary: Mapped[str] = mapped_column(
        Text,
        default="",
        nullable=False,
        comment="Executive summary of the conversation",
    )
    primary_intent: Mapped[str] = mapped_column(
        String(64),
        default="general_inquiry",
        nullable=False,
        index=True,
    )
    secondary_intents: Mapped[List[str]] = mapped_column(
        JSONB,
        default=list,
        nullable=False,
        server_default="[]",
    )
    sentiment: Mapped[str] = mapped_column(
        String(32),
        default="neutral",
        nullable=False,
        index=True,
        comment="positive, neutral, negative, frustrated",
    )
    resolution_status: Mapped[str] = mapped_column(
        String(32),
        default="resolved",
        nullable=False,
        index=True,
        comment="resolved, partially_resolved, unresolved, escalated",
    )
    agent_score: Mapped[float] = mapped_column(
        Float,
        default=8.0,
        nullable=False,
        comment="Overall agent quality score (1.0 to 10.0)",
    )
    scores: Mapped[Dict[str, float]] = mapped_column(
        JSONB,
        default=dict,
        nullable=False,
        server_default="{}",
        comment="Granular scores: correctness, intent_understanding, communication, tool_usage, policy_compliance, overall",
    )
    customer_satisfaction: Mapped[float] = mapped_column(
        Float,
        default=8.0,
        nullable=False,
        comment="Estimated customer satisfaction (1.0 to 10.0)",
    )
    language: Mapped[str] = mapped_column(
        String(32),
        default="English",
        nullable=False,
        index=True,
        comment="Dominant language: English, Hindi, Gujarati",
    )
    escalation_required: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )
    issues: Mapped[List[Dict[str, Any]]] = mapped_column(
        JSONB,
        default=list,
        nullable=False,
        server_default="[]",
        comment="Detected agent mistakes or friction points: category, severity, description, evidence, recommendation",
    )
    improvements: Mapped[List[str]] = mapped_column(
        JSONB,
        default=list,
        nullable=False,
        server_default="[]",
        comment="Specific recommendations for prompt or tool improvements",
    )
    raw_analysis: Mapped[Dict[str, Any]] = mapped_column(
        JSONB,
        default=dict,
        nullable=False,
        server_default="{}",
    )
    analyzed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    call_session: Mapped["CallSession"] = relationship("CallSession", back_populates="analysis")
    tenant: Mapped["Tenant"] = relationship("Tenant")


class CallRequest(Base, UUIDPrimaryKeyMixin):
    """Normalized granular demand request extracted from a call session.

    Enables high-performance SQL analytics across thousands of calls without re-running LLM inference.
    """

    __tablename__ = "call_requests"

    call_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("call_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    request_type: Mapped[str] = mapped_column(
        String(64),
        default="appointment_booking",
        nullable=False,
        index=True,
        comment="e.g. appointment_booking, doctor_availability, timing_inquiry, fee_inquiry, general_info",
    )
    requested_doctor_name: Mapped[Optional[str]] = mapped_column(
        String(128),
        nullable=True,
        index=True,
    )
    requested_department: Mapped[Optional[str]] = mapped_column(
        String(128),
        nullable=True,
        index=True,
    )
    requested_date: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True,
    )
    requested_time_slot: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True,
        index=True,
        comment="e.g. 10:00 AM, Morning, 16:00, etc.",
    )
    fulfilled: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        index=True,
        comment="Whether the request was successfully fulfilled",
    )
    failure_reason: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        index=True,
        comment="e.g. slot_unavailable, doctor_not_found, out_of_hours, cancelled_by_user",
    )
    booking_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("appointments.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    call_session: Mapped["CallSession"] = relationship("CallSession", back_populates="requests")
    tenant: Mapped["Tenant"] = relationship("Tenant")
