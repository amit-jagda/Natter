"""Health Check Schemas."""

from datetime import datetime
from typing import Dict

from pydantic import BaseModel, Field


class ServiceHealth(BaseModel):
    """Component-level health status."""
    status: str = Field(description="Operational status: healthy, degraded, or unhealthy")
    details: Dict[str, str] = Field(default_factory=dict)


class HealthResponse(BaseModel):
    """Overall platform health response."""
    status: str
    version: str
    environment: str
    timestamp: datetime
    services: Dict[str, ServiceHealth]

