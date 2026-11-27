"""Doctor Leave & Scheduled Absence Data Model.

Defines planned doctor absences and unavailability exceptions.
Factored dynamically into real-time slot generation to prevent booking closed days.
"""

import uuid
from datetime import date, time
from typing import TYPE_CHECKING, Optional

from app.database.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from sqlalchemy import Boolean, Date, ForeignKey, String, Time
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

if TYPE_CHECKING:
    from app.models.doctor import Doctor
    from app.models.tenant import Tenant


class DoctorLeave(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Specific date or partial-day scheduled absence for a doctor."""

    __tablename__ = "doctor_leaves"

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
    leave_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    is_full_day: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    start_time: Mapped[Optional[time]] = mapped_column(Time, nullable=True)
    end_time: Mapped[Optional[time]] = mapped_column(Time, nullable=True)
    reason: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Relationships
    tenant: Mapped["Tenant"] = relationship("Tenant", lazy="select")
    doctor: Mapped["Doctor"] = relationship("Doctor", lazy="select")

    def __repr__(self) -> str:
        return (
            f"<DoctorLeave doctor_id={self.doctor_id} date={self.leave_date} "
            f"full_day={self.is_full_day} reason='{self.reason}'>"
        )
