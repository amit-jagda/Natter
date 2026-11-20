"""Hospital Operating Hours Data Model.

Defines the weekly recurring operating schedule for a hospital/clinic.
"""

import uuid
from datetime import time
from typing import TYPE_CHECKING, Optional
from sqlalchemy import Boolean, ForeignKey, Integer, Time, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.tenant import Tenant


class HospitalOperatingHours(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Weekly opening and closing hours for a specific hospital tenant."""

    __tablename__ = "hospital_operating_hours"
    __table_args__ = (
        UniqueConstraint("tenant_id", "day_of_week", name="uq_hospital_hours_day"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    day_of_week: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="0=Monday, 1=Tuesday, 2=Wednesday, 3=Thursday, 4=Friday, 5=Saturday, 6=Sunday",
    )
    open_time: Mapped[Optional[time]] = mapped_column(Time, nullable=True)
    close_time: Mapped[Optional[time]] = mapped_column(Time, nullable=True)
    is_closed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Relationships
    tenant: Mapped["Tenant"] = relationship(
        "Tenant",
        back_populates="operating_hours",
        lazy="select",
    )

    def __repr__(self) -> str:
        status = "Closed" if self.is_closed else f"{self.open_time}-{self.close_time}"
        return f"<HospitalOperatingHours tenant_id={self.tenant_id} day={self.day_of_week} hours='{status}'>"
