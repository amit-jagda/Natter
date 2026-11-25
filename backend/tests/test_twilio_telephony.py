"""Unit tests for Twilio Cloud Telephony integration."""

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.services.twilio_service import format_e164, twilio_service


def test_format_e164():
    """Verify phone numbers are correctly converted to international E.164 format."""
    assert format_e164("8980616264") == "+918980616264"
    assert format_e164("9328291692") == "+919328291692"
    assert format_e164("+918980616264") == "+918980616264"
    assert format_e164("918980616264") == "+918980616264"
    assert format_e164("+14155552671") == "+14155552671"


def test_twiml_initial_generation():
    """Verify initial TwiML contains patient greeting and speech gather with barge-in."""
    xml = twilio_service.generate_initial_twiml(
        call_id="test_call_01",
        patient_name="tushar",
        hospital_name="City Hospital",
        callback_base_url="http://localhost:8000",
    )
    assert "<Response>" in xml
    assert "tushar" in xml
    assert '<Gather input="speech"' in xml
    assert 'bargeIn="true"' in xml
    assert "/api/v1/telephony/twilio/turn?call_id=test_call_01" in xml


def test_twiml_turn_generation():
    """Verify conversational turn TwiML contains the AI's reply with barge-in."""
    reply_xml = twilio_service.generate_turn_twiml(
        call_id="test_call_01",
        bot_reply="Your appointment with Dr. Sharma is confirmed for 4 PM.",
        callback_base_url="http://localhost:8000",
        is_closing=False,
    )
    assert "<Response>" in reply_xml
    assert "Dr. Sharma" in reply_xml
    assert '<Gather input="speech"' in reply_xml
    assert 'bargeIn="true"' in reply_xml

    closing_xml = twilio_service.generate_turn_twiml(
        call_id="test_call_01",
        bot_reply="Thank you for choosing our hospital. Goodbye!",
        callback_base_url="http://localhost:8000",
        is_closing=True,
    )
    assert "<Hangup/>" in closing_xml


@pytest.mark.asyncio
async def test_twilio_config_status_endpoint():
    """Verify GET /api/v1/telephony/twilio/config-status reports status."""
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.get("/api/v1/telephony/twilio/config-status")
        assert resp.status_code == 200
        data = resp.json()
        assert "configured" in data
        assert "account_sid_present" in data


@pytest.mark.asyncio
async def test_twilio_twiml_endpoint():
    """Verify POST /api/v1/telephony/twilio/twiml serves application/xml."""
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.post(
            "/api/v1/telephony/twilio/twiml?call_id=c123&patient_name=tushar&hospital_name=xyz",
        )
        assert resp.status_code == 200
        assert "application/xml" in resp.headers.get("content-type", "")
        assert "tushar" in resp.text
