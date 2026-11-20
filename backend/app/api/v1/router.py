"""Central API v1 Router Registration.

Aggregates all module and feature routers under the /api/v1 namespace.
"""

from fastapi import APIRouter
from app.api.v1.auth import router as auth_router
from app.api.v1.doctors import router as doctors_router
from app.api.v1.health import router as health_router
from app.api.v1.onboarding import router as onboarding_router
from app.api.v1.tenants import router as tenants_router
from app.api.v1.voice import router as voice_router

api_v1_router = APIRouter()

# Core health probes
api_v1_router.include_router(health_router, prefix="", tags=["Health"])

# Authentication & Registration
api_v1_router.include_router(auth_router, prefix="", tags=["Authentication"])

# Hospital Onboarding Canvas
api_v1_router.include_router(onboarding_router, prefix="", tags=["Hospital Onboarding Canvas"])

# Tenant Hospital Profile & Operating Hours
api_v1_router.include_router(tenants_router, prefix="", tags=["Tenants Management"])

# Doctors & Availability CRUD
api_v1_router.include_router(doctors_router, prefix="", tags=["Doctors Management"])

# Voice Playground & Turn API
api_v1_router.include_router(voice_router, prefix="", tags=["Voice Playground"])



