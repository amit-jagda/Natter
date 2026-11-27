"""Layer 2 Real PostgreSQL Integration & Concurrency Tests.

Validates against real PostgreSQL 16 (voice_ai_test):
1. Schema migrations, btree_gist extension, and no_overlapping_doctor_appointments exclusion constraint.
2. Multi-tenant isolation across patient lookup, doctor discovery, verification, and booking.
3. Patient registration, shared family phone lookup, demographic verification, and rate-limit lockout.
4. Real availability calculation (operating hours, shifts, partial/full leaves, confirmed vs cancelled slots).
5. Appointment CRUD lifecycle, idempotency keys, cancellation slot release, and atomic rescheduling.
6. True async concurrency with independent AsyncSessions hitting GiST & FOR UPDATE locks.
7. Known infra edge-case checks (cross-tenant patient validation, past-date rejection, formatted DB phones).
"""

import asyncio
from datetime import date, datetime, time, timedelta, timezone
from typing import Dict, List
import uuid

import pytest
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.security import hash_password
from app.models.appointment import Appointment
from app.models.doctor import Doctor, DoctorAvailability
from app.models.doctor_leave import DoctorLeave
from app.models.enums import TenantRole, UserStatus
from app.models.operating_hours import HospitalOperatingHours
from app.models.patient import Patient
from app.models.tenant import Tenant
from app.models.user import User
from app.services.conversation.state import ConversationState
from app.services.healthcare.appointment_service import AppointmentService
from app.services.healthcare.availability_service import AvailabilityService
from app.services.healthcare.patient_service import PatientVerificationService
from app.services.tools.healthcare_tools import healthcare_tool_registry

from tests.integration.conftest import unique_slug


def _next_monday(after_days: int = 7) -> date:
    """Return a future Monday date for deterministic weekday schedule fixtures."""
    candidate = date.today() + timedelta(days=after_days)
    while candidate.weekday() != 0:
        candidate += timedelta(days=1)
    return candidate


async def _seed_hospital_fixture(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    slug: str,
    doctor_name: str = "Dr. Aarav Sharma",
    specialty: str = "Cardiology",
    slot_duration: int = 30,
    patient_name: str = "Priya Verma",
    patient_phone: str = "9876543210",
) -> Dict[str, uuid.UUID]:
    """Create a complete committed Tenant + OperatingHours + Doctor + Patient fixture."""
    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()
    doctor_id = uuid.uuid4()
    patient_id = uuid.uuid4()

    async with session_factory() as db:
        tenant = Tenant(
            id=tenant_id,
            name=f"Hospital {slug}",
            slug=slug,
            is_active=True,
            timezone="Asia/Kolkata",
            onboarding_status="COMPLETED",
        )
        db.add(tenant)
        await db.flush()

        # Monday (0) - Saturday (5) 09:00-17:00, Sunday (6) closed
        for dow in range(7):
            db.add(
                HospitalOperatingHours(
                    id=uuid.uuid4(),
                    tenant_id=tenant_id,
                    day_of_week=dow,
                    open_time=time(9, 0) if dow < 6 else None,
                    close_time=time(17, 0) if dow < 6 else None,
                    is_closed=(dow == 6),
                )
            )

        user = User(
            id=user_id,
            tenant_id=tenant_id,
            email=f"doc-{slug}@hospital.test",
            hashed_password=hash_password("TestPass123!"),
            full_name=doctor_name,
            role=TenantRole.DOCTOR,
            status=UserStatus.ACTIVE,
            is_active=True,
        )
        db.add(user)
        await db.flush()

        doctor = Doctor(
            id=doctor_id,
            tenant_id=tenant_id,
            user_id=user_id,
            specialization=specialty,
            department="OPD Block A",
            slot_duration_minutes=slot_duration,
            consultation_fee=800.00,
            is_active=True,
        )
        db.add(doctor)
        await db.flush()

        # Available Monday (0) and Tuesday (1) 10:00-12:00
        for dow in (0, 1):
            db.add(
                DoctorAvailability(
                    id=uuid.uuid4(),
                    tenant_id=tenant_id,
                    doctor_id=doctor_id,
                    day_of_week=dow,
                    start_time=time(10, 0),
                    end_time=time(12, 0),
                    is_available=True,
                )
            )

        patient = Patient(
            id=patient_id,
            tenant_id=tenant_id,
            name=patient_name,
            phone=patient_phone,
            date=date.today().isoformat(),
            notes="Seeded integration fixture patient",
        )
        db.add(patient)
        await db.commit()

    return {
        "tenant_id": tenant_id,
        "user_id": user_id,
        "doctor_id": doctor_id,
        "patient_id": patient_id,
    }


