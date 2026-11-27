"""Redis Connection and Arq Client Pool.

Provides Redis client initialization, health checking, and Arq queue connection.
"""

import asyncio
import logging
from typing import Any, Optional

try:
    from arq import create_pool
    from arq.connections import ArqRedis, RedisSettings
except ImportError:
    create_pool = None  # type: ignore
    ArqRedis = Any  # type: ignore
    RedisSettings = Any  # type: ignore
import redis.asyncio as aioredis
from app.core.config import settings

logger = logging.getLogger(__name__)

_redis_client: Optional[aioredis.Redis] = None
_redis_loop_id: Optional[int] = None
_arq_pool: Optional[ArqRedis] = None


def get_redis_settings() -> RedisSettings:
    """Generate Arq-compatible RedisSettings from application config."""
    return RedisSettings(
        host=settings.REDIS_HOST,
        port=settings.REDIS_PORT,
        password=settings.REDIS_PASSWORD,
        database=settings.REDIS_DB,
    )


async def get_redis_client() -> aioredis.Redis:
    """Return an async Redis client bound cleanly to the current running event loop."""
    global _redis_client, _redis_loop_id
    try:
        current_loop_id: Optional[int] = id(asyncio.get_running_loop())
    except RuntimeError:
        current_loop_id = None

    if _redis_client is not None and _redis_loop_id != current_loop_id:
        _redis_client = None
        _redis_loop_id = None

    if _redis_client is None:
        _redis_client = aioredis.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=1.0,
            socket_timeout=1.0,
        )
        _redis_loop_id = current_loop_id
    return _redis_client


async def get_arq_pool() -> ArqRedis:
    """Return an initialized Arq task enqueue pool."""
    global _arq_pool
    if _arq_pool is None:
        _arq_pool = await create_pool(get_redis_settings())
    return _arq_pool


async def close_redis() -> None:
    """Close active Redis and Arq client pools during application shutdown."""
    global _redis_client, _redis_loop_id, _arq_pool
    if _redis_client is not None:
        try:
            await _redis_client.close()
        except RuntimeError:
            pass
        _redis_client = None
        _redis_loop_id = None
    if _arq_pool is not None:
        try:
            await _arq_pool.close()
        except RuntimeError:
            pass
        _arq_pool = None
    logger.info("Closed Redis connection pools.")


async def check_redis_health() -> bool:
    """Ping Redis to verify server connectivity."""
    try:
        client = await get_redis_client()
        return await client.ping() is True
    except Exception as exc:
        logger.error("Redis health check failed: %s", exc)
        return False

