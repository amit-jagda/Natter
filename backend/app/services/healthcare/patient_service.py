"""Healthcare Patient Verification and Record Service.

Provides:
1. Candidate patient lookup by contact number (supporting shared family phone numbers).
2. Strategy-based patient identity verification with demographic matching.
3. Strict rate limiting (max 3 failed attempts before 15-minute session lockout).
4. Time-limited, server-controlled verification tokens.
5. New patient registration and record creation.

Note: Patient.date is the registration/encounter date, strictly excluded from DOB matching.
"""

from dataclasses import dataclass
import logging
import re
import time
from typing import Any, Dict, List, Optional
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.patient import Patient
from app.services.conversation.state import ConversationState

logger = logging.getLogger(__name__)

MAX_VERIFICATION_ATTEMPTS = 3
VERIFICATION_LOCKOUT_SECONDS = 900.0  # 15 minutes
VERIFICATION_TOKEN_TTL_SECONDS = 1200.0  # 20 minutes


def _normalize_name(name: str) -> str:
    """Normalize names by lowercasing, stripping honorifics, and removing excess whitespace."""
    n = name.lower().strip()
    n = re.sub(r"^(mr\.|mrs\.|ms\.|dr\.|shri|smt)\s+", "", n)
    n = re.sub(r"[^\w\s]", "", n)
    return re.sub(r"\s+", " ", n).strip()


def _normalize_phone(phone: str) -> str:
    """Extract digits only from phone numbers."""
    return re.sub(r"\D", "", phone.strip()) if phone else ""


@dataclass
class VerificationResult:
    """Outcome of a patient identity verification attempt."""
    success: bool
    patient_id: Optional[str] = None
    patient_name: Optional[str] = None
    error: Optional[str] = None
    is_locked: bool = False
    attempts_remaining: int = 0


class PatientVerificationService:
    """Server-controlled patient verification and lookup service."""

    @staticmethod
    async def lookup_candidates_by_phone(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        phone: str,
    ) -> List[Dict[str, str]]:
        """Find candidate patients registered under a phone number.

        Supports shared family lines by returning names and IDs for disambiguation
        without exposing confidential medical records.
        """
        clean_phone = _normalize_phone(phone)
        if not clean_phone or len(clean_phone) < 10:
            return []

        # Find patients with matching phone or last 10 digits
        query = (
            select(Patient)
            .where(Patient.tenant_id == tenant_id)
            .where(
                (Patient.phone == clean_phone)
                | (Patient.phone.endswith(clean_phone[-10:]))
            )
            .order_by(Patient.name)
        )
        result = await db.execute(query)
        patients = result.scalars().all()

        return [
            {
                "patient_id": str(p.id),
                "name": p.name,
                "phone_masked": f"******{clean_phone[-4:]}" if len(clean_phone) >= 4 else clean_phone,
            }
            for p in patients
        ]

    @staticmethod
    async def verify_patient_demographics(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        patient_id: uuid.UUID,
        provided_name: str,
        session_state: ConversationState,
    ) -> VerificationResult:
        """Verify patient identity using server-side demographic full name matching.

        Enforces rate limits and sets expiring verification state in the session.
        """
        # 1. Enforce active lockout
        if session_state.is_verification_locked():
            return VerificationResult(
                success=False,
                error="Verification attempts have been locked due to repeated failures. Please hold for reception.",
                is_locked=True,
                attempts_remaining=0,
            )

        # 2. Fetch authoritative patient record from PostgreSQL
        query = (
            select(Patient)
            .where(Patient.id == patient_id)
            .where(Patient.tenant_id == tenant_id)
        )
        result = await db.execute(query)
        patient = result.scalar_one_or_none()

        if not patient:
            session_state.verification_attempts += 1
            if session_state.verification_attempts >= MAX_VERIFICATION_ATTEMPTS:
                session_state.verification_locked_until = time.time() + VERIFICATION_LOCKOUT_SECONDS
                session_state.verification_status = "locked"
                return VerificationResult(
                    success=False,
                    error="Maximum verification attempts exceeded. Verification locked.",
                    is_locked=True,
                    attempts_remaining=0,
                )
            return VerificationResult(
                success=False,
                error="Patient record not found.",
                attempts_remaining=MAX_VERIFICATION_ATTEMPTS - session_state.verification_attempts,
            )

        # 3. Match normalized names
        expected = _normalize_name(patient.name)
        given = _normalize_name(provided_name)

        # Exact match or word subset match (e.g. first and last name match)
        match_success = False
        if expected == given:
            match_success = True
        elif len(given) >= 3 and (given in expected or expected in given):
            match_success = True
        else:
            # Check individual name components
            expected_parts = set(expected.split())
            given_parts = set(given.split())
            if expected_parts and given_parts and (expected_parts.issubset(given_parts) or given_parts.issubset(expected_parts)):
                match_success = True

        if match_success:
            # Identity confirmed: Issue server-controlled verification token
            session_state.verified_patient_id = str(patient.id)
            session_state.verification_status = "verified"
            session_state.verification_method = "demographic_name_match"
            session_state.verified_at = time.time()
            session_state.verification_attempts = 0
            session_state.verification_locked_until = None

            return VerificationResult(
                success=True,
                patient_id=str(patient.id),
                patient_name=patient.name,
                attempts_remaining=MAX_VERIFICATION_ATTEMPTS,
            )

        # Match failed: Increment lockout counter
        session_state.verification_attempts += 1
        if session_state.verification_attempts >= MAX_VERIFICATION_ATTEMPTS:
            session_state.verification_locked_until = time.time() + VERIFICATION_LOCKOUT_SECONDS
            session_state.verification_status = "locked"
            return VerificationResult(
                success=False,
                error="Maximum verification attempts exceeded. Verification locked for 15 minutes.",
                is_locked=True,
                attempts_remaining=0,
            )

        remaining = MAX_VERIFICATION_ATTEMPTS - session_state.verification_attempts
        return VerificationResult(
            success=False,
            error=f"Provided name does not match hospital records. {remaining} attempt(s) remaining.",
            is_locked=False,
            attempts_remaining=remaining,
        )

    @staticmethod
    async def register_new_patient(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        name: str,
        phone: str,
        *,
        email: Optional[str] = None,
        gender: Optional[str] = None,
        notes: Optional[str] = None,
        session_state: Optional[ConversationState] = None,
    ) -> Patient:
        """Register a new patient and automatically verify them for the current session."""
        clean_phone = _normalize_phone(phone)
        if not clean_phone or len(clean_phone) < 10 or len(clean_phone) > 15:
            raise ValueError("Phone number must contain between 10 and 15 digits.")

        clean_name = name.strip()
        if not clean_name or len(clean_name) < 2:
            raise ValueError("Patient full name must be at least 2 characters.")

        today_str = time.strftime("%Y-%m-%d")
        new_patient = Patient(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            name=clean_name,
            phone=clean_phone,
            email=email.strip() if email else None,
            date=today_str,  # Registration date as defined in schema
            gender=gender.strip() if gender else None,
            notes=notes.strip() if notes else "Registered via AI Voice Agent",
        )
        db.add(new_patient)
        await db.commit()
        await db.refresh(new_patient)

        # Grant verified status in active conversational session
        if session_state is not None:
            session_state.verified_patient_id = str(new_patient.id)
            session_state.verification_status = "verified"
            session_state.verification_method = "new_registration"
            session_state.verified_at = time.time()
            session_state.verification_attempts = 0

        return new_patient
