# Bounded AFD protocol acceptance tier

Status: stabilization candidate, 2026-10-10; source changes based on `ddb1663` remain unmerged and unpublished. This document indexes AFD acceptance criteria exercised over real local sockets. It is not full MCP certification, deployed-service assurance, or a shared executable protocol fixture. The 34-case todo conformance suite remains a separate domain tier.

## Executors and transports

- **TypeScript:** `packages/server/src/http-transport.test.ts`, describe **AFD contracts over HTTP**. An actual Node loopback server hosts `createMcpHandler`; requests use the existing legacy JSON-RPC `/message` route and POST `/batch`. The tests do not use an official SDK client or establish Streamable HTTP, stdio, or hosted behavior.
- **Python:** `python/tests/test_mcp_protocol_live.py`, hosting `python/tests/fixtures/protocol_server.py` as a real AFD/FastMCP subprocess. Official MCP SDK clients initialize over actual loopback SSE and Streamable HTTP sockets. Two tests are parameterized across three tool strategies and two transports, plus one stateless HTTP test: 13 network cases.
- **Rust/C++:** no library-transport coverage in this tier. Their todo backend conformance results do not imply implementation of optional Rust `server` or C++ `afd::mcp_stdio` library targets.

The common criteria below are an acceptance index, not an assertion of equal coverage or a common runner. Each test suite constructs its own commands and assertions.

## Acceptance index

| Criterion | TypeScript source evidence | Python source evidence | Limit |
|---|---|---|---|
| List/discover exposed commands for individual/grouped/lazy strategies | `discovers and calls only exposed commands with %s tools`: `tools/list`, `afd-discover` | `test_protocol_discovery_exposure_errors_and_meta_tools`: same three strategies, both transports | Different fixtures and transport stacks |
| Detail advertises command schema | Same TS test asserts `afd-detail` contains `inputSchema` | Same Python test checks detail and individual tool schema plus `_meta.contexts` / `_meta.requires` | TS canonical metadata also has separate unit tests; this row is bounded network evidence |
| Private command stays hidden; execution rejection | Private name absent from list/discovery; handler spy remains unused | Private name absent from list/discovery; direct and `afd-call` requests return `COMMAND_NOT_FOUND` | No broader application-auth claim |
| Unknown/private command errors are structured and give suggestions | Both names through `afd-call`: `COMMAND_NOT_FOUND` and string suggestion | Direct unknown/private tools plus `afd-call`; no private name in suggestions | The TS case does not test every direct unknown-tool route |
| Exposed command dispatch succeeds | `afd-call` returns expected item data | Strategy-native invocation returns expected value | Domain behavior beyond fixture commands is out of scope |
| Invalid command input rejects before handler execution | Existing validation vector suite is separate; this TS protocol describe does not assert this criterion | Strategy-native invalid input returns `VALIDATION_ERROR` | Do not promote TS unit/vector coverage to network coverage |
| Malformed batch rejects before any mutation | `keeps malformed batch vectors in the core failure shape on MCP and POST /batch`: 16 failed vectors on REST, 15 at AFD MCP routing; no handler writes | Malformed second command after a write command rejects; independent `probe-read` confirms zero writes | Python does not replay all malformed vectors in this network test |
| Malformed batch retains canonical failed `BatchResult` | TS compares result/summary/confidence/reasoning/error/timing with core | Python network case asserts `INVALID_BATCH_REQUEST`; complete shape covered elsewhere | Non-object MCP arguments stop at JSON-RPC `-32602` before the TS AFD router |
| Successful batch and pipeline execution | Not in this TS describe | Same Python discovery test executes both and checks pipeline data reference | Shared executor vectors remain separate from transport tests |
| Independent session contexts, depth and lifetime | Not in this TS describe | `test_two_transport_sessions_isolate_contexts_and_fresh_connections`: overlapping clients, concurrent calls, discovery/execution, batch/pipeline inheritance, depth 16, repeated-active no-op, fresh connection | Caller-provided `sessionId` is deliberately forged identically on distinct clients and cannot establish identity; no app-auth proof |
| Stateless HTTP context mutation requires a session | Not applicable to this TS transport case | `test_stateless_http_context_mutation_requires_a_persistent_session`: enter/exit return `SESSION_REQUIRED` | Only Python stateless Streamable HTTP exercised |

## Running the tier

From the repository root, with the repository toolchains and dependencies installed:

```sh
pnpm -F @lushly-dev/afd-server exec vitest run src/http-transport.test.ts
cd python
uv run pytest -q tests/test_mcp_protocol_live.py
```

The TypeScript command includes the broader existing HTTP suite. A passing local tier does not replace `pnpm check`, the supported Python version/wheel matrix, native CI, or release gates. Lane receipts describe their actual runtime versions; final combined validation is coordinator-owned.

## Remaining scope

A reusable shared protocol fixture/runner, native library transports, broader bootstrap behavior, additional TypeScript session/executor paths, stream semantics and general MCP interoperability remain open. The separate local Better Auth and local-db integration tests are unrelated to protocol certification: hosted local-db was skipped, and OAuth, Convex, browser cookie/multi-tab behavior and durable storage were not proven. Python 0.8.0 remains the published broken artifact; #347 remains publication-blocked until release requirements are met.
