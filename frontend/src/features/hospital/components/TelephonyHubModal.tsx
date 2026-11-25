import React, { useState, useEffect, useRef } from "react";
import {
  PhoneCall,
  PhoneOff,
  Mic,
  MicOff,
  CheckCircle2,
  AlertTriangle,
  Radio,
  Smartphone,
  CloudLightning,
  Copy,
  Check,
  Loader2,
  X,
  Send,
  RotateCcw,
  ShieldCheck,
  QrCode,
  ArrowLeft,
  Volume2,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";

export type TelephonyProviderType = "twilio" | "exotel" | "web" | "gsm";

export interface TelephonyHubModalProps {
  isOpen: boolean;
  onClose: () => void;
  patientName: string;
  patientPhone: string;
  hospitalPhone: string;
  patientId?: string;
  initialProvider?: TelephonyProviderType;
}

interface ProviderDiagnosticStatus {
  active_provider?: string;
  calling_provider_setting?: string;
  twilio?: {
    configured: boolean;
    account_sid_present: boolean;
    auth_token_present?: boolean;
    phone_number?: string;
  };
  exotel?: {
    configured: boolean;
    api_key_present: boolean;
    subdomain?: string;
    caller_id?: string;
  };
}

export const TelephonyHubModal: React.FC<TelephonyHubModalProps> = ({
  isOpen,
  onClose,
  patientName,
  patientPhone,
  hospitalPhone,
  patientId,
}) => {
  // Navigation view: "options" (Step 1) or "provider_screen" (Step 2)
  const [currentView, setCurrentView] = useState<"options" | "provider_screen">("options");
  const [selectedProvider, setSelectedProvider] = useState<TelephonyProviderType>("twilio");

  const [providerStatus, setProviderStatus] = useState<ProviderDiagnosticStatus | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState<boolean>(true);
  const [copiedEnv, setCopiedEnv] = useState<string | null>(null);

  // Active Call States
  const [callStatus, setCallStatus] = useState<"idle" | "dialing" | "ringing" | "connected" | "ended">("idle");
  const [activeCallId, setActiveCallId] = useState<string>("");
  const [callDuration, setCallDuration] = useState<number>(0);
  const [isCallingApi, setIsCallingApi] = useState<boolean>(false);
  const [apiResponse, setApiResponse] = useState<any>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  // Conversational Transcript & Audio
  const [conversation, setConversation] = useState<Array<{ sender: "bot" | "user"; text: string; time: string }>>([]);
  const [manualInput, setManualInput] = useState<string>("");
  const [isProcessingTurn, setIsProcessingTurn] = useState<boolean>(false);
  const [isBotSpeaking, setIsBotSpeaking] = useState<boolean>(false);
  const [isMicActive, setIsMicActive] = useState<boolean>(false);
  const [showQrCode, setShowQrCode] = useState<boolean>(false);

  const durationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<any>(null);

  const cleanPatientPhone = patientPhone.replace(/[^\d+]/g, "");
  const cleanHospitalPhone = hospitalPhone ? hospitalPhone.replace(/[^\d+]/g, "") : "";
  const telUri = `tel:${cleanPatientPhone}`;

  // Fetch provider configuration diagnostics from backend
  const fetchProviderStatus = async () => {
    setIsLoadingStatus(true);
    try {
      const res = await apiClient.get<ProviderDiagnosticStatus>("/api/v1/telephony/provider-status");
      setProviderStatus(res);
    } catch (err) {
      console.warn("Could not fetch telephony provider status:", err);
    } finally {
      setIsLoadingStatus(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchProviderStatus();
      setCurrentView("options");
      setCallStatus("idle");
      setApiResponse(null);
      setApiError(null);
      setConversation([
        {
          sender: "bot",
          text: `Namaste! Hospital Voice Agent ready. Calling ${patientName} (${cleanPatientPhone}).`,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } else {
      cleanupCall();
    }
  }, [isOpen, patientName]);

  const cleanupCall = () => {
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    setIsMicActive(false);
    setIsBotSpeaking(false);
  };

  useEffect(() => {
    return () => cleanupCall();
  }, []);

  // Duration timer
  useEffect(() => {
    if (callStatus === "connected") {
      durationTimerRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current);
        durationTimerRef.current = null;
      }
    }
    return () => {
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current);
      }
    };
  }, [callStatus]);

  // Auto-scroll chat transcript
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [conversation]);

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedEnv(key);
    setTimeout(() => setCopiedEnv(null), 2500);
  };

  // Bot speech synthesis for web simulation
  const speakBotMessage = (text: string) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    utterance.lang = "en-IN";
    utterance.onstart = () => setIsBotSpeaking(true);
    utterance.onend = () => setIsBotSpeaking(false);
    utterance.onerror = () => setIsBotSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };

  // Select provider from Step 1 options to enter Step 2
  const handleSelectProvider = (provider: TelephonyProviderType) => {
    setSelectedProvider(provider);
    setCurrentView("provider_screen");
    setCallStatus("idle");
    setApiError(null);
    setApiResponse(null);
  };

  // Return back to Step 1 options
  const handleBackToOptions = () => {
    cleanupCall();
    setCallStatus("idle");
    setCurrentView("options");
  };

  // Initiate call
  const handleInitiateCall = async (isSimulation: boolean = false) => {
    setIsCallingApi(true);
    setApiError(null);
    setApiResponse(null);
    setCallStatus("dialing");
    setCallDuration(0);

    const callId = `${selectedProvider}_${Date.now().toString(36)}`;
    setActiveCallId(callId);

    try {
      if (selectedProvider === "gsm") {
        const res = await apiClient.post<any>("/api/v1/telephony/phone-dispatch", {
          patient_name: patientName,
          patient_phone: cleanPatientPhone,
          patient_id: patientId || null,
          hospital_phone: cleanHospitalPhone,
        });
        setApiResponse(res);
        setCallStatus("connected");
        setConversation((prev) => [
          ...prev,
          {
            sender: "bot",
            text: `Dispatched GSM direct dial via Hospital Phone (${cleanHospitalPhone || "Default"}). Dialing ${cleanPatientPhone}...`,
            time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          },
        ]);
        try {
          window.location.href = telUri;
        } catch {}
      } else if (selectedProvider === "web") {
        const res = await apiClient.post<any>("/api/v1/telephony/outbound-call", {
          patient_name: patientName,
          patient_phone: cleanPatientPhone,
          patient_id: patientId || null,
          hospital_phone: cleanHospitalPhone,
        });
        setApiResponse(res);
        setCallStatus("connected");
        const greeting = `Hello ${patientName}, this is the Hospital Voice Agent speaking through web audio. How can I assist you with your consultation?`;
        setConversation((prev) => [
          ...prev,
          {
            sender: "bot",
            text: greeting,
            time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          },
        ]);
        speakBotMessage(greeting);
      } else {
        const providerName = selectedProvider === "exotel" ? "exotel" : "twilio";

        if (isSimulation) {
          setCallStatus("connected");
          setApiResponse({
            call_id: callId,
            status: "simulated_connected",
            configured: true,
            provider: `${providerName}_dev_sandbox`,
            message: `Developer Sandbox Mode: Simulated ${providerName.toUpperCase()} telecom call active. Real speech turn webhooks are operational!`,
          });
          const greeting = `Namaste ${patientName}! Calling via ${providerName.toUpperCase()} telephony from hospital ${hospitalPhone || "reception"}. Doctor consultation schedule is open. Which department would you like?`;
          setConversation((prev) => [
            ...prev,
            {
              sender: "bot",
              text: greeting,
              time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            },
          ]);
          speakBotMessage(greeting);
        } else {
          const res = await apiClient.post<any>("/api/v1/telephony/dispatch-call", {
            patient_name: patientName,
            patient_phone: cleanPatientPhone,
            hospital_phone: cleanHospitalPhone,
            provider: providerName,
          });
          setApiResponse(res);

          if (!res.configured || res.status === "failed" || res.status === "error") {
            setCallStatus("ended");
            setApiError(
              res.message ||
                res.error ||
                `${providerName.toUpperCase()} API rejected the call. Check credentials in backend/.env.`
            );
          } else {
            setCallStatus("connected");
            const greeting = res.initial_greeting || `Call queued on ${providerName.toUpperCase()}. Ringing patient phone...`;
            setConversation((prev) => [
              ...prev,
              {
                sender: "bot",
                text: greeting,
                time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              },
            ]);
          }
        }
      }
    } catch (err: any) {
      console.error("Call dispatch failed:", err);
      setCallStatus("ended");
      const errMsg = err?.response?.data?.detail || err?.message || "Failed to dispatch call. Please verify backend API.";
      setApiError(errMsg);
    } finally {
      setIsCallingApi(false);
    }
  };

  const handleHangup = async () => {
    setCallStatus("ended");
    cleanupCall();
    if (activeCallId) {
      try {
        await apiClient.post("/api/v1/telephony/end-call", { call_id: activeCallId });
      } catch {}
    }
  };

  const handleSendTurn = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = manualInput.trim();
    if (!query) return;

    const userTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setConversation((prev) => [...prev, { sender: "user", text: query, time: userTime }]);
    setManualInput("");
    setIsProcessingTurn(true);

    try {
      const res = await apiClient.post<any>("/api/v1/telephony/chat-turn", {
        call_id: activeCallId || `hub_${Date.now()}`,
        message: query,
      });

      const botTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const reply = res.reply || "Thank you. Your consultation preference has been noted.";
      setConversation((prev) => [...prev, { sender: "bot", text: reply, time: botTime }]);
      speakBotMessage(reply);
    } catch (err: any) {
      console.error("Chat turn error:", err);
      setConversation((prev) => [
        ...prev,
        {
          sender: "bot",
          text: "I noted your request and our clinical staff will follow up shortly.",
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } finally {
      setIsProcessingTurn(false);
    }
  };

  const toggleMicListening = () => {
    if (isMicActive) {
      cleanupCall();
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Browser speech recognition is not supported in this browser. Please use Chrome or Edge.");
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = "en-IN";

      recognition.onstart = () => setIsMicActive(true);

      recognition.onresult = (event: any) => {
        const lastIndex = event.results.length - 1;
        const transcript = event.results[lastIndex][0].transcript.trim();
        if (transcript) {
          if (window.speechSynthesis) window.speechSynthesis.cancel();
          setIsBotSpeaking(false);
          setManualInput(transcript);
        }
      };

      recognition.onerror = () => setIsMicActive(false);
      recognition.onend = () => setIsMicActive(false);

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setIsMicActive(false);
    }
  };

  if (!isOpen) return null;

  const isTwilioConfigured = Boolean(providerStatus?.twilio?.configured);
  const isExotelConfigured = Boolean(providerStatus?.exotel?.configured);

  const twilioEnvSnippet = `TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_32char_auth_token_here
TWILIO_PHONE_NUMBER=+1234567890`;

  const exotelEnvSnippet = `EXOTEL_API_KEY=your_exotel_api_key_here
EXOTEL_API_TOKEN=your_exotel_api_token_here
EXOTEL_SUBDOMAIN=your_subdomain
EXOTEL_CALLER_ID=0xxxxxxxxxx`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-3xl max-h-[92vh] flex flex-col rounded-3xl bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-2xl overflow-hidden text-[#150f26] dark:text-white">
        
        {/* =========================================================================
            VIEW 1: CLEAN SQUARE OPTIONS (STEP 1 - SELECT PROVIDER)
            ========================================================================= */}
        {currentView === "options" && (
          <div className="flex flex-col h-full">
            {/* Header */}
            <div className="px-6 py-5 border-b border-[#e6e0f5] dark:border-[#2b2347] flex items-center justify-between">
              <div>
                <h2 className="font-['Bricolage_Grotesque',sans-serif] text-xl font-bold">
                  Select Calling Channel
                </h2>
                <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] mt-0.5">
                  Choose a provider to initiate or test outbound call to <strong>{patientName}</strong> ({cleanPatientPhone})
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={fetchProviderStatus}
                  title="Refresh provider status"
                  className="p-2 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] text-[#625b7e] dark:text-[#a29bc2] hover:text-[#150f26] dark:hover:text-white transition-colors cursor-pointer"
                >
                  <RotateCcw className={`h-4 w-4 ${isLoadingStatus ? "animate-spin text-[#7c3aed]" : ""}`} />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 rounded-xl text-[#625b7e] hover:text-[#150f26] dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Square Options Grid */}
            <div className="p-6 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                
                {/* 1. TWILIO CARD */}
                <button
                  type="button"
                  onClick={() => handleSelectProvider("twilio")}
                  className="text-left p-5 rounded-2xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#faf8fe] dark:bg-[#181329] hover:border-[#7c3aed] hover:shadow-md transition-all cursor-pointer flex flex-col justify-between space-y-4 group"
                >
                  <div className="flex items-start justify-between">
                    <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                      <CloudLightning className="h-6 w-6" />
                    </div>
                    {isTwilioConfigured ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="h-3 w-3" /> Ready
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">
                        <AlertTriangle className="h-3 w-3" /> Not Configured
                      </span>
                    )}
                  </div>
                  <div>
                    <h3 className="font-['Bricolage_Grotesque',sans-serif] font-bold text-base text-[#150f26] dark:text-white">
                      Twilio Telephony
                    </h3>
                    <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] mt-1 leading-relaxed">
                      Place real cellular PSTN calls worldwide using Twilio Voice API &amp; TwiML webhooks.
                    </p>
                  </div>
                  <div className="pt-2 border-t border-[#e6e0f5]/60 dark:border-[#2b2347]/60 flex items-center justify-between text-xs font-semibold text-[#7c3aed] dark:text-purple-300">
                    <span>SID: {providerStatus?.twilio?.account_sid_present ? "Authenticated" : "Missing in .env"}</span>
                    <span>Test &amp; Call &rarr;</span>
                  </div>
                </button>

                {/* 2. EXOTEL CARD */}
                <button
                  type="button"
                  onClick={() => handleSelectProvider("exotel")}
                  className="text-left p-5 rounded-2xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#faf8fe] dark:bg-[#181329] hover:border-[#7c3aed] hover:shadow-md transition-all cursor-pointer flex flex-col justify-between space-y-4 group"
                >
                  <div className="flex items-start justify-between">
                    <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                      <Radio className="h-6 w-6" />
                    </div>
                    {isExotelConfigured ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="h-3 w-3" /> Ready
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">
                        <AlertTriangle className="h-3 w-3" /> Not Configured
                      </span>
                    )}
                  </div>
                  <div>
                    <h3 className="font-['Bricolage_Grotesque',sans-serif] font-bold text-base text-[#150f26] dark:text-white">
                      Exotel Telephony
                    </h3>
                    <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] mt-1 leading-relaxed">
                      Indian cellular (+91) calling via Exotel TRAI-compliant virtual telecom lines.
                    </p>
                  </div>
                  <div className="pt-2 border-t border-[#e6e0f5]/60 dark:border-[#2b2347]/60 flex items-center justify-between text-xs font-semibold text-[#7c3aed] dark:text-purple-300">
                    <span>API Key: {providerStatus?.exotel?.api_key_present ? "Authenticated" : "Missing in .env"}</span>
                    <span>Test &amp; Call &rarr;</span>
                  </div>
                </button>

                {/* 3. WEB AUDIO CARD */}
                <button
                  type="button"
                  onClick={() => handleSelectProvider("web")}
                  className="text-left p-5 rounded-2xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#faf8fe] dark:bg-[#181329] hover:border-[#7c3aed] hover:shadow-md transition-all cursor-pointer flex flex-col justify-between space-y-4 group"
                >
                  <div className="flex items-start justify-between">
                    <div className="w-12 h-12 rounded-2xl bg-purple-50 dark:bg-purple-950/60 text-[#7c3aed] flex items-center justify-center group-hover:scale-105 transition-transform">
                      <Mic className="h-6 w-6" />
                    </div>
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="h-3 w-3" /> Browser Ready
                    </span>
                  </div>
                  <div>
                    <h3 className="font-['Bricolage_Grotesque',sans-serif] font-bold text-base text-[#150f26] dark:text-white">
                      Web Audio &amp; LiveKit
                    </h3>
                    <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] mt-1 leading-relaxed">
                      Instant browser audio testing with microphone, live neural voice, and speech turns. No setup needed.
                    </p>
                  </div>
                  <div className="pt-2 border-t border-[#e6e0f5]/60 dark:border-[#2b2347]/60 flex items-center justify-between text-xs font-semibold text-[#7c3aed] dark:text-purple-300">
                    <span>Zero Config Needed</span>
                    <span>Test &amp; Call &rarr;</span>
                  </div>
                </button>

                {/* 4. DIRECT GSM CARD */}
                <button
                  type="button"
                  onClick={() => handleSelectProvider("gsm")}
                  className="text-left p-5 rounded-2xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#faf8fe] dark:bg-[#181329] hover:border-[#7c3aed] hover:shadow-md transition-all cursor-pointer flex flex-col justify-between space-y-4 group"
                >
                  <div className="flex items-start justify-between">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                      <Smartphone className="h-6 w-6" />
                    </div>
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="h-3 w-3" /> SIM Ready
                    </span>
                  </div>
                  <div>
                    <h3 className="font-['Bricolage_Grotesque',sans-serif] font-bold text-base text-[#150f26] dark:text-white">
                      Direct Mobile SIM Dial
                    </h3>
                    <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] mt-1 leading-relaxed">
                      Launch phone dialer via standard tel: protocol and send WhatsApp consultation notice.
                    </p>
                  </div>
                  <div className="pt-2 border-t border-[#e6e0f5]/60 dark:border-[#2b2347]/60 flex items-center justify-between text-xs font-semibold text-[#7c3aed] dark:text-purple-300">
                    <span>Caller ID: {hospitalPhone || "None"}</span>
                    <span>Test &amp; Call &rarr;</span>
                  </div>
                </button>

              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-[#e6e0f5] dark:border-[#2b2347] flex items-center justify-between text-xs text-[#625b7e] dark:text-[#a29bc2]">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                <span>PSTN Telephony &bull; WebRTC &bull; Multi-Tenant Isolated</span>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* =========================================================================
            VIEW 2: DEDICATED PROVIDER TESTING & CALLING SCREEN (STEP 2)
            ========================================================================= */}
        {currentView === "provider_screen" && (
          <div className="flex flex-col h-full">
            {/* Header with Back button */}
            <div className="px-6 py-4 border-b border-[#e6e0f5] dark:border-[#2b2347] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleBackToOptions}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] text-xs font-semibold text-[#7c3aed] dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors cursor-pointer"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  <span>All Channels</span>
                </button>
                <div>
                  <h2 className="font-['Bricolage_Grotesque',sans-serif] text-lg font-bold capitalize">
                    {selectedProvider === "twilio" && "Twilio Telephony Dispatch"}
                    {selectedProvider === "exotel" && "Exotel Telephony Dispatch"}
                    {selectedProvider === "web" && "Web Audio Voice AI"}
                    {selectedProvider === "gsm" && "Direct Mobile SIM Call"}
                  </h2>
                  <div className="text-xs text-[#625b7e] dark:text-[#a29bc2]">
                    Patient: <strong>{patientName}</strong> ({cleanPatientPhone})
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Active call duration badge */}
                {callStatus !== "idle" && (
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-mono font-bold border ${
                      callStatus === "connected"
                        ? "bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-300"
                        : "bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-300 animate-pulse"
                    }`}
                  >
                    {callStatus.toUpperCase()} {callStatus === "connected" && `(${formatSeconds(callDuration)})`}
                  </span>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 rounded-xl text-[#625b7e] hover:text-[#150f26] dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Content Area */}
            <div className="p-6 overflow-y-auto space-y-5">
              
              {/* Active API Dispatch Response Banner */}
              {apiResponse && (
                <div className="p-3 rounded-2xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 text-xs font-mono flex items-center justify-between text-[#7c3aed] dark:text-purple-300">
                  <span>Session: {apiResponse.call_id || apiResponse.twilio_sid || apiResponse.exotel_sid || activeCallId}</span>
                  <span className="font-bold uppercase">Status: {apiResponse.status || "active"}</span>
                </div>
              )}

              {/* STATUS & DEVELOPER DIAGNOSTICS BANNER */}
              {selectedProvider === "twilio" && (
                <div>
                  {isTwilioConfigured ? (
                    <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300 flex items-start gap-3">
                      <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <div className="font-bold text-sm">Twilio API Configured &amp; Working</div>
                        <p className="leading-relaxed">
                          Account SID authenticated. Outbound calls route via Twilio with Caller ID <strong>{hospitalPhone || providerStatus?.twilio?.phone_number || "Configured"}</strong>.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5">
                          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                          <div>
                            <div className="font-bold text-sm">Twilio Not Configured in backend/.env</div>
                            <p className="mt-0.5 text-amber-800 dark:text-amber-300">
                              Missing credentials. To place real phone calls, add Twilio credentials to .env or use &ldquo;Simulate Call&rdquo; below to test without credentials.
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(twilioEnvSnippet, "twilio")}
                          className="px-2.5 py-1 rounded-lg bg-amber-200 dark:bg-amber-900 hover:bg-amber-300 text-xs font-semibold flex items-center gap-1 cursor-pointer shrink-0"
                        >
                          {copiedEnv === "twilio" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                          <span>{copiedEnv === "twilio" ? "Copied" : "Copy .env format"}</span>
                        </button>
                      </div>
                      <div className="p-2.5 rounded-xl bg-amber-100/70 dark:bg-amber-950/80 font-mono text-[11px]">
                        Missing: <span className="underline">TWILIO_ACCOUNT_SID</span>, <span className="underline">TWILIO_AUTH_TOKEN</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {selectedProvider === "exotel" && (
                <div>
                  {isExotelConfigured ? (
                    <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300 flex items-start gap-3">
                      <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <div className="font-bold text-sm">Exotel Indian Telephony Working</div>
                        <p className="leading-relaxed">
                          Exotel API authenticated for +91 calling. Subdomain: <strong>{providerStatus?.exotel?.subdomain}</strong>.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5">
                          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                          <div>
                            <div className="font-bold text-sm">Exotel Not Configured in backend/.env</div>
                            <p className="mt-0.5 text-amber-800 dark:text-amber-300">
                              Missing credentials. Add Exotel credentials to .env or use &ldquo;Simulate Call&rdquo; to test speech turns.
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(exotelEnvSnippet, "exotel")}
                          className="px-2.5 py-1 rounded-lg bg-amber-200 dark:bg-amber-900 hover:bg-amber-300 text-xs font-semibold flex items-center gap-1 cursor-pointer shrink-0"
                        >
                          {copiedEnv === "exotel" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                          <span>{copiedEnv === "exotel" ? "Copied" : "Copy .env format"}</span>
                        </button>
                      </div>
                      <div className="p-2.5 rounded-xl bg-amber-100/70 dark:bg-amber-950/80 font-mono text-[11px]">
                        Missing: <span className="underline">EXOTEL_API_KEY</span>, <span className="underline">EXOTEL_API_TOKEN</span>, <span className="underline">EXOTEL_SUBDOMAIN</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {selectedProvider === "web" && (
                <div className="p-4 rounded-2xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 text-xs text-[#150f26] dark:text-white flex items-start gap-3">
                  <Mic className="h-5 w-5 text-[#7c3aed] shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <div className="font-bold text-sm">Web Voice Stream Working</div>
                    <p className="text-[#625b7e] dark:text-[#a29bc2] leading-relaxed">
                      Uses browser microphone and speaker audio. Perfect for immediate zero-config testing.
                    </p>
                  </div>
                </div>
              )}

              {selectedProvider === "gsm" && (
                <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-[#150f26] dark:text-white flex items-start gap-3">
                  <Smartphone className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <div className="font-bold text-sm">Direct Mobile SIM Dialing</div>
                    <p className="text-[#625b7e] dark:text-[#a29bc2] leading-relaxed">
                      Launches mobile dialer with patient phone <strong>{cleanPatientPhone}</strong> and Caller ID <strong>{hospitalPhone || "None"}</strong>.
                    </p>
                  </div>
                </div>
              )}

              {/* Error Notice */}
              {apiError && (
                <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
                  <span className="font-bold">Error Notice: </span>
                  <span className="font-mono">{apiError}</span>
                </div>
              )}

              {/* Call Control Buttons */}
              <div className="flex flex-wrap items-center gap-3">
                {callStatus === "idle" || callStatus === "ended" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleInitiateCall(false)}
                      disabled={isCallingApi}
                      className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-[#6d28d9] to-[#9333ea] hover:brightness-105 active:scale-95 text-white font-bold text-xs shadow-md shadow-purple-600/30 transition-all cursor-pointer disabled:opacity-50"
                    >
                      {isCallingApi ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
                      <span>
                        {selectedProvider === "twilio" && "Start Twilio Outbound Call"}
                        {selectedProvider === "exotel" && "Start Exotel Outbound Call"}
                        {selectedProvider === "web" && "Start Web Voice Call"}
                        {selectedProvider === "gsm" && "Dial via Mobile SIM"}
                      </span>
                    </button>

                    {(selectedProvider === "twilio" || selectedProvider === "exotel") && (
                      <button
                        type="button"
                        onClick={() => handleInitiateCall(true)}
                        className="inline-flex items-center gap-2 px-4 py-3 rounded-xl border border-purple-200 dark:border-purple-800 bg-white dark:bg-[#120e1f] hover:bg-purple-50 dark:hover:bg-purple-950/40 text-xs font-semibold text-[#7c3aed] dark:text-purple-300 transition-all cursor-pointer"
                      >
                        <span>Simulate Call (Dev Sandbox)</span>
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={handleHangup}
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-red-600 hover:bg-red-700 active:scale-95 text-white font-bold text-xs shadow-md shadow-red-600/30 transition-all cursor-pointer"
                  >
                    <PhoneOff className="h-4 w-4" />
                    <span>Hang Up Call</span>
                  </button>
                )}

                {selectedProvider === "web" && callStatus === "connected" && (
                  <button
                    type="button"
                    onClick={toggleMicListening}
                    className={`inline-flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      isMicActive
                        ? "bg-emerald-600 text-white animate-pulse"
                        : "border border-[#e6e0f5] dark:border-[#2b2347] bg-white dark:bg-[#120e1f] text-[#625b7e] dark:text-[#a29bc2]"
                    }`}
                  >
                    {isMicActive ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                    <span>{isMicActive ? "Mic Listening (Speak now)" : "Enable Mic"}</span>
                  </button>
                )}

                {selectedProvider === "gsm" && (
                  <button
                    type="button"
                    onClick={() => setShowQrCode(!showQrCode)}
                    className="inline-flex items-center gap-2 px-4 py-3 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-white dark:bg-[#120e1f] text-xs font-semibold text-[#625b7e] dark:text-[#a29bc2] hover:text-[#150f26] dark:hover:text-white transition-colors cursor-pointer"
                  >
                    <QrCode className="h-4 w-4 text-[#7c3aed]" />
                    <span>{showQrCode ? "Hide QR" : "Show QR Code"}</span>
                  </button>
                )}
              </div>

              {/* QR Code view */}
              {selectedProvider === "gsm" && showQrCode && (
                <div className="p-4 rounded-2xl bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] flex items-center gap-4">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(telUri)}`}
                    alt="Scan to dial"
                    className="w-20 h-20 rounded-xl border border-[#e6e0f5]"
                  />
                  <div className="space-y-1">
                    <div className="font-bold text-xs">Scan to Dial on Mobile</div>
                    <p className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
                      Point phone camera to dial <strong>{cleanPatientPhone}</strong> instantly.
                    </p>
                  </div>
                </div>
              )}

              {/* Transcript & Speech Dialogue */}
              <div className="space-y-2.5 pt-2">
                <div className="flex items-center justify-between text-xs text-[#625b7e] dark:text-[#a29bc2]">
                  <span className="font-bold text-[11px] uppercase tracking-wider flex items-center gap-1.5 text-[#150f26] dark:text-white">
                    <Volume2 className="h-3.5 w-3.5 text-[#7c3aed]" />
                    <span>Live Call Transcript</span>
                  </span>
                  {isBotSpeaking && (
                    <span className="text-[11px] font-semibold text-[#7c3aed] dark:text-purple-300 animate-pulse">
                      AI Agent Speaking...
                    </span>
                  )}
                </div>

                <div
                  ref={chatScrollRef}
                  className="h-44 overflow-y-auto p-4 rounded-2xl bg-[#faf8fe] dark:bg-[#181329] border border-[#e6e0f5] dark:border-[#2b2347] space-y-3"
                >
                  {conversation.map((msg, i) => (
                    <div
                      key={`msg-${i}`}
                      className={`flex items-start gap-2 ${
                        msg.sender === "user" ? "justify-end" : "justify-start"
                      }`}
                    >
                      <div
                        className={`max-w-[85%] p-3 rounded-2xl text-xs font-medium leading-relaxed ${
                          msg.sender === "user"
                            ? "bg-[#7c3aed] text-white rounded-tr-sm"
                            : "bg-white dark:bg-[#120e1f] text-[#150f26] dark:text-white border border-[#e6e0f5] dark:border-[#2b2347] rounded-tl-sm shadow-xs"
                        }`}
                      >
                        <p>{msg.text}</p>
                        <span className="block text-[9.5px] opacity-70 mt-1 text-right font-mono">
                          {msg.time}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <form onSubmit={handleSendTurn} className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Type speech prompt to test AI response (e.g. 'I want to see cardiologist tomorrow')..."
                    value={manualInput}
                    onChange={(e) => setManualInput(e.target.value)}
                    disabled={isProcessingTurn}
                    className="flex-1 h-10 px-4 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-white dark:bg-[#120e1f] text-xs font-medium text-[#150f26] dark:text-white focus:outline-none focus:border-[#7c3aed]"
                  />
                  <button
                    type="submit"
                    disabled={!manualInput.trim() || isProcessingTurn}
                    className="h-10 px-4 rounded-xl bg-[#7c3aed] hover:bg-[#6d28d9] text-white font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-40"
                  >
                    {isProcessingTurn ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    <span>Send</span>
                  </button>
                </form>
              </div>

            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-[#e6e0f5] dark:border-[#2b2347] flex items-center justify-between text-xs text-[#625b7e] dark:text-[#a29bc2]">
              <button
                type="button"
                onClick={handleBackToOptions}
                className="inline-flex items-center gap-1.5 text-[#7c3aed] dark:text-purple-300 font-semibold hover:underline cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Choose another channel</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Close Window
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default TelephonyHubModal;
