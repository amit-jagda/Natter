"""Application Exception Hierarchy.

Provides domain-specific exceptions mapped to standardized HTTP status codes
and structured error responses.
"""

from typing import Any, Dict, Optional


class AppException(Exception):
    """Base exception for all domain-specific platform errors."""

    status_code: int = 500
    default_message: str = "An unexpected server error occurred."

    def __init__(
        self,
        message: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
        status_code: Optional[int] = None,
    ) -> None:
        super().__init__(message or self.default_message)
        self.message = message or self.default_message
        self.details = details or {}
        if status_code is not None:
            self.status_code = status_code


class NotFoundException(AppException):
    """Raised when a requested resource does not exist."""
    status_code = 404
    default_message = "Requested resource not found."


class BadRequestException(AppException):
    """Raised when request payload or parameters are invalid."""
    status_code = 400
    default_message = "Bad request."


class UnauthorizedException(AppException):
    """Raised when credentials are missing or invalid."""
    status_code = 401
    default_message = "Authentication required."


class ForbiddenException(AppException):
    """Raised when an authenticated actor lacks permission for an operation."""
    status_code = 403
    default_message = "Operation not permitted."


class ConflictException(AppException):
    """Raised on unique constraint violations or duplicate entity conflicts."""
    status_code = 409
    default_message = "Resource already exists or is in conflict."


class TenantIsolationException(ForbiddenException):
    """Raised when cross-tenant data access is detected or attempted."""
    default_message = "Access to resources belonging to another tenant is strictly prohibited."


class ProviderException(AppException):
    """Raised when an external provider (STT, TTS, LLM, Telephony) fails."""
    status_code = 502
    default_message = "External service provider error."

