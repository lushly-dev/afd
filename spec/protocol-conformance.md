# AFD protocol conformance tier

Status: updated 2026-10-25 for MCP 2026-07-28 (the [upgrade plan](../docs/features/active/mcp-2026-07-28/proposal.md), Phases 1–5); hybrid tool strategy rows added 2026-10-31. This document indexes the protocol-level acceptance criteria AFD exercises over real transports, in both MCP eras. It is not full MCP certification or deployed-service assurance. The 34-case todo conformance suite is the shared executable tier; the per-language protocol tests below each construct their own fixtures.

## Eras

- **Modern:** MCP 2026-07-28. No `initialize`; every request carries `_meta["io.modelcontextprotocol/protocolVersion"]` and `clientCapabilities`; `server/discover`; `resultType` on results; on Streamable HTTP, the `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` headers.
- **Legacy:** MCP 2025-11-25 and earlier, opened with `initialize`.

Every AFD server is dual-era: one stdio connection or one `/mcp` endpoint serves both.

## Shared tier: todo conformance in three negotiation modes

`packages/examples/todo/dx/run-conformance.ts` drives each backend with the official MCP TypeScript SDK v2 client (`@modelcontextprotocol/client`) and checks 34 todo cases plus the `spec/wire` shape of every result. `--mode` selects how the client negotiates:

| `--mode` | Client behaviour |
| --- | --- |
| `legacy` (default) | 2025 `initialize` handshake |
| `auto` | `server/discover` probe; 2026-07-28 when offered, else `initialize` |
| `modern` | 2026-07-28 required; connecting fails otherwise |

| Backend | Transport | `legacy` | `auto` | `modern` | In `conformance.yml` |
| --- | --- | --- | --- | --- | --- |
| TypeScript (`@lushly-dev/afd-server`, SDK v2) | stdio | 34/34 | 34/34, 2026-07-28 | 34/34 | `legacy` and `modern` |
| Python (`afd`, `mcp` 2.x) | stdio | 34/34 | 34/34, 2026-07-28 | 34/34 | `legacy` and `modern` |
| Rust (`afd` `server` feature, `rmcp`) | Streamable HTTP | 34/34 | 34/34, 2026-07-28 | 34/34 | `legacy` and `modern` |
| C++ (todo backend `mcp_stdio.cpp`) | stdio | 34/34 | 34/34, 2026-07-28 | 34/34 | `legacy` and `modern` |

Run one locally, for example:

```sh
pnpm --dir packages/examples/todo test:conformance:ts --mode modern
```

## Acceptance index

Each criterion names the tests that exercise it over a real transport. "Runner" means the shared todo tier above.

