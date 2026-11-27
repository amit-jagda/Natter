"""Hospital onboarding fields, operating hours, doctors and availabilities.

Revision ID: 0002_hospital_and_doctors
Revises: 0001_initial_tenants_and_users
Create Date: 2026-11-19 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0002_hospital_and_doctors"
down_revision: Union[str, None] = "0001_initial_tenants_and_users"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add hospital onboarding columns to tenants
    op.add_column("tenants", sa.Column("phone_number", sa.String(length=32), nullable=True))
    op.add_column("tenants", sa.Column("emergency_contact", sa.String(length=32), nullable=True))
    op.add_column(
        "tenants",
        sa.Column("address", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
    )
    op.add_column(
        "tenants",
        sa.Column("timezone", sa.String(length=64), server_default=sa.text("'Asia/Kolkata'"), nullable=False),
    )
    op.add_column(
        "tenants",
        sa.Column("onboarding_status", sa.String(length=32), server_default=sa.text("'IN_PROGRESS'"), nullable=False),
    )
    op.add_column(
        "tenants",
        sa.Column("onboarding_step", sa.Integer(), server_default=sa.text("1"), nullable=False),
    )

    # 2. Add phone_number to users
    op.add_column("users", sa.Column("phone_number", sa.String(length=32), nullable=True))

    # 3. Create hospital_operating_hours table
    op.create_table(
        "hospital_operating_hours",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("day_of_week", sa.Integer(), nullable=False),
        sa.Column("open_time", sa.Time(), nullable=True),
        sa.Column("close_time", sa.Time(), nullable=True),
        sa.Column("is_closed", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "day_of_week", name="uq_hospital_hours_day"),
    )
    op.create_index(op.f("ix_hospital_operating_hours_id"), "hospital_operating_hours", ["id"], unique=False)
    op.create_index(op.f("ix_hospital_operating_hours_tenant_id"), "hospital_operating_hours", ["tenant_id"], unique=False)

    # 4. Create doctors table
    op.create_table(
        "doctors",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("specialization", sa.String(length=120), nullable=False),
        sa.Column("department", sa.String(length=120), nullable=True),
        sa.Column("slot_duration_minutes", sa.Integer(), server_default=sa.text("30"), nullable=False),
        sa.Column("consultation_fee", sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "user_id", name="uq_tenant_doctor_user"),
    )
    op.create_index(op.f("ix_doctors_id"), "doctors", ["id"], unique=False)
    op.create_index(op.f("ix_doctors_tenant_id"), "doctors", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_doctors_user_id"), "doctors", ["user_id"], unique=False)
    op.create_index(op.f("ix_doctors_specialization"), "doctors", ["specialization"], unique=False)

    # 5. Create doctor_availabilities table
    op.create_table(
        "doctor_availabilities",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("doctor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("doctors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("day_of_week", sa.Integer(), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
        sa.Column("is_available", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(op.f("ix_doctor_availabilities_id"), "doctor_availabilities", ["id"], unique=False)
    op.create_index(op.f("ix_doctor_availabilities_tenant_id"), "doctor_availabilities", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_doctor_availabilities_doctor_id"), "doctor_availabilities", ["doctor_id"], unique=False)


def downgrade() -> None:
    op.drop_table("doctor_availabilities")
    op.drop_table("doctors")
    op.drop_table("hospital_operating_hours")
    op.drop_column("users", "phone_number")
    op.drop_column("tenants", "onboarding_step")
    op.drop_column("tenants", "onboarding_status")
    op.drop_column("tenants", "timezone")
    op.drop_column("tenants", "address")
    op.drop_column("tenants", "emergency_contact")
    op.drop_column("tenants", "phone_number")
