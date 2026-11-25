"""Appointment Data Model.

Defines healthcare appointments booked by patients with doctors,
protected by interval-based overlap prevention and idempotency.
"""

from datetime import date, time
from typing import TYPE_CHECKING, Any, Optional
import uuid

from sqlalchemy import Date, ForeignKey, Index, String, Text, Time
from sqlalchemy.dialects.postgresql import TSTZRANGE, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.doctor import Doctor
    from app.models.patient import Patient
    from app.models.tenant import Tenant


class Appointment(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Healthcare appointment booked between a patient and a doctor."""

    __tablename__ = "appointments"

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
    patient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patients.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    appointment_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)

    # Interval range for exclusion-based overlap prevention
    appointment_range: Mapped[Any] = mapped_column(TSTZRANGE, nullable=False)

    status: Mapped[str] = mapped_column(
        String(32),
        default="confirmed",
        nullable=False,
        index=True,
        comment="'confirmed', 'pending', 'cancelled', 'completed'",
    )
    idempotency_key: Mapped[Optional[str]] = mapped_column(
        String(64),
        unique=True,
        nullable=True,
        index=True,
        comment="Unique client/session idempotency key to prevent double bookings on retry",
    )
    source: Mapped[str] = mapped_column(
        String(32),
        default="voice_agent",
        nullable=False,
        comment="Origin of booking e.g. voice_agent, dashboard",
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    tenant: Mapped["Tenant"] = relationship("Tenant", lazy="select")
    doctor: Mapped["Doctor"] = relationship("Doctor", lazy="joined")
    patient: Mapped["Patient"] = relationship("Patient", lazy="joined")

    def __repr__(self) -> str:
        return (
            f"<Appointment id={self.id} doctor_id={self.doctor_id} "
            f"date={self.appointment_date} {self.start_time}-{self.end_time} status='{self.status}'>"
        )
