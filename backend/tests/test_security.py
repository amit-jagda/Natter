"""Security and Cryptography Unit Tests."""

import uuid
import pytest
from datetime import timedelta
from app.core.exceptions import UnauthorizedException
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_access_token,
    decode_refresh_token,
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


def test_refresh_token_lifecycle():
    """Verify refresh token generation and decoding."""
    subject = str(uuid.uuid4())
    tenant_id = str(uuid.uuid4())
    role = "admin"

    token = create_refresh_token(subject=subject, tenant_id=tenant_id, role=role)
    assert isinstance(token, str)

    payload = decode_refresh_token(token)
    assert payload["sub"] == subject
    assert payload["tenant_id"] == tenant_id
    assert payload["role"] == role
    assert payload["type"] == "refresh"


def test_token_type_separation():
    """Verify access tokens cannot be decoded as refresh tokens, and vice versa."""
    subject = str(uuid.uuid4())
    tenant_id = str(uuid.uuid4())

    access_tok = create_access_token(subject=subject, tenant_id=tenant_id, role="admin")
    refresh_tok = create_refresh_token(subject=subject, tenant_id=tenant_id, role="admin")

    # Access token cannot be used where refresh token is expected
    with pytest.raises(UnauthorizedException) as exc_info:
        decode_refresh_token(access_tok)
    assert "Invalid refresh token type" in str(exc_info.value)

    # Refresh token cannot be used where access token is expected
    with pytest.raises(UnauthorizedException) as exc_info:
        decode_access_token(refresh_tok)
    assert "Invalid token type" in str(exc_info.value)


def test_expired_tokens():
    """Verify expired access and refresh tokens raise UnauthorizedException."""
    subject = str(uuid.uuid4())
    tenant_id = str(uuid.uuid4())

    expired_access = create_access_token(
        subject=subject,
        tenant_id=tenant_id,
        role="admin",
        expires_delta=timedelta(seconds=-10),
    )
    with pytest.raises(UnauthorizedException) as exc:
        decode_access_token(expired_access)
    assert "expired" in str(exc.value).lower()

    expired_refresh = create_refresh_token(
        subject=subject,
        tenant_id=tenant_id,
        role="admin",
        expires_delta=timedelta(seconds=-10),
    )
    with pytest.raises(UnauthorizedException) as exc:
        decode_refresh_token(expired_refresh)
    assert "expired" in str(exc.value).lower()


