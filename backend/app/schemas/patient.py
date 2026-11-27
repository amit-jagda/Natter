"""Patient Pydantic Schemas.

Defines request/response serialization for patient records,
patch updates, and Excel bulk import results.
"""

import re
import uuid
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class PatientBase(BaseModel):
    """Base schema for patient details."""
    name: str = Field(..., min_length=1, max_length=120, description="Patient full name")
    phone: str = Field(
        ...,
        min_length=10,
        max_length=15,
        description="Patient mobile number (10-15 digits only, required)",
    )
    date: str = Field(..., min_length=4, max_length=32, description="Appointment or registration date (YYYY-MM-DD)")
    email: Optional[EmailStr] = Field(default=None, description="Patient email address (optional)")
    gender: Optional[str] = Field(default=None, max_length=32, description="Gender (e.g. Male, Female, Other)")
    notes: Optional[str] = Field(default=None, max_length=500, description="Clinical or general notes")

    @field_validator("phone", mode="before")
    @classmethod
    def validate_numeric_phone(cls, v: object) -> str:
        if v is None:
            raise ValueError("Mobile number is required.")
        val_str = str(v).strip()
        if not val_str:
            raise ValueError("Mobile number is required.")
        # Ensure only digits are present (no alphabets or special characters)
        if not re.match(r"^\d+$", val_str):
            raise ValueError("Mobile number must contain digits only, no alphabets or special characters allowed.")
        if len(val_str) < 10 or len(val_str) > 15:
            raise ValueError(f"Mobile number must be between 10 and 15 digits (got {len(val_str)}).")
        return val_str

    @field_validator("email", mode="before")
    @classmethod
    def validate_optional_email(cls, v: object) -> Optional[str]:
        if v is None:
            return None
        val_str = str(v).strip()
        return val_str if val_str else None


class PatientCreate(PatientBase):
    """Schema for creating a patient record via form."""
    pass


class PatientPatch(BaseModel):
    """Schema for partial update (PATCH) of patient records."""
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    date: Optional[str] = Field(default=None, min_length=4, max_length=32)
    gender: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("phone", mode="before")
    @classmethod
    def validate_patch_phone(cls, v: object) -> Optional[str]:
        if v is None:
            return None
        val_str = str(v).strip()
        if not val_str:
            return None
        if not re.match(r"^\d+$", val_str):
            raise ValueError("Mobile number must contain digits only, no alphabets or special characters allowed.")
        if len(val_str) < 10 or len(val_str) > 15:
            raise ValueError(f"Mobile number must be between 10 and 15 digits (got {len(val_str)}).")
        return val_str

    @field_validator("email", mode="before")
    @classmethod
    def validate_patch_email(cls, v: object) -> Optional[str]:
        if v is None:
            return None
        val_str = str(v).strip()
        return val_str if val_str else None


class PatientRead(PatientBase):
    """Schema for returning patient data."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class PatientListResponse(BaseModel):
    """Schema for paginated/filtered patient list."""
    patients: List[PatientRead]
    total: int


class PatientImportResponse(BaseModel):
    """Schema for returning Excel/CSV bulk import results."""
    imported: int
    failed: int
    errors: List[str]
    patients: List[PatientRead]