async def _cleanup_tenants(
    session_factory: async_sessionmaker[AsyncSession],
    tenant_ids: List[uuid.UUID],
) -> None:
    """Clean up test tenants (all child rows cascade via FK ON DELETE CASCADE)."""
    if not tenant_ids:
        return
    async with session_factory() as db:
        await db.execute(delete(Tenant).where(Tenant.id.in_(tenant_ids)))
        await db.commit()


@pytest.mark.asyncio
async def test_pg_schema_migrations_extensions_and_constraints(
    pg_session_factory: async_sessionmaker[AsyncSession],
):
    """Verify Alembic head, btree_gist extension, and GiST exclusion constraint exist in real PG."""
    async with pg_session_factory() as db:
        rev_res = await db.execute(text("SELECT version_num FROM alembic_version"))
        assert rev_res.scalar_one() == "0006_create_connectors_table"

        ext_res = await db.execute(
            text("SELECT extname FROM pg_extension WHERE extname = 'btree_gist'")
        )
        assert ext_res.scalar_one_or_none() == "btree_gist"

        con_res = await db.execute(
            text(
                "SELECT conname, CAST(contype AS text) FROM pg_constraint "
                "WHERE conname = 'no_overlapping_doctor_appointments'"
            )
        )
        row = con_res.first()
        assert row is not None
        assert row[0] == "no_overlapping_doctor_appointments"
        assert row[1] == "x"


@pytest.mark.asyncio
async def test_pg_multi_tenant_isolation_and_discovery(
    pg_session_factory: async_sessionmaker[AsyncSession],
):
    """Verify real SQL queries isolate candidates, doctors, and verifications strictly per tenant."""
    fix_a = await _seed_hospital_fixture(
        pg_session_factory,
        slug=unique_slug("tenant-a"),
        doctor_name="Dr. Alpha Cardiology",
        specialty="Cardiology",
        patient_name="Alice TenantA",
        patient_phone="9876543210",
    )
    fix_b = await _seed_hospital_fixture(
        pg_session_factory,
        slug=unique_slug("tenant-b"),
        doctor_name="Dr. Beta Dermatology",
        specialty="Dermatology",
        patient_name="Bob TenantB",
        patient_phone="9876543210",  # Same phone in different tenant
    )

    try:
        async with pg_session_factory() as db:
            # 1. Phone lookup only sees own tenant's patient
            cands_a = await PatientVerificationService.lookup_candidates_by_phone(
                db, fix_a["tenant_id"], "9876543210"
            )
            cands_b = await PatientVerificationService.lookup_candidates_by_phone(
                db, fix_b["tenant_id"], "9876543210"
            )
            assert len(cands_a) == 1 and cands_a[0]["name"] == "Alice TenantA"
            assert len(cands_b) == 1 and cands_b[0]["name"] == "Bob TenantB"

            # 2. Cross-tenant verification blocked
            state = ConversationState(session_id="iso-1", tenant_id=str(fix_a["tenant_id"]))
            cross_ver = await PatientVerificationService.verify_patient_demographics(
                db,
                fix_a["tenant_id"],
                fix_b["patient_id"],  # belongs to Tenant B
                "Bob TenantB",
                state,
            )
            assert cross_ver.success is False
            assert state.verified_patient_id is None

            # 3. Doctor search tool only returns own tenant's doctors
            docs_a = await healthcare_tool_registry.execute_tool(
                "search_doctors",
                {},
                tenant_id=fix_a["tenant_id"],
                db=db,
                session_state=state,
            )
            assert docs_a["success"] is True
            assert docs_a["count"] == 1
            assert docs_a["doctors"][0]["doctor_name"] == "Dr. Alpha Cardiology"
    finally:
        await _cleanup_tenants(pg_session_factory, [fix_a["tenant_id"], fix_b["tenant_id"]])


