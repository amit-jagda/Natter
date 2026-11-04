"""Pytest Configuration and Test Fixtures."""

import os
import pytest
from httpx import ASGITransport, AsyncClient

# Set testing environment before importing application
os.environ["ENVIRONMENT"] = "test"
os.environ["SECRET_KEY"] = "test-secret-key-for-unit-testing-purposes-only-32ch"

from app.main import app


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    """Async test client bound to the FastAPI application."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac

