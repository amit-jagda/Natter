"""Reusable FastAPI Dependencies.

Provides database sessions, tenant resolution, authenticated user contexts,
and background job queue access.
"""

import uuid
from typing import AsyncGenerator, Optional
from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.exceptions import ForbiddenException, NotFoundException, UnauthorizedException
from app.core.security import decode_access_token
from app.database.session import AsyncSessionLocal, get_db
from app.models.tenant import Tenant
from app.models.user import User
from app.models.enums import TenantRole
from app.workers.redis import ArqRedis, get_arq_pool

bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_token_payload(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> dict:
    """Validate Bearer token from header or access_token cookie, and return its decoded payload."""
    raw_token = (
        credentials.credentials
        if credentials and credentials.credentials
        else request.cookies.get("access_token")
    )
    if not raw_token:
        raise UnauthorizedException("Authentication token required.")
    return decode_access_token(raw_token)


async def get_current_user(
    payload: dict = Depends(get_current_token_payload),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Resolve the authenticated user entity from the JWT payload."""
    user_id_raw = payload.get("sub")
    if not user_id_raw:
        raise UnauthorizedException("Invalid token subject.")

    try:
        user_id = uuid.UUID(user_id_raw)
    except ValueError as exc:
        raise UnauthorizedException("Malformed user identifier.") from exc

    result = await db.execute(select(User).where(User.id == user_id, User.is_active.is_(True)))
    user = result.scalar_one_or_none()
    if not user:
        raise UnauthorizedException("User account not found or deactivated.")

    return user


async def get_optional_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> Optional[User]:
    """Resolve user if Bearer token or cookie is valid, otherwise return None."""
    raw_token = (
        credentials.credentials
        if credentials and credentials.credentials
        else request.cookies.get("access_token")
    )
    if not raw_token:
        return None
    try:
        payload = decode_access_token(raw_token)
        user_id_raw = payload.get("sub")
        if not user_id_raw:
            return None
        user_id = uuid.UUID(user_id_raw)
        if AsyncSessionLocal is None:
            return None
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(User).where(User.id == user_id, User.is_active.is_(True)))
            return result.scalar_one_or_none()
    except Exception:
        return None


async def get_current_tenant(
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-ID"),
    current_user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Tenant:
    """Resolve the active tenant context, ensuring strict tenant isolation.

    If an explicit X-Tenant-ID header is passed by an authenticated user,
    it must match their authorized tenant membership.
    """
    if current_user:
        tenant_id = current_user.tenant_id
        if x_tenant_id:
            try:
                requested_id = uuid.UUID(x_tenant_id)
                if requested_id != tenant_id:
                    raise ForbiddenException("Cross-tenant access is strictly prohibited.")
            except ValueError as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid X-Tenant-ID format.",
                ) from exc
    elif x_tenant_id:
        try:
            tenant_id = uuid.UUID(x_tenant_id)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid X-Tenant-ID format.",
            ) from exc
    else:
        raise UnauthorizedException("Tenant context required.")

    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id, Tenant.is_active.is_(True)))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise NotFoundException("Tenant not found or inactive.")

    return tenant


async def get_job_queue() -> ArqRedis:
    """Dependency providing access to the Arq background task queue."""
    return await get_arq_pool()


async def require_write_permission(
    current_user: User = Depends(get_current_user),
) -> User:
    """Ensure the user has write permissions (Administrator role).

    Operators have read-only permissions (GET only) and are strictly barred
    from creating, updating, patching, or deleting resources.
    """
    if current_user.role != TenantRole.ADMIN:
        raise ForbiddenException(
            "Access denied: Operators have read-only permissions. Create, update, and delete actions are reserved for Admins."
        )
    return current_user


require_admin = require_write_permission


