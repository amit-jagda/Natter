"""Structured Logging Configuration.

Configures standard library logging with contextual formatters, request ID propagation,
and optional Sentry error monitoring integration.
"""

import logging
import sys
from typing import Optional
from app.core.config import settings


def setup_logging(sentry_dsn: Optional[str] = None) -> None:
    """Configure application-wide structured logging and optional error monitoring."""
    log_level = getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO)

    log_format = (
        "[%(asctime)s] [%(levelname)s] [%(name)s] "
        "[req_id=%(request_id)s] %(message)s"
        if settings.ENVIRONMENT != "production"
        else '{"time": "%(asctime)s", "level": "%(levelname)s", "logger": "%(name)s", "message": "%(message)s"}'
    )

    class ContextFilter(logging.Filter):
        """Injects default request_id when logging outside of an HTTP request context."""
        def filter(self, record: logging.LogRecord) -> bool:
            if not hasattr(record, "request_id"):
                record.request_id = "-"
            return True

    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(log_level)
    handler.addFilter(ContextFilter())
    handler.setFormatter(logging.Formatter(log_format, datefmt="%Y-%m-%d %H:%M:%S"))

    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)
    # Clear existing handlers to prevent duplicate lines
    root_logger.handlers = [handler]

    # Silence overly noisy third-party libraries
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("asyncio").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.pool").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.dialects").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.orm").setLevel(logging.WARNING)

    # Sentry hook (if configured)
    if sentry_dsn:
        try:
            import sentry_sdk
            from sentry_sdk.integrations.fastapi import FastApiIntegration
            from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

            sentry_sdk.init(
                dsn=sentry_dsn,
                environment=settings.ENVIRONMENT,
                integrations=[FastApiIntegration(), SqlalchemyIntegration()],
                traces_sample_rate=0.1 if settings.ENVIRONMENT == "production" else 1.0,
            )
            root_logger.info("Sentry monitoring initialized successfully.")
        except ImportError:
            root_logger.warning("sentry-sdk not installed; skipping Sentry initialization.")

