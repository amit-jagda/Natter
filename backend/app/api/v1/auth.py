"""Authentication & Hospital Registration API Router."""

import re
import uuid
from datetime import time
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_tenant, get_current_user
from app.core.exceptions import ConflictException, UnauthorizedException
from app.core.security import create_access_token, hash_password, verify_password
from app.database.session import get_db
from app.models.enums import TenantRole, UserStatus
from app.models.operating_hours import HospitalOperatingHours
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.auth import AuthResponse, HospitalRegisterRequest, LoginRequest
from app.schemas.tenant import OperatingHoursItem, TenantRead
from app.schemas.user import UserRead

router = APIRouter(prefix="/auth", tags=["Authentication & Onboarding"])


def generate_slug(name: str) -> str:
    """Create a URL-safe lowercase slug from a name."""
    clean = re.sub(r"[^\w\s-]", "", name).strip().lower()
    return re.sub(r"[-\s]+", "-", clean)


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


@router.post(
    "/register-hospital",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new hospital organization and primary admin",
)
async def register_hospital(
    payload: HospitalRegisterRequest,
    db: AsyncSession = Depends(get_db),
) -> AuthResponse:
    """Step 1 of the Onboarding Canvas.

    Creates the Hospital Tenant, initializes default weekly operating hours (Mon-Sat 9am-8pm),
    and sets up the primary Admin account with JWT credentials.
    """
    # 1. Resolve slug uniqueness
    base_slug = payload.slug or generate_slug(payload.hospital_name)
    slug = base_slug
    counter = 1
    while True:
        existing_tenant = await db.execute(select(Tenant).where(Tenant.slug == slug))
        if not existing_tenant.scalar_one_or_none():
            break
        slug = f"{base_slug}-{counter}"
        counter += 1

    # 2. Check if admin email is already registered anywhere
    existing_user = await db.execute(select(User).where(User.email == payload.admin_email.lower()))
    if existing_user.scalar_one_or_none():
        raise ConflictException("An account with this email address already exists.")

    # 3. Create Tenant
    tenant = Tenant(
        name=payload.hospital_name,
        slug=slug,
        onboarding_status="IN_PROGRESS",
    )
    db.add(tenant)
    await db.flush()

    # 4. Initialize Default 7-day Hospital Operating Hours (Mon-Sat 09:00 - 20:00, Sun Closed)
    default_hours: List[HospitalOperatingHours] = []
    for day in range(7):
        is_sun = day == 6
        h = HospitalOperatingHours(
            tenant_id=tenant.id,
            day_of_week=day,
            open_time=None if is_sun else time(9, 0),
            close_time=None if is_sun else time(20, 0),
            is_closed=is_sun,
        )
        default_hours.append(h)
        db.add(h)

    # 5. Create Admin User
    admin_user = User(
        tenant_id=tenant.id,
        email=payload.admin_email.lower(),
        hashed_password=hash_password(payload.password),
        full_name=payload.admin_name,
        role=TenantRole.ADMIN,
        status=UserStatus.ACTIVE,
    )
    db.add(admin_user)
    await db.commit()
    await db.refresh(tenant)
    await db.refresh(admin_user)

    # 6. Issue JWT Token
    token = create_access_token(
        subject=str(admin_user.id),
        tenant_id=str(tenant.id),
        role=admin_user.role.value,
    )

    tenant_read = TenantRead.model_validate(tenant)
    tenant_read.operating_hours = serialize_operating_hours(default_hours)

    return AuthResponse(
        access_token=token,
        token_type="bearer",
        user=UserRead.model_validate(admin_user),
        tenant=tenant_read,
    )


@router.post(
    "/login",
    response_model=AuthResponse,
    summary="Authenticate with email and password",
)
async def login(
    payload: LoginRequest,
    db: AsyncSession = Depends(get_db),
) -> AuthResponse:
    """Authenticate an existing hospital user and return access token with tenant context."""
    result = await db.execute(
        select(User).where(User.email == payload.email.lower(), User.is_active.is_(True))
    )
    user = result.scalar_one_or_none()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise UnauthorizedException("Invalid email or password.")

    # Load tenant and operating hours
    tenant_result = await db.execute(select(Tenant).where(Tenant.id == user.tenant_id))
    tenant = tenant_result.scalar_one_or_none()
    if not tenant or not tenant.is_active:
        raise UnauthorizedException("Associated hospital account is inactive or suspended.")

    hours_result = await db.execute(
        select(HospitalOperatingHours)
        .where(HospitalOperatingHours.tenant_id == tenant.id)
        .order_by(HospitalOperatingHours.day_of_week)
    )
    operating_hours = list(hours_result.scalars().all())

    token = create_access_token(
        subject=str(user.id),
        tenant_id=str(tenant.id),
        role=user.role.value,
    )

    tenant_read = TenantRead.model_validate(tenant)
    tenant_read.operating_hours = serialize_operating_hours(operating_hours)

    return AuthResponse(
        access_token=token,
        token_type="bearer",
        user=UserRead.model_validate(user),
        tenant=tenant_read,
    )


@router.get(
    "/me",
    response_model=AuthResponse,
    summary="Get current authenticated user and hospital tenant info",
)
async def get_me(
    current_user: User = Depends(get_current_user),
    current_tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
) -> AuthResponse:
    """Fetch current user session details and operating hours."""
    hours_result = await db.execute(
        select(HospitalOperatingHours)
        .where(HospitalOperatingHours.tenant_id == current_tenant.id)
        .order_by(HospitalOperatingHours.day_of_week)
    )
    operating_hours = list(hours_result.scalars().all())

    token = create_access_token(
        subject=str(current_user.id),
        tenant_id=str(current_tenant.id),
        role=current_user.role.value,
    )

    tenant_read = TenantRead.model_validate(current_tenant)
    tenant_read.operating_hours = serialize_operating_hours(operating_hours)

    return AuthResponse(
        access_token=token,
        token_type="bearer",
        user=UserRead.model_validate(current_user),
        tenant=tenant_read,
    )
