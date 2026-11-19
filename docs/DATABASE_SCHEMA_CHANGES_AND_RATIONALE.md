# Database Schema Evolution & Architectural Rationale

## 1. Executive Summary

This document explains the transition of the **Natter AI Voice Platform** database schema from its initial generic multi-tenant structure (`0001_initial_tenants_and_users`) to the healthcare-grade clinical architecture (`0002_hospital_onboarding_and_doctors`).

The original schema only provided foundational authentication and basic tenant containers. To power autonomous voice agents capable of conducting real-time telephone appointments in Hindi, Hinglish, and English, the relational model was expanded to capture hospital operational boundaries, 7-day clinic operating hours, and physician availability rosters.

---

## 2. Initial Database Schema (Baseline: Migration 0001)

In the initial release, the database contained only **2 primary relational tables** (plus the Alembic migration tracker):

### A. `tenants` Table (Initial)
| Column | Type | Nullable | Description |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | No (PK) | Unique tenant identifier |
| `name` | `VARCHAR(120)` | No | Tenant organization name |
| `slug` | `VARCHAR(120)` | No (Unique) | URL-safe identifier for tenant routing |
| `is_active` | `BOOLEAN` | No | Soft-delete / active status flag |
| `settings` | `JSONB` | No | Unstructured JSON storage |
| `created_at` | `TIMESTAMPTZ` | No | Organization creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | No | Last update timestamp |

### B. `users` Table (Initial)
| Column | Type | Nullable | Description |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | No (PK) | Unique user identifier |
| `tenant_id` | `UUID` | No (FK) | Reference to `tenants.id` with `ON DELETE CASCADE` |
| `email` | `VARCHAR(255)` | No | User login email address |
| `hashed_password`| `VARCHAR(255)` | No | Bcrypt password hash |
| `full_name` | `VARCHAR(120)` | No | User's legal name |
| `role` | `VARCHAR(32)` | No | Role designation (`admin`, `operator`, etc.) |
| `status` | `VARCHAR(32)` | No | Account status (`active`, `suspended`, etc.) |
| `is_active` | `BOOLEAN` | No | Active account flag |
| `created_at` | `TIMESTAMPTZ` | No | Timestamp of registration |
| `updated_at` | `TIMESTAMPTZ` | No | Timestamp of last modification |

### Limitations of the Initial Schema
1. **No Hospital Identity**: No telephone lines, no emergency hotlines, and no geographic address fields.
2. **No Timezone Awareness**: Voice agents operating across India (`Asia/Kolkata`) or international clinics could not interpret local time accurately.
3. **No Onboarding Lifecycle**: If an administrator left midway during workspace creation, the system could not restore their incomplete step.
4. **No Medical Staff Abstraction**: Doctors could only exist as generic users without specialty, slot duration, or consultation fees.
5. **No Scheduling Capabilities**: The voice agent had zero visibility into whether the hospital was currently open or which doctors had open shifts on a given day.

---

## 3. Current Database Schema (Enhanced: Migration 0002)

To fulfill clinical requirements, the database was expanded into **6 tables** in PostgreSQL:

1. `alembic_version` (Alembic schema version tracker)
2. `tenants` (Updated with 6 new healthcare columns)
3. `users` (Updated with contact phone)
4. `hospital_operating_hours` (New Table)
5. `doctors` (New Table)
6. `doctor_availabilities` (New Table)

```
  +------------------+       1:N       +----------------------------+
  |     tenants      | <-------------> |  hospital_operating_hours  |
  +------------------+                 +----------------------------+
       ^          ^
       | 1:N      | 1:N
       v          v
  +---------+   +-------------------+  1:N   +-----------------------+
  |  users  |   |      doctors      | <----> | doctor_availabilities |
  +---------+   +-------------------+        +-----------------------+
       ^                  ^
       | 1:1 Link         |
       +------------------+
```

---

## 4. Detailed Changes & Schema Additions

### 1. Enhancements to `tenants` Table
Six clinical attributes were added to the `tenants` table:

| Added Column | Type | Default | Why it was Added |
| :--- | :--- | :--- | :--- |
| `phone_number` | `VARCHAR(32)` | `NULL` | Dedicated hospital contact line spoken by the Voice AI. |
| `emergency_contact` | `VARCHAR(32)` | `NULL` | Critical for triage; when a caller indicates acute emergency, the AI routes them here immediately. |
| `address` | `JSONB` | `'{}'::jsonb` | Structured JSON containing street, city, state, postal code for patient directions. |
| `timezone` | `VARCHAR(64)` | `'Asia/Kolkata'`| Guarantees accurate slot booking relative to the clinic's local wall clock. |
| `onboarding_status` | `VARCHAR(32)` | `'IN_PROGRESS'` | Tracks onboarding progress (`IN_PROGRESS`, `COMPLETED`, `PAUSED`). |
| `onboarding_step` | `INTEGER` | `1` | Stores the active step (1 to 4) so incomplete sessions resume seamlessly. |

### 2. Enhancements to `users` Table
| Added Column | Type | Default | Why it was Added |
| :--- | :--- | :--- | :--- |
| `phone_number` | `VARCHAR(32)` | `NULL` | Direct mobile number for physicians/administrators for SMS notifications and 2FA. |

### 3. New Table: `hospital_operating_hours`
Stores weekly operational hours per tenant for each day of the week (0 = Monday ... 6 = Sunday).

```sql
CREATE TABLE hospital_operating_hours (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL,          -- 0 = Monday, 6 = Sunday
    open_time TIME NULL,                   -- e.g. 09:00:00
    close_time TIME NULL,                  -- e.g. 20:00:00
    is_closed BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_hospital_hours_day UNIQUE (tenant_id, day_of_week)
);
```

#### Why it was Added:
- **Prevents Out-of-Hours Bookings**: Before querying doctor slots, the voice agent checks whether the clinic is open on that day.
- **Unique Constraint (`uq_hospital_hours_day`)**: Enforces that a single hospital cannot have duplicate or conflicting operating records for the same day of the week.

### 4. New Table: `doctors`
Represents verified medical professionals belonging to a hospital workspace.

```sql
CREATE TABLE doctors (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    specialization VARCHAR(120) NOT NULL,  -- e.g. Cardiologist, Pediatrician
    department VARCHAR(120) NULL,
    slot_duration_minutes INTEGER NOT NULL DEFAULT 30, -- 15, 30, 45, or 60 min
    consultation_fee NUMERIC(10, 2) NULL,  -- e.g. 500.00
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenant_doctor_user UNIQUE (tenant_id, user_id)
);
```

#### Why it was Added:
- **Entity Separation**: A physician is both a system user (credentials, JWT access) and a medical resource (specialization, fee, appointment duration).
- **Voice Agent Natural Language Routing**: Enables callers to say *"Mujhe General Physician se milna hai"* or *"Book with Dr. Sharma"*, allowing the AI to filter matching doctors.
- **Configurable Appointment Durations**: Automatically slices physician consultation windows into exact 15, 30, 45, or 60-minute appointment slots.

### 5. New Table: `doctor_availabilities`
Stores the active weekly working shifts for each physician.

```sql
CREATE TABLE doctor_availabilities (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL,          -- 0 = Monday, 6 = Sunday
    start_time TIME NOT NULL,              -- e.g. 10:00:00
    end_time TIME NOT NULL,                -- e.g. 14:00:00
    is_available BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### Why it was Added:
- **Multiple Shifts per Day**: A doctor can practice Morning (09:00 - 13:00) and Evening (17:00 - 20:00) shifts on the same day.
- **Double-Booking Elimination**: Appointment generation algorithms cross-reference booked slots against these time boundaries.

---

## 5. Architectural & Technical Rationale Summary

| Architectural Goal | How the Schema Solves It |
| :--- | :--- |
| **Strict Multi-Tenancy** | Every single child record (`hospital_operating_hours`, `doctors`, `doctor_availabilities`) carries an indexed `tenant_id` foreign key with cascade deletion. No cross-tenant data leaks are possible. |
| **Low-Latency Voice Responses** | Queries during phone calls (e.g. finding open slots) are indexed on `tenant_id`, `doctor_id`, and `specialization`, ensuring DB query execution times under 5ms. |
| **Stateful Onboarding Flow** | `onboarding_status` and `onboarding_step` columns in `tenants` allow multi-step client workflows to persist across page reloads or network disconnections. |
| **Relational Integrity** | Composite unique constraints (`uq_users_tenant_email`, `uq_hospital_hours_day`, `uq_tenant_doctor_user`) protect the platform from orphaned, duplicate, or corrupted scheduling records. |
