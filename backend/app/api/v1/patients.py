"""Patients API Router.

Provides complete CRUDL, Excel import/export, and sample template downloading for patient records.
Enforces role boundaries:
- Operators have GET-only access (can list, view, export, and download templates).
- Admins have full access including creation, PATCH partial updates, deletions, and Excel bulk imports.
"""

import csv
import io
import re
import uuid
from datetime import date, datetime
from typing import List, Optional

import openpyxl
from fastapi import APIRouter, Depends, File, Query, Response, UploadFile, status
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    get_current_tenant,
    get_current_user,
    require_write_permission,
)
from app.core.exceptions import BadRequestException, ConflictException, NotFoundException
from app.database.session import get_db
from app.models.patient import Patient
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.patient import (
    PatientCreate,
    PatientImportResponse,
    PatientListResponse,
    PatientPatch,
    PatientRead,
)

router = APIRouter(prefix="/patients", tags=["Patient Details & Records"])

EMAIL_REGEX = re.compile(r"^[\w\.-]+@[\w\.-]+\.\w+$")


def format_date_value(val: object) -> str:
    """Normalize date object or string into YYYY-MM-DD representation."""
    if isinstance(val, (datetime, date)):
        return val.strftime("%Y-%m-%d")
    val_str = str(val).strip()
    # Try parsing common date string formats
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y", "%Y/%m/%d"):
        try:
            parsed = datetime.strptime(val_str, fmt)
            return parsed.strftime("%Y-%m-%d")
        except ValueError:
            pass
    return val_str


@router.get(
    "/sample-template",
    summary="Download sample Excel template (.xlsx) for patient bulk import (GET - Allowed for all roles)",
)
async def download_sample_template(
    format: str = Query("xlsx", pattern="^(xlsx|csv)$"),
) -> Response:
    """Provides a standardized sample file with pre-populated rows and column headers.

    Headers: name, phone (required), email (optional), date (required), gender, notes
    """
    sample_rows = [
        ["Aarav Sharma", "9876543210", "aarav.sharma@example.com", "2026-11-25", "Male", "Routine quarterly checkup"],
        ["Priya Patel", "9812345678", "", "2026-11-26", "Female", "Follow-up consultation for blood pressure"],
        ["Rohan Gupta", "9988776655", "rohan.gupta@example.com", "2026-11-27", "Male", "New patient dental intake"],
    ]

    headers_list = ["name", "phone", "email", "date", "gender", "notes"]

    if format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(headers_list)
        writer.writerows(sample_rows)
        csv_bytes = output.getvalue().encode("utf-8")
        return Response(
            content=csv_bytes,
            media_type="text/csv",
            headers={
                "Content-Disposition": 'attachment; filename="sample_patient_import_template.csv"',
                "Access-Control-Expose-Headers": "Content-Disposition",
                "Cache-Control": "no-cache",
            },
        )

    # Generate styled Excel (.xlsx) using openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Patients"

    ws.append(headers_list)

    # Style header row
    header_fill = PatternFill(start_color="7C3AED", end_color="7C3AED", fill_type="solid")
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    thin_border = Border(
        left=Side(style="thin", color="E2E8F0"),
        right=Side(style="thin", color="E2E8F0"),
        top=Side(style="thin", color="E2E8F0"),
        bottom=Side(style="thin", color="E2E8F0"),
    )

    for col_idx, _header in enumerate(headers_list, start=1):
        cell = ws.cell(row=1, column=col_idx)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")

    for row_data in sample_rows:
        ws.append(row_data)

    for row in ws.iter_rows(min_row=2, max_row=len(sample_rows) + 1, min_col=1, max_col=len(headers_list)):
        for cell in row:
            cell.border = thin_border
            cell.alignment = Alignment(vertical="center")

    # Auto-adjust column widths
    for col in ws.columns:
        max_len = max(len(str(cell.value or "")) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws.column_dimensions[col_letter].width = max(max_len + 4, 15)

    stream = io.BytesIO()
    wb.save(stream)
    stream.seek(0)

    return Response(
        content=stream.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": 'attachment; filename="sample_patient_import_template.xlsx"',
            "Access-Control-Expose-Headers": "Content-Disposition",
            "Cache-Control": "no-cache",
        },
    )