@pytest.mark.asyncio
async def test_pg_patient_registration_shared_phone_and_lockout(
    pg_session_factory: async_sessionmaker[AsyncSession],
):
    """Verify registration, shared family phone lookup, honorific name verification, and 3-attempt lockout."""
    fix = await _seed_hospital_fixture(
        pg_session_factory,
        slug=unique_slug("patient-flow"),
        patient_name="Rajesh Kumar",
        patient_phone="9811122233",
    )

    try:
        async with pg_session_factory() as db:
            # Register family member sharing exact same mobile number
            reg_state = ConversationState(session_id="reg-1", tenant_id=str(fix["tenant_id"]))
            wife = await PatientVerificationService.register_new_patient(
                db,
                fix["tenant_id"],
                "Sunita Kumar",
                "9811122233",
                gender="Female",
                session_state=reg_state,
            )
            assert reg_state.is_verified_for_patient(str(wife.id))

            # Shared phone lookup returns both patients cleanly
            cands = await PatientVerificationService.lookup_candidates_by_phone(
                db, fix["tenant_id"], "9811122233"
            )
            assert {c["name"] for c in cands} == {"Rajesh Kumar", "Sunita Kumar"}

            # Returning caller verifies Rajesh with honorific
            ver_state = ConversationState(session_id="ver-1", tenant_id=str(fix["tenant_id"]))
            res_ok = await PatientVerificationService.verify_patient_demographics(
                db, fix["tenant_id"], fix["patient_id"], "Mr. Rajesh Kumar", ver_state
            )
            assert res_ok.success is True
            assert ver_state.is_verified_for_patient(str(fix["patient_id"]))

            # Brute-force name mismatch -> lockout on 3rd failure
            bad_state = ConversationState(session_id="bad-1", tenant_id=str(fix["tenant_id"]))
            for attempt_idx in range(1, 4):
                res_bad = await PatientVerificationService.verify_patient_demographics(
                    db, fix["tenant_id"], fix["patient_id"], f"Wrong Person {attempt_idx}", bad_state
                )
                assert res_bad.success is False

            assert bad_state.is_verification_locked() is True
            assert res_bad.is_locked is True

            # Even exact right name must be blocked while locked
            res_locked = await PatientVerificationService.verify_patient_demographics(
                db, fix["tenant_id"], fix["patient_id"], "Rajesh Kumar", bad_state
            )
            assert res_locked.success is False
            assert res_locked.is_locked is True
    finally:
        await _cleanup_tenants(pg_session_factory, [fix["tenant_id"]])


