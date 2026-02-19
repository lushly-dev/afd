# Security Policy

> **Status**: AFD is in alpha. Security patterns are being established. Please report any concerns.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.x.x   | :white_check_mark: |

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
| **Authentication**     | Error codes (`UNAUTHORIZED`, `TOKEN_EXPIRED`) | Token validation, session management    |
| **Authorization**      | Middleware pattern                            | Permission checks, RBAC                 |
| **Encryption**         | —                                             | TLS/HTTPS, data encryption              |
| **Secrets Management** | —                                             | Vault integration, env var security     |
| **Rate Limiting**      | In-memory middleware (dev only)               | Distributed rate limiting (Redis, etc.) |

See [Production Considerations](./.claude/skills/afd-developer/references/production-considerations.md) for implementation patterns.

## Reporting a Vulnerability

**For security vulnerabilities**, please:

1. **Do NOT** open a public GitHub issue
2. Email the maintainers directly (see CODEOWNERS or package.json)
3. Include:
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
- **zod-to-json-schema** - Schema conversion

Run `npm audit` in the root and all packages to check for known vulnerabilities.
