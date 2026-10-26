# MCP 2026-07-28 ("MCP v2") upgrade

> **Goal**: Bring every AFD MCP surface (TypeScript server and client, Python server and client, the Rust and C++ todo backends and their planned library targets, the testing fixtures, the CLI and the conformance tier) up to the MCP `2026-07-28` specification, with statelessness as the organizing principle, while keeping today's clients working through a declared deprecation window.

| Field | Value |
|---|---|
| Status | Active: accepted 2026-10-25 with every recommendation (D1–D9). Phase 0 complete 2026-10-25 ([findings](#phase-0-findings)); D1, D2, D4 and D5 confirmed, one new decision (D10) raised. No issues filed yet. |
| Author | jasfalk (drafted with Claude) |
| Spec | [MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28), [key changes](https://modelcontextprotocol.io/specification/2026-07-28/changelog), [Cloudflare: The next generation of MCP](https://blog.cloudflare.com/mcp-v2/) |
| Packages | `packages/server`, `packages/client`, `packages/core`, `packages/testing`, `packages/cli`, `python/`, `packages/rust` (D1 server feature), `packages/cpp` (D2 stdio target), `packages/examples/todo`, `spec/` |
| Related | [Language parity closure](../../active/parity-closure/parity-closure.plan.md) (D1, D2, D7), [protocol conformance tier](../../../../spec/protocol-conformance.md), [#341](https://github.com/lushly-dev/afd/issues/341) (C++ `afd::mcp_stdio`), [2026-09-23 quality review](../../../reviews/2026-09-23-quality-review.md) (Wave 2: "MCP-conformant HTTP via the SDK") |
| Supersedes | The "current protocol version" wording of parity decision D7: this proposal pins it to `2026-07-28`, served dual-era |

## Summary

"MCP v2" is the `2026-07-28` revision of the specification, released 2026-07-28 together with Tier 1 SDKs. It is not a new wire format: JSON-RPC, `tools/list` and `tools/call` are unchanged. What changed is the lifecycle. There is no `initialize` handshake and no `Mcp-Session-Id`; every request carries its protocol version and client capabilities in `_meta`, every result carries `resultType`, and a mandatory `server/discover` RPC replaces the handshake for clients that want to inspect a server first. Server-initiated requests (elicitation, sampling, roots) are replaced by Multi Round-Trip Requests (MRTR): the server answers `input_required`, the client retries with the answers. Streamable HTTP becomes POST-only with routing headers (`MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`), list results carry cache hints (`ttlMs`, `cacheScope`), and the HTTP+SSE transport that AFD's TypeScript HTTP lane still speaks is formally Deprecated.

AFD is three protocol revisions behind on its HTTP surface. The TypeScript server's HTTP lane is a hand-rolled `2024-11-05` HTTP+SSE transport (`GET /sse` + `POST /message`) that official MCP clients cannot use; the TypeScript client only speaks that lane; the Python server rides `mcp<2` (FastMCP), which the Python SDK removed in 2.0; the testing fixtures answer `initialize` with `2024-11-05`; and the one AFD feature that genuinely depends on sessions, context scoping (`afd-context-enter`), is incompatible with the new rule that `tools/list` must not vary per connection.

The plan: adopt the official v2 SDKs where they exist (TypeScript `@modelcontextprotocol/server` 2.4 and `client` 2.4, Python `mcp` 2.3, Rust `rmcp` 3.7) for transport plumbing, keep AFD's value in the command layer, redesign contexts as explicit per-request input, run the conformance suite in both protocol eras, and remove the legacy lanes in the next major after a declared window. Nine decisions were put to the maintainer; all nine were accepted as recommended on 2026-10-25.

## 1. What changed in MCP since AFD's protocol baseline

AFD's TypeScript HTTP lane and both clients advertise `2024-11-05`. The Rust and C++ todo backends negotiate up to `2025-06-18`. Nothing in AFD speaks `2025-11-25` or `2026-07-28`.

| Revision | Changes that affect AFD |
|---|---|
| `2025-03-26` | Streamable HTTP (single `/mcp` endpoint, optional `Mcp-Session-Id`) replaces HTTP+SSE, which is deprecated from here on. Tool `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`). Audio content. OAuth 2.1 authorization framework. JSON-RPC batching added. |
| `2025-06-18` | Top-level tool `outputSchema` and `structuredContent` in results. Elicitation. `resource_link` content. `MCP-Protocol-Version` HTTP header. Servers are OAuth resource servers (RFC 9728 protected resource metadata, RFC 8707 audience binding). JSON-RPC batching removed. `_meta` key rules. |
| `2025-11-25` | Icons, `title`, tool-name guidance (ASCII letters, digits, `_`, `-`, `.`; 1–128 chars). URL-mode elicitation, enum schema rework. Client ID Metadata Documents (CIMD) as the recommended client registration. OpenID Connect discovery. Experimental tasks. JSON Schema 2020-12 as the default dialect. Input validation errors are tool errors, not protocol errors (SEP-1303, which AFD already does). |
| `2026-07-28` | See below. |

### 1.1 The 2026-07-28 revision

| Change | SEP | Rule |
|---|---|---|
| Stateless core | 2575 | No `initialize`/`notifications/initialized`. Every request carries `_meta['io.modelcontextprotocol/protocolVersion']` and `_meta['io.modelcontextprotocol/clientCapabilities']` (both required), and SHOULD carry `clientInfo`. A request missing a required field is `-32602` (HTTP 400). Servers SHOULD put `io.modelcontextprotocol/serverInfo` in every result's `_meta`. Version mismatch is `UnsupportedProtocolVersionError` `-32022` with `data.supported`, and the client retries with a supported version. |
| No sessions | 2567 | `Mcp-Session-Id` removed. `tools/list`, `prompts/list`, `resources/list` MUST NOT vary per connection or as a side effect of other requests (they MAY vary by the authorization on the request). Cross-call state uses explicit, server-minted handles passed as ordinary tool arguments. |
| `server/discover` | 2575 | Servers MUST implement it. Returns `supportedVersions`, `capabilities`, optional `instructions`, `_meta.serverInfo`, `ttlMs`, `cacheScope`. Optional for clients on HTTP; the stdio backward-compatibility probe. |
| `resultType` | 2322 | Required on every result: `"complete"` or `"input_required"`. Clients treat an absent `resultType` from older servers as `"complete"`. |
| MRTR | 2322 | Replaces server-initiated `elicitation/create`, `sampling/createMessage`, `roots/list`. Allowed on `tools/call`, `prompts/get`, `resources/read`. The server returns `{ resultType: "input_required", inputRequests: {...}, requestState?: "opaque" }`; the client retries the original request with `inputResponses` and the exact `requestState`, under a new JSON-RPC id. `requestState` is attacker-controlled input: integrity-protect it (HMAC/AEAD) with principal, TTL and a request digest when it affects authorization or logic. A server MUST NOT request an input kind the client did not declare in `clientCapabilities` (`MissingRequiredClientCapability` `-32021`). |
| Streamable HTTP | 2243, 2575 | POST only; GET and DELETE answer 405. Required headers on every POST: `MCP-Protocol-Version` and `Mcp-Method`; `Mcp-Name` (`params.name` or `params.uri`) on `tools/call`, `resources/read`, `prompts/get`. Header/body mismatch or a missing header is HTTP 400 with `HeaderMismatch` `-32020`. Non-ASCII names use the `=?base64?…?=` sentinel. Unknown method is HTTP 404 with `-32601`. The response is a JSON object or a request-scoped SSE stream (progress and log notifications, then the response). Closing the stream cancels the request. No `Last-Event-ID` resumability. `X-Accel-Buffering: no` on SSE. Origin validation is mandatory (403). |
| `x-mcp-header` | 2243 | A tool parameter schema may carry `x-mcp-header: "Name"`; clients MUST mirror the value into `Mcp-Param-Name`, and servers MUST validate it against the body. |
| Subscriptions | 2575 | `subscriptions/listen` (a long-lived POST response stream) replaces the standalone GET stream and `resources/subscribe`. `notifications/tools/list_changed` flows there. |
| Caching | 2549 | `ttlMs` (≥ 0) and `cacheScope` (`public`/`private`) are REQUIRED on complete results of `server/discover`, `tools/list`, `prompts/list`, `resources/list`, `resources/templates/list`, `resources/read`. `tools/list` SHOULD be deterministically ordered. |
| Removed | 2575 | `ping`, `logging/setLevel`, `notifications/roots/list_changed`, `notifications/elicitation/complete`. Log level is per request (`_meta['io.modelcontextprotocol/logLevel']`). |
| Deprecated | 2577, 2596, PR 2858 | Roots, Sampling, Logging; the HTTP+SSE transport; Dynamic Client Registration (CIMD preferred). Minimum 12-month window before removal under the new feature lifecycle policy. |
| Tasks | 2663 | Moved to the `io.modelcontextprotocol/tasks` extension; polling `tasks/get`, new `tasks/update`. |
| Schemas | 2106 | `inputSchema`/`outputSchema` may use any JSON Schema 2020-12 keywords; `structuredContent` may be any JSON value. No automatic network `$ref` dereferencing; bound composition-keyword cost. |
| Error codes | — | `-32000`…`-32019` is grandfathered implementation space (do not allocate new codes there); `-32020`…`-32099` is reserved for the spec. `-32002` must not be emitted. |
| Authorization | 2468, 837, 2352 | RFC 9207 `iss` validation; `application_type` in DCR; credentials keyed by issuer. Servers that protect themselves MUST publish RFC 9728 metadata, MUST bind tokens to their audience (RFC 8707), MUST NOT pass tokens through. Optional overall; not for stdio. |
| Observability | 414 | `traceparent`, `tracestate`, `baggage` are reserved `_meta` keys for W3C trace context. |

### 1.2 Interoperability model

The spec defines three eras. **Modern** (`2026-07-28`+) uses per-request `_meta`. **Legacy** (`2025-11-25` and earlier) uses `initialize`. A **dual-era** server picks its behavior per request: an `initialize` selects legacy semantics for that stdio process or HTTP session; a request carrying modern `_meta` is served statelessly. A dual-era client probes `server/discover` on stdio (falling back to `initialize` on any non-modern error or timeout) and, on HTTP, sends a modern request and falls back only if a 400 does not carry a recognized modern error body.

The important asymmetry: a legacy client against a modern-only server **fails** (its POST lacks the required headers). So AFD's servers must be dual-era for a window, and AFD's clients must be dual-era to keep working against today's servers.

### 1.3 SDK state on 2026-10-25

| SDK | Version | Status |
|---|---|---|
| TypeScript | `@modelcontextprotocol/server` 2.4.0, `client` 2.4.0, `node` 2.1.2, `express`/`hono` 2.0.2, `codemod` 2.4.0, `core` | Stable v2 line implementing `2026-07-28`. Node ≥ 20, ESM-first with a CJS build, Web Standards `Request`/`Response`, Standard Schema inputs (Zod v4 ≥ 4.2; Zod v3 unsupported). `createMcpHandler(factory, { legacy, responseMode })` serves `2026-07-28` and `2025-11-25` from one endpoint (legacy served statelessly by default; `legacy: 'reject'` for a strict lane; `isLegacyRequest()` to route). `serveStdio(factory)` is dual-era stdio. `toNodeHandler` and `NodeStreamableHTTPServerTransport` bridge Node `req`/`res`. The monolithic `@modelcontextprotocol/sdk` (AFD pins `^1.32.1`; latest 1.32.2) is the maintenance lane and never serves `2026-07-28`. |
| Python | `mcp` 2.3.0 (Python ≥ 3.10) | `FastMCP` is `MCPServer` (`from mcp.server import MCPServer`); `mcp.server.fastmcp.*` moved to `mcp.server.mcpserver.*` with the same structure. One `streamable_http_app()` answers both eras; `stateless_http` only affects legacy clients. Transport options moved to `run()`/`streamable_http_app()` (`stateless_http`, `json_response`, `transport_security`, `max_request_body_size`, 4 MiB default). Server-initiated `ctx.elicit()` raises `NoBackChannelError` on modern connections; use `Resolve(Elicit(...))` parameters or return an input-required result. `mcp.Client` with `mode='auto'` probes `server/discover` then falls back. `httpx2`. AFD pins `mcp>=1.19,<2`. |
| Rust | `rmcp` 3.7.0 | Implements `2026-07-28`, serves it statelessly by default, compatible with `2025-11-25` and earlier; `with_legacy_session_mode(false)`, `with_stateless_protocol_metadata_required(true)`; validates the routing headers automatically. |
| C#, Go | 2.0, 1.7 | Not used by AFD. |

## 2. Where AFD stands

| Surface | Today | Protocol |
|---|---|---|
| TypeScript server, HTTP (`packages/server/src/http-handler.ts`) | Hand-rolled HTTP+SSE: `GET /sse` (endpoint event), `POST /message` (`initialize`, `ping`, `tools/list`, `tools/call`). `initialize` always answers `protocolVersion: '2024-11-05'`. Optional `Mcp-Session-Id` sessions exist only when `contexts` are configured (`http-sessions.ts`). AFD-native REST next to it: `POST /rpc`, `POST /batch`, `GET|POST /stream/<command>`, `GET /health`. Host/Origin/body-cap validation in `http-security.ts`. `createMcpHandler(req, res)` embeds in any Node host. Official MCP clients cannot connect to this lane (`packages/client/README.md` says so). | `2024-11-05`, Deprecated transport |
| TypeScript server, stdio (`server.ts`) | `@modelcontextprotocol/sdk` 1.x `Server` with `tools/list` and `tools/call` handlers. The SDK negotiates the version. | Up to what SDK 1.32 negotiates; legacy era |
| TypeScript tool surface (`tools.ts`, `core/src/mcp.ts`) | `name`, `description`, `inputSchema`, AFD `_meta` (`category`, `requires`, `mutation`, `destructive`, `undoable`, `examples`, `outputSchema`, `contexts`, grouped `actions`). No `annotations`, `title`, top-level `outputSchema`, `structuredContent`, `ttlMs`/`cacheScope`, `resultType`. Unknown or private commands return a `COMMAND_NOT_FOUND` tool result with a suggestion (parity D4). | Pre-`2025-03-26` shape |
| TypeScript client (`packages/client`) | `SseTransport` and `HttpTransport` speak only the AFD lane (`/sse` + `/message`), `initialize` with `2024-11-05`, session renewal on 404 (`mcp-session.ts`), `-32001 SESSION_NOT_FOUND` mapping, `stream()` via `/stream/<command>`, `DirectTransport` in process. Not a general MCP client. | `2024-11-05` |
| CLI (`packages/cli`) | `afd connect <url>`: SSE for a `/sse` URL, otherwise the AFD HTTP transport. README quick starts use `/sse` and `claude mcp add --transport sse`. | `2024-11-05` |
| Testing (`packages/testing/src/mcp/server.ts`, `mock-server.ts`; `python/src/afd/testing/mcp/server.py`) | Mock servers answer `initialize` with `2024-11-05`. | Legacy |
| Python server (`python/src/afd/server/factory.py`) | Wraps `mcp.server.fastmcp.FastMCP` (`mcp>=1.19,<2`) for stdio, SSE and Streamable HTTP; subclasses it to bind per-session context state; builds tools with `Tool(... meta=...)`. Over stateless HTTP, `afd-context-enter` returns `SESSION_REQUIRED`. | `2025-xx` via SDK 1.x; the `mcp` 2.x upgrade is blocked by the removed module |
| Python client (`python/src/afd/client.py`, `transports/`) | `SseTransport` on the upstream `mcp` client; `HttpTransport` POSTs JSON-RPC to `/message` with `initialize` `2024-11-05`. | Legacy |
| Rust (`packages/rust/src/mcp.rs`; todo backend `server.rs`) | Library: wire types including `initialize` shapes, `-32002 SERVER_NOT_INITIALIZED`. Todo backend: hand-rolled Streamable HTTP on axum, `POST /mcp` and `/message`, versions `2025-06-18`/`03-26`/`2024-11-05`, no sessions, GET 405. Parity D1 plans a `server` feature. | `2025-06-18` |
| C++ (todo backend `mcp_stdio.cpp`) | Hand-rolled stdio: `initialize` negotiation (`2025-06-18` newest), `ping`, `tools/list`, `tools/call`. Parity D2 and #341 plan `afd::mcp_stdio`. | `2025-06-18` |
| Conformance (`packages/examples/todo/dx/run-conformance.ts`) | SDK 1.x `Client`; stdio for TS, Python and C++; Streamable HTTP for Rust. 34 todo cases, all through a legacy `initialize`. The bounded protocol tier (`spec/protocol-conformance.md`) covers the TS legacy lane and Python SDK clients over SSE and Streamable HTTP. | Legacy only |
| Todo web frontends (`frontends/vanilla/app.js`, `frontends/react/src/api.ts`) | POST JSON-RPC straight to `http://localhost:3100/message`. | Legacy lane |
| Authorization | None at the MCP layer. `createContext(req)` lets a host inject auth into `CommandContext`; `@lushly-dev/afd-auth` is application sign-in (Better Auth, Convex, Mock), not MCP OAuth. No RFC 9728 metadata, no bearer validation, no `WWW-Authenticate`. | — |

## 3. Gap analysis

Legend: **Yes** done, **Part** partial, **No** missing, **Redesign** conflicts with the spec, **N/A** by role.

| 2026-07-28 requirement | TS server | TS client | Python server | Python client | Rust | C++ | Testing / CLI |
|---|---|---|---|---|---|---|---|
| Streamable HTTP endpoint (POST-only, JSON or SSE) | No (HTTP+SSE) | No | Yes via SDK 1.x (legacy shape) | Part (SSE via SDK; HTTP is AFD-only) | Part (todo backend) | N/A | No |
| Per-request `_meta` (version, capabilities, clientInfo) in; `serverInfo` out | No | No | No (SDK 1.x) | No | No | No | No |
| `server/discover` | No | No | No (SDK 1.x) | No | No | No | No |
| `resultType` on results; absent treated as complete | No | No | No | No | No | No | No |
| `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name` validation and emission | No | No | No (SDK 1.x) | No | No | N/A | No |
| `UnsupportedProtocolVersion` (-32022) / `HeaderMismatch` (-32020) / `MissingRequiredClientCapability` (-32021) | No | No | No | No | No | No | No |
| Dual-era: serve `initialize` clients during the window | Part (legacy only) | Part (legacy only) | Yes (SDK 1.x only) | Legacy only | Legacy only | Legacy only | Legacy only |
| No `Mcp-Session-Id`; `tools/list` must not vary per connection | **Redesign** (contexts) | Redesign (renewal logic) | **Redesign** (session-bound contexts) | — | Yes | Yes (stdio single stack) | — |
| `ttlMs`/`cacheScope`, deterministic `tools/list` | No / order is registration order | No (`refreshTools` has no TTL) | No | No | No | No | No |
| Tool `annotations` from `mutation`/`destructive`/`undoable` | No | — | No | — | No | No | — |
| Top-level `outputSchema` + `structuredContent` | No (`_meta.outputSchema`) | Part (reads text) | No | Part | No | No | — |
| `title`, `icons` | No | — | No | — | No | No | — |
| MRTR: `input_required` for `confirmPrompt`/destructive commands; client handles `inputResponses` | No | No | No | No | No | No | No |
| Progress notifications on the `tools/call` response stream | No (`/stream` is AFD SSE, runs to completion) | — | No | — | No | N/A | — |
| `traceparent` → `traceId` | No | No | No | No | No | No | — |
| Remove `ping`, `-32002`, `-32001`; respect the error-code policy | Part (`ping` answered; `-32001` in use) | Part | Part | Part | Part (`-32002` constant) | Part (`ping`) | Part |
| MCP authorization (RFC 9728, bearer validation, 401/403) | No | No | No | No | No | N/A | — |
| Conformance in both eras | No | — | — | — | — | — | No |

## 4. Decisions

All nine were accepted as recommended on 2026-10-25. The recommended option in each table is marked **Rec.**

### D1. How the TypeScript server implements the modern lane

| Option | For | Against |
|---|---|---|
| **A. Official SDK v2** (`@modelcontextprotocol/server` + `@modelcontextprotocol/node`): `createMcpHandler(factory)` mounted at `/mcp` inside AFD's existing `createHttpHandler`, `serveStdio(factory)` for stdio. **Rec.** | Dual-era, header validation, `server/discover`, `resultType`, MRTR plumbing, `subscriptions/listen`, cancellation and future revisions come from the SDK. AFD already depends on the SDK for stdio. Zod ^4.5.4 satisfies Standard Schema. Node ≥ 22.12 satisfies Node ≥ 20. The quality review already asked for "Streamable HTTP via the SDK". | A second dependency line beside `@modelcontextprotocol/sdk` 1.x until the legacy lane is removed. The factory runs per request; registering a 1000-command surface per request needs the low-level `Server` with `setRequestHandler('tools/list' | 'tools/call')` over AFD's cached tool list rather than `registerTool` per command. |
| B. Hand-roll `2026-07-28` in `http-handler.ts` as today. | No new dependency; full control of body caps and error text. | AFD then owns header validation, base64 sentinels, era detection, MRTR envelopes and every future revision. The current hand-rolled lane is why no official client can connect today. |

Either way, AFD keeps its own `validateHttpRequest` (Host, Origin, body cap, `allowedHosts`/`allowedOrigins`) in front of the SDK handler, and `createContext(req)` keeps feeding `CommandContext` (the SDK exposes the request as `requestInfo` and bearer results as `authInfo` on `ctx.http`).

### D2. Contexts without sessions

Today `afd-context-enter` mutates a per-session stack, and `tools/list` and execution are filtered by it. The spec now forbids list results that vary per connection or as a side effect of other requests, and its own guidance for cross-call state is "an explicit handle the model passes back".

| Option | Description | Verdict |
|---|---|---|
| **A. Explicit per-request context. Rec.** | The context name is the handle. `tools/list` and `tools/call` honor `_meta['dev.afd/context']` (a vendor-prefixed `_meta` key, allowed by the key rules), and `afd-call`, `afd-batch`, `afd-pipe`, `afd-discover` and `afd-detail` accept an optional `context` argument. `afd-context-enter` becomes a pure function: validate the name, return `{ context, tools, instructions }` without storing anything. `afd-context-exit` is removed from the modern lane (or returns the universal list). No stack, no depth cap, no `SESSION_REQUIRED`. Cache keys include params, so a context-scoped `tools/list` is still cacheable. | Spec-aligned, works on any instance, no shared store. Limit: mainstream hosts do not forward custom `_meta` on `tools/list`, so for them contexts shape discovery (`afd-discover`) and `afd-call` execution rather than the host's tool palette. |
| B. Server-minted context tokens with a store | `afd-context-enter` returns `ctx_…`, kept server-side with a TTL. | Reintroduces cross-instance state and stickiness, which is what the revision removes. Rejected. |
| C. Fold contexts into the lazy strategy | Contexts become a discovery dimension only (`afd-discover { context }`); no execution gating. | Simplest, but drops the "focus" property the feature was built for. Take its discovery additions into A. |
| D. Authorization-derived scoping | Deployments that need hard scoping derive the context from the request's auth (`createContext` → scopes). The spec explicitly allows `tools/list` to vary by authorization. | Compatible with A; document it as the hard-boundary path. Contexts were never a security boundary: the agent controls them. |

The legacy lane keeps the session stack until removal. Python has the same design (`SessionContextState` bound to the FastMCP request context) and takes the same redesign. The spec document for contexts (`docs/features/complete/contextual-tool-loading/`) and `spec/command-metadata.md` are updated in the same change.

### D3. TypeScript client transport

| Option | Verdict |
|---|---|
| **A. New `streamable-http` transport built on `@modelcontextprotocol/client` `StreamableHTTPClientTransport`. Rec.** | Era detection, fallback to `initialize`, header emission, `UnsupportedProtocolVersion` retry and `input_required` plumbing come from the SDK, and `McpClient` becomes a general MCP client (the README's current disclaimer goes away). `McpClient` keeps AFD semantics on top: `call()` returns `CommandResult`, `batch()`, `pipe()`, `stream()`, `handoff`, reconnect, `direct`. |
| B. Hand-roll the modern POST | Small for the modern-only path (headers plus `_meta`), but AFD then owns fallback and MRTR. |

Default transport for a URL without a trailing `/sse` becomes `streamable-http`. `sse` and `http` (the AFD lane) stay available and deprecated until the next major. `stream()` keeps `POST /stream/<command>` (AFD REST, outside MCP).

### D4. Python: move to `mcp>=2`

Required: `mcp.server.fastmcp` no longer exists in 2.x. Rename imports to `mcp.server.mcpserver.*` (same structure), replace the `SessionFastMCP` subclass with `MCPServer`, move `stateless_http`/`json_response`/`transport_security`/`max_request_body_size` to `run()`/`streamable_http_app()`, keep `Tool(... meta=...)` (verify in the spike), and apply D2. The `FastMCPTransport` wrapper and the `server.mcp` property that expose the FastMCP instance are breaking for anyone who touched them, so this lands in Python 0.10 together with parity D5 (see the [versioning plan](../../active/versioning/versioning.plan.md)). Replace the AFD `HttpTransport` client with `mcp.Client` (`mode='auto'`) behind the AFD transport API; keep `SseTransport` deprecated. Add Host/Origin validation through `transport_security` (parity Wave 3 item).

### D5. Rust server feature (parity D1) and the todo backend

| Option | Verdict |
|---|---|
| **A. Build the `server` feature on `rmcp` 3.7. Rec. Confirmed by the Phase 0 spike, with an MSRV cost (see findings)** | `2026-07-28` with stateless default, legacy compatibility, header validation and MRTR for free. Cost: a large optional dependency behind the feature flag, and rmcp's tool model has to carry AFD `_meta`. |
| B. Hand-roll the stateless lane | Small (POST, headers, `_meta`, `server/discover`, two methods) and the todo backend is already most of the way there, but no legacy lane, no MRTR, and AFD owns future revisions. |

Either way the todo backend moves onto the library (as D1 already says) and gains `server/discover`, `_meta` handling and the headers.

### D6. `structuredContent` and `outputSchema` shape

| Option | Verdict |
|---|---|
| **A. `structuredContent` is the whole `CommandResult`; top-level `outputSchema` is the `CommandResult` envelope with `data` typed by the command's `output` schema. Rec.** | `success`, `error` and `metadata` stay typed; `content[0].text` keeps the same JSON (the spec says structured results SHOULD also appear as text), so every current AFD client keeps working. `_meta.outputSchema` (the `data`-level schema) stays for one major for `afd-detail` consumers. |
| B. `structuredContent` is `data` only | Loses the envelope the AFD contract is built on. Rejected. |

### D7. Unknown tool: tool error or protocol error

The spec lists "unknown tool" under protocol errors (`-32602`) and says clients MAY show those to models, but SHOULD show tool execution errors. AFD returns `COMMAND_NOT_FOUND` as a tool result with a suggestion so the agent can self-correct and private commands stay indistinguishable from missing ones (parity D4). **Rec.: keep the AFD behavior** and record the deliberate deviation in `spec/error-codes.md` and the protocol tier.

### D8. Versioning, deprecation window and the contract

- npm (`@lushly-dev/*`, fixed versioning): the modern lane, the new client transport and the tool-surface additions are additive and ship in **2.x**. The removals (`GET /sse`, JSON-RPC on `/message`, `Mcp-Session-Id`, `SseTransport`/`HttpTransport`, the `@modelcontextprotocol/sdk` 1.x dependency, `-32001`) ship in **3.0**, in line with parity D7's "legacy routes stay for one major version". MCP's own policy gives HTTP+SSE at least 12 months from 2026-07-28; AFD need not wait that long for its own lane, but the CHANGELOG should state the window.
- Python: **0.10** (`mcp>=2`, D2, parity D5 defaults).
- Rust and C++: the server feature and stdio target are new surfaces; their first release carries `2026-07-28` and legacy `initialize`.
- Contract (`spec/VERSION`): the wire fixtures do not change (results are unchanged inside `content`/`structuredContent`), so the contract stays `1.0-rc` on its current path. Protocol envelopes are a layer-3 surface and are tracked by the protocol conformance tier, not the contract version. **Rec.: do not couple them**; revisit if `structuredContent` ever becomes the only carrier.

### D9. Where the browser frontends go

The todo frontends POST JSON-RPC to `/message`. **Rec.: move them to AFD's REST routes** (`POST /rpc`, `POST /batch`) rather than teaching browsers the MCP header set; `/rpc` and `/batch` are AFD-native and unaffected by this proposal. Document `/mcp` as the agent endpoint and `/rpc`, `/batch`, `/stream` as the application endpoints.

## 5. Phases

Sizes follow the parity plan: **S** under a day, **M** a few days, **L** a week or more.

### Phase 0: spike and decisions (S–M)

- Branch spike: `@modelcontextprotocol/server` 2.4 + `node` mounted inside `createHttpHandler`; confirm `createContext`, `allowedHosts`/`allowedOrigins`, `maxBodyBytes` and `onError` still apply; measure the per-request factory cost for a 500-command surface and pick `McpServer.registerTool` vs the low-level `Server` handlers.
- Python spike: `mcp==2.3.*` import rename, `Tool(meta=)`, one endpoint answering both eras, `Resolve(Elicit(...))` for `confirmPrompt`.
- Rust spike: rmcp 3.7 carrying AFD `_meta` on tools, stateless default, legacy mode off.
- Update `dx/run-conformance.ts` to the v2 client and run the 34 cases against every backend in both modes (`mode: legacy` and modern). This becomes the gate for every later phase.
- D1–D9 decided 2026-10-25. Exit: spike findings recorded in [Phase 0 findings](#phase-0-findings); spike code discarded.

### Phase 1: TypeScript server (L)

**Status (2026-10-25): merged in #391.** The TypeScript backend passes 34/34 in `legacy`, `auto` (now negotiating `2026-07-28`) and `modern`, and `conformance.yml` runs the `modern` mode. Deviations from the bullets below:

- Tool order stays registration order. It is already deterministic, which is what the spec asks for, and sorting would reorder the legacy lane too.
- `tools/list` defaults to `ttlMs: 0` when `contexts` are configured. The SDK v2 client caches `tools/list` without its `_meta`, so a longer TTL served a context-scoped list from the unscoped entry.
- The optional `context` argument on `afd-call`, `afd-batch`, `afd-pipe`, `afd-discover` and `afd-detail` (D2) moves to Phase 5; `_meta["dev.afd/context"]` covers every tool call in the meantime.
- Errors the SDK answers on the wire (bad headers, unsupported versions) are not forwarded to `onError`.

- Mount pattern proven in Phase 0: AFD's `validateHttpRequest` in front, `toNodeHandler(createMcpHandler(factory))` on `/mcp`, the low-level `Server` over AFD's cached tool list, `createContext(req)` carried to the handler through `AsyncLocalStorage`, `cacheHints` for `tools/list` and `server/discover`.

- `POST /mcp` via `createMcpHandler` (dual-era by default) with `server/discover` (`supportedVersions: ['2026-07-28']`: the TypeScript SDK lists only per-request revisions there, and 2025 clients reach the same endpoint through `initialize`; `instructions` carrying AFD's bootstrap primer: how to use `afd-discover`, `afd-detail`, `afd-call`, `afd-batch`, `afd-pipe`), `serverInfo` in result `_meta`, `resultType`, `ttlMs`/`cacheScope` on `tools/list` (long TTL and `public` for a static command set; `private` when the list varies by auth or context), tools sorted by name.
- stdio via `serveStdio(factory)` (dual-era; the SDK 1.x `Server` goes).
- D2 for the modern lane; the legacy `/sse` + `/message` lane keeps sessions unchanged and gains deprecation notices (README, `console.error` once at start, CHANGELOG).
- `traceparent` in `_meta` → `traceId` (and the tracing middleware's parent span).
- Drop `ping` from the modern lane (the SDK handles era rules); keep it on the legacy lane.
- Exit: official v2 client, SDK 1.x client (legacy), and today's AFD client all pass the todo suite against the TypeScript backend over HTTP and stdio; the protocol tier asserts `server/discover`, missing-`_meta` → `-32602`/400, header mismatch → `-32020`/400, unsupported version → `-32022`.

### Phase 2: TypeScript client, CLI and testing (L)

**Status (2026-10-25): implemented on `claude/mcp-v2-phase2-ts-client`.** `McpClient` passes call, batch, pipe and stream against AFD's `/mcp` in `auto`, `modern` and `legacy` modes, and connects to official SDK servers of both eras. Deviations from the bullets below:

- `input_required` is not surfaced yet. AFD servers emit none until D10 is decided, so the transport declares no elicitation capability and the SDK never receives an `input_required` result from them.
- `refreshTools` is not TTL-aware on its own; the SDK client inside the transport already honours `ttlMs` for `tools/list`.
- The CLI infers the transport from every URL (`sse`, `http` for `/message`, `streamable-http` otherwise), not only for non-`/sse` URLs, because `call --connect` and `scenario run` previously hard-defaulted to `http` and `sse`.

- `streamable-http` transport on `@modelcontextprotocol/client` (D3); default for non-`/sse` URLs; `initialize` fallback preserved for legacy servers; `resultType` handling; `UnsupportedProtocolVersion` retry; `ttlMs`-aware `refreshTools`.
- `input_required` surfaced to callers: as a `CommandResult` failure with a new `INPUT_REQUIRED` code carrying `inputRequests` when no handler is registered, and as an elicitation handler hook when one is (used by the CLI for confirmations).
- `-32001`, session renewal and `SessionStore` remain legacy-only, behind the deprecated transports.
- CLI: `afd connect http://host:3100/mcp` is the documented form; README and skills switch `claude mcp add --transport sse` to `--transport http … /mcp`.
- `packages/testing` MCP server and `MockServer`: dual-era (`server/discover` + `initialize`), `resultType`, new error codes.
- Exit: `afd` CLI and scenario runner work against the TypeScript `/mcp`, the Python `streamable_http_app()` and the Rust backend (parity D6 over HTTP).

### Phase 3: Python (L)

**Status (2026-10-25): implemented on `claude/mcp-v2-phase3-python`.** The Python todo backend passes 34/34 in `legacy`, `auto` (negotiating `2026-07-28`) and `modern`, and `conformance.yml` runs the `modern` mode. Deviations and findings:

- Request context reaches `list_tools`/`call_tool` through the SDK's public `middleware` hook, not the private handlers.
- **`ctx.session` is a new object per request in mcp 2.x.** 2025-era context stacks are keyed by the session's connection (`session._connection`, no public accessor); the live session-isolation tests guard it.
- The SDK's `ClientSession` no longer has `_receive_loop`; `SseTransport` notices a dropped stream by wrapping its read stream, and enforces its own call deadline because the SDK's timeout waits behind a POST that never completes.
- `mcp.Client` in pinned-version mode skips `server/discover`, so `protocol_mode="modern"` negotiates like `auto` and then insists on 2026-07-28.
- Confirmations (`Resolve(Elicit(...))`) wait for D10.

- `mcp>=2,<3`; `MCPServer`; options moved to `run()`; D2 applied to `SessionContextState` (modern lane stateless, legacy sessions kept until removal); `transport_security` Host/Origin (parity Wave 3); body cap mapped from `max_request_body_size`.
- `confirmPrompt` confirmations per D10, once decided.
- D2 lands in the same change as `mcp>=2`: removing the session binding without it leaks one client's context to the next (see findings).
- Client: `mcp.Client` (`mode='auto'`) behind `afd.client.McpClient`; `HttpTransport` retired to the legacy lane; `afd.testing.mcp.server` dual-era.
- `test_mcp_protocol_live.py` parameterized over eras; `MCP_PROTOCOL_VERSION` constants replaced by a supported-versions list.
- Exit: Python 0.10 release notes; protocol tier green in both eras.

### Phase 4: Rust and C++ (M–L, folds into parity D1 and D2)

**Status (2026-10-25): implemented on `claude/mcp-v2-phase4-rust-cpp`.** The Rust and C++ todo backends pass 34/34 in `legacy`, `auto` (negotiating `2026-07-28`) and `modern`, and `conformance.yml` runs the `modern` mode for both. Deviations:

- **Rust MSRV (open question 8):** the `server` feature documents its own minimum, Rust 1.88 (`rmcp`'s), and is off by default, so the crate keeps 1.82 for everything else; `rust.yml` adds clippy and tests with `--features server`. Raising the whole crate to 1.88 remains a one-line change if preferred.
- The Rust `server` feature covers the individual tool strategy, exposure and `COMMAND_NOT_FOUND`; grouped and lazy strategies, meta-tools, bootstrap and contexts stay in parity D1. `rmcp` answers malformed bodies, unknown methods and a nameless `tools/call` itself; the backend tests pin those outcomes.
- **C++:** the todo backend's `mcp_stdio.cpp` is dual-era (`server/discover`, per-request `_meta` with `-32022`/`-32602`, `resultType`, `ping` legacy-only). Promoting it to the `afd::mcp_stdio` library target stays with #341 (parity D2), together with `command_to_mcp_tool` and its `_meta`.

- Rust `server` feature (D5): `server/discover`, `_meta`, headers, `resultType`, cache hints, legacy `initialize`; the todo backend moves onto it; the `-32002` constant and `initialize` types are kept for the legacy lane and marked deprecated.
- C++ `afd::mcp_stdio` (#341): dual-era stdio is small since stdio has no header layer: `server/discover`, per-request `_meta` check, `resultType`, `initialize` for legacy clients, `notifications/cancelled` → `CancellationToken`. The version table test in `mcp_stdio_test.cpp` changes accordingly.
- Exit: both backends pass the conformance suite in both eras; `docs/language-parity.md` "MCP server" rows updated.

### Phase 5: tool surface modernization (M, all languages, spec first)

**Status (2026-10-25): merged in #395 (`d225fee`).** `spec/command-metadata.md` gains "MCP tool fields" (annotations, structured results) with a per-language status table. TypeScript emits annotations, the CommandResult `outputSchema` (new `advertiseOutputSchema` option) and `structuredContent`; the v2 client validates them in tests and the todo conformance passes in all modes. Python and Rust emit annotations for `mutation: true` (their `mutation` has no unset state); core TypeScript and Rust gain the `-32020`–`-32022` codes and deprecate `-32002`. C++ (todo backend) emits annotations from `mutation` and `destructive`. Python and Rust export `command_tool_annotations` and `command_result_output_schema`; the alfred C++ name budget rose from 73 to 75 for them, inside the deferred MCP-helper group. Deferred: `structuredContent`/`outputSchema` in Python, Rust and C++, the optional `title` field (needs a new command field in four languages), the `context` argument on meta-tools, and `x-mcp-header` on `afd-call` (MCP clients must then mirror it, so it needs its own compatibility check).

- `annotations`: `mutation: false` → `readOnlyHint: true`; `destructive` → `destructiveHint`; `idempotentHint` from a new optional `idempotent` field or `undoable` (decide in `spec/command-metadata.md`); never guess `openWorldHint`.
- Top-level `outputSchema` and `structuredContent` per D6; `title` from a new optional `title` field.
- `x-mcp-header: "Afd-Command"` on `afd-call.command` so gateways can route and rate-limit by command (`Mcp-Param-Afd-Command`); optional, documented.
- Core `McpErrorCodes`: add `-32020`…`-32022`, deprecate `-32002` and `-32001`.
- Exit: `spec/command-metadata.md` describes the mapping; `spec/wire` gains a `tools/list` entry fixture (new file, additive) that all four languages round-trip.

### Phase 6: conformance and documentation (M)

**Status (2026-10-25): implemented; lands with the Phase 6 docs PR.** `spec/protocol-conformance.md` is the era matrix (four backends × `legacy`/`auto`/`modern`, plus an acceptance index per criterion and language); `docs/language-parity.md` has MCP rows per era; the `afd`, `afd-developer`, `afd-python` and `afd-rust` skills and the todo README use `/mcp`; the [migration note](./migration.md) covers what changes per language. The package READMEs were updated in Phases 1–4.

- `spec/protocol-conformance.md` rewritten as the era matrix: 4 backends × {legacy, modern} × {stdio or HTTP}, with the discover/`_meta`/header/error criteria added to the acceptance index.
- `docs/language-parity.md`: transport rows per era; `docs/features/README.md` index row; `packages/*/README.md`, `python/README.md`, the `afd-*` skills, `SETUP.md` and the todo README move every `/sse` example to `/mcp`.
- A migration note for AFD users: server options unchanged; URLs change; `contexts` semantics change; `SessionStore` options deprecated.

### Phase 7: optional follow-ons (each its own proposal)

**Status (2026-10-25): each follow-on has its own proposal, ranked by value.** Value weighs user impact against SDK readiness, effort and dependencies.

| Rank | Proposal | Value | Readiness | Effort | Recommendation |
|---|---|---|---|---|---|
| 1 | [Confirmations and input requests](../../proposed/mcp-confirmations/mcp-confirmations.proposal.md) | High: `destructive` and `confirmPrompt` are advertised but ignored | High: MRTR and signed `requestState` in all three SDKs | M | Start next; resolves D10 |
| 2 | [Authorization](../../proposed/mcp-authorization/mcp-authorization.proposal.md) | High for hosted servers, low for stdio | Mixed: TypeScript complete, Python with gaps, Rust none | M + M | Do the spec phase now; build when a hosted deployment is planned |
| 3 | [Progress](../../proposed/mcp-progress/mcp-progress.proposal.md) | Medium: few AFD commands run long | High on MCP; AFD core has no progress hook | M | After confirmations |
| 4 | [Tasks](../../proposed/mcp-tasks/mcp-tasks.proposal.md) | Low to medium today | Low: only rmcp has a runtime | L | Wait; Rust pilot first |

The authorization proposal keeps `context.auth` for `@lushly-dev/afd-auth`, so verified MCP claims go to a new `context.credentials`. Elicitation-driven undo is phase 4 of the confirmations proposal.

### Phase 8: legacy removal (next major)

Remove `GET /sse`, JSON-RPC on `/message`, `Mcp-Session-Id`, `SessionStore`, `maxSessions`/`sessionIdleTimeoutMs`, `SseTransport`/`HttpTransport`, `@modelcontextprotocol/sdk` 1.x, `-32001`, the Python `SseTransport` and `HttpTransport`, and the legacy branches in the mock servers. Keep `initialize` support in the SDK-provided dual-era lanes as long as the SDKs do.

### Dependencies

```
Phase 0 (spike, decisions, dual-era runner) ──► everything
D2 decision ──► Phase 1 (TS contexts) and Phase 3 (Python contexts)
Phase 1 ──► Phase 2 (client needs a modern AFD server; Python SDK v2 can stand in)
Phase 2 ──► parity D6 over HTTP (CLI against Python and Rust HTTP servers)
Phase 4 ──► parity D1/D2 exit criteria, #341
Phase 5 spec first ──► per-language ports
Phases 1–5 ──► Phase 6 ──► Phase 8 (after the window)
```

## Phase 0 findings

Run on 2026-10-25 against `@modelcontextprotocol/server` 2.4.0, `client` 2.4.0, `node` 2.1.2, `sdk` 1.32.2, Python `mcp` 2.3.0 and `rmcp` 3.7.0. Spike code lived in the session scratchpad and was not committed. The one kept change is the conformance runner (below).

### TypeScript (D1 confirmed)

A Node server mounted AFD's real execution engine, tool router and tool list inside `createMcpHandler` on `/mcp`, with AFD's legacy lane (`/sse`, `/message`, `/rpc`) on the same port. 31 of 31 probe checks passed:

- **Wire rules come from the SDK.** `server/discover`, `resultType`, `serverInfo` in result `_meta`, header/body mismatch (400, `-32020`), missing `Mcp-Name` (400, `-32020`), unsupported version (400, `-32022` with `data.supported`), missing `clientCapabilities` (400, `-32602`), unknown method (404, `-32601`), `GET` (405) and no modern `ping`.
- **AFD keeps its own edge.** `validateHttpRequest` in front of the SDK rejects a foreign `Host` and `Origin` with 403. The SDK handler does no Host or Origin validation of its own.
- **`createContext(req)` survives.** The factory only receives a web `Request`, so the Node request reaches tool handlers through `AsyncLocalStorage`.
- **Cache hints are one option.** `cacheHints` on the `Server` fills `ttlMs` and `cacheScope`; without it the SDK emits `ttlMs: 0` and `private`. AFD sorts the tool list itself.
- **D2 works statelessly.** `_meta["dev.afd/context"]` on `tools/list` scoped the list per request, with no session.
- **D7 holds.** A private command through `afd-call` still returns `COMMAND_NOT_FOUND` as a tool result.
- **Every client era works on one endpoint.** The v2 client with `mode: 'auto'` negotiated `2026-07-28`; the v2 client in its default mode and the 1.32 client used `initialize` and were served statelessly; AFD's 2.x client kept working on the legacy lane.
- **The v2 client defaults to `mode: 'legacy'`.** AFD's client (Phase 2) must opt into `'auto'` explicitly, or it never speaks `2026-07-28`.
- **The low-level `Server` class is tagged `@deprecated`** in the v2 typings ("only for advanced use cases") but is supported and is what a per-request factory over a large surface needs. Track it as an upstream risk.
- **stdio is dual-era.** `serveStdio(factory)` served the v2 client in both modes and the 1.32 client.

Per-request cost, 505 commands, mean over 400 sequential requests on loopback:

| Request | Grouped | Individual |
|---|---|---|
| `/mcp` `tools/list` (cached list) | 1.07 ms | 0.44 ms |
| `/mcp` `tools/call` through `afd-call` | 0.23 ms | 0.19 ms |
| `/mcp` 2025-era `tools/call`, no `initialize` | 0.33 ms | 0.18 ms |
| Today's `/message` `tools/list` | 1.64 ms | 1.40 ms |
| Today's `/message` `tools/call` | 0.12 ms | 0.16 ms |

The per-request factory adds about 0.1 ms to a call. `tools/list` is faster than today's lane only because the spike caches the list; today's lane rebuilds it on every request. Building an `McpServer` with 505 `registerTool` calls costs 0.57 ms per request, so the low-level `Server` stays the right choice but `registerTool` would also be viable. The grouped `tools/list` for this surface is 226 KiB against 98 KiB individual, which is worth its own look outside this proposal.

### Confirmations and MRTR (new decision D10)

- **AFD does not enforce `confirmPrompt` today.** `spec/command-metadata.md` says AFD carries it and does not act on it, so server-side confirmation is new behavior, not a port. Phase 3's earlier wording ("today's behavior") was wrong.
- **Modern requests can confirm.** `inputRequired.elicit(...)` and `acceptedContent(...)` drove a full `input_required` round trip through the v2 client's elicitation handler.
- **Stateless legacy HTTP cannot.** The SDK's legacy shim fulfils `input_required` returns with real server-to-client requests, but the per-request legacy lane on `/mcp` has no back channel and answers "per-request legacy serving cannot receive server-to-client requests". On stdio, where a 2025 connection is pinned, the shim worked for the v2 and 1.32 clients.
- **Capabilities gate it.** A modern request that does not declare `elicitation` must not receive an elicitation request (the SDK answers `-32021`). The handler has to check `ctx.mcpReq.envelope` and fall back.

**D10 (new): should AFD servers enforce `confirmPrompt`?** Recommendation: yes, as an opt-in server option. When a command declares `confirmPrompt` and the call has no `confirm: true`, elicit through `input_required` if the request can carry it; otherwise return a tool error with a new `CONFIRMATION_REQUIRED` code whose suggestion says to retry with `confirm: true`. This needs a `spec/command-metadata.md` change and an error-code catalog entry before any language implements it. Until it is decided, Phase 1 and Phase 3 ship without enforcement, matching today.

### Python (D4 confirmed, with an ordering constraint)

A scratch copy of `python/src/afd` ran on `mcp` 2.3.0 with these changes only:

- `mcp.server.fastmcp` renamed to `mcp.server.mcpserver`, and `FastMCP` to `MCPServer`. `Tool(meta=...)`, `FuncMetadata` and `ArgModelBase` work unchanged.
- The `SessionFastMCP` overrides rewritten: `get_context()` and `settings` no longer exist, `list_tools()` takes no context, and `call_tool()` gains a `context` parameter.

One `streamable_http_app(stateless_http=True)` then served the Python v2 `Client` in `mode='auto'` (`2026-07-28`) and `mode='legacy'` (`2025-11-25`): list, call and the private-command rule all passed. Findings:

- **D2 must land with the SDK bump.** With the session binding removed, `afd-context-enter` wrote to the shared default stack, and a second client saw the first client's context (`previous: "document"`). Today's code avoids this by returning `SESSION_REQUIRED` on stateless HTTP. Shipping `mcp>=2` without D2 would be a cross-client leak.
- **Cache hints default to `ttlMs: 0`, `private`.** Pass `cache_hints` to `MCPServer`.
- **Tool order is registration order.** Sort it, as TypeScript will.
- **`GET` with `stateless_http=True` opens a 2025-style SSE stream (200)** rather than answering 405. That is the SDK's legacy behavior and allowed for a dual-era endpoint; it is not an AFD bug.
- **Default `transport_security` already rejects a foreign `Origin` (403),** which covers part of parity Wave 3's HTTP hardening item.
- **Grouped tools carry no `_meta.actions`.** That is the existing parity D5 gap, not a regression.

### Rust (D5 confirmed, with an MSRV cost)

A scratch crate served the `afd` crate's `CommandRegistry` through `rmcp` 3.7.0 Streamable HTTP with `legacy_session_mode(false)`. The TypeScript v2 client (both modes) and the 1.32 client worked; `server/discover`, header validation (400, `-32020`), missing capabilities (400, `-32602`) and `GET` (405) came from `rmcp`. Findings:

- **`rmcp` 3.7 requires Rust 1.88; the `afd` crate's MSRV is 1.82.** The `server` feature raises the MSRV for anyone who enables it. Decide in Phase 4 whether to raise the crate MSRV or document a feature MSRV and keep the 1.82 check feature-less.
- **Origin validation is off by default in `rmcp`.** Call `enforce_origin_validation()` or set `allowed_origins`; with it, a foreign `Origin` got 403.
- **Build results with `rmcp`'s constructors.** A `CallToolResult` deserialized from JSON lacks `resultType`, and the TypeScript v2 client rejects it.
- **`rmcp`'s `server/discover` lists all five revisions** (`2024-11-05` through `2026-07-28`); the TypeScript SDK lists only `2026-07-28`. Both are valid. The protocol tier must not assert one list.
- **`command_to_mcp_tool` emits no `_meta`,** so AFD metadata cannot reach the wire from Rust yet. That is an existing parity item and it blocks Phase 4's metadata parity.
- **Remote calls to private commands return `COMMAND_NOT_EXPOSED`** from the registry; the server feature must map them to `COMMAND_NOT_FOUND` per parity D4.

### Conformance runner (kept in the repository)

`packages/examples/todo/dx/run-conformance.ts` now uses `@modelcontextprotocol/client` 2.4 and takes `--mode legacy|auto|modern` (default `legacy`, so CI runs unchanged). The todo example's devDependency moved from `@modelcontextprotocol/sdk` to `@modelcontextprotocol/client`. Baseline:

| Backend | `legacy` | `auto` | `modern` |
|---|---|---|---|
| TypeScript (stdio) | 34/34, `2025-11-25` | 34/34, fell back to `2025-11-25` | Fails: no `2026-07-28` offered |
| Python (stdio) | 34/34, `2025-11-25` | 34/34, fell back to `2025-11-25` | Fails: no `2026-07-28` offered |
| Rust (HTTP) | 34/34, `2025-06-18` | 34/34, fell back to `2025-06-18` | Fails: no `2026-07-28` offered |
| C++ (stdio) | 34/34, `2025-06-18` | 34/34, fell back to `2025-06-18` | Fails: no `2026-07-28` offered |

The `modern` column is each later phase's exit gate. Add the `--mode modern` run to `conformance.yml` per backend as that backend's phase lands.

## 6. Compatibility during the window

| Client → Server | TS `/mcp` (2.x) | TS `/sse`+`/message` (2.x) | Python `streamable_http_app()` (0.10) | Rust `server` | C++ `mcp_stdio` |
|---|---|---|---|---|---|
| Official v2 clients (Claude Code `--transport http`, Cursor, …) | Works | Fails (today's state) | Works | Works | Works (stdio) |
| Official SDK 1.x clients (`initialize`) | Works, statelessly | Fails (today's state) | Works | Works | Works |
| AFD TS client 2.x `streamable-http` | Works | — | Works | Works | — |
| AFD TS client ≤ 2.1 (`sse`/`http`) | — | Works | — | — | — |
| Todo frontends | — | Works until moved to `/rpc` | — | — | — |

## 7. Risks

- **Contexts are agent-visible.** D2 changes what an agent sees after `afd-context-enter`. Mitigation: the `instructions` field of `server/discover` and `afd-help` explain the explicit `context` argument; the legacy lane is unchanged until removal.
- **Per-request server construction.** The SDK's factory model favors small servers. Mitigation: low-level handlers over AFD's cached tool list; measure in Phase 0.
- **Python `mcp>=2` is breaking for downstream users** pinned to 1.x or touching `server.mcp`. Mitigation: Python 0.10 with release notes; `afd[server]` extra bumps the floor.
- **Two SDK dependency lines in TypeScript** until 3.0. Mitigation: isolate the legacy lane in its own module so removal is a deletion.
- **`Mcp-Name` for grouped and meta-tools** is the group or `afd-call`, not the command. Mitigation: `x-mcp-header: "Afd-Command"` (Phase 5) for gateways that need it.
- **Header validation vs AFD's lenient `/message` parsing.** `/mcp` is strict by spec; `/rpc` stays lenient for applications. Document the split (D9).
- **Error-code policy.** `-32001` and `-32002` are grandfathered but must not spread; new AFD transport errors use codes outside `-32768`…`-32000` or AFD `CommandError` codes.
- **Rust dependency weight.** rmcp behind the `server` feature keeps `wasm` and core builds lean; confirm in Phase 0.

## 8. Out of scope

MCP Apps and Enterprise Managed Authorization extensions; Resources and Prompts (AFD exposes commands as tools only); the deprecated Roots, Sampling and Logging features (AFD never implemented them and should not start); Dynamic Client Registration; the handoff pattern (not MCP).

## 9. Open questions for the maintainer

1. D1: official SDK v2 or hand-rolled for the TypeScript modern lane?
2. D2: explicit per-request contexts (A) with discovery additions (C), or drop execution gating entirely (C)?
3. D5: rmcp or hand-rolled for the Rust `server` feature?
4. D8: is 3.0 acceptable as the removal release, and should the window be time-boxed (for example, no sooner than 2027-01) as well as version-boxed?
5. Phase 7: is MCP authorization wanted in 2.x, or deferred until a hosted AFD deployment needs it? (See decision A1 in the [authorization proposal](../../proposed/mcp-authorization/mcp-authorization.proposal.md).)
6. Should this proposal replace parity Wave 3's D7 row and D1/D2 transport details, or be linked from them?
7. D10 (raised by Phase 0): should AFD servers enforce `confirmPrompt` through `input_required`, with a `CONFIRMATION_REQUIRED` fallback? (Worked out in the [confirmations proposal](../../proposed/mcp-confirmations/mcp-confirmations.proposal.md), decisions C1–C6.)
8. Phase 4: raise the Rust crate MSRV to 1.88, or keep 1.82 for the core and document a higher MSRV for the `server` feature?

## Sources

- [MCP 2026-07-28 key changes](https://modelcontextprotocol.io/specification/2026-07-28/changelog); [versioning and compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/lifecycle); [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http); [stdio](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio); [`server/discover`](https://modelcontextprotocol.io/specification/2026-07-28/server/discover); [MRTR](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr); [base protocol and `_meta`](https://modelcontextprotocol.io/specification/2026-07-28/basic/index); [tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools); [caching](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching); [authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization); [2025-11-25 key changes](https://modelcontextprotocol.io/specification/2025-11-25/changelog)
- [The 2026-07-28 Specification (MCP blog)](https://blog.modelcontextprotocol.io/posts/2026-07-28/); [SDK betas for 2026-07-28](https://blog.modelcontextprotocol.io/posts/sdk-betas-2026-07-28/)
- [Cloudflare: The next generation of MCP](https://blog.cloudflare.com/mcp-v2/); [Cloudflare migration guide](https://developers.cloudflare.com/agents/model-context-protocol/guides/migrate-to-mcp-sdk-v2/); [Solo.io: MCP stateless spec changes](https://www.solo.io/blog/mcp-stateless-spec-changes-the-engineering-details); [Google: scaling with MCP stateless](https://developers.googleblog.com/scaling-ai-agent-infrastructure-with-the-mcp-stateless-updates/); [AAIF migration overview](https://aaif.io/blog/mcp-2026-07-28-whats-changing-and-how-to-migrate)
- TypeScript SDK v2: [upgrade guide](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2), [serving HTTP](https://ts.sdk.modelcontextprotocol.io/v2/serving/http), `@modelcontextprotocol/node` README; Python SDK v2: [what's new](https://py.sdk.modelcontextprotocol.io/whats-new/), [migration guide](https://github.com/modelcontextprotocol/python-sdk/blob/main/docs/migration.md); Rust: [rmcp 3.7.0](https://crates.io/crates/rmcp)
- Registry checks on 2026-10-25: npm `@modelcontextprotocol/server` 2.4.0, `client` 2.4.0, `node` 2.1.2, `sdk` 1.32.2; PyPI `mcp` 2.3.0; crates.io `rmcp` 3.7.0
