"""Create call analytics tables for voice agent BI.

Revision ID: 0007_call_analytics_tables
Revises: 0006_create_connectors_table
Create Date: 2026-11-27 12:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0007_call_analytics_tables"
down_revision: Union[str, None] = "0006_create_connectors_table"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. call_sessions table
    op.create_table(
        "call_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("session_id", sa.String(length=128), nullable=False),
        sa.Column("caller_phone", sa.String(length=64), nullable=True),
        sa.Column("dialed_number", sa.String(length=64), nullable=True),
        sa.Column("channel", sa.String(length=32), server_default=sa.text("'voice_playground'"), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("status", sa.String(length=32), server_default=sa.text("'completed'"), nullable=False),
        sa.Column("analysis_status", sa.String(length=32), server_default=sa.text("'pending'"), nullable=False),
        sa.Column("transcript", sa.Text(), server_default=sa.text("''"), nullable=False),
        sa.Column("call_metadata", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(op.f("ix_call_sessions_id"), "call_sessions", ["id"], unique=False)
    op.create_index(op.f("ix_call_sessions_tenant_id"), "call_sessions", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_call_sessions_session_id"), "call_sessions", ["session_id"], unique=True)
    op.create_index(op.f("ix_call_sessions_caller_phone"), "call_sessions", ["caller_phone"], unique=False)
    op.create_index(op.f("ix_call_sessions_analysis_status"), "call_sessions", ["analysis_status"], unique=False)

    # 2. call_analyses table
    op.create_table(
        "call_analyses",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "call_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("call_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("summary", sa.Text(), server_default=sa.text("''"), nullable=False),
        sa.Column("primary_intent", sa.String(length=64), server_default=sa.text("'general_inquiry'"), nullable=False),
        sa.Column("secondary_intents", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column("sentiment", sa.String(length=32), server_default=sa.text("'neutral'"), nullable=False),
        sa.Column("resolution_status", sa.String(length=32), server_default=sa.text("'resolved'"), nullable=False),
        sa.Column("agent_score", sa.Float(), server_default=sa.text("8.0"), nullable=False),
        sa.Column("scores", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("customer_satisfaction", sa.Float(), server_default=sa.text("8.0"), nullable=False),
        sa.Column("language", sa.String(length=32), server_default=sa.text("'English'"), nullable=False),
        sa.Column("escalation_required", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("issues", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column("improvements", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column("raw_analysis", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("analyzed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(op.f("ix_call_analyses_id"), "call_analyses", ["id"], unique=False)
    op.create_index(op.f("ix_call_analyses_call_id"), "call_analyses", ["call_id"], unique=True)
    op.create_index(op.f("ix_call_analyses_tenant_id"), "call_analyses", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_call_analyses_primary_intent"), "call_analyses", ["primary_intent"], unique=False)
    op.create_index(op.f("ix_call_analyses_sentiment"), "call_analyses", ["sentiment"], unique=False)
    op.create_index(op.f("ix_call_analyses_resolution_status"), "call_analyses", ["resolution_status"], unique=False)
    op.create_index(op.f("ix_call_analyses_language"), "call_analyses", ["language"], unique=False)

    # 3. call_requests table
    op.create_table(
        "call_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "call_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("call_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("request_type", sa.String(length=64), server_default=sa.text("'appointment_booking'"), nullable=False),
        sa.Column("requested_doctor_name", sa.String(length=128), nullable=True),
        sa.Column("requested_department", sa.String(length=128), nullable=True),
        sa.Column("requested_date", sa.String(length=64), nullable=True),
        sa.Column("requested_time_slot", sa.String(length=64), nullable=True),
        sa.Column("fulfilled", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("failure_reason", sa.String(length=255), nullable=True),
        sa.Column(
            "booking_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("appointments.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(op.f("ix_call_requests_id"), "call_requests", ["id"], unique=False)
    op.create_index(op.f("ix_call_requests_call_id"), "call_requests", ["call_id"], unique=False)
    op.create_index(op.f("ix_call_requests_tenant_id"), "call_requests", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_call_requests_request_type"), "call_requests", ["request_type"], unique=False)
    op.create_index(op.f("ix_call_requests_requested_doctor_name"), "call_requests", ["requested_doctor_name"], unique=False)
    op.create_index(op.f("ix_call_requests_requested_department"), "call_requests", ["requested_department"], unique=False)
    op.create_index(op.f("ix_call_requests_requested_time_slot"), "call_requests", ["requested_time_slot"], unique=False)
    op.create_index(op.f("ix_call_requests_fulfilled"), "call_requests", ["fulfilled"], unique=False)
    op.create_index(op.f("ix_call_requests_failure_reason"), "call_requests", ["failure_reason"], unique=False)


def downgrade() -> None:
    op.drop_table("call_requests")
    op.drop_table("call_analyses")
    op.drop_table("call_sessions")
