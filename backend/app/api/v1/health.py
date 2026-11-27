"""Health and Readiness Probes.

Exposes deep health inspection for container orchestrators, load balancers,
and monitoring services.
"""

from datetime import datetime, timezone

from app.core.config import settings
from app.database.session import check_database_health
from app.schemas.health import HealthResponse, ServiceHealth
from app.workers.redis import check_redis_health
from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

router = APIRouter(tags=["Health"])


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Health check probe",
    description="Returns operational status of the API, database, and cache services.",
)
async def health_check():
    """Verify application runtime and downstream service dependencies."""
    db_healthy = await check_database_health()
    redis_healthy = await check_redis_health()

    overall_healthy = db_healthy and redis_healthy
    http_status = status.HTTP_200_OK if overall_healthy else status.HTTP_503_SERVICE_UNAVAILABLE

    payload = HealthResponse(
        status="healthy" if overall_healthy else "degraded",
        version="0.1.0",
        environment=settings.ENVIRONMENT,
        timestamp=datetime.now(timezone.utc),
        services={
            "database": ServiceHealth(
                status="healthy" if db_healthy else "unhealthy",
                details={"engine": "PostgreSQL 16", "connected": str(db_healthy)},
            ),
            "redis": ServiceHealth(
                status="healthy" if redis_healthy else "unhealthy",
                details={"engine": "Redis 7", "connected": str(redis_healthy)},
            ),
        },
    )

    return JSONResponse(status_code=http_status, content=payload.model_dump(mode="json"))

