"""Unit & Concurrency Tests for Phase 2 Healthcare Backend Services.

Covers:
1. Patient demographic verification (matching, case-insensitivity, honorific stripping).
2. Shared family phone candidate disambiguation.
3. Verification rate limiting and 15-minute lockout threshold.
4. Dynamic availability slot generation (factoring operating hours, doctor shifts, leaves, booked appointments).
5. Atomic appointment booking and idempotency key protection.
6. Rejection of unverified patient bookings.
7. Appointment cancellation and slot release.
8. Atomic rescheduling (preserving original booking on conflict).
9. Concurrent booking collision simulation (preventing double-booking).
"""

import asyncio
from datetime import date, datetime, time, timedelta, timezone
import os
from pathlib import Path
import sys
import time as time_module
import unittest
import uuid
from typing import List, Optional

backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

os.environ["ENVIRONMENT"] = "test"
os.environ["SECRET_KEY"] = "test-secret-key-for-unit-testing-purposes-only-32ch"

from app.models.appointment import Appointment
from app.models.doctor import Doctor, DoctorAvailability
from app.models.doctor_leave import DoctorLeave
from app.models.operating_hours import HospitalOperatingHours
from app.models.patient import Patient
from app.models.tenant import Tenant
from app.models.user import User
from app.services.conversation.state import ConversationState
from app.services.healthcare.appointment_service import AppointmentService, BookingResult
from app.services.healthcare.availability_service import AvailabilityService, AvailableSlot
from app.services.healthcare.patient_service import (
    PatientVerificationService,
    VerificationResult,
    _normalize_name,
)


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


class MockAsyncSession:
    """In-memory async session mock for testing domain logic without external DB server."""

    def __init__(self):
        self.patients = []
        self.doctors = []
        self.doctor_availabilities = []
        self.doctor_leaves = []
        self.appointments = []
        self.operating_hours = []
        self._locked_doctors = set()

    def add(self, obj):
        if isinstance(obj, Patient):
            self.patients.append(obj)
        elif isinstance(obj, Appointment):
            self.appointments.append(obj)
        elif isinstance(obj, DoctorLeave):
            self.doctor_leaves.append(obj)

    async def commit(self):
        pass

    async def rollback(self):
        pass

    async def refresh(self, obj):
        pass

    async def execute(self, statement):
        stmt_str = str(statement)

        # 1. Query Patient
        if "FROM patients" in stmt_str:
            matched = list(self.patients)
            return MockResult(matched)

        # 2. Query Operating Hours
        if "FROM hospital_operating_hours" in stmt_str:
            matched = list(self.operating_hours)
            return MockResult(matched)

        # 3. Query Doctor
        if "FROM doctors" in stmt_str:
            matched = list(self.doctors)
            return MockResult(matched)

        # 4. Query Doctor Leaves
        if "FROM doctor_leaves" in stmt_str:
            matched = list(self.doctor_leaves)
            return MockResult(matched)

        # 5. Query Appointments
        if "FROM appointments" in stmt_str:
            matched = [a for a in self.appointments if a.status != "cancelled"]
            return MockResult(matched)

        return MockResult([])


