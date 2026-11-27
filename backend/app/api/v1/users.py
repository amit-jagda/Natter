"""Users & Staff Allocation API Router.

Enforces role boundaries:
- Admins can invite staff users (by default Operator), view users, update roles, and revoke accounts.
- Operators can only view (GET) the user list.
- Invitations automatically generate secure credentials and dispatch an email with the login ID and password.
"""

import uuid
from typing import List, Optional

from app.api.deps import get_current_tenant, get_current_user, require_write_permission
from app.core.exceptions import BadRequestException, ConflictException, NotFoundException
from app.core.security import hash_password
from app.database.session import get_db
from app.models.enums import TenantRole, UserStatus
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.user import UserInviteRequest, UserInviteResponse, UserRead, UserUpdate
from app.services.email import generate_random_password
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/users", tags=["User Allocation & Staff Management"])


@router.get(
    "",
    response_model=List[UserRead],
    summary="List all staff users within the current hospital (GET - Allowed for Admin & Operator)",
)
async def list_tenant_users(
    search: Optional[str] = Query(None, description="Search users by name or email"),
    role: Optional[str] = Query(None, description="Filter by role: admin, operator"),
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> List[UserRead]:
    """Fetch all users assigned to the hospital organization with optional search and role filtering.

    Accessible to both Admins and Operators for directory viewing.
    """
    stmt = select(User).where(User.tenant_id == tenant.id, User.is_active.is_(True))
    if search and search.strip():
        term = f"%{search.strip()}%"
        stmt = stmt.where(or_(User.full_name.ilike(term), User.email.ilike(term)))
    if role and role.strip() and role.lower() != "all":
        stmt = stmt.where(User.role == role.strip().lower())

    stmt = stmt.order_by(User.created_at.desc())
    result = await db.execute(stmt)
    users = list(result.scalars().all())
    return [UserRead.model_validate(u) for u in users]


@router.post(
    "/invite",
    response_model=UserInviteResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Invite a new staff user with Operator role and dispatch email credentials (Admin Only)",
)
async def invite_user(
    payload: UserInviteRequest,
    tenant: Tenant = Depends(get_current_tenant),
    admin_user: User = Depends(require_write_permission),
    db: AsyncSession = Depends(get_db),
) -> UserInviteResponse:
    """Invites a new hospital staff member.

    1. Enforces Admin permission (Operators cannot invite).
    2. Defaults role to Operator (read-only access).
    3. Auto-generates a secure temporary password if not manually specified.
    4. Creates the User record.
    5. Dispatches an invitation email with login credentials (User ID and Password).
    """
    clean_email = payload.email.lower().strip()

    # Verify email uniqueness
    existing_user_result = await db.execute(select(User).where(User.email == clean_email))
    existing_user = existing_user_result.scalar_one_or_none()

    if existing_user:
        if existing_user.tenant_id == tenant.id:
            raise ConflictException("A user with this email address already belongs to your hospital.")
        raise ConflictException("A user with this email address is already registered in another organization.")

    # Determine temporary password
    temp_password = payload.password if payload.password else generate_random_password(10)
    assigned_role = payload.role or TenantRole.OPERATOR

    new_user = User(
        tenant_id=tenant.id,
        email=clean_email,
        hashed_password=hash_password(temp_password),
        full_name=payload.full_name.strip(),
        role=assigned_role,
        status=UserStatus.ACTIVE,
        is_active=True,
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)

    # -------------------------------------------------------------------------
    # Email invitation dispatch commented out for now as requested.
    # Will be re-enabled once SMTP configuration is set in .env.
    # -------------------------------------------------------------------------
    # email_result = send_invitation_email(
    #     recipient_email=new_user.email,
    #     recipient_name=new_user.full_name,
    #     temp_password=temp_password,
    #     hospital_name=tenant.name,
    #     role=new_user.role.value,
    # )
    email_sent = False

    return UserInviteResponse(
        user=UserRead.model_validate(new_user),
        temp_password=temp_password,
        email_sent=email_sent,
        message=(
            f"User '{new_user.full_name}' invited successfully with '{new_user.role.value}' role."
        ),
    )


@router.get(
    "/{user_id}",
    response_model=UserRead,
    summary="Get staff user by ID (GET - Allowed for all roles)",
)
async def get_user(
    user_id: uuid.UUID,
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserRead:
    """Fetch a single staff user by ID."""
    result = await db.execute(
        select(User).where(User.id == user_id, User.tenant_id == tenant.id)
    )
    target_user = result.scalar_one_or_none()
    if not target_user:
        raise NotFoundException("User account not found.")
    return UserRead.model_validate(target_user)


@router.delete(
    "/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Revoke or delete a staff user (Admin Only)",
)
async def delete_user(
    user_id: uuid.UUID,
    tenant: Tenant = Depends(get_current_tenant),
    admin_user: User = Depends(require_write_permission),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Removes a user from the hospital tenant organization."""
    if admin_user.id == user_id:
        raise BadRequestException("You cannot delete your own active administrator account.")

    result = await db.execute(
        select(User).where(User.id == user_id, User.tenant_id == tenant.id)
    )
    target_user = result.scalar_one_or_none()
    if not target_user:
        raise NotFoundException("User account not found.")

    await db.delete(target_user)
    await db.commit()


@router.patch(
    "/{user_id}",
    response_model=UserRead,
    summary="Update staff user role or profile (Admin Only)",
)
async def patch_user(
    user_id: uuid.UUID,
    payload: UserUpdate,
    tenant: Tenant = Depends(get_current_tenant),
    admin_user: User = Depends(require_write_permission),
    db: AsyncSession = Depends(get_db),
) -> UserRead:
    """Update user properties (name, role, status)."""
    result = await db.execute(
        select(User).where(User.id == user_id, User.tenant_id == tenant.id)
    )
    target_user = result.scalar_one_or_none()
    if not target_user:
        raise NotFoundException("User account not found.")

    if payload.full_name is not None:
        target_user.full_name = payload.full_name.strip()
    if payload.role is not None:
        target_user.role = payload.role
    if payload.status is not None:
        target_user.status = payload.status
    if payload.is_active is not None:
        target_user.is_active = payload.is_active
    if payload.password is not None:
        target_user.hashed_password = hash_password(payload.password)

    await db.commit()
    await db.refresh(target_user)
    return UserRead.model_validate(target_user)
