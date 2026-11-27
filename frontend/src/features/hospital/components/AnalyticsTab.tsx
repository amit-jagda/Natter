import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  CheckCircle2,
  Clock,
  Phone,
  UserCheck,
  Sparkles,
  RefreshCw,
  Search,
  X,
  FileText,
  Award,
  Loader2,
  Stethoscope,
  ChevronRight,
  ChevronLeft,
  AlertTriangle,
  Calendar,
} from "lucide-react";
import { TenantData } from "@/types/onboarding";
import { apiClient } from "@/lib/api-client";

interface AnalyticsTabProps {
  tenant: TenantData | null;
  isOperator: boolean;
  showToast: (msg: string) => void;
  portalContainer?: HTMLElement | null;
}

interface DoctorDemand {
  name: string;
  specialty?: string;
  requests: number;
  fulfilled_count: number;
  fulfillment_rate: number;
  weekly_capacity: number;
  utilization_rate: number;
}

interface SlotDemand {
  slot: string;
  count: number;
}

interface TopIssue {
  category: string;
  severity: string;
  description: string;
  count: number;
}

interface DistributionItem {
  name: string;
  count: number;
  percentage: number;
}

interface DashboardMetrics {
  total_calls: number;
  completed_analyses: number;
  pending_analyses: number;
  resolution_rate: number;
  avg_agent_score: number;
  avg_duration_seconds: number;
  executive_summary?: string;
  summary_points?: string[];
  summary_highlights?: string[];
  date_range_label?: string;
  top_doctors: DoctorDemand[];
  slot_demands: SlotDemand[];
  agent_quality_scores: {
    correctness?: number;
    intent_understanding?: number;
    communication?: number;
    tool_usage?: number;
    policy_compliance?: number;
    overall?: number;
    [key: string]: number | undefined;
  };
  top_issues: TopIssue[];
  top_improvements: string[];
  language_distribution: DistributionItem[];
  sentiment_distribution: DistributionItem[];
}

interface CallListItem {
  id: string;
  session_id: string;
  caller_phone: string | null;
  patient_name?: string | null;
  channel: string;
  duration_seconds: number;
  started_at: string;
  status: string;
  analysis_status: "pending" | "completed" | "failed";
  transcript_preview: string;
  language?: string | null;
  sentiment?: string | null;
  resolution_status?: string | null;
  agent_score?: number | null;
  primary_intent?: string | null;
}

interface CallDetail {
  session: {
    id: string;
    session_id: string;
    caller_phone: string | null;
    dialed_number: string | null;
    channel: string;
    started_at: string;
    duration_seconds: number;
    status: string;
    analysis_status: string;
    transcript: string;
  };
  analysis?: {
    summary: string;
    primary_intent: string;
    secondary_intents: string[];
    sentiment: string;
    resolution_status: string;
    agent_score: number;
    scores: Record<string, number>;
    customer_satisfaction: number;
    language: string;
    escalation_required: boolean;
    issues: Array<{
      category: string;
      severity: string;
      description: string;
      evidence?: string;
      recommendation?: string;
    }>;
    improvements: string[];
    analyzed_at: string;
  };
  requests: Array<{
    id: string;
    request_type: string;
    requested_doctor_name?: string | null;
    requested_department?: string | null;
    requested_date?: string | null;
    requested_time_slot?: string | null;
    fulfilled: boolean;
    failure_reason?: string | null;
  }>;
}

