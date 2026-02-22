---
name: handle-authentication
source: botcore
description: >
  Guides authentication and authorization design for web applications, APIs, and AI agent systems. Covers OAuth 2.1, OIDC, passkeys/WebAuthn, RBAC/ABAC/ReBAC, Cedar policy language, session management (JWT vs server sessions), multi-tenant patterns, zero trust continuous verification, MCP server auth, and agentic identity with machine-to-machine delegation. Use when designing login flows, implementing authorization, adding passkeys, configuring SSO, building multi-tenant auth, securing MCP servers, or managing AI agent credentials. Triggers: authentication, authorization, OAuth, OIDC, passkey, WebAuthn, RBAC, ABAC, session, JWT, token, multi-tenant, SSO, MFA, zero trust, MCP auth, agent identity, delegation.

version: 1.0.0
triggers:
  - authentication
  - authorization
  - OAuth
  - OIDC
  - passkey
  - WebAuthn
  - RBAC
  - ABAC
  - ReBAC
  - session management
  - JWT
  - token rotation
  - multi-tenant
  - SSO
  - SAML
  - MFA
  - zero trust
  - MCP auth
  - agent identity
  - delegation
  - Cedar policy
  - access control
portable: true
---

# Handling Authentication

Expert guidance for designing and implementing authentication, authorization, and identity management across web apps, APIs, multi-tenant SaaS, and AI agent systems.

## Capabilities

