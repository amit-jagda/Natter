"""Healthcare Tool Implementations for Conversational Agent.

Provides structured tool models and executable handlers for:
1. Patient demographic verification and phone candidate lookup.
2. Patient registration.
3. Doctor and medical specialty search.
4. Dynamic shift and slot availability checking.
5. Atomic appointment booking with PostgreSQL interval exclusion protection.
6. Appointment retrieval, cancellation, and atomic rescheduling.
7. Human escalation and emergency diversion signaling.
"""

from datetime import date, datetime, time
import logging
import re
from typing import Any, Dict, List, Optional
import uuid

from pydantic import BaseModel, Field
from sqlalchemy import distinct, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.appointment import Appointment
from app.models.doctor import Doctor
from app.models.operating_hours import HospitalOperatingHours
from app.models.patient import Patient
from app.models.user import User
from app.services.conversation.state import ConversationState
from app.services.healthcare.appointment_service import AppointmentService
from app.services.healthcare.availability_service import AvailabilityService
from app.services.healthcare.patient_service import PatientVerificationService
from app.services.tools.registry import ToolRegistry

logger = logging.getLogger(__name__)

# Registry instance for healthcare tools
healthcare_tool_registry = ToolRegistry()


# =============================================================================
# 1. Patient Verification & Registration Tools
# =============================================================================

class LookupPatientParams(BaseModel):
    phone_number: str = Field(
        ...,
        description="Patient contact mobile phone number (digits only or with standard format).",
    )


@healthcare_tool_registry.register(
    name="lookup_patient",
    description="Look up patient records matching a contact phone number. Useful for identifying returning patients.",
    parameter_model=LookupPatientParams,
    requires_verification=False,
)
async def handle_lookup_patient(
    params: LookupPatientParams,
    tenant_id: uuid.UUID,
    db: AsyncSession,
    session_state: ConversationState,
) -> Dict[str, Any]:
    candidates = await PatientVerificationService.lookup_candidates_by_phone(
        db, tenant_id, params.phone_number
    )
    if not candidates:
        return {
            "success": True,
            "count": 0,
            "message": "No registered patient records found for this phone number.",
            "candidates": [],
        }

    return {
        "success": True,
        "count": len(candidates),
        "requires_name_verification": True,
        "message": (
            f"Found {len(candidates)} registered patient record(s) linked to this phone number. "
            "For privacy and security, do NOT guess their name. Ask the caller to state their full name, "
            "then call verify_patient_identity with both their spoken name and phone number."
        ),
    }


class VerifyPatientIdentityParams(BaseModel):
    patient_name: str = Field(
        ...,
        description="Patient full name as stated by caller.",
    )
    phone_number: str = Field(
        ...,
        description="Patient contact mobile number.",
    )


