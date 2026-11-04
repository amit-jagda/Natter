"""Arq Background Worker Definition.

Defines background tasks, job lifecycles, and worker configuration.
Execute via: `arq app.workers.worker.WorkerSettings`
"""

import logging
from typing import Any, Dict
from app.workers.redis import get_redis_settings

logger = logging.getLogger(__name__)


async def startup(ctx: Dict[Any, Any]) -> None:
    """Worker startup hook: initialize database pools and background resources."""
    logger.info("Initializing Arq background worker...")
    ctx["worker_initialized"] = True


async def shutdown(ctx: Dict[Any, Any]) -> None:
    """Worker shutdown hook: gracefully terminate worker resources."""
    logger.info("Shutting down Arq background worker...")


async def ping_job(ctx: Dict[Any, Any], message: str = "pong") -> str:
    """Simple verification job to ensure the worker is consuming tasks."""
    logger.info("Executing background ping job with message: %s", message)
    return f"Processed: {message}"


class WorkerSettings:
    """Arq Worker settings specification."""

    functions = [ping_job]
    redis_settings = get_redis_settings()
    on_startup = startup
    on_shutdown = shutdown
    max_jobs = 10
    job_timeout = 300
    keep_result = 3600

