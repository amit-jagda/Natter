import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { VoiceProvidersStatusResponse } from "@/types/api";
import { Mic, Cpu, Volume2, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ProviderStatusProps {
  status?: VoiceProvidersStatusResponse;
  isLoading: boolean;
  onRefresh: () => void;
}

export const ProviderStatus: React.FC<ProviderStatusProps> = ({
  status,
  isLoading,
  onRefresh,
}) => {
  const renderBadge = (configured: boolean, available: boolean) => {
    if (!available) {
      return (
        <Badge variant="destructive" className="gap-1 text-[11px]">
          <AlertCircle className="h-3 w-3" /> Unavailable
        </Badge>
      );
    }
    if (!configured) {
      return (
        <Badge variant="secondary" className="gap-1 text-[11px] text-amber-600 bg-amber-50 border-amber-200">
          <AlertCircle className="h-3 w-3" /> Missing Key
        </Badge>
      );
    }
    return (
      <Badge variant="default" className="gap-1 text-[11px] bg-emerald-600">
        <CheckCircle2 className="h-3 w-3" /> Ready
      </Badge>
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Voice Engine Provider Status
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-xs text-muted-foreground"
          onClick={onRefresh}
          disabled={isLoading}
        >
          <RefreshCw className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {/* STT Card */}
        <Card className="border bg-card/60">
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-500/10 text-blue-600">
                  <Mic className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground">Speech-to-Text</div>
                  <div className="text-sm font-semibold capitalize">
                    {status?.stt.provider || "Loading..."}
                  </div>
                </div>
              </div>
              {status && renderBadge(status.stt.configured, status.stt.available)}
            </div>
            {status?.stt.details && (
              <p className="mt-2 text-[11px] text-muted-foreground line-clamp-1">
                {status.stt.details}
              </p>
            )}
          </CardContent>
        </Card>

        {/* LLM Card */}
        <Card className="border bg-card/60">
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-purple-500/10 text-purple-600">
                  <Cpu className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground">Conversational LLM</div>
                  <div className="text-sm font-semibold capitalize">
                    {status?.llm.provider || "Loading..."}
                  </div>
                </div>
              </div>
              {status && renderBadge(status.llm.configured, status.llm.available)}
            </div>
            {status?.llm.details && (
              <p className="mt-2 text-[11px] text-muted-foreground line-clamp-1">
                {status.llm.details}
              </p>
            )}
          </CardContent>
        </Card>

        {/* TTS Card */}
        <Card className="border bg-card/60">
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600">
                  <Volume2 className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground">Text-to-Speech</div>
                  <div className="text-sm font-semibold capitalize">
                    {status?.tts.provider || "Loading..."}
                  </div>
                </div>
              </div>
              {status && renderBadge(status.tts.configured, status.tts.available)}
            </div>
            {status?.tts.details && (
              <p className="mt-2 text-[11px] text-muted-foreground line-clamp-1">
                {status.tts.details}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

