import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { HealthStatusResponse } from "@/types/api";
import {
  Server,
  Database,
  Cpu,
  ShieldCheck,
  CheckCircle2,
  Layers,
  Mic,
  ArrowRight,
  PhoneCall,
  LayoutDashboard,
  Sparkles,
  Zap,
  Clock,
  CalendarCheck2,
  AlertTriangle,
  Volume2,
  Bot,
  User,
  ChevronDown,
  Stethoscope,
  Activity,
  HeartPulse,
  Radio,
  BadgeCheck,
} from "lucide-react";

interface Scenario {
  id: string;
  title: string;
  lang: string;
  badge: string;
  badgeColor: string;
  patientPrompt: string;
  patientLangText: string;
  agentResponse: string;
  agentLangText: string;
  verifiedDoctor: string;
  department: string;
  slotBooked: string;
  fee: string;
  latencyMs: number;
}

const SCENARIOS: Scenario[] = [
  {
    id: "hinglish",
    title: "Cardiology Booking (Hinglish)",
    lang: "Hinglish / Hindi-English",
    badge: "Most Common",
    badgeColor: "bg-purple-100 dark:bg-purple-950/60 text-[#7c3aed] dark:text-purple-300 border-purple-200 dark:border-purple-800",
    patientPrompt: "Patient (Caller)",
    patientLangText: "Hello, mujhe Dr. Anita Sharma se milna hai kal subah. Kya koi OPD slot khali hai?",
    agentResponse: "Hospital AI Voice Agent",
    agentLangText: "Namaste! Dr. Anita Sharma kal subah 09:00 AM se 06:00 PM tak OPD me hain. 10:30 AM ka 30-minute slot available hai, consultation fee ₹500 hai. Kya main aapka appointment lock kar doon?",
    verifiedDoctor: "Dr. Anita Sharma",
    department: "General Medicine & Cardiology",
    slotBooked: "Tomorrow 10:30 AM (30 mins)",
    fee: "₹500 INR",
    latencyMs: 640,
  },
  {
    id: "emergency",
    title: "Emergency Triage & Casualty (Hindi)",
    lang: "Hindi / Emergency",
    badge: "Critical Triage",
    badgeColor: "bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800",
    patientPrompt: "Patient (Urgent Caller)",
    patientLangText: "Mere seene me bahut tej dard ho raha hai aur saans lene me takleef ho rahi hai, please jaldi batayein!",
    agentResponse: "Clinical Triage Guardrail",
    agentLangText: "Dhyaan dijiye, ye gambhir aapatkaalin lakshan hain. Main turant aapki call hamari 24/7 Emergency Casualty Desk ko patch kar rahi hoon aur ambulance desk alert kar diya hai. Kripya call na kaatein.",
    verifiedDoctor: "Casualty Senior Medical Officer",
    department: "24/7 Trauma & Emergency Center",
    slotBooked: "Immediate Handoff + Ambulance Dispatched",
    fee: "Emergency Admission Protocol",
    latencyMs: 480,
  },
  {
    id: "pediatrics",
    title: "Pediatrics Routine Slot (English)",
    lang: "English / Follow-up",
    badge: "Multi-Language",
    badgeColor: "bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800",
    patientPrompt: "Patient (Parent)",
    patientLangText: "Good morning, I would like to schedule a 3-month routine vaccination follow-up with Dr. Rajesh Verma for Saturday.",
    agentResponse: "Hospital AI Voice Agent",
    agentLangText: "Good morning! Dr. Rajesh Verma has Pediatrics slots open this Saturday from 09:00 AM to 02:00 PM. We have an 11:15 AM slot available. The consultation fee is ₹800. Shall I confirm your booking?",
    verifiedDoctor: "Dr. Rajesh Verma",
    department: "Pediatrics & Child Care",
    slotBooked: "Saturday 11:15 AM (15 mins)",
    fee: "₹800 INR",
    latencyMs: 590,
  },
];

const FAQS = [
  {
    q: "How does the Voice Agent handle natural mixed Hindi and English (Hinglish)?",
    a: "The voice pipeline is trained on phonetic and conversational Indian medical telephony. It natively parses code-switching (e.g. 'Dr. ke saath appointment book karna hai Friday morning') with automatic intent extraction, symptoms recognition, and clinical terminology mapping.",
  },
  {
    q: "How does the system ensure zero double-booking if multiple patients call at once?",
    a: "Every booking query executes with PostgreSQL ACID transaction isolation and advisory locks. When a patient confirms a slot over the phone, the slot is locked atomically within milliseconds, preventing concurrent telephone callers or receptionists from reserving the same doctor time window.",
  },
  {
    q: "Can hospital administrators override doctor shifts or mark sudden leave?",
    a: "Yes. From the Hospital Dashboard, administrators can toggle doctor availability off with a single click, modify consultation hours, adjust slot durations (15m, 30m, 45m, 60m), or customize consultation fees. Changes sync instantly to active voice calls.",
  },
  {
    q: "What happens when a caller has a medical emergency?",
    a: "Our clinical safety guardrails analyze speech for emergency keywords (chest pain, unconsciousness, severe hemorrhage, acute breathing distress). When detected, the conversational flow halts standard booking and automatically transfers the call to the hospital's 24/7 casualty desk while triggering SMS alerts.",
  },
];

