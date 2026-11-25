"""Authentication & Hospital Registration API Router."""

import re
import uuid
from datetime import time
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_tenant, get_current_user
from app.core.config import settings
from app.core.exceptions import ConflictException, UnauthorizedException
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
    hash_password,
    verify_password,
)
from app.database.session import get_db
from app.models.enums import TenantRole, UserStatus
from app.models.operating_hours import HospitalOperatingHours
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.auth import (
    AuthResponse,
    HospitalRegisterRequest,
    LoginRequest,
    TokenRefreshRequest,
    TokenRefreshResponse,
)
from app.schemas.tenant import OperatingHoursItem, TenantRead
from app.schemas.user import UserRead

router = APIRouter(prefix="/auth", tags=["Authentication & Onboarding"])


def set_access_cookie(response: Response, access_token: str) -> None:
    """Set SameSite cookie for access token."""
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=False,
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        expires=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        samesite="lax",
        secure=False if settings.ENVIRONMENT == "development" else True,
        path="/",
    )


def set_refresh_cookie(response: Response, refresh_token: str) -> None:
    """Set HttpOnly SameSite secure cookie for refresh token."""
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
        expires=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
        samesite="lax",
        secure=False if settings.ENVIRONMENT == "development" else True,
        path="/",
    )


def clear_refresh_cookie(response: Response) -> None:
    """Delete the refresh token HttpOnly cookie."""
    response.delete_cookie(
        key="refresh_token",
        path="/",
        samesite="lax",
        secure=False if settings.ENVIRONMENT == "development" else True,
    )


def clear_auth_cookies(response: Response) -> None:
    """Delete both access_token and refresh_token cookies."""
    response.delete_cookie(
        key="access_token",
        path="/",
        samesite="lax",
        secure=False if settings.ENVIRONMENT == "development" else True,
    )
    response.delete_cookie(
        key="refresh_token",
        path="/",
        samesite="lax",
        secure=False if settings.ENVIRONMENT == "development" else True,
    )



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
    response: Response,
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

    # 6. Issue Access & Refresh Tokens
    access_token = create_access_token(
        subject=str(admin_user.id),
        tenant_id=str(tenant.id),
        role=admin_user.role.value,
    )
    refresh_token = create_refresh_token(
        subject=str(admin_user.id),
        tenant_id=str(tenant.id),
        role=admin_user.role.value,
    )
    set_access_cookie(response, access_token)
    set_refresh_cookie(response, refresh_token)

    tenant_read = TenantRead.model_validate(tenant)
    tenant_read.operating_hours = serialize_operating_hours(default_hours)

    return AuthResponse(
        access_token=access_token,
        refresh_token=refresh_token,
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
    response: Response,
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

    access_token = create_access_token(
        subject=str(user.id),
        tenant_id=str(tenant.id),
        role=user.role.value,
    )
    refresh_token = create_refresh_token(
        subject=str(user.id),
        tenant_id=str(tenant.id),
        role=user.role.value,
    )
    set_access_cookie(response, access_token)
    set_refresh_cookie(response, refresh_token)

    tenant_read = TenantRead.model_validate(tenant)
    tenant_read.operating_hours = serialize_operating_hours(operating_hours)

    return AuthResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        user=UserRead.model_validate(user),
        tenant=tenant_read,
    )


@router.post(
    "/refresh",
    response_model=TokenRefreshResponse,
    summary="Exchange refresh token (from cookie or payload) for a fresh access token",
)
async def refresh_tokens(
    request: Request,
    response: Response,
    payload: Optional[TokenRefreshRequest] = None,
    db: AsyncSession = Depends(get_db),
) -> TokenRefreshResponse:
    """Validate refresh token and rotate with fresh access token and new refresh cookie."""
    # 1. Resolve raw refresh token from cookie or payload
    raw_token = request.cookies.get("refresh_token")
    if not raw_token and payload and payload.refresh_token:
        raw_token = payload.refresh_token

    if not raw_token:
        raise UnauthorizedException("Refresh token required in cookie or request body.")

    # 2. Decode & validate refresh token
    token_data = decode_refresh_token(raw_token)
    user_id_raw = token_data.get("sub")
    tenant_id_raw = token_data.get("tenant_id")
    role = token_data.get("role", "admin")

    try:
        user_uuid = uuid.UUID(user_id_raw)
        tenant_uuid = uuid.UUID(tenant_id_raw)
    except (ValueError, TypeError) as exc:
        raise UnauthorizedException("Malformed token claims.") from exc

    # 3. Verify user and tenant are still active in database
    user_res = await db.execute(select(User).where(User.id == user_uuid, User.is_active.is_(True)))
    user = user_res.scalar_one_or_none()
    if not user:
        clear_refresh_cookie(response)
        raise UnauthorizedException("User account not found or deactivated.")

    tenant_res = await db.execute(select(Tenant).where(Tenant.id == tenant_uuid, Tenant.is_active.is_(True)))
    tenant = tenant_res.scalar_one_or_none()
    if not tenant:
        clear_refresh_cookie(response)
        raise UnauthorizedException("Hospital tenant account is inactive.")

    # 4. Generate fresh access token and rotated refresh token
    new_access_token = create_access_token(
        subject=str(user.id),
        tenant_id=str(tenant.id),
        role=role,
    )
    new_refresh_token = create_refresh_token(
        subject=str(user.id),
        tenant_id=str(tenant.id),
        role=role,
    )
    set_access_cookie(response, new_access_token)
    set_refresh_cookie(response, new_refresh_token)

    return TokenRefreshResponse(
        access_token=new_access_token,
        refresh_token=new_refresh_token,
        token_type="bearer",
        user=UserRead.model_validate(user),
        tenant=TenantRead.model_validate(tenant),
    )


@router.post(
    "/logout",
    status_code=status.HTTP_200_OK,
    summary="Clear refresh token cookie and invalidate session",
)
async def logout(response: Response) -> dict:
    """Clear access and refresh token cookies on logout."""
    clear_auth_cookies(response)
    return {"status": "success", "message": "Logged out successfully."}



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
