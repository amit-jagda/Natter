import React from "react";
import { Badge } from "@/components/ui/badge";
import { VoiceTurnTimings } from "@/types/api";
import { Clock, Cpu, Mic, Volume2 } from "lucide-react";

interface TimingsBadgeProps {
  timings: VoiceTurnTimings;
  className?: string;
}

export const TimingsBadge: React.FC<TimingsBadgeProps> = ({ timings, className = "" }) => {
  return (
    <div className={`flex flex-wrap items-center gap-1.5 text-xs ${className}`}>
      <Badge variant="outline" className="gap-1 font-mono text-[11px] text-muted-foreground">
        <Mic className="h-3 w-3 text-blue-500" />
        STT: {timings.stt_ms}ms
      </Badge>
      <Badge variant="outline" className="gap-1 font-mono text-[11px] text-muted-foreground">
        <Cpu className="h-3 w-3 text-purple-500" />
        LLM: {timings.llm_ms}ms
      </Badge>
      <Badge variant="outline" className="gap-1 font-mono text-[11px] text-muted-foreground">
        <Volume2 className="h-3 w-3 text-emerald-500" />
        TTS: {timings.tts_ms}ms
      </Badge>
      <Badge variant="secondary" className="gap-1 font-mono font-semibold text-[11px]">
        <Clock className="h-3 w-3 text-primary" />
        Total: {timings.total_ms}ms
      </Badge>
    </div>
  );
};

