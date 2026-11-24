"""Tenants API Router for profile and operating hours."""

from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_tenant, require_write_permission
from app.database.session import get_db
from app.models.operating_hours import HospitalOperatingHours
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.tenant import (
    OperatingHoursItem,
    TenantRead,
    TenantUpdate,
)
from app.api.v1.onboarding import parse_time_str, serialize_operating_hours

router = APIRouter(prefix="/tenants", tags=["Tenants Management"])


@router.get(
    "/me",
    response_model=TenantRead,
    summary="Get current tenant hospital details and operating hours",
)
async def get_current_tenant_profile(
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
    "/me",
    response_model=TenantRead,
    summary="Update current tenant hospital contact details and address (PATCH)",
)
@router.put(
    "/me",
    response_model=TenantRead,
    summary="Update current tenant hospital contact details and address (PUT)",
)
async def update_current_tenant_profile(
    payload: TenantUpdate,
    tenant: Tenant = Depends(get_current_tenant),
    admin_user: User = Depends(require_write_permission),
    db: AsyncSession = Depends(get_db),
) -> TenantRead:
    """Update tenant profile attributes."""
    if payload.name is not None:
        tenant.name = payload.name
    if payload.phone_number is not None:
        tenant.phone_number = payload.phone_number
    if payload.emergency_contact is not None:
        tenant.emergency_contact = payload.emergency_contact
    if payload.address is not None:
        tenant.address = payload.address
    if payload.timezone is not None:
        tenant.timezone = payload.timezone

    await db.commit()
    await db.refresh(tenant)

    hours_result = await db.execute(
        select(HospitalOperatingHours)
        .where(HospitalOperatingHours.tenant_id == tenant.id)
        .order_by(HospitalOperatingHours.day_of_week)
    )
    operating_hours = list(hours_result.scalars().all())

    tenant_read = TenantRead.model_validate(tenant)
    tenant_read.operating_hours = serialize_operating_hours(operating_hours)
    return tenant_read


@router.get(
    "/me/operating-hours",
    response_model=List[OperatingHoursItem],
    summary="Get 7-day operating hours for current hospital",
)
async def get_current_tenant_hours(
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
) -> List[OperatingHoursItem]:
    """Fetch operating hours."""
    hours_result = await db.execute(
        select(HospitalOperatingHours)
        .where(HospitalOperatingHours.tenant_id == tenant.id)
        .order_by(HospitalOperatingHours.day_of_week)
    )
    return serialize_operating_hours(list(hours_result.scalars().all()))


@router.patch(
    "/me/operating-hours",
    response_model=List[OperatingHoursItem],
    summary="Update 7-day operating hours for current hospital (PATCH)",
)
@router.put(
    "/me/operating-hours",
    response_model=List[OperatingHoursItem],
    summary="Update 7-day operating hours for current hospital (PUT)",
)
async def update_current_tenant_hours(
    payload: List[OperatingHoursItem],
    tenant: Tenant = Depends(get_current_tenant),
    admin_user: User = Depends(require_write_permission),
    db: AsyncSession = Depends(get_db),
) -> List[OperatingHoursItem]:
    """Update or insert 7-day operating hours."""
    for item in payload:
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

    hours_result = await db.execute(
        select(HospitalOperatingHours)
        .where(HospitalOperatingHours.tenant_id == tenant.id)
        .order_by(HospitalOperatingHours.day_of_week)
    )
    return serialize_operating_hours(list(hours_result.scalars().all()))
