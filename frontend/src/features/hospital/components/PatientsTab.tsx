import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Search,
  Plus,
  Download,
  Upload,
  FileSpreadsheet,
  Calendar,
  Mail,
  Phone,
  Trash2,
  Edit3,
  Loader2,
  AlertCircle,
  CheckCircle2,
  X,
  ShieldAlert,
  Info,
  FileText,
} from "lucide-react";
import { z } from "zod";
import { CustomSelect } from "@/components/ui/CustomSelect";
import { apiClient } from "@/lib/api-client";
import {
  PatientItem,
  PatientCreatePayload,
  PatientPatchPayload,
  PatientListResponse,
  PatientImportResponse,
} from "@/types/onboarding";

// Zod Validation Schema for Patient Form
export const patientFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Patient full name is required")
    .max(120, "Name cannot exceed 120 characters"),
  phone: z
    .string()
    .trim()
    .min(1, "Mobile number is required")
    .regex(/^\d+$/, "Mobile number must contain digits only (no alphabets or special characters)")
    .min(10, "Mobile number must be at least 10 digits")
    .max(15, "Mobile number cannot exceed 15 digits"),
  date: z.string().trim().min(1, "Appointment/registration date is required"),
  email: z
    .string()
    .trim()
    .email("Invalid email address format")
    .optional()
    .or(z.literal("")),
  gender: z.string().optional(),
  notes: z.string().max(500, "Notes cannot exceed 500 characters").optional(),
});

interface PatientsTabProps {
  isOperator: boolean;
  showToast: (msg: string) => void;
  hospitalName?: string;
  portalContainer?: HTMLElement | null;
}

