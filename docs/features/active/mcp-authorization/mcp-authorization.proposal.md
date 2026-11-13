# MCP authorization for AFD servers

> **Goal**: Let an AFD server on HTTP act as an OAuth 2.1 protected resource under MCP 2026-07-28. It publishes its metadata, rejects requests without a valid token for its own audience, and hands commands a verified caller identity and scopes.

| Field | Value |
|---|---|
| Status | Active. Proposed 2026-10-25; approved 2026-11-04 with the [Umbel phase 5 specification](../../../../endpoints/umbel/docs/phases/5-auth-hosted/spec.md#31-afd-first-step-0-d106) (decision D106, under the owner's 2026-10-31 delegation), which amends A4 and A5 (below). Phase 1, the spec, done 2026-11-07 as Umbel step 0a: [`spec/authorization.md`](../../../../spec/authorization.md) with its cases in [`spec/authorization.json`](../../../../spec/authorization.json), and `scopes`, the #532 binding and the host-verified confirmation mode in [`spec/command-metadata.md`](../../../../spec/command-metadata.md). Rust is next (Umbel steps 0b to 0d), before TypeScript and Python; the #532 binding is done in TypeScript, Python and Rust (2026-11-07, Umbel step 0c); progress is in the [Umbel status](../../../../endpoints/umbel/docs/STATUS.md). Ranked 2 of 4 among the [MCP 2026-07-28 Phase 7 follow-ons](../mcp-2026-07-28/proposal.md#phase-7-optional-follow-ons-each-its-own-proposal). Answers that plan's open question 5. |
| Author | jasfalk (drafted with Claude) |
| Spec | [Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization), [authorization server discovery](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery), RFC 9728, RFC 8707, RFC 6750 |
| Packages | `spec/`, `packages/core`, `packages/server`, `python/`, `packages/rust` (`server` feature), `packages/auth` (coexistence only) |
| Related | [Auth adapter](../../complete/auth-adapter/) (`@lushly-dev/afd-auth`, application sign-in), [MCP confirmations](../mcp-confirmations/mcp-confirmations.proposal.md) (binds `requestState` to the principal), [MCP tasks](../mcp-tasks/mcp-tasks.proposal.md) (task access checks) |

## Why this is second

| Criterion | Assessment |
|---|---|
| Value | High for any AFD server reachable over a network, which is what the stateless upgrade makes practical. It is low for local stdio servers, which the spec excludes. |
| Readiness | Mixed. TypeScript SDK 2.4 has verification, challenges and metadata helpers. Python `mcp` 2.3 has a verifier and middleware with two gaps. rmcp 3.7 has nothing for the server side. |
| Effort | M for TypeScript and Python, plus an M for an AFD-owned Rust layer. |
| Dependencies | None. Confirmations and Tasks both get stronger once it lands. |

If no hosted AFD deployment is planned for 2.x, this can wait. Phase 1 below is small enough to do early anyway, because it fixes the `context.auth` naming before anything else claims it.

## Today

- No AFD MCP route checks a bearer token, publishes RFC 9728 metadata, or answers 401 or 403 with `WWW-Authenticate`.
- TypeScript hosts can inject anything through `createContext(req)`. The `/mcp` lane never passes the SDK's `authInfo` to commands.
- `CommandContext.actor` exists in TypeScript, `{ kind, id?, label?, onBehalfOf? }`, and defaults to `{ kind: 'agent' }`. Python and Rust have no actor field.
- `@lushly-dev/afd-auth` already owns `CommandContext.auth`. Its middleware overwrites that field on every call with the adapter's sign-in session, and sets `actor` from the session user.
- `tools/list` is sent with `cacheScope: 'public'`.

## Proposal

### Server option

```ts
createMcpHandler({
  auth: {
    resource: 'https://todo.example.com/mcp',      // canonical URI, the expected audience
    authorizationServers: ['https://auth.example.com'],
    verifier: { verifyAccessToken: async (token) => authInfo },
    scopesSupported: ['todo:read', 'todo:write'],
    requiredScopes: ['todo:read'],                 // needed for any call
    filterToolsByScope: false,
  },
});
```

When `auth` is set, on every HTTP MCP route (the modern `/mcp` and the legacy `/sse` and `/message`):

- `GET /.well-known/oauth-protected-resource/mcp` (and the root form) serves RFC 9728 metadata built from the options.
- A request without a token, or with an invalid or expired one, gets HTTP 401 with `WWW-Authenticate: Bearer resource_metadata="…", scope="…"`.
- A token whose audience is not `resource` is rejected with a 401. That check is not optional.
- Tokens in the query string are rejected.
- stdio is unaffected, as the spec requires.

### Per-command scopes

`spec/command-metadata.md` gains an optional `scopes: string[]` field: the scopes a caller needs to run the command. It is reported in `_meta.scopes`. `requires` is not reused, because it already means "call these commands first".

- **Individual tools.** The `Mcp-Name` header names the tool, so the HTTP layer checks scopes before the body is dispatched. Missing scopes get HTTP 403 with `error="insufficient_scope"` and every missing scope in one challenge, which lets the client step up in one round.
- **Meta-tools and grouped tools.** `Mcp-Name` names the meta-tool or group, not the command. The router checks scopes after it resolves the command, and returns a tool error with a new `INSUFFICIENT_SCOPE` code whose suggestion names the scopes. `afd-batch` and `afd-pipe` check every step before running any.
- **Listing.** With `filterToolsByScope`, `tools/list` and `afd-discover` hide commands the token cannot run, and `tools/list` switches to `cacheScope: 'private'`. The spec allows lists to vary by authorization but not by connection.

### What commands see

A new field, `CommandContext.credentials`, holds the verified claims: `{ issuer, subject?, clientId, scopes, resource, expiresAt }` (*specified 2026-11-07 as `{ issuer, subject, clientId, scopes, resource, expiresAt, issuedAt, authTime?, acr?, cnf? }`, [M4](../../../../spec/authorization.md#m4-credentials)*). The raw token is never on the context, so commands cannot pass it on. The spec forbids token passthrough, and this makes the rule easy to follow.

The server also sets `actor` when the host has not: `{ kind: 'agent', id: clientId, onBehalfOf: { kind: 'human', id: subject } }`.

`context.auth` stays with `@lushly-dev/afd-auth`. The two layers answer different questions. MCP authorization says which client may call this server. Application sign-in says which user the app thinks is signed in. A host that wants one identity can map `credentials` into its adapter; the docs show that recipe rather than AFD merging the two.

### Per language

| Language | Implementation |
|---|---|
| TypeScript | `verifyBearerToken`, `bearerAuthChallengeResponse` and `oauthMetadataResponse` from `@modelcontextprotocol/server` inside AFD's HTTP handler, ahead of `createMcpHandler`. `authInfo` is passed through to the factory and mapped to `credentials`. |
| Python | The SDK's `AuthSettings` and `TokenVerifier` through `streamable_http_app(auth=…, token_verifier=…)`, with `validate_token_resource` forced on. AFD adds its own challenge, because the SDK omits `scope=` and challenges one scope at a time. |
| Rust | An AFD tower layer in front of `StreamableHttpService`, since rmcp's `auth` feature is client-only. A `TokenVerifier` trait, the metadata route, and challenges. The verified claims reach handlers through the request `extensions` that rmcp already forwards. |
| C++ | Not applicable while the C++ backend is stdio only. |

AFD ships the hook, not a token library. Hosts plug in JWT validation (for example `jose` or `PyJWT`) or token introspection. One reference verifier per language, for JWTs with a JWKS URL, is in scope so that the common case takes one line.

### Testing

A local test authorization server fixture issues tokens for a test audience, extending the credential-free style of `pnpm test:hosted:local`. Conformance cases cover: no token, wrong audience, expired, missing scope on an individual tool, missing scope through `afd-call`, list filtering, and that no handler ever sees the raw token.

## Phases

1. Spec: the `scopes` field, the `credentials` context field, the `INSUFFICIENT_SCOPE` code, and the HTTP behavior.
2. TypeScript, with the test authorization server and conformance cases.
3. Python.
4. Rust layer.

## Decisions

| # | Question | Recommendation |
|---|---|---|
| A1 | Is authorization wanted in 2.x? | Yes for TypeScript and Python once a hosted deployment is planned. Do Phase 1 now either way. |
| A2 | What field do commands read? | `context.credentials`, leaving `context.auth` to `@lushly-dev/afd-auth`. |
| A3 | Is the raw token available to commands? | No. |
| A4 | How are scopes declared? | A new `scopes` field, not `requires` and not inferred from `mutation`. *Amended 2026-11-04 (Umbel D106):* static `scopes` stay the default, and a host `ScopeResolver`, when installed, decides each call from the command and its input, as MCP allows ([M6](../../../../spec/authorization.md#m6-scopes)). |
| A5 | Where are scopes enforced? | HTTP 403 for individual tools (via `Mcp-Name`), a tool error for meta-tools and groups. *Amended 2026-11-04 (Umbel D106):* the HTTP layer parses the body, so a missing scope on any non-streamed `tools/call`, including the commands `afd-call`, `afd-batch` and `afd-pipe` name, is an HTTP 403 decided before dispatch; a batch with any missing step is one 403 naming every missing scope. `INSUFFICIENT_SCOPE` remains for calls HTTP cannot answer ([M6](../../../../spec/authorization.md#m6-scopes)). |
| A6 | Is list filtering on by default? | No. It changes caching, so hosts opt in. |
| A7 | Does AFD include an authorization server? | No. AFD is the resource server only. |
| A8 | Must every issuer's tokens follow RFC 9068's names? | *Added 2026-11-12 (Umbel D184), not yet in `spec/`:* no. A JWT issuer may carry a claim profile (token types `at+jwt` or `JWT`, an exact audience, `jti` or `uti`, `client_id`, `azp` or `appid`, and `scope`, `scp` or `roles`), each defaulting to today's rule, and a server may set a scope qualifier. Specified in the [Umbel auth profiles specification](../../../../endpoints/umbel/docs/phases/5-auth-hosted/auth-profiles.spec.md), section 2; written into `spec/authorization.md` by its step A1. |

## Out of scope

The authorization server role, Dynamic Client Registration and Client ID Metadata Documents (client and authorization server concerns), the client side of OAuth in `@lushly-dev/afd-client`, Enterprise Managed Authorization, and application sign-in, which stays in `@lushly-dev/afd-auth`.

## Sources

- [Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization): optional on HTTP, not for stdio; RFC 9728 metadata; audience binding; no passthrough; 401 and 403 rules; scope challenges.
- [Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools): lists may vary by authorization, not by connection.
- The SDKs as installed: TypeScript `@modelcontextprotocol/server` 2.4.0 (`verifyBearerToken`, `requireBearerAuth`, `oauthMetadataResponse`, `AuthInfo`), Python `mcp` 2.3.0 (`server/auth/settings.py`, `middleware/bearer_auth.py`), rmcp 3.7.0 (`src/transport/auth.rs`, client side only).
