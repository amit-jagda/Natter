"""Tenant Data Model.

Represents an isolated business organization using the platform.
"""

from typing import TYPE_CHECKING, Any, Dict, List
from sqlalchemy import Boolean, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.user import User


class Tenant(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Business tenant entity enforcing data isolation across organizations."""

    __tablename__ = "tenants"

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Tenant-level settings (default timezone, preferred language, telephony configs)
    settings: Mapped[Dict[str, Any]] = mapped_column(
        JSONB,
        default=dict,
        nullable=False,
        server_default="{}",
    )

    # Relationships
    users: Mapped[List["User"]] = relationship(
        "User",
        back_populates="tenant",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return f"<Tenant id={self.id} name='{self.name}' slug='{self.slug}'>"