// Compact SVG Donut Chart Component
const DonutPieChart: React.FC<{
  data: DistributionItem[];
  colors: string[];
  centerLabel: string;
}> = ({ data, colors, centerLabel }) => {
  const radius = 34;
  const circumference = 2 * Math.PI * radius; // ~213.63

  let cumulativeOffset = 0;
  const validData = data.filter((d) => d.count > 0);

  if (validData.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-xs text-[#625b7e] dark:text-[#a29bc2]">
        No data for selected time range
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <div className="relative w-20 h-20 shrink-0 flex items-center justify-center">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="transparent"
            stroke="currentColor"
            strokeWidth="14"
            className="text-gray-100 dark:text-white/5"
          />
          {validData.map((item, idx) => {
            const strokeDash = (item.percentage / 100) * circumference;
            const strokeOffset = -cumulativeOffset;
            cumulativeOffset += strokeDash;
            const color = colors[idx % colors.length];

            return (
              <circle
                key={idx}
                cx="50"
                cy="50"
                r={radius}
                fill="transparent"
                stroke={color}
                strokeWidth="14"
                strokeDasharray={`${strokeDash} ${circumference}`}
                strokeDashoffset={strokeOffset}
                className="transition-all duration-500"
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
          <span className="text-[10px] font-bold text-[#150f26] dark:text-[#f6f3ff] leading-none">
            {centerLabel}
          </span>
        </div>
      </div>

      <div className="flex-1 space-y-1">
        {validData.map((item, idx) => {
          const color = colors[idx % colors.length];
          return (
            <div key={idx} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                <span className="truncate text-[#150f26] dark:text-[#f6f3ff] font-medium">
                  {item.name}
                </span>
              </div>
              <span className="text-[11px] font-bold text-[#625b7e] dark:text-[#a29bc2] shrink-0 ml-1">
                {item.percentage}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const AnalyticsTab: React.FC<AnalyticsTabProps> = ({
  tenant: _tenant,
  isOperator: _isOperator,
  showToast,
  portalContainer,
}) => {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [calls, setCalls] = useState<CallListItem[]>([]);
  const [totalCalls, setTotalCalls] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingMetrics, setLoadingMetrics] = useState(true);
  const [loadingCalls, setLoadingCalls] = useState(true);
  const [analyzingPending, setAnalyzingPending] = useState(false);

  // Time Range Filter: 'all', 'today', '7d', '30d', 'custom'
  const [timeRange, setTimeRange] = useState<string>("all");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [showCustomRangePicker, setShowCustomRangePicker] = useState<boolean>(false);

  // Search with backend debouncing
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Table filters & Pagination
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Selected Call Modal
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [callDetail, setCallDetail] = useState<CallDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Point-wise summary items
  const summaryPoints = React.useMemo(() => {
    if (metrics?.summary_points && metrics.summary_points.length > 0) {
      return metrics.summary_points;
    }
    if (metrics?.executive_summary) {
      const lines = metrics.executive_summary
        .split(/\n[•\-*]\s*|\n/)
        .map((s) => s.trim().replace(/^[•\-*]\s*/, ""))
        .filter((s) => s.length > 5);
      if (lines.length > 0) return lines;
      return [metrics.executive_summary];
    }
    return [
      "No call sessions have been analyzed yet for this period.",
      "Click 'Analyze Pending Calls' to generate point-wise intelligence.",
    ];
  }, [metrics]);

  // 350ms Debounce effect for backend search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const fetchMetrics = useCallback(async () => {
    try {
      setLoadingMetrics(true);
      const params = new URLSearchParams();
      if (timeRange === "custom" && (startDate || endDate)) {
        if (startDate) params.set("start_date", startDate);
        if (endDate) params.set("end_date", endDate);
      } else {
        params.set("time_range", timeRange);
      }
      const res = await apiClient.get<DashboardMetrics>(
        `/api/v1/analytics/dashboard?${params.toString()}`
      );
      setMetrics(res);
    } catch (err: any) {
      console.error("Failed to load analytics metrics:", err);
      showToast("Unable to load analytics data.");
    } finally {
      setLoadingMetrics(false);
    }
  }, [timeRange, startDate, endDate, showToast]);

  const fetchCalls = useCallback(async () => {
    try {
      setLoadingCalls(true);
      const queryParams = new URLSearchParams({
        page: String(page),
        size: String(pageSize),
        analysis_status: statusFilter,
      });
      if (timeRange === "custom" && (startDate || endDate)) {
        if (startDate) queryParams.set("start_date", startDate);
        if (endDate) queryParams.set("end_date", endDate);
      } else {
        queryParams.set("time_range", timeRange);
      }
      if (debouncedSearch) {
        queryParams.set("search", debouncedSearch);
      }
      const res = await apiClient.get<{
        items: CallListItem[];
        total: number;
        total_pages?: number;
      }>(`/api/v1/analytics/calls?${queryParams.toString()}`);

      setCalls(res.items || []);
      setTotalCalls(res.total || 0);
      setTotalPages(res.total_pages || Math.max(1, Math.ceil((res.total || 0) / pageSize)));
    } catch (err: any) {
      console.error("Failed to fetch calls:", err);
    } finally {
      setLoadingCalls(false);
    }
  }, [page, pageSize, statusFilter, debouncedSearch, timeRange, startDate, endDate]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  useEffect(() => {
    fetchCalls();
  }, [fetchCalls]);

  const handleAnalyzePending = async () => {
    try {
      setAnalyzingPending(true);
      const res = await apiClient.post<{
        total_pending_found: number;
        analyzed_count: number;
        failed_count: number;
        status?: string;
        message: string;
      }>("/api/v1/analytics/analyze-pending?limit=50");
      showToast(res.message);

      // Refresh immediately
      await Promise.all([fetchMetrics(), fetchCalls()]);

      // If background task is running, poll every 2.5s to stream updates until all are completed
      if (res.status === "processing" && res.total_pending_found > 0) {
        let attempts = 0;
        const interval = setInterval(async () => {
          attempts += 1;
          await Promise.all([fetchMetrics(), fetchCalls()]);
          if (attempts >= 6) {
            clearInterval(interval);
            setAnalyzingPending(false);
          }
        }, 2500);
      } else {
        setAnalyzingPending(false);
      }
    } catch (err: any) {
      console.error("Failed to analyze pending calls:", err);
      showToast("Failed to run analysis on pending calls.");
      setAnalyzingPending(false);
    }
  };

  const handleOpenDetail = async (callId: string) => {
    setSelectedCallId(callId);
    setLoadingDetail(true);
    setCallDetail(null);
    try {
      const res = await apiClient.get<CallDetail>(`/api/v1/analytics/calls/${callId}`);
      setCallDetail(res);
    } catch (err: any) {
      console.error("Failed to fetch call detail:", err);
      showToast("Failed to load call details.");
    } finally {
      setLoadingDetail(false);
    }
  };

  const scoreCategories = [
    { key: "correctness", label: "Medical & Factual Accuracy" },
    { key: "intent_understanding", label: "Intent Understanding" },
    { key: "communication", label: "Communication & Tone" },
    { key: "tool_usage", label: "Healthcare Tool Calling" },
    { key: "policy_compliance", label: "Policy Compliance" },
    { key: "overall", label: "Overall Quality Rating" },
  ];

  const pendingCount = metrics?.pending_analyses ?? 0;
  const hasAnalyses = (metrics?.completed_analyses ?? 0) > 0;

  // Single Global Header Control Bar mounted in the main page top header
  const headerActionsNode = (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Time Range Selector */}
      <div className="flex items-center bg-gray-100 dark:bg-white/5 p-0.5 rounded-xl border border-gray-200/60 dark:border-white/10 text-xs relative">
        <button
          type="button"
          onClick={() => {
            setTimeRange("all");
            setStartDate("");
            setEndDate("");
            setShowCustomRangePicker(false);
            setPage(1);
          }}
          className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
            timeRange === "all"
              ? "bg-white dark:bg-white/20 text-[#150f26] dark:text-white shadow-xs font-semibold"
              : "text-[#625b7e] dark:text-[#a29bc2] hover:text-[#150f26]"
          }`}
        >
          All Time
        </button>
        <button
          type="button"
          onClick={() => {
            setTimeRange("today");
            setStartDate("");
            setEndDate("");
            setShowCustomRangePicker(false);
            setPage(1);
          }}
          className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
            timeRange === "today"
              ? "bg-white dark:bg-white/20 text-[#150f26] dark:text-white shadow-xs font-semibold"
              : "text-[#625b7e] dark:text-[#a29bc2] hover:text-[#150f26]"
          }`}
        >
          Today
        </button>
        <button
          type="button"
          onClick={() => {
            setTimeRange("7d");
            setStartDate("");
            setEndDate("");
            setShowCustomRangePicker(false);
            setPage(1);
          }}
          className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
            timeRange === "7d"
              ? "bg-white dark:bg-white/20 text-[#150f26] dark:text-white shadow-xs font-semibold"
              : "text-[#625b7e] dark:text-[#a29bc2] hover:text-[#150f26]"
          }`}
        >
          Last 7 Days
        </button>
        <button
          type="button"
          onClick={() => {
            setTimeRange("30d");
            setStartDate("");
            setEndDate("");
            setShowCustomRangePicker(false);
            setPage(1);
          }}
          className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
            timeRange === "30d"
              ? "bg-white dark:bg-white/20 text-[#150f26] dark:text-white shadow-xs font-semibold"
              : "text-[#625b7e] dark:text-[#a29bc2] hover:text-[#150f26]"
          }`}
        >
          30 Days
        </button>
        <button
          type="button"
          onClick={() => setShowCustomRangePicker(!showCustomRangePicker)}
          className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer inline-flex items-center gap-1 ${
            timeRange === "custom"
              ? "bg-white dark:bg-white/20 text-[#7c3aed] dark:text-purple-300 shadow-xs font-semibold"
              : "text-[#625b7e] dark:text-[#a29bc2] hover:text-[#150f26]"
          }`}
          title="Filter by custom date range"
        >
          <Calendar className="h-3 w-3" />
          <span>{timeRange === "custom" && startDate && endDate ? `${startDate} ~ ${endDate}` : "Custom"}</span>
        </button>

        {/* Custom Date Range Popover */}
        {showCustomRangePicker && (
          <div className="absolute right-0 top-full mt-2 z-50 bg-white dark:bg-[#1a1429] border border-[#e2dcf2] dark:border-white/10 rounded-xl p-3 shadow-xl w-72 space-y-2 text-xs animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-1 border-b border-gray-100 dark:border-white/10">
              <span className="font-bold text-[#150f26] dark:text-[#f6f3ff]">Filter by Custom Dates</span>
              <button
                type="button"
                onClick={() => setShowCustomRangePicker(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-white cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="space-y-1.5">
              <div>
                <label className="text-[10px] font-semibold text-[#625b7e] dark:text-[#a29bc2] block mb-0.5">
                  Start Date (From)
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-2 py-1 text-xs rounded-lg border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-[#150f26] dark:text-[#f6f3ff] focus:outline-none focus:ring-1 focus:ring-[#7c3aed]"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-[#625b7e] dark:text-[#a29bc2] block mb-0.5">
                  End Date (To)
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-2 py-1 text-xs rounded-lg border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-[#150f26] dark:text-[#f6f3ff] focus:outline-none focus:ring-1 focus:ring-[#7c3aed]"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => {
                  setStartDate("");
                  setEndDate("");
                  setTimeRange("all");
                  setShowCustomRangePicker(false);
                  setPage(1);
                }}
                className="px-2 py-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5 text-xs cursor-pointer"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => {
                  if (startDate || endDate) {
                    setTimeRange("custom");
                    setShowCustomRangePicker(false);
                    setPage(1);
                  }
                }}
                disabled={!startDate && !endDate}
                className="px-3 py-1 rounded bg-[#7c3aed] hover:bg-[#6d28d9] disabled:opacity-40 text-white text-xs font-semibold cursor-pointer"
              >
                Apply Range
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Refresh Button */}
      <button
        type="button"
        onClick={() => {
          fetchMetrics();
          fetchCalls();
        }}
        disabled={loadingMetrics || loadingCalls}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#150f26] dark:text-[#f6f3ff] bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 rounded-xl transition cursor-pointer"
        title="Refresh data"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${loadingMetrics ? "animate-spin text-[#7c3aed]" : ""}`} />
        Refresh
      </button>

      {/* Single Batch Analyze Pending Button */}
      <button
        type="button"
        onClick={handleAnalyzePending}
        disabled={analyzingPending || pendingCount === 0}
        className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-xl text-white shadow-sm transition-all cursor-pointer ${
          pendingCount > 0
            ? "bg-[#7c3aed] hover:bg-[#6d28d9] shadow-purple-600/20"
            : "bg-gray-300 dark:bg-white/10 opacity-70 cursor-not-allowed text-gray-500 dark:text-gray-400"
        }`}
      >
        {analyzingPending ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Analyzing...</span>
          </>
        ) : pendingCount > 0 ? (
          <>
            <Sparkles className="h-3.5 w-3.5" />
            <span>Analyze Pending Calls ({pendingCount})</span>
          </>
        ) : (
          <>
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>All Calls Analyzed</span>
          </>
        )}
      </button>
    </div>
  );

  return (
    <div className="space-y-3.5 pb-6">
      {/* Portaled Header Buttons into main page header (or fallback if portal unmounted) */}
      {portalContainer ? createPortal(headerActionsNode, portalContainer) : (
        <div className="flex justify-end">{headerActionsNode}</div>
      )}

      {/* =========================================================================
          FINALIZED EXECUTIVE INTELLIGENCE SUMMARY CARD (Top AI Overview)
          ========================================================================= */}
      <div className="bg-gradient-to-r from-purple-900/10 via-indigo-900/5 to-transparent dark:from-purple-950/40 dark:via-purple-900/10 dark:to-transparent border border-purple-200/80 dark:border-purple-800/40 rounded-2xl p-4 shadow-sm relative overflow-hidden">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-2 pb-2 border-b border-purple-100 dark:border-purple-900/40">
          <div>
            <h2 className="text-xs font-extrabold uppercase tracking-wider text-[#150f26] dark:text-[#f6f3ff]">
              Executive Call Intelligence & Summary
            </h2>
            <span className="text-[10px] text-[#625b7e] dark:text-[#a29bc2]">
              Active Filter Scope:{" "}
              <strong className="text-[#7c3aed] dark:text-purple-300 font-semibold">
                {metrics?.date_range_label || "All Time"}
              </strong>
            </span>
          </div>
        </div>

        {/* Point-wise Executive Summary */}
        {loadingMetrics ? (
          <div className="py-2.5 flex items-center gap-2 text-xs text-gray-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#7c3aed]" />
            <span>Synthesizing point-wise executive intelligence across call records...</span>
          </div>
        ) : (
          <ul className="space-y-1.5 text-xs text-[#150f26] dark:text-[#e4dff2] mb-3">
            {summaryPoints.map((point, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#7c3aed] mt-1.5 shrink-0" />
                <span className="leading-relaxed font-medium">{point}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Highlights Pills */}
        {metrics?.summary_highlights && metrics.summary_highlights.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pt-1">
            {metrics.summary_highlights.map((highlight, idx) => (
              <div
                key={idx}
                className="px-2.5 py-1.5 rounded-xl bg-white/80 dark:bg-white/5 border border-purple-100 dark:border-purple-900/30 text-[11px] font-medium text-[#150f26] dark:text-[#f6f3ff] flex items-center gap-1.5 shadow-2xs"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#7c3aed] shrink-0" />
                <span className="truncate">{highlight}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* =========================================================================
          COMPACT TOP KPI TILES (Single Row)
          ========================================================================= */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Total Calls */}
        <div className="bg-white dark:bg-[#1a1429] border border-[#e2dcf2] dark:border-white/10 rounded-xl p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#625b7e] dark:text-[#a29bc2]">
              Total Calls
            </span>
            <Phone className="h-3.5 w-3.5 text-[#7c3aed]" />
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-2xl font-extrabold text-[#150f26] dark:text-[#f6f3ff]">
              {loadingMetrics ? "—" : metrics?.total_calls ?? 0}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
            {metrics?.completed_analyses ?? 0} analyzed • {metrics?.pending_analyses ?? 0} pending
          </div>
        </div>

        {/* Resolution Rate */}
        <div className="bg-white dark:bg-[#1a1429] border border-[#e2dcf2] dark:border-white/10 rounded-xl p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#625b7e] dark:text-[#a29bc2]">
              Resolution Rate
            </span>
            <UserCheck className="h-3.5 w-3.5 text-emerald-500" />
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">
              {loadingMetrics ? "—" : hasAnalyses ? `${metrics?.resolution_rate}%` : "—"}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
            Resolved autonomously
          </div>
        </div>

        {/* Quality Rating */}
        <div className="bg-white dark:bg-[#1a1429] border border-[#e2dcf2] dark:border-white/10 rounded-xl p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#625b7e] dark:text-[#a29bc2]">
              Quality Rating
            </span>
            <Award className="h-3.5 w-3.5 text-amber-500" />
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-2xl font-extrabold text-[#150f26] dark:text-[#f6f3ff]">
              {loadingMetrics ? "—" : hasAnalyses ? `${metrics?.avg_agent_score}` : "—"}
            </span>
            {hasAnalyses && <span className="text-xs text-[#625b7e] dark:text-[#a29bc2]">/ 10</span>}
          </div>
          <div className="mt-1 text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
            Average evaluation score
          </div>
        </div>

        {/* Avg Duration */}
        <div className="bg-white dark:bg-[#1a1429] border border-[#e2dcf2] dark:border-white/10 rounded-xl p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#625b7e] dark:text-[#a29bc2]">
              Avg Duration
            </span>
            <Clock className="h-3.5 w-3.5 text-blue-500" />
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-2xl font-extrabold text-[#150f26] dark:text-[#f6f3ff]">
              {loadingMetrics ? "—" : `${metrics?.avg_duration_seconds ?? 0}s`}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
            Call turnaround time
          </div>
        </div>
      </div>

      {/* =========================================================================
          COMPACT 3-CARD BALANCED GRID
          ========================================================================= */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Card 1: Accurate Doctor Inquiries & Capacity */}
        <div className="bg-white dark:bg-[#1a1429] border border-[#e2dcf2] dark:border-white/10 rounded-xl p-3.5 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Stethoscope className="h-3.5 w-3.5 text-[#7c3aed]" />
                <h3 className="font-bold text-xs uppercase tracking-wider text-[#150f26] dark:text-[#f6f3ff]">
                  Doctor Inquiries & Capacity
                </h3>
              </div>
              <span className="text-[10px] text-[#625b7e] dark:text-[#a29bc2]">
                Hospital Roster
              </span>
            </div>

            {metrics?.top_doctors && metrics.top_doctors.length > 0 ? (
              <div className="space-y-2">
                {metrics.top_doctors.slice(0, 4).map((doc, idx) => (
                  <div key={idx} className="p-2 rounded-lg bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/5">
                    <div className="flex items-center justify-between text-xs">
                      <div className="min-w-0 pr-1">
                        <span className="font-semibold text-[#150f26] dark:text-[#f6f3ff] block truncate">
                          {doc.name}
                        </span>
                        <span className="text-[10px] text-[#625b7e] dark:text-[#a29bc2] block truncate">
                          {doc.specialty || "Specialist"} • {doc.weekly_capacity} shifts/wk
                        </span>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-[11px] font-bold text-[#7c3aed] dark:text-purple-300 block">
                          {doc.requests} {doc.requests === 1 ? "call" : "calls"}
                        </span>
                        <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                          {doc.fulfillment_rate}% fulfilled
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-[#625b7e] dark:text-[#a29bc2]">
                No doctor inquiries recorded yet.
              </div>
            )}
          </div>
        </div>

        {/* Card 2: Pie / Donut Charts (Languages & Sentiment) */}
        <div className="bg-white dark:bg-[#1a1429] border border-[#e2dcf2] dark:border-white/10 rounded-xl p-3.5 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="font-bold text-xs uppercase tracking-wider text-[#150f26] dark:text-[#f6f3ff] mb-2">
              Call Breakdown (Pie Charts)
            </h3>

            <div className="space-y-2.5">
              {/* Language Donut */}
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#625b7e] dark:text-[#a29bc2] block mb-1">
                  Languages
                </span>
                <DonutPieChart
                  data={metrics?.language_distribution || []}
                  colors={["#7c3aed", "#f59e0b", "#0d9488", "#3b82f6"]}
                  centerLabel="Lang"
                />
              </div>

              {/* Sentiment Donut */}
              <div className="pt-2 border-t border-gray-100 dark:border-white/5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#625b7e] dark:text-[#a29bc2] block mb-1">
                  Caller Sentiment
                </span>
                <DonutPieChart
                  data={metrics?.sentiment_distribution || []}
                  colors={["#10b981", "#3b82f6", "#ef4444", "#f59e0b"]}
                  centerLabel="Mood"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Card 3: Quality Scorecard */}
        <div className="bg-white dark:bg-[#1a1429] border border-[#e2dcf2] dark:border-white/10 rounded-xl p-3.5 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Award className="h-3.5 w-3.5 text-[#7c3aed]" />
              <h3 className="font-bold text-xs uppercase tracking-wider text-[#150f26] dark:text-[#f6f3ff]">
                Quality Scorecard
              </h3>
            </div>

            {hasAnalyses ? (
              <div className="space-y-1.5">
                {scoreCategories.map((cat) => {
                  const score = metrics?.agent_quality_scores?.[cat.key] ?? 0;
                  const pct = Math.min(score * 10, 100);
                  const color =
                    score >= 9.0 ? "bg-emerald-500" : score >= 7.5 ? "bg-[#7c3aed]" : "bg-amber-500";

                  return (
                    <div key={cat.key} className="space-y-0.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-[#150f26] dark:text-[#f6f3ff] truncate">{cat.label}</span>
                        <span className="font-bold text-[#150f26] dark:text-[#f6f3ff] shrink-0 ml-1">
                          {score > 0 ? `${score.toFixed(1)}/10` : "—"}
                        </span>
                      </div>
                      <div className="w-full bg-gray-100 dark:bg-white/10 rounded-full h-1.5 overflow-hidden">
                        <div className={`${color} h-1.5 rounded-full`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-[#625b7e] dark:text-[#a29bc2]">
                Quality ratings will appear once calls are analyzed.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* =========================================================================
          CALLS HISTORY TABLE WITH DEBOUNCED BACKEND SEARCH & FULL PAGINATION
          ========================================================================= */}
      <div className="bg-white dark:bg-[#1a1429] border border-[#e2dcf2] dark:border-white/10 rounded-xl p-3.5 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 mb-2.5">
          <div>
            <h3 className="font-bold text-xs uppercase tracking-wider text-[#150f26] dark:text-[#f6f3ff]">
              Call History ({totalCalls})
            </h3>
            <p className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
              Click any call to inspect dialogue transcript and evaluation details.
            </p>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            {/* Debounced Backend Search Input */}
            <div className="relative flex-1 sm:flex-initial">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-gray-400" />
              <input
                type="text"
                placeholder="Search phone, ID, transcript..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-7 pr-2.5 py-1 text-xs rounded-lg border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-[#150f26] dark:text-[#f6f3ff] focus:outline-none focus:ring-1 focus:ring-[#7c3aed] w-full sm:w-56"
              />
            </div>

            {/* Analysis Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="px-2 py-1 text-xs rounded-lg border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-[#150f26] dark:text-[#f6f3ff] focus:outline-none focus:ring-1 focus:ring-[#7c3aed] cursor-pointer"
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="completed">Completed</option>
            </select>

            {/* Page Size Selector */}
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="px-2 py-1 text-xs rounded-lg border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-[#150f26] dark:text-[#f6f3ff] focus:outline-none focus:ring-1 focus:ring-[#7c3aed] cursor-pointer"
            >
              <option value={10}>10 / page</option>
              <option value={25}>25 / page</option>
              <option value={50}>50 / page</option>
            </select>
          </div>
        </div>

        {/* Compact Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-gray-100 dark:border-white/10 text-[#625b7e] dark:text-[#a29bc2] font-semibold">
                <th className="py-2 px-2.5">Patient Name</th>
                <th className="py-2 px-2.5">Phone Number</th>
                <th className="py-2 px-2.5">Session ID</th>
                <th className="py-2 px-2.5">Duration</th>
                <th className="py-2 px-2.5">Language</th>
                <th className="py-2 px-2.5">Score</th>
                <th className="py-2 px-2.5">Status</th>
                <th className="py-2 px-2.5 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/5">
              {loadingCalls ? (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-[#625b7e] dark:text-[#a29bc2]">
                    <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1 text-[#7c3aed]" />
                    Searching call records...
                  </td>
                </tr>
              ) : calls.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-[#625b7e] dark:text-[#a29bc2]">
                    No calls match current filters.
                  </td>
                </tr>
              ) : (
                calls.map((call) => (
                  <tr
                    key={call.id}
                    onClick={() => handleOpenDetail(call.id)}
                    className="hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer transition"
                  >
                    <td className="py-2 px-2.5 font-semibold text-[#150f26] dark:text-[#f6f3ff]">
                      <div className="flex items-center gap-1.5">
                        <div className="w-5 h-5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-[#7c3aed] dark:text-purple-300 flex items-center justify-center text-[10px] font-bold shrink-0">
                          {(call.patient_name || "P").charAt(0).toUpperCase()}
                        </div>
                        <span className="truncate max-w-[130px]">{call.patient_name || "Patient"}</span>
                      </div>
                    </td>
                    <td className="py-2 px-2.5 font-mono text-[11px] text-[#150f26] dark:text-[#f6f3ff]">
                      {call.caller_phone || "—"}
                    </td>
                    <td className="py-2 px-2.5 font-mono text-[11px] text-[#625b7e] dark:text-[#a29bc2] truncate max-w-[120px]">
                      {call.session_id}
                    </td>
                    <td className="py-2 px-2.5 text-[#150f26] dark:text-[#f6f3ff]">
                      {call.duration_seconds}s
                    </td>
                    <td className="py-2 px-2.5">
                      {call.language ? (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-50 dark:bg-purple-950 text-[#7c3aed] dark:text-purple-300">
                          {call.language}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-2 px-2.5 font-bold text-[#150f26] dark:text-[#f6f3ff]">
                      {call.agent_score ? (
                        <span className="text-emerald-600 dark:text-emerald-400">
                          {call.agent_score.toFixed(1)}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-2 px-2.5">
                      {call.analysis_status === "completed" ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" />
                          Completed
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                          <Clock className="h-3 w-3" />
                          Pending
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-2.5 text-right">
                      <span className="text-[11px] text-[#7c3aed] dark:text-purple-300 font-semibold inline-flex items-center gap-0.5">
                        Inspect
                        <ChevronRight className="h-3 w-3" />
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Full Pagination Bar */}
        <div className="flex items-center justify-between border-t border-gray-100 dark:border-white/10 px-2 py-2 mt-1">
          <span className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
            Showing {totalCalls > 0 ? (page - 1) * pageSize + 1 : 0} –{" "}
            {Math.min(page * pageSize, totalCalls)} of {totalCalls} calls
          </span>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-2 py-1 rounded border border-gray-200 dark:border-white/10 hover:bg-gray-100 dark:hover:bg-white/10 disabled:opacity-40 cursor-pointer text-xs flex items-center gap-1"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </button>
            <span className="text-[11px] font-semibold px-2">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-2 py-1 rounded border border-gray-200 dark:border-white/10 hover:bg-gray-100 dark:hover:bg-white/10 disabled:opacity-40 cursor-pointer text-xs flex items-center gap-1"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* =========================================================================
          CALL DETAIL MODAL
          ========================================================================= */}
      {selectedCallId && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#1a1429] border border-[#e2dcf2] dark:border-white/10 rounded-2xl w-full max-w-xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl animate-in fade-in zoom-in-95">
            {/* Modal Header */}
            <div className="p-4 border-b border-gray-100 dark:border-white/10 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-[#150f26] dark:text-[#f6f3ff]">
                  Call Inspection & Transcript
                </h3>
                <p className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
                  {callDetail?.session.session_id} • {callDetail?.session.duration_seconds}s
                </p>
              </div>

              <button
                type="button"
                onClick={() => setSelectedCallId(null)}
                className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400 hover:text-gray-600 dark:hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 overflow-y-auto space-y-3 flex-1">
              {loadingDetail ? (
                <div className="py-8 text-center text-xs text-[#625b7e] dark:text-[#a29bc2]">
                  <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1 text-[#7c3aed]" />
                  Loading details...
                </div>
              ) : callDetail ? (
                <>
                  {/* Executive Summary */}
                  {callDetail.analysis && (
                    <div className="p-3 rounded-xl bg-purple-50/70 dark:bg-purple-950/30 border border-purple-200/60 dark:border-purple-900/40 space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] font-semibold text-[#7c3aed] dark:text-purple-300">
                        <span>SUMMARY</span>
                        <span>Language: {callDetail.analysis.language}</span>
                      </div>
                      <p className="text-xs text-[#150f26] dark:text-[#f6f3ff] leading-relaxed">
                        {callDetail.analysis.summary}
                      </p>
                      <div className="flex items-center gap-2 text-[11px] text-[#625b7e] dark:text-[#a29bc2] pt-0.5">
                        <span>Score: {callDetail.analysis.agent_score}/10</span>
                        <span>•</span>
                        <span className="capitalize">{callDetail.analysis.resolution_status}</span>
                        <span>•</span>
                        <span className="capitalize">{callDetail.analysis.sentiment}</span>
                      </div>
                    </div>
                  )}

                  {/* Demands */}
                  {callDetail.requests && callDetail.requests.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-[#625b7e] dark:text-[#a29bc2] uppercase tracking-wider">
                        Patient Inquiries
                      </span>
                      {callDetail.requests.map((req, idx) => (
                        <div
                          key={idx}
                          className="p-2 rounded-lg bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/5 text-xs flex items-center justify-between"
                        >
                          <div>
                            <span className="font-semibold text-[#150f26] dark:text-[#f6f3ff]">
                              {req.requested_doctor_name || "Doctor Consultation"}
                            </span>
                            <span className="text-[11px] text-[#625b7e] dark:text-[#a29bc2] ml-2">
                              {req.requested_time_slot || "Not specified"}
                            </span>
                          </div>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              req.fulfilled
                                ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300"
                                : "bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300"
                            }`}
                          >
                            {req.fulfilled ? "Fulfilled" : "Unfulfilled"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Detected Issues */}
                  {callDetail.analysis?.issues && callDetail.analysis.issues.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Feedback / Issue
                      </span>
                      {callDetail.analysis.issues.map((iss, idx) => (
                        <div
                          key={idx}
                          className="p-2 rounded-lg bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/30 text-xs space-y-1"
                        >
                          <p className="font-medium text-[#150f26] dark:text-[#f6f3ff]">
                            {iss.description}
                          </p>
                          {iss.evidence && (
                            <div className="font-mono text-[10px] text-[#625b7e] dark:text-[#a29bc2] italic">
                              &quot;{iss.evidence}&quot;
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Conversation Transcript */}
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-[#625b7e] dark:text-[#a29bc2] uppercase tracking-wider flex items-center gap-1">
                      <FileText className="h-3.5 w-3.5" />
                      Dialogue Transcript
                    </span>
                    <div className="p-3 rounded-lg bg-gray-50 dark:bg-black/30 border border-gray-100 dark:border-white/10 font-mono text-xs whitespace-pre-wrap leading-relaxed text-[#150f26] dark:text-[#f6f3ff] max-h-44 overflow-y-auto">
                      {callDetail.session.transcript || "No dialogue recorded."}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
