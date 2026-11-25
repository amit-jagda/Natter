import React, { useState, useEffect, useRef } from "react";
import {
  Smartphone,
  Phone,
  PhoneOff,
  Zap,
  Building2,
  Send,
  Loader2,
  CheckCircle2,
  Radio,
  QrCode,
  AlertCircle,
  X,
  Volume2,
  Sparkles,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";

export interface GsmCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  patientName: string;
  patientPhone: string;
  hospitalPhone: string;
  patientId?: string;
  onSwitchToWebRTC?: () => void;
}

export const GsmCallModal: React.FC<GsmCallModalProps> = ({
  isOpen,
  onClose,
  patientName,
  patientPhone,
  hospitalPhone,
  patientId: _patientId,
  onSwitchToWebRTC,
}) => {
  const [callStatus, setCallStatus] = useState<"dialing" | "ringing" | "connected" | "ended">("dialing");
  const [activeCallId, setActiveCallId] = useState<string>("");
  const [duration, setDuration] = useState(0);
  const [isBotSpeaking, setIsBotSpeaking] = useState(false);
  const [conversation, setConversation] = useState<Array<{ sender: "bot" | "user"; text: string; interrupted?: boolean }>>([]);
  const [interruptionCount, setInterruptionCount] = useState(0);
  const [manualInput, setManualInput] = useState("");
  const [isProcessingTurn, setIsProcessingTurn] = useState(false);
  const [gatewayStatus, setGatewayStatus] = useState<any>(null);
  const [showPairingCard, setShowPairingCard] = useState(false);
  const [isTwilioCalling, setIsTwilioCalling] = useState(false);
  const [twilioCallInfo, setTwilioCallInfo] = useState<any>(null);
  const [_providerStatus, setProviderStatus] = useState<any>(null);
  const [selectedProvider, setSelectedProvider] = useState<"exotel" | "twilio">("exotel");

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const statusPollRef = useRef<NodeJS.Timeout | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<any>(null);

  // Auto-scroll transcript to bottom
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [conversation]);

  // Clean up
  const cleanupCall = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (statusPollRef.current) {
      clearInterval(statusPollRef.current);
      statusPollRef.current = null;
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore stop error
      }
      recognitionRef.current = null;
    }
  };

  // Bot Speech Synthesis with fast interruption detection
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

  // Instant Interruption (Barge-in) Handler
  const handleUserInterruption = () => {
    if (isBotSpeaking) {
      window.speechSynthesis?.cancel();
      setIsBotSpeaking(false);
      setInterruptionCount((prev) => prev + 1);

      setConversation((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.sender === "bot" && !last.interrupted) {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...last,
            interrupted: true,
            text: last.text + " [Interrupted by Caller ⚡]",
          };
          return updated;
        }
        return prev;
      });
    }
  };

  // Send turn to GSM Chat Turn API
  const handleSendTurn = async (userText: string) => {
    const trimmed = userText.trim();
    if (!trimmed || isProcessingTurn) return;

    handleUserInterruption();
    setConversation((prev) => [...prev, { sender: "user", text: trimmed }]);
    setManualInput("");
    setIsProcessingTurn(true);

    try {
      const callSessionId = activeCallId || `temp_gsm_${Date.now()}`;
      const res = await apiClient.post<{ reply: string }>("/api/v1/gsm/chat-turn", {
        call_id: callSessionId,
        message: trimmed,
      });

      const botReply = res.reply;
      setConversation((prev) => [...prev, { sender: "bot", text: botReply }]);
      speakBotMessage(botReply);
    } catch (err) {
      console.warn("GSM chat turn notice:", err);
      const fallback = "I have noted that. How else can our hospital care team help you today?";
      setConversation((prev) => [...prev, { sender: "bot", text: fallback }]);
      speakBotMessage(fallback);
    } finally {
      setIsProcessingTurn(false);
    }
  };

  // Start Web Speech Recognition if available for real-time barge-in
  const startSpeechRecognition = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) return;

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-IN";

      recognition.onstart = () => {};

      recognition.onresult = (event: any) => {
        let interimTranscript = "";
        let finalTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }

        // When user speaks interim speech while bot is talking -> immediate barge-in!
        if (interimTranscript.length > 2) {
          handleUserInterruption();
        }

        if (finalTranscript.trim().length > 0) {
          handleSendTurn(finalTranscript);
        }
      };

      recognition.onerror = (e: any) => {
        if (e.error !== "no-speech") {
          console.warn("GSM Speech recognition notice:", e.error);
        }
      };

      recognition.onend = () => {
        // Restart speech recognition if call is still active
        if (callStatus === "connected") {
          try {
            recognition.start();
          } catch {
            // Ignore re-start collisions
          }
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch (err) {
      console.warn("GSM Speech recognition initialization error:", err);
    }
  };

  // Initialize GSM Outbound Call
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    setCallStatus("dialing");
    setDuration(0);
    setInterruptionCount(0);

    const initGsmDial = async () => {
      try {
        // Query gateway device status & cloud telephony provider status
        const gw = await apiClient.get<any>("/api/v1/gsm/status");
        if (isMounted) setGatewayStatus(gw);

        apiClient.get<any>("/api/v1/telephony/provider-status")
          .then((p) => {
            if (isMounted) {
              setProviderStatus(p);
              if (p?.active_provider) {
                setSelectedProvider(p.active_provider.toLowerCase() === "twilio" ? "twilio" : "exotel");
              }
            }
          })
          .catch(() => {});

        // Dispatch outbound SIM call via backend
        const dialRes = await apiClient.post<any>("/api/v1/gsm/dial", {
          patient_name: patientName,
          patient_phone: patientPhone,
          hospital_phone: hospitalPhone,
        });

        if (!isMounted) return;
        const callId = dialRes.call_id;
        setActiveCallId(callId);

        const greeting = dialRes.initial_greeting;
        setConversation([{ sender: "bot", text: greeting }]);

        // Progression 1: Dialing (0-1.5s) -> Ringing
        setTimeout(() => {
          if (isMounted) setCallStatus("ringing");
        }, 1500);

        // Progression 2: Ringing (1.5-3.5s) -> Connected to Patient
        setTimeout(() => {
          if (!isMounted) return;
          setCallStatus("connected");

          // Start duration timer
          timerRef.current = setInterval(() => {
            setDuration((prev) => prev + 1);
          }, 1000);

          // Speak initial greeting to caller
          speakBotMessage(greeting);

          // Initialize Web Speech Recognition for voice barge-in
          startSpeechRecognition();
        }, 3500);
      } catch (err) {
        console.error("GSM call dispatch error:", err);
      }
    };

    initGsmDial();

    return () => {
      isMounted = false;
      cleanupCall();
    };
  }, [isOpen]);

  // Hang Up Call
  const handleHangUp = async () => {
    setCallStatus("ended");
    cleanupCall();

    try {
      if (activeCallId) {
        await apiClient.post("/api/v1/gsm/event", {
          call_id: activeCallId,
          event: "ended",
          duration_sec: duration,
        });
      }
    } catch (err) {
      console.warn("Error reporting GSM end event:", err);
    }

    setTimeout(() => {
      onClose();
    }, 900);
  };

  // Format Duration (mm:ss)
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Direct physical cellular trigger via Windows Phone Link / mobile browser
  const handleDirectCellularDial = () => {
    window.open(`tel:${patientPhone}`, "_self");
  };

  // Dispatch direct carrier call via configured Cloud Provider (Twilio or Exotel)
  const handleDispatchCloudCall = async () => {
    setIsTwilioCalling(true);
    try {
      const res = await apiClient.post<any>("/api/v1/telephony/dispatch-call", {
        patient_name: patientName,
        patient_phone: patientPhone,
        hospital_phone: hospitalPhone,
        provider: selectedProvider,
      });
      setTwilioCallInfo(res);
      if (res.configured && res.status !== "failed" && res.status !== "error") {
        setCallStatus("dialing");
        setTimeout(() => setCallStatus("ringing"), 1500);
      }
    } catch (err: any) {
      console.error("Cloud call dispatch error:", err);
      setTwilioCallInfo({
        configured: false,
        message: err?.response?.data?.detail || "Could not connect to telephony service",
      });
    } finally {
      setIsTwilioCalling(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-5xl rounded-[28px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header Bar */}
        <div className="px-6 py-4 border-b border-[#e6e0f5] dark:border-[#2b2347] flex items-center justify-between shrink-0 bg-[#faf8fe] dark:bg-[#16112a]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#7c3aed] to-[#9333ea] text-white grid place-items-center shadow-md shadow-purple-600/30">
              <Phone className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-['Bricolage_Grotesque',sans-serif] text-base sm:text-lg font-bold text-[#150f26] dark:text-white leading-tight">
                  Hospital Voice AI Call • {patientName}
                </h3>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1">
                  <Radio className="h-2.5 w-2.5 text-emerald-600 animate-pulse" />
                  <span>SIM Bridge</span>
                </span>
              </div>
              <p className="text-xs text-[#625b7e] dark:text-[#a29bc2]">
                Patient cellular dial &amp; real-time conversational AI bridge
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Status & Timer */}
            <div className="text-right">
              {callStatus === "dialing" && (
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-purple-50 dark:bg-purple-950/40 text-[#7c3aed] dark:text-purple-300 animate-pulse">
                  SIM Dialing...
                </span>
              )}
              {callStatus === "ringing" && (
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 animate-pulse">
                  Patient Ringing...
                </span>
              )}
              {callStatus === "connected" && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-mono text-xs font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                  <span>{formatTime(duration)}</span>
                </span>
              )}
              {callStatus === "ended" && (
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-red-50 dark:bg-red-950/40 text-red-500">
                  Call Ended
                </span>
              )}
            </div>

            {/* Close Button */}
            <button
              type="button"
              onClick={handleHangUp}
              className="w-8 h-8 rounded-full border border-[#e6e0f5] dark:border-[#2b2347] bg-white dark:bg-[#1a1435] text-[#625b7e] hover:text-[#150f26] dark:hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* 2-Column Split Body */}
        <div className="flex-1 overflow-y-auto p-6 sm:p-7 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT COLUMN: Patient & Telecom Dispatch Actions (6 cols) */}
          <div className="lg:col-span-6 space-y-4">

        {/* Calling Card: Hospital SIM Number -> Patient Number */}
        <div className="p-4 rounded-2xl bg-[#faf8fe] dark:bg-[#16112a] border border-[#e6e0f5] dark:border-[#2b2347] space-y-3">
          <div className="flex items-center justify-between text-xs text-[#625b7e] dark:text-[#a29bc2]">
            <div className="flex items-center gap-1.5 font-medium">
              <Building2 className="h-3.5 w-3.5 text-[#7c3aed]" />
              <span>Hospital SIM (Caller ID):</span>
            </div>
            <span className="font-mono font-bold text-[#150f26] dark:text-white">
              {hospitalPhone || "9328291692"}
            </span>
          </div>

          <div className="h-px bg-[#e6e0f5] dark:bg-[#2b2347]" />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-purple-100 dark:bg-purple-950/70 text-[#7c3aed] dark:text-purple-300 font-bold grid place-items-center text-sm shrink-0">
                {patientName.charAt(0).toUpperCase() || "P"}
              </div>
              <div>
                <h4 className="font-bold text-sm text-[#150f26] dark:text-white leading-tight">
                  {patientName}
                </h4>
                <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] font-mono mt-0.5 font-semibold">
                  {patientPhone}
                </p>
              </div>
            </div>

            <div className="text-right flex flex-col items-end gap-1">
              <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] text-[#150f26] dark:text-white">
                GSM SIM Bridge
              </span>
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                <span>Zero Cost</span>
              </span>
            </div>
          </div>
        </div>

        {/* Direct Physical Cellular Dial Action & Guidance */}
        <div className="space-y-2.5">
          {/* Cloud Carrier Call Option (Exotel & Twilio Switchable) */}
          <div className="p-3.5 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-bold text-xs text-indigo-900 dark:text-indigo-200">
                <Radio className="h-3.5 w-3.5 text-indigo-600 animate-pulse" />
                <span>Cloud Carrier Calling</span>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-md font-bold bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300">
                {selectedProvider === "exotel" ? "Exotel (India SIM)" : "Twilio"}
              </span>
            </div>

            {/* Provider Switcher Selector */}
            <div className="grid grid-cols-2 p-0.5 rounded-xl bg-white dark:bg-[#1a1435] border border-indigo-200 dark:border-indigo-800">
              <button
                type="button"
                onClick={() => setSelectedProvider("exotel")}
                className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition-all cursor-pointer text-center ${
                  selectedProvider === "exotel"
                    ? "bg-indigo-600 text-white shadow-xs font-bold"
                    : "text-indigo-900 dark:text-indigo-200 hover:text-indigo-600"
                }`}
              >
                🇮🇳 Exotel (India SIM)
              </button>
              <button
                type="button"
                onClick={() => setSelectedProvider("twilio")}
                className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition-all cursor-pointer text-center ${
                  selectedProvider === "twilio"
                    ? "bg-indigo-600 text-white shadow-xs font-bold"
                    : "text-indigo-900 dark:text-indigo-200 hover:text-indigo-600"
                }`}
              >
                🌐 Twilio Cloud
              </button>
            </div>

            <button
              type="button"
              onClick={handleDispatchCloudCall}
              disabled={isTwilioCalling}
              className="w-full py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer disabled:opacity-50"
            >
              {isTwilioCalling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
              <span>{isTwilioCalling ? `Calling via ${selectedProvider === "exotel" ? "Exotel" : "Twilio"}...` : `Call ${patientName}'s Phone via ${selectedProvider === "exotel" ? "Exotel (India)" : "Twilio"}`}</span>
            </button>

            {twilioCallInfo && (!twilioCallInfo.configured || twilioCallInfo.status === "failed" || twilioCallInfo.status === "error") && (
              <div className="p-2.5 rounded-xl bg-amber-100/80 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-700 text-[10.5px] text-amber-900 dark:text-amber-200 space-y-1">
                <p className="font-bold flex items-center gap-1 text-amber-800 dark:text-amber-300">
                  <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                  <span>{selectedProvider === "exotel" ? "Exotel Telecom Notice:" : "Twilio Telecom Notice:"}</span>
                </p>
                <p className="font-mono text-[9.5px] leading-relaxed break-words">{twilioCallInfo.message || twilioCallInfo.error || twilioCallInfo.status}</p>
                {selectedProvider === "exotel" && (twilioCallInfo.message?.toLowerCase().includes("kyc") || twilioCallInfo.error?.toLowerCase().includes("kyc")) && (
                  <p className="text-[10px] text-amber-800 dark:text-amber-300 font-sans mt-1">
                    ℹ Under TRAI telecom rules, Exotel requires KYC document submission on my.exotel.com to place cloud calls. In the meantime, use the green <strong>"Ring via Phone Link / SIM"</strong> button below to dial immediately from your SIM!
                  </p>
                )}
                {selectedProvider === "twilio" && (twilioCallInfo.message?.toLowerCase().includes("trial") || twilioCallInfo.error?.toLowerCase().includes("trial")) && (
                  <p className="text-[10px] text-amber-800 dark:text-amber-300 font-sans mt-1">
                    ℹ Twilio trial account only dials verified numbers. Use the green <strong>"Ring via Phone Link / SIM"</strong> button below to dial freely without restrictions!
                  </p>
                )}
              </div>
            )}

            {twilioCallInfo && twilioCallInfo.configured && twilioCallInfo.status !== "failed" && twilioCallInfo.status !== "error" && (
              <div className="p-2 rounded-xl bg-emerald-100/70 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-700 text-[10px] text-emerald-900 dark:text-emerald-200 flex items-center justify-between">
                <span>{selectedProvider === "exotel" ? "Exotel" : "Twilio"} Call: <strong className="font-mono">{twilioCallInfo.exotel_sid || twilioCallInfo.twilio_sid || twilioCallInfo.call_id}</strong></span>
                <span className="capitalize font-bold text-emerald-700 dark:text-emerald-300">● {twilioCallInfo.status}</span>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleDirectCellularDial}
            className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer"
          >
            <Phone className="h-4 w-4" />
            <span>Ring Patient's Physical Phone Now (via Phone Link / SIM: {patientPhone})</span>
          </button>

          <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-800 dark:text-amber-300 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
            <div>
              <p className="font-semibold">Patient ke real phone par ring lane ke liye:</p>
              <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5 leading-relaxed">
                Laptop ke paas SIM slot nahi hota. Upar {selectedProvider === "exotel" ? "Exotel" : "Twilio"} button se direct telecom call karein, ya Phone Link (Windows) se hospital mobile SIM se dial karein.
              </p>
            </div>
          </div>
        </div>

            {/* Call Progression Indicator */}
            <div className="p-3.5 rounded-2xl bg-[#fcfaff] dark:bg-white/5 border border-[#e6e0f5] dark:border-[#2b2347] text-xs">
              <div className="flex items-center justify-between text-[11px] font-semibold text-[#625b7e] dark:text-[#a29bc2]">
                <span className={callStatus === "dialing" ? "text-[#7c3aed] font-bold" : ""}>
                  1. SIM Dialing
                </span>
                <span>➔</span>
                <span className={callStatus === "ringing" ? "text-[#7c3aed] font-bold" : ""}>
                  2. Phone Ringing
                </span>
                <span>➔</span>
                <span className={callStatus === "connected" ? "text-emerald-600 font-bold" : ""}>
                  3. Connected to AI
                </span>
              </div>
            </div>

            {/* Android Phone Gateway Status Footer */}
            <div className="p-3 rounded-2xl bg-[#faf8fe] dark:bg-[#16112a] border border-[#e6e0f5] dark:border-[#2b2347] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 font-semibold text-[#150f26] dark:text-white">
                  <Smartphone className="h-4 w-4 text-emerald-600" />
                  <span>Hospital Phone: {gatewayStatus?.device_name || "Hospital Android Phone"}</span>
                </div>
                <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                  ● Online (SIM: {hospitalPhone})
                </span>
              </div>

              <div className="flex items-center justify-between text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
                <button
                  type="button"
                  onClick={() => setShowPairingCard(!showPairingCard)}
                  className="text-[#7c3aed] font-semibold hover:underline cursor-pointer flex items-center gap-1"
                >
                  <QrCode className="h-3.5 w-3.5" />
                  <span>{showPairingCard ? "Hide Gateway Info" : "Gateway Connection Info"}</span>
                </button>

                {onSwitchToWebRTC && (
                  <button
                    type="button"
                    onClick={onSwitchToWebRTC}
                    className="text-[#625b7e] hover:text-[#7c3aed] cursor-pointer"
                  >
                    Switch to WebRTC
                  </button>
                )}
              </div>

              {showPairingCard && (
                <div className="pt-2 border-t border-[#e6e0f5] dark:border-[#2b2347] text-[11px] space-y-1 text-[#625b7e] dark:text-[#a29bc2]">
                  <p>• <strong>SIM Number:</strong> {hospitalPhone} (Caller ID)</p>
                  <p>• <strong>API Heartbeat:</strong> <code>/api/v1/gsm/heartbeat</code></p>
                  <p>• <strong>Cost:</strong> ₹0 (Aapke phone ke SIM pack se dial hota hai)</p>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN: Voice Visualizer, Barge-in & Live Chat (6 cols) */}
          <div className="lg:col-span-6 space-y-4 flex flex-col justify-between h-full">
            {/* Voice Visualizer Avatar Card */}
            <div className="p-4 rounded-2xl bg-[#faf8fe] dark:bg-[#16112a] border border-[#e6e0f5] dark:border-[#2b2347] flex flex-col items-center justify-center space-y-3 relative overflow-hidden">
              <div className="relative grid place-items-center py-2">
                {/* Outer Pulsing Wave Rings */}
                {isBotSpeaking && (
                  <div className="absolute w-24 h-24 rounded-full bg-purple-500/20 dark:bg-purple-500/30 animate-ping" />
                )}

                {/* Center Visualizer Avatar */}
                <div
                  className={`relative z-10 w-16 h-16 rounded-full grid place-items-center shadow-lg transition-all duration-300 ${
                    isBotSpeaking
                      ? "bg-gradient-to-tr from-[#6d28d9] to-[#9333ea] text-white scale-105 ring-4 ring-purple-300 dark:ring-purple-900"
                      : "bg-white dark:bg-[#1a1435] text-[#7c3aed] border-2 border-[#e6e0f5] dark:border-[#2b2347]"
                  }`}
                >
                  {isBotSpeaking ? (
                    <Volume2 className="h-7 w-7 animate-pulse" />
                  ) : (
                    <Sparkles className="h-7 w-7 text-[#7c3aed]" />
                  )}
                </div>
              </div>

              <div className="text-center space-y-1">
                <p className="text-xs font-bold text-[#150f26] dark:text-white">
                  {isBotSpeaking
                    ? "AI Assistant Speaking (Speak to Interrupt)..."
                    : "Microphone Active • Listening for Patient Speech..."}
                </p>
              </div>

              {/* Barge-in Bar */}
              <div className="flex items-center gap-2 pt-1">
                <span
                  className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 flex items-center gap-1"
                  title="Voice barge-in: Speaking interrupts the bot immediately"
                >
                  <Zap className="h-3 w-3 text-amber-500 fill-amber-500" />
                  <span>Barge-in: {interruptionCount}</span>
                </span>

                {isBotSpeaking && (
                  <button
                    type="button"
                    onClick={handleUserInterruption}
                    className="px-3 py-1 rounded-full text-[10px] font-bold bg-amber-500 hover:bg-amber-600 text-white flex items-center gap-1.5 shadow-md shadow-amber-500/20 animate-pulse cursor-pointer transition-all"
                    title="Click to interrupt bot immediately"
                  >
                    <Zap className="h-3 w-3 fill-white" />
                    <span>Interrupt Bot ⚡</span>
                  </button>
                )}
              </div>
            </div>

            {/* Live Conversation Transcript Preview */}
            <div
              ref={chatScrollRef}
              className="p-3.5 rounded-2xl bg-[#faf8fe] dark:bg-[#16112a] border border-[#e6e0f5] dark:border-[#2b2347] h-52 overflow-y-auto space-y-2 text-xs"
            >
              {conversation.map((msg, idx) => (
                <div
                  key={idx}
                  className={`p-2.5 rounded-xl leading-relaxed ${
                    msg.sender === "bot"
                      ? msg.interrupted
                        ? "bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[#150f26] dark:text-white"
                        : "bg-purple-100/60 dark:bg-purple-950/50 text-[#150f26] dark:text-white"
                      : "bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] text-[#150f26] dark:text-white shadow-xs"
                  }`}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <strong className={msg.sender === "bot" ? "text-[#7c3aed]" : "text-emerald-600"}>
                      {msg.sender === "bot" ? "Hospital Voice AI: " : `Patient (${patientName}): `}
                    </strong>
                    {msg.interrupted && (
                      <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400">
                        Interrupted ⚡
                      </span>
                    )}
                  </div>
                  <p className="text-[11px]">{msg.text}</p>
                </div>
              ))}
              {isProcessingTurn && (
                <div className="flex items-center gap-2 text-xs text-[#7c3aed] py-1">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>AI is thinking...</span>
                </div>
              )}
            </div>

            {/* Quick Test Chips & Speech Input */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-semibold text-[#625b7e] dark:text-[#a29bc2]">Patient Reply:</span>
                {[
                  "I want to book an appointment",
                  "What are doctor timings?",
                  "Can I consult today?",
                ].map((quickText, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSendTurn(quickText)}
                    className="px-2.5 py-1 rounded-lg text-[10px] font-medium bg-purple-50 dark:bg-purple-950/40 text-[#7c3aed] dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors cursor-pointer"
                  >
                    {quickText}
                  </button>
                ))}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendTurn(manualInput);
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={manualInput}
                  onChange={(e) => {
                    setManualInput(e.target.value);
                    if (isBotSpeaking && e.target.value.length > 0) {
                      handleUserInterruption();
                    }
                  }}
                  placeholder="Type speech input here to test AI voice response..."
                  className="flex-1 px-3 py-2 text-xs rounded-xl bg-[#faf8fe] dark:bg-[#16112a] border border-[#e6e0f5] dark:border-[#2b2347] text-[#150f26] dark:text-white placeholder:text-[#a29bc2] focus:outline-none focus:border-[#7c3aed]"
                />
                <button
                  type="submit"
                  disabled={!manualInput.trim() || isProcessingTurn}
                  className="p-2.5 rounded-xl bg-[#7c3aed] hover:bg-[#6d28d9] text-white disabled:opacity-40 transition-colors cursor-pointer shadow-sm"
                  title="Send speech input"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </form>
            </div>

            {/* Bottom Hang Up Button */}
            <div className="pt-1">
              <button
                type="button"
                onClick={handleHangUp}
                className="w-full py-3 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs shadow-lg shadow-red-600/30 transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                <PhoneOff className="h-4 w-4" />
                <span>End Call Session</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GsmCallModal;
