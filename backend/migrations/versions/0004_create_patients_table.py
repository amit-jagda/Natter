"""Create patients table for patient records and excel imports.

Revision ID: 0004_create_patients_table
Revises: 0003_drop_phone_and_step
Create Date: 2026-11-23 12:50:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0004_create_patients_table"
down_revision: Union[str, None] = "0003_drop_phone_and_step"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "patients",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("phone", sa.String(length=32), nullable=False, comment="Patient mobile number (required)"),
        sa.Column("email", sa.String(length=255), nullable=True, comment="Patient email address (optional)"),
        sa.Column("date", sa.String(length=32), nullable=False, comment="Patient date (YYYY-MM-DD)"),
        sa.Column("gender", sa.String(length=32), nullable=True),
        sa.Column("notes", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_patients_id", "patients", ["id"], unique=False)
    op.create_index("ix_patients_tenant_id", "patients", ["tenant_id"], unique=False)
    op.create_index("ix_patients_name", "patients", ["name"], unique=False)
    op.create_index("ix_patients_phone", "patients", ["phone"], unique=False)
    op.create_index("ix_patients_email", "patients", ["email"], unique=False)
    op.create_index("ix_patients_date", "patients", ["date"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_patients_date", table_name="patients")
    op.drop_index("ix_patients_email", table_name="patients")
    op.drop_index("ix_patients_phone", table_name="patients")
    op.drop_index("ix_patients_name", table_name="patients")
    op.drop_index("ix_patients_tenant_id", table_name="patients")
    op.drop_index("ix_patients_id", table_name="patients")
    op.drop_table("patients")
