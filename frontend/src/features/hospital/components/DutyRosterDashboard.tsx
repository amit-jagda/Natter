import React, { useState, useMemo } from "react";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Search,
  Stethoscope,
  AlertTriangle,
  CheckCircle2,
  Edit3,
  Coffee,
} from "lucide-react";
import { DoctorItem, OperatingHoursItem } from "@/types/onboarding";

interface DutyRosterDashboardProps {
  doctors: DoctorItem[];
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  doctorLeaves: { [doctorId: string]: number[] };
  onToggleLeave: (doctorId: string, dateNum: number) => void;
  onOpenEditDoctor: (doctor: DoctorItem) => void;
  onOpenAddDoctor: () => void;
  onSwitchToTable: () => void;
  isOperator?: boolean;
  operatingHours?: OperatingHoursItem[];
  showToast: (msg: string) => void;
}

const DAYS_OF_WEEK = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export const DutyRosterDashboard: React.FC<DutyRosterDashboardProps> = ({
  doctors,
  selectedDate,
  onSelectDate,
  doctorLeaves,
  onToggleLeave,
  onOpenEditDoctor,
  isOperator = false,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSpecialty, setSelectedSpecialty] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "on_duty" | "on_leave" | "weekly_off">("all");

  // Helper to format Date as YYYY-MM-DD
  const formatDateToYMD = (d: Date): string => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  // Helper to parse Date from YYYY-MM-DD
  const parseYMDToDate = (ymdStr: string): Date => {
    const parts = ymdStr.split("-").map(Number);
    if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
      return new Date(parts[0], parts[1] - 1, parts[2]);
    }
    return new Date();
  };

  // Day index from 0 (Monday) to 6 (Sunday)
  const selectedDayOfWeek = (selectedDate.getDay() + 6) % 7;
  const selectedDayName = DAYS_OF_WEEK[selectedDayOfWeek] || "Monday";
  const selectedDateNum = selectedDate.getDate();
  const selectedDateYMD = formatDateToYMD(selectedDate);
  const isSelectedToday = selectedDate.toDateString() === new Date().toDateString();

  // Distinct Specialties from Doctors List
  const specialties = useMemo(() => {
    const set = new Set<string>();
    doctors.forEach((d) => {
      if (d.specialization) set.add(d.specialization);
    });
    return Array.from(set).sort();
  }, [doctors]);

  // Retrieve Leaves for a Doctor
  const getDoctorLeaves = (docId: string): number[] => {
    if (doctorLeaves[docId]) return doctorLeaves[docId];
    for (const [key, val] of Object.entries(doctorLeaves)) {
      if (key.toLowerCase().includes(docId.toLowerCase()) || docId.toLowerCase().includes(key.toLowerCase())) {
        return val;
      }
    }
    return [];
  };

  // Check if a doctor is on leave on this specific date
  const isDoctorOnLeaveOnDate = (docId: string, date: Date): boolean => {
    const leaves = getDoctorLeaves(docId);
    const dayNum = date.getDate();
    const dateYMD = formatDateToYMD(date);
    return leaves.some((l: any) => l === dayNum || l === dateYMD || String(l) === String(dayNum));
  };

  // 7-Day Week Strip (Monday to Sunday) for active week
  const weekDays = useMemo(() => {
    const monday = new Date(selectedDate);
    const day = (monday.getDay() + 6) % 7;
    monday.setDate(monday.getDate() - day);

    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d;
    });
  }, [selectedDate]);

  // Compute Roster List for Selected Date
  const rosterData = useMemo(() => {
    return doctors.map((doc) => {
      const isOnLeave = isDoctorOnLeaveOnDate(doc.id, selectedDate);
      const avail = doc.availabilities?.find((a) => a.day_of_week === selectedDayOfWeek);
      const isRegularlyScheduled = avail
        ? (avail.is_available ?? (avail as any).is_active ?? true)
        : (selectedDayOfWeek < 6);

      let status: "on_duty" | "on_leave" | "weekly_off" = "on_duty";
      if (isOnLeave) {
        status = "on_leave";
      } else if (!isRegularlyScheduled) {
        status = "weekly_off";
      } else {
        status = "on_duty";
      }

      const startTime = avail?.start_time || "09:00";
      const endTime = avail?.end_time || "18:00";

      // Calculate shift duration in hours
      let hoursCount = 0;
      try {
        const [sh, sm] = startTime.split(":").map(Number);
        const [eh, em] = endTime.split(":").map(Number);
        hoursCount = Math.max(0, (eh * 60 + em - (sh * 60 + sm)) / 60);
      } catch {
        hoursCount = 8;
      }

      return {
        doctor: doc,
        status,
        isOnLeave,
        isRegularlyScheduled,
        availability: avail,
        startTime,
        endTime,
        hoursCount,
      };
    });
  }, [doctors, selectedDate, selectedDayOfWeek, doctorLeaves]);

  // Summary Counts
  const onDutyCount = useMemo(() => rosterData.filter((r) => r.status === "on_duty").length, [rosterData]);
  const onLeaveCount = useMemo(() => rosterData.filter((r) => r.status === "on_leave").length, [rosterData]);
  const weeklyOffCount = useMemo(() => rosterData.filter((r) => r.status === "weekly_off").length, [rosterData]);

  // Filtered Roster for Table Display
  const filteredRoster = useMemo(() => {
    return rosterData.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (selectedSpecialty !== "all" && item.doctor.specialization !== selectedSpecialty) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = item.doctor.full_name.toLowerCase().includes(q);
        const matchSpec = item.doctor.specialization?.toLowerCase().includes(q);
        if (!matchName && !matchSpec) return false;
      }
      return true;
    });
  }, [rosterData, statusFilter, selectedSpecialty, searchQuery]);

  // Quick Day Navigators
  const handlePrevDay = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 1);
    onSelectDate(d);
  };

  const handleNextDay = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + 1);
    onSelectDate(d);
  };

  const handleToday = () => {
    onSelectDate(new Date());
  };

  const formatShortTime = (timeStr: string) => {
    try {
      const [hStr, mStr] = timeStr.split(":");
      let h = parseInt(hStr, 10);
      const m = mStr || "00";
      const ampm = h >= 12 ? "PM" : "AM";
      h = h % 12;
      if (h === 0) h = 12;
      return `${h}:${m} ${ampm}`;
    } catch {
      return timeStr;
    }
  };

  return (
    <div className="space-y-5">
      {/* =========================================================================
          1. CLEAN DATE NAVIGATION BAR + 7-DAY STRIP (Zero clutter)
          ========================================================================= */}
      <div className="p-5 sm:p-6 rounded-[24px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm space-y-4">
        {/* Top Header: Date Navigation (Left) + Quick Metric Pills (Right) */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          {/* Date Selector */}
          <div className="flex items-center flex-wrap gap-2.5">
            <div className="flex items-center gap-1 border border-[#e6e0f5] dark:border-[#2b2347] rounded-xl p-1 bg-[#fcfaff] dark:bg-[#161226]">
              <button
                type="button"
                onClick={handlePrevDay}
                className="p-1.5 rounded-lg text-[#625b7e] hover:text-[#150f26] dark:hover:text-white hover:bg-white dark:hover:bg-white/10 transition-colors cursor-pointer"
                title="Previous Day"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={handleToday}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  isSelectedToday
                    ? "bg-[#7c3aed] text-white shadow-xs font-bold"
                    : "text-[#625b7e] dark:text-[#a29bc2] hover:text-[#150f26] dark:hover:text-white"
                }`}
              >
                Today
              </button>

              <button
                type="button"
                onClick={handleNextDay}
                className="p-1.5 rounded-lg text-[#625b7e] hover:text-[#150f26] dark:hover:text-white hover:bg-white dark:hover:bg-white/10 transition-colors cursor-pointer"
                title="Next Day"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            {/* Date Display Pill */}
            <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-purple-50/70 dark:bg-purple-950/40 border border-purple-200/60 dark:border-purple-900/50">
              <Calendar className="h-4 w-4 text-[#7c3aed] dark:text-purple-300" />
              <span className="font-['Bricolage_Grotesque',sans-serif] font-bold text-sm text-[#150f26] dark:text-white">
                {selectedDayName}, {selectedDate.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
              </span>
              {isSelectedToday && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[#7c3aed] text-white">
                  Today
                </span>
              )}
            </div>

            {/* Native Date Picker */}
            <input
              type="date"
              value={selectedDateYMD}
              onChange={(e) => {
                if (e.target.value) {
                  onSelectDate(parseYMDToDate(e.target.value));
                }
              }}
              className="h-10 px-3 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#fcfaff] dark:bg-white/5 text-xs font-semibold text-[#150f26] dark:text-white cursor-pointer focus:outline-none focus:border-[#7c3aed]"
              title="Pick any date"
            />
          </div>

          {/* Quick Roster Status Summary Badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>{onDutyCount} On Duty</span>
            </span>
            {onLeaveCount > 0 && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                <span>{onLeaveCount} On Leave</span>
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200">
              <span className="w-2 h-2 rounded-full bg-slate-400" />
              <span>{weeklyOffCount} Weekly Off</span>
            </span>
          </div>
        </div>

        {/* 7-Day Week Strip (Monday to Sunday) */}
        <div className="pt-2 border-t border-[#e6e0f5] dark:border-[#2b2347]">
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
            {weekDays.map((dayDate) => {
              const dayYMD = formatDateToYMD(dayDate);
              const isSelected = dayYMD === selectedDateYMD;
              const isToday = dayDate.toDateString() === new Date().toDateString();
              const dayIdx = (dayDate.getDay() + 6) % 7;
              const dayAbbr = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"][dayIdx];

              const dayDutyCount = doctors.filter((doc) => {
                const onLeave = isDoctorOnLeaveOnDate(doc.id, dayDate);
                if (onLeave) return false;
                const avail = doc.availabilities?.find((a) => a.day_of_week === dayIdx);
                return avail ? (avail.is_available ?? (avail as any).is_active ?? true) : dayIdx < 6;
              }).length;

              const hasDayLeave = doctors.some((doc) => isDoctorOnLeaveOnDate(doc.id, dayDate));

              return (
                <button
                  key={dayYMD}
                  type="button"
                  onClick={() => onSelectDate(dayDate)}
                  className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center justify-between select-none ${
                    isSelected
                      ? "bg-purple-50/80 dark:bg-purple-950/50 border-2 border-[#7c3aed] ring-2 ring-[#7c3aed]/20 shadow-sm"
                      : isToday
                      ? "bg-white dark:bg-[#161226] border-2 border-[#150f26] dark:border-white"
                      : "bg-[#fcfaff] dark:bg-[#161226] border-[#e6e0f5] dark:border-[#2b2347] hover:border-[#7c3aed]/50 hover:bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between w-full px-0.5">
                    <span className="text-[10px] font-bold text-[#8b84a6] dark:text-[#7a7299]">
                      {dayAbbr}
                    </span>
                    {isToday && (
                      <span className="text-[9px] font-bold text-[#7c3aed] dark:text-purple-300">
                        Today
                      </span>
                    )}
                  </div>

                  <div className="font-['Bricolage_Grotesque',sans-serif] font-bold text-base text-[#150f26] dark:text-white my-0.5">
                    {dayDate.getDate()}
                  </div>

                  <div className="flex items-center gap-1">
                    <span
                      className={`text-[9.5px] font-bold px-1.5 py-0.2 rounded-md ${
                        dayDutyCount > 0
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                          : "text-slate-400"
                      }`}
                    >
                      {dayDutyCount > 0 ? `${dayDutyCount} on duty` : "Off duty"}
                    </span>
                    {hasDayLeave && (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" title="Leave registered" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* =========================================================================
          2. FILTER & SEARCH TOOLBAR + TABULAR ROSTER
          ========================================================================= */}
      <div className="p-5 sm:p-6 rounded-[24px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm space-y-5">
        {/* Filter Controls Bar */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          {/* Status Segmented Tabs */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#f3f0fb] dark:bg-[#1a1435] border border-[#e6e0f5] dark:border-[#2b2347] overflow-x-auto">
            <button
              type="button"
              onClick={() => setStatusFilter("all")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                statusFilter === "all"
                  ? "bg-white dark:bg-[#120e1f] text-[#150f26] dark:text-white shadow-xs font-bold"
                  : "text-[#625b7e] dark:text-[#a29bc2] hover:text-[#150f26]"
              }`}
            >
              All Doctors ({doctors.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("on_duty")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                statusFilter === "on_duty"
                  ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 font-bold"
                  : "text-[#625b7e] dark:text-[#a29bc2] hover:text-[#150f26]"
              }`}
            >
              On Duty ({onDutyCount})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("on_leave")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                statusFilter === "on_leave"
                  ? "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-200 font-bold"
                  : "text-[#625b7e] dark:text-[#a29bc2] hover:text-[#150f26]"
              }`}
            >
              On Leave ({onLeaveCount})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("weekly_off")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                statusFilter === "weekly_off"
                  ? "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200 font-bold"
                  : "text-[#625b7e] dark:text-[#a29bc2] hover:text-[#150f26]"
              }`}
            >
              Weekly Off ({weeklyOffCount})
            </button>
          </div>

          {/* Search & Specialization Dropdown */}
          <div className="flex items-center gap-2.5 flex-1 max-w-md">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#a29bc2]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search doctors by name or specialty..."
                className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-[#fcfaff] dark:bg-white/5 border border-[#e6e0f5] dark:border-[#2b2347] text-xs text-[#150f26] dark:text-white placeholder:text-[#a29bc2] focus:outline-none focus:border-[#7c3aed]"
              />
            </div>

            {specialties.length > 0 && (
              <select
                value={selectedSpecialty}
                onChange={(e) => setSelectedSpecialty(e.target.value)}
                className="px-3 py-2 rounded-xl bg-[#fcfaff] dark:bg-[#161226] border border-[#e6e0f5] dark:border-[#2b2347] text-xs font-semibold text-[#150f26] dark:text-white focus:outline-none focus:border-[#7c3aed] cursor-pointer"
              >
                <option value="all">All Specialties</option>
                {specialties.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* =========================================================================
            3. TABULAR DOCTOR DUTY ROSTER (Matching Hospital Dashboard Design)
            ========================================================================= */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#fcfaff] dark:bg-white/[0.02] border-b border-[#e6e0f5] dark:border-[#2b2347] text-[#625b7e] dark:text-[#a29bc2] uppercase font-semibold text-[11px] tracking-wider">
              <tr>
                <th className="py-3.5 px-4 text-center w-12 font-mono">#</th>
                <th className="py-3.5 px-5">Doctor Name</th>
                <th className="py-3.5 px-4">Specialization</th>
                <th className="py-3.5 px-4">Duty Status ({selectedDateNum} {selectedDate.toLocaleString("en-US", { month: "short" })})</th>
                <th className="py-3.5 px-4">Shift Timings</th>
                <th className="py-3.5 px-4">Fee &amp; Slot</th>
                {!isOperator && <th className="py-3.5 px-5 text-right">Duty Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0ebfa] dark:divide-[#251e3e]">
              {filteredRoster.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-[#625b7e] dark:text-[#a29bc2]">
                    <p className="font-semibold text-sm text-[#150f26] dark:text-white">
                      No doctors found for this date and filter selection
                    </p>
                    <p className="text-xs mt-1">Try switching status or picking a different date.</p>
                  </td>
                </tr>
              ) : (
                filteredRoster.map((item, docIdx) => {
                  const initial =
                    item.doctor.full_name.replace(/^Dr\.?\s*/i, "").charAt(0).toUpperCase() || "D";

                  return (
                    <tr
                      key={item.doctor.id}
                      className={`hover:bg-[#fbf9ff] dark:hover:bg-white/[0.02] transition-colors ${
                        item.isOnLeave
                          ? "bg-amber-50/30 dark:bg-amber-950/10"
                          : item.status === "weekly_off"
                          ? "bg-slate-50/40 dark:bg-white/[0.005]"
                          : ""
                      }`}
                    >
                      {/* Serial Number */}
                      <td className="py-3.5 px-4 text-center font-mono text-[11px] font-bold text-[#8b84a6] dark:text-[#7a7299]">
                        {docIdx + 1}
                      </td>

                      {/* Doctor Name & Avatar */}
                      <td className="py-3.5 px-5 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-8 h-8 rounded-xl font-bold grid place-items-center text-xs shrink-0 ${
                              item.isOnLeave
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                                : item.status === "weekly_off"
                                ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                                : "bg-purple-100 dark:bg-purple-950/70 text-[#7c3aed] dark:text-purple-300"
                            }`}
                          >
                            {initial}
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-[#150f26] dark:text-white">
                              {item.doctor.full_name}
                            </div>
                            <div className="text-[11px] text-[#625b7e] dark:text-[#a29bc2] font-mono">
                              {item.doctor.email || "Doctor on roster"}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Specialization */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-purple-50 dark:bg-purple-950/40 text-[#7c3aed] dark:text-purple-300">
                          <Stethoscope className="h-3 w-3" />
                          <span>{item.doctor.specialization || "General Medicine"}</span>
                        </span>
                      </td>

                      {/* Duty Status */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {item.isOnLeave ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 border border-amber-300">
                            <AlertTriangle className="h-3 w-3" />
                            <span>On Leave Today</span>
                          </span>
                        ) : item.status === "weekly_off" ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border border-slate-200">
                            <Coffee className="h-3 w-3" />
                            <span>Weekly Off</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200 border border-emerald-300">
                            <CheckCircle2 className="h-3 w-3" />
                            <span>Active On Duty</span>
                          </span>
                        )}
                      </td>

                      {/* Shift Timings */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {item.isOnLeave ? (
                          <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                            Leave Registered
                          </span>
                        ) : item.status === "weekly_off" ? (
                          <span className="text-[11px] font-medium text-slate-400">
                            Scheduled Rest Day ({selectedDayName})
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#f3f0fb] dark:bg-[#1f1938] text-xs font-semibold text-[#6d28d9] dark:text-[#c084fc]">
                            <Clock className="h-3 w-3" />
                            <span>{formatShortTime(item.startTime)} - {formatShortTime(item.endTime)} ({item.hoursCount}h)</span>
                          </span>
                        )}
                      </td>

                      {/* Fee & Slot */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-mono font-medium">
                          <span>₹{item.doctor.consultation_fee ?? 500}</span>
                          <span className="text-[10px] text-emerald-500">· {item.doctor.slot_duration_minutes || 30}m</span>
                        </div>
                      </td>

                      {/* Actions */}
                      {!isOperator && (
                        <td className="py-3.5 px-5 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Toggle Leave Action Button */}
                            <button
                              type="button"
                              onClick={() => onToggleLeave(item.doctor.id, selectedDateNum)}
                              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer shadow-xs ${
                                item.isOnLeave
                                  ? "bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300 font-bold"
                                  : "bg-amber-50 hover:bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border-amber-300"
                              }`}
                              title={item.isOnLeave ? "Cancel leave for this day" : "Mark doctor on leave for this day"}
                            >
                              {item.isOnLeave ? "Cancel Leave" : "Mark Leave"}
                            </button>

                            {/* Edit Shift Button */}
                            <button
                              type="button"
                              onClick={() => onOpenEditDoctor(item.doctor)}
                              className="p-1.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-white dark:bg-[#1f1938] hover:bg-purple-50 text-[#7c3aed] dark:text-purple-300 transition-all cursor-pointer shadow-xs"
                              title="Edit doctor consultation timings"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