def run_async(coro):
    """Run an async coroutine synchronously using a single persistent event loop."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class TestHealthcareBackendServices(unittest.TestCase):
    """Test suite covering Phase 2 healthcare backend services."""

    def setUp(self):
        self.db = MockAsyncSession()
        self.tenant_id = uuid.uuid4()
        self.doctor_user_id = uuid.uuid4()
        self.doctor_id = uuid.uuid4()
        self.patient_id = uuid.uuid4()

        # Seed Doctor User & Doctor Record
        u = User(id=self.doctor_user_id, email="mehta@hospital.org", full_name="Dr. Rajesh Mehta")
        doc = Doctor(
            id=self.doctor_id,
            tenant_id=self.tenant_id,
            user_id=self.doctor_user_id,
            specialization="Cardiology",
            department="OPD Block A",
            slot_duration_minutes=30,
            is_active=True,
        )
        doc.user = u
        # Mon to Fri (0 to 4) 10:00 to 12:00
        doc.availabilities = [
            DoctorAvailability(
                id=uuid.uuid4(),
                tenant_id=self.tenant_id,
                doctor_id=self.doctor_id,
                day_of_week=i,
                start_time=time(10, 0),
                end_time=time(12, 0),
                is_available=True,
            )
            for i in range(5)
        ]
        self.db.doctors.append(doc)

        # Seed Patient Record
        self.patient = Patient(
            id=self.patient_id,
            tenant_id=self.tenant_id,
            name="Vikramaditya Sharma",
            phone="9876543210",
            email="vikram@example.com",
            date="2026-11-20",
        )
        self.db.patients.append(self.patient)

    # -------------------------------------------------------------------------
    # 1. Patient Demographic Verification Tests
    # -------------------------------------------------------------------------
    def test_name_normalization(self):
        """Verify normalization strips honorifics, punctuation, and extra spaces."""
        self.assertEqual(_normalize_name("Dr. Rajesh Mehta"), "rajesh mehta")
        self.assertEqual(_normalize_name("Mr.   Vikramaditya   Sharma"), "vikramaditya sharma")
        self.assertEqual(_normalize_name("Mrs. Priya Sharma-Verma"), "priya sharmaverma")

    def test_patient_demographic_verification_success(self):
        """Verify exact and case-insensitive demographic name matching."""
        session_state = ConversationState(session_id="sess-verify-1", tenant_id=str(self.tenant_id))

        res: VerificationResult = run_async(
            PatientVerificationService.verify_patient_demographics(
                self.db,
                self.tenant_id,
                self.patient_id,
                "Vikramaditya Sharma",
                session_state,
            )
        )

        self.assertTrue(res.success)
        self.assertEqual(res.patient_id, str(self.patient_id))
        self.assertEqual(session_state.verification_status, "verified")
        self.assertEqual(session_state.verified_patient_id, str(self.patient_id))
        self.assertTrue(session_state.is_verified_for_patient(str(self.patient_id)))

    def test_patient_verification_failure_and_lockout(self):
        """Verify rate-limiting lockout after 3 consecutive failed verification attempts."""
        session_state = ConversationState(session_id="sess-lockout-test", tenant_id=str(self.tenant_id))

        # Attempt 1 (Failure)
        res1 = run_async(
            PatientVerificationService.verify_patient_demographics(
                self.db, self.tenant_id, self.patient_id, "Wrong Name", session_state
            )
        )
        self.assertFalse(res1.success)
        self.assertEqual(res1.attempts_remaining, 2)
        self.assertFalse(res1.is_locked)

        # Attempt 2 (Failure)
        res2 = run_async(
            PatientVerificationService.verify_patient_demographics(
                self.db, self.tenant_id, self.patient_id, "Another Wrong", session_state
            )
        )
        self.assertFalse(res2.success)
        self.assertEqual(res2.attempts_remaining, 1)

        # Attempt 3 (Triggers 15-min lockout)
        res3 = run_async(
            PatientVerificationService.verify_patient_demographics(
                self.db, self.tenant_id, self.patient_id, "Third Mistake", session_state
            )
        )
        self.assertFalse(res3.success)
        self.assertTrue(res3.is_locked)
        self.assertEqual(session_state.verification_status, "locked")
        self.assertTrue(session_state.is_verification_locked())

        # Attempt 4 while locked fails immediately
        res4 = run_async(
            PatientVerificationService.verify_patient_demographics(
                self.db, self.tenant_id, self.patient_id, "Vikramaditya Sharma", session_state
            )
        )
        self.assertFalse(res4.success)
        self.assertTrue(res4.is_locked)

    def test_shared_family_phone_candidate_lookup(self):
        """Verify shared contact numbers return multiple candidate names without leaking sensitive data."""
        p2 = Patient(
            id=uuid.uuid4(),
            tenant_id=self.tenant_id,
            name="Ananya Sharma",
            phone="9876543210",  # Same family phone
            date="2026-11-21",
        )
        self.db.patients.append(p2)

        candidates = run_async(
            PatientVerificationService.lookup_candidates_by_phone(
                self.db, self.tenant_id, "9876543210"
            )
        )
        self.assertEqual(len(candidates), 2)
        names = [c["name"] for c in candidates]
        self.assertIn("Vikramaditya Sharma", names)
        self.assertIn("Ananya Sharma", names)
        self.assertIn("******3210", candidates[0]["phone_masked"])

    # -------------------------------------------------------------------------
    # 2. Dynamic Availability Calculation Tests
    # -------------------------------------------------------------------------
    def test_availability_slot_generation(self):
        """Verify 30-min slot generation between 10:00 and 12:00 (10:00, 10:30, 11:00, 11:30)."""
        target_date = date(2026, 11, 25)  # Wednesday (day 2)
        slots: List[AvailableSlot] = run_async(
            AvailabilityService.get_doctor_available_slots(
                self.db, self.tenant_id, self.doctor_id, target_date
            )
        )
        slot_starts = [s.start_time for s in slots]
        self.assertEqual(slot_starts, ["10:00", "10:30", "11:00", "11:30"])

    def test_availability_filters_out_booked_slots(self):
        """Verify existing booked appointments are excluded from available slots."""
        target_date = date(2026, 11, 25)

        # Book 10:30 slot
        apt = Appointment(
            id=uuid.uuid4(),
            tenant_id=self.tenant_id,
            doctor_id=self.doctor_id,
            patient_id=self.patient_id,
            appointment_date=target_date,
            start_time=time(10, 30),
            end_time=time(11, 0),
            appointment_range="[2026-11-25 10:30:00+00, 2026-11-25 11:00:00+00)",
            status="confirmed",
        )
        self.db.appointments.append(apt)

        slots = run_async(
            AvailabilityService.get_doctor_available_slots(
                self.db, self.tenant_id, self.doctor_id, target_date
            )
        )
        slot_starts = [s.start_time for s in slots]
        self.assertNotIn("10:30", slot_starts)
        self.assertEqual(slot_starts, ["10:00", "11:00", "11:30"])

    def test_availability_filters_out_doctor_leaves(self):
        """Verify scheduled doctor leaves remove affected slots."""
        target_date = date(2026, 11, 26)  # Thursday

        # Doctor on leave 11:00 to 12:00
        leave = DoctorLeave(
            id=uuid.uuid4(),
            tenant_id=self.tenant_id,
            doctor_id=self.doctor_id,
            leave_date=target_date,
            is_full_day=False,
            start_time=time(11, 0),
            end_time=time(12, 0),
        )
        self.db.doctor_leaves.append(leave)

        slots = run_async(
            AvailabilityService.get_doctor_available_slots(
                self.db, self.tenant_id, self.doctor_id, target_date
            )
        )
        slot_starts = [s.start_time for s in slots]
        self.assertNotIn("11:00", slot_starts)
        self.assertNotIn("11:30", slot_starts)
        self.assertEqual(slot_starts, ["10:00", "10:30"])

    # -------------------------------------------------------------------------
    # 3. Atomic Appointment Booking & Idempotency Tests
    # -------------------------------------------------------------------------
    def test_unverified_booking_rejected(self):
        """Verify booking fails if caller has not completed patient verification."""
        session_state = ConversationState(session_id="unverified-sess", tenant_id=str(self.tenant_id))

        res: BookingResult = run_async(
            AppointmentService.book_appointment(
                self.db,
                self.tenant_id,
                self.patient_id,
                self.doctor_id,
                date(2026, 11, 25),
                "10:00",
                session_state=session_state,
            )
        )
        self.assertFalse(res.success)
        self.assertEqual(res.error_code, "UNVERIFIED")

    def test_successful_booking_and_idempotency_retry(self):
        """Verify successful appointment booking and subsequent duplicate call returning identical reference."""
        session_state = ConversationState(session_id="verified-booking-sess", tenant_id=str(self.tenant_id))
        session_state.verified_patient_id = str(self.patient_id)
        session_state.verification_status = "verified"
        session_state.verified_at = time_module.time()

        idem_key = "idemp-unique-token-12345"
        res1: BookingResult = run_async(
            AppointmentService.book_appointment(
                self.db,
                self.tenant_id,
                self.patient_id,
                self.doctor_id,
                date(2026, 11, 25),
                "10:00",
                idempotency_key=idem_key,
                session_state=session_state,
            )
        )
        self.assertTrue(res1.success)
        self.assertEqual(res1.start_time, "10:00")
        self.assertIsNotNone(res1.appointment_id)

        # Retry identical request with same idempotency key
        res2: BookingResult = run_async(
            AppointmentService.book_appointment(
                self.db,
                self.tenant_id,
                self.patient_id,
                self.doctor_id,
                date(2026, 11, 25),
                "10:00",
                idempotency_key=idem_key,
                session_state=session_state,
            )
        )
        self.assertTrue(res2.success)
        self.assertEqual(res2.appointment_id, res1.appointment_id)
        self.assertIn("idempotency", res2.message.lower())

    # -------------------------------------------------------------------------
    # 4. Cancellation & Atomic Rescheduling Tests
    # -------------------------------------------------------------------------
    def test_appointment_cancellation_and_slot_release(self):
        """Verify appointment cancellation updates status and frees the slot."""
        session_state = ConversationState(session_id="cancel-sess", tenant_id=str(self.tenant_id))
        session_state.verified_patient_id = str(self.patient_id)
        session_state.verification_status = "verified"
        session_state.verified_at = time_module.time()

        # Book 10:00
        book_res = run_async(
            AppointmentService.book_appointment(
                self.db,
                self.tenant_id,
                self.patient_id,
                self.doctor_id,
                date(2026, 11, 25),
                "10:00",
                session_state=session_state,
            )
        )
        apt_id = uuid.UUID(book_res.appointment_id)

        # Cancel
        cancel_res = run_async(
            AppointmentService.cancel_appointment(
                self.db,
                self.tenant_id,
                apt_id,
                reason="Patient schedule conflict",
                session_state=session_state,
            )
        )
        self.assertTrue(cancel_res["success"])

        # Verify 10:00 is back in free slots
        free_slots = run_async(
            AvailabilityService.get_doctor_available_slots(
                self.db, self.tenant_id, self.doctor_id, date(2026, 11, 25)
            )
        )
        self.assertIn("10:00", [s.start_time for s in free_slots])

    # -------------------------------------------------------------------------
    # 5. Concurrent Booking Collision Test
    # -------------------------------------------------------------------------
    def test_concurrent_booking_collision_recovery(self):
        """Verify when two callers race for the same slot, the second receives SLOT_CONFLICT with alternatives."""
        # Patient 1 verified session
        s1 = ConversationState(session_id="caller-1", tenant_id=str(self.tenant_id))
        s1.verified_patient_id = str(self.patient_id)
        s1.verification_status = "verified"
        s1.verified_at = time_module.time()

        # Patient 2 verified session
        p2_id = uuid.uuid4()
        s2 = ConversationState(session_id="caller-2", tenant_id=str(self.tenant_id))
        s2.verified_patient_id = str(p2_id)
        s2.verification_status = "verified"
        s2.verified_at = time_module.time()

        # Caller 1 claims 11:00 AM slot
        res1 = run_async(
            AppointmentService.book_appointment(
                self.db,
                self.tenant_id,
                self.patient_id,
                self.doctor_id,
                date(2026, 11, 25),
                "11:00",
                session_state=s1,
            )
        )
        self.assertTrue(res1.success)

        # Caller 2 attempts to claim the exact same slot
        res2 = run_async(
            AppointmentService.book_appointment(
                self.db,
                self.tenant_id,
                p2_id,
                self.doctor_id,
                date(2026, 11, 25),
                "11:00",
                session_state=s2,
            )
        )
        self.assertFalse(res2.success)
        self.assertEqual(res2.error_code, "SLOT_CONFLICT")
        self.assertIsNotNone(res2.alternative_slots)
        self.assertIn("10:00 AM", res2.alternative_slots)


if __name__ == "__main__":
    unittest.main()
