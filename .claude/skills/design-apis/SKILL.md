---
name: design-apis
source: botcore
description: >
  Provides API design guidance for REST, GraphQL, and gRPC services covering naming conventions, resource modeling, versioning strategies, error handling (RFC 9457), pagination patterns, OpenAPI 3.1 specification authoring, security (OAuth 2.1, rate limiting), and agent-friendly design patterns including MCP tool integration. Use when designing new APIs, reviewing API contracts, choosing between REST/GraphQL/gRPC, implementing error handling or pagination, writing OpenAPI specs, or making APIs consumable by AI agents. Triggers: API design, REST, GraphQL, gRPC, OpenAPI, error handling, pagination, versioning, API security, agent-friendly API, MCP tools, API-first.

version: 1.0.0
triggers:
  - API design
  - REST API
  - GraphQL
  - gRPC
  - protobuf
  - OpenAPI
  - API error handling
  - pagination
  - API versioning
  - API security
  - rate limiting
  - OAuth
  - agent-friendly API
  - MCP tools
  - API-first
  - API contract
  - API documentation
portable: true
---

# Designing APIs

Expert guidance for designing REST, GraphQL, and gRPC APIs with modern best practices, agent-friendly patterns, and production-ready conventions.

## Capabilities

1. **REST API Design** -- Resource naming, HTTP methods, status codes, headers, HATEOAS, and bulk/async operations
2. **GraphQL Schema Design** -- Type system, mutations, connections, error handling, and schema evolution
3. **gRPC Service Design** -- Protobuf style guide, service patterns, streaming, and well-known types
4. **Error Handling** -- RFC 9457 Problem Details, error code registries, and retry guidance
5. **Versioning** -- URI/header/query strategies, lifecycle management, deprecation, and migration
6. **Pagination and Filtering** -- Offset, cursor, and keyset pagination with sorting and search
7. **Security** -- OAuth 2.1, API keys, JWT validation, rate limiting, and OWASP API Top 10
8. **Agent-Friendly Design** -- MCP integration, OpenAPI for tool generation, composable workflows, idempotency
9. **OpenAPI Specification** -- API-first methodology, 3.1 authoring, linting, and documentation generation

## Routing Logic

| Request type | Load reference |
|---|---|
| REST resource design, HTTP methods, status codes, headers | [references/rest-patterns.md](references/rest-patterns.md) |
| GraphQL schema, mutations, connections, subscriptions | [references/graphql-patterns.md](references/graphql-patterns.md) |
| gRPC services, protobuf style, streaming patterns | [references/grpc-patterns.md](references/grpc-patterns.md) |
| Error responses, RFC 9457, error codes, retry logic | [references/error-handling.md](references/error-handling.md) |
| Versioning approaches, deprecation, migration | [references/versioning-strategies.md](references/versioning-strategies.md) |
| Pagination, filtering, sorting, search | [references/pagination-and-filtering.md](references/pagination-and-filtering.md) |
| Authentication, authorization, rate limiting, transport security | [references/security-patterns.md](references/security-patterns.md) |
| Agent consumption, MCP tools, composability, OpenAPI for agents | [references/agent-friendly-apis.md](references/agent-friendly-apis.md) |
| OpenAPI 3.1, API-first workflow, linting, documentation | [references/openapi-and-documentation.md](references/openapi-and-documentation.md) |

## Core Principles

### 1. API-First Design

Design the API contract before writing implementation code. The OpenAPI (REST), GraphQL schema, or Protobuf definition is the source of truth.

**Workflow:** Requirements -> Contract design -> Stakeholder review -> Lint/validate -> Mock -> Implement -> Test conformance -> Publish docs.

Use OpenAPI 3.1 for REST APIs, AsyncAPI 3.0 for event-driven APIs, and Protobuf with `buf lint` for gRPC.

### 2. Choose the Right Paradigm

