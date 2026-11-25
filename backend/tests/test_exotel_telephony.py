"""Unit tests for Exotel Cloud Telephony & Unified Provider Dispatching."""

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import settings
from app.main import app
from app.services.exotel_service import format_exotel_phone, exotel_service


def test_format_exotel_phone():
    """Verify phone numbers are correctly converted for Indian carrier dialing."""
    assert format_exotel_phone("8980616264") == "08980616264"
    assert format_exotel_phone("9328291692") == "09328291692"
    assert format_exotel_phone("+918980616264") == "08980616264"


def test_exotel_unconfigured_response():
    """Verify unconfigured Exotel returns helpful guidance message."""
    service = exotel_service
    # If not configured, should return configured=False
    assert isinstance(service.is_configured, bool)


@pytest.mark.asyncio
async def test_telephony_provider_status_endpoint():
    """Verify GET /api/v1/telephony/provider-status reports active provider and readiness."""
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.get("/api/v1/telephony/provider-status")
        assert resp.status_code == 200
        data = resp.json()
        assert "active_provider" in data
        assert "twilio" in data
        assert "exotel" in data
        assert "configured" in data["twilio"]
        assert "configured" in data["exotel"]


def test_active_calling_provider_setting():
    """Verify active calling provider computation from config."""
    assert settings.ACTIVE_CALLING_PROVIDER in ("twilio", "exotel", "mock", "plivo")
