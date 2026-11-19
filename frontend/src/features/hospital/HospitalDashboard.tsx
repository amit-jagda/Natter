import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Building2,
  Stethoscope,
  Clock,
  Plus,
  Trash2,
  Mail,
  PhoneCall,
  Save,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import {
  AuthResponse,
  DoctorItem,
  DoctorCreatePayload,
  DoctorAvailabilityItem,
  OperatingHoursItem,
  TenantData,
} from "@/types/onboarding";

const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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
];

export const HospitalDashboard: React.FC = () => {
  const [tenant, setTenant] = useState<TenantData | null>(null);
  const [doctors, setDoctors] = useState<DoctorItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<"profile" | "doctors">("doctors");

  // Profile Form State
  const [phoneNumber, setPhoneNumber] = useState("");
  const [emergencyContact, setEmergencyContact] = useState("");
  const [address, setAddress] = useState({
    street: "",
    city: "",
    state: "",
    postal_code: "",
  });
  const [operatingHours, setOperatingHours] = useState<OperatingHoursItem[]>([]);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileSuccessMsg, setProfileSuccessMsg] = useState<string | null>(null);

  // Invite Doctor Modal State
  const [showDoctorModal, setShowDoctorModal] = useState(false);
  const [docName, setDocName] = useState("");
  const [docEmail, setDocEmail] = useState("");
  const [docSpecialty, setDocSpecialty] = useState("General Physician");
  const [slotDuration, setSlotDuration] = useState(30);
  const [fee, setFee] = useState("");
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
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const auth = await apiClient.get<AuthResponse>("/api/v1/auth/me");
      setTenant(auth.tenant);
      setPhoneNumber(auth.tenant.phone_number || "");
      setEmergencyContact(auth.tenant.emergency_contact || "");
      setAddress({
        street: auth.tenant.address?.street || "",
        city: auth.tenant.address?.city || "",
        state: auth.tenant.address?.state || "",
        postal_code: auth.tenant.address?.postal_code || "",
      });

      if (auth.tenant.operating_hours && auth.tenant.operating_hours.length === 7) {
        setOperatingHours(auth.tenant.operating_hours);
      } else {
        setOperatingHours(
          [0, 1, 2, 3, 4, 5, 6].map((day) => ({
            day_of_week: day,
            open_time: day === 6 ? null : "09:00",
            close_time: day === 6 ? null : "20:00",
            is_closed: day === 6,
          }))
        );
      }

      const docs = await apiClient.get<DoctorItem[]>("/api/v1/doctors");
      setDoctors(docs);
    } catch (err) {
      console.error("Dashboard data load error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingProfile(true);
    setProfileSuccessMsg(null);
    try {
      const updated = await apiClient.put<TenantData>("/api/v1/onboarding/hospital-profile", {
        phone_number: phoneNumber.trim() || undefined,
        emergency_contact: emergencyContact.trim() || undefined,
        address,
        operating_hours: operatingHours,
      });
      setTenant(updated);
      setProfileSuccessMsg("Hospital profile and operating hours updated successfully!");
      setTimeout(() => setProfileSuccessMsg(null), 4000);
    } catch (err: unknown) {
      console.error("Failed to update profile:", err);
      alert("Failed to update profile.");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleCreateDoctor = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError(null);

    const availabilities: DoctorAvailabilityItem[] = [];
    Object.entries(selectedDays).forEach(([dStr, isSelected]) => {
      if (isSelected) {
        availabilities.push({
          day_of_week: parseInt(dStr, 10),
          start_time: startTime,
          end_time: endTime,
          is_available: true,
        });
      }
    });

    const payload: DoctorCreatePayload = {
      full_name: docName.trim(),
      email: docEmail.trim(),
      specialization: docSpecialty,
      slot_duration_minutes: slotDuration,
      consultation_fee: fee ? parseFloat(fee) : undefined,
      availabilities,
    };

    setIsInviting(true);
    try {
      const newDoc = await apiClient.post<DoctorItem>("/api/v1/doctors", payload);
      setDoctors((prev) => [newDoc, ...prev]);
      setShowDoctorModal(false);
      setDocName("");
      setDocEmail("");
      setFee("");
    } catch (err: unknown) {
      console.error("Failed to invite doctor:", err);
      if (err instanceof Error) {
        setInviteError(err.message);
      } else {
        setInviteError("Failed to invite doctor.");
      }
    } finally {
      setIsInviting(false);
    }
  };

  const handleDeleteDoctor = async (id: string) => {
    if (!confirm("Are you sure you want to deactivate this doctor?")) return;
    try {
      await apiClient.delete(`/api/v1/doctors/${id}`);
      setDoctors((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      console.error("Failed to delete doctor:", err);
      alert("Failed to remove doctor.");
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="container mx-auto max-w-xl py-16 text-center">
        <Building2 className="mx-auto h-12 w-12 text-muted-foreground/60 mb-3" />
        <h2 className="text-xl font-bold">No Active Hospital Workspace Found</h2>
        <p className="text-sm text-muted-foreground mt-1 mb-6">
          Please register your hospital through the onboarding canvas to manage doctors and operating hours.
        </p>
        <Link to="/onboarding">
          <Button>Start Hospital Onboarding</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8 sm:px-8">
      {/* Hospital Workspace Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b pb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{tenant.name}</h1>
            <Badge variant="default" className="bg-emerald-600 text-xs">
              {tenant.onboarding_status === "COMPLETED" ? "Live" : "In Onboarding"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1 font-mono">
            Hospital ID: {tenant.id} &bull; Timezone: {tenant.timezone}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link to="/playground">
            <Button variant="outline" className="gap-2">
              <PhoneCall className="h-4 w-4 text-primary" />
              Test Voice AI Booking
            </Button>
          </Link>
          <Button onClick={() => setShowDoctorModal(true)} className="gap-1.5 shadow-sm">
            <Plus className="h-4 w-4" />
            Add Doctor
          </Button>
        </div>
      </div>

      {/* Tabs Switcher */}
      <div className="mb-6 flex gap-2 border-b">
        <button
          className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
            activeTab === "doctors"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("doctors")}
        >
          <Stethoscope className="h-4 w-4" />
          Doctors & Available Shifts ({doctors.length})
        </button>

        <button
          className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
            activeTab === "profile"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("profile")}
        >
          <Building2 className="h-4 w-4" />
          Hospital Profile & Operating Hours
        </button>
      </div>

      {/* Tab 1: Doctors & Availability CRUD */}
      {activeTab === "doctors" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold">Medical Staff Directory</h2>
              <p className="text-xs text-muted-foreground">
                Manage doctor specializations, consultation durations, and weekly shifts used by the voice agent.
              </p>
            </div>
            <Button onClick={() => setShowDoctorModal(true)} size="sm" className="gap-1">
              <Plus className="h-4 w-4" /> Invite Doctor
            </Button>
          </div>

          {doctors.length === 0 ? (
            <Card className="p-8 text-center border-dashed">
              <Stethoscope className="mx-auto h-10 w-10 text-muted-foreground/60 mb-2" />
              <h4 className="font-semibold text-sm">No Doctors Registered</h4>
              <p className="text-xs text-muted-foreground mt-1 mb-4">
                Add doctors to your hospital to enable outbound AI appointment booking calls.
              </p>
              <Button size="sm" onClick={() => setShowDoctorModal(true)}>
                Add First Doctor
              </Button>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {doctors.map((doc) => (
                <Card key={doc.id} className="shadow-sm hover:shadow transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-bold">
                          {doc.full_name.charAt(0)}
                        </div>
                        <div>
                          <CardTitle className="text-base font-semibold">{doc.full_name}</CardTitle>
                          <Badge variant="secondary" className="text-xs mt-0.5">
                            {doc.specialization}
                          </Badge>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10 h-8 w-8 p-0"
                        onClick={() => handleDeleteDoctor(doc.id)}
                        title="Deactivate doctor"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-3 pt-0">
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Mail className="h-3 w-3" /> {doc.email}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {doc.slot_duration_minutes}m slot
                      </span>
                      {doc.consultation_fee && <span>₹{doc.consultation_fee}</span>}
                    </div>

                    <div>
                      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                        Weekly Consultation Shifts:
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {doc.availabilities.length === 0 ? (
                          <span className="text-xs text-muted-foreground italic">No working shifts</span>
                        ) : (
                          doc.availabilities.map((a, idx) => (
                            <Badge key={idx} variant="outline" className="text-[11px] font-mono bg-muted/40">
                              {DAYS_SHORT[a.day_of_week]}: {a.start_time}-{a.end_time}
                            </Badge>
                          ))
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Hospital Profile & Operating Hours */}
      {activeTab === "profile" && (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Hospital Profile & Operating Hours</CardTitle>
            <CardDescription>
              Configure emergency contact numbers, physical hospital address, and 7-day operational schedule.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {profileSuccessMsg && (
              <div className="mb-4 flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-sm text-emerald-600 font-medium">
                <CheckCircle2 className="h-4 w-4" /> {profileSuccessMsg}
              </div>
            )}

            <form onSubmit={handleSaveProfile} className="space-y-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">
                    Main Reception Phone
                  </label>
                  <input
                    type="tel"
                    placeholder="+91 98765 43210"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">
                    Emergency / Hotline Phone
                  </label>
                  <input
                    type="tel"
                    placeholder="+91 102"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm"
                    value={emergencyContact}
                    onChange={(e) => setEmergencyContact(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">
                  Street Address
                </label>
                <input
                  type="text"
                  placeholder="Street / Landmark"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm mb-3"
                  value={address.street}
                  onChange={(e) => setAddress({ ...address, street: e.target.value })}
                />
                <div className="grid grid-cols-3 gap-3">
                  <input
                    type="text"
                    placeholder="City"
                    className="rounded-md border bg-background px-3 py-2 text-sm shadow-sm"
                    value={address.city}
                    onChange={(e) => setAddress({ ...address, city: e.target.value })}
                  />
                  <input
                    type="text"
                    placeholder="State"
                    className="rounded-md border bg-background px-3 py-2 text-sm shadow-sm"
                    value={address.state}
                    onChange={(e) => setAddress({ ...address, state: e.target.value })}
                  />
                  <input
                    type="text"
                    placeholder="Postal PIN"
                    className="rounded-md border bg-background px-3 py-2 text-sm shadow-sm"
                    value={address.postal_code}
                    onChange={(e) => setAddress({ ...address, postal_code: e.target.value })}
                  />
                </div>
              </div>

              {/* Operating Hours Table */}
              <div>
                <h4 className="text-sm font-semibold uppercase tracking-wider text-primary mb-3">
                  Hospital Operating Hours (Mon - Sun)
                </h4>
                <div className="rounded-lg border bg-muted/20 divide-y overflow-hidden">
                  {operatingHours.map((h) => {
                    const dayName = DAYS_OF_WEEK[h.day_of_week];
                    return (
                      <div
                        key={h.day_of_week}
                        className={`flex items-center justify-between p-3 gap-2 text-sm ${
                          h.is_closed ? "bg-muted/40 opacity-75" : "bg-card"
                        }`}
                      >
                        <span className="font-medium w-32">{dayName}</span>
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                            <input
                              type="checkbox"
                              checked={!h.is_closed}
                              onChange={(e) =>
                                setOperatingHours((prev) =>
                                  prev.map((item) =>
                                    item.day_of_week === h.day_of_week
                                      ? {
                                          ...item,
                                          is_closed: !e.target.checked,
                                          open_time: !e.target.checked ? null : item.open_time || "09:00",
                                          close_time: !e.target.checked ? null : item.close_time || "20:00",
                                        }
                                      : item
                                  )
                                )
                              }
                            />
                            <span>{h.is_closed ? "Closed" : "Open"}</span>
                          </label>

                          {!h.is_closed && (
                            <div className="flex items-center gap-2">
                              <input
                                type="time"
                                value={h.open_time || "09:00"}
                                onChange={(e) =>
                                  setOperatingHours((prev) =>
                                    prev.map((item) =>
                                      item.day_of_week === h.day_of_week
                                        ? { ...item, open_time: e.target.value }
                                        : item
                                    )
                                  )
                                }
                                className="rounded border bg-background px-2 py-1 text-xs font-mono"
                              />
                              <span className="text-xs text-muted-foreground">to</span>
                              <input
                                type="time"
                                value={h.close_time || "20:00"}
                                onChange={(e) =>
                                  setOperatingHours((prev) =>
                                    prev.map((item) =>
                                      item.day_of_week === h.day_of_week
                                        ? { ...item, close_time: e.target.value }
                                        : item
                                    )
                                  )
                                }
                                className="rounded border bg-background px-2 py-1 text-xs font-mono"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button type="submit" disabled={isSavingProfile} className="gap-2">
                  {isSavingProfile ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" /> Save Profile & Hours
                    </>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Modal: Invite / Add Doctor */}
      {showDoctorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-lg rounded-xl border bg-card p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b">
              <h3 className="text-lg font-bold">Invite New Doctor</h3>
              <button
                onClick={() => setShowDoctorModal(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-mono"
              >
                ✕
              </button>
            </div>

            {inviteError && (
              <div className="mt-4 rounded-lg bg-destructive/10 border border-destructive/20 p-2.5 text-xs text-destructive">
                {inviteError}
              </div>
            )}

            <form onSubmit={handleCreateDoctor} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">
                  Doctor Full Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Dr. Anil Kumble"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm"
                  value={docName}
                  onChange={(e) => setDocName(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">
                  Doctor Email Address *
                </label>
                <input
                  type="email"
                  required
                  placeholder="anil@hospital.com"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm"
                  value={docEmail}
                  onChange={(e) => setDocEmail(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">
                    Specialization
                  </label>
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm"
                    value={docSpecialty}
                    onChange={(e) => setDocSpecialty(e.target.value)}
                  >
                    {SPECIALIZATIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">
                    Slot Duration
                  </label>
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm"
                    value={slotDuration}
                    onChange={(e) => setSlotDuration(parseInt(e.target.value, 10))}
                  >
                    <option value={15}>15 mins</option>
                    <option value={20}>20 mins</option>
                    <option value={30}>30 mins</option>
                    <option value={45}>45 mins</option>
                    <option value={60}>60 mins</option>
                  </select>
                </div>
              </div>

              {/* Working Shifts */}
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <label className="block text-xs font-semibold text-primary uppercase">
                  Weekly Available Shifts
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {DAYS_SHORT.map((day, idx) => (
                    <button
                      type="button"
                      key={day}
                      onClick={() => setSelectedDays((p) => ({ ...p, [idx]: !p[idx] }))}
                      className={`px-2 py-1 text-xs rounded border transition-colors ${
                        selectedDays[idx]
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground"
                      }`}
                    >
                      {day}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 pt-1 text-xs">
                  <span className="text-muted-foreground">Hours:</span>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="rounded border px-2 py-1 font-mono text-xs bg-background"
                  />
                  <span>to</span>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="rounded border px-2 py-1 font-mono text-xs bg-background"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button type="button" variant="outline" onClick={() => setShowDoctorModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isInviting}>
                  {isInviting ? "Adding..." : "Add Doctor"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