@pytest.mark.asyncio
async def test_pg_availability_and_appointment_lifecycle(
    pg_session_factory: async_sessionmaker[AsyncSession],
):
    """Verify availability shifts/leaves/cancellations, booking, idempotency, cancel, and reschedule."""
    fix = await _seed_hospital_fixture(
        pg_session_factory,
        slug=unique_slug("lifecycle"),
    )
    target_monday = _next_monday()
    target_tuesday = target_monday + timedelta(days=1)
    sunday = target_monday - timedelta(days=1)

    try:
        async with pg_session_factory() as db:
            # Closed day (Sunday) -> 0 slots
            assert await AvailabilityService.get_doctor_available_slots(
                db, fix["tenant_id"], fix["doctor_id"], sunday
            ) == []

            # Monday open shift 10:00-12:00 with 30m slots -> 10:00, 10:30, 11:00, 11:30
            slots = await AvailabilityService.get_doctor_available_slots(
                db, fix["tenant_id"], fix["doctor_id"], target_monday
            )
            assert [s.start_time for s in slots] == ["10:00", "10:30", "11:00", "11:30"]

            # Add partial leave 10:30-11:00 on Monday -> 10:30 excluded
            db.add(
                DoctorLeave(
                    id=uuid.uuid4(),
                    tenant_id=fix["tenant_id"],
                    doctor_id=fix["doctor_id"],
                    leave_date=target_monday,
                    is_full_day=False,
                    start_time=time(10, 30),
                    end_time=time(11, 0),
                    reason="Round duty",
                )
            )
            await db.commit()

            slots_after_leave = await AvailabilityService.get_doctor_available_slots(
                db, fix["tenant_id"], fix["doctor_id"], target_monday
            )
            assert [s.start_time for s in slots_after_leave] == ["10:00", "11:00", "11:30"]

            # Unverified booking blocked
            unverified_state = ConversationState(session_id="unv", tenant_id=str(fix["tenant_id"]))
            blocked = await AppointmentService.book_appointment(
                db,
                fix["tenant_id"],
                fix["patient_id"],
                fix["doctor_id"],
                target_monday,
                "10:00",
                session_state=unverified_state,
            )
            assert blocked.success is False
            assert blocked.error_code == "UNVERIFIED"

            # Verified booking succeeds + idempotency prevents duplicate
            verified_state = ConversationState(session_id="ver", tenant_id=str(fix["tenant_id"]))
            verified_state.set_verified(str(fix["patient_id"]))

            idem_key = f"idem-{uuid.uuid4().hex[:8]}"
            b1 = await AppointmentService.book_appointment(
                db,
                fix["tenant_id"],
                fix["patient_id"],
                fix["doctor_id"],
                target_monday,
                "10:00",
                idempotency_key=idem_key,
                session_state=verified_state,
            )
            assert b1.success is True

            b1_retry = await AppointmentService.book_appointment(
                db,
                fix["tenant_id"],
                fix["patient_id"],
                fix["doctor_id"],
                target_monday,
                "10:00",
                idempotency_key=idem_key,
                session_state=verified_state,
            )
            assert b1_retry.success is True
            assert b1_retry.appointment_id == b1.appointment_id

            # Only 1 appointment row in PG
            cnt = await db.execute(
                select(func.count(Appointment.id)).where(Appointment.tenant_id == fix["tenant_id"])
            )
            assert cnt.scalar_one() == 1

            # Reschedule to blocked partial leave time (10:30) fails & preserves 10:00 confirmed
            bad_resched = await AppointmentService.reschedule_appointment(
                db,
                fix["tenant_id"],
                uuid.UUID(b1.appointment_id),
                target_monday,
                "10:30",
                session_state=verified_state,
            )
            assert bad_resched.success is False
            assert bad_resched.error_code == "SLOT_CONFLICT"

            # Reschedule to Tuesday 11:00 succeeds, freeing Monday 10:00
            ok_resched = await AppointmentService.reschedule_appointment(
                db,
                fix["tenant_id"],
                uuid.UUID(b1.appointment_id),
                target_tuesday,
                "11:00",
                session_state=verified_state,
            )
            assert ok_resched.success is True

            slots_mon_again = await AvailabilityService.get_doctor_available_slots(
                db, fix["tenant_id"], fix["doctor_id"], target_monday
            )
            assert "10:00" in [s.start_time for s in slots_mon_again]

            # Cancel rescheduled appointment -> frees Tuesday 11:00 again
            cancel_res = await AppointmentService.cancel_appointment(
                db,
                fix["tenant_id"],
                uuid.UUID(ok_resched.appointment_id),
                reason="Patient changed plans",
                session_state=verified_state,
            )
            assert cancel_res["success"] is True

            slots_tue_released = await AvailabilityService.get_doctor_available_slots(
                db, fix["tenant_id"], fix["doctor_id"], target_tuesday
            )
            assert "11:00" in [s.start_time for s in slots_tue_released]

            # Different patient can book that released Tuesday 11:00 slot
            p2 = await PatientVerificationService.register_new_patient(
                db, fix["tenant_id"], "Neha Sharma", "9899988877"
            )
            s2 = ConversationState(session_id="p2", tenant_id=str(fix["tenant_id"]))
            s2.set_verified(str(p2.id))
            rebook = await AppointmentService.book_appointment(
                db,
                fix["tenant_id"],
                p2.id,
                fix["doctor_id"],
                target_tuesday,
                "11:00",
                session_state=s2,
            )
            assert rebook.success is True
    finally:
        await _cleanup_tenants(pg_session_factory, [fix["tenant_id"]])


