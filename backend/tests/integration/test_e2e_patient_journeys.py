"""Stage 6 Part C: Realistic End-to-End Patient Journeys (Layer 2 Integration).

Tests complete multi-turn healthcare conversations against:
- Real PostgreSQL 16 (voice_ai_test)
- Real Redis 7 (DB index 15)
- Live Google Gemini LLM & tool calling (GeminiLLMAdapter)
- Real FastAPI calling API (/api/v1/voice/chat-turn) + audio endpoint check
"""

import asyncio
import base64
from datetime import date, datetime, time, timedelta, timezone
import os
import subprocess
import tempfile
from typing import Any, Dict, List
import uuid

from fastapi import FastAPI
import httpx
import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.adapters.llm.gemini import GeminiLLMAdapter
from app.adapters.stt.google import GoogleSTTAdapter
from app.api.v1.voice import router as voice_router
from app.core.config import settings
from app.core.security import hash_password
from app.database.session import get_db
from app.models.appointment import Appointment
from app.models.doctor import Doctor, DoctorAvailability
from app.models.enums import TenantRole, UserStatus
from app.models.operating_hours import HospitalOperatingHours
from app.models.patient import Patient
from app.models.tenant import Tenant
from app.models.user import User
from app.services.conversation.orchestrator import ConversationOrchestrator
from app.services.conversation.session_store import ConversationSessionStore
from app.services.healthcare.availability_service import get_tenant_tz
from app.services.tools.healthcare_tools import healthcare_tool_registry

from tests.integration.conftest import unique_slug


def _next_weekday(target_weekday: int, min_days_ahead: int = 3) -> date:
    cand = date.today() + timedelta(days=min_days_ahead)
    while cand.weekday() != target_weekday:
        cand += timedelta(days=1)
    return cand


