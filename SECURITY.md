# Security Policy

> **Status**: AFD's TypeScript and Python packages are in beta, and its Rust and C++ packages are previews. Please report any concerns.

## Scope

This policy covers everything in this repository: the AFD packages in all four languages, and the rest of the family (Specimen, FAST-AF, Violet, Umbel, Loam, Botcore and Health). The guidance below on modes, scope and best practices is about AFD servers.

Umbel and Loam are unreleased and still changing. Umbel's README says what its access filtering does and does not guarantee today ([access is not a security boundary yet](./endpoints/umbel/README.md#access-is-not-a-security-boundary-yet)); read it before putting an instance in front of other people.

## Supported Versions

Fixes land on `main` and ship in the next release of the affected package; there are no maintenance branches. The latest release of each package is the supported one.

## Development vs Production Mode

AFD servers support two operating modes with different security behaviors:

### 🔧 Development Mode (`devMode: true`)

Enable by setting `NODE_ENV=development` or `devMode: true` in server options.

| Behavior              | Development                          |
| --------------------- | ------------------------------------ |
| **Error messages**    | Full error details with stack traces |
| **CORS**              | Permissive (`*` origin allowed)      |
| **Validation errors** | Verbose with field-level details     |
| **Logging**           | Verbose by default                   |

**When to use**: Local development, testing, debugging.

### 🔒 Production Mode (`devMode: false`, default)

The default when `NODE_ENV` is not set or is set to `production`.

| Behavior              | Production                                             |
| --------------------- | ------------------------------------------------------ |
| **Error messages**    | Generic messages, no stack traces                      |
| **CORS**              | Restrictive (same-origin unless explicitly configured) |
| **Validation errors** | Sanitized, no internal details                         |
| **Logging**           | Minimal by default                                     |

**When to use**: Any environment accessible outside localhost.

### Configuration

```typescript
// Automatic (recommended)
const DEV_MODE = process.env.NODE_ENV === 'development';

createMcpServer({
  name: 'my-app',
  version: '1.0.0',
  commands: [...],
  devMode: DEV_MODE,
});
```

```bash
# Start in development mode
NODE_ENV=development node dist/server.js

# Start in production mode (default)
node dist/server.js
```

## Security Scope

AFD is a **methodology and toolkit**, not a complete security framework. The following are explicitly **out of scope** for AFD itself:

| Concern                | AFD Provides                                  | You Must Implement                      |
| ---------------------- | --------------------------------------------- | --------------------------------------- |
| **Authentication**     | Error codes (`UNAUTHORIZED`, `TOKEN_EXPIRED`); [`@lushly-dev/afd-auth`](./packages/auth), an adapter over your provider; bearer-token verification for HTTP MCP servers in TypeScript and Rust ([`spec/authorization.md`](./spec/authorization.md); per-command scopes are in Rust only so far, see [language parity](./docs/language-parity.md)) | An identity provider, its keys and session storage |
| **Authorization**      | Middleware pattern                            | Permission checks, RBAC                 |
| **Encryption**         | —                                             | TLS/HTTPS, data encryption              |
| **Secrets Management** | —                                             | Vault integration, env var security     |
| **Rate Limiting**      | In-memory middleware (dev only)               | Distributed rate limiting (Redis, etc.) |

See [Production Considerations](./docs/whitepaper/AFD-Whitepaper.md#11-production-considerations) and [approvals](./spec/command-metadata.md#approvals) for implementation patterns.

## Reporting a Vulnerability

**For security vulnerabilities**, please:

1. **Do NOT** open a public GitHub issue
2. Report privately via GitHub Security Advisories:
  - https://github.com/lushly-dev/AFD/security/advisories/new
3. If GitHub advisories are unavailable, open a maintainer contact in Discussions:
  - https://github.com/lushly-dev/AFD/discussions
4. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will respond within 7 days and work with you on responsible disclosure.

## Security Best Practices

When building with AFD:

### ✅ Do

- Use `devMode: false` in any non-local environment
- Implement authentication middleware for sensitive commands
- Validate and sanitize the `reasoning` field before logging (may contain sensitive data)
- Use HTTPS in production
- Implement proper authorization checks in command handlers
- Run `npm audit` regularly

### ❌ Don't

- Expose AFD servers to the internet without authentication
- Trust client-provided `traceId` for security decisions
- Store secrets in command results
- Use in-memory rate limiting in production (not distributed)
- Return database queries or internal paths in error messages

## Dependencies

AFD uses minimal dependencies to reduce attack surface:

- **zod** - Input validation (actively maintained, security-focused)
- **The official MCP SDK** (`@modelcontextprotocol/*`) - Protocol transport
- **jose** - Token signature checks for MCP authorization
- **yaml** - Reading YAML frontmatter

Run `npm audit` in the root and all packages to check for known vulnerabilities.
