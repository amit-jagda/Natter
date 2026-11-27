"""User Schemas."""

import uuid
from datetime import datetime
from typing import Optional

from app.models.enums import TenantRole, UserStatus
from pydantic import BaseModel, ConfigDict, EmailStr, Field


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
    password: Optional[str] = Field(default=None, min_length=6, max_length=128)


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


class UserInviteRequest(BaseModel):
    """Schema for inviting a staff user into the hospital organization."""
    full_name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    role: TenantRole = Field(default=TenantRole.OPERATOR, description="Default role is operator")
    password: Optional[str] = Field(
        default=None,
        min_length=6,
        max_length=128,
        description="Optional manual password; auto-generated if omitted",
    )


class UserInviteResponse(BaseModel):
    """Schema returning invited user details and temporary credentials."""
    user: UserRead
    temp_password: str
    email_sent: bool
    message: str