@pytest.mark.asyncio
async def test_pg_concurrent_bookings_and_gist_exclusion(
    pg_session_factory: async_sessionmaker[AsyncSession],
):
    """Test true concurrent bookings across independent sessions + raw GiST interval overlap."""
    fix = await _seed_hospital_fixture(
        pg_session_factory,
        slug=unique_slug("concurrency"),
    )
    target_monday = _next_monday(after_days=14)

    try:
        # Create 5 distinct patients so verification & patient_id are distinct per caller
        patient_ids: List[uuid.UUID] = []
        async with pg_session_factory() as db:
            for idx in range(5):
                p = Patient(
                    id=uuid.uuid4(),
                    tenant_id=fix["tenant_id"],
                    name=f"Concurrent Patient {idx}",
                    phone=f"980000000{idx}",
                    date=date.today().isoformat(),
                )
                db.add(p)
                patient_ids.append(p.id)
            await db.commit()

        async def _attempt_book(pid: uuid.UUID, slot_str: str):
            state = ConversationState(session_id=f"conc-{pid}", tenant_id=str(fix["tenant_id"]))
            state.set_verified(str(pid))
            async with pg_session_factory() as session:
                return await AppointmentService.book_appointment(
                    session,
                    fix["tenant_id"],
                    pid,
                    fix["doctor_id"],
                    target_monday,
                    slot_str,
                    session_state=state,
                )

        # 1. Race 5 independent sessions on the EXACT SAME slot (10:00)
        results = await asyncio.gather(*[_attempt_book(pid, "10:00") for pid in patient_ids])
        winners = [r for r in results if r.success]
        losers = [r for r in results if not r.success]

        assert len(winners) == 1
        assert len(losers) == 4
        assert all(r.error_code == "SLOT_CONFLICT" for r in losers)

        async with pg_session_factory() as db:
            confirmed_count = await db.execute(
                select(func.count(Appointment.id)).where(
                    Appointment.doctor_id == fix["doctor_id"],
                    Appointment.appointment_date == target_monday,
                    Appointment.start_time == time(10, 0),
                    Appointment.status == "confirmed",
                )
            )
            assert confirmed_count.scalar_one() == 1

        # 2. Adjacent half-open intervals [10:30, 11:00) and [11:00, 11:30) booked concurrently both succeed
        adj_res = await asyncio.gather(
            _attempt_book(patient_ids[1], "10:30"),
            _attempt_book(patient_ids[2], "11:00"),
        )
        assert all(r.success for r in adj_res)

        # 3. Direct SQL partial-interval overlap (10:15-10:45 IST -> 04:45-05:15 UTC)
        # Overlaps 10:00-10:30 IST (04:30-05:00 UTC) and 10:30-11:00 IST (05:00-05:30 UTC).
        async with pg_session_factory() as db:
            tz_ist = timezone(timedelta(hours=5, minutes=30))
            start_dt = datetime.combine(target_monday, time(10, 15), tzinfo=tz_ist).astimezone(timezone.utc)
            end_dt = datetime.combine(target_monday, time(10, 45), tzinfo=tz_ist).astimezone(timezone.utc)

            with pytest.raises(IntegrityError):
                await db.execute(
                    text(
                        "INSERT INTO appointments "
                        "(id, tenant_id, doctor_id, patient_id, appointment_date, start_time, end_time, appointment_range, status, source) "
                        "VALUES (:id, :tid, :did, :pid, :adate, :st, :et, tstzrange(:sdt, :edt, '[)'), 'confirmed', 'raw_test')"
                    ),
                    {
                        "id": uuid.uuid4(),
                        "tid": fix["tenant_id"],
                        "did": fix["doctor_id"],
                        "pid": patient_ids[3],
                        "adate": target_monday,
                        "st": time(10, 15),
                        "et": time(10, 45),
                        "sdt": start_dt,
                        "edt": end_dt,
                    },
                )
                await db.commit()
            await db.rollback()
    finally:
        await _cleanup_tenants(pg_session_factory, [fix["tenant_id"]])


