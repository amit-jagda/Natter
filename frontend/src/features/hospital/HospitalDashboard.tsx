import React, { useState, useEffect, useMemo } from "react";
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
  ChevronDown,
  Filter,
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

type TabType = "dashboard" | "doctors" | "voice" | "profile";

export const HospitalDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
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
  const [isSearchingDoctors, setIsSearchingDoctors] = useState(false);
  const [isSpecialtyDropdownOpen, setIsSpecialtyDropdownOpen] = useState(false);
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

  const calculateShiftHours = (start: string, end: string): string => {
    const diff = calculateShiftMinutes(start, end);
    if (diff === 0) return "0 hrs";
    const hours = Math.floor(diff / 60);
    const mins = diff % 60;
    if (mins === 0) return `${hours} hrs`;
    return `${hours}h ${mins}m`;
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
      showToast("Failed to delete doctor");
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
                <h1 className="font-['Bricolage_Grotesque',sans-serif] text-2xl sm:text-[28px] font-bold text-[#150f26] dark:text-white leading-tight">
                  Good evening, {user?.full_name?.split(" ")[0] || "Bhagya"}
                </h1>
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
                <h1 className="font-['Bricolage_Grotesque',sans-serif] text-2xl sm:text-[28px] font-bold text-[#150f26] dark:text-white leading-tight">
                  {activeTab === "doctors" && "Doctors and shifts"}
                  {activeTab === "voice" && "Voice AI studio"}
                  {activeTab === "profile" && "Hospital profile"}
                </h1>
                <p className="text-[13.5px] text-[#625b7e] dark:text-[#a29bc2] mt-0.5">
                  {activeTab === "doctors" && "Manage doctors, fees and weekly availability"}
                  {activeTab === "voice" && "Try a live simulated phone call with your AI agent"}
                  {activeTab === "profile" && "Contact lines, location and clinic operating hours"}
                </p>
              </div>
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
              VIEW 2: DOCTORS & SHIFTS
              ========================================================================= */}
          {activeTab === "doctors" && (
            <div className="space-y-6">
              {/* Filter & Search Bar Card */}
              <div className="p-4 rounded-[22px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-[280px]">
                  {/* Search Input with Debounced Backend Integration */}
                  <div className="relative flex-1">
                    {isSearchingDoctors ? (
                      <Loader2 className="absolute left-3.5 top-3 h-4 w-4 text-[#7c3aed] animate-spin" />
                    ) : (
                      <Search className="absolute left-3.5 top-3 h-4 w-4 text-[#625b7e] dark:text-[#a29bc2]" />
                    )}
                    <input
                      type="text"
                      placeholder="Search doctors by name, specialty, or email..."
                      value={doctorSearchQuery}
                      onChange={(e) => setDoctorSearchQuery(e.target.value)}
                      className="w-full h-10 pl-10 pr-3.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] text-xs font-medium text-[#150f26] dark:text-white placeholder-[#625b7e]/60 focus:outline-none focus:border-[#7c3aed]"
                    />
                  </div>

                  {/* Proper UI-Matched Specialty Dropdown */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setIsSpecialtyDropdownOpen((prev) => !prev)}
                      className="h-10 px-3.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] text-xs font-semibold text-[#150f26] dark:text-white hover:border-[#7c3aed] flex items-center gap-2 cursor-pointer transition-colors shadow-xs"
                    >
                      <Filter className="h-3.5 w-3.5 text-[#7c3aed]" />
                      <span>{selectedSpecialty ? selectedSpecialty : `All specialties (${doctors.length})`}</span>
                      <ChevronDown
                        className={`h-3.5 w-3.5 text-[#625b7e] dark:text-[#a29bc2] transition-transform duration-200 ${
                          isSpecialtyDropdownOpen ? "rotate-180" : ""
                        }`}
                      />
                    </button>

                    {isSpecialtyDropdownOpen && (
                      <>
                        <div
                          className="fixed inset-0 z-20"
                          onClick={() => setIsSpecialtyDropdownOpen(false)}
                        />
                        <div className="absolute left-0 mt-2 z-30 w-56 rounded-2xl bg-white dark:bg-[#181329] border border-[#e6e0f5] dark:border-[#2b2347] shadow-xl p-1.5 space-y-0.5 animate-in fade-in zoom-in-95 duration-100">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedSpecialty("");
                              setIsSpecialtyDropdownOpen(false);
                            }}
                            className={`w-full px-3 py-2 rounded-xl text-xs font-medium flex items-center justify-between cursor-pointer transition-colors ${
                              !selectedSpecialty
                                ? "bg-purple-50 dark:bg-purple-950/40 text-[#7c3aed] font-bold"
                                : "text-[#150f26] dark:text-white hover:bg-slate-100 dark:hover:bg-white/5"
                            }`}
                          >
                            <span>All specialties</span>
                            {!selectedSpecialty && <Check className="h-3.5 w-3.5 text-[#7c3aed]" />}
                          </button>
                          {allSpecialties.map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => {
                                setSelectedSpecialty(s);
                                setIsSpecialtyDropdownOpen(false);
                              }}
                              className={`w-full px-3 py-2 rounded-xl text-xs font-medium flex items-center justify-between cursor-pointer transition-colors ${
                                selectedSpecialty === s
                                  ? "bg-purple-50 dark:bg-purple-950/40 text-[#7c3aed] font-bold"
                                  : "text-[#150f26] dark:text-white hover:bg-slate-100 dark:hover:bg-white/5"
                              }`}
                            >
                              <span>{s}</span>
                              {selectedSpecialty === s && <Check className="h-3.5 w-3.5 text-[#7c3aed]" />}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Add Doctor Button (Renamed from Add physician) */}
                <button
                  type="button"
                  onClick={handleOpenAddDoctorModal}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-[#6d28d9] to-[#9333ea] text-white font-semibold text-xs shadow-md shadow-purple-600/30 hover:brightness-105 active:scale-95 transition-all cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  <span>Add doctor</span>
                </button>
              </div>

              {/* Doctor Table (Tabular format matching UI layout) */}
              {doctors.length === 0 ? (
                /* Empty State */
                <div className="p-12 text-center rounded-[22px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm space-y-3">
                  <div className="w-16 h-16 rounded-[20px] bg-gradient-to-br from-[#6d28d9] to-[#9333ea] text-white grid place-items-center mx-auto shadow-md">
                    <Stethoscope className="h-7 w-7" />
                  </div>
                  <h2 className="font-['Bricolage_Grotesque',sans-serif] text-xl font-bold text-[#150f26] dark:text-white">
                    No doctors found
                  </h2>
                  <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] max-w-sm mx-auto">
                    {doctorSearchQuery || selectedSpecialty
                      ? "No doctors matched your search criteria. Try a different query or specialty."
                      : "Add your first doctor to begin scheduling automated phone consultations."}
                  </p>
                  <button
                    type="button"
                    onClick={handleOpenAddDoctorModal}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#6d28d9] to-[#9333ea] text-white font-semibold text-xs shadow-md shadow-purple-600/30 hover:brightness-105 transition-all cursor-pointer mt-2"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Add doctor</span>
                  </button>
                </div>
              ) : (
                <div className="rounded-[22px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-[#e6e0f5] dark:border-[#2b2347] bg-[#faf8fe] dark:bg-[#16112a] text-[#625b7e] dark:text-[#a29bc2] font-semibold text-[11px] uppercase tracking-wider">
                          <th className="py-3.5 px-5">Doctor</th>
                          <th className="py-3.5 px-4">Specialization</th>
                          <th className="py-3.5 px-4">Consultation &amp; Slot</th>
                          <th className="py-3.5 px-4">Weekly Schedule</th>
                          <th className="py-3.5 px-4">Status</th>
                          <th className="py-3.5 px-5 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#e6e0f5]/70 dark:divide-[#2b2347]/70">
                        {doctors.map((doc) => {
                          const activeShiftsCount =
                            doc.availabilities?.filter((a) => a.is_available).length || 0;
                          return (
                            <tr
                              key={doc.id}
                              className="hover:bg-purple-50/40 dark:hover:bg-white/[0.02] transition-colors group"
                            >
                              {/* Doctor Name & Avatar */}
                              <td className="py-3.5 px-5">
                                <div className="flex items-center gap-3">
                                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#6d28d9] to-[#9333ea] text-white font-bold text-xs grid place-items-center shrink-0 shadow-xs">
                                    {doc.full_name.replace(/^Dr\.?\s*/i, "").charAt(0).toUpperCase()}
                                  </div>
                                  <div className="min-w-0">
                                    <b className="block text-[13px] font-bold text-[#150f26] dark:text-white truncate">
                                      {doc.full_name}
                                    </b>
                                    <small className="text-[11px] text-[#625b7e] dark:text-[#a29bc2] block truncate font-mono">
                                      {doc.email || "No email registered"}
                                    </small>
                                  </div>
                                </div>
                              </td>

                              {/* Specialization & Department */}
                              <td className="py-3.5 px-4">
                                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-purple-50 dark:bg-purple-950/50 text-[#7c3aed] dark:text-purple-300 border border-purple-200/60 dark:border-purple-800/40">
                                  <Stethoscope className="h-3 w-3" />
                                  <span>{doc.specialization}</span>
                                </div>
                                {doc.department && (
                                  <div className="text-[10.5px] text-[#625b7e] dark:text-[#a29bc2] mt-0.5 font-medium">
                                    {doc.department}
                                  </div>
                                )}
                              </td>

                              {/* Fee & Slot Duration */}
                              <td className="py-3.5 px-4">
                                <div className="font-bold text-[#150f26] dark:text-white text-[12.5px]">
                                  ₹{doc.consultation_fee || 500}
                                </div>
                                <div className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
                                  {doc.slot_duration_minutes || 15} min slot
                                </div>
                              </td>

                              {/* Weekly Shifts */}
                              <td className="py-3.5 px-4">
                                <div className="flex items-center gap-1 flex-wrap mb-1">
                                  {DAYS_OF_WEEK.map((dName, dayIdx) => {
                                    const shift = doc.availabilities?.find(
                                      (a) => a.day_of_week === dayIdx
                                    );
                                    const isAvailable = shift ? shift.is_available : false;
                                    return (
                                      <span
                                        key={dayIdx}
                                        title={
                                          shift && isAvailable
                                            ? `${dName}: ${shift.start_time} - ${shift.end_time}`
                                            : `${dName}: Off duty`
                                        }
                                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                          isAvailable
                                            ? "bg-purple-100 dark:bg-purple-950/60 text-[#7c3aed] dark:text-purple-300"
                                            : "bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500"
                                        }`}
                                      >
                                        {dName.slice(0, 3)}
                                      </span>
                                    );
                                  })}
                                </div>
                                <span className="text-[10.5px] text-[#625b7e] dark:text-[#a29bc2] font-medium">
                                  {activeShiftsCount} of 7 days active
                                </span>
                              </td>

                              {/* Status */}
                              <td className="py-3.5 px-4">
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/40">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                  <span>Active</span>
                                </span>
                              </td>

                              {/* Actions */}
                              <td className="py-3.5 px-5 text-right">
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEditDoctorModal(doc)}
                                    title="Edit Doctor"
                                    className="p-1.5 rounded-lg text-[#625b7e] hover:text-[#7c3aed] hover:bg-purple-50 dark:hover:bg-white/10 transition-colors cursor-pointer"
                                  >
                                    <Edit3 className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteDoctor(doc.id, doc.full_name)}
                                    title="Delete Doctor"
                                    className="p-1.5 rounded-lg text-[#625b7e] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
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
                  WEEKLY OPERATING SCHEDULE (Matching Reference Physician Layout)
                  ========================================================================= */}
              <div className="p-6 sm:p-7 rounded-[24px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-[0_12px_30px_-18px_rgba(76,29,149,0.4)] dark:shadow-[0_14px_34px_-18px_rgba(0,0,0,0.8)] space-y-4">
                {/* Header with Title & Presets Toolbar */}
                <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-[#e6e0f5] dark:border-[#2b2347]">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-purple-100/60 dark:bg-purple-950/60 text-[#7c3aed]">
                      <Clock className="h-4.5 w-4.5" />
                    </div>
                    <div>
                      <h3 className="font-['Bricolage_Grotesque',sans-serif] font-bold text-base sm:text-lg text-[#150f26] dark:text-white leading-tight">
                        Weekly operating schedule
                      </h3>
                      <p className="text-xs text-[#625b7e] dark:text-[#a29bc2]">
                        Clinic open hours for automated phone bookings and voice agent shifts
                      </p>
                    </div>
                  </div>

                  {/* Presets Toolbar matching reference image */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={applyWeekdaysPreset}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#f3f0fb] dark:bg-[#1a1530] border border-[#e6e0f5] dark:border-[#2b2347] text-[#625b7e] dark:text-[#a29bc2] hover:text-[#7c3aed] transition-colors cursor-pointer"
                    >
                      Mon-Fri (9-5)
                    </button>
                    <button
                      type="button"
                      onClick={applyStandardPreset}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#f3f0fb] dark:bg-[#1a1530] border border-[#e6e0f5] dark:border-[#2b2347] text-[#625b7e] dark:text-[#a29bc2] hover:text-[#7c3aed] transition-colors cursor-pointer"
                    >
                      Mon-Sat (9-8)
                    </button>
                    <button
                      type="button"
                      onClick={applyAllWeekPreset}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#f3f0fb] dark:bg-[#1a1530] border border-[#e6e0f5] dark:border-[#2b2347] text-[#625b7e] dark:text-[#a29bc2] hover:text-[#7c3aed] transition-colors cursor-pointer"
                    >
                      All 7 days
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyMonToFri}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#f3f0fb] dark:bg-[#1a1530] border border-[#e6e0f5] dark:border-[#2b2347] text-[#625b7e] dark:text-[#a29bc2] hover:text-[#7c3aed] transition-colors cursor-pointer"
                    >
                      Copy Mon to Fri
                    </button>
                    <button
                      type="button"
                      onClick={applyClearAllPreset}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#f3f0fb] dark:bg-[#1a1530] border border-[#e6e0f5] dark:border-[#2b2347] text-[#625b7e] dark:text-[#a29bc2] hover:text-red-500 transition-colors cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                {/* 7 Sleek Horizontal Rows */}
                <div className="space-y-2">
                  {operatingHours.map((h) => {
                    const dayName = DAYS_OF_WEEK[h.day_of_week];
                    const isActive = !h.is_closed;
                    const isToday = h.day_of_week === todayDayIndex;
                    const durationText = calculateDuration(h.open_time, h.close_time);

                    return (
                      <div
                        key={h.day_of_week}
                        className={`px-3.5 py-2 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                          isActive
                            ? "bg-[#faf8fe] dark:bg-[#161226] border-[#e6e0f5] dark:border-[#2b2347]"
                            : "bg-[#f8f6fc]/50 dark:bg-[#1a1530]/40 border-transparent opacity-50"
                        }`}
                      >
                        {/* Left: Switch + Day Abbreviation */}
                        <div className="flex items-center gap-3 w-28 shrink-0">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={isActive}
                            onClick={() => handleToggleOperatingDay(h.day_of_week)}
                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                              isActive
                                ? "bg-gradient-to-r from-[#6d28d9] to-[#9333ea]"
                                : "bg-slate-200 dark:bg-slate-700"
                            }`}
                          >
                            <span
                              aria-hidden="true"
                              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                                isActive ? "translate-x-4" : "translate-x-0"
                              }`}
                            />
                          </button>

                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-xs text-[#150f26] dark:text-white">
                              {dayName.slice(0, 3)}
                            </span>
                            {isToday && (
                              <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-purple-100 dark:bg-purple-950 text-[#7c3aed] dark:text-[#a78bfa] border border-purple-200 dark:border-purple-800">
                                Today
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Right: Time Pickers OR Off duty */}
                        <div className="flex items-center justify-end gap-2 flex-1">
                          {isActive ? (
                            <>
                              <input
                                type="time"
                                value={h.open_time ? h.open_time.slice(0, 5) : "09:00"}
                                onChange={(e) =>
                                  handleUpdateOperatingTime(h.day_of_week, "open_time", e.target.value)
                                }
                                className="h-7.5 w-[112px] px-2.5 rounded-lg border border-[#e6e0f5] dark:border-[#2b2347] bg-white dark:bg-[#120e1f] text-xs font-mono font-medium text-[#150f26] dark:text-white focus:outline-none focus:border-[#7c3aed] transition-colors cursor-pointer"
                              />
                              <span className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">to</span>
                              <input
                                type="time"
                                value={h.close_time ? h.close_time.slice(0, 5) : "20:00"}
                                onChange={(e) =>
                                  handleUpdateOperatingTime(h.day_of_week, "close_time", e.target.value)
                                }
                                className="h-7.5 w-[112px] px-2.5 rounded-lg border border-[#e6e0f5] dark:border-[#2b2347] bg-white dark:bg-[#120e1f] text-xs font-mono font-medium text-[#150f26] dark:text-white focus:outline-none focus:border-[#7c3aed] transition-colors cursor-pointer"
                              />
                              <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-purple-100 dark:bg-purple-950/60 text-[#7c3aed] dark:text-[#c084fc] shrink-0 min-w-[50px] text-center">
                                {durationText}
                              </span>
                            </>
                          ) : (
                            <span className="text-xs text-slate-400 dark:text-slate-500 font-medium italic pr-2">
                              Off duty
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Bottom Summary & Save Actions */}
                <div className="space-y-3 pt-2">
                  <div className="px-3.5 py-2 rounded-xl bg-[#faf8fe] dark:bg-[#161226] border border-[#e6e0f5] dark:border-[#2b2347] flex items-center justify-between text-xs text-[#625b7e] dark:text-[#a29bc2]">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span>
                        <b className="text-[#150f26] dark:text-white">{activeDaysCount} of 7</b> active
                      </span>
                    </div>
                    <div>
                      Weekly: <b className="text-[#150f26] dark:text-white">{totalWeeklyOperatingHours} hrs / wk</b>
                    </div>
                  </div>

                  <div className="flex justify-end pt-1">
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
            </div>
          )}
        </div>
      </main>

      {/* =========================================================================
          REGISTER / EDIT PHYSICIAN MODAL POPUP (Exact Reference Image Layout)
          ========================================================================= */}
      {showDoctorModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-[#050a19]/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto animate-in fade-in duration-150"
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

                {/* RIGHT COLUMN: Weekly Shifts & Scheduling (7 cols) */}
                <div className="md:col-span-7 space-y-3 p-4 rounded-2xl bg-[#faf8fe] dark:bg-[#16112a] border border-[#e6e0f5] dark:border-[#2b2347]">
                  {/* Shifts Header with Presets */}
                  <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-[#e6e0f5] dark:border-[#2b2347]">
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-4 w-4 text-[#7c3aed]" />
                      <span className="text-xs font-bold text-[#150f26] dark:text-white">
                        Weekly consultation shifts
                      </span>
                    </div>

                    {/* Presets Toolbar */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => applyDoctorShiftPreset("weekdays")}
                        className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-white dark:bg-[#1f1938] border border-[#e6e0f5] dark:border-[#2b2347] text-[#625b7e] dark:text-[#a29bc2] hover:text-[#7c3aed] hover:border-[#7c3aed] transition-colors cursor-pointer"
                      >
                        Mon-Fri (9-5)
                      </button>
                      <button
                        type="button"
                        onClick={() => applyDoctorShiftPreset("mon-sat")}
                        className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-white dark:bg-[#1f1938] border border-[#e6e0f5] dark:border-[#2b2347] text-[#625b7e] dark:text-[#a29bc2] hover:text-[#7c3aed] hover:border-[#7c3aed] transition-colors cursor-pointer"
                      >
                        Mon-Sat (9-6)
                      </button>
                      <button
                        type="button"
                        onClick={() => applyDoctorShiftPreset("all-week")}
                        className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-white dark:bg-[#1f1938] border border-[#e6e0f5] dark:border-[#2b2347] text-[#625b7e] dark:text-[#a29bc2] hover:text-[#7c3aed] hover:border-[#7c3aed] transition-colors cursor-pointer"
                      >
                        All 7 days
                      </button>
                      <button
                        type="button"
                        onClick={() => applyDoctorShiftPreset("clear")}
                        className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-white dark:bg-[#1f1938] border border-[#e6e0f5] dark:border-[#2b2347] text-[#625b7e] dark:text-[#a29bc2] hover:text-red-500 hover:border-red-400 transition-colors cursor-pointer"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  {/* 7 Clean Day Rows */}
                  <div className="space-y-1.5">
                    {doctorFormData.availabilities.map((avail, idx) => {
                      const dayName = DAYS_OF_WEEK[avail.day_of_week];
                      const isActive = avail.is_active;

                      return (
                        <div
                          key={avail.day_of_week}
                          className={`px-3 py-2 rounded-xl border transition-all flex items-center justify-between gap-2 ${
                            isActive
                              ? "bg-white dark:bg-[#1a1435] border-[#e6e0f5] dark:border-[#2b2347] shadow-xs"
                              : "bg-slate-50/50 dark:bg-white/[0.02] border-transparent opacity-60"
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
                              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                isActive
                                  ? "bg-[#7c3aed]"
                                  : "bg-slate-200 dark:bg-slate-700"
                              }`}
                            >
                              <span
                                aria-hidden="true"
                                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${
                                  isActive ? "translate-x-4" : "translate-x-0"
                                }`}
                              />
                            </button>

                            <span className="font-bold text-xs text-[#150f26] dark:text-white">
                              {dayName.slice(0, 3)}
                            </span>
                          </div>

                          {/* Right: Time Pickers or Off Duty */}
                          <div className="flex items-center justify-end gap-2 flex-1">
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
                                  className="h-8 w-[108px] px-2 rounded-lg border border-[#e6e0f5] dark:border-[#2b2347] bg-white dark:bg-[#120e1f] text-xs font-mono font-medium text-[#150f26] dark:text-white focus:outline-none focus:border-[#7c3aed] transition-colors cursor-pointer"
                                />
                                <span className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">to</span>
                                <input
                                  type="time"
                                  value={avail.end_time}
                                  onChange={(e) => {
                                    const updated = [...doctorFormData.availabilities];
                                    updated[idx].end_time = e.target.value;
                                    setDoctorFormData((prev) => ({ ...prev, availabilities: updated }));
                                  }}
                                  className="h-8 w-[108px] px-2 rounded-lg border border-[#e6e0f5] dark:border-[#2b2347] bg-white dark:bg-[#120e1f] text-xs font-mono font-medium text-[#150f26] dark:text-white focus:outline-none focus:border-[#7c3aed] transition-colors cursor-pointer"
                                />
                                <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-purple-50 dark:bg-purple-950/40 text-[#7c3aed] dark:text-purple-300 shrink-0">
                                  {calculateShiftHours(avail.start_time, avail.end_time)}
                                </span>
                              </>
                            ) : (
                              <span className="text-xs text-slate-400 dark:text-slate-500 font-medium italic pr-2">
                                Off duty
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Compact Shift Summary */}
                  <div className="px-3 py-1.5 rounded-xl bg-white dark:bg-[#1a1435] border border-[#e6e0f5] dark:border-[#2b2347] flex items-center justify-between text-xs text-[#625b7e] dark:text-[#a29bc2]">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span>
                        <strong className="text-[#150f26] dark:text-white">
                          {doctorFormData.availabilities.filter((a) => a.is_active).length} of 7
                        </strong>{" "}
                        active
                      </span>
                    </div>
                    <div>
                      Weekly:{" "}
                      <strong className="text-[#150f26] dark:text-white">
                        {totalDoctorWeeklyHours}
                      </strong>
                    </div>
                  </div>
                </div>
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
