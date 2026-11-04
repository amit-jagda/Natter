"""Tenant Schemas."""

import uuid
from datetime import datetime
from typing import Any, Dict, Optional
from pydantic import BaseModel, ConfigDict, Field


class TenantBase(BaseModel):
    """Base tenant schema."""
    name: str = Field(min_length=2, max_length=120)
    slug: str = Field(min_length=2, max_length=120, pattern=r"^[a-z0-9-]+$")
    settings: Dict[str, Any] = Field(default_factory=dict)


class TenantCreate(TenantBase):
    """Schema for tenant creation."""
    pass


class TenantUpdate(BaseModel):
    """Schema for tenant updates."""
    name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    settings: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None


class TenantRead(TenantBase):
    """Schema for tenant responses."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    is_active: bool
    created_at: datetime
    updated_at: datetime