@healthcare_tool_registry.register(
    name="verify_patient_identity",
    description="Verify patient identity using name and phone number before booking, cancelling, or viewing appointments.",
    parameter_model=VerifyPatientIdentityParams,
    requires_verification=False,
)
async def handle_verify_patient_identity(
    params: VerifyPatientIdentityParams,
    tenant_id: uuid.UUID,
    db: AsyncSession,
    session_state: ConversationState,
) -> Dict[str, Any]:
    # 1. Enforce active lockout
    if session_state.is_verification_locked():
        return {
            "success": False,
            "verified": False,
            "error_code": "VERIFICATION_LOCKED",
            "message": "Verification attempts are temporarily locked. Transferring to human staff.",
            "action_signal": "transfer_to_human",
            "stage": "escalated",
        }

    # 2. Look up candidate patients registered under this phone number
    candidates = await PatientVerificationService.lookup_candidates_by_phone(
        db, tenant_id, params.phone_number
    )

    if not candidates:
        session_state.verification_attempts += 1
        if session_state.verification_attempts >= 3:
            session_state.verification_locked_until = datetime.now().timestamp() + 900.0
            session_state.verification_status = "locked"
            return {
                "success": False,
                "verified": False,
                "error_code": "VERIFICATION_LOCKED",
                "message": "Maximum verification attempts exceeded. Verification locked for 15 minutes.",
                "action_signal": "transfer_to_human",
                "stage": "escalated",
            }
        remaining = 3 - session_state.verification_attempts
        return {
            "success": False,
            "verified": False,
            "error_code": "NOT_FOUND",
            "message": f"No registered patient found with this phone number. {remaining} attempt(s) remaining.",
            "attempts_remaining": remaining,
        }

    # 3. Test demographic name matching against candidate records
    last_res = None
    for cand in candidates:
        cand_id = uuid.UUID(cand["patient_id"])
        last_res = await PatientVerificationService.verify_patient_demographics(
            db,
            tenant_id,
            cand_id,
            params.patient_name,
            session_state,
        )
        if last_res.success:
            return {
                "success": True,
                "verified": True,
                "patient_id": last_res.patient_id,
                "patient_name": last_res.patient_name,
                "message": f"Patient identity verified successfully for {last_res.patient_name}.",
            }

    # If none matched, return the failure
    return {
        "success": False,
        "verified": False,
        "error_code": "VERIFICATION_LOCKED" if (last_res and last_res.is_locked) else "VERIFICATION_FAILED",
        "message": (last_res.error if last_res else "Patient identity could not be verified."),
        "attempts_remaining": last_res.attempts_remaining if last_res else 0,
        "action_signal": "transfer_to_human" if (last_res and last_res.is_locked) else None,
        "stage": "escalated" if (last_res and last_res.is_locked) else None,
    }


class RegisterPatientParams(BaseModel):
    full_name: str = Field(
        ...,
        description="Patient's full legal name.",
    )
    phone_number: str = Field(
        ...,
        description="Patient's mobile contact phone number.",
    )
    email: Optional[str] = Field(
        None,
        description="Patient's email address (optional).",
    )
    gender: Optional[str] = Field(
        None,
        description="Patient's gender (Male, Female, Other, optional).",
    )


@healthcare_tool_registry.register(
    name="register_patient",
    description="Register a new patient into the hospital system and automatically verify their session.",
    parameter_model=RegisterPatientParams,
    requires_verification=False,
)
async def handle_register_patient(
    params: RegisterPatientParams,
    tenant_id: uuid.UUID,
    db: AsyncSession,
    session_state: ConversationState,
) -> Dict[str, Any]:
    clean_phone = re.sub(r"\D", "", params.phone_number)
    clean_name = params.full_name.strip()

    # Check if a record already exists with identical name and phone
    existing_query = select(Patient).where(
        Patient.tenant_id == tenant_id,
        Patient.phone == clean_phone,
    )
    result = await db.execute(existing_query)
    existing_patients = result.scalars().all()

    for p in existing_patients:
        if p.name.strip().lower() == clean_name.lower():
            session_state.set_verified(str(p.id), verification_method="registration_existing")
            return {
                "success": True,
                "patient_id": str(p.id),
                "patient_name": p.name,
                "message": f"Patient '{p.name}' was already registered and is now verified.",
            }

    # Register new patient
    new_patient = Patient(
        tenant_id=tenant_id,
        name=clean_name,
        phone=clean_phone,
        email=params.email.strip() if params.email else None,
        gender=params.gender.strip() if params.gender else None,
        date=date.today().isoformat(),
    )
    db.add(new_patient)
    await db.commit()
    await db.refresh(new_patient)

    session_state.set_verified(str(new_patient.id), verification_method="registration_new")

    return {
        "success": True,
        "patient_id": str(new_patient.id),
        "patient_name": new_patient.name,
        "message": f"Patient '{new_patient.name}' successfully registered and verified.",
    }


# =============================================================================
# 2. Doctor & Hospital Service Discovery Tools
# =============================================================================

