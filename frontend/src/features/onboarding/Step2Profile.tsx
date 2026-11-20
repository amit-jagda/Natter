import React, { useState, useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Phone,
  PhoneCall,
  MapPin,
  Clock,
  ArrowRight,
  Loader2,
  Copy,
  AlertCircle,
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
  const phoneId = useId();
  const emergencyId = useId();
  const streetId = useId();
  const cityId = useId();
  const stateId = useId();
  const postalCodeId = useId();

  const [phoneNumber, setPhoneNumber] = useState(tenant.phone_number || "");
  const [emergencyContact, setEmergencyContact] = useState(tenant.emergency_contact || "");
  const [address, setAddress] = useState({
    street: tenant.address?.street || "",
    city: tenant.address?.city || "",
    state: tenant.address?.state || "",
    postal_code: tenant.address?.postal_code || "",
  });
  const [timezone] = useState(tenant.timezone || "Asia/Kolkata");

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

  const handleHourChange = (
    day: number,
    field: "open_time" | "close_time" | "is_closed",
    value: string | boolean | null
  ) => {
    setOperatingHours((prev) =>
      prev.map((item) => {
        if (item.day_of_week !== day) return item;
        if (field === "is_closed") {
          const isClosed = Boolean(value);
          return {
            ...item,
            is_closed: isClosed,
            open_time: isClosed ? null : item.open_time || "09:00",
            close_time: isClosed ? null : item.close_time || "20:00",
          };
        }
        return { ...item, [field]: value };
      })
    );
  };

  const copyMondayToWeekdays = () => {
    const monday = operatingHours.find((h) => h.day_of_week === 0);
    if (!monday) return;
    setOperatingHours((prev) =>
      prev.map((item) => {
        if (item.day_of_week >= 1 && item.day_of_week <= 4) {
          return {
            ...item,
            open_time: monday.open_time,
            close_time: monday.close_time,
            is_closed: monday.is_closed,
          };
        }
        return item;
      })
    );
  };

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
      operating_hours: operatingHours,
    };

    // Zod Validation
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
      const updatedTenant = await apiClient.put<TenantData>(
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
    <div className="w-full max-w-[520px] mx-auto py-2">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
        <div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 text-blue-600 font-semibold text-[12.5px] mb-3">
            ✦ Step 2 of 4 · Profile
          </span>
          <h2 className="text-[30px] sm:text-[32px] font-extrabold tracking-[-0.03em] text-slate-900 mt-2 mb-1.5 leading-tight">
            Tell us about your clinic
          </h2>
          <p className="text-slate-500 text-[14px] leading-relaxed">
            The voice agent uses this when it greets patients and routes incoming calls.
          </p>
        </div>
        <button
          type="button"
          onClick={onSkip}
          className="text-xs font-semibold text-slate-400 hover:text-slate-600 transition-colors self-start sm:self-auto"
        >
          Skip for now &rarr;
        </button>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-3.5 text-xs text-red-700 font-medium flex items-center gap-2 mb-4">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Contact Numbers */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div className="space-y-1.5">
            <Label htmlFor={phoneId} className="text-xs font-semibold text-slate-700">
              Hospital Main Phone
            </Label>
            <div className="relative">
              <Phone className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
              <Input
                id={phoneId}
                type="tel"
                placeholder="+91 98765 43210"
                className={`pl-10 h-11 text-xs rounded-xl ${
                  fieldErrors.phone_number ? "border-red-400" : ""
                }`}
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
              />
            </div>
            {fieldErrors.phone_number && (
              <p className="text-xs text-red-600 font-medium">{fieldErrors.phone_number}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={emergencyId} className="text-xs font-semibold text-slate-700">
              Emergency Helpline
            </Label>
            <div className="relative">
              <PhoneCall className="absolute left-3.5 top-3 h-4 w-4 text-red-500" />
              <Input
                id={emergencyId}
                type="tel"
                placeholder="102 or 011-26567890"
                className={`pl-10 h-11 text-xs rounded-xl ${
                  fieldErrors.emergency_contact ? "border-red-400" : ""
                }`}
                value={emergencyContact}
                onChange={(e) => setEmergencyContact(e.target.value)}
              />
            </div>
            {fieldErrors.emergency_contact && (
              <p className="text-xs text-red-600 font-medium">{fieldErrors.emergency_contact}</p>
            )}
          </div>
        </div>

        {/* Physical Address */}
        <div className="space-y-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700">
            <MapPin className="h-4 w-4 text-blue-600" /> Hospital Address (Optional)
          </div>

          <div className="space-y-2">
            <Input
              id={streetId}
              type="text"
              placeholder="Street Address, Building, Floor"
              className="h-10 text-xs rounded-lg bg-white"
              value={address.street}
              onChange={(e) => setAddress({ ...address, street: e.target.value })}
            />
            <div className="grid grid-cols-3 gap-2">
              <Input
                id={cityId}
                type="text"
                placeholder="City (e.g. Mumbai)"
                className="h-10 text-xs rounded-lg bg-white"
                value={address.city}
                onChange={(e) => setAddress({ ...address, city: e.target.value })}
              />
              <Input
                id={stateId}
                type="text"
                placeholder="State"
                className="h-10 text-xs rounded-lg bg-white"
                value={address.state}
                onChange={(e) => setAddress({ ...address, state: e.target.value })}
              />
              <Input
                id={postalCodeId}
                type="text"
                placeholder="PIN Code"
                className="h-10 text-xs rounded-lg bg-white"
                value={address.postal_code}
                onChange={(e) => setAddress({ ...address, postal_code: e.target.value })}
              />
            </div>
          </div>
        </div>

        <Separator />

        {/* 7-Day Operating Hours */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                <Clock className="h-4 w-4 text-blue-600" /> 7-Day Weekly Operating Hours
              </Label>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Appointments will only be offered within these operating windows.
              </p>
            </div>
            <button
              type="button"
              onClick={copyMondayToWeekdays}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors"
            >
              <Copy className="h-3 w-3" /> Copy Mon to Fri
            </button>
          </div>

          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
            {DAYS_OF_WEEK.map((dayName, idx) => {
              const item = operatingHours.find((h) => h.day_of_week === idx) || {
                day_of_week: idx,
                open_time: "09:00",
                close_time: "20:00",
                is_closed: false,
              };

              return (
                <div
                  key={idx}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between p-3 gap-3 transition-colors ${
                    item.is_closed ? "bg-slate-50/70 opacity-70" : "bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between sm:justify-start gap-3 w-36">
                    <span className="text-xs font-semibold text-slate-800">{dayName}</span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        item.is_closed
                          ? "bg-slate-200 text-slate-600"
                          : "bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      {item.is_closed ? "Closed" : "Open"}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    {!item.is_closed ? (
                      <div className="flex items-center gap-2">
                        <Input
                          type="time"
                          className="h-8 w-28 text-xs font-mono"
                          value={item.open_time || "09:00"}
                          onChange={(e) => handleHourChange(idx, "open_time", e.target.value)}
                        />
                        <span className="text-slate-400 text-xs">to</span>
                        <Input
                          type="time"
                          className="h-8 w-28 text-xs font-mono"
                          value={item.close_time || "20:00"}
                          onChange={(e) => handleHourChange(idx, "close_time", e.target.value)}
                        />
                      </div>
                    ) : (
                      <span className="text-xs italic text-slate-400 h-8 flex items-center">
                        Closed for appointments
                      </span>
                    )}

                    <div className="flex items-center gap-1.5 pl-2 border-l border-slate-100">
                      <Switch
                        checked={!item.is_closed}
                        onCheckedChange={(checked) => handleHourChange(idx, "is_closed", !checked)}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="pt-3 flex flex-col sm:flex-row items-center justify-between gap-3">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800"
            >
              &larr; Back to hospital
            </button>
          ) : (
            <button
              type="button"
              onClick={onSkip}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800"
            >
              Skip for now
            </button>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full sm:w-auto h-[48px] px-6 rounded-xl bg-gradient-to-r from-[#2563eb] to-[#4f46e5] text-white font-semibold text-[14px] flex items-center justify-center gap-2 shadow-[0_10px_24px_-8px_rgba(37,99,235,0.6)] hover:shadow-[0_16px_30px_-10px_rgba(37,99,235,0.7)] hover:-translate-y-0.5 active:translate-y-0 transition-all cursor-pointer disabled:opacity-50"
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
      </form>
    </div>
  );
};
