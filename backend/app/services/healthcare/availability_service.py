"""Healthcare Dynamic Availability and Discovery Service.

Calculates actual, real-time consultation slot matrices by combining:
1. Hospital facility operating hours.
2. Doctor weekly recurring shifts.
3. Doctor scheduled leaves and absence exceptions.
4. Active booked appointments from PostgreSQL.
"""

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone, tzinfo
import logging
from typing import Any, Dict, List, Optional
import uuid
from zoneinfo import ZoneInfo

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.appointment import Appointment
from app.models.doctor import Doctor, DoctorAvailability
from app.models.doctor_leave import DoctorLeave
from app.models.operating_hours import HospitalOperatingHours
from app.models.tenant import Tenant
from app.models.user import User

logger = logging.getLogger(__name__)

_TZ_FALLBACK_OFFSETS = {
    "asia/kolkata": timedelta(hours=5, minutes=30),
    "asia/calcutta": timedelta(hours=5, minutes=30),
    "ist": timedelta(hours=5, minutes=30),
    "utc": timedelta(0),
}


def get_tenant_tz(tz_name: Optional[str]) -> tzinfo:
    """Resolve an IANA timezone cleanly with safe fixed-offset fallback if tzdata is absent."""
    clean = (tz_name or "Asia/Kolkata").strip() or "Asia/Kolkata"
    try:
        return ZoneInfo(clean)
    except Exception:
        offset = _TZ_FALLBACK_OFFSETS.get(clean.lower())
        if offset is not None:
            return timezone(offset)
        return timezone.utc


def get_tenant_now(tz_name: Optional[str]) -> datetime:
    """Return current wall-clock datetime in the hospital tenant's timezone."""
    return datetime.now(tz=get_tenant_tz(tz_name))


@dataclass
class AvailableSlot:
    """Representation of an unbooked, open consultation slot."""
    start_time: str  # "HH:MM" 24h
    end_time: str    # "HH:MM" 24h
    formatted: str   # "10:00 AM"


def _time_to_minutes(t: time) -> int:
    return t.hour * 60 + t.minute