| Criterion | TypeScript | Python | Rust | C++ |
| --- | --- | --- | --- | --- |
| Modern requests served without `initialize`; `server/discover` describes the server | `packages/server/src/mcp-modern.test.ts` (HTTP and stdio); runner | `tests/test_mcp_modern_live.py`; runner | `packages/rust/tests/server_http.rs`; todo backend `serves_mcp_2026_07_28_statelessly`; runner | todo backend `mcp_stdio_test.cpp`; runner |
| Legacy `initialize` clients served on the same endpoint or connection | `mcp-modern.test.ts` (v2 client in its default 2025 mode, over HTTP and stdio); runner `legacy` | `tests/test_mcp_protocol_live.py` (SSE and Streamable HTTP sessions); runner `legacy` | `server_http.rs` `legacy_clients_initialize_on_the_same_endpoint`; runner `legacy` | `mcp_stdio_test.cpp`; runner `legacy` |
| Unsupported version → `-32022` with `data.supported`; missing `clientCapabilities` → `-32602` | `mcp-modern.test.ts` | SDK behaviour (`mcp` 2.x) | SDK behaviour (`rmcp`); `server_http.rs` | `mcp_stdio_test.cpp` |
| Header/body mismatch or missing `Mcp-Name` → 400, `-32020` | `mcp-modern.test.ts` | SDK behaviour | `server_http.rs`; todo backend tests | N/A (stdio has no headers) |
| `GET` on the endpoint → 405 | `mcp-modern.test.ts` | Not asserted (the SDK's 2025 stateless lane opens an SSE stream) | todo backend `get_on_the_endpoint_is_405` | N/A |
| Host and Origin validation before the SDK | `mcp-modern.test.ts` | SDK `transport_security` (default) | `server_http.rs` (`enforce_origin_validation`); todo backend guard tests | N/A |
| Only MCP-exposed commands listed; unknown and private tools → `COMMAND_NOT_FOUND` tool result | `mcp-modern.test.ts`, `mcp-modern-client.test.ts` | `test_mcp_modern_live.py`, `test_mcp_protocol_live.py` | `server_http.rs`; todo backend | `mcp_stdio_test.cpp` |
| Contexts are request input on the modern era (`_meta["dev.afd/context"]`), never stored | `mcp-modern.test.ts` | `test_mcp_modern_live.py` | `packages/rust/tests/server_contexts.rs` | N/A |
| Legacy sessions keep separate context stacks | stdio `mcp-modern.test.ts`; `session-contexts.test.ts` (`/message` lane) | `test_mcp_protocol_live.py` | `server_contexts.rs` (one stack per 2025 connection; stateless HTTP is `SESSION_REQUIRED`) | N/A |
| Tool strategies ([`tool-strategies.md`](./tool-strategies.md)) and meta-tools: the same tool lists, definitions, routing, D4 hiding, confirmations and approval on every route | `tool-surface.test.ts`, `grouped-tools.test.ts`, `lazy-tools.test.ts`, `meta-tools.test.ts` (definitions equal `spec/meta-tools.json`) | `test_mcp_server_tools.py`, `test_mcp_unknown_tools.py` | `packages/rust/tests/server_strategies.rs` (definitions equal `spec/meta-tools.json`), `server_approval.rs` | N/A (#341) |
| Hybrid strategy: `tools/list` is the five meta-tools, then the context tools when contexts are configured, then the first-class tools in configured order ([H3](./tool-strategies.md#h3-the-tool-list-and-its-order)); each first-class tool equals its individual tool | `hybrid-tools.test.ts` (both eras, through `createMcpHandler`) | `test_hybrid_tool_strategy.py`, `test_mcp_protocol_live.py`, `test_mcp_modern_live.py` | `packages/rust/tests/server_hybrid.rs` (Streamable HTTP and stdio, both eras) | Planned (after #341) |
| Hybrid strategy with contexts: `tools/list` identical with and without `_meta["dev.afd/context"]`, with `ttlMs` 300,000 by default ([H4](./tool-strategies.md#h4-contexts-a-fixed-list-scoped-calls), [H6](./tool-strategies.md#h6-cache-hints-and-listchanged)) | `hybrid-tools.test.ts` | `test_hybrid_tool_strategy.py`, `test_mcp_modern_live.py` | `server_hybrid.rs` | Planned (after #341) |
| Hybrid strategy: a first-class tool called outside the active context → `COMMAND_NOT_IN_CONTEXT` tool result ([H4](./tool-strategies.md#h4-contexts-a-fixed-list-scoped-calls)) | `hybrid-tools.test.ts` | `test_hybrid_tool_strategy.py`, `test_mcp_protocol_live.py`, `test_mcp_modern_live.py` | `server_hybrid.rs` | Planned (after #341) |
| Declared context fields ([`context-fields.md`](./context-fields.md)): `tools/call` `_meta` values reach the handler on both eras; undeclared keys dropped; an invalid value is a `VALIDATION_ERROR` tool result naming the field; `createContext` wins; `tools/list` unchanged | `context-fields-mcp.test.ts` (Streamable HTTP and stdio, both eras) | `test_context_fields_mcp.py` (Streamable HTTP and stdio, both eras; SSE) | `packages/rust/tests/server_context_fields.rs` (Streamable HTTP and stdio, both eras) | N/A |
| `server/discover` lists declared context fields under `_meta["dev.afd/context-fields"]`; `afd-help` returns them as `contextFields` | `context-fields-mcp.test.ts` | `test_context_fields_mcp.py` | `server_context_fields.rs` (`server/discover` over Streamable HTTP and stdio; `afd-help` on both eras) | N/A |
| `tools/list` and `server/discover` cache hints (`ttlMs`, `cacheScope`) | `mcp-modern.test.ts` | `test_mcp_modern_live.py` | `server_http.rs`, `server_hybrid.rs` | `mcp_stdio_test.cpp` |
| MCP annotations from command metadata | `tool-surface.test.ts` | `tests/test_tool_annotations.py` | `tests/tool_annotations.rs` | `mcp_stdio_test.cpp` |
| `structuredContent` validated against the CommandResult `outputSchema` | `tool-surface.test.ts`; runner (todo `output` schemas) | Planned | Planned | Planned |
| AFD client negotiates each mode against an AFD server | `mcp-modern-client.test.ts` (call, batch, pipe, stream) | `test_mcp_modern_live.py` | N/A (no Rust client) | N/A (no C++ client) |

## Limits

- The per-language suites are independent; there is no shared executable protocol fixture beyond the todo runner.
- Where a row says "SDK behaviour", AFD relies on the official SDK for that rule and does not assert it separately.
- The C++ loop lives in the todo backend until `afd::mcp_stdio` lands (#341).
- The hybrid tool strategy ([`tool-strategies.md`](./tool-strategies.md#hybrid)) is implemented in TypeScript, Python and Rust so far; the C++ rows stay Planned until its step lands, and each step also loads [`tool-strategies.json`](./tool-strategies.json).
- The deprecated TypeScript `/sse` and `/message` lane keeps its own tests in `packages/server/src/http-transport.test.ts`; it is removed in 3.0.