class SearchDoctorsParams(BaseModel):
    specialty: Optional[str] = Field(
        None,
        description="Medical specialty or department (e.g., Cardiology, Pediatrics, General Medicine, Dermatology).",
    )
    doctor_name: Optional[str] = Field(
        None,
        description="Doctor's name or part of name to search for.",
    )


@healthcare_tool_registry.register(
    name="search_doctors",
    description="Search for active hospital doctors by medical specialty or name.",
    parameter_model=SearchDoctorsParams,
    requires_verification=False,
)
async def handle_search_doctors(
    params: SearchDoctorsParams,
    tenant_id: uuid.UUID,
    db: AsyncSession,
    session_state: ConversationState,
) -> Dict[str, Any]:
    query = (
        select(Doctor)
        .options(selectinload(Doctor.user))
        .where(
            Doctor.tenant_id == tenant_id,
            Doctor.is_active.is_(True),
        )
    )

    if params.specialty:
        query = query.where(Doctor.specialization.ilike(f"%{params.specialty.strip()}%"))

    result = await db.execute(query)
    doctors = result.scalars().all()

    doctor_list = []
    name_filter = params.doctor_name.strip().lower() if params.doctor_name else None

    for doc in doctors:
        doc_user_name = doc.user.full_name if doc.user else "Doctor"
        if name_filter:
            # Strip common honorifics (Dr., Doctor, etc.) to match both "Dr. Rohit" and "rohit"
            clean_search = re.sub(r"^(dr\.?|doctor|ડૉ\.?|ડોક્ટર|डॉ\.?|डॉक्टर)\s*", "", name_filter, flags=re.IGNORECASE).strip()
            clean_doc = re.sub(r"^(dr\.?|doctor|ડૉ\.?|ડોક્ટર|डॉ\.?|डॉक्टर)\s*", "", doc_user_name.lower(), flags=re.IGNORECASE).strip()
            if clean_search:
                if clean_search not in clean_doc and clean_doc not in clean_search:
                    continue
            else:
                if name_filter not in doc_user_name.lower():
                    continue

        fee = float(doc.consultation_fee) if doc.consultation_fee is not None else None
        doctor_list.append(
            {
                "doctor_id": str(doc.id),
                "doctor_name": doc_user_name,
                "specialty": doc.specialization,
                "department": doc.department,
                "consultation_fee": fee,
                "slot_duration_minutes": doc.slot_duration_minutes,
            }
        )

    return {
        "success": True,
        "count": len(doctor_list),
        "doctors": doctor_list,
        "message": f"Found {len(doctor_list)} doctor(s) matching criteria.",
    }


class GetDoctorAvailabilityParams(BaseModel):
    doctor_id: str = Field(
        ...,
        description="Unique UUID string of the doctor.",
    )
    date: str = Field(
        ...,
        description="Target appointment date in YYYY-MM-DD format.",
    )


@healthcare_tool_registry.register(
    name="get_doctor_availability",
    description="Check available appointment time slots for a doctor on a specific date.",
    parameter_model=GetDoctorAvailabilityParams,
    requires_verification=False,
)
async def handle_get_doctor_availability(
    params: GetDoctorAvailabilityParams,
    tenant_id: uuid.UUID,
    db: AsyncSession,
    session_state: ConversationState,
) -> Dict[str, Any]:
    try:
        doctor_uuid = uuid.UUID(params.doctor_id.strip())
    except (ValueError, AttributeError):
        return {
            "success": False,
            "error_code": "INVALID_DOCTOR_ID",
            "message": "Invalid doctor ID format. Must be a valid UUID.",
        }

    try:
        target_date = datetime.strptime(params.date.strip(), "%Y-%m-%d").date()
    except ValueError:
        return {
            "success": False,
            "error_code": "INVALID_DATE_FORMAT",
            "message": "Invalid date format. Please specify the date as YYYY-MM-DD.",
        }

    slots = await AvailabilityService.get_doctor_available_slots(
        db, tenant_id, doctor_uuid, target_date
    )

    available_times = [s.start_time for s in slots]

    return {
        "success": True,
        "doctor_id": str(doctor_uuid),
        "date": target_date.isoformat(),
        "total_available_slots": len(available_times),
        "available_slots": available_times,
        "message": (
            f"Found {len(available_times)} open slot(s) on {target_date.isoformat()}."
            if available_times
            else f"No available slots on {target_date.isoformat()}."
        ),
    }