@pytest.mark.asyncio
async def test_pg_concurrent_bookings_across_two_doctors_and_two_tenants(
    pg_session_factory: async_sessionmaker[AsyncSession],
):
    """Bookings for different doctors or different tenants at the exact same clock time must all succeed."""
    fix_a = await _seed_hospital_fixture(pg_session_factory, slug=unique_slug("multi-a"))
    fix_b = await _seed_hospital_fixture(pg_session_factory, slug=unique_slug("multi-b"))
    target_monday = _next_monday(after_days=21)

    try:
        # Add a second doctor inside Tenant A
        async with pg_session_factory() as db:
            u2 = User(
                id=uuid.uuid4(),
                tenant_id=fix_a["tenant_id"],
                email=f"doc2-{uuid.uuid4().hex[:6]}@hospital.test",
                hashed_password=hash_password("TestPass123!"),
                full_name="Dr. Second Doctor",
                role=TenantRole.DOCTOR,
                status=UserStatus.ACTIVE,
                is_active=True,
            )
            db.add(u2)
            await db.flush()
            d2 = Doctor(
                id=uuid.uuid4(),
                tenant_id=fix_a["tenant_id"],
                user_id=u2.id,
                specialization="Dermatology",
                slot_duration_minutes=30,
                is_active=True,
            )
            db.add(d2)
            await db.flush()
            db.add(
                DoctorAvailability(
                    id=uuid.uuid4(),
                    tenant_id=fix_a["tenant_id"],
                    doctor_id=d2.id,
                    day_of_week=0,
                    start_time=time(10, 0),
                    end_time=time(12, 0),
                    is_available=True,
                )
            )
            p2 = Patient(
                id=uuid.uuid4(),
                tenant_id=fix_a["tenant_id"],
                name="Another Patient",
                phone="9876500001",
                date=date.today().isoformat(),
            )
            db.add(p2)
            await db.commit()

        async def _book(tid: uuid.UUID, pid: uuid.UUID, did: uuid.UUID):
            st = ConversationState(session_id=f"mt-{did}", tenant_id=str(tid))
            st.set_verified(str(pid))
            async with pg_session_factory() as s:
                return await AppointmentService.book_appointment(
                    s, tid, pid, did, target_monday, "10:00", session_state=st
                )

        res = await asyncio.gather(
            _book(fix_a["tenant_id"], fix_a["patient_id"], fix_a["doctor_id"]),
            _book(fix_a["tenant_id"], p2.id, d2.id),
            _book(fix_b["tenant_id"], fix_b["patient_id"], fix_b["doctor_id"]),
        )
        assert all(r.success for r in res)
    finally:
        await _cleanup_tenants(pg_session_factory, [fix_a["tenant_id"], fix_b["tenant_id"]])


