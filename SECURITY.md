# Security Policy

> **Status**: AFD's TypeScript and Python packages are in beta, and its Rust and C++ packages are previews. Please report any concerns.

## Scope

This policy covers everything in this repository: the AFD packages in all four languages, and the rest of the family (Specimen, FAST-AF, Violet, Umbel, Loam, Botcore and Health). The guidance below on modes, scope and best practices is about AFD servers.

Umbel and Loam are unreleased and still changing. Umbel's README says what its access filtering does and does not guarantee today ([access is not a security boundary yet](./endpoints/umbel/README.md#access-is-not-a-security-boundary-yet)); read it before putting an instance in front of other people.

## Supported Versions

Fixes land on `main` and ship in the next release of the affected package; there are no maintenance branches. The latest release of each package is the supported one.

## Development vs Production Mode

AFD servers take a `devMode` option (`dev_mode` in Python and C++). It is off by default. It decides how much an error tells the caller and, in TypeScript, adds debug output for grouped tools; it changes no Host, Origin or CORS rule:

| Behavior                   | Production (`devMode: false`, default)                                   | Development (`devMode: true`)                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| **Handler exceptions**     | `COMMAND_EXECUTION_ERROR` with the generic "An internal error occurred" | The exception's message; TypeScript adds its stack trace in `details.stack`                                                      |
| **Invalid input**          | `VALIDATION_ERROR` with field-level issues in `details.errors`           | The same                                                                                                                         |
| **Schema callback throws** | `VALIDATION_ERROR` whose `suggestion` points at the input schema         | The exception text in `suggestion` instead                                                                                       |
| **Origin checks and CORS** | As configured (below)                                                    | The same                                                                                                                         |
| **Logging**                | No debug output                                                          | TypeScript's `grouped` tool strategy (the default) writes each grouped call's tool, action and full arguments to stderr, and an `INVALID_GROUPED_CALL` result carries the arguments in `_debug.receivedArgs`. Arguments can hold secrets |

Origin checks and CORS do not depend on the mode; what each server accepts is the same in development:

- **TypeScript** (`@lushly-dev/afd-server`): Host and Origin are checked on every HTTP request. Same-origin requests are accepted, and requests without an `Origin` unless their `Sec-Fetch-Site` is `cross-site` or `same-site`; any other browser origin gets HTTP 403 unless it is listed exactly in `allowedOrigins`, which refuses `*` and `null`. CORS headers are sent only with `cors: true` (default `false`), and they echo the accepted request's own origin, never `*`.
- **Rust** (`afd` with the `server` feature): the Streamable HTTP service refuses any browser `Origin` not listed in `allowed_origins`, including when the list is empty. The server has no `devMode`: a handler panic it catches returns the generic message.
- **Python** (`afd`): HTTP is served by the MCP SDK's `MCPServer` transports. AFD sets no CORS headers and no Origin rule of its own; the SDK's own Host and Origin settings apply, including any `transport_security` the host passes to `run()` or `streamable_http_app()`.
- **C++** (`afd-cpp`) serves MCP over stdio only; `dev_mode` on its registry governs error detail only.

**When to use `devMode`**: local development, testing and debugging. Leave it off anywhere reachable from outside localhost.

### Configuration

```typescript
// The server never reads NODE_ENV itself; map it explicitly
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

# Start in production mode (the default when NODE_ENV is unset)
node dist/server.js
```

## Security Scope

AFD is a **methodology and toolkit**, not a complete security framework. The following are explicitly **out of scope** for AFD itself:

| Concern                | AFD Provides                                  | You Must Implement                      |
| ---------------------- | --------------------------------------------- | --------------------------------------- |
| **Authentication**     | Error codes (`UNAUTHORIZED`, `TOKEN_EXPIRED`); [`@lushly-dev/afd-auth`](./packages/auth), an adapter over your provider; bearer-token verification and per-command scopes for HTTP MCP servers in TypeScript, Python and Rust ([`spec/authorization.md`](./spec/authorization.md); [language parity](./docs/language-parity.md) says what each language covers) | An identity provider, its keys and session storage |
| **Authorization**      | Middleware pattern                            | Permission checks, RBAC                 |
| **Encryption**         | —                                             | TLS/HTTPS, data encryption              |
| **Secrets Management** | —                                             | Vault integration, env var security     |
| **Rate Limiting**      | In-memory middleware (dev only)               | Distributed rate limiting (Redis, etc.) |

See [Production Considerations](./docs/whitepaper/AFD-Whitepaper.md#11-production-considerations) and [approvals](./spec/command-metadata.md#approvals) for implementation patterns.

## Reporting a Vulnerability

**For security vulnerabilities**, please:

1. **Do NOT** open a public GitHub issue
2. Report privately through GitHub's private vulnerability reporting:
  - https://github.com/lushly-dev/afd/security/advisories/new
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
- Audit your dependencies regularly (see [Dependencies](#dependencies) for each language's tool)

### ❌ Don't

- Expose AFD servers to the internet without authentication
- Trust client-provided `traceId` for security decisions
- Store secrets in command results
- Use in-memory rate limiting in production (not distributed)
- Return database queries or internal paths in error messages

## Dependencies

Each implementation keeps its runtime dependencies few, to keep the attack surface small. The lists below are the third-party packages each one pulls in at run time; build and test tools are not listed.

- **TypeScript** (npm, `@lushly-dev/afd-*`)
  - `zod`: input validation (a peer dependency of the server)
  - The official MCP SDK (`@modelcontextprotocol/*`): the protocol transport in the server and client
  - `jose`: token signature checks for MCP authorization
  - `yaml`: reading YAML frontmatter
  - `eventsource` in the client; `commander`, `chalk`, `ora`, `conf` and `glob` in the CLI
- **Python** (PyPI, `afd`)
  - `pydantic`: the only required dependency
  - `mcp` (the official MCP SDK), `pyyaml`, `httpx` and `websockets` in the `server` and `client` extras; `click` and `rich` in the `cli` extra
- **Rust** (crates.io, `afd`)
  - `serde`, `serde_json`, `chrono`, `regex`, `sha2` and a few small helpers always
  - `tokio`, `hmac`, `subtle` and `getrandom` with the default features (`native` and `approval`); build with `default-features = false` to leave them out
  - `rmcp` (the official MCP Rust SDK), `http` and a YAML parser with the `server` feature; `jsonwebtoken` (on `aws-lc-rs`), `base64` and the `tower` layer crates with `server-auth`
  - [`packages/rust/Cargo.toml`](./packages/rust/Cargo.toml) gives each one's reason and feature
- **C++** (`afd-cpp`, a git tag)
  - [nlohmann/json](https://github.com/nlohmann/json) is the only runtime dependency. A host's own copy is used when `find_package(nlohmann_json)` finds one; otherwise a pinned release is downloaded and its hash checked. HMAC-SHA256 is built in, so there is no crypto dependency.

To check for known vulnerabilities, run the audit tool for the language you use:

| Language   | Command                                                            |
| ---------- | ------------------------------------------------------------------ |
| TypeScript | `pnpm audit` (or `npm audit`) in your project                      |
| Python     | `pip-audit`                                                        |
| Rust       | `cargo audit`                                                      |
| C++        | Track [nlohmann/json's advisories](https://github.com/nlohmann/json/security) |
