"""Security & Cryptography Foundation.

Implements secure password hashing via bcrypt (direct integration avoiding passlib
incompatibility) and JWT token creation/verification.
"""

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
import bcrypt
import jwt
from app.core.config import settings
from app.core.exceptions import UnauthorizedException


def hash_password(password: str) -> str:
    """Hash a plaintext password with bcrypt using a generated salt."""
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plaintext password against a stored bcrypt hash."""
    try:
        return bcrypt.checkpw(
            plain_password.encode("utf-8"),
            hashed_password.encode("utf-8"),
        )
    except Exception:
        return False


def create_access_token(
    subject: str,
    tenant_id: str,
    role: str,
    expires_delta: Optional[timedelta] = None,
    extra_claims: Optional[Dict[str, Any]] = None,
) -> str:
    """Create a signed JWT access token containing subject, tenant_id, and role claims."""
    now = datetime.now(timezone.utc)
    expire = now + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))

    payload: Dict[str, Any] = {
        "sub": str(subject),
        "tenant_id": str(tenant_id),
        "role": str(role),
        "iat": now,
        "exp": expire,
        "type": "access",
    }
    if extra_claims:
        payload.update(extra_claims)

    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_access_token(token: str) -> Dict[str, Any]:
    """Decode and validate a JWT access token, verifying expiration and signature."""
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
        )
        if payload.get("type") != "access":
            raise UnauthorizedException("Invalid token type.")
        return payload
    except jwt.ExpiredSignatureError as exc:
        raise UnauthorizedException("Token has expired.") from exc
    except jwt.PyJWTError as exc:
        raise UnauthorizedException("Could not validate credentials.") from exc

