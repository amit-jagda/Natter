"""Central API v1 Router Registration.

Aggregates all module and feature routers under the /api/v1 namespace.
"""

from app.api.v1.analytics import router as analytics_router
from app.api.v1.auth import router as auth_router
from app.api.v1.connectors import router as connectors_router
from app.api.v1.doctors import router as doctors_router
from app.api.v1.gsm_gateway import router as gsm_router
from app.api.v1.health import router as health_router
from app.api.v1.onboarding import router as onboarding_router
from app.api.v1.patients import router as patients_router
from app.api.v1.telephony import router as telephony_router
from app.api.v1.tenants import router as tenants_router
from app.api.v1.users import router as users_router
from app.api.v1.voice import router as voice_router
from fastapi import APIRouter

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

# User Allocation & Staff Management
api_v1_router.include_router(users_router, prefix="", tags=["User Allocation & Staff Management"])

# Patient Details & Excel Bulk Records
api_v1_router.include_router(patients_router, prefix="", tags=["Patient Details & Records"])

# External Connectors & Integrations (Google Calendar, Google Sheets, Radicale)
api_v1_router.include_router(connectors_router, prefix="", tags=["External Connectors & Integrations"])

# Voice Playground & Turn API
api_v1_router.include_router(voice_router, prefix="", tags=["Voice Playground"])

# Telephony & LiveKit Calling (Inbound / Outbound / Interruption)
api_v1_router.include_router(telephony_router, prefix="", tags=["Telephony & LiveKit Calling"])

# GSM Gateway & Physical Android SIM Calling
api_v1_router.include_router(gsm_router, prefix="", tags=["GSM Gateway & SIM Calling"])

# Call Analytics & Business Intelligence
api_v1_router.include_router(analytics_router, prefix="", tags=["Call Analytics & BI"])



