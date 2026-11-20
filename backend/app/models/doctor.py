"""Doctor and Availability Data Models.

Defines medical doctor resources and their weekly recurring availability schedules.
Doctor details (name, email) are normalized and linked to the User account.
"""

import uuid
from datetime import time
from typing import TYPE_CHECKING, List, Optional
from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String, Time, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.tenant import Tenant
    from app.models.user import User


class Doctor(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Doctor resource belonging to a hospital tenant, linked 1-to-1 with a User."""

    __tablename__ = "doctors"
    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", name="uq_tenant_doctor_user"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    specialization: Mapped[str] = mapped_column(
        String(120),
        nullable=False,
        index=True,
        comment="Medical specialty, e.g. Cardiology, Pediatrics, General Medicine",
    )
    department: Mapped[Optional[str]] = mapped_column(
        String(120),
        nullable=True,
        comment="Optional department or clinic room, e.g. OPD Block B",
    )
    slot_duration_minutes: Mapped[int] = mapped_column(
        Integer,
        default=30,
        nullable=False,
        comment="Consultation slot length in minutes",
    )
    consultation_fee: Mapped[Optional[float]] = mapped_column(
        Numeric(10, 2),
        nullable=True,
        comment="Standard consultation fee",
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Relationships
    tenant: Mapped["Tenant"] = relationship(
        "Tenant",
        back_populates="doctors",
        lazy="select",
    )
    user: Mapped["User"] = relationship(
        "User",
        lazy="joined",
    )
    availabilities: Mapped[List["DoctorAvailability"]] = relationship(
        "DoctorAvailability",
        back_populates="doctor",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="DoctorAvailability.day_of_week, DoctorAvailability.start_time",
    )

    def __repr__(self) -> str:
        return f"<Doctor id={self.id} user_id={self.user_id} spec='{self.specialization}'>"


class DoctorAvailability(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Weekly recurring shift availability for a doctor."""

    __tablename__ = "doctor_availabilities"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    doctor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("doctors.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    day_of_week: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="0=Monday, 1=Tuesday, 2=Wednesday, 3=Thursday, 4=Friday, 5=Saturday, 6=Sunday",
    )
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    is_available: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Relationships
    doctor: Mapped["Doctor"] = relationship(
        "Doctor",
        back_populates="availabilities",
        lazy="select",
    )

    def __repr__(self) -> str:
        return (
            f"<DoctorAvailability doctor_id={self.doctor_id} day={self.day_of_week} "
            f"{self.start_time}-{self.end_time}>"
        )
