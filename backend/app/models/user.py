"""User Data Model.

Represents an individual user associated with a specific tenant.
"""

import uuid
from typing import TYPE_CHECKING, Optional
from sqlalchemy import Boolean, Enum as SQLEnum, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import TenantRole, UserStatus

if TYPE_CHECKING:
    from app.models.tenant import Tenant
    from app.models.doctor import Doctor


class User(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """User account belonging to a specific tenant."""

    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("tenant_id", "email", name="uq_users_tenant_email"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)

    role: Mapped[TenantRole] = mapped_column(
        SQLEnum(TenantRole, name="tenant_role_enum", native_enum=False),
        default=TenantRole.OPERATOR,
        nullable=False,
    )
    status: Mapped[UserStatus] = mapped_column(
        SQLEnum(UserStatus, name="user_status_enum", native_enum=False),
        default=UserStatus.ACTIVE,
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Relationships
    tenant: Mapped["Tenant"] = relationship(
        "Tenant",
        back_populates="users",
        lazy="select",
    )
    doctor_profile: Mapped[Optional["Doctor"]] = relationship(
        "Doctor",
        back_populates="user",
        uselist=False,
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return f"<User id={self.id} email='{self.email}' tenant_id={self.tenant_id} role={self.role}>"