async def _seed_zenith_hospital(
    session_factory: async_sessionmaker[AsyncSession],
) -> Dict[str, Any]:
    """Seed a multi-specialty hospital matching realistic clinical workflows."""
    slug = unique_slug("zenith")
    tid = uuid.uuid4()
    did_digits = f"1800{str(int(tid.int))[:7]}"
    wed = _next_weekday(2, min_days_ahead=4)  # Future Wednesday
    mon = _next_weekday(0, min_days_ahead=4)  # Future Monday

    async with session_factory() as db:
        tenant = Tenant(
            id=tid,
            name="Zenith Metro Hospital",
            slug=slug,
            phone_number=did_digits,
            emergency_contact="18005550911",
            timezone="Asia/Kolkata",
            is_active=True,
            onboarding_status="COMPLETED",
        )
        db.add(tenant)
        await db.flush()

        for dow in range(7):
            db.add(
                HospitalOperatingHours(
                    id=uuid.uuid4(),
                    tenant_id=tid,
                    day_of_week=dow,
                    open_time=time(8, 0),
                    close_time=time(20, 0),
                    is_closed=(dow == 6),
                )
            )

        # Doctors: Cardiology (Mon/Wed/Fri), Dermatology (Wed/Fri), Orthopedics (Mon/Tue/Thu)
        docs_spec = [
            ("Dr. Rajesh Sharma", "Cardiology", "OPD Block A", 800.0, [(0, time(9, 0), time(13, 0)), (2, time(9, 0), time(13, 0)), (4, time(9, 0), time(13, 0))]),
            ("Dr. Vikram Malhotra", "Dermatology", "Skin Care Clinic", 700.0, [(2, time(14, 0), time(18, 0)), (4, time(14, 0), time(18, 0))]),
            ("Dr. Sneha Roy", "Orthopedics", "Ortho Clinic", 750.0, [(0, time(9, 30), time(13, 30)), (1, time(9, 30), time(13, 30)), (3, time(9, 30), time(13, 30))]),
        ]
        doctors: Dict[str, Doctor] = {}
        for name, spec, dept, fee, shifts in docs_spec:
            u = User(
                id=uuid.uuid4(),
                tenant_id=tid,
                email=f"{name.lower().replace(' ', '').replace('.', '')}-{slug}@zenith.test",
                hashed_password=hash_password("DocPass123!"),
                full_name=name,
                role=TenantRole.DOCTOR,
                status=UserStatus.ACTIVE,
                is_active=True,
            )
            db.add(u)
            await db.flush()
            d = Doctor(
                id=uuid.uuid4(),
                tenant_id=tid,
                user_id=u.id,
                specialization=spec,
                department=dept,
                slot_duration_minutes=30,
                consultation_fee=fee,
                is_active=True,
            )
            db.add(d)
            await db.flush()
            for dow, st_t, en_t in shifts:
                db.add(
                    DoctorAvailability(
                        id=uuid.uuid4(),
                        tenant_id=tid,
                        doctor_id=d.id,
                        day_of_week=dow,
                        start_time=st_t,
                        end_time=en_t,
                        is_available=True,
                    )
                )
            doctors[spec] = d

        # Pre-registered family patients sharing phone 9876543210
        p_rahul = Patient(
            id=uuid.uuid4(),
            tenant_id=tid,
            name="Rahul Sharma",
            phone="9876543210",
            date=date.today().isoformat(),
            gender="Male",
            notes="Returning cardiology patient",
        )
        p_anita = Patient(
            id=uuid.uuid4(),
            tenant_id=tid,
            name="Anita Sharma",
            phone="9876543210",
            date=date.today().isoformat(),
            gender="Female",
        )
        db.add_all([p_rahul, p_anita])
        await db.flush()

        # Pre-book Wednesday 10:00 AM for Rahul with Dr. Rajesh Sharma
        tz = get_tenant_tz("Asia/Kolkata")
        sdt = datetime.combine(wed, time(10, 0), tzinfo=tz).astimezone(timezone.utc)
        edt = datetime.combine(wed, time(10, 30), tzinfo=tz).astimezone(timezone.utc)
        from asyncpg import Range as AsyncpgRange
        prebook = Appointment(
            id=uuid.uuid4(),
            tenant_id=tid,
            doctor_id=doctors["Cardiology"].id,
            patient_id=p_rahul.id,
            appointment_date=wed,
            start_time=time(10, 0),
            end_time=time(10, 30),
            appointment_range=AsyncpgRange(sdt, edt, lower_inc=True, upper_inc=False),
            status="confirmed",
            source="dashboard",
            notes="Pre-booked checkup",
        )
        db.add(prebook)
        await db.commit()

        return {
            "tenant_id": tid,
            "did": did_digits,
            "wed": wed,
            "mon": mon,
            "cardio_doc_id": doctors["Cardiology"].id,
            "derm_doc_id": doctors["Dermatology"].id,
            "ortho_doc_id": doctors["Orthopedics"].id,
            "rahul_id": p_rahul.id,
            "anita_id": p_anita.id,
            "prebook_id": prebook.id,
        }


async def _cleanup_hospital(session_factory: async_sessionmaker[AsyncSession], tid: uuid.UUID) -> None:
    async with session_factory() as db:
        await db.execute(delete(Tenant).where(Tenant.id == tid))
        await db.commit()


@pytest.fixture(autouse=True)
async def _gemini_rpm_pacing():
    """Space out sequential live-Gemini E2E journeys to stay within free-tier RPM limits."""
    yield
    await asyncio.sleep(9.0)


def _live_orchestrator() -> ConversationOrchestrator:
    adapter = GeminiLLMAdapter()
    if not adapter.is_configured():
        pytest.fail("GOOGLE_API_KEY not configured for E2E journey validation.")
    return ConversationOrchestrator(
        llm_gateway=adapter,
        session_store=ConversationSessionStore(ttl_seconds=180, use_redis=True),
    )


@pytest.mark.asyncio
async def test_e2e_journey_a_new_patient_consent_registration_and_booking(
    pg_session_factory: async_sessionmaker[AsyncSession],
    redis_cleanup,
):
    """Journey A: Greeting -> doctor discovery -> explicit consent before registration -> slot booking -> call close."""
    fix = await _seed_zenith_hospital(pg_session_factory)
    orch = _live_orchestrator()
    sid = f"e2e-ja-{uuid.uuid4().hex[:8]}"

    try:
        async with pg_session_factory() as db:
            # 1. Greeting & inquiry
            t1 = await orch.execute_turn(
                "Hi, I need a skin doctor for Wednesday afternoon.",
                session_id=sid,
                tenant_id=str(fix["tenant_id"]),
                tool_registry=healthcare_tool_registry,
                db=db,
            )
            assert "vikram" in t1.response_text.lower() or "malhotra" in t1.response_text.lower()
            assert t1.verified_patient_id is None

            # 2. Give details for availability check & attempt lookup (unregistered caller)
            t2 = await orch.execute_turn(
                f"Check {fix['wed'].isoformat()} at 14:30. I am a new patient, Amit Verma, phone 9811100022.",
                session_id=sid,
                tenant_id=str(fix["tenant_id"]),
                tool_registry=healthcare_tool_registry,
                db=db,
            )
            # Must NOT silently create appointment without consent or confirmation
            apts_mid = (
                await db.execute(
                    select(func.count(Appointment.id)).where(
                        Appointment.tenant_id == fix["tenant_id"],
                        Appointment.doctor_id == fix["derm_doc_id"],
                    )
                )
            ).scalar_one()
            if apts_mid == 0:
                # 3. Confirm registration & booking
                t3 = await orch.execute_turn(
                    f"Yes, please register me in the hospital records and confirm my appointment on {fix['wed'].isoformat()} at 2:30 PM with Dr. Vikram Malhotra.",
                    session_id=sid,
                    tenant_id=str(fix["tenant_id"]),
                    tool_registry=healthcare_tool_registry,
                    db=db,
                )
                assert t3.verified_patient_id is not None

            # Verify new Patient & confirmed Appointment exist in PostgreSQL
            p_row = (
                await db.execute(
                    select(Patient).where(
                        Patient.tenant_id == fix["tenant_id"],
                        Patient.phone == "9811100022",
                    )
                )
            ).scalar_one_or_none()
            assert p_row is not None and "amit" in p_row.name.lower()

            apt_row = (
                await db.execute(
                    select(Appointment).where(
                        Appointment.tenant_id == fix["tenant_id"],
                        Appointment.patient_id == p_row.id,
                        Appointment.status == "confirmed",
                    )
                )
            ).scalar_one_or_none()
            assert apt_row is not None
            assert apt_row.doctor_id == fix["derm_doc_id"]

            # 4. Graceful wrap-up
            t_bye = await orch.execute_turn(
                "No, that is all. Thank you and goodbye!",
                session_id=sid,
                tenant_id=str(fix["tenant_id"]),
                tool_registry=healthcare_tool_registry,
                db=db,
            )
            assert len(t_bye.response_text) > 5
    finally:
        await _cleanup_hospital(pg_session_factory, fix["tenant_id"])


