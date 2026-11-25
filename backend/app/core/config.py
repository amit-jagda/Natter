"""Core Application Configuration.

Uses Pydantic Settings v2 for robust environment-based configuration, validation,
and type safety. Keeps provider and infrastructure settings strictly decoupled.
"""

from typing import List, Optional

try:
    from pydantic import computed_field
    from pydantic_settings import BaseSettings, SettingsConfigDict
except ImportError:
    # Fallback minimal settings stub when running in uninstalled/test environments
    def computed_field(func):  # type: ignore
        return property(func)

    def SettingsConfigDict(**kwargs):  # type: ignore
        return {}

    class BaseSettings:  # type: ignore
        def __init__(self, **kwargs) -> None:
            for k, v in kwargs.items():
                setattr(self, k, v)



class Settings(BaseSettings):
    """Application runtime settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Environment & Application Metadata
    ENVIRONMENT: str = "development"
    DEBUG: bool = False
    PROJECT_NAME: str = "Hospital Voice Agent"
    API_V1_PREFIX: str = "/api/v1"

    # Security & Authentication Foundation
    SECRET_KEY: str = "development-secret-key-change-in-production-min-32-chars"
    SERVICE_API_KEY: Optional[str] = None  # Pre-shared secret for telephony / live calling service auth
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # CORS
    CORS_ORIGINS: List[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

    # Database (PostgreSQL)
    POSTGRES_SERVER: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str = "postgres"
    POSTGRES_DB: str = "voice_ai_platform"
    DATABASE_URL_OVERRIDE: Optional[str] = None
    DATABASE_SYNC_URL_OVERRIDE: Optional[str] = None
    SQL_ECHO: bool = False

    @computed_field  # type: ignore[prop-decorator]
    @property
    def DATABASE_URL(self) -> str:
        """Async SQLAlchemy database connection string for application runtime."""
        if self.DATABASE_URL_OVERRIDE:
            return self.DATABASE_URL_OVERRIDE
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_SERVER}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    @computed_field  # type: ignore[prop-decorator]
    @property
    def DATABASE_SYNC_URL(self) -> str:
        """Synchronous connection string for Alembic migrations and CLI operations."""
        if self.DATABASE_SYNC_URL_OVERRIDE:
            return self.DATABASE_SYNC_URL_OVERRIDE
        return (
            f"postgresql+psycopg2://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_SERVER}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    # Redis & Arq Background Worker
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_PASSWORD: Optional[str] = None
    REDIS_DB: int = 0
    REDIS_URL_OVERRIDE: Optional[str] = None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def REDIS_URL(self) -> str:
        """Redis connection URL for caching and Arq task queue."""
        if self.REDIS_URL_OVERRIDE:
            return self.REDIS_URL_OVERRIDE
        auth = f":{self.REDIS_PASSWORD}@" if self.REDIS_PASSWORD else ""
        return f"redis://{auth}{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"

    # Voice Engine & Telephony Provider Boundaries (Separated from business config)
    STT_PROVIDER: str = "google"
    TTS_PROVIDER: str = "piper"
    LLM_PROVIDER: str = "gemini"
    TELEPHONY_PROVIDER: str = "mock"
    VOICE_FRAMEWORK: str = "adapter"  # 'adapter', 'livekit', or 'pipecat'

    # Model & Voice Configurations
    GOOGLE_STT_MODEL: str = "gemini-3.5-flash-lite"
    GEMINI_LLM_MODEL: str = "gemini-3.5-flash-lite"
    PIPER_VOICE_DIR: str = "data/piper_voices"
    PIPER_DEFAULT_VOICE: str = "en_US-lessac-medium"
    TTS_FALLBACK_PROVIDER: str = "mock"

    # External Provider Credentials (Placeholders)
    GOOGLE_API_KEY: Optional[str] = None
    OPENAI_API_KEY: Optional[str] = None
    ANTHROPIC_API_KEY: Optional[str] = None
    OLLAMA_BASE_URL: str = "http://localhost:11434"

    # Email & SMTP Settings
    SMTP_HOST: Optional[str] = None
    SMTP_PORT: int = 587
    SMTP_USER: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    SMTP_TLS: bool = True
    EMAILS_FROM_EMAIL: str = "noreply@hospital-agent.ai"
    EMAILS_FROM_NAME: str = "Hospital Voice Agent"

    # Monitoring & Observability
    SENTRY_DSN: Optional[str] = None
    LOG_LEVEL: str = "INFO"


settings = Settings()

