"""Patient Data Model.

Represents a patient associated with a specific tenant hospital.
Stores personal details, registration/appointment date, and clinical notes.
"""

import uuid
from typing import TYPE_CHECKING, Optional

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.tenant import Tenant


class Patient(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Patient record belonging to a specific tenant hospital."""

    __tablename__ = "patients"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    phone: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        index=True,
        comment="Patient contact mobile number (digits only, required)",
    )
    email: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        index=True,
        comment="Patient email address (optional)",
    )
    date: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        index=True,
        comment="Patient appointment or registration date (YYYY-MM-DD)",
    )
    gender: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # Relationships
    tenant: Mapped["Tenant"] = relationship(
        "Tenant",
        back_populates="patients",
        lazy="select",
    )

    def __repr__(self) -> str:
        return f"<Patient id={self.id} name='{self.name}' phone='{self.phone}' date='{self.date}'>"