1. **OAuth 2.1 and OIDC** -- Authorization code + PKCE, client credentials, DPoP sender-constrained tokens, and OpenID Connect identity layer
2. **Passkeys and WebAuthn** -- Passwordless authentication with progressive rollout, conditional UI, and phishing resistance
3. **Authorization Models** -- RBAC, ABAC, ReBAC design and Cedar/*BAC policy language for unified access control
4. **Session Management** -- JWT vs server sessions, hybrid approaches, token rotation, secure cookies
5. **Multi-Tenant Authentication** -- Tenant discovery, per-tenant policies, SSO integration, data isolation
6. **Agentic Authentication** -- AI agent identity, MCP server OAuth, delegation chains, scope attenuation, machine-to-machine tokens
7. **Zero Trust Patterns** -- Continuous verification, device trust, step-up authentication, behavioral analysis

## Routing Logic

| Request type | Load reference |
|---|---|
| OAuth 2.1, OIDC, PKCE, DPoP, grant types, token endpoints | [references/oauth-and-oidc.md](references/oauth-and-oidc.md) |
| Passkeys, WebAuthn, passwordless, FIDO2, conditional UI | [references/passkeys-and-webauthn.md](references/passkeys-and-webauthn.md) |
| RBAC, ABAC, ReBAC, Cedar, OPA, Zanzibar, policy engines | [references/authorization-models.md](references/authorization-models.md) |
| JWT, sessions, cookies, token rotation, token lifetimes | [references/session-management.md](references/session-management.md) |
| Multi-tenant, tenant discovery, SSO, SAML, per-tenant config | [references/multi-tenant-auth.md](references/multi-tenant-auth.md) |
| AI agent auth, MCP OAuth, delegation, M2M, agent identity | [references/agentic-auth.md](references/agentic-auth.md) |
| Zero trust, continuous verification, device trust, step-up | [references/zero-trust-patterns.md](references/zero-trust-patterns.md) |

## Core Principles

### 1. Defense in Depth

Never rely on a single authentication factor or authorization check. Layer protections:

- Authentication: passkey > password + MFA > password alone
- Authorization: enforce at API gateway, service layer, and data layer
- Sessions: short-lived access tokens + rotated refresh tokens + server-side revocation

### 2. Least Privilege by Default

Grant minimum permissions for minimum time:

```typescript
// Bad: Over-broad, long-lived token
scope: 'admin:full', expiresIn: '30d'

// Good: Minimal scope, short-lived
scope: 'read:documents', expiresIn: '15m'
```

- Request scopes incrementally as features need them
- AI agents get task-specific scopes, never admin access
- Refresh tokens rotate on each use
- Default-deny in all authorization policies

### 3. Cryptographic Proof over Shared Secrets

Prefer mechanisms where secrets are never transmitted:

| Prefer | Over |
|---|---|
| Passkeys (public key crypto) | Passwords (shared secret) |
| DPoP (sender-constrained tokens) | Bearer tokens |
| PKCE (code challenge) | Implicit flow |
| `private_key_jwt` client auth | Client secret in request body |

### 4. Tokens Must Be Bound and Short-Lived

- Access tokens: 15 minutes maximum
- Refresh tokens: 7-14 days with rotation
- Include audience (`aud`), issuer (`iss`), and tenant (`tid`) claims
- Bind to sender where possible (DPoP, mTLS)
- Never store tokens in localStorage; use httpOnly cookies or secure storage

### 5. Every Action Must Be Attributable

All authentication and authorization events must trace to a responsible identity:

- Human users: user ID + session ID + auth method
- AI agents: agent ID + human sponsor + delegation chain
- Log: who, what, when, from where, with what permissions, allow/deny decision

### 6. Multi-Tenant Isolation Is Non-Negotiable

- Every token includes tenant context (`tid` claim)
- Data queries always scoped by tenant (Row-Level Security)
- Auth policies are per-tenant, not global
- Cross-tenant access is an immediate security incident

## Quick Reference

### OAuth 2.1 Grant Types

| Grant | Use Case | Client Type |
|---|---|---|
| Authorization Code + PKCE | User login (web, mobile, SPA) | Public or confidential |
| Client Credentials | Machine-to-machine, AI agents | Confidential |
| Device Authorization | CLI tools, TVs, IoT | Public |
| Token Exchange (RFC 8693) | Delegation, on-behalf-of | Confidential |

### Authentication Method Strength

| Method | Phishing Resistant | Recommended |
|---|---|---|
| Passkey (WebAuthn) | Yes | Primary for users |
| Hardware security key | Yes | Backup/recovery |
| TOTP authenticator app | No | MFA secondary factor |
| Password + MFA | No | Legacy, migrate away |
| Password only | No | Not recommended |
| SMS OTP | No | Avoid for sensitive apps |
| Static API key | N/A | Avoid; use OAuth tokens |

### Token Lifetimes

| Token | Lifetime | Notes |
|---|---|---|
| Access token (JWT) | 15 min | Short-lived, stateless validation |
| Refresh token | 7-14 days | Rotate on each use |
| ID token | 1 hour | Identity assertion only |
| Agent access token | 5-15 min | Even shorter for autonomous agents |
| Session (server) | 30 days sliding | Extended with activity |

### Authorization Model Selection

```
Need simple role hierarchy?           -> RBAC
Need attribute-based conditions?      -> ABAC
Need resource ownership/sharing?      -> ReBAC
Need all of the above unified?        -> Cedar / *BAC
```

## Workflow

### Authentication Design Protocol

#### 1. Assess Requirements

- [ ] Identify user types (human, service, AI agent)
- [ ] Determine tenant model (single, multi-tenant, B2B)
- [ ] List authentication methods needed (password, passkey, SSO, M2M)
- [ ] Identify compliance requirements (SOC 2, HIPAA, PCI DSS)
- [ ] Map sensitive operations that need step-up auth

#### 2. Design Authentication Flow

- [ ] Choose primary auth method (passkeys recommended for users)
- [ ] Design MFA strategy (TOTP, WebAuthn for second factor)
- [ ] Plan session management (hybrid JWT + server sessions recommended)
- [ ] Configure token lifetimes and rotation strategy
- [ ] Design account recovery flow (avoid SMS-based recovery with passkeys)

#### 3. Design Authorization Model

- [ ] Choose model (RBAC for simple, Cedar for complex)
- [ ] Define roles, permissions, and resource types
- [ ] Implement default-deny with explicit grants
- [ ] Enforce at API gateway, service layer, and data layer
- [ ] Plan for authorization audit logging

#### 4. Implement Multi-Tenant (if applicable)

- [ ] Choose tenant discovery pattern (subdomain, email, invite)
- [ ] Implement per-tenant auth policies
- [ ] Configure enterprise SSO (SAML/OIDC) per tenant
- [ ] Enforce data isolation (RLS, schema, or DB separation)
- [ ] Scope all tokens with tenant ID

#### 5. Implement Agent Auth (if applicable)

- [ ] Register agent identities with unique client IDs
- [ ] Use OAuth 2.1 client credentials or token exchange
- [ ] Implement delegation chains with scope attenuation
- [ ] Set up MCP server OAuth with resource indicators
- [ ] Ensure all agent actions trace to human sponsor
- [ ] Automate credential rotation

#### 6. Apply Zero Trust

- [ ] Implement continuous trust evaluation (not just login-time)
- [ ] Add device posture checking for sensitive operations
- [ ] Configure step-up auth for trust degradation
- [ ] Classify resources by sensitivity tier
- [ ] Set up behavioral anomaly detection

### Agentic Workflow Considerations

When an AI agent is implementing authentication:

1. **Never hardcode secrets** -- Use environment variables or vault references
2. **Generate secure random values** -- Use `crypto.randomBytes()` or equivalent, never `Math.random()`
3. **Validate all tokens server-side** -- Never trust client-provided claims without verification
4. **Test for common vulnerabilities** -- CSRF, session fixation, token leakage in logs
5. **Document auth decisions** -- Explain why a particular pattern was chosen
6. **Flag for human review** -- Authentication code changes should always be reviewed by a human

## Checklist

### Authentication

- [ ] OAuth 2.1 flows use PKCE (no implicit or password grants)
- [ ] Passkeys offered as primary authentication method
- [ ] MFA enforced for sensitive operations at minimum
- [ ] Passwords hashed with Argon2id, bcrypt, or scrypt (never MD5/SHA)
- [ ] Rate limiting on authentication endpoints
- [ ] Account lockout after repeated failures (with unlock mechanism)
- [ ] Brute-force protection on all auth endpoints

### Sessions and Tokens

- [ ] Access tokens expire in 15 minutes or less
- [ ] Refresh tokens rotate on each use with reuse detection
- [ ] JWTs signed with RS256/ES256 (asymmetric) for distributed systems
- [ ] JWT `alg: none` explicitly rejected in validation
- [ ] Cookies set: `httpOnly`, `secure`, `sameSite`, scoped `path`
- [ ] Session regenerated after login (session fixation prevention)
- [ ] Logout revokes server-side session and clears all cookies

### Authorization

- [ ] Default-deny policy (no access unless explicitly granted)
- [ ] Authorization enforced server-side at service and data layers
- [ ] No client-side-only authorization checks
- [ ] Resource access verified per-request (no cached permissions stale > 5 min)
- [ ] Audit log captures every allow/deny decision

### Multi-Tenant

- [ ] Tenant ID present in every token and validated on every request
- [ ] Data isolation enforced at database level (RLS or schema separation)
- [ ] Cross-tenant token reuse impossible (audience + tenant validation)
- [ ] Per-tenant SSO and MFA policies supported

### Agent Identity

- [ ] Each agent has a unique identity (no shared service accounts)
- [ ] Agent tokens are short-lived (5-15 minutes) with auto-rotation
- [ ] Delegation chain preserved in tokens (traceable to human sponsor)
- [ ] Scope attenuation enforced (sub-agents cannot exceed parent permissions)
- [ ] MCP servers validate tokens with resource indicators

## When to Escalate

- **Authentication bypass suspected** -- Any path that skips authentication checks
- **Cross-tenant data access** -- Token or query returning data from another tenant
- **Privilege escalation** -- User or agent gaining permissions beyond their grant
- **Credential leakage** -- Tokens, keys, or secrets appearing in logs, URLs, or client code
- **Cryptographic decisions** -- Custom crypto, algorithm selection, key management design
- **Compliance-driven requirements** -- SOC 2, HIPAA, PCI DSS, FedRAMP auth requirements
- **Agent permission model design** -- First-time setup of agent identity and delegation infrastructure
- **SSO integration issues** -- SAML/OIDC federation with enterprise identity providers
- **Recovery flow design** -- Account recovery mechanisms that could weaken authentication guarantees
