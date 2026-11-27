import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Volume2,
  Clock,
  Sparkles,
  Zap,
  RotateCcw,
  AlertCircle,
  CheckCircle2,
  Send,
  Loader2,
  Languages,
} from "lucide-react";
import { Room } from "livekit-client";
import { apiClient } from "@/lib/api-client";

interface ConversationTurn {
  id: string;
  sender: "user" | "bot";
  text: string;
  timestamp: string;
  interrupted?: boolean;
}

// Utility to find the best available speech synthesis voice in Chrome/Edge/Windows
const getBestVoice = (lang: "auto" | "en" | "hi" | "gu", text?: string): SpeechSynthesisVoice | null => {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return null;

  let resolvedLang: "en" | "hi" | "gu" = "en";
  if (lang === "auto") {
    if (text && /[\u0A80-\u0AFF]/.test(text)) {
      resolvedLang = "gu";
    } else if (text && /[\u0900-\u097F]/.test(text)) {
      resolvedLang = "hi";
    } else {
      resolvedLang = "en";
    }
  } else {
    resolvedLang = lang;
  }

  if (resolvedLang === "gu") {
    const guVoice = voices.find(
      (v) =>
        v.lang.toLowerCase().startsWith("gu") ||
        v.name.toLowerCase().includes("gujarati")
    );
    if (guVoice) return guVoice;
  }

  if (resolvedLang === "hi") {
    const hiVoice = voices.find(
      (v) =>
        v.lang.toLowerCase().startsWith("hi") ||
        v.name.toLowerCase().includes("hindi") ||
        v.name.toLowerCase().includes("india")
    );
    if (hiVoice) return hiVoice;
  }

  // Look for Indian English voice
  const enIn = voices.find(
    (v) =>
      v.lang.toLowerCase() === "en-in" ||
      v.name.toLowerCase().includes("india") ||
      v.name.toLowerCase().includes("indian")
  );
  if (enIn) return enIn;

  // Look for standard English voices (e.g. Natural, Google, Microsoft, English)
  const enVoice = voices.find((v) => v.lang.toLowerCase().startsWith("en"));
  if (enVoice) return enVoice;

  return voices.find((v) => v.default) || voices[0] || null;
};

export interface VoicePlaygroundProps {
  portalContainer?: HTMLElement | null;
}