class GetHospitalServicesParams(BaseModel):
    pass


@healthcare_tool_registry.register(
    name="get_hospital_services",
    description="Retrieve available medical specialties, departments, and general operating hours for the hospital.",
    parameter_model=GetHospitalServicesParams,
    requires_verification=False,
)
async def handle_get_hospital_services(
    params: GetHospitalServicesParams,
    tenant_id: uuid.UUID,
    db: AsyncSession,
    session_state: ConversationState,
) -> Dict[str, Any]:
    # 1. Distinct specialties
    spec_query = (
        select(Doctor.specialization)
        .distinct()
        .where(
            Doctor.tenant_id == tenant_id,
            Doctor.is_active.is_(True),
        )
    )
    spec_result = await db.execute(spec_query)
    specialties = [s[0] for s in spec_result.all() if s[0]]

    # 2. Operating hours
    hours_query = (
        select(HospitalOperatingHours)
        .where(HospitalOperatingHours.tenant_id == tenant_id)
        .order_by(HospitalOperatingHours.day_of_week)
    )
    hours_result = await db.execute(hours_query)
    operating_hours = []
    day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

    for h in hours_result.scalars().all():
        operating_hours.append(
            {
                "day": day_names[h.day_of_week] if 0 <= h.day_of_week < 7 else str(h.day_of_week),
                "is_closed": h.is_closed,
                "open_time": h.open_time.strftime("%H:%M") if h.open_time else None,
                "close_time": h.close_time.strftime("%H:%M") if h.close_time else None,
            }
        )

    return {
        "success": True,
        "specialties": specialties,
        "operating_hours": operating_hours,
        "message": f"Hospital offers {len(specialties)} specialties.",
    }


# =============================================================================
# 3. Appointment Management Tools (Strictly Verification-Gated)
# =============================================================================

class CreateAppointmentParams(BaseModel):
    doctor_id: str = Field(
        ...,
        description="UUID string of the doctor.",
    )
    appointment_date: str = Field(
        ...,
        description="Appointment date in YYYY-MM-DD format.",
    )
    start_time: str = Field(
        ...,
        description="Appointment start time in HH:MM format (24-hour).",
    )
    reason: Optional[str] = Field(
        None,
        description="Optional reason for visit or clinical symptoms.",
    )
    idempotency_key: Optional[str] = Field(
        None,
        description="Optional client idempotency key to prevent accidental duplicate bookings.",
    )


@healthcare_tool_registry.register(
    name="create_appointment",
    description="Book a confirmed healthcare appointment for the verified patient. Patient must be verified first.",
    parameter_model=CreateAppointmentParams,
    requires_verification=True,
    is_idempotent=True,
)
async def handle_create_appointment(
    params: CreateAppointmentParams,
    tenant_id: uuid.UUID,
    db: AsyncSession,
    session_state: ConversationState,
) -> Dict[str, Any]:
    patient_id = uuid.UUID(session_state.verified_patient_id)

    try:
        doctor_uuid = uuid.UUID(params.doctor_id.strip())
    except (ValueError, AttributeError):
        return {
            "success": False,
            "error_code": "INVALID_DOCTOR_ID",
            "message": "Invalid doctor ID. Please provide a valid UUID.",
        }

    try:
        appt_date = datetime.strptime(params.appointment_date.strip(), "%Y-%m-%d").date()
    except ValueError:
        return {
            "success": False,
            "error_code": "INVALID_DATE_FORMAT",
            "message": "Invalid date format. Use YYYY-MM-DD.",
        }

    # Execute booking via atomic service
    booking_result = await AppointmentService.book_appointment(
        db,
        tenant_id=tenant_id,
        patient_id=patient_id,
        doctor_id=doctor_uuid,
        appointment_date=appt_date,
        start_time_str=params.start_time.strip(),
        notes=params.reason,
        idempotency_key=params.idempotency_key,
        session_state=session_state,
    )

    if booking_result.success:
        return {
            "success": True,
            "appointment_id": booking_result.appointment_id,
            "doctor_name": booking_result.doctor_name,
            "appointment_date": str(booking_result.appointment_date) if booking_result.appointment_date else None,
            "start_time": booking_result.start_time,
            "end_time": booking_result.end_time,
            "message": booking_result.message,
            "action_signal": "booking_confirmed",
            "stage": "confirmed",
        }

    return {
        "success": False,
        "error_code": booking_result.error_code,
        "message": booking_result.message,
        "alternative_slots": booking_result.alternative_slots,
    }


