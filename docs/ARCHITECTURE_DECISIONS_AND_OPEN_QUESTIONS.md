# Architectural Decisions, Trade-Offs, and Open Questions

> **Document Type:** Architectural Decision Matrix & Technical Roadmap  
> **Source Base:** `voice-ai-agent/` (FastAPI, React 18, PostgreSQL, Redis/Arq), `Voice-AI-Agent.pdf` (Version 0.3), and ADRs 0001–0004  
> **Purpose:** Document all critical architectural choices, trade-offs, current codebase status, and criteria needed to resolve pending technical decisions.  

---

## Executive Summary

The **AI Voice Agent Platform** is moving rapidly from an initial technical foundation toward a production-ready, low-latency conversational healthcare booking engine.

Because early architectural commitments can introduce substantial technical debt or unnecessary vendor lock-in, several key technical choices have been intentionally isolated behind modular adapter interfaces (`app/adapters/`).

This document provides a systematic review of the **11 core architectural decision areas**, outlining:
1. The available options.
2. The technical and commercial trade-offs.
3. The current repository state and code references.
4. The exact evidence and criteria required to reach a final decision.

---

## Summary Matrix of Architecture Decisions

| # | Decision Area | Current Repo State | Leading Options | Recommendation |
|---|---|---|---|---|
| **1** | **Database Deployment** | Docker Compose PostgreSQL 16 (`app/database/`) | Local Container vs. AWS RDS vs. Supabase / Neon | **Managed PostgreSQL (AWS RDS or Supabase)** for production; Docker for dev. |
| **2** | **Scheduling Constraints** | No scheduling tables yet (`0001` migration only) | App-Level Locks vs. Composite Unique Index + `SELECT FOR UPDATE` | **Composite Unique Index + `SELECT ... FOR UPDATE`** (Strict Zero Double-Booking). |
| **3** | **STT Provider** | Google Gemini STT verified (`adapters/stt/google.py`)| Deepgram Nova-2 vs. Sarvam AI vs. Google Gemini | **Hybrid:** Sarvam AI for Hindi/Hinglish calls; Deepgram for pure English streaming. |
| **4** | **TTS Provider** | Piper ONNX local (`adapters/tts/piper.py`) & gTTS | Local Piper CPU vs. Sarvam Bulbul vs. ElevenLabs | **Hybrid:** Local Piper for testing/dev; Sarvam Bulbul for natural Indian accents. |
| **5** | **LLM Gateway** | Google Gemini 1.5 Flash (`adapters/llm/gemini.py`)| Gemini 1.5 Flash vs. GPT-4o-mini vs. Claude 3.5 Sonnet | **Gemini 1.5 Flash** for low latency (<300ms); Claude 3.5 Sonnet for safety validation. |
| **6** | **Telephony Provider** | `MockTelephonyAdapter` (`adapters/telephony/base.py`)| Exotel vs. Plivo vs. Twilio | **Exotel** for India regulatory compliance (TRAI/DoT); Plivo as secondary backup. |
| **7** | **Voice Framework** | `VoiceEngineSession` base ABC | LiveKit Agents vs. Pipecat vs. Custom WebSockets | **LiveKit Agents** for WebRTC/SIP telephony maturity and Python agent framework. |
| **8** | **Object Storage** | Not implemented (in-memory base64) | AWS S3 vs. Cloudflare R2 vs. Self-hosted MinIO | **AWS S3 / MinIO** with 15-minute Pre-Signed URLs and server-side encryption. |
| **9** | **Tenant Isolation** | Column `tenant_id` + JWT + header check | Shared DB/Shared Schema vs. Schema-per-Tenant vs. DB-per-Tenant | **Shared DB with Discriminator Column (`tenant_id`)** (ADR 0002). |
| **10**| **Data Retention** | Ephemeral memory store (TTL 7200s) | Fixed 30 Days vs. Configurable 30–365 Days + Auto-Purge | **Clinic-Configurable (Default 90 Days)** with automated background purge. |
| **11**| **Healthcare Compliance**| System prompt guidelines | Basic Disclaimers vs. Hardcoded State Machine Guardrails | **Enforced Conversational State Machine** (No booking without consent & ID). |

