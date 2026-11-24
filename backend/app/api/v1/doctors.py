"""Doctors & Availability CRUD API Router."""

import uuid
from datetime import time
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.api.deps import get_current_tenant, require_write_permission
from app.core.exceptions import ConflictException, NotFoundException
from app.core.security import hash_password
from app.database.session import get_db
from app.models.doctor import Doctor, DoctorAvailability
from app.models.enums import TenantRole, UserStatus
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.doctor import (
    BulkAvailabilityUpdate,
    DoctorAvailabilityItem,
    DoctorCreate,
    DoctorRead,
    DoctorUpdate,
)

router = APIRouter(prefix="/doctors", tags=["Doctors & Availability Management"])


def parse_time_str(val: str) -> time:
    """Parse 'HH:MM' string to time object."""
    parts = val.strip().split(":")
    return time(int(parts[0]), int(parts[1]))


def serialize_doctor(doctor: Doctor) -> DoctorRead:
    """Helper to convert Doctor ORM entity to DoctorRead schema."""
    availabilities = [
        DoctorAvailabilityItem(
            day_of_week=a.day_of_week,
            start_time=a.start_time.strftime("%H:%M"),
            end_time=a.end_time.strftime("%H:%M"),
            is_available=a.is_available,
        )
        for a in (doctor.availabilities or [])
    ]
    return DoctorRead(
        id=doctor.id,
        tenant_id=doctor.tenant_id,
        user_id=doctor.user_id,
        full_name=doctor.user.full_name if doctor.user else "Unknown Doctor",
        email=doctor.user.email if doctor.user else "",
        specialization=doctor.specialization,
        department=doctor.department,
        slot_duration_minutes=doctor.slot_duration_minutes,
        consultation_fee=float(doctor.consultation_fee) if doctor.consultation_fee is not None else None,
        is_active=doctor.is_active,
        status=doctor.user.status.value if doctor.user else "invited",
        availabilities=availabilities,
        created_at=doctor.created_at,
        updated_at=doctor.updated_at,
    )


@router.get(
    "",
    response_model=List[DoctorRead],
    summary="List all doctors for the current hospital tenant",
)
async def list_doctors(
    specialization: Optional[str] = Query(None, description="Filter by specialty"),
    search: Optional[str] = Query(None, description="Search by doctor name or specialty"),
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
) -> List[DoctorRead]:
    """Retrieve all onboarded doctors and their working shifts."""
    query = (
        select(Doctor)
        .options(selectinload(Doctor.user), selectinload(Doctor.availabilities))
        .where(Doctor.tenant_id == tenant.id, Doctor.is_active.is_(True))
        .order_by(Doctor.created_at.desc())
    )

    if specialization:
        query = query.where(Doctor.specialization.ilike(f"%{specialization}%"))

    result = await db.execute(query)
    doctors = list(result.scalars().all())

    if search:
        term = search.lower()
        doctors = [
            d for d in doctors
            if (term in d.specialization.lower())
            or (d.user and (term in d.user.full_name.lower() or term in d.user.email.lower()))
        ]

    return [serialize_doctor(d) for d in doctors]


@router.post(
    "",
    response_model=DoctorRead,
    status_code=status.HTTP_201_CREATED,
    summary="Invite and onboard a new doctor with availability shifts",
)
async def create_doctor(
    payload: DoctorCreate,
    tenant: Tenant = Depends(get_current_tenant),
    admin_user: User = Depends(require_write_permission),
    db: AsyncSession = Depends(get_db),
) -> DoctorRead:
    """Step 3 of Onboarding Canvas (or subsequent CRUD).

    1. Normalizes doctor identity by creating or resolving a User record.
    2. Creates the Doctor clinical resource entity.
    3. Saves weekly availability shifts.
    """
    clean_email = payload.email.lower()

    # 1. Check if user already exists
    user_result = await db.execute(select(User).where(User.email == clean_email))
    user = user_result.scalar_one_or_none()

    if user:
        if user.tenant_id != tenant.id:
            raise ConflictException("A user with this email is registered with another organization.")
        # Check if already a doctor in this tenant
        doc_result = await db.execute(
            select(Doctor).where(Doctor.tenant_id == tenant.id, Doctor.user_id == user.id)
        )
        if doc_result.scalar_one_or_none():
            raise ConflictException("This doctor is already onboarded in your hospital.")
    else:
        # Create User account in INVITED state
        user = User(
            tenant_id=tenant.id,
            email=clean_email,
            hashed_password=hash_password(uuid.uuid4().hex[:12] + "Aa1!"),  # Temporary invite password
            full_name=payload.full_name,
            role=TenantRole.DOCTOR,
            status=UserStatus.INVITED,
        )
        db.add(user)
        await db.flush()

    # 2. Create Doctor Record
    doctor = Doctor(
        tenant_id=tenant.id,
        user_id=user.id,
        specialization=payload.specialization,
        department=payload.department,
        slot_duration_minutes=payload.slot_duration_minutes,
        consultation_fee=payload.consultation_fee,
        is_active=True,
    )
    db.add(doctor)
    await db.flush()

    # 3. Add Availabilities
    availabilities: List[DoctorAvailability] = []
    if payload.availabilities:
        for item in payload.availabilities:
            avail = DoctorAvailability(
                tenant_id=tenant.id,
                doctor_id=doctor.id,
                day_of_week=item.day_of_week,
                start_time=parse_time_str(item.start_time),
                end_time=parse_time_str(item.end_time),
                is_available=item.is_available,
            )
            availabilities.append(avail)
            db.add(avail)

    await db.commit()
    await db.refresh(doctor)
    doctor.user = user
    doctor.availabilities = availabilities

    return serialize_doctor(doctor)


