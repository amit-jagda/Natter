"""Doctor and Availability Schemas with Pydantic Validation."""

import re
import uuid
from datetime import datetime, time
from typing import List, Optional, Union
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_serializer, field_validator, model_validator


TIME_REGEX = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


class DoctorAvailabilityItem(BaseModel):
    """Weekly recurring availability shift for a doctor."""
    model_config = ConfigDict(from_attributes=True)

    day_of_week: int = Field(ge=0, le=6, description="0=Monday, 6=Sunday")
    start_time: Union[time, str] = Field(description="HH:MM format, e.g. 10:00")
    end_time: Union[time, str] = Field(description="HH:MM format, e.g. 14:00")
    is_available: bool = True

    @field_validator("start_time", "end_time")
    @classmethod
    def validate_time_format(cls, v: Union[time, str]) -> Union[time, str]:
        if isinstance(v, str):
            if not TIME_REGEX.match(v.strip()):
                raise ValueError("Shift time must be in 24-hour 'HH:MM' format (e.g. '10:00', '14:30').")
        return v

    @model_validator(mode="after")
    def validate_start_before_end(self) -> "DoctorAvailabilityItem":
        if self.is_available:
            t1 = self.start_time.strftime("%H:%M") if isinstance(self.start_time, time) else str(self.start_time)
            t2 = self.end_time.strftime("%H:%M") if isinstance(self.end_time, time) else str(self.end_time)
            if t1 >= t2:
                raise ValueError(f"Shift start time ({t1}) must be before end time ({t2}).")
        return self

    @field_serializer("start_time", "end_time")
    def serialize_time(self, v: Union[time, str]) -> str:
        if isinstance(v, time):
            return v.strftime("%H:%M")
        return str(v)


class DoctorCreate(BaseModel):
    """Payload to invite/register a new doctor."""
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    specialization: str = Field(min_length=2, max_length=120)
    department: Optional[str] = Field(default=None, max_length=120)
    slot_duration_minutes: int = Field(default=30, ge=5, le=180)
    consultation_fee: Optional[float] = Field(default=None, ge=0)
    availabilities: List[DoctorAvailabilityItem] = Field(default_factory=list)

    @field_validator("full_name", "specialization")
    @classmethod
    def strip_text(cls, v: str) -> str:
        clean = v.strip()
        if len(clean) < 2:
            raise ValueError("Value must be at least 2 characters.")
        return clean


class DoctorUpdate(BaseModel):
    """Payload to update an existing doctor."""
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    specialization: Optional[str] = Field(default=None, min_length=2, max_length=120)
    department: Optional[str] = Field(default=None, max_length=120)
    slot_duration_minutes: Optional[int] = Field(default=None, ge=5, le=180)
    consultation_fee: Optional[float] = Field(default=None, ge=0)
    is_active: Optional[bool] = None
    availabilities: Optional[List[DoctorAvailabilityItem]] = None


class DoctorRead(BaseModel):
    """Response model for doctor details."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    user_id: uuid.UUID
    full_name: str
    email: str
    specialization: str
    department: Optional[str] = None
    slot_duration_minutes: int
    consultation_fee: Optional[float] = None
    is_active: bool
    status: str = "invited"
    availabilities: List[DoctorAvailabilityItem] = []
    created_at: datetime
    updated_at: datetime


class BulkAvailabilityUpdate(BaseModel):
    """Payload to replace all weekly availability shifts for a doctor."""
    availabilities: List[DoctorAvailabilityItem]
