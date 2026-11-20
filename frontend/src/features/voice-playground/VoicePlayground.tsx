import React, { useState } from "react";
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

  // Handle new recorded audio turn
  const handleAudioRecorded = async (audioBlob: Blob, mimeType: string) => {
    setIsProcessing(true);
    setErrorMessage(null);
    setResetNotice(null);

    const formData = new FormData();
    // Use proper extension based on mimeType
    const ext = mimeType.includes("webm") ? "webm" : mimeType.includes("mp4") ? "mp4" : "wav";
    formData.append("audio", audioBlob, `input_turn.${ext}`);
    formData.append("session_id", sessionId);
    formData.append("language", language);

    try {
      const turnResult = await apiClient.uploadForm<VoiceTurnResponse>(
        "/api/v1/voice/turn",
        formData
      );
      setSessionId(turnResult.session_id);
      setTurns((prev) => [...prev, turnResult]);
    } catch (err: unknown) {
      console.error("Voice turn processing error:", err);
      if (err instanceof APIClientError) {
        setErrorMessage(err.message);
      } else if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage("An unexpected network error occurred while processing the voice turn.");
      }
    } finally {
      setIsProcessing(false);
    }
  };

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
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-border/60">
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
        <ConversationHistory turns={turns} />
      </div>

      {/* Floating Microphone Control Bar */}
      <div className="sticky bottom-4 z-20 rounded-2xl border bg-background/95 p-4 shadow-xl backdrop-blur-md">
        <AudioRecorder
          onAudioRecorded={handleAudioRecorded}
          isProcessing={isProcessing}
        />
      </div>
    </div>
  );
};

