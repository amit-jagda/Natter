"""Healthcare Appointment Management Service.

Provides:
1. Atomic appointment booking with database locking and idempotency protection.
2. Conflict detection and recovery.
3. Patient-verified appointment cancellation.
4. Atomic appointment rescheduling (preserving existing slot if new slot fails).
5. Patient appointment history retrieval.
"""

import logging
import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.appointment import Appointment
from app.models.doctor import Doctor
from app.models.patient import Patient
from app.models.tenant import Tenant
from app.services.conversation.state import ConversationState
from app.services.healthcare.availability_service import (
    AvailabilityService,
    _format_time_ampm,
    _minutes_to_time,
    _time_to_minutes,
    get_tenant_now,
    get_tenant_tz,
)

logger = logging.getLogger(__name__)


@dataclass
class BookingResult:
    """Outcome of an appointment booking operation."""
    success: bool
    appointment_id: Optional[str] = None
    doctor_id: Optional[str] = None
    doctor_name: Optional[str] = None
    patient_id: Optional[str] = None
    patient_name: Optional[str] = None
    appointment_date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    error_code: Optional[str] = None  # e.g. "SLOT_CONFLICT", "UNVERIFIED", "NOT_FOUND"
    message: Optional[str] = None
    alternative_slots: Optional[List[str]] = None


