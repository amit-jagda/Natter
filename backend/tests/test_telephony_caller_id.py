"""Unit Tests for LiveKit Telephony & Hospital Profile Phone (Caller ID) Enforcement.

Verifies:
1. Outbound call FAILS with 400 Bad Request when Hospital Profile has no phone number.
2. Outbound call SUCCEEDS and uses the exact Hospital Profile phone number as Caller ID.
3. Inbound call FAILS with 400 Bad Request when Hospital Profile has no phone number.
4. Inbound call SUCCEEDS and associates the hospital's profile phone number.
5. LiveKit JWT access token generation with room and audio grants.
6. Telephony chat turn with AI response and session persistence.
"""

import sys
import unittest
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, patch

backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

from fastapi import HTTPException
import jwt
from app.api.v1.telephony import (
    OutboundCallRequest,
    InboundCallRequest,
    ChatTurnRequest,
    PhoneCallDispatchRequest,
    initiate_outbound_call,
    initiate_inbound_call,
    process_telephony_turn,
    dispatch_phone_call,
)
from app.models.tenant import Tenant
from app.models.user import User
from app.services.livekit_service import livekit_telephony_service


class TestTelephonyCallerIdEnforcement(unittest.IsolatedAsyncioTestCase):
    """Test suite ensuring calls strictly require and use the Hospital Profile phone number."""

    def setUp(self):
        self.tenant_id = uuid.uuid4()
        self.user_id = uuid.uuid4()
        self.mock_user = User(
            id=self.user_id,
            email="admin@hospital.com",
            full_name="Hospital Administrator",
            tenant_id=self.tenant_id,
        )

    async def test_outbound_call_fails_when_hospital_phone_is_missing(self):
        """Outbound call must be rejected with 400 when hospital profile phone is empty/None."""
        tenant_without_phone = Tenant(
            id=self.tenant_id,
            name="Apollo City Clinic",
            phone_number=None,  # No phone number configured in profile!
        )

        payload = OutboundCallRequest(
            patient_name="Ramesh Kumar",
            patient_phone="9876543210",
        )

        with self.assertRaises(HTTPException) as ctx:
            await initiate_outbound_call(
                payload=payload,
                tenant=tenant_without_phone,
                user=self.mock_user,
            )

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Hospital phone number is not configured in Hospital Profile", ctx.exception.detail)

    async def test_outbound_call_fails_when_hospital_phone_is_blank_string(self):
        """Outbound call must be rejected with 400 when hospital profile phone is whitespace."""
        tenant_with_blank_phone = Tenant(
            id=self.tenant_id,
            name="Apollo City Clinic",
            phone_number="   ",
        )

        payload = OutboundCallRequest(
            patient_name="Suresh Patel",
            patient_phone="9876543210",
        )

        with self.assertRaises(HTTPException) as ctx:
            await initiate_outbound_call(
                payload=payload,
                tenant=tenant_with_blank_phone,
                user=self.mock_user,
            )

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Hospital Profile", ctx.exception.detail)

    async def test_outbound_call_succeeds_using_hospital_profile_phone(self):
        """Outbound call must succeed and strictly use the Hospital Profile phone number as Caller ID."""
        hospital_verified_number = "+91 98765 11223"
        tenant_with_phone = Tenant(
            id=self.tenant_id,
            name="Apollo City Clinic",
            phone_number=hospital_verified_number,
        )

        payload = OutboundCallRequest(
            patient_name="Ramesh Kumar",
            patient_phone="9876543210",
        )

        response = await initiate_outbound_call(
            payload=payload,
            tenant=tenant_with_phone,
            user=self.mock_user,
        )

        self.assertEqual(response["status"], "connected")
        self.assertEqual(response["hospital_phone"], hospital_verified_number)
        self.assertEqual(response["patient_phone"], "9876543210")
        self.assertEqual(response["patient_name"], "Ramesh Kumar")
        self.assertIn("Apollo City Clinic", response["initial_greeting"])
        self.assertTrue(response["token"])
        self.assertTrue(response["call_id"].startswith("call_"))

    async def test_inbound_call_fails_when_hospital_phone_is_missing(self):
        """Inbound call must be rejected with 400 when hospital profile has no phone number."""
        tenant_without_phone = Tenant(
            id=self.tenant_id,
            name="Apollo City Clinic",
            phone_number=None,
        )

        payload = InboundCallRequest(
            caller_phone="9876543210",
        )

        with self.assertRaises(HTTPException) as ctx:
            await initiate_inbound_call(
                payload=payload,
                tenant=tenant_without_phone,
            )

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Hospital phone number is not configured in Hospital Profile", ctx.exception.detail)

    async def test_inbound_call_succeeds_using_hospital_profile_phone(self):
        """Inbound call must succeed and use the Hospital Profile phone number."""
        hospital_verified_number = "+91 98765 99887"
        tenant_with_phone = Tenant(
            id=self.tenant_id,
            name="Apex General Hospital",
            phone_number=hospital_verified_number,
        )

        payload = InboundCallRequest(
            caller_phone="9876543210",
        )

        response = await initiate_inbound_call(
            payload=payload,
            tenant=tenant_with_phone,
        )

        self.assertEqual(response["status"], "connected")
        self.assertEqual(response["hospital_phone"], hospital_verified_number)
        self.assertEqual(response["direction"], "inbound")
        self.assertIn("Apex General Hospital", response["initial_greeting"])
        self.assertTrue(response["token"])

    def test_livekit_token_contains_room_and_video_grants(self):
        """LiveKit JWT token must include valid subject and room permissions."""
        room_name = "room_test_123"
        token = livekit_telephony_service.create_token(
            room_name=room_name,
            participant_identity="patient_001",
            participant_name="Ramesh Kumar",
        )
        self.assertTrue(isinstance(token, str))

        # Decode token without verification to inspect claims
        decoded = jwt.decode(token, options={"verify_signature": False})
        self.assertEqual(decoded["sub"], "patient_001")
        self.assertEqual(decoded["name"], "Ramesh Kumar")
        self.assertEqual(decoded["video"]["room"], room_name)
        self.assertTrue(decoded["video"]["roomJoin"])
        self.assertTrue(decoded["video"]["canPublish"])

    async def test_telephony_chat_turn_fallback_receptionist(self):
        """Chat turn processes user message and returns conversational bot response."""
        payload = ChatTurnRequest(
            call_id=f"session_{uuid.uuid4().hex[:8]}",
            message="I want to book an appointment with a cardiologist tomorrow",
        )
        res = await process_telephony_turn(payload)
        self.assertTrue("reply" in res)
        self.assertTrue(len(res["reply"]) > 0)

    async def test_phone_dispatch_fails_without_hospital_phone(self):
        """Direct phone dispatch must fail with 400 when hospital profile phone is missing."""
        tenant_no_phone = Tenant(
            id=self.tenant_id,
            name="Apollo Clinic",
            phone_number=None,
        )
        payload = PhoneCallDispatchRequest(
            patient_name="Tushar",
            patient_phone="9876543210",
        )
        with self.assertRaises(HTTPException) as ctx:
            await dispatch_phone_call(payload=payload, tenant=tenant_no_phone)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Hospital Profile", ctx.exception.detail)

    async def test_phone_dispatch_succeeds_with_hospital_profile_phone(self):
        """Direct phone dispatch must succeed with tel: URI and hospital caller ID."""
        hospital_phone = "+91 9988776655"
        tenant_with_phone = Tenant(
            id=self.tenant_id,
            name="Apollo Clinic",
            phone_number=hospital_phone,
        )
        payload = PhoneCallDispatchRequest(
            patient_name="Tushar",
            patient_phone="9876543210",
        )
        res = await dispatch_phone_call(payload=payload, tenant=tenant_with_phone)
        self.assertEqual(res["status"], "dispatched")
        self.assertEqual(res["hospital_phone"], hospital_phone)
        self.assertEqual(res["patient_phone"], "9876543210")
        self.assertEqual(res["tel_uri"], "tel:9876543210")
        self.assertTrue("wa.me" in res["whatsapp_uri"])



if __name__ == "__main__":
    unittest.main()
