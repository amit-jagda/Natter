"""Configuration & Settings Unit Tests."""

from app.core.config import Settings


def test_settings_computed_urls():
    """Verify database and redis connection strings compute correctly."""
    custom_settings = Settings(
        POSTGRES_SERVER="db.example.com",
        POSTGRES_PORT=5433,
        POSTGRES_USER="myuser",
        POSTGRES_PASSWORD="mypassword",
        POSTGRES_DB="testdb",
        REDIS_HOST="redis.example.com",
        REDIS_PORT=6380,
    )

    assert custom_settings.DATABASE_URL == "postgresql+asyncpg://myuser:mypassword@db.example.com:5433/testdb"
    assert custom_settings.DATABASE_SYNC_URL == "postgresql://myuser:mypassword@db.example.com:5433/testdb"
    assert custom_settings.REDIS_URL == "redis://redis.example.com:6380/0"


def test_settings_default_providers():
    """Verify default provider boundaries are configured."""
    s = Settings()
    assert s.STT_PROVIDER in ("google", "mock")
    assert s.TTS_PROVIDER in ("piper", "mock", "gtts")
    assert s.LLM_PROVIDER in ("gemini", "ollama", "openai", "anthropic")
    assert s.TELEPHONY_PROVIDER in ("mock", "exotel", "plivo", "twilio")