class AppointmentService:
    """Service handling transactional appointment lifecycle operations."""

    @staticmethod
    def _parse_time(t_str: str) -> time:
        parts = t_str.strip().split(":")
        return time(hour=int(parts[0]), minute=int(parts[1]))

    @classmethod
    async def book_appointment(
        cls,
        db: AsyncSession,
        tenant_id: uuid.UUID,
        patient_id: uuid.UUID,
        doctor_id: uuid.UUID,
        appointment_date: date,
        start_time_str: str,
        *,
        idempotency_key: Optional[str] = None,
        notes: Optional[str] = None,
        source: str = "voice_agent",
        session_state: Optional[ConversationState] = None,
        commit: bool = True,
    ) -> BookingResult:
        """Atomically book an appointment slot with double-booking prevention.

        1. Enforces patient verification if session state is provided.
        2. Checks idempotency key to prevent double bookings on retries.
        3. Locks doctor row with SELECT FOR UPDATE to serialize concurrent attempts.
        4. Revalidates slot availability.
        5. Inserts appointment with range exclusion protection.
        """
        # 1. Verify caller authorization for patient
        if session_state is not None and not session_state.is_verified_for_patient(str(patient_id)):
            return BookingResult(
                success=False,
                error_code="UNVERIFIED",
                message="Patient identity must be verified before booking an appointment.",
            )

        # 2. Idempotency Check
        if idempotency_key:
            existing_query = (
                select(Appointment)
                .options(selectinload(Appointment.doctor).selectinload(Doctor.user), selectinload(Appointment.patient))
                .where(Appointment.tenant_id == tenant_id)
                .where(Appointment.idempotency_key == idempotency_key)
            )
            existing_res = await db.execute(existing_query)
            existing_apt = existing_res.scalar_one_or_none()
            if existing_apt:
                return BookingResult(
                    success=True,
                    appointment_id=str(existing_apt.id),
                    doctor_id=str(existing_apt.doctor_id),
                    doctor_name=existing_apt.doctor.user.full_name if (existing_apt.doctor and existing_apt.doctor.user) else "Doctor",
                    patient_id=str(existing_apt.patient_id),
                    patient_name=existing_apt.patient.name if existing_apt.patient else "Patient",
                    appointment_date=str(existing_apt.appointment_date),
                    start_time=f"{existing_apt.start_time.hour:02d}:{existing_apt.start_time.minute:02d}",
                    end_time=f"{existing_apt.end_time.hour:02d}:{existing_apt.end_time.minute:02d}",
                    message="Existing booking returned via idempotency key.",
                )

        start_t = cls._parse_time(start_time_str)

        # Reject past dates and already-elapsed times in the hospital's timezone
        tz_res = await db.execute(select(Tenant.timezone).where(Tenant.id == tenant_id))
        tz_row = tz_res.scalar_one_or_none()
        tenant_tz_name = tz_row if isinstance(tz_row, str) else "Asia/Kolkata"
        now_local = get_tenant_now(tenant_tz_name)
        if appointment_date < now_local.date() or (
            appointment_date == now_local.date()
            and _time_to_minutes(start_t) <= (now_local.hour * 60 + now_local.minute)
        ):
            return BookingResult(
                success=False,
                error_code="INVALID_PAST_SLOT",
                message="Cannot schedule an appointment in the past. Please choose a future date and time.",
            )

        try:
            # 3. Lock Doctor row within transaction to prevent race conditions
            doc_query = (
                select(Doctor)
                .options(selectinload(Doctor.user), selectinload(Doctor.availabilities))
                .where(Doctor.id == doctor_id)
                .where(Doctor.tenant_id == tenant_id)
                .where(Doctor.is_active)
                .with_for_update()
            )
            doc_res = await db.execute(doc_query)
            doctor = doc_res.scalar_one_or_none()

            if not doctor:
                return BookingResult(
                    success=False,
                    error_code="DOCTOR_NOT_FOUND",
                    message="Doctor not found or inactive in this hospital.",
                )

            # Enforce strict tenant isolation for the patient record as well
            pat_res = await db.execute(
                select(Patient)
                .where(Patient.id == patient_id)
                .where(Patient.tenant_id == tenant_id)
            )
            patient = pat_res.scalar_one_or_none()
            if not patient:
                return BookingResult(
                    success=False,
                    error_code="PATIENT_NOT_FOUND",
                    message="Patient record not found in this hospital.",
                )

            # Calculate end time based on slot duration
            duration = doctor.slot_duration_minutes or 30
            start_min = _time_to_minutes(start_t)
            end_min = start_min + duration
            end_t = _minutes_to_time(end_min)

            # 4. Check real-time slot availability
            free_slots = await AvailabilityService.get_doctor_available_slots(
                db, tenant_id, doctor_id, appointment_date
            )
            requested_slot_str = f"{start_t.hour:02d}:{start_t.minute:02d}"
            matching_slot = any(s.start_time == requested_slot_str for s in free_slots)

            if not matching_slot:
                alt_slots = [s.formatted for s in free_slots[:4]]
                return BookingResult(
                    success=False,
                    error_code="SLOT_CONFLICT",
                    message=f"The requested slot at {_format_time_ampm(start_t)} is no longer available.",
                    alternative_slots=alt_slots,
                )

            # Build timezone-aware UTC range from tenant local date + time for PostgreSQL GiST exclusion
            tenant_tz = get_tenant_tz(tenant_tz_name)
            start_dt = datetime.combine(appointment_date, start_t, tzinfo=tenant_tz).astimezone(timezone.utc)
            end_dt = datetime.combine(appointment_date, end_t, tzinfo=tenant_tz).astimezone(timezone.utc)
            try:
                from asyncpg import Range as AsyncpgRange
                tstz_range: Any = AsyncpgRange(start_dt, end_dt, lower_inc=True, upper_inc=False)
            except ImportError:
                tstz_range = (start_dt, end_dt)

            # 5. Insert Appointment Record
            apt = Appointment(
                id=uuid.uuid4(),
                tenant_id=tenant_id,
                doctor_id=doctor_id,
                patient_id=patient_id,
                appointment_date=appointment_date,
                start_time=start_t,
                end_time=end_t,
                appointment_range=tstz_range,
                status="confirmed",
                idempotency_key=idempotency_key,
                source=source,
                notes=notes,
            )
            db.add(apt)
            if commit:
                await db.commit()
                await db.refresh(apt)
            else:
                flush_fn = getattr(db, "flush", None)
                if callable(flush_fn):
                    await flush_fn()

            doctor_name = doctor.user.full_name if (doctor and doctor.user) else "Doctor"
            patient_name = patient.name if patient else "Patient"
            patient_phone = patient.phone if patient else ""

            # Dispatch appointment event to active hospital connectors only after commit
            if commit:
                try:
                    from app.services.healthcare.connector_sync_service import ConnectorSyncService
                    await ConnectorSyncService.dispatch_appointment_created(
                        db=db,
                        tenant_id=tenant_id,
                        appointment_data={
                            "appointment_id": str(apt.id),
                            "doctor_id": str(doctor_id),
                            "doctor_name": doctor_name,
                            "patient_id": str(patient_id),
                            "patient_name": patient_name,
                            "patient_phone": patient_phone,
                            "appointment_date": str(appointment_date),
                            "start_time": f"{start_t.hour:02d}:{start_t.minute:02d}",
                            "end_time": f"{end_t.hour:02d}:{end_t.minute:02d}",
                            "status": "confirmed",
                            "notes": notes,
                        },
                    )
                except Exception as sync_err:
                    logger.warning("Non-blocking external connector sync error: %s", sync_err)

            return BookingResult(
                success=True,
                appointment_id=str(apt.id),
                doctor_id=str(doctor_id),
                doctor_name=doctor_name,
                patient_id=str(patient_id),
                patient_name=patient_name,
                appointment_date=str(appointment_date),
                start_time=f"{start_t.hour:02d}:{start_t.minute:02d}",
                end_time=f"{end_t.hour:02d}:{end_t.minute:02d}",
                message=f"Appointment successfully confirmed with {doctor_name} on {appointment_date} at {_format_time_ampm(start_t)}.",
            )

        except IntegrityError as exc:
            await db.rollback()
            logger.warning("Appointment booking conflict or constraint violation: %s", exc)
            # Fetch alternative slots for recovery
            free_slots = await AvailabilityService.get_doctor_available_slots(
                db, tenant_id, doctor_id, appointment_date
            )
            alt_slots = [s.formatted for s in free_slots[:4]]
            return BookingResult(
                success=False,
                error_code="SLOT_CONFLICT",
                message="This slot was just reserved by another patient.",
                alternative_slots=alt_slots,
            )

    @classmethod
    async def cancel_appointment(
        cls,
        db: AsyncSession,
        tenant_id: uuid.UUID,
        appointment_id: uuid.UUID,
        *,
        reason: Optional[str] = None,
        session_state: Optional[ConversationState] = None,
    ) -> Dict[str, Any]:
        """Cancel an appointment and release its reserved slot."""
        query = (
            select(Appointment)
            .options(selectinload(Appointment.doctor).selectinload(Doctor.user))
            .where(Appointment.id == appointment_id)
            .where(Appointment.tenant_id == tenant_id)
        )
        res = await db.execute(query)
        apt = res.scalar_one_or_none()

        if not apt:
            return {"success": False, "error": "Appointment not found."}

        if apt.status == "cancelled":
            return {"success": True, "message": "Appointment is already cancelled."}

        # Check patient authorization
        if session_state is not None and not session_state.is_verified_for_patient(str(apt.patient_id)):
            return {
                "success": False,
                "error": "You must be verified as the registered patient to cancel this appointment.",
            }

        apt.status = "cancelled"
        if reason:
            apt.notes = f"{apt.notes or ''} [Cancelled: {reason}]".strip()

        await db.commit()
        await db.refresh(apt)

        doc_name = apt.doctor.user.full_name if (apt.doctor and apt.doctor.user) else "Doctor"
        return {
            "success": True,
            "appointment_id": str(apt.id),
            "message": f"Appointment with {doc_name} on {apt.appointment_date} has been cancelled.",
        }

    @classmethod
    async def reschedule_appointment(
        cls,
        db: AsyncSession,
        tenant_id: uuid.UUID,
        appointment_id: uuid.UUID,
        new_date: date,
        new_start_time_str: str,
        *,
        session_state: Optional[ConversationState] = None,
    ) -> BookingResult:
        """Atomically reschedule an appointment to a new slot.

        Guarantees that the existing appointment is NOT lost if the new slot fails validation.
        """
        query = (
            select(Appointment)
            .where(Appointment.id == appointment_id)
            .where(Appointment.tenant_id == tenant_id)
        )
        res = await db.execute(query)
        apt = res.scalar_one_or_none()

        if not apt:
            return BookingResult(success=False, error_code="NOT_FOUND", message="Appointment not found.")

        # Re-verify patient
        if session_state is not None and not session_state.is_verified_for_patient(str(apt.patient_id)):
            return BookingResult(
                success=False,
                error_code="UNVERIFIED",
                message="Patient identity must be verified to reschedule an appointment.",
            )

        # Attempt to book new slot within the same DB transaction first (commit=False flushes & validates GiST)
        new_booking = await cls.book_appointment(
            db=db,
            tenant_id=tenant_id,
            patient_id=apt.patient_id,
            doctor_id=apt.doctor_id,
            appointment_date=new_date,
            start_time_str=new_start_time_str,
            source=apt.source,
            session_state=session_state,
            commit=False,
        )

        if not new_booking.success:
            return new_booking  # Keep original appointment intact

        # Cancel old appointment and commit both state changes atomically in one transaction
        apt.status = "cancelled"
        apt.notes = f"{apt.notes or ''} [Rescheduled to {new_booking.appointment_id}]".strip()
        try:
            await db.commit()
        except Exception as exc:
            await db.rollback()
            logger.error("Atomic reschedule commit failed: %s", exc)
            return BookingResult(
                success=False,
                error_code="SLOT_CONFLICT",
                message="Could not finalize reschedule. Your original appointment remains unchanged.",
            )

        try:
            from app.services.healthcare.connector_sync_service import ConnectorSyncService
            pat_res = await db.execute(select(Patient).where(Patient.id == apt.patient_id))
            pat = pat_res.scalar_one_or_none()
            await ConnectorSyncService.dispatch_appointment_created(
                db=db,
                tenant_id=tenant_id,
                appointment_data={
                    "appointment_id": str(new_booking.appointment_id),
                    "doctor_id": str(apt.doctor_id),
                    "doctor_name": new_booking.doctor_name or "Doctor",
                    "patient_id": str(apt.patient_id),
                    "patient_name": new_booking.patient_name or (pat.name if pat else "Patient"),
                    "patient_phone": pat.phone if pat else "",
                    "appointment_date": str(new_date),
                    "start_time": new_booking.start_time,
                    "end_time": new_booking.end_time,
                    "status": "confirmed",
                    "notes": f"Rescheduled from {apt.id}",
                },
            )
        except Exception as sync_err:
            logger.warning("Non-blocking external connector sync error on reschedule: %s", sync_err)

        return BookingResult(
            success=True,
            appointment_id=new_booking.appointment_id,
            doctor_id=new_booking.doctor_id,
            doctor_name=new_booking.doctor_name,
            patient_id=new_booking.patient_id,
            patient_name=new_booking.patient_name,
            appointment_date=str(new_date),
            start_time=new_booking.start_time,
            end_time=new_booking.end_time,
            message=f"Appointment successfully rescheduled to {new_date} at {new_booking.start_time}.",
        )

    @staticmethod
    async def get_patient_appointments(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        patient_id: uuid.UUID,
        *,
        session_state: Optional[ConversationState] = None,
    ) -> List[Dict[str, Any]]:
        """Retrieve appointment history for an identity-verified patient."""
        if session_state is not None and not session_state.is_verified_for_patient(str(patient_id)):
            return []

        query = (
            select(Appointment)
            .options(selectinload(Appointment.doctor).selectinload(Doctor.user))
            .where(Appointment.tenant_id == tenant_id)
            .where(Appointment.patient_id == patient_id)
            .order_by(Appointment.appointment_date.desc(), Appointment.start_time.desc())
        )
        res = await db.execute(query)
        appointments = res.scalars().all()

        return [
            {
                "appointment_id": str(a.id),
                "doctor_name": a.doctor.user.full_name if (a.doctor and a.doctor.user) else "Doctor",
                "specialization": a.doctor.specialization if a.doctor else "General",
                "appointment_date": str(a.appointment_date),
                "start_time": f"{a.start_time.hour:02d}:{a.start_time.minute:02d}",
                "formatted_time": _format_time_ampm(a.start_time),
                "status": a.status,
            }
            for a in appointments
        ]
