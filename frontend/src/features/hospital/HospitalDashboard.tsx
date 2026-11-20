import React, { useState, useEffect, useMemo } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import {
  LayoutDashboard,
  BarChart3,
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
  Check,
  AlertCircle,
  X,
  Server,
  Database,
  Cpu,
  LogOut,
  Sun,
  Moon,
  Sparkles,
  Search,
  Volume2,
  RotateCcw,
  Copy,
  Calendar,
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

type TabType = "dashboard" | "analytics" | "doctors" | "voice" | "profile";

export const HospitalDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const [searchParams, setSearchParams] = useSearchParams();

  // Map legacy 'test' parameter to 'voice'
  const rawTab = searchParams.get("tab");
  const initialTab: TabType =
    rawTab === "test"
      ? "voice"
      : (rawTab as TabType) || "dashboard";

  const [activeTab, setActiveTab] = useState<TabType>(initialTab);

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

  // Toast State
  const [toastMessage, setToastMessage] = useState<string | null>(null);
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

  // Doctor Filter State
  const [doctorSearchQuery, setDoctorSearchQuery] = useState("");
  const [selectedSpecialty, setSelectedSpecialty] = useState("");

  // Analytics Filter State
  const [analyticsRange, setAnalyticsRange] = useState<7 | 30>(7);

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

  // Filtered Doctors
  const filteredDoctors = useMemo(() => {
    return doctors.filter((doc) => {
      const matchSearch =
        doc.full_name.toLowerCase().includes(doctorSearchQuery.toLowerCase()) ||
        doc.specialization.toLowerCase().includes(doctorSearchQuery.toLowerCase());
      const matchSpecialty =
        !selectedSpecialty || doc.specialization === selectedSpecialty;
      return matchSearch && matchSpecialty;
    });
  }, [doctors, doctorSearchQuery, selectedSpecialty]);

  const uniqueSpecialties = useMemo(() => {
    const set = new Set<string>();
    doctors.forEach((d) => set.add(d.specialization));
    return Array.from(set);
  }, [doctors]);

  // Check if hospital hours are set
  const hoursSet = useMemo(() => {
    return operatingHours.some((h) => !h.is_closed && h.open_time && h.close_time);
  }, [operatingHours]);

  // Open Modal for New Doctor
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
    setShowDoctorModal(true);
  };

  // Open Modal for Edit Doctor
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
        const updated = await apiClient.put<DoctorItem>(
          `/api/v1/doctors/${editingDoctorId}`,
          payload
        );
        setDoctors((prev) => prev.map((d) => (d.id === editingDoctorId ? updated : d)));
        showToast("Physician details updated");
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

  // Delete Doctor
  const handleDeleteDoctor = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete ${name} from your roster?`)) {
      return;
    }

    try {
      await apiClient.delete(`/api/v1/doctors/${id}`);
      setDoctors((prev) => prev.filter((d) => d.id !== id));
      showToast(`${name} removed from roster`);
    } catch (err) {
      console.error("Failed to delete doctor:", err);
      showToast("Failed to delete physician");
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
            open_time: willClose ? null : "09:00",
            close_time: willClose ? null : "20:00",
          };
        }
        return h;
      })
    );
  };

  // Update Operating Time
  const handleUpdateOperatingTime = (
    dayIndex: number,
    field: "open_time" | "close_time",
    val: string
  ) => {
    setOperatingHours((prev) =>
      prev.map((h) => {
        if (h.day_of_week === dayIndex) {
          return { ...h, [field]: val };
        }
        return h;
      })
    );
  };

  // Copy Monday timings to Friday
  const handleCopyMonToFri = () => {
    const mon = operatingHours.find((h) => h.day_of_week === 0);
    if (!mon) return;

    setOperatingHours((prev) =>
      prev.map((h) => {
        if (h.day_of_week >= 1 && h.day_of_week <= 4) {
          return {
            ...h,
            is_closed: mon.is_closed,
            open_time: mon.open_time,
            close_time: mon.close_time,
          };
        }
        return h;
      })
    );
    showToast("Monday timings copied to Friday");
  };

  // Save Hospital Profile & Operating Hours
  const handleSaveProfileAndHours = async () => {
    setIsSavingProfile(true);

    try {
      const profilePromise = apiClient.put<TenantData>("/api/v1/tenants/me", {
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

      const hoursPromise = apiClient.put<OperatingHoursItem[]>(
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
  const todayDayIndex = (new Date().getDay() + 6) % 7; // 0=Mon ... 6=Sun

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

  const getTimelinePercentage = (time: string | null) => {
    if (!time) return 0;
    const [h, m] = time.split(":").map(Number);
    return Math.min(100, Math.max(0, ((h * 60 + m) / (24 * 60)) * 100));
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

  const setDayQuickTiming = (dayOfWeek: number, open: string | null, close: string | null, isClosed: boolean) => {
    setOperatingHours((prev) =>
      prev.map((h) => {
        if (h.day_of_week === dayOfWeek) {
          return {
            ...h,
            is_closed: isClosed,
            open_time: open,
            close_time: close,
          };
        }
        return h;
      })
    );
  };

  const activeDaysCount = operatingHours.filter((h) => !h.is_closed).length;
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

  // Analytics Dynamic Series
  const analyticsData = useMemo(() => {
    if (analyticsRange === 7) {
      return {
        labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        calls: [46, 58, 52, 64, 61, 38, 29],
        booked: [27, 34, 30, 37, 35, 22, 17],
        totCalls: 348,
        totBooked: 202,
        escalations: 10,
        avgLatency: "640 ms",
      };
    } else {
      const labels = Array.from({ length: 30 }, (_, i) => String(i + 1));
      const calls = labels.map((_, i) =>
        Math.round(46 + 16 * Math.sin(i / 2.6) + i * 0.5 - (i % 7 > 4 ? 14 : 0))
      );
      const booked = calls.map((c) => Math.round(c * 0.58));
      const totCalls = calls.reduce((a, b) => a + b, 0);
      const totBooked = booked.reduce((a, b) => a + b, 0);
      return {
        labels,
        calls,
        booked,
        totCalls,
        totBooked,
        escalations: Math.round(totCalls * 0.03),
        avgLatency: "640 ms",
      };
    }
  }, [analyticsRange]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f5ff] dark:bg-[#07050d] text-[#150f26] dark:text-[#f6f3ff] font-sans antialiased">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-9 w-9 animate-spin text-[#7c3aed]" />
          <p className="text-xs font-semibold text-[#625b7e] dark:text-[#a29bc2]">
            Loading Clinical Workspace...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full bg-[#f7f5ff] dark:bg-[#07050d] text-[#150f26] dark:text-[#f6f3ff] font-['Figtree',system-ui,sans-serif] antialiased overflow-hidden select-none">
      {/* =========================================================================
          LEFT SIDEBAR: EXACT SPEC FROM Hospital_Voice_Agent.html
          ========================================================================= */}
      <aside className="w-[264px] h-screen bg-white dark:bg-black border-r border-[#e6e0f5] dark:border-[#2b2347] flex flex-col justify-between p-5 shrink-0 z-30 overflow-y-auto">
        <div className="flex flex-col gap-5">
          {/* Brand Header */}
          <Link to="/" className="flex items-center gap-3 group px-1">
            <div className="w-[42px] h-[42px] rounded-[13px] bg-gradient-to-br from-[#6d28d9] to-[#9333ea] grid place-items-center text-white shadow-[0_8px_20px_-6px_#7c3aed] group-hover:scale-105 transition-transform shrink-0">
              <PhoneCall className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <b className="block font-['Bricolage_Grotesque',sans-serif] font-bold text-[17px] leading-tight text-[#150f26] dark:text-white truncate">
                Hospital Voice Agent
              </b>
              <small className="text-[#625b7e] dark:text-[#a29bc2] text-[12.5px] block font-medium">
                Workspace edition
              </small>
            </div>
          </Link>

          {/* Navigation Tabs (Top-to-Bottom Vertical Tabs) */}
          <nav className="flex flex-col gap-1">
            {/* 1. Dashboard */}
            <button
              type="button"
              onClick={() => handleTabChange("dashboard")}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-medium text-[14px] transition-all cursor-pointer ${
                activeTab === "dashboard"
                  ? "bg-gradient-to-r from-[#6d28d9] to-[#9333ea] text-white shadow-[0_8px_20px_-10px_#6d28d9] font-semibold"
                  : "text-[#625b7e] dark:text-[#a29bc2] hover:bg-[#f3f0fb] dark:hover:bg-[#1a1530] hover:text-[#150f26] dark:hover:text-white"
              }`}
            >
              <LayoutDashboard className="h-4 w-4 shrink-0" />
              <span>Dashboard</span>
            </button>

            {/* 2. Analytics */}
            <button
              type="button"
              onClick={() => handleTabChange("analytics")}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-medium text-[14px] transition-all cursor-pointer ${
                activeTab === "analytics"
                  ? "bg-gradient-to-r from-[#6d28d9] to-[#9333ea] text-white shadow-[0_8px_20px_-10px_#6d28d9] font-semibold"
                  : "text-[#625b7e] dark:text-[#a29bc2] hover:bg-[#f3f0fb] dark:hover:bg-[#1a1530] hover:text-[#150f26] dark:hover:text-white"
              }`}
            >
              <BarChart3 className="h-4 w-4 shrink-0" />
              <span>Analytics</span>
            </button>

            {/* 3. Doctors & Shifts */}
            <button
              type="button"
              onClick={() => handleTabChange("doctors")}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-medium text-[14px] transition-all cursor-pointer ${
                activeTab === "doctors"
                  ? "bg-gradient-to-r from-[#6d28d9] to-[#9333ea] text-white shadow-[0_8px_20px_-10px_#6d28d9] font-semibold"
                  : "text-[#625b7e] dark:text-[#a29bc2] hover:bg-[#f3f0fb] dark:hover:bg-[#1a1530] hover:text-[#150f26] dark:hover:text-white"
              }`}
            >
              <Stethoscope className="h-4 w-4 shrink-0" />
              <span>Doctors &amp; shifts</span>
              <em
                className={`ml-auto not-italic text-xs px-2 py-0.5 rounded-full font-bold ${
                  activeTab === "doctors"
                    ? "bg-white/22 text-white"
                    : "bg-[#f3f0fb] dark:bg-[#1a1530] text-[#625b7e] dark:text-[#a29bc2]"
                }`}
              >
                {doctors.length}
              </em>
            </button>

            {/* 4. Voice AI Studio */}
            <button
              type="button"
              onClick={() => handleTabChange("voice")}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-medium text-[14px] transition-all cursor-pointer ${
                activeTab === "voice"
                  ? "bg-gradient-to-r from-[#6d28d9] to-[#9333ea] text-white shadow-[0_8px_20px_-10px_#6d28d9] font-semibold"
                  : "text-[#625b7e] dark:text-[#a29bc2] hover:bg-[#f3f0fb] dark:hover:bg-[#1a1530] hover:text-[#150f26] dark:hover:text-white"
              }`}
            >
              <Mic className="h-4 w-4 shrink-0" />
              <span>Voice AI studio</span>
              <em
                className={`ml-auto not-italic text-xs px-2 py-0.5 rounded-full font-bold ${
                  activeTab === "voice"
                    ? "bg-white/22 text-white"
                    : "bg-[#f3f0fb] dark:bg-[#1a1530] text-[#625b7e] dark:text-[#a29bc2]"
                }`}
              >
                Live
              </em>
            </button>

            {/* 5. Hospital Profile */}
            <button
              type="button"
              onClick={() => handleTabChange("profile")}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-medium text-[14px] transition-all cursor-pointer ${
                activeTab === "profile"
                  ? "bg-gradient-to-r from-[#6d28d9] to-[#9333ea] text-white shadow-[0_8px_20px_-10px_#6d28d9] font-semibold"
                  : "text-[#625b7e] dark:text-[#a29bc2] hover:bg-[#f3f0fb] dark:hover:bg-[#1a1530] hover:text-[#150f26] dark:hover:text-white"
              }`}
            >
              <Building2 className="h-4 w-4 shrink-0" />
              <span>Hospital profile</span>
              <em
                className={`ml-auto not-italic text-xs px-2 py-0.5 rounded-full font-bold ${
                  activeTab === "profile"
                    ? "bg-white/22 text-white"
                    : "bg-[#f3f0fb] dark:bg-[#1a1530] text-[#625b7e] dark:text-[#a29bc2]"
                }`}
              >
                {hoursSet ? "Set" : "Setup"}
              </em>
            </button>
          </nav>
        </div>

        {/* Sidebar Bottom: Theme Toggle, Engine Status, User Avatar */}
        <div className="flex flex-col gap-2.5 pt-4">
          {/* Theme Button */}
          <button
            type="button"
            onClick={toggleTheme}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] text-[13px] font-medium text-[#150f26] dark:text-white hover:bg-purple-100/60 dark:hover:bg-purple-950/40 transition-colors cursor-pointer"
          >
            <span>{isDark ? "Light mode" : "Dark mode"}</span>
            {isDark ? (
              <Sun className="h-4 w-4 text-amber-400" />
            ) : (
              <Moon className="h-4 w-4 text-[#625b7e]" />
            )}
          </button>

          {/* AI Engine Status Card */}
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] text-[13px] font-medium text-[#150f26] dark:text-white">
            <span className="w-2 h-2 rounded-full bg-[#4ade80] shadow-[0_0_0_4px_rgba(74,222,128,0.22)] shrink-0" />
            <span>AI engine online</span>
            <span className="ml-auto text-[12px] text-[#625b7e] dark:text-[#a29bc2] font-mono">
              &lt;800 ms
            </span>
          </div>

          {/* User Profile Card */}
          <div className="flex items-center gap-2.5 px-2 py-2 text-[13px]">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#6d28d9] to-[#9333ea] text-white font-bold grid place-items-center shrink-0 text-sm shadow-xs">
              {(user?.full_name || tenant?.name || "A").charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <b className="block text-[13.5px] text-[#150f26] dark:text-white truncate">
                {user?.full_name || "Admin Staff"}
              </b>
              <small className="text-[#625b7e] dark:text-[#a29bc2] text-[11.5px] block truncate">
                {user?.email || "admin@hospital.org"}
              </small>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              title="Sign Out"
              className="text-[#625b7e] hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* =========================================================================
          MAIN WORKSPACE CANVAS (Scrollable edge-to-edge container)
          ========================================================================= */}
      <main className="flex-1 min-w-0 h-screen overflow-y-auto px-6 sm:px-10 py-6 pb-20">
        <div className="max-w-[1180px] mx-auto space-y-6">
          {/* Top Breadcrumb & Status Bar */}
          <header className="flex items-center justify-between flex-wrap gap-4 pb-4 border-b border-[#e6e0f5] dark:border-[#2b2347]">
            <div>
              <h1 className="font-['Bricolage_Grotesque',sans-serif] text-2xl sm:text-[28px] font-bold text-[#150f26] dark:text-white leading-tight">
                {activeTab === "dashboard" && "Dashboard"}
                {activeTab === "analytics" && "Call analytics"}
                {activeTab === "doctors" && "Doctors and shifts"}
                {activeTab === "voice" && "Voice AI studio"}
                {activeTab === "profile" && "Hospital profile"}
              </h1>
              <p className="text-[13.5px] text-[#625b7e] dark:text-[#a29bc2] mt-0.5">
                {activeTab === "dashboard" && (tenant?.name || "Hospital workspace")}
                {activeTab === "analytics" && "Call performance & real-time telemetry"}
                {activeTab === "doctors" && "Manage physicians, fees and weekly availability"}
                {activeTab === "voice" && "Try a live simulated phone call with your AI agent"}
                {activeTab === "profile" && "Contact lines, location and clinic operating hours"}
              </p>
            </div>

            <div className="flex items-center gap-3">
              {/* Status Chip */}
              <span
                className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold ${
                  hoursSet
                    ? "bg-[#d1fae5] dark:bg-[rgba(16,185,129,0.16)] text-[#059669] dark:text-[#34d399]"
                    : "bg-[#fef3c7] dark:bg-[rgba(245,158,11,0.16)] text-[#b45309] dark:text-[#fbbf24]"
                }`}
              >
                <Clock className="h-3.5 w-3.5" />
                <span>{hoursSet ? "Hours set" : "Hours not set"}</span>
              </span>

              {/* Add Doctor CTA (shown on Doctors tab) */}
              {activeTab === "doctors" && (
                <button
                  type="button"
                  onClick={handleOpenAddDoctorModal}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-[#6d28d9] to-[#9333ea] text-white font-semibold text-xs shadow-md shadow-purple-600/30 hover:brightness-105 active:scale-95 transition-all cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  <span>Add doctor</span>
                </button>
              )}
            </div>
          </header>

          {/* =========================================================================
              VIEW 1: DASHBOARD
              ========================================================================= */}
          {activeTab === "dashboard" && (
            <div className="space-y-6">
              {/* Hero Banner */}
              <div className="relative overflow-hidden rounded-[24px] p-8 sm:p-9 text-white bg-[radial-gradient(520px_240px_at_92%_0,rgba(255,255,255,0.26),transparent_65%),linear-gradient(135deg,#1a0b3b_0%,#5b21b6_58%,#9333ea_100%)] shadow-[0_24px_50px_-26px_#6d28d9] flex flex-wrap items-center justify-between gap-6 before:content-[''] before:absolute before:-left-16 before:-bottom-24 before:w-64 before:h-64 before:rounded-full before:bg-white/5">
                <div className="relative z-10 max-w-xl space-y-2">
                  <h2 className="font-['Bricolage_Grotesque',sans-serif] text-2xl sm:text-3xl font-bold leading-tight">
                    Your clinic’s phone line, answered in Hindi, Hinglish and English.
                  </h2>
                  <p className="text-white/88 text-sm sm:text-[15px] leading-relaxed">
                    Add your doctors and clinic hours, then test the voice agent before patients
                    start calling.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleTabChange("voice")}
                  className="relative z-10 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-[#5b21b6] font-bold text-sm shadow-md hover:bg-slate-50 transition-all cursor-pointer"
                >
                  <Mic className="h-4 w-4" />
                  <span>Test voice agent</span>
                </button>
              </div>

              {/* 4 Stat Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* 1. Medical Staff */}
                <div className="p-5 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-[0_12px_30px_-18px_rgba(76,29,149,0.4)] dark:shadow-[0_14px_34px_-18px_rgba(0,0,0,0.8)] grid grid-cols-[auto_1fr] column-gap-4 items-center">
                  <div className="w-[42px] h-[42px] rounded-[13px] bg-gradient-to-br from-[#6366f1] to-[#3b82f6] text-white grid place-items-center row-span-3 mr-3.5 shadow-md">
                    <Stethoscope className="h-5 w-5" />
                  </div>
                  <small className="text-[#625b7e] dark:text-[#a29bc2] font-medium text-xs">
                    Medical staff
                  </small>
                  <div className="font-['Bricolage_Grotesque',sans-serif] text-2xl font-bold text-[#150f26] dark:text-white leading-tight">
                    {doctors.length} {doctors.length === 1 ? "doctor" : "doctors"}
                  </div>
                  <div className="text-[12px] text-[#625b7e] dark:text-[#a29bc2] flex items-center gap-1.5 mt-0.5">
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                    <span>Appointment slots update live</span>
                  </div>
                </div>

                {/* 2. Clinic Hours */}
                <div className="p-5 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-[0_12px_30px_-18px_rgba(76,29,149,0.4)] dark:shadow-[0_14px_34px_-18px_rgba(0,0,0,0.8)] grid grid-cols-[auto_1fr] column-gap-4 items-center">
                  <div className="w-[42px] h-[42px] rounded-[13px] bg-gradient-to-br from-[#10b981] to-[#0ea5a4] text-white grid place-items-center row-span-3 mr-3.5 shadow-md">
                    <Clock className="h-5 w-5" />
                  </div>
                  <small className="text-[#625b7e] dark:text-[#a29bc2] font-medium text-xs">
                    Clinic hours
                  </small>
                  <div
                    className={`font-['Bricolage_Grotesque',sans-serif] text-2xl font-bold leading-tight ${
                      hoursSet ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
                    }`}
                  >
                    {hoursSet ? "Open today" : "Not set"}
                  </div>
                  <div className="text-[12px] text-[#625b7e] dark:text-[#a29bc2] flex items-center gap-1.5 mt-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span>7-day schedule enforced</span>
                  </div>
                </div>

                {/* 3. Emergency Helpline */}
                <div className="p-5 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-[0_12px_30px_-18px_rgba(76,29,149,0.4)] dark:shadow-[0_14px_34px_-18px_rgba(0,0,0,0.8)] grid grid-cols-[auto_1fr] column-gap-4 items-center">
                  <div className="w-[42px] h-[42px] rounded-[13px] bg-gradient-to-br from-[#f43f5e] to-[#f97316] text-white grid place-items-center row-span-3 mr-3.5 shadow-md">
                    <Phone className="h-5 w-5" />
                  </div>
                  <small className="text-[#625b7e] dark:text-[#a29bc2] font-medium text-xs">
                    Emergency helpline
                  </small>
                  <div className="font-['Bricolage_Grotesque',sans-serif] text-2xl font-bold text-[#150f26] dark:text-white leading-tight">
                    {emergencyContact || "102"}
                  </div>
                  <div className="text-[12px] text-[#625b7e] dark:text-[#a29bc2] flex items-center gap-1.5 mt-0.5">
                    <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                    <span>Callers escalated instantly</span>
                  </div>
                </div>

                {/* 4. Voice Response Time */}
                <div className="p-5 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-[0_12px_30px_-18px_rgba(76,29,149,0.4)] dark:shadow-[0_14px_34px_-18px_rgba(0,0,0,0.8)] grid grid-cols-[auto_1fr] column-gap-4 items-center">
                  <div className="w-[42px] h-[42px] rounded-[13px] bg-gradient-to-br from-[#8b5cf6] to-[#d946ef] text-white grid place-items-center row-span-3 mr-3.5 shadow-md">
                    <Mic className="h-5 w-5" />
                  </div>
                  <small className="text-[#625b7e] dark:text-[#a29bc2] font-medium text-xs">
                    Voice response time
                  </small>
                  <div className="font-['Bricolage_Grotesque',sans-serif] text-2xl font-bold text-[#150f26] dark:text-white leading-tight">
                    &lt;800 ms
                  </div>
                  <div className="text-[12px] text-[#625b7e] dark:text-[#a29bc2] flex items-center gap-1.5 mt-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span>Hindi, Hinglish, English</span>
                  </div>
                </div>
              </div>

              {/* Get Started Quick Tiles */}
              <div className="space-y-3 pt-2">
                <h2 className="font-['Bricolage_Grotesque',sans-serif] text-lg font-bold text-[#150f26] dark:text-white flex items-center gap-2.5 before:content-[''] before:w-1 before:h-5 before:rounded-full before:bg-gradient-to-b before:from-[#6d28d9] before:to-[#9333ea]">
                  Get started
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Tile 1: Voice */}
                  <button
                    type="button"
                    onClick={() => handleTabChange("voice")}
                    className="p-5 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm hover:-translate-y-1 hover:border-[#7c3aed] transition-all text-left flex items-center gap-4 cursor-pointer"
                  >
                    <div className="w-11 h-11 rounded-[14px] bg-gradient-to-br from-[#4f46e5] to-[#2563eb] text-white grid place-items-center shrink-0 shadow-md">
                      <Mic className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-['Bricolage_Grotesque',sans-serif] font-bold text-base text-[#150f26] dark:text-white">
                        Test the voice agent
                      </h3>
                      <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] mt-0.5">
                        Talk with microphone and check Hindi/Hinglish booking.
                      </p>
                    </div>
                  </button>

                  {/* Tile 2: Doctors */}
                  <button
                    type="button"
                    onClick={() => {
                      handleTabChange("doctors");
                      handleOpenAddDoctorModal();
                    }}
                    className="p-5 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm hover:-translate-y-1 hover:border-[#7c3aed] transition-all text-left flex items-center gap-4 cursor-pointer"
                  >
                    <div className="w-11 h-11 rounded-[14px] bg-gradient-to-br from-[#8b5cf6] to-[#d946ef] text-white grid place-items-center shrink-0 shadow-md">
                      <Stethoscope className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-['Bricolage_Grotesque',sans-serif] font-bold text-base text-[#150f26] dark:text-white">
                        Add a physician
                      </h3>
                      <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] mt-0.5">
                        Set consultation fees, slot length and weekday shifts.
                      </p>
                    </div>
                  </button>

                  {/* Tile 3: Profile */}
                  <button
                    type="button"
                    onClick={() => handleTabChange("profile")}
                    className="p-5 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm hover:-translate-y-1 hover:border-[#7c3aed] transition-all text-left flex items-center gap-4 cursor-pointer"
                  >
                    <div className="w-11 h-11 rounded-[14px] bg-gradient-to-br from-[#0ea5a4] to-[#10b981] text-white grid place-items-center shrink-0 shadow-md">
                      <Clock className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-['Bricolage_Grotesque',sans-serif] font-bold text-base text-[#150f26] dark:text-white">
                        Set clinic hours
                      </h3>
                      <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] mt-0.5">
                        Add phone lines, emergency number, address and timings.
                      </p>
                    </div>
                  </button>
                </div>
              </div>

              {/* Platform Health Grid */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <h2 className="font-['Bricolage_Grotesque',sans-serif] text-lg font-bold text-[#150f26] dark:text-white flex items-center gap-2.5 before:content-[''] before:w-1 before:h-5 before:rounded-full before:bg-gradient-to-b before:from-[#6d28d9] before:to-[#9333ea]">
                    Platform health
                  </h2>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#d1fae5] dark:bg-[rgba(16,185,129,0.16)] text-[#059669] dark:text-[#34d399]">
                    <Check className="h-3.5 w-3.5" />
                    <span>All services running</span>
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* API Server */}
                  <div className="p-4 rounded-[16px] border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-[12px] bg-[#d1fae5] dark:bg-[rgba(16,185,129,0.16)] text-[#059669] dark:text-[#34d399] grid place-items-center shrink-0">
                      <Server className="h-5 w-5" />
                    </div>
                    <div>
                      <b className="block text-sm text-[#150f26] dark:text-white font-bold">API server</b>
                      <small className="text-xs text-[#625b7e] dark:text-[#a29bc2]">FastAPI &bull; port 8000</small>
                    </div>
                  </div>

                  {/* Database */}
                  <div className="p-4 rounded-[16px] border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-[12px] bg-[#d1fae5] dark:bg-[rgba(16,185,129,0.16)] text-[#059669] dark:text-[#34d399] grid place-items-center shrink-0">
                      <Database className="h-5 w-5" />
                    </div>
                    <div>
                      <b className="block text-sm text-[#150f26] dark:text-white font-bold">Database</b>
                      <small className="text-xs text-[#625b7e] dark:text-[#a29bc2]">PostgreSQL 16 &bull; port 5433</small>
                    </div>
                  </div>

                  {/* Task Worker */}
                  <div className="p-4 rounded-[16px] border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-[12px] bg-[#d1fae5] dark:bg-[rgba(16,185,129,0.16)] text-[#059669] dark:text-[#34d399] grid place-items-center shrink-0">
                      <Cpu className="h-5 w-5" />
                    </div>
                    <div>
                      <b className="block text-sm text-[#150f26] dark:text-white font-bold">Task worker</b>
                      <small className="text-xs text-[#625b7e] dark:text-[#a29bc2]">Redis 7 &bull; port 6379</small>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* =========================================================================
              VIEW 2: ANALYTICS (Exact charts from Hospital_Voice_Agent.html)
              ========================================================================= */}
          {activeTab === "analytics" && (
            <div className="space-y-6">
              {/* Range Toggle Header */}
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <h2 className="font-['Bricolage_Grotesque',sans-serif] text-2xl font-bold text-[#150f26] dark:text-white">
                    Call analytics
                  </h2>
                  <p className="text-xs text-[#625b7e] dark:text-[#a29bc2]">
                    Sample data preview. Charts switch to live numbers once call sessions accumulate.
                  </p>
                </div>

                <div className="inline-flex p-1 rounded-xl bg-[#f3f0fb] dark:bg-[#1a1530] border border-[#e6e0f5] dark:border-[#2b2347]">
                  <button
                    type="button"
                    onClick={() => setAnalyticsRange(7)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      analyticsRange === 7
                        ? "bg-gradient-to-r from-[#6d28d9] to-[#9333ea] text-white shadow-xs"
                        : "text-[#625b7e] dark:text-[#a29bc2]"
                    }`}
                  >
                    7 days
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnalyticsRange(30)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      analyticsRange === 30
                        ? "bg-gradient-to-r from-[#6d28d9] to-[#9333ea] text-white shadow-xs"
                        : "text-[#625b7e] dark:text-[#a29bc2]"
                    }`}
                  >
                    30 days
                  </button>
                </div>
              </div>

              {/* 4 Analytics KPIs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-5 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm">
                  <small className="text-[#625b7e] dark:text-[#a29bc2] font-medium text-xs">
                    Calls handled
                  </small>
                  <div className="font-['Bricolage_Grotesque',sans-serif] text-2xl font-bold text-[#150f26] dark:text-white mt-1">
                    {analyticsData.totCalls}
                  </div>
                  <div className="text-[12px] text-emerald-600 font-semibold mt-1">
                    ▲ 12% vs last period
                  </div>
                </div>

                <div className="p-5 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm">
                  <small className="text-[#625b7e] dark:text-[#a29bc2] font-medium text-xs">
                    Appointments booked
                  </small>
                  <div className="font-['Bricolage_Grotesque',sans-serif] text-2xl font-bold text-[#150f26] dark:text-white mt-1">
                    {analyticsData.totBooked}
                  </div>
                  <div className="text-[12px] text-emerald-600 font-semibold mt-1">
                    ▲ 9% vs last period
                  </div>
                </div>

                <div className="p-5 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm">
                  <small className="text-[#625b7e] dark:text-[#a29bc2] font-medium text-xs">
                    Average response
                  </small>
                  <div className="font-['Bricolage_Grotesque',sans-serif] text-2xl font-bold text-[#150f26] dark:text-white mt-1">
                    {analyticsData.avgLatency}
                  </div>
                  <div className="text-[12px] text-[#625b7e] dark:text-[#a29bc2] mt-1">
                    Under the 800 ms target
                  </div>
                </div>

                <div className="p-5 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm">
                  <small className="text-[#625b7e] dark:text-[#a29bc2] font-medium text-xs">
                    Emergency escalations
                  </small>
                  <div className="font-['Bricolage_Grotesque',sans-serif] text-2xl font-bold text-[#150f26] dark:text-white mt-1">
                    {analyticsData.escalations}
                  </div>
                  <div className="text-[12px] text-[#625b7e] dark:text-[#a29bc2] mt-1">
                    Routed to 102
                  </div>
                </div>
              </div>

              {/* Charts Row 1: Area Chart (Call Volume) + Donut (Languages) */}
              <div className="grid grid-cols-1 lg:grid-cols-[1.7fr_1fr] gap-4">
                {/* Area Chart: Call Volume */}
                <div className="p-6 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-['Bricolage_Grotesque',sans-serif] font-bold text-base text-[#150f26] dark:text-white">
                      Call volume
                    </h3>
                    <div className="flex items-center gap-4 text-xs text-[#625b7e] dark:text-[#a29bc2]">
                      <span className="flex items-center gap-1.5">
                        <span className="w-3.5 h-1 rounded-full bg-[#7c3aed]" /> Calls
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="w-3.5 h-0.5 border-t border-dashed border-[#150f26] dark:border-white" />{" "}
                        Booked
                      </span>
                    </div>
                  </div>

                  {/* SVG Area Chart */}
                  <div className="w-full h-56">
                    <svg viewBox="0 0 640 250" className="w-full h-full">
                      <defs>
                        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.4" />
                          <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      {/* Grid Lines */}
                      {[0, 1, 2, 3, 4].map((k) => (
                        <line
                          key={k}
                          x1="36"
                          x2="630"
                          y1={214 - k * 45}
                          y2={214 - k * 45}
                          className="stroke-[#e6e0f5] dark:stroke-[#2b2347]"
                        />
                      ))}
                      {/* Area Fill */}
                      <polygon
                        points={`36,214 ${analyticsData.calls
                          .map((v, i) => `${36 + (i * 594) / (analyticsData.calls.length - 1)},${214 - (v / 80) * 190}`)
                          .join(" ")} 630,214`}
                        fill="url(#areaGrad)"
                      />
                      {/* Calls Line */}
                      <polyline
                        points={analyticsData.calls
                          .map((v, i) => `${36 + (i * 594) / (analyticsData.calls.length - 1)},${214 - (v / 80) * 190}`)
                          .join(" ")}
                        fill="none"
                        stroke="#7c3aed"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {/* Booked Dashed Line */}
                      <polyline
                        points={analyticsData.booked
                          .map((v, i) => `${36 + (i * 594) / (analyticsData.booked.length - 1)},${214 - (v / 80) * 190}`)
                          .join(" ")}
                        fill="none"
                        className="stroke-[#150f26] dark:stroke-white"
                        strokeWidth="2"
                        strokeDasharray="5 5"
                        strokeLinecap="round"
                      />
                      {/* Labels */}
                      {analyticsData.labels.map((l, i) => (
                        <text
                          key={i}
                          x={36 + (i * 594) / (analyticsData.labels.length - 1)}
                          y="240"
                          textAnchor="middle"
                          className="fill-[#625b7e] dark:fill-[#a29bc2] text-[11px]"
                        >
                          {analyticsRange === 7 || i % 5 === 0 ? l : ""}
                        </text>
                      ))}
                    </svg>
                  </div>
                </div>

                {/* Donut Chart: Languages */}
                <div className="p-6 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm flex flex-col justify-between">
                  <h3 className="font-['Bricolage_Grotesque',sans-serif] font-bold text-base text-[#150f26] dark:text-white">
                    Languages
                  </h3>

                  <div className="flex items-center justify-center gap-6 py-4 flex-wrap">
                    {/* SVG Donut */}
                    <div className="relative w-36 h-36">
                      <svg viewBox="0 0 42 42" className="w-full h-full -rotate-90">
                        <circle
                          cx="21"
                          cy="21"
                          r="15.915"
                          fill="none"
                          className="stroke-[#f3f0fb] dark:stroke-[#1a1530]"
                          strokeWidth="5.5"
                        />
                        {/* Hindi 38% */}
                        <circle
                          cx="21"
                          cy="21"
                          r="15.915"
                          fill="none"
                          stroke="#6d28d9"
                          strokeWidth="5.5"
                          strokeDasharray="36.8 63.2"
                          strokeDashoffset="25"
                        />
                        {/* Hinglish 34% */}
                        <circle
                          cx="21"
                          cy="21"
                          r="15.915"
                          fill="none"
                          stroke="#a855f7"
                          strokeWidth="5.5"
                          strokeDasharray="32.8 67.2"
                          strokeDashoffset="-11.8"
                        />
                        {/* English 28% */}
                        <circle
                          cx="21"
                          cy="21"
                          r="15.915"
                          fill="none"
                          stroke="#d8b4fe"
                          strokeWidth="5.5"
                          strokeDasharray="26.8 73.2"
                          strokeDashoffset="-44.6"
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="font-['Bricolage_Grotesque',sans-serif] font-bold text-xl text-[#150f26] dark:text-white">
                          {analyticsData.totCalls}
                        </span>
                        <span className="text-[10px] text-[#625b7e] dark:text-[#a29bc2]">calls</span>
                      </div>
                    </div>

                    {/* Legend */}
                    <div className="space-y-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-md bg-[#6d28d9]" />
                        <span>Hindi</span>
                        <b className="ml-auto font-bold">38%</b>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-md bg-[#a855f7]" />
                        <span>Hinglish</span>
                        <b className="ml-auto font-bold">34%</b>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-md bg-[#d8b4fe]" />
                        <span>English</span>
                        <b className="ml-auto font-bold">28%</b>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Charts Row 2: Busiest Hours + Intent Breakdown */}
              <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-4">
                {/* Bar Chart: Busiest Hours */}
                <div className="p-6 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm space-y-4">
                  <h3 className="font-['Bricolage_Grotesque',sans-serif] font-bold text-base text-[#150f26] dark:text-white">
                    Busiest hours
                  </h3>
                  <div className="w-full h-52">
                    <svg viewBox="0 0 640 230" className="w-full h-full">
                      <defs>
                        <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#a855f7" />
                          <stop offset="100%" stopColor="#6d28d9" />
                        </linearGradient>
                      </defs>
                      {[12, 28, 41, 36, 22, 18, 24, 33, 29, 21, 14, 8].map((v, i) => {
                        const h = (v / 41) * 180;
                        const x = 16 + i * 51;
                        return (
                          <g key={i}>
                            <rect
                              x={x}
                              y={200 - h}
                              width="32"
                              height={h}
                              rx="7"
                              fill="url(#barGrad)"
                              opacity={v === 41 ? 1 : 0.6}
                            />
                            <text
                              x={x + 16}
                              y="220"
                              textAnchor="middle"
                              className="fill-[#625b7e] dark:fill-[#a29bc2] text-[11px]"
                            >
                              {["9a", "10a", "11a", "12p", "1p", "2p", "3p", "4p", "5p", "6p", "7p", "8p"][i]}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                </div>

                {/* Progress Bars: Why Patients Call */}
                <div className="p-6 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm space-y-3.5">
                  <h3 className="font-['Bricolage_Grotesque',sans-serif] font-bold text-base text-[#150f26] dark:text-white mb-4">
                    Why patients call
                  </h3>
                  {[
                    ["Book appointment", 46],
                    ["Doctor availability", 24],
                    ["Clinic timings", 16],
                    ["Consultation fees", 9],
                    ["Emergency", 5],
                  ].map(([intent, pct]) => (
                    <div key={intent as string} className="space-y-1.5">
                      <div className="flex justify-between text-xs font-semibold">
                        <span>{intent}</span>
                        <b className="text-[#7c3aed]">{pct}%</b>
                      </div>
                      <div className="h-2 rounded-full bg-[#f3f0fb] dark:bg-[#1a1530] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#6d28d9] to-[#9333ea]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* =========================================================================
              VIEW 3: DOCTORS & SHIFTS
              ========================================================================= */}
          {activeTab === "doctors" && (
            <div className="space-y-6">
              {/* Filter & Search Bar Card */}
              <div className="p-4 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-[280px]">
                  {/* Search Input */}
                  <div className="relative flex-1">
                    <Search className="absolute left-3.5 top-3 h-4 w-4 text-[#625b7e] dark:text-[#a29bc2]" />
                    <input
                      type="text"
                      placeholder="Search by name or specialty..."
                      value={doctorSearchQuery}
                      onChange={(e) => setDoctorSearchQuery(e.target.value)}
                      className="w-full h-10 pl-10 pr-3.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] text-xs font-medium text-[#150f26] dark:text-white focus:outline-none focus:border-[#7c3aed]"
                    />
                  </div>

                  {/* Specialty Dropdown */}
                  <div className="relative">
                    <select
                      value={selectedSpecialty}
                      onChange={(e) => setSelectedSpecialty(e.target.value)}
                      className="h-10 px-3.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] text-xs font-medium text-[#150f26] dark:text-white focus:outline-none focus:border-[#7c3aed]"
                    >
                      <option value="">All specialties ({doctors.length})</option>
                      {uniqueSpecialties.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Add Doctor Button */}
                <button
                  type="button"
                  onClick={handleOpenAddDoctorModal}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-[#6d28d9] to-[#9333ea] text-white font-semibold text-xs shadow-md shadow-purple-600/30 hover:brightness-105 active:scale-95 transition-all cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  <span>Add doctor</span>
                </button>
              </div>

              {/* Doctor Cards Grid */}
              {filteredDoctors.length === 0 ? (
                /* Empty State */
                <div className="p-12 text-center rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm space-y-3">
                  <div className="w-16 h-16 rounded-[20px] bg-gradient-to-br from-[#6d28d9] to-[#9333ea] text-white grid place-items-center mx-auto shadow-md">
                    <Stethoscope className="h-7 w-7" />
                  </div>
                  <h2 className="font-['Bricolage_Grotesque',sans-serif] text-xl font-bold text-[#150f26] dark:text-white">
                    No physicians yet
                  </h2>
                  <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] max-w-sm mx-auto">
                    Add your first doctor so the voice agent can start booking patient
                    appointments accurately.
                  </p>
                  <button
                    type="button"
                    onClick={handleOpenAddDoctorModal}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#6d28d9] to-[#9333ea] text-white font-semibold text-xs shadow-md shadow-purple-600/30 hover:brightness-105 transition-all cursor-pointer mt-2"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Add first doctor</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredDoctors.map((doc) => (
                    <div
                      key={doc.id}
                      className="p-5 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm hover:border-[#7c3aed] transition-all flex flex-col justify-between space-y-4"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#6d28d9] to-[#9333ea] text-white font-bold text-base grid place-items-center shrink-0 shadow-sm">
                            {doc.full_name.replace(/^Dr\.?\s*/i, "").charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <b className="block text-sm font-bold text-[#150f26] dark:text-white">
                              {doc.full_name}
                            </b>
                            <small className="text-xs text-[#625b7e] dark:text-[#a29bc2] block">
                              {doc.specialization}
                            </small>
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleOpenEditDoctorModal(doc)}
                            title="Edit Doctor"
                            className="p-1.5 rounded-lg text-[#625b7e] hover:text-[#7c3aed] hover:bg-[#f3f0fb] dark:hover:bg-[#1a1530] transition-colors"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteDoctor(doc.id, doc.full_name)}
                            title="Delete Doctor"
                            className="p-1.5 rounded-lg text-[#625b7e] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Consultation Fee & Slot Details */}
                      <div className="pt-3 border-t border-[#e6e0f5] dark:border-[#2b2347] flex items-center justify-between text-xs text-[#625b7e] dark:text-[#a29bc2]">
                        <span>
                          Consultation <b className="text-[#150f26] dark:text-white">₹{doc.consultation_fee}</b>
                        </span>
                        <span>
                          Slot <b className="text-[#150f26] dark:text-white">{doc.slot_duration_minutes || 15} min</b>
                        </span>
                      </div>

                      {/* Weekly Availability Chips */}
                      <div className="flex gap-1 flex-wrap pt-1">
                        {DAYS_OF_WEEK.map((dName, dayIdx) => {
                          const hasShift = doc.availabilities?.some((a) => a.day_of_week === dayIdx);
                          return (
                            <span
                              key={dayIdx}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                hasShift
                                  ? "bg-purple-100 dark:bg-purple-950/60 text-[#7c3aed] dark:text-purple-300"
                                  : "bg-slate-100 dark:bg-slate-800 text-slate-400"
                              }`}
                            >
                              {dName.slice(0, 3)}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* =========================================================================
              VIEW 4: VOICE AI STUDIO (Microphone Interactive Simulation)
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
              VIEW 5: HOSPITAL PROFILE & WEEKLY OPERATING CALENDAR (7 Big Day Boxes)
              ========================================================================= */}
          {activeTab === "profile" && (
            <div className="space-y-6">
              {/* Top Row: Contact Lines & Clinic Location (2 Cards) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Card 1: Contact Lines & Direct Portal */}
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
                        placeholder="+91 98765 43210"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
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
                        type="text"
                        placeholder="102 or 011-26567890"
                        value={emergencyContact}
                        onChange={(e) => setEmergencyContact(e.target.value)}
                        className="flex-1 bg-transparent text-xs font-medium text-[#150f26] dark:text-white focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Dedicated Portal Slug */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-[#625b7e] dark:text-[#a29bc2] uppercase tracking-wider">
                      Dedicated portal domain
                    </label>
                    <div className="flex items-center justify-between px-3 h-11 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] text-xs font-mono text-[#150f26] dark:text-white">
                      <span className="truncate">voiceagent.hospital/{tenant?.slug || "portal"}</span>
                      <button
                        type="button"
                        onClick={() => {
                          if (tenant?.slug) {
                            navigator.clipboard.writeText(`https://voiceagent.hospital/${tenant.slug}`);
                            showToast("Portal link copied to clipboard");
                          }
                        }}
                        className="text-[#7c3aed] hover:underline text-[11px] font-bold ml-2 cursor-pointer"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                </div>

                {/* Card 2: Clinic Location & Regional Settings */}
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
                        placeholder="PIN"
                        value={address.postal_code}
                        onChange={(e) => setAddress((prev) => ({ ...prev, postal_code: e.target.value }))}
                        className="w-full h-11 px-3.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] text-xs font-medium text-[#150f26] dark:text-white focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Timezone */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-[#625b7e] dark:text-[#a29bc2] uppercase tracking-wider">
                      Regional schedule timezone
                    </label>
                    <div className="flex items-center gap-2.5 px-3.5 h-11 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530]">
                      <Clock className="h-4 w-4 text-[#625b7e] dark:text-[#a29bc2]" />
                      <select
                        value={timezone}
                        onChange={(e) => setTimezone(e.target.value)}
                        className="flex-1 bg-transparent text-xs font-medium text-[#150f26] dark:text-white focus:outline-none"
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

              {/* =========================================================================
                  BIG CALENDAR VIEW: 7 LARGE INTERACTIVE DAY BOXES
                  ========================================================================= */}
              <div className="p-6 sm:p-7 rounded-[24px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-[0_12px_30px_-18px_rgba(76,29,149,0.4)] dark:shadow-[0_14px_34px_-18px_rgba(0,0,0,0.8)] space-y-6">
                {/* Calendar Header with Live Pill & Preset Toolbar */}
                <div className="flex items-center justify-between flex-wrap gap-4 pb-4 border-b border-[#e6e0f5] dark:border-[#2b2347]">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-xl bg-purple-100/60 dark:bg-purple-950/60 text-[#7c3aed]">
                        <Calendar className="h-5 w-5" />
                      </div>
                      <h3 className="font-['Bricolage_Grotesque',sans-serif] font-bold text-xl text-[#150f26] dark:text-white">
                        Weekly Operating Calendar
                      </h3>
                    </div>
                    <p className="text-xs text-[#625b7e] dark:text-[#a29bc2]">
                      Calendar day boxes for scheduling doctor shifts and automated patient call windows.
                    </p>
                  </div>

                  {/* Calendar Quick Presets Toolbar */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={handleCopyMonToFri}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] text-xs font-semibold text-[#150f26] dark:text-white hover:bg-purple-100/60 dark:hover:bg-purple-950/40 transition-colors cursor-pointer"
                    >
                      <Copy className="h-3.5 w-3.5 text-[#7c3aed]" />
                      <span>Copy Mon to Fri</span>
                    </button>

                    <button
                      type="button"
                      onClick={applyStandardPreset}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] text-xs font-semibold text-[#150f26] dark:text-white hover:bg-purple-100/60 dark:hover:bg-purple-950/40 transition-colors cursor-pointer"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-[#7c3aed]" />
                      <span>Mon-Sat (9a-8p)</span>
                    </button>

                    <button
                      type="button"
                      onClick={applyAllWeekPreset}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] text-xs font-semibold text-[#150f26] dark:text-white hover:bg-purple-100/60 dark:hover:bg-purple-950/40 transition-colors cursor-pointer"
                    >
                      <span>Open 7 Days</span>
                    </button>
                  </div>
                </div>

                {/* THE 7 BIG CALENDAR BOXES (Monday to Sunday) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3.5">
                  {operatingHours.map((h) => {
                    const dayName = DAYS_OF_WEEK[h.day_of_week];
                    const dayShort = dayName.slice(0, 3).toUpperCase();
                    const isToday = h.day_of_week === todayDayIndex;
                    const durationText = calculateDuration(h.open_time, h.close_time);

                    const startPct = getTimelinePercentage(h.open_time);
                    const endPct = getTimelinePercentage(h.close_time);
                    const widthPct = Math.max(0, endPct - startPct);

                    return (
                      <div
                        key={h.day_of_week}
                        className={`p-4 rounded-[20px] border transition-all flex flex-col justify-between min-h-[260px] relative overflow-hidden ${
                          !h.is_closed
                            ? "bg-white dark:bg-[#120e1f] border-[#7c3aed]/40 dark:border-[#a855f7]/40 shadow-[0_8px_24px_-12px_rgba(124,58,237,0.25)] hover:border-[#7c3aed]"
                            : "bg-[#f3f0fb]/60 dark:bg-[#1a1530]/40 border-[#e6e0f5] dark:border-[#2b2347] opacity-80"
                        }`}
                      >
                        {/* Top Indicator for Today */}
                        {isToday && (
                          <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-[#6d28d9] to-[#9333ea]" />
                        )}

                        {/* Box Header: Day Name + Toggle Switch */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`font-['Bricolage_Grotesque',sans-serif] font-bold text-sm tracking-wide ${
                                    !h.is_closed
                                      ? "text-[#7c3aed] dark:text-[#a78bfa]"
                                      : "text-[#625b7e] dark:text-[#a29bc2]"
                                  }`}
                                >
                                  {dayShort}
                                </span>
                                {isToday && (
                                  <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-purple-100 dark:bg-purple-950 text-[#7c3aed] border border-purple-200 dark:border-purple-800">
                                    Today
                                  </span>
                                )}
                              </div>
                              <span className="text-xs font-semibold text-[#150f26] dark:text-white block">
                                {dayName}
                              </span>
                            </div>

                            {/* Toggle Switch */}
                            <button
                              type="button"
                              role="switch"
                              aria-checked={!h.is_closed}
                              onClick={() => handleToggleOperatingDay(h.day_of_week)}
                              className={`w-9 h-5 rounded-full relative transition-colors cursor-pointer shrink-0 ${
                                !h.is_closed
                                  ? "bg-gradient-to-r from-[#6d28d9] to-[#9333ea]"
                                  : "bg-[#e6e0f5] dark:bg-[#2b2347]"
                              }`}
                            >
                              <span
                                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                                  !h.is_closed ? "translate-x-4" : "translate-x-0"
                                } shadow-xs`}
                              />
                            </button>
                          </div>

                          {/* Status Pill */}
                          <div className="flex items-center justify-between text-[11px] mb-3">
                            {!h.is_closed ? (
                              <>
                                <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                  Open
                                </span>
                                <span className="text-[#625b7e] dark:text-[#a29bc2] font-semibold text-[10.5px]">
                                  {durationText}
                                </span>
                              </>
                            ) : (
                              <span className="w-full text-center py-0.5 rounded-full text-[10.5px] font-semibold bg-[#e6e0f5]/60 dark:bg-[#2b2347]/60 text-[#625b7e] dark:text-[#a29bc2]">
                                Closed all day
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Middle Content: Time Pickers OR Closed Rest Graphic */}
                        {!h.is_closed ? (
                          <div className="space-y-2.5 my-2">
                            {/* Opens at */}
                            <div>
                              <span className="text-[10px] uppercase font-bold text-[#625b7e] dark:text-[#a29bc2] block mb-1">
                                Opens at
                              </span>
                              <div className="relative">
                                <Clock className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[#625b7e] dark:text-[#a29bc2]" />
                                <input
                                  type="time"
                                  value={h.open_time ? h.open_time.slice(0, 5) : "09:00"}
                                  onChange={(e) =>
                                    handleUpdateOperatingTime(h.day_of_week, "open_time", e.target.value)
                                  }
                                  className="w-full h-8 pl-8 pr-2 rounded-lg border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] text-xs font-semibold text-[#150f26] dark:text-white focus:outline-none focus:border-[#7c3aed]"
                                />
                              </div>
                            </div>

                            {/* Closes at */}
                            <div>
                              <span className="text-[10px] uppercase font-bold text-[#625b7e] dark:text-[#a29bc2] block mb-1">
                                Closes at
                              </span>
                              <div className="relative">
                                <Clock className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[#625b7e] dark:text-[#a29bc2]" />
                                <input
                                  type="time"
                                  value={h.close_time ? h.close_time.slice(0, 5) : "20:00"}
                                  onChange={(e) =>
                                    handleUpdateOperatingTime(h.day_of_week, "close_time", e.target.value)
                                  }
                                  className="w-full h-8 pl-8 pr-2 rounded-lg border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] text-xs font-semibold text-[#150f26] dark:text-white focus:outline-none focus:border-[#7c3aed]"
                                />
                              </div>
                            </div>

                            {/* Mini 24h Timeline Bar */}
                            <div className="pt-1">
                              <div className="w-full h-1.5 rounded-full bg-[#f3f0fb] dark:bg-[#1a1530] overflow-hidden relative">
                                <div
                                  className="absolute h-full rounded-full bg-gradient-to-r from-[#6d28d9] to-[#9333ea]"
                                  style={{ left: `${startPct}%`, width: `${widthPct}%` }}
                                />
                              </div>
                              <div className="flex justify-between text-[9px] text-[#625b7e] dark:text-[#a29bc2] mt-0.5 font-mono">
                                <span>6 AM</span>
                                <span>10 PM</span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="my-auto py-5 text-center space-y-1.5">
                            <div className="w-8 h-8 rounded-full bg-[#f3f0fb] dark:bg-[#1a1530] grid place-items-center mx-auto text-[#625b7e] dark:text-[#a29bc2]">
                              <Moon className="h-4 w-4" />
                            </div>
                            <p className="text-[11px] font-medium text-[#625b7e] dark:text-[#a29bc2]">
                              Rest Day
                            </p>
                          </div>
                        )}

                        {/* Bottom Quick Preset Chips per day */}
                        <div className="pt-2 border-t border-[#e6e0f5]/70 dark:border-[#2b2347]/70 flex items-center justify-between gap-1 text-[10px]">
                          <button
                            type="button"
                            onClick={() => setDayQuickTiming(h.day_of_week, "09:00", "20:00", false)}
                            className="px-1.5 py-0.5 rounded hover:bg-purple-100/60 dark:hover:bg-purple-950/40 text-[#625b7e] dark:text-[#a29bc2] font-semibold transition-colors"
                          >
                            9a-8p
                          </button>
                          <button
                            type="button"
                            onClick={() => setDayQuickTiming(h.day_of_week, "09:00", "14:00", false)}
                            className="px-1.5 py-0.5 rounded hover:bg-purple-100/60 dark:hover:bg-purple-950/40 text-[#625b7e] dark:text-[#a29bc2] font-semibold transition-colors"
                          >
                            Half
                          </button>
                          <button
                            type="button"
                            onClick={() => setDayQuickTiming(h.day_of_week, null, null, true)}
                            className="px-1.5 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-950/40 text-[#625b7e] dark:text-[#a29bc2] font-semibold transition-colors"
                          >
                            Off
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Calendar Footer Summary & Save Action */}
                <div className="flex items-center justify-between flex-wrap gap-4 pt-4 border-t border-[#e6e0f5] dark:border-[#2b2347]">
                  <div className="flex items-center gap-4 text-xs font-semibold text-[#625b7e] dark:text-[#a29bc2]">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      <b>{activeDaysCount} / 7 days</b> active
                    </span>
                    <span>&bull;</span>
                    <span>
                      <b>~{totalWeeklyOperatingHours} hrs</b> weekly operating capacity
                    </span>
                  </div>

                  <button
                    type="button"
                    disabled={isSavingProfile}
                    onClick={handleSaveProfileAndHours}
                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#6d28d9] to-[#9333ea] text-white font-bold text-xs shadow-md shadow-purple-600/30 hover:brightness-105 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isSavingProfile ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    <span>Save profile &amp; weekly calendar</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* =========================================================================
          ADD / EDIT DOCTOR MODAL (Matching Hospital_Voice_Agent.html modal)
          ========================================================================= */}
      {showDoctorModal && (
        <div className="fixed inset-0 bg-[#050a19]/65 backdrop-blur-xs grid place-items-center z-50 p-4">
          <div className="w-full max-w-[480px] rounded-[22px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] p-6 sm:p-7 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#e6e0f5] dark:border-[#2b2347]">
              <h3 className="font-['Bricolage_Grotesque',sans-serif] text-xl font-bold text-[#150f26] dark:text-white">
                {editingDoctorId ? "Edit physician" : "Add a physician"}
              </h3>
              <button
                type="button"
                onClick={() => setShowDoctorModal(false)}
                className="text-[#625b7e] hover:text-[#150f26] dark:hover:text-white p-1 rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {doctorFormError && (
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-600 dark:text-red-400 font-semibold flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{doctorFormError}</span>
              </div>
            )}

            <div className="space-y-4 text-xs">
              {/* Full Name */}
              <div className="space-y-1.5">
                <label className="font-bold text-[#625b7e] dark:text-[#a29bc2] uppercase tracking-wider">
                  Full name
                </label>
                <input
                  type="text"
                  placeholder="Dr. Anita Shah"
                  value={doctorFormData.full_name}
                  onChange={(e) =>
                    setDoctorFormData((prev) => ({ ...prev, full_name: e.target.value }))
                  }
                  className="w-full h-11 px-3.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] text-sm font-medium text-[#150f26] dark:text-white focus:outline-none focus:border-[#7c3aed]"
                />
              </div>

              {/* Specialty */}
              <div className="space-y-1.5">
                <label className="font-bold text-[#625b7e] dark:text-[#a29bc2] uppercase tracking-wider">
                  Specialty
                </label>
                <input
                  type="text"
                  placeholder="Cardiology"
                  value={doctorFormData.specialization}
                  onChange={(e) =>
                    setDoctorFormData((prev) => ({ ...prev, specialization: e.target.value }))
                  }
                  className="w-full h-11 px-3.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] text-sm font-medium text-[#150f26] dark:text-white focus:outline-none focus:border-[#7c3aed]"
                />
              </div>

              {/* Fee and Slot Duration */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="font-bold text-[#625b7e] dark:text-[#a29bc2] uppercase tracking-wider">
                    Fee (₹)
                  </label>
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
                    className="w-full h-11 px-3.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] text-sm font-medium text-[#150f26] dark:text-white focus:outline-none focus:border-[#7c3aed]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="font-bold text-[#625b7e] dark:text-[#a29bc2] uppercase tracking-wider">
                    Slot (min)
                  </label>
                  <select
                    value={doctorFormData.slot_duration}
                    onChange={(e) =>
                      setDoctorFormData((prev) => ({
                        ...prev,
                        slot_duration: Number(e.target.value),
                      }))
                    }
                    className="w-full h-11 px-3.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] text-sm font-medium text-[#150f26] dark:text-white focus:outline-none focus:border-[#7c3aed]"
                  >
                    {SLOT_DURATIONS.map((dur) => (
                      <option key={dur} value={dur}>
                        {dur} mins
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Weekday Consultation Shifts */}
              <div className="space-y-2 pt-1">
                <label className="font-bold text-[#625b7e] dark:text-[#a29bc2] uppercase tracking-wider block">
                  Consultation shifts
                </label>
                <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                  {doctorFormData.availabilities.map((avail, idx) => (
                    <div
                      key={avail.day_of_week}
                      className="flex items-center gap-2 p-2 rounded-lg bg-[#f3f0fb] dark:bg-[#1a1530] border border-[#e6e0f5] dark:border-[#2b2347] text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={avail.is_active}
                        onChange={(e) => {
                          const updated = [...doctorFormData.availabilities];
                          updated[idx].is_active = e.target.checked;
                          setDoctorFormData((prev) => ({ ...prev, availabilities: updated }));
                        }}
                        className="rounded accent-[#7c3aed] cursor-pointer"
                      />
                      <span className="w-16 font-bold text-[#150f26] dark:text-white">
                        {DAYS_OF_WEEK[avail.day_of_week].slice(0, 3)}
                      </span>
                      {avail.is_active ? (
                        <div className="flex items-center gap-1.5 ml-auto">
                          <input
                            type="time"
                            value={avail.start_time}
                            onChange={(e) => {
                              const updated = [...doctorFormData.availabilities];
                              updated[idx].start_time = e.target.value;
                              setDoctorFormData((prev) => ({ ...prev, availabilities: updated }));
                            }}
                            className="px-1.5 py-0.5 rounded border border-[#e6e0f5] dark:border-[#2b2347] bg-white dark:bg-[#120e1f] text-[11px] font-mono focus:outline-none"
                          />
                          <span className="text-[#625b7e]">-</span>
                          <input
                            type="time"
                            value={avail.end_time}
                            onChange={(e) => {
                              const updated = [...doctorFormData.availabilities];
                              updated[idx].end_time = e.target.value;
                              setDoctorFormData((prev) => ({ ...prev, availabilities: updated }));
                            }}
                            className="px-1.5 py-0.5 rounded border border-[#e6e0f5] dark:border-[#2b2347] bg-white dark:bg-[#120e1f] text-[11px] font-mono focus:outline-none"
                          />
                        </div>
                      ) : (
                        <span className="ml-auto text-[#625b7e] dark:text-[#a29bc2] text-[11px]">
                          Off duty
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#e6e0f5] dark:border-[#2b2347]">
              <button
                type="button"
                onClick={() => setShowDoctorModal(false)}
                className="px-4 py-2 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] text-xs font-semibold text-[#150f26] dark:text-white hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSavingDoctor}
                onClick={handleSaveDoctor}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-[#6d28d9] to-[#9333ea] text-white font-semibold text-xs shadow-md shadow-purple-600/30 hover:brightness-105 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
              >
                {isSavingDoctor && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>{editingDoctorId ? "Save changes" : "Add doctor"}</span>
              </button>
            </div>
          </div>
        </div>
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
