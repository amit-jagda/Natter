import React, { useState, useEffect, useRef } from "react";
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Volume2,
  Sparkles,
  Zap,
  Building2,
  Send,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { Room, RoomEvent, Track, RemoteTrack, RemoteParticipant } from "livekit-client";
import { apiClient } from "@/lib/api-client";

export interface LiveKitCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  direction: "outbound" | "inbound";
  patientName: string;
  patientPhone: string;
  hospitalPhone?: string;
  patientId?: string;
  callId?: string;
  roomName?: string;
  token?: string;
  serverUrl?: string;
  initialGreeting?: string;
}

export const LiveKitCallModal: React.FC<LiveKitCallModalProps> = ({
  isOpen,
  onClose,
  direction,
  patientName,
  patientPhone,
  hospitalPhone: initialHospitalPhone,
  patientId,
  callId: propCallId,
  roomName: _propRoomName,
  token: propToken,
  serverUrl: propServerUrl = "ws://localhost:7880",
  initialGreeting: propGreeting,
}) => {
  const [callStatus, setCallStatus] = useState<"connecting" | "ringing" | "connected" | "ended">("connecting");
  const [activeCallId, setActiveCallId] = useState<string>(propCallId || "");
  const [hospitalPhone, setHospitalPhone] = useState<string>(initialHospitalPhone || "+91 98765 43210");
  const [isMuted, setIsMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [isBotSpeaking, setIsBotSpeaking] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [conversation, setConversation] = useState<Array<{ sender: "bot" | "user"; text: string; interrupted?: boolean }>>([]);
  const [interruptionCount, setInterruptionCount] = useState(0);
  const [manualInput, setManualInput] = useState("");
  const [isProcessingTurn, setIsProcessingTurn] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);

  const roomRef = useRef<Room | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll transcript to bottom
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [conversation]);

  // Clean up all WebRTC, audio, and speech recognition
  const cleanupCall = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
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
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
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

      // Tag the last bot message as interrupted in transcript
      setConversation((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.sender === "bot" && !last.interrupted) {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...last,
            interrupted: true,
            text: last.text + " [Interrupted by Caller]",
          };
          return updated;
        }
        return prev;
      });
    }
  };

  // Process human turn (Speech or Quick text)
  const handleSendTurn = async (userText: string) => {
    const trimmed = userText.trim();
    if (!trimmed || isProcessingTurn) return;

    // Immediately stop bot if it is speaking
    handleUserInterruption();

    setConversation((prev) => [...prev, { sender: "user", text: trimmed }]);
    setManualInput("");
    setIsProcessingTurn(true);

    try {
      const callSessionId = activeCallId || `temp_${Date.now()}`;
      const res = await apiClient.post<{ reply: string }>("/api/v1/telephony/chat-turn", {
        call_id: callSessionId,
        message: trimmed,
      });

      const botReply = res.reply;
      setConversation((prev) => [...prev, { sender: "bot", text: botReply }]);
      speakBotMessage(botReply);
    } catch (err) {
      console.warn("Telephony chat turn error, fallback to receptionist reply:", err);
      const fallbackReply =
        "Thank you. I have recorded your request. Our hospital care coordinator will be in touch shortly.";
      setConversation((prev) => [...prev, { sender: "bot", text: fallbackReply }]);
      speakBotMessage(fallbackReply);
    } finally {
      setIsProcessingTurn(false);
    }
  };

  // Start Web Speech Recognition if available
  const startSpeechRecognition = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) return;

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-IN";

      recognition.onstart = () => {
        // Recognition started
      };

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
          setIsUserSpeaking(true);
          handleUserInterruption();
        }

        if (finalTranscript.trim().length > 0) {
          setIsUserSpeaking(false);
          handleSendTurn(finalTranscript);
        }
      };

      recognition.onerror = (e: any) => {
        if (e.error !== "no-speech") {
          console.warn("Speech recognition notice:", e.error);
        }
      };

      recognition.onend = () => {
        // Restart speech recognition if call is still active
        if (callStatus === "connected" && !isMuted) {
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
      console.warn("Speech recognition initialization error:", err);
    }
  };

  // Initialize Call & LiveKit Room
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    setCallStatus("connecting");
    setDuration(0);
    setInterruptionCount(0);

    const initCall = async () => {
      let callToken = propToken;
      let effectiveCallId = propCallId || "";
      let effectiveServerUrl = propServerUrl;
      let greeting = propGreeting;

      // 1. If token is not provided, initialize via Telephony API
      if (!callToken) {
        try {
          if (direction === "outbound") {
            const outRes = await apiClient.post<any>("/api/v1/telephony/outbound-call", {
              patient_name: patientName,
              patient_phone: patientPhone,
              patient_id: patientId || null,
              hospital_phone: initialHospitalPhone || null,
            });
            callToken = outRes.token;
            effectiveCallId = outRes.call_id;
            effectiveServerUrl = outRes.server_url || propServerUrl;
            greeting = outRes.initial_greeting;
            if (outRes.hospital_phone) setHospitalPhone(outRes.hospital_phone);
          } else {
            const inRes = await apiClient.post<any>("/api/v1/telephony/inbound-call", {
              caller_phone: patientPhone,
              hospital_phone: initialHospitalPhone || null,
            });
            callToken = inRes.token;
            effectiveCallId = inRes.call_id;
            effectiveServerUrl = inRes.server_url || propServerUrl;
            greeting = inRes.initial_greeting;
            if (inRes.hospital_phone) setHospitalPhone(inRes.hospital_phone);
          }
          if (isMounted) {
            setActiveCallId(effectiveCallId);
          }
        } catch (err: any) {
          console.warn("Backend telephony init failed:", err);
          const errMsg =
            err?.message ||
            err?.detail ||
            "Hospital phone number is not configured in Hospital Profile. Please configure your hospital phone number in Hospital Profile first.";
          if (isMounted) {
            setCallError(errMsg);
            setCallStatus("ended");
          }
          return;
        }
      }

      if (!isMounted) return;

      const initialMessageText =
        greeting ||
        (direction === "outbound"
          ? `Hello ${patientName}, this is the Hospital AI Assistant calling from ${hospitalPhone} regarding your medical appointments. How can I help you today?`
          : `Thank you for calling Hospital Reception. I am the Voice AI Agent. How may I assist you?`);

      setConversation([{ sender: "bot", text: initialMessageText }]);

      // Transition to ringing
      setCallStatus("ringing");

      // Connect after 1.5s ringing simulation
      setTimeout(async () => {
        if (!isMounted) return;
        setCallStatus("connected");

        // Start duration counter
        timerRef.current = setInterval(() => {
          setDuration((prev) => prev + 1);
        }, 1000);

        // Speak initial greeting
        speakBotMessage(initialMessageText);

        // Connect LiveKit WebRTC room if token available
        if (callToken && effectiveServerUrl) {
          try {
            const room = new Room({
              adaptiveStream: true,
              dynacast: true,
              audioCaptureDefaults: {
                autoGainControl: true,
                echoCancellation: true,
                noiseSuppression: true,
              },
            });
            roomRef.current = room;

            room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, _participant: RemoteParticipant) => {
              if (track.kind === Track.Kind.Audio) {
                const element = track.attach();
                document.body.appendChild(element);
              }
            });

            await room.connect(effectiveServerUrl, callToken);
            await room.localParticipant.setMicrophoneEnabled(true);
          } catch (err) {
            console.warn("LiveKit server connect notice (continuing with local WebRTC audio):", err);
          }
        }

        // Initialize local VAD & Speech Recognition
        startLocalVAD();
        startSpeechRecognition();
      }, 1500);
    };

    initCall();

    return () => {
      isMounted = false;
      cleanupCall();
    };
  }, [isOpen]);

  // Local Voice Activity Detector (VAD) via Web Audio API AnalyserNode
  const startLocalVAD = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const checkVolume = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;

        // Human voice threshold (>16 on frequency amplitude)
        if (average > 16) {
          setIsUserSpeaking(true);
          handleUserInterruption();
        } else {
          setIsUserSpeaking(false);
        }

        requestAnimationFrame(checkVolume);
      };
      checkVolume();
    } catch (err) {
      console.warn("Microphone access for VAD not available, fallback to manual voice input:", err);
    }
  };

  // Hang Up Call
  const handleHangUp = async () => {
    setCallStatus("ended");
    cleanupCall();

    try {
      if (activeCallId) {
        await apiClient.post("/api/v1/telephony/end-call", { call_id: activeCallId });
      }
    } catch (err) {
      console.error("Error ending call session:", err);
    }

    setTimeout(() => {
      onClose();
    }, 900);
  };

  // Toggle Mute
  const handleToggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    if (roomRef.current?.localParticipant) {
      roomRef.current.localParticipant.setMicrophoneEnabled(!next);
    }
    if (micStreamRef.current) {
      micStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = !next));
    }
  };

  // Format Duration (mm:ss)
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-[28px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-2xl overflow-hidden p-6 sm:p-7 space-y-5">
        {/* Top Header Badge */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={`px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 ${
                direction === "outbound"
                  ? "bg-purple-100 dark:bg-purple-950/70 text-[#7c3aed] dark:text-purple-300 border border-purple-200 dark:border-purple-800"
                  : "bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
              }`}
            >
              <Phone className="h-3 w-3" />
              <span>{direction === "outbound" ? "Outbound Call" : "Inbound Call"}</span>
            </span>

            {/* Barge-in Interruption Active Badge */}
            <span
              className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 flex items-center gap-1"
              title="Voice barge-in: Speaking into your microphone immediately interrupts the bot"
            >
              <Zap className="h-3 w-3 text-amber-500 fill-amber-500" />
              <span>Barge-in: {interruptionCount} Interrupted</span>
            </span>

            {isBotSpeaking && (
              <button
                type="button"
                onClick={handleUserInterruption}
                className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-500 hover:bg-amber-600 text-white flex items-center gap-1 shadow-sm animate-pulse cursor-pointer transition-all"
                title="Click to interrupt bot immediately"
              >
                <Zap className="h-3 w-3 fill-white" />
                <span>Interrupt Bot ⚡</span>
              </button>
            )}
          </div>

          {/* Call Status / Timer */}
          <div className="text-right">
            {callStatus === "connecting" && (
              <span className="text-xs font-semibold text-[#8b84a6] dark:text-[#7a7299] animate-pulse">
                Dialing...
              </span>
            )}
            {callStatus === "ringing" && (
              <span className="text-xs font-semibold text-[#7c3aed] dark:text-purple-300 animate-pulse">
                Ringing...
              </span>
            )}
            {callStatus === "connected" && (
              <span className="inline-flex items-center gap-1.5 font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                <span>{formatTime(duration)}</span>
              </span>
            )}
            {callStatus === "ended" && (
              <span className="text-xs font-bold text-red-500">Call Ended</span>
            )}
          </div>
        </div>

        {/* Missing Hospital Profile Phone Warning */}
        {callError && (
          <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 space-y-2">
            <div className="flex items-center gap-2 font-bold text-xs">
              <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>Hospital Profile Phone Required</span>
            </div>
            <p className="text-xs leading-relaxed">{callError}</p>
            <div className="pt-1">
              <button
                type="button"
                onClick={onClose}
                className="w-full py-2.5 rounded-xl text-xs font-semibold bg-[#7c3aed] hover:bg-[#6d28d9] text-white transition-colors cursor-pointer"
              >
                Close & Configure in Hospital Profile
              </button>
            </div>
          </div>
        )}

        {/* Center Calling Card (Caller ID & Patient) */}
        <div className="p-4 rounded-2xl bg-[#faf8fe] dark:bg-[#16112a] border border-[#e6e0f5] dark:border-[#2b2347] space-y-3">
          <div className="flex items-center justify-between text-xs text-[#625b7e] dark:text-[#a29bc2]">
            <div className="flex items-center gap-1.5 font-medium">
              <Building2 className="h-3.5 w-3.5 text-[#7c3aed]" />
              <span>Hospital Phone (Caller ID):</span>
            </div>
            <span className="font-mono font-bold text-[#150f26] dark:text-white">
              {hospitalPhone}
            </span>
          </div>

          <div className="h-px bg-[#e6e0f5] dark:bg-[#2b2347]" />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-purple-100 dark:bg-purple-950/70 text-[#7c3aed] dark:text-purple-300 font-bold grid place-items-center text-sm shrink-0">
                {patientName.charAt(0).toUpperCase() || "P"}
              </div>
              <div>
                <h4 className="font-bold text-sm text-[#150f26] dark:text-white leading-tight">
                  {patientName}
                </h4>
                <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] font-mono mt-0.5">
                  {patientPhone}
                </p>
              </div>
            </div>

            <div className="text-right flex flex-col items-end gap-1">
              <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] text-[#150f26] dark:text-white">
                LiveKit WebRTC
              </span>
              <span className="text-[10px] text-[#625b7e] dark:text-[#a29bc2]">
                Room: {activeCallId ? activeCallId.slice(0, 10) : "ready"}
              </span>
            </div>
          </div>
        </div>

        {/* Voice Visualizer / Pulse Waves */}
        <div className="py-2 flex flex-col items-center justify-center space-y-2">
          <div className="relative grid place-items-center">
            {/* Outer Pulsing Wave Rings */}
            {isBotSpeaking && (
              <div className="absolute w-24 h-24 rounded-full bg-purple-500/20 dark:bg-purple-500/30 animate-ping" />
            )}
            {isUserSpeaking && (
              <div className="absolute w-24 h-24 rounded-full bg-emerald-500/20 dark:bg-emerald-500/30 animate-ping" />
            )}

            {/* Center Visualizer Avatar */}
            <div
              className={`relative z-10 w-16 h-16 rounded-full grid place-items-center shadow-lg transition-all duration-300 ${
                isBotSpeaking
                  ? "bg-gradient-to-tr from-[#6d28d9] to-[#9333ea] text-white scale-105 ring-4 ring-purple-300 dark:ring-purple-900"
                  : isUserSpeaking
                  ? "bg-gradient-to-tr from-[#059669] to-[#10b981] text-white scale-105 ring-4 ring-emerald-300 dark:ring-emerald-900"
                  : "bg-white dark:bg-[#1a1435] text-[#7c3aed] border-2 border-[#e6e0f5] dark:border-[#2b2347]"
              }`}
            >
              {isBotSpeaking ? (
                <Volume2 className="h-7 w-7 animate-pulse" />
              ) : isUserSpeaking ? (
                <Mic className="h-7 w-7 animate-pulse" />
              ) : (
                <Sparkles className="h-7 w-7 text-[#7c3aed]" />
              )}
            </div>
          </div>

          <div className="text-center">
            <p className="text-xs font-bold text-[#150f26] dark:text-white">
              {isBotSpeaking
                ? "AI Assistant Speaking (Speak to Interrupt)..."
                : isUserSpeaking
                ? "User Speaking (Interrupted Bot / Listening)..."
                : "Active Call • Microphone Listening..."}
            </p>
          </div>
        </div>

        {/* Live Conversation Transcript Preview */}
        <div
          ref={chatScrollRef}
          className="p-3 rounded-2xl bg-[#faf8fe] dark:bg-[#16112a] border border-[#e6e0f5] dark:border-[#2b2347] max-h-36 overflow-y-auto space-y-2 text-xs"
        >
          {conversation.map((msg, idx) => (
            <div
              key={idx}
              className={`p-2 rounded-xl leading-relaxed ${
                msg.sender === "bot"
                  ? msg.interrupted
                    ? "bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[#150f26] dark:text-white"
                    : "bg-purple-100/60 dark:bg-purple-950/50 text-[#150f26] dark:text-white"
                  : "bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] text-[#150f26] dark:text-white"
              }`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <strong className={msg.sender === "bot" ? "text-[#7c3aed]" : "text-emerald-600"}>
                  {msg.sender === "bot" ? "Hospital AI Bot: " : "You (Caller): "}
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

        {/* Quick Test Chips & Manual Speech Input */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-semibold text-[#625b7e] dark:text-[#a29bc2]">Quick Test:</span>
            {[
              "I want to book an appointment",
              "What are doctor timings?",
              "Is this an emergency?",
            ].map((quickText, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSendTurn(quickText)}
                className="px-2 py-1 rounded-lg text-[10px] font-medium bg-purple-50 dark:bg-purple-950/40 text-[#7c3aed] dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors cursor-pointer"
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
              placeholder="Or type speech input here (to test barge-in)..."
              className="flex-1 px-3 py-2 text-xs rounded-xl bg-[#faf8fe] dark:bg-[#16112a] border border-[#e6e0f5] dark:border-[#2b2347] text-[#150f26] dark:text-white placeholder:text-[#a29bc2] focus:outline-none focus:border-[#7c3aed]"
            />
            <button
              type="submit"
              disabled={!manualInput.trim() || isProcessingTurn}
              className="p-2 rounded-xl bg-[#7c3aed] hover:bg-[#6d28d9] text-white disabled:opacity-40 transition-colors cursor-pointer"
              title="Send speech input"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </form>
        </div>

        {/* Bottom Call Controls */}
        <div className="flex items-center justify-center gap-4 pt-1">
          {/* Mute Button */}
          <button
            type="button"
            onClick={handleToggleMute}
            className={`p-3 rounded-2xl border transition-all cursor-pointer ${
              isMuted
                ? "bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-800 text-red-600"
                : "bg-white dark:bg-[#161226] border-[#e6e0f5] dark:border-[#2b2347] text-[#150f26] dark:text-white hover:border-[#7c3aed]"
            }`}
            title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
          >
            {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>

          {/* Red End Call Button */}
          <button
            type="button"
            onClick={handleHangUp}
            className="px-7 py-3 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs shadow-lg shadow-red-600/30 transition-all cursor-pointer flex items-center gap-2"
          >
            <PhoneOff className="h-4 w-4" />
            <span>End Call</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default LiveKitCallModal;
