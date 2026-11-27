"""Role Permission Enforcement Middleware.

Enforces strict role-based access control:
Operators are granted GET (read-only) permissions. All mutating HTTP methods
(POST, PUT, PATCH, DELETE) attempted by operators are rejected with HTTP 403 Forbidden.
"""

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core.security import decode_access_token

# Paths that any authenticated user can invoke regardless of role
EXEMPT_WRITE_PATHS = {
    "/api/v1/auth/login",
    "/api/v1/auth/register-hospital",
    "/api/v1/auth/refresh",
    "/api/v1/auth/logout",
    "/health",
}


class RolePermissionMiddleware(BaseHTTPMiddleware):
    """Enforces read-only access for Operator roles across all mutating API routes."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        # Safe read-only methods are always allowed
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return await call_next(request)

        # Exempt authentication routes (e.g., logout, refresh, login)
        path = request.url.path
        if any(path.startswith(exempt) for exempt in EXEMPT_WRITE_PATHS):
            return await call_next(request)

        # Inspect Authorization header
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()
            try:
                payload = decode_access_token(token)
                role = payload.get("role", "").lower()
                if role == "operator":
                    return JSONResponse(
                        status_code=403,
                        content={
                            "status": "error",
                            "error": {
                                "code": 403,
                                "message": (
                                    "Access denied: Operators have read-only permissions. "
                                    "Create, update, patch, and delete actions are reserved for Administrators."
                                ),
                            },
                        },
                    )
            except Exception:
                # Malformed/expired tokens will be rejected by the endpoint auth dependency
                pass

        return await call_next(request)
