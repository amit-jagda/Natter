"""User Schemas."""

import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from app.models.enums import TenantRole, UserStatus


class UserBase(BaseModel):
    """Base user schema."""
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=120)
    role: TenantRole = TenantRole.OPERATOR


class UserCreate(UserBase):
    """Schema for user creation (internal/admin)."""
    password: str = Field(min_length=8, max_length=128)
    tenant_id: uuid.UUID


class UserUpdate(BaseModel):
    """Schema for updating user details."""
    full_name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    role: Optional[TenantRole] = None
    status: Optional[UserStatus] = None
    is_active: Optional[bool] = None


class UserRead(UserBase):
    """Schema for returning user data."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    status: UserStatus
    is_active: bool
    created_at: datetime
    updated_at: datetime


class TokenResponse(BaseModel):
    """Authentication token response."""
    access_token: str
    token_type: str = "bearer"
    expires_in: int

