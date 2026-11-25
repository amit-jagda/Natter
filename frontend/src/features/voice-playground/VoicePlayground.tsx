import React, { useState, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient, APIClientError } from "@/lib/api-client";
import { VoiceProvidersStatusResponse, VoiceTurnResponse, SessionResetResponse } from "@/types/api";
import { ProviderStatus } from "./ProviderStatus";
import { AudioRecorder } from "./AudioRecorder";
import { ConversationHistory } from "./ConversationHistory";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RotateCcw, AlertCircle, Sparkles, CheckCircle2 } from "lucide-react";

export const VoicePlayground: React.FC = () => {
  const [sessionId, setSessionId] = useState<string>(() => `sess-${Date.now()}`);
  const [language, setLanguage] = useState<string>("en");
  const [turns, setTurns] = useState<VoiceTurnResponse[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [stopSignal, setStopSignal] = useState<number>(0);
  const activeTurnIdRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const audioQueueRef = useRef<Array<{ base64: string; mimeType: string }>>([]);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const isPlayingQueueRef = useRef<boolean>(false);
  const isProcessingRef = useRef<boolean>(false);
  const inFlightTranscriptRef = useRef<string>("");
  const carryOverTranscriptRef = useRef<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resetNotice, setResetNotice] = useState<string | null>(null);

  // Query configured providers and readiness diagnostics
  const {
    data: providerStatus,
    isLoading: isLoadingProviders,
    refetch: refetchProviders,
  } = useQuery<VoiceProvidersStatusResponse>({
    queryKey: ["voice-providers-status"],
    queryFn: () => apiClient.get<VoiceProvidersStatusResponse>("/api/v1/voice/providers"),
    refetchInterval: 30000,
  });

  const playNextInQueue = useCallback(() => {
    if (audioQueueRef.current.length === 0) {
      isPlayingQueueRef.current = false;
      currentAudioRef.current = null;
      return;
    }

    isPlayingQueueRef.current = true;
    const next = audioQueueRef.current.shift()!;
    const audio = new Audio(`data:${next.mimeType};base64,${next.base64}`);
    currentAudioRef.current = audio;

    audio.onended = () => {
      playNextInQueue();
    };
    audio.onerror = () => {
      playNextInQueue();
    };
    audio.play().catch((err) => {
      console.warn("Audio chunk playback deferred:", err);
      playNextInQueue();
    });
  }, []);

  const enqueueAudioChunk = useCallback(
    (base64: string, mimeType: string) => {
      audioQueueRef.current.push({ base64, mimeType });
      if (!isPlayingQueueRef.current) {
        playNextInQueue();
      }
    },
    [playNextInQueue]
  );

  // Stop any playing audio and abort any in-flight stream immediately on barge-in
  const handleBargeIn = useCallback(() => {
    const wasPlaying = isPlayingQueueRef.current;
    const wasProcessing = isProcessingRef.current;

    if (!wasPlaying && wasProcessing && inFlightTranscriptRef.current) {
      // User paused briefly mid-sentence and continued before AI spoke; carry over previous words!
      carryOverTranscriptRef.current = inFlightTranscriptRef.current;
      // Remove the incomplete placeholder turn so the merged utterance replaces it cleanly
      setTurns((prev) => prev.slice(0, -1));
    } else if (wasPlaying) {
      carryOverTranscriptRef.current = "";
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    audioQueueRef.current = [];
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
    }
    isPlayingQueueRef.current = false;
    isProcessingRef.current = false;
    inFlightTranscriptRef.current = "";
    setIsProcessing(false);
    setStopSignal((prev) => prev + 1);
  }, []);

  // Handle new recorded audio turn via sentence-chunked SSE streaming
  const handleAudioRecorded = useCallback(
    async (audioBlob: Blob, mimeType: string) => {
      const turnId = ++activeTurnIdRef.current;

      // Clear any previous stream
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      isProcessingRef.current = true;
      inFlightTranscriptRef.current = "";
      setIsProcessing(true);
      setErrorMessage(null);
      setResetNotice(null);

      const formData = new FormData();
      const ext = mimeType.includes("webm") ? "webm" : mimeType.includes("mp4") ? "mp4" : "wav";
      formData.append("audio", audioBlob, `input_turn.${ext}`);
      formData.append("session_id", sessionId);
      formData.append("language", language);

      if (carryOverTranscriptRef.current) {
        formData.append("prefix_transcript", carryOverTranscriptRef.current);
        carryOverTranscriptRef.current = "";
      }

      const headers: Record<string, string> = {};
      const token = apiClient.getToken();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      try {
        const response = await fetch("/api/v1/voice/turn/stream", {
          method: "POST",
          headers,
          body: formData,
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`Server returned HTTP ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = "";
        const turnIndex = Date.now();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (turnId !== activeTurnIdRef.current) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split("\n\n");
          sseBuffer = lines.pop() || "";

          for (const block of lines) {
            const dataLine = block.trim();
            if (!dataLine.startsWith("data: ")) continue;
            const jsonStr = dataLine.slice(6);

            try {
              const event = JSON.parse(jsonStr);

              if (event.type === "transcript") {
                inFlightTranscriptRef.current = event.transcript;
                setSessionId(event.session_id);
                // Show user's spoken transcript immediately while LLM thinks
                const placeholderTurn: VoiceTurnResponse = {
                  session_id: `${event.session_id}-stream-${turnIndex}`,
                  transcript: event.transcript,
                  response_text: "",
                  audio_base64: null,
                  audio_mime_type: null,
                  audio_error: null,
                  timings: { stt_ms: event.stt_ms, llm_ms: 0, tts_ms: 0, total_ms: event.stt_ms },
                  providers: { stt: "google", llm: "gemini", tts: "piper" },
                };
                setTurns((prev) => [...prev, placeholderTurn]);
              } else if (event.type === "audio_chunk" || event.type === "text_chunk") {
                // Append sentence text immediately & queue audio chunk for gapless playback
                setTurns((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last) {
                    updated[updated.length - 1] = {
                      ...last,
                      response_text: last.response_text
                        ? `${last.response_text} ${event.text}`
                        : event.text,
                    };
                  }
                  return updated;
                });

                if (event.type === "audio_chunk" && event.audio_base64) {
                  enqueueAudioChunk(event.audio_base64, event.audio_mime_type || "audio/wav");
                }
              } else if (event.type === "done") {
                setSessionId(event.session_id);
                setTurns((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last) {
                    updated[updated.length - 1] = {
                      ...last,
                      session_id: event.session_id,
                      response_text: event.response_text,
                      audio_error: event.audio_error,
                      timings: event.timings,
                      providers: event.providers,
                    };
                  }
                  return updated;
                });
              } else if (event.type === "error") {
                setErrorMessage(event.error || "Streaming error occurred.");
              }
            } catch {
              // Ignore malformed SSE chunk
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // Expected when user interrupts (barge-in)
          return;
        }
        if (turnId !== activeTurnIdRef.current) return;
        console.error("Voice stream processing error:", err);
        if (err instanceof APIClientError || err instanceof Error) {
          setErrorMessage(err.message);
        } else {
          setErrorMessage("An unexpected network error occurred while streaming the voice turn.");
        }
      } finally {
        if (turnId === activeTurnIdRef.current) {
          isProcessingRef.current = false;
          setIsProcessing(false);
        }
      }
    },
    [sessionId, language, enqueueAudioChunk]
  );

  // Reset conversation session context
  const handleResetSession = async () => {
    try {
      await apiClient.post<SessionResetResponse>(
        `/api/v1/voice/sessions/${encodeURIComponent(sessionId)}/reset`
      );
      setTurns([]);
      setErrorMessage(null);
      setResetNotice("Conversation context has been cleared. Starting a fresh session.");
      setTimeout(() => setResetNotice(null), 4000);
    } catch (err: unknown) {
      console.error("Failed to reset session:", err);
      // Even if backend fails, reset local state
      setTurns([]);
      setSessionId(`sess-${Date.now()}`);
    }
  };

  return (
    <div className="w-full">
      {/* Action Controls & Sub-header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between p-4 sm:p-5 rounded-2xl bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-[0_4px_20px_-4px_rgba(21,15,38,0.06)]">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1.5 font-mono text-xs py-1 px-3">
            <Sparkles className="h-3.5 w-3.5 text-blue-600" />
            STT &rarr; LLM &rarr; TTS Real-Time Pipeline
          </Badge>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3">
          {/* Language Selector */}
          <div className="flex items-center rounded-xl border bg-muted/40 p-1 text-xs shadow-xs">
            <button
              className={`rounded-lg px-3 py-1.5 font-semibold transition-all cursor-pointer ${
                language === "en"
                  ? "bg-background text-foreground shadow-xs font-bold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setLanguage("en")}
            >
              English
            </button>
            <button
              className={`rounded-lg px-3 py-1.5 font-semibold transition-all cursor-pointer ${
                language === "hi"
                  ? "bg-background text-foreground shadow-xs font-bold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setLanguage("hi")}
            >
              Hindi / Hinglish
            </button>
          </div>

          {/* Reset Session Button */}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs rounded-xl shadow-xs cursor-pointer"
            onClick={handleResetSession}
            disabled={isProcessing || turns.length === 0}
            title="Reset conversation context"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset Context
          </Button>
        </div>
      </div>

      {/* Provider Status Diagnostic Banner */}
      <div className="mb-6">
        <ProviderStatus
          status={providerStatus}
          isLoading={isLoadingProviders}
          onRefresh={() => refetchProviders()}
        />
      </div>

      {/* Error and Alert Banners */}
      {errorMessage && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-xs text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">Pipeline Execution Error</p>
            <p className="mt-0.5 text-destructive/90">{errorMessage}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-destructive hover:bg-destructive/20"
            onClick={() => setErrorMessage(null)}
          >
            Dismiss
          </Button>
        </div>
      )}

      {resetNotice && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800 dark:border-emerald-900/30 dark:bg-emerald-950/30 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>{resetNotice}</span>
        </div>
      )}

      {/* Main Conversation Stream */}
      <div className="mb-8 min-h-[280px]">
        <ConversationHistory turns={turns} stopSignal={stopSignal} />
      </div>

      {/* Floating Microphone Control Bar */}
      <div className="sticky bottom-4 z-20 rounded-2xl border bg-background/95 p-4 shadow-xl backdrop-blur-md">
        <AudioRecorder
          onAudioRecorded={handleAudioRecorded}
          onBargeIn={handleBargeIn}
          isProcessing={isProcessing}
        />
      </div>
    </div>
  );
};