@router.get(
    "/export-excel",
    summary="Export all hospital patient records to Excel (.xlsx) (GET - Allowed for all roles)",
)
async def export_patients_excel(
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Exports all patients belonging to the current hospital tenant as an Excel workbook."""
    result = await db.execute(
        select(Patient)
        .where(Patient.tenant_id == tenant.id)
        .order_by(Patient.date.desc(), Patient.created_at.desc())
    )
    patients = list(result.scalars().all())

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Patients Directory"

    headers = ["Name", "Mobile Number", "Email", "Date", "Gender", "Notes", "Created At"]
    ws.append(headers)

    header_fill = PatternFill(start_color="6D28D9", end_color="6D28D9", fill_type="solid")
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    thin_border = Border(
        left=Side(style="thin", color="CBD5E1"),
        right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="CBD5E1"),
        bottom=Side(style="thin", color="CBD5E1"),
    )

    for col_idx, _ in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")

    for p in patients:
        created_str = p.created_at.strftime("%Y-%m-%d %H:%M") if p.created_at else ""
        ws.append([p.name, p.phone, p.email or "", p.date, p.gender or "", p.notes or "", created_str])

    for row in ws.iter_rows(min_row=2, max_row=len(patients) + 1, min_col=1, max_col=len(headers)):
        for cell in row:
            cell.border = thin_border
            cell.alignment = Alignment(vertical="center")

    for col in ws.columns:
        max_len = max(len(str(cell.value or "")) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws.column_dimensions[col_letter].width = max(max_len + 4, 15)

    stream = io.BytesIO()
    wb.save(stream)
    stream.seek(0)

    filename = f"patients_export_{tenant.slug}_{datetime.now().strftime('%Y%m%d')}.xlsx"
    return Response(
        content=stream.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Access-Control-Expose-Headers": "Content-Disposition",
            "Cache-Control": "no-cache",
        },
    )


@router.post(
    "/import-excel",
    response_model=PatientImportResponse,
    summary="Bulk import patients from Excel (.xlsx) or CSV file (Admin Only)",
)
async def import_patients_from_file(
    file: UploadFile = File(...),
    tenant: Tenant = Depends(get_current_tenant),
    admin_user: User = Depends(require_write_permission),
    db: AsyncSession = Depends(get_db),
) -> PatientImportResponse:
    """Reads and validates patient records from an uploaded Excel (.xlsx) or CSV file.

    Requires columns: name, email, date. Optional columns: phone, gender, notes.
    """
    if not file.filename:
        raise BadRequestException("Uploaded file must have a valid filename.")

    filename_lower = file.filename.lower()
    if not (filename_lower.endswith(".xlsx") or filename_lower.endswith(".csv")):
        raise BadRequestException("Only Excel (.xlsx) or CSV (.csv) files are supported for import.")

    contents = await file.read()
    if not contents:
        raise BadRequestException("Uploaded file is empty.")

    raw_rows: List[dict] = []
    errors: List[str] = []

    if filename_lower.endswith(".xlsx"):
        try:
            wb = openpyxl.load_workbook(io.BytesIO(contents), data_only=True)
            ws = wb.active
            rows = list(ws.iter_rows(values_only=True))
            if not rows:
                raise BadRequestException("Excel sheet is empty.")

            header_row = [str(col).strip().lower() if col is not None else "" for col in rows[0]]

            # Map header columns
            col_map = {}
            for idx, h in enumerate(header_row):
                if h in ("name", "patient_name", "patient name", "full_name", "fullname"):
                    col_map["name"] = idx
                elif h in ("phone", "phone_number", "phone number", "mobile", "mobile_number", "mobile number", "contact", "contact_number", "contact no", "mobile no"):
                    col_map["phone"] = idx
                elif h in ("email", "email_address", "email address", "mail"):
                    col_map["email"] = idx
                elif h in ("date", "appointment_date", "appointment date", "reg_date", "registration_date"):
                    col_map["date"] = idx
                elif h in ("gender", "sex"):
                    col_map["gender"] = idx
                elif h in ("notes", "note", "remarks", "clinical_notes"):
                    col_map["notes"] = idx

            if "name" not in col_map or "phone" not in col_map or "date" not in col_map:
                raise BadRequestException(
                    "Excel file must include headers for 'name', 'phone' (mobile number), and 'date'. Found: " + ", ".join(header_row)
                )

            for r_idx, row in enumerate(rows[1:], start=2):
                if not any(row):
                    continue  # skip empty lines

                name_val = row[col_map["name"]] if col_map["name"] < len(row) else None
                phone_val = row[col_map["phone"]] if col_map["phone"] < len(row) else None
                email_val = row[col_map.get("email", -1)] if "email" in col_map and col_map["email"] < len(row) else None
                date_val = row[col_map["date"]] if col_map["date"] < len(row) else None
                gender_val = row[col_map.get("gender", -1)] if "gender" in col_map and col_map["gender"] < len(row) else None
                notes_val = row[col_map.get("notes", -1)] if "notes" in col_map and col_map["notes"] < len(row) else None

                raw_rows.append({
                    "row_num": r_idx,
                    "name": str(name_val).strip() if name_val is not None else "",
                    "phone": str(phone_val).strip() if phone_val is not None else "",
                    "email": str(email_val).strip().lower() if email_val is not None else "",
                    "date": format_date_value(date_val) if date_val is not None else "",
                    "gender": str(gender_val).strip() if gender_val is not None else None,
                    "notes": str(notes_val).strip() if notes_val is not None else None,
                })
        except Exception as exc:
            if isinstance(exc, BadRequestException):
                raise
            raise BadRequestException(f"Failed to parse Excel file: {str(exc)}") from exc

    else:
        # CSV parsing
        try:
            csv_text = contents.decode("utf-8-sig")
            reader = csv.DictReader(io.StringIO(csv_text))
            if not reader.fieldnames:
                raise BadRequestException("CSV header is missing.")

            # Normalize headers
            headers_map = {h.strip().lower(): h for h in reader.fieldnames if h}
            name_key = next((headers_map[k] for k in headers_map if k in ("name", "patient_name", "full_name")), None)
            phone_key = next((headers_map[k] for k in headers_map if k in ("phone", "phone_number", "phone number", "mobile", "mobile_number", "contact", "contact_number")), None)
            email_key = next((headers_map[k] for k in headers_map if k in ("email", "email_address", "mail")), None)
            date_key = next((headers_map[k] for k in headers_map if k in ("date", "appointment_date", "reg_date")), None)
            gender_key = next((headers_map[k] for k in headers_map if k in ("gender", "sex")), None)
            notes_key = next((headers_map[k] for k in headers_map if k in ("notes", "note", "remarks")), None)

            if not name_key or not phone_key or not date_key:
                raise BadRequestException("CSV must include columns for 'name', 'phone' (mobile number), and 'date'.")

            for r_idx, row in enumerate(reader, start=2):
                raw_rows.append({
                    "row_num": r_idx,
                    "name": row.get(name_key, "").strip(),
                    "phone": row.get(phone_key, "").strip() if phone_key and row.get(phone_key) else "",
                    "email": row.get(email_key, "").strip().lower() if email_key and row.get(email_key) else "",
                    "date": format_date_value(row.get(date_key, "")),
                    "gender": row.get(gender_key, "").strip() if gender_key and row.get(gender_key) else None,
                    "notes": row.get(notes_key, "").strip() if notes_key and row.get(notes_key) else None,
                })
        except Exception as exc:
            if isinstance(exc, BadRequestException):
                raise
            raise BadRequestException(f"Failed to parse CSV file: {str(exc)}") from exc

    # Fetch existing patient (name, phone) pairs for duplicate detection
    existing_res = await db.execute(
        select(func.lower(Patient.name), Patient.phone).where(Patient.tenant_id == tenant.id)
    )
    existing_pairs = set(existing_res.all())
    seen_in_batch = set()

    created_patients: List[Patient] = []

    for item in raw_rows:
        row_num = item["row_num"]
        name = item["name"]
        raw_phone = item["phone"]
        email = item["email"]
        date_str = item["date"]

        # Validate name
        if not name:
            errors.append(f"Row {row_num}: Patient name is required.")
            continue
        if len(name) > 120:
            errors.append(f"Row {row_num} ({name}): Patient name cannot exceed 120 characters.")
            continue

        # Validate mobile number (REQUIRED, digits only, 10-15 digits, no alphabets)
        if not raw_phone:
            errors.append(f"Row {row_num} ({name}): Mobile number is required.")
            continue

        if re.search(r"[a-zA-Z]", str(raw_phone)):
            errors.append(f"Row {row_num} ({name}): Mobile number '{raw_phone}' cannot contain alphabets. Only digits (0-9) allowed.")
            continue

        cleaned_phone = re.sub(r"[^\d]", "", str(raw_phone))
        if not cleaned_phone.isdigit() or len(cleaned_phone) < 10 or len(cleaned_phone) > 15:
            errors.append(f"Row {row_num} ({name}): Mobile number must be 10-15 digits. Got '{raw_phone}'.")
            continue

        # Duplicate detection (Name + Phone check within file and against database)
        pair = (name.lower(), cleaned_phone)
        if pair in seen_in_batch:
            errors.append(f"Row {row_num} ({name}): Duplicate entry within file - already appeared in a previous row.")
            continue
        if pair in existing_pairs:
            errors.append(f"Row {row_num} ({name}): Duplicate entry - Patient with this name and mobile already exists in records.")
            continue
        seen_in_batch.add(pair)

        # Validate date
        if not date_str:
            errors.append(f"Row {row_num}: Appointment/registration date is required for patient '{name}'.")
            continue

        # Validate email (OPTIONAL, but if present must be valid email format)
        clean_email = None
        if email:
            if not EMAIL_REGEX.match(email):
                errors.append(f"Row {row_num}: Invalid email address format '{email}' for patient '{name}'.")
                continue
            clean_email = email

        patient = Patient(
            tenant_id=tenant.id,
            name=name,
            phone=cleaned_phone,
            email=clean_email,
            date=date_str,
            gender=item["gender"] or None,
            notes=item["notes"] or None,
        )
        db.add(patient)
        created_patients.append(patient)

    if created_patients:
        await db.commit()
        for p in created_patients:
            await db.refresh(p)

    return PatientImportResponse(
        imported=len(created_patients),
        failed=len(errors),
        errors=errors,
        patients=[PatientRead.model_validate(p) for p in created_patients],
    )


@router.get(
    "",
    response_model=PatientListResponse,
    summary="List patients with filtering and pagination (GET - Allowed for all roles)",
)
async def list_patients(
    search: Optional[str] = Query(None, description="Search by patient name or email"),
    date_filter: Optional[str] = Query(None, alias="date", description="Filter by date (YYYY-MM-DD)"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PatientListResponse:
    """Fetch patients belonging to the current tenant hospital."""
    query = select(Patient).where(Patient.tenant_id == tenant.id)

    if search:
        search_term = f"%{search.strip()}%"
        query = query.where(
            or_(
                Patient.name.ilike(search_term),
                Patient.phone.ilike(search_term),
                Patient.email.ilike(search_term),
            )
        )

    if date_filter:
        query = query.where(Patient.date == date_filter.strip())

    query = query.order_by(Patient.date.desc(), Patient.created_at.desc())

    # Total count
    all_res = await db.execute(query)
    all_patients = list(all_res.scalars().all())
    total = len(all_patients)

    paginated = all_patients[offset : offset + limit]
    return PatientListResponse(
        patients=[PatientRead.model_validate(p) for p in paginated],
        total=total,
    )


@router.post(
    "",
    response_model=PatientRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new patient record via Form (Admin Only)",
)
async def create_patient(
    payload: PatientCreate,
    tenant: Tenant = Depends(get_current_tenant),
    admin_user: User = Depends(require_write_permission),
    db: AsyncSession = Depends(get_db),
) -> PatientRead:
    """Creates an individual patient record via form with duplicate detection."""
    clean_name = payload.name.strip()
    clean_phone = payload.phone.strip()

    # Duplicate check on Name + Mobile for this hospital
    existing = await db.execute(
        select(Patient).where(
            Patient.tenant_id == tenant.id,
            func.lower(Patient.name) == clean_name.lower(),
            Patient.phone == clean_phone,
        )
    )
    if existing.scalar_one_or_none():
        raise ConflictException(
            f"Patient with name '{clean_name}' and mobile number '{clean_phone}' already exists."
        )

    patient = Patient(
        tenant_id=tenant.id,
        name=clean_name,
        phone=clean_phone,
        email=payload.email.lower().strip() if payload.email else None,
        date=format_date_value(payload.date),
        gender=payload.gender.strip() if payload.gender else None,
        notes=payload.notes.strip() if payload.notes else None,
    )
    db.add(patient)
    await db.commit()
    await db.refresh(patient)
    return PatientRead.model_validate(patient)


@router.get(
    "/{patient_id}",
    response_model=PatientRead,
    summary="Get patient details by ID (GET - Allowed for all roles)",
)
async def get_patient(
    patient_id: uuid.UUID,
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PatientRead:
    """Fetch a single patient."""
    result = await db.execute(
        select(Patient).where(Patient.id == patient_id, Patient.tenant_id == tenant.id)
    )
    patient = result.scalar_one_or_none()
    if not patient:
        raise NotFoundException("Patient record not found.")
    return PatientRead.model_validate(patient)


@router.patch(
    "/{patient_id}",
    response_model=PatientRead,
    summary="Partially update patient details using PATCH (Admin Only)",
)
async def patch_patient(
    patient_id: uuid.UUID,
    payload: PatientPatch,
    tenant: Tenant = Depends(get_current_tenant),
    admin_user: User = Depends(require_write_permission),
    db: AsyncSession = Depends(get_db),
) -> PatientRead:
    """Partially update patient details using the PATCH method.

    Only provided fields are modified.
    """
    result = await db.execute(
        select(Patient).where(Patient.id == patient_id, Patient.tenant_id == tenant.id)
    )
    patient = result.scalar_one_or_none()
    if not patient:
        raise NotFoundException("Patient record not found.")

    if payload.name is not None:
        patient.name = payload.name.strip()
    if payload.phone is not None:
        patient.phone = payload.phone.strip()
    if payload.email is not None:
        patient.email = payload.email.lower().strip() if payload.email else None
    if payload.date is not None:
        patient.date = format_date_value(payload.date)
    if payload.gender is not None:
        patient.gender = payload.gender.strip() if payload.gender else None
    if payload.notes is not None:
        patient.notes = payload.notes.strip() if payload.notes else None

    await db.commit()
    await db.refresh(patient)
    return PatientRead.model_validate(patient)


@router.delete(
    "/{patient_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a patient record (Admin Only)",
)
async def delete_patient(
    patient_id: uuid.UUID,
    tenant: Tenant = Depends(get_current_tenant),
    admin_user: User = Depends(require_write_permission),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Permanently delete a patient record."""
    result = await db.execute(
        select(Patient).where(Patient.id == patient_id, Patient.tenant_id == tenant.id)
    )
    patient = result.scalar_one_or_none()
    if not patient:
        raise NotFoundException("Patient record not found.")

    await db.delete(patient)
    await db.commit()
