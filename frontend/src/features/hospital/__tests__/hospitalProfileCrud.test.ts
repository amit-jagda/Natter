import { describe, it, expect, beforeEach, vi } from "vitest";
import { apiClient } from "@/lib/api-client";
import {
  TenantData,
  OperatingHoursItem,
  HospitalProfilePayload,
} from "@/types/onboarding";

// Mock localStorage for Vitest environment
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

const mockDefaultOperatingHours: OperatingHoursItem[] = [
  { day_of_week: 0, open_time: "09:00", close_time: "20:00", is_closed: false },
  { day_of_week: 1, open_time: "09:00", close_time: "20:00", is_closed: false },
  { day_of_week: 2, open_time: "09:00", close_time: "20:00", is_closed: false },
  { day_of_week: 3, open_time: "09:00", close_time: "20:00", is_closed: false },
  { day_of_week: 4, open_time: "09:00", close_time: "20:00", is_closed: false },
  { day_of_week: 5, open_time: "09:00", close_time: "20:00", is_closed: false },
  { day_of_week: 6, open_time: null, close_time: null, is_closed: true },
];

const mockTenant: TenantData = {
  id: "tenant-uuid-101",
  name: "Apex Multi-Speciality Hospital",
  slug: "apex-hospital",
  phone_number: "+91 98765 43210",
  emergency_contact: "102",
  address: {
    street: "Plot 42, Health City, Sector 5",
    city: "New Delhi",
    state: "Delhi",
    postal_code: "110001",
  },
  timezone: "Asia/Kolkata",
  onboarding_status: "COMPLETED",
  operating_hours: mockDefaultOperatingHours,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("Hospital Profile CRUD & Operating Calendar", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe("Profile Read Operations (GET)", () => {
    it("fetches hospital profile and operating hours via /api/v1/onboarding/hospital-profile", async () => {
      apiClient.setToken("valid-jwt-token");

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockTenant), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const result = await apiClient.get<TenantData>("/api/v1/onboarding/hospital-profile");

      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/v1/onboarding/hospital-profile",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer valid-jwt-token",
          }),
        })
      );

      expect(result.id).toBe("tenant-uuid-101");
      expect(result.name).toBe("Apex Multi-Speciality Hospital");
      expect(result.phone_number).toBe("+91 98765 43210");
      expect(result.emergency_contact).toBe("102");
      expect(result.address?.city).toBe("New Delhi");
      expect(result.timezone).toBe("Asia/Kolkata");
      expect(result.operating_hours).toHaveLength(7);
      expect(result.operating_hours[6].is_closed).toBe(true);
    });

    it("fetches tenant profile via /api/v1/tenants/me fallback", async () => {
      apiClient.setToken("valid-jwt-token");

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockTenant), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const result = await apiClient.get<TenantData>("/api/v1/tenants/me");
      expect(result.slug).toBe("apex-hospital");
      expect(result.timezone).toBe("Asia/Kolkata");
    });
  });

  describe("Profile Update Operations (PUT)", () => {
    it("updates hospital profile and operating hours atomically", async () => {
      apiClient.setToken("valid-jwt-token");

      const updatedPayload: HospitalProfilePayload = {
        phone_number: "+91 91234 56789",
        emergency_contact: "011-26567890",
        address: {
          street: "Block B, AIIMS Road",
          city: "New Delhi",
          state: "Delhi",
          postal_code: "110029",
        },
        timezone: "Asia/Dubai",
        operating_hours: mockDefaultOperatingHours.map((h) =>
          h.day_of_week === 6
            ? { ...h, is_closed: false, open_time: "10:00", close_time: "16:00" }
            : h
        ),
      };

      const updatedResponse: TenantData = {
        ...mockTenant,
        ...updatedPayload,
        operating_hours: updatedPayload.operating_hours!,
        updated_at: "2026-02-01T12:00:00Z",
      };

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(updatedResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const result = await apiClient.patch<TenantData>(
        "/api/v1/onboarding/hospital-profile",
        updatedPayload
      );

      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/v1/onboarding/hospital-profile",
        expect.objectContaining({
          method: "PATCH",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Authorization: "Bearer valid-jwt-token",
          }),
          body: JSON.stringify(updatedPayload),
        })
      );

      expect(result.phone_number).toBe("+91 91234 56789");
      expect(result.emergency_contact).toBe("011-26567890");
      expect(result.timezone).toBe("Asia/Dubai");
      expect(result.address?.postal_code).toBe("110029");
      expect(result.operating_hours[6].is_closed).toBe(false);
      expect(result.operating_hours[6].open_time).toBe("10:00");
    });

    it("handles fallback to separate /api/v1/tenants/me and operating-hours endpoints using PATCH", async () => {
      apiClient.setToken("valid-jwt-token");

      const profilePayload = {
        phone_number: "+91 99999 88888",
        emergency_contact: "108",
        address: { city: "Mumbai" },
        timezone: "Asia/Kolkata",
      };

      const hoursPayload = mockDefaultOperatingHours;

      const fetchSpy = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ...mockTenant, ...profilePayload }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(hoursPayload), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );

      const updatedProfile = await apiClient.patch<TenantData>("/api/v1/tenants/me", profilePayload);
      const updatedHours = await apiClient.patch<OperatingHoursItem[]>(
        "/api/v1/tenants/me/operating-hours",
        hoursPayload
      );

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(updatedProfile.phone_number).toBe("+91 99999 88888");
      expect(updatedHours).toHaveLength(7);
    });

    it("throws appropriate error when server rejects update with 422 Unprocessable Entity", async () => {
      apiClient.setToken("valid-jwt-token");

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            detail: "Opening time (21:00) must be earlier than closing time (09:00).",
          }),
          {
            status: 422,
            headers: { "Content-Type": "application/json" },
          }
        )
      );

      await expect(
        apiClient.patch("/api/v1/onboarding/hospital-profile", {
          operating_hours: [{ day_of_week: 0, open_time: "21:00", close_time: "09:00", is_closed: false }],
        })
      ).rejects.toThrow("Opening time (21:00) must be earlier than closing time (09:00).");
    });
  });

  describe("Calendar Preset & Duration Helper Logic", () => {
    const calculateDuration = (openTime: string | null, closeTime: string | null): string => {
      if (!openTime || !closeTime) return "0 hrs";
      const [h1, m1] = openTime.split(":").map(Number);
      const [h2, m2] = closeTime.split(":").map(Number);
      let diff = h2 * 60 + m2 - (h1 * 60 + m1);
      if (diff <= 0) diff += 24 * 60;
      const hours = Math.floor(diff / 60);
      const mins = diff % 60;
      if (mins === 0) return `${hours} hrs`;
      return `${hours}h ${mins}m`;
    };

    it("calculates shift durations accurately", () => {
      expect(calculateDuration("09:00", "20:00")).toBe("11 hrs");
      expect(calculateDuration("09:00", "17:00")).toBe("8 hrs");
      expect(calculateDuration("09:30", "18:00")).toBe("8h 30m");
      expect(calculateDuration("10:00", "10:45")).toBe("0h 45m");
      expect(calculateDuration(null, null)).toBe("0 hrs");
    });

    it("applies Mon-Fri (9-5) preset correctly", () => {
      const updated = mockDefaultOperatingHours.map((h) => ({
        ...h,
        is_closed: h.day_of_week >= 5,
        open_time: h.day_of_week < 5 ? "09:00" : null,
        close_time: h.day_of_week < 5 ? "17:00" : null,
      }));

      const activeDays = updated.filter((h) => !h.is_closed);
      expect(activeDays).toHaveLength(5);
      expect(updated[0].open_time).toBe("09:00");
      expect(updated[0].close_time).toBe("17:00");
      expect(updated[5].is_closed).toBe(true);
      expect(updated[6].is_closed).toBe(true);
    });

    it("applies Mon-Sat (9-8) preset correctly", () => {
      const updated = mockDefaultOperatingHours.map((h) => ({
        ...h,
        is_closed: h.day_of_week === 6,
        open_time: h.day_of_week < 6 ? "09:00" : null,
        close_time: h.day_of_week < 6 ? "20:00" : null,
      }));

      const activeDays = updated.filter((h) => !h.is_closed);
      expect(activeDays).toHaveLength(6);
      expect(updated[5].is_closed).toBe(false);
      expect(updated[6].is_closed).toBe(true);
    });

    it("applies All 7 Days preset correctly", () => {
      const updated = mockDefaultOperatingHours.map((h) => ({
        ...h,
        is_closed: false,
        open_time: "09:00",
        close_time: "20:00",
      }));

      const activeDays = updated.filter((h) => !h.is_closed);
      expect(activeDays).toHaveLength(7);
      expect(updated[6].is_closed).toBe(false);
    });

    it("applies Clear All preset correctly", () => {
      const updated = mockDefaultOperatingHours.map((h) => ({
        ...h,
        is_closed: true,
      }));

      const activeDays = updated.filter((h) => !h.is_closed);
      expect(activeDays).toHaveLength(0);
    });

    it("replicates Monday timings to Friday (Tue-Fri)", () => {
      const customMonHours: OperatingHoursItem[] = [
        { day_of_week: 0, open_time: "08:30", close_time: "19:30", is_closed: false },
        { day_of_week: 1, open_time: "09:00", close_time: "17:00", is_closed: false },
        { day_of_week: 2, open_time: "09:00", close_time: "17:00", is_closed: false },
        { day_of_week: 3, open_time: "09:00", close_time: "17:00", is_closed: false },
        { day_of_week: 4, open_time: "09:00", close_time: "17:00", is_closed: false },
        { day_of_week: 5, open_time: "10:00", close_time: "14:00", is_closed: false },
        { day_of_week: 6, open_time: null, close_time: null, is_closed: true },
      ];

      const mon = customMonHours[0];
      const copied = customMonHours.map((h) => {
        if (h.day_of_week >= 1 && h.day_of_week <= 4) {
          return {
            ...h,
            is_closed: mon.is_closed,
            open_time: mon.open_time,
            close_time: mon.close_time,
          };
        }
        return h;
      });

      expect(copied[1].open_time).toBe("08:30");
      expect(copied[1].close_time).toBe("19:30");
      expect(copied[4].open_time).toBe("08:30");
      expect(copied[4].close_time).toBe("19:30");
      // Saturday should remain untouched
      expect(copied[5].open_time).toBe("10:00");
    });
  });

  describe("Doctor Module Full CRUDL with PATCH verification", () => {
    const mockDoctor = {
      id: "doc-123",
      tenant_id: "tenant-123",
      user_id: "user-456",
      full_name: "Dr. Anita Sharma",
      email: "anita.sharma@hospital.org",
      specialization: "General Physician",
      department: "Internal Medicine",
      slot_duration_minutes: 15,
      consultation_fee: 500,
      is_active: true,
      status: "active",
      availabilities: [
        { day_of_week: 0, start_time: "09:00", end_time: "18:00", is_available: true },
        { day_of_week: 1, start_time: "09:00", end_time: "18:00", is_available: true },
        { day_of_week: 2, start_time: "09:00", end_time: "18:00", is_available: true },
        { day_of_week: 3, start_time: "09:00", end_time: "18:00", is_available: true },
        { day_of_week: 4, start_time: "09:00", end_time: "18:00", is_available: true },
        { day_of_week: 5, start_time: "09:00", end_time: "18:00", is_available: true },
      ],
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };

    it("1. [List] Fetches all active doctors via GET /api/v1/doctors", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify([mockDoctor]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const docs = await apiClient.get<typeof mockDoctor[]>("/api/v1/doctors");
      expect(fetchSpy).toHaveBeenCalledWith("/api/v1/doctors", expect.objectContaining({ method: "GET" }));
      expect(docs).toHaveLength(1);
      expect(docs[0].full_name).toBe("Dr. Anita Sharma");
      expect(docs[0].availabilities).toHaveLength(6);
    });

    it("2. [Create] Registers a new doctor via POST /api/v1/doctors", async () => {
      const newDocPayload = {
        full_name: "Dr. Rohan Mehta",
        email: "rohan.mehta@hospital.org",
        specialization: "Cardiology",
        consultation_fee: 800,
        slot_duration_minutes: 30,
        availabilities: [
          { day_of_week: 0, start_time: "10:00", end_time: "16:00", is_available: true },
        ],
      };

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ...mockDoctor, id: "doc-456", ...newDocPayload }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        )
      );

      const created = await apiClient.post<typeof mockDoctor>("/api/v1/doctors", newDocPayload);
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/v1/doctors",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(newDocPayload),
        })
      );
      expect(created.id).toBe("doc-456");
      expect(created.specialization).toBe("Cardiology");
      expect(created.consultation_fee).toBe(800);
    });

    it("3. [Read] Fetches single doctor profile via GET /api/v1/doctors/:id", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockDoctor), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const doc = await apiClient.get<typeof mockDoctor>("/api/v1/doctors/doc-123");
      expect(fetchSpy).toHaveBeenCalledWith("/api/v1/doctors/doc-123", expect.objectContaining({ method: "GET" }));
      expect(doc.id).toBe("doc-123");
    });

    it("4. [Update] Modifies physician fee, shifts & duration using PATCH /api/v1/doctors/:id", async () => {
      const patchPayload = {
        full_name: "Dr. Anita Sharma",
        specialization: "General Physician",
        consultation_fee: 600,
        slot_duration_minutes: 30,
        availabilities: [
          { day_of_week: 0, start_time: "09:00", end_time: "17:00", is_available: true },
        ],
      };

      const updatedDoctor = {
        ...mockDoctor,
        consultation_fee: 600,
        slot_duration_minutes: 30,
        availabilities: patchPayload.availabilities,
      };

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(updatedDoctor), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const result = await apiClient.patch<typeof mockDoctor>(
        "/api/v1/doctors/doc-123",
        patchPayload
      );

      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/v1/doctors/doc-123",
        expect.objectContaining({
          method: "PATCH",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
          body: JSON.stringify(patchPayload),
        })
      );
      expect(result.consultation_fee).toBe(600);
      expect(result.slot_duration_minutes).toBe(30);
      expect(result.availabilities).toHaveLength(1);
    });

    it("5. [Delete] Removes/deactivates doctor via DELETE /api/v1/doctors/:id", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(null, { status: 204 })
      );

      await apiClient.delete("/api/v1/doctors/doc-123");
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/v1/doctors/doc-123",
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });
});
