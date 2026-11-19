# AI Voice Agent Platform

> Enterprise-ready, multi-tenant conversational voice agent platform for automated outbound business campaigns in Hinglish, Hindi, and English.

[![CI Pipeline](https://github.com/organization/voice-ai-agent-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/organization/voice-ai-agent-platform/actions/workflows/ci.yml)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI_0.115-009688.svg?logo=fastapi)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/Frontend-React_18_Vite-61DAFB.svg?logo=react)](https://react.dev)
[![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL_16-336791.svg?logo=postgresql)](https://www.postgresql.org)
[![Redis](https://img.shields.io/badge/Queue-Redis_7_Arq-DC382D.svg?logo=redis)](https://redis.io)

---

## 1. Project Overview

The **AI Voice Agent Platform** empowers businesses to run scalable, intelligent outbound voice calling campaigns. Key capabilities planned across the delivery roadmap include:
- **Lead Management**: Upload customer contacts with dynamic custom metadata.
- **Campaign Orchestration**: Schedule and manage concurrent voice calling campaigns.
- **Conversational AI Agent**: Natural human-like speech in Hindi, English, and Hinglish with barge-in interruption support.
- **Call Dispositions & Recording**: Store audio recordings, dual-channel transcripts, and structured call outcomes.
- **AI Post-Call Processing**: Automated conversation summaries and customer sentiment/interest scoring (Hot, Warm, Cold).
- **Multi-Tenant Administration**: Independent tenant data isolation and access controls.

---

## 2. Technology Stack

- **Backend**: Python 3.11 / 3.12, FastAPI, Uvicorn, Pydantic v2, SQLAlchemy 2.0 (Async), Alembic.
- **Storage & Caching**: PostgreSQL 16 (Relational DB), Redis 7 (In-Memory Cache & Message Broker).
- **Background Workers**: Arq (Async Python worker pool for post-call analytics and scheduling).
- **Frontend**: React 18, Vite, TypeScript (Strict Mode), React Router, TanStack Query, Tailwind CSS, shadcn/ui.
- **DevOps & Infrastructure**: Docker, Docker Compose, GitHub Actions CI.

---

## 3. Repository Structure

```text
voice-ai-agent/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── v1/                # Versioned API routes (health, tenants, users)
│   │   │   └── deps.py            # Reusable dependency injection (DB, Tenant, Auth)
│   │   ├── core/                  # Configuration, logging, security, exception handling
│   │   ├── database/              # SQLAlchemy 2.0 async session and declarative base
│   │   ├── models/                # Foundational database models (Tenant, User)
│   │   ├── schemas/               # Pydantic v2 validation schemas
│   │   ├── modules/               # Domain business modules (tenants, users, leads, campaigns, calls)
│   │   ├── adapters/              # Provider independence boundaries (STT, TTS, LLM, Telephony)
│   │   ├── workers/               # Arq background worker and Redis connections
│   │   ├── middleware/            # Request ID tracing, tenant propagation
│   │   ├── utils/                 # Audio sentence chunking, thought scrubber, text sanitizer
│   │   └── main.py                # FastAPI application entrypoint & lifespan
│   ├── migrations/                # Alembic database migrations (versions, env.py)
│   ├── tests/                     # Automated test suite (pytest, pytest-asyncio, httpx)
│   ├── pyproject.toml             # Python build & dependency metadata
│   ├── requirements.txt           # Pinned production dependencies
│   ├── alembic.ini                # Migration tool configuration
│   └── Dockerfile                 # Backend container definition
│
├── frontend/
│   ├── src/
│   │   ├── app/                   # Root App component and context providers
│   │   ├── components/ui/         # Accessible shadcn/ui components (Button, Card, Badge)
│   │   ├── features/              # Feature-oriented domain modules (tenants, campaigns, calls)
│   │   ├── layouts/               # Application navigation and layout wrappers
│   │   ├── lib/                   # API client, environment variables, utility helpers
│   │   ├── routes/                # React Router setup and page views
│   │   ├── types/                 # Shared TypeScript interfaces
│   │   └── main.tsx               # Frontend client mounting
│   ├── package.json               # Node.js dependencies and scripts
│   ├── tsconfig.json              # TypeScript strict configuration
│   ├── vite.config.ts             # Vite bundler configuration
│   └── Dockerfile                 # Multi-stage production container
│
├── docs/
│   ├── architecture/              # System architecture, multi-tenancy, voice engine reuse
│   └── decisions/                 # Architecture Decision Records (ADRs)
│
├── .github/workflows/ci.yml       # GitHub Actions automated test & build pipeline
├── docker-compose.yml             # Local multi-service orchestration (Postgres, Redis, API, Worker, Web)
├── .env.example                   # Sanitized environment variable template
├── .gitignore                     # Git ignore definitions
├── README.md                      # Primary project reference
└── CONTRIBUTING.md                # Engineering standards & guidelines
```

---

## 4. Prerequisites

Ensure you have the following installed locally:
- **Docker & Docker Compose** (Recommended for full stack execution)
- **Python 3.11 or 3.12**
- **Node.js 20+** or **Bun 1.2+**
- **PostgreSQL 16** (If running without Docker)
- **Redis 7** (If running without Docker)

---

## 5. Quickstart with Docker Compose

The fastest way to spin up the entire platform (PostgreSQL, Redis, FastAPI Backend, Arq Worker, and Web Dashboard):

```bash
# 1. Clone the repository and enter the workspace
cd voice-ai-agent

# 2. Copy the environment configuration
cp .env.example .env

# 3. Build and launch all services in detached mode
docker compose up --build -d

# 4. View container logs
docker compose logs -f
```

### Active Service Endpoints:
- **Web Dashboard**: [http://localhost:3000](http://localhost:3000)
- **Backend API**: [http://localhost:8000](http://localhost:8000)
- **Interactive OpenAPI Docs**: [http://localhost:8000/api/v1/docs](http://localhost:8000/api/v1/docs)
- **ReDoc Documentation**: [http://localhost:8000/api/v1/redoc](http://localhost:8000/api/v1/redoc)
- **Health Check Probe**: [http://localhost:8000/api/v1/health](http://localhost:8000/api/v1/health)

---

## 6. Local Development Setup (Without Docker)

### Backend Setup

```bash
cd backend

# Create and activate virtual environment
python -m venv venv
# On Windows:
.\venv\Scripts\Activate.ps1
# On macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
pip install -e ".[dev]"

# Configure environment variables
cp ../.env.example .env

# Run database migrations
alembic upgrade head

# Start the FastAPI server
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Start the background task worker (in a separate terminal)
arq app.workers.worker.WorkerSettings
```

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install  # or: bun install

# Start development server
npm run dev  # or: bun run dev
```
Visit [http://localhost:5173](http://localhost:5173).

---

## 7. Local AI Voice Playground (STT → LLM → TTS)

The platform includes a laptop-based **AI Voice Playground** allowing developers to test the complete voice pipeline without requiring telephony, SIP trunks, or cloud carriers.

```text
[ Browser Mic ] ──(Audio Blob)──> [ POST /api/v1/voice/turn ]
                                          │
                                          ▼
                                   [ Google Gemini STT ]
                                          │ (User Transcript)
                                          ▼
                                   [ In-Memory Session ]
                                          │ (Multi-turn Context)
                                          ▼
                                   [ Google Gemini LLM ]
                                          │ (Spoken Text Sanitizer)
                                          ▼
                                   [ Piper Neural TTS ]
                                          │ (16-bit PCM WAV)
                                          ▼
[ Browser Speakers ] <──(Playable Audio + Latency Metrics)──
```

### Features
- **Turn-based voice interaction**: Speak naturally in Hindi, English, or Hinglish.
- **Real-time Latency Profiling**: Visual breakdown of STT ms, LLM ms, TTS ms, and Total turn ms.
- **Multi-turn Context Isolation**: Ephemeral session storage that maintains conversation history.
- **Decoupled Error Containment**: If TTS fails, the user transcript and LLM text response are preserved.

### Step 1: Configure Environment Variables
Copy `.env.example` to `.env` in the project root:
```env
STT_PROVIDER=google
TTS_PROVIDER=piper
LLM_PROVIDER=gemini

GOOGLE_API_KEY=your_gemini_api_key_here
```

### Step 2: Set Up Piper TTS on Windows
Piper runs high-performance neural text-to-speech locally on CPU using ONNX Runtime (50–150ms synthesis latency).

1. Install `piper-tts`:
   ```bash
   pip install piper-tts
   ```
2. Download voice models into `data/piper_voices/`:
   ```bash
   # Create voices directory
   mkdir -p data/piper_voices

   # English Voice (Lessac - Natural Female):
   curl -L -o data/piper_voices/en_US-lessac-medium.onnx "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx"
   curl -L -o data/piper_voices/en_US-lessac-medium.onnx.json "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json"

   # Hindi Voice (Pratham - Clear Indian Male):
   curl -L -o data/piper_voices/hi_IN-pratham-medium.onnx "https://huggingface.co/rhasspy/piper-voices/resolve/main/hi/hi_IN/pratham/medium/hi_IN-pratham-medium.onnx"
   curl -L -o data/piper_voices/hi_IN-pratham-medium.onnx.json "https://huggingface.co/rhasspy/piper-voices/resolve/main/hi/hi_IN/pratham/medium/hi_IN-pratham-medium.onnx.json"
   ```
3. **Configurable Fallback**: If Piper is not installed on your system, you can set `TTS_PROVIDER=mock` or `TTS_PROVIDER=gtts` in `.env` without breaking STT and LLM functionality.

### Step 3: Run the Backend & Frontend
1. **Backend**:
   ```bash
   cd backend
   uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
   ```
2. **Frontend**:
   ```bash
   cd frontend
   npm run dev  # or bun run dev
   ```
3. Open `http://localhost:5173/playground` in your browser.
4. Allow microphone access, click **Start Speaking**, ask a query, and click **Done**.

### Step 4: Verification & Testing
- **Unit Test Suite (17 automated tests)**:
  ```bash
  python backend/tests/run_unit_tests.py
  ```
- **Live Integration Test (Tests real Gemini STT/LLM and Piper synthesis)**:
  ```bash
  python backend/scripts/test_voice_turn.py
  ```

---

## 8. Database Migrations

We use **Alembic** for tracking database schema changes.

```bash
cd backend

# Apply all pending migrations to the database
alembic upgrade head

# Create a new migration after updating SQLAlchemy models
alembic revision --autogenerate -m "describe_schema_change"

# Roll back the last applied migration
alembic downgrade -1
```

---

## 8. Running Automated Tests & Linting

### Backend Tests (pytest)
```bash
cd backend
pytest -v tests/
```

### Backend Linting (Ruff)
```bash
cd backend
ruff check .
```

### Frontend Typechecking & Production Build
```bash
cd frontend
npm run build   # or: bun run build
```

---

## 9. Current Implementation Status

| Milestone | Status | Details |
|---|---|---|
| **Repository Foundation** | ✅ Complete | Monorepo structure, clean configs, and GitHub Actions CI. |
| **Backend Core & API** | ✅ Complete | FastAPI 0.115, OpenAPI docs, `/api/v1`, error handlers, and health probes. |
| **Database Architecture** | ✅ Complete | SQLAlchemy 2, Alembic `0001` migration, multi-tenant `Tenants` and `Users` models with UUID keys. |
| **Worker Infrastructure** | ✅ Complete | Redis 7 connectivity, Arq worker lifecycle, and enqueue client pool. |
| **Voice Engine Adapters** | ✅ Complete | Concrete Google Gemini STT, Piper Neural TTS, and Gemini LLM gateway adapters + factories. |
| **Voice Playground**      | ✅ Complete | Browser mic recording, latency breakdown, audio playback, and multi-turn session store. |
| **Audio Processing Utils**| ✅ Complete | Real-time sentence chunking, thought scrubber, and TTS text sanitization harvested from reference code. |
| **Frontend Foundation** | ✅ Complete | React 18, Vite, Tailwind CSS, shadcn/ui, TanStack Query, and live health diagnostics. |
| **Phase 1: Voice & Calls** | ⏳ Planned Next | Outbound calling pipeline, LiveKit/Pipecat evaluation, Exotel/Plivo adapter, and call dispositions. |
| **Phase 2: Campaigns & CRM**| ⏳ Planned Next | Lead CSV upload, campaign scheduler, and analytics dashboard. |