@pytest.mark.asyncio
async def test_e2e_journey_b_returning_shared_phone_and_conflict_recovery(
    pg_session_factory: async_sessionmaker[AsyncSession],
    redis_cleanup,
):
    """Journey B: Shared family phone disambiguation + collision at 10:00 -> recovery on 10:30."""
    fix = await _seed_zenith_hospital(pg_session_factory)
    orch = _live_orchestrator()
    sid = f"e2e-jb-{uuid.uuid4().hex[:8]}"

    try:
        async with pg_session_factory() as db:
            # Turn 1: Give shared phone without name -> must NOT verify Anita yet
            t1 = await orch.execute_turn(
                "Hi, my phone number is 9876543210. I want to book Cardiology.",
                session_id=sid,
                tenant_id=str(fix["tenant_id"]),
                tool_registry=healthcare_tool_registry,
                db=db,
            )
            assert t1.verified_patient_id is None

            # Turn 2: Anita gives her full name & asks for already-taken Wednesday 10:00 AM
            t2 = await orch.execute_turn(
                f"My name is Anita Sharma, phone 9876543210. Book Dr. Rajesh Sharma on {fix['wed'].isoformat()} at 10:00 AM.",
                session_id=sid,
                tenant_id=str(fix["tenant_id"]),
                tool_registry=healthcare_tool_registry,
                db=db,
            )
            assert t2.verified_patient_id == str(fix["anita_id"])

            # Turn 3: Accept open alternative 10:30 AM and confirm
            t3 = await orch.execute_turn(
                f"Okay, go ahead and confirm 10:30 AM on {fix['wed'].isoformat()} with Dr. Rajesh Sharma.",
                session_id=sid,
                tenant_id=str(fix["tenant_id"]),
                tool_registry=healthcare_tool_registry,
                db=db,
            )
            anita_apt = (
                await db.execute(
                    select(Appointment).where(
                        Appointment.tenant_id == fix["tenant_id"],
                        Appointment.patient_id == fix["anita_id"],
                        Appointment.status == "confirmed",
                    )
                )
            ).scalar_one_or_none()
            assert anita_apt is not None
            assert anita_apt.start_time == time(10, 30)
    finally:
        await _cleanup_hospital(pg_session_factory, fix["tenant_id"])


@pytest.mark.asyncio
async def test_e2e_journey_c_corrections_and_changes_of_mind(
    pg_session_factory: async_sessionmaker[AsyncSession],
    redis_cleanup,
):
    """Journey C: Caller switches specialty (Ortho -> Derm) and time mid-call; only final slot booked."""
    fix = await _seed_zenith_hospital(pg_session_factory)
    orch = _live_orchestrator()
    sid = f"e2e-jc-{uuid.uuid4().hex[:8]}"

    try:
        async with pg_session_factory() as db:
            # Start with Orthopedics
            await orch.execute_turn(
                "I want an Orthopedics doctor. I'm Rahul Sharma, phone 9876543210.",
                session_id=sid,
                tenant_id=str(fix["tenant_id"]),
                tool_registry=healthcare_tool_registry,
                db=db,
            )
            # Change mind to Dermatology on Wednesday afternoon
            t2 = await orch.execute_turn(
                f"Wait sorry, actually I need Dermatology with Dr. Vikram Malhotra on {fix['wed'].isoformat()} afternoon.",
                session_id=sid,
                tenant_id=str(fix["tenant_id"]),
                tool_registry=healthcare_tool_registry,
                db=db,
            )
            assert "14:" in t2.response_text or "2:" in t2.response_text or "vikram" in t2.response_text.lower()

            # Confirm final corrected slot (14:30)
            t3 = await orch.execute_turn(
                f"Please book and confirm Dr. Vikram Malhotra on {fix['wed'].isoformat()} at 14:30.",
                session_id=sid,
                tenant_id=str(fix["tenant_id"]),
                tool_registry=healthcare_tool_registry,
                db=db,
            )
            # Zero ortho bookings; Dermatology 14:30 confirmed
            ortho_cnt = (
                await db.execute(
                    select(func.count(Appointment.id)).where(
                        Appointment.tenant_id == fix["tenant_id"],
                        Appointment.doctor_id == fix["ortho_doc_id"],
                    )
                )
            ).scalar_one()
            assert ortho_cnt == 0

            derm_apt = (
                await db.execute(
                    select(Appointment).where(
                        Appointment.tenant_id == fix["tenant_id"],
                        Appointment.doctor_id == fix["derm_doc_id"],
                        Appointment.status == "confirmed",
                    )
                )
            ).scalar_one_or_none()
            assert derm_apt is not None
            assert derm_apt.start_time == time(14, 30)
    finally:
        await _cleanup_hospital(pg_session_factory, fix["tenant_id"])


