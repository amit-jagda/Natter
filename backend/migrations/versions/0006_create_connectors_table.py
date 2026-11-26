"""Create connectors table for external integrations.

Revision ID: 0006_create_connectors_table
Revises: 0005_healthcare_appointments
Create Date: 2026-11-25 17:50:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0006_create_connectors_table"
down_revision: Union[str, None] = "0005_healthcare_appointments"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "connectors",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("connector_type", sa.String(length=32), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("config", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("credentials", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sync_status", sa.String(length=32), server_default=sa.text("'idle'"), nullable=False),
        sa.Column("synced_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("sync_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "connector_type", name="uq_tenant_connector_type"),
    )
    op.create_index(op.f("ix_connectors_id"), "connectors", ["id"], unique=False)
    op.create_index(op.f("ix_connectors_tenant_id"), "connectors", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_connectors_connector_type"), "connectors", ["connector_type"], unique=False)


def downgrade() -> None:
    op.drop_table("connectors")
