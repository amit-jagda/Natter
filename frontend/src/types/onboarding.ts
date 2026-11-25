/**
 * TypeScript Type Definitions for Hospital Onboarding & Doctor Management.
 */

export interface OperatingHoursItem {
  day_of_week: number; // 0=Mon ... 6=Sun
  open_time: string | null; // "09:00"
  close_time: string | null; // "20:00"
  is_closed: boolean;
}

export interface HospitalAddress {
  street?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
}

export interface TenantData {
  id: string;
  name: string;
  slug: string;
  phone_number?: string | null;
  emergency_contact?: string | null;
  address?: HospitalAddress;
  timezone: string;
  onboarding_status: "IN_PROGRESS" | "COMPLETED";
  onboarding_step?: number;
  operating_hours: OperatingHoursItem[];
  created_at: string;
  updated_at: string;
}

export interface UserData {
  id: string;
  tenant_id: string;
  email: string;
  full_name: string;
  role: "admin" | "doctor" | "receptionist" | "operator" | "manager" | "viewer";
  status: "active" | "invited" | "inactive" | "suspended";
  is_active: boolean;
}

export interface AuthResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  user: UserData;
  tenant: TenantData;
}

export interface HospitalRegisterPayload {
  hospital_name: string;
  slug?: string;
  admin_name: string;
  admin_email: string;
  password: string;
}

export interface HospitalProfilePayload {
  phone_number?: string;
  emergency_contact?: string;
  address?: HospitalAddress;
  timezone?: string;
  operating_hours?: OperatingHoursItem[];
}

export interface DoctorAvailabilityItem {
  day_of_week: number;
  start_time: string; // "10:00"
  end_time: string; // "14:00"
  is_available: boolean;
}

export interface DoctorItem {
  id: string;
  tenant_id: string;
  user_id: string;
  full_name: string;
  email: string;
  specialization: string;
  department?: string | null;
  slot_duration_minutes: number;
  consultation_fee?: number | null;
  is_active: boolean;
  status: string;
  availabilities: DoctorAvailabilityItem[];
  created_at: string;
  updated_at: string;
}

export interface DoctorCreatePayload {
  full_name: string;
  email: string;
  specialization: string;
  department?: string;
  slot_duration_minutes: number;
  consultation_fee?: number;
  availabilities?: DoctorAvailabilityItem[];
}

export interface OnboardingStatusResponse {
  onboarding_status: "IN_PROGRESS" | "COMPLETED";
  onboarding_step?: number;
  hospital_name: string;
  hospital_id: string;
  profile_complete: boolean;
  operating_hours_configured: boolean;
  doctors_count: number;
}

export interface PatientItem {
  id: string;
  tenant_id: string;
  name: string;
  phone: string;
  date: string;
  email?: string | null;
  gender?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PatientCreatePayload {
  name: string;
  phone: string;
  date: string;
  email?: string | null;
  gender?: string | null;
  notes?: string | null;
}

export interface PatientPatchPayload {
  name?: string;
  phone?: string | null;
  email?: string | null;
  date?: string;
  gender?: string | null;
  notes?: string | null;
}

export interface PatientListResponse {
  patients: PatientItem[];
  total: number;
}

export interface PatientImportResponse {
  imported: number;
  failed: number;
  errors: string[];
  patients: PatientItem[];
}
