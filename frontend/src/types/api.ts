/**
 * Standard API Response and Pagination Types.
 */

export interface APIResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface HealthStatusResponse {
  status: "healthy" | "degraded" | "unhealthy";
  version: string;
  environment: string;
  timestamp: string;
  services: {
    database: { status: string; details: Record<string, string> };
    redis: { status: string; details: Record<string, string> };
  };
}

export interface VoiceTurnTimings {
  stt_ms: number;
  llm_ms: number;
  tts_ms: number;
  total_ms: number;
}

export interface VoiceTurnResponse {
  session_id: string;
  transcript: string;
  response_text: string;
  audio_base64: string | null;
  audio_mime_type: string | null;
  audio_error: string | null;
  timings: VoiceTurnTimings;
  providers: {
    stt: string;
    llm: string;
    tts: string;
  };
}

export interface ProviderStatusItem {
  provider: string;
  configured: boolean;
  available: boolean;
  details?: string | null;
}

export interface VoiceProvidersStatusResponse {
  stt: ProviderStatusItem;
  llm: ProviderStatusItem;
  tts: ProviderStatusItem;
}

export interface SessionResetResponse {
  session_id: string;
  reset: boolean;
  message: string;
}

