import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { HealthStatusResponse } from "@/types/api";
import {
  Server,
  Database,
  Cpu,
  PhoneForwarded,
  ShieldCheck,
  CheckCircle2,
  Layers,
  Mic,
  ArrowRight,
  PhoneCall,
  LayoutDashboard,
  Sparkles,
} from "lucide-react";

export const HomePage: React.FC = () => {
  const { data: health, isLoading } = useQuery<HealthStatusResponse>({
    queryKey: ["health"],
    queryFn: () => apiClient.get<HealthStatusResponse>("/api/v1/health"),
    refetchInterval: 10000,
  });

  return (
    <div className="container mx-auto max-w-6xl px-4 py-12 sm:px-8 font-['Figtree',system-ui,sans-serif] antialiased text-[#150f26] dark:text-[#f6f3ff] transition-colors">
      {/* Hero Section */}
      <div className="mb-14 text-center max-w-3xl mx-auto relative">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#f3f0fb] dark:bg-[#1a1530] border border-[#e6e0f5] dark:border-[#2b2347] shadow-xs mb-6">
          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#6d28d9] to-[#9333ea] flex items-center justify-center text-white text-[10px] font-bold">
            <PhoneCall className="h-3 w-3" />
          </div>
          <span className="text-xs font-bold text-[#7c3aed] dark:text-[#a78bfa] tracking-wide">Hospital Voice Agent</span>
          <span className="text-[10px] text-[#625b7e] dark:text-[#a29bc2] font-mono font-semibold">&bull; Workspace Edition</span>
        </div>

        <h1 className="font-['Bricolage_Grotesque',sans-serif] text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-[#150f26] dark:text-white leading-[1.12]">
          Autonomous Voice Intelligence for Modern Hospitals
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-sm sm:text-base text-[#625b7e] dark:text-[#a29bc2] leading-relaxed">
          Production-grade conversational AI architecture for automated outbound and inbound patient calls
          in Hinglish, Hindi, and English with real-time doctor appointment scheduling.
        </p>

        <div className="mt-8 flex flex-wrap justify-center items-center gap-3">
          <Link to="/hospital">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl px-6 py-3 text-xs font-semibold text-white bg-gradient-to-r from-[#6d28d9] to-[#9333ea] shadow-md shadow-purple-600/30 hover:brightness-105 active:scale-95 transition-all cursor-pointer"
            >
              <LayoutDashboard className="h-4 w-4" />
              <span>Open Hospital Workspace</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </Link>

          <Link to="/hospital?tab=voice">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl px-6 py-3 text-xs font-semibold text-[#150f26] dark:text-white border border-[#e6e0f5] dark:border-[#2b2347] bg-white dark:bg-[#120e1f] hover:bg-purple-50 dark:hover:bg-purple-950/40 shadow-xs transition-all cursor-pointer"
            >
              <Mic className="h-4 w-4 text-[#7c3aed]" />
              <span>Test Voice AI</span>
            </button>
          </Link>

          <Link to="/register">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-xs font-semibold text-[#625b7e] dark:text-[#a29bc2] hover:text-[#150f26] dark:hover:text-white transition-colors cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5 text-[#7c3aed]" />
              <span>Register New Hospital &rarr;</span>
            </button>
          </Link>
        </div>
      </div>

      {/* Live System Diagnostics */}
      <div className="mb-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {/* Core API Service */}
        <div className="p-5 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-[0_12px_30px_-18px_rgba(76,29,149,0.4)] dark:shadow-[0_14px_34px_-18px_rgba(0,0,0,0.8)] hover:border-[#7c3aed] transition-all">
          <div className="flex items-center justify-between pb-3">
            <span className="text-[11px] font-mono uppercase tracking-wider text-[#625b7e] dark:text-[#a29bc2] font-semibold">
              Core API Service
            </span>
            <div className="p-2 rounded-xl bg-purple-100/60 dark:bg-purple-950/60 text-[#7c3aed]">
              <Server className="h-4 w-4" />
            </div>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="font-['Bricolage_Grotesque',sans-serif] text-xl font-bold text-[#150f26] dark:text-white">
              FastAPI Monolith
            </span>
            {isLoading ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-[#625b7e]">
                Checking...
              </span>
            ) : health?.status === "healthy" ? (
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#d1fae5] dark:bg-[rgba(16,185,129,0.16)] text-[#059669] dark:text-[#34d399] flex items-center gap-1 font-mono">
                <CheckCircle2 className="h-3 w-3" /> Online
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 dark:bg-red-950/60 text-red-600 font-mono">
                Degraded
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-[#625b7e] dark:text-[#a29bc2]">
            Async runtime with Pydantic validation, JWT RBAC security, and multi-tenant isolation.
          </p>
        </div>

        {/* Database Layer */}
        <div className="p-5 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-[0_12px_30px_-18px_rgba(76,29,149,0.4)] dark:shadow-[0_14px_34px_-18px_rgba(0,0,0,0.8)] hover:border-[#7c3aed] transition-all">
          <div className="flex items-center justify-between pb-3">
            <span className="text-[11px] font-mono uppercase tracking-wider text-[#625b7e] dark:text-[#a29bc2] font-semibold">
              Data Tier
            </span>
            <div className="p-2 rounded-xl bg-emerald-100/60 dark:bg-emerald-950/60 text-emerald-600">
              <Database className="h-4 w-4" />
            </div>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="font-['Bricolage_Grotesque',sans-serif] text-xl font-bold text-[#150f26] dark:text-white">
              PostgreSQL 16
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#d1fae5] dark:bg-[rgba(16,185,129,0.16)] text-[#059669] dark:text-[#34d399] flex items-center gap-1 font-mono">
              <CheckCircle2 className="h-3 w-3" /> Port 5433
            </span>
          </div>
          <p className="mt-2 text-xs text-[#625b7e] dark:text-[#a29bc2]">
            6 normalized relational tables: tenants, users, operating hours, doctors &amp; availabilities.
          </p>
        </div>

        {/* Task Queue Layer */}
        <div className="p-5 rounded-[20px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-[0_12px_30px_-18px_rgba(76,29,149,0.4)] dark:shadow-[0_14px_34px_-18px_rgba(0,0,0,0.8)] hover:border-[#7c3aed] transition-all sm:col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between pb-3">
            <span className="text-[11px] font-mono uppercase tracking-wider text-[#625b7e] dark:text-[#a29bc2] font-semibold">
              Call Task Queue
            </span>
            <div className="p-2 rounded-xl bg-indigo-100/60 dark:bg-indigo-950/60 text-indigo-600">
              <Cpu className="h-4 w-4" />
            </div>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="font-['Bricolage_Grotesque',sans-serif] text-xl font-bold text-[#150f26] dark:text-white">
              Redis 7 + Arq
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#d1fae5] dark:bg-[rgba(16,185,129,0.16)] text-[#059669] dark:text-[#34d399] flex items-center gap-1 font-mono">
              <CheckCircle2 className="h-3 w-3" /> Ready
            </span>
          </div>
          <p className="mt-2 text-xs text-[#625b7e] dark:text-[#a29bc2]">
            Low-latency distributed task queue for scheduling and retrying automated patient calls.
          </p>
        </div>
      </div>

      {/* Feature Highlights Grid */}
      <div className="mb-14 rounded-[22px] border border-[#e6e0f5] dark:border-[#2b2347] bg-white dark:bg-[#120e1f] p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-[#6d28d9] to-[#9333ea] text-white shadow-sm">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-['Bricolage_Grotesque',sans-serif] text-base font-bold text-[#150f26] dark:text-white">
              Hospital Workspace Architecture
            </h3>
            <p className="text-xs text-[#625b7e] dark:text-[#a29bc2]">
              Multi-tenant clinical platform engineered for sub-800ms conversational turn latency.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          <div className="rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-xs text-[#150f26] dark:text-white">
                <PhoneForwarded className="h-4 w-4 text-[#7c3aed]" />
                <span>Voice AI Engine &amp; Call Telephony</span>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-purple-100 dark:bg-purple-950/60 text-[#7c3aed] dark:text-purple-300 border border-[#e6e0f5] dark:border-[#2b2347]">
                Sub-800ms
              </span>
            </div>
            <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] leading-relaxed">
              Real-time streaming pipeline combining speech recognition, sentence chunking, thought scrubber,
              and low-latency neural TTS with natural Hinglish, Hindi, and English support.
            </p>
          </div>

          <div className="rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-xs text-[#150f26] dark:text-white">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                <span>Clinical Shifts &amp; Double-Booking Guard</span>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-[#d1fae5] dark:bg-[rgba(16,185,129,0.16)] text-[#059669] dark:text-[#34d399] border border-[#e6e0f5] dark:border-[#2b2347]">
                Zero Collision
              </span>
            </div>
            <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] leading-relaxed">
              Dynamic 7-day hospital operating hours, doctor weekly consultation shifts, customizable slot durations
              (15 to 60 mins), and transactional appointment locks.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