---

## Detailed Decision Breakdown

---

### Decision 1: Database Deployment Strategy

#### Context:
The platform requires an ACID-compliant relational database to store tenant settings, user credentials, doctor availability rules, call logs, and appointment reservations.

#### Available Options:
1. **Option A: Containerized PostgreSQL in Docker Compose (Current)**
   - *Description*: Running official `postgres:16-alpine` inside `docker-compose.yml` with a mounted local Docker volume (`postgres_data`).
2. **Option B: Managed Cloud PostgreSQL (AWS RDS / GCP Cloud SQL)**
   - *Description*: Fully managed database service with automated backups, multi-AZ replication, failover, and point-in-time recovery.
3. **Option C: Serverless PostgreSQL (Neon / Supabase)**
   - *Description*: Cloud Postgres with connection pooling (PgBouncer) and branching.

#### Trade-Off Analysis:
| Dimension | Option A (Docker Container) | Option B (Managed RDS / Cloud SQL) | Option C (Serverless Neon/Supabase) |
|---|---|---|---|
| **Monthly Cost** | Zero direct cloud cost (runs on host). | \$30–\$150/month. | \$0–\$25/month tier. |
| **Operational Overhead** | HIGH. Manual backups, zero automated failover, volume corruption risk. | LOW. Automated maintenance, security patches, point-in-time recovery. | LOW. Automated connection pooling and branching. |
| **Connection Pooling** | Handled inside FastAPI application via asyncpg pool (10 connections). | Managed via external PgBouncer or RDS Proxy. | Built-in PgBouncer pooling. |
| **Suitability** | **Ideal for local developer laptops.** | **MANDATORY for production healthcare data.** | Strong candidate for staging and early alpha. |

#### Current Repository State:
- `docker-compose.yml` (lines 5–24) defines a healthy PostgreSQL 16 container.
- `voice-ai-agent/backend/app/database/session.py` creates an `AsyncEngine` connected to `settings.DATABASE_URL`.
- Local Windows host port 5432 is currently offline, designed to run through Docker Compose.

#### Information Needed to Decide:
- Cloud deployment budget and target hosting cloud (AWS vs. GCP vs. On-Premise Clinic VM).
- Production compliance requirements for encrypted automated snapshots.

---

### Decision 2: Database and Scheduling Concurrency Constraints

#### Context:
In healthcare appointment booking, two patients must never book the same doctor for the same time slot (zero tolerance for double-booking).

#### Available Options:
1. **Option A: Application-Level Checks (Naive)**
   - *Description*: Query `SELECT * FROM appointments WHERE slot = :slot`. If none returned, execute `INSERT`.
2. **Option B: Database Partial Unique Index**
   - *Description*: An unbreachable index constraint at the storage engine level:
     ```sql
     CREATE UNIQUE INDEX uq_appointments_active_slot 
     ON appointments (tenant_id, resource_id, start_at) 
     WHERE status NOT IN ('cancelled', 'rescheduled');
     ```
3. **Option C: Pessimistic Row-Level Locking (`SELECT ... FOR UPDATE`) + Unique Index**
   - *Description*: When booking starts, the doctor's record is locked in an ACID transaction, preventing any other concurrent call from evaluating or modifying that doctor's schedule until the transaction commits.

