"""Reusable FastAPI Dependencies.

Provides database sessions, tenant resolution, authenticated user contexts,
and background job queue access.
"""

import uuid
from typing import AsyncGenerator, Optional
from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.exceptions import ForbiddenException, NotFoundException, UnauthorizedException
from app.core.security import decode_access_token
from app.database.session import AsyncSessionLocal, get_db
from app.models.tenant import Tenant
from app.models.user import User
from app.workers.redis import get_arq_pool
from arq.connections import ArqRedis

bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_token_payload(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> dict:
    """Validate Bearer token and return its decoded payload."""
    if not credentials or not credentials.credentials:
        raise UnauthorizedException("Authentication token required.")
    return decode_access_token(credentials.credentials)


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