| Factor | REST | GraphQL | gRPC |
|--------|------|---------|------|
| Best for | CRUD, public APIs, broad adoption | Flexible queries, frontend-driven | Microservices, high performance |
| Data fetching | Fixed endpoints | Client-specified fields | Strongly typed messages |
| Protocol | HTTP/1.1+ JSON | HTTP POST JSON | HTTP/2 Protobuf |
| Caching | Native HTTP caching | Requires custom caching | No native HTTP caching |
| Agent-friendly | High (URL-based, widely supported) | Medium (requires query construction) | Low without gRPC-Gateway |
| Schema | OpenAPI 3.1 | GraphQL SDL (introspectable) | Protobuf definitions |
| Real-time | Webhooks, SSE | Subscriptions (WebSocket) | Bidirectional streaming |

**Decision guide:**
- Public API or AI agent consumers -> REST
- Frontend with diverse data needs -> GraphQL
- Internal microservices needing speed -> gRPC
- Multiple paradigms are valid; expose gRPC internally with a REST gateway for external consumers

### 3. Naming Conventions

**REST URLs:**
- Plural nouns for collections: `/users`, `/order-items`
- No verbs in paths: `POST /users` not `POST /createUser`
- Kebab-case for multi-word segments: `/order-items` not `/orderItems`
- Max 3 levels of nesting: `/users/{id}/orders` (flatten beyond that)

**GraphQL:** PascalCase types, camelCase fields, SCREAMING_SNAKE_CASE enums, `Input`/`Payload` suffixes.

**Protobuf:** PascalCase messages/services, snake_case fields, `ENUM_PREFIX_VALUE` enums, `Service` suffix.

### 4. Error Handling

Use RFC 9457 Problem Details for all REST error responses:

```json
{
  "type": "https://api.example.com/errors/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "The email field must be a valid email address.",
  "errors": [
    { "field": "email", "code": "INVALID_FORMAT", "message": "Must be a valid email" }
  ]
}
```

**Rules:**
- Content-Type: `application/problem+json`
- Define an error code registry and publish it
- Include field-level validation errors for 400/422 responses
- Include `retry_after_seconds` for 429 and transient 5xx errors
- Distinguish retryable (408, 429, 500, 502, 503, 504) from non-retryable (400, 401, 403, 404, 422) errors
- For agents: use stable string error codes, not just HTTP status codes

### 5. Versioning

Use URI path versioning (`/api/v1/`) for public and agent-consumed APIs. It is the most explicit and discoverable approach.

**When to bump the version:** Removing fields, renaming fields, changing types, changing auth, changing error format.

**When NOT to bump:** Adding new fields, adding new endpoints, adding optional parameters, fixing bugs to match documented behavior.

**Deprecation:** Set `Deprecation: true` and `Sunset: {date}` headers. Give consumers 6+ months notice. Return 410 Gone after sunset.

### 6. Pagination

**Default to cursor-based pagination** for most APIs:

```
GET /api/v1/users?limit=20&after=eyJpZCI6MTAwfQ
```

```json
{
  "data": [ ... ],
  "pagination": {
    "has_next": true,
    "next_cursor": "eyJpZCI6MTIwfQ"
  }
}
```

- Enforce a maximum page size (100 is typical)
- Always return `has_next` and navigation cursor/link
- Return empty array for zero results, never null
- Use offset-based only when random page access is required

### 7. Security

**Authentication:** OAuth 2.1 with Authorization Code + PKCE for user context. Client Credentials for service-to-service. API keys for application identification only (not user auth).

**Authorization:** Scope-based (`read:users`, `write:users`) checked at middleware layer. RBAC or ABAC for fine-grained control.

**Rate limiting:** Per-consumer (API key or token), not global. Return `X-RateLimit-*` headers on every response. Return 429 with `Retry-After` header when exceeded.

**Transport:** TLS 1.2+ required. HSTS header. CORS configured per-origin (never wildcard for authenticated APIs).

### 8. Agent-Friendly Design

Design every API as if an AI agent is a first-class consumer:

- **OpenAPI spec at stable URL** -- Serve at `/openapi.json`. Agents auto-generate tools from it.
- **operationId as tool name** -- Use clear verb-noun IDs: `listUsers`, `createOrder`. These become function names.
- **Examples in every schema** -- Agents use examples to construct valid requests.
- **HATEOAS links** -- Include `links` and `allowed_actions` so agents can navigate without hardcoding URLs.
- **Idempotency keys** -- Accept `Idempotency-Key` header on POST/PATCH for safe agent retries.
- **Prefixed IDs** -- Use `usr_123`, `ord_456` so agents can identify resource types from IDs alone.
- **Consistent response shapes** -- Same envelope for success, error, and collection responses.
- **Document workflows** -- Show multi-step API call chains in docs; agents use these to plan.

