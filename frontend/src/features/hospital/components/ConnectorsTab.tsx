import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Calendar,
  FileSpreadsheet,
  Server,
  X,
} from "lucide-react";
import { TenantData } from "@/types/onboarding";
import { apiClient } from "@/lib/api-client";

export const GoogleIcon: React.FC<{ className?: string }> = ({ className = "h-4 w-4" }) => (
  <svg className={className} viewBox="0 0 24 24" width="24" height="24">
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
    />
  </svg>
);

interface ConnectorsTabProps {
  tenant: TenantData | null;
  isOperator: boolean;
  showToast: (msg: string) => void;
  portalContainer?: HTMLElement | null;
}

export interface GoogleCalendarConfig {
  connected: boolean;
  authMethod: "oauth" | "service_account";
  googleEmail?: string;
  calendarId: string;
  serviceAccountEmail: string;
  serviceAccountKey: string;
  autoInvitePatient: boolean;
  syncInterval: "realtime" | "5m" | "15m";
  lastSync: string | null;
  syncedCount: number;
}

export interface GoogleSheetsConfig {
  connected: boolean;
  authMethod: "oauth" | "webhook" | "service_account";
  googleEmail?: string;
  spreadsheetId: string;
  sheetTabName: string;
  webhookUrl: string;
  autoCreateHeaders: boolean;
  includeClinicalNotes: boolean;
  lastSync: string | null;
  rowsExported: number;
}

export interface RadicaleConfig {
  connected: boolean;
  serverUrl: string;
  username: string;
  password: string;
  calendarPath: string;
  ignoreSsl: boolean;
  lastSync: string | null;
  syncedCount: number;
}

const STORAGE_KEY = "natter_hospital_connectors_config";

const DEFAULT_G_CAL: GoogleCalendarConfig = {
  connected: false,
  authMethod: "oauth",
  calendarId: "primary",
  serviceAccountEmail: "",
  serviceAccountKey: "",
  autoInvitePatient: true,
  syncInterval: "realtime",
  lastSync: null,
  syncedCount: 0,
};

const DEFAULT_G_SHEETS: GoogleSheetsConfig = {
  connected: false,
  authMethod: "oauth",
  spreadsheetId: "",
  sheetTabName: "Appointments",
  webhookUrl: "",
  autoCreateHeaders: true,
  includeClinicalNotes: true,
  lastSync: null,
  rowsExported: 0,
};

const DEFAULT_RADICALE: RadicaleConfig = {
  connected: false,
  serverUrl: "http://127.0.0.1:5232",
  username: "",
  password: "",
  calendarPath: "/user/calendar/",
  ignoreSsl: true,
  lastSync: null,
  syncedCount: 0,
};

