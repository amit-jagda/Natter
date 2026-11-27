import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Step1Register } from "./Step1Register";
import { Step2Profile } from "./Step2Profile";
import { Step3Doctors } from "./Step3Doctors";
import { Step4Completed } from "./Step4Completed";
import { useAuth } from "@/lib/auth-context";
import { AuthResponse, TenantData } from "@/types/onboarding";
import { ArrowLeft, Loader2, Phone, Check } from "lucide-react";

export const OnboardingCanvas: React.FC = () => {
  const { user, tenant, setTenant, logout, isAuthenticated, isLoading: authLoading } = useAuth();
  const [currentStep, setCurrentStep] = useState<number>(1);

  // Sync step with tenant onboarding progress
  useEffect(() => {
    if (tenant) {
      if (tenant.onboarding_status === "COMPLETED") {
        setCurrentStep(4);
      } else if (tenant.onboarding_step && tenant.onboarding_step >= 2) {
        setCurrentStep(tenant.onboarding_step);
      } else {
        setCurrentStep(2);
      }
    } else {
      setCurrentStep(1);
    }
  }, [tenant]);

  const handleStep1Success = (auth: AuthResponse) => {
    setTenant(auth.tenant);
    setCurrentStep(2);
  };

  const handleStep2Success = (updatedTenant: TenantData) => {
    setTenant(updatedTenant);
    setCurrentStep(3);
  };

  const handleStep3Success = () => {
    setCurrentStep(4);
  };

  const handleLogout = () => {
    logout();
    setCurrentStep(1);
  };

  const steps = [
    { num: 1, label: "Hospital" },
    { num: 2, label: "Profile" },
    { num: 3, label: "Doctors" },
    { num: 4, label: "Ready" },
  ];

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center app-product-bg">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
          <p className="text-sm font-medium text-slate-500">Loading Hospital Workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[42%_58%] min-h-screen font-sans antialiased bg-white text-slate-900">
      {/* =========================================================================
          LEFT PANEL: EXACT NATTER BLUEPRINT (Clean Hero without simulator card)
          ========================================================================= */}
      <aside className="relative overflow-hidden bg-[#070c1c] text-[#e2e8f0] p-8 sm:p-10 lg:p-12 flex flex-col justify-between hidden lg:flex select-none">
        {/* Ambient Gradient Glowing Orbs */}
        <div className="absolute -top-28 -left-24 w-[380px] h-[380px] rounded-full bg-[#2563eb] blur-[70px] opacity-55 pointer-events-none animate-pulse" />
        <div className="absolute -bottom-24 -right-20 w-[320px] h-[320px] rounded-full bg-[#7c3aed] blur-[70px] opacity-55 pointer-events-none" />

        {/* Brand Header */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-[42px] h-[42px] rounded-[11px] bg-[#2563eb] grid place-items-center text-white shadow-lg shadow-blue-600/40">
            <Phone className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-[19px] text-white tracking-tight">Hospital Voice Agent</span>
            </div>
            <div className="text-[12px] text-slate-400 mt-0.5 font-medium">
              Healthcare Outbound Voice Infrastructure
            </div>
          </div>
        </div>

        {/* Center Pitch */}
        <div className="relative z-10 my-auto py-10">
          <h1 className="text-[38px] xl:text-[44px] font-extrabold leading-[1.08] tracking-[-0.03em] text-white mb-4">
            Automate Doctor Appointments Over Voice.
          </h1>
          <p className="text-[#a5b4cc] text-[15px] leading-[1.65] max-w-[460px] m-0">
            Onboard your clinic in 3 simple steps. Connect your medical staff roster, configure weekly
            shifts, and let conversational AI handle scheduling in Hinglish, Hindi and English.
          </p>
        </div>

        {/* Feature Strip */}
        <div className="relative z-10 flex gap-6 text-[12px] text-slate-400 font-medium">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Instant calendar sync
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Hinglish &amp; Hindi native
          </span>
        </div>
      </aside>

      {/* =========================================================================
          RIGHT PANEL: CLEAN FORM WORKSPACE
          ========================================================================= */}
      <main className="flex flex-col justify-between p-6 sm:px-14 sm:py-8 min-w-0 app-product-bg">
        {/* Top Header Bar */}
        <div className="bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] rounded-2xl sm:rounded-3xl p-3.5 sm:px-5 shadow-[0_4px_20px_-4px_rgba(21,15,38,0.06)] flex justify-between items-center text-slate-500 dark:text-slate-400 text-[13px] mb-6">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-slate-700 font-medium hover:text-slate-900 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> &larr; Back to home
          </Link>

          <div>
            {isAuthenticated ? (
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-900">{tenant?.name || user?.full_name}</span>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="text-red-600 font-semibold hover:underline text-xs ml-2 cursor-pointer"
                >
                  Logout
                </button>
              </div>
            ) : (
              <span>
                Already registered?{" "}
                <Link to="/login" className="text-slate-900 font-semibold hover:underline">
                  Sign in
                </Link>
              </span>
            )}
          </div>
        </div>

        {/* Stepper with Connecting Lines (as in Natter HTML) */}
        <div className="my-8 mb-6">
          <div className="flex items-center">
            {steps.map((st, idx) => {
              const isActive = currentStep === st.num;
              const isCompleted = currentStep > st.num;
              return (
                <React.Fragment key={st.num}>
                  <div
                    onClick={() => isCompleted && setCurrentStep(st.num)}
                    className={`flex items-center gap-2 text-[13px] font-medium transition-all ${
                      isCompleted ? "cursor-pointer" : ""
                    } ${
                      isActive
                        ? "text-slate-900 font-bold"
                        : isCompleted
                        ? "text-slate-700 font-semibold"
                        : "text-slate-400"
                    }`}
                  >
                    <div
                      className={`w-[30px] h-[30px] rounded-full border-[1.5px] grid place-items-center text-xs font-semibold transition-all relative ${
                        isActive
                          ? "bg-blue-600 border-blue-600 text-white shadow-[0_0_0_5px_rgba(37,99,235,0.18)] scale-105"
                          : isCompleted
                          ? "bg-green-600 border-green-600 text-white"
                          : "border-slate-200 text-slate-400 bg-white"
                      }`}
                    >
                      {isCompleted ? <Check className="h-3.5 w-3.5 stroke-[3]" /> : st.num}
                    </div>
                    <span className="hidden sm:inline">{st.label}</span>
                  </div>

                  {idx < steps.length - 1 && (
                    <div className="flex-1 h-[2px] bg-slate-200 mx-3 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-500 bg-green-600 ${
                          currentStep > st.num ? "w-full" : "w-0"
                        }`}
                      />
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Form Container */}
        <div className="flex-1 flex items-center justify-center my-auto py-2">
          {currentStep === 1 && <Step1Register onSuccess={handleStep1Success} />}

          {currentStep === 2 && tenant && (
            <Step2Profile
              tenant={tenant}
              onSuccess={handleStep2Success}
              onSkip={() => setCurrentStep(3)}
              onBack={() => setCurrentStep(1)}
            />
          )}

          {currentStep === 3 && (
            <Step3Doctors
              onSuccess={handleStep3Success}
              onSkip={() => setCurrentStep(4)}
              onBack={() => setCurrentStep(2)}
            />
          )}

          {currentStep === 4 && tenant && (
            <Step4Completed
              tenant={tenant}
              onRestart={() => setCurrentStep(1)}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-col sm:flex-row justify-between text-[12px] text-slate-400 border-t border-slate-200 pt-4 mt-6 gap-2">
          <span>Enterprise Healthcare AI · Encrypted multi-tenant DB</span>
          <div className="flex gap-4">
            <span className="hover:text-slate-600 cursor-pointer">Privacy &amp; Terms</span>
            <span className="hover:text-slate-600 cursor-pointer">Support</span>
          </div>
        </div>
      </main>
    </div>
  );
};
