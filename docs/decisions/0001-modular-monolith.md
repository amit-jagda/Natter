# ADR 0001: Adoption of Modular Monolith Architecture

## Status
Accepted

## Context
The platform must support outbound voice campaigns, real-time voice streaming, lead ingestion, analytics, and tenant management. Early architectural choices between microservices and a monolith determine developer velocity, latency, and deployment complexity.

## Decision
We adopt a **Modular Monolith** structure implemented in Python with FastAPI. The backend is a single deployable application organized into decoupled internal packages (`tenants`, `users`, `leads`, `campaigns`, `calls`, `voice`, `adapters`).

## Consequences
### Positive:
- **Low Latency**: In-memory function invocations eliminate inter-service network overhead during call initiation.
- **Developer Velocity**: Single repository, unified database migrations, simplified testing, and straightforward local development.
- **Clear Extraction Paths**: Clean interface boundaries allow extracting high-traffic services (such as the voice streaming runtime) into standalone microservices later if scaling demands it.

### Negative:
- Requires strict engineering discipline to prevent circular imports or cross-module direct database table joins.

