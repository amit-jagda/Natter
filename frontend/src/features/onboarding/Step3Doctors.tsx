import React, { useState, useEffect, useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Stethoscope,
  Plus,
  Trash2,
  Mail,
  Loader2,
  ArrowRight,
  DollarSign,
  User,
  X,
  AlertCircle,
  CheckCircle2,
  Calendar,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import {
  DoctorCreatePayload,
  DoctorItem,
  DoctorAvailabilityItem,
} from "@/types/onboarding";
import { doctorCreateSchema } from "@/lib/validations/onboarding";

const DAYS_SHORT = [
  { day: 0, label: "Mon" },
  { day: 1, label: "Tue" },
  { day: 2, label: "Wed" },
  { day: 3, label: "Thu" },
  { day: 4, label: "Fri" },
  { day: 5, label: "Sat" },
  { day: 6, label: "Sun" },
];

const SPECIALIZATIONS = [
  "General Physician",
  "Cardiologist",
  "Pediatrician",
  "Orthopedic Surgeon",
  "Dermatologist",
  "ENT Specialist",
  "Gynecologist",
  "Neurologist",
  "Dentist",
  "Psychiatrist",
  "Other",
];

const SLOT_DURATIONS = [15, 30, 45, 60];

interface Props {
  onSuccess: () => void;
  onSkip: () => void;
  onBack?: () => void;
}

export const Step3Doctors: React.FC<Props> = ({ onSuccess, onSkip, onBack }) => {
  const docNameId = useId();
  const docEmailId = useId();
  const docFeeId = useId();

  const [doctors, setDoctors] = useState<DoctorItem[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalFieldErrors, setModalFieldErrors] = useState<Record<string, string>>({});

  // Form State for new doctor
  const [docName, setDocName] = useState("");
  const [docEmail, setDocEmail] = useState("");
  const [docSpecialty, setDocSpecialty] = useState("General Physician");
  const [customSpecialty, setCustomSpecialty] = useState("");
  const [slotDuration, setSlotDuration] = useState<number>(30);
  const [consultationFee, setConsultationFee] = useState<string>("");

  // Default Mon-Fri 10:00 - 14:00 shifts
  const [selectedDays, setSelectedDays] = useState<Record<number, boolean>>({
    0: true,
    1: true,
    2: true,
    3: true,
    4: true,
    5: false,
    6: false,
  });
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("14:00");

  const loadDoctors = async () => {
    setIsLoadingList(true);
    try {
      const data = await apiClient.get<DoctorItem[]>("/api/v1/doctors");
      setDoctors(data);
    } catch (err) {
      console.error("Failed to load doctors:", err);
    } finally {
      setIsLoadingList(false);
    }
  };

  useEffect(() => {
    loadDoctors();
  }, []);

  const toggleDay = (day: number) => {
    setSelectedDays((prev) => ({
      ...prev,
      [day]: !prev[day],
    }));
  };

  const handleAddDoctor = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setModalFieldErrors({});

    const specialty = docSpecialty === "Other" ? customSpecialty.trim() : docSpecialty;

    const availabilities: DoctorAvailabilityItem[] = [];
    Object.entries(selectedDays).forEach(([dayStr, isSelected]) => {
      if (isSelected) {
        availabilities.push({
          day_of_week: parseInt(dayStr, 10),
          start_time: startTime,
          end_time: endTime,
          is_available: true,
        });
      }
    });

    const rawPayload: DoctorCreatePayload = {
      full_name: docName.trim(),
      email: docEmail.trim(),
      specialization: specialty,
      slot_duration_minutes: slotDuration,
      consultation_fee: consultationFee ? parseFloat(consultationFee) : undefined,
      availabilities,
    };

    // Zod Validation
    const validationResult = doctorCreateSchema.safeParse(rawPayload);
    if (!validationResult.success) {
      const errors: Record<string, string> = {};
      validationResult.error.issues.forEach((err) => {
        const key = err.path.join(".");
        errors[key] = err.message;
      });
      setModalFieldErrors(errors);
      return;
    }

    setIsSubmitting(true);
    try {
      const newDoc = await apiClient.post<DoctorItem>("/api/v1/doctors", validationResult.data);
      setDoctors((prev) => [newDoc, ...prev]);
      setShowModal(false);
      setDocName("");
      setDocEmail("");
      setConsultationFee("");
      setCustomSpecialty("");
      setModalFieldErrors({});
    } catch (err: unknown) {
      console.error("Add doctor error:", err);
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to invite doctor.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteDoctor = async (doctorId: string) => {
    if (!confirm("Are you sure you want to remove this doctor from the roster?")) return;
    try {
      await apiClient.delete(`/api/v1/doctors/${doctorId}`);
      setDoctors((prev) => prev.filter((d) => d.id !== doctorId));
    } catch (err) {
      console.error("Failed to delete doctor:", err);
      alert("Failed to remove doctor.");
    }
  };

  const handleFinish = async () => {
    setIsSubmitting(true);
    try {
      await apiClient.post("/api/v1/onboarding/complete");
      onSuccess();
    } catch (err) {
      console.error("Failed to complete onboarding:", err);
      onSuccess();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto py-2 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 text-blue-600 font-semibold text-[12.5px] mb-3">
            ✦ Step 3 of 4 · Medical Staff
          </span>
          <h2 className="text-[30px] sm:text-[32px] font-extrabold tracking-[-0.03em] text-slate-900 mt-2 mb-1.5 leading-tight">
            Build Medical Roster
          </h2>
          <p className="text-slate-500 text-[14px] leading-relaxed">
            Register physicians and consultation shifts. The Voice AI books patient appointments against these slots.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800"
            >
              &larr; Back
            </button>
          )}
          <button
            type="button"
            onClick={onSkip}
            className="text-xs font-semibold text-slate-400 hover:text-slate-600 transition-colors"
          >
            Skip for now &rarr;
          </button>
        </div>
      </div>

      {/* Action Bar */}
      <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 bg-slate-50 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700 font-bold text-sm">
            {doctors.length}
          </div>
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Active Medical Staff
            </span>
            <p className="text-xs text-slate-500">
              {doctors.length === 0 ? "No doctors added yet" : `${doctors.length} doctor(s) on active roster`}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setShowModal(true);
            setError(null);
            setModalFieldErrors({});
          }}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Doctor
        </button>
      </div>

      {/* Doctor Cards List */}
      {isLoadingList ? (
        <div className="flex items-center justify-center py-12 text-slate-400 gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
          <span className="text-sm">Loading medical staff...</span>
        </div>
      ) : doctors.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center bg-slate-50/50">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600 mb-3">
            <Stethoscope className="h-6 w-6" />
          </div>
          <h4 className="text-sm font-bold text-slate-800">No doctors on roster yet</h4>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 mb-4">
            Click &ldquo;Add Doctor&rdquo; above to register your first physician, or continue to finish onboarding and add staff later.
          </p>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 border border-slate-300 bg-white hover:bg-slate-50 transition-colors shadow-xs"
          >
            <Plus className="h-3.5 w-3.5 text-blue-600" /> Add First Doctor
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {doctors.map((doc) => (
            <div
              key={doc.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border border-slate-200 bg-white hover:border-slate-300 shadow-xs transition-all gap-3"
            >
              <div className="flex items-start gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-100 to-sky-100 text-blue-700 font-bold text-base shadow-xs">
                  {doc.full_name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-900">{doc.full_name}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-600">
                      {doc.specialization}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
                    <span className="flex items-center gap-1">
                      <Mail className="h-3 w-3" /> {doc.email}
                    </span>
                    {doc.consultation_fee && (
                      <span className="font-semibold text-slate-700">
                        ₹{doc.consultation_fee}
                      </span>
                    )}
                    <span className="text-[11px] text-slate-400">
                      {doc.slot_duration_minutes}m slots
                    </span>
                  </div>
                  {doc.availabilities && doc.availabilities.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {doc.availabilities.map((avail, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 rounded-md bg-slate-100 text-[10px] font-medium text-slate-600 flex items-center gap-1"
                        >
                          <Calendar className="h-2.5 w-2.5 text-slate-400" />
                          {DAYS_SHORT[avail.day_of_week]?.label || `D${avail.day_of_week}`}: {avail.start_time.slice(0, 5)} - {avail.end_time.slice(0, 5)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 self-end sm:self-center">
                <button
                  type="button"
                  onClick={() => handleDeleteDoctor(doc.id)}
                  className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  title="Remove Doctor"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Completion CTA */}
      <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="text-xs text-slate-500">
          {doctors.length > 0 ? (
            <span className="flex items-center gap-1.5 text-emerald-600 font-medium">
              <CheckCircle2 className="h-4 w-4" /> Ready to finalize voice agent setup
            </span>
          ) : (
            <span>You can add doctors anytime from the hospital dashboard.</span>
          )}
        </div>

        <button
          type="button"
          onClick={handleFinish}
          disabled={isSubmitting}
          className="w-full sm:w-auto h-[48px] px-6 rounded-xl bg-gradient-to-r from-[#2563eb] to-[#4f46e5] text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-[0_10px_24px_-8px_rgba(37,99,235,0.6)] hover:shadow-[0_16px_30px_-10px_rgba(37,99,235,0.7)] hover:-translate-y-0.5 active:translate-y-0 transition-all cursor-pointer disabled:opacity-50"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Finalizing...</span>
            </>
          ) : (
            <>
              <span>Complete Onboarding</span>
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </div>

      {/* Add Doctor Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                  <Stethoscope className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Invite Doctor to Roster</h3>
                  <p className="text-xs text-slate-500">Configure physician profile and weekly shifts</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2 font-medium">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleAddDoctor} className="space-y-4">
              {/* Doctor Name */}
              <div className="space-y-1.5">
                <Label htmlFor={docNameId} className="text-xs font-semibold text-slate-700">
                  Doctor Full Name *
                </Label>
                <div className="relative">
                  <User className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                  <Input
                    id={docNameId}
                    type="text"
                    required
                    placeholder="e.g. Dr. Ramesh Gupta"
                    className={`pl-10 h-10 text-xs rounded-xl ${
                      modalFieldErrors.full_name ? "border-red-400" : ""
                    }`}
                    value={docName}
                    onChange={(e) => setDocName(e.target.value)}
                  />
                </div>
                {modalFieldErrors.full_name && (
                  <p className="text-xs text-red-600 font-medium">{modalFieldErrors.full_name}</p>
                )}
              </div>

              {/* Doctor Email */}
              <div className="space-y-1.5">
                <Label htmlFor={docEmailId} className="text-xs font-semibold text-slate-700">
                  Email Address *
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                  <Input
                    id={docEmailId}
                    type="email"
                    required
                    placeholder="doctor@hospital.com"
                    className={`pl-10 h-10 text-xs rounded-xl ${
                      modalFieldErrors.email ? "border-red-400" : ""
                    }`}
                    value={docEmail}
                    onChange={(e) => setDocEmail(e.target.value)}
                  />
                </div>
                {modalFieldErrors.email && (
                  <p className="text-xs text-red-600 font-medium">{modalFieldErrors.email}</p>
                )}
              </div>

              {/* Specialization */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">
                  Medical Specialization *
                </Label>
                <select
                  className="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 shadow-xs"
                  value={docSpecialty}
                  onChange={(e) => setDocSpecialty(e.target.value)}
                >
                  {SPECIALIZATIONS.map((spec) => (
                    <option key={spec} value={spec}>
                      {spec}
                    </option>
                  ))}
                </select>

                {docSpecialty === "Other" && (
                  <Input
                    type="text"
                    required
                    placeholder="Enter specialty name"
                    className="mt-2 h-10 text-xs rounded-xl"
                    value={customSpecialty}
                    onChange={(e) => setCustomSpecialty(e.target.value)}
                  />
                )}
              </div>

              {/* Slot Duration & Consultation Fee */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">
                    Slot Duration
                  </Label>
                  <div className="grid grid-cols-4 gap-1">
                    {SLOT_DURATIONS.map((dur) => (
                      <button
                        type="button"
                        key={dur}
                        onClick={() => setSlotDuration(dur)}
                        className={`py-1.5 text-xs font-bold rounded-lg border transition-all ${
                          slotDuration === dur
                            ? "border-blue-600 bg-blue-600 text-white shadow-xs"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        {dur}m
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={docFeeId} className="text-xs font-semibold text-slate-700">
                    Fee (₹ Optional)
                  </Label>
                  <div className="relative">
                    <DollarSign className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                    <Input
                      id={docFeeId}
                      type="number"
                      min="0"
                      step="50"
                      placeholder="e.g. 500"
                      className="pl-8 h-10 text-xs rounded-xl"
                      value={consultationFee}
                      onChange={(e) => setConsultationFee(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <Separator />

              {/* Shift Timing Days */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">
                  Consultation Shift Days
                </Label>
                <div className="grid grid-cols-7 gap-1">
                  {DAYS_SHORT.map(({ day, label }) => {
                    const isSelected = !!selectedDays[day];
                    return (
                      <button
                        type="button"
                        key={day}
                        onClick={() => toggleDay(day)}
                        className={`py-2 text-xs font-bold rounded-lg border transition-all ${
                          isSelected
                            ? "border-blue-600 bg-blue-50 text-blue-600"
                            : "border-slate-200 bg-slate-50 text-slate-400 hover:border-slate-300"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Shift Hours */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[11px] text-slate-600">
                    Shift Start Time
                  </Label>
                  <Input
                    type="time"
                    className="h-9 text-xs rounded-lg"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-slate-600">
                    Shift End Time
                  </Label>
                  <Input
                    type="time"
                    className="h-9 text-xs rounded-lg"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-xl px-5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                      Saving...
                    </>
                  ) : (
                    "Save & Add to Roster"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
