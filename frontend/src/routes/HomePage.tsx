import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiClient } from "@/lib/api-client";
import { HealthStatusResponse } from "@/types/api";
import {
  Server,
  Database,
  Cpu,
  PhoneForwarded,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Layers,
} from "lucide-react";

export const HomePage: React.FC = () => {
  const { data: health, isLoading } = useQuery<HealthStatusResponse>({
    queryKey: ["health"],
    queryFn: () => apiClient.get<HealthStatusResponse>("/api/v1/health"),
    refetchInterval: 10000,
  });

  return (
    <div className="container mx-auto max-w-6xl px-4 py-12 sm:px-8">
      {/* Hero Section */}
      <div className="mb-10 text-center">
        <Badge variant="secondary" className="mb-3 px-3 py-1 text-xs">
          Initial Platform Foundation Active
        </Badge>
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          AI Voice Agent Platform
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
          Production-oriented architecture for automated outbound business calls in Hinglish, Hindi,
          and English with real-time conversational intelligence.
        </p>
      </div>

      {/* Live System Diagnostics */}
      <div className="mb-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Core API Service</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold">FastAPI</span>
              {isLoading ? (
                <Badge variant="outline">Checking...</Badge>
              ) : health?.status === "healthy" ? (
                <Badge variant="default" className="bg-emerald-600">
                  <CheckCircle2 className="mr-1 h-3 w-3" /> Online
                </Badge>
              ) : (
                <Badge variant="secondary">Degraded / Offline</Badge>
              )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              v0.1.0 Modular Monolith &bull; OpenAPI enabled
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Relational Storage</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold">PostgreSQL 16</span>
              <Badge variant="outline">SQLAlchemy 2</Badge>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Alembic migrations &bull; Tenant isolation schema
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Background Worker</CardTitle>
            <Cpu className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold">Redis 7 + Arq</span>
              <Badge variant="outline">Job Queue</Badge>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Asynchronous post-call processing & campaigns
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Architecture Readiness & Delivery Plan Roadmap */}
      <Card className="border-primary/20 bg-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            <CardTitle>Architecture Status & Delivery Plan</CardTitle>
          </div>
          <CardDescription>
            Foundations established for two-phase delivery plan without premature feature coupling.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/40 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold">
                <PhoneForwarded className="h-4 w-4 text-primary" />
                Phase 1 Foundation: Voice Engine & Call Lifecycle
              </div>
              <Badge variant="secondary">Architecture Ready</Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Adapter boundaries created for STT (Google/Deepgram), TTS (Piper ONNX/Kyutai), LLM
              (Gemini/Ollama/OpenAI), and Telephony (Exotel/Plivo/Twilio). Real-time sentence chunker,
              thought scrubber, and speech text sanitizers initialized.
            </p>
          </div>

          <div className="rounded-lg border bg-muted/40 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Phase 2 Foundation: Multi-Tenancy & Campaigns
              </div>
              <Badge variant="outline">Schema Ready</Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Multi-tenant database schema (Tenants, Users) with UUID keys, timestamps, indexes, and
              role authorization boundaries established. Ready for lead ingestion, campaign
              schedulers, and analytics dashboard.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

