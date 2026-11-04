"""Data Model Instantiation and Convention Tests."""

import uuid
from app.models.enums import TenantRole, UserStatus
from app.models.tenant import Tenant
from app.models.user import User


def test_tenant_model_instantiation():
    """Verify Tenant model instantiation and attributes."""
    tenant = Tenant(
        name="Acme Dental Corp",
        slug="acme-dental",
        settings={"timezone": "Asia/Kolkata", "primary_language": "hi-IN"},
    )
    assert tenant.name == "Acme Dental Corp"
    assert tenant.slug == "acme-dental"
    assert tenant.is_active is True
    assert tenant.settings["timezone"] == "Asia/Kolkata"


def test_user_model_instantiation():
    """Verify User model instantiation and attributes."""
    t_id = uuid.uuid4()
    user = User(
        tenant_id=t_id,
        email="doctor@acme.com",
        hashed_password="hashed_pw_value",
        full_name="Dr. Rajesh Sharma",
        role=TenantRole.ADMIN,
        status=UserStatus.ACTIVE,
    )
    assert user.email == "doctor@acme.com"
    assert user.tenant_id == t_id
    assert user.role == TenantRole.ADMIN
    assert user.status == UserStatus.ACTIVE

