"""Layer 2 Integration Test Configuration.

Configures test execution against isolated real infrastructure:
- PostgreSQL test database: voice_ai_test (localhost:5435 inside Docker host setup)
- Redis test database index: 15 (redis://localhost:6379/15)

Layer 2 integration tests MUST NOT use ENVIRONMENT=test because
ConversationSessionStore disables Redis whenever ENVIRONMENT=test.
"""

import os
from pathlib import Path
import sys
from typing import AsyncGenerator
import uuid

import pytest_asyncio
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Set overrides before importing application settings/modules.
os.environ["ENVIRONMENT"] = os.environ.get("INTEGRATION_ENV", "integration")
os.environ.setdefault(
    "DATABASE_URL_OVERRIDE",
    "postgresql+asyncpg://postgres:postgres@localhost:5435/voice_ai_test",
)
os.environ.setdefault(
    "DATABASE_SYNC_URL_OVERRIDE",
    "postgresql+psycopg2://postgres:postgres@localhost:5435/voice_ai_test",
)
os.environ.setdefault(
    "REDIS_URL_OVERRIDE",
    "redis://localhost:6379/15",
)
os.environ.setdefault(
    "SECRET_KEY",
    "integration-test-secret-key-min-32-chars-safe",
)

from app.core.config import settings  # noqa: E402
import app.workers.redis as redis_mod  # noqa: E402


TEST_ASYNC_DB_URL = settings.DATABASE_URL
TEST_REDIS_URL = settings.REDIS_URL


@pytest_asyncio.fixture
async def pg_engine() -> AsyncGenerator[AsyncEngine, None]:
    """Yield a per-test AsyncEngine bound cleanly to the active event loop."""
    if "voice_ai_test" not in TEST_ASYNC_DB_URL:
        raise RuntimeError(
            f"Refusing to run destructive PG integration tests on non-test DB: {TEST_ASYNC_DB_URL}"
        )

    engine = create_async_engine(
        TEST_ASYNC_DB_URL,
        echo=False,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=10,
        connect_args={"timeout": 5, "command_timeout": 15},
    )
    try:
        yield engine
    finally:
        await engine.dispose()


@pytest_asyncio.fixture
async def pg_session_factory(pg_engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    """Yield an async_sessionmaker for creating independent concurrent sessions."""
    return async_sessionmaker(
        bind=pg_engine,
        class_=AsyncSession,
        autocommit=False,
        autoflush=False,
        expire_on_commit=False,
    )


@pytest_asyncio.fixture
async def redis_cleanup():
    """Ensure singleton Redis client pools are cleanly reset per test loop."""
    async def _safe_reset():
        try:
            await redis_mod.close_redis()
        except RuntimeError:
            redis_mod._redis_client = None
            redis_mod._arq_pool = None

    await _safe_reset()
    yield
    await _safe_reset()


def unique_slug(prefix: str = "inttest") -> str:
    """Generate a unique tenant slug for isolated test runs."""
    return f"{prefix}-{uuid.uuid4().hex[:10]}"
