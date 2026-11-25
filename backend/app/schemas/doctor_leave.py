"""Doctor Leave Pydantic Schemas."""

from datetime import date, datetime, time
from typing import Optional
import uuid

from pydantic import BaseModel, ConfigDict, Field


class DoctorLeaveCreate(BaseModel):
    """Payload to register a doctor scheduled absence."""
    doctor_id: uuid.UUID
    leave_date: date
    is_full_day: bool = True
    start_time: Optional[str] = Field(default=None, description="HH:MM format for partial leave")
    end_time: Optional[str] = Field(default=None, description="HH:MM format for partial leave")
    reason: Optional[str] = Field(default=None, max_length=255)


class DoctorLeaveRead(BaseModel):
    """Serialized doctor leave view."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    doctor_id: uuid.UUID
    leave_date: date
    is_full_day: bool
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    reason: Optional[str] = None
    created_at: datetime
