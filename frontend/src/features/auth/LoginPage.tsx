import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Mail,
  Lock,
  ArrowRight,
  Loader2,
  ShieldCheck,
  AlertCircle,
  Eye,
  EyeOff,
  ArrowLeft,
  PhoneCall,
  Sun,
  Moon,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import { AuthResponse } from "@/types/onboarding";
import { loginSchema } from "@/lib/validations/onboarding";

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { isDark, toggleTheme } = useTheme();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);
    setFieldErrors({});

    const validationResult = loginSchema.safeParse({ email, password });
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
      const response = await apiClient.post<AuthResponse>("/api/v1/auth/login", {
        email: validationResult.data.email,
        password: validationResult.data.password,
      });

      login(response);
      navigate("/hospital");
    } catch (err: unknown) {
      console.error("Login failed:", err);
      if (err instanceof Error) {
        setGeneralError(err.message);
      } else {
        setGeneralError("Invalid email or password. Please verify your credentials.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f7f5ff] dark:bg-[#07050d] text-[#150f26] dark:text-[#f6f3ff] flex flex-col justify-between py-8 px-4 sm:px-6 lg:px-8 font-['Figtree',system-ui,sans-serif] antialiased transition-colors">
      {/* Top Bar with Home Link and Theme Toggle */}
      <header className="max-w-md mx-auto w-full flex items-center justify-between mb-6">
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

      {/* Main Login Card */}
      <main className="max-w-md mx-auto w-full my-auto">
        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center p-3.5 rounded-[16px] bg-gradient-to-br from-[#6d28d9] to-[#9333ea] text-white shadow-[0_10px_24px_-10px_#6d28d9] mb-4">
            <PhoneCall className="h-6 w-6" />
          </div>
          <h1 className="font-['Bricolage_Grotesque',sans-serif] text-2xl sm:text-3xl font-bold tracking-tight text-[#150f26] dark:text-white">
            Sign In to Workspace
          </h1>
          <p className="mt-1.5 text-xs sm:text-sm text-[#625b7e] dark:text-[#a29bc2]">
            Hospital Voice Agent &bull; Autonomous Clinical Outbound Engine
          </p>
        </div>

        <div className="bg-white dark:bg-[#120e1f] py-8 px-6 sm:px-8 rounded-[22px] border border-[#e6e0f5] dark:border-[#2b2347] shadow-[0_12px_30px_-18px_rgba(76,29,149,0.4)] dark:shadow-[0_14px_34px_-18px_rgba(0,0,0,0.8)] space-y-6">
          {generalError && (
            <div className="rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 p-3.5 text-xs text-red-700 dark:text-red-300 font-semibold flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
              <span>{generalError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email Field */}
            <div>
              <label
                htmlFor="login-email"
                className="block text-xs font-bold text-[#625b7e] dark:text-[#a29bc2] uppercase tracking-wider mb-1.5"
              >
                Admin / Doctor Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-3.5 h-4 w-4 text-[#625b7e] dark:text-[#a29bc2] pointer-events-none" />
                <input
                  id="login-email"
                  type="email"
                  required
                  placeholder="admin@hospital.org"
                  className={`w-full h-11 pl-10 pr-3.5 rounded-xl border text-sm font-medium transition-all focus:outline-none bg-[#f3f0fb] dark:bg-[#1a1530] text-[#150f26] dark:text-white placeholder:text-[#625b7e] ${
                    fieldErrors.email
                      ? "border-red-400 focus:ring-2 focus:ring-red-100"
                      : "border-[#e6e0f5] dark:border-[#2b2347] focus:border-[#7c3aed]"
                  }`}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              {fieldErrors.email && (
                <p className="text-xs text-red-600 dark:text-red-400 font-medium mt-1 pl-1">
                  {fieldErrors.email}
                </p>
              )}
            </div>

            {/* Password Field */}
            <div>
              <label
                htmlFor="login-password"
                className="block text-xs font-bold text-[#625b7e] dark:text-[#a29bc2] uppercase tracking-wider mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-3.5 h-4 w-4 text-[#625b7e] dark:text-[#a29bc2] pointer-events-none" />
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="Enter your password"
                  className={`w-full h-11 pl-10 pr-11 rounded-xl border text-sm font-medium transition-all focus:outline-none bg-[#f3f0fb] dark:bg-[#1a1530] text-[#150f26] dark:text-white placeholder:text-[#625b7e] ${
                    fieldErrors.password
                      ? "border-red-400 focus:ring-2 focus:ring-red-100"
                      : "border-[#e6e0f5] dark:border-[#2b2347] focus:border-[#7c3aed]"
                  }`}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-3.5 text-[#625b7e] hover:text-[#150f26] dark:hover:text-white p-0.5 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {fieldErrors.password && (
                <p className="text-xs text-red-600 dark:text-red-400 font-medium mt-1 pl-1">
                  {fieldErrors.password}
                </p>
              )}
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-11 rounded-xl bg-gradient-to-r from-[#6d28d9] to-[#9333ea] text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-md shadow-purple-600/30 hover:brightness-105 active:scale-95 transition-all cursor-pointer disabled:opacity-50 mt-5"
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

          {/* Register Prompt */}
          <div className="pt-4 border-t border-[#e6e0f5] dark:border-[#2b2347] text-center space-y-3">
            <p className="text-xs text-[#625b7e] dark:text-[#a29bc2]">
              New Hospital or Clinic?{" "}
              <Link
                to="/register"
                className="font-bold text-[#7c3aed] dark:text-[#a78bfa] hover:underline inline-flex items-center gap-1"
              >
                Register Hospital Workspace &rarr;
              </Link>
            </p>

            <div className="flex items-center justify-center gap-1.5 text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Multi-Tenant Enterprise Security &bull; End-to-End Encrypted</span>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center text-xs text-[#625b7e] dark:text-[#a29bc2] mt-6">
        Hospital Voice Agent &bull; Autonomous Clinical Outbound Engine &bull; Workspace Edition
      </footer>
    </div>
  );
};
