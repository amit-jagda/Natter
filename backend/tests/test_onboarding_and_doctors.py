"""Unit and Integration Tests for Hospital Onboarding & Doctor Validation.

Verifies Pydantic v2 validation logic, error handling, and API workflows.
"""

import os
import sys
import unittest
import urllib.request
import urllib.error
import json
from datetime import time
from pydantic import ValidationError

from app.schemas.auth import HospitalRegisterRequest
from app.schemas.tenant import OperatingHoursItem, HospitalProfileUpdate
from app.schemas.doctor import DoctorCreate, DoctorAvailabilityItem


class TestPydanticValidation(unittest.TestCase):
    """Direct schema unit tests verifying Pydantic v2 validators."""

    def test_hospital_register_valid(self):
        req = HospitalRegisterRequest(
            hospital_name="Fortis Memorial",
            admin_name="Dr. Sameer",
            admin_email="sameer@fortis.org",
            password="SecurePassword123!",
        )
        self.assertEqual(req.hospital_name, "Fortis Memorial")
        self.assertEqual(req.admin_email, "sameer@fortis.org")

    def test_hospital_register_weak_password_no_number(self):
        with self.assertRaises(ValidationError) as ctx:
            HospitalRegisterRequest(
                hospital_name="Fortis Memorial",
                admin_name="Dr. Sameer",
                admin_email="sameer@fortis.org",
                password="OnlyLettersPassword!",
            )
        self.assertIn("at least one number", str(ctx.exception))

    def test_hospital_register_weak_password_no_letters(self):
        with self.assertRaises(ValidationError) as ctx:
            HospitalRegisterRequest(
                hospital_name="Fortis Memorial",
                admin_name="Dr. Sameer",
                admin_email="sameer@fortis.org",
                password="1234567890!@#$",
            )
        self.assertIn("at least one letter", str(ctx.exception))

    def test_operating_hours_valid(self):
        h = OperatingHoursItem(day_of_week=0, open_time="09:00", close_time="20:00", is_closed=False)
        self.assertEqual(h.open_time, "09:00")
        self.assertEqual(h.close_time, "20:00")

    def test_operating_hours_open_after_close(self):
        with self.assertRaises(ValidationError) as ctx:
            OperatingHoursItem(day_of_week=0, open_time="21:00", close_time="09:00", is_closed=False)
        self.assertIn("earlier than closing time", str(ctx.exception))

    def test_doctor_availability_valid(self):
        avail = DoctorAvailabilityItem(day_of_week=1, start_time="10:00", end_time="14:00")
        self.assertEqual(str(avail.start_time), "10:00")
        self.assertEqual(str(avail.end_time), "14:00")

    def test_doctor_availability_start_after_end(self):
        with self.assertRaises(ValidationError) as ctx:
            DoctorAvailabilityItem(day_of_week=1, start_time="16:00", end_time="11:00")
        self.assertIn("start time (16:00) must be before end time (11:00)", str(ctx.exception))

    def test_doctor_create_invalid_slot_duration(self):
        with self.assertRaises(ValidationError) as ctx:
            DoctorCreate(
                full_name="Dr. Ramesh",
                email="ramesh@clinic.com",
                specialization="Cardiology",
                slot_duration_minutes=2,  # min is 5
            )
        self.assertIn("greater than or equal to 5", str(ctx.exception))

    def test_hospital_profile_invalid_phone(self):
        with self.assertRaises(ValidationError) as ctx:
            HospitalProfileUpdate(phone_number="12")  # min 3 digits
        self.assertIn("between 3 and 15 digits", str(ctx.exception))


class TestAPIEndpointsIntegration(unittest.TestCase):
    """Integration tests verifying HTTP 422 error codes and successful workflows."""

    BASE_URL = os.environ.get("TEST_API_URL", "http://localhost:8000/api/v1")

    def make_request(self, method, path, data=None, token=None):
        url = f"{self.BASE_URL}{path}"
        body = json.dumps(data).encode("utf-8") if data is not None else None
        headers = {}
        if data is not None:
            headers["Content-Type"] = "application/json"
        if token:
            headers["Authorization"] = f"Bearer {token}"

        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req) as resp:
                status_code = resp.status
                content = resp.read().decode("utf-8")
                return status_code, json.loads(content) if content else {}
        except urllib.error.HTTPError as err:
            err_content = err.read().decode("utf-8")
            try:
                err_json = json.loads(err_content)
            except Exception:
                err_json = {"detail": err_content}
            return err.code, err_json

    def test_e2e_onboarding_and_validation(self):
        # 1. Register with weak password should return 422
        status, res = self.make_request(
            "POST",
            "/auth/register-hospital",
            {
                "hospital_name": "Validation Hospital",
                "admin_name": "Admin Test",
                "admin_email": "val.admin@hospital.com",
                "password": "onlyletters",
            },
        )
        self.assertEqual(status, 422, f"Expected 422 for weak password, got {status}: {res}")

        # 2. Register with valid payload should return 201
        import uuid
        unique_suffix = uuid.uuid4().hex[:6]
        status, reg_res = self.make_request(
            "POST",
            "/auth/register-hospital",
            {
                "hospital_name": f"City Care {unique_suffix}",
                "admin_name": "Admin City",
                "admin_email": f"city.{unique_suffix}@care.org",
                "password": "ValidPassword123!",
            },
        )
        self.assertEqual(status, 201, f"Failed registration: {reg_res}")
        token = reg_res["access_token"]
        self.assertIsNotNone(token)

        # 3. Update profile with invalid operating hours (open >= close) should return 422
        status, err_res = self.make_request(
            "PUT",
            "/onboarding/hospital-profile",
            {
                "operating_hours": [
                    {"day_of_week": 0, "open_time": "20:00", "close_time": "08:00", "is_closed": False}
                ]
            },
            token=token,
        )
        self.assertEqual(status, 422, f"Expected 422 for inverted hours, got {status}: {err_res}")

        # 4. Add doctor with inverted shift times should return 422
        status, err_res = self.make_request(
            "POST",
            "/doctors",
            {
                "full_name": "Dr. Invalid Time",
                "email": f"invalid.{unique_suffix}@care.org",
                "specialization": "Neurology",
                "availabilities": [
                    {"day_of_week": 2, "start_time": "18:00", "end_time": "10:00", "is_available": True}
                ],
            },
            token=token,
        )
        self.assertEqual(status, 422, f"Expected 422 for inverted doctor shift, got {status}: {err_res}")

        # 5. Add doctor with valid data should return 201
        status, doc_res = self.make_request(
            "POST",
            "/doctors",
            {
                "full_name": "Dr. Tarun Verma",
                "email": f"tarun.{unique_suffix}@care.org",
                "specialization": "Neurology",
                "slot_duration_minutes": 30,
                "consultation_fee": 900,
                "availabilities": [
                    {"day_of_week": 2, "start_time": "10:00", "end_time": "14:00", "is_available": True}
                ],
            },
            token=token,
        )
        self.assertEqual(status, 201, f"Failed to add doctor: {doc_res}")
        doctor_id = doc_res["id"]

        # 6. Complete onboarding should return 200
        status, comp_res = self.make_request("POST", "/onboarding/complete", {}, token=token)
        self.assertEqual(status, 200)
        self.assertEqual(comp_res["onboarding_status"], "COMPLETED")


if __name__ == "__main__":
    unittest.main()
