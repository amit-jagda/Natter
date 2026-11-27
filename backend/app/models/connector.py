"""Hospital External Connector Data Model.

Stores configuration and integration credentials for external systems:
- Google Calendar (Doctor appointment scheduling & slot blocking)
- Google Sheets (Receptionist booking records & live spreadsheet ledger)
- Radicale (Self-hosted CalDAV calendar integration)
"""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any, Dict, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.tenant import Tenant


class HospitalConnector(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """External service connector configuration for a hospital tenant."""

    __tablename__ = "connectors"
    __table_args__ = (
        UniqueConstraint("tenant_id", "connector_type", name="uq_tenant_connector_type"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    connector_type: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        index=True,
        comment="Type of connector: 'google_calendar', 'google_sheets', 'radicale'",
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        server_default="false",
        comment="Whether the connector is actively enabled for auto-sync",
    )
    config: Mapped[Dict[str, Any]] = mapped_column(
        JSONB,
        default=dict,
        nullable=False,
        server_default="{}",
        comment="Connector settings (calendar_id, spreadsheet_id, sheet_name, server_url, etc.)",
    )
    credentials: Mapped[Dict[str, Any]] = mapped_column(
        JSONB,
        default=dict,
        nullable=False,
        server_default="{}",
        comment="Encrypted credentials, API keys, service account emails, tokens, or webhooks",
    )
    last_sync_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="Timestamp of the most recent sync operation",
    )
    sync_status: Mapped[str] = mapped_column(
        String(32),
        default="idle",
        nullable=False,
        server_default="'idle'",
        comment="'idle', 'syncing', 'synced', 'failed'",
    )
    synced_count: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
        server_default="0",
        comment="Total number of items/rows synced to external system",
    )
    sync_error: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="Last error message if sync failed",
    )

    # Relationships
    tenant: Mapped["Tenant"] = relationship(
        "Tenant",
        back_populates="connectors",
        lazy="select",
    )

    def __repr__(self) -> str:
        return f"<HospitalConnector id={self.id} tenant_id={self.tenant_id} type='{self.connector_type}' active={self.is_active}>"