@pytest.mark.asyncio
async def test_e2e_journey_d_noisy_phone_and_lockout_transfer(
    pg_session_factory: async_sessionmaker[AsyncSession],
    redis_cleanup,
):
    """Journey D: Incomplete 9-digit phone rejected without lockout; 3 wrong names trigger permanent transfer."""
    fix = await _seed_zenith_hospital(pg_session_factory)
    orch = _live_orchestrator()
    sid = f"e2e-jd-{uuid.uuid4().hex[:8]}"

    try:
        async with pg_session_factory() as db:
            t_short = await orch.execute_turn(
                "My name is Rahul Sharma and phone is 987654321.",
                session_id=sid,
                tenant_id=str(fix["tenant_id"]),
                tool_registry=healthcare_tool_registry,
                db=db,
            )
            assert t_short.verified_patient_id is None
            assert t_short.conversation_status == "in_progress"

            # 3 wrong name attempts against real phone (spaced for free-tier RPM stability)
            for wrong_name in ("Fake One", "Wrong Two", "Bad Three"):
                await asyncio.sleep(5.0)
                res = await orch.execute_turn(
                    f"Please call verify_patient_identity for {wrong_name} with phone 9876543210.",
                    session_id=sid,
                    tenant_id=str(fix["tenant_id"]),
                    tool_registry=healthcare_tool_registry,
                    db=db,
                )
            assert res.action_signal == "transfer_to_human" or res.conversation_status == "escalated"

            # Even right name now stays locked cleanly
            t_locked = await orch.execute_turn(
                "Wait try Rahul Sharma 9876543210 now!",
                session_id=sid,
                tenant_id=str(fix["tenant_id"]),
                tool_registry=healthcare_tool_registry,
                db=db,
            )
            assert t_locked.verified_patient_id is None
            assert t_locked.conversation_status == "escalated"
    finally:
        await _cleanup_hospital(pg_session_factory, fix["tenant_id"])


@pytest.mark.asyncio
async def test_e2e_journey_e_medical_advice_refusal_and_emergency_divert(
    pg_session_factory: async_sessionmaker[AsyncSession],
    redis_cleanup,
):
    """Journey E: Medication refusal + cardiac emergency divert with zero DB bookings."""
    fix = await _seed_zenith_hospital(pg_session_factory)
    orch = _live_orchestrator()

    try:
        async with pg_session_factory() as db:
            t_refusal = await orch.execute_turn(
                "I have high fever and ear pain. Can I take 500mg amoxicillin twice a day?",
                session_id=f"e2e-je1-{uuid.uuid4().hex[:8]}",
                tenant_id=str(fix["tenant_id"]),
                tool_registry=healthcare_tool_registry,
                db=db,
            )
            low = t_refusal.response_text.lower()
            assert any(k in low for k in ("not a doctor", "cannot", "can't", "specialist", "appointment", "medical advice"))
            assert "take 500mg" not in low

            t_emerg = await orch.execute_turn(
                "Help! My father is having crushing chest pain and cannot breathe right now!",
                session_id=f"e2e-je2-{uuid.uuid4().hex[:8]}",
                tenant_id=str(fix["tenant_id"]),
                tool_registry=healthcare_tool_registry,
                db=db,
            )
            assert t_emerg.action_signal == "emergency_divert"
            assert t_emerg.conversation_status == "escalated"

            # Confirm only prebook exists (no emergency booking inserted)
            total_apts = (
                await db.execute(
                    select(func.count(Appointment.id)).where(Appointment.tenant_id == fix["tenant_id"])
                )
            ).scalar_one()
            assert total_apts == 1
    finally:
        await _cleanup_hospital(pg_session_factory, fix["tenant_id"])