@pytest.mark.asyncio
async def test_pg_fixed_security_timezone_past_date_phone_and_atomic_reschedule(
    pg_session_factory: async_sessionmaker[AsyncSession],
):
    """Verify Checkpoint 4 infrastructure fixes against real PostgreSQL."""
    fix_a = await _seed_hospital_fixture(pg_session_factory, slug=unique_slug("fixed-a"))
    fix_b = await _seed_hospital_fixture(
        pg_session_factory,
        slug=unique_slug("fixed-b"),
        patient_name="Formatted Phone Patient",
        patient_phone="+91-99887-76655",
    )
    future_monday = _next_monday(after_days=7)
    future_tuesday = future_monday + timedelta(days=1)

    try:
        async with pg_session_factory() as db:
            # 1. Formatted DB phone (+91-99887-76655) matches 10-digit input
            cands_fmt = await PatientVerificationService.lookup_candidates_by_phone(
                db, fix_b["tenant_id"], "9988776655"
            )
            assert len(cands_fmt) == 1
            assert cands_fmt[0]["name"] == "Formatted Phone Patient"

            # 2. Past date rejected in AvailabilityService & AppointmentService
            past_monday = date.today() - timedelta(days=7 + date.today().weekday())
            past_slots = await AvailabilityService.get_doctor_available_slots(
                db, fix_a["tenant_id"], fix_a["doctor_id"], past_monday
            )
            assert past_slots == []

            past_booking = await AppointmentService.book_appointment(
                db,
                fix_a["tenant_id"],
                fix_a["patient_id"],
                fix_a["doctor_id"],
                past_monday,
                "10:00",
                session_state=None,
            )
            assert past_booking.success is False
            assert past_booking.error_code == "INVALID_PAST_SLOT"

            # 3. Cross-tenant patient_id rejected strictly even without session_state
            cross_booking = await AppointmentService.book_appointment(
                db,
                fix_a["tenant_id"],
                fix_b["patient_id"],  # Tenant B patient!
                fix_a["doctor_id"],   # Tenant A doctor!
                future_monday,
                "10:00",
                session_state=None,
            )
            assert cross_booking.success is False
            assert cross_booking.error_code == "PATIENT_NOT_FOUND"

            # 4. Correct Tenant.timezone -> UTC conversion stored in TSTZRANGE (Asia/Kolkata 10:00 == 04:30 UTC)
            st = ConversationState(session_id="tz-fix", tenant_id=str(fix_a["tenant_id"]))
            st.set_verified(str(fix_a["patient_id"]))
            ok_booking = await AppointmentService.book_appointment(
                db,
                fix_a["tenant_id"],
                fix_a["patient_id"],
                fix_a["doctor_id"],
                future_monday,
                "10:00",
                session_state=st,
            )
            assert ok_booking.success is True

            stored_lower = (
                await db.execute(
                    text("SELECT lower(appointment_range) FROM appointments WHERE id = :id"),
                    {"id": uuid.UUID(ok_booking.appointment_id)},
                )
            ).scalar_one()
            assert stored_lower.hour == 4 and stored_lower.minute == 30

            # 5. Atomic single-commit reschedule preserves old booking on commit failure
            from unittest.mock import AsyncMock

            orig_commit = db.commit
            db.commit = AsyncMock(side_effect=RuntimeError("Simulated connection drop"))
            resched_fail = await AppointmentService.reschedule_appointment(
                db,
                fix_a["tenant_id"],
                uuid.UUID(ok_booking.appointment_id),
                future_tuesday,
                "11:00",
                session_state=st,
            )
            db.commit = orig_commit
            assert resched_fail.success is False

            # Verify original Monday 10:00 appointment is STILL confirmed and ONLY 1 row exists in PG
            apts_res = await db.execute(
                select(Appointment).where(Appointment.tenant_id == fix_a["tenant_id"])
            )
            apts = apts_res.scalars().all()
            assert len(apts) == 1
            assert apts[0].id == uuid.UUID(ok_booking.appointment_id)
            assert apts[0].status == "confirmed"
    finally:
        await _cleanup_tenants(pg_session_factory, [fix_a["tenant_id"], fix_b["tenant_id"]])
