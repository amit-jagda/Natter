import React, { useState, useId } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Building2,
  User,
  Mail,
  Lock,
  ArrowRight,
  Loader2,
  Eye,
  EyeOff,
  AlertCircle,
  Copy,
  Check,
  ShieldCheck,
  ArrowLeft,
  PhoneCall,
  Sun,
  Moon,
  Sparkles,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import { AuthResponse, HospitalRegisterPayload } from "@/types/onboarding";
import { hospitalRegisterSchema } from "@/lib/validations/onboarding";

export const RegisterPage: React.FC = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { isDark, toggleTheme } = useTheme();

  const hospitalNameId = useId();
  const adminNameId = useId();
  const adminEmailId = useId();
  const passwordId = useId();

  const [formData, setFormData] = useState<HospitalRegisterPayload>({
    hospital_name: "",
    slug: "",
    admin_name: "",
    admin_email: "",
    password: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [copiedSlug, setCopiedSlug] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);

  const calculatePasswordStrength = (
    pwd: string
  ): { score: number; label: string; color: string } => {
    if (!pwd) return { score: 0, label: "Strength", color: "bg-slate-200 dark:bg-slate-800" };
    let score = 0;
    if (pwd.length >= 8) score += 1;
    if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score += 1;
    if (/\d/.test(pwd)) score += 1;
    if (/[^A-Za-z0-9]/.test(pwd) || pwd.length >= 12) score += 1;

    if (score <= 1) return { score: 1, label: "Weak", color: "bg-red-500" };
    if (score === 2) return { score: 2, label: "Fair", color: "bg-amber-500" };
    if (score === 3) return { score: 3, label: "Good", color: "bg-blue-500" };
    return { score: 4, label: "Strong", color: "bg-emerald-500" };
  };

  const strength = calculatePasswordStrength(formData.password);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value;
    const autoSlug = name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/[\s_-]+/g, "-");
    setFormData((prev) => ({
      ...prev,
      hospital_name: name,
      slug: autoSlug,
    }));
    if (fieldErrors.hospital_name) {
      setFieldErrors((prev) => ({ ...prev, hospital_name: "" }));
    }
  };

  const copySlug = () => {
    if (!formData.slug) return;
    navigator.clipboard.writeText(`https://voiceagent.hospital/${formData.slug}`);
    setCopiedSlug(true);
    setTimeout(() => setCopiedSlug(false), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);
    setFieldErrors({});

    const validationResult = hospitalRegisterSchema.safeParse(formData);
    if (!validationResult.success) {
      const errors: Record<string, string> = {};
      validationResult.error.issues.forEach((err) => {
        if (err.path[0]) {
          errors[String(err.path[0])] = err.message;
        }
      });
      setFieldErrors(errors);
      return;
    }

    setIsLoading(true);
    try {
      const response = await apiClient.post<AuthResponse>(
        "/api/v1/auth/register-hospital",
        validationResult.data
      );
      apiClient.setToken(response.access_token);
      login(response);
      navigate("/hospital");
    } catch (err: unknown) {
      console.error("Hospital registration error:", err);
      if (err instanceof Error) {
        setGeneralError(err.message);
      } else {
        setGeneralError("Failed to register hospital. Please verify your details.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f7f5ff] dark:bg-[#07050d] text-[#150f26] dark:text-[#f6f3ff] font-['Figtree',system-ui,sans-serif] antialiased flex flex-col justify-between py-8 px-4 sm:px-6 lg:px-8 transition-colors">
      {/* Top Bar with Home Link and Theme Toggle */}
      <header className="max-w-xl mx-auto w-full flex items-center justify-between mb-6">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#625b7e] hover:text-[#150f26] dark:text-[#a29bc2] dark:hover:text-white transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Home</span>
        </Link>

        <button
          type="button"
          onClick={toggleTheme}
          title={isDark ? "Switch to Light Theme" : "Switch to Dark Theme"}
          className="p-2.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] text-[#150f26] dark:text-white hover:bg-purple-100/60 dark:hover:bg-purple-950/40 transition-colors shadow-xs cursor-pointer"
        >
          {isDark ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-[#625b7e]" />}
        </button>
      </header>

      {/* Main Registration Card */}
      <main className="max-w-xl mx-auto w-full my-auto">
        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center p-3.5 rounded-[16px] bg-gradient-to-br from-[#6d28d9] to-[#9333ea] text-white shadow-[0_10px_24px_-10px_#6d28d9] mb-4">
            <PhoneCall className="h-6 w-6" />
          </div>
          <h1 className="font-['Bricolage_Grotesque',sans-serif] text-2xl sm:text-3xl font-bold tracking-tight text-[#150f26] dark:text-white">
            Register Hospital Workspace
          </h1>
          <p className="mt-1.5 text-xs sm:text-sm text-[#625b7e] dark:text-[#a29bc2]">
            Set up your clinical organization and immediately access the AI voice dispatch dashboard.
          </p>
        </div>

        {/* Card Box */}
        <div className="bg-white dark:bg-[#120e1f] p-6 sm:p-8 rounded-[22px] border border-[#e6e0f5] dark:border-[#2b2347] shadow-[0_12px_30px_-18px_rgba(76,29,149,0.4)] dark:shadow-[0_14px_34px_-18px_rgba(0,0,0,0.8)] space-y-6">
          {generalError && (
            <div className="rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 p-3.5 text-xs text-red-700 dark:text-red-300 font-semibold flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
              <span>{generalError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Hospital Name */}
            <div>
              <label
                htmlFor={hospitalNameId}
                className="block text-xs font-bold text-[#625b7e] dark:text-[#a29bc2] uppercase tracking-wider mb-1.5"
              >
                Hospital / Clinic Name
              </label>
              <div className="relative">
                <Building2 className="absolute left-3.5 top-3.5 h-4 w-4 text-[#625b7e] dark:text-[#a29bc2]" />
                <input
                  id={hospitalNameId}
                  type="text"
                  required
                  placeholder="e.g. Apollo Super Specialty Hospital"
                  className={`w-full h-11 pl-10 pr-3.5 rounded-xl border text-sm font-medium transition-all focus:outline-none bg-[#f3f0fb] dark:bg-[#1a1530] text-[#150f26] dark:text-white placeholder:text-[#625b7e] ${
                    fieldErrors.hospital_name
                      ? "border-red-400 focus:ring-2 focus:ring-red-100"
                      : "border-[#e6e0f5] dark:border-[#2b2347] focus:border-[#7c3aed]"
                  }`}
                  value={formData.hospital_name}
                  onChange={handleNameChange}
                />
              </div>
              {fieldErrors.hospital_name && (
                <p className="text-xs text-red-600 dark:text-red-400 font-medium mt-1 pl-1">
                  {fieldErrors.hospital_name}
                </p>
              )}
            </div>

            {/* Custom URL Slug Preview */}
            <div>
              <label className="block text-xs font-bold text-[#625b7e] dark:text-[#a29bc2] uppercase tracking-wider mb-1.5">
                Hospital Dedicated Domain Slug
              </label>
              <div className="flex rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] overflow-hidden bg-[#f3f0fb] dark:bg-[#1a1530] focus-within:border-[#7c3aed] transition-all">
                <span className="inline-flex items-center px-3 text-xs font-mono text-[#625b7e] dark:text-[#a29bc2] bg-purple-100/40 dark:bg-purple-950/40 border-r border-[#e6e0f5] dark:border-[#2b2347] select-none">
                  voiceagent.hospital/
                </span>
                <input
                  type="text"
                  placeholder="apollo-clinic"
                  className="flex-1 h-11 px-3 text-xs font-mono font-medium text-[#150f26] dark:text-white bg-transparent focus:outline-none"
                  value={formData.slug}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
                    }))
                  }
                />
                <button
                  type="button"
                  onClick={copySlug}
                  disabled={!formData.slug}
                  title="Copy URL"
                  className="px-3 flex items-center justify-center text-[#625b7e] hover:text-[#7c3aed] cursor-pointer disabled:opacity-40 transition-colors"
                >
                  {copiedSlug ? (
                    <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Grid for Medical Director Name & Admin Email */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Admin Name */}
              <div>
                <label
                  htmlFor={adminNameId}
                  className="block text-xs font-bold text-[#625b7e] dark:text-[#a29bc2] uppercase tracking-wider mb-1.5"
                >
                  Medical Director / Admin
                </label>
                <div className="relative">
                  <User className="absolute left-3.5 top-3.5 h-4 w-4 text-[#625b7e] dark:text-[#a29bc2]" />
                  <input
                    id={adminNameId}
                    type="text"
                    required
                    placeholder="Dr. Rajesh Sharma"
                    className={`w-full h-11 pl-10 pr-3.5 rounded-xl border text-sm font-medium transition-all focus:outline-none bg-[#f3f0fb] dark:bg-[#1a1530] text-[#150f26] dark:text-white placeholder:text-[#625b7e] ${
                      fieldErrors.admin_name
                        ? "border-red-400 focus:ring-2 focus:ring-red-100"
                        : "border-[#e6e0f5] dark:border-[#2b2347] focus:border-[#7c3aed]"
                    }`}
                    value={formData.admin_name}
                    onChange={(e) => setFormData((prev) => ({ ...prev, admin_name: e.target.value }))}
                  />
                </div>
                {fieldErrors.admin_name && (
                  <p className="text-xs text-red-600 dark:text-red-400 font-medium mt-1 pl-1">
                    {fieldErrors.admin_name}
                  </p>
                )}
              </div>

              {/* Admin Email */}
              <div>
                <label
                  htmlFor={adminEmailId}
                  className="block text-xs font-bold text-[#625b7e] dark:text-[#a29bc2] uppercase tracking-wider mb-1.5"
                >
                  Admin Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-3.5 h-4 w-4 text-[#625b7e] dark:text-[#a29bc2]" />
                  <input
                    id={adminEmailId}
                    type="email"
                    required
                    placeholder="admin@hospital.org"
                    className={`w-full h-11 pl-10 pr-3.5 rounded-xl border text-sm font-medium transition-all focus:outline-none bg-[#f3f0fb] dark:bg-[#1a1530] text-[#150f26] dark:text-white placeholder:text-[#625b7e] ${
                      fieldErrors.admin_email
                        ? "border-red-400 focus:ring-2 focus:ring-red-100"
                        : "border-[#e6e0f5] dark:border-[#2b2347] focus:border-[#7c3aed]"
                    }`}
                    value={formData.admin_email}
                    onChange={(e) => setFormData((prev) => ({ ...prev, admin_email: e.target.value }))}
                  />
                </div>
                {fieldErrors.admin_email && (
                  <p className="text-xs text-red-600 dark:text-red-400 font-medium mt-1 pl-1">
                    {fieldErrors.admin_email}
                  </p>
                )}
              </div>
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor={passwordId}
                className="block text-xs font-bold text-[#625b7e] dark:text-[#a29bc2] uppercase tracking-wider mb-1.5"
              >
                Account Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-3.5 h-4 w-4 text-[#625b7e] dark:text-[#a29bc2]" />
                <input
                  id={passwordId}
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="Min. 8 chars with letter &amp; number"
                  className={`w-full h-11 pl-10 pr-11 rounded-xl border text-sm font-medium transition-all focus:outline-none bg-[#f3f0fb] dark:bg-[#1a1530] text-[#150f26] dark:text-white placeholder:text-[#625b7e] ${
                    fieldErrors.password
                      ? "border-red-400 focus:ring-2 focus:ring-red-100"
                      : "border-[#e6e0f5] dark:border-[#2b2347] focus:border-[#7c3aed]"
                  }`}
                  value={formData.password}
                  onChange={(e) => setFormData((prev) => ({ ...prev, password: e.target.value }))}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-3.5 text-[#625b7e] hover:text-[#150f26] dark:hover:text-white p-0.5 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {/* Password Strength Meter */}
              {formData.password && (
                <div className="mt-2 space-y-1.5">
                  <div className="flex gap-1 h-1.5 w-full bg-[#e6e0f5] dark:bg-[#2b2347] rounded-full overflow-hidden">
                    {[1, 2, 3, 4].map((step) => (
                      <div
                        key={step}
                        className={`flex-1 transition-all duration-300 ${
                          strength.score >= step ? strength.color : "bg-transparent"
                        }`}
                      />
                    ))}
                  </div>
                  <div className="flex justify-between items-center text-[10px] text-[#625b7e] dark:text-[#a29bc2]">
                    <span>Min 8 chars, 1 letter, 1 number</span>
                    <span className="font-semibold text-[#150f26] dark:text-white">
                      Security: {strength.label}
                    </span>
                  </div>
                </div>
              )}

              {fieldErrors.password && (
                <p className="text-xs text-red-600 dark:text-red-400 font-medium mt-1 pl-1">
                  {fieldErrors.password}
                </p>
              )}
            </div>

            {/* Direct Submit to Dashboard */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-12 rounded-xl bg-gradient-to-r from-[#6d28d9] to-[#9333ea] text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-md shadow-purple-600/30 hover:brightness-105 active:scale-95 transition-all cursor-pointer disabled:opacity-50 mt-6"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Creating Workspace &amp; Initializing Roster...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  <span>Create Workspace &amp; Open Dashboard</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          {/* Prompt to Sign In */}
          <div className="pt-4 border-t border-[#e6e0f5] dark:border-[#2b2347] text-center space-y-3">
            <p className="text-xs text-[#625b7e] dark:text-[#a29bc2]">
              Already registered your clinic?{" "}
              <Link to="/login" className="font-bold text-[#7c3aed] dark:text-[#a78bfa] hover:underline">
                Sign in to Dashboard &rarr;
              </Link>
            </p>

            <div className="flex items-center justify-center gap-1.5 text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Multi-Tenant Architecture &bull; HIPAA Aligned &bull; Dedicated PostgreSQL Schema</span>
            </div>
          </div>
        </div>
      </main>

      {/* Footer Note */}
      <footer className="text-center text-xs text-[#625b7e] dark:text-[#a29bc2] mt-6">
        Hospital Voice Agent &bull; Autonomous Clinical Outbound Engine &bull; Workspace Edition
      </footer>
    </div>
  );
};
