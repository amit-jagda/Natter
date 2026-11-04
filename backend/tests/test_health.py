"""Health Probes Test Suite."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_root_health_endpoint(client: AsyncClient):
    """Verify /health returns structured health payload."""
    response = await client.get("/health")
    assert response.status_code in (200, 503)
    data = response.json()
    assert "status" in data
    assert "version" in data
    assert "services" in data
    assert "database" in data["services"]
    assert "redis" in data["services"]


@pytest.mark.asyncio
async def test_api_v1_health_endpoint(client: AsyncClient):
    """Verify /api/v1/health returns matching payload."""
    response = await client.get("/api/v1/health")
    assert response.status_code in (200, 503)
    data = response.json()
    assert "status" in data
    assert data["version"] == "0.1.0"

