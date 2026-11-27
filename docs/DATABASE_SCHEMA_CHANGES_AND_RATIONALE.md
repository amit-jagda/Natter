# Database Schema Evolution & Architectural Rationale

## 1. Executive Summary

This document explains the evolution of the **Natter AI Voice Platform** database schema from its initial generic multi-tenant structure (`0001_initial_tenants_and_users`) to the healthcare-grade clinical architecture (`0002_hospital_onboarding_and_doctors`), followed by the schema refinement in (`0003_drop_phone_and_step`).

The original schema provided foundational authentication and basic tenant containers. To power autonomous voice agents capable of conducting real-time telephone appointments in Hindi, Hinglish, and English, the relational model was expanded to capture hospital operational boundaries, 7-day clinic operating hours, and physician availability rosters. Subsequently, Migration 0003 streamlined the schema by removing obsolete wizard progression steps and duplicate user contact fields, aligning database normalization with the single-form registration architecture.

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
3. **No Medical Staff Abstraction**: Doctors could only exist as generic users without specialty, slot duration, or consultation fees.
4. **No Scheduling Capabilities**: The voice agent had zero visibility into whether the hospital was currently open or which doctors had open shifts on a given day.

---

## 3. Current Database Schema (Active Head: Migration 0003)

The database consists of **6 tables** in PostgreSQL:

1. `alembic_version` (Alembic schema version tracker: `0003_drop_phone_and_step`)
2. `tenants` (Enhanced with clinical identity and timezone; wizard step column removed)
3. `users` (Clean authentication entity; phone number normalized out)
4. `hospital_operating_hours` (7-day operational boundary table)
5. `doctors` (Physician medical credentials and fee profiles)
6. `doctor_availabilities` (Weekly recurring consultation shifts)

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

## 4. Migration 0002: Clinical Expansion

In Migration `0002_hospital_and_doctors`, healthcare-specific entities were introduced:

### 1. Enhancements to `tenants` Table
| Added Column | Type | Default | Purpose |
| :--- | :--- | :--- | :--- |
| `phone_number` | `VARCHAR(32)` | `NULL` | Main hospital inquiry/reception line spoken by the Voice AI. |
| `emergency_contact` | `VARCHAR(32)` | `NULL` | Critical for triage; caller emergencies route here immediately. |
| `address` | `JSONB` | `'{}'::jsonb` | Structured JSON containing street, city, state, and postal code. |
| `timezone` | `VARCHAR(64)` | `'Asia/Kolkata'`| Guarantees accurate slot booking relative to clinic local wall clock. |
| `onboarding_status` | `VARCHAR(32)` | `'IN_PROGRESS'` | High-level status flag (`IN_PROGRESS`, `COMPLETED`). |

### 2. New Table: `hospital_operating_hours`
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

### 3. New Table: `doctors`
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

### 4. New Table: `doctor_availabilities`
Stores active recurring weekly consultation shifts for each physician.

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

---

## 5. Migration 0003: Schema Refinement & Normalization

**Revision ID:** `0003_drop_phone_and_step`  
**Down Revision:** `0002_hospital_and_doctors`  
**Execution Status:** Active `(head)`

### Changes Made:
```sql
-- 1. Drop personal phone from users table
ALTER TABLE users DROP COLUMN phone_number;

-- 2. Drop legacy wizard step tracker from tenants table
ALTER TABLE tenants DROP COLUMN onboarding_step;
```

### Architectural & Business Rationale:

1. **Alignment with Single-Step Registration Flow**:
   - The original schema included `tenants.onboarding_step` (integer 1..4) designed for a 4-step wizard canvas.
   - The user onboarding experience was refactored into a single streamlined registration screen (`/register`) that immediately provisions the workspace and redirects users directly to their complete Clinical Dashboard (`/hospital`).
   - Maintaining `onboarding_step` introduced dead state and unnecessary schema bloat; `onboarding_status` (`IN_PROGRESS` / `COMPLETED`) is sufficient for platform analytics.

2. **Elimination of Duplicate & Ambiguous Phone Fields**:
   - Migration 0002 inadvertently introduced `phone_number` on both `tenants` and `users`.
   - In a clinical voice AI system, phone numbers represent telephonic dispatch endpoints. The AI answers on the hospital's dedicated line (`tenants.phone_number`) and dispatches acute calls to (`tenants.emergency_contact`).
   - Personal phone numbers on `users` were unneeded for authentication (which is email/password + JWT driven) and created ambiguity over which phone number callers and SMS notifications should target.
   - Removing `users.phone_number` enforces strict database normalization and guarantees that telephony services reference the authoritative hospital tenant contact.

---

## 6. Architectural & Technical Rationale Summary

| Architectural Goal | How the Current Schema Solves It |
| :--- | :--- |
| **Strict Multi-Tenancy** | Every child record (`hospital_operating_hours`, `doctors`, `doctor_availabilities`) carries an indexed `tenant_id` foreign key with cascade deletion. No cross-tenant data leaks are possible. |
| **Clean Single-Form Registration** | Dropping `onboarding_step` and `users.phone_number` simplifies registration payloads and eliminates out-of-sync state during onboarding. |
| **Low-Latency Voice Responses** | Queries during inbound calls (e.g., checking hospital hours, finding doctor slots) are indexed on `tenant_id`, `doctor_id`, and `specialization`, ensuring DB execution under 5ms. |
| **Authoritative Telephony Contacts** | Hospital inbound lines (`phone_number`) and emergency dispatch lines (`emergency_contact`) live strictly on the `tenants` entity. |
| **Relational Integrity** | Composite unique constraints (`uq_users_tenant_email`, `uq_hospital_hours_day`, `uq_tenant_doctor_user`) protect the platform from duplicate, orphaned, or corrupted scheduling records. |
