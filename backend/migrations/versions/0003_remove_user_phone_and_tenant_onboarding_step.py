"""Remove phone_number from users and onboarding_step from tenants.

Revision ID: 0003_remove_user_phone_and_tenant_step
Revises: 0002_hospital_and_doctors
Create Date: 2026-11-20 10:30:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0003_drop_phone_and_step"
down_revision: Union[str, None] = "0002_hospital_and_doctors"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Drop phone_number from users
    op.drop_column("users", "phone_number")

    # 2. Drop onboarding_step from tenants
    op.drop_column("tenants", "onboarding_step")


def downgrade() -> None:
    # 1. Re-add onboarding_step to tenants
    op.add_column(
        "tenants",
        sa.Column("onboarding_step", sa.Integer(), server_default=sa.text("1"), nullable=False),
    )

    # 2. Re-add phone_number to users
    op.add_column(
        "users",
        sa.Column("phone_number", sa.String(length=32), nullable=True),
    )