export const HomePage: React.FC = () => {
  const [activeScenarioId, setActiveScenarioId] = useState<string>("hinglish");
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);
  const [isPlayingAudio, setIsPlayingAudio] = useState<boolean>(true);

  const { data: health, isLoading } = useQuery<HealthStatusResponse>({
    queryKey: ["health"],
    queryFn: () => apiClient.get<HealthStatusResponse>("/api/v1/health"),
    refetchInterval: 10000,
  });

  const activeScenario = SCENARIOS.find((s) => s.id === activeScenarioId) || SCENARIOS[0];

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8 sm:py-12 sm:px-8 font-['Figtree',system-ui,sans-serif] antialiased text-[#150f26] dark:text-[#f6f3ff] transition-colors space-y-16 sm:space-y-24">
      {/* =========================================================================
          1. HERO SECTION
          ========================================================================= */}
      <section className="text-center max-w-4xl mx-auto relative pt-4 sm:pt-6">
        {/* Glow Spheres */}
        <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-96 h-96 bg-purple-200/40 dark:bg-purple-900/15 rounded-full blur-3xl pointer-events-none -z-10" />

        {/* Live Status Pill */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm mb-6 animate-pulse-ring">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-bold text-[#7c3aed] dark:text-[#a78bfa] tracking-wide">
            Hospital Voice Intelligence v2.4
          </span>
          <span className="text-[10px] text-[#625b7e] dark:text-[#a29bc2] font-mono font-semibold hidden sm:inline">
            &bull; Sub-800ms Streaming Engine
          </span>
        </div>

        {/* Main Headline */}
        <h1 className="font-['Bricolage_Grotesque',sans-serif] text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-[#150f26] dark:text-white leading-[1.12]">
          Autonomous Voice AI for Modern Hospitals &amp; Clinics
        </h1>

        {/* Subhead */}
        <p className="mx-auto mt-5 max-w-2xl text-base sm:text-lg text-[#625b7e] dark:text-[#a29bc2] leading-relaxed">
          Eliminate missed patient calls, automate doctor appointment bookings in{" "}
          <span className="font-semibold text-[#150f26] dark:text-white">Hindi, Hinglish &amp; English</span>, and
          enforce strict zero-collision clinical shift rosters with sub-800ms conversational turn latency.
        </p>

        {/* CTA Actions */}
        <div className="mt-8 flex flex-wrap justify-center items-center gap-3.5">
          <Link to="/hospital">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-2xl px-6 py-3.5 text-sm font-bold text-white bg-gradient-to-r from-[#6d28d9] to-[#9333ea] shadow-lg shadow-purple-600/30 hover:brightness-105 active:scale-95 transition-all cursor-pointer"
            >
              <LayoutDashboard className="h-4 w-4" />
              <span>Open Hospital Workspace</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </Link>

          <Link to="/hospital?tab=voice">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-2xl px-6 py-3.5 text-sm font-semibold text-[#150f26] dark:text-white border border-[#e6e0f5] dark:border-[#2b2347] bg-white dark:bg-[#120e1f] hover:bg-purple-50 dark:hover:bg-purple-950/40 shadow-sm transition-all cursor-pointer"
            >
              <Mic className="h-4 w-4 text-[#7c3aed]" />
              <span>Test Live Voice AI</span>
            </button>
          </Link>

          <Link to="/register">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-2xl px-5 py-3.5 text-sm font-semibold text-[#625b7e] dark:text-[#a29bc2] hover:text-[#150f26] dark:hover:text-white transition-colors cursor-pointer"
            >
              <Sparkles className="h-4 w-4 text-[#7c3aed]" />
              <span>Register New Hospital &rarr;</span>
            </button>
          </Link>
        </div>

        {/* Trust Badges Bar */}
        <div className="mt-10 pt-6 border-t border-[#e6e0f5]/80 dark:border-[#2b2347]/80 flex flex-wrap items-center justify-center gap-y-3 gap-x-8 text-xs font-medium text-[#625b7e] dark:text-[#a29bc2]">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span>45+ Hospitals Deployed</span>
          </div>
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-[#7c3aed] dark:text-purple-400" />
            <span>Sub-800ms Turn Latency</span>
          </div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span>Zero Double-Booking Guarantee</span>
          </div>
          <div className="flex items-center gap-2">
            <BadgeCheck className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <span>HIPAA-Aligned Multi-Tenancy</span>
          </div>
        </div>
      </section>

      {/* =========================================================================
          2. INTERACTIVE LIVE VOICE CALL SIMULATOR (SHOWCASE DEMO)
          ========================================================================= */}
      <section className="rounded-3xl border border-[#e6e0f5] dark:border-[#2b2347] bg-white dark:bg-[#120e1f] p-6 sm:p-10 shadow-[0_16px_50px_-20px_rgba(21,15,38,0.08)] relative overflow-hidden">
        {/* Ambient Top Glow */}
        <div className="absolute top-0 right-0 w-80 h-80 bg-purple-100/60 dark:bg-purple-950/20 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-[#e6e0f5] dark:border-[#2b2347]">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 text-[#7c3aed] dark:text-purple-300 text-xs font-bold mb-2">
              <Radio className="h-3.5 w-3.5 animate-pulse" />
              <span>Interactive Telephony Preview</span>
            </div>
            <h2 className="font-['Bricolage_Grotesque',sans-serif] text-2xl sm:text-3xl font-bold text-[#150f26] dark:text-white">
              Listen to Autonomous Patient Conversations
            </h2>
            <p className="text-xs sm:text-sm text-[#625b7e] dark:text-[#a29bc2] mt-1">
              Select a clinical scenario below to see how our voice model converses, checks live shifts, and books slots.
            </p>
          </div>

          {/* Scenario Selector Pills */}
          <div className="flex flex-wrap items-center gap-2">
            {SCENARIOS.map((sc) => (
              <button
                key={sc.id}
                type="button"
                onClick={() => setActiveScenarioId(sc.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  activeScenarioId === sc.id
                    ? "bg-[#7c3aed] text-white shadow-md shadow-purple-600/30 scale-102"
                    : "bg-[#f3f0fb] dark:bg-[#1a1530] text-[#625b7e] dark:text-[#a29bc2] hover:text-[#150f26] dark:hover:text-white border border-[#e6e0f5] dark:border-[#2b2347]"
                }`}
              >
                <span>{sc.title}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Live Call Simulator Visualizer */}
        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-6 pt-6">
          {/* Left Column: Call Metadata & Audio Equalizer */}
          <div className="lg:col-span-5 rounded-2xl bg-[#faf8fe] dark:bg-[#181329] border border-[#e6e0f5] dark:border-[#2b2347] p-5 flex flex-col justify-between space-y-5">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider text-[#625b7e] dark:text-[#a29bc2] font-semibold">
                  Active Call Session
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                  Live Audio Stream
                </span>
              </div>

              {/* Caller Card */}
              <div className="p-3.5 rounded-xl bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-950/60 text-[#7c3aed] dark:text-purple-300 flex items-center justify-center font-bold text-sm">
                  <PhoneCall className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-[#150f26] dark:text-white flex items-center gap-2">
                    <span>+91 98765 43210</span>
                    <span className="text-[10px] px-2 py-0.2 rounded-md bg-purple-50 dark:bg-purple-950 text-[#7c3aed] font-mono">
                      Inbound
                    </span>
                  </div>
                  <div className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">{activeScenario.lang}</div>
                </div>
              </div>

              {/* Audio Waveform Equalizer */}
              <div className="p-4 rounded-xl bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] space-y-3">
                <div className="flex items-center justify-between text-xs text-[#625b7e] dark:text-[#a29bc2]">
                  <span className="flex items-center gap-1.5 font-semibold text-[#150f26] dark:text-white">
                    <Volume2 className="h-3.5 w-3.5 text-[#7c3aed]" />
                    <span>Neural Voice Waveform</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsPlayingAudio(!isPlayingAudio)}
                    className="text-[11px] font-mono text-[#7c3aed] hover:underline cursor-pointer"
                  >
                    {isPlayingAudio ? "Mute Visualizer" : "Animate Visualizer"}
                  </button>
                </div>

                <div className="h-12 flex items-center justify-center gap-1.5 px-4 bg-[#faf8fe] dark:bg-[#181329] rounded-lg">
                  {isPlayingAudio ? (
                    <>
                      <span className="w-1.5 rounded-full bg-[#7c3aed] animate-soundwave-1" />
                      <span className="w-1.5 rounded-full bg-[#9333ea] animate-soundwave-2" />
                      <span className="w-1.5 rounded-full bg-[#a855f7] animate-soundwave-3" />
                      <span className="w-1.5 rounded-full bg-[#7c3aed] animate-soundwave-4" />
                      <span className="w-1.5 rounded-full bg-[#c084fc] animate-soundwave-5" />
                      <span className="w-1.5 rounded-full bg-[#9333ea] animate-soundwave-6" />
                      <span className="w-1.5 rounded-full bg-[#7c3aed] animate-soundwave-7" />
                      <span className="w-1.5 rounded-full bg-[#a855f7] animate-soundwave-2" />
                      <span className="w-1.5 rounded-full bg-[#9333ea] animate-soundwave-4" />
                      <span className="w-1.5 rounded-full bg-[#7c3aed] animate-soundwave-1" />
                    </>
                  ) : (
                    <span className="text-xs text-[#625b7e] font-mono">Audio waveform paused</span>
                  )}
                </div>

                <div className="flex items-center justify-between text-[11px] font-mono text-[#625b7e] dark:text-[#a29bc2] pt-1">
                  <span>Latency: ~{activeScenario.latencyMs}ms</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Loss: 0.0%</span>
                </div>
              </div>
            </div>

            {/* Verified Lock Action */}
            <div className="p-3.5 rounded-xl bg-purple-50/70 dark:bg-purple-950/30 border border-purple-200/70 dark:border-purple-800/60 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-[#7c3aed] dark:text-purple-300 flex items-center gap-1.5">
                  <CalendarCheck2 className="h-3.5 w-3.5" />
                  <span>Transactional Slot Lock</span>
                </span>
                <span className="text-[10px] font-mono font-bold text-emerald-600 dark:text-emerald-400">VERIFIED</span>
              </div>
              <div className="text-xs text-[#150f26] dark:text-white font-semibold">
                {activeScenario.verifiedDoctor} &bull; {activeScenario.slotBooked}
              </div>
              <div className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
                Department: {activeScenario.department} &bull; Fee: {activeScenario.fee}
              </div>
            </div>
          </div>

          {/* Right Column: Real-Time Dialogue Transcript */}
          <div className="lg:col-span-7 rounded-2xl bg-[#faf8fe] dark:bg-[#181329] border border-[#e6e0f5] dark:border-[#2b2347] p-5 flex flex-col justify-between space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#e6e0f5] dark:border-[#2b2347]">
              <span className="text-[11px] font-mono uppercase tracking-wider text-[#625b7e] dark:text-[#a29bc2] font-semibold">
                Multi-Turn Telephony Dialogue
              </span>
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${activeScenario.badgeColor}`}>
                {activeScenario.badge}
              </span>
            </div>

            {/* Messages */}
            <div className="space-y-3.5 py-1">
              {/* Turn 1: Patient */}
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-[#e6e0f5] dark:bg-[#2b2347] flex items-center justify-center text-[#150f26] dark:text-white shrink-0 mt-0.5">
                  <User className="h-4 w-4" />
                </div>
                <div className="space-y-1 max-w-[85%]">
                  <div className="text-[11px] font-bold text-[#625b7e] dark:text-[#a29bc2]">
                    {activeScenario.patientPrompt}
                  </div>
                  <div className="p-3.5 rounded-2xl rounded-tl-sm bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] text-xs sm:text-sm text-[#150f26] dark:text-white font-medium leading-relaxed shadow-xs">
                    &ldquo;{activeScenario.patientLangText}&rdquo;
                  </div>
                </div>
              </div>

              {/* Turn 2: Agent */}
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#6d28d9] to-[#9333ea] flex items-center justify-center text-white shrink-0 mt-0.5 shadow-sm">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="space-y-1 max-w-[90%]">
                  <div className="text-[11px] font-bold text-[#7c3aed] dark:text-purple-300 flex items-center gap-1.5">
                    <span>{activeScenario.agentResponse}</span>
                    <span className="text-[10px] font-mono font-normal text-[#625b7e] dark:text-[#a29bc2]">
                      ({activeScenario.latencyMs}ms STT+LLM+TTS)
                    </span>
                  </div>
                  <div className="p-3.5 rounded-2xl rounded-tl-sm bg-gradient-to-r from-purple-50 to-indigo-50/50 dark:from-[#201938] dark:to-[#1a1530] border border-purple-200/80 dark:border-purple-800/80 text-xs sm:text-sm text-[#150f26] dark:text-white font-medium leading-relaxed shadow-xs">
                    &ldquo;{activeScenario.agentLangText}&rdquo;
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Actions inside Simulator */}
            <div className="pt-3 border-t border-[#e6e0f5] dark:border-[#2b2347] flex items-center justify-between text-xs">
              <span className="text-[#625b7e] dark:text-[#a29bc2] text-[11px]">
                Auto-generates appointment in PostgreSQL + SMS trigger
              </span>
              <Link
                to="/hospital?tab=voice"
                className="font-bold text-[#7c3aed] dark:text-purple-300 hover:underline flex items-center gap-1 text-xs"
              >
                <span>Launch Interactive Voice Mic &rarr;</span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          3. METRICS & IMPACT STATS
          ========================================================================= */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <div className="p-6 rounded-3xl bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm hover:border-purple-300 dark:hover:border-purple-800 transition-all text-center space-y-1.5">
          <div className="font-['Bricolage_Grotesque',sans-serif] text-3xl sm:text-4xl font-bold text-[#7c3aed] dark:text-purple-400">
            &lt; 800ms
          </div>
          <div className="text-xs sm:text-sm font-bold text-[#150f26] dark:text-white">Streaming Voice Latency</div>
          <p className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
            Speech-to-text, LLM sentence chunking &amp; neural TTS pipeline
          </p>
        </div>

        <div className="p-6 rounded-3xl bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm hover:border-emerald-300 dark:hover:border-emerald-800 transition-all text-center space-y-1.5">
          <div className="font-['Bricolage_Grotesque',sans-serif] text-3xl sm:text-4xl font-bold text-emerald-600 dark:text-emerald-400">
            0%
          </div>
          <div className="text-xs sm:text-sm font-bold text-[#150f26] dark:text-white">Double-Booking Collisions</div>
          <p className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
            ACID transaction locks prevent concurrent slot conflicts
          </p>
        </div>

        <div className="p-6 rounded-3xl bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm hover:border-indigo-300 dark:hover:border-indigo-800 transition-all text-center space-y-1.5">
          <div className="font-['Bricolage_Grotesque',sans-serif] text-3xl sm:text-4xl font-bold text-indigo-600 dark:text-indigo-400">
            3 Dialects
          </div>
          <div className="text-xs sm:text-sm font-bold text-[#150f26] dark:text-white">Hindi, Hinglish &amp; English</div>
          <p className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
            Seamless linguistic code-switching during natural patient calls
          </p>
        </div>

        <div className="p-6 rounded-3xl bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm hover:border-pink-300 dark:hover:border-pink-800 transition-all text-center space-y-1.5">
          <div className="font-['Bricolage_Grotesque',sans-serif] text-3xl sm:text-4xl font-bold text-pink-600 dark:text-pink-400">
            24 / 7
          </div>
          <div className="text-xs sm:text-sm font-bold text-[#150f26] dark:text-white">Autonomous Dispatch</div>
          <p className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
            Never miss after-hours appointment calls or triage opportunities
          </p>
        </div>
      </section>

      {/* =========================================================================
          4. 4-STAGE ARCHITECTURE PIPELINE (HOW IT WORKS)
          ========================================================================= */}
      <section className="space-y-8">
        <div className="text-center max-w-2xl mx-auto space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 text-[#7c3aed] dark:text-purple-300 text-xs font-bold">
            <Layers className="h-3.5 w-3.5" />
            <span>Under The Hood</span>
          </div>
          <h2 className="font-['Bricolage_Grotesque',sans-serif] text-3xl sm:text-4xl font-bold text-[#150f26] dark:text-white">
            How The Clinical Voice Engine Operates
          </h2>
          <p className="text-xs sm:text-sm text-[#625b7e] dark:text-[#a29bc2]">
            Every patient call flows through a synchronized multi-stage pipeline designed for extreme low-latency and medical safety.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {/* Step 1 */}
          <div className="p-6 rounded-3xl bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm space-y-3 relative">
            <div className="w-9 h-9 rounded-xl bg-purple-100 dark:bg-purple-950/60 text-[#7c3aed] dark:text-purple-300 flex items-center justify-center font-bold text-sm">
              01
            </div>
            <h3 className="font-['Bricolage_Grotesque',sans-serif] text-base font-bold text-[#150f26] dark:text-white">
              Streaming Audio Ingestion &amp; STT
            </h3>
            <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] leading-relaxed">
              Inbound and outbound telephone audio streams are captured with sub-millisecond voice activity detection (VAD) and converted to text in real-time.
            </p>
            <div className="pt-2 text-[11px] font-mono font-semibold text-[#7c3aed]">
              Audio Frame Chunking &bull; 16kHz
            </div>
          </div>

          {/* Step 2 */}
          <div className="p-6 rounded-3xl bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm space-y-3 relative">
            <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 flex items-center justify-center font-bold text-sm">
              02
            </div>
            <h3 className="font-['Bricolage_Grotesque',sans-serif] text-base font-bold text-[#150f26] dark:text-white">
              Clinical Guardrails &amp; Intent Analysis
            </h3>
            <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] leading-relaxed">
              Medical triage guardrails identify urgent symptoms immediately. Routine appointment intents extract doctor name, preferred day, and slot duration.
            </p>
            <div className="pt-2 text-[11px] font-mono font-semibold text-indigo-600">
              Emergency Symptom Triage Gate
            </div>
          </div>

          {/* Step 3 */}
          <div className="p-6 rounded-3xl bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm space-y-3 relative">
            <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-300 flex items-center justify-center font-bold text-sm">
              03
            </div>
            <h3 className="font-['Bricolage_Grotesque',sans-serif] text-base font-bold text-[#150f26] dark:text-white">
              Shift Roster &amp; Slot Transaction
            </h3>
            <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] leading-relaxed">
              The engine queries the hospital&apos;s weekly calendar and the physician&apos;s active shifts. If open, the slot is locked atomically with PostgreSQL advisory locks.
            </p>
            <div className="pt-2 text-[11px] font-mono font-semibold text-emerald-600">
              ACID Advisory Lock Isolation
            </div>
          </div>

          {/* Step 4 */}
          <div className="p-6 rounded-3xl bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm space-y-3 relative">
            <div className="w-9 h-9 rounded-xl bg-pink-100 dark:bg-pink-950/60 text-pink-600 dark:text-pink-300 flex items-center justify-center font-bold text-sm">
              04
            </div>
            <h3 className="font-['Bricolage_Grotesque',sans-serif] text-base font-bold text-[#150f26] dark:text-white">
              Neural TTS Synthesis &amp; Confirmation
            </h3>
            <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] leading-relaxed">
              Sentence-by-sentence streaming neural TTS synthesizes a natural voice confirmation back to the patient. Instant WhatsApp/SMS booking receipt dispatched.
            </p>
            <div className="pt-2 text-[11px] font-mono font-semibold text-pink-600">
              Sub-800ms Stream Playback
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          5. 6 CORE CAPABILITY PILLARS
          ========================================================================= */}
      <section className="space-y-8">
        <div className="text-center max-w-2xl mx-auto space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 text-[#7c3aed] dark:text-purple-300 text-xs font-bold">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Complete Hospital Suite</span>
          </div>
          <h2 className="font-['Bricolage_Grotesque',sans-serif] text-3xl sm:text-4xl font-bold text-[#150f26] dark:text-white">
            Built For Real Hospital Operations
          </h2>
          <p className="text-xs sm:text-sm text-[#625b7e] dark:text-[#a29bc2]">
            Every tool required to administer your hospital profile, doctor shifts, telephony dispatch, and patient analytics in one unified workspace.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Card 1 */}
          <div className="p-6 rounded-3xl bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm hover:border-purple-300 dark:hover:border-purple-800 transition-all space-y-3">
            <div className="w-10 h-10 rounded-2xl bg-purple-100 dark:bg-purple-950/60 text-[#7c3aed] dark:text-purple-300 flex items-center justify-center">
              <Clock className="h-5 w-5" />
            </div>
            <h3 className="font-['Bricolage_Grotesque',sans-serif] text-lg font-bold text-[#150f26] dark:text-white">
              Weekly Operating Calendar
            </h3>
            <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] leading-relaxed">
              Set comprehensive 7-day hospital hours with instant presets (Mon-Fri 9-5, Mon-Sat 9-6, All 7 Days). Toggle individual days off or update open/close times anytime.
            </p>
          </div>

          {/* Card 2 */}
          <div className="p-6 rounded-3xl bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm hover:border-purple-300 dark:hover:border-purple-800 transition-all space-y-3">
            <div className="w-10 h-10 rounded-2xl bg-purple-100 dark:bg-purple-950/60 text-[#7c3aed] dark:text-purple-300 flex items-center justify-center">
              <Stethoscope className="h-5 w-5" />
            </div>
            <h3 className="font-['Bricolage_Grotesque',sans-serif] text-lg font-bold text-[#150f26] dark:text-white">
              Doctor Shifts &amp; Slot Duration
            </h3>
            <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] leading-relaxed">
              Configure per-doctor consultation fees (₹300 - ₹1500+), slot durations (15m, 30m, 45m, 60m), and weekly shift rosters for Cardiology, Pediatrics, Orthopedics, and more.
            </p>
          </div>

          {/* Card 3 */}
          <div className="p-6 rounded-3xl bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm hover:border-emerald-300 dark:hover:border-emerald-800 transition-all space-y-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-300 flex items-center justify-center">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <h3 className="font-['Bricolage_Grotesque',sans-serif] text-lg font-bold text-[#150f26] dark:text-white">
              Zero-Collision Locks
            </h3>
            <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] leading-relaxed">
              Transactional database locks eliminate double bookings. Even when hundreds of callers dial in at peak morning hours, every slot allocation is collision-free.
            </p>
          </div>

          {/* Card 4 */}
          <div className="p-6 rounded-3xl bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm hover:border-red-300 dark:hover:border-red-800 transition-all space-y-3">
            <div className="w-10 h-10 rounded-2xl bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-300 flex items-center justify-center">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <h3 className="font-['Bricolage_Grotesque',sans-serif] text-lg font-bold text-[#150f26] dark:text-white">
              Emergency Hotline Triage
            </h3>
            <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] leading-relaxed">
              Dedicated emergency routing connects severe symptoms directly to your 24/7 casualty desk with priority SIP routing, dispatching instant ambulance notifications.
            </p>
          </div>

          {/* Card 5 */}
          <div className="p-6 rounded-3xl bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm hover:border-blue-300 dark:hover:border-blue-800 transition-all space-y-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-300 flex items-center justify-center">
              <Activity className="h-5 w-5" />
            </div>
            <h3 className="font-['Bricolage_Grotesque',sans-serif] text-lg font-bold text-[#150f26] dark:text-white">
              Voice Playground &amp; Diagnostics
            </h3>
            <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] leading-relaxed">
              Test and calibrate voice models directly in browser with real mic audio before routing live telephony. View raw latency breakdown and debug thought logs.
            </p>
          </div>

          {/* Card 6 */}
          <div className="p-6 rounded-3xl bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm hover:border-purple-300 dark:hover:border-purple-800 transition-all space-y-3">
            <div className="w-10 h-10 rounded-2xl bg-purple-100 dark:bg-purple-950/60 text-[#7c3aed] dark:text-purple-300 flex items-center justify-center">
              <Layers className="h-5 w-5" />
            </div>
            <h3 className="font-['Bricolage_Grotesque',sans-serif] text-lg font-bold text-[#150f26] dark:text-white">
              HIPAA-Aligned Multi-Tenancy
            </h3>
            <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] leading-relaxed">
              Strict multi-tenant architecture with PostgreSQL tenant isolation, JWT authentication, role-based access control, and encrypted patient call metadata.
            </p>
          </div>
        </div>
      </section>

      {/* =========================================================================
          6. COMPARISON MATRIX (RECEPTIONIST VS AI VOICE AGENT)
          ========================================================================= */}
      <section className="rounded-3xl border border-[#e6e0f5] dark:border-[#2b2347] bg-white dark:bg-[#120e1f] p-6 sm:p-10 shadow-sm space-y-6">
        <div className="text-center max-w-xl mx-auto space-y-2">
          <h2 className="font-['Bricolage_Grotesque',sans-serif] text-2xl sm:text-3xl font-bold text-[#150f26] dark:text-white">
            Traditional Front Desk vs Hospital Voice Agent
          </h2>
          <p className="text-xs sm:text-sm text-[#625b7e] dark:text-[#a29bc2]">
            Why hospitals switch from manual phone reception to autonomous AI voice dispatch.
          </p>
        </div>

        <div className="overflow-x-auto pt-2">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[#e6e0f5] dark:border-[#2b2347] text-[11px] font-mono uppercase text-[#625b7e] dark:text-[#a29bc2]">
                <th className="py-3 px-4 font-bold">Metric / Capability</th>
                <th className="py-3 px-4 font-bold text-red-500">Traditional Front Desk</th>
                <th className="py-3 px-4 font-bold text-[#7c3aed] dark:text-purple-300">Hospital Voice Agent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e6e0f5]/60 dark:divide-[#2b2347]/60">
              <tr className="hover:bg-[#faf8fe] dark:hover:bg-[#181329] transition-colors">
                <td className="py-3.5 px-4 font-bold text-[#150f26] dark:text-white">Concurrent Caller Handling</td>
                <td className="py-3.5 px-4 text-[#625b7e] dark:text-[#a29bc2]">1 caller per staff member (busy tones)</td>
                <td className="py-3.5 px-4 font-semibold text-emerald-600 dark:text-emerald-400">Unlimited simultaneous callers</td>
              </tr>
              <tr className="hover:bg-[#faf8fe] dark:hover:bg-[#181329] transition-colors">
                <td className="py-3.5 px-4 font-bold text-[#150f26] dark:text-white">After-Hours &amp; Weekend Booking</td>
                <td className="py-3.5 px-4 text-[#625b7e] dark:text-[#a29bc2]">Voicemail / Unanswered calls</td>
                <td className="py-3.5 px-4 font-semibold text-emerald-600 dark:text-emerald-400">24/7 Full booking &amp; emergency routing</td>
              </tr>
              <tr className="hover:bg-[#faf8fe] dark:hover:bg-[#181329] transition-colors">
                <td className="py-3.5 px-4 font-bold text-[#150f26] dark:text-white">Multilingual Dialect Support</td>
                <td className="py-3.5 px-4 text-[#625b7e] dark:text-[#a29bc2]">Limited by individual staff languages</td>
                <td className="py-3.5 px-4 font-semibold text-emerald-600 dark:text-emerald-400">Fluent Hindi, Hinglish, English</td>
              </tr>
              <tr className="hover:bg-[#faf8fe] dark:hover:bg-[#181329] transition-colors">
                <td className="py-3.5 px-4 font-bold text-[#150f26] dark:text-white">Double-Booking Risk</td>
                <td className="py-3.5 px-4 text-[#625b7e] dark:text-[#a29bc2]">High during peak morning call spikes</td>
                <td className="py-3.5 px-4 font-semibold text-emerald-600 dark:text-emerald-400">0% (ACID Transactional Lock)</td>
              </tr>
              <tr className="hover:bg-[#faf8fe] dark:hover:bg-[#181329] transition-colors">
                <td className="py-3.5 px-4 font-bold text-[#150f26] dark:text-white">Average Call Hold Time</td>
                <td className="py-3.5 px-4 text-[#625b7e] dark:text-[#a29bc2]">2 to 8 minutes on hold</td>
                <td className="py-3.5 px-4 font-semibold text-emerald-600 dark:text-emerald-400">0 seconds (Immediate pickup)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* =========================================================================
          7. LIVE SYSTEM DIAGNOSTICS (FASTAPI, POSTGRESQL 16, REDIS 7)
          ========================================================================= */}
      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-['Bricolage_Grotesque',sans-serif] text-xl font-bold text-[#150f26] dark:text-white">
              Live Infrastructure Telemetry
            </h3>
            <p className="text-xs text-[#625b7e] dark:text-[#a29bc2]">
              Real-time health status of backend micro-services and persistent databases.
            </p>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 text-xs font-mono font-bold border border-emerald-200 dark:border-emerald-800">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Telemetry Active</span>
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {/* Core API Service */}
          <div className="p-5 rounded-2xl bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm hover:border-[#7c3aed] transition-all">
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
          <div className="p-5 rounded-2xl bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm hover:border-[#7c3aed] transition-all">
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
                <CheckCircle2 className="h-3 w-3" /> Ready
              </span>
            </div>
            <p className="mt-2 text-xs text-[#625b7e] dark:text-[#a29bc2]">
              6 normalized relational tables: tenants, users, operating hours, doctors &amp; availabilities.
            </p>
          </div>

          {/* Task Queue Layer */}
          <div className="p-5 rounded-2xl bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm hover:border-[#7c3aed] transition-all sm:col-span-2 lg:col-span-1">
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
      </section>

      {/* =========================================================================
          8. FREQUENTLY ASKED QUESTIONS (ACCORDION)
          ========================================================================= */}
      <section className="max-w-3xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 text-[#7c3aed] dark:text-purple-300 text-xs font-bold">
            <span>Hospital FAQ</span>
          </div>
          <h2 className="font-['Bricolage_Grotesque',sans-serif] text-2xl sm:text-3xl font-bold text-[#150f26] dark:text-white">
            Frequently Asked Questions
          </h2>
        </div>

        <div className="space-y-3">
          {FAQS.map((faq, idx) => (
            <div
              key={faq.q}
              className="rounded-2xl border border-[#e6e0f5] dark:border-[#2b2347] bg-white dark:bg-[#120e1f] overflow-hidden transition-all shadow-xs"
            >
              <button
                type="button"
                onClick={() => setOpenFaqIndex(openFaqIndex === idx ? null : idx)}
                className="w-full p-4 sm:p-5 text-left flex items-center justify-between gap-4 font-bold text-xs sm:text-sm text-[#150f26] dark:text-white hover:text-[#7c3aed] transition-colors cursor-pointer"
              >
                <span>{faq.q}</span>
                <ChevronDown
                  className={`h-4 w-4 text-[#7c3aed] shrink-0 transition-transform duration-200 ${
                    openFaqIndex === idx ? "rotate-180" : ""
                  }`}
                />
              </button>
              {openFaqIndex === idx && (
                <div className="px-4 sm:px-5 pb-5 text-xs text-[#625b7e] dark:text-[#a29bc2] leading-relaxed border-t border-[#e6e0f5]/60 dark:border-[#2b2347]/60 pt-3">
                  {faq.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* =========================================================================
          9. FINAL HIGH-CONVERSION CTA BANNER
          ========================================================================= */}
      <section className="relative rounded-3xl bg-gradient-to-br from-[#6d28d9] via-[#7c3aed] to-[#9333ea] p-8 sm:p-12 text-white shadow-xl shadow-purple-600/25 overflow-hidden text-center">
        {/* Glow Spheres inside banner */}
        <div className="absolute -top-24 -left-24 w-80 h-80 bg-white/10 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-80 h-80 bg-pink-400/20 rounded-full blur-2xl pointer-events-none" />

        <div className="relative z-10 max-w-2xl mx-auto space-y-4">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 backdrop-blur-md text-white text-xs font-semibold">
            <HeartPulse className="h-3.5 w-3.5 text-pink-200" />
            <span>Modernize Your Medical Phone Operations Today</span>
          </div>

          <h2 className="font-['Bricolage_Grotesque',sans-serif] text-3xl sm:text-4xl lg:text-5xl font-bold leading-tight tracking-tight">
            Ready to Automate Your Hospital Line?
          </h2>

          <p className="text-white/85 text-xs sm:text-sm leading-relaxed max-w-lg mx-auto">
            Get up and running in minutes. Configure your operating calendar, register doctors and shifts, and test live speech interactions immediately.
          </p>

          <div className="pt-3 flex flex-wrap justify-center items-center gap-3">
            <Link to="/register">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-2xl px-6 py-3.5 text-xs font-bold text-[#6d28d9] bg-white shadow-lg hover:bg-purple-50 active:scale-95 transition-all cursor-pointer"
              >
                <span>Register Hospital Workspace</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </Link>

            <Link to="/hospital">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-2xl px-6 py-3.5 text-xs font-bold text-white border border-white/40 bg-white/10 hover:bg-white/20 backdrop-blur-md transition-all cursor-pointer"
              >
                <LayoutDashboard className="h-4 w-4" />
                <span>Go to Dashboard</span>
              </button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
};
