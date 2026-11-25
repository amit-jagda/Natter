import React, { useRef, useEffect } from "react";
import { VoiceTurnResponse } from "@/types/api";
import { TranscriptMessage } from "./TranscriptMessage";
import { MessageSquareDashed } from "lucide-react";

interface ConversationHistoryProps {
  turns: VoiceTurnResponse[];
  stopSignal?: number;
}

export const ConversationHistory: React.FC<ConversationHistoryProps> = ({ turns, stopSignal = 0 }) => {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  if (turns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center text-muted-foreground bg-muted/10">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/60 mb-3">
          <MessageSquareDashed className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">No conversation turns yet</h3>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
          Click &ldquo;Start Speaking&rdquo; below to record your voice. The pipeline will transcribe,
          reason, and respond with natural voice.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {turns.map((turn, index) => (
        <TranscriptMessage
          key={`${turn.session_id}-${index}`}
          turn={turn}
          turnIndex={index}
          stopSignal={stopSignal}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
};

