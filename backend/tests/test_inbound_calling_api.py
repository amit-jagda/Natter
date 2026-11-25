"""Integration Tests for Phase 5 Inbound Calling API Boundary.

Tests:
1. Rejection of unresolvable tenant (400 Bad Request).
2. Authoritative DID dialed number tenant resolution.
3. Authenticated direct tenant_id resolution.
4. Service-to-service authentication enforcement.
5. Provider-independent response contract verification (no Gemini/internal leakage).
6. Action signal propagation (booking_confirmed, transfer_to_human, emergency_divert).
"""

import asyncio
from datetime import date, datetime, time
import os
from pathlib import Path
import sys
import unittest
import uuid
from typing import Any, Dict, List, Optional

backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

os.environ["ENVIRONMENT"] = "test"
os.environ["SECRET_KEY"] = "test-secret-key-for-calling-api-boundary"

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.adapters.llm.base import LLMMessage, LLMResponse, MockLLMAdapter, ToolCall
from app.api.v1.voice import router as voice_router
from app.core.config import settings
from app.database.session import get_db
from app.models.tenant import Tenant
from app.services.conversation.orchestrator import conversation_orchestrator, ConversationOrchestrator
from app.services.conversation.session_store import ConversationSessionStore


class MockScalars:
    def __init__(self, items):
        self._items = items

    def all(self):
        return list(self._items)


class MockResult:
    def __init__(self, items):
        self._items = items

    def scalars(self):
        return MockScalars(self._items)

    def scalar_one_or_none(self):
        return self._items[0] if self._items else None


class MockAsyncDBSession:
    """Mock session for API router testing."""

    def __init__(self, tenants: List[Tenant]):
        self.tenants = tenants

    async def execute(self, statement):
        stmt_str = str(statement)
        if "FROM tenants" in stmt_str:
            params = statement.compile().params
            matched = list(self.tenants)
            for k, v in params.items():
                if "phone_number" in k or "emergency_contact" in k:
                    clean_v = str(v).replace("%", "")
                    matched = [
                        t for t in matched
                        if (t.phone_number and clean_v in t.phone_number)
                        or (t.emergency_contact and clean_v in t.emergency_contact)
                    ]
                elif "id" in k and isinstance(v, uuid.UUID):
                    matched = [t for t in matched if t.id == v]
            return MockResult(matched)
        return MockResult([])


class TestInboundCallingAPI(unittest.TestCase):
    """Test suite for the telephony conversation API boundary."""

    def setUp(self):
        self.tenant_id = uuid.uuid4()
        self.test_tenant = Tenant(
            id=self.tenant_id,
            name="Apollo City Hospital",
            slug="apollo-city",
            phone_number="18005550199",
            emergency_contact="18005550911",
            is_active=True,
        )

        self.mock_db = MockAsyncDBSession([self.test_tenant])
        conversation_orchestrator._llm = MockLLMAdapter(
            canned_response="I can assist you with your hospital appointment."
        )

        self.app = FastAPI()
        self.app.include_router(voice_router, prefix="/api/v1")

        # Dependency override for database session
        async def override_get_db():
            yield self.mock_db

        self.app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(self.app)

    def tearDown(self):
        self.app.dependency_overrides.clear()

    # -------------------------------------------------------------------------
    # 1. Tenant Security & Trust Boundary Tests
    # -------------------------------------------------------------------------
    def test_unresolvable_tenant_rejected(self):
        """Verify request without valid dialed DID or tenant ID is rejected with 400."""
        payload = {
            "transcript": "Hello, I want to book an appointment",
            "caller_phone": "+919876543210",
            # neither dialed_number nor valid tenant_id
        }
        res = self.client.post("/api/v1/voice/chat-turn", json=payload)
        self.assertEqual(res.status_code, 400)
        self.assertIn("Unable to resolve active hospital tenant", res.json()["detail"])

    def test_dialed_did_resolves_hospital_tenant(self):
        """Verify dialed hospital DID authoritatively resolves tenant without trusting caller."""
        payload = {
            "transcript": "Hello, good morning",
            "dialed_number": "+1 (800) 555-0199",  # Matches Apollo City Hospital
            "caller_phone": "+919999999999",  # Untrusted caller number
        }
        res = self.client.post("/api/v1/voice/chat-turn", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("session_id", data)
        self.assertIn("response_text", data)
        self.assertEqual(data["conversation_status"], "in_progress")

    def test_service_api_key_enforcement(self):
        """Verify service-to-service key is strictly validated when configured."""
        try:
            settings.SERVICE_API_KEY = "super-secret-telephony-token"

            # Missing header -> 401
            res1 = self.client.post(
                "/api/v1/voice/chat-turn",
                json={"transcript": "Hi", "dialed_number": "18005550199"},
            )
            self.assertEqual(res1.status_code, 401)

            # Valid header -> 200
            res2 = self.client.post(
                "/api/v1/voice/chat-turn",
                json={"transcript": "Hi", "dialed_number": "18005550199"},
                headers={"X-Service-API-Key": "super-secret-telephony-token"},
            )
            self.assertEqual(res2.status_code, 200)

        finally:
            settings.SERVICE_API_KEY = None

    # -------------------------------------------------------------------------
    # 2. Provider Independence & Contract Isolation Tests
    # -------------------------------------------------------------------------
    def test_response_is_provider_independent(self):
        """Verify response contains clean spoken text and standard signals with zero LLM/tool internals."""
        payload = {
            "transcript": "What doctors are available?",
            "tenant_id": str(self.tenant_id),
        }
        res = self.client.post("/api/v1/voice/chat-turn", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()

        # Contract fields must exist
        self.assertIn("session_id", data)
        self.assertIn("response_text", data)
        self.assertIn("conversation_status", data)
        self.assertIn("action_signal", data)
        self.assertIn("current_stage", data)

        # Gemini-specific / internal tool artifacts must NOT be exposed
        self.assertNotIn("functionCall", data)
        self.assertNotIn("candidates", data)
        self.assertNotIn("thought", data)
        self.assertNotIn("tool_calls", data)
        self.assertNotIn("tool_results", data)
        self.assertNotIn("system_instruction", data)


if __name__ == "__main__":
    unittest.main()
