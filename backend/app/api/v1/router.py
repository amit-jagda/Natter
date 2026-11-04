"""Central API v1 Router Registration.

Aggregates all module and feature routers under the /api/v1 namespace.
"""

from fastapi import APIRouter
from app.api.v1.health import router as health_router

api_v1_router = APIRouter()

# Core health probes
api_v1_router.include_router(health_router, prefix="", tags=["Health"])

