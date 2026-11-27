"""Schemas for Hospital External Connectors."""

import uuid
from datetime import datetime
from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

ConnectorType = Literal["google_calendar", "google_sheets", "radicale"]


class ConnectorBase(BaseModel):
    """Base schema for connector."""
    connector_type: ConnectorType
    is_active: bool = False
    config: Dict[str, Any] = Field(default_factory=dict)
    credentials: Dict[str, Any] = Field(default_factory=dict)


class ConnectorCreate(ConnectorBase):
    """Schema for registering a connector."""
    pass


class ConnectorUpdate(BaseModel):
    """Schema for updating an existing connector."""
    is_active: Optional[bool] = None
    config: Optional[Dict[str, Any]] = None
    credentials: Optional[Dict[str, Any]] = None


class ConnectorRead(BaseModel):
    """Public read schema for connector."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    connector_type: str
    is_active: bool
    config: Dict[str, Any]
    credentials: Dict[str, Any]
    last_sync_at: Optional[datetime] = None
    sync_status: str = "idle"
    synced_count: int = 0
    sync_error: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class ConnectorTestResponse(BaseModel):
    """Response returned when pinging a connector."""
    success: bool
    connector_type: str
    message: str
    latency_ms: Optional[int] = None
    details: Optional[Dict[str, Any]] = None


class ConnectorSyncResponse(BaseModel):
    """Response returned when triggering a manual or automated sync."""
    success: bool
    connector_type: str
    synced_count: int
    message: str
    timestamp: datetime


class GoogleOAuthUrlResponse(BaseModel):
    """Response containing Google OAuth initiation URL."""
    url: str
    client_id_configured: bool
    client_id: Optional[str] = None
    redirect_uri: str


class GoogleOAuthCallbackPayload(BaseModel):
    """Payload sent when completing Google OAuth handshake."""
    code: Optional[str] = None
    connector_type: Optional[str] = "both"  # "google_calendar", "google_sheets", or "both"
    google_email: Optional[str] = None
    calendar_id: Optional[str] = "primary"
    spreadsheet_id: Optional[str] = None
    sheet_tab_name: Optional[str] = "OPD_Appointments_2026"


class GoogleOAuthResponse(BaseModel):
    """Response returned after Google OAuth authentication succeeds."""
    success: bool
    google_email: str
    message: str
    connected_types: list[str] = Field(default_factory=list)

