"""Appointment Pydantic Schemas."""

from datetime import date, datetime, time
from typing import Optional
import uuid

from pydantic import BaseModel, ConfigDict, Field


class AppointmentBase(BaseModel):
    """Base appointment schema attributes."""
    appointment_date: date
    start_time: str = Field(description="HH:MM format, e.g. 10:30")
    notes: Optional[str] = None


class AppointmentCreate(AppointmentBase):
    """Payload to create a new appointment."""
    doctor_id: uuid.UUID
    patient_id: uuid.UUID
    idempotency_key: Optional[str] = Field(default=None, max_length=64)
    source: str = Field(default="voice_agent", max_length=32)


class AppointmentCancel(BaseModel):
    """Payload to cancel an existing appointment."""
    appointment_id: uuid.UUID
    reason: Optional[str] = Field(default=None, max_length=255)


class AppointmentReschedule(BaseModel):
    """Payload to atomically reschedule an existing appointment to a new slot."""
    appointment_id: uuid.UUID
    new_date: date
    new_start_time: str = Field(description="New slot start time in HH:MM format")


class AppointmentRead(BaseModel):
    """Serialized appointment view."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    doctor_id: uuid.UUID
    doctor_name: Optional[str] = None
    patient_id: uuid.UUID
    patient_name: Optional[str] = None
    appointment_date: date
    start_time: str
    end_time: str
    status: str
    source: str
    notes: Optional[str] = None
    created_at: datetime