def _minutes_to_time(m: int) -> time:
    return time(hour=m // 60, minute=m % 60)


def _format_time_ampm(t: time) -> str:
    h = t.hour
    m = t.minute
    ampm = "AM" if h < 12 else "PM"
    h12 = h % 12
    if h12 == 0:
        h12 = 12
    return f"{h12}:{m:02d} {ampm}"


class AvailabilityService:
    """Calculates real-time appointment slot availability and handles doctor discovery."""

    @staticmethod
    async def get_doctor_available_slots(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        doctor_id: uuid.UUID,
        target_date: date,
    ) -> List[AvailableSlot]:
        """Compute all available appointment slots for a doctor on a specific date.

        Respects tenant timezone past-date/elapsed-slot guards, hospital operating hours,
        recurring doctor shifts, scheduled leaves, and existing uncancelled appointments.
        """
        tz_res = await db.execute(select(Tenant.timezone).where(Tenant.id == tenant_id))
        tz_row = tz_res.scalar_one_or_none()
        tenant_tz_name = tz_row if isinstance(tz_row, str) else "Asia/Kolkata"
        now_local = get_tenant_now(tenant_tz_name)

        if target_date < now_local.date():
            return []  # Do not expose slots on past calendar dates

        min_allowed_start_min: Optional[int] = None
        if target_date == now_local.date():
            min_allowed_start_min = now_local.hour * 60 + now_local.minute

        # Day of week in Python: 0=Monday, 6=Sunday
        day_of_week = target_date.weekday()

        # 1. Check Hospital Facility Operating Hours
        hosp_query = (
            select(HospitalOperatingHours)
            .where(HospitalOperatingHours.tenant_id == tenant_id)
            .where(HospitalOperatingHours.day_of_week == day_of_week)
        )
        hosp_res = await db.execute(hosp_query)
        hosp_hours = hosp_res.scalar_one_or_none()

        if hosp_hours and hosp_hours.is_closed:
            return []  # Hospital is closed on this day

        hosp_open_min = _time_to_minutes(hosp_hours.open_time) if (hosp_hours and hosp_hours.open_time) else 0
        hosp_close_min = _time_to_minutes(hosp_hours.close_time) if (hosp_hours and hosp_hours.close_time) else 24 * 60

        # 2. Fetch Doctor & Recurring Shifts
        doc_query = (
            select(Doctor)
            .options(selectinload(Doctor.availabilities), selectinload(Doctor.user))
            .where(Doctor.id == doctor_id)
            .where(Doctor.tenant_id == tenant_id)
            .where(Doctor.is_active == True)
        )
        doc_res = await db.execute(doc_query)
        doctor = doc_res.scalar_one_or_none()

        if not doctor:
            return []

        slot_duration = doctor.slot_duration_minutes or 30

        # Filter active shifts for this day of the week
        active_shifts = [
            a for a in doctor.availabilities
            if a.day_of_week == day_of_week and a.is_available
        ]
        if not active_shifts:
            return []  # Doctor has no scheduled shifts on this weekday

        # 3. Check Scheduled Doctor Leaves
        leave_query = (
            select(DoctorLeave)
            .where(DoctorLeave.doctor_id == doctor_id)
            .where(DoctorLeave.tenant_id == tenant_id)
            .where(DoctorLeave.leave_date == target_date)
        )
        leave_res = await db.execute(leave_query)
        leaves = leave_res.scalars().all()

        for l in leaves:
            if l.is_full_day:
                return []  # Doctor is on full-day leave

        # 4. Fetch Booked Appointments
        apt_query = (
            select(Appointment)
            .where(Appointment.doctor_id == doctor_id)
            .where(Appointment.tenant_id == tenant_id)
            .where(Appointment.appointment_date == target_date)
            .where(Appointment.status.in_(["confirmed", "pending"]))
        )
        apt_res = await db.execute(apt_query)
        appointments = apt_res.scalars().all()

        booked_ranges = [
            (_time_to_minutes(apt.start_time), _time_to_minutes(apt.end_time))
            for apt in appointments
        ]

        leave_ranges = [
            (_time_to_minutes(l.start_time), _time_to_minutes(l.end_time))
            for l in leaves
            if l.start_time and l.end_time
        ]

        # 5. Generate Free Slots
        available_slots: List[AvailableSlot] = []

        for shift in active_shifts:
            shift_start_min = max(_time_to_minutes(shift.start_time), hosp_open_min)
            shift_end_min = min(_time_to_minutes(shift.end_time), hosp_close_min)

            current_start_min = shift_start_min
            while current_start_min + slot_duration <= shift_end_min:
                current_end_min = current_start_min + slot_duration

                # Check conflict with leaves
                has_leave_conflict = any(
                    not (current_end_min <= l_start or current_start_min >= l_end)
                    for l_start, l_end in leave_ranges
                )

                # Check conflict with existing appointments
                has_apt_conflict = any(
                    not (current_end_min <= b_start or current_start_min >= b_end)
                    for b_start, b_end in booked_ranges
                )

                if min_allowed_start_min is not None and current_start_min <= min_allowed_start_min:
                    current_start_min += slot_duration
                    continue

                if not has_leave_conflict and not has_apt_conflict:
                    slot_t_start = _minutes_to_time(current_start_min)
                    slot_t_end = _minutes_to_time(current_end_min)
                    available_slots.append(
                        AvailableSlot(
                            start_time=f"{slot_t_start.hour:02d}:{slot_t_start.minute:02d}",
                            end_time=f"{slot_t_end.hour:02d}:{slot_t_end.minute:02d}",
                            formatted=_format_time_ampm(slot_t_start),
                        )
                    )

                current_start_min += slot_duration

        return available_slots

    @staticmethod
    async def search_doctors(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        *,
        specialization: Optional[str] = None,
        query: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Discover doctors by specialty or name within the hospital tenant."""
        stmt = (
            select(Doctor)
            .join(User, Doctor.user_id == User.id)
            .where(Doctor.tenant_id == tenant_id)
            .where(Doctor.is_active == True)
        )

        if specialization and specialization.strip():
            stmt = stmt.where(Doctor.specialization.ilike(f"%{specialization.strip()}%"))

        if query and query.strip():
            term = query.strip()
            stmt = stmt.where(
                or_(
                    User.full_name.ilike(f"%{term}%"),
                    Doctor.specialization.ilike(f"%{term}%"),
                    Doctor.department.ilike(f"%{term}%"),
                )
            )

        res = await db.execute(stmt)
        doctors = res.scalars().all()

        return [
            {
                "doctor_id": str(d.id),
                "name": d.user.full_name if d.user else "Doctor",
                "specialization": d.specialization,
                "department": d.department or "General OPD",
                "consultation_fee": float(d.consultation_fee) if d.consultation_fee else 0.0,
                "slot_duration_minutes": d.slot_duration_minutes,
            }
            for d in doctors
        ]
