import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Mail,
  Lock,
  ArrowRight,
  Loader2,
  AlertCircle,
  CheckCircle2,
  PhoneCall,
  ArrowLeft,
  Calendar,
  ShieldCheck,
  Eye,
  EyeOff,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { AuthResponse } from "@/types/onboarding";
import { loginSchema } from "@/lib/validations/onboarding";

interface ToastState {
  type: "success" | "error";
  message: string;
}

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login } = useAuth();

  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  };

  const handleInputChange = (field: keyof typeof formData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (fieldErrors[field]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
    if (generalError) {
      setGeneralError(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);
    setFieldErrors({});

    // 1. Zod Validation
    const validationResult = loginSchema.safeParse(formData);
    if (!validationResult.success) {
      const errors: Record<string, string> = {};
      validationResult.error.issues.forEach((issue) => {
        const fieldName = String(issue.path[0] || "");
        if (fieldName && !errors[fieldName]) {
          errors[fieldName] = issue.message;
        }
      });
      setFieldErrors(errors);
      showToast("Please provide valid login credentials.", "error");
      return;
    }

    setIsLoading(true);

    try {
      // 2. Submit to Backend API
      const response = await apiClient.post<AuthResponse>("/api/v1/auth/login", {
        email: formData.email.trim().toLowerCase(),
        password: formData.password,
      });

      apiClient.setToken(response.access_token);
      login(response);

      showToast("Signed in successfully! Redirecting to workspace...", "success");

      const targetRedirect = searchParams.get("redirect") || "/hospital";
      setTimeout(() => {
        navigate(targetRedirect);
      }, 600);
    } catch (err: unknown) {
      console.error("Login failed:", err);
      const errorMessage =
        err instanceof Error
          ? err.message
          : "Invalid email or password. Please verify your credentials.";

      setGeneralError(errorMessage);
      showToast(errorMessage, "error");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex app-product-bg text-[#150f26] dark:text-[#f6f3ff] font-['Figtree',system-ui,sans-serif] antialiased transition-colors">
      {/* =========================================================================
          LEFT SIDE: CLINICAL SHOWCASE & BRANDING (Exact match to RegisterPage)
          ========================================================================= */}
      <aside className="hidden lg:flex lg:w-[48%] xl:w-[45%] flex-col justify-between p-10 xl:p-14 bg-white dark:bg-[#120e1f] border-r border-[#e6e0f5] dark:border-[#2b2347] text-[#150f26] dark:text-white relative overflow-hidden select-none shrink-0 shadow-sm">
        {/* Glow Spheres */}
        <div className="absolute -top-32 -left-32 w-96 h-96 bg-purple-100/60 dark:bg-purple-950/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-pink-100/60 dark:bg-pink-950/20 rounded-full blur-3xl pointer-events-none" />

        {/* Brand Header */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-[44px] h-[44px] rounded-[14px] bg-gradient-to-br from-[#6d28d9] to-[#9333ea] flex items-center justify-center text-white shadow-md shadow-purple-600/30">
            <PhoneCall className="h-5 w-5" />
          </div>
          <div>
            <span className="font-['Bricolage_Grotesque',sans-serif] text-xl font-bold tracking-tight block text-[#150f26] dark:text-white">
              Hospital Voice Agent
            </span>
            <span className="text-[11px] font-mono text-[#7c3aed] dark:text-purple-300 font-semibold uppercase tracking-wider block">
              Autonomous Clinical Dispatch
            </span>
          </div>
        </div>

        {/* Main Narrative & Showcase Feature Cards */}
        <div className="relative z-10 my-auto py-8 space-y-6">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 text-[#7c3aed] dark:text-purple-300 text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Clinical Dispatch Center Active</span>
            </div>
            <h2 className="font-['Bricolage_Grotesque',sans-serif] text-3xl xl:text-4xl font-bold leading-tight text-[#150f26] dark:text-white">
              Welcome back to your Clinical Voice Dispatch Center.
            </h2>
            <p className="text-[#625b7e] dark:text-[#a29bc2] text-sm leading-relaxed max-w-lg">
              Manage doctor consultation hours, view real-time outbound call analytics, and test live AI conversations across your hospital workspace.
            </p>
          </div>

          {/* 3 Value Pillars */}
          <div className="space-y-3.5 pt-2">
            <div className="p-4 rounded-2xl bg-[#faf8fe] dark:bg-[#181329] border border-[#e6e0f5] dark:border-[#2b2347] flex items-start gap-3.5 shadow-xs">
              <div className="w-9 h-9 rounded-xl bg-purple-100 dark:bg-purple-950/60 border border-purple-200/60 dark:border-purple-800/60 flex items-center justify-center text-[#7c3aed] dark:text-purple-300 shrink-0 mt-0.5">
                <PhoneCall className="h-4 w-4" />
              </div>
              <div className="text-xs">
                <h3 className="font-bold text-[#150f26] dark:text-white text-sm">Real-Time Voice Studio</h3>
                <p className="text-[#625b7e] dark:text-[#a29bc2] mt-0.5 leading-relaxed">
                  Interactive mic playground with STT transcription, Gemini LLM intent routing, and Piper audio synthesis.
                </p>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-[#faf8fe] dark:bg-[#181329] border border-[#e6e0f5] dark:border-[#2b2347] flex items-start gap-3.5 shadow-xs">
              <div className="w-9 h-9 rounded-xl bg-purple-100 dark:bg-purple-950/60 border border-purple-200/60 dark:border-purple-800/60 flex items-center justify-center text-[#7c3aed] dark:text-purple-300 shrink-0 mt-0.5">
                <Calendar className="h-4 w-4" />
              </div>
              <div className="text-xs">
                <h3 className="font-bold text-[#150f26] dark:text-white text-sm">Doctor Shifts &amp; Pricing</h3>
                <p className="text-[#625b7e] dark:text-[#a29bc2] mt-0.5 leading-relaxed">
                  Update doctor consultation fees, slot durations (15-60 min), and active days with instant live sync.
                </p>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-[#faf8fe] dark:bg-[#181329] border border-[#e6e0f5] dark:border-[#2b2347] flex items-start gap-3.5 shadow-xs">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-200/60 dark:border-emerald-800/60 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div className="text-xs">
                <h3 className="font-bold text-[#150f26] dark:text-white text-sm">Multi-Tenant Isolation Guard</h3>
                <p className="text-[#625b7e] dark:text-[#a29bc2] mt-0.5 leading-relaxed">
                  PostgreSQL 16 tenant row security with encrypted credentials and strict HIPAA compliance.
                </p>
              </div>
            </div>
          </div>
        </div>

      </aside>

      {/* =========================================================================
          RIGHT SIDE: LOGIN FORM PANEL
          ========================================================================= */}
      <main className="flex-1 flex flex-col justify-between p-6 sm:p-10 lg:p-12 overflow-y-auto">
        {/* Top Controls: Back link */}
        <div className="w-full max-w-[460px] mx-auto flex items-center justify-start">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#625b7e] hover:text-[#150f26] dark:text-[#a29bc2] dark:hover:text-white transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to Home</span>
          </Link>
        </div>

        {/* Form Container */}
        <div className="w-full max-w-[460px] mx-auto my-auto py-8 bg-transparent">
          <div className="mb-6">
            <h1 className="font-['Bricolage_Grotesque',sans-serif] text-2xl sm:text-3xl font-bold tracking-tight text-[#150f26] dark:text-white">
              Sign In to Workspace
            </h1>
            <p className="mt-1.5 text-xs sm:text-sm text-[#625b7e] dark:text-[#a29bc2]">
              Enter your administrator credentials to access your hospital voice dispatch dashboard.
            </p>
          </div>

          {/* Backend Error Banner */}
          {generalError && (
            <div className="mb-5 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 p-4 text-xs text-red-700 dark:text-red-300 font-semibold flex items-center gap-3 animate-shake">
              <AlertCircle className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
              <span>{generalError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            {/* 1. Admin Email */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-[#625b7e] dark:text-[#a29bc2] uppercase tracking-wider">
                Administrator Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-3.5 h-4 w-4 text-[#625b7e] dark:text-[#a29bc2]" />
                <input
                  type="email"
                  placeholder="Enter administrator email address"
                  value={formData.email}
                  onChange={(e) => handleInputChange("email", e.target.value)}
                  className={`w-full h-11 pl-10 pr-3.5 rounded-xl border text-sm font-medium transition-all focus:outline-none bg-white dark:bg-[#120e1f] text-[#150f26] dark:text-white ${
                    fieldErrors.email
                      ? "border-red-500 focus:ring-2 focus:ring-red-200 dark:focus:ring-red-950/60"
                      : "border-[#e6e0f5] dark:border-[#2b2347] focus:border-[#7c3aed] focus:ring-2 focus:ring-purple-200/50 dark:focus:ring-purple-950/50"
                  }`}
                />
              </div>
              {fieldErrors.email && (
                <p className="text-xs text-red-500 font-medium pl-1">{fieldErrors.email}</p>
              )}
            </div>

            {/* 2. Password */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-[#625b7e] dark:text-[#a29bc2] uppercase tracking-wider">
                Account Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-3.5 h-4 w-4 text-[#625b7e] dark:text-[#a29bc2]" />
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your account password"
                  value={formData.password}
                  onChange={(e) => handleInputChange("password", e.target.value)}
                  className={`w-full h-11 pl-10 pr-11 rounded-xl border text-sm font-medium transition-all focus:outline-none bg-white dark:bg-[#120e1f] text-[#150f26] dark:text-white ${
                    fieldErrors.password
                      ? "border-red-500 focus:ring-2 focus:ring-red-200 dark:focus:ring-red-950/60"
                      : "border-[#e6e0f5] dark:border-[#2b2347] focus:border-[#7c3aed] focus:ring-2 focus:ring-purple-200/50 dark:focus:ring-purple-950/50"
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-3.5 text-[#625b7e] hover:text-[#150f26] dark:hover:text-white p-0.5 cursor-pointer"
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {fieldErrors.password && (
                <p className="text-xs text-red-500 font-medium pl-1">{fieldErrors.password}</p>
              )}
            </div>

            {/* Direct Submit Action */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-12 rounded-xl bg-gradient-to-r from-[#6d28d9] to-[#9333ea] text-white font-bold text-sm flex items-center justify-center gap-2 shadow-md shadow-purple-600/30 hover:brightness-105 active:scale-98 transition-all cursor-pointer disabled:opacity-50 mt-6"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Signing In...</span>
                </>
              ) : (
                <>
                  <span>Sign In to Dashboard</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          {/* Switch to Register Link */}
          <div className="mt-8 pt-6 border-t border-[#e6e0f5] dark:border-[#2b2347] text-center space-y-3">
            <p className="text-xs text-[#625b7e] dark:text-[#a29bc2]">
              Need to register a new clinic?{" "}
              <Link to="/register" className="font-bold text-[#7c3aed] dark:text-[#a78bfa] hover:underline">
                Create hospital workspace &rarr;
              </Link>
            </p>

            <div className="flex items-center justify-center gap-1.5 text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Multi-Tenant Architecture &bull; HIPAA Aligned &bull; Dedicated PostgreSQL Schema</span>
            </div>
          </div>
        </div>

      </main>

      {/* =========================================================================
          ANIMATED TOAST NOTIFICATION
          ========================================================================= */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-bounce">
          <div
            className={`flex items-center gap-2 px-5 py-3 rounded-2xl shadow-2xl text-xs sm:text-sm font-semibold border ${
              toast.type === "success"
                ? "bg-[#150f26] dark:bg-white text-white dark:text-[#150f26] border-emerald-500/50"
                : "bg-red-600 text-white border-red-700"
            }`}
          >
            {toast.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400 dark:text-emerald-600" />
            ) : (
              <AlertCircle className="h-4 w-4 text-white" />
            )}
            <span>{toast.message}</span>
          </div>
        </div>
      )}
    </div>
  );
};
