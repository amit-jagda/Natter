"""Authentication & Registration Schemas with Pydantic Validation."""

import re
from typing import Optional

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.schemas.tenant import TenantRead
from app.schemas.user import UserRead


class HospitalRegisterRequest(BaseModel):
    """Initial hospital onboarding registration payload with strict Pydantic validation."""
    hospital_name: str = Field(min_length=2, max_length=120)
    slug: Optional[str] = Field(default=None, min_length=2, max_length=120, pattern=r"^[a-z0-9-]+$")
    admin_name: str = Field(min_length=2, max_length=120)
    admin_email: EmailStr
    password: str = Field(min_length=8, max_length=128)

    @field_validator("password")
    @classmethod
    def validate_password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters long.")
        if not re.search(r"[A-Za-z]", v):
            raise ValueError("Password must contain at least one letter.")
        if not re.search(r"[A-Z]", v):
            raise ValueError("Password must contain at least one uppercase letter.")
        if not re.search(r"[a-z]", v):
            raise ValueError("Password must contain at least one lowercase letter.")
        if not re.search(r"[0-9]", v):
            raise ValueError("Password must contain at least one number.")
        return v

    @field_validator("hospital_name", "admin_name")
    @classmethod
    def strip_whitespace(cls, v: str) -> str:
        clean = v.strip()
        if len(clean) < 2:
            raise ValueError("Value must be at least 2 characters after trimming.")
        return clean


class LoginRequest(BaseModel):
    """Standard credentials login payload."""
    email: EmailStr
    password: str = Field(min_length=1)


class AuthResponse(BaseModel):
    """Authentication token response with tenant and user context."""
    access_token: str
    token_type: str = "bearer"
    refresh_token: Optional[str] = None
    user: UserRead
    tenant: TenantRead


class TokenRefreshRequest(BaseModel):
    """Optional payload to supply refresh_token when not stored in cookies."""
    refresh_token: Optional[str] = None


class TokenRefreshResponse(BaseModel):
    """Fresh access token issued from valid refresh token."""
    access_token: str
    token_type: str = "bearer"
    refresh_token: Optional[str] = None
    user: Optional[UserRead] = None
    tenant: Optional[TenantRead] = None

