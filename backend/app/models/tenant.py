"""Tenant (Hospital / Clinic) Data Model.

Represents an isolated healthcare organization using the platform.
"""

from typing import TYPE_CHECKING, Any, Dict, List, Optional
from sqlalchemy import Boolean, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.operating_hours import HospitalOperatingHours
    from app.models.doctor import Doctor


class Tenant(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Hospital / Clinic tenant entity enforcing strict multi-tenant isolation."""

    __tablename__ = "tenants"

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Hospital Contact & Location Profiles (Optional in initial registration)
    phone_number: Mapped[Optional[str]] = mapped_column(
        String(32),
        nullable=True,
        comment="Main reception / inquiry phone number",
    )
    emergency_contact: Mapped[Optional[str]] = mapped_column(
        String(32),
        nullable=True,
        comment="24/7 Emergency ambulance or hotline number",
    )
    address: Mapped[Dict[str, Any]] = mapped_column(
        JSONB,
        default=dict,
        nullable=False,
        server_default="{}",
        comment="Physical address: street, city, state, postal_code, country",
    )
    timezone: Mapped[str] = mapped_column(
        String(64),
        default="Asia/Kolkata",
        nullable=False,
        server_default="Asia/Kolkata",
        comment="Primary operating timezone for appointment scheduling",
    )

    # Guided Onboarding Workflow Progression
    onboarding_status: Mapped[str] = mapped_column(
        String(32),
        default="IN_PROGRESS",
        nullable=False,
        server_default="IN_PROGRESS",
        comment="IN_PROGRESS or COMPLETED",
    )
    onboarding_step: Mapped[int] = mapped_column(
        Integer,
        default=1,
        nullable=False,
        server_default="1",
        comment="Current onboarding wizard step (1: Register, 2: Profile, 3: Doctors, 4: Done)",
    )

    # Tenant-level settings (preferred language, AI voice settings, telephony credentials)
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
    operating_hours: Mapped[List["HospitalOperatingHours"]] = relationship(
        "HospitalOperatingHours",
        back_populates="tenant",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="HospitalOperatingHours.day_of_week",
    )
    doctors: Mapped[List["Doctor"]] = relationship(
        "Doctor",
        back_populates="tenant",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="Doctor.created_at",
    )

    def __repr__(self) -> str:
        return f"<Tenant id={self.id} name='{self.name}' slug='{self.slug}'>"


