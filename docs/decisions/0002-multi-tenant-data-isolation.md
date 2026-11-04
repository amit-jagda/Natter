# ADR 0002: Multi-Tenant Data Isolation Strategy

## Status
Accepted

## Context
Multiple businesses will use the platform to conduct proprietary voice campaigns. Strict data separation is an absolute compliance, security, and functional requirement.

## Decision
We enforce multi-tenancy using a **Shared Database, Shared Schema with Discriminator Column (`tenant_id`)** pattern:
1. Every business-owned entity includes a foreign-keyed `tenant_id` UUID column with an index.
2. Tenant context is validated in FastAPI dependencies using JWT authentication claims.
3. Repositories and service functions explicitly enforce `tenant_id` filtering on all queries.

## Consequences
### Positive:
- **Cost Effective & Simple Migrations**: Single PostgreSQL database instance with one migration run applies across all tenants.
- **Predictable Performance**: Indexed foreign keys maintain high query speeds without complex dynamic schema switching.

### Negative:
- Developers must never write queries omitting the `tenant_id` filter (mitigated by automated repository base classes in Phase 2).

