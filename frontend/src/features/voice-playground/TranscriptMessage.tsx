import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { VoiceTurnResponse } from "@/types/api";
import { AudioPlayer } from "./AudioPlayer";
import { TimingsBadge } from "./TimingsBadge";
import { User, Bot, AlertTriangle } from "lucide-react";

interface TranscriptMessageProps {
  turn: VoiceTurnResponse;
  turnIndex: number;
}

export const TranscriptMessage: React.FC<TranscriptMessageProps> = ({
  turn,
  turnIndex,
}) => {
  return (
    <div className="space-y-4">
      {/* User Turn */}
      <div className="flex items-start justify-end gap-3">
        <div className="max-w-[85%] sm:max-w-[75%] space-y-1">
          <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-[10px] font-mono">
              STT: {turn.providers.stt}
            </Badge>
            <span>Turn #{turnIndex + 1}</span>
          </div>
          <div className="rounded-2xl rounded-tr-sm bg-primary px-4 py-3 text-sm text-primary-foreground shadow-sm">
            <p className="whitespace-pre-wrap leading-relaxed">{turn.transcript}</p>
          </div>
        </div>
        <div className="flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full bg-primary/20 text-primary font-semibold text-xs">
          <User className="h-4 w-4" />
        </div>
      </div>

      {/* AI Assistant Turn */}
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full bg-purple-500/20 text-purple-600 font-semibold text-xs">
          <Bot className="h-4 w-4" />
        </div>
        <div className="max-w-[90%] sm:max-w-[80%] space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">AI Voice Assistant</span>
            <Badge variant="outline" className="text-[10px] font-mono">
              LLM: {turn.providers.llm}
            </Badge>
          </div>

          <Card className="border bg-card shadow-sm">
            <CardContent className="p-4 space-y-3">
              <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                {turn.response_text}
              </p>

              {/* Audio Playback or TTS Error Warning */}
              {turn.audio_base64 ? (
                <AudioPlayer
                  base64Audio={turn.audio_base64}
                  mimeType={turn.audio_mime_type || "audio/wav"}
                  autoPlay={true}
                />
              ) : turn.audio_error ? (
                <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700 dark:border-amber-900/30 dark:bg-amber-950/30">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                  <span>
                    Audio synthesis warning: {turn.audio_error} (LLM response preserved above).
                  </span>
                </div>
              ) : null}

              {/* Latency profiling breakdown */}
              <div className="border-t pt-2">
                <TimingsBadge timings={turn.timings} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