export const PatientsTab: React.FC<PatientsTabProps> = ({
  isOperator,
  showToast,
  hospitalName: _hospitalName = "Hospital",
  portalContainer,
}) => {
  const [patients, setPatients] = useState<PatientItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("");

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [editingPatient, setEditingPatient] = useState<PatientItem | null>(null);
  const [patientToDelete, setPatientToDelete] = useState<PatientItem | null>(null);
  const [isDeletingPatient, setIsDeletingPatient] = useState(false);

  // Form states
  const [formData, setFormData] = useState<PatientCreatePayload>({
    name: "",
    phone: "",
    date: new Date().toISOString().split("T")[0],
    email: "",
    gender: "Male",
    notes: "",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Import states
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<PatientImportResponse | null>(null);
  const [importBannerErrors, setImportBannerErrors] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Export / Sample states
  const [isExporting, setIsExporting] = useState(false);
  const [isDownloadingSample, setIsDownloadingSample] = useState(false);

  // Fetch patients
  const loadPatients = async () => {
    setIsLoading(true);
    try {
      const queryParams = new URLSearchParams();
      if (searchQuery.trim()) queryParams.set("search", searchQuery.trim());
      if (dateFilter) queryParams.set("date", dateFilter);

      const url = `/api/v1/patients${queryParams.toString() ? `?${queryParams.toString()}` : ""}`;
      const res = await apiClient.get<PatientListResponse>(url);
      setPatients(res.patients || []);
    } catch (err: unknown) {
      console.error("Failed to load patients:", err);
      showToast("Could not load patients list");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPatients();
  }, [searchQuery, dateFilter]);

  // Download Sample Template (.xlsx or .csv)
  const handleDownloadSample = async (format: "xlsx" | "csv" = "xlsx") => {
    setIsDownloadingSample(true);
    try {
      const blob = await apiClient.downloadBlob(`/api/v1/patients/sample-template?format=${format}`);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;
      a.download = `sample_patient_import_template.${format}`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        window.URL.revokeObjectURL(url);
        a.remove();
      }, 1000);
      showToast(`Sample ${format.toUpperCase()} template downloaded`);
    } catch (err: any) {
      console.error("Failed to download sample:", err);
      // Fallback: direct navigation download
      window.location.href = `/api/v1/patients/sample-template?format=${format}`;
      showToast(`Downloading sample ${format.toUpperCase()} template...`);
    } finally {
      setIsDownloadingSample(false);
    }
  };

  // Export all patients to Excel
  const handleExportExcel = async () => {
    setIsExporting(true);
    try {
      const blob = await apiClient.downloadBlob("/api/v1/patients/export-excel");
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;
      a.download = `patients_export_${new Date().toISOString().split("T")[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        window.URL.revokeObjectURL(url);
        a.remove();
      }, 1000);
      showToast("Patient records exported to Excel");
    } catch (err: any) {
      console.error("Export error:", err);
      window.location.href = "/api/v1/patients/export-excel";
      showToast("Exporting patient records...");
    } finally {
      setIsExporting(false);
    }
  };

  // Open Add Modal
  const handleOpenAddModal = () => {
    if (isOperator) {
      showToast("Operators have read-only access");
      return;
    }
    setFormData({
      name: "",
      phone: "",
      date: new Date().toISOString().split("T")[0],
      email: "",
      gender: "Male",
      notes: "",
    });
    setFormError(null);
    setShowAddModal(true);
  };

  // Open Edit Modal (PATCH)
  const handleOpenEditModal = (p: PatientItem) => {
    if (isOperator) {
      showToast("Operators have read-only access");
      return;
    }
    setEditingPatient(p);
    setFormData({
      name: p.name,
      phone: p.phone || "",
      date: p.date,
      email: p.email || "",
      gender: p.gender || "Male",
      notes: p.notes || "",
    });
    setFormError(null);
    setShowEditModal(true);
  };

  // KeyDown Handler: Disallow alphabets and symbols in phone number field
  const handlePhoneKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Allow navigation and editing control keys
    if (
      ["Backspace", "Delete", "Tab", "ArrowLeft", "ArrowRight", "Enter", "Home", "End"].includes(e.key) ||
      e.ctrlKey ||
      e.metaKey
    ) {
      return;
    }
    // Block any non-numeric character
    if (!/^[0-9]$/.test(e.key)) {
      e.preventDefault();
    }
  };

  // Change Handler: Strip non-digits on paste or typing
  const handlePhoneChange = (val: string) => {
    const digitsOnly = val.replace(/\D/g, "");
    if (digitsOnly.length <= 15) {
      setFormData((prev) => ({ ...prev, phone: digitsOnly }));
    }
  };

  // Create Patient (POST) with Zod Validation
  const handleCreatePatient = async (e: React.FormEvent) => {
    e.preventDefault();

    // Zod validation check
    const validation = patientFormSchema.safeParse(formData);
    if (!validation.success) {
      const firstError = validation.error.issues?.[0]?.message || "Validation failed";
      setFormError(firstError);
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      const created = await apiClient.post<PatientItem>("/api/v1/patients", {
        name: validation.data.name,
        phone: validation.data.phone,
        date: validation.data.date,
        email: validation.data.email?.trim() || null,
        gender: validation.data.gender || null,
        notes: validation.data.notes?.trim() || null,
      });

      setPatients((prev) => [created, ...prev]);
      setShowAddModal(false);
      showToast(`Patient ${created.name} added successfully`);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setFormError(err.message);
      } else {
        setFormError("Failed to create patient record.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Partial Update Patient (PATCH) with Zod Validation
  const handlePatchPatient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPatient) return;

    // Zod validation check
    const validation = patientFormSchema.safeParse(formData);
    if (!validation.success) {
      const firstError = validation.error.issues?.[0]?.message || "Validation failed";
      setFormError(firstError);
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    const patchPayload: PatientPatchPayload = {
      name: validation.data.name,
      phone: validation.data.phone,
      date: validation.data.date,
      email: validation.data.email?.trim() || null,
      gender: validation.data.gender || null,
      notes: validation.data.notes?.trim() || null,
    };

    try {
      const updated = await apiClient.patch<PatientItem>(
        `/api/v1/patients/${editingPatient.id}`,
        patchPayload
      );

      setPatients((prev) => prev.map((p) => (p.id === editingPatient.id ? updated : p)));
      setShowEditModal(false);
      showToast(`Patient ${updated.name} updated successfully (PATCH)`);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setFormError(err.message);
      } else {
        setFormError("Failed to update patient record.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Request Delete Patient (opens custom confirmation modal)
  const handleRequestDeletePatient = (patient: PatientItem) => {
    if (isOperator) {
      showToast("Operators have read-only access");
      return;
    }
    setPatientToDelete(patient);
  };

  // Confirm and Execute Patient Deletion
  const handleConfirmDeletePatient = async () => {
    if (!patientToDelete) return;
    setIsDeletingPatient(true);
    try {
      await apiClient.delete(`/api/v1/patients/${patientToDelete.id}`);
      setPatients((prev) => prev.filter((p) => p.id !== patientToDelete.id));
      showToast(`Patient ${patientToDelete.name} removed`);
      setPatientToDelete(null);
    } catch (err: unknown) {
      console.error("Delete patient error:", err);
      showToast("Failed to delete patient record");
    } finally {
      setIsDeletingPatient(false);
    }
  };

  // Import Excel File
  const handleImportSubmit = async () => {
    if (!importFile) {
      showToast("Please choose an Excel (.xlsx) or CSV (.csv) file to import");
      return;
    }

    setIsImporting(true);
    setImportResult(null);

    const form = new FormData();
    form.append("file", importFile);

    try {
      const res = await apiClient.uploadForm<PatientImportResponse>(
        "/api/v1/patients/import-excel",
        form
      );
      setImportResult(res);
      if (res.errors && res.errors.length > 0) {
        setImportBannerErrors(res.errors);
      } else {
        setImportBannerErrors([]);
      }
      if (res.imported > 0) {
        loadPatients();
        showToast(`Successfully imported ${res.imported} patient record(s)`);
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        showToast(err.message);
      } else {
        showToast("Excel import failed. Please verify format and headers.");
      }
    } finally {
      setIsImporting(false);
    }
  };

  const portalTarget =
    portalContainer || (typeof document !== "undefined" ? document.getElementById("header-actions-portal") : null);

  const headerActionsContent = (
    <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
      {/* Download Sample Template Dropdown / Buttons */}
      <div className="flex items-center gap-1 bg-[#fcfaff] dark:bg-white/5 border border-[#e6e0f5] dark:border-[#2b2347] rounded-xl p-1">
        <button
          type="button"
          onClick={() => handleDownloadSample("xlsx")}
          disabled={isDownloadingSample}
          title="Download sample Excel template (.xlsx)"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#150f26] dark:text-white hover:bg-white dark:hover:bg-white/10 transition-colors cursor-pointer"
        >
          {isDownloadingSample ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#7c3aed]" />
          ) : (
            <Download className="h-3.5 w-3.5 text-[#7c3aed]" />
          )}
          <span>Sample Excel</span>
        </button>
        <button
          type="button"
          onClick={() => handleDownloadSample("csv")}
          disabled={isDownloadingSample}
          title="Download sample CSV template (.csv)"
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#625b7e] dark:text-[#a29bc2] hover:bg-white dark:hover:bg-white/10 transition-colors cursor-pointer"
        >
          <FileText className="h-3 w-3 text-[#7c3aed]" />
          <span>CSV</span>
        </button>
      </div>

      {/* Export All to Excel */}
      <button
        type="button"
        onClick={handleExportExcel}
        disabled={isExporting || patients.length === 0}
        className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#fcfaff] dark:bg-white/5 hover:bg-white dark:hover:bg-white/10 text-[#150f26] dark:text-white text-xs font-semibold transition-all disabled:opacity-40 cursor-pointer"
      >
        {isExporting ? (
          <Loader2 className="h-4 w-4 animate-spin text-[#7c3aed]" />
        ) : (
          <FileSpreadsheet className="h-4 w-4 text-[#7c3aed]" />
        )}
        <span>Export Records</span>
      </button>

      {/* Admin Write Actions */}
      {!isOperator && (
        <>
          <button
            type="button"
            onClick={() => {
              setImportFile(null);
              setImportResult(null);
              setShowImportModal(true);
            }}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-purple-200 dark:border-purple-900/40 bg-purple-50 dark:bg-purple-950/30 hover:bg-purple-100 text-[#7c3aed] dark:text-purple-300 text-xs font-semibold transition-all cursor-pointer"
          >
            <Upload className="h-4 w-4" />
            <span>Import Excel</span>
          </button>

          <button
            type="button"
            onClick={handleOpenAddModal}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-[#7c3aed] to-[#9333ea] text-white hover:brightness-105 shadow-md shadow-purple-600/30 transition-all cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Add Patient</span>
          </button>
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Portal render for main header action buttons */}
      {portalTarget && createPortal(headerActionsContent, portalTarget)}

      {/* Operator Permission Banner */}
      {isOperator && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-500 flex items-center gap-3">
          <ShieldAlert className="h-5 w-5 shrink-0" />
          <div className="text-xs sm:text-sm">
            <span className="font-semibold">Operator View Only:</span> You have view-only access. You can view patient lists, filter by date, download sample templates, and export records.
          </div>
        </div>
      )}

      {/* Main Container */}
      <div className="p-6 rounded-[24px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm space-y-6">
        {/* Detailed Point-Wise Import Errors Top Banner with Clean Button */}
        {importBannerErrors.length > 0 && (
          <div className="p-4 rounded-2xl bg-red-50/90 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-red-700 dark:text-red-300">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Import Row Errors ({importBannerErrors.length} issues detected):</span>
              </div>
              <button
                type="button"
                onClick={() => setImportBannerErrors([])}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/40 hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors cursor-pointer shadow-xs"
                title="Clear and clean error list"
              >
                <span>Clean / Dismiss</span>
              </button>
            </div>
            <ul className="list-disc list-inside space-y-1.5 text-xs text-red-600 dark:text-red-300 max-h-48 overflow-y-auto pl-1 font-medium">
              {importBannerErrors.map((err: string, idx: number) => (
                <li key={idx} className="leading-relaxed">
                  {err}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Filter Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-2">
          {/* Search by Name, Mobile or Email */}
          <div className="sm:col-span-8 relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#a29bc2]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search patients by name, mobile number, or email..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#fcfaff] dark:bg-white/5 border border-[#e6e0f5] dark:border-[#2b2347] text-xs sm:text-sm text-[#150f26] dark:text-white placeholder:text-[#a29bc2] focus:outline-none focus:border-[#7c3aed] transition-colors"
            />
          </div>

          {/* Date Filter */}
          <div className="sm:col-span-4 relative flex items-center gap-2">
            <div className="relative flex-1">
              <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#a29bc2]" />
              <input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#fcfaff] dark:bg-white/5 border border-[#e6e0f5] dark:border-[#2b2347] text-xs sm:text-sm text-[#150f26] dark:text-white focus:outline-none focus:border-[#7c3aed] transition-colors"
              />
            </div>
            {dateFilter && (
              <button
                type="button"
                onClick={() => setDateFilter("")}
                className="p-2.5 rounded-xl text-xs text-[#625b7e] hover:text-[#150f26] dark:hover:text-white bg-[#fcfaff] dark:bg-white/5 border border-[#e6e0f5] dark:border-[#2b2347]"
                title="Clear date filter"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Patients Table */}
        {isLoading ? (
          <div className="py-20 flex flex-col items-center justify-center gap-3 text-[#625b7e]">
            <Loader2 className="h-8 w-8 animate-spin text-[#7c3aed]" />
            <span className="text-xs">Loading patient directory...</span>
          </div>
        ) : patients.length === 0 ? (
          <div className="py-16 text-center border-2 border-dashed border-[#e6e0f5] dark:border-[#2b2347] rounded-2xl p-8 space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-purple-100 dark:bg-purple-950/50 text-[#7c3aed] grid place-items-center mx-auto">
              <FileSpreadsheet className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#150f26] dark:text-white">
                No patient records found
              </h3>
              <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] mt-1 max-w-md mx-auto">
                {searchQuery || dateFilter
                  ? "No patients matched your search filters. Try adjusting the query or clearing the date filter."
                  : "Start by importing an Excel spreadsheet with patients or add one directly using the form."}
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#fcfaff] dark:bg-white/[0.02] border-b border-[#e6e0f5] dark:border-[#2b2347] text-[#625b7e] dark:text-[#a29bc2] uppercase font-semibold text-[11px] tracking-wider">
                <tr>
                  <th className="py-3.5 px-5">Patient Name</th>
                  <th className="py-3.5 px-4">Mobile Number <span className="text-[#7c3aed]">*</span></th>
                  <th className="py-3.5 px-4">Date</th>
                  <th className="py-3.5 px-4">Email Address (Optional)</th>
                  <th className="py-3.5 px-4">Gender</th>
                  <th className="py-3.5 px-4">Notes</th>
                  {!isOperator && <th className="py-3.5 px-5 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0ebfa] dark:divide-[#251e3e]">
                {patients.map((patient) => {
                  const initial = patient.name.charAt(0).toUpperCase() || "P";
                  return (
                    <tr
                      key={patient.id}
                      className="hover:bg-[#fbf9ff] dark:hover:bg-white/[0.02] transition-colors"
                    >
                      {/* Name & Avatar */}
                      <td className="py-3.5 px-5 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-xl bg-purple-100 dark:bg-purple-950/70 text-[#7c3aed] dark:text-purple-300 font-bold grid place-items-center text-xs shrink-0">
                            {initial}
                          </div>
                          <div>
                            <div className="font-semibold text-[#150f26] dark:text-white">
                              {patient.name}
                            </div>
                            <div className="text-[10px] text-[#625b7e] dark:text-[#a29bc2]">
                              ID: {patient.id.slice(0, 8)}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Mobile Number (Required) */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-mono font-medium">
                          <Phone className="h-3 w-3 text-emerald-500" />
                          <span>{patient.phone}</span>
                        </div>
                      </td>

                      {/* Date */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-50 dark:bg-purple-950/40 text-[#7c3aed] dark:text-purple-300 font-medium">
                          <Calendar className="h-3 w-3" />
                          <span>{patient.date}</span>
                        </span>
                      </td>

                      {/* Email (Optional) */}
                      <td className="py-3.5 px-4 text-[#625b7e] dark:text-[#a29bc2] whitespace-nowrap">
                        {patient.email ? (
                          <div className="flex items-center gap-1.5">
                            <Mail className="h-3.5 w-3.5 text-[#7c3aed]" />
                            <span>{patient.email}</span>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">—</span>
                        )}
                      </td>

                      {/* Gender */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          {patient.gender || "Unspecified"}
                        </span>
                      </td>

                      {/* Notes */}
                      <td className="py-3.5 px-4 max-w-xs truncate text-[#625b7e] dark:text-[#a29bc2]">
                        {patient.notes || <span className="text-slate-400 italic">—</span>}
                      </td>

                      {/* Actions (Admin Only) */}
                      {!isOperator && (
                        <td className="py-3.5 px-5 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(patient)}
                              className="p-1.5 rounded-lg text-[#625b7e] hover:text-[#7c3aed] hover:bg-purple-50 dark:hover:bg-purple-950/40 transition-colors"
                              title="Edit Patient (PATCH)"
                            >
                              <Edit3 className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRequestDeletePatient(patient)}
                              className="p-1.5 rounded-lg text-[#625b7e] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
                              title="Delete Patient Record"
                            >
                              <Trash2 className="h-4 w-4" />
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
        )}
      </div>

      {/* =========================================================================
          MODAL 1: ADD PATIENT (POST) WITH ZOD VALIDATION & NUMERIC PHONE
          ========================================================================= */}
      {showAddModal &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fade-in">
            <div className="w-full max-w-lg rounded-[24px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between pb-4 border-b border-[#e6e0f5] dark:border-[#2b2347]">
                <div>
                  <h3 className="text-base font-bold text-[#150f26] dark:text-white flex items-center gap-2">
                    <Plus className="h-4 w-4 text-[#7c3aed]" />
                    <span>Add New Patient</span>
                  </h3>
                  <p className="text-xs text-[#625b7e] dark:text-[#a29bc2]">
                    Create an appointment/intake record. Mobile number is required.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="p-1.5 rounded-xl text-[#625b7e] hover:text-[#150f26] dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {formError && (
                <div className="mt-4 p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-300 text-xs flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <form onSubmit={handleCreatePatient} className="mt-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#150f26] dark:text-white mb-1">
                      Patient Full Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g. Ramesh Kumar"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#fcfaff] dark:bg-white/5 border border-[#e6e0f5] dark:border-[#2b2347] text-xs sm:text-sm text-[#150f26] dark:text-white focus:outline-none focus:border-[#7c3aed]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#150f26] dark:text-white mb-1">
                      Mobile Number <span className="text-red-500">* (Digits Only)</span>
                    </label>
                    <input
                      type="tel"
                      inputMode="numeric"
                      required
                      value={formData.phone}
                      onKeyDown={handlePhoneKeyDown}
                      onChange={(e) => handlePhoneChange(e.target.value)}
                      placeholder="e.g. 9876543210 (10-15 digits)"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#fcfaff] dark:bg-white/5 border border-[#e6e0f5] dark:border-[#2b2347] text-xs sm:text-sm text-[#150f26] dark:text-white font-mono focus:outline-none focus:border-[#7c3aed]"
                    />
                    <p className="text-[10px] text-slate-400 mt-0.5">Only numbers allowed. Alphabets are blocked.</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#150f26] dark:text-white mb-1">
                      Appointment / Intake Date <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      required
                      value={formData.date}
                      onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#fcfaff] dark:bg-white/5 border border-[#e6e0f5] dark:border-[#2b2347] text-xs sm:text-sm text-[#150f26] dark:text-white focus:outline-none focus:border-[#7c3aed]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#150f26] dark:text-white mb-1">
                      Email Address <span className="text-slate-400 font-normal">(Optional)</span>
                    </label>
                    <input
                      type="email"
                      value={formData.email || ""}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="e.g. patient@example.com (optional)"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#fcfaff] dark:bg-white/5 border border-[#e6e0f5] dark:border-[#2b2347] text-xs sm:text-sm text-[#150f26] dark:text-white focus:outline-none focus:border-[#7c3aed]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#150f26] dark:text-white mb-1">
                    Gender
                  </label>
                  <CustomSelect
                    value={formData.gender || "Male"}
                    onChange={(val) => setFormData({ ...formData, gender: val })}
                    options={[
                      { value: "Male", label: "Male" },
                      { value: "Female", label: "Female" },
                      { value: "Other", label: "Other" },
                    ]}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#150f26] dark:text-white mb-1">
                    Clinical / General Notes
                  </label>
                  <textarea
                    rows={3}
                    value={formData.notes || ""}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="e.g. Follow-up for routine blood test, reports pending..."
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#fcfaff] dark:bg-white/5 border border-[#e6e0f5] dark:border-[#2b2347] text-xs text-[#150f26] dark:text-white focus:outline-none focus:border-[#7c3aed]"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#e6e0f5] dark:border-[#2b2347]">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="px-4 py-2.5 rounded-xl text-xs font-semibold text-[#625b7e] hover:text-[#150f26] dark:hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-[#7c3aed] to-[#9333ea] text-white hover:brightness-105 shadow-md shadow-purple-600/30 disabled:opacity-50"
                  >
                    {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    <span>Save Patient</span>
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* =========================================================================
          MODAL 2: EDIT PATIENT (STRICTLY PATCH) WITH ZOD VALIDATION & NUMERIC PHONE
          ========================================================================= */}
      {showEditModal &&
        editingPatient &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fade-in">
            <div className="w-full max-w-lg rounded-[24px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between pb-4 border-b border-[#e6e0f5] dark:border-[#2b2347]">
                <div>
                  <h3 className="text-base font-bold text-[#150f26] dark:text-white flex items-center gap-2">
                    <Edit3 className="h-4 w-4 text-[#7c3aed]" />
                    <span>Edit Patient Details (PATCH)</span>
                  </h3>
                  <p className="text-xs text-[#625b7e] dark:text-[#a29bc2]">
                    Partially update details for {editingPatient.name}.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="p-1.5 rounded-xl text-[#625b7e] hover:text-[#150f26] dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {formError && (
                <div className="mt-4 p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-300 text-xs flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <form onSubmit={handlePatchPatient} className="mt-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#150f26] dark:text-white mb-1">
                      Patient Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#fcfaff] dark:bg-white/5 border border-[#e6e0f5] dark:border-[#2b2347] text-xs sm:text-sm text-[#150f26] dark:text-white focus:outline-none focus:border-[#7c3aed]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#150f26] dark:text-white mb-1">
                      Mobile Number <span className="text-red-500">* (Digits Only)</span>
                    </label>
                    <input
                      type="tel"
                      inputMode="numeric"
                      required
                      value={formData.phone}
                      onKeyDown={handlePhoneKeyDown}
                      onChange={(e) => handlePhoneChange(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#fcfaff] dark:bg-white/5 border border-[#e6e0f5] dark:border-[#2b2347] text-xs sm:text-sm text-[#150f26] dark:text-white font-mono focus:outline-none focus:border-[#7c3aed]"
                    />
                    <p className="text-[10px] text-slate-400 mt-0.5">Only numbers allowed. Alphabets are blocked.</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#150f26] dark:text-white mb-1">
                      Date <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      required
                      value={formData.date}
                      onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#fcfaff] dark:bg-white/5 border border-[#e6e0f5] dark:border-[#2b2347] text-xs sm:text-sm text-[#150f26] dark:text-white focus:outline-none focus:border-[#7c3aed]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#150f26] dark:text-white mb-1">
                      Email Address <span className="text-slate-400 font-normal">(Optional)</span>
                    </label>
                    <input
                      type="email"
                      value={formData.email || ""}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="e.g. patient@example.com"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#fcfaff] dark:bg-white/5 border border-[#e6e0f5] dark:border-[#2b2347] text-xs sm:text-sm text-[#150f26] dark:text-white focus:outline-none focus:border-[#7c3aed]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#150f26] dark:text-white mb-1">
                    Gender
                  </label>
                  <CustomSelect
                    value={formData.gender || "Male"}
                    onChange={(val) => setFormData({ ...formData, gender: val })}
                    options={[
                      { value: "Male", label: "Male" },
                      { value: "Female", label: "Female" },
                      { value: "Other", label: "Other" },
                    ]}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#150f26] dark:text-white mb-1">
                    Notes
                  </label>
                  <textarea
                    rows={3}
                    value={formData.notes || ""}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#fcfaff] dark:bg-white/5 border border-[#e6e0f5] dark:border-[#2b2347] text-xs text-[#150f26] dark:text-white focus:outline-none focus:border-[#7c3aed]"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#e6e0f5] dark:border-[#2b2347]">
                  <button
                    type="button"
                    onClick={() => setShowEditModal(false)}
                    className="px-4 py-2.5 rounded-xl text-xs font-semibold text-[#625b7e] hover:text-[#150f26] dark:hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-[#7c3aed] to-[#9333ea] text-white hover:brightness-105 shadow-md shadow-purple-600/30 disabled:opacity-50"
                  >
                    {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    <span>Save Changes (PATCH)</span>
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* =========================================================================
          MODAL 3: EXCEL BULK IMPORT (WITH DETAILED ROW-BY-ROW ERROR REPORTING)
          ========================================================================= */}
      {showImportModal &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fade-in">
            <div className="w-full max-w-lg rounded-[24px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between pb-4 border-b border-[#e6e0f5] dark:border-[#2b2347]">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-purple-100 dark:bg-purple-950/70 text-[#7c3aed] grid place-items-center">
                    <Upload className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-[#150f26] dark:text-white">
                      Bulk Import Patients from Excel
                    </h3>
                    <p className="text-xs text-[#625b7e] dark:text-[#a29bc2]">
                      Upload an .xlsx or .csv spreadsheet to populate the patients table.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="p-1.5 rounded-xl text-[#625b7e] hover:text-[#150f26] dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Instruction Box */}
              <div className="mt-4 p-3.5 rounded-2xl bg-purple-50/70 dark:bg-purple-950/30 border border-purple-100 dark:border-purple-900/30 text-xs space-y-2">
                <div className="font-semibold text-[#7c3aed] dark:text-purple-300 flex items-center justify-between flex-wrap gap-2">
                  <span className="flex items-center gap-1.5">
                    <Info className="h-3.5 w-3.5" />
                    <span>Spreadsheet Requirements:</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleDownloadSample("xlsx")}
                      className="underline hover:text-purple-800 text-[11px] font-bold"
                    >
                      Download .xlsx
                    </button>
                    <span>•</span>
                    <button
                      type="button"
                      onClick={() => handleDownloadSample("csv")}
                      className="underline hover:text-purple-800 text-[11px] font-bold"
                    >
                      Download .csv
                    </button>
                  </div>
                </div>
                <p className="text-[#625b7e] dark:text-[#a29bc2] leading-relaxed text-[11px]">
                  Required headers: <code className="font-mono font-bold text-[#150f26] dark:text-white">name</code>, <code className="font-mono font-bold text-[#150f26] dark:text-white">phone</code> (10-15 digits only), and <code className="font-mono font-bold text-[#150f26] dark:text-white">date</code> (YYYY-MM-DD). Optional columns: <code className="font-mono text-slate-500">email</code>, <code className="font-mono text-slate-500">gender</code>, <code className="font-mono text-slate-500">notes</code>.
                </p>
              </div>

              {/* File Dropzone */}
              <div className="mt-4">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.csv"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      setImportFile(e.target.files[0]);
                      setImportResult(null);
                    }
                  }}
                  className="hidden"
                />
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
                    importFile
                      ? "border-emerald-500 bg-emerald-50/30 dark:bg-emerald-950/20"
                      : "border-[#e6e0f5] dark:border-[#2b2347] hover:border-[#7c3aed] bg-[#fcfaff] dark:bg-white/[0.02]"
                  }`}
                >
                  {importFile ? (
                    <div className="flex flex-col items-center gap-2">
                      <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                      <div className="text-xs font-semibold text-[#150f26] dark:text-white">
                        {importFile.name}
                      </div>
                      <div className="text-[11px] text-[#625b7e]">
                        {(importFile.size / 1024).toFixed(1)} KB • Click to choose another file
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <Upload className="h-8 w-8 text-[#7c3aed]" />
                      <div className="text-xs font-semibold text-[#150f26] dark:text-white">
                        Click to browse or drag & drop spreadsheet
                      </div>
                      <div className="text-[11px] text-[#a29bc2]">
                        Supports Excel (.xlsx) and CSV (.csv) up to 5MB
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Detailed Row-Level Import Results / Validation Errors */}
              {importResult && (
                <div className="mt-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-center">
                    <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/40">
                      <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                        {importResult.imported}
                      </div>
                      <div className="text-[11px] text-emerald-700 dark:text-emerald-300">
                        Successfully Imported
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/40">
                      <div className="text-lg font-bold text-amber-600 dark:text-amber-400">
                        {importResult.failed}
                      </div>
                      <div className="text-[11px] text-amber-700 dark:text-amber-300">
                        Failed / Rejected
                      </div>
                    </div>
                  </div>

                  {importResult.errors.length > 0 && (
                    <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 space-y-1.5 max-h-36 overflow-y-auto">
                      <div className="text-xs font-bold text-red-700 dark:text-red-300 flex items-center gap-1.5">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        <span>Row Validation Warnings ({importResult.errors.length}):</span>
                      </div>
                      <ul className="list-disc list-inside text-[11px] text-red-600 dark:text-red-300 space-y-1">
                        {importResult.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 mt-4 border-t border-[#e6e0f5] dark:border-[#2b2347]">
                {importResult ? (
                  <button
                    type="button"
                    onClick={() => {
                      setShowImportModal(false);
                      setImportFile(null);
                      setImportResult(null);
                    }}
                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-[#7c3aed] to-[#9333ea] text-white hover:brightness-105 shadow-md shadow-purple-600/30 cursor-pointer"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span>OK / Done</span>
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowImportModal(false)}
                      className="px-4 py-2.5 rounded-xl text-xs font-semibold text-[#625b7e] hover:text-[#150f26] dark:hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleImportSubmit}
                      disabled={!importFile || isImporting}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-[#7c3aed] to-[#9333ea] text-white hover:brightness-105 shadow-md shadow-purple-600/30 disabled:opacity-50 cursor-pointer"
                    >
                      {isImporting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      <span>{isImporting ? "Processing..." : "Start Import"}</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* =========================================================================
          MODAL 4: DELETE PATIENT CONFIRMATION MODAL
          ========================================================================= */}
      {patientToDelete &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fade-in">
            <div className="w-full max-w-md rounded-[24px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] p-6 shadow-2xl relative space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-red-100 dark:bg-red-950/70 text-red-500 grid place-items-center shrink-0">
                  <Trash2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#150f26] dark:text-white">
                    Remove Patient Record
                  </h3>
                  <p className="text-xs text-[#625b7e] dark:text-[#a29bc2]">
                    Are you sure you want to permanently delete this patient record? This action cannot be undone.
                  </p>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-[#fcfaff] dark:bg-white/5 border border-[#e6e0f5] dark:border-[#2b2347] text-xs space-y-1">
                <div className="font-semibold text-[#150f26] dark:text-white">
                  {patientToDelete.name}
                </div>
                <div className="text-[#625b7e] dark:text-[#a29bc2]">
                  Mobile: {patientToDelete.phone} {patientToDelete.email ? `• ${patientToDelete.email}` : ""}
                </div>
                <div className="text-[11px] text-[#a29bc2]">
                  Date: {patientToDelete.date} • Gender: {patientToDelete.gender || "Not specified"}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#e6e0f5] dark:border-[#2b2347]">
                <button
                  type="button"
                  onClick={() => setPatientToDelete(null)}
                  disabled={isDeletingPatient}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold text-[#625b7e] hover:text-[#150f26] dark:hover:text-white transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDeletePatient}
                  disabled={isDeletingPatient}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-700 text-white shadow-md shadow-red-500/20 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isDeletingPatient ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Deleting...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="h-4 w-4" />
                      <span>Delete Patient</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default PatientsTab;
