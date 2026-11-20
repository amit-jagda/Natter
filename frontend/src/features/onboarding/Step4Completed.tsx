import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircle2,
  Building2,
  Stethoscope,
  Clock,
  PhoneCall,
  ArrowRight,
  Layers,
  ShieldCheck,
  CalendarCheck,
  Globe,
  Copy,
  Check,
} from "lucide-react";
import { TenantData } from "@/types/onboarding";

interface Props {
  tenant: TenantData;
  onRestart?: () => void;
}

export const Step4Completed: React.FC<Props> = ({ tenant, onRestart }) => {
  const [copied, setCopied] = useState(false);

  const copyUrl = () => {
    navigator.clipboard.writeText(`https://app.natter.ai/${tenant.slug}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full max-w-[520px] mx-auto text-center space-y-6 py-2">
      {/* Animated Floating Green Checkmark Icon (as in Natter HTML) */}
      <div className="relative mx-auto flex h-20 w-20 items-center justify-center">
        <div className="absolute inset-0 rounded-full bg-green-100 animate-ping opacity-30" />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-lg shadow-green-500/25">
          <CheckCircle2 className="h-9 w-9 stroke-[2.2]" />
        </div>
      </div>

      {/* Heading */}
      <div>
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-50 border border-green-200 text-green-700 font-semibold text-[12.5px] mb-3">
          ✦ Step 4 of 4 · Ready
        </span>
        <h2 className="text-[30px] sm:text-[34px] font-extrabold tracking-[-0.03em] text-slate-900 mt-2 mb-1.5 leading-tight">
          {tenant.name} is Ready!
        </h2>
        <p className="text-slate-500 text-[14px] leading-relaxed max-w-md mx-auto">
          Your hospital workspace, 7-day operating hours, and medical staff roster are fully
          configured. The AI Voice Agent can now answer patient calls and book appointments.
        </p>
      </div>

      {/* Dedicated Portal URL Card */}
      <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs text-slate-600">
        <div className="flex items-center gap-2 font-mono">
          <Globe className="h-4 w-4 text-blue-600 shrink-0" />
          <span className="text-slate-400">Hospital Portal:</span>
          <span className="font-bold text-slate-900">app.natter.ai/{tenant.slug}</span>
        </div>
        <button
          type="button"
          onClick={copyUrl}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-200 transition-colors"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-green-600" />
              <span className="text-green-600">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3 text-slate-400" />
              <span>Copy Link</span>
            </>
          )}
        </button>
      </div>

      {/* 3 Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left pt-1">
        <div className="p-3.5 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-all shadow-xs">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <Building2 className="h-3.5 w-3.5 text-blue-600" /> Profile
          </div>
          <div className="mt-1.5 text-sm font-bold text-slate-900 truncate">
            {tenant.phone_number || tenant.name}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            TZ: {tenant.timezone || "Asia/Kolkata"}
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-all shadow-xs">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <Clock className="h-3.5 w-3.5 text-blue-600" /> Timings
          </div>
          <div className="mt-1.5 text-sm font-bold text-green-600">
            Active 7-Day
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Auto-checks shifts
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-all shadow-xs">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <Stethoscope className="h-3.5 w-3.5 text-blue-600" /> Medical Roster
          </div>
          <div className="mt-1.5 text-sm font-bold text-slate-900">
            Live Booking
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Double-booking guard
          </div>
        </div>
      </div>

      {/* Feature Bullet Strip */}
      <div className="rounded-xl border border-green-200/80 bg-green-50/50 p-3 flex items-center justify-around text-xs text-green-800 font-medium">
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="h-4 w-4 text-green-600" /> Multi-Tenant Encrypted
        </span>
        <span className="flex items-center gap-1.5">
          <CalendarCheck className="h-4 w-4 text-green-600" /> Instant Calendar Sync
        </span>
      </div>

      {/* Action Buttons */}
      <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
        <Link to="/hospital" className="w-full sm:w-auto">
          <button
            type="button"
            className="w-full sm:w-auto h-[48px] px-6 rounded-xl bg-gradient-to-r from-[#2563eb] to-[#4f46e5] text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-[0_10px_24px_-8px_rgba(37,99,235,0.6)] hover:shadow-[0_16px_30px_-10px_rgba(37,99,235,0.7)] hover:-translate-y-0.5 active:translate-y-0 transition-all cursor-pointer"
          >
            <Layers className="h-4 w-4" />
            Open Hospital Dashboard
          </button>
        </Link>

        <Link to="/playground" className="w-full sm:w-auto">
          <button
            type="button"
            className="w-full sm:w-auto h-[48px] px-6 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 font-semibold text-sm text-slate-700 flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer"
          >
            <PhoneCall className="h-4 w-4 text-blue-600" />
            Test Voice AI Agent
            <ArrowRight className="h-4 w-4" />
          </button>
        </Link>
      </div>

      {onRestart && (
        <div className="pt-2">
          <button
            type="button"
            onClick={onRestart}
            className="text-xs text-slate-400 hover:text-slate-600 hover:underline transition-colors"
          >
            Revisit setup steps &rarr;
          </button>
        </div>
      )}
    </div>
  );
};
