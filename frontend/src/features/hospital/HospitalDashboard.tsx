import React, { useState, useEffect, useMemo } from "react";
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
  Sparkles,
  Search,
  Volume2,
  RotateCcw,
  Calendar,
  Cpu,
  User,
  Check,
  ChevronLeft,
  ChevronRight,
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
    setSearchParams({ tab });
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

  // Doctor Filter & View Mode State
  const [doctorViewMode, setDoctorViewMode] = useState<"calendar" | "table">("calendar");
  const [calendarViewSpan, setCalendarViewSpan] = useState<"month" | "week">("month");
  const [selectedInspectorDate, setSelectedInspectorDate] = useState<number>(24);
  const [selectedDateScope, setSelectedDateScope] = useState<"date" | "dayOfWeek">("date");
  const [activeDoctorFilterIds, setActiveDoctorFilterIds] = useState<string[]>([]);
  const [doctorLeaves, setDoctorLeaves] = useState<{ [doctorId: string]: number[] }>({
    "doc-shah": [12, 19],
    "doc-mehta": [26],
  });
  const [doctorModalLeaves, setDoctorModalLeaves] = useState<number[]>([]);
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

  // Voice AI Playground Mini-State
  const [voiceLanguage, setVoiceLanguage] = useState<"en" | "hi">("en");

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

  // Open Modal for New Doctor
  const handleOpenAddDoctorModal = () => {
    setEditingDoctorId(null);
    setDoctorModalLeaves([]);
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
    setDoctorModalLeaves([]);
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
        showToast("Doctor details updated");
      } else {
        const created = await apiClient.post<DoctorItem>("/api/v1/doctors", payload);
        setDoctors((prev) => [...prev, created]);
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

              {/* Portal Target for Patient and User Tab Main Header Actions */}
              {(activeTab === "patients" || activeTab === "users") && (
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

              {/* VIEW A: DESIGN-MATCHING DOCTORS & SHIFTS CALENDAR + DAY INSPECTOR */}
              {doctorViewMode === "calendar" ? (
                <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
                  {/* LEFT COLUMN: Main Doctors & Shifts Calendar Card (8 cols) */}
                  <div className="xl:col-span-8 p-6 rounded-[24px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm space-y-5">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-4 flex-wrap pb-2 border-b border-[#e6e0f5] dark:border-[#2b2347]">
                      <div>
                        <h2 className="text-xl font-bold font-['Bricolage_Grotesque',sans-serif] text-[#150f26] dark:text-white leading-tight">
                          Doctors &amp; shifts
                        </h2>
                        <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] mt-0.5">
                          Who is on duty each day, and when the voice agent can book
                        </p>
                      </div>

                      <div className="flex items-center gap-3 flex-wrap">
                        {/* Month / Week / Table Segmented Toggle */}
                        <div className="flex items-center p-1 rounded-xl bg-[#f3f0fb] dark:bg-[#1a1435] border border-[#e6e0f5] dark:border-[#2b2347]">
                          <button
                            type="button"
                            onClick={() => setCalendarViewSpan("month")}
                            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                              calendarViewSpan === "month"
                                ? "bg-white dark:bg-[#120e1f] text-[#150f26] dark:text-white shadow-xs font-bold"
                                : "text-[#625b7e] dark:text-[#a29bc2] hover:text-[#150f26] dark:hover:text-white"
                            }`}
                          >
                            Month
                          </button>
                          <button
                            type="button"
                            onClick={() => setCalendarViewSpan("week")}
                            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                              calendarViewSpan === "week"
                                ? "bg-white dark:bg-[#120e1f] text-[#150f26] dark:text-white shadow-xs font-bold"
                                : "text-[#625b7e] dark:text-[#a29bc2] hover:text-[#150f26] dark:hover:text-white"
                            }`}
                          >
                            Week
                          </button>
                          <button
                            type="button"
                            onClick={() => setDoctorViewMode("table")}
                            title="Switch to full tabular view"
                            className="px-2.5 py-1 rounded-lg text-xs font-semibold text-[#625b7e] dark:text-[#a29bc2] hover:text-[#7c3aed] transition-colors cursor-pointer"
                          >
                            Table
                          </button>
                        </div>

                        {/* Save Shifts Button */}
                        <button
                          type="button"
                          onClick={() => showToast("Doctor shifts and leaves saved successfully")}
                          className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#6d28d9] hover:bg-[#5b21b6] text-white shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
                        >
                          <Save className="h-3.5 w-3.5" />
                          <span>Save shifts</span>
                        </button>
                      </div>
                    </div>

                    {/* Controls & Filter Strip */}
                    <div className="flex items-center justify-between flex-wrap gap-3 pt-1">
                      {/* Month Nav & Today */}
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 border border-[#e6e0f5] dark:border-[#2b2347] rounded-xl px-2.5 py-1 bg-white dark:bg-[#161226]">
                          <button
                            type="button"
                            onClick={() => showToast("Showing November 2026")}
                            className="text-[#625b7e] hover:text-[#150f26] dark:hover:text-white p-0.5 cursor-pointer"
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </button>
                          <span className="text-xs sm:text-sm font-bold text-[#150f26] dark:text-white px-1">
                            November 2026
                          </span>
                          <button
                            type="button"
                            onClick={() => showToast("Showing November 2026")}
                            className="text-[#625b7e] hover:text-[#150f26] dark:hover:text-white p-0.5 cursor-pointer"
                          >
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => setSelectedInspectorDate(todayDate)}
                          className="px-3 py-1.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-white dark:bg-[#161226] text-xs font-semibold text-[#150f26] dark:text-white hover:border-[#6d28d9] transition-all cursor-pointer"
                        >
                          Today
                        </button>
                      </div>

                      {/* SHOW Doctor Filter Chips */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-bold text-[#8b84a6] dark:text-[#7a7299] tracking-wider uppercase">
                          SHOW
                        </span>

                        {/* Doctor 1: Dr. Mehta */}
                        <button
                          type="button"
                          onClick={() => {
                            setActiveDoctorFilterIds((prev) =>
                              prev.includes("mehta") ? prev.filter((id) => id !== "mehta") : [...prev, "mehta"]
                            );
                          }}
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                            activeDoctorFilterIds.length === 0 || activeDoctorFilterIds.includes("mehta")
                              ? "bg-purple-100 dark:bg-purple-950/70 text-[#6d28d9] dark:text-purple-300 border border-purple-300 dark:border-purple-800"
                              : "bg-white dark:bg-[#161226] border border-[#e6e0f5] dark:border-[#2b2347] text-[#625b7e] dark:text-[#a29bc2] opacity-50"
                          }`}
                        >
                          <span className="w-4 h-4 rounded-full bg-[#7c3aed] text-white text-[10px] font-bold grid place-items-center">
                            M
                          </span>
                          <span>Dr. Mehta</span>
                        </button>

                        {/* Doctor 2: Dr. Shah */}
                        <button
                          type="button"
                          onClick={() => {
                            setActiveDoctorFilterIds((prev) =>
                              prev.includes("shah") ? prev.filter((id) => id !== "shah") : [...prev, "shah"]
                            );
                          }}
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                            activeDoctorFilterIds.length === 0 || activeDoctorFilterIds.includes("shah")
                              ? "bg-teal-100 dark:bg-teal-950/70 text-[#0f766e] dark:text-teal-300 border border-teal-300 dark:border-teal-800"
                              : "bg-white dark:bg-[#161226] border border-[#e6e0f5] dark:border-[#2b2347] text-[#625b7e] dark:text-[#a29bc2] opacity-50"
                          }`}
                        >
                          <span className="w-4 h-4 rounded-full bg-[#0d9488] text-white text-[10px] font-bold grid place-items-center">
                            S
                          </span>
                          <span>Dr. Shah</span>
                        </button>

                        {/* Doctor 3: Dr. Joshi */}
                        <button
                          type="button"
                          onClick={() => {
                            setActiveDoctorFilterIds((prev) =>
                              prev.includes("joshi") ? prev.filter((id) => id !== "joshi") : [...prev, "joshi"]
                            );
                          }}
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                            activeDoctorFilterIds.length === 0 || activeDoctorFilterIds.includes("joshi")
                              ? "bg-pink-100 dark:bg-pink-950/70 text-[#be185d] dark:text-pink-300 border border-pink-300 dark:border-pink-800"
                              : "bg-white dark:bg-[#161226] border border-[#e6e0f5] dark:border-[#2b2347] text-[#625b7e] dark:text-[#a29bc2] opacity-50"
                          }`}
                        >
                          <span className="w-4 h-4 rounded-full bg-[#db2777] text-white text-[10px] font-bold grid place-items-center">
                            J
                          </span>
                          <span>Dr. Joshi</span>
                        </button>
                      </div>
                    </div>

                    {/* CALENDAR GRID (Mon to Sun - 7 Columns) */}
                    <div>
                      {/* Weekday Column Headers */}
                      <div className="grid grid-cols-7 gap-2 pb-2">
                        {["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((col) => (
                          <div
                            key={col}
                            className="text-left font-bold text-[11px] text-[#8b84a6] dark:text-[#7a7299] tracking-wider pl-1"
                          >
                            {col}
                          </div>
                        ))}
                      </div>

                      {/* Month Grid */}
                      <div className="grid grid-cols-7 gap-2">
                        {/* ROW 1: Trailing October Days 26 to 31 */}
                        {[26, 27, 28, 29, 30, 31].map((prevDay) => (
                          <div
                            key={`oct-${prevDay}`}
                            className="rounded-2xl p-2.5 min-h-[96px] bg-slate-50/50 dark:bg-white/[0.01] border border-slate-100 dark:border-white/[0.03] opacity-40 select-none text-left"
                          >
                            <span className="font-semibold text-xs text-slate-400 dark:text-slate-600">
                              {prevDay}
                            </span>
                          </div>
                        ))}

                        {/* November 1 (Sunday): Off Duty */}
                        <div
                          onClick={() => setSelectedInspectorDate(1)}
                          className={`rounded-2xl p-2.5 min-h-[96px] calendar-off-striped border transition-all cursor-pointer text-left flex flex-col justify-between ${
                            selectedInspectorDate === 1
                              ? "border-2 border-[#7c3aed] ring-2 ring-[#7c3aed]/20 shadow-md"
                              : "border-[#e6e0f5] dark:border-[#2b2347]"
                          }`}
                        >
                          <span className="font-bold text-xs text-[#625b7e] dark:text-[#a29bc2]">1</span>
                          <span className="text-[11px] font-medium text-[#8b84a6] dark:text-[#7a7299] italic mt-auto">
                            Off duty
                          </span>
                        </div>

                        {/* November 2 through 30 */}
                        {Array.from({ length: 29 }, (_, i) => i + 2).map((dayNum) => {
                          const dayOfWeek = (startOffset + dayNum - 1) % 7;
                          const isSunday = dayOfWeek === 6;
                          const isToday = dayNum === todayDate;
                          const isSelected = selectedInspectorDate === dayNum;
                          const isGapDay = [12, 19, 26].includes(dayNum) || Object.values(doctorLeaves).some((arr) => arr.includes(dayNum));
                          const isEmergencySunday = dayNum === 15;

                          // Sunday Off-Duty
                          if (isSunday && !isEmergencySunday) {
                            return (
                              <button
                                key={`nov-${dayNum}`}
                                type="button"
                                onClick={() => setSelectedInspectorDate(dayNum)}
                                className={`rounded-2xl p-2.5 min-h-[96px] calendar-off-striped border transition-all cursor-pointer text-left flex flex-col justify-between select-none ${
                                  isSelected
                                    ? "border-2 border-[#7c3aed] ring-2 ring-[#7c3aed]/20 shadow-md"
                                    : "border-[#e6e0f5] dark:border-[#2b2347]"
                                }`}
                              >
                                <span className="font-bold text-xs text-[#625b7e] dark:text-[#a29bc2]">
                                  {dayNum}
                                </span>
                                <span className="text-[11px] font-medium text-[#8b84a6] dark:text-[#7a7299] italic mt-auto">
                                  Off duty
                                </span>
                              </button>
                            );
                          }

                          // Sunday 15: Special Emergency Shift
                          if (isEmergencySunday) {
                            return (
                              <button
                                key={`nov-${dayNum}`}
                                type="button"
                                onClick={() => setSelectedInspectorDate(dayNum)}
                                className={`rounded-2xl p-2.5 min-h-[96px] bg-pink-50/50 dark:bg-pink-950/20 border transition-all cursor-pointer text-left flex flex-col justify-between select-none ${
                                  isSelected
                                    ? "border-2 border-[#7c3aed] ring-2 ring-[#7c3aed]/20 shadow-md"
                                    : "border-pink-200 dark:border-pink-900/40 hover:border-pink-400"
                                }`}
                              >
                                <span className="font-bold text-xs text-[#150f26] dark:text-white">
                                  {dayNum}
                                </span>
                                <div className="space-y-1 mt-auto">
                                  <div className="w-5 h-5 rounded-full bg-[#db2777] text-white text-[10px] font-bold grid place-items-center">
                                    J
                                  </div>
                                  <div className="text-[10px] font-semibold text-[#be185d] dark:text-pink-300 leading-tight">
                                    Emergency 10a-2p
                                  </div>
                                </div>
                              </button>
                            );
                          }

                          // Coverage Gap Days: 12, 19, 26
                          if (isGapDay) {
                            const isGap12or19 = dayNum === 12 || dayNum === 19;
                            return (
                              <button
                                key={`nov-${dayNum}`}
                                type="button"
                                onClick={() => setSelectedInspectorDate(dayNum)}
                                className={`rounded-2xl p-2.5 min-h-[96px] bg-[#fef7ee] dark:bg-amber-950/25 border transition-all cursor-pointer text-left flex flex-col justify-between select-none ${
                                  isSelected
                                    ? "border-2 border-[#7c3aed] ring-2 ring-[#7c3aed]/20 shadow-md"
                                    : "border-amber-200 dark:border-amber-900/40 hover:border-amber-400"
                                }`}
                              >
                                <span className="font-bold text-xs text-[#150f26] dark:text-white">
                                  {dayNum}
                                </span>

                                <div className="space-y-1.5 mt-auto">
                                  {/* Doctor Avatar circles */}
                                  <div className="flex items-center gap-1">
                                    {isGap12or19 ? (
                                      <>
                                        <span className="w-5 h-5 rounded-full bg-[#7c3aed] text-white text-[10px] font-bold grid place-items-center">
                                          M
                                        </span>
                                        <span
                                          className="w-5 h-5 rounded-full border-2 border-dashed border-[#0d9488] text-[#0d9488] dark:text-teal-300 text-[10px] font-bold grid place-items-center bg-white/50 dark:bg-white/5"
                                          title="Dr. Shah on leave"
                                        >
                                          S
                                        </span>
                                      </>
                                    ) : (
                                      <>
                                        <span
                                          className="w-5 h-5 rounded-full border-2 border-dashed border-[#7c3aed] text-[#7c3aed] dark:text-purple-300 text-[10px] font-bold grid place-items-center bg-white/50 dark:bg-white/5"
                                          title="Dr. Mehta on leave"
                                        >
                                          M
                                        </span>
                                        <span className="w-5 h-5 rounded-full bg-[#0d9488] text-white text-[10px] font-bold grid place-items-center">
                                          S
                                        </span>
                                      </>
                                    )}
                                  </div>

                                  {/* Gap Alert Label */}
                                  <div className="text-[10px] font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1 leading-tight">
                                    <span>⚠</span>
                                    <span>{isGap12or19 ? "Gap 6p-8p" : "Gap 9a-12p"}</span>
                                  </div>
                                </div>
                              </button>
                            );
                          }

                          // Regular Active Weekdays (including Day 24 - Today)
                          const isDay17 = dayNum === 17;

                          return (
                            <button
                              key={`nov-${dayNum}`}
                              type="button"
                              onClick={() => setSelectedInspectorDate(dayNum)}
                              className={`rounded-2xl p-2.5 min-h-[96px] bg-white dark:bg-[#161226] border transition-all cursor-pointer text-left flex flex-col justify-between select-none ${
                                isSelected || isToday
                                  ? "border-2 border-[#7c3aed] ring-2 ring-[#7c3aed]/20 shadow-md"
                                  : "border-[#e6e0f5] dark:border-[#2b2347] hover:border-[#7c3aed]"
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-xs text-[#150f26] dark:text-white">
                                  {dayNum}
                                </span>
                                {isToday && (
                                  <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-[#150f26] dark:bg-white text-white dark:text-[#150f26]">
                                    Today
                                  </span>
                                )}
                              </div>

                              <div className="space-y-1.5 mt-auto">
                                {/* Doctor Avatar circles */}
                                <div className="flex items-center gap-1">
                                  <span className="w-5 h-5 rounded-full bg-[#7c3aed] text-white text-[10px] font-bold grid place-items-center">
                                    M
                                  </span>
                                  <span className="w-5 h-5 rounded-full bg-[#0d9488] text-white text-[10px] font-bold grid place-items-center">
                                    S
                                  </span>
                                  {isDay17 && (
                                    <span className="w-5 h-5 rounded-full bg-[#db2777] text-white text-[10px] font-bold grid place-items-center">
                                      J
                                    </span>
                                  )}
                                </div>

                                {/* Shift Timing */}
                                <div className="text-[10px] font-medium text-[#625b7e] dark:text-[#a29bc2] leading-tight">
                                  9a-8p
                                </div>
                              </div>
                            </button>
                          );
                        })}

                        {/* Trailing December Days 1 to 6 */}
                        {[1, 2, 3, 4, 5, 6].map((nextDay) => (
                          <div
                            key={`dec-${nextDay}`}
                            className="rounded-2xl p-2.5 min-h-[96px] bg-slate-50/50 dark:bg-white/[0.01] border border-slate-100 dark:border-white/[0.03] opacity-40 select-none text-left"
                          >
                            <span className="font-semibold text-xs text-slate-400 dark:text-slate-600">
                              {nextDay}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Bottom Legend & Hospital Profile Reference */}
                    <div className="pt-3 border-t border-[#e6e0f5] dark:border-[#2b2347] flex items-center justify-between flex-wrap gap-3 text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
                      <div className="flex items-center gap-4 flex-wrap">
                        {/* Legend 1 */}
                        <div className="flex items-center gap-1.5">
                          <span className="w-3 h-3 rounded-xs bg-[#fef7ee] border border-amber-300" />
                          <span>3 days with a coverage gap</span>
                        </div>
                        {/* Legend 2 */}
                        <div className="flex items-center gap-1.5">
                          <span className="w-3.5 h-3.5 rounded-full border-2 border-dashed border-purple-500 text-[8px] font-bold grid place-items-center text-purple-600">
                            S
                          </span>
                          <span>3 days with a doctor on leave</span>
                        </div>
                        {/* Legend 3 */}
                        <div className="flex items-center gap-1.5">
                          <span className="w-3.5 h-3.5 rounded-xs calendar-off-striped border border-[#e6e0f5] dark:border-[#2b2347]" />
                          <span>Off duty</span>
                        </div>
                      </div>

                      <div className="text-[11px] font-medium text-[#8b84a6] dark:text-[#7a7299]">
                        Clinic hours 9 AM - 8 PM, Mon - Sat, from Hospital profile
                      </div>
                    </div>
                  </div>

                  {/* RIGHT COLUMN: Day Inspector & Duty Details Panel (4 cols) */}
                  <div className="xl:col-span-4 p-5 sm:p-6 rounded-[24px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm space-y-6">
                    {/* Header: Day name + Status badge + Date */}
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-[#8b84a6] dark:text-[#7a7299] tracking-wider uppercase">
                          {DAYS_OF_WEEK[(startOffset + selectedInspectorDate - 1) % 7]?.toUpperCase() || "TUESDAY"}
                        </span>

                        {[12, 19, 26].includes(selectedInspectorDate) ? (
                          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                            Coverage gap
                          </span>
                        ) : (startOffset + selectedInspectorDate - 1) % 7 === 6 && selectedInspectorDate !== 15 ? (
                          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border border-slate-200">
                            Off duty
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                            Fully covered
                          </span>
                        )}
                      </div>

                      <h3 className="text-2xl font-bold font-['Bricolage_Grotesque',sans-serif] text-[#150f26] dark:text-white mt-1 leading-tight">
                        {selectedInspectorDate} November
                      </h3>
                    </div>

                    {/* Section: COVERAGE Timeline */}
                    <div className="space-y-2.5">
                      <div className="text-[11px] font-bold text-[#8b84a6] dark:text-[#7a7299] tracking-wider uppercase">
                        COVERAGE
                      </div>

                      {/* Continuous Coverage Bar with 8 AM - 8 PM Timeline */}
                      <div className="space-y-1.5">
                        <div className="h-3 rounded-full bg-[#f3f0fb] dark:bg-[#1f1938] overflow-hidden relative border border-[#e6e0f5] dark:border-[#2b2347]">
                          <div
                            className={`h-full rounded-full transition-all ${
                              [12, 19, 26].includes(selectedInspectorDate)
                                ? "w-[75%] bg-amber-500"
                                : (startOffset + selectedInspectorDate - 1) % 7 === 6 && selectedInspectorDate !== 15
                                ? "w-0"
                                : "w-full bg-[#7c3aed]"
                            }`}
                          />
                        </div>
                        <div className="flex justify-between text-[10px] font-semibold text-[#8b84a6] dark:text-[#7a7299] px-0.5">
                          <span>8 AM</span>
                          <span>12 PM</span>
                          <span>4 PM</span>
                          <span>8 PM</span>
                        </div>
                      </div>

                      {/* Callout Notice Box */}
                      {[12, 19, 26].includes(selectedInspectorDate) ? (
                        <div className="p-3 rounded-xl bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 text-xs text-amber-900 dark:text-amber-200 leading-relaxed font-medium">
                          Coverage gap detected between 6:00 PM and 8:00 PM. Voice agent will not book appointments during this gap.
                        </div>
                      ) : (startOffset + selectedInspectorDate - 1) % 7 === 6 && selectedInspectorDate !== 15 ? (
                        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-medium">
                          Clinic is closed on Sunday. Emergency on-call is available via 102.
                        </div>
                      ) : (
                        <div className="p-3 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 text-xs text-emerald-900 dark:text-emerald-200 leading-relaxed font-medium">
                          Every hour from 9 AM to 8 PM has a doctor. The voice agent can book any slot.
                        </div>
                      )}
                    </div>

                    {/* Section: ON SHIFT Doctors */}
                    <div className="space-y-3">
                      <div className="text-[11px] font-bold text-[#8b84a6] dark:text-[#7a7299] tracking-wider uppercase">
                        ON SHIFT
                      </div>

                      {/* Doctor 1 Card: Dr. Mehta */}
                      <div className="p-3.5 rounded-2xl bg-[#faf8fe] dark:bg-[#16112a] border border-[#e6e0f5] dark:border-[#2b2347] flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-[#7c3aed] text-white font-bold text-xs grid place-items-center shrink-0">
                            M
                          </div>
                          <div className="min-w-0">
                            <h4 className="font-bold text-xs text-[#150f26] dark:text-white truncate">
                              Dr. Mehta
                            </h4>
                            <p className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
                              9:00 AM - 6:00 PM (9 hrs)
                            </p>
                            <div className="h-1.5 w-24 rounded-full bg-[#7c3aed] mt-1.5" />
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            const found = doctors.find((d) => d.full_name.toLowerCase().includes("mehta")) || doctors[0];
                            if (found) {
                              handleOpenEditDoctorModal(found);
                            } else {
                              handleOpenAddDoctorModal();
                            }
                          }}
                          className="p-1.5 rounded-lg text-[#625b7e] hover:text-[#7c3aed] hover:bg-white dark:hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                          title="Edit Dr. Mehta's shift"
                        >
                          <Edit3 className="h-4 w-4" />
                        </button>
                      </div>

                      {/* Doctor 2 Card: Dr. Shah */}
                      <div className="p-3.5 rounded-2xl bg-[#faf8fe] dark:bg-[#16112a] border border-[#e6e0f5] dark:border-[#2b2347] flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-[#0d9488] text-white font-bold text-xs grid place-items-center shrink-0">
                            S
                          </div>
                          <div className="min-w-0">
                            <h4 className="font-bold text-xs text-[#150f26] dark:text-white truncate">
                              Dr. Shah
                            </h4>
                            <p className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
                              12:00 PM - 8:00 PM (8 hrs)
                            </p>
                            <div className="h-1.5 w-24 rounded-full bg-[#0d9488] mt-1.5" />
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            const found = doctors.find((d) => d.full_name.toLowerCase().includes("shah")) || doctors[1] || doctors[0];
                            if (found) {
                              handleOpenEditDoctorModal(found);
                            } else {
                              handleOpenAddDoctorModal();
                            }
                          }}
                          className="p-1.5 rounded-lg text-[#625b7e] hover:text-[#0d9488] hover:bg-white dark:hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                          title="Edit Dr. Shah's shift"
                        >
                          <Edit3 className="h-4 w-4" />
                        </button>
                      </div>

                      {/* Extra Doctor Card for Day 15 or 17: Dr. Joshi */}
                      {(selectedInspectorDate === 15 || selectedInspectorDate === 17) && (
                        <div className="p-3.5 rounded-2xl bg-[#faf8fe] dark:bg-[#16112a] border border-[#e6e0f5] dark:border-[#2b2347] flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-full bg-[#db2777] text-white font-bold text-xs grid place-items-center shrink-0">
                              J
                            </div>
                            <div className="min-w-0">
                              <h4 className="font-bold text-xs text-[#150f26] dark:text-white truncate">
                                Dr. Joshi
                              </h4>
                              <p className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
                                {selectedInspectorDate === 15 ? "10:00 AM - 2:00 PM (4 hrs)" : "9:00 AM - 5:00 PM (8 hrs)"}
                              </p>
                              <div className="h-1.5 w-24 rounded-full bg-[#db2777] mt-1.5" />
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              const found = doctors.find((d) => d.full_name.toLowerCase().includes("joshi")) || doctors[2] || doctors[0];
                              if (found) {
                                handleOpenEditDoctorModal(found);
                              } else {
                                handleOpenAddDoctorModal();
                              }
                            }}
                            className="p-1.5 rounded-lg text-[#625b7e] hover:text-[#db2777] hover:bg-white dark:hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                            title="Edit Dr. Joshi's shift"
                          >
                            <Edit3 className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Inspector Action Buttons */}
                    <div className="space-y-2.5 pt-2 border-t border-[#e6e0f5] dark:border-[#2b2347]">
                      {/* Scope Segmented Switch */}
                      <div className="grid grid-cols-2 p-1 rounded-xl bg-[#f3f0fb] dark:bg-[#1a1435] border border-[#e6e0f5] dark:border-[#2b2347]">
                        <button
                          type="button"
                          onClick={() => setSelectedDateScope("date")}
                          className={`py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer text-center ${
                            selectedDateScope === "date"
                              ? "bg-white dark:bg-[#120e1f] text-[#150f26] dark:text-white shadow-xs font-bold"
                              : "text-[#625b7e] dark:text-[#a29bc2]"
                          }`}
                        >
                          This date only
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedDateScope("dayOfWeek")}
                          className={`py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer text-center ${
                            selectedDateScope === "dayOfWeek"
                              ? "bg-white dark:bg-[#120e1f] text-[#150f26] dark:text-white shadow-xs font-bold"
                              : "text-[#625b7e] dark:text-[#a29bc2]"
                          }`}
                        >
                          Every {DAYS_OF_WEEK[(startOffset + selectedInspectorDate - 1) % 7] || "Tuesday"}
                        </button>
                      </div>

                      {/* Add Doctor to this Day */}
                      <button
                        type="button"
                        onClick={handleOpenAddDoctorModal}
                        className="w-full py-2.5 px-4 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-white dark:bg-[#161226] hover:border-[#6d28d9] hover:text-[#6d28d9] text-xs font-bold text-[#150f26] dark:text-white transition-all cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        <Plus className="h-4 w-4" />
                        <span>Add doctor to this day</span>
                      </button>

                      {/* Bottom 2 Action Buttons */}
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setDoctorLeaves((prev) => {
                              const key = "doc-shah";
                              const cur = prev[key] || [];
                              const upd = cur.includes(selectedInspectorDate)
                                ? cur.filter((d) => d !== selectedInspectorDate)
                                : [...cur, selectedInspectorDate];
                              return { ...prev, [key]: upd };
                            });
                            showToast(`Leave status updated for ${selectedInspectorDate} November`);
                          }}
                          className="py-2 px-3 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-white dark:bg-[#161226] hover:bg-[#faf8fe] text-xs font-semibold text-[#150f26] dark:text-white transition-colors cursor-pointer text-center"
                        >
                          Mark leave
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            showToast(`Shift schedule copied for ${selectedInspectorDate} November`);
                          }}
                          className="py-2 px-3 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-white dark:bg-[#161226] hover:bg-[#faf8fe] text-xs font-semibold text-[#150f26] dark:text-white transition-colors cursor-pointer text-center"
                        >
                          Copy to...
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                /* VIEW B: DOCTOR ROSTER TABLE (Clean, Complete Table with Search, Filter & Actions) */
                <div className="p-6 rounded-[24px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm space-y-6">
                  {/* Table Switcher Header */}
                  <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-[#e6e0f5] dark:border-[#2b2347]">
                    <div className="flex items-center gap-2">
                      <div className="p-2 rounded-xl bg-purple-100 dark:bg-purple-950/70 text-[#7c3aed]">
                        <Stethoscope className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="font-bold text-sm text-[#150f26] dark:text-white">
                          Doctor Directory &amp; Roster
                        </h3>
                        <p className="text-xs text-[#625b7e] dark:text-[#a29bc2]">
                          Manage doctor credentials, consultation fees, and profile records
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setDoctorViewMode("calendar")}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#fcfaff] dark:bg-white/5 hover:bg-white text-xs font-semibold text-[#7c3aed] transition-colors cursor-pointer"
                      >
                        <Calendar className="h-3.5 w-3.5" />
                        <span>View Duty Calendar</span>
                      </button>

                      {!isOperator && (
                        <button
                          type="button"
                          onClick={handleOpenAddDoctorModal}
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-[#7c3aed] to-[#9333ea] text-white hover:brightness-105 shadow-sm shadow-purple-600/30 transition-all cursor-pointer"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>Add Doctor</span>
                        </button>
                      )}
                    </div>
                  </div>

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
              VIEW 5: VOICE AI STUDIO (Microphone Interactive Simulation)
              ========================================================================= */}
          {activeTab === "voice" && (
            <div className="space-y-6">
              <div className="p-6 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm space-y-6">
                {/* Header Action Strip */}
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#f3f0fb] dark:bg-[#1a1530] border border-[#e6e0f5] dark:border-[#2b2347] text-[#150f26] dark:text-white">
                    <Sparkles className="h-3.5 w-3.5 text-[#7c3aed]" />
                    <span>Speech &rarr; AI &rarr; Voice</span>
                  </span>

                  <div className="flex items-center gap-3">
                    {/* Language Segmented Control */}
                    <div className="inline-flex p-1 rounded-xl bg-[#f3f0fb] dark:bg-[#1a1530] border border-[#e6e0f5] dark:border-[#2b2347]">
                      <button
                        type="button"
                        onClick={() => setVoiceLanguage("en")}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                          voiceLanguage === "en"
                            ? "bg-gradient-to-r from-[#6d28d9] to-[#9333ea] text-white shadow-xs"
                            : "text-[#625b7e] dark:text-[#a29bc2]"
                        }`}
                      >
                        English
                      </button>
                      <button
                        type="button"
                        onClick={() => setVoiceLanguage("hi")}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                          voiceLanguage === "hi"
                            ? "bg-gradient-to-r from-[#6d28d9] to-[#9333ea] text-white shadow-xs"
                            : "text-[#625b7e] dark:text-[#a29bc2]"
                        }`}
                      >
                        Hindi / Hinglish
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => showToast("Voice context cleared")}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] text-xs font-semibold text-[#150f26] dark:text-white hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                    >
                      <RotateCcw className="h-3.5 w-3.5 text-[#625b7e]" />
                      <span>Reset</span>
                    </button>
                  </div>
                </div>

                {/* Voice Engine Status 3-Grid */}
                <div className="space-y-3">
                  <h2 className="font-['Bricolage_Grotesque',sans-serif] text-base font-bold text-[#150f26] dark:text-white">
                    Voice engine status
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* STT */}
                    <div className="p-4 rounded-[16px] border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] flex flex-col justify-between space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-950/60 text-[#7c3aed] grid place-items-center">
                            <Mic className="h-4 w-4" />
                          </div>
                          <div>
                            <small className="text-[11px] text-[#625b7e] dark:text-[#a29bc2] block">Speech to text</small>
                            <b className="text-xs font-bold text-[#150f26] dark:text-white">Google Speech</b>
                          </div>
                        </div>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#d1fae5] dark:bg-[rgba(16,185,129,0.16)] text-[#059669] dark:text-[#34d399]">
                          Ready
                        </span>
                      </div>
                      <small className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">Streaming recognition active</small>
                    </div>

                    {/* LLM */}
                    <div className="p-4 rounded-[16px] border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] flex flex-col justify-between space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-950/60 text-[#7c3aed] grid place-items-center">
                            <Cpu className="h-4 w-4" />
                          </div>
                          <div>
                            <small className="text-[11px] text-[#625b7e] dark:text-[#a29bc2] block">Conversation AI</small>
                            <b className="text-xs font-bold text-[#150f26] dark:text-white">Gemini Flash Lite</b>
                          </div>
                        </div>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#d1fae5] dark:bg-[rgba(16,185,129,0.16)] text-[#059669] dark:text-[#34d399]">
                          Ready
                        </span>
                      </div>
                      <small className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">Sub-800ms thought scrubbing</small>
                    </div>

                    {/* TTS */}
                    <div className="p-4 rounded-[16px] border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] flex flex-col justify-between space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-950/60 text-[#7c3aed] grid place-items-center">
                            <Volume2 className="h-4 w-4" />
                          </div>
                          <div>
                            <small className="text-[11px] text-[#625b7e] dark:text-[#a29bc2] block">Text to speech</small>
                            <b className="text-xs font-bold text-[#150f26] dark:text-white">Piper Neural ONNX</b>
                          </div>
                        </div>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#d1fae5] dark:bg-[rgba(16,185,129,0.16)] text-[#059669] dark:text-[#34d399]">
                          Ready
                        </span>
                      </div>
                      <small className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">Voice: en_US-lessac-medium</small>
                    </div>
                  </div>
                </div>

                {/* Live Playground Canvas */}
                <div className="rounded-[18px] border border-dashed border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb]/60 dark:bg-[#1a1530]/60 p-6">
                  <VoicePlayground />
                </div>
              </div>
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
            <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col rounded-[24px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.5)] overflow-hidden animate-in zoom-in-95 duration-150">
              {/* Modal Header */}
              <div className="px-6 py-4 border-b border-[#e6e0f5] dark:border-[#2b2347] flex items-center justify-between shrink-0 bg-[#faf8fe] dark:bg-[#16112a]">
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-[14px] bg-gradient-to-br from-[#6d28d9] to-[#9333ea] text-white grid place-items-center shadow-md shadow-purple-600/30">
                    <Stethoscope className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-['Bricolage_Grotesque',sans-serif] text-lg sm:text-xl font-bold text-[#150f26] dark:text-white leading-tight">
                      {editingDoctorId ? "Edit doctor" : "Register doctor"}
                    </h2>
                    <p className="text-xs text-[#625b7e] dark:text-[#a29bc2]">
                      Set doctor credentials, consultation fees, and weekly consultation shifts.
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

              {/* Modal Form Body - Side-by-Side 2 Columns */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSaveDoctor();
                }}
                noValidate
                className="flex-1 overflow-y-auto px-6 py-5 space-y-4"
              >
                {doctorFormError && (
                  <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-600 dark:text-red-400 font-semibold flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{doctorFormError}</span>
                  </div>
                )}

              {/* 2-Column Grid: Left = Details & Fees, Right = Shifts */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
                {/* LEFT COLUMN: Credentials & Fee (5 cols) */}
                <div className="md:col-span-5 space-y-4">
                  {/* Full Name */}
                  <div className="space-y-1.5">
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
                  <div className="space-y-1.5">
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
                      {["General Physician", "Cardiology", "Pediatrics", "Orthopedics"].map((spec) => {
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
                            className={`px-3 py-1 rounded-full text-[11px] transition-all cursor-pointer ${
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
                    <div className="grid grid-cols-4 gap-2">
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
                  </div>
                </div>

                {/* RIGHT COLUMN: Weekly Consultation Shifts (Mini Calendar matching Hospital Profile) */}
                <div className="md:col-span-7 space-y-3.5 p-4 sm:p-5 rounded-2xl bg-[#faf8fe] dark:bg-[#16112a] border border-[#e6e0f5] dark:border-[#2b2347]">
                  {/* Shifts Header with Presets */}
                  <div className="flex items-center justify-between flex-wrap gap-2 pb-2.5 border-b border-[#e6e0f5] dark:border-[#2b2347]">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-purple-100/70 dark:bg-purple-950/70 text-[#7c3aed]">
                        <Clock className="h-4 w-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-[#150f26] dark:text-white leading-tight">
                          Consultation shift schedule
                        </h4>
                        <p className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
                          Tap weekday to toggle shift. Tap date to toggle one-off leave.
                        </p>
                      </div>
                    </div>

                    {/* Presets Toolbar */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => applyDoctorShiftPreset("weekdays")}
                        className="px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-white dark:bg-[#1f1938] border border-[#e6e0f5] dark:border-[#2b2347] text-[#625b7e] dark:text-[#a29bc2] hover:text-[#7c3aed] hover:border-[#7c3aed] transition-colors cursor-pointer"
                      >
                        Mon-Fri (9-5)
                      </button>
                      <button
                        type="button"
                        onClick={() => applyDoctorShiftPreset("mon-sat")}
                        className="px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-white dark:bg-[#1f1938] border border-[#e6e0f5] dark:border-[#2b2347] text-[#625b7e] dark:text-[#a29bc2] hover:text-[#7c3aed] hover:border-[#7c3aed] transition-colors cursor-pointer"
                      >
                        Mon-Sat (9-6)
                      </button>
                      <button
                        type="button"
                        onClick={() => applyDoctorShiftPreset("all-week")}
                        className="px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-white dark:bg-[#1f1938] border border-[#e6e0f5] dark:border-[#2b2347] text-[#625b7e] dark:text-[#a29bc2] hover:text-[#7c3aed] hover:border-[#7c3aed] transition-colors cursor-pointer"
                      >
                        All 7 days
                      </button>
                      <button
                        type="button"
                        onClick={() => applyDoctorShiftPreset("clear")}
                        className="px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-white dark:bg-[#1f1938] border border-[#e6e0f5] dark:border-[#2b2347] text-[#625b7e] dark:text-[#a29bc2] hover:text-red-500 hover:border-red-400 transition-colors cursor-pointer"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  {/* Top Weekday Buttons (Mon to Sun) */}
                  <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                    {WEEKDAYS.map((day) => {
                      const avail = doctorFormData.availabilities.find(
                        (a) => a.day_of_week === day.index
                      );
                      const isActive = avail ? avail.is_active : false;
                      const timeText = isActive
                        ? formatShortRange(avail?.start_time, avail?.end_time, false)
                        : "Off";

                      return (
                        <button
                          key={day.index}
                          type="button"
                          onClick={() => handleToggleDoctorModalDay(day.index)}
                          title={`Click to toggle ${day.label}`}
                          className={`py-1.5 px-0.5 rounded-xl text-center transition-all cursor-pointer flex flex-col items-center justify-center select-none shadow-xs ${
                            isActive
                              ? "bg-[#6d28d9] text-white hover:bg-[#5b21b6]"
                              : "bg-white dark:bg-[#161226] border border-[#e6e0f5] dark:border-[#2b2347] text-[#150f26] dark:text-white hover:border-[#6d28d9]"
                          }`}
                        >
                          <span className="font-bold text-[11px] leading-tight">{day.label}</span>
                          <span
                            className={`text-[9.5px] font-medium leading-tight mt-0.5 ${
                              isActive ? "text-purple-100" : "text-[#8b84a6] dark:text-[#7a7299]"
                            }`}
                          >
                            {timeText}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Compact Month Calendar Grid (7 columns) */}
                  <div className="grid grid-cols-7 gap-1 sm:gap-1.5 mt-2">
                    {/* Spacers for days before 1st */}
                    {Array.from({ length: startOffset }).map((_, i) => (
                      <div key={`modal-spacer-${i}`} className="min-h-[44px] sm:min-h-[48px]" />
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
                          className={`relative rounded-xl p-1 sm:p-1.5 flex flex-col justify-between min-h-[44px] sm:min-h-[48px] transition-all cursor-pointer select-none text-left ${
                            isLeave
                              ? "bg-amber-50/90 dark:bg-amber-950/40 border-2 border-amber-400 dark:border-amber-500 shadow-xs"
                              : isRegularActive
                              ? "bg-[#f1edfc] dark:bg-[#1e1738] border border-[#e2daf5] dark:border-[#2e2350] hover:border-[#7c3aed]"
                              : "calendar-off-striped border border-[#e6e0f5] dark:border-[#2b2347]"
                          } ${
                            isToday
                              ? "border-2 border-[#150f26] dark:border-white shadow-xs ring-1 ring-[#150f26]/20 dark:ring-white/20"
                              : ""
                          }`}
                        >
                          <span
                            className={`font-bold text-[11px] sm:text-xs leading-none ${
                              isLeave
                                ? "text-amber-900 dark:text-amber-200"
                                : isRegularActive
                                ? "text-[#150f26] dark:text-white"
                                : "text-[#625b7e] dark:text-[#a29bc2]"
                            }`}
                          >
                            {dayNum}
                          </span>
                          <span
                            className={`text-[9px] font-medium leading-none ${
                              isLeave
                                ? "text-amber-700 dark:text-amber-300 font-semibold"
                                : isRegularActive
                                ? "text-[#625b7e] dark:text-[#a29bc2]"
                                : "text-[#8b84a6] dark:text-[#7a7299]"
                            }`}
                          >
                            {isLeave ? "Leave" : timeText}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Standard Shift Hours Setting */}
                  <div className="pt-2 border-t border-[#e6e0f5] dark:border-[#2b2347] flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-[#150f26] dark:text-white">
                        Active Shift:
                      </span>
                      <input
                        type="time"
                        value={
                          doctorFormData.availabilities.find((a) => a.is_active)?.start_time || "09:00"
                        }
                        onChange={(e) => {
                          const newStart = e.target.value;
                          setDoctorFormData((prev) => ({
                            ...prev,
                            availabilities: prev.availabilities.map((a) =>
                              a.is_active ? { ...a, start_time: newStart } : a
                            ),
                          }));
                        }}
                        className="h-7 w-[96px] px-2 rounded-lg border border-[#e6e0f5] dark:border-[#2b2347] bg-white dark:bg-[#120e1f] text-xs font-mono font-medium text-[#150f26] dark:text-white focus:outline-none focus:border-[#7c3aed]"
                      />
                      <span className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">to</span>
                      <input
                        type="time"
                        value={
                          doctorFormData.availabilities.find((a) => a.is_active)?.end_time || "18:00"
                        }
                        onChange={(e) => {
                          const newEnd = e.target.value;
                          setDoctorFormData((prev) => ({
                            ...prev,
                            availabilities: prev.availabilities.map((a) =>
                              a.is_active ? { ...a, end_time: newEnd } : a
                            ),
                          }));
                        }}
                        className="h-7 w-[96px] px-2 rounded-lg border border-[#e6e0f5] dark:border-[#2b2347] bg-white dark:bg-[#120e1f] text-xs font-mono font-medium text-[#150f26] dark:text-white focus:outline-none focus:border-[#7c3aed]"
                      />
                    </div>

                    <div className="text-[11px] font-semibold text-[#7c3aed] dark:text-purple-300">
                      {totalDoctorWeeklyHours}
                    </div>
                  </div>

                  {/* Compact Bottom Legend & Summary */}
                  <div className="px-3 py-1.5 rounded-xl bg-white dark:bg-[#1a1435] border border-[#e6e0f5] dark:border-[#2b2347] flex items-center justify-between text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
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
                  </div>                </div>
              </div>

              {/* Modal Actions */}
              <div className="pt-3 border-t border-[#e6e0f5] dark:border-[#2b2347] flex items-center justify-end gap-3">
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
