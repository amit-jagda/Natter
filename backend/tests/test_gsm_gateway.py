"""Unit Tests for GSM Gateway & Android Phone SIM Telephony.

Verifies:
1. Device status query (online, SIM number, battery).
2. Android phone heartbeat registration and pending dial command retrieval.
3. Outbound GSM call fails with 400 when Hospital Profile phone is missing.
4. Outbound GSM call succeeds and enqueues dial command with Caller ID.
5. Call lifecycle state reporting (ringing -> connected -> ended).
6. Conversational turn processing during active GSM call.
"""

import sys
import unittest
import uuid
from pathlib import Path

backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

from fastapi import HTTPException
from app.api.v1.gsm_gateway import (
    GsmDialRequest,
    GsmHeartbeatRequest,
    GsmEventRequest,
    GsmChatTurnRequest,
    get_gateway_status,
    phone_heartbeat,
    dispatch_gsm_dial,
    report_gsm_event,
    process_gsm_chat_turn,
)
from app.models.tenant import Tenant
from app.models.user import User
from app.services.gsm_gateway_service import gsm_gateway_service


class TestGsmGatewayTelephony(unittest.IsolatedAsyncioTestCase):
    """Test suite covering Android GSM Gateway phone calling and AI bridge."""

    def setUp(self):
        self.tenant_id = uuid.uuid4()
        self.user_id = uuid.uuid4()
        self.mock_user = User(
            id=self.user_id,
            email="xyz@gmail.com",
            full_name="Hospital Administrator",
            tenant_id=self.tenant_id,
        )

    async def test_get_gsm_device_status(self):
        """Gateway returns paired status and hospital SIM number."""
        status = await get_gateway_status()
        self.assertTrue(status["paired"])
        self.assertEqual(status["status"], "online")
        self.assertTrue("sim_number" in status)

    async def test_gsm_dial_fails_without_hospital_phone(self):
        """GSM dial must be rejected with 400 when hospital profile phone is missing."""
        tenant_no_phone = Tenant(
            id=self.tenant_id,
            name="Apollo City Clinic",
            phone_number=None,
        )
        payload = GsmDialRequest(
            patient_name="Tushar",
            patient_phone="8980616264",
        )
        with self.assertRaises(HTTPException) as ctx:
            await dispatch_gsm_dial(
                payload=payload,
                tenant=tenant_no_phone,
                user=self.mock_user,
            )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Hospital Profile", ctx.exception.detail)

    async def test_gsm_dial_succeeds_with_hospital_sim(self):
        """GSM dial enqueues physical call command using Hospital SIM."""
        hospital_sim = "9328291692"
        tenant_with_sim = Tenant(
            id=self.tenant_id,
            name="City Hospital",
            phone_number=hospital_sim,
        )
        payload = GsmDialRequest(
            patient_name="Tushar",
            patient_phone="8980616264",
        )
        res = await dispatch_gsm_dial(
            payload=payload,
            tenant=tenant_with_sim,
            user=self.mock_user,
        )
        self.assertEqual(res["status"], "dialing")
        self.assertEqual(res["hospital_phone"], hospital_sim)
        self.assertEqual(res["patient_phone"], "8980616264")
        self.assertEqual(res["patient_name"], "Tushar")
        self.assertTrue(res["call_id"].startswith("gsm_"))
        self.assertIn("City Hospital", res["initial_greeting"])

    async def test_phone_heartbeat_retrieves_dial_command(self):
        """Android phone heartbeat polling retrieves queued dial action."""
        # Enqueue a dial command
        gsm_gateway_service.initiate_gsm_call(
            hospital_phone="9328291692",
            patient_phone="8980616264",
            patient_name="Tushar",
        )

        heartbeat_req = GsmHeartbeatRequest(
            device_id="hospital_gateway_01",
            device_name="Hospital Pixel 8",
            sim_number="9328291692",
            battery_level=95,
            is_charging=True,
        )
        res = await phone_heartbeat(heartbeat_req)
        self.assertEqual(res["status"], "ok")
        self.assertTrue(len(res["pending_commands"]) > 0)
        command = res["pending_commands"][0]
        self.assertEqual(command["action"], "dial")
        self.assertEqual(command["target_number"], "8980616264")

    async def test_gsm_call_event_reporting(self):
        """Phone reports lifecycle transitions like ringing, connected, and ended."""
        call_info = gsm_gateway_service.initiate_gsm_call(
            hospital_phone="9328291692",
            patient_phone="8980616264",
            patient_name="Tushar",
        )
        call_id = call_info["call_id"]

        # Report ringing
        event_res = await report_gsm_event(
            GsmEventRequest(call_id=call_id, event="ringing")
        )
        self.assertTrue(event_res["updated"])
        self.assertEqual(event_res["event"], "ringing")

        # Report connected
        conn_res = await report_gsm_event(
            GsmEventRequest(call_id=call_id, event="connected")
        )
        self.assertTrue(conn_res["updated"])

        # Report ended with duration
        end_res = await report_gsm_event(
            GsmEventRequest(call_id=call_id, event="ended", duration_sec=45)
        )
        self.assertTrue(end_res["updated"])

        record = gsm_gateway_service.get_call(call_id)
        self.assertIsNotNone(record)
        self.assertEqual(record.status, "ended")
        self.assertEqual(record.duration_sec, 45)

    async def test_gsm_chat_turn_ai_conversation(self):
        """Conversational turn during active GSM call returns AI reply."""
        call_info = gsm_gateway_service.initiate_gsm_call(
            hospital_phone="9328291692",
            patient_phone="8980616264",
            patient_name="Tushar",
        )
        call_id = call_info["call_id"]

        turn_req = GsmChatTurnRequest(
            call_id=call_id,
            message="Hello, can I consult Dr. Sharma today?",
        )
        turn_res = await process_gsm_chat_turn(turn_req)
        self.assertTrue("reply" in turn_res)
        self.assertTrue(len(turn_res["reply"]) > 0)


if __name__ == "__main__":
    unittest.main()