#### Trade-Off Analysis:
- *Option A* is fatally flawed; high concurrency causes inevitable race conditions and double-bookings.
- *Option B* guarantees data integrity at the database layer, but an unhandled race condition raises an ugly database error.
- *Option C* combines graceful application flow (locking the doctor's calendar so concurrent requests cleanly queue and see the updated state) with the fail-safe guarantee of Option B.

#### Current Repository State:
- `tenants` and `users` tables exist in `0001_initial_tenants_and_users.py`.
- No scheduling models or constraints currently exist in `app/models/`.

#### Information Needed to Decide:
- **Decision is already resolved technically:** Implement **Option C** in `0002_scheduling_core.py` as detailed in Section 7.4 of the Architecture Document.

---

### Decision 3: Speech-to-Text (STT) Provider Selection

#### Context:
Outbound calling in India requires transcribing English, Hindi, and mixed colloquial Hinglish (e.g., *"Mera appointment Dr. Sharma ke saath Friday ko 10 baje confirm kar do"*). Transcription latency directly impacts conversation fluency.

#### Available Options:
1. **Google Gemini Generative STT (Current Implementation)**
   - *Description*: REST-based transcription using Gemini 1.5 Flash inline audio.
   - *Pros*: Excellent Hinglish code-switching; already implemented and tested in `app/adapters/stt/google.py`.
   - *Cons*: High latency (~1.0s to 1.5s per turn); not a true real-time streaming WebSocket engine.
2. **Deepgram Nova-2**
   - *Description*: Real-time WebSocket streaming transcription engine.
   - *Pros*: Industry-lowest streaming latency (~200–300ms); excellent English medical transcription.
   - *Cons*: Mixed performance on accented regional Indian dialects and colloquial Hinglish.
3. **Sarvam AI (Saaras)**
   - *Description*: Indian indigenous speech engine built specifically for 10 Indian languages.
   - *Pros*: Market leader in Indian Hindi, Hinglish, and regional speech accuracy.
   - *Cons*: Slightly higher latency than Deepgram; dependent on Sarvam cloud availability.

#### Current Repository State:
- `voice-ai-agent/backend/app/adapters/stt/google.py` contains the fully working `GoogleSTTAdapter`.
- `app/adapters/stt/base.py` provides the abstract `STTProvider` interface allowing seamless swapping.

#### Criteria Needed to Decide:
- Conduct the **Week 1 Provider Bake-Off**: Benchmark 20 recorded test audio clips containing Hindi, English, and Hinglish dates, numbers, and doctor names across Google, Deepgram, and Sarvam. Measure Word Error Rate (WER) and Time-to-First-Audio (TTFA).

---

### Decision 4: Text-to-Speech (TTS) Provider Selection

#### Context:
The voice must sound natural, professional, and pleasant over a telephone line without robotic artifacts. Speech synthesis latency must remain below 300ms to keep turn-taking responsive.

#### Available Options:
1. **Piper Local Neural TTS (Current Implementation)**
   - *Description*: Local ONNX-based VITS neural models running on host CPU (`app/adapters/tts/piper.py`).
   - *Pros*: Ultra-fast (50–150ms); zero per-character cloud API costs; high privacy (audio generated on-premise).
   - *Cons*: Requires Piper ONNX runtime and models (`data/piper_voices/`); voice naturalness is acceptable but not as expressive as premium cloud models.
2. **Sarvam AI (Bulbul)**
   - *Description*: Cloud neural TTS designed specifically for Indian languages and English with authentic Indian accents.
   - *Pros*: Unmatched naturalness for Indian phone calls; authentic pronunciation of Indian names and clinics.
   - *Cons*: Cloud network latency (~300–400ms); per-character billing.
3. **ElevenLabs Conversational TTS**
   - *Description*: State-of-the-art hyper-realistic cloud voice cloning.
   - *Pros*: Remarkable human-like warmth, breathing, and prosody.
   - *Cons*: High latency (~400–600ms); highest cost among all providers.

#### Current Repository State:
- `PiperTTSAdapter` (`app/adapters/tts/piper.py`) is implemented with Hindi (`hi_IN-pratham-medium`) and English (`en_US-lessac-medium`) voice configurations.
- `GTTSAdapter` (`app/adapters/tts/gtts.py`) is implemented as an automated fallback.

#### Criteria Needed to Decide:
- **Adopt a Hybrid Strategy**: Keep Piper TTS for local development, unit tests, and CI/CD pipelines. Evaluate Sarvam Bulbul for live telephony pilot calls to Indian patients.

---

### Decision 5: Language Model (LLM) Reasoning Engine

#### Context:
The LLM serves as the conversational brain: extracting patient intents, deciding when to query database tools, and formatting spoken responses.

#### Available Options:
1. **Google Gemini 1.5 Flash (Current Implementation)**
   - *Pros*: Extremely low Time-to-First-Token (TTFT < 300ms); native multimodal audio capabilities; highly cost-effective; large context window.
   - *Cons*: Function calling adherence can occasionally wander if prompts are ambiguous.
2. **OpenAI GPT-4o-mini**
   - *Pros*: Fast TTFT (~350ms); exceptionally reliable function calling and JSON schema adherence.
   - *Cons*: Cloud pricing per token; slightly more robotic conversational tone than larger models.
3. **Anthropic Claude 3.5 Sonnet**
   - *Pros*: Industry gold standard for strict instruction following, safety guardrail compliance, and zero medical hallucination.
   - *Cons*: Higher latency (~600–900ms) and higher cost.

#### Current Repository State:
- `GeminiLLMAdapter` (`app/adapters/llm/gemini.py`) is implemented and verified.
- `MockLLMAdapter` (`app/adapters/llm/base.py`) is used for instant unit testing.

#### Criteria Needed to Decide:
- Benchmark simulated patient conversation turns testing function calling speed and edge-case safety compliance (e.g., patient asking for heart medication advice or reporting emergency symptoms).

---

### Decision 6: Telephony Carrier Gateway

#### Context:
The platform must connect to Indian cellular and landline telephone networks to dial outbound calls and receive inbound calls.

#### Available Options:
1. **Exotel (India)**
   - *Description*: The leading Indian cloud telephony provider.
   - *Pros*: 100% compliant with Indian Department of Telecommunications (DoT) and TRAI regulations; native local CLI numbers; direct SIP trunking support.
   - *Cons*: Enterprise sales signup process; strict KYC requirements.
2. **Plivo (Global / India)**
   - *Description*: Developer-friendly global telephony platform with strong Indian presence.
   - *Pros*: Fast self-serve developer portal; easy SIP integration; clear REST API and WebSocket audio streaming docs.
   - *Cons*: Number availability and outbound route quality in India vary by region.
3. **Twilio**
   - *Description*: Global leader in cloud communications.
   - *Pros*: Superb documentation, global reliability, and rich WebRTC SDKs.
   - *Cons*: Extremely difficult and expensive regulatory compliance for local Indian two-way voice calling.

#### Current Repository State:
- `app/adapters/telephony/base.py` provides `TelephonyProvider` interface and `MockTelephonyAdapter`.

#### Action Required:
- Submit KYC documentation for both **Exotel** and **Plivo** on Day 1 of development. Approval turnaround times (3 to 7 business days) will dictate which carrier is wired first.

---

### Decision 7: Real-Time Voice Framework Runtime

#### Context:
Handling full-duplex telephony requires streaming audio over WebSockets or WebRTC, detecting caller interruptions (barge-in), managing Voice Activity Detection (VAD), and pipelining LLM tokens into audio streams.

#### Available Options:
1. **LiveKit Agents Framework**
   - *Description*: Open-source real-time communication platform built on WebRTC with native Python Agents framework.
   - *Pros*: Pre-built SIP telephony bridge (LiveKit SIP); built-in VAD (Silero); turn-detection and barge-in handling out of the box; massive industry adoption.
   - *Cons*: Requires running a LiveKit server instance (or using LiveKit Cloud).
2. **Pipecat (Daily.co)**
   - *Description*: Open-source Python framework specifically designed for voice AI pipelines.
   - *Pros*: Lightweight, highly modular frame-based architecture; easy to understand.
   - *Cons*: Telephony SIP bridging requires third-party PBX configuration.
3. **Custom Async WebSocket Pipeline**
   - *Description*: Building a proprietary WebSocket handler inside FastAPI with Silero VAD and asyncio queues.
   - *Pros*: Zero external server dependencies.
   - *Cons*: Enormous engineering effort to handle packet jitter, echo cancellation, and barge-in interruptions reliably.

#### Current Repository State:
- `app/adapters/voice_engine/base.py` defines the `VoiceEngineSession` abstraction.

#### Criteria Needed to Decide:
- Conduct a 2-day evaluation building a laptop audio test loop using **LiveKit Agents**. If barge-in and audio streaming latency are under 1.0s, select LiveKit.

---

### Decision 8: Audio File and Recording Storage

#### Context:
Every completed phone call produces a dual-channel audio recording (WAV or MP3) that must be retained for clinic quality assurance and legal audits.

#### Available Options:
1. **AWS S3 (Simple Storage Service)**
   - *Pros*: Industry standard; 99.999999999% durability; native lifecycle rules (auto-delete after 90 days); pre-signed URL support.
   - *Cons*: AWS egress costs.
2. **Cloudflare R2**
   - *Pros*: S3-compatible API; **zero egress bandwidth fees**.
   - *Cons*: Slightly newer ecosystem.
3. **Self-Hosted MinIO**
   - *Pros*: 100% open-source S3-compatible storage running in Docker Compose for local development.
   - *Cons*: Must be maintained and backed up manually in production.

#### Current Repository State:
- Audio recordings are currently handled in-memory or returned as base64 in the Voice Playground.

#### Recommendation:
- Use **MinIO in local Docker Compose** for developer testing, and **AWS S3 / Cloudflare R2** in cloud production with automated 90-day lifecycle expiration.

---

### Decision 9: Multi-Tenant Data Isolation Strategy

#### Context:
Formalized in **ADR 0002**, deciding how to isolate data between competing clinics sharing the platform.

#### Available Options:
1. **Option A: Separate Database per Tenant** (Highest isolation, highest cost and operational complexity).
2. **Option B: Separate PostgreSQL Schema per Tenant** (Complex migration maintenance across hundreds of schemas).
3. **Option C: Shared Database, Shared Schema with Discriminator Column (`tenant_id`)** (Accepted in ADR 0002).

#### Evaluation:
- **Option C is officially accepted and implemented in code.**
- Foreign keys on `tenants.id` with B-tree indexes provide predictable query performance without infrastructure sprawl.

---

### Decision 10: Call Recording and Transcript Data Retention

#### Context:
Under Indian healthcare privacy guidelines and the Digital Personal Data Protection (DPDP) Act, patient health records and conversation recordings should not be stored indefinitely without clear retention policies.

#### Available Options:
1. **Option A: Indefinite Storage** (Risk of regulatory non-compliance; unbounded storage costs).
2. **Option B: Global Fixed 30-Day Auto-Purge** (Safe, but some clinics require 180 days for legal medical audits).
3. **Option C: Clinic-Configurable Retention with Automated Purge (Recommended)**
   - Store `retention_days` in `tenants.settings` (default: 90 days).
   - Nightly Arq background worker executes:
     ```sql
     DELETE FROM transcript_turns WHERE created_at < NOW() - INTERVAL '90 days';
     ```
     and issues S3 batch delete commands for corresponding recording keys.

---

### Decision 11: Healthcare Safety and Regulatory Compliance

#### Context:
An AI voice agent calling a patient must adhere to medical safety boundaries. The agent must never practice medicine or provide unsupervised clinical diagnoses.

#### Policy Commitments:
1. **Mandatory Identity Verification**: Before stating any appointment reason or medical details, the agent must ask: *"Am I speaking with Mr. [Patient Name]?"* If the recipient says no, the agent immediately terminates the call without disclosing clinic details.
2. **Explicit Recording Consent**: The call greeting must state: *"I am an automated assistant calling from [Clinic] on a recorded line."*
3. **Strict Negative Medical Constraints**: If a patient asks: *"What medicine should I take for chest pain?"*, the agent is strictly prohibited from guessing. It must reply: *"I cannot provide medical advice. Please consult Dr. Sharma directly or visit the emergency room immediately."*
4. **Emergency Redirection**: Detection of keywords (*"heart attack"*, *"can't breathe"*, *"bleeding"*) triggers immediate instruction to call emergency services (`112`).
