"""Hospital Onboarding Canvas Workflow API Router."""

from datetime import time
from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_tenant, get_current_user, require_write_permission
from app.database.session import get_db
from app.models.doctor import Doctor
from app.models.operating_hours import HospitalOperatingHours
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.tenant import (
    HospitalProfileUpdate,
    OnboardingStatusResponse,
    OperatingHoursItem,
    TenantRead,
)

router = APIRouter(prefix="/onboarding", tags=["Hospital Onboarding Canvas"])


def parse_time_str(val: Any) -> Optional[time]:
    """Parse 'HH:MM' or 'HH:MM:SS' string or time object to time object."""
    if not val:
        return None
    if isinstance(val, time):
        return val
    parts = str(val).strip().split(":")
    return time(int(parts[0]), int(parts[1]))


def serialize_operating_hours(hours: List[HospitalOperatingHours]) -> List[OperatingHoursItem]:
    """Helper to convert ORM hours to schema representation."""
    return [
        OperatingHoursItem(
            day_of_week=h.day_of_week,
            open_time=h.open_time.strftime("%H:%M") if h.open_time else None,
            close_time=h.close_time.strftime("%H:%M") if h.close_time else None,
            is_closed=h.is_closed,
        )
        for h in hours
    ]


@router.get(
    "/status",
    response_model=OnboardingStatusResponse,
    summary="Get current hospital onboarding progress and completion status",
)
async def get_onboarding_status(
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
) -> OnboardingStatusResponse:
    """Returns the current onboarding step, completion flags, and doctor counts."""
    # Count active doctors
    doctors_count_result = await db.execute(
        select(func.count(Doctor.id)).where(Doctor.tenant_id == tenant.id, Doctor.is_active.is_(True))
    )
    doctors_count = doctors_count_result.scalar() or 0

    profile_complete = bool(tenant.phone_number or tenant.address)

    hours_result = await db.execute(
        select(func.count(HospitalOperatingHours.id)).where(
            HospitalOperatingHours.tenant_id == tenant.id
        )
    )
    hours_count = hours_result.scalar() or 0

    return OnboardingStatusResponse(
        onboarding_status=tenant.onboarding_status,
        hospital_name=tenant.name,
        hospital_id=tenant.id,
        profile_complete=profile_complete,
        operating_hours_configured=hours_count > 0,
        doctors_count=doctors_count,
    )


@router.get(
    "/hospital-profile",
    response_model=TenantRead,
    summary="Get current hospital profile, address, contact numbers, and 7-day operating hours",
)
async def get_hospital_profile(
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
) -> TenantRead:
    """Fetch current hospital profile and 7-day operating schedule."""
    hours_result = await db.execute(
        select(HospitalOperatingHours)
        .where(HospitalOperatingHours.tenant_id == tenant.id)
        .order_by(HospitalOperatingHours.day_of_week)
    )
    operating_hours = list(hours_result.scalars().all())

    tenant_read = TenantRead.model_validate(tenant)
    tenant_read.operating_hours = serialize_operating_hours(operating_hours)
    return tenant_read


@router.patch(
    "/hospital-profile",
    response_model=TenantRead,
    summary="Update hospital profile, address, contact numbers, and 7-day operating hours (PATCH)",
)
@router.put(
    "/hospital-profile",
    response_model=TenantRead,
    summary="Update hospital profile, address, contact numbers, and 7-day operating hours (PUT)",
)
async def update_hospital_profile(
    payload: HospitalProfileUpdate,
    tenant: Tenant = Depends(get_current_tenant),
    admin_user: User = Depends(require_write_permission),
    db: AsyncSession = Depends(get_db),
) -> TenantRead:
    """Step 2 of Onboarding Canvas.

    Updates optional hospital contact details (reception, emergency phone, address)
    and saves the 7-day operating schedule.
    """
    if payload.phone_number is not None:
        tenant.phone_number = payload.phone_number
    if payload.emergency_contact is not None:
        tenant.emergency_contact = payload.emergency_contact
    if payload.address is not None:
        tenant.address = payload.address
    if payload.timezone is not None:
        tenant.timezone = payload.timezone

    # Update or insert operating hours
    if payload.operating_hours is not None:
        for item in payload.operating_hours:
            existing = await db.execute(
                select(HospitalOperatingHours).where(
                    HospitalOperatingHours.tenant_id == tenant.id,
                    HospitalOperatingHours.day_of_week == item.day_of_week,
                )
            )
            record = existing.scalar_one_or_none()
            open_t = parse_time_str(item.open_time) if (item.open_time and not item.is_closed) else None
            close_t = parse_time_str(item.close_time) if (item.close_time and not item.is_closed) else None

            if record:
                record.open_time = open_t
                record.close_time = close_t
                record.is_closed = item.is_closed
            else:
                new_h = HospitalOperatingHours(
                    tenant_id=tenant.id,
                    day_of_week=item.day_of_week,
                    open_time=open_t,
                    close_time=close_t,
                    is_closed=item.is_closed,
                )
                db.add(new_h)

    await db.commit()
    await db.refresh(tenant)

    # Fetch updated hours
    hours_result = await db.execute(
        select(HospitalOperatingHours)
        .where(HospitalOperatingHours.tenant_id == tenant.id)
        .order_by(HospitalOperatingHours.day_of_week)
    )
    operating_hours = list(hours_result.scalars().all())

    tenant_read = TenantRead.model_validate(tenant)
    tenant_read.operating_hours = serialize_operating_hours(operating_hours)
    return tenant_read


@router.post(
    "/complete",
    response_model=OnboardingStatusResponse,
    summary="Mark the hospital onboarding workflow as completed",
)
async def complete_onboarding(
    tenant: Tenant = Depends(get_current_tenant),
    admin_user: User = Depends(require_write_permission),
    db: AsyncSession = Depends(get_db),
) -> OnboardingStatusResponse:
    """Step 4 of Onboarding Canvas. Marks onboarding as COMPLETED."""
    tenant.onboarding_status = "COMPLETED"
    await db.commit()
    await db.refresh(tenant)

    doctors_count_result = await db.execute(
        select(func.count(Doctor.id)).where(Doctor.tenant_id == tenant.id, Doctor.is_active.is_(True))
    )
    doctors_count = doctors_count_result.scalar() or 0

    return OnboardingStatusResponse(
        onboarding_status=tenant.onboarding_status,
        hospital_name=tenant.name,
        hospital_id=tenant.id,
        profile_complete=bool(tenant.phone_number or tenant.address),
        operating_hours_configured=True,
        doctors_count=doctors_count,
    )
