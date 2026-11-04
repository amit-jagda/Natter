"""Security and Cryptography Unit Tests."""

import uuid
import pytest
from app.core.exceptions import UnauthorizedException
from app.core.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)


def test_password_hashing():
    """Verify bcrypt hashing and verification behavior."""
    raw = "SuperSecretPassword123!"
    hashed = hash_password(raw)

    assert hashed != raw
    assert verify_password(raw, hashed) is True
    assert verify_password("WrongPassword123!", hashed) is False


def test_jwt_token_lifecycle():
    """Verify JWT access token creation and decoding."""
    subject = str(uuid.uuid4())
    tenant_id = str(uuid.uuid4())
    role = "admin"

    token = create_access_token(subject=subject, tenant_id=tenant_id, role=role)
    assert isinstance(token, str)

    payload = decode_access_token(token)
    assert payload["sub"] == subject
    assert payload["tenant_id"] == tenant_id
    assert payload["role"] == role
    assert payload["type"] == "access"


def test_invalid_jwt_token():
    """Verify decoding a malformed token raises UnauthorizedException."""
    with pytest.raises(UnauthorizedException):
        decode_access_token("not.a.valid.jwt.token")

