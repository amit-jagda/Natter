# ADR 0004: Background Task Processing with Arq and Redis

## Status
Accepted

## Context
Post-call processing (transcription analysis, summarization, customer scoring, CRM webhooks) and outbound campaign scheduling require asynchronous execution to prevent blocking HTTP endpoints and webhook consumers.

## Decision
We select **Arq** backed by **Redis 7** for background task processing.

## Consequences
### Positive:
- **Async Native**: Built directly on Python's `asyncio` event loop, pairing naturally with async database queries and async LLM API calls.
- **Low Operational Overhead**: Reuses the Redis instance deployed for caching and session state.
- **Lightweight Footprint**: Drastically lighter CPU and memory profile than Celery with RabbitMQ.

### Negative:
- Arq does not include a built-in web monitoring dashboard out of the box (mitigated by exposing simple Redis queue stats endpoints in Phase 2).

