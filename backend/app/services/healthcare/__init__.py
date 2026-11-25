"""Healthcare Domain Services Package."""

from app.services.healthcare.appointment_service import (
    AppointmentService,
    BookingResult,
)
from app.services.healthcare.availability_service import (
    AvailabilityService,
    AvailableSlot,
)
from app.services.healthcare.patient_service import (
    PatientVerificationService,
    VerificationResult,
)

__all__ = [
    "AppointmentService",
    "BookingResult",
    "AvailabilityService",
    "AvailableSlot",
    "PatientVerificationService",
    "VerificationResult",
]
