import React, { useState, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/lib/auth-context";
import {
  LayoutDashboard,
  Stethoscope,
  Mic,
  Building2,
  Phone,
  PhoneCall,
  MapPin,
  Clock,
  Plus,
  Trash2,
  Edit3,
  Save,
  CheckCircle2,
  Loader2,
  AlertCircle,
  AlertTriangle,
  Target,
  FileText,
  X,
  LogOut,
  Search,
  Calendar,
  List,
  User,
  Check,
  Users,
  FileSpreadsheet,
  ShieldAlert,
  RefreshCw,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import {
  DoctorItem,
  DoctorCreatePayload,
  DoctorAvailabilityItem,
  OperatingHoursItem,
  TenantData,
} from "@/types/onboarding";
import { VoicePlayground } from "@/features/voice-playground/VoicePlayground";
import { PatientsTab } from "./components/PatientsTab";
import { UsersTab } from "./components/UsersTab";
import { DutyRosterDashboard } from "./components/DutyRosterDashboard";
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

const SLOT_DURATIONS = [15, 30, 45, 60];

type TabType = "dashboard" | "doctors" | "patients" | "users" | "voice" | "profile";

export const HospitalDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const isOperator = user?.role === "operator";
  const [searchParams, setSearchParams] = useSearchParams();

  // Map legacy 'test' parameter to 'voice'
  const rawTab = searchParams.get("tab");
  const initialTab: TabType =
    rawTab === "test"
      ? "voice"
      : (rawTab as TabType) || "dashboard";

  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);
  const [isSidebarHovered, setIsSidebarHovered] = useState(false);
  const isExpanded = isSidebarExpanded || isSidebarHovered;

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", tab);
      if (tab !== "doctors") {
        next.delete("view");
        next.delete("date");
      }
      return next;
    });
  };

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const [tenant, setTenant] = useState<TenantData | null>(null);
  const [doctors, setDoctors] = useState<DoctorItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Profile Form State
  const [phoneNumber, setPhoneNumber] = useState("");
  const [emergencyContact, setEmergencyContact] = useState("102");
  const [address, setAddress] = useState({
    street: "",
    city: "",
    state: "",
    postal_code: "",
  });
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [operatingHours, setOperatingHours] = useState<OperatingHoursItem[]>([]);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [holidays, setHolidays] = useState<number[]>([]);
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [customShiftOpen, setCustomShiftOpen] = useState("09:00");
  const [customShiftClose, setCustomShiftClose] = useState("20:00");

  // Toast State
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [headerActionsPortalNode, setHeaderActionsPortalNode] = useState<HTMLElement | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 2400);
  };

  // Doctor Add/Edit Modal State
  const [showDoctorModal, setShowDoctorModal] = useState(false);
  const [editingDoctorId, setEditingDoctorId] = useState<string | null>(null);
  const [isSavingDoctor, setIsSavingDoctor] = useState(false);
  const [doctorFormError, setDoctorFormError] = useState<string | null>(null);
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
      is_active: i < 6, // Mon to Sat active
    })),
  });

  // Helper to format Date as YYYY-MM-DD
  const formatDateToYMD = (d: Date): string => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  // Helper to parse Date from YYYY-MM-DD
  const parseYMDToDate = (ymdStr: string | null): Date => {
    if (ymdStr) {
      const parts = ymdStr.split("-").map(Number);
      if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
        return new Date(parts[0], parts[1] - 1, parts[2]);
      }
    }
    return new Date();
  };

  // Doctor Filter & View Mode State (Synced with URL search params so refresh preserves calendar/dashboard view)
  const rawView = searchParams.get("view");
  const [doctorViewMode, setDoctorViewMode] = useState<"calendar" | "table">(
    rawView === "calendar" ? "calendar" : "table"
  );
  const [selectedRosterDate, setSelectedRosterDate] = useState<Date>(() =>
    parseYMDToDate(searchParams.get("date"))
  );
  const [doctorLeaves, setDoctorLeaves] = useState<{ [doctorId: string]: number[] }>(() => {
    try {
      const saved = localStorage.getItem("natter_hospital_doctor_leaves");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === "object") return parsed;
      }
    } catch (e) {
      console.error("Failed to load doctor leaves from localStorage:", e);
    }
    return {
      "doc-shah": [12, 19],
      "doc-mehta": [26],
    };
  });
  const [doctorModalLeaves, setDoctorModalLeaves] = useState<number[]>([]);
  const [selectedModalDayIndex, setSelectedModalDayIndex] = useState<number>(0);

  // Sync doctor leaves to localStorage on state changes
  useEffect(() => {
    try {
      localStorage.setItem("natter_hospital_doctor_leaves", JSON.stringify(doctorLeaves));
    } catch (e) {
      console.error("Failed to save doctor leaves to localStorage:", e);
    }
  }, [doctorLeaves]);

  // Synchronize URL search params with doctor view mode and selected date on refresh
  useEffect(() => {
    const viewParam = searchParams.get("view");
    if (viewParam === "calendar" && doctorViewMode !== "calendar") {
      setDoctorViewMode("calendar");
    } else if (viewParam === "table" && doctorViewMode !== "table") {
      setDoctorViewMode("table");
    }
    const dateParam = searchParams.get("date");
    if (dateParam) {
      const parsed = parseYMDToDate(dateParam);
      if (formatDateToYMD(parsed) !== formatDateToYMD(selectedRosterDate)) {
        setSelectedRosterDate(parsed);
      }
    }
  }, [searchParams]);

  const handleDoctorViewModeChange = (mode: "calendar" | "table") => {
    setDoctorViewMode(mode);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", "doctors");
      if (mode === "calendar") {
        next.set("view", "calendar");
        if (!next.has("date")) {
          next.set("date", formatDateToYMD(selectedRosterDate));
        }
      } else {
        next.delete("view");
        next.delete("date");
      }
      return next;
    });
  };

  const handleSelectRosterDate = (newDate: Date) => {
    setSelectedRosterDate(newDate);
    const dateStr = formatDateToYMD(newDate);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", "doctors");
      next.set("view", "calendar");
      next.set("date", dateStr);
      return next;
    });
  };

  // Robust doctor leaves lookup supporting UUID, name, and legacy slugs
  const getDoctorLeavesForDoc = useCallback(
    (docIdOrName?: string): number[] => {
      if (!docIdOrName) return [];
      // 1. Direct match on key
      if (doctorLeaves[docIdOrName]) return doctorLeaves[docIdOrName];
      // 2. Doctor item lookup
      const doc = doctors.find((d) => d.id === docIdOrName || d.full_name === docIdOrName);
      if (doc) {
        if (doctorLeaves[doc.id]) return doctorLeaves[doc.id];
        if (doctorLeaves[doc.full_name]) return doctorLeaves[doc.full_name];
        // 3. Normalized slug matching for mock/legacy keys (e.g. "doc-shah", "shah", "mehta")
        const nameClean = doc.full_name.toLowerCase().replace(/[^a-z0-9]/g, "");
        for (const [k, v] of Object.entries(doctorLeaves)) {
          const keyClean = k.toLowerCase().replace(/^doc-?/, "").replace(/[^a-z0-9]/g, "");
          if (keyClean.length >= 3 && nameClean.includes(keyClean)) {
            return v;
          }
        }
      }
      return [];
    },
    [doctorLeaves, doctors]
  );
  const [doctorSearchQuery, setDoctorSearchQuery] = useState("");
  const [selectedSpecialty, setSelectedSpecialty] = useState("");
  const [isSearchingDoctors, setIsSearchingDoctors] = useState(false);
  const [allSpecialties, setAllSpecialties] = useState<string[]>([
    "General Physician",
    "Cardiology",
    "Pediatrics",
    "Orthopedics",
    "Dentistry",
    "Neurology",
  ]);

  // Debounced backend doctor search
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setIsSearchingDoctors(true);
      try {
        const params = new URLSearchParams();
        if (doctorSearchQuery.trim()) params.append("search", doctorSearchQuery.trim());
        if (selectedSpecialty) params.append("specialization", selectedSpecialty);
        const qs = params.toString() ? `?${params.toString()}` : "";
        const res = await apiClient.get<DoctorItem[]>(`/api/v1/doctors${qs}`);
        if (active) {
          setDoctors(res);
          setAllSpecialties((prev) => {
            const set = new Set([...prev, ...res.map((d) => d.specialization)]);
            return Array.from(set);
          });
        }
      } catch (err) {
        console.error("Backend doctor search error:", err);
      } finally {
        if (active) setIsSearchingDoctors(false);
      }
    }, 350);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [doctorSearchQuery, selectedSpecialty]);

  const fetchDoctors = async (query = doctorSearchQuery, specialty = selectedSpecialty) => {
    setIsSearchingDoctors(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.append("search", query.trim());
      if (specialty) params.append("specialization", specialty);
      const qs = params.toString() ? `?${params.toString()}` : "";
      const res = await apiClient.get<DoctorItem[]>(`/api/v1/doctors${qs}`);
      setDoctors(res);
      setAllSpecialties((prev) => {
        const set = new Set([...prev, ...res.map((d) => d.specialization)]);
        return Array.from(set);
      });
    } catch (err) {
      console.error("Backend doctor fetch error:", err);
    } finally {
      setIsSearchingDoctors(false);
    }
  };

  // Analytics Filter State
  const [analyticsRange, setAnalyticsRange] = useState<"today" | 7 | 30>("today");

  // Fetch Tenant, Doctors & Operating Hours on Mount
  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      setIsLoading(true);
      try {
        const [tenantRes, doctorsRes, hoursRes] = await Promise.allSettled([
          apiClient.get<TenantData>("/api/v1/tenants/me"),
          apiClient.get<DoctorItem[]>("/api/v1/doctors"),
          apiClient.get<OperatingHoursItem[]>("/api/v1/tenants/me/operating-hours"),
        ]);

        if (isMounted) {
          if (tenantRes.status === "fulfilled") {
            const t = tenantRes.value;
            setTenant(t);
            setPhoneNumber(t.phone_number || "");
            setEmergencyContact(t.emergency_contact || "102");
            setAddress({
              street: t.address?.street || "",
              city: t.address?.city || "",
              state: t.address?.state || "",
              postal_code: t.address?.postal_code || "",
            });
            setTimezone(t.timezone || "Asia/Kolkata");
          }

          if (doctorsRes.status === "fulfilled") {
            setDoctors(doctorsRes.value);
          }

          if (hoursRes.status === "fulfilled" && hoursRes.value.length > 0) {
            setOperatingHours(hoursRes.value);
          } else {
            // Default 7-day schedule (Mon-Sat 09:00 - 20:00, Sun closed)
            const defaults: OperatingHoursItem[] = Array.from({ length: 7 }, (_, i) => ({
              day_of_week: i,
              open_time: i === 6 ? null : "09:00",
              close_time: i === 6 ? null : "20:00",
              is_closed: i === 6,
            }));
            setOperatingHours(defaults);
          }
        }
      } catch (err) {
        console.error("Failed to load hospital data:", err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadData();
    return () => {
      isMounted = false;
    };
  }, []);

  const calculateShiftMinutes = (start: string, end: string): number => {
    if (!start || !end) return 0;
    const [h1, m1] = start.split(":").map(Number);
    const [h2, m2] = end.split(":").map(Number);
    let diff = h2 * 60 + m2 - (h1 * 60 + m1);
    if (diff <= 0) diff += 24 * 60;
    return diff;
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

  const handleSetDayTimes = (dayIndex: number, start: string, end: string) => {
    setDoctorFormData((prev) => ({
      ...prev,
      availabilities: prev.availabilities.map((a) =>
        a.day_of_week === dayIndex ? { ...a, start_time: start, end_time: end, is_active: true } : a
      ),
    }));
  };

  const handleApplyDayPreset = (
    dayIndex: number,
    preset: "morning" | "afternoon" | "evening" | "fullday" | "night" | "off"
  ) => {
    if (preset === "off") {
      setDoctorFormData((prev) => ({
        ...prev,
        availabilities: prev.availabilities.map((a) =>
          a.day_of_week === dayIndex ? { ...a, is_active: false } : a
        ),
      }));
      return;
    }
    const presetMap: Record<string, [string, string]> = {
      morning: ["09:00", "13:00"],
      afternoon: ["13:00", "17:00"],
      evening: ["17:00", "21:00"],
      fullday: ["09:00", "18:00"],
      night: ["20:00", "08:00"],
    };
    const [start, end] = presetMap[preset] || ["09:00", "18:00"];
    handleSetDayTimes(dayIndex, start, end);
  };

  const handleCopyDayToAllDays = (sourceDayIndex: number) => {
    const source = doctorFormData.availabilities.find((a) => a.day_of_week === sourceDayIndex);
    if (!source) return;
    setDoctorFormData((prev) => ({
      ...prev,
      availabilities: prev.availabilities.map((a) =>
        a.is_active ? { ...a, start_time: source.start_time, end_time: source.end_time } : a
      ),
    }));
    showToast(`Copied ${WEEKDAYS[sourceDayIndex].label} shift timings (${source.start_time} - ${source.end_time}) to all active days`);
  };

  // Open Modal for New Doctor
  const handleOpenAddDoctorModal = () => {
    setEditingDoctorId(null);
    setDoctorModalLeaves([]);
    setSelectedModalDayIndex(0);
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
    setShowDoctorModal(true);
  };

  // Open Modal for Edit Doctor
  const handleOpenEditDoctorModal = (doc: DoctorItem) => {
    setEditingDoctorId(doc.id);
    const existingLeaves = getDoctorLeavesForDoc(doc.id);
    setDoctorModalLeaves(existingLeaves);
    setSelectedModalDayIndex(0);
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
    setShowDoctorModal(true);
  };

  // Save Doctor (Create or Update)
  const handleSaveDoctor = async () => {
    if (!doctorFormData.full_name.trim()) {
      setDoctorFormError("Please enter the doctor's full name.");
      return;
    }
    if (!doctorFormData.specialization.trim()) {
      setDoctorFormError("Please specify a medical specialization.");
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
        setDoctorLeaves((prev) => {
          const next = {
            ...prev,
            [editingDoctorId]: doctorModalLeaves,
            [updated.full_name]: doctorModalLeaves,
          };
          try {
            localStorage.setItem("natter_hospital_doctor_leaves", JSON.stringify(next));
          } catch (e) {
            console.error("Failed to save leaves to localStorage:", e);
          }
          return next;
        });
        showToast("Doctor details updated");
      } else {
        const created = await apiClient.post<DoctorItem>("/api/v1/doctors", payload);
        setDoctors((prev) => [...prev, created]);
        setDoctorLeaves((prev) => {
          const next = {
            ...prev,
            [created.id]: doctorModalLeaves,
            [created.full_name]: doctorModalLeaves,
          };
          try {
            localStorage.setItem("natter_hospital_doctor_leaves", JSON.stringify(next));
          } catch (e) {
            console.error("Failed to save leaves to localStorage:", e);
          }
          return next;
        });
        showToast("Doctor added to roster");
      }
      setShowDoctorModal(false);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setDoctorFormError(err.message);
      } else {
        setDoctorFormError("Failed to save doctor. Please check required fields.");
      }
    } finally {
      setIsSavingDoctor(false);
    }
  };

  // Doctor Delete Modal State
  const [doctorToDelete, setDoctorToDelete] = useState<{ id: string; name: string } | null>(null);
  const [isDeletingDoctor, setIsDeletingDoctor] = useState(false);

  // Delete Doctor
  const handleRequestDeleteDoctor = (id: string, name: string) => {
    setDoctorToDelete({ id, name });
  };

  const handleConfirmDeleteDoctor = async () => {
    if (!doctorToDelete) return;
    setIsDeletingDoctor(true);
    try {
      await apiClient.delete(`/api/v1/doctors/${doctorToDelete.id}`);
      setDoctors((prev) => prev.filter((d) => d.id !== doctorToDelete.id));
      showToast(`${doctorToDelete.name} removed from roster`);
      setDoctorToDelete(null);
    } catch (err) {
      console.error("Failed to delete doctor:", err);
      showToast("Failed to delete doctor");
    } finally {
      setIsDeletingDoctor(false);
    }
  };

  // Toggle Operating Day Status
  const handleToggleOperatingDay = (dayIndex: number) => {
    setOperatingHours((prev) =>
      prev.map((h) => {
        if (h.day_of_week === dayIndex) {
          const willClose = !h.is_closed;
          return {
            ...h,
            is_closed: willClose,
            open_time: willClose ? null : (customShiftOpen || "09:00"),
            close_time: willClose ? null : (customShiftClose || "20:00"),
          };
        }
        return h;
      })
    );
  };

  // Save Hospital Profile & Operating Hours
  const handleSaveProfileAndHours = async () => {
    setIsSavingProfile(true);

    try {
      const profilePromise = apiClient.patch<TenantData>("/api/v1/tenants/me", {
        phone_number: phoneNumber.trim() || null,
        emergency_contact: emergencyContact.trim() || null,
        address: {
          street: address.street.trim() || undefined,
          city: address.city.trim() || undefined,
          state: address.state.trim() || undefined,
          postal_code: address.postal_code.trim() || undefined,
        },
        timezone: timezone,
      });

      const hoursPayload = operatingHours.map((h) => ({
        day_of_week: h.day_of_week,
        open_time: h.is_closed ? null : h.open_time ? h.open_time.slice(0, 5) : null,
        close_time: h.is_closed ? null : h.close_time ? h.close_time.slice(0, 5) : null,
        is_closed: h.is_closed,
      }));

      const hoursPromise = apiClient.patch<OperatingHoursItem[]>(
        "/api/v1/tenants/me/operating-hours",
        hoursPayload
      );

      const [updatedTenant, updatedHours] = await Promise.all([profilePromise, hoursPromise]);
      setTenant(updatedTenant);
      setOperatingHours(updatedHours);
      showToast("Profile and hours saved successfully");
    } catch (err: unknown) {
      console.error("Failed to save profile:", err);
      showToast("Failed to save profile and hours");
    } finally {
      setIsSavingProfile(false);
    }
  };

  // Calendar-specific helpers & presets
  const now = useMemo(() => new Date(), []);
  const calendarYear = now.getFullYear();
  const calendarMonth = now.getMonth();
  const currentMonthLabel = now.toLocaleString("en-US", { month: "long", year: "numeric" });
  const totalDaysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const firstDayOfMonth = new Date(calendarYear, calendarMonth, 1);
  const startOffset = (firstDayOfMonth.getDay() + 6) % 7;
  const todayDate = now.getDate();

  const handleToggleHoliday = (dayNum: number) => {
    setHolidays((prev) =>
      prev.includes(dayNum) ? prev.filter((d) => d !== dayNum) : [...prev, dayNum]
    );
  };

  const formatHourShort = (timeStr: string | null | undefined): string => {
    if (!timeStr) return "";
    const [hStr] = timeStr.split(":");
    let h = parseInt(hStr, 10);
    if (isNaN(h)) return "";
    const ampm = h >= 12 ? "p" : "a";
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}${ampm}`;
  };

  const formatShortRange = (
    open: string | null | undefined,
    close: string | null | undefined,
    isClosed?: boolean
  ): string => {
    if (isClosed || !open || !close) return "Off";
    return `${formatHourShort(open)}-${formatHourShort(close)}`;
  };

  const formatLegendHours = (open: string | null | undefined, close: string | null | undefined): string => {
    if (!open || !close) return "Open 9 AM – 8 PM";
    const formatAmPm = (t: string) => {
      const [hStr, mStr] = t.split(":");
      let h = parseInt(hStr, 10);
      const ampm = h >= 12 ? "PM" : "AM";
      h = h % 12;
      if (h === 0) h = 12;
      const m = mStr && mStr !== "00" ? `:${mStr}` : "";
      return `${h}${m} ${ampm}`;
    };
    return `Open ${formatAmPm(open)} – ${formatAmPm(close)}`;
  };

  const WEEKDAYS = [
    { index: 0, label: "Mon" },
    { index: 1, label: "Tue" },
    { index: 2, label: "Wed" },
    { index: 3, label: "Thu" },
    { index: 4, label: "Fri" },
    { index: 5, label: "Sat" },
    { index: 6, label: "Sun" },
  ];

  const firstOpenDay = operatingHours.find((h) => !h.is_closed);
  const legendOpenText =
    firstOpenDay && firstOpenDay.open_time && firstOpenDay.close_time
      ? formatLegendHours(firstOpenDay.open_time, firstOpenDay.close_time)
      : "Open 9 AM – 8 PM";

  const applyWeekdaysPreset = () => {
    setOperatingHours((prev) =>
      prev.map((h) => ({
        ...h,
        is_closed: h.day_of_week >= 5,
        open_time: h.day_of_week >= 5 ? null : "09:00",
        close_time: h.day_of_week >= 5 ? null : "17:00",
      }))
    );
    showToast("Weekdays (Mon-Fri 9am-5pm) applied");
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
    showToast("Standard Preset (Mon-Sat 9a-8p, Sun Off) applied");
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
    showToast("All 7 days marked Open (9am-8pm)");
  };

  const applyClearAllPreset = () => {
    setOperatingHours((prev) =>
      prev.map((h) => ({
        ...h,
        is_closed: true,
        open_time: null,
        close_time: null,
      }))
    );
    showToast("All days marked off duty");
  };

  const applyCustomShift = (open: string, close: string) => {
    setCustomShiftOpen(open);
    setCustomShiftClose(close);
    setOperatingHours((prev) =>
      prev.map((h) => {
        if (h.is_closed) return h;
        return { ...h, open_time: open, close_time: close };
      })
    );
    showToast(`Shift updated to ${formatLegendHours(open, close)}`);
    setShowShiftModal(false);
  };

  const totalWeeklyOperatingHours = useMemo(() => {
    let totalMin = 0;
    operatingHours.forEach((h) => {
      if (!h.is_closed && h.open_time && h.close_time) {
        const [h1, m1] = h.open_time.split(":").map(Number);
        const [h2, m2] = h.close_time.split(":").map(Number);
        let diff = h2 * 60 + m2 - (h1 * 60 + m1);
        if (diff > 0) totalMin += diff;
      }
    });
    return Math.round(totalMin / 60);
  }, [operatingHours]);

  const openDaysCount = useMemo(() => {
    let count = 0;
    for (let day = 1; day <= totalDaysInMonth; day++) {
      const dayOfWeek = (startOffset + day - 1) % 7;
      const h = operatingHours.find((item) => item.day_of_week === dayOfWeek);
      const isRegularClosed = h ? h.is_closed : dayOfWeek === 6;
      const isHoliday = holidays.includes(day);
      if (!isRegularClosed && !isHoliday) {
        count++;
      }
    }
    return count;
  }, [totalDaysInMonth, startOffset, operatingHours, holidays]);



  const handleToggleDoctorModalLeave = (dayNum: number) => {
    setDoctorModalLeaves((prev) =>
      prev.includes(dayNum) ? prev.filter((d) => d !== dayNum) : [...prev, dayNum]
    );
  };

  const handleToggleDoctorLeaveOnDate = (doctorId: string, dateNum: number) => {
    const doc = doctors.find((d) => d.id === doctorId || d.full_name === doctorId);
    const docId = doc?.id || doctorId;
    const docName = doc?.full_name || doctorId;
    const currentLeaves = getDoctorLeavesForDoc(docId);
    const isCurrentlyOnLeave = currentLeaves.includes(dateNum);
    const updatedLeaves = isCurrentlyOnLeave
      ? currentLeaves.filter((d: number) => d !== dateNum)
      : [...currentLeaves, dateNum];

    setDoctorLeaves((prev) => {
      const next = {
        ...prev,
        [docId]: updatedLeaves,
        [docName]: updatedLeaves,
      };
      // Keep legacy mock keys (e.g. doc-shah, doc-mehta) in sync
      for (const k of Object.keys(prev)) {
        const keyClean = k.toLowerCase().replace(/^doc-?/, "").replace(/[^a-z0-9]/g, "");
        if (keyClean.length >= 3 && docName.toLowerCase().includes(keyClean)) {
          next[k] = updatedLeaves;
        }
      }
      try {
        localStorage.setItem("natter_hospital_doctor_leaves", JSON.stringify(next));
      } catch (e) {
        console.error("Failed to save doctor leaves to localStorage:", e);
      }
      return next;
    });

    showToast(
      isCurrentlyOnLeave
        ? `Cancelled leave for ${docName} on ${dateNum} November`
        : `Marked ${docName} on leave on ${dateNum} November`
    );
  };

  const handleToggleDoctorModalDay = (dayIndex: number) => {
    setDoctorFormData((prev) => ({
      ...prev,
      availabilities: prev.availabilities.map((a) =>
        a.day_of_week === dayIndex ? { ...a, is_active: !a.is_active } : a
      ),
    }));
  };

  const doctorModalActiveDaysCount = doctorFormData.availabilities.filter((a) => a.is_active).length;

  const doctorModalOpenDaysCount = useMemo(() => {
    let count = 0;
    for (let day = 1; day <= totalDaysInMonth; day++) {
      const dayOfWeek = (startOffset + day - 1) % 7;
      const a = doctorFormData.availabilities.find((item) => item.day_of_week === dayOfWeek);
      const isClosed = !a || !a.is_active;
      const isLeave = doctorModalLeaves.includes(day);
      if (!isClosed && !isLeave) {
        count++;
      }
    }
    return count;
  }, [totalDaysInMonth, startOffset, doctorFormData.availabilities, doctorModalLeaves]);



  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center app-product-bg text-[#150f26] dark:text-[#f6f3ff] font-sans antialiased">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-9 w-9 animate-spin text-[#7c3aed]" />
          <p className="text-xs font-semibold text-[#625b7e] dark:text-[#a29bc2]">
            Loading Clinical Workspace...
          </p>
        </div>
      </div>
    );
  }

  const NAV_ITEMS: {
    id: TabType;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badgeDot?: React.ReactNode;
  }[] = [
    {
      id: "dashboard",
      label: "Dashboard",
      icon: LayoutDashboard,
    },
    {
      id: "doctors",
      label: "Doctors & shifts",
      icon: Stethoscope,
    },
    {
      id: "patients",
      label: "Patient details",
      icon: FileSpreadsheet,
    },
    {
      id: "users",
      label: "User allocation",
      icon: Users,
    },
    {
      id: "voice",
      label: "Voice AI studio",
      icon: Mic,
    },
    {
      id: "profile",
      label: "Hospital profile",
      icon: Building2,
    },
  ];

  return (
    <div className="flex h-screen w-full app-product-bg text-[#150f26] dark:text-[#f6f3ff] font-['Figtree',system-ui,sans-serif] antialiased overflow-hidden">
      {/* =========================================================================
          SLEEK FLOATING CAPSULE SIDEBAR (EXPANDED BY DEFAULT, COLLAPSIBLE VIA TOGGLE)
          Adaptive flex layout that smoothly resizes and moves with the page
          ========================================================================= */}
      <div
        onMouseEnter={() => {
          if (!isSidebarExpanded) setIsSidebarHovered(true);
        }}
        onMouseLeave={() => setIsSidebarHovered(false)}
        className={`shrink-0 z-30 my-3 ml-3.5 h-[calc(100vh-24px)] transition-[width] duration-300 ease-[cubic-bezier(0.2,0,0,1)] ${
          isExpanded ? "w-[260px]" : "w-[72px]"
        }`}
      >
        <aside
          className={`w-full h-full rounded-[36px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] ${
            isExpanded
              ? "shadow-[0_16px_40px_-12px_rgba(21,15,38,0.12)] dark:shadow-[0_16px_40px_-12px_rgba(0,0,0,0.6)]"
              : "shadow-[0_8px_24px_-6px_rgba(21,15,38,0.08)] dark:shadow-[0_8px_24px_-6px_rgba(0,0,0,0.5)]"
          } flex flex-col justify-between py-4 px-2.5 select-none overflow-hidden transition-shadow duration-300`}
        >
          {/* Top: Logo & App Branding */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center">
              <Link
                to="/"
                className="flex items-center h-12 w-full p-1 rounded-2xl hover:bg-slate-100/70 dark:hover:bg-white/5 transition-colors group cursor-pointer overflow-hidden"
              >
                <div className="w-[52px] h-12 shrink-0 grid place-items-center">
                  <div className="w-11 h-11 rounded-[16px] bg-gradient-to-br from-[#7c3aed] to-[#9333ea] grid place-items-center text-white shadow-md shadow-purple-600/30 group-hover:scale-105 transition-transform">
                    <PhoneCall className="h-5 w-5" />
                  </div>
                </div>
                <div
                  className={`min-w-0 flex-1 pl-1 overflow-hidden whitespace-nowrap transition-all duration-300 ease-[cubic-bezier(0.2,0,0,1)] ${
                    isExpanded
                      ? "opacity-100 translate-x-0"
                      : "opacity-0 max-w-0 -translate-x-3 pointer-events-none"
                  }`}
                >
                  <b className="block font-['Bricolage_Grotesque',sans-serif] font-bold text-[14.5px] leading-tight text-[#150f26] dark:text-white whitespace-nowrap">
                    Hospital Voice Agent
                  </b>
                  <small className="text-[#625b7e] dark:text-[#a29bc2] text-[11px] block font-medium whitespace-nowrap">
                    Workspace edition
                  </small>
                </div>
              </Link>
            </div>

            {/* Hairline Divider */}
            <div
              className={`h-[1px] bg-[#e6e0f5] dark:bg-[#2b2347] mx-auto transition-all duration-300 ${
                isExpanded ? "w-[90%] my-2" : "w-7 my-2.5"
              }`}
            />

            {/* Navigation Tabs (Top-to-Bottom Vertical) */}
            <nav className="flex flex-col gap-2">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleTabChange(item.id)}
                    title={!isExpanded ? item.label : undefined}
                    className={`group relative flex items-center h-11 w-full rounded-2xl transition-all duration-300 cursor-pointer overflow-hidden ${
                      isActive
                        ? "bg-[#7c3aed] text-white shadow-md shadow-purple-600/30 font-semibold"
                        : "text-[#150f26] dark:text-[#f6f3ff] hover:text-[#7c3aed] dark:hover:text-purple-300 hover:bg-[#f3f0fb] dark:hover:bg-white/10 font-medium"
                    }`}
                  >
                    {/* Icon Area: Always centered at 52px (exact center of 72px pill) */}
                    <div className="w-[52px] h-11 shrink-0 grid place-items-center relative">
                      <div className="relative">
                        <Icon className="h-5 w-5 transition-transform duration-200 group-hover:scale-110" />
                        {item.badgeDot}
                      </div>
                    </div>

                    {/* Label: Smooth slide & fade without line breaking */}
                    <span
                      className={`whitespace-nowrap text-[13.5px] pr-3 transition-all duration-300 ease-[cubic-bezier(0.2,0,0,1)] ${
                        isExpanded
                          ? "opacity-100 max-w-[170px] translate-x-0"
                          : "opacity-0 max-w-0 -translate-x-3 pointer-events-none"
                      }`}
                    >
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Bottom Controls: Divider, Live Dot, User Profile */}
          <div className="flex flex-col gap-2">
            {/* Hairline Divider */}
            <div
              className={`h-[1px] bg-[#e6e0f5] dark:bg-[#2b2347] mx-auto transition-all duration-300 ${
                isExpanded ? "w-[90%] mb-1" : "w-7 mb-1.5"
              }`}
            />

            {/* Live Status Indicator (Visible in collapsed mode) */}
            {!isExpanded && (
              <div
                className="w-[52px] h-6 shrink-0 grid place-items-center"
                title="AI Voice Agent Active"
              >
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 ring-4 ring-emerald-500/20 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.7)]" />
              </div>
            )}

            {/* User Profile Card */}
            <div
              onClick={() => {
                if (!isSidebarExpanded) setIsSidebarExpanded(true);
              }}
              className="flex items-center h-12 w-full rounded-2xl bg-[#f8f6fc] dark:bg-white/5 border border-[#e6e0f5] dark:border-white/10 hover:border-purple-300 dark:hover:border-purple-500/30 transition-all overflow-hidden cursor-pointer"
            >
              <div className="w-[52px] h-12 shrink-0 grid place-items-center">
                <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-[#7c3aed] to-[#a855f7] text-white font-bold grid place-items-center text-sm shadow-xs">
                  {(user?.full_name || tenant?.name || "B").charAt(0).toUpperCase()}
                </div>
              </div>
              <div
                className={`flex items-center justify-between flex-1 min-w-0 pr-2 whitespace-nowrap transition-all duration-300 ease-[cubic-bezier(0.2,0,0,1)] ${
                  isExpanded
                    ? "opacity-100 max-w-[170px] translate-x-0"
                    : "opacity-0 max-w-0 -translate-x-3 pointer-events-none"
                }`}
              >
                <div className="min-w-0 flex-1 pr-1.5 overflow-hidden">
                  <b className="block text-[13px] text-[#150f26] dark:text-white truncate font-medium">
                    {user?.full_name || "Admin Staff"}
                  </b>
                  <small className="text-[#625b7e] dark:text-[#a29bc2] text-[11px] block truncate">
                    {user?.email || "admin@hospital.org"}
                  </small>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleLogout();
                  }}
                  title="Sign Out"
                  className="text-[#625b7e] hover:text-red-500 dark:text-[#a29bc2] dark:hover:text-red-400 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer shrink-0"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* =========================================================================
          MAIN WORKSPACE CANVAS (Scrollable edge-to-edge container)
          Smoothly adjusts width & padding with sidebar expansion
          ========================================================================= */}
      <main className="flex-1 min-w-0 h-screen overflow-y-auto px-6 sm:px-10 py-6 pb-20 transition-all duration-300 ease-[cubic-bezier(0.2,0,0,1)]">
        <div className="max-w-[1180px] mx-auto space-y-6">
          {/* Top Breadcrumb & Status Bar */}
          {activeTab === "dashboard" ? (
            <header className="bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] rounded-2xl sm:rounded-3xl p-5 sm:px-6 sm:py-5 shadow-[0_4px_20px_-4px_rgba(21,15,38,0.06)] flex items-center justify-between flex-wrap gap-4">
              <div>
                <div className="flex items-center gap-2.5">
                  <h1 className="font-['Bricolage_Grotesque',sans-serif] text-2xl sm:text-[28px] font-bold text-[#150f26] dark:text-white leading-tight">
                    Good evening, {user?.full_name?.split(" ")[0] || "Bhagya"}
                  </h1>
                  {isOperator && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300/50">
                      <ShieldAlert className="h-3 w-3" />
                      <span>Operator (Read-Only)</span>
                    </span>
                  )}
                </div>
                <p className="text-[13.5px] text-[#625b7e] dark:text-[#a29bc2] mt-0.5">
                  Friday, 20 November 2026 &bull; Here&apos;s how your voice agent is performing today
                </p>
              </div>

              <div className="flex items-center gap-3">
                {/* Time Range Pill Toggle */}
                <div className="inline-flex p-1 rounded-xl bg-[#f3f0fb] dark:bg-[#1a1530] border border-[#e6e0f5] dark:border-[#2b2347]">
                  <button
                    type="button"
                    onClick={() => setAnalyticsRange("today")}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      analyticsRange === "today"
                        ? "bg-[#6d28d9] text-white shadow-xs"
                        : "text-[#625b7e] dark:text-[#a29bc2] hover:text-[#150f26] dark:hover:text-white"
                    }`}
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnalyticsRange(7)}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      analyticsRange === 7
                        ? "bg-[#6d28d9] text-white shadow-xs"
                        : "text-[#625b7e] dark:text-[#a29bc2] hover:text-[#150f26] dark:hover:text-white"
                    }`}
                  >
                    7 days
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnalyticsRange(30)}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      analyticsRange === 30
                        ? "bg-[#6d28d9] text-white shadow-xs"
                        : "text-[#625b7e] dark:text-[#a29bc2] hover:text-[#150f26] dark:hover:text-white"
                    }`}
                  >
                    30 days
                  </button>
                </div>

                {/* Test Voice Agent CTA */}
                <button
                  type="button"
                  onClick={() => handleTabChange("voice")}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#6d28d9] hover:bg-[#5b21b6] text-white font-semibold text-xs shadow-md shadow-purple-600/30 hover:brightness-105 active:scale-95 transition-all cursor-pointer"
                >
                  <Phone className="h-3.5 w-3.5" />
                  <span>Test voice agent</span>
                </button>
              </div>
            </header>
          ) : (
            <header className="bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] rounded-2xl sm:rounded-3xl p-5 sm:px-6 sm:py-5 shadow-[0_4px_20px_-4px_rgba(21,15,38,0.06)] flex items-center justify-between flex-wrap gap-4">
              <div>
                <div className="flex items-center gap-2.5">
                  <h1 className="font-['Bricolage_Grotesque',sans-serif] text-2xl sm:text-[28px] font-bold text-[#150f26] dark:text-white leading-tight">
                    {activeTab === "doctors" && "Doctors and shifts"}
                    {activeTab === "patients" && "Patient details & records"}
                    {activeTab === "users" && "User allocation & staff access"}
                    {activeTab === "voice" && "Voice AI studio"}
                    {activeTab === "profile" && "Hospital profile"}
                  </h1>
                  {isOperator && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300/50">
                      <ShieldAlert className="h-3 w-3" />
                      <span>Operator (Read-Only)</span>
                    </span>
                  )}
                </div>
                <p className="text-[13.5px] text-[#625b7e] dark:text-[#a29bc2] mt-0.5">
                  {activeTab === "doctors" && "Manage doctors, fees and weekly availability"}
                  {activeTab === "patients" && "Directory, Excel bulk import/export, and record tracking"}
                  {activeTab === "users" && "Invite team members and manage staff operator permissions"}
                  {activeTab === "voice" && "Try a live simulated phone call with your AI agent"}
                  {activeTab === "profile" && "Contact lines, location and clinic operating hours"}
                </p>
              </div>

              {/* Main Header Right Side Actions: Doctor Tab */}
              {activeTab === "doctors" && (
                <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                  <button
                    type="button"
                    onClick={() => fetchDoctors(doctorSearchQuery, selectedSpecialty)}
                    disabled={isSearchingDoctors}
                    className="p-2.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#fcfaff] dark:bg-white/5 hover:bg-white dark:hover:bg-white/10 text-[#150f26] dark:text-white text-xs font-semibold transition-all disabled:opacity-40 cursor-pointer"
                    title="Refresh Doctors List"
                  >
                    <RefreshCw className={`h-4 w-4 text-[#7c3aed] ${isSearchingDoctors ? "animate-spin" : ""}`} />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDoctorViewModeChange(doctorViewMode === "table" ? "calendar" : "table")}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#fcfaff] dark:bg-white/5 hover:bg-white dark:hover:bg-white/10 text-xs font-semibold text-[#7c3aed] transition-all cursor-pointer"
                    title={doctorViewMode === "table" ? "Switch to Duty Calendar & Dashboard" : "Switch to Table View"}
                  >
                    {doctorViewMode === "table" ? (
                      <>
                        <Calendar className="h-4 w-4 text-[#7c3aed]" />
                        <span>View Duty Calendar</span>
                      </>
                    ) : (
                      <>
                        <List className="h-4 w-4 text-[#7c3aed]" />
                        <span>View Doctor Table</span>
                      </>
                    )}
                  </button>

                  {!isOperator && (
                    <button
                      type="button"
                      onClick={handleOpenAddDoctorModal}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-[#7c3aed] to-[#9333ea] text-white hover:brightness-105 shadow-md shadow-purple-600/30 transition-all cursor-pointer"
                    >
                      <Plus className="h-4 w-4" />
                      <span>Add Doctor</span>
                    </button>
                  )}
                </div>
              )}

              {/* Portal Target for Patient, User, and Voice Tab Main Header Actions */}
              {(activeTab === "patients" || activeTab === "users" || activeTab === "voice") && (
                <div
                  ref={setHeaderActionsPortalNode}
                  id="header-actions-portal"
                  className="flex items-center gap-2 sm:gap-3 flex-wrap"
                />
              )}

              {/* Main Header Right Side Actions: Profile Tab */}
              {activeTab === "profile" && (
                <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                  {isOperator ? (
                    <span className="text-xs text-amber-700 dark:text-amber-400 font-medium bg-amber-50 dark:bg-amber-950/30 px-3.5 py-2.5 rounded-xl border border-amber-200 dark:border-amber-900/30">
                      Operator (Read-Only)
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={isSavingProfile}
                      onClick={handleSaveProfileAndHours}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#6d28d9] to-[#9333ea] text-white font-bold text-xs shadow-md shadow-purple-600/30 hover:brightness-105 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                    >
                      {isSavingProfile ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      <span>Save Profile &amp; Calendar</span>
                    </button>
                  )}
                </div>
              )}
            </header>
          )}

          {/* =========================================================================
              VIEW 1: DASHBOARD (Matching Reference UI)
              ========================================================================= */}
          {activeTab === "dashboard" && (
            <div className="space-y-6">
              {/* Row 1: 5 Metric KPI Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
                {/* 1. Calls today */}
                <div className="p-4 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-xs flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <small className="text-[#625b7e] dark:text-[#a29bc2] font-medium text-xs">
                      Calls today
                    </small>
                    <div className="w-6 h-6 rounded-lg bg-purple-50 dark:bg-purple-950/40 text-[#7c3aed] flex items-center justify-center">
                      <Phone className="h-3 w-3" />
                    </div>
                  </div>
                  <div className="mt-2 mb-1">
                    <span className="font-['Bricolage_Grotesque',sans-serif] text-[26px] font-bold text-[#150f26] dark:text-white leading-tight">
                      148
                    </span>
                  </div>
                  <div className="text-[11.5px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <span>+ 12%</span>
                    <span className="text-[#625b7e] dark:text-[#a29bc2] font-normal">vs yesterday</span>
                  </div>
                </div>

                {/* 2. Appointments booked */}
                <div className="p-4 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-xs flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <small className="text-[#625b7e] dark:text-[#a29bc2] font-medium text-xs">
                      Appointments booked
                    </small>
                    <div className="w-6 h-6 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 flex items-center justify-center">
                      <Calendar className="h-3 w-3" />
                    </div>
                  </div>
                  <div className="mt-2 mb-1">
                    <span className="font-['Bricolage_Grotesque',sans-serif] text-[26px] font-bold text-[#150f26] dark:text-white leading-tight">
                      63
                    </span>
                  </div>
                  <div className="text-[11.5px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <span>+ 8%</span>
                    <span className="text-[#625b7e] dark:text-[#a29bc2] font-normal">vs yesterday</span>
                  </div>
                </div>

                {/* 3. Booking conversion */}
                <div className="p-4 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-xs flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <small className="text-[#625b7e] dark:text-[#a29bc2] font-medium text-xs">
                      Booking conversion
                    </small>
                    <div className="w-6 h-6 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-600 flex items-center justify-center">
                      <Target className="h-3 w-3" />
                    </div>
                  </div>
                  <div className="mt-2 mb-1">
                    <span className="font-['Bricolage_Grotesque',sans-serif] text-[26px] font-bold text-[#150f26] dark:text-white leading-tight">
                      42.6%
                    </span>
                  </div>
                  <div className="text-[11.5px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <span>+ 3.1pt</span>
                    <span className="text-[#625b7e] dark:text-[#a29bc2] font-normal">vs yesterday</span>
                  </div>
                </div>

                {/* 4. Avg call duration */}
                <div className="p-4 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-xs flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <small className="text-[#625b7e] dark:text-[#a29bc2] font-medium text-xs">
                      Avg call duration
                    </small>
                    <div className="w-6 h-6 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-600 flex items-center justify-center">
                      <Clock className="h-3 w-3" />
                    </div>
                  </div>
                  <div className="mt-2 mb-1">
                    <span className="font-['Bricolage_Grotesque',sans-serif] text-[26px] font-bold text-[#150f26] dark:text-white leading-tight">
                      2m 18s
                    </span>
                  </div>
                  <div className="text-[11.5px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <span>✓ 6s</span>
                    <span className="text-[#625b7e] dark:text-[#a29bc2] font-normal">faster than yesterday</span>
                  </div>
                </div>

                {/* 5. Escalations */}
                <div className="p-4 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-xs flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <small className="text-[#625b7e] dark:text-[#a29bc2] font-medium text-xs">
                      Escalations
                    </small>
                    <div className="w-6 h-6 rounded-lg bg-red-50 dark:bg-red-950/40 text-red-500 flex items-center justify-center">
                      <AlertTriangle className="h-3 w-3" />
                    </div>
                  </div>
                  <div className="mt-2 mb-1">
                    <span className="font-['Bricolage_Grotesque',sans-serif] text-[26px] font-bold text-[#150f26] dark:text-white leading-tight">
                      4
                    </span>
                  </div>
                  <div className="text-[11.5px] font-semibold text-red-500 dark:text-red-400 flex items-center gap-1">
                    <span>↑ 2</span>
                    <span className="text-[#625b7e] dark:text-[#a29bc2] font-normal">need follow-up</span>
                  </div>
                </div>
              </div>

              {/* Doctor Availability (40%) + Call Outcomes (30%) + Languages (30%) */}
              <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr_1fr] gap-4">
                {/* 1. Doctor availability */}
                <div className="p-6 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="font-['Bricolage_Grotesque',sans-serif] font-bold text-base text-[#150f26] dark:text-white">
                          Doctor availability
                        </h3>
                        <p className="text-xs text-[#625b7e] dark:text-[#a29bc2]">
                          Slots filled today
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleTabChange("doctors")}
                        className="text-xs font-semibold text-[#7c3aed] hover:underline cursor-pointer"
                      >
                        Manage shifts &gt;
                      </button>
                    </div>

                    <div className="space-y-4">
                      {/* Doctor 1 */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 font-bold text-[10px] flex items-center justify-center">
                              AS
                            </span>
                            <div>
                              <b className="text-[#150f26] dark:text-white font-semibold">Dr. Anita Sharma</b>
                              <span className="text-[11px] text-[#625b7e] dark:text-[#a29bc2] block -mt-0.5">General Physician</span>
                            </div>
                          </div>
                          <b className="text-[#150f26] dark:text-white font-semibold">18 / 24</b>
                        </div>
                        <div className="h-1.5 rounded-full bg-[#f3f0fb] dark:bg-[#1a1530] overflow-hidden">
                          <div className="h-full rounded-full bg-[#7c3aed]" style={{ width: "75%" }} />
                        </div>
                        <div className="flex justify-between text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
                          <span>75% booked</span>
                          <span>Next free: 5:10 PM</span>
                        </div>
                      </div>

                      {/* Doctor 2 */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 font-bold text-[10px] flex items-center justify-center">
                              RM
                            </span>
                            <div>
                              <b className="text-[#150f26] dark:text-white font-semibold">Dr. Rohan Mehta</b>
                              <span className="text-[11px] text-[#625b7e] dark:text-[#a29bc2] block -mt-0.5">Dentistry</span>
                            </div>
                          </div>
                          <b className="text-[#150f26] dark:text-white font-semibold">11 / 16</b>
                        </div>
                        <div className="h-1.5 rounded-full bg-[#f3f0fb] dark:bg-[#1a1530] overflow-hidden">
                          <div className="h-full rounded-full bg-[#7c3aed]" style={{ width: "69%" }} />
                        </div>
                        <div className="flex justify-between text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
                          <span>69% booked</span>
                          <span>Next free: 6:15 PM</span>
                        </div>
                      </div>

                      {/* Doctor 3 */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 font-bold text-[10px] flex items-center justify-center">
                              KI
                            </span>
                            <div>
                              <b className="text-[#150f26] dark:text-white font-semibold">Dr. Kavya Iyer</b>
                              <span className="text-[11px] text-[#625b7e] dark:text-[#a29bc2] block -mt-0.5">Pediatrics</span>
                            </div>
                          </div>
                          <b className="text-[#150f26] dark:text-white font-semibold">20 / 20</b>
                        </div>
                        <div className="h-1.5 rounded-full bg-[#f3f0fb] dark:bg-[#1a1530] overflow-hidden">
                          <div className="h-full rounded-full bg-amber-500" style={{ width: "100%" }} />
                        </div>
                        <div className="flex justify-between text-[11px]">
                          <span className="text-amber-600 dark:text-amber-400 font-semibold">Fully booked</span>
                          <span className="text-[#625b7e] dark:text-[#a29bc2]">Next free: Tomorrow 9:00 AM</span>
                        </div>
                      </div>

                      {/* Doctor 4 */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 font-bold text-[10px] flex items-center justify-center">
                              IQ
                            </span>
                            <div>
                              <b className="text-[#150f26] dark:text-white font-semibold">Dr. Imran Qureshi</b>
                              <span className="text-[11px] text-[#625b7e] dark:text-[#a29bc2] block -mt-0.5">Orthopedics</span>
                            </div>
                          </div>
                          <b className="text-[#150f26] dark:text-white font-semibold">6 / 16</b>
                        </div>
                        <div className="h-1.5 rounded-full bg-[#f3f0fb] dark:bg-[#1a1530] overflow-hidden">
                          <div className="h-full rounded-full bg-[#7c3aed]" style={{ width: "38%" }} />
                        </div>
                        <div className="flex justify-between text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
                          <span>38% booked</span>
                          <span>Next free: 5:45 PM</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. Call outcomes */}
                <div className="p-6 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm flex flex-col justify-between">
                  <div>
                    <h3 className="font-['Bricolage_Grotesque',sans-serif] font-bold text-base text-[#150f26] dark:text-white">
                      Call outcomes
                    </h3>
                    <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] mb-4">
                      How today&apos;s calls ended
                    </p>

                    {/* Donut and Legend */}
                    <div className="flex items-center justify-center gap-5 py-2">
                      <div className="relative w-32 h-32 shrink-0">
                        <svg viewBox="0 0 42 42" className="w-full h-full -rotate-90">
                          <circle
                            cx="21"
                            cy="21"
                            r="15.915"
                            fill="none"
                            className="stroke-[#f3f0fb] dark:stroke-[#1a1530]"
                            strokeWidth="5.5"
                          />
                          {/* Booked 42% */}
                          <circle
                            cx="21"
                            cy="21"
                            r="15.915"
                            fill="none"
                            stroke="#6d28d9"
                            strokeWidth="5.5"
                            strokeDasharray="42 58"
                            strokeDashoffset="25"
                          />
                          {/* Info shared 34% */}
                          <circle
                            cx="21"
                            cy="21"
                            r="15.915"
                            fill="none"
                            stroke="#3b82f6"
                            strokeWidth="5.5"
                            strokeDasharray="34 66"
                            strokeDashoffset="-17"
                          />
                          {/* Escalated 6% */}
                          <circle
                            cx="21"
                            cy="21"
                            r="15.915"
                            fill="none"
                            stroke="#f97316"
                            strokeWidth="5.5"
                            strokeDasharray="6 94"
                            strokeDashoffset="-51"
                          />
                          {/* Dropped 18% */}
                          <circle
                            cx="21"
                            cy="21"
                            r="15.915"
                            fill="none"
                            stroke="#94a3b8"
                            strokeWidth="5.5"
                            strokeDasharray="18 82"
                            strokeDashoffset="-57"
                          />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="font-['Bricolage_Grotesque',sans-serif] font-bold text-lg text-[#150f26] dark:text-white leading-tight">
                            148
                          </span>
                          <span className="text-[10px] text-[#625b7e] dark:text-[#a29bc2]">calls today</span>
                        </div>
                      </div>

                      <div className="space-y-1.5 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-[#6d28d9]" />
                          <span className="text-[#625b7e] dark:text-[#a29bc2]">Booked</span>
                          <b className="ml-auto font-bold text-[#150f26] dark:text-white">42%</b>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-[#3b82f6]" />
                          <span className="text-[#625b7e] dark:text-[#a29bc2]">Info shared</span>
                          <b className="ml-auto font-bold text-[#150f26] dark:text-white">34%</b>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-[#f97316]" />
                          <span className="text-[#625b7e] dark:text-[#a29bc2]">Escalated</span>
                          <b className="ml-auto font-bold text-[#150f26] dark:text-white">6%</b>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-[#94a3b8]" />
                          <span className="text-[#625b7e] dark:text-[#a29bc2]">Dropped</span>
                          <b className="ml-auto font-bold text-[#150f26] dark:text-white">18%</b>
                        </div>
                      </div>
                    </div>

                    {/* 2 Stat Sub-boxes */}
                    <div className="grid grid-cols-2 gap-2.5 mt-3 pt-3 border-t border-[#e6e0f5] dark:border-[#2b2347]">
                      <div className="p-2.5 rounded-xl bg-[#faf8ff] dark:bg-[#161226] border border-[#e6e0f5] dark:border-[#2b2347]">
                        <div className="font-['Bricolage_Grotesque',sans-serif] text-base font-bold text-[#150f26] dark:text-white">
                          94%
                        </div>
                        <div className="text-[10px] text-[#625b7e] dark:text-[#a29bc2] leading-tight mt-0.5">
                          Resolved without a human
                        </div>
                      </div>

                      <div className="p-2.5 rounded-xl bg-[#faf8ff] dark:bg-[#161226] border border-[#e6e0f5] dark:border-[#2b2347]">
                        <div className="font-['Bricolage_Grotesque',sans-serif] text-base font-bold text-[#150f26] dark:text-white">
                          2m 18s
                        </div>
                        <div className="text-[10px] text-[#625b7e] dark:text-[#a29bc2] leading-tight mt-0.5">
                          Avg handling time
                        </div>
                      </div>
                    </div>
                  </div>

                  <p className="text-[10.5px] text-[#86809e] dark:text-[#7f7899] mt-3 leading-relaxed">
                    Dropped calls are down from 24% yesterday. Most drop-offs happen in the first 20 seconds.
                  </p>
                </div>

                {/* 3. Languages */}
                <div className="p-6 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm flex flex-col justify-between">
                  <div>
                    <h3 className="font-['Bricolage_Grotesque',sans-serif] font-bold text-base text-[#150f26] dark:text-white">
                      Languages
                    </h3>
                    <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] mb-4">
                      Caller language mix
                    </p>

                    {/* Bars Mix */}
                    <div className="space-y-3.5">
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs font-medium">
                          <span className="text-[#150f26] dark:text-white">Hinglish</span>
                          <b className="text-[#150f26] dark:text-white font-bold">52%</b>
                        </div>
                        <div className="h-2 rounded-full bg-[#f3f0fb] dark:bg-[#1a1530] overflow-hidden">
                          <div className="h-full rounded-full bg-[#7c3aed]" style={{ width: "52%" }} />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between text-xs font-medium">
                          <span className="text-[#150f26] dark:text-white">Hindi</span>
                          <b className="text-[#150f26] dark:text-white font-bold">31%</b>
                        </div>
                        <div className="h-2 rounded-full bg-[#f3f0fb] dark:bg-[#1a1530] overflow-hidden">
                          <div className="h-full rounded-full bg-[#38bdf8]" style={{ width: "31%" }} />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between text-xs font-medium">
                          <span className="text-[#150f26] dark:text-white">English</span>
                          <b className="text-[#150f26] dark:text-white font-bold">17%</b>
                        </div>
                        <div className="h-2 rounded-full bg-[#f3f0fb] dark:bg-[#1a1530] overflow-hidden">
                          <div className="h-full rounded-full bg-[#c084fc]" style={{ width: "17%" }} />
                        </div>
                      </div>
                    </div>

                    {/* Booking Rate By Language */}
                    <div className="mt-6 pt-4 border-t border-[#e6e0f5] dark:border-[#2b2347]">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[#625b7e] dark:text-[#a29bc2] mb-2.5">
                        Booking rate by language
                      </div>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between">
                          <span className="text-[#625b7e] dark:text-[#a29bc2]">Hinglish</span>
                          <b className="text-[#150f26] dark:text-white font-bold">46%</b>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#625b7e] dark:text-[#a29bc2]">Hindi</span>
                          <b className="text-[#150f26] dark:text-white font-bold">41%</b>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#625b7e] dark:text-[#a29bc2]">English</span>
                          <b className="text-[#150f26] dark:text-white font-bold">38%</b>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Row 4: Recent calls (65%) + Needs attention (35%) */}
              <div className="grid grid-cols-1 lg:grid-cols-[1.85fr_1fr] gap-4">
                {/* Recent calls table */}
                <div className="p-6 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="font-['Bricolage_Grotesque',sans-serif] font-bold text-base text-[#150f26] dark:text-white">
                          Recent calls
                        </h3>
                        <p className="text-xs text-[#625b7e] dark:text-[#a29bc2]">
                          Latest conversations handled by the agent
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleTabChange("voice")}
                        className="text-xs font-semibold text-[#7c3aed] hover:underline cursor-pointer"
                      >
                        View all calls &gt;
                      </button>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-[#e6e0f5] dark:border-[#2b2347] text-[10.5px] uppercase tracking-wider text-[#625b7e] dark:text-[#a29bc2]">
                            <th className="py-2.5 font-semibold">Time</th>
                            <th className="py-2.5 font-semibold">Caller</th>
                            <th className="py-2.5 font-semibold">Intent</th>
                            <th className="py-2.5 font-semibold">Outcome</th>
                            <th className="py-2.5 font-semibold">Duration</th>
                            <th className="py-2.5 font-semibold text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#ece8f8] dark:divide-[#241d38]">
                          {/* Row 1 */}
                          <tr>
                            <td className="py-3 text-[#625b7e] dark:text-[#a29bc2] font-mono text-[11px]">5:24 PM</td>
                            <td className="py-3">
                              <div className="font-bold text-[#150f26] dark:text-white">+91 97••• •5521</div>
                              <div className="text-[10px] text-[#625b7e] dark:text-[#a29bc2]">Hinglish</div>
                            </td>
                            <td className="py-3 text-[#150f26] dark:text-white">Book appointment</td>
                            <td className="py-3">
                              <span className="inline-block px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300">
                                Booked
                              </span>
                            </td>
                            <td className="py-3 font-mono text-[11px] text-[#625b7e] dark:text-[#a29bc2]">2m 41s</td>
                            <td className="py-3 text-right">
                              <button
                                type="button"
                                onClick={() => handleTabChange("voice")}
                                className="p-1 rounded-md text-[#625b7e] hover:text-[#7c3aed] transition-colors cursor-pointer"
                              >
                                <FileText className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>

                          {/* Row 2 */}
                          <tr>
                            <td className="py-3 text-[#625b7e] dark:text-[#a29bc2] font-mono text-[11px]">5:11 PM</td>
                            <td className="py-3">
                              <div className="font-bold text-[#150f26] dark:text-white">+91 98••• •0192</div>
                              <div className="text-[10px] text-[#625b7e] dark:text-[#a29bc2]">Hindi</div>
                            </td>
                            <td className="py-3 text-[#150f26] dark:text-white">Clinic timings</td>
                            <td className="py-3">
                              <span className="inline-block px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300">
                                Info shared
                              </span>
                            </td>
                            <td className="py-3 font-mono text-[11px] text-[#625b7e] dark:text-[#a29bc2]">1m 05s</td>
                            <td className="py-3 text-right">
                              <button
                                type="button"
                                onClick={() => handleTabChange("voice")}
                                className="p-1 rounded-md text-[#625b7e] hover:text-[#7c3aed] transition-colors cursor-pointer"
                              >
                                <FileText className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>

                          {/* Row 3 */}
                          <tr>
                            <td className="py-3 text-[#625b7e] dark:text-[#a29bc2] font-mono text-[11px]">4:58 PM</td>
                            <td className="py-3">
                              <div className="font-bold text-[#150f26] dark:text-white">+91 90••• •3347</div>
                              <div className="text-[10px] text-[#625b7e] dark:text-[#a29bc2]">English</div>
                            </td>
                            <td className="py-3 text-[#150f26] dark:text-white font-medium">Emergency &bull; chest pain</td>
                            <td className="py-3">
                              <span className="inline-block px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-300">
                                Escalated
                              </span>
                            </td>
                            <td className="py-3 font-mono text-[11px] text-[#625b7e] dark:text-[#a29bc2]">0m 52s</td>
                            <td className="py-3 text-right">
                              <button
                                type="button"
                                onClick={() => handleTabChange("voice")}
                                className="p-1 rounded-md text-[#625b7e] hover:text-[#7c3aed] transition-colors cursor-pointer"
                              >
                                <FileText className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>

                          {/* Row 4 */}
                          <tr>
                            <td className="py-3 text-[#625b7e] dark:text-[#a29bc2] font-mono text-[11px]">4:40 PM</td>
                            <td className="py-3">
                              <div className="font-bold text-[#150f26] dark:text-white">+91 99••• •8810</div>
                              <div className="text-[10px] text-[#625b7e] dark:text-[#a29bc2]">English</div>
                            </td>
                            <td className="py-3 text-[#150f26] dark:text-white">Reschedule visit</td>
                            <td className="py-3">
                              <span className="inline-block px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300">
                                Booked
                              </span>
                            </td>
                            <td className="py-3 font-mono text-[11px] text-[#625b7e] dark:text-[#a29bc2]">2m 12s</td>
                            <td className="py-3 text-right">
                              <button
                                type="button"
                                onClick={() => handleTabChange("voice")}
                                className="p-1 rounded-md text-[#625b7e] hover:text-[#7c3aed] transition-colors cursor-pointer"
                              >
                                <FileText className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>

                          {/* Row 5 */}
                          <tr>
                            <td className="py-3 text-[#625b7e] dark:text-[#a29bc2] font-mono text-[11px]">4:22 PM</td>
                            <td className="py-3">
                              <div className="font-bold text-[#150f26] dark:text-white">+91 95••• •6403</div>
                              <div className="text-[10px] text-[#625b7e] dark:text-[#a29bc2]">Hindi</div>
                            </td>
                            <td className="py-3 text-[#150f26] dark:text-white">Doctor availability</td>
                            <td className="py-3">
                              <span className="inline-block px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                                Dropped
                              </span>
                            </td>
                            <td className="py-3 font-mono text-[11px] text-[#625b7e] dark:text-[#a29bc2]">0m 18s</td>
                            <td className="py-3 text-right">
                              <button
                                type="button"
                                onClick={() => handleTabChange("voice")}
                                className="p-1 rounded-md text-[#625b7e] hover:text-[#7c3aed] transition-colors cursor-pointer"
                              >
                                <FileText className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* Needs attention */}
                <div className="p-6 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm flex flex-col justify-between">
                  <div>
                    <h3 className="font-['Bricolage_Grotesque',sans-serif] font-bold text-base text-[#150f26] dark:text-white">
                      Needs attention
                    </h3>
                    <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] mb-4">
                      3 items waiting on you
                    </p>

                    <div className="space-y-3">
                      {/* Item 1 */}
                      <div className="p-3.5 rounded-xl border border-red-200/80 dark:border-red-900/40 bg-red-50/40 dark:bg-red-950/20 space-y-2.5">
                        <div className="flex items-start gap-2.5">
                          <div className="w-6 h-6 rounded-md bg-red-100 dark:bg-red-950/60 text-red-500 flex items-center justify-center shrink-0 mt-0.5">
                            <AlertTriangle className="h-3.5 w-3.5" />
                          </div>
                          <div>
                            <div className="text-xs font-bold text-[#150f26] dark:text-white">
                              Emergency call escalated
                            </div>
                            <div className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
                              Chest pain reported &bull; 4:58 PM
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => handleTabChange("voice")}
                            className="px-3 py-1 rounded-lg bg-[#6d28d9] hover:bg-[#5b21b6] text-white text-[11px] font-semibold transition-all cursor-pointer"
                          >
                            Call back
                          </button>
                          <button
                            type="button"
                            onClick={() => handleTabChange("voice")}
                            className="px-3 py-1 rounded-lg border border-[#e6e0f5] dark:border-[#2b2347] text-[#150f26] dark:text-white text-[11px] font-medium hover:bg-white dark:hover:bg-[#1e1736] transition-all cursor-pointer"
                          >
                            Transcript
                          </button>
                        </div>
                      </div>

                      {/* Item 2 */}
                      <div className="p-3.5 rounded-xl border border-amber-200/80 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/20 space-y-2.5">
                        <div className="flex items-start gap-2.5">
                          <div className="w-6 h-6 rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-600 flex items-center justify-center shrink-0 mt-0.5">
                            <Calendar className="h-3.5 w-3.5" />
                          </div>
                          <div>
                            <div className="text-xs font-bold text-[#150f26] dark:text-white">
                              2 bookings failed
                            </div>
                            <div className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
                              Dr. Kavya Iyer is fully booked today
                            </div>
                          </div>
                        </div>
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={() => handleTabChange("doctors")}
                            className="px-3 py-1 rounded-lg border border-[#e6e0f5] dark:border-[#2b2347] text-[#150f26] dark:text-white text-[11px] font-medium hover:bg-white dark:hover:bg-[#1e1736] transition-all cursor-pointer"
                          >
                            Open schedule
                          </button>
                        </div>
                      </div>

                      {/* Item 3 */}
                      <div className="p-3.5 rounded-xl border border-blue-200/80 dark:border-blue-900/40 bg-blue-50/40 dark:bg-blue-950/20 space-y-2.5">
                        <div className="flex items-start gap-2.5">
                          <div className="w-6 h-6 rounded-md bg-blue-100 dark:bg-blue-950/60 text-blue-600 flex items-center justify-center shrink-0 mt-0.5">
                            <Phone className="h-3.5 w-3.5" />
                          </div>
                          <div>
                            <div className="text-xs font-bold text-[#150f26] dark:text-white">
                              3 callbacks pending
                            </div>
                            <div className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
                              Patients asked for a human follow-up
                            </div>
                          </div>
                        </div>
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={() => handleTabChange("voice")}
                            className="px-3 py-1 rounded-lg border border-[#e6e0f5] dark:border-[#2b2347] text-[#150f26] dark:text-white text-[11px] font-medium hover:bg-white dark:hover:bg-[#1e1736] transition-all cursor-pointer"
                          >
                            Review
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Row 5: Telemetry Footer Bar */}
              <div className="p-4 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center flex-wrap gap-4 text-xs">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#d1fae5] dark:bg-[rgba(16,185,129,0.16)] text-[#059669] dark:text-[#34d399]">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    All services running
                  </span>
                  <span className="text-[#625b7e] dark:text-[#a29bc2] flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    API server <b className="text-[#150f26] dark:text-white font-semibold">42 ms</b>
                  </span>
                  <span className="text-[#625b7e] dark:text-[#a29bc2] flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    Database <b className="text-[#150f26] dark:text-white font-semibold">6 ms</b>
                  </span>
                  <span className="text-[#625b7e] dark:text-[#a29bc2] flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    Task worker <b className="text-[#150f26] dark:text-white font-semibold">0 queued</b>
                  </span>
                </div>

                <div className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
                  Last checked 10 seconds ago
                </div>
              </div>
            </div>
          )}

          {/* =========================================================================
              VIEW 2: DOCTORS & SHIFTS (Exact Match with PatientsTab Theme & Layout)
              ========================================================================= */}
          {activeTab === "doctors" && (
            <div className="space-y-6">
              {/* Operator Read-Only Banner */}
              {isOperator && (
                <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-500 flex items-center gap-3">
                  <ShieldAlert className="h-5 w-5 shrink-0" />
                  <div className="text-xs sm:text-sm">
                    <span className="font-semibold">Operator View Only:</span> You have read-only access. You can view doctor schedules, fees, and shifts.
                  </div>
                </div>
              )}

              {/* VIEW A: ZOHO PEOPLE-STYLE DAY-WISE DUTY ROSTER DASHBOARD */}
              {doctorViewMode === "calendar" ? (
                <DutyRosterDashboard
                  doctors={doctors}
                  selectedDate={selectedRosterDate}
                  onSelectDate={handleSelectRosterDate}
                  doctorLeaves={doctorLeaves}
                  onToggleLeave={handleToggleDoctorLeaveOnDate}
                  onOpenEditDoctor={handleOpenEditDoctorModal}
                  onOpenAddDoctor={handleOpenAddDoctorModal}
                  onSwitchToTable={() => handleDoctorViewModeChange("table")}
                  isOperator={isOperator}
                  operatingHours={operatingHours}
                  showToast={showToast}
                />
              ) : (
                /* VIEW B: DOCTOR ROSTER TABLE (Clean Table starting directly with Search & Filters) */
                <div className="p-6 rounded-[24px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm space-y-6">
                  {/* Filter & Search Bar */}
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                    <div className="sm:col-span-8 relative">
                      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#a29bc2]" />
                      <input
                        type="text"
                        value={doctorSearchQuery}
                        onChange={(e) => setDoctorSearchQuery(e.target.value)}
                        placeholder="Search doctors by name or specialization..."
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#fcfaff] dark:bg-white/5 border border-[#e6e0f5] dark:border-[#2b2347] text-xs sm:text-sm text-[#150f26] dark:text-white placeholder:text-[#a29bc2] focus:outline-none focus:border-[#7c3aed] transition-colors"
                      />
                    </div>
                    <div className="sm:col-span-4">
                      <CustomSelect
                        value={selectedSpecialty}
                        onChange={(val) => setSelectedSpecialty(val)}
                        options={[
                          { value: "", label: "All Specializations" },
                          ...allSpecialties.map((spec) => ({ value: spec, label: spec })),
                        ]}
                      />
                    </div>
                  </div>

                  {/* Doctor Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#fcfaff] dark:bg-white/[0.02] border-b border-[#e6e0f5] dark:border-[#2b2347] text-[#625b7e] dark:text-[#a29bc2] uppercase font-semibold text-[11px] tracking-wider">
                        <tr>
                          <th className="py-3.5 px-4 text-center w-12 font-mono">#</th>
                          <th className="py-3.5 px-5">Doctor Name</th>
                          <th className="py-3.5 px-4">Specialization</th>
                          <th className="py-3.5 px-4">Fee &amp; Slot</th>
                          <th className="py-3.5 px-4">Weekly Schedule</th>
                          <th className="py-3.5 px-4">Status</th>
                          {!isOperator && <th className="py-3.5 px-5 text-right">Actions</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#f0ebfa] dark:divide-[#251e3e]">
                        {doctors.map((doc, docIdx) => {
                          const activeShiftsCount =
                            doc.availabilities?.filter((a) => a.is_available).length || 0;
                          const initial =
                            doc.full_name.replace(/^Dr\.?\s*/i, "").charAt(0).toUpperCase() || "D";

                          return (
                            <tr
                              key={doc.id}
                              className="hover:bg-[#fbf9ff] dark:hover:bg-white/[0.02] transition-colors"
                            >
                              {/* Serial Number */}
                              <td className="py-3.5 px-4 text-center font-mono text-[11px] font-bold text-[#8b84a6] dark:text-[#7a7299]">
                                {docIdx + 1}
                              </td>

                              {/* Doctor Name & Avatar */}
                              <td className="py-3.5 px-5 whitespace-nowrap">
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 rounded-xl bg-purple-100 dark:bg-purple-950/70 text-[#7c3aed] dark:text-purple-300 font-bold grid place-items-center text-xs shrink-0">
                                    {initial}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="font-semibold text-[#150f26] dark:text-white">
                                      {doc.full_name}
                                    </div>
                                    <div className="text-[11px] text-[#625b7e] dark:text-[#a29bc2] font-mono">
                                      {doc.email || "No email"}
                                    </div>
                                  </div>
                                </div>
                              </td>

                              {/* Specialization */}
                              <td className="py-3.5 px-4 whitespace-nowrap">
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-purple-50 dark:bg-purple-950/40 text-[#7c3aed] dark:text-purple-300">
                                  <Stethoscope className="h-3 w-3" />
                                  <span>{doc.specialization}</span>
                                </span>
                              </td>

                              {/* Fee & Slot */}
                              <td className="py-3.5 px-4 whitespace-nowrap">
                                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-mono font-medium">
                                  <span>₹{doc.consultation_fee ?? 500}</span>
                                  <span className="text-[10px] text-emerald-500">· {doc.slot_duration_minutes || 30}m</span>
                                </div>
                              </td>

                              {/* Weekly Schedule */}
                              <td className="py-3.5 px-4 whitespace-nowrap">
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#f3f0fb] dark:bg-[#1f1938] text-xs font-semibold text-[#6d28d9] dark:text-[#c084fc]">
                                  <Clock className="h-3 w-3" />
                                  <span>{activeShiftsCount} days / wk</span>
                                </span>
                              </td>

                              {/* Status */}
                              <td className="py-3.5 px-4 whitespace-nowrap">
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100/70 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                  Active
                                </span>
                              </td>

                              {/* Actions */}
                              {!isOperator && (
                                <td className="py-3.5 px-5 text-right whitespace-nowrap">
                                  <div className="flex items-center justify-end gap-1">
                                    <button
                                      type="button"
                                      onClick={() => handleOpenEditDoctorModal(doc)}
                                      className="p-1.5 rounded-lg text-[#625b7e] hover:text-[#7c3aed] hover:bg-purple-50 dark:hover:bg-purple-950/40 transition-colors cursor-pointer"
                                      title="Edit doctor"
                                    >
                                      <Edit3 className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleRequestDeleteDoctor(doc.id, doc.full_name)}
                                      className="p-1.5 rounded-lg text-[#625b7e] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
                                      title="Delete doctor"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* =========================================================================
              VIEW 3: PATIENT DETAILS (Excel Bulk Import/Export & Form CRUDL with PATCH)
              ========================================================================= */}
          {activeTab === "patients" && (
            <PatientsTab
              isOperator={isOperator}
              showToast={showToast}
              hospitalName={tenant?.name}
              hospitalPhoneNumber={tenant?.phone_number || phoneNumber}
              onNavigateToProfile={() => handleTabChange("profile")}
              portalContainer={headerActionsPortalNode}
            />
          )}

          {/* =========================================================================
              VIEW 4: USER ALLOCATION & STAFF MANAGEMENT (Invite Operators & Credentials)
              ========================================================================= */}
          {activeTab === "users" && (
            <UsersTab
              isOperator={isOperator}
              currentUserId={user?.id}
              showToast={showToast}
              hospitalName={tenant?.name}
              portalContainer={headerActionsPortalNode}
            />
          )}

          {/* =========================================================================
              VIEW 5: VOICE AI STUDIO (Continuous Telephone Call Simulation)
              ========================================================================= */}
          {activeTab === "voice" && (
            <div className="space-y-6">
              <VoicePlayground portalContainer={headerActionsPortalNode} />
            </div>
          )}

          {/* =========================================================================
              VIEW 5: HOSPITAL PROFILE & WEEKLY OPERATING CALENDAR (2-Column Grid: Location & Contacts on Left, Weekly Schedule on Right)
              ========================================================================= */}
          {activeTab === "profile" && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Column: Clinic Location (Top) & Contact Lines (Bottom) */}
              <div className="lg:col-span-5 space-y-6">
                {/* Card 1: Clinic Location & Regional Settings */}
                <div className="p-6 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-[0_12px_30px_-18px_rgba(76,29,149,0.4)] dark:shadow-[0_14px_34px_-18px_rgba(0,0,0,0.8)] space-y-4">
                  <h3 className="font-['Bricolage_Grotesque',sans-serif] font-bold text-lg text-[#150f26] dark:text-white flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-[#7c3aed]" />
                    <span>Clinic location &amp; timezone</span>
                  </h3>

                  {/* Street Address */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-[#625b7e] dark:text-[#a29bc2] uppercase tracking-wider">
                      Physical clinic address
                    </label>
                    <div className="flex items-center gap-2.5 px-3.5 h-11 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530]">
                      <MapPin className="h-4 w-4 text-[#625b7e] dark:text-[#a29bc2]" />
                      <input
                        type="text"
                        placeholder="Street address, wing, floor..."
                        value={address.street}
                        onChange={(e) => setAddress((prev) => ({ ...prev, street: e.target.value }))}
                        className="flex-1 bg-transparent text-xs font-medium text-[#150f26] dark:text-white focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* City, State, PIN */}
                  <div className="grid grid-cols-3 gap-2.5">
                    <div>
                      <label className="text-[10px] font-bold text-[#625b7e] dark:text-[#a29bc2] uppercase block mb-1">
                        City
                      </label>
                      <input
                        type="text"
                        placeholder="City"
                        value={address.city}
                        onChange={(e) => setAddress((prev) => ({ ...prev, city: e.target.value }))}
                        className="w-full h-11 px-3.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] text-xs font-medium text-[#150f26] dark:text-white focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-[#625b7e] dark:text-[#a29bc2] uppercase block mb-1">
                        State
                      </label>
                      <input
                        type="text"
                        placeholder="State"
                        value={address.state}
                        onChange={(e) => setAddress((prev) => ({ ...prev, state: e.target.value }))}
                        className="w-full h-11 px-3.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] text-xs font-medium text-[#150f26] dark:text-white focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-[#625b7e] dark:text-[#a29bc2] uppercase block mb-1">
                        PIN Code
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={6}
                        placeholder="PIN (6 digits)"
                        value={address.postal_code}
                        onChange={(e) =>
                          setAddress((prev) => ({
                            ...prev,
                            postal_code: e.target.value.replace(/\D/g, "").slice(0, 6),
                          }))
                        }
                        className="w-full h-11 px-3.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] text-xs font-medium text-[#150f26] dark:text-white focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Timezone */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-[#625b7e] dark:text-[#a29bc2] uppercase tracking-wider">
                      Regional schedule timezone
                    </label>
                    <CustomSelect
                      value={timezone}
                      onChange={setTimezone}
                      icon={<Clock className="h-4 w-4" />}
                      options={[
                        { value: "Asia/Kolkata", label: "Asia/Kolkata (IST · UTC+5:30)" },
                        { value: "Asia/Dubai", label: "Asia/Dubai (GST · UTC+4:00)" },
                        { value: "Europe/London", label: "Europe/London (GMT/BST)" },
                        { value: "America/New_York", label: "America/New_York (EST · UTC-5)" },
                        { value: "America/Los_Angeles", label: "America/Los_Angeles (PST · UTC-8)" },
                      ]}
                    />
                  </div>
                </div>

                {/* Card 2: Contact Lines & Direct Portal (Positioned directly underneath Clinic Location) */}
                <div className="p-6 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-[0_12px_30px_-18px_rgba(76,29,149,0.4)] dark:shadow-[0_14px_34px_-18px_rgba(0,0,0,0.8)] space-y-4">
                  <h3 className="font-['Bricolage_Grotesque',sans-serif] font-bold text-lg text-[#150f26] dark:text-white flex items-center gap-2">
                    <Phone className="h-4 w-4 text-[#7c3aed]" />
                    <span>Contact lines &amp; portal</span>
                  </h3>

                  {/* Main Phone */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-[#625b7e] dark:text-[#a29bc2] uppercase tracking-wider">
                      Hospital main phone
                    </label>
                    <div className="flex items-center gap-2.5 px-3.5 h-11 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530]">
                      <Phone className="h-4 w-4 text-[#625b7e] dark:text-[#a29bc2]" />
                      <input
                        type="tel"
                        inputMode="tel"
                        placeholder="+91 98765 43210"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value.replace(/[^0-9+\s-]/g, ""))}
                        className="flex-1 bg-transparent text-xs font-medium text-[#150f26] dark:text-white focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Emergency Helpline */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-[#625b7e] dark:text-[#a29bc2] uppercase tracking-wider">
                      Emergency helpline
                    </label>
                    <div className="flex items-center gap-2.5 px-3.5 h-11 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530]">
                      <AlertCircle className="h-4 w-4 text-[#625b7e] dark:text-[#a29bc2]" />
                      <input
                        type="tel"
                        inputMode="tel"
                        placeholder="102 or 011-26567890"
                        value={emergencyContact}
                        onChange={(e) => setEmergencyContact(e.target.value.replace(/[^0-9+\s-]/g, ""))}
                        className="flex-1 bg-transparent text-xs font-medium text-[#150f26] dark:text-white focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Weekly Operating Schedule (Calendar UI matching reference) */}
              <div className="lg:col-span-7">
                <div className="p-6 sm:p-7 rounded-[24px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-[0_12px_30px_-18px_rgba(76,29,149,0.4)] dark:shadow-[0_14px_34px_-18px_rgba(0,0,0,0.8)]">
                  {/* Header: Title, Subtitle & Month Badge */}
                  <div className="flex items-start justify-between gap-3 mb-5">
                    <div className="flex items-start gap-3">
                      <div className="p-2.5 rounded-xl bg-purple-100/70 dark:bg-purple-950/70 text-[#7c3aed] shrink-0 mt-0.5">
                        <Calendar className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-['Bricolage_Grotesque',sans-serif] font-bold text-lg text-[#150f26] dark:text-white leading-tight">
                          Weekly operating schedule
                        </h3>
                        <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] mt-0.5 leading-relaxed">
                          Tap a weekday to open or close it every week. Tap any date to mark a one-off holiday.
                        </p>
                      </div>
                    </div>

                    <div className="px-3.5 py-1.5 rounded-full bg-[#f3f0fb] dark:bg-[#1f1938] text-xs font-semibold text-[#6d28d9] dark:text-[#c084fc] shrink-0 border border-[#e6e0f5] dark:border-[#2b2347] whitespace-nowrap">
                      {currentMonthLabel}
                    </div>
                  </div>

                  {/* Top Weekday Buttons (Mon to Sun) */}
                  <div className="grid grid-cols-7 gap-1.5 sm:gap-2.5">
                    {WEEKDAYS.map((day) => {
                      const h = operatingHours.find((item) => item.day_of_week === day.index);
                      const isOpen = h ? !h.is_closed : day.index !== 6;
                      const timeText = isOpen
                        ? formatShortRange(h?.open_time || "09:00", h?.close_time || "20:00", false)
                        : "Off";

                      return (
                        <button
                          key={day.index}
                          type="button"
                          onClick={() => handleToggleOperatingDay(day.index)}
                          title={`Click to ${isOpen ? "close" : "open"} ${day.label}`}
                          className={`py-2 sm:py-2.5 px-1 rounded-xl text-center transition-all cursor-pointer flex flex-col items-center justify-center select-none shadow-sm ${
                            isOpen
                              ? "bg-[#6d28d9] text-white hover:bg-[#5b21b6]"
                              : "bg-white dark:bg-[#161226] border border-[#e6e0f5] dark:border-[#2b2347] text-[#150f26] dark:text-white hover:border-[#6d28d9]"
                          }`}
                        >
                          <span className="font-bold text-xs sm:text-sm leading-tight">{day.label}</span>
                          <span
                            className={`text-[10px] sm:text-xs font-medium leading-tight mt-0.5 ${
                              isOpen ? "text-purple-100" : "text-[#8b84a6] dark:text-[#7a7299]"
                            }`}
                          >
                            {timeText}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* 7-Column Calendar Grid */}
                  <div className="grid grid-cols-7 gap-1.5 sm:gap-2.5 mt-3 sm:mt-3.5">
                    {/* Spacers for days before the 1st */}
                    {Array.from({ length: startOffset }).map((_, i) => (
                      <div key={`spacer-${i}`} className="min-h-[56px] sm:min-h-[64px]" />
                    ))}

                    {/* Days 1 through totalDaysInMonth */}
                    {Array.from({ length: totalDaysInMonth }, (_, i) => i + 1).map((dayNum) => {
                      const dayOfWeek = (startOffset + dayNum - 1) % 7;
                      const h = operatingHours.find((item) => item.day_of_week === dayOfWeek);
                      const isRegularClosed = h ? h.is_closed : dayOfWeek === 6;
                      const isHoliday = holidays.includes(dayNum);
                      const isToday = dayNum === todayDate;
                      const timeText = isRegularClosed
                        ? "Off"
                        : formatShortRange(h?.open_time || "09:00", h?.close_time || "20:00", false);

                      return (
                        <button
                          key={dayNum}
                          type="button"
                          onClick={() => handleToggleHoliday(dayNum)}
                          title={
                            isHoliday
                              ? `Day ${dayNum}: Holiday (Click to remove)`
                              : isRegularClosed
                              ? `Day ${dayNum}: Off duty (Click to mark Holiday)`
                              : `Day ${dayNum}: Open ${timeText} (Click to mark Holiday)`
                          }
                          className={`relative rounded-xl sm:rounded-2xl p-2 sm:p-2.5 flex flex-col justify-between min-h-[56px] sm:min-h-[64px] transition-all cursor-pointer select-none text-left ${
                            isHoliday
                              ? "bg-amber-50/90 dark:bg-amber-950/40 border-2 border-amber-400 dark:border-amber-500 shadow-sm"
                              : isRegularClosed
                              ? "calendar-off-striped border border-[#e6e0f5] dark:border-[#2b2347]"
                              : "bg-[#f1edfc] dark:bg-[#1e1738] border border-[#e2daf5] dark:border-[#2e2350] hover:border-[#7c3aed]"
                          } ${
                            isToday
                              ? "border-2 border-[#150f26] dark:border-white shadow-sm ring-1 ring-[#150f26]/20 dark:ring-white/20"
                              : ""
                          }`}
                        >
                          <span
                            className={`font-bold text-xs sm:text-sm leading-none ${
                              isHoliday
                                ? "text-amber-900 dark:text-amber-200"
                                : isRegularClosed
                                ? "text-[#625b7e] dark:text-[#a29bc2]"
                                : "text-[#150f26] dark:text-white"
                            }`}
                          >
                            {dayNum}
                          </span>
                          <span
                            className={`text-[10px] sm:text-xs font-medium leading-none ${
                              isHoliday
                                ? "text-amber-700 dark:text-amber-300 font-semibold"
                                : isRegularClosed
                                ? "text-[#8b84a6] dark:text-[#7a7299]"
                                : "text-[#625b7e] dark:text-[#a29bc2]"
                            }`}
                          >
                            {isHoliday ? "Holiday" : timeText}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Bottom Footer: Legend & Summary */}
                  <div className="flex items-center justify-between flex-wrap gap-3 pt-4 border-t border-[#f0ebfa] dark:border-[#241c3d] mt-4">
                    {/* Left: Legend items */}
                    <div className="flex items-center gap-3.5 sm:gap-5 text-xs text-[#625b7e] dark:text-[#a29bc2] flex-wrap">
                      {/* Open Timing */}
                      <div className="flex items-center gap-1.5 sm:gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#6d28d9] shrink-0" />
                        <span className="font-medium text-[#150f26] dark:text-white">
                          {legendOpenText}
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowShiftModal(true)}
                          className="p-1 rounded hover:bg-purple-100 dark:hover:bg-purple-950/60 text-[#7c3aed] transition-colors cursor-pointer"
                          title="Customize Shift Timings & Presets"
                        >
                          <Edit3 className="w-3 h-3" />
                        </button>
                      </div>

                      {/* Off Duty */}
                      <div className="flex items-center gap-1.5 sm:gap-2">
                        <span className="w-3.5 h-3.5 rounded-sm border border-[#d8d0ec] dark:border-[#382e56] calendar-off-striped shrink-0" />
                        <span className="font-medium">Off duty</span>
                      </div>

                      {/* Holiday */}
                      <div className="flex items-center gap-1.5 sm:gap-2">
                        <span className="w-3.5 h-3.5 rounded-sm border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/40 shrink-0" />
                        <span className="font-medium">Holiday</span>
                      </div>
                    </div>

                    {/* Right: Summary Stats */}
                    <div className="text-xs font-medium text-[#625b7e] dark:text-[#a29bc2]">
                      <span className="text-[#150f26] dark:text-white font-bold">{openDaysCount}</span> open days this month,{" "}
                      <span className="text-[#150f26] dark:text-white font-bold">{totalWeeklyOperatingHours} hrs / wk</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* =========================================================================
          REGISTER / EDIT PHYSICIAN MODAL POPUP (Exact Reference Image Layout)
          ========================================================================= */}
      {showDoctorModal &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 overflow-y-auto animate-in fade-in duration-150"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowDoctorModal(false);
            }}
          >
            <div className="relative w-full max-w-[1380px] w-[96vw] max-h-[92vh] flex flex-col rounded-[28px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.5)] overflow-hidden animate-in zoom-in-95 duration-150">
              {/* Modal Header */}
              <div className="px-6 py-4 border-b border-[#e6e0f5] dark:border-[#2b2347] flex items-center justify-between shrink-0 bg-[#faf8fe] dark:bg-[#16112a]">
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-[14px] bg-gradient-to-br from-[#6d28d9] to-[#9333ea] text-white grid place-items-center shadow-md shadow-purple-600/30">
                    <Stethoscope className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-['Bricolage_Grotesque',sans-serif] text-lg sm:text-xl font-bold text-[#150f26] dark:text-white leading-tight">
                      {editingDoctorId ? "Edit doctor details & shift schedule" : "Register new doctor"}
                    </h2>
                    <p className="text-xs text-[#625b7e] dark:text-[#a29bc2]">
                      Set doctor credentials, consultation fees, flexible weekly shifts, and duty calendar.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowDoctorModal(false)}
                  className="w-8 h-8 rounded-full border border-[#e6e0f5] dark:border-[#2b2347] bg-white dark:bg-[#1a1435] text-[#625b7e] hover:text-[#150f26] dark:hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Modal Form: Full height container with scrollable body and pinned sticky footer */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSaveDoctor();
                }}
                noValidate
                className="flex-1 flex flex-col min-h-0 overflow-hidden"
              >
                {/* Scrollable Form Body */}
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                  {doctorFormError && (
                    <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-600 dark:text-red-400 font-semibold flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <span>{doctorFormError}</span>
                    </div>
                  )}

                  {/* 2-Partition Responsive Grid: Left (7 cols) = Basic Details + Shift Form, Right (5 cols) = Calendar */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                    {/* LEFT COLUMN: Section 1 (Basic Details) on Top, Section 2 (Shift Schedule Form) Underneath */}
                    <div className="lg:col-span-7 space-y-5">
                      {/* SECTION 1: Basic Details & Credentials Card */}
                      <div className="p-4 sm:p-5 rounded-2xl bg-[#faf8fe] dark:bg-[#16112a] border border-[#e6e0f5] dark:border-[#2b2347] space-y-4 shadow-xs">
                        <div className="flex items-center gap-2.5 pb-2.5 border-b border-[#e6e0f5] dark:border-[#2b2347]">
                          <div className="p-1.5 rounded-lg bg-purple-100/70 dark:bg-purple-950/70 text-[#7c3aed]">
                            <User className="h-4 w-4" />
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-[#150f26] dark:text-white leading-tight">
                              Basic Details & Consultation Fees
                            </h4>
                            <p className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
                              Doctor's name, specialization, consultation fee, and slot duration.
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {/* Full Name */}
                          <div className="space-y-1.5 sm:col-span-2">
                            <label className="text-xs font-bold text-[#150f26] dark:text-white flex items-center justify-between">
                              <span>Full name</span>
                              <span className="text-purple-600 dark:text-purple-400 text-[10px] font-semibold">Required</span>
                            </label>
                            <div className="relative">
                              <User className="absolute left-3.5 top-3 h-4 w-4 text-[#625b7e] dark:text-[#a29bc2]" />
                              <input
                                type="text"
                                placeholder="Dr. Anita Sharma"
                                value={doctorFormData.full_name}
                                onChange={(e) =>
                                  setDoctorFormData((prev) => ({ ...prev, full_name: e.target.value }))
                                }
                                className="w-full h-10 pl-10 pr-3.5 rounded-xl border border-[#7c3aed] bg-white dark:bg-[#161128] text-xs font-medium text-[#150f26] dark:text-white placeholder-[#625b7e]/50 focus:outline-none focus:ring-1 focus:ring-[#7c3aed]"
                              />
                            </div>
                          </div>

                          {/* Specialization */}
                          <div className="space-y-1.5 sm:col-span-2">
                            <label className="text-xs font-bold text-[#150f26] dark:text-white flex items-center justify-between">
                              <span>Specialization</span>
                              <span className="text-purple-600 dark:text-purple-400 text-[10px] font-semibold">Required</span>
                            </label>
                            <div className="relative">
                              <Stethoscope className="absolute left-3.5 top-3 h-4 w-4 text-[#625b7e] dark:text-[#a29bc2]" />
                              <input
                                type="text"
                                placeholder="General Physician"
                                value={doctorFormData.specialization}
                                onChange={(e) =>
                                  setDoctorFormData((prev) => ({ ...prev, specialization: e.target.value }))
                                }
                                className="w-full h-10 pl-10 pr-3.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-white dark:bg-[#161128] text-xs font-medium text-[#150f26] dark:text-white placeholder-[#625b7e]/50 focus:outline-none focus:border-[#7c3aed]"
                              />
                            </div>

                            {/* Quick Specialty Pills */}
                            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                              {["General Physician", "Cardiology", "Pediatrics", "Orthopedics", "Dentistry", "Neurology"].map((spec) => {
                                const isSelected = doctorFormData.specialization === spec;
                                return (
                                  <button
                                    key={spec}
                                    type="button"
                                    onClick={() => setDoctorFormData((prev) => ({ ...prev, specialization: spec }))}
                                    className={`px-3 py-1 rounded-full text-[11px] transition-all cursor-pointer ${
                                      isSelected
                                        ? "border border-[#7c3aed] text-[#7c3aed] bg-purple-50/70 dark:bg-purple-950/40 font-semibold"
                                        : "border border-[#e6e0f5] dark:border-[#2b2347] text-[#625b7e] dark:text-[#a29bc2] bg-white dark:bg-[#1a1435] hover:border-[#7c3aed] hover:text-[#7c3aed]"
                                    }`}
                                  >
                                    {spec}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* Consultation Fee */}
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-[#150f26] dark:text-white block">
                              Consultation fee (₹ INR)
                            </label>
                            <div className="relative">
                              <span className="absolute left-3.5 top-2.5 text-xs font-bold text-[#625b7e] dark:text-[#a29bc2]">₹</span>
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
                                className="w-full h-10 pl-8 pr-3.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-white dark:bg-[#161128] text-xs font-semibold text-[#150f26] dark:text-white focus:outline-none focus:border-[#7c3aed]"
                              />
                            </div>

                            {/* Quick fee pills */}
                            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                              {[300, 500, 800, 1000, 1500].map((fee) => {
                                const isSelected = doctorFormData.consultation_fee === fee;
                                return (
                                  <button
                                    key={fee}
                                    type="button"
                                    onClick={() => setDoctorFormData((prev) => ({ ...prev, consultation_fee: fee }))}
                                    className={`px-2.5 py-0.5 rounded-full text-[10.5px] transition-all cursor-pointer ${
                                      isSelected
                                        ? "border border-[#7c3aed] text-[#7c3aed] bg-purple-50/70 dark:bg-purple-950/40 font-semibold"
                                        : "border border-[#e6e0f5] dark:border-[#2b2347] text-[#625b7e] dark:text-[#a29bc2] bg-white dark:bg-[#1a1435] hover:border-[#7c3aed] hover:text-[#7c3aed]"
                                    }`}
                                  >
                                    ₹{fee}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* Slot Duration */}
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-[#150f26] dark:text-white block">
                              Slot duration
                            </label>
                            <div className="grid grid-cols-4 gap-2 pt-0.5">
                              {SLOT_DURATIONS.map((dur) => {
                                const isSelected = doctorFormData.slot_duration === dur;
                                return (
                                  <button
                                    key={dur}
                                    type="button"
                                    onClick={() => setDoctorFormData((prev) => ({ ...prev, slot_duration: dur }))}
                                    className={`h-9 rounded-xl font-bold text-xs flex items-center justify-center transition-all cursor-pointer ${
                                      isSelected
                                        ? "bg-[#7c3aed] text-white shadow-xs"
                                        : "border border-[#e6e0f5] dark:border-[#2b2347] bg-white dark:bg-[#161128] text-[#150f26] dark:text-white hover:border-[#7c3aed]"
                                    }`}
                                  >
                                    {dur}m
                                  </button>
                                );
                              })}
                            </div>
                            <p className="text-[10.5px] text-[#8b84a6] dark:text-[#7a7299] pt-1">
                              Voice AI allocates {doctorFormData.slot_duration} minutes per appointment slot.
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* SECTION 2: Flexible Consultation Shift Schedule Form (Underneath Basic Details) */}
                      <div className="p-4 sm:p-5 rounded-2xl bg-[#faf8fe] dark:bg-[#16112a] border border-[#e6e0f5] dark:border-[#2b2347] space-y-4 shadow-xs">
                        {/* Shifts Header with Global Presets */}
                        <div className="flex items-center justify-between flex-wrap gap-2 pb-2.5 border-b border-[#e6e0f5] dark:border-[#2b2347]">
                          <div className="flex items-center gap-2">
                            <div className="p-1.5 rounded-lg bg-purple-100/70 dark:bg-purple-950/70 text-[#7c3aed]">
                              <Clock className="h-4 w-4" />
                            </div>
                            <div>
                              <h4 className="text-xs font-bold text-[#150f26] dark:text-white leading-tight">
                                Consultation Shift Schedule
                              </h4>
                              <p className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
                                Select any weekday to customize start and end consultation hours.
                              </p>
                            </div>
                          </div>

                          {/* Presets Toolbar */}
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <button
                              type="button"
                              onClick={() => applyDoctorShiftPreset("all-week")}
                              className="px-2.5 py-1 rounded-lg text-[10.5px] font-semibold bg-white dark:bg-[#1f1938] border border-[#e6e0f5] dark:border-[#2b2347] text-[#625b7e] dark:text-[#a29bc2] hover:text-[#7c3aed] hover:border-[#7c3aed] transition-colors cursor-pointer"
                            >
                              All 7 days
                            </button>
                            <button
                              type="button"
                              onClick={() => applyDoctorShiftPreset("mon-sat")}
                              className="px-2.5 py-1 rounded-lg text-[10.5px] font-semibold bg-white dark:bg-[#1f1938] border border-[#e6e0f5] dark:border-[#2b2347] text-[#625b7e] dark:text-[#a29bc2] hover:text-[#7c3aed] hover:border-[#7c3aed] transition-colors cursor-pointer"
                            >
                              Mon-Sat (9-6)
                            </button>
                            <button
                              type="button"
                              onClick={() => applyDoctorShiftPreset("weekdays")}
                              className="px-2.5 py-1 rounded-lg text-[10.5px] font-semibold bg-white dark:bg-[#1f1938] border border-[#e6e0f5] dark:border-[#2b2347] text-[#625b7e] dark:text-[#a29bc2] hover:text-[#7c3aed] hover:border-[#7c3aed] transition-colors cursor-pointer"
                            >
                              Mon-Fri (9-5)
                            </button>
                            <button
                              type="button"
                              onClick={() => applyDoctorShiftPreset("clear")}
                              className="px-2.5 py-1 rounded-lg text-[10.5px] font-semibold bg-white dark:bg-[#1f1938] border border-[#e6e0f5] dark:border-[#2b2347] text-[#625b7e] dark:text-[#a29bc2] hover:text-red-500 hover:border-red-400 transition-colors cursor-pointer"
                            >
                              Clear
                            </button>
                          </div>
                        </div>

                        {/* Weekday Switcher Strip (Mon to Sun - 7 Columns) */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-[11px] font-bold text-[#8b84a6] dark:text-[#7a7299]">
                            <span>SELECT WEEKDAY TO CONFIGURE:</span>
                            <span className="text-[#7c3aed] dark:text-purple-300 font-semibold">{totalDoctorWeeklyHours}</span>
                          </div>

                          <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                            {WEEKDAYS.map((day) => {
                              const avail = doctorFormData.availabilities.find(
                                (a) => a.day_of_week === day.index
                              );
                              const isActive = avail ? avail.is_active : false;
                              const isSelected = selectedModalDayIndex === day.index;
                              const timeText = isActive
                                ? formatShortRange(avail?.start_time, avail?.end_time, false)
                                : "Off";

                              return (
                                <button
                                  key={day.index}
                                  type="button"
                                  onClick={() => setSelectedModalDayIndex(day.index)}
                                  title={`Select ${day.label} to configure shift`}
                                  className={`py-2 px-1 rounded-xl text-center transition-all cursor-pointer flex flex-col items-center justify-center select-none shadow-xs ${
                                    isSelected
                                      ? "ring-2 ring-[#7c3aed] bg-[#6d28d9] text-white shadow-md"
                                      : isActive
                                      ? "bg-purple-100/70 dark:bg-purple-950/40 border border-purple-300 dark:border-purple-800 text-[#150f26] dark:text-white hover:border-[#6d28d9]"
                                      : "bg-white dark:bg-[#161226] border border-[#e6e0f5] dark:border-[#2b2347] text-[#8b84a6] dark:text-[#7a7299] hover:border-[#6d28d9]"
                                  }`}
                                >
                                  <span className="font-bold text-[11px] leading-tight">{day.label}</span>
                                  <span
                                    className={`text-[9px] font-medium leading-tight mt-0.5 ${
                                      isSelected
                                        ? "text-purple-100 font-bold"
                                        : isActive
                                        ? "text-[#7c3aed] dark:text-purple-300 font-semibold"
                                        : "text-[#8b84a6] dark:text-[#7a7299]"
                                    }`}
                                  >
                                    {timeText}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* In-Depth Custom Shift Editor for Selected Day */}
                        {(() => {
                          const currentDay = WEEKDAYS.find((d) => d.index === selectedModalDayIndex) || WEEKDAYS[0];
                          const currentAvail = doctorFormData.availabilities.find(
                            (a) => a.day_of_week === selectedModalDayIndex
                          ) || {
                            day_of_week: selectedModalDayIndex,
                            start_time: "09:00",
                            end_time: "18:00",
                            is_active: false,
                          };

                          return (
                            <div className="p-3.5 rounded-xl bg-white dark:bg-[#1a1435] border border-purple-200 dark:border-purple-900/60 shadow-xs space-y-3">
                              <div className="flex items-center justify-between flex-wrap gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-xs text-[#150f26] dark:text-white">
                                    {DAYS_OF_WEEK[currentDay.index]} Shift:
                                  </span>
                                  <span
                                    className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                                      currentAvail.is_active
                                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                                        : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                                    }`}
                                  >
                                    {currentAvail.is_active ? "Active on Duty" : "Off Duty"}
                                  </span>
                                </div>

                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleToggleDoctorModalDay(selectedModalDayIndex)}
                                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                      currentAvail.is_active
                                        ? "bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800"
                                        : "bg-[#7c3aed] text-white hover:bg-[#6d28d9] shadow-xs"
                                    }`}
                                  >
                                    {currentAvail.is_active ? "Set as Off Duty" : "Enable Shift"}
                                  </button>
                                  {currentAvail.is_active && (
                                    <button
                                      type="button"
                                      onClick={() => handleCopyDayToAllDays(selectedModalDayIndex)}
                                      className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[#f3f0fb] dark:bg-[#251b47] hover:bg-purple-100 text-[#7c3aed] dark:text-purple-300 border border-[#e6e0f5] dark:border-[#2b2347] transition-all cursor-pointer"
                                      title="Copy these hours to all active days"
                                    >
                                      Copy to All Days
                                    </button>
                                  )}
                                </div>
                              </div>

                              {currentAvail.is_active ? (
                                <div className="space-y-2.5 pt-1 border-t border-[#e6e0f5] dark:border-[#2b2347]">
                                  {/* Preset Buttons for this Day */}
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[10px] font-bold text-[#8b84a6] dark:text-[#7a7299] mr-1">
                                      Presets:
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleApplyDayPreset(selectedModalDayIndex, "morning")}
                                      className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:border-[#7c3aed] hover:text-[#7c3aed] cursor-pointer"
                                    >
                                      Morning (09:00 - 13:00)
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleApplyDayPreset(selectedModalDayIndex, "afternoon")}
                                      className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:border-[#7c3aed] hover:text-[#7c3aed] cursor-pointer"
                                    >
                                      Afternoon (13:00 - 17:00)
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleApplyDayPreset(selectedModalDayIndex, "evening")}
                                      className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:border-[#7c3aed] hover:text-[#7c3aed] cursor-pointer"
                                    >
                                      Evening (17:00 - 21:00)
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleApplyDayPreset(selectedModalDayIndex, "fullday")}
                                      className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:border-[#7c3aed] hover:text-[#7c3aed] cursor-pointer"
                                    >
                                      Full Day (09:00 - 18:00)
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleApplyDayPreset(selectedModalDayIndex, "night")}
                                      className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:border-[#7c3aed] hover:text-[#7c3aed] cursor-pointer"
                                    >
                                      Night (20:00 - 08:00)
                                    </button>
                                  </div>

                                  {/* Exact Time Pickers */}
                                  <div className="flex items-center gap-3 flex-wrap bg-[#faf8fe] dark:bg-[#120e1f] p-2.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347]">
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs font-semibold text-[#150f26] dark:text-white">Start time:</span>
                                      <input
                                        type="time"
                                        value={currentAvail.start_time}
                                        onChange={(e) =>
                                          handleSetDayTimes(selectedModalDayIndex, e.target.value, currentAvail.end_time)
                                        }
                                        className="h-8 px-2.5 rounded-lg border border-[#e6e0f5] dark:border-[#2b2347] bg-white dark:bg-[#1a1435] text-xs font-mono font-bold text-[#150f26] dark:text-white focus:outline-none focus:border-[#7c3aed]"
                                      />
                                    </div>

                                    <div className="flex items-center gap-2">
                                      <span className="text-xs font-semibold text-[#150f26] dark:text-white">End time:</span>
                                      <input
                                        type="time"
                                        value={currentAvail.end_time}
                                        onChange={(e) =>
                                          handleSetDayTimes(selectedModalDayIndex, currentAvail.start_time, e.target.value)
                                        }
                                        className="h-8 px-2.5 rounded-lg border border-[#e6e0f5] dark:border-[#2b2347] bg-white dark:bg-[#1a1435] text-xs font-mono font-bold text-[#150f26] dark:text-white focus:outline-none focus:border-[#7c3aed]"
                                      />
                                    </div>

                                    <span className="text-xs font-bold text-[#7c3aed] dark:text-purple-300 ml-auto">
                                      {formatShortRange(currentAvail.start_time, currentAvail.end_time, true)}
                                    </span>
                                  </div>
                                </div>
                              ) : (
                                <div className="text-xs text-[#625b7e] dark:text-[#a29bc2] italic py-1">
                                  {DAYS_OF_WEEK[currentDay.index]} is marked as Off Duty. Click "Enable Shift" above to assign consultation hours for {DAYS_OF_WEEK[currentDay.index]}.
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    {/* RIGHT COLUMN: Section 3 (Duty & Leave Calendar Preview - November 2026) */}
                    <div className="lg:col-span-5 space-y-4 p-4 sm:p-5 rounded-2xl bg-[#faf8fe] dark:bg-[#16112a] border border-[#e6e0f5] dark:border-[#2b2347] shadow-xs">
                      {/* Calendar Header */}
                      <div className="flex items-center justify-between pb-2 border-b border-[#e6e0f5] dark:border-[#2b2347]">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-lg bg-purple-100/70 dark:bg-purple-950/70 text-[#7c3aed]">
                            <Calendar className="h-4 w-4" />
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-[#150f26] dark:text-white leading-tight">
                              Duty & Leave Calendar (Nov 2026)
                            </h4>
                            <p className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
                              Tap any calendar date below to toggle doctor leave.
                            </p>
                          </div>
                        </div>

                        {doctorModalLeaves.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setDoctorModalLeaves([])}
                            className="text-[10.5px] font-semibold text-rose-600 hover:text-rose-700 cursor-pointer"
                          >
                            Clear leaves
                          </button>
                        )}
                      </div>

                      {/* Compact Month Calendar Grid (7 columns: Mon to Sun) */}
                      <div className="space-y-1">
                        <div className="grid grid-cols-7 gap-1 text-center font-bold text-[10px] text-[#8b84a6] dark:text-[#7a7299] uppercase pb-1">
                          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                            <div key={d}>{d}</div>
                          ))}
                        </div>

                        <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                          {/* Spacers for days before Nov 1st */}
                          {Array.from({ length: startOffset }).map((_, i) => (
                            <div key={`modal-spacer-${i}`} className="min-h-[46px]" />
                          ))}

                          {/* Days 1 through totalDaysInMonth */}
                          {Array.from({ length: totalDaysInMonth }, (_, i) => i + 1).map((dayNum) => {
                            const dayOfWeek = (startOffset + dayNum - 1) % 7;
                            const avail = doctorFormData.availabilities.find(
                              (a) => a.day_of_week === dayOfWeek
                            );
                            const isRegularActive = avail ? avail.is_active : false;
                            const isLeave = doctorModalLeaves.includes(dayNum);
                            const isToday = dayNum === todayDate;
                            const timeText = isRegularActive
                              ? formatShortRange(avail?.start_time, avail?.end_time, false)
                              : "Off";

                            return (
                              <button
                                key={dayNum}
                                type="button"
                                onClick={() => handleToggleDoctorModalLeave(dayNum)}
                                title={
                                  isLeave
                                    ? `Day ${dayNum}: On Leave (Click to remove)`
                                    : isRegularActive
                                    ? `Day ${dayNum}: Shift ${timeText} (Click to mark leave)`
                                    : `Day ${dayNum}: Off duty`
                                }
                                className={`relative rounded-xl p-1.5 flex flex-col justify-between min-h-[48px] transition-all cursor-pointer select-none text-left ${
                                  isLeave
                                    ? "bg-amber-100 dark:bg-amber-950/70 border-2 border-amber-500 shadow-xs"
                                    : isRegularActive
                                    ? "bg-white dark:bg-[#1a1435] border border-[#e2daf5] dark:border-[#2e2350] hover:border-[#7c3aed]"
                                    : "calendar-off-striped border border-[#e6e0f5] dark:border-[#2b2347]"
                                } ${
                                  isToday
                                    ? "ring-2 ring-[#150f26] dark:ring-white shadow-xs"
                                    : ""
                                }`}
                              >
                                <span
                                  className={`font-bold text-[11px] leading-none ${
                                    isLeave
                                      ? "text-amber-950 dark:text-amber-100 font-extrabold"
                                      : isRegularActive
                                      ? "text-[#150f26] dark:text-white"
                                      : "text-[#625b7e] dark:text-[#a29bc2]"
                                  }`}
                                >
                                  {dayNum}
                                </span>
                                <span
                                  className={`text-[8.5px] font-semibold leading-none mt-1 ${
                                    isLeave
                                      ? "text-amber-800 dark:text-amber-300 font-bold"
                                      : isRegularActive
                                      ? "text-[#7c3aed] dark:text-purple-300 font-medium"
                                      : "text-[#8b84a6] dark:text-[#7a7299]"
                                  }`}
                                >
                                  {isLeave ? "Leave" : timeText}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Active Leaves Chip List */}
                      <div className="pt-2 border-t border-[#e6e0f5] dark:border-[#2b2347] space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] font-bold text-[#8b84a6] dark:text-[#7a7299]">
                          <span>SCHEDULED LEAVES:</span>
                          <span className="text-amber-700 dark:text-amber-400 font-semibold">{doctorModalLeaves.length} day{doctorModalLeaves.length === 1 ? "" : "s"}</span>
                        </div>

                        {doctorModalLeaves.length > 0 ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {doctorModalLeaves
                              .slice()
                              .sort((a, b) => a - b)
                              .map((leaveDay) => (
                                <span
                                  key={leaveDay}
                                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[10.5px] font-bold bg-amber-100 text-amber-900 dark:bg-amber-950/80 dark:text-amber-200 border border-amber-300 dark:border-amber-800 shadow-2xs"
                                >
                                  <span>Nov {leaveDay}</span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleToggleDoctorModalLeave(leaveDay);
                                    }}
                                    className="hover:text-red-600 cursor-pointer ml-1 text-xs font-bold leading-none"
                                    title="Remove leave"
                                  >
                                    ×
                                  </button>
                                </span>
                              ))}
                          </div>
                        ) : (
                          <p className="text-[11px] text-[#625b7e] dark:text-[#a29bc2] italic">
                            No one-off leaves scheduled. Doctor will be on duty on all active weekdays.
                          </p>
                        )}
                      </div>

                      {/* Calendar Summary Bar */}
                      <div className="px-3 py-2.5 rounded-xl bg-white dark:bg-[#1a1435] border border-[#e6e0f5] dark:border-[#2b2347] flex items-center justify-between text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-[#6d28d9]" />
                            <span>Shift</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-xs calendar-off-striped border border-[#e6e0f5] dark:border-[#2b2347]" />
                            <span>Off</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-xs bg-amber-100 border border-amber-400" />
                            <span>Leave</span>
                          </div>
                        </div>

                        <div>
                          <strong className="text-[#150f26] dark:text-white">
                            {doctorModalActiveDaysCount} of 7 days
                          </strong>{" "}
                          active ({doctorModalOpenDaysCount} open days)
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ========================================================
                    STICKY FOOTER ACTION BAR (Non-scrolling, permanently visible)
                    ======================================================== */}
                <div className="shrink-0 px-6 py-4 border-t border-[#e6e0f5] dark:border-[#2b2347] bg-[#faf8fe] dark:bg-[#16112a] flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-[#625b7e] dark:text-[#a29bc2]">
                    <span className="font-bold text-[#150f26] dark:text-white">
                      {doctorModalActiveDaysCount} active days
                    </span>
                    <span>•</span>
                    <span>{totalDoctorWeeklyHours}</span>
                    {doctorModalLeaves.length > 0 && (
                      <>
                        <span>•</span>
                        <span className="text-amber-700 dark:text-amber-300 font-semibold">
                          {doctorModalLeaves.length} leave{doctorModalLeaves.length > 1 ? "s" : ""}
                        </span>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setShowDoctorModal(false)}
                      className="px-5 py-2.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-white dark:bg-[#1a1435] text-xs font-semibold text-[#150f26] dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSavingDoctor}
                      className="px-5 py-2.5 inline-flex items-center justify-center gap-2 rounded-xl bg-[#7c3aed] hover:bg-[#6d28d9] text-white font-semibold text-xs shadow-md shadow-purple-600/30 hover:brightness-105 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                    >
                      {isSavingDoctor ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>Saving...</span>
                        </>
                      ) : (
                        <>
                          <Check className="h-4 w-4" />
                          <span>{editingDoctorId ? "Update doctor" : "Save doctor to roster"}</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </form>
            </div>
        </div>,
        document.body
      )}

      {/* =========================================================================
          DOCTOR DELETE CONFIRMATION MODAL
          ========================================================================= */}
      {doctorToDelete &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fade-in">
            <div className="w-full max-w-md rounded-[24px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] p-6 shadow-2xl relative space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-red-100 dark:bg-red-950/70 text-red-500 grid place-items-center shrink-0">
                  <Trash2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#150f26] dark:text-white">
                    Remove Doctor from Roster?
                  </h3>
                  <p className="text-xs text-[#625b7e] dark:text-[#a29bc2]">
                    This will remove the doctor and their weekly shift availability from {tenant?.name || "the hospital"}.
                  </p>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-[#fcfaff] dark:bg-white/5 border border-[#e6e0f5] dark:border-[#2b2347] text-xs space-y-1">
                <div className="font-semibold text-[#150f26] dark:text-white">
                  {doctorToDelete.name}
                </div>
                <div className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
                  Action cannot be undone once confirmed.
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#e6e0f5] dark:border-[#2b2347]">
                <button
                  type="button"
                  onClick={() => setDoctorToDelete(null)}
                  disabled={isDeletingDoctor}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold text-[#625b7e] hover:text-[#150f26] dark:hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDeleteDoctor}
                  disabled={isDeletingDoctor}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-700 text-white shadow-md shadow-red-600/30 disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {isDeletingDoctor && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>{isDeletingDoctor ? "Removing..." : "Yes, Remove Doctor"}</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* =========================================================================
          CUSTOMIZE SHIFT HOURS & PRESETS MODAL POPUP
          ========================================================================= */}
      {showShiftModal &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 overflow-y-auto animate-in fade-in duration-150"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowShiftModal(false);
            }}
          >
            <div className="w-full max-w-md bg-white dark:bg-[#120e1f] rounded-2xl sm:rounded-3xl shadow-2xl border border-[#e6e0f5] dark:border-[#2b2347] p-6 sm:p-7 space-y-5 animate-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between pb-3 border-b border-[#e6e0f5] dark:border-[#2b2347]">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-purple-100/70 dark:bg-purple-950/70 text-[#7c3aed]">
                    <Clock className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-['Bricolage_Grotesque',sans-serif] font-bold text-lg text-[#150f26] dark:text-white">
                      Shift Hours & Presets
                    </h3>
                    <p className="text-xs text-[#625b7e] dark:text-[#a29bc2]">
                      Update operating shift hours or apply standard clinic schedules
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowShiftModal(false)}
                  className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Quick Presets */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-[#150f26] dark:text-white block">
                  Quick Presets
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      applyStandardPreset();
                      setShowShiftModal(false);
                    }}
                    className="p-2.5 rounded-xl text-xs font-semibold text-left bg-[#f8f6fc] dark:bg-[#1a1530] hover:bg-purple-100/60 dark:hover:bg-purple-950/60 border border-[#e6e0f5] dark:border-[#2b2347] text-[#150f26] dark:text-white transition-all cursor-pointer"
                  >
                    <div className="font-bold text-[#7c3aed]">Standard</div>
                    <div className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">Mon-Sat (9a-8p), Sun Off</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      applyWeekdaysPreset();
                      setShowShiftModal(false);
                    }}
                    className="p-2.5 rounded-xl text-xs font-semibold text-left bg-[#f8f6fc] dark:bg-[#1a1530] hover:bg-purple-100/60 dark:hover:bg-purple-950/60 border border-[#e6e0f5] dark:border-[#2b2347] text-[#150f26] dark:text-white transition-all cursor-pointer"
                  >
                    <div className="font-bold text-[#7c3aed]">Office Hours</div>
                    <div className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">Mon-Fri (9a-5p), Wknd Off</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      applyAllWeekPreset();
                      setShowShiftModal(false);
                    }}
                    className="p-2.5 rounded-xl text-xs font-semibold text-left bg-[#f8f6fc] dark:bg-[#1a1530] hover:bg-purple-100/60 dark:hover:bg-purple-950/60 border border-[#e6e0f5] dark:border-[#2b2347] text-[#150f26] dark:text-white transition-all cursor-pointer"
                  >
                    <div className="font-bold text-[#7c3aed]">All 7 Days</div>
                    <div className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">Daily 9am-8pm</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      applyClearAllPreset();
                      setShowShiftModal(false);
                    }}
                    className="p-2.5 rounded-xl text-xs font-semibold text-left bg-[#f8f6fc] dark:bg-[#1a1530] hover:bg-red-50 dark:hover:bg-red-950/30 border border-[#e6e0f5] dark:border-[#2b2347] text-red-600 transition-all cursor-pointer"
                  >
                    <div className="font-bold">Clear All</div>
                    <div className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">Mark all days off duty</div>
                  </button>
                </div>
              </div>

              {/* Custom Hours */}
              <div className="space-y-3 pt-2 border-t border-[#e6e0f5] dark:border-[#2b2347]">
                <label className="text-xs font-semibold text-[#150f26] dark:text-white block">
                  Custom Shift Hours (applies to active days)
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-medium text-[#625b7e] dark:text-[#a29bc2] block mb-1">
                      Opening Time
                    </label>
                    <input
                      type="time"
                      value={customShiftOpen}
                      onChange={(e) => setCustomShiftOpen(e.target.value)}
                      className="w-full h-10 px-3 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-white dark:bg-[#1a1530] text-sm font-mono text-[#150f26] dark:text-white focus:outline-none focus:border-[#7c3aed]"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-[#625b7e] dark:text-[#a29bc2] block mb-1">
                      Closing Time
                    </label>
                    <input
                      type="time"
                      value={customShiftClose}
                      onChange={(e) => setCustomShiftClose(e.target.value)}
                      className="w-full h-10 px-3 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-white dark:bg-[#1a1530] text-sm font-mono text-[#150f26] dark:text-white focus:outline-none focus:border-[#7c3aed]"
                    />
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#e6e0f5] dark:border-[#2b2347]">
                <button
                  type="button"
                  onClick={() => setShowShiftModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-[#625b7e] dark:text-[#a29bc2] hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => applyCustomShift(customShiftOpen, customShiftClose)}
                  className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-[#6d28d9] to-[#9333ea] hover:opacity-95 shadow-md shadow-purple-600/20 transition-all cursor-pointer"
                >
                  Apply Hours
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* =========================================================================
          TOAST NOTIFICATION (Exact styling from Hospital_Voice_Agent.html)
          ========================================================================= */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#150f26] dark:bg-white text-white dark:text-[#150f26] px-5 py-2.5 rounded-2xl font-semibold shadow-2xl text-xs sm:text-sm z-50 flex items-center gap-2 animate-bounce">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 dark:text-emerald-600" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};
