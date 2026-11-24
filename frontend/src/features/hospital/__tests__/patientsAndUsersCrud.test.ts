import { describe, it, expect, beforeEach, vi } from "vitest";
import { apiClient } from "@/lib/api-client";
import {
  PatientItem,
  PatientCreatePayload,
  PatientPatchPayload,
  PatientListResponse,
  PatientImportResponse,
} from "@/types/onboarding";
import { User, UserInvitePayload, UserInviteResponse } from "@/types/user";
import { patientFormSchema } from "@/features/hospital/components/PatientsTab";

// Mock localStorage for Vitest
const storage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, value: string) => {
    storage[key] = String(value);
  },
  removeItem: (key: string) => {
    delete storage[key];
  },
  clear: () => {
    Object.keys(storage).forEach((k) => delete storage[k]);
  },
  length: 0,
  key: () => null,
};

Object.defineProperty(globalThis, "localStorage", {
  value: mockLocalStorage,
  writable: true,
});

describe("Patient Details CRUDL & Excel Import/Export", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockLocalStorage.clear();
    apiClient.setToken("admin-jwt-token-xyz");
  });

  it("should fetch patient directory with search and date filters", async () => {
    const mockListResponse: PatientListResponse = {
      patients: [
        {
          id: "pat-1",
          tenant_id: "tenant-1",
          name: "Aarav Sharma",
          phone: "9876543210",
          email: "aarav@example.com",
          date: "2026-11-25",
          gender: "Male",
          notes: "Cardiac checkup",
          created_at: "2026-11-20T10:00:00Z",
          updated_at: "2026-11-20T10:00:00Z",
        },
      ],
      total: 1,
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockListResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await apiClient.get<PatientListResponse>("/api/v1/patients?search=Aarav");
    expect(result.patients).toHaveLength(1);
    expect(result.patients[0].name).toBe("Aarav Sharma");
    expect(result.patients[0].phone).toBe("9876543210");
    expect(result.patients[0].email).toBe("aarav@example.com");
    expect(result.patients[0].date).toBe("2026-11-25");
  });

  it("should validate patient form with Zod (phone required digits only, email optional)", () => {
    // Valid with phone & email
    const valid1 = patientFormSchema.safeParse({
      name: "Priya Patel",
      phone: "9812345678",
      date: "2026-11-26",
      email: "priya@example.com",
      gender: "Female",
    });
    expect(valid1.success).toBe(true);

    // Valid with phone and NO email (optional)
    const validNoEmail = patientFormSchema.safeParse({
      name: "Priya Patel",
      phone: "9812345678",
      date: "2026-11-26",
      email: "",
    });
    expect(validNoEmail.success).toBe(true);

    // Invalid: Phone contains alphabets
    const invalidPhoneAlphabets = patientFormSchema.safeParse({
      name: "Priya Patel",
      phone: "98123abcde",
      date: "2026-11-26",
    });
    expect(invalidPhoneAlphabets.success).toBe(false);

    // Invalid: Phone too short (<10 digits)
    const invalidPhoneShort = patientFormSchema.safeParse({
      name: "Priya Patel",
      phone: "12345",
      date: "2026-11-26",
    });
    expect(invalidPhoneShort.success).toBe(false);

    // Invalid: Missing required name
    const invalidMissingName = patientFormSchema.safeParse({
      name: "",
      phone: "9812345678",
      date: "2026-11-26",
    });
    expect(invalidMissingName.success).toBe(false);

    // Invalid: Bad email format
    const invalidEmail = patientFormSchema.safeParse({
      name: "Priya Patel",
      phone: "9812345678",
      date: "2026-11-26",
      email: "not-an-email",
    });
    expect(invalidEmail.success).toBe(false);
  });

  it("should create a new patient record via Form (POST)", async () => {
    const newPayload: PatientCreatePayload = {
      name: "Priya Patel",
      phone: "9812345678",
      date: "2026-11-26",
      email: "priya@example.com",
      gender: "Female",
      notes: "Follow-up consultation",
    };

    const createdPatient: PatientItem = {
      id: "pat-2",
      tenant_id: "tenant-1",
      ...newPayload,
      created_at: "2026-11-23T12:00:00Z",
      updated_at: "2026-11-23T12:00:00Z",
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(createdPatient), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await apiClient.post<PatientItem>("/api/v1/patients", newPayload);
    expect(result.id).toBe("pat-2");
    expect(result.name).toBe("Priya Patel");
    expect(result.phone).toBe("9812345678");

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/v1/patients");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual(newPayload);
  });

  it("should partially update a patient using PATCH method", async () => {
    const patchPayload: PatientPatchPayload = {
      phone: "9999988888",
      notes: "Updated blood pressure notes",
    };

    const patchedPatient: PatientItem = {
      id: "pat-1",
      tenant_id: "tenant-1",
      name: "Aarav Sharma",
      phone: "9999988888",
      email: "aarav@example.com",
      date: "2026-11-25",
      gender: "Male",
      notes: "Updated blood pressure notes",
      created_at: "2026-11-20T10:00:00Z",
      updated_at: "2026-11-23T12:30:00Z",
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(patchedPatient), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await apiClient.patch<PatientItem>("/api/v1/patients/pat-1", patchPayload);
    expect(result.phone).toBe("9999988888");
    expect(result.notes).toBe("Updated blood pressure notes");

    // Strictly ensure method is PATCH
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/v1/patients/pat-1");
    expect(init?.method).toBe("PATCH");
  });

  it("should delete a patient record (DELETE)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, {
        status: 204,
      })
    );

    await apiClient.delete("/api/v1/patients/pat-1");
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/v1/patients/pat-1");
    expect(init?.method).toBe("DELETE");
  });

  it("should download sample excel template as binary blob", async () => {
    const dummyBlob = new Blob(["sample-xlsx-binary-data"], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(dummyBlob, {
        status: 200,
        headers: {
          "Content-Disposition": 'attachment; filename="sample_patient_import_template.xlsx"',
        },
      })
    );

    const blob = await apiClient.downloadBlob("/api/v1/patients/sample-template?format=xlsx");
    expect(blob).toBeDefined();
    expect(blob.size).toBeGreaterThan(0);
  });

  it("should handle excel import file upload (POST multipart/form-data)", async () => {
    const mockImportResponse: PatientImportResponse = {
      imported: 3,
      failed: 0,
      errors: [],
      patients: [
        {
          id: "p-1",
          tenant_id: "t-1",
          name: "Aarav Sharma",
          phone: "9876543210",
          email: "aarav@example.com",
          date: "2026-11-25",
          created_at: "2026-11-23T00:00:00Z",
          updated_at: "2026-11-23T00:00:00Z",
        },
      ],
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockImportResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const formData = new FormData();
    const dummyFile = new File(["dummy excel content"], "patients.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    formData.append("file", dummyFile);

    const result = await apiClient.uploadForm<PatientImportResponse>(
      "/api/v1/patients/import-excel",
      formData
    );

    expect(result.imported).toBe(3);
    expect(result.failed).toBe(0);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/v1/patients/import-excel");
    expect(init?.method).toBe("POST");
  });
});

