"""Security & Cryptography Foundation.

Implements secure password hashing via bcrypt (direct integration avoiding passlib
incompatibility) and JWT token creation/verification.
"""

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import bcrypt

try:
    import jwt
except ImportError:
    # Graceful standard library fallback for HS256 JWT when pyjwt is not installed
    import base64
    import hashlib
    import hmac
    import json

    class _PyJWTError(Exception):
        pass

    class _ExpiredSignatureError(_PyJWTError):
        pass

    class _JWTFallback:
        PyJWTError = _PyJWTError
        ExpiredSignatureError = _ExpiredSignatureError

        @staticmethod
        def _b64_encode(data: bytes) -> str:
            return base64.urlsafe_b64encode(data).rstrip(b"=").decode("utf-8")

        @staticmethod
        def _b64_decode(data: str) -> bytes:
            padding = 4 - (len(data) % 4)
            if padding != 4:
                data += "=" * padding
            return base64.urlsafe_b64decode(data.encode("utf-8"))

        @classmethod
        def encode(cls, payload: Dict[str, Any], key: str, algorithm: str = "HS256") -> str:
            clean_payload = {}
            for k, v in payload.items():
                if isinstance(v, datetime):
                    clean_payload[k] = int(v.timestamp())
                else:
                    clean_payload[k] = v
            header = {"alg": algorithm, "typ": "JWT"}
            h_b64 = cls._b64_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
            p_b64 = cls._b64_encode(json.dumps(clean_payload, separators=(",", ":")).encode("utf-8"))
            signing_input = f"{h_b64}.{p_b64}".encode("utf-8")
            sig = hmac.new(key.encode("utf-8"), signing_input, hashlib.sha256).digest()
            s_b64 = cls._b64_encode(sig)
            return f"{h_b64}.{p_b64}.{s_b64}"

        @classmethod
        def decode(cls, token: str, key: str, algorithms: Optional[list] = None) -> Dict[str, Any]:
            parts = token.split(".")
            if len(parts) != 3:
                raise _PyJWTError("Invalid token format")
            h_b64, p_b64, s_b64 = parts
            signing_input = f"{h_b64}.{p_b64}".encode("utf-8")
            expected_sig = hmac.new(key.encode("utf-8"), signing_input, hashlib.sha256).digest()
            try:
                actual_sig = cls._b64_decode(s_b64)
            except Exception as exc:
                raise _PyJWTError("Malformed signature base64") from exc
            if not hmac.compare_digest(expected_sig, actual_sig):
                raise _PyJWTError("Signature verification failed")
            try:
                payload = json.loads(cls._b64_decode(p_b64).decode("utf-8"))
            except Exception as exc:
                raise _PyJWTError("Malformed payload JSON") from exc
            exp = payload.get("exp")
            if exp is not None:
                now_ts = int(datetime.now(timezone.utc).timestamp())
                if now_ts > exp:
                    raise _ExpiredSignatureError("Token has expired")
            return payload

    jwt = _JWTFallback()  # type: ignore
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

    return jwt.encode(payload, settings.EFFECTIVE_SECRET_KEY, algorithm=settings.EFFECTIVE_ALGORITHM)


def decode_access_token(token: str) -> Dict[str, Any]:
    """Decode and validate a JWT access token, verifying expiration and signature."""
    try:
        payload = jwt.decode(
            token,
            settings.EFFECTIVE_SECRET_KEY,
            algorithms=[settings.EFFECTIVE_ALGORITHM],
        )
        if payload.get("type") != "access":
            raise UnauthorizedException("Invalid token type.")
        return payload
    except jwt.ExpiredSignatureError as exc:
        raise UnauthorizedException("Token has expired.") from exc
    except jwt.PyJWTError as exc:
        raise UnauthorizedException("Could not validate credentials.") from exc


def create_refresh_token(
    subject: str,
    tenant_id: str,
    role: str,
    expires_delta: Optional[timedelta] = None,
    extra_claims: Optional[Dict[str, Any]] = None,
) -> str:
    """Create a signed JWT refresh token containing subject, tenant_id, and role claims."""
    now = datetime.now(timezone.utc)
    expire = now + (expires_delta or timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS))

    payload: Dict[str, Any] = {
        "sub": str(subject),
        "tenant_id": str(tenant_id),
        "role": str(role),
        "iat": now,
        "exp": expire,
        "type": "refresh",
    }
    if extra_claims:
        payload.update(extra_claims)

    return jwt.encode(payload, settings.EFFECTIVE_SECRET_KEY, algorithm=settings.EFFECTIVE_ALGORITHM)


def decode_refresh_token(token: str) -> Dict[str, Any]:
    """Decode and validate a JWT refresh token, verifying expiration and signature."""
    try:
        payload = jwt.decode(
            token,
            settings.EFFECTIVE_SECRET_KEY,
            algorithms=[settings.EFFECTIVE_ALGORITHM],
        )
        if payload.get("type") != "refresh":
            raise UnauthorizedException("Invalid refresh token type.")
        return payload
    except jwt.ExpiredSignatureError as exc:
        raise UnauthorizedException("Refresh token has expired. Please log in again.") from exc
    except jwt.PyJWTError as exc:
        raise UnauthorizedException("Could not validate refresh credentials.") from exc


