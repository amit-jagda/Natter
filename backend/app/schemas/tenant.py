"""Tenant (Hospital) Schemas with Pydantic Validation."""

import re
import uuid
from datetime import datetime, time
from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator, model_validator


TIME_REGEX = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


class OperatingHoursItem(BaseModel):
    """Single day operating hours representation."""
    model_config = ConfigDict(from_attributes=True)

    day_of_week: int = Field(ge=0, le=6, description="0=Monday, 6=Sunday")
    open_time: Optional[Union[time, str]] = Field(default="09:00", description="HH:MM format")
    close_time: Optional[Union[time, str]] = Field(default="20:00", description="HH:MM format")
    is_closed: bool = False

    @field_validator("open_time", "close_time")
    @classmethod
    def validate_time_format(cls, v: Optional[Union[time, str]]) -> Optional[Union[time, str]]:
        if v is None:
            return None
        if isinstance(v, str):
            if not TIME_REGEX.match(v.strip()):
                raise ValueError("Time must be in 24-hour 'HH:MM' format (e.g. '09:00', '18:30').")
        return v

    @model_validator(mode="after")
    def validate_open_before_close(self) -> "OperatingHoursItem":
        if self.is_closed:
            return self
        if self.open_time and self.close_time:
            t1 = self.open_time.strftime("%H:%M") if isinstance(self.open_time, time) else self.open_time
            t2 = self.close_time.strftime("%H:%M") if isinstance(self.close_time, time) else self.close_time
            if t1 >= t2:
                raise ValueError(f"Opening time ({t1}) must be earlier than closing time ({t2}).")
        return self

    @field_serializer("open_time", "close_time")
    def serialize_time(self, v: Optional[Union[time, str]]) -> Optional[str]:
        if isinstance(v, time):
            return v.strftime("%H:%M")
        return v


class TenantBase(BaseModel):
    """Base tenant schema."""
    name: str = Field(min_length=2, max_length=120)
    slug: str = Field(min_length=2, max_length=120, pattern=r"^[a-z0-9-]+$")
    phone_number: Optional[str] = None
    emergency_contact: Optional[str] = None
    address: Dict[str, Any] = Field(default_factory=dict)
    timezone: str = "Asia/Kolkata"
    settings: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("phone_number", "emergency_contact")
    @classmethod
    def validate_phone(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return None
        cleaned = re.sub(r"[\s-]", "", v)
        if not re.match(r"^\+?[0-9]{3,15}$", cleaned):
            raise ValueError("Contact number must be between 3 and 15 digits.")
        return v.strip()


class TenantCreate(TenantBase):
    """Schema for tenant creation."""
    pass


class TenantUpdate(BaseModel):
    """Schema for tenant updates."""
    name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    phone_number: Optional[str] = None
    emergency_contact: Optional[str] = None
    address: Optional[Dict[str, Any]] = None
    timezone: Optional[str] = None
    settings: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None


class HospitalProfileUpdate(BaseModel):
    """Update payload for hospital profile and operating hours."""
    phone_number: Optional[str] = None
    emergency_contact: Optional[str] = None
    address: Optional[Dict[str, Any]] = None
    timezone: Optional[str] = "Asia/Kolkata"
    operating_hours: Optional[List[OperatingHoursItem]] = None

    @field_validator("phone_number", "emergency_contact")
    @classmethod
    def validate_phone(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return None
        cleaned = re.sub(r"[\s-]", "", v)
        if not re.match(r"^\+?[0-9]{3,15}$", cleaned):
            raise ValueError("Contact number must be between 3 and 15 digits.")
        return v.strip()


class TenantRead(TenantBase):
    """Schema for tenant responses."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    onboarding_status: str
    onboarding_step: int
    is_active: bool
    operating_hours: List[OperatingHoursItem] = []
    created_at: datetime
    updated_at: datetime


class OnboardingStatusResponse(BaseModel):
    """Summary status of hospital onboarding progress."""
    onboarding_status: str
    onboarding_step: int
    hospital_name: str
    hospital_id: uuid.UUID
    profile_complete: bool
    operating_hours_configured: bool
    doctors_count: int
