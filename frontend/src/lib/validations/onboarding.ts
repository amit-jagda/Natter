import { z } from "zod";

/**
 * Validates 'HH:MM' 24-hour time string and checks if start < end.
 */
export const timeStringRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const operatingHourSchema = z
  .object({
    day_of_week: z.number().int().min(0).max(6),
    open_time: z.string().regex(timeStringRegex, "Invalid time format (HH:MM)").nullable(),
    close_time: z.string().regex(timeStringRegex, "Invalid time format (HH:MM)").nullable(),
    is_closed: z.boolean(),
  })
  .refine(
    (data) => {
      if (data.is_closed) return true;
      if (!data.open_time || !data.close_time) return false;
      return data.open_time < data.close_time;
    },
    {
      message: "Opening time must be earlier than closing time",
      path: ["close_time"],
    }
  );

export const hospitalRegisterSchema = z.object({
  hospital_name: z
    .string()
    .trim()
    .min(1, "Hospital name is required")
    .min(2, "Hospital name must be at least 2 characters")
    .max(120, "Hospital name cannot exceed 120 characters"),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+$/, "Slug may only contain lowercase letters, numbers, and hyphens")
    .optional()
    .or(z.literal("")),
  admin_name: z
    .string()
    .trim()
    .min(1, "Administrator name is required")
    .min(2, "Admin full name must be at least 2 characters")
    .max(120, "Admin name cannot exceed 120 characters"),
  admin_email: z
    .string()
    .trim()
    .min(1, "Admin email address is required")
    .email("Please provide a valid email address")
    .toLowerCase(),
  password: z
    .string()
    .min(1, "Password is required")
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter (A-Z)")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter (a-z)")
    .regex(/[0-9]/, "Password must contain at least one number (0-9)"),
});

export const hospitalProfileSchema = z.object({
  phone_number: z
    .string()
    .trim()
    .regex(/^[+]?[0-9\s-]{10,15}$/, "Please enter a valid phone number (10-15 digits)")
    .optional()
    .or(z.literal("")),
  emergency_contact: z
    .string()
    .trim()
    .min(3, "Emergency contact must be at least 3 digits")
    .max(32, "Emergency contact cannot exceed 32 characters")
    .optional()
    .or(z.literal("")),
  address: z
    .object({
      street: z.string().trim().optional(),
      city: z.string().trim().optional(),
      state: z.string().trim().optional(),
      postal_code: z
        .string()
        .trim()
        .regex(/^[0-9]{4,10}$/, "Invalid postal code format")
        .optional()
        .or(z.literal("")),
    })
    .optional(),
  timezone: z.string().default("Asia/Kolkata"),
  operating_hours: z.array(operatingHourSchema).optional(),
});

export const doctorAvailabilitySchema = z
  .object({
    day_of_week: z.number().int().min(0).max(6),
    start_time: z.string().regex(timeStringRegex, "Invalid shift start time (HH:MM)"),
    end_time: z.string().regex(timeStringRegex, "Invalid shift end time (HH:MM)"),
    is_available: z.boolean().default(true),
  })
  .refine((slot) => slot.start_time < slot.end_time, {
    message: "Shift start time must be before end time",
    path: ["end_time"],
  });

export const doctorCreateSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(2, "Doctor name must be at least 2 characters")
    .max(120, "Doctor name cannot exceed 120 characters"),
  email: z
    .string()
    .trim()
    .email("Please enter a valid doctor email address")
    .toLowerCase(),
  specialization: z
    .string()
    .trim()
    .min(2, "Specialization must be at least 2 characters")
    .max(120, "Specialization cannot exceed 120 characters"),
  department: z.string().trim().max(120).optional().or(z.literal("")),
  slot_duration_minutes: z
    .number()
    .int("Slot duration must be an integer")
    .min(5, "Minimum slot duration is 5 minutes")
    .max(180, "Maximum slot duration is 180 minutes"),
  consultation_fee: z
    .number()
    .min(0, "Consultation fee cannot be negative")
    .optional(),
  availabilities: z.array(doctorAvailabilitySchema).default([]),
});

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email address is required")
    .email("Please enter a valid email address")
    .toLowerCase(),
  password: z.string().min(1, "Password is required"),
});

export type HospitalRegisterInput = z.infer<typeof hospitalRegisterSchema>;
export type HospitalProfileInput = z.infer<typeof hospitalProfileSchema>;
export type DoctorCreateInput = z.infer<typeof doctorCreateSchema>;
export type DoctorAvailabilityInput = z.infer<typeof doctorAvailabilitySchema>;
export type LoginInput = z.infer<typeof loginSchema>;

