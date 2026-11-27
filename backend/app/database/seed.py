"""Database Seeder Service.

Populates initial healthcare data for development, testing, and frontend demonstrations:
1. Hospital Tenant ("Apollo Metro Hospital") with contact DIDs and operating schedule.
2. Hospital Administration user account.
3. Multi-specialty doctors (Cardiology, General Medicine, Pediatrics, Orthopedics, Dermatology)
   with normalized user profiles, consultation fees, and recurring weekly shift schedules.
4. Pre-registered patients with contact phone numbers (including shared family phone lines)
   for direct frontend calling and verification testing.
5. Sample existing appointments for conflict recovery demonstrations.
"""

import asyncio
from datetime import date, datetime, time, timedelta, timezone
import logging
import sys
from typing import Any, Dict, List, Optional
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.database.session import AsyncSessionLocal
from app.models.appointment import Appointment
from app.models.doctor import Doctor, DoctorAvailability
from app.models.enums import TenantRole, UserStatus
from app.models.operating_hours import HospitalOperatingHours
from app.models.patient import Patient
from app.models.tenant import Tenant
from app.models.user import User
from app.services.healthcare.availability_service import get_tenant_tz

logger = logging.getLogger(__name__)


async def seed_data(db: AsyncSession, force: bool = False) -> Dict[str, Any]:
    """Seed hospital tenant, doctors, patients, and schedules.

    Args:
        db: Active async database session.
        force: If True, seeds data even if tenants already exist.

    Returns:
        Summary dict of created entities.
    """
    # 1. Check if database already has tenant records
    existing_tenant_res = await db.execute(select(Tenant).limit(1))
    existing_tenant = existing_tenant_res.scalar_one_or_none()

    if existing_tenant and not force:
        logger.info(
            "Database already contains tenant '%s' (%s). Auto-seeding skipped.",
            existing_tenant.name,
            existing_tenant.id,
        )
        return {
            "seeded": False,
            "message": "Database already populated.",
            "tenant_id": str(existing_tenant.id),
        }

    logger.info("Starting healthcare database seeding...")

    # 2. Create Hospital Tenant
    tenant_id = uuid.uuid4()
    tenant = Tenant(
        id=tenant_id,
        name="Apollo Metro Hospital",
        slug="apollo-metro",
        phone_number="18005550199",
        emergency_contact="18005550911",
        address={
            "street": "45 Park Avenue, Healthcare Hub",
            "city": "Mumbai",
            "state": "Maharashtra",
            "country": "India",
            "postal_code": "400001",
        },
        timezone="Asia/Kolkata",
        is_active=True,
    )
    db.add(tenant)

    # 3. Weekly Hospital Operating Hours (Mon-Sat: 08:00-20:00, Sun: 09:00-14:00)
    for day in range(7):
        is_sunday = (day == 6)
        operating_hour = HospitalOperatingHours(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            day_of_week=day,
            open_time=time(9, 0) if is_sunday else time(8, 0),
            close_time=time(14, 0) if is_sunday else time(20, 0),
            is_closed=False,
        )
        db.add(operating_hour)

    # 4. Hospital Admin User
    admin_user = User(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        email="admin@apollometro.com",
        hashed_password=hash_password("Password@123"),
        full_name="Hospital Administration",
        role=TenantRole.ADMIN,
        status=UserStatus.ACTIVE,
        is_active=True,
    )
    db.add(admin_user)

    # 5. Multi-Specialty Doctors & Shift Availability
    doctors_spec = [
        {
            "name": "Dr. Rajesh Sharma",
            "email": "dr.sharma@apollometro.com",
            "specialty": "Cardiology",
            "department": "Cardiology Block A, Room 102",
            "fee": 800.0,
            "duration": 30,
            "shifts": [
                {"day": 0, "start": time(9, 0), "end": time(13, 0)},  # Mon
                {"day": 2, "start": time(9, 0), "end": time(13, 0)},  # Wed
                {"day": 4, "start": time(9, 0), "end": time(13, 0)},  # Fri
                {"day": 0, "start": time(14, 0), "end": time(17, 0)}, # Mon PM
                {"day": 2, "start": time(14, 0), "end": time(17, 0)}, # Wed PM
            ],
        },
        {
            "name": "Dr. Priya Patel",
            "email": "dr.priya@apollometro.com",
            "specialty": "General Medicine",
            "department": "OPD Block B, Room 205",
            "fee": 500.0,
            "duration": 30,
            "shifts": [
                {"day": 0, "start": time(10, 0), "end": time(14, 0)}, # Mon
                {"day": 1, "start": time(10, 0), "end": time(14, 0)}, # Tue
                {"day": 2, "start": time(10, 0), "end": time(14, 0)}, # Wed
                {"day": 3, "start": time(10, 0), "end": time(14, 0)}, # Thu
                {"day": 4, "start": time(10, 0), "end": time(14, 0)}, # Fri
                {"day": 5, "start": time(10, 0), "end": time(14, 0)}, # Sat
            ],
        },
        {
            "name": "Dr. Amit Verma",
            "email": "dr.amit@apollometro.com",
            "specialty": "Pediatrics",
            "department": "Child Care Center, Room 101",
            "fee": 600.0,
            "duration": 30,
            "shifts": [
                {"day": 1, "start": time(11, 0), "end": time(16, 0)}, # Tue
                {"day": 3, "start": time(11, 0), "end": time(16, 0)}, # Thu
                {"day": 5, "start": time(11, 0), "end": time(16, 0)}, # Sat
            ],
        },
        {
            "name": "Dr. Sneha Roy",
            "email": "dr.sneha@apollometro.com",
            "specialty": "Orthopedics",
            "department": "Ortho Clinic, Block C",
            "fee": 750.0,
            "duration": 30,
            "shifts": [
                {"day": 0, "start": time(9, 30), "end": time(13, 30)}, # Mon
                {"day": 1, "start": time(9, 30), "end": time(13, 30)}, # Tue
                {"day": 3, "start": time(9, 30), "end": time(13, 30)}, # Thu
                {"day": 4, "start": time(9, 30), "end": time(13, 30)}, # Fri
            ],
        },
        {
            "name": "Dr. Vikram Malhotra",
            "email": "dr.vikram@apollometro.com",
            "specialty": "Dermatology",
            "department": "Skin Care Clinic, Room 304",
            "fee": 700.0,
            "duration": 30,
            "shifts": [
                {"day": 2, "start": time(14, 0), "end": time(18, 0)}, # Wed
                {"day": 4, "start": time(14, 0), "end": time(18, 0)}, # Fri
                {"day": 5, "start": time(14, 0), "end": time(18, 0)}, # Sat
            ],
        },
    ]

    created_doctors: List[Doctor] = []
    for d_spec in doctors_spec:
        user_id = uuid.uuid4()
        doc_user = User(
            id=user_id,
            tenant_id=tenant_id,
            email=d_spec["email"],
            hashed_password=hash_password("Doctor@123"),
            full_name=d_spec["name"],
            role=TenantRole.DOCTOR,
            status=UserStatus.ACTIVE,
            is_active=True,
        )
        db.add(doc_user)

        doctor_id = uuid.uuid4()
        doctor = Doctor(
            id=doctor_id,
            tenant_id=tenant_id,
            user_id=user_id,
            specialization=d_spec["specialty"],
            department=d_spec["department"],
            slot_duration_minutes=d_spec["duration"],
            consultation_fee=d_spec["fee"],
            is_active=True,
        )
        db.add(doctor)
        created_doctors.append(doctor)

        for s in d_spec["shifts"]:
            avail = DoctorAvailability(
                id=uuid.uuid4(),
                tenant_id=tenant_id,
                doctor_id=doctor_id,
                day_of_week=s["day"],
                start_time=s["start"],
                end_time=s["end"],
                is_available=True,
            )
            db.add(avail)

    # 6. Sample Registered Patients (ready to test verification and direct calls)
    patients_spec = [
        {
            "name": "Rahul Sharma",
            "phone": "9876543210",
            "email": "rahul.sharma@example.com",
            "gender": "Male",
            "notes": "Known hypertension patient, periodic cardiac consultation",
        },
        {
            "name": "Anita Sharma",
            "phone": "9876543210",  # Shared family line with Rahul Sharma
            "email": "anita.sharma@example.com",
            "gender": "Female",
            "notes": "Spouse of Rahul Sharma, routine health checkup",
        },
        {
            "name": "Sunita Verma",
            "phone": "9123456780",
            "email": "sunita.verma@example.com",
            "gender": "Female",
            "notes": "Mother of Aarav Verma (Pediatrics patient)",
        },
        {
            "name": "Ramesh Iyer",
            "phone": "9988776655",
            "email": "ramesh.iyer@example.com",
            "gender": "Male",
            "notes": "Post-surgery knee orthopedic review",
        },
        {
            "name": "Pooja Mehta",
            "phone": "9822334455",
            "email": "pooja.mehta@example.com",
            "gender": "Female",
            "notes": "Seasonal allergy and skin rash consultation",
        },
    ]

    created_patients: List[Patient] = []
    today_iso = date.today().isoformat()
    for p_spec in patients_spec:
        patient = Patient(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            name=p_spec["name"],
            phone=p_spec["phone"],
            email=p_spec["email"],
            date=today_iso,
            gender=p_spec["gender"],
            notes=p_spec["notes"],
        )
        db.add(patient)
        created_patients.append(patient)

    # 7. Sample Appointment (to test slot conflict recovery & cancellation)
    # Book Dr. Rajesh Sharma on the next upcoming Wednesday at 10:00 AM
    today = date.today()
    days_ahead = (2 - today.weekday()) % 7  # 2 is Wednesday
    if days_ahead == 0:
        days_ahead = 7
    sample_apt_date = today + timedelta(days=days_ahead)

    cardio_doc = created_doctors[0]
    sample_patient = created_patients[0]

    tenant_tz = get_tenant_tz(tenant.timezone)
    start_dt = datetime.combine(sample_apt_date, time(10, 0), tzinfo=tenant_tz).astimezone(timezone.utc)
    end_dt = datetime.combine(sample_apt_date, time(10, 30), tzinfo=tenant_tz).astimezone(timezone.utc)
    range_str = f"[{start_dt.strftime('%Y-%m-%d %H:%M:%S%z')}, {end_dt.strftime('%Y-%m-%d %H:%M:%S%z')})"

    sample_apt = Appointment(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        doctor_id=cardio_doc.id,
        patient_id=sample_patient.id,
        appointment_date=sample_apt_date,
        start_time=time(10, 0),
        end_time=time(10, 30),
        appointment_range=range_str,
        status="confirmed",
        idempotency_key=f"sample-seed-{uuid.uuid4()}",
        source="dashboard",
        notes="Pre-booked routine cardiology checkup",
    )
    db.add(sample_apt)

    await db.commit()

    logger.info("Healthcare database seeding successfully completed!")
    return {
        "seeded": True,
        "tenant_id": str(tenant_id),
        "hospital_name": tenant.name,
        "hospital_did": tenant.phone_number,
        "doctors_count": len(created_doctors),
        "patients_count": len(created_patients),
        "admin_credentials": {
            "email": "admin@apollometro.com",
            "password": "Password@123",
        },
        "sample_patients": [
            {"name": p.name, "phone": p.phone, "notes": p.notes}
            for p in created_patients
        ],
    }


async def main():
    """CLI execution entrypoint."""
    if AsyncSessionLocal is None:
        print("Error: AsyncSessionLocal is None. Check PostgreSQL connection.")
        return
    async with AsyncSessionLocal() as db:
        result = await seed_data(db, force=True)
        print("\n" + "=" * 60)
        print("SEEDING SUMMARY")
        print("=" * 60)
        for k, v in result.items():
            print(f"{k}: {v}")
        print("=" * 60 + "\n")


if __name__ == "__main__":
    asyncio.run(main())
