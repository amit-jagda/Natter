import React, { useState, useId } from "react";
import { Link } from "react-router-dom";
import {
  Building2,
  User,
  Mail,
  Lock,
  ArrowRight,
  Loader2,
  Globe,
  Eye,
  EyeOff,
  AlertCircle,
  Copy,
  Check,
  ShieldCheck,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { AuthResponse, HospitalRegisterPayload } from "@/types/onboarding";
import { hospitalRegisterSchema } from "@/lib/validations/onboarding";

interface Props {
  onSuccess: (auth: AuthResponse) => void;
}

export const Step1Register: React.FC<Props> = ({ onSuccess }) => {
  const { login } = useAuth();
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

  // Validation rules as in Natter HTML
  const isHospitalValid = formData.hospital_name.trim().length >= 3;
  const isNameValid = formData.admin_name.trim().length >= 3;
  const isEmailValid = /^\S+@\S+\.\S+$/.test(formData.admin_email);
  const isPasswordValid =
    formData.password.length >= 8 &&
    /[a-zA-Z]/.test(formData.password) &&
    /\d/.test(formData.password);

  const calculatePasswordStrength = (pwd: string): { score: number; label: string; color: string } => {
    if (!pwd) return { score: 0, label: "Strength", color: "bg-slate-200" };
    let score = 0;
    if (pwd.length >= 8) score += 1;
    if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score += 1;
    if (/\d/.test(pwd)) score += 1;
    if (/[^A-Za-z0-9]/.test(pwd) || pwd.length >= 12) score += 1;

    if (score <= 1) return { score: 1, label: "Weak", color: "bg-red-500" };
    if (score === 2) return { score: 2, label: "Fair", color: "bg-amber-500" };
    if (score === 3) return { score: 3, label: "Good", color: "bg-lime-500" };
    return { score: 4, label: "Strong", color: "bg-green-600" };
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
    navigator.clipboard.writeText(`https://app.natter.ai/${formData.slug}`);
    setCopiedSlug(true);
    setTimeout(() => setCopiedSlug(false), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);
    setFieldErrors({});

    // Zod Client-Side Validation
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
      if (response.refresh_token) {
        apiClient.setRefreshToken(response.refresh_token);
      }
      login(response);
      onSuccess(response);
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
    <div className="w-full max-w-[520px] mx-auto py-2">
      {/* Step Header */}
      <div className="mb-6">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 text-blue-600 font-semibold text-[12.5px] mb-3">
          ✦ Step 1 of 4 · Organization
        </span>
        <h2 className="text-[30px] sm:text-[32px] font-extrabold tracking-[-0.03em] text-slate-900 mt-2 mb-1.5 leading-tight">
          Create hospital workspace
        </h2>
        <p className="text-slate-500 text-[14px] leading-relaxed">
          Set up your organization and the primary medical director account.
        </p>
      </div>

      {generalError && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-3.5 text-xs text-red-700 font-medium flex items-center gap-2 mb-4">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
          <span>{generalError}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Hospital Name with Floating Label */}
        <div className="relative">
          <Building2 className="absolute left-3.5 top-[18px] h-5 w-5 text-slate-400 pointer-events-none transition-colors" />
          <input
            id={hospitalNameId}
            type="text"
            required
            placeholder=" "
            className={`peer w-full h-14 border-[1.5px] rounded-xl bg-white text-slate-900 px-11 pt-4 pb-0 text-sm font-medium transition-all focus:outline-none ${
              fieldErrors.hospital_name
                ? "border-red-400 focus:ring-4 focus:ring-red-100"
                : "border-slate-200 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/15"
            }`}
            value={formData.hospital_name}
            onChange={handleNameChange}
          />
          <label
            htmlFor={hospitalNameId}
            className="absolute left-11 top-[18px] text-slate-400 text-sm pointer-events-none transition-all peer-focus:top-2 peer-focus:text-[11px] peer-focus:font-semibold peer-focus:text-blue-600 peer-[:not(:placeholder-shown)]:top-2 peer-[:not(:placeholder-shown)]:text-[11px] peer-[:not(:placeholder-shown)]:font-semibold peer-[:not(:placeholder-shown)]:text-slate-500"
          >
            Hospital / clinic name
          </label>

          {/* Green Checkmark Badge when valid */}
          {isHospitalValid && (
            <span className="absolute right-3.5 top-[18px] w-5 h-5 rounded-full bg-green-600 grid place-items-center text-white animate-in zoom-in-75">
              <Check className="h-3 w-3 stroke-[3]" />
            </span>
          )}

          {fieldErrors.hospital_name && (
            <p className="text-xs text-red-600 font-medium mt-1 pl-1 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" /> {fieldErrors.hospital_name}
            </p>
          )}

          {/* Slug preview */}
          {formData.slug && !fieldErrors.hospital_name && (
            <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 mt-2">
              <div className="flex items-center gap-1.5 font-mono truncate">
                <Globe className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                <span className="text-slate-400">app.natter.ai/</span>
                <span className="font-bold text-slate-900">{formData.slug}</span>
              </div>
              <button
                type="button"
                onClick={copySlug}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 transition-colors"
              >
                {copiedSlug ? (
                  <>
                    <Check className="h-3 w-3 text-green-600" />
                    <span className="text-green-600">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Admin Name & Email in Two Columns */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {/* Admin Name */}
          <div className="relative">
            <User className="absolute left-3.5 top-[18px] h-5 w-5 text-slate-400 pointer-events-none" />
            <input
              id={adminNameId}
              type="text"
              required
              placeholder=" "
              className={`peer w-full h-14 border-[1.5px] rounded-xl bg-white text-slate-900 px-11 pt-4 pb-0 text-sm font-medium transition-all focus:outline-none ${
                fieldErrors.admin_name
                  ? "border-red-400 focus:ring-4 focus:ring-red-100"
                  : "border-slate-200 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/15"
              }`}
              value={formData.admin_name}
              onChange={(e) => {
                setFormData({ ...formData, admin_name: e.target.value });
                if (fieldErrors.admin_name) setFieldErrors({ ...fieldErrors, admin_name: "" });
              }}
            />
            <label
              htmlFor={adminNameId}
              className="absolute left-11 top-[18px] text-slate-400 text-sm pointer-events-none transition-all peer-focus:top-2 peer-focus:text-[11px] peer-focus:font-semibold peer-focus:text-blue-600 peer-[:not(:placeholder-shown)]:top-2 peer-[:not(:placeholder-shown)]:text-[11px] peer-[:not(:placeholder-shown)]:font-semibold peer-[:not(:placeholder-shown)]:text-slate-500"
            >
              Admin full name
            </label>

            {isNameValid && (
              <span className="absolute right-3.5 top-[18px] w-5 h-5 rounded-full bg-green-600 grid place-items-center text-white animate-in zoom-in-75">
                <Check className="h-3 w-3 stroke-[3]" />
              </span>
            )}

            {fieldErrors.admin_name && (
              <p className="text-xs text-red-600 font-medium mt-1 pl-1">{fieldErrors.admin_name}</p>
            )}
          </div>

          {/* Admin Email */}
          <div className="relative">
            <Mail className="absolute left-3.5 top-[18px] h-5 w-5 text-slate-400 pointer-events-none" />
            <input
              id={adminEmailId}
              type="email"
              required
              placeholder=" "
              className={`peer w-full h-14 border-[1.5px] rounded-xl bg-white text-slate-900 px-11 pt-4 pb-0 text-sm font-medium transition-all focus:outline-none ${
                fieldErrors.admin_email
                  ? "border-red-400 focus:ring-4 focus:ring-red-100"
                  : "border-slate-200 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/15"
              }`}
              value={formData.admin_email}
              onChange={(e) => {
                setFormData({ ...formData, admin_email: e.target.value });
                if (fieldErrors.admin_email) setFieldErrors({ ...fieldErrors, admin_email: "" });
              }}
            />
            <label
              htmlFor={adminEmailId}
              className="absolute left-11 top-[18px] text-slate-400 text-sm pointer-events-none transition-all peer-focus:top-2 peer-focus:text-[11px] peer-focus:font-semibold peer-focus:text-blue-600 peer-[:not(:placeholder-shown)]:top-2 peer-[:not(:placeholder-shown)]:text-[11px] peer-[:not(:placeholder-shown)]:font-semibold peer-[:not(:placeholder-shown)]:text-slate-500"
            >
              Work email
            </label>

            {isEmailValid && (
              <span className="absolute right-3.5 top-[18px] w-5 h-5 rounded-full bg-green-600 grid place-items-center text-white animate-in zoom-in-75">
                <Check className="h-3 w-3 stroke-[3]" />
              </span>
            )}

            {fieldErrors.admin_email && (
              <p className="text-xs text-red-600 font-medium mt-1 pl-1">{fieldErrors.admin_email}</p>
            )}
          </div>
        </div>

        {/* Password Field with Eye and Strength Meter */}
        <div>
          <div className="relative">
            <Lock className="absolute left-3.5 top-[18px] h-5 w-5 text-slate-400 pointer-events-none" />
            <input
              id={passwordId}
              type={showPassword ? "text" : "password"}
              required
              minLength={8}
              placeholder=" "
              className={`peer w-full h-14 border-[1.5px] rounded-xl bg-white text-slate-900 px-11 pr-20 pt-4 pb-0 text-sm font-medium transition-all focus:outline-none ${
                fieldErrors.password
                  ? "border-red-400 focus:ring-4 focus:ring-red-100"
                  : "border-slate-200 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/15"
              }`}
              value={formData.password}
              onChange={(e) => {
                setFormData({ ...formData, password: e.target.value });
                if (fieldErrors.password) setFieldErrors({ ...fieldErrors, password: "" });
              }}
            />
            <label
              htmlFor={passwordId}
              className="absolute left-11 top-[18px] text-slate-400 text-sm pointer-events-none transition-all peer-focus:top-2 peer-focus:text-[11px] peer-focus:font-semibold peer-focus:text-blue-600 peer-[:not(:placeholder-shown)]:top-2 peer-[:not(:placeholder-shown)]:text-[11px] peer-[:not(:placeholder-shown)]:font-semibold peer-[:not(:placeholder-shown)]:text-slate-500"
            >
              Password
            </label>

            {isPasswordValid && (
              <span className="absolute right-11 top-[18px] w-5 h-5 rounded-full bg-green-600 grid place-items-center text-white animate-in zoom-in-75">
                <Check className="h-3 w-3 stroke-[3]" />
              </span>
            )}

            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3.5 top-[18px] text-slate-400 hover:text-slate-600 transition-colors p-0.5"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          {/* 4-Segment Strength Meter */}
          <div className="flex items-center gap-1.5 mt-2 mb-1 px-1">
            {[1, 2, 3, 4].map((step) => (
              <div
                key={step}
                className={`flex-1 h-1 rounded-full transition-all duration-300 ${
                  strength.score >= step ? strength.color : "bg-slate-200"
                }`}
              />
            ))}
            <span
              className={`text-xs font-semibold min-w-[55px] text-right transition-colors ${
                strength.score <= 1
                  ? "text-red-500"
                  : strength.score === 2
                  ? "text-amber-500"
                  : strength.score === 3
                  ? "text-lime-600"
                  : "text-green-600"
              }`}
            >
              {formData.password ? strength.label : "Strength"}
            </span>
          </div>

          {fieldErrors.password && (
            <p className="text-xs text-red-600 font-medium pl-1">{fieldErrors.password}</p>
          )}
        </div>

        {/* Submit Button (Gradient Blue from Natter HTML) */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={isLoading}
            className="w-full h-[54px] rounded-xl bg-gradient-to-r from-[#2563eb] to-[#4f46e5] text-white font-semibold text-[15px] flex items-center justify-center gap-2.5 shadow-[0_10px_24px_-8px_rgba(37,99,235,0.6)] hover:shadow-[0_16px_30px_-10px_rgba(37,99,235,0.7)] hover:-translate-y-0.5 active:translate-y-0 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Setting up workspace...</span>
              </>
            ) : (
              <>
                <span>Continue to hospital profile</span>
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>

        {/* Trust Badges */}
        <div className="flex items-center justify-center gap-6 pt-3 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-green-600" /> Encrypted data
          </span>
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-green-600" /> Isolated per hospital
          </span>
        </div>

        {/* Existing User Login Prompt */}
        <div className="pt-1 text-center">
          <p className="text-xs text-slate-500">
            Already registered?{" "}
            <Link
              to="/login"
              className="font-semibold text-blue-600 hover:underline"
            >
              Sign in to Hospital Portal &rarr;
            </Link>
          </p>
        </div>
      </form>
    </div>
  );
};
