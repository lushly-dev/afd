# API Security Patterns

Comprehensive reference for authentication, authorization, rate limiting, and transport security.

## Authentication Methods

### 1. OAuth 2.0 / OAuth 2.1

The industry standard for delegated authorization. OAuth 2.1 (draft, expected to finalize 2025-2026) consolidates best practices from OAuth 2.0 and related RFCs.

**Key OAuth 2.1 Changes:**
- PKCE required for all clients (not just public clients)
- Implicit grant removed
- Resource Owner Password Credentials (ROPC) grant removed
- Refresh tokens must be sender-constrained or one-time-use
- Exact redirect URI matching required (no wildcards)

**Recommended Flows:**

| Flow | Use Case |
|------|----------|
| Authorization Code + PKCE | Web apps, mobile apps, SPAs, agent OAuth |
| Client Credentials | Server-to-server, machine-to-machine |
| Device Authorization | CLI tools, IoT devices, smart TVs |

**Token Best Practices (per RFC 9700):**
- Access tokens: short-lived (5-15 minutes)
- Refresh tokens: longer-lived but single-use (rotate on each use)
- Bind tokens to specific scopes and audiences
- Use JWTs for stateless validation; opaque tokens for revocability

### 2. API Keys

Simple authentication for identifying the calling application.

```http
GET /api/v1/users
X-API-Key: sk_live_abc123def456
```

**API Key Rules:**
- Use for identification, not authorization (pair with OAuth for user context)
- Prefix keys to indicate environment: `sk_live_`, `sk_test_`
- Hash keys in storage (never store plaintext)
- Support key rotation without downtime (accept old + new during transition)
- Scope keys to specific operations or resources
- Set per-key rate limits

### 3. JWT (JSON Web Tokens)

Stateless tokens carrying claims for identity and permissions.

```json
{
  "header": { "alg": "RS256", "typ": "JWT", "kid": "key-2025-06" },
  "payload": {
    "sub": "usr_123",
    "iss": "https://auth.example.com",
    "aud": "https://api.example.com",
    "exp": 1718450000,
    "iat": 1718449100,
    "scope": "read:users write:users",
    "roles": ["admin"]
  }
}
```

**JWT Validation Checklist:**
- Verify signature using the correct public key (from JWKS endpoint)
- Check `exp` (expiration) -- reject expired tokens
- Check `iss` (issuer) -- must match your auth server
- Check `aud` (audience) -- must match your API identifier
- Check `iat` (issued at) -- reject tokens issued too far in the past
- Validate scopes/permissions for the specific endpoint

### 4. mTLS (Mutual TLS)

Both client and server present certificates. Use for high-security service-to-service communication.

## Authorization Patterns

### Role-Based Access Control (RBAC)

```json
{
  "roles": {
    "admin": ["users:read", "users:write", "users:delete"],
    "editor": ["users:read", "users:write"],
    "viewer": ["users:read"]
  }
}
```

### Attribute-Based Access Control (ABAC)

Policies based on user attributes, resource attributes, and context:

```
ALLOW if user.role == "manager"
  AND resource.department == user.department
  AND action == "read"
  AND time.hour >= 9 AND time.hour <= 17
```

### Scope-Based Authorization

OAuth scopes restrict what actions a token can perform:

```
read:users      - List and view users
write:users     - Create and update users
delete:users    - Delete users
admin:users     - Full user management including role assignment
```

Design scopes as `action:resource`. Check scopes at the API gateway or middleware layer.

## Rate Limiting

### Implementation Strategies

| Strategy | Description | Best For |
|----------|-------------|----------|
| Fixed Window | Count requests per time window (e.g., 100/min) | Simple, low-overhead |
| Sliding Window | Rolling window prevents burst at boundary | More accurate, moderate overhead |
| Token Bucket | Refill tokens at fixed rate, spend per request | Burst-tolerant, standard choice |
| Leaky Bucket | Requests processed at constant rate, queue excess | Smooth throughput |

### Rate Limit Headers

Always include rate limit information in responses:

```http
HTTP/1.1 200 OK
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 997
X-RateLimit-Reset: 1718450000
```

On rate limit exceeded:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1718450000
Content-Type: application/problem+json

{
  "type": "https://api.example.com/errors/rate-limited",
  "title": "Rate Limited",
  "status": 429,
  "detail": "Rate limit of 1000 requests per hour exceeded.",
  "retry_after_seconds": 30
}
```

### Rate Limit Tiers

| Tier | Limit | Scope |
|------|-------|-------|
| Free | 100 requests/hour | Per API key |
| Standard | 1,000 requests/hour | Per API key |
| Premium | 10,000 requests/hour | Per API key |
| Internal | 50,000 requests/hour | Per service |

### Per-Endpoint Rate Limits

Apply stricter limits to expensive operations:

```
GET  /users          -> 1000/hour
POST /users          -> 100/hour
POST /reports/generate -> 10/hour
GET  /search          -> 500/hour
```

## Transport Security

### TLS Requirements

- TLS 1.2 minimum; prefer TLS 1.3
- HSTS header: `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- Redirect all HTTP to HTTPS
- Use strong cipher suites; disable CBC-mode ciphers

### CORS (Cross-Origin Resource Sharing)

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: GET, POST, PUT, DELETE
Access-Control-Allow-Headers: Authorization, Content-Type
Access-Control-Max-Age: 86400
Access-Control-Allow-Credentials: true
```

**Rules:**
- Never use `Access-Control-Allow-Origin: *` for authenticated APIs
- Validate the Origin header server-side
- Keep preflight cache long (`Max-Age: 86400`)

## Input Validation

### Request Validation Layers

1. **Schema validation** -- Match request against OpenAPI schema (types, required fields, formats)
2. **Business validation** -- Domain rules (e.g., end date after start date)
3. **Sanitization** -- Strip or escape dangerous characters

### Common Validation Rules

```yaml
string_fields:
  - max_length: 10000 (prevent payload stuffing)
  - pattern: regex for emails, URLs, etc.
  - strip: leading/trailing whitespace

numeric_fields:
  - min/max bounds
  - integer vs float

array_fields:
  - max_items: 100 (prevent array bombs)
  - unique_items: when appropriate

request_body:
  - max_size: 1MB default (configurable per endpoint)
  - content_type: must match expected type
```

## OWASP API Security Top 10 (2023)

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Broken Object-Level Authorization | Check resource ownership on every request |
| 2 | Broken Authentication | Use OAuth 2.1, enforce MFA, rotate tokens |
| 3 | Broken Object Property-Level Authorization | Filter response fields per role |
| 4 | Unrestricted Resource Consumption | Rate limiting, pagination limits, query cost analysis |
| 5 | Broken Function-Level Authorization | RBAC/ABAC at endpoint level |
| 6 | Unrestricted Access to Sensitive Business Flows | Bot detection, CAPTCHA, step-up auth |
| 7 | Server-Side Request Forgery | Validate and allowlist outbound URLs |
| 8 | Security Misconfiguration | Secure defaults, disable debug in production |
| 9 | Improper Inventory Management | API catalog, deprecation tracking |
| 10 | Unsafe Consumption of APIs | Validate all upstream API responses |

## Agent Security Considerations

When AI agents consume APIs:

1. **Scoped tokens** -- Issue agents the narrowest possible scopes. Agents should not hold admin tokens.
2. **Short-lived credentials** -- Agent tokens should expire frequently (5-15 min). Use refresh tokens with rotation.
3. **Audit logging** -- Log all agent API calls with the agent identifier for traceability.
4. **Action confirmation** -- For destructive operations (DELETE, bulk updates), consider requiring a confirmation step or human-in-the-loop approval.
5. **Rate limit agents separately** -- Agents can generate high request volumes. Apply dedicated rate limit tiers for agent consumers to prevent resource exhaustion.
6. **Tool-level permissions** -- When exposing APIs via MCP or function calling, map each tool to specific API scopes so the LLM cannot exceed its granted permissions.