### 9. MCP Tool Exposure

When wrapping APIs as MCP tools for AI agents:

- One tool per distinct action (not one mega-tool)
- Simple parameter types (str, int, bool) over complex objects
- Descriptions under 50 tokens each
- Include valid values and defaults in the description
- Return structured Markdown, not raw JSON

## Quick Reference

### REST Endpoint Template

```
GET    /api/v1/{resource}              -> List (200, paginated)
POST   /api/v1/{resource}              -> Create (201 + Location header)
GET    /api/v1/{resource}/{id}         -> Read (200)
PUT    /api/v1/{resource}/{id}         -> Replace (200)
PATCH  /api/v1/{resource}/{id}         -> Partial update (200)
DELETE /api/v1/{resource}/{id}         -> Remove (204)
POST   /api/v1/{resource}/{id}/{action} -> Custom action (200)
```

### Standard Headers

```
Request:  Authorization, Content-Type, Accept, Idempotency-Key, X-Request-ID
Response: Content-Type, Location, ETag, Cache-Control, Retry-After,
          X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset,
          X-Request-ID, Deprecation, Sunset
```

### Status Code Cheat Sheet

```
200 OK              - GET/PUT/PATCH success
201 Created         - POST success (+ Location)
202 Accepted        - Async operation queued
204 No Content      - DELETE success
400 Bad Request     - Malformed input
401 Unauthorized    - Missing/invalid auth
403 Forbidden       - Insufficient permissions
404 Not Found       - Resource doesn't exist
409 Conflict        - State conflict
422 Unprocessable   - Validation failure
429 Too Many        - Rate limited (+ Retry-After)
500 Internal Error  - Server failure
503 Unavailable     - Temporary outage (+ Retry-After)
```

## Checklist

Before shipping an API, verify:

- [ ] API contract (OpenAPI/GraphQL SDL/Protobuf) written and reviewed before implementation
- [ ] All endpoints have `operationId`, `summary`, `description`, and `examples`
- [ ] Naming conventions are consistent (plural nouns, kebab-case URLs, appropriate casing per paradigm)
- [ ] Error responses follow RFC 9457 with stable error codes and field-level validation details
- [ ] Pagination implemented with maximum page size enforced and navigation metadata included
- [ ] Versioning strategy chosen and documented; deprecation policy defined
- [ ] Authentication and authorization implemented (OAuth 2.1 / API keys / scopes)
- [ ] Rate limiting active with `X-RateLimit-*` headers and 429 + `Retry-After` responses
- [ ] TLS 1.2+ enforced; CORS configured per-origin
- [ ] Idempotency keys supported on POST/PATCH endpoints
- [ ] OpenAPI spec published at a stable URL and passes Spectral linting
- [ ] Response shapes are consistent across all endpoints (same envelope for data, errors, collections)
- [ ] Agent-friendly: prefixed IDs, HATEOAS links, documented workflows, examples in every schema
- [ ] Input validation: max lengths, type checking, required fields, sanitization

## When to Escalate

- **Choosing between paradigms** -- If the system has both public consumers and internal microservices, consider a multi-paradigm approach (gRPC internal + REST external). Consult with the architecture team.
- **Breaking change to a public API** -- Requires a versioning plan, migration guide, and stakeholder sign-off. Never break a public API without a deprecation period.
- **Complex authorization requirements** -- ABAC policies, multi-tenant isolation, or cross-service permission propagation may need a dedicated authorization service (e.g., OPA, Cedar, Zanzibar-based).
- **Real-time requirements** -- WebSocket, SSE, or gRPC streaming architectures need infrastructure review for connection management, scaling, and failover.
- **Regulatory compliance** -- APIs handling PII, financial data, or health data may require additional security review, audit logging, and data residency considerations.
- **Agent-specific API design** -- If agents are the primary consumer, consider whether MCP tool exposure, function-calling schemas, or a dedicated agent API layer is more appropriate than a general-purpose API.
