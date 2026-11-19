import { describe, it, expect } from "vitest";
import {
  hospitalRegisterSchema,
  hospitalProfileSchema,
  doctorCreateSchema,
  doctorAvailabilitySchema,
  operatingHourSchema,
  loginSchema,
} from "@/lib/validations/onboarding";

describe("Frontend Zod Validation Suite", () => {
  describe("Hospital Registration Schema", () => {
    it("should pass with valid registration data", () => {
      const validData = {
        hospital_name: "Apollo Care Center",
        slug: "apollo-care",
        admin_name: "Dr. Rajesh Sharma",
        admin_email: "rajesh@apollocare.org",
        password: "SecurePassword123!",
      };
      const result = hospitalRegisterSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it("should fail when hospital name is too short", () => {
      const invalidData = {
        hospital_name: "A",
        admin_name: "Dr. Rajesh",
        admin_email: "rajesh@apollocare.org",
        password: "Password123!",
      };
      const result = hospitalRegisterSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("at least 2 characters");
      }
    });

    it("should fail with invalid email address", () => {
      const invalidData = {
        hospital_name: "Valid Hospital",
        admin_name: "Admin Name",
        admin_email: "not-an-email",
        password: "Password123!",
      };
      const result = hospitalRegisterSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("valid email");
      }
    });

    it("should fail with weak password (missing numbers)", () => {
      const invalidData = {
        hospital_name: "Valid Hospital",
        admin_name: "Admin Name",
        admin_email: "admin@hospital.com",
        password: "NoNumbersPassword!",
      };
      const result = hospitalRegisterSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("at least one number");
      }
    });
  });

  describe("Hospital Profile & Operating Hours Schema", () => {
    it("should pass with valid profile and hours", () => {
      const validData = {
        phone_number: "+91 98765 43210",
        emergency_contact: "102",
        address: { city: "Mumbai", state: "Maharashtra", postal_code: "400001" },
        operating_hours: [
          { day_of_week: 0, open_time: "09:00", close_time: "20:00", is_closed: false },
          { day_of_week: 6, open_time: null, close_time: null, is_closed: true },
        ],
      };
      const result = hospitalProfileSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it("should fail when open_time is after close_time", () => {
      const invalidHour = {
        day_of_week: 1,
        open_time: "18:00",
        close_time: "09:00",
        is_closed: false,
      };
      const result = operatingHourSchema.safeParse(invalidHour);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("earlier than closing time");
      }
    });
  });

  describe("Doctor & Availability Schema", () => {
    it("should pass with valid doctor and availability shifts", () => {
      const validDoctor = {
        full_name: "Dr. Anita Desai",
        email: "anita.desai@hospital.com",
        specialization: "Cardiology",
        slot_duration_minutes: 30,
        consultation_fee: 750,
        availabilities: [
          { day_of_week: 0, start_time: "10:00", end_time: "14:00", is_available: true },
        ],
      };
      const result = doctorCreateSchema.safeParse(validDoctor);
      expect(result.success).toBe(true);
    });

    it("should fail when shift start_time is greater than or equal to end_time", () => {
      const invalidShift = {
        day_of_week: 0,
        start_time: "15:00",
        end_time: "11:00",
        is_available: true,
      };
      const result = doctorAvailabilitySchema.safeParse(invalidShift);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("start time must be before end time");
      }
    });

    it("should fail when slot duration is below 5 minutes", () => {
      const invalidDoctor = {
        full_name: "Dr. Anita Desai",
        email: "anita@hospital.com",
        specialization: "Cardiology",
        slot_duration_minutes: 2, // invalid
      };
      const result = doctorCreateSchema.safeParse(invalidDoctor);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("Minimum slot duration is 5");
      }
    });
  });

  describe("Login Schema", () => {
    it("should pass with valid email and password", () => {
      const valid = {
        email: "admin@hospital.com",
        password: "SecretPassword123",
      };
      const result = loginSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("should fail when email format is invalid", () => {
      const invalid = {
        email: "not-an-email",
        password: "SecretPassword123",
      };
      const result = loginSchema.safeParse(invalid);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("valid email address");
      }
    });

    it("should fail when password is blank", () => {
      const invalid = {
        email: "admin@hospital.com",
        password: "",
      };
      const result = loginSchema.safeParse(invalid);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("Password is required");
      }
    });
  });
});
