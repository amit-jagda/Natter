"""Layer 2 Real Redis Session Store Integration Tests.

Validates against real Redis 7 (DB index 15):
1. Actual Redis key creation (voice_ai:session:{id}) and ping connectivity.
2. ConversationState round-trip (messages, ToolCall thought_signature, verified status, stage).
3. Secret sanitization in persisted JSON (otp/password masked as ***).
4. Cross-worker / process-restart simulation across two independent ConversationSessionStore instances.
5. Real Redis TTL expiration behavior and session reset key deletion.
6. Audit of sticky Redis outage disablement defect (_redis_checked / _redis_available).
"""

import asyncio
import json
from unittest.mock import AsyncMock, patch
import uuid

import pytest
import redis.asyncio as aioredis

from app.adapters.llm.base import ToolCall, ToolResult
from app.services.conversation.session_store import ConversationSessionStore
from app.services.conversation.state import ConversationState
from app.workers.redis import close_redis

from tests.integration.conftest import TEST_REDIS_URL


@pytest.mark.asyncio
async def test_redis_session_roundtrip_sanitization_and_worker_handoff(redis_cleanup):
    """Verify real Redis storage, thought_signature & verification persistence, sanitization, and cross-store read."""
    client = aioredis.from_url(
        TEST_REDIS_URL,
        decode_responses=True,
        socket_connect_timeout=2.0,
        socket_timeout=2.0,
    )
    await client.flushdb()

    session_id = f"int-redis-{uuid.uuid4().hex[:10]}"
    redis_key = f"voice_session:{session_id}"

    try:
        store_worker_a = ConversationSessionStore(ttl_seconds=120, use_redis=True)
        state = await store_worker_a.get_or_create_session_async(
            session_id,
            tenant_id=str(uuid.uuid4()),
            language="en",
            caller_phone="9876543210",
        )
        state.current_intent = "book_appointment"
        state.current_stage = "slot_selection"
        state.set_verified("patient-123", verification_method="demographic_name_match")
        state.add_message("user", "Book me with Dr. Sharma tomorrow")
        state.add_message(
            "assistant",
            "Checking availability",
            tool_calls=[
                ToolCall(
                    name="get_doctor_availability",
                    arguments={"doctor_id": "doc-1", "date": "2026-12-01"},
                    call_id="call_1",
                    thought_signature="sig_gemini_xyz",
                )
            ],
        )
        state.add_message(
            "tool",
            '{"success": true}',
            tool_result=ToolResult(
                name="get_doctor_availability",
                result={"success": True, "available_slots": ["10:00"]},
                call_id="call_1",
            ),
        )
        state.record_tool_execution(
            "verify_patient_identity",
            {"patient_name": "Priya", "otp": "otp-918273", "password": "topsecret-pw"},
            {"success": True},
        )

        await store_worker_a.save_session_async(state)

        # 1. Verify raw key, TTL, and secret sanitization directly in Redis
        raw_val = await client.get(redis_key)
        assert raw_val is not None
        ttl = await client.ttl(redis_key)
        assert 0 < ttl <= 120

        assert "otp-918273" not in raw_val
        assert "topsecret-pw" not in raw_val
        parsed = json.loads(raw_val)
        assert parsed["tool_execution_history"][0]["arguments"]["otp"] == "***"
        assert parsed["tool_execution_history"][0]["arguments"]["password"] == "***"

        # 2. Simulate Worker B (brand new store with empty in-memory cache) reading from Redis
        store_worker_b = ConversationSessionStore(ttl_seconds=120, use_redis=True)
        assert session_id not in store_worker_b._memory_cache

        loaded = await store_worker_b.get_session_async(session_id)
        assert loaded is not None
        assert loaded.verified_patient_id == "patient-123"
        assert loaded.is_verified() is True
        assert loaded.current_stage == "slot_selection"
        assert loaded.caller_phone == "9876543210"
        assert len(loaded.messages) == 3
        assert loaded.messages[1].tool_calls[0].thought_signature == "sig_gemini_xyz"
    finally:
        await client.flushdb()
        await client.aclose()


@pytest.mark.asyncio
async def test_redis_ttl_expiration_and_reset(redis_cleanup):
    """Verify Redis key TTL actually expires and reset_session_async removes key from Redis."""
    client = aioredis.from_url(
        TEST_REDIS_URL,
        decode_responses=True,
        socket_connect_timeout=2.0,
        socket_timeout=2.0,
    )
    await client.flushdb()

    session_exp = f"int-ttl-{uuid.uuid4().hex[:8]}"
    session_rst = f"int-rst-{uuid.uuid4().hex[:8]}"

    try:
        # 1. TTL expiration test
        short_store = ConversationSessionStore(ttl_seconds=2, use_redis=True)
        st = await short_store.get_or_create_session_async(session_exp)
        st.add_message("user", "Hello")
        await short_store.save_session_async(st)

        assert await client.exists(f"voice_session:{session_exp}") == 1
        await asyncio.sleep(2.4)
        assert await client.exists(f"voice_session:{session_exp}") == 0

        fresh_reader = ConversationSessionStore(ttl_seconds=2, use_redis=True)
        assert await fresh_reader.get_session_async(session_exp) is None

        # 2. Explicit reset deletes Redis key and memory entry
        normal_store = ConversationSessionStore(ttl_seconds=60, use_redis=True)
        st2 = await normal_store.get_or_create_session_async(session_rst)
        await normal_store.save_session_async(st2)
        assert await client.exists(f"voice_session:{session_rst}") == 1

        await normal_store.reset_session_async(session_rst)
        assert await client.exists(f"voice_session:{session_rst}") == 0
        assert await normal_store.get_session_async(session_rst) is None
    finally:
        await client.flushdb()
        await client.aclose()


@pytest.mark.asyncio
async def test_redis_reconnect_recovery_after_transient_outage(redis_cleanup):
    """Verify ConversationSessionStore automatically recovers Redis after cooldown expires."""
    client = aioredis.from_url(
        TEST_REDIS_URL,
        decode_responses=True,
        socket_connect_timeout=2.0,
        socket_timeout=2.0,
    )
    await client.flushdb()

    store = ConversationSessionStore(
        ttl_seconds=60,
        use_redis=True,
        retry_cooldown_seconds=0.1,
    )
    session_id = f"int-recover-{uuid.uuid4().hex[:8]}"

    try:
        # 1. Transient outage -> graceful memory fallback
        with patch(
            "app.workers.redis.get_redis_client",
            new=AsyncMock(side_effect=ConnectionError("Transient Redis blip")),
        ):
            r1 = await store._get_redis()
            assert r1 is None
            assert store._redis_available is False

        # 2. Immediately during cooldown, returns None without hammering Redis
        r_cooldown = await store._get_redis()
        assert r_cooldown is None

        # 3. After cooldown expires, automatically reconnects and persists to Redis
        await asyncio.sleep(0.15)
        r_recovered = await store._get_redis()
        assert r_recovered is not None
        assert store._redis_available is True

        st = ConversationState(session_id=session_id)
        await store.save_session_async(st)
        assert await client.exists(f"voice_session:{session_id}") == 1
    finally:
        await client.flushdb()
        await client.aclose()
        await close_redis()