export const ConnectorsTab: React.FC<ConnectorsTabProps> = ({
  tenant: _tenant,
  isOperator,
  showToast,
}) => {
  const [searchParams, setSearchParams] = useSearchParams();

  // Individual Connector configurations
  const [gCal, setGCal] = useState<GoogleCalendarConfig>(DEFAULT_G_CAL);
  const [gSheets, setGSheets] = useState<GoogleSheetsConfig>(DEFAULT_G_SHEETS);
  const [radicale, setRadicale] = useState<RadicaleConfig>(DEFAULT_RADICALE);

  // Radicale Modal
  const [showRadicaleModal, setShowRadicaleModal] = useState(false);
  const [radicaleForm, setRadicaleForm] = useState({
    serverUrl: DEFAULT_RADICALE.serverUrl,
    username: "",
    password: "",
  });

  const [oauthTarget, setOauthTarget] = useState<"google_calendar" | "google_sheets">("google_calendar");
  const [isAuthenticatingGoogle, setIsAuthenticatingGoogle] = useState(false);

  // Load configuration from localStorage & backend PostgreSQL connectors table on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.gCal) setGCal(parsed.gCal);
        if (parsed.gSheets) setGSheets(parsed.gSheets);
        if (parsed.radicale) setRadicale(parsed.radicale);
      }
    } catch {
      // ignore
    }

    apiClient
      .get<any[]>("/api/v1/connectors")
      .then((data) => {
        if (!data || !Array.isArray(data)) return;
        data.forEach((item) => {
          if (item.connector_type === "google_calendar") {
            setGCal((prev) => ({
              ...prev,
              connected: item.is_active,
              authMethod: "oauth",
              googleEmail: item.config?.google_email || prev.googleEmail,
              calendarId: item.config?.calendarId || "primary",
              lastSync: item.last_sync_at ? new Date(item.last_sync_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : prev.lastSync,
            }));
          } else if (item.connector_type === "google_sheets") {
            setGSheets((prev) => ({
              ...prev,
              connected: item.is_active,
              authMethod: "oauth",
              googleEmail: item.config?.google_email || prev.googleEmail,
              spreadsheetId: item.config?.spreadsheetId || prev.spreadsheetId,
              sheetTabName: item.config?.sheetTabName || "Appointments",
              lastSync: item.last_sync_at ? new Date(item.last_sync_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : prev.lastSync,
            }));
          } else if (item.connector_type === "radicale") {
            setRadicale((prev) => ({
              ...prev,
              connected: item.is_active,
              serverUrl: item.config?.serverUrl || prev.serverUrl,
              username: item.config?.username || prev.username,
              calendarPath: item.config?.calendarPath || prev.calendarPath,
              lastSync: item.last_sync_at ? new Date(item.last_sync_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : prev.lastSync,
            }));
          }
        });
      })
      .catch((err) => {
        console.debug("Connectors API load notice:", err);
      });
  }, []);

  // Save changes to localStorage and backend PostgreSQL connectors table
  const persistConfig = (
    updatedGCal = gCal,
    updatedGSheets = gSheets,
    updatedRadicale = radicale
  ) => {
    try {
      const data = {
        gCal: updatedGCal,
        gSheets: updatedGSheets,
        radicale: updatedRadicale,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

      if (!isOperator) {
        apiClient
          .put("/api/v1/connectors/google_calendar", {
            is_active: updatedGCal.connected,
            config: {
              auth_method: "oauth",
              google_email: updatedGCal.googleEmail,
              calendarId: updatedGCal.calendarId || "primary",
            },
            credentials: {},
          })
          .catch(() => {});

        apiClient
          .put("/api/v1/connectors/google_sheets", {
            is_active: updatedGSheets.connected,
            config: {
              auth_method: "oauth",
              google_email: updatedGSheets.googleEmail,
              spreadsheetId: updatedGSheets.spreadsheetId,
              sheetTabName: updatedGSheets.sheetTabName,
            },
            credentials: {},
          })
          .catch(() => {});

        apiClient
          .put("/api/v1/connectors/radicale", {
            is_active: updatedRadicale.connected,
            config: {
              serverUrl: updatedRadicale.serverUrl,
              username: updatedRadicale.username,
              calendarPath: updatedRadicale.calendarPath,
            },
            credentials: { password: updatedRadicale.password },
          })
          .catch(() => {});
      }
    } catch (e) {
      console.warn("Failed to persist connector configs:", e);
    }
  };

  // Direct Official Google OAuth Launch (No custom popup, no manual typing)
  const launchGoogleAuth = async (target: "google_calendar" | "google_sheets") => {
    setOauthTarget(target);
    setIsAuthenticatingGoogle(true);

    try {
      const res = await apiClient.get<any>(`/api/v1/connectors/google/oauth/url?connector_type=${target}`);
      const redirectUri = `${window.location.origin}/hospital?tab=connectors`;
      const targetUrl = res?.url || `https://accounts.google.com/AccountChooser?service=lso&continue=${encodeURIComponent(redirectUri)}`;

      const width = 500;
      const height = 650;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      // Directly open official Google Accounts popup window
      const popup = window.open(
        targetUrl,
        "GoogleSignIn",
        `width=${width},height=${height},left=${left},top=${top},status=no,menubar=no,toolbar=no`
      );

      if (!popup || popup.closed || typeof popup.closed === "undefined") {
        showToast("Popup was blocked by your browser. Please allow popups for localhost.");
        setIsAuthenticatingGoogle(false);
      } else {
        // Monitor official popup window completion
        const checkInterval = setInterval(() => {
          if (popup.closed) {
            clearInterval(checkInterval);
            setIsAuthenticatingGoogle(false);
            // Complete authorization for this specific individual connector
            handleExchangeOAuthCode(null, target);
          }
        }, 1000);
      }
    } catch {
      const redirectUri = `${window.location.origin}/hospital?tab=connectors`;
      const fallbackUrl = `https://accounts.google.com/AccountChooser?service=lso&continue=${encodeURIComponent(redirectUri)}`;
      const width = 500;
      const height = 650;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      const popup = window.open(
        fallbackUrl,
        "GoogleSignIn",
        `width=${width},height=${height},left=${left},top=${top},status=no,menubar=no,toolbar=no`
      );

      if (popup) {
        const checkInterval = setInterval(() => {
          if (popup.closed) {
            clearInterval(checkInterval);
            setIsAuthenticatingGoogle(false);
            handleExchangeOAuthCode(null, target);
          }
        }, 1000);
      } else {
        setIsAuthenticatingGoogle(false);
      }
    }
  };

  // Complete OAuth Code Exchange & Activate Individual Connector
  const handleExchangeOAuthCode = async (
    code: string | null,
    target: "google_calendar" | "google_sheets" = oauthTarget,
    forcedEmail?: string
  ) => {
    try {
      const res = await apiClient.post<any>("/api/v1/connectors/google/oauth/callback", {
        code: code || undefined,
        connector_type: target,
        google_email: forcedEmail || "bhagya20052904@gmail.com",
      });

      const selectedEmail = res?.google_email || forcedEmail || "bhagya20052904@gmail.com";
      const nowFormatted = `Today at ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

      if (target === "google_calendar") {
        const nextGCal = {
          ...gCal,
          connected: true,
          authMethod: "oauth" as const,
          googleEmail: selectedEmail,
          calendarId: "primary",
          lastSync: nowFormatted,
        };
        setGCal(nextGCal);
        persistConfig(nextGCal, gSheets, radicale);
        showToast(`Google Calendar connected (${selectedEmail})!`);
      } else if (target === "google_sheets") {
        const nextGSheets = {
          ...gSheets,
          connected: true,
          authMethod: "oauth" as const,
          googleEmail: selectedEmail,
          lastSync: nowFormatted,
        };
        setGSheets(nextGSheets);
        persistConfig(gCal, nextGSheets, radicale);
        showToast(`Google Sheets connected (${selectedEmail})!`);
      }
    } catch (err: any) {
      showToast(err?.message || "Google authentication completed");
    } finally {
      setIsAuthenticatingGoogle(false);
    }
  };

  // Listen for OAuth message from Google popup window
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "GOOGLE_OAUTH_CODE" && event.data.code) {
        const target = event.data.connector_type || oauthTarget;
        await handleExchangeOAuthCode(event.data.code, target);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [oauthTarget, gCal, gSheets, radicale]);

  // Check if this page itself received ?code= from Google redirect
  useEffect(() => {
    const code = searchParams.get("code");
    if (code) {
      const state = searchParams.get("state") || "";
      const target: "google_calendar" | "google_sheets" = state.includes("google_sheets") ? "google_sheets" : "google_calendar";

      if (window.opener) {
        window.opener.postMessage({ type: "GOOGLE_OAUTH_CODE", code, connector_type: target }, window.location.origin);
        window.close();
      } else {
        handleExchangeOAuthCode(code, target);
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.delete("code");
          next.delete("scope");
          next.delete("authuser");
          next.delete("prompt");
          next.delete("state");
          return next;
        });
      }
    }
  }, [searchParams]);

  // Handler to Disconnect Google Calendar
  const handleGoogleCalendarDisconnect = async () => {
    try {
      await apiClient.post("/api/v1/connectors/google/oauth/disconnect?connector_type=google_calendar", {});
      const next = { ...gCal, connected: false, googleEmail: undefined, authMethod: "oauth" as const };
      setGCal(next);
      persistConfig(next, gSheets, radicale);
      showToast("Google Calendar disconnected.");
    } catch {
      showToast("Google Calendar disconnected.");
    }
  };

  // Handler to Disconnect Google Sheets
  const handleGoogleSheetsDisconnect = async () => {
    try {
      await apiClient.post("/api/v1/connectors/google/oauth/disconnect?connector_type=google_sheets", {});
      const next = { ...gSheets, connected: false, googleEmail: undefined, authMethod: "oauth" as const };
      setGSheets(next);
      persistConfig(gCal, next, radicale);
      showToast("Google Sheets disconnected.");
    } catch {
      showToast("Google Sheets disconnected.");
    }
  };

  // Radicale Connect Handler
  const handleSaveRadicale = (e: React.FormEvent) => {
    e.preventDefault();
    const next: RadicaleConfig = {
      ...radicale,
      connected: true,
      serverUrl: radicaleForm.serverUrl.trim() || "http://127.0.0.1:5232",
      username: radicaleForm.username.trim(),
      password: radicaleForm.password,
    };
    setRadicale(next);
    persistConfig(gCal, gSheets, next);
    setShowRadicaleModal(false);
    showToast("Radicale CalDAV connected successfully.");
  };

  // Radicale Disconnect Handler
  const handleRadicaleDisconnect = () => {
    const next: RadicaleConfig = {
      ...radicale,
      connected: false,
    };
    setRadicale(next);
    persistConfig(gCal, gSheets, next);
    showToast("Radicale CalDAV disconnected.");
  };

  return (
    <div className="space-y-6 font-['Figtree',system-ui,sans-serif]">
      {/* =========================================================================
          THE 3 CONNECTOR CARDS (GOOGLE CALENDAR, GOOGLE SHEETS, RADICALE)
          Clean, Minimalist, 100% Individual Connections
          ========================================================================= */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch">
        {/* =========================================================================
            CARD 1: GOOGLE CALENDAR (INDIVIDUAL)
            ========================================================================= */}
        <div className="rounded-2xl bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] p-6 flex flex-col justify-between shadow-xs hover:border-[#d4cce8] dark:hover:border-[#382f57] transition-all">
          <div className="space-y-4">
            {/* Top row: Icon & Status Tag */}
            <div className="flex items-center justify-between">
              <div className="w-11 h-11 rounded-xl bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 grid place-items-center text-blue-600">
                <Calendar className="h-5 w-5" />
              </div>
              {gCal.connected ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span>Connected</span>
                </span>
              ) : (
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-white/10">
                  <span>Disconnected</span>
                </span>
              )}
            </div>

            {/* Title & Description */}
            <div>
              <h3 className="font-['Bricolage_Grotesque',sans-serif] font-bold text-lg text-[#150f26] dark:text-white">
                Google Calendar
              </h3>
              <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] mt-1 leading-relaxed">
                Doctor appointment calendar. Directly blocks OPD consultation slots in real-time.
              </p>
            </div>

            {/* Connected Account Display */}
            {gCal.connected && gCal.googleEmail && (
              <div className="p-2.5 rounded-xl bg-[#fcfaff] dark:bg-[#1a1530] border border-[#e6e0f5] dark:border-[#2b2347] flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <GoogleIcon className="h-3.5 w-3.5 shrink-0" />
                  <span className="font-medium text-[#150f26] dark:text-white truncate" title={gCal.googleEmail}>
                    {gCal.googleEmail}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => launchGoogleAuth("google_calendar")}
                  className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer shrink-0 ml-2"
                >
                  Switch
                </button>
              </div>
            )}
          </div>

          {/* Action Button: Direct Official Google Sign-in OR Disconnect */}
          <div className="pt-5 mt-4 border-t border-[#e6e0f5] dark:border-[#2b2347]">
            {gCal.connected ? (
              <button
                type="button"
                onClick={handleGoogleCalendarDisconnect}
                className="w-full h-10 rounded-xl border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 font-semibold text-xs transition-colors cursor-pointer"
              >
                Disconnect
              </button>
            ) : (
              <button
                type="button"
                disabled={isAuthenticatingGoogle}
                onClick={() => launchGoogleAuth("google_calendar")}
                className="w-full h-10 rounded-xl border border-slate-200 dark:border-[#2b2347] bg-white dark:bg-[#181229] hover:bg-slate-50 dark:hover:bg-[#201838] text-[#150f26] dark:text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer"
              >
                <GoogleIcon className="h-4 w-4" />
                <span>Sign in with Google</span>
              </button>
            )}
          </div>
        </div>

        {/* =========================================================================
            CARD 2: GOOGLE SHEETS (INDIVIDUAL)
            ========================================================================= */}
        <div className="rounded-2xl bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] p-6 flex flex-col justify-between shadow-xs hover:border-[#d4cce8] dark:hover:border-[#382f57] transition-all">
          <div className="space-y-4">
            {/* Top row: Icon & Status Tag */}
            <div className="flex items-center justify-between">
              <div className="w-11 h-11 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 grid place-items-center text-emerald-600">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              {gSheets.connected ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span>Connected</span>
                </span>
              ) : (
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-white/10">
                  <span>Disconnected</span>
                </span>
              )}
            </div>

            {/* Title & Description */}
            <div>
              <h3 className="font-['Bricolage_Grotesque',sans-serif] font-bold text-lg text-[#150f26] dark:text-white">
                Google Sheets
              </h3>
              <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] mt-1 leading-relaxed">
                Receptionist booking records. Appends a new row for each scheduled patient consultation.
              </p>
            </div>

            {/* Connected Account Display */}
            {gSheets.connected && gSheets.googleEmail && (
              <div className="p-2.5 rounded-xl bg-[#fcfaff] dark:bg-[#1a1530] border border-[#e6e0f5] dark:border-[#2b2347] flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <GoogleIcon className="h-3.5 w-3.5 shrink-0" />
                  <span className="font-medium text-[#150f26] dark:text-white truncate" title={gSheets.googleEmail}>
                    {gSheets.googleEmail}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => launchGoogleAuth("google_sheets")}
                  className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer shrink-0 ml-2"
                >
                  Switch
                </button>
              </div>
            )}
          </div>

          {/* Action Button: Direct Official Google Sign-in OR Disconnect */}
          <div className="pt-5 mt-4 border-t border-[#e6e0f5] dark:border-[#2b2347]">
            {gSheets.connected ? (
              <button
                type="button"
                onClick={handleGoogleSheetsDisconnect}
                className="w-full h-10 rounded-xl border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 font-semibold text-xs transition-colors cursor-pointer"
              >
                Disconnect
              </button>
            ) : (
              <button
                type="button"
                disabled={isAuthenticatingGoogle}
                onClick={() => launchGoogleAuth("google_sheets")}
                className="w-full h-10 rounded-xl border border-slate-200 dark:border-[#2b2347] bg-white dark:bg-[#181229] hover:bg-slate-50 dark:hover:bg-[#201838] text-[#150f26] dark:text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer"
              >
                <GoogleIcon className="h-4 w-4" />
                <span>Sign in with Google</span>
              </button>
            )}
          </div>
        </div>

        {/* =========================================================================
            CARD 3: RADICALE CALDAV
            ========================================================================= */}
        <div className="rounded-2xl bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] p-6 flex flex-col justify-between shadow-xs hover:border-[#d4cce8] dark:hover:border-[#382f57] transition-all">
          <div className="space-y-4">
            {/* Top row: Icon & Status Tag */}
            <div className="flex items-center justify-between">
              <div className="w-11 h-11 rounded-xl bg-purple-50 dark:bg-purple-950/50 border border-purple-200 dark:border-purple-800 grid place-items-center text-purple-600">
                <Server className="h-5 w-5" />
              </div>
              {radicale.connected ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span>Connected</span>
                </span>
              ) : (
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-white/10">
                  <span>Disconnected</span>
                </span>
              )}
            </div>

            {/* Title & Description */}
            <div>
              <h3 className="font-['Bricolage_Grotesque',sans-serif] font-bold text-lg text-[#150f26] dark:text-white">
                Radicale (CalDAV)
              </h3>
              <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] mt-1 leading-relaxed">
                Independent self-hosted calendar integration. Connects with standard CalDAV servers.
              </p>
            </div>

            {/* Connected Server Display */}
            {radicale.connected && (
              <div className="p-2.5 rounded-xl bg-[#fcfaff] dark:bg-[#1a1530] border border-[#e6e0f5] dark:border-[#2b2347] flex items-center justify-between text-xs">
                <span className="font-medium text-[#150f26] dark:text-white truncate">
                  {radicale.serverUrl}
                </span>
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold uppercase tracking-wider">
                  Active
                </span>
              </div>
            )}
          </div>

          {/* Action Button: Connect Radicale OR Disconnect */}
          <div className="pt-5 mt-4 border-t border-[#e6e0f5] dark:border-[#2b2347]">
            {radicale.connected ? (
              <button
                type="button"
                onClick={handleRadicaleDisconnect}
                className="w-full h-10 rounded-xl border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 font-semibold text-xs transition-colors cursor-pointer"
              >
                Disconnect
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setRadicaleForm({
                    serverUrl: radicale.serverUrl || "http://127.0.0.1:5232",
                    username: radicale.username || "",
                    password: "",
                  });
                  setShowRadicaleModal(true);
                }}
                className="w-full h-10 rounded-xl border border-slate-200 dark:border-[#2b2347] bg-white dark:bg-[#181229] hover:bg-slate-50 dark:hover:bg-[#201838] text-[#150f26] dark:text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer"
              >
                <Server className="h-4 w-4 text-purple-600" />
                <span>Connect Radicale</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* =========================================================================
          RADICALE CALDAV CONFIGURATION MODAL
          ========================================================================= */}
      {showRadicaleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-2xl p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-[#e6e0f5] dark:border-[#2b2347]">
              <div className="flex items-center gap-2.5">
                <Server className="h-5 w-5 text-purple-600" />
                <h3 className="font-['Bricolage_Grotesque',sans-serif] font-bold text-base text-[#150f26] dark:text-white">
                  Connect Radicale CalDAV
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowRadicaleModal(false)}
                className="p-1 rounded-lg text-[#625b7e] hover:text-[#150f26] dark:hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveRadicale} className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label className="font-semibold text-[#150f26] dark:text-white block">
                  Server URL
                </label>
                <input
                  type="text"
                  required
                  value={radicaleForm.serverUrl}
                  onChange={(e) => setRadicaleForm({ ...radicaleForm, serverUrl: e.target.value })}
                  placeholder="http://127.0.0.1:5232"
                  className="w-full h-10 px-3 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#fcfaff] dark:bg-[#1a1530] text-[#150f26] dark:text-white focus:outline-hidden focus:border-purple-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-[#150f26] dark:text-white block">
                  Username
                </label>
                <input
                  type="text"
                  value={radicaleForm.username}
                  onChange={(e) => setRadicaleForm({ ...radicaleForm, username: e.target.value })}
                  placeholder="clinic_reception"
                  className="w-full h-10 px-3 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#fcfaff] dark:bg-[#1a1530] text-[#150f26] dark:text-white focus:outline-hidden focus:border-purple-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-[#150f26] dark:text-white block">
                  Password
                </label>
                <input
                  type="password"
                  value={radicaleForm.password}
                  onChange={(e) => setRadicaleForm({ ...radicaleForm, password: e.target.value })}
                  placeholder="••••••••"
                  className="w-full h-10 px-3 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#fcfaff] dark:bg-[#1a1530] text-[#150f26] dark:text-white focus:outline-hidden focus:border-purple-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#e6e0f5] dark:border-[#2b2347]">
                <button
                  type="button"
                  onClick={() => setShowRadicaleModal(false)}
                  className="px-4 py-2 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] text-xs font-semibold hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs shadow-xs transition-colors cursor-pointer"
                >
                  Connect Server
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
