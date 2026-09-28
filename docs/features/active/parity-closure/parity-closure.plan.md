# Language Parity Closure Plan

## Overview

[`docs/language-parity.md`](../../../language-parity.md) rates every AFD capability for TypeScript, Python, Rust and C++. This plan closes its unintended gaps. It also asks for a decision on every gap that no plan declares, so each gap is either closed or recorded as intentional.

| Field | Value |
|---|---|
| Status | Active: accepted 2026-09-27, with every recommendation (D1–D8) |
| Author | jasfalk |
| Updated | 2026-09-27 |
| Tracks | [`docs/language-parity.md`](../../../language-parity.md) |
| Supersedes | The name-only [Python parity plan](../python-parity/python-parity.plan.md) (see [Tracking](#tracking)). The Rust parity plan is marked complete in #289. |
| Related | [Versioning and release plan](../versioning/versioning.plan.md), [C++ proposal](../../proposed/cpp-support/proposal.md), [Rust support](../../proposed/rust-support/00-overview.md) |

**Goal.** Every matrix row is **Yes**, **N/A** with a reason, or **Deferred** with a plan. All four languages consume every `spec/vectors` file in CI, and all four pass a protocol-level conformance tier.

## Principles

1. **Spec first.** When more than one language implements a behavior, write it as a spec or vector file first, generated from TypeScript where possible. Each language then loads the vectors. A parity fix becomes one decision plus mechanical ports, and the vectors stop the languages drifting apart again.
2. **Agent-visible behavior first.** Fix what an agent sees (results, errors, dispatch, exposure) before surfaces (servers, meta-tools), and surfaces before tooling.
3. **Each language has a role,** and the role decides whether a gap is "appropriate" to close:

| Language | Role | Must match TypeScript | Not planned |
|---|---|---|---|
| TypeScript | Reference and full stack | — | — |
| Python | Full stack: server, client, CLI, testing | The contract, the engine, and server and client surfaces | UI packages |
| Rust | Embeddable library, WASM, optional MCP server | The contract and the engine; the server surface when the `server` feature is on | CLI, testing toolkit, MCP client, UI, auth |
| C++ | Host-agnostic embeddable library, optional stdio MCP target | The contract and the engine; the stdio surface when that target is used | HTTP, CLI, testing toolkit, MCP client, handoff client, UI, auth, engine adapters |

4. **Close and record together.** A pull request that closes a gap also updates its matrix row and lowers the `alfred parity` budget.

## Decisions

All eight were accepted as recommended on 2026-09-27.

| # | Question | Decision | Why |
|---|---|---|---|
| D1 | Should Rust get an MCP server? | **Yes,** behind a `server` Cargo feature that is off by default: stdio and Streamable HTTP, tool strategies, meta-tools, bootstrap and context tools. | The [Rust support proposal](../../proposed/rust-support/01-afd-rust.md) planned "full MCP server support". The todo backend already hand-rolls one, and its security checks too. The feature flag keeps `wasm` and core builds lean. |
| D2 | Should C++ get an MCP target? | **Yes, stdio only:** an optional `afd::mcp_stdio` target promoted from the todo backend's `mcp_stdio.cpp`, with the meta-tools and bootstrap commands. HTTP stays out. | This is the proposal's "Maybe" (scope row "Stdio MCP loop"). It passes the scope principle: any C++ host that wants to be an MCP server needs the same loop. |
| D3 | Which unit do length checks count? | **Schema `minLength`/`maxLength` count code points,** as JSON Schema defines. Zod has counted code points since 4.5.0, and the server requires `zod ^4.5.4`. The 128-character similarity and 1024-character reference caps follow TypeScript's UTF-16 units. C++ already counts similarity this way; Rust changes (#286, #288), and any other language that counts differently changes too (#283). | The JSON Schema that TypeScript advertises already promises code points, and every language's validator already counts them. |
| D4 | What code does an unknown or unexposed command return? | **Write down the current TypeScript split as the spec:** remote MCP returns `COMMAND_NOT_FOUND` for both, so private commands stay hidden; an in-process registry called with a surface returns `COMMAND_NOT_EXPOSED`; `DirectClient` returns `UNKNOWN_TOOL`, always with a `suggestion`. | The split protects private commands over the network, and each language copied a different part of it. Suggestions name `afd-discover` or `afd-context-*` only where those tools exist. |
| D5 | Should Python's server defaults change to TypeScript's? | **Yes:** bootstrap opt-in and a `grouped` default strategy, released as Python 0.10 (see the versioning plan). | Agents should see the same tool list whichever language serves it. |
| D6 | What about the gaps no plan declares? | **Rust and C++:** CLI, testing toolkit, MCP client and handoff client are **N/A**. A Rust or C++ server is exercised through the TypeScript CLI and scenario runner over MCP. **C++:** tracing middleware is N/A; `compose_middleware` is added. **Python:** an auth adapter is **planned**: the `AuthAdapter` protocol, auth middleware and `auth-*` commands, without React. **Everywhere:** platform utilities and connectors are **N/A** beyond what exists today, including Rust's type-only connectors. | This follows the role table above. |
| D7 | Should TypeScript implement MCP Streamable HTTP? | **Yes,** a `/mcp` endpoint on the server and a Streamable HTTP transport in `packages/client`, with the current protocol version. The legacy routes stay for one major version. | Without it, the TypeScript client and CLI cannot talk to the Python or Rust HTTP servers, so D6 stops working over HTTP. |
| D8 | `CommandContext.timeout` is declared but only `DirectClient` enforces it. | **Enforce it in the server engine** as a per-command deadline, as Rust and C++ already do. | A declared field that does nothing misleads the authors of other languages. |

## Waves

Sizes: **S** is under a day, **M** is a few days, **L** is a week or more.

### Wave 0: in flight

Already under way, from before this plan or from the 2026-09-26 review:

| Item | Language | Closes | State |
|---|---|---|---|
| Registry engine aligned with TypeScript: the validation message and shape, undeclared keys dropped, UTF-16 name handling | Rust | Part of the Wave 2 Rust validation item; D3 | Merged in #286 (breaking) |
| Fuzzy matching and name truncation count UTF-16 units | Rust | D3 | Folded into #286; #288 closed |
| Rust parity plan marked complete; `AGENTS.md` becomes the only agent guide | Docs | Tracking | #289 (open) |
| Server dispatch order, validation of `None` input, exception redaction | Python | Priority 1 items 1–2 | #304 (open) |
| `execute` catches panics; `COMMAND_EXECUTION_ERROR`; `is_success` and `is_failure` | Rust | Priority 1 items 2–4 | Task running |
| `DirectClient` keeps the caller's cancellation when `timeout_ms` is set | C++ | The defect in the matrix | Task running |
| `expose` and the other broken snippets in the README and skill | Python docs | Documentation drift | Task running |
| Site, root README, Rust and C++ docs and skills, the todo spec README | Docs | Documentation drift | Merged in #301 |

### Wave 1: shared contract

TypeScript leads this wave. It is small and unblocks everything after it.

| # | Item | Size | State |
|---|---|---|---|
| 1.1 | Load `spec/vectors/pipeline-variables.json` in the TypeScript, Python and Rust test suites; C++ already does. | S per language | Done in #317: all four suites load it. Python and Rust now treat a literal `when` operand as absent, and Rust's `$eq` compares numbers by value |
| 1.2 | **`spec/error-codes.md`:** every emitted code, whether it is retryable, and which layer emits it, plus the D4 rules. Add the missing codes to TypeScript `ErrorCodes` (about 25), Python `ErrorCodes`, Rust `error_codes` and C++ `error_codes`. | M | Open |
| 1.3 | **`spec/validation.md` and `spec/vectors/validation.json`:** see the list below the table. Generate the vectors from TypeScript, marking the astral-character cases where TypeScript differs. | M | Done for TypeScript: [`spec/validation.md`](../../../../spec/validation.md), 32 cases in [`spec/vectors/validation.json`](../../../../spec/vectors/validation.json); Python, Rust and C++ load them in Wave 2 (#310, #311, #312) |
| 1.4 | **`spec/vectors/batch-controls.json`,** from `packages/server/src/execution-controls.test.ts`. The C++ work plan already recommends this file. | S–M | Done in #317: 21 batch and 22 pipeline cases from `generate-batch-controls.mjs`, loaded by all four suites. Python and Rust envelope validation and Rust's pipeline deadline now match TypeScript. TypeScript's `afd-batch` tool still differs from `executeBatch` ([#314](https://github.com/lushly-dev/afd/issues/314)) |
| 1.5 | **Command metadata:** list the canonical fields in the spec. Fix the TypeScript split ([#275](https://github.com/lushly-dev/afd/issues/275)): core `CommandDefinition` and `defineCommand` both carry `destructive`, `confirmPrompt` and `undoable`, and `toCommandDefinition()` keeps them. | S (TS minor) | Done in #308: canonical fields in [`spec/command-metadata.md`](../../../../spec/command-metadata.md); `_meta`, afd-detail, afd-help, afd-docs and `afd tools` report `undoable` |
| 1.6 | **One default reconnect policy.** The TypeScript client's fallback of 5 attempts becomes core's 3. | S | Done for TypeScript in #308. Python's handoff client also falls back to 5; see Wave 2 |
| 1.7 | **Contract 1.0:** add the AFD contract version constant (see the [versioning plan](../versioning/versioning.plan.md#1-a-versioned-afd-contract)). Declare 1.0 once 1.1–1.4 pass in all four languages. | S | Open |

The validation spec (1.3) covers:
- stripping unknown keys;
- the message text and `details` shape: `errors`, `expectedFields`, `unexpectedFields`, `missingFields`;
- the D3 length units ([#283](https://github.com/lushly-dev/afd/issues/283));
- the JSON Schema subset every language must support: `type`, `properties`, `required`, `enum`, `items`, `minItems`/`maxItems`, `minLength`/`maxLength`, the four numeric bounds, `additionalProperties` and local `$ref`;
- the optional keywords, such as `pattern` and the combinators.

**1.3 outcome.**
- **What landed:**
  - `spec/vectors/generate-validation.mjs` generates the vectors;
  - `packages/server/src/validation-vectors.test.ts` checks TypeScript against every case.
- **Also covered:** explicit `null` ([#282](https://github.com/lushly-dev/afd/issues/282)) and
  schema defaults ([#284](https://github.com/lushly-dev/afd/issues/284)), recorded as TypeScript
  behaves.
- **D3 and TypeScript.** Zod counts code points from 4.5.0, and `@lushly-dev/afd-server` requires
  4.5.4. So TypeScript differs from D3 only for a schema built with Zod 4.0 to 4.4, and the four
  astral tests carry that exception.
- **Loading the vectors is Wave 2 work.** Each issue lists that language's failing cases:
  - Python: [#310](https://github.com/lushly-dev/afd/issues/310);
  - Rust: [#311](https://github.com/lushly-dev/afd/issues/311);
  - C++: [#312](https://github.com/lushly-dev/afd/issues/312).

### Wave 2: engine alignment

Each language works against the Wave 1 vectors, and the four can proceed in parallel.

**Python (L overall):**
- One executor. Route the core registry, `SimpleRegistry`/`DirectClient`, `MockServer` and `DirectClient.pipe` through a single engine. Export `execute_batch` and `execute_stream`. (L)
- A `DirectClient` boundary: exposure, the `allow` predicate, middleware and timeout. (M)
- One context stack per session, capped at 16. (M)
- A 1 MiB event-size cap in `SseDecoder`. (S)
- `is_success` checks only `success`, and `failure()` accepts every result option. (S)
- Decorator metadata: `version`, `errors`, `execution_time`, `destructive`, `confirm_prompt` and `undoable`; `handoff` through `MCPServer.command`. Call `validate_command_name`, and reserve the bootstrap names. (M)
- `create_handoff` applies the default reconnect policy, and the handoff client falls back to it instead of 5 attempts. There is one `TelemetryEvent`, and it serializes in camelCase. (S)
- Export cleanup: resolve the `afd.direct` name collisions, then re-export the 60 implemented names and lower the budget. (M)

**Rust (L overall):**
- **Engine** (M):
  - result metadata stamping;
  - `on_command` and `on_error` hooks;
  - active-context scoping;
  - a cancellation token on `CommandContext`;
  - `list_by_tags`.
- **Built-in middleware** (M): trace ID, logging, timing and `default_middleware`; then retry, rate limit and telemetry.
- **Stream executor:** `execute_stream` with `StreamExecutorOptions`. (M)
- **Validation** (M). #286 already strips undeclared keys and matches the TypeScript message. What remains:
  - add `minItems`/`maxItems` and `additionalProperties: false`;
  - cache compiled `pattern` regexes;
  - count schema lengths per D3;
  - apply schema defaults ([#284](https://github.com/lushly-dev/afd/issues/284));
  - treat an explicit `null` parameter as TypeScript does ([#282](https://github.com/lushly-dev/afd/issues/282)).
- **Metadata** (S): `destructive`, `confirm_prompt` and `undoable`; validate examples; surface `returns` in `afd-schema`.
- **Small alignments** (S):
  - `is_handoff_protocol` and `is_handoff_command` take the TypeScript meanings, and `handoff:<p>` tags are honored;
  - `TelemetryEvent.duration_ms` becomes a float;
  - export `is_mcp_exposed`, `commands_to_mcp_tools`, `MAX_SIMILARITY_INPUT_LENGTH` and `truncate_name`.

**C++ (M overall):**
- The 15 cheap exports. (S)
  - MCP exposure helpers;
  - request guards;
  - pipeline aggregation helpers;
  - `create_progress_chunk_with_steps`;
  - a `StreamExecutorOptions` alias.
- `to_json` for `CommandDefinition`, and `command_to_mcp_tool`, so `output_schema`, `prerequisites` and `_meta` reach the wire. The todo backend uses them. (M)
- Error suggestions follow D4: they name only the tools the host provides. (S)
- Retry, rate-limit and telemetry middleware, `TelemetryEvent`/`TelemetrySink`, and `compose_middleware`. These are the proposal's deferred middleware. (M)
- `list_by_tags`. (S)

**TypeScript (M overall):**
- `MockServer` runs on the server engine (`createDirectRegistry`), so scenario tests get production semantics. (M)
- D8: the engine enforces `CommandContext.timeout`. (S)
- Complete the `ErrorCodes` catalog as part of 1.2. (S)

### Wave 3: surfaces

| Item | Language | Size |
|---|---|---|
| **D7: MCP Streamable HTTP** on the server (`/mcp`) and in the client, with the current protocol version | TypeScript | L |
| **D5 defaults:** bootstrap opt-in; `grouped` by default, with `afd-detail` and per-action schemas | Python | M |
| **HTTP hardening:** Host/Origin checks and a body cap on the FastMCP HTTP transports | Python | M |
| **MCP client:** make `auto_reconnect` work | Python | S |
| **CLI:** add `batch` and `stream` | Python | S |
| **D1: the `server` feature:** stdio and Streamable HTTP, tool strategies, meta-tools, bootstrap, context tools, Host/Origin checks and a body cap. Move the todo backend onto it. | Rust | L |
| **D2: `afd::mcp_stdio`:** `initialize`, `tools/list` with `_meta`, `tools/call`, the meta-tools and bootstrap. Move the todo backend onto it. | C++ | M |
| **Protocol conformance tier:** see below the table. It is opt-in per backend. TypeScript and Python join first; Rust and C++ join as D1 and D2 land. | All | M |

The protocol conformance tier adds cases next to `packages/examples/todo/spec/test-cases.json` for:
- meta-tools and bootstrap tools;
- a private command staying hidden;
- an unknown command getting a suggestion;
- `afd-batch` and `afd-pipe`;
- context entry.

### Wave 4: remaining decisions

- **D6, Python auth:** port the `AuthAdapter` protocol, the auth middleware and the `auth-*` commands. (M)
- **Mark the D6 N/A decisions in the matrix,** each with its reason.

## Dependencies

```
Wave 0 ──► update matrix
Wave 1 (specs, vectors, contract constant)
   ├──► Wave 2 validation and error-code items (all languages)
   └──► contract 1.0 (versioning plan)
Wave 2 Python executor ──► Wave 3 Python defaults and CLI
Wave 2 Rust engine and middleware ──► Wave 3 Rust server feature
Wave 2 C++ to_json and tool conversion ──► Wave 3 C++ mcp_stdio
Wave 3 TypeScript Streamable HTTP ──► D6 over HTTP (TypeScript CLI against Python and Rust HTTP servers)
Wave 3 servers ──► protocol conformance tier for Rust and C++
```

## Exit criteria

- Every row of the matrix is Yes, N/A with a reason, or Deferred with a plan.
- Every `spec/vectors` file is loaded by all four test suites in CI.
- The protocol conformance tier passes for all four backends.
- The `alfred parity` budgets hold only intentional differences:
  - Python: the 20 typing artifacts;
  - Rust: `executor_options` and `command_registry_options`, if it keeps no dev mode;
  - C++: the by-design set.
- All four implementations declare the same AFD contract version.

## Tracking

- Open one issue per wave item, labeled `parity` plus the language, linked from this plan. Existing issues are linked where they fit: #275, #282, #283, #284.
- **The Python plan's** export cleanup is a Wave 2 item. Move that plan to `complete/` when the `missing_from_python` budget reaches 20.
- **The Rust parity plan** moves to `complete/` in #289. Its behavioral items are Wave 2 here.
- **Update `docs/language-parity.md`** in the same pull request as each change.
- **New cross-language features are outside this plan:** #172, #271, #272, #273, #274 and #276. Each follows the same spec-first rule, and lands in all four languages or records N/A in the matrix.
