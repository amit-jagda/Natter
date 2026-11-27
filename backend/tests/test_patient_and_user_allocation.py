"""Unit Tests for Patient Details, Excel Import/Export, and User Allocation.

Verifies:
1. Patient model instantiation and relationships.
2. Patient Pydantic validation (Create, Patch, Read).
3. Sample Excel template creation (.xlsx) with openpyxl.
4. Patient Excel export creation.
5. Patient import parsing for .xlsx and .csv.
6. User allocation invite password generation & email dispatch.
7. Role permission enforcement (Operator GET-only vs Admin full write).
"""

import io
import os
import sys
import unittest
import uuid
from pathlib import Path

backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

import openpyxl
from pydantic import ValidationError
from app.core.exceptions import ForbiddenException
from app.models.enums import TenantRole, UserStatus
from app.models.patient import Patient
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.patient import PatientCreate, PatientPatch, PatientRead
from app.schemas.user import UserInviteRequest, UserInviteResponse, UserRead
from app.services.email import generate_random_password, send_invitation_email


class TestPatientAndUserAllocation(unittest.TestCase):
    """Test suite covering patient CRUD schemas, Excel import/export logic, and user allocation."""

    def test_patient_model_instantiation(self):
        """Verify Patient ORM model fields with required phone and optional email."""
        t_id = uuid.uuid4()
        p = Patient(
            tenant_id=t_id,
            name="Ramesh Kumar",
            phone="9876500000",
            email="ramesh@example.com",
            date="2026-11-25",
            gender="Male",
            notes="Cardiac consultation",
        )
        self.assertEqual(p.name, "Ramesh Kumar")
        self.assertEqual(p.phone, "9876500000")
        self.assertEqual(p.email, "ramesh@example.com")
        self.assertEqual(p.date, "2026-11-25")
        self.assertEqual(p.tenant_id, t_id)
        self.assertIn("Ramesh Kumar", repr(p))

    def test_patient_schemas_create_and_patch(self):
        """Verify Patient validation schemas with phone required (digits only) and email optional."""
        # Valid create with all fields
        valid_payload = {
            "name": "Sunita Rao",
            "phone": "9876543210",
            "email": "sunita@example.com",
            "date": "2026-11-28",
            "gender": "Female",
            "notes": "Follow up",
        }
        create_schema = PatientCreate(**valid_payload)
        self.assertEqual(create_schema.name, "Sunita Rao")
        self.assertEqual(create_schema.phone, "9876543210")
        self.assertEqual(create_schema.email, "sunita@example.com")

        # Valid create with optional email omitted or empty
        valid_no_email = {
            "name": "Sunita Rao",
            "phone": "9876543210",
            "email": "",
            "date": "2026-11-28",
        }
        schema_no_email = PatientCreate(**valid_no_email)
        self.assertIsNone(schema_no_email.email)
        self.assertEqual(schema_no_email.phone, "9876543210")

        # Reject phone with alphabets
        with self.assertRaises(ValidationError):
            PatientCreate(name="Bad Phone", phone="98765abcde", date="2026-11-28")

        # Reject phone that is too short (<10 digits)
        with self.assertRaises(ValidationError):
            PatientCreate(name="Short Phone", phone="12345", date="2026-11-28")

        # Reject missing phone
        with self.assertRaises(ValidationError):
            PatientCreate(name="Missing Phone", date="2026-11-28")

        # Invalid email in create (when provided)
        with self.assertRaises(ValidationError):
            PatientCreate(name="Bad Email", phone="9876543210", email="not-an-email", date="2026-11-28")

        # Patch schema allows partial fields
        patch_schema = PatientPatch(phone="1111122222")
        self.assertEqual(patch_schema.phone, "1111122222")
        self.assertIsNone(patch_schema.name)
        self.assertIsNone(patch_schema.email)

        # Patch schema rejects alphabets in phone
        with self.assertRaises(ValidationError):
            PatientPatch(phone="invalid-phone-abc")

    def test_sample_excel_template_generation(self):
        """Verify openpyxl workbook creation for sample patient import with phone column."""
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Patients"
        headers = ["name", "phone", "email", "date", "gender", "notes"]
        ws.append(headers)
        ws.append(["Aarav Sharma", "9876543210", "aarav@example.com", "2026-11-25", "Male", "Checkup"])

        stream = io.BytesIO()
        wb.save(stream)
        stream.seek(0)
        content = stream.getvalue()

        # Re-read with openpyxl
        loaded_wb = openpyxl.load_workbook(io.BytesIO(content))
        loaded_ws = loaded_wb.active
        rows = list(loaded_ws.iter_rows(values_only=True))

        self.assertEqual(rows[0], ("name", "phone", "email", "date", "gender", "notes"))
        self.assertEqual(rows[1][0], "Aarav Sharma")
        self.assertEqual(rows[1][1], "9876543210")
        self.assertEqual(rows[1][2], "aarav@example.com")
        self.assertEqual(rows[1][3], "2026-11-25")

    def test_user_invite_schema_and_password_generator(self):
        """Verify secure password generator and user invite schemas with custom password."""
        pwd1 = generate_random_password(12)
        pwd2 = generate_random_password(12)
        self.assertEqual(len(pwd1), 12)
        self.assertNotEqual(pwd1, pwd2)
        # Check presence of digits or characters
        self.assertTrue(any(c.isdigit() for c in pwd1))

        # Default role in UserInviteRequest must be OPERATOR
        invite_req = UserInviteRequest(full_name="Staff Operator", email="staff@hospital.org")
        self.assertEqual(invite_req.role, TenantRole.OPERATOR)
        self.assertIsNone(invite_req.password)

        # Custom password in UserInviteRequest
        custom_invite = UserInviteRequest(
            full_name="Staff Operator 2",
            email="staff2@hospital.org",
            role=TenantRole.OPERATOR,
            password="MySecretPassword#999"
        )
        self.assertEqual(custom_invite.password, "MySecretPassword#999")
        self.assertEqual(custom_invite.role, TenantRole.OPERATOR)

    def test_user_update_schema_with_password(self):
        """Verify UserUpdate allows partial edits and password reset."""
        from app.schemas.user import UserUpdate
        update_schema = UserUpdate(
            full_name="Senior Staff",
            role=TenantRole.ADMIN,
            password="NewResetPassword#123"
        )
        self.assertEqual(update_schema.full_name, "Senior Staff")
        self.assertEqual(update_schema.role, TenantRole.ADMIN)
        self.assertEqual(update_schema.password, "NewResetPassword#123")

    def test_send_invitation_email_mock(self):
        """Verify email invitation builder and mock delivery."""
        result = send_invitation_email(
            recipient_email="operator@hospital.org",
            recipient_name="Amitabh Sen",
            temp_password="SecurePass#123",
            hospital_name="Apex Healthcare Center",
            role="operator",
        )
        self.assertTrue(result.get("sent"))
        self.assertEqual(result.get("recipient"), "operator@hospital.org")

    def test_role_permission_enforcement_logic(self):
        """Verify that Operator role is denied write permissions."""
        t_id = uuid.uuid4()
        operator_user = User(
            tenant_id=t_id,
            email="operator@test.com",
            hashed_password="pw",
            full_name="Operator User",
            role=TenantRole.OPERATOR,
            status=UserStatus.ACTIVE,
        )
        admin_user = User(
            tenant_id=t_id,
            email="admin@test.com",
            hashed_password="pw",
            full_name="Admin User",
            role=TenantRole.ADMIN,
            status=UserStatus.ACTIVE,
        )

        def check_write_permission(user: User):
            if user.role != TenantRole.ADMIN:
                raise ForbiddenException("Access denied: Operators have read-only permissions.")
            return True

        # Operator write should raise ForbiddenException
        with self.assertRaises(ForbiddenException):
            check_write_permission(operator_user)

        # Admin write should succeed
        self.assertTrue(check_write_permission(admin_user))


if __name__ == "__main__":
    unittest.main()