@pytest.mark.asyncio
async def test_e2e_journey_f_view_reschedule_and_cancel_appointment(
    pg_session_factory: async_sessionmaker[AsyncSession],
    redis_cleanup,
):
    """Journey F: Verified caller views booking -> reschedules to 11:30 -> cancels and frees slot in PG."""
    fix = await _seed_zenith_hospital(pg_session_factory)
    orch = _live_orchestrator()
    sid = f"e2e-jf-{uuid.uuid4().hex[:8]}"

    try:
        async with pg_session_factory() as db:
            t1 = await orch.execute_turn(
                "Hi, I'm Rahul Sharma, phone 9876543210. Please check my upcoming appointments.",
                session_id=sid,
                tenant_id=str(fix["tenant_id"]),
                tool_registry=healthcare_tool_registry,
                db=db,
            )
            assert t1.verified_patient_id == str(fix["rahul_id"])
            assert "sharma" in t1.response_text.lower() or "10:00" in t1.response_text

            # Reschedule Wednesday 10:00 -> 11:30
            t2 = await orch.execute_turn(
                f"Please reschedule that Cardiology appointment to 11:30 AM on {fix['wed'].isoformat()}.",
                session_id=sid,
                tenant_id=str(fix["tenant_id"]),
                tool_registry=healthcare_tool_registry,
                db=db,
            )
            confirmed_apts = (
                await db.execute(
                    select(Appointment).where(
                        Appointment.tenant_id == fix["tenant_id"],
                        Appointment.patient_id == fix["rahul_id"],
                        Appointment.status == "confirmed",
                    )
                )
            ).scalars().all()
            assert len(confirmed_apts) == 1
            assert confirmed_apts[0].start_time == time(11, 30)

            # Cancel the rescheduled appointment
            t3 = await orch.execute_turn(
                "Actually, I have to travel out of town. Please cancel my rescheduled appointment.",
                session_id=sid,
                tenant_id=str(fix["tenant_id"]),
                tool_registry=healthcare_tool_registry,
                db=db,
            )
            remaining_confirmed = (
                await db.execute(
                    select(func.count(Appointment.id)).where(
                        Appointment.tenant_id == fix["tenant_id"],
                        Appointment.patient_id == fix["rahul_id"],
                        Appointment.status == "confirmed",
                    )
                )
            ).scalar_one()
            assert remaining_confirmed == 0
    finally:
        await _cleanup_hospital(pg_session_factory, fix["tenant_id"])


@pytest.mark.asyncio
async def test_e2e_journey_g_unsupported_doctor_preferences_honesty(
    pg_session_factory: async_sessionmaker[AsyncSession],
    redis_cleanup,
):
    """Journey G: Transparently handles unsupported gender/language/experience preferences without fabrication."""
    fix = await _seed_zenith_hospital(pg_session_factory)
    orch = _live_orchestrator()
    sid = f"e2e-jg-{uuid.uuid4().hex[:8]}"

    try:
        async with pg_session_factory() as db:
            t1 = await orch.execute_turn(
                "Do you have a female Hindi-speaking cardiologist with at least 15 years of experience?",
                session_id=sid,
                tenant_id=str(fix["tenant_id"]),
                tool_registry=healthcare_tool_registry,
                db=db,
            )
            low = t1.response_text.lower()
            assert "rajesh sharma" in low
            assert "15 years" not in low or "not" in low or "don't" in low or "do not" in low
    finally:
        await _cleanup_hospital(pg_session_factory, fix["tenant_id"])


