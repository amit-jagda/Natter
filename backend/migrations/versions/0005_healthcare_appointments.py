"""Create appointments and doctor_leaves tables with exclusion constraints.

Revision ID: 0005_healthcare_appointments_and_availability
Revises: 0004_create_patients_table
Create Date: 2026-11-24 18:40:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0005_healthcare_appointments"
down_revision: Union[str, None] = "0004_create_patients_table"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Enable btree_gist extension for PostgreSQL exclusion constraints with UUIDs
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist;")

    # 2. Create doctor_leaves table
    op.create_table(
        "doctor_leaves",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "doctor_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("doctors.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("leave_date", sa.Date(), nullable=False),
        sa.Column("is_full_day", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=True),
        sa.Column("end_time", sa.Time(), nullable=True),
        sa.Column("reason", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(op.f("ix_doctor_leaves_id"), "doctor_leaves", ["id"], unique=False)
    op.create_index(op.f("ix_doctor_leaves_tenant_id"), "doctor_leaves", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_doctor_leaves_doctor_id"), "doctor_leaves", ["doctor_id"], unique=False)
    op.create_index(op.f("ix_doctor_leaves_leave_date"), "doctor_leaves", ["leave_date"], unique=False)

    # 3. Create appointments table
    op.create_table(
        "appointments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "doctor_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("doctors.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "patient_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("patients.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("appointment_date", sa.Date(), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
        sa.Column("appointment_range", postgresql.TSTZRANGE(), nullable=False),
        sa.Column("status", sa.String(length=32), server_default=sa.text("'confirmed'"), nullable=False),
        sa.Column("idempotency_key", sa.String(length=64), nullable=True),
        sa.Column("source", sa.String(length=32), server_default=sa.text("'voice_agent'"), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(op.f("ix_appointments_id"), "appointments", ["id"], unique=False)
    op.create_index(op.f("ix_appointments_tenant_id"), "appointments", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_appointments_doctor_id"), "appointments", ["doctor_id"], unique=False)
    op.create_index(op.f("ix_appointments_patient_id"), "appointments", ["patient_id"], unique=False)
    op.create_index(op.f("ix_appointments_appointment_date"), "appointments", ["appointment_date"], unique=False)
    op.create_index(op.f("ix_appointments_status"), "appointments", ["status"], unique=False)
    op.create_index(op.f("ix_appointments_idempotency_key"), "appointments", ["idempotency_key"], unique=True)

    # 4. Add GiST Exclusion Constraint on appointments to prevent overlapping doctor bookings
    op.execute(
        """
        ALTER TABLE appointments
        ADD CONSTRAINT no_overlapping_doctor_appointments
        EXCLUDE USING gist (
            tenant_id WITH =,
            doctor_id WITH =,
            appointment_range WITH &&
        ) WHERE (status IN ('confirmed', 'pending'));
        """
    )


def downgrade() -> None:
    op.drop_table("appointments")
    op.drop_table("doctor_leaves")