class GetPatientAppointmentsParams(BaseModel):
    include_past: Optional[bool] = Field(
        False,
        description="Whether to include past or cancelled appointments.",
    )


@healthcare_tool_registry.register(
    name="get_patient_appointments",
    description="Retrieve upcoming and recent appointments for the verified patient.",
    parameter_model=GetPatientAppointmentsParams,
    requires_verification=True,
)
async def handle_get_patient_appointments(
    params: GetPatientAppointmentsParams,
    tenant_id: uuid.UUID,
    db: AsyncSession,
    session_state: ConversationState,
) -> Dict[str, Any]:
    patient_id = uuid.UUID(session_state.verified_patient_id)

    query = (
        select(Appointment)
        .options(
            selectinload(Appointment.doctor).selectinload(Doctor.user),
        )
        .where(
            Appointment.tenant_id == tenant_id,
            Appointment.patient_id == patient_id,
        )
    )

    if not params.include_past:
        query = query.where(Appointment.status != "cancelled")

    query = query.order_by(Appointment.appointment_date, Appointment.start_time)
    result = await db.execute(query)
    appointments = result.scalars().all()

    appt_list = []
    for apt in appointments:
        doc_name = apt.doctor.user.full_name if apt.doctor and apt.doctor.user else "Doctor"
        appt_list.append(
            {
                "appointment_id": str(apt.id),
                "doctor_id": str(apt.doctor_id),
                "doctor_name": doc_name,
                "appointment_date": apt.appointment_date.isoformat(),
                "start_time": apt.start_time.strftime("%H:%M"),
                "end_time": apt.end_time.strftime("%H:%M"),
                "status": apt.status,
                "notes": apt.notes,
            }
        )

    return {
        "success": True,
        "count": len(appt_list),
        "appointments": appt_list,
        "message": f"Found {len(appt_list)} appointment(s).",
    }


class CancelAppointmentParams(BaseModel):
    appointment_id: str = Field(
        ...,
        description="UUID string of the appointment to cancel.",
    )
    reason: Optional[str] = Field(
        None,
        description="Reason for cancellation.",
    )


@healthcare_tool_registry.register(
    name="cancel_appointment",
    description="Cancel an existing appointment for the verified patient.",
    parameter_model=CancelAppointmentParams,
    requires_verification=True,
    is_idempotent=True,
)
async def handle_cancel_appointment(
    params: CancelAppointmentParams,
    tenant_id: uuid.UUID,
    db: AsyncSession,
    session_state: ConversationState,
) -> Dict[str, Any]:
    try:
        apt_uuid = uuid.UUID(params.appointment_id.strip())
    except (ValueError, AttributeError):
        return {
            "success": False,
            "error_code": "INVALID_APPOINTMENT_ID",
            "message": "Invalid appointment ID.",
        }

    cancel_result = await AppointmentService.cancel_appointment(
        db,
        tenant_id=tenant_id,
        appointment_id=apt_uuid,
        reason=params.reason,
        session_state=session_state,
    )

    if cancel_result.get("success"):
        cancel_result["action_signal"] = "appointment_cancelled"
        cancel_result["stage"] = "cancelled"

    return cancel_result