describe("User Allocation & Operator Read-Only Boundaries", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockLocalStorage.clear();
    apiClient.setToken("admin-token");
  });

  it("should list staff users belonging to the hospital organization", async () => {
    const mockUsers: User[] = [
      {
        id: "u-admin",
        tenant_id: "t-1",
        email: "admin@hospital.org",
        full_name: "Dr. Admin",
        role: "admin",
        status: "active",
        is_active: true,
        created_at: "2026-11-20T00:00:00Z",
        updated_at: "2026-11-20T00:00:00Z",
      },
      {
        id: "u-operator",
        tenant_id: "t-1",
        email: "staff@hospital.org",
        full_name: "Operator Staff",
        role: "operator",
        status: "active",
        is_active: true,
        created_at: "2026-11-22T00:00:00Z",
        updated_at: "2026-11-22T00:00:00Z",
      },
    ];

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockUsers), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const users = await apiClient.get<User[]>("/api/v1/users");
    expect(users).toHaveLength(2);
    expect(users[0].role).toBe("admin");
    expect(users[1].role).toBe("operator");
  });

  it("should invite a user with optional custom password and return credentials", async () => {
    const invitePayload: UserInvitePayload = {
      full_name: "Rahul Verma",
      email: "rahul@hospital.org",
      role: "operator",
      password: "CustomPassword#123",
    };

    const mockInviteResponse: UserInviteResponse = {
      user: {
        id: "u-new",
        tenant_id: "t-1",
        email: "rahul@hospital.org",
        full_name: "Rahul Verma",
        role: "operator",
        status: "active",
        is_active: true,
        created_at: "2026-11-23T12:00:00Z",
        updated_at: "2026-11-23T12:00:00Z",
      },
      temp_password: "CustomPassword#123",
      email_sent: false,
      message: "User created with role operator. Email dispatch is currently paused.",
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockInviteResponse), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await apiClient.post<UserInviteResponse>("/api/v1/users/invite", invitePayload);
    expect(result.user.role).toBe("operator");
    expect(result.temp_password).toBe("CustomPassword#123");
    expect(result.email_sent).toBe(false);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/v1/users/invite");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual(invitePayload);
  });

  it("should update user details and role using PATCH method", async () => {
    const updatePayload = {
      full_name: "Rahul Verma Senior",
      role: "admin",
      status: "active",
    };

    const mockUpdatedUser: User = {
      id: "u-new",
      tenant_id: "t-1",
      email: "rahul@hospital.org",
      full_name: "Rahul Verma Senior",
      role: "admin",
      status: "active",
      is_active: true,
      created_at: "2026-11-23T12:00:00Z",
      updated_at: "2026-11-23T12:45:00Z",
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockUpdatedUser), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await apiClient.patch<User>("/api/v1/users/u-new", updatePayload);
    expect(result.full_name).toBe("Rahul Verma Senior");
    expect(result.role).toBe("admin");

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/v1/users/u-new");
    expect(init?.method).toBe("PATCH");
  });

  it("should delete an allocated user (DELETE)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, {
        status: 204,
      })
    );

    await apiClient.delete("/api/v1/users/u-new");
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/v1/users/u-new");
    expect(init?.method).toBe("DELETE");
  });

  it("should reject write operations (POST/PATCH/DELETE) when performed by an Operator (403 Forbidden)", async () => {
    // When an operator token attempts a mutating POST/PATCH/DELETE
    apiClient.setToken("operator-token");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: 403,
            message: "Access denied: Operators have read-only permissions. Create, update, and delete actions are reserved for Admins.",
          },
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }
      )
    );

    await expect(
      apiClient.post("/api/v1/patients", { name: "Test", email: "test@test.com", date: "2026-11-25" })
    ).rejects.toThrow("Access denied: Operators have read-only permissions");
  });
});