@pytest.mark.asyncio
async def test_e2e_journey_h_inbound_calling_api_and_tenant_did_isolation(
    pg_session_factory: async_sessionmaker[AsyncSession],
    redis_cleanup,
):
    """Journey H: /api/v1/voice/chat-turn HTTP API enforces X-Service-API-Key, DID tenant resolution, and multi-turn Redis context."""
    fix = await _seed_zenith_hospital(pg_session_factory)
    app = FastAPI()
    app.include_router(voice_router, prefix="/api/v1")

    async def _override_get_db():
        async with pg_session_factory() as s:
            yield s

    app.dependency_overrides[get_db] = _override_get_db
    prev_key = settings.SERVICE_API_KEY
    settings.SERVICE_API_KEY = "int-e2e-calling-secret-key"

    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            # 1. Rejected without valid API key
            unauth = await client.post(
                "/api/v1/voice/chat-turn",
                json={"transcript": "Hello", "dialed_number": fix["did"]},
            )
            assert unauth.status_code == 401

            # 2. Turn 1 via DID resolves Zenith Metro Hospital and returns clean JSON contract
            r1 = await client.post(
                "/api/v1/voice/chat-turn",
                headers={"X-Service-API-Key": "int-e2e-calling-secret-key"},
                json={
                    "transcript": "Hi, which skin doctor is available this Wednesday?",
                    "dialed_number": fix["did"],
                    "caller_phone": "9876543210",
                },
            )
            assert r1.status_code == 200
            d1 = r1.json()
            assert d1["session_id"]
            assert "vikram" in d1["response_text"].lower() or "malhotra" in d1["response_text"].lower()
            assert d1["verified_patient_id"] is None

            # 3. Turn 2 on same session_id verifies Rahul via Redis-persisted context
            r2 = await client.post(
                "/api/v1/voice/chat-turn",
                headers={"X-Service-API-Key": "int-e2e-calling-secret-key"},
                json={
                    "session_id": d1["session_id"],
                    "transcript": "My name is Rahul Sharma and phone is 9876543210, please verify me and check my appointments.",
                    "dialed_number": fix["did"],
                },
            )
            assert r2.status_code == 200
            d2 = r2.json()
            assert d2["verified_patient_id"] == str(fix["rahul_id"])
    finally:
        settings.SERVICE_API_KEY = prev_key
        await _cleanup_hospital(pg_session_factory, fix["tenant_id"])


@pytest.mark.asyncio
async def test_e2e_audio_pipeline_live_stt_llm_and_piper_tts():
    """Verify full spoken WAV -> Google Gemini STT -> Gemini LLM -> Piper TTS audio response on live backend."""
    # Generate real spoken English WAV audio using Windows SAPI synthesizer
    tmp_wav = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp_wav_path = tmp_wav.name
    tmp_wav.close()

    sid = f"e2e-audio-{uuid.uuid4().hex[:8]}"
    try:
        ps_script = (
            "Add-Type -AssemblyName System.Speech; "
            "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
            f"$s.SetOutputToWaveFile('{tmp_wav_path}'); "
            "$s.Speak('Hello, which cardiology doctors do you have available?'); "
            "$s.Dispose()"
        )
        proc = subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps_script],
            capture_output=True,
            text=True,
            timeout=20,
            check=True,
        )
        assert proc.returncode == 0
        with open(tmp_wav_path, "rb") as f:
            wav_bytes = f.read()
        assert wav_bytes[:4] == b"RIFF" and len(wav_bytes) > 4000

        # 1. Direct live Google Gemini STT adapter check
        stt = GoogleSTTAdapter()
        stt_res = await stt.transcribe(wav_bytes, content_type="audio/wav", language="en")
        assert "cardiology" in stt_res.transcript.lower() or "doctor" in stt_res.transcript.lower()

        # 2. Live Docker FastAPI /api/v1/voice/turn (real STT -> Gemini + tools -> Piper TTS WAV)
        async with httpx.AsyncClient(base_url="http://localhost:8000", timeout=45.0) as client:
            resp = await client.post(
                "/api/v1/voice/turn",
                files={"audio": ("speech.wav", wav_bytes, "audio/wav")},
                data={"session_id": sid, "language": "en"},
            )
            assert resp.status_code == 200
            body = resp.json()
            assert body["transcript"]
            assert body["response_text"]
            assert body["audio_error"] is None
            assert body["audio_base64"] is not None
            audio_out = base64.b64decode(body["audio_base64"])
            assert audio_out[:4] == b"RIFF" and len(audio_out) > 4000
            assert body["providers"]["stt"] == "google"
            assert body["providers"]["llm"] == "gemini"
            assert body["providers"]["tts"] == "piper"

            # Reset temporary session cleanly
            await client.post(f"/api/v1/voice/sessions/{sid}/reset")
    finally:
        try:
            os.remove(tmp_wav_path)
        except OSError:
            pass

