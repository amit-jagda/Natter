"""FastAPI Application Entrypoint.

Initializes the modular monolith application with OpenAPI documentation,
CORS security, error handlers, and lifespan lifecycle management.
"""

from contextlib import asynccontextmanager
import logging
from typing import AsyncGenerator
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from app.api.v1.health import router as health_router
from app.api.v1.router import api_v1_router
from app.core.config import settings
from app.core.error_handlers import register_error_handlers
from app.core.logging import setup_logging
from app.middleware.request_id import RequestIDMiddleware
from app.middleware.role_permission import RolePermissionMiddleware
from app.workers.redis import close_redis, get_arq_pool

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan manager for clean startup and shutdown sequences."""
    # 1. Initialize logging & Sentry
    setup_logging(sentry_dsn=settings.SENTRY_DSN)
    logger.info("Starting %s in [%s] mode...", settings.PROJECT_NAME, settings.ENVIRONMENT)

    # 2. Pre-warm Redis and Arq connection pool (best effort, graceful on startup if offline)
    try:
        await get_arq_pool()
        logger.info("Connected to Redis and Arq task queue.")
    except Exception as exc:
        logger.warning("Redis not immediately available on startup: %s", exc)

    yield

    # 3. Graceful shutdown: close connection pools
    logger.info("Shutting down %s...", settings.PROJECT_NAME)
    await close_redis()


def create_application() -> FastAPI:
    """Application factory configuring middleware, routes, and exception handling."""
    app = FastAPI(
        title=settings.PROJECT_NAME,
        version="0.1.0",
        description=(
            "Hospital Voice Agent: Autonomous Multi-Tenant Conversational AI Platform "
            "for Hospital Doctor Scheduling, Outbound Patient Calls, and Shift Management."
        ),
        openapi_url="/openapi.json",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )

    # Middlewares
    app.add_middleware(RequestIDMiddleware)
    app.add_middleware(RolePermissionMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Global Exception Handlers
    register_error_handlers(app)

    # Root health probe (for Docker/ALB checks)
    app.include_router(health_router, prefix="", tags=["Health"])

    # API v1 Versioned Router
    app.include_router(api_v1_router, prefix=settings.API_V1_PREFIX)

    # Convenience redirects so both /docs and /api/v1/docs work seamlessly
    @app.get("/api/v1/docs", include_in_schema=False)
    async def redirect_api_v1_docs():
        return RedirectResponse(url="/docs")

    @app.get("/api/v1/redoc", include_in_schema=False)
    async def redirect_api_v1_redoc():
        return RedirectResponse(url="/redoc")

    @app.get("/api/v1/openapi.json", include_in_schema=False)
    async def redirect_api_v1_openapi():
        return RedirectResponse(url="/openapi.json")

    return app



app = create_application()