export const VoicePlayground: React.FC<VoicePlaygroundProps> = ({ portalContainer: propPortalContainer }) => {
  // Call Lifecycle & Controls State (Default to Auto Mirror)
  const [callStatus, setCallStatus] = useState<"idle" | "connecting" | "connected" | "ended">("idle");
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [duration, setDuration] = useState<number>(0);
  const [language, setLanguage] = useState<"auto" | "en" | "hi" | "gu">("auto");
  const [activeCallId, setActiveCallId] = useState<string>("");

  // Speech & Interruption State (Stable, No 60fps React State Loops)
  const [isBotSpeaking, setIsBotSpeaking] = useState<boolean>(false);
  const [isProcessingTurn, setIsProcessingTurn] = useState<boolean>(false);
  const [interruptionCount, setInterruptionCount] = useState<number>(0);
  const [interimText, setInterimText] = useState<string>("");

  // Conversation & UI
  const [conversation, setConversation] = useState<ConversationTurn[]>([]);
  const [manualInput, setManualInput] = useState<string>("");
  const [callError, setCallError] = useState<string | null>(null);

  // Synchronous Refs to avoid race conditions & re-renders
  const roomRef = useRef<Room | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const isBotSpeakingRef = useRef<boolean>(false);
  const isMutedRef = useRef<boolean>(false);
  const isProcessingTurnRef = useRef<boolean>(false);
  const callStatusRef = useRef<string>("idle");
  const languageRef = useRef<"auto" | "en" | "hi" | "gu">("auto");
  const activeCallIdRef = useRef<string>("");
  const handleSendTurnRef = useRef<(text: string) => void>(() => {});
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const inactivityStageRef = useRef<number>(0);
  const shouldEndAfterSpeechRef = useRef<boolean>(false);
  const currentUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const botSpeakingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const botSpeakStartTimeRef = useRef<number>(0);

  // Initialize SpeechSynthesis Voices cache on browser mount
  useEffect(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices();
      };
    }
  }, []);

  useEffect(() => {
    isBotSpeakingRef.current = isBotSpeaking;
  }, [isBotSpeaking]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    callStatusRef.current = callStatus;
  }, [callStatus]);

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  // Auto-scroll transcript to bottom smoothly
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [conversation, interimText]);

  // Clean up all resources
  const cleanupCall = useCallback(() => {
    callStatusRef.current = "ended";
    setCallStatus("ended");
    setIsBotSpeaking(false);
    isBotSpeakingRef.current = false;
    setInterimText("");
    shouldEndAfterSpeechRef.current = false;
    inactivityStageRef.current = 0;

    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }

    if (botSpeakingTimeoutRef.current) {
      clearTimeout(botSpeakingTimeoutRef.current);
      botSpeakingTimeoutRef.current = null;
    }
    currentUtteranceRef.current = null;

    if (currentAudioRef.current) {
      try {
        currentAudioRef.current.pause();
        currentAudioRef.current.currentTime = 0;
      } catch {
        // ignore
      }
      currentAudioRef.current = null;
    }

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
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
  }, []);

  // Instant Interruption (Barge-In) Handler
  // Stops bot from speaking immediately and marks last message as interrupted
  const handleUserInterruption = useCallback(() => {
    if (isBotSpeakingRef.current) {
      if (botSpeakingTimeoutRef.current) {
        clearTimeout(botSpeakingTimeoutRef.current);
        botSpeakingTimeoutRef.current = null;
      }
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          // ignore
        }
      }
      if (currentAudioRef.current) {
        try {
          currentAudioRef.current.pause();
          currentAudioRef.current.currentTime = 0;
        } catch {
          // ignore
        }
        currentAudioRef.current = null;
      }
      isBotSpeakingRef.current = false;
      setIsBotSpeaking(false);
      currentUtteranceRef.current = null;
      setInterruptionCount((prev) => prev + 1);

      // Tag the interrupted bot message in transcript
      setConversation((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        if (last && last.sender === "bot" && !last.interrupted) {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...last,
            interrupted: true,
            text: last.text + " [⚡ Interrupted by Caller]",
          };
          return updated;
        }
        return prev;
      });
    }
  }, []);

  // Robust Bot Speech Synthesis with voice binding and Chrome unpause
  const speakBotReply = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      console.warn("SpeechSynthesis is not supported in this browser.");
      return;
    }

    if (botSpeakingTimeoutRef.current) {
      clearTimeout(botSpeakingTimeoutRef.current);
      botSpeakingTimeoutRef.current = null;
    }

    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }

    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }

    const utterance = new SpeechSynthesisUtterance(text);
    currentUtteranceRef.current = utterance; // Prevent V8 garbage collection

    const currentLang = languageRef.current;
    let targetLang: "en" | "hi" | "gu" = "en";
    if (currentLang === "auto") {
      if (/[\u0A80-\u0AFF]/.test(text)) targetLang = "gu";
      else if (/[\u0900-\u097F]/.test(text)) targetLang = "hi";
      else targetLang = "en";
    } else {
      targetLang = currentLang;
    }

    const selectedVoice = getBestVoice(targetLang, text);
    if (selectedVoice) {
      utterance.voice = selectedVoice;
      utterance.lang = selectedVoice.lang;
    } else {
      utterance.lang = targetLang === "gu" ? "gu-IN" : targetLang === "hi" ? "hi-IN" : "en-US";
    }

    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    utterance.onstart = () => {
      botSpeakStartTimeRef.current = Date.now();
      isBotSpeakingRef.current = true;
      setIsBotSpeaking(true);
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
    };
    utterance.onend = () => {
      isBotSpeakingRef.current = false;
      setIsBotSpeaking(false);
      currentUtteranceRef.current = null;

      if (shouldEndAfterSpeechRef.current) {
        shouldEndAfterSpeechRef.current = false;
        cleanupCall();
        const sid = activeCallIdRef.current;
        if (sid) {
          apiClient.post(`/api/v1/voice/sessions/${encodeURIComponent(sid)}/reset`).catch(() => {});
        }
        return;
      }

      if (callStatusRef.current === "connected" && !isMutedRef.current && recognitionRef.current) {
        try {
          recognitionRef.current.start();
        } catch {
          // Already actively listening
        }
      }

      // Start silence inactivity timer while waiting for user's reply
      if (callStatusRef.current === "connected") {
        if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = setTimeout(() => {
          if (callStatusRef.current !== "connected" || isBotSpeakingRef.current || isProcessingTurnRef.current) {
            return;
          }
          if (inactivityStageRef.current === 0) {
            inactivityStageRef.current = 1;
            const nudge =
              languageRef.current === "hi"
                ? "Kya aap sun paa rahe hain? Kripya batayein main aapki kya sahayata kar sakti hoon."
                : "Are you still there? Please let me know how I can help you.";
            setConversation((prev) => [
              ...prev,
              {
                id: `bot-nudge-${Date.now()}`,
                sender: "bot",
                text: nudge,
                timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              },
            ]);
            speakBotReply(nudge);
          } else {
            inactivityStageRef.current = 2;
            shouldEndAfterSpeechRef.current = true;
            const goodbye =
              languageRef.current === "hi"
                ? "Koi pratikriya na milne ke kaaran main call samapt kar rahi hoon. Dhanyavaad, namaste!"
                : "Since I haven't heard from you, I will end the call now. Please call Apollo Metro Hospital anytime. Goodbye!";
            setConversation((prev) => [
              ...prev,
              {
                id: `bot-bye-${Date.now()}`,
                sender: "bot",
                text: goodbye,
                timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              },
            ]);
            speakBotReply(goodbye);
          }
        }, 15000);
      }
    };
    utterance.onerror = (e) => {
      if (e.error !== "canceled" && e.error !== "interrupted") {
        console.warn("SpeechSynthesis error:", e.error);
      }
      isBotSpeakingRef.current = false;
      setIsBotSpeaking(false);
      currentUtteranceRef.current = null;
    };

    // 50ms delay to unblock Chrome's audio output pipeline after cancel()
    botSpeakingTimeoutRef.current = setTimeout(() => {
      try {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.warn("Error calling speechSynthesis.speak:", err);
      }
    }, 50);
  }, []);

  // Play Natural Neural Audio from Backend with Web Speech Fallback
  const playBackendAudio = useCallback(
    (base64Data: string, mimeType: string, fallbackText: string) => {
      // 1. Stop any currently active speech synthesis or audio
      if (currentAudioRef.current) {
        try {
          currentAudioRef.current.pause();
          currentAudioRef.current.currentTime = 0;
        } catch {
          // ignore
        }
        currentAudioRef.current = null;
      }
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          // ignore
        }
      }

      try {
        const audioUrl = `data:${mimeType || "audio/mpeg"};base64,${base64Data}`;
        const audio = new Audio(audioUrl);
        currentAudioRef.current = audio;

        audio.onplay = () => {
          botSpeakStartTimeRef.current = Date.now();
          isBotSpeakingRef.current = true;
          setIsBotSpeaking(true);
        };

        audio.onended = () => {
          isBotSpeakingRef.current = false;
          setIsBotSpeaking(false);
          currentAudioRef.current = null;
        };

        audio.onerror = (e) => {
          console.warn("Backend audio playback error, falling back to Web Speech:", e);
          isBotSpeakingRef.current = false;
          setIsBotSpeaking(false);
          currentAudioRef.current = null;
          speakBotReply(fallbackText);
        };

        audio.play().catch((err) => {
          console.warn("Audio autoplay policy deferred playback, falling back to Web Speech:", err);
          speakBotReply(fallbackText);
        });
      } catch (err) {
        console.warn("Audio instance initialization failed:", err);
        speakBotReply(fallbackText);
      }
    },
    [speakBotReply]
  );

  // Dispatch Turn to Backend AI Pipeline
  const handleSendTurn = useCallback(
    async (userText: string) => {
      const trimmed = userText.trim();
      if (!trimmed || isProcessingTurnRef.current) return;

      // Stop any active bot speech and clear inactivity timer immediately
      inactivityStageRef.current = 0;
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
      handleUserInterruption();

      const userTurn: ConversationTurn = {
        id: `usr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        sender: "user",
        text: trimmed,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };

      setConversation((prev) => [...prev, userTurn]);
      isProcessingTurnRef.current = true;
      setIsProcessingTurn(true);

      try {
        const callSessionId = activeCallIdRef.current || activeCallId || `call_${Date.now()}`;
        activeCallIdRef.current = callSessionId;
        const res = await apiClient.post<{
          session_id: string;
          response_text: string;
          conversation_status: string;
          action_signal?: string | null;
          audio_base64?: string | null;
          audio_mime_type?: string | null;
        }>("/api/v1/voice/chat-turn", {
          session_id: callSessionId,
          transcript: trimmed,
          dialed_number: "9328291692",
          language: languageRef.current,
        });

        if (res.session_id) {
          activeCallIdRef.current = res.session_id;
          setActiveCallId(res.session_id);
        }

        const botReply = res.response_text;
        if (res.conversation_status === "completed" || res.action_signal === "call_completed") {
          shouldEndAfterSpeechRef.current = true;
        }
        const botTurn: ConversationTurn = {
          id: `bot-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          sender: "bot",
          text: botReply,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };

        setConversation((prev) => [...prev, botTurn]);
        if (res.audio_base64) {
          playBackendAudio(res.audio_base64, res.audio_mime_type || "audio/mpeg", botReply);
        } else {
          speakBotReply(botReply);
        }
      } catch (err: any) {
        console.warn("Telephony chat turn error:", err);
        const errDetail = err?.message || "Connection to hospital assistant failed. Please check network.";
        setCallError(errDetail);

        const errorBotTurn: ConversationTurn = {
          id: `bot-err-${Date.now()}`,
          sender: "bot",
          text: "I am having trouble connecting to our hospital service right now. Please try again in a moment.",
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        setConversation((prev) => [...prev, errorBotTurn]);
      } finally {
        isProcessingTurnRef.current = false;
        setIsProcessingTurn(false);
      }
    },
    [activeCallId, handleUserInterruption, isProcessingTurn, playBackendAudio, speakBotReply]
  );

  useEffect(() => {
    handleSendTurnRef.current = handleSendTurn;
  }, [handleSendTurn]);

  // Continuous Hands-Free Speech Recognition Loop
  const startContinuousSpeechRecognition = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn("Web Speech API not supported in browser; text fallback available.");
      return;
    }

    try {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = languageRef.current === "gu" ? "gu-IN" : languageRef.current === "hi" ? "hi-IN" : "en-IN";

      recognition.onresult = (event: any) => {
        let interimTranscript = "";
        let finalTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const text = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += text;
          } else {
            interimTranscript += text;
          }
        }

        // Live interim caption
        if (interimTranscript.trim().length > 0) {
          inactivityStageRef.current = 0;
          if (inactivityTimerRef.current) {
            clearTimeout(inactivityTimerRef.current);
            inactivityTimerRef.current = null;
          }
          setInterimText(interimTranscript);
          // Instant barge-in: If bot is speaking and caller speaks, interrupt cleanly
          // 800ms guard allows bot audio to start cleanly without being tripped by mic activation/speaker echo
          if (
            isBotSpeakingRef.current &&
            Date.now() - botSpeakStartTimeRef.current > 800 &&
            interimTranscript.trim().length >= 2
          ) {
            handleUserInterruption();
          }
        }

        // Final speech sentence confirmed
        if (finalTranscript.trim().length > 0) {
          setInterimText("");
          handleSendTurnRef.current(finalTranscript.trim());
        }
      };

      recognition.onerror = (e: any) => {
        if (e.error !== "no-speech" && e.error !== "aborted") {
          console.warn("Speech recognition notice:", e.error);
        }
      };

      recognition.onend = () => {
        // Keep continuous loop active if call is still connected and unmuted.
        // Use a short delay so Chrome's speech engine finishes releasing audio focus.
        if (callStatusRef.current === "connected" && !isMutedRef.current) {
          setTimeout(() => {
            if (callStatusRef.current !== "connected" || isMutedRef.current) return;
            try {
              recognition.start();
            } catch {
              // If the existing instance is stuck in an invalid state, recreate it cleanly
              startContinuousSpeechRecognition();
            }
          }, 250);
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch (err) {
      console.warn("Failed to initialize speech recognition:", err);
    }
  }, [handleSendTurn, handleUserInterruption]);

  // Connect Local Microphone Stream with echo cancellation & noise suppression
  const initAudioStreams = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      micStreamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const audioCtx = new AudioCtx();
        audioContextRef.current = audioCtx;
      }
    } catch (err) {
      console.warn("Microphone access notice:", err);
    }
  }, []);

  // Start Call Handler (Button 1: Call)
  const handleStartCall = async () => {
    cleanupCall();

    const newCallId = `call_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    activeCallIdRef.current = newCallId;
    setActiveCallId(newCallId);
    setCallStatus("connecting");
    callStatusRef.current = "connecting";
    setDuration(0);
    setInterruptionCount(0);
    setIsMuted(false);
    isMutedRef.current = false;
    setCallError(null);

    // Initial greeting in selected language
    let initialGreeting =
      language === "gu"
        ? "નમસ્તે! એપોલો મેટ્રો હોસ્પિટલમાં આપનું સ્વાગત છે. હું આપની ડોક્ટર એપોઇન્ટમેન્ટ અથવા હોસ્પિટલ પૂછપરછમાં શું મદદ કરી શકું?"
        : language === "hi"
        ? "नमस्ते! अपोलो मेट्रो हॉस्पिटल में आपका स्वागत है। मैं आपकी डॉक्टर अपॉइंटमेंट या अस्पताल संबंधी क्या सहायता कर सकती हूँ?"
        : "Thank you for calling Apollo Metro Hospital. How may I assist you with your doctor appointments or hospital inquiries today?";

    try {
      // Initialize real backend conversation session & greeting
      let initialAudio: string | null = null;
      let initialMime: string | null = null;
      try {
        const res = await apiClient.post<{
          session_id: string;
          response_text: string;
          audio_base64?: string | null;
          audio_mime_type?: string | null;
        }>("/api/v1/voice/chat-turn", {
          session_id: newCallId,
          transcript: "Hello",
          dialed_number: "9328291692",
          language,
        });

        if (res?.session_id) {
          activeCallIdRef.current = res.session_id;
          setActiveCallId(res.session_id);
        }
        if (res?.response_text) {
          initialGreeting = res.response_text;
        }
        if (res?.audio_base64) {
          initialAudio = res.audio_base64;
          initialMime = res.audio_mime_type || "audio/mpeg";
        }
      } catch (backendErr) {
        console.warn("Backend greeting notice (using default hospital greeting):", backendErr);
      }

      // Initialize Greeting in transcript
      const greetingTurn: ConversationTurn = {
        id: `bot-greet-${Date.now()}`,
        sender: "bot",
        text: initialGreeting,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setConversation([greetingTurn]);

      // Connect timer
      timerRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);

      // Connected state
      setCallStatus("connected");
      callStatusRef.current = "connected";

      // Initialize microphone stream & continuous recognition
      await initAudioStreams();
      startContinuousSpeechRecognition();

      // Speak initial greeting (backend neural voice or Web Speech fallback)
      if (initialAudio) {
        playBackendAudio(initialAudio, initialMime || "audio/mpeg", initialGreeting);
      } else {
        speakBotReply(initialGreeting);
      }
    } catch (err: any) {
      console.error("Call initialization failed:", err);
      setCallError(err?.message || "Failed to access microphone or connect audio service.");
      setCallStatus("idle");
      callStatusRef.current = "idle";
    }
  };

  // Toggle Mute Handler (Button 2: Mute)
  const handleToggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    isMutedRef.current = next;

    if (micStreamRef.current) {
      micStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !next;
      });
    }

    if (next) {
      // When muted: stop speech recognition
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }
      setInterimText("");
    } else {
      // When unmuted: restart continuous speech recognition
      startContinuousSpeechRecognition();
    }
  };

  // End Call Handler (Button 3: End)
  const handleEndCall = () => {
    cleanupCall();

    const sid = activeCallIdRef.current || activeCallId;
    if (sid) {
      apiClient.post(`/api/v1/voice/sessions/${encodeURIComponent(sid)}/reset`).catch(() => {});
    }
  };

  // Reset Conversation Context
  const handleReset = () => {
    cleanupCall();
    setConversation([]);
    setInterruptionCount(0);
    setDuration(0);
    setCallStatus("idle");
    callStatusRef.current = "idle";
    setCallError(null);
  };

  // Manual Text Submit
  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim()) return;
    const txt = manualInput.trim();
    setManualInput("");
    handleSendTurn(txt);
  };

  // Format Duration seconds into mm:ss
  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupCall();
    };
  }, [cleanupCall]);

  const headerActionsTarget =
    propPortalContainer ||
    (typeof document !== "undefined" ? document.getElementById("header-actions-portal") : null);

  const headerButtonsContent = (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Language Toggle: Auto-Mirror First & Default */}
      <div className="inline-flex p-1 rounded-2xl bg-[#f3f0fb] dark:bg-[#1a1530] border border-[#e6e0f5] dark:border-[#2b2347] text-xs">
        <button
          type="button"
          disabled={callStatus === "connected"}
          onClick={() => setLanguage("auto")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold transition-colors cursor-pointer ${
            language === "auto"
              ? "bg-gradient-to-r from-[#6d28d9] to-[#9333ea] text-white shadow-sm"
              : "text-[#625b7e] dark:text-[#a29bc2] hover:text-[#150f26]"
          } disabled:opacity-50`}
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span>Auto Mirror (En/Hi/Gu)</span>
        </button>
        <button
          type="button"
          disabled={callStatus === "connected"}
          onClick={() => setLanguage("en")}
          className={`px-3 py-1.5 rounded-xl font-bold transition-colors cursor-pointer ${
            language === "en"
              ? "bg-gradient-to-r from-[#6d28d9] to-[#9333ea] text-white shadow-sm"
              : "text-[#625b7e] dark:text-[#a29bc2] hover:text-[#150f26]"
          } disabled:opacity-50`}
        >
          English
        </button>
        <button
          type="button"
          disabled={callStatus === "connected"}
          onClick={() => setLanguage("hi")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold transition-colors cursor-pointer ${
            language === "hi"
              ? "bg-gradient-to-r from-[#6d28d9] to-[#9333ea] text-white shadow-sm"
              : "text-[#625b7e] dark:text-[#a29bc2] hover:text-[#150f26]"
          } disabled:opacity-50`}
        >
          <Languages className="h-3.5 w-3.5" />
          <span>Hindi / Hinglish</span>
        </button>
        <button
          type="button"
          disabled={callStatus === "connected"}
          onClick={() => setLanguage("gu")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold transition-colors cursor-pointer ${
            language === "gu"
              ? "bg-gradient-to-r from-[#6d28d9] to-[#9333ea] text-white shadow-sm"
              : "text-[#625b7e] dark:text-[#a29bc2] hover:text-[#150f26]"
          } disabled:opacity-50`}
        >
          <Languages className="h-3.5 w-3.5" />
          <span>ગુજરાતી (Gujarati)</span>
        </button>
      </div>

      {/* Reset Context */}
      <button
        type="button"
        onClick={handleReset}
        className="p-2.5 rounded-2xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] text-[#625b7e] hover:text-[#150f26] dark:text-[#a29bc2] dark:hover:text-white transition-colors cursor-pointer"
        title="Reset Context and Clear Session"
      >
        <RotateCcw className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <div className="w-full space-y-6 font-['Figtree',system-ui,sans-serif]">
      {/* Header Actions Portaled to Main Page Header */}
      {headerActionsTarget ? (
        createPortal(headerButtonsContent, headerActionsTarget)
      ) : (
        <div className="flex justify-end">{headerButtonsContent}</div>
      )}

      {/* Error Notice */}
      {callError && (
        <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
            <span>{callError}</span>
          </div>
          <button
            type="button"
            onClick={() => setCallError(null)}
            className="text-xs font-bold underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* =========================================================================
          CENTER STAGE: PHONE CALL SIMULATOR (STABLE, ZERO-JERK, INSTANT BARGE-IN)
          ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left Column: Stable Call Stage & Core Buttons (7 Cols) */}
        <div className="lg:col-span-7 flex flex-col justify-between p-6 sm:p-8 rounded-3xl bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-[0_12px_36px_-12px_rgba(21,15,38,0.08)] min-h-[460px]">
          {/* Stage Top Bar: Status Badge, Timer & Interruption Count (Fixed Heights, No Layout Shifts) */}
          <div className="flex items-center justify-between gap-3 h-8">
            {/* Status Badge */}
            <div className="flex items-center">
              {callStatus === "idle" && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                  <span className="w-2 h-2 rounded-full bg-slate-400" />
                  <span>Ready to Call</span>
                </span>
              )}

              {callStatus === "connecting" && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-purple-50 text-[#7c3aed] dark:bg-purple-950/60 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                  <Loader2 className="h-3 w-3 animate-spin text-[#7c3aed]" />
                  <span>Connecting Line...</span>
                </span>
              )}

              {callStatus === "connected" && (
                <>
                  {isMuted ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                      <MicOff className="h-3.5 w-3.5" />
                      <span>Muted</span>
                    </span>
                  ) : isBotSpeaking ? (
                    <button
                      type="button"
                      onClick={handleUserInterruption}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-purple-100 text-[#7c3aed] dark:bg-purple-950/80 dark:text-purple-300 border border-purple-300 dark:border-purple-700 hover:bg-purple-200 dark:hover:bg-purple-900 transition-colors cursor-pointer"
                      title="AI is speaking. Speak or click here to interrupt."
                    >
                      <Volume2 className="h-3.5 w-3.5 animate-pulse" />
                      <span>AI Speaking • Speak or Tap to Interrupt</span>
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span>Listening Hands-Free</span>
                    </span>
                  )}
                </>
              )}

              {callStatus === "ended" && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                  <CheckCircle2 className="h-3.5 w-3.5 text-slate-500" />
                  <span>Call Finished</span>
                </span>
              )}
            </div>

            {/* Timer & Interruption Badge */}
            <div className="flex items-center gap-2 text-xs font-mono">
              {callStatus === "connected" && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-[#150f26] dark:text-white font-bold border border-slate-200 dark:border-slate-700">
                  <Clock className="h-3.5 w-3.5 text-[#7c3aed]" />
                  <span>{formatDuration(duration)}</span>
                </div>
              )}

              {interruptionCount > 0 && (
                <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-[#7c3aed] dark:text-purple-300 font-semibold border border-purple-200 dark:border-purple-800">
                  <Zap className="h-3 w-3" />
                  <span>{interruptionCount} Interrupted</span>
                </div>
              )}
            </div>
          </div>

          {/* Stage Center: Classic Fixed-Size Avatar (No Jerk, No Ping, No Scale Transitions) */}
          <div className="my-auto py-6 flex flex-col items-center justify-center text-center space-y-4">
            {/* Stable Avatar Container */}
            <div className="relative w-28 h-28 rounded-full flex items-center justify-center shadow-lg transition-colors border-4 border-slate-100 dark:border-slate-800 bg-gradient-to-tr from-[#6d28d9] to-[#9333ea] text-white">
              {callStatus === "connected" ? (
                isBotSpeaking ? (
                  <Volume2 className="h-12 w-12 text-white" />
                ) : isMuted ? (
                  <MicOff className="h-12 w-12 text-amber-200" />
                ) : (
                  <Mic className="h-12 w-12 text-white" />
                )
              ) : (
                <Phone className="h-12 w-12 text-white" />
              )}
            </div>

            {/* Stable Status Explanation (Fixed Height to prevent layout jumping) */}
            <div className="h-16 flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-1">
              <h3 className="font-['Bricolage_Grotesque',sans-serif] text-lg font-bold text-[#150f26] dark:text-white">
                {callStatus === "idle" && "Ready to Start Phone Conversation"}
                {callStatus === "connecting" && "Dialing & Connecting to Hospital Assistant..."}
                {callStatus === "connected" &&
                  (isMuted
                    ? "Microphone is Muted"
                    : isBotSpeaking
                    ? "AI Assistant is Speaking (Speak to Interrupt)"
                    : "Listening Hands-Free... Speak Your Inquiry")}
                {callStatus === "ended" && "Call Finished"}
              </h3>
              <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] line-clamp-2">
                {callStatus === "connected"
                  ? "Hands-free continuous mode. If the AI is answering, speak anytime to instantly stop the AI and ask another question."
                  : "Autonomous clinical phone simulation for doctor shifts, emergency triage, and appointment booking."}
              </p>
            </div>

            {/* Stable Interim Caption Area (Fixed Height) */}
            <div className="h-8 flex items-center justify-center w-full">
              {interimText ? (
                <div className="px-3.5 py-1 rounded-xl bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800 text-xs text-[#7c3aed] dark:text-purple-300 font-semibold max-w-md truncate">
                  <span className="text-[10px] uppercase font-bold text-slate-500 mr-1.5">Hearing:</span>
                  &ldquo;{interimText}&rdquo;
                </div>
              ) : null}
            </div>
          </div>

          {/* =========================================================================
              THE 3 CORE BUTTONS (CALL, MUTE, END) - STABLE, CLEAN & RIGID
              ========================================================================= */}
          <div className="pt-4 border-t border-[#e6e0f5] dark:border-[#2b2347] flex items-center justify-center gap-4">
            {/* BUTTON 1: CALL (When Idle / Ended) */}
            {callStatus !== "connected" ? (
              <button
                type="button"
                onClick={handleStartCall}
                disabled={callStatus === "connecting"}
                className="inline-flex items-center gap-3 px-8 py-3.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm shadow-md shadow-emerald-600/20 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                title="Start Voice Call"
              >
                <Phone className="h-5 w-5" />
                <span>Start Voice Call</span>
              </button>
            ) : (
              <>
                {/* BUTTON 2: MUTE / UNMUTE (During Call) */}
                <button
                  type="button"
                  onClick={handleToggleMute}
                  className={`inline-flex items-center justify-center gap-2 h-12 px-6 rounded-2xl text-xs font-bold transition-colors cursor-pointer border ${
                    isMuted
                      ? "bg-amber-500 text-white border-amber-600 shadow-sm hover:bg-amber-600"
                      : "bg-[#f3f0fb] dark:bg-[#1a1530] text-[#150f26] dark:text-white border-[#e6e0f5] dark:border-[#2b2347] hover:bg-slate-200 dark:hover:bg-slate-800"
                  }`}
                  title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
                >
                  {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4 text-[#7c3aed]" />}
                  <span>{isMuted ? "Unmute" : "Mute"}</span>
                </button>

                {/* ACTIVE CALL INDICATOR (Center Pill) */}
                <div className="inline-flex items-center gap-2 h-12 px-5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 font-bold text-xs">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  <span>Connected</span>
                </div>

                {/* BUTTON 3: END CALL (During Call) */}
                <button
                  type="button"
                  onClick={handleEndCall}
                  className="inline-flex items-center justify-center gap-2 h-12 px-6 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs shadow-md shadow-red-600/20 active:scale-95 transition-all cursor-pointer"
                  title="End Call and Disconnect"
                >
                  <PhoneOff className="h-4 w-4" />
                  <span>End Call</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Right Column: Live Conversation Transcript Stream (5 Cols) */}
        <div className="lg:col-span-5 flex flex-col justify-between p-6 rounded-3xl bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-[0_4px_24px_-6px_rgba(21,15,38,0.06)] min-h-[460px]">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-[#e6e0f5] dark:border-[#2b2347]">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[#7c3aed]" />
                <h3 className="font-['Bricolage_Grotesque',sans-serif] text-sm font-bold text-[#150f26] dark:text-white">
                  Live Conversation Transcript
                </h3>
              </div>
              <span className="text-[11px] font-mono font-bold text-[#625b7e] dark:text-[#a29bc2]">
                {conversation.length} Turns
              </span>
            </div>

            {/* Scrollable Transcript Messages */}
            <div
              ref={chatScrollRef}
              className="mt-4 space-y-3.5 max-h-[340px] overflow-y-auto pr-1 text-xs"
            >
              {conversation.length === 0 ? (
                <div className="h-48 flex flex-col items-center justify-center text-center text-slate-400 space-y-2">
                  <Phone className="h-8 w-8 text-slate-300 dark:text-slate-700" />
                  <p>No call active yet.</p>
                  <p className="text-[11px] text-slate-400 max-w-[200px]">
                    Click &ldquo;Start Voice Call&rdquo; to test live spoken turns.
                  </p>
                </div>
              ) : (
                conversation.map((turn) => (
                  <div
                    key={turn.id}
                    className={`flex flex-col ${
                      turn.sender === "user" ? "items-end" : "items-start"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1 text-[10px] font-bold text-[#625b7e] dark:text-[#a29bc2]">
                      <span>{turn.sender === "user" ? "Caller (You)" : "Hospital AI Agent"}</span>
                      <span>&bull;</span>
                      <span>{turn.timestamp}</span>
                      {turn.interrupted && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                          Interrupted
                        </span>
                      )}
                    </div>
                    <div
                      className={`max-w-[85%] rounded-2xl p-3 text-xs leading-relaxed shadow-xs ${
                        turn.sender === "user"
                          ? "bg-gradient-to-r from-[#6d28d9] to-[#9333ea] text-white rounded-tr-xs"
                          : "bg-[#f3f0fb] dark:bg-[#1a1530] text-[#150f26] dark:text-white rounded-tl-xs border border-[#e6e0f5] dark:border-[#2b2347]"
                      }`}
                    >
                      {turn.text}
                    </div>
                  </div>
                ))
              )}

              {/* Bot thinking indicator */}
              {isProcessingTurn && (
                <div className="flex items-center gap-2 text-xs text-[#7c3aed] font-semibold">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Processing response...</span>
                </div>
              )}
            </div>
          </div>

          {/* Fallback Text Input Bar */}
          <form
            onSubmit={handleManualSubmit}
            className="pt-4 border-t border-[#e6e0f5] dark:border-[#2b2347] flex items-center gap-2"
          >
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder={
                language === "gu"
                  ? "સંદેશ અહીં લખો અને Enter દબાવો..."
                  : language === "hi"
                  ? "संदेश यहाँ लिखें और Enter दबाएँ..."
                  : "Or type a test message and press Enter..."
              }
              disabled={isProcessingTurn}
              className="flex-1 h-10 px-3.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#f3f0fb] dark:bg-[#1a1530] text-xs text-[#150f26] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#7c3aed]/30 placeholder:text-slate-400"
            />
            <button
              type="submit"
              disabled={!manualInput.trim() || isProcessingTurn}
              className="h-10 px-3.5 rounded-xl bg-gradient-to-r from-[#6d28d9] to-[#9333ea] text-white text-xs font-semibold shadow-xs hover:brightness-105 active:scale-95 disabled:opacity-50 transition-all cursor-pointer flex items-center gap-1.5"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
