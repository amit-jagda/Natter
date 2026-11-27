import React, { useState, useEffect, useMemo } from "react";
import {
  Stethoscope,
  Plus,
  Trash2,
  Edit3,
  Loader2,
  ArrowRight,
  User,
  X,
  AlertCircle,
  CheckCircle2,
  Clock,
  Search,
  IndianRupee,
  Check,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import {
  DoctorCreatePayload,
  DoctorItem,
  DoctorAvailabilityItem,
} from "@/types/onboarding";
import { CustomSelect } from "@/components/ui/CustomSelect";

const DAYS_OF_WEEK = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const COMMON_SPECIALTIES = [
  "General Physician",
  "Cardiology",
  "Pediatrics",
  "Orthopedics",
  "Dermatology",
  "ENT Specialist",
  "Gynecology",
  "Neurology",
  "Dentistry",
  "Psychiatry",
];

const QUICK_CONSULTATION_FEES = [300, 500, 800, 1000, 1500];
const SLOT_DURATIONS = [15, 30, 45, 60];

interface Props {
  onSuccess: () => void;
  onSkip: () => void;
  onBack?: () => void;
}

export const Step3Doctors: React.FC<Props> = ({ onSuccess, onSkip, onBack }) => {
  const [doctors, setDoctors] = useState<DoctorItem[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isFinishing, setIsFinishing] = useState(false);
  const [doctorSearchQuery, setDoctorSearchQuery] = useState("");
  const [selectedSpecialty, setSelectedSpecialty] = useState("");

  // Modal State
  const [showDoctorForm, setShowDoctorForm] = useState(false);
  const [editingDoctorId, setEditingDoctorId] = useState<string | null>(null);
  const [isSavingDoctor, setIsSavingDoctor] = useState(false);
  const [doctorFormError, setDoctorFormError] = useState<string | null>(null);
  const [doctorToDelete, setDoctorToDelete] = useState<{ id: string; full_name: string } | null>(null);
  const [isDeletingDoctor, setIsDeletingDoctor] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const [doctorFormData, setDoctorFormData] = useState<{
    full_name: string;
    specialization: string;
    consultation_fee: number;
    slot_duration: number;
    availabilities: {
      day_of_week: number;
      start_time: string;
      end_time: string;
      is_active: boolean;
    }[];
  }>({
    full_name: "",
    specialization: "General Physician",
    consultation_fee: 500,
    slot_duration: 15,
    availabilities: Array.from({ length: 7 }, (_, i) => ({
      day_of_week: i,
      start_time: "09:00",
      end_time: "18:00",
      is_active: i < 6,
    })),
  });

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

  const handleOpenAddDoctorModal = () => {
    setEditingDoctorId(null);
    setDoctorFormData({
      full_name: "",
      specialization: "General Physician",
      consultation_fee: 500,
      slot_duration: 15,
      availabilities: Array.from({ length: 7 }, (_, i) => ({
        day_of_week: i,
        start_time: "09:00",
        end_time: "18:00",
        is_active: i < 6,
      })),
    });
    setDoctorFormError(null);
    setShowDoctorForm(true);
  };

  const handleOpenEditDoctorModal = (doc: DoctorItem) => {
    setEditingDoctorId(doc.id);
    const existingAvailMap = new Map<number, DoctorAvailabilityItem>();
    if (doc.availabilities) {
      doc.availabilities.forEach((a) => existingAvailMap.set(a.day_of_week, a));
    }

    const availabilities = Array.from({ length: 7 }, (_, i) => {
      const existing = existingAvailMap.get(i);
      return {
        day_of_week: i,
        start_time: existing ? existing.start_time.slice(0, 5) : "09:00",
        end_time: existing ? existing.end_time.slice(0, 5) : "18:00",
        is_active: !!existing,
      };
    });

    setDoctorFormData({
      full_name: doc.full_name,
      specialization: doc.specialization,
      consultation_fee: doc.consultation_fee ?? 500,
      slot_duration: doc.slot_duration_minutes ?? 15,
      availabilities,
    });
    setDoctorFormError(null);
    setShowDoctorForm(true);
  };

  const handleCloseDoctorForm = () => {
    setShowDoctorForm(false);
    setEditingDoctorId(null);
    setDoctorFormError(null);
  };

  const applyDoctorShiftPreset = (preset: "weekdays" | "mon-sat" | "all-week" | "clear") => {
    setDoctorFormData((prev) => ({
      ...prev,
      availabilities: prev.availabilities.map((a) => {
        if (preset === "clear") {
          return { ...a, is_active: false };
        }
        if (preset === "weekdays") {
          return {
            ...a,
            is_active: a.day_of_week < 5,
            start_time: "09:00",
            end_time: "17:00",
          };
        }
        if (preset === "mon-sat") {
          return {
            ...a,
            is_active: a.day_of_week < 6,
            start_time: "09:00",
            end_time: "18:00",
          };
        }
        return {
          ...a,
          is_active: true,
          start_time: "09:00",
          end_time: "18:00",
        };
      }),
    }));
  };

  const calculateShiftMinutes = (start: string, end: string): number => {
    if (!start || !end) return 0;
    const [h1, m1] = start.split(":").map(Number);
    const [h2, m2] = end.split(":").map(Number);
    let diff = h2 * 60 + m2 - (h1 * 60 + m1);
    if (diff <= 0) diff += 24 * 60;
    return diff;
  };

  const calculateShiftHours = (start: string, end: string): string => {
    const diff = calculateShiftMinutes(start, end);
    if (diff === 0) return "0 hrs";
    const hours = Math.floor(diff / 60);
    const mins = diff % 60;
    if (mins === 0) return `${hours} hrs`;
    return `${hours}h ${mins}m`;
  };

  const totalDoctorWeeklyHours = useMemo(() => {
    let totalMin = 0;
    doctorFormData.availabilities.forEach((a) => {
      if (a.is_active && a.start_time && a.end_time) {
        totalMin += calculateShiftMinutes(a.start_time, a.end_time);
      }
    });
    const hours = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    if (mins === 0) return `${hours} hrs / wk`;
    return `${hours}h ${mins}m / wk`;
  }, [doctorFormData.availabilities]);

  const handleSaveDoctor = async () => {
    if (!doctorFormData.full_name.trim()) {
      setDoctorFormError("Please enter the doctor's full name (e.g., Dr. Anita Sharma).");
      return;
    }
    if (!doctorFormData.specialization.trim()) {
      setDoctorFormError("Please specify or select a medical specialization.");
      return;
    }

    setIsSavingDoctor(true);
    setDoctorFormError(null);

    const activeAvails: DoctorAvailabilityItem[] = doctorFormData.availabilities
      .filter((a) => a.is_active)
      .map((a) => ({
        day_of_week: a.day_of_week,
        start_time: a.start_time,
        end_time: a.end_time,
        is_available: true,
      }));

    const cleanEmail = `${doctorFormData.full_name.toLowerCase().replace(/[^a-z0-9]/g, "") || "doctor"}@hospital.org`;

    const payload: DoctorCreatePayload = {
      full_name: doctorFormData.full_name.trim(),
      email: cleanEmail,
      specialization: doctorFormData.specialization.trim(),
      consultation_fee: Number(doctorFormData.consultation_fee) || 0,
      slot_duration_minutes: Number(doctorFormData.slot_duration) || 15,
      availabilities: activeAvails,
    };

    try {
      if (editingDoctorId) {
        const updated = await apiClient.patch<DoctorItem>(
          `/api/v1/doctors/${editingDoctorId}`,
          payload
        );
        setDoctors((prev) => prev.map((d) => (d.id === editingDoctorId ? updated : d)));
        showToast("Physician details updated successfully");
      } else {
        const created = await apiClient.post<DoctorItem>("/api/v1/doctors", payload);
        setDoctors((prev) => [created, ...prev]);
        showToast("Doctor registered and added to roster");
      }
      handleCloseDoctorForm();
    } catch (err: unknown) {
      console.error("Save doctor error:", err);
      if (err instanceof Error) {
        setDoctorFormError(err.message);
      } else {
        setDoctorFormError("Failed to save physician to roster.");
      }
    } finally {
      setIsSavingDoctor(false);
    }
  };

  // Prompt custom delete confirmation modal
  const handlePromptDeleteDoctor = (doctorId: string, doctorName: string) => {
    setDoctorToDelete({ id: doctorId, full_name: doctorName });
  };

  // Confirm and execute doctor deletion
  const handleConfirmDeleteDoctor = async () => {
    if (!doctorToDelete) return;
    setIsDeletingDoctor(true);
    try {
      await apiClient.delete(`/api/v1/doctors/${doctorToDelete.id}`);
      setDoctors((prev) => prev.filter((d) => d.id !== doctorToDelete.id));
      showToast(`${doctorToDelete.full_name} removed from roster`);
      setDoctorToDelete(null);
    } catch (err) {
      console.error("Failed to delete doctor:", err);
      showToast("Failed to remove doctor.");
    } finally {
      setIsDeletingDoctor(false);
    }
  };

  const handleFinishOnboarding = async () => {
    setIsFinishing(true);
    try {
      await apiClient.post("/api/v1/onboarding/complete");
      onSuccess();
    } catch (err) {
      console.error("Failed to complete onboarding:", err);
      onSuccess();
    } finally {
      setIsFinishing(false);
    }
  };

  const uniqueSpecialties = Array.from(
    new Set(doctors.map((d) => d.specialization).filter(Boolean))
  );

  const filteredDoctors = doctors.filter((doc) => {
    const matchesSearch =
      doc.full_name.toLowerCase().includes(doctorSearchQuery.toLowerCase()) ||
      doc.specialization.toLowerCase().includes(doctorSearchQuery.toLowerCase());
    const matchesSpecialty =
      !selectedSpecialty || doc.specialization === selectedSpecialty;
    return matchesSearch && matchesSpecialty;
  });

  return (
    <div className="w-full max-w-4xl mx-auto py-2 space-y-6">
      {/* Header Banner */}
      <div className="bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] rounded-2xl sm:rounded-3xl p-5 sm:px-6 sm:py-5 shadow-[0_4px_20px_-4px_rgba(21,15,38,0.06)] flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-['Bricolage_Grotesque',sans-serif] text-2xl sm:text-[28px] font-bold text-[#150f26] leading-tight">
            Doctors and shifts
          </h1>
          <p className="text-[13.5px] text-[#625b7e] mt-0.5">
            Manage physicians, fees and weekly availability
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

      {/* Search & Filter Toolbar (Exact Image 1 Layout) */}
      <div className="p-4 sm:p-5 rounded-[22px] bg-white border border-[#e6e0f5] shadow-xs flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3 flex-1 min-w-[280px]">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-3 h-4 w-4 text-[#625b7e]" />
            <input
              type="text"
              placeholder="Search by physician name or specialty..."
              value={doctorSearchQuery}
              onChange={(e) => setDoctorSearchQuery(e.target.value)}
              className="w-full h-10 pl-10 pr-3.5 rounded-xl border border-[#e6e0f5] bg-[#f8f6fc] text-xs font-medium text-[#150f26] placeholder-[#625b7e]/60 focus:outline-none focus:border-[#7c3aed] transition-colors"
            />
          </div>

          {/* Specialty Dropdown */}
          <div className="w-56">
            <CustomSelect
              value={selectedSpecialty}
              onChange={setSelectedSpecialty}
              options={[
                { value: "", label: `All specialties (${doctors.length})` },
                ...uniqueSpecialties.map((s) => ({ value: s, label: s })),
              ]}
            />
          </div>
        </div>

        {/* Add Physician Primary Button */}
        <button
          type="button"
          onClick={handleOpenAddDoctorModal}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#6d28d9] to-[#9333ea] text-white font-semibold text-xs shadow-md shadow-purple-600/30 hover:brightness-105 active:scale-95 transition-all cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          <span>Add physician</span>
        </button>
      </div>

      {/* Doctors List or Empty State */}
      {isLoadingList ? (
        <div className="p-12 text-center text-[#625b7e] flex items-center justify-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-[#7c3aed]" />
          <span className="text-sm font-semibold">Loading physicians roster...</span>
        </div>
      ) : filteredDoctors.length === 0 ? (
        /* Empty State (Exact Image 2 Layout) */
        <div className="p-12 sm:p-14 text-center rounded-[24px] bg-white border border-[#e6e0f5] shadow-xs space-y-4 max-w-xl mx-auto my-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#6d28d9] to-[#9333ea] text-white grid place-items-center mx-auto shadow-lg shadow-purple-600/30">
            <Stethoscope className="h-7 w-7" />
          </div>
          <div className="space-y-1">
            <h2 className="font-['Bricolage_Grotesque',sans-serif] text-xl font-bold text-[#150f26]">
              No physicians yet
            </h2>
            <p className="text-xs text-[#625b7e] max-w-md mx-auto leading-relaxed">
              Add your first doctor so the voice agent can start booking patient appointments accurately.
            </p>
          </div>
          <div>
            <button
              type="button"
              onClick={handleOpenAddDoctorModal}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#6d28d9] to-[#9333ea] text-white font-semibold text-xs shadow-md shadow-purple-600/30 hover:brightness-105 active:scale-95 transition-all cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Add first doctor</span>
            </button>
          </div>
        </div>
      ) : (
        /* Doctors Data Table (Exact Image 1 Layout) */
        <div className="rounded-[22px] bg-white border border-[#e6e0f5] shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#e6e0f5] bg-[#faf8fe] text-[11px] font-bold text-[#625b7e] uppercase tracking-wider">
                  <th className="py-3.5 px-5">Physician</th>
                  <th className="py-3.5 px-4">Specialization</th>
                  <th className="py-3.5 px-4">Consultation Fee</th>
                  <th className="py-3.5 px-4">Slot Interval</th>
                  <th className="py-3.5 px-4">Weekly Schedule</th>
                  <th className="py-3.5 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e6e0f5] text-xs">
                {filteredDoctors.map((doc) => {
                  const activeDays = doc.availabilities?.filter((a) => a.is_available).length ?? 0;
                  const initial = doc.full_name.replace(/^Dr\.?\s*/i, "").charAt(0).toUpperCase() || "D";

                  return (
                    <tr key={doc.id} className="hover:bg-[#fcfaff] transition-colors group">
                      {/* 1. Physician Identity */}
                      <td className="py-4 px-5">
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#6d28d9] to-[#9333ea] text-white font-['Bricolage_Grotesque',sans-serif] font-bold text-sm grid place-items-center shrink-0 shadow-xs">
                              {initial}
                            </div>
                            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white" />
                          </div>
                          <div>
                            <span className="font-['Bricolage_Grotesque',sans-serif] font-bold text-sm text-[#150f26] block group-hover:text-[#7c3aed] transition-colors leading-tight">
                              {doc.full_name}
                            </span>
                            <span className="text-[11px] text-[#625b7e]">
                              {doc.email || "Active on roster"}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* 2. Specialization */}
                      <td className="py-4 px-4">
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-purple-50 text-[#7c3aed] border border-purple-200/60">
                          <Stethoscope className="h-3 w-3" />
                          <span>{doc.specialization}</span>
                        </span>
                      </td>

                      {/* 3. Consultation Fee */}
                      <td className="py-4 px-4">
                        <span className="font-bold text-sm text-[#150f26]">
                          ₹{doc.consultation_fee}
                        </span>
                      </td>

                      {/* 4. Slot Interval */}
                      <td className="py-4 px-4">
                        <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#f8f6fc] border border-[#e6e0f5] text-[#150f26]">
                          {doc.slot_duration_minutes || 15} mins
                        </span>
                      </td>

                      {/* 5. Weekly Schedule */}
                      <td className="py-4 px-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1">
                            {DAYS_OF_WEEK.map((dName, dayIdx) => {
                              const shift = doc.availabilities?.find((a) => a.day_of_week === dayIdx);
                              const hasShift = shift && shift.is_available;
                              return (
                                <span
                                  key={dayIdx}
                                  title={
                                    hasShift
                                      ? `${dName}: ${shift.start_time?.slice(0, 5)} - ${shift.end_time?.slice(0, 5)}`
                                      : `${dName}: Off duty`
                                  }
                                  className={`w-5 h-5 rounded text-[10px] font-bold grid place-items-center transition-all ${
                                    hasShift
                                      ? "bg-purple-100 text-[#7c3aed] font-extrabold"
                                      : "bg-slate-100 text-slate-400"
                                  }`}
                                >
                                  {dName.slice(0, 1)}
                                </span>
                              );
                            })}
                          </div>
                          <span className="text-[10px] text-[#625b7e] font-medium block">
                            {activeDays} {activeDays === 1 ? "day" : "days"} / wk
                          </span>
                        </div>
                      </td>

                      {/* 6. Actions */}
                      <td className="py-4 px-5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenEditDoctorModal(doc)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#e6e0f5] bg-[#f8f6fc] hover:bg-purple-50 hover:text-[#7c3aed] text-xs font-semibold text-[#150f26] transition-all cursor-pointer"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handlePromptDeleteDoctor(doc.id, doc.full_name)}
                            title="Delete physician"
                            className="p-1.5 rounded-xl text-[#625b7e] hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Table Footer */}
          <div className="px-5 py-3 border-t border-[#e6e0f5] bg-[#faf8fe] flex items-center justify-between text-xs text-[#625b7e]">
            <span>
              Total physicians: <b className="text-[#150f26]">{filteredDoctors.length}</b>
            </span>
            <button
              type="button"
              onClick={handleOpenAddDoctorModal}
              className="inline-flex items-center gap-1 text-xs font-bold text-[#7c3aed] hover:underline cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add another physician</span>
            </button>
          </div>
        </div>
      )}

      {/* Onboarding Bottom Stepper Actions */}
      <div className="flex items-center justify-between flex-wrap gap-4 pt-4 border-t border-[#e6e0f5]">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="px-4 py-2.5 rounded-xl text-xs font-semibold text-[#625b7e] hover:text-[#150f26] transition-colors"
          >
            &larr; Back to hospital profile
          </button>
        ) : (
          <button
            type="button"
            onClick={onSkip}
            className="px-4 py-2.5 rounded-xl text-xs font-semibold text-[#625b7e] hover:text-[#150f26] transition-colors"
          >
            Skip for now
          </button>
        )}

        <button
          type="button"
          disabled={isFinishing}
          onClick={handleFinishOnboarding}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#6d28d9] to-[#9333ea] text-white font-semibold text-xs shadow-md shadow-purple-600/30 hover:brightness-105 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
        >
          {isFinishing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Completing setup...</span>
            </>
          ) : (
            <>
              <span>Complete onboarding &amp; Launch</span>
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </div>

      {/* =========================================================================
          REGISTER PHYSICIAN MODAL POPUP (Exact Image 2 Layout)
          ========================================================================= */}
      {showDoctorForm && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-[#050a19]/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCloseDoctorForm();
          }}
        >
          <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col rounded-[24px] bg-white border border-[#e6e0f5] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.5)] overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-6 py-3.5 border-b border-[#e6e0f5] flex items-center justify-between shrink-0 bg-[#faf8fe]">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#6d28d9] to-[#9333ea] text-white grid place-items-center shadow-md shadow-purple-600/30">
                  <Stethoscope className="h-4.5 w-4.5" />
                </div>
                <div>
                  <h2 className="font-['Bricolage_Grotesque',sans-serif] text-base sm:text-lg font-bold text-[#150f26] leading-tight">
                    {editingDoctorId ? `Edit ${doctorFormData.full_name || "Doctor"} Profile` : "Register physician"}
                  </h2>
                  <p className="text-[11px] text-[#625b7e]">
                    Set physician credentials, consultation fees, and weekly consultation shifts.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleCloseDoctorForm}
                className="w-8 h-8 rounded-xl border border-[#e6e0f5] bg-white text-[#625b7e] hover:text-[#150f26] hover:border-[#7c3aed] flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Form Body - Side-by-Side 2 Columns */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSaveDoctor();
              }}
              noValidate
              className="flex-1 overflow-y-auto px-6 py-4 space-y-3.5"
            >
              {doctorFormError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-600 font-semibold flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{doctorFormError}</span>
                </div>
              )}

              {/* 2-Column Grid: Left = Form, Right = Shifts */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
                {/* LEFT COLUMN: Credentials & Fee (5 cols) */}
                <div className="md:col-span-5 space-y-3">
                  {/* Full Name */}
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-[#150f26] flex items-center justify-between">
                      <span>Full name</span>
                      <span className="text-purple-600 text-[10px] font-semibold">Required</span>
                    </label>
                    <div className="relative">
                      <User className="absolute left-3 top-2.5 h-4 w-4 text-[#625b7e]" />
                      <input
                        type="text"
                        placeholder="Dr. Anita Sharma"
                        value={doctorFormData.full_name}
                        onChange={(e) =>
                          setDoctorFormData((prev) => ({ ...prev, full_name: e.target.value }))
                        }
                        className="w-full h-9 pl-9 pr-3 rounded-xl border border-[#e6e0f5] bg-[#f8f6fc] text-xs font-medium text-[#150f26] placeholder-[#625b7e]/50 focus:outline-none focus:border-[#7c3aed] transition-colors"
                      />
                    </div>
                  </div>

                  {/* Specialization */}
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-[#150f26] flex items-center justify-between">
                      <span>Specialization</span>
                      <span className="text-purple-600 text-[10px] font-semibold">Required</span>
                    </label>
                    <div className="relative">
                      <Stethoscope className="absolute left-3 top-2.5 h-4 w-4 text-[#625b7e]" />
                      <input
                        type="text"
                        list="onboarding-specialties-list"
                        placeholder="e.g. General Physician"
                        value={doctorFormData.specialization}
                        onChange={(e) =>
                          setDoctorFormData((prev) => ({ ...prev, specialization: e.target.value }))
                        }
                        className="w-full h-9 pl-9 pr-3 rounded-xl border border-[#e6e0f5] bg-[#f8f6fc] text-xs font-medium text-[#150f26] placeholder-[#625b7e]/50 focus:outline-none focus:border-[#7c3aed] transition-colors"
                      />
                      <datalist id="onboarding-specialties-list">
                        {COMMON_SPECIALTIES.map((spec) => (
                          <option key={spec} value={spec} />
                        ))}
                      </datalist>
                    </div>

                    {/* Quick Specialty Chips */}
                    <div className="flex items-center gap-1 flex-wrap pt-0.5">
                      {["General Physician", "Cardiology", "Pediatrics", "Orthopedics"].map((spec) => (
                        <button
                          key={spec}
                          type="button"
                          onClick={() => setDoctorFormData((prev) => ({ ...prev, specialization: spec }))}
                          className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-all cursor-pointer ${
                            doctorFormData.specialization === spec
                              ? "bg-purple-100 text-[#7c3aed] font-bold border border-purple-300"
                              : "bg-[#f3f0fb] text-[#625b7e] hover:text-[#150f26]"
                          }`}
                        >
                          {spec}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Consultation Fee */}
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-[#150f26] flex items-center gap-1.5">
                      <IndianRupee className="h-3.5 w-3.5 text-[#7c3aed]" />
                      <span>Consultation fee (₹ INR)</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-xs font-bold text-[#625b7e]">₹</span>
                      <input
                        type="number"
                        placeholder="500"
                        value={doctorFormData.consultation_fee}
                        onChange={(e) =>
                          setDoctorFormData((prev) => ({
                            ...prev,
                            consultation_fee: Number(e.target.value),
                          }))
                        }
                        className="w-full h-9 pl-7 pr-3 rounded-xl border border-[#e6e0f5] bg-[#f8f6fc] text-xs font-semibold text-[#150f26] focus:outline-none focus:border-[#7c3aed] transition-colors"
                      />
                    </div>
                    {/* Quick fee chips */}
                    <div className="flex items-center gap-1 flex-wrap pt-0.5">
                      {QUICK_CONSULTATION_FEES.map((fee) => (
                        <button
                          key={fee}
                          type="button"
                          onClick={() => setDoctorFormData((prev) => ({ ...prev, consultation_fee: fee }))}
                          className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-all cursor-pointer ${
                            doctorFormData.consultation_fee === fee
                              ? "bg-purple-100 text-[#7c3aed] font-bold border border-purple-300"
                              : "bg-[#f3f0fb] text-[#625b7e] hover:text-[#150f26]"
                          }`}
                        >
                          ₹{fee}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Slot Duration */}
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-[#150f26] block">
                      Slot duration
                    </label>
                    <div className="grid grid-cols-4 gap-1.5">
                      {SLOT_DURATIONS.map((dur) => {
                        const isSelected = doctorFormData.slot_duration === dur;
                        return (
                          <button
                            key={dur}
                            type="button"
                            onClick={() => setDoctorFormData((prev) => ({ ...prev, slot_duration: dur }))}
                            className={`h-8.5 rounded-xl font-bold text-xs flex items-center justify-center transition-all cursor-pointer ${
                              isSelected
                                ? "bg-gradient-to-r from-[#6d28d9] to-[#9333ea] text-white shadow-xs"
                                : "border border-[#e6e0f5] bg-[#f8f6fc] text-[#150f26] hover:border-[#7c3aed]"
                            }`}
                          >
                            {dur}m
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* RIGHT COLUMN: Weekly Shifts & Scheduling (7 cols) */}
                <div className="md:col-span-7 space-y-2.5 p-3.5 rounded-2xl bg-[#faf8fe] border border-[#e6e0f5]">
                  {/* Shifts Header with Presets */}
                  <div className="flex items-center justify-between flex-wrap gap-2 pb-1 border-b border-[#e6e0f5]">
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5 text-[#7c3aed]" />
                      <span className="font-['Bricolage_Grotesque',sans-serif] text-xs font-bold text-[#150f26]">
                        Weekly consultation shifts
                      </span>
                    </div>

                    {/* Presets Toolbar */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => applyDoctorShiftPreset("weekdays")}
                        className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-white border border-[#e6e0f5] text-[#625b7e] hover:text-[#7c3aed] transition-colors cursor-pointer"
                      >
                        Mon-Fri (9-5)
                      </button>
                      <button
                        type="button"
                        onClick={() => applyDoctorShiftPreset("mon-sat")}
                        className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-white border border-[#e6e0f5] text-[#625b7e] hover:text-[#7c3aed] transition-colors cursor-pointer"
                      >
                        Mon-Sat (9-6)
                      </button>
                      <button
                        type="button"
                        onClick={() => applyDoctorShiftPreset("all-week")}
                        className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-white border border-[#e6e0f5] text-[#625b7e] hover:text-[#7c3aed] transition-colors cursor-pointer"
                      >
                        All 7 days
                      </button>
                      <button
                        type="button"
                        onClick={() => applyDoctorShiftPreset("clear")}
                        className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-white border border-[#e6e0f5] text-[#625b7e] hover:text-red-500 transition-colors cursor-pointer"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  {/* 7 Compact Rows */}
                  <div className="space-y-1">
                    {doctorFormData.availabilities.map((avail, idx) => {
                      const dayName = DAYS_OF_WEEK[avail.day_of_week];
                      const isActive = avail.is_active;

                      return (
                        <div
                          key={avail.day_of_week}
                          className={`px-2.5 py-1.5 rounded-xl border transition-all flex items-center justify-between gap-2 ${
                            isActive
                              ? "bg-white border-[#7c3aed]/30 shadow-xs"
                              : "bg-[#f8f6fc]/50 border-transparent opacity-50"
                          }`}
                        >
                          {/* Left: Switch + Day Name */}
                          <div className="flex items-center gap-2.5 w-24 shrink-0">
                            <button
                              type="button"
                              role="switch"
                              aria-checked={isActive}
                              onClick={() => {
                                const updated = [...doctorFormData.availabilities];
                                updated[idx].is_active = !isActive;
                                setDoctorFormData((prev) => ({ ...prev, availabilities: updated }));
                              }}
                              className={`relative inline-flex h-4.5 w-8 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                isActive
                                  ? "bg-gradient-to-r from-[#6d28d9] to-[#9333ea]"
                                  : "bg-slate-200"
                              }`}
                            >
                              <span
                                aria-hidden="true"
                                className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                                  isActive ? "translate-x-3.5" : "translate-x-0"
                                }`}
                              />
                            </button>

                            <span className="font-semibold text-xs text-[#150f26]">
                              {dayName.slice(0, 3)}
                            </span>
                          </div>

                          {/* Right: Time Pickers or Off Duty */}
                          <div className="flex items-center justify-end gap-1.5 flex-1">
                            {isActive ? (
                              <>
                                <input
                                  type="time"
                                  value={avail.start_time}
                                  onChange={(e) => {
                                    const updated = [...doctorFormData.availabilities];
                                    updated[idx].start_time = e.target.value;
                                    setDoctorFormData((prev) => ({ ...prev, availabilities: updated }));
                                  }}
                                  className="h-7 w-[108px] px-2 rounded-lg border border-[#e6e0f5] bg-white text-[11px] font-mono font-medium text-[#150f26] focus:outline-none focus:border-[#7c3aed] transition-colors cursor-pointer"
                                />
                                <span className="text-[10px] text-[#625b7e]">to</span>
                                <input
                                  type="time"
                                  value={avail.end_time}
                                  onChange={(e) => {
                                    const updated = [...doctorFormData.availabilities];
                                    updated[idx].end_time = e.target.value;
                                    setDoctorFormData((prev) => ({ ...prev, availabilities: updated }));
                                  }}
                                  className="h-7 w-[108px] px-2 rounded-lg border border-[#e6e0f5] bg-white text-[11px] font-mono font-medium text-[#150f26] focus:outline-none focus:border-[#7c3aed] transition-colors cursor-pointer"
                                />
                                <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-purple-100 text-[#7c3aed] shrink-0">
                                  {calculateShiftHours(avail.start_time, avail.end_time)}
                                </span>
                              </>
                            ) : (
                              <span className="text-[11px] text-slate-400 font-medium italic pr-1">
                                Off duty
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Compact Shift Summary */}
                  <div className="px-2.5 py-1 rounded-xl bg-white border border-[#e6e0f5] flex items-center justify-between text-[11px] text-[#625b7e]">
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      <span>
                        <b>{doctorFormData.availabilities.filter((a) => a.is_active).length} of 7</b> active
                      </span>
                    </div>
                    <div>
                      Weekly: <b className="text-[#150f26]">{totalDoctorWeeklyHours}</b>
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Actions */}
              <div className="pt-3 border-t border-[#e6e0f5] flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={handleCloseDoctorForm}
                  className="px-4 h-9 rounded-xl border border-[#e6e0f5] bg-white text-xs font-semibold text-[#625b7e] hover:text-[#150f26] hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingDoctor}
                  className="px-5 h-9 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#6d28d9] to-[#9333ea] text-white font-semibold text-xs shadow-md shadow-purple-600/30 hover:brightness-105 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isSavingDoctor ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      <span>{editingDoctorId ? "Update Physician" : "Save physician to roster"}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          CUSTOM DELETE CONFIRMATION MODAL (Matching UI Theme)
          ========================================================================= */}
      {doctorToDelete && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-[#050a19]/75 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isDeletingDoctor) {
              setDoctorToDelete(null);
            }
          }}
        >
          <div className="relative w-full max-w-md rounded-[24px] bg-white border border-[#e6e0f5] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.5)] p-6 space-y-5 animate-in zoom-in-95 duration-150 text-center">
            {/* Danger Icon Container */}
            <div className="w-14 h-14 rounded-2xl bg-red-50 border border-red-200/60 text-red-600 grid place-items-center mx-auto shadow-sm shadow-red-500/10">
              <Trash2 className="h-7 w-7" />
            </div>

            {/* Confirmation Text */}
            <div className="space-y-1.5">
              <h3 className="font-['Bricolage_Grotesque',sans-serif] text-xl font-bold text-[#150f26] leading-tight">
                Remove {doctorToDelete.full_name}?
              </h3>
              <p className="text-xs text-[#625b7e] leading-relaxed max-w-sm mx-auto">
                Are you sure you want to remove <b className="text-[#150f26] font-bold">{doctorToDelete.full_name}</b> from the medical roster? The Voice AI assistant will no longer offer appointment slots for this physician.
              </p>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                disabled={isDeletingDoctor}
                onClick={() => setDoctorToDelete(null)}
                className="flex-1 h-10 px-4 rounded-xl border border-[#e6e0f5] bg-white text-xs font-semibold text-[#625b7e] hover:text-[#150f26] hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeletingDoctor}
                onClick={handleConfirmDeleteDoctor}
                className="flex-1 h-10 px-4 inline-flex items-center justify-center gap-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold text-xs shadow-md shadow-red-600/30 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
              >
                {isDeletingDoctor ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Removing...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" />
                    <span>Yes, remove</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

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