@router.get(
    "/{doctor_id}",
    response_model=DoctorRead,
    summary="Get doctor details and schedule by ID",
)
async def get_doctor(
    doctor_id: uuid.UUID,
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
) -> DoctorRead:
    """Fetch single doctor profile and full shift schedule."""
    result = await db.execute(
        select(Doctor)
        .options(selectinload(Doctor.user), selectinload(Doctor.availabilities))
        .where(Doctor.id == doctor_id, Doctor.tenant_id == tenant.id, Doctor.is_active.is_(True))
    )
    doctor = result.scalar_one_or_none()
    if not doctor:
        raise NotFoundException("Doctor not found.")
    return serialize_doctor(doctor)


@router.patch(
    "/{doctor_id}",
    response_model=DoctorRead,
    summary="Update doctor profile details and shifts (PATCH)",
)
@router.put(
    "/{doctor_id}",
    response_model=DoctorRead,
    summary="Update doctor profile details and shifts (PUT)",
)
async def update_doctor(
    doctor_id: uuid.UUID,
    payload: DoctorUpdate,
    tenant: Tenant = Depends(get_current_tenant),
    admin_user: User = Depends(require_write_permission),
    db: AsyncSession = Depends(get_db),
) -> DoctorRead:
    """Update doctor metadata (specialization, fee, slot duration, name, shifts)."""
    result = await db.execute(
        select(Doctor)
        .options(selectinload(Doctor.user), selectinload(Doctor.availabilities))
        .where(Doctor.id == doctor_id, Doctor.tenant_id == tenant.id)
    )
    doctor = result.scalar_one_or_none()
    if not doctor:
        raise NotFoundException("Doctor not found.")

    if payload.specialization is not None:
        doctor.specialization = payload.specialization
    if payload.department is not None:
        doctor.department = payload.department
    if payload.slot_duration_minutes is not None:
        doctor.slot_duration_minutes = payload.slot_duration_minutes
    if payload.consultation_fee is not None:
        doctor.consultation_fee = payload.consultation_fee
    if payload.is_active is not None:
        doctor.is_active = payload.is_active

    if payload.full_name is not None and doctor.user:
        doctor.user.full_name = payload.full_name

    # Handle shifts/availabilities update if provided
    if payload.availabilities is not None:
        existing_availabilities = await db.execute(
            select(DoctorAvailability).where(DoctorAvailability.doctor_id == doctor.id)
        )
        for a in existing_availabilities.scalars().all():
            await db.delete(a)

        new_availabilities: List[DoctorAvailability] = []
        for item in payload.availabilities:
            avail = DoctorAvailability(
                tenant_id=tenant.id,
                doctor_id=doctor.id,
                day_of_week=item.day_of_week,
                start_time=parse_time_str(item.start_time),
                end_time=parse_time_str(item.end_time),
                is_available=item.is_available,
            )
            new_availabilities.append(avail)
            db.add(avail)
        doctor.availabilities = new_availabilities

    await db.commit()
    await db.refresh(doctor)
    return serialize_doctor(doctor)


@router.delete(
    "/{doctor_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete or deactivate a doctor",
)
async def delete_doctor(
    doctor_id: uuid.UUID,
    tenant: Tenant = Depends(get_current_tenant),
    admin_user: User = Depends(require_write_permission),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Deactivates a doctor from the hospital roster."""
    result = await db.execute(
        select(Doctor).where(Doctor.id == doctor_id, Doctor.tenant_id == tenant.id)
    )
    doctor = result.scalar_one_or_none()
    if not doctor:
        raise NotFoundException("Doctor not found.")

    doctor.is_active = False
    await db.commit()


@router.patch(
    "/{doctor_id}/availability",
    response_model=DoctorRead,
    summary="Bulk update weekly availability shifts for a doctor (PATCH)",
)
@router.put(
    "/{doctor_id}/availability",
    response_model=DoctorRead,
    summary="Bulk update weekly availability shifts for a doctor (PUT)",
)
async def update_doctor_availability(
    doctor_id: uuid.UUID,
    payload: BulkAvailabilityUpdate,
    tenant: Tenant = Depends(get_current_tenant),
    admin_user: User = Depends(require_write_permission),
    db: AsyncSession = Depends(get_db),
) -> DoctorRead:
    """Replaces all existing availability shifts with the new schedule list."""
    result = await db.execute(
        select(Doctor)
        .options(selectinload(Doctor.user), selectinload(Doctor.availabilities))
        .where(Doctor.id == doctor_id, Doctor.tenant_id == tenant.id, Doctor.is_active.is_(True))
    )
    doctor = result.scalar_one_or_none()
    if not doctor:
        raise NotFoundException("Doctor not found.")

    # Remove old availabilities
    existing_availabilities = await db.execute(
        select(DoctorAvailability).where(DoctorAvailability.doctor_id == doctor.id)
    )
    for a in existing_availabilities.scalars().all():
        await db.delete(a)

    # Insert new
    new_availabilities: List[DoctorAvailability] = []
    for item in payload.availabilities:
        avail = DoctorAvailability(
            tenant_id=tenant.id,
            doctor_id=doctor.id,
            day_of_week=item.day_of_week,
            start_time=parse_time_str(item.start_time),
            end_time=parse_time_str(item.end_time),
            is_available=item.is_available,
        )
        new_availabilities.append(avail)
        db.add(avail)

    await db.commit()
    await db.refresh(doctor)
    doctor.availabilities = new_availabilities
    return serialize_doctor(doctor)