class RescheduleAppointmentParams(BaseModel):
    appointment_id: str = Field(
        ...,
        description="UUID string of the existing appointment to reschedule.",
    )
    new_date: str = Field(
        ...,
        description="New appointment date in YYYY-MM-DD format.",
    )
    new_start_time: str = Field(
        ...,
        description="New appointment start time in HH:MM format.",
    )
    reason: Optional[str] = Field(
        None,
        description="Reason for rescheduling.",
    )


@healthcare_tool_registry.register(
    name="reschedule_appointment",
    description="Reschedule an existing appointment to a new date and time atomically.",
    parameter_model=RescheduleAppointmentParams,
    requires_verification=True,
    is_idempotent=True,
)
async def handle_reschedule_appointment(
    params: RescheduleAppointmentParams,
    tenant_id: uuid.UUID,
    db: AsyncSession,
    session_state: ConversationState,
) -> Dict[str, Any]:
    try:
        apt_uuid = uuid.UUID(params.appointment_id.strip())
    except (ValueError, AttributeError):
        return {
            "success": False,
            "error_code": "INVALID_APPOINTMENT_ID",
            "message": "Invalid appointment ID.",
        }

    try:
        parsed_new_date = datetime.strptime(params.new_date.strip(), "%Y-%m-%d").date()
    except ValueError:
        return {
            "success": False,
            "error_code": "INVALID_DATE_FORMAT",
            "message": "Invalid date format. Use YYYY-MM-DD.",
        }

    reschedule_result = await AppointmentService.reschedule_appointment(
        db,
        tenant_id=tenant_id,
        appointment_id=apt_uuid,
        new_date=parsed_new_date,
        new_start_time_str=params.new_start_time.strip(),
        session_state=session_state,
    )

    if reschedule_result.success:
        return {
            "success": True,
            "appointment_id": reschedule_result.appointment_id,
            "doctor_name": reschedule_result.doctor_name,
            "appointment_date": str(reschedule_result.appointment_date) if reschedule_result.appointment_date else None,
            "start_time": reschedule_result.start_time,
            "end_time": reschedule_result.end_time,
            "message": reschedule_result.message or "Appointment successfully rescheduled.",
            "action_signal": "appointment_rescheduled",
            "stage": "rescheduled",
        }

    return {
        "success": False,
        "error_code": reschedule_result.error_code,
        "message": reschedule_result.message,
        "alternative_slots": reschedule_result.alternative_slots,
    }


# =============================================================================
# 4. Human Escalation & Emergency Divert Tool
# =============================================================================

class EscalateToHumanParams(BaseModel):
    reason: str = Field(
        ...,
        description="Reason for escalating caller to human hospital staff.",
    )
    urgency: Optional[str] = Field(
        "normal",
        description="Urgency level: 'normal', 'high', or 'emergency'.",
    )


@healthcare_tool_registry.register(
    name="escalate_to_human",
    description="Escalate the call to a human receptionist or medical emergency triage.",
    parameter_model=EscalateToHumanParams,
    requires_verification=False,
)
async def handle_escalate_to_human(
    params: EscalateToHumanParams,
    tenant_id: uuid.UUID,
    db: AsyncSession,
    session_state: ConversationState,
) -> Dict[str, Any]:
    is_emergency = params.urgency.strip().lower() in ("emergency", "critical", "urgent")
    action_signal = "emergency_divert" if is_emergency else "transfer_to_human"

    session_state.action_signal = action_signal
    session_state.current_stage = "escalated"

    return {
        "success": True,
        "action_signal": action_signal,
        "stage": "escalated",
        "urgency": params.urgency,
        "message": (
            "Immediately connecting caller to emergency triage team."
            if is_emergency
            else "Connecting caller to hospital reception."
        ),
    }
