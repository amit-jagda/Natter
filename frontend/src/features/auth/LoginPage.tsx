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
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { AuthResponse } from "@/types/onboarding";
import { loginSchema } from "@/lib/validations/onboarding";

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { login } = useAuth();

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

      if (response.tenant.onboarding_status === "COMPLETED") {
        navigate("/hospital");
      } else {
        navigate("/onboarding");
      }
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
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 font-sans antialiased text-slate-900">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        {/* Back Link */}
        <div className="mb-6">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>&larr; Back to Home</span>
          </Link>
        </div>

        {/* Brand */}
        <div className="flex items-center gap-3 justify-center mb-6">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white shadow-md shadow-blue-600/20">
            <PhoneCall className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xl font-extrabold tracking-tight text-slate-900">Hospital Voice Agent</span>
            </div>
            <p className="text-xs text-slate-500 font-medium">Healthcare Outbound Voice Platform</p>
          </div>
        </div>

        <h2 className="text-center text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
          Sign In to Hospital Portal
        </h2>
        <p className="mt-1 text-center text-xs text-slate-500">
          Manage your hospital shifts, doctor rosters, and live AI voice appointments.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-6 sm:px-10 shadow-xl shadow-slate-200/50 rounded-2xl border border-slate-200 space-y-6">
          {generalError && (
            <div className="rounded-xl bg-red-50 border border-red-200 p-3.5 text-xs text-red-700 font-medium flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{generalError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email Field with Floating Label */}
            <div className="relative">
              <Mail className="absolute left-3.5 top-[18px] h-5 w-5 text-slate-400 pointer-events-none" />
              <input
                id="login-email"
                type="email"
                required
                placeholder=" "
                className={`peer w-full h-14 border-[1.5px] rounded-xl bg-white text-slate-900 px-11 pt-4 pb-0 text-sm font-medium transition-all focus:outline-none ${fieldErrors.email
                  ? "border-red-400 focus:ring-4 focus:ring-red-100"
                  : "border-slate-200 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/15"
                  }`}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <label
                htmlFor="login-email"
                className="absolute left-11 top-[18px] text-slate-400 text-sm pointer-events-none transition-all peer-focus:top-2 peer-focus:text-[11px] peer-focus:font-semibold peer-focus:text-blue-600 peer-[:not(:placeholder-shown)]:top-2 peer-[:not(:placeholder-shown)]:text-[11px] peer-[:not(:placeholder-shown)]:font-semibold peer-[:not(:placeholder-shown)]:text-slate-500"
              >
                Admin / Doctor Email
              </label>
              {fieldErrors.email && (
                <p className="text-xs text-red-600 font-medium mt-1 pl-1">{fieldErrors.email}</p>
              )}
            </div>

            {/* Password Field with Floating Label & Eye */}
            <div className="relative">
              <Lock className="absolute left-3.5 top-[18px] h-5 w-5 text-slate-400 pointer-events-none" />
              <input
                id="login-password"
                type={showPassword ? "text" : "password"}
                required
                placeholder=" "
                className={`peer w-full h-14 border-[1.5px] rounded-xl bg-white text-slate-900 px-11 pr-11 pt-4 pb-0 text-sm font-medium transition-all focus:outline-none ${fieldErrors.password
                  ? "border-red-400 focus:ring-4 focus:ring-red-100"
                  : "border-slate-200 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/15"
                  }`}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <label
                htmlFor="login-password"
                className="absolute left-11 top-[18px] text-slate-400 text-sm pointer-events-none transition-all peer-focus:top-2 peer-focus:text-[11px] peer-focus:font-semibold peer-focus:text-blue-600 peer-[:not(:placeholder-shown)]:top-2 peer-[:not(:placeholder-shown)]:text-[11px] peer-[:not(:placeholder-shown)]:font-semibold peer-[:not(:placeholder-shown)]:text-slate-500"
              >
                Password
              </label>
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-[18px] text-slate-400 hover:text-slate-600 p-0.5"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
              {fieldErrors.password && (
                <p className="text-xs text-red-600 font-medium mt-1 pl-1">{fieldErrors.password}</p>
              )}
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-[52px] rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-[0_10px_24px_-8px_rgba(37,99,235,0.6)] hover:shadow-[0_16px_30px_-10px_rgba(37,99,235,0.7)] hover:-translate-y-0.5 active:translate-y-0 transition-all cursor-pointer disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Signing In...</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          {/* Register Prompt */}
          <div className="pt-4 border-t border-slate-100 text-center space-y-3">
            <p className="text-xs text-slate-500">
              New Hospital or Clinic?{" "}
              <Link
                to="/onboarding"
                className="font-bold text-blue-600 hover:underline inline-flex items-center gap-1"
              >
                Register Hospital Workspace <ArrowRight className="h-3 w-3" />
              </Link>
            </p>

            <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5 text-green-600" />
              <span>Multi-Tenant Enterprise Security &bull; End-to-End Encrypted</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
