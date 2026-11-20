import React, { useState, useMemo } from "react";
import {
  Phone,
  MapPin,
  Clock,
  ArrowRight,
  Loader2,
  AlertCircle,
  Calendar,
  Sparkles,
  Moon,
  CheckCircle2,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import {
  HospitalProfilePayload,
  OperatingHoursItem,
  TenantData,
} from "@/types/onboarding";
import { hospitalProfileSchema } from "@/lib/validations/onboarding";

const DAYS_OF_WEEK = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

interface Props {
  tenant: TenantData;
  onSuccess: (updatedTenant: TenantData) => void;
  onSkip: () => void;
  onBack?: () => void;
}

export const Step2Profile: React.FC<Props> = ({ tenant, onSuccess, onSkip, onBack }) => {
  const [phoneNumber, setPhoneNumber] = useState(tenant.phone_number || "+91 98765 43210");
  const [emergencyContact, setEmergencyContact] = useState(tenant.emergency_contact || "102");
  const [address, setAddress] = useState({
    street: tenant.address?.street || "",
    city: tenant.address?.city || "",
    state: tenant.address?.state || "",
    postal_code: tenant.address?.postal_code || "",
  });
  const [timezone, setTimezone] = useState(tenant.timezone || "Asia/Kolkata");

  const [operatingHours, setOperatingHours] = useState<OperatingHoursItem[]>(() => {
    if (tenant.operating_hours && tenant.operating_hours.length === 7) {
      return tenant.operating_hours;
    }
    return [0, 1, 2, 3, 4, 5, 6].map((day) => ({
      day_of_week: day,
      open_time: day === 6 ? null : "09:00",
      close_time: day === 6 ? null : "20:00",
      is_closed: day === 6,
    }));
  });

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const todayDayIndex = (new Date().getDay() + 6) % 7;

  const handleToggleOperatingDay = (dayOfWeek: number) => {
    setOperatingHours((prev) =>
      prev.map((h) => {
        if (h.day_of_week === dayOfWeek) {
          const nextClosed = !h.is_closed;
          return {
            ...h,
            is_closed: nextClosed,
            open_time: nextClosed ? null : h.open_time || "09:00",
            close_time: nextClosed ? null : h.close_time || "20:00",
          };
        }
        return h;
      })
    );
  };

  const handleUpdateOperatingTime = (
    dayOfWeek: number,
    field: "open_time" | "close_time",
    val: string
  ) => {
    setOperatingHours((prev) =>
      prev.map((h) => {
        if (h.day_of_week === dayOfWeek) {
          return { ...h, [field]: val };
        }
        return h;
      })
    );
  };

  const applyStandardPreset = () => {
    setOperatingHours((prev) =>
      prev.map((h) => ({
        ...h,
        is_closed: h.day_of_week === 6,
        open_time: h.day_of_week === 6 ? null : "09:00",
        close_time: h.day_of_week === 6 ? null : "20:00",
      }))
    );
    showToast("Standard Preset (Mon–Sat 9a–8p, Sun Off) applied");
  };

  const applyAllWeekPreset = () => {
    setOperatingHours((prev) =>
      prev.map((h) => ({
        ...h,
        is_closed: false,
        open_time: "09:00",
        close_time: "20:00",
      }))
    );
    showToast("All 7 days marked Open (9am–8pm)");
  };

  const handleDiscardChanges = () => {
    setPhoneNumber(tenant.phone_number || "+91 98765 43210");
    setEmergencyContact(tenant.emergency_contact || "102");
    setAddress({
      street: tenant.address?.street || "",
      city: tenant.address?.city || "",
      state: tenant.address?.state || "",
      postal_code: tenant.address?.postal_code || "",
    });
    setTimezone(tenant.timezone || "Asia/Kolkata");
    if (tenant.operating_hours && tenant.operating_hours.length === 7) {
      setOperatingHours(tenant.operating_hours);
    } else {
      setOperatingHours([0, 1, 2, 3, 4, 5, 6].map((day) => ({
        day_of_week: day,
        open_time: day === 6 ? null : "09:00",
        close_time: day === 6 ? null : "20:00",
        is_closed: day === 6,
      })));
    }
    showToast("Changes discarded");
  };

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

  const activeDaysCount = operatingHours.filter((h) => !h.is_closed).length;
  const totalWeeklyOperatingHours = useMemo(() => {
    let totalMin = 0;
    operatingHours.forEach((h) => {
      if (!h.is_closed && h.open_time && h.close_time) {
        const [h1, m1] = h.open_time.split(":").map(Number);
        const [h2, m2] = h.close_time.split(":").map(Number);
        let diff = h2 * 60 + m2 - (h1 * 60 + m1);
        if (diff <= 0) diff += 24 * 60;
        totalMin += diff;
      }
    });
    return Math.floor(totalMin / 60);
  }, [operatingHours]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setFieldErrors({});

    const rawPayload: HospitalProfilePayload = {
      phone_number: phoneNumber.trim() || undefined,
      emergency_contact: emergencyContact.trim() || undefined,
      address,
      timezone,
      operating_hours: operatingHours.map((h) => ({
        day_of_week: h.day_of_week,
        open_time: h.is_closed ? null : h.open_time ? h.open_time.slice(0, 5) : null,
        close_time: h.is_closed ? null : h.close_time ? h.close_time.slice(0, 5) : null,
        is_closed: h.is_closed,
      })),
    };

    const validationResult = hospitalProfileSchema.safeParse(rawPayload);
    if (!validationResult.success) {
      const errors: Record<string, string> = {};
      validationResult.error.issues.forEach((err) => {
        const key = err.path.join(".");
        errors[key] = err.message;
      });
      setFieldErrors(errors);
      setIsLoading(false);
      return;
    }

    try {
      const updatedTenant = await apiClient.patch<TenantData>(
        "/api/v1/onboarding/hospital-profile",
        validationResult.data
      );
      onSuccess(updatedTenant);
    } catch (err: unknown) {
      console.error("Profile update error:", err);
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to update hospital profile.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto py-2 space-y-6">
      {/* Header Banner */}
      <div className="bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] rounded-2xl sm:rounded-3xl p-5 sm:px-6 sm:py-5 shadow-[0_4px_20px_-4px_rgba(21,15,38,0.06)] flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-['Bricolage_Grotesque',sans-serif] text-2xl sm:text-[28px] font-bold text-[#150f26] leading-tight">
            Hospital profile
          </h1>
          <p className="text-[13.5px] text-[#625b7e] mt-0.5">
            Contact lines, location and clinic operating hours
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onSkip}
            className="text-xs font-semibold text-[#625b7e] hover:text-[#150f26] transition-colors"
          >
            Skip for now &rarr;
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-3.5 text-xs text-red-700 font-semibold flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        {/* Top 2 Cards Row: Contact Lines & Clinic Location (Exact Image 3 Layout) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Card 1: Contact lines & portal */}
          <div className="p-6 rounded-[22px] bg-white border border-[#e6e0f5] shadow-xs space-y-4">
            <h3 className="font-['Bricolage_Grotesque',sans-serif] font-bold text-base text-[#150f26] flex items-center gap-2">
              <Phone className="h-4 w-4 text-[#7c3aed]" />
              <span>Contact lines &amp; portal</span>
            </h3>

            {/* Hospital Main Phone */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-[#625b7e] uppercase tracking-wider block">
                Hospital main phone
              </label>
              <div className="flex items-center gap-2.5 px-3.5 h-10 rounded-xl border border-[#e6e0f5] bg-[#f8f6fc]">
                <Phone className="h-4 w-4 text-[#625b7e]" />
                <input
                  type="tel"
                  inputMode="tel"
                  placeholder="+91 98765 43210"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value.replace(/[^0-9+\s-]/g, ""))}
                  className="flex-1 bg-transparent text-xs font-semibold text-[#150f26] focus:outline-none"
                />
              </div>
              {fieldErrors.phone_number && (
                <p className="text-[11px] text-red-600 font-medium">{fieldErrors.phone_number}</p>
              )}
            </div>

            {/* Emergency Helpline */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-[#625b7e] uppercase tracking-wider block">
                Emergency helpline
              </label>
              <div className="flex items-center gap-2.5 px-3.5 h-10 rounded-xl border border-[#e6e0f5] bg-[#f8f6fc]">
                <AlertCircle className="h-4 w-4 text-[#625b7e]" />
                <input
                  type="text"
                  inputMode="tel"
                  placeholder="102"
                  value={emergencyContact}
                  onChange={(e) => setEmergencyContact(e.target.value.replace(/[^0-9+\s-]/g, ""))}
                  className="flex-1 bg-transparent text-xs font-semibold text-[#150f26] focus:outline-none"
                />
              </div>
              {fieldErrors.emergency_contact && (
                <p className="text-[11px] text-red-600 font-medium">{fieldErrors.emergency_contact}</p>
              )}
            </div>
          </div>

          {/* Card 2: Clinic location & timezone */}
          <div className="p-6 rounded-[22px] bg-white border border-[#e6e0f5] shadow-xs space-y-4">
            <h3 className="font-['Bricolage_Grotesque',sans-serif] font-bold text-base text-[#150f26] flex items-center gap-2">
              <MapPin className="h-4 w-4 text-[#7c3aed]" />
              <span>Clinic location &amp; timezone</span>
            </h3>

            {/* Street Address */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-[#625b7e] uppercase tracking-wider block">
                Physical clinic address
              </label>
              <div className="flex items-center gap-2.5 px-3.5 h-10 rounded-xl border border-[#e6e0f5] bg-[#f8f6fc]">
                <MapPin className="h-4 w-4 text-[#625b7e]" />
                <input
                  type="text"
                  placeholder="Street address, wing, floor..."
                  value={address.street}
                  onChange={(e) => setAddress((prev) => ({ ...prev, street: e.target.value }))}
                  className="flex-1 bg-transparent text-xs font-medium text-[#150f26] focus:outline-none"
                />
              </div>
            </div>

            {/* City, State, PIN */}
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-[#625b7e] uppercase tracking-wider block">
                  City
                </label>
                <input
                  type="text"
                  placeholder="City"
                  value={address.city}
                  onChange={(e) => setAddress((prev) => ({ ...prev, city: e.target.value }))}
                  className="w-full h-10 px-3 rounded-xl border border-[#e6e0f5] bg-[#f8f6fc] text-xs font-medium text-[#150f26] focus:outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-[#625b7e] uppercase tracking-wider block">
                  State
                </label>
                <input
                  type="text"
                  placeholder="State"
                  value={address.state}
                  onChange={(e) => setAddress((prev) => ({ ...prev, state: e.target.value }))}
                  className="w-full h-10 px-3 rounded-xl border border-[#e6e0f5] bg-[#f8f6fc] text-xs font-medium text-[#150f26] focus:outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-[#625b7e] uppercase tracking-wider block">
                  Pin code
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="PIN"
                  value={address.postal_code}
                  onChange={(e) =>
                    setAddress((prev) => ({
                      ...prev,
                      postal_code: e.target.value.replace(/\D/g, "").slice(0, 6),
                    }))
                  }
                  className="w-full h-10 px-3 rounded-xl border border-[#e6e0f5] bg-[#f8f6fc] text-xs font-medium text-[#150f26] focus:outline-none"
                />
              </div>
            </div>

            {/* Timezone */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-[#625b7e] uppercase tracking-wider block">
                Regional schedule timezone
              </label>
              <div className="flex items-center gap-2.5 px-3.5 h-10 rounded-xl border border-[#e6e0f5] bg-[#f8f6fc]">
                <Clock className="h-4 w-4 text-[#625b7e]" />
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="flex-1 bg-transparent text-xs font-semibold text-[#150f26] focus:outline-none cursor-pointer"
                >
                  <option value="Asia/Kolkata">Asia/Kolkata (IST · UTC+5:30)</option>
                  <option value="Asia/Dubai">Asia/Dubai (GST · UTC+4:00)</option>
                  <option value="Europe/London">Europe/London (GMT/BST)</option>
                  <option value="America/New_York">America/New_York (EST · UTC-5)</option>
                  <option value="America/Los_Angeles">America/Los_Angeles (PST · UTC-8)</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Card: Weekly Operating Calendar (Exact 4+3 Grid Layout) */}
        <div className="p-6 rounded-[22px] bg-white border border-[#e6e0f5] shadow-xs space-y-6">
          {/* Calendar Toolbar */}
          <div className="flex items-center justify-between flex-wrap gap-4 pb-4 border-b border-[#e6e0f5]">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-purple-100 text-[#7c3aed]">
                  <Calendar className="h-4 w-4" />
                </div>
                <h3 className="font-['Bricolage_Grotesque',sans-serif] font-bold text-lg text-[#150f26]">
                  Weekly operating calendar
                </h3>
              </div>
              <p className="text-xs text-[#625b7e]">
                Calendar day boxes for scheduling doctor shifts and automated patient call windows.
              </p>
            </div>

            {/* Quick Presets */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={applyStandardPreset}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#e6e0f5] bg-[#f8f6fc] text-xs font-semibold text-[#150f26] hover:bg-purple-50 hover:text-[#7c3aed] transition-colors cursor-pointer"
              >
                <Sparkles className="h-3.5 w-3.5 text-[#7c3aed]" />
                <span>Mon-Sat (9a-8p)</span>
              </button>

              <button
                type="button"
                onClick={applyAllWeekPreset}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#e6e0f5] bg-[#f8f6fc] text-xs font-semibold text-[#150f26] hover:bg-purple-50 hover:text-[#7c3aed] transition-colors cursor-pointer"
              >
                <span>Open 7 days</span>
              </button>
            </div>
          </div>

          {/* 7 Big Calendar Day Boxes: 4 on Row 1, 3 on Row 2 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {operatingHours.map((h) => {
              const dayName = DAYS_OF_WEEK[h.day_of_week];
              const dayShort = dayName.slice(0, 3).toUpperCase();
              const isToday = h.day_of_week === todayDayIndex;
              const durationText = calculateDuration(h.open_time, h.close_time);

              return (
                <div
                  key={h.day_of_week}
                  className={`p-4 rounded-[20px] border transition-all flex flex-col justify-between min-h-[220px] relative overflow-hidden ${
                    !h.is_closed
                      ? "bg-white border-[#e6e0f5] shadow-xs hover:border-[#7c3aed]/50"
                      : "bg-[#faf8fe]/80 border-[#e6e0f5]"
                  }`}
                >
                  {/* Day Header: Short + Full + Switch */}
                  <div>
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-['Bricolage_Grotesque',sans-serif] font-bold text-sm tracking-wide text-[#7c3aed]">
                            {dayShort}
                          </span>
                          {isToday && (
                            <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-purple-100 text-[#7c3aed] border border-purple-200">
                              Today
                            </span>
                          )}
                        </div>
                        <span className="text-xs font-semibold text-[#150f26] block">
                          {dayName}
                        </span>
                      </div>

                      {/* iOS Style Switch */}
                      <button
                        type="button"
                        role="switch"
                        aria-checked={!h.is_closed}
                        onClick={() => handleToggleOperatingDay(h.day_of_week)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          !h.is_closed
                            ? "bg-gradient-to-r from-[#6d28d9] to-[#9333ea]"
                            : "bg-slate-200"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                            !h.is_closed ? "translate-x-4" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>

                    {/* Status Pill: Open 11 hrs OR Closed all day */}
                    <div className="flex items-center justify-between text-xs mb-3">
                      {!h.is_closed ? (
                        <>
                          <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-600">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            Open
                          </span>
                          <span className="text-[#625b7e] font-semibold text-xs">
                            {durationText}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs font-medium text-[#625b7e]">
                          Closed all day
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Middle: OPENS AT & CLOSES AT with Clock icon OR Rest Moon Graphic */}
                  {!h.is_closed ? (
                    <div className="space-y-2.5 my-1">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-[#625b7e] tracking-wider block mb-1">
                          Opens at
                        </span>
                        <input
                          type="time"
                          value={h.open_time ? h.open_time.slice(0, 5) : "09:00"}
                          onChange={(e) =>
                            handleUpdateOperatingTime(h.day_of_week, "open_time", e.target.value)
                          }
                          className="w-full h-9 px-3 rounded-xl border border-[#e6e0f5] bg-[#f8f6fc] text-xs font-semibold text-[#150f26] focus:outline-none focus:border-[#7c3aed] transition-colors cursor-pointer"
                        />
                      </div>

                      <div>
                        <span className="text-[10px] uppercase font-bold text-[#625b7e] tracking-wider block mb-1">
                          Closes at
                        </span>
                        <input
                          type="time"
                          value={h.close_time ? h.close_time.slice(0, 5) : "20:00"}
                          onChange={(e) =>
                            handleUpdateOperatingTime(h.day_of_week, "close_time", e.target.value)
                          }
                          className="w-full h-9 px-3 rounded-xl border border-[#e6e0f5] bg-[#f8f6fc] text-xs font-semibold text-[#150f26] focus:outline-none focus:border-[#7c3aed] transition-colors cursor-pointer"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="my-auto py-7 text-center flex flex-col items-center justify-center">
                      <Moon className="h-6 w-6 text-[#a29bc2]/60 stroke-1" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Calendar Footer: Summary & Actions (Exact Image 3 Layout) */}
          <div className="flex items-center justify-between flex-wrap gap-4 pt-4 border-t border-[#e6e0f5]">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#625b7e]">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>
                {activeDaysCount} days open &middot; {totalWeeklyOperatingHours} hrs / wk
              </span>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleDiscardChanges}
                className="px-5 py-2.5 rounded-xl border border-[#e6e0f5] bg-white hover:bg-[#f8f6fc] text-xs font-semibold text-[#150f26] transition-colors cursor-pointer"
              >
                Discard changes
              </button>

              {onBack && (
                <button
                  type="button"
                  onClick={onBack}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold text-[#625b7e] hover:text-[#150f26] transition-colors"
                >
                  &larr; Back
                </button>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#6d28d9] to-[#9333ea] text-white font-semibold text-xs shadow-md shadow-purple-600/30 hover:brightness-105 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Saving Profile...</span>
                  </>
                ) : (
                  <>
                    <span>Continue to doctors</span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </form>

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#150f26] text-white px-5 py-2.5 rounded-2xl font-semibold shadow-2xl text-xs sm:text-sm z-50 flex items-center gap-2 animate-bounce">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};
