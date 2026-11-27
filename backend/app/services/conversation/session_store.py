"""Conversation Session Store.

Provides server-controlled, expiring conversation state management.
Prefers Redis for multi-instance distribution with automatic in-memory fallback
for unit testing and offline development environments.
"""

import asyncio
import json
import logging
import os
import threading
import time
import uuid
from typing import Dict, Optional

from app.core.config import settings
from app.services.conversation.state import ConversationState

logger = logging.getLogger(__name__)

DEFAULT_SESSION_TTL_SECONDS = 7200  # 2 hours


class ConversationSessionStore:
    """Thread-safe, Redis-backed session store with automatic in-memory fallback."""

    def __init__(
        self,
        ttl_seconds: int = DEFAULT_SESSION_TTL_SECONDS,
        use_redis: bool = True,
        retry_cooldown_seconds: float = 10.0,
    ) -> None:
        self.ttl_seconds = ttl_seconds
        self.use_redis = use_redis
        self.retry_cooldown_seconds = retry_cooldown_seconds
        self._memory_cache: Dict[str, ConversationState] = {}
        self._lock = threading.Lock()
        self._redis_checked = False
        self._redis_available = False
        self._redis_retry_after = 0.0

    def _redis_key(self, session_id: str) -> str:
        return f"voice_session:{session_id}"

    async def _get_redis(self):
        """Lazy-load async redis client with cooldown-based automatic reconnect."""
        if not self.use_redis:
            return None

        # In test environment or offline, always use fast in-memory store
        if os.environ.get("ENVIRONMENT", "").lower() == "test" or getattr(settings, "ENVIRONMENT", "").lower() == "test":
            return None

        now = time.monotonic()
        if self._redis_checked and not self._redis_available and now < self._redis_retry_after:
            return None

        try:
            from app.workers.redis import get_redis_client
            client = await get_redis_client()
            # Fast ping with 0.5s timeout
            await asyncio.wait_for(client.ping(), timeout=0.5)
            self._redis_checked = True
            self._redis_available = True
            self._redis_retry_after = 0.0
            return client
        except Exception as exc:
            self._redis_checked = True
            self._redis_available = False
            self._redis_retry_after = now + self.retry_cooldown_seconds
            logger.debug("Redis unavailable for session store, using memory fallback: %s", exc)
            return None

    async def get_session_async(self, session_id: str) -> Optional[ConversationState]:
        """Retrieve conversation state by session ID, checking Redis first then in-memory cache."""
        if not session_id:
            return None

        redis = await self._get_redis()
        if redis is not None:
            try:
                data_str = await redis.get(self._redis_key(session_id))
                if data_str:
                    data = json.loads(data_str)
                    state = ConversationState.from_dict(data)
                    with self._lock:
                        self._memory_cache[session_id] = state
                    return state
            except Exception as exc:
                logger.warning("Failed to fetch session %s from Redis: %s", session_id, exc)

        with self._lock:
            state = self._memory_cache.get(session_id)
            if state and (time.time() - state.updated_at) > self.ttl_seconds:
                del self._memory_cache[session_id]
                return None
            return state

    async def save_session_async(self, state: ConversationState) -> None:
        """Persist updated conversation state to Redis and in-memory cache."""
        state.updated_at = time.time()

        # Update local memory cache
        with self._lock:
            self._memory_cache[state.session_id] = state

        # Persist to Redis with expiration
        redis = await self._get_redis()
        if redis is not None:
            try:
                data_str = json.dumps(state.to_dict())
                await redis.set(
                    self._redis_key(state.session_id),
                    data_str,
                    ex=self.ttl_seconds,
                )
            except Exception as exc:
                logger.warning("Failed to save session %s to Redis: %s", state.session_id, exc)

    async def get_or_create_session_async(
        self,
        session_id: Optional[str] = None,
        *,
        tenant_id: Optional[str] = None,
        language: str = "en",
        caller_phone: Optional[str] = None,
    ) -> ConversationState:
        """Fetch existing session or initialize a fresh server-controlled state."""
        sid = session_id or str(uuid.uuid4())
        existing = await self.get_session_async(sid)
        if existing:
            if tenant_id and not existing.tenant_id:
                existing.tenant_id = tenant_id
            if caller_phone and not existing.caller_phone:
                existing.caller_phone = caller_phone
            return existing

        new_state = ConversationState(
            session_id=sid,
            tenant_id=tenant_id,
            language=language,
            caller_phone=caller_phone,
        )
        await self.save_session_async(new_state)
        return new_state

    async def reset_session_async(self, session_id: str) -> bool:
        """Purge conversational state for session_id."""
        with self._lock:
            self._memory_cache.pop(session_id, None)

        redis = await self._get_redis()
        if redis is not None:
            try:
                await redis.delete(self._redis_key(session_id))
            except Exception as exc:
                logger.warning("Failed to delete session %s from Redis: %s", session_id, exc)
        return True

    # =========================================================================
    # Synchronous Compatibility Methods (for existing callers & offline tests)
    # =========================================================================
    def get_session(self, session_id: str) -> Optional[ConversationState]:
        """Synchronously get session from local memory cache."""
        with self._lock:
            return self._memory_cache.get(session_id)

    def save_session(self, state: ConversationState) -> None:
        """Synchronously save session to local memory cache."""
        state.updated_at = time.time()
        with self._lock:
            self._memory_cache[state.session_id] = state

    def get_or_create_session(
        self,
        session_id: Optional[str] = None,
        *,
        tenant_id: Optional[str] = None,
    ) -> ConversationState:
        """Synchronously fetch or create state in local memory cache."""
        sid = session_id or str(uuid.uuid4())
        with self._lock:
            if sid in self._memory_cache:
                state = self._memory_cache[sid]
                if tenant_id and not state.tenant_id:
                    state.tenant_id = tenant_id
                return state

            new_state = ConversationState(session_id=sid, tenant_id=tenant_id)
            self._memory_cache[sid] = new_state
            return new_state

    def reset_session(self, session_id: str) -> bool:
        """Synchronously reset state in local memory cache."""
        with self._lock:
            if session_id in self._memory_cache:
                del self._memory_cache[session_id]
                return True
            return False


# Shared Global Conversation Session Store Instance
conversation_session_store = ConversationSessionStore()
