"""Global Exception Handlers for FastAPI.

Maps application-level exceptions, validation errors, and uncaught exceptions
into consistent, structured JSON responses.
"""

import logging
from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from app.core.exceptions import AppException

logger = logging.getLogger(__name__)


def register_error_handlers(app: FastAPI) -> None:
    """Register all custom and global exception handlers with the FastAPI app."""

    @app.exception_handler(AppException)
    async def app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
        logger.warning(
            "Application error [%s]: %s (details=%s)",
            exc.__class__.__name__,
            exc.message,
            exc.details,
        )
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "success": False,
                "error": {
                    "code": exc.__class__.__name__,
                    "message": exc.message,
                    "details": exc.details,
                },
            },
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        errors = exc.errors()
        logger.warning("Validation error on %s: %s", request.url.path, errors)
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "success": False,
                "error": {
                    "code": "ValidationError",
                    "message": "Input validation failed.",
                    "details": errors,
                },
            },
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.error("Unhandled server exception on %s: %s", request.url.path, exc, exc_info=True)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "success": False,
                "error": {
                    "code": "InternalServerError",
                    "message": "An unexpected error occurred. Please contact support.",
                    "details": {},
                },
            },
        )

