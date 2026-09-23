# AFD deep quality review — September 23, 2026

Baseline: `6b93be8` (`main`, after the hardening round in #225).
Previous round: [2026-09-05-review.md](2026-09-05-review.md). Nothing that round
fixed is re-reported here unless the fix is incomplete.

## Scope and method

Five independent reviews ran in parallel, one per area:

1. `packages/core` + `packages/server`
2. `packages/client`, `cli`, `adapters`, `view-state`, `local-db`
3. `packages/testing` + `packages/auth`
4. The Python package (`python/`)
5. The Rust crate (`packages/rust`), `alfred/`, and `packages/examples/`

A lead pass covered repository tooling, CI, packaging, layering, and
agent-facing documentation. It also re-ran the most severe reproductions
independently before accepting them.

Each finding is marked:

- **V (verified)**: reproduced with a script, or traced end to end through
  the code.
- **P (plausible)**: the mechanism was confirmed, but not on the target
  platform. Windows-only issues are the main case.

No repository files were changed during the review. Reproduction scripts
were kept outside the tree.

Dimensions: architecture, maintainability, performance, security, and
overall code quality.

## Baseline health

| Check | Result |
| --- | --- |
| `pnpm lint` / `pnpm typecheck` / `pnpm build` | Pass |
| TypeScript tests | 1,700+ pass across 12 packages; coverage identical to the 09-05 round |
| File-size / orphan / portability scripts | Pass (36 size warnings, 12 `afd-override` exemptions, 53 portability warnings) |
| Python `pytest` | 1,641 pass, 87% line coverage |
| Python `ruff` (package config) | 4,362 violations in `src`; 65 of 81 files not formatted |
| Python `mypy --strict` | 167 errors in 33 files |
| Rust `cargo test` | 119 unit + 17 doc tests pass (default and `--no-default-features`) |
| Rust `clippy` | 15 default warnings, 285 pedantic |
| `alfred parity` / `alfred quality` on HEAD | Exit 1: 180 gaps; 338 issues |
| Committed-secret scan | Clean |

The TypeScript gate is green and honest. The problems below are almost all
**outside what the gate measures**:

- the Python and Rust implementations;
- cross-language behaviour;
- algorithmic cost on untrusted input;
- paths the tests mock away.

## Scorecard

| Dimension | Assessment |
| --- | --- |
| **Architecture** | **Good core ideas, uneven execution.** The command contract (`CommandResult`, exposure, preflight) is sound, and the TS server enforces it well after #225. But execution semantics are implemented five times: the TS server engine, the core registry, DirectClient, the Python server, and Python DirectClient. They have diverged. The three languages no longer share a wire format. |
| **Maintainability** | **Fair.** TypeScript is strict and nearly `any`-free, with good tests. The biggest modules all sit under self-granted size overrides. Routing and similarity helpers are copy-pasted. `packages/testing` (11.6k source lines) has grown sideways. Python has no lint or type gate at all. |
| **Performance** | **Fine on the happy path, fragile on hostile input.** Several O(n·m) or O(n²) algorithms run on attacker-sized strings: fuzzy matching in three languages, surface similarity, and the SSE line buffer. Per-call overhead is modest. Python rebuilds its router on every call. |
| **Security** | **The TS HTTP server is solid; the surroundings leak.** Python has a critical remote read of process globals via pipelines. Remote clients can block the TS server's event loop. Around the hardened server, the boundary reopens: DirectClient, the examples, testing's MCP tools, CLI output to the terminal, and Windows `shell: true` execution. |
| **Code quality** | **High in TS core/server/client; lower elsewhere.** Python ships an unimportable base install and two incompatible `CommandError` classes. Several test suites lock in bugs (dot-notation fixtures, stack traces in errors) or mock away the behaviour under test (CLI). |

## Cross-cutting themes

These explain most of the individual findings. Fixing a theme closes many
findings at once.

### 1. No cross-language contract, and no gate for Python or Rust

`ci.yml` and `pnpm check` cover TypeScript only. Python runs only in
`publish-python.yml`, on a tag push, on Python 3.12, although the package
declares `>=3.10`. Rust has no CI at all. `alfred.yml` only tests alfred itself,
and `alfred parity` compares export *names*, not shapes. The result is drift
that no check catches:

- **Python emits snake_case JSON:**
  - `success_count`, `execution_time_ms`, `undo_command`
  - failure tool results with `isError: false`
- **Rust shapes differ:**
  - `Source`, `PlanStep`, `Warning` and `BatchOptions` all have different
    shapes.
  - Batches stop on the first error **by default**; TS and Python continue.
  - `BatchResult.success` is always `true`.
  - `suggestions` and `undoCommand` are dropped on a round trip.
- **The todo backends are no longer the same product:**
  - The Python backend is dot-named, unexposed, and cannot be installed.
  - The Rust backend is not an MCP server.
  - Conformance runs only against TS.

**Recommendation:**

- Add golden wire fixtures (`spec/wire/*.json`) covering results, batch,
  pipeline, stream chunks and errors, round-tripped by all three test suites.
- Add Python jobs: ruff, pytest on 3.10–3.12, and a clean-venv install smoke
  test per extra.
- Add Rust jobs: test on the default and `--no-default-features` builds, plus
  clippy.
- Replace name-based parity with schema or fixture comparison.

### 2. One contract, many executors

In TypeScript, the same concepts are implemented in several places:

| Concept | Copies | Where |
| --- | --- | --- |
| Batch/stream execution | 3 | server `execution.ts`, core `createCommandRegistry`, DirectClient |
| Context predicate | 4 | |
| Group derivation | 4 | |
| `COMMAND_NOT_IN_CONTEXT` error | 4 | |

The core registry already behaves differently from the server:

- It ignores the timeout when `parallelism > 1`.
- It skips exposure checks in batch and stream.
- It leaks stacks.

That matters because `packages/testing`'s MockServer uses the core registry,
so scenario tests run different semantics from production.

Python has three registries, two pipeline engines with different variable
syntax, and two exposure checks.

**Recommendation:** one executor per language with a pluggable `execute`
callback, as `executePipeline` already does. Every entry point, including the
server, registry, DirectClient and test harness, delegates to it.

### 3. Pipeline variable resolution is an unsafe mini-language in every language

| Problem | Where |
| --- | --- |
| Literal strings starting with `$` (`"$9.99"`, `"$HOME"`) silently become `undefined`/`null`; there is no escape syntax | TS and Rust |
| Resolution walks prototypes: `constructor.constructor === Function` | TS |
| Resolution walks arbitrary attributes via `getattr`, up to `__globals__` (**critical, C2**) | Python |
| `$input` aliases the host execution context; DirectClient passes the caller's whole context, so secrets can be copied into command inputs | TS |
| No recursion depth limit; deep bodies crash with `RangeError` instead of returning a `PipelineResult` | TS |
| Regexes are recompiled per path segment | Rust |

**Recommendation:** write a short spec and implement it identically in all
three languages:

- Step data is normalized to JSON first.
- Only own dict keys and array indices are followed; `_`-prefixed and
  `__proto__`/`constructor`/`prototype` segments are rejected.
- Only known prefixes are resolved (`$prev`, `$first`, `$steps`, `$input`),
  with `$$` as the escape.
- `$input` comes from an explicit `PipelineRequest.input`.
- Depth is capped.

### 4. The security boundary lives only in the TS HTTP server

#225 made the TS MCP server enforce exposure, Host/Origin checks and body
limits. Most other entry points do not:

- **DirectClient** calls any registered command. It has no `expose.agent`
  check and validates only top-level fields. The official examples and the
  `afd-directclient` skill teach a hand-rolled registry that skips Zod
  entirely.
- **Example servers** reflect any `Origin`, bind to all interfaces, trust
  `X-Forwarded-For` for rate limiting, and render LLM output as HTML (XSS):
  the todo-directclient chat server, the chat side server, and the Rust todo
  backend.
- **The testing package's MCP tools** give any MCP client read and write
  access to arbitrary files.
- **Python discovery** (`afd-help`, `afd-docs`, `afd-schema`, `afd-detail`)
  lists private commands and their schemas.
- **Context scoping** is one process-global stack shared by every HTTP
  client.
- **No request identity** reaches `CommandContext`, so per-client auth or rate
  limiting is impossible. The documented rate-limit examples key on `traceId`
  (never limits) or `userId` (never set).

**Recommendation:**

- Ship `server.toDirectRegistry({ interface: 'agent' })`, wrapping the real
  executor with Zod, middleware and exposure, and make the examples and skill
  use it.
- Add a `createContext(req)` hook to `createMcpHandler`.
- Key context state per session.

### 5. Untrusted-input algorithmic cost

| Hot spot | Measured |
| --- | --- |
| TS server fuzzy match (`afd-call` / `afd-detail` on an unknown name) | 879 KB request → **22 s** event-loop block (re-run and confirmed) |
| TS DirectClient fuzzy match | 100 KB name → 6.3 s |
| Rust `similarity.rs` | 1 MB name → 7.2 s, 219 MB |
| `validateCommandSurface` | n=2,000 → 32.7 s / 966 MB; crashes on 600 templated commands (spread into `push`) |
| Client `stream()` line buffer | 64 MB without a newline → 601 MB heap growth (quadratic) |

**Recommendation:**

- Cap names at 128 characters before fuzzy matching.
- Skip candidates whose length ratio makes the 0.4 threshold impossible, and
  use a two-row Levenshtein.
- Precompute term-frequency vectors once. A prototype of this was about 16×
  faster.
- Bound SSE event size.

### 6. Error paths leak or lie

**Leaks:**

- **TS core:** `wrapError()` copies stacks into `details.stack` regardless of
  `devMode`, and `errors.test.ts` asserts the stack is there.
- **TS core:** `isCommandError` accepts Node system errors, which serialize
  file paths.
- **TS server:** `validateInputEnhanced` runs outside the `try`, so a throwing
  Zod refinement escapes as HTTP 500 after earlier batch writes. It also puts
  raw exception text into pipe and stream errors.
- **Python:** returns `str(exc)` to remote clients and logs nothing.

**Misreports:**

- An `onCommand` hook that throws turns a completed write into
  `COMMAND_EXECUTION_ERROR`, inviting a duplicate retry.
- Client transport failures are reported as definite per-command failures,
  although the server may have committed them.

### 7. Quality gates narrower than advertised

- CLAUDE.md says "lefthook IS the CI pipeline", but neither lefthook nor CI
  touches Python or Rust.
- `packages/server` has **no coverage thresholds** and no `include`, so its
  89.9% is unenforced. `packages/adapters` has no `typecheck` script, so
  `pnpm -r typecheck` skips it.
- 12 of the largest TS files are exempted from the 500-line gate. Two are
  within 5% of their exemption cap: `core/pipeline.ts` (965/1000) and
  `commands.ts` (857/900).
- **The CLI's 87% coverage is almost entirely mocked.** The client, the
  connection and `process.exit` are all stubbed. The two high CLI bugs (H6,
  H7) ship because no test runs the binary against a real server.
- **Tests lock in bugs:**
  - `fixture-loader.test.ts` asserts dot-notation command names that do not
    exist.
  - `errors.test.ts` asserts that stacks are present.
  - `transport-parity.test.ts` exercises the internal engine, not either
    transport.

### 8. Naming and documentation drift aimed at agents

AFD's primary users are agents that follow the skills. Several of them now
produce broken code:

- **Missing opt-in.** The `afd-typescript` and `afd` skills show
  `defineCommand` with no `expose: { mcp: true }`. Since #225, commands built
  that way do not appear to MCP clients. `@lushly-dev/afd-view-state`'s own
  commands have the same gap, so its README setup exposes zero view-state
  tools.
- **Surface-validation doc.** Its example `additionalInjectionPatterns: []`
  disables injection detection entirely: the option replaces the built-in
  patterns instead of extending them.
- **Dot notation.** Much code still uses `todo.create`-style names although
  the rest of the repo uses kebab-case: the testing package, the CLI, the
  Python todo backend, `spec/commands.schema.json`, and the scenario template.
- **Wrong or overstated docs:**
  - Testing README: wrong option name (`handler` vs `commandHandler`) and
    wrong tool names (`scenario_list` vs `scenario-list`).
  - Rust README: the quick start does not compile.
  - Rust README: it claims "guaranteed type compatibility" with TS and
    Python, which is false.

### 9. Layering and packaging

**TypeScript:**

- The `@lushly-dev/afd-core` root barrel re-exports `GitHubConnector` and
  `PackageManagerConnector`, which pull in `node:child_process`. A browser
  bundle of `import { success }` fails.
- `defineCommand` lives in `afd-server` (MCP SDK plus `node:http`, `node:tls`;
  about 225 ms to import). So the browser-side `view-state` package cannot be
  bundled for the browser without marking Node builtins external.
- `zod` is a hard dependency of `afd-server` while `instanceof z.ZodObject`
  checks assume a single copy.

**Python:**

- The root `__init__` exports 176 names eagerly.
- The `cli` extra imports `pytest`.
- The `client` extra lacks `mcp`.
- The `server` extra declares `fastmcp`, but the code uses private
  `mcp.server.fastmcp` internals.

**Rust:**

- `native = ["tokio/full"]` forces full Tokio on consumers.
- The `wasm` feature adds no code, and the crate traps on wasm32
  (`Instant::now`).

**Recommendation:**

- Move `defineCommand` and the schema helpers to a transport-free entry point
  (e.g. `@lushly-dev/afd-server/define`).
- Move the connectors to `@lushly-dev/afd-core/connectors`.
- Move view-state commands to a `/commands` subpath, following the #222
  pattern for auth.
- Make Python imports lazy per extra.

## Findings

Findings are ranked by severity, and within each severity by blast radius.
Paths are relative to the repo root.

### Critical

**C1 — Python base install cannot be imported.** *packaging · V (re-run)*
`python/src/afd/__init__.py:189` → `afd.client` → `afd/transports/http.py:19`
imports `httpx`, which is only in the `client` extra. In a clean venv,
`pip install afd` (0.8.0) followed by `import afd`, or even `import afd.core`,
raises `ModuleNotFoundError: No module named 'httpx'`.

Related extras problems:

- `pip install afd[cli]` → `afd --help` crashes on `import pytest`.
- `[client]` lacks `mcp`, which the default `SseTransport` needs.
- `websockets>=12` is too low: `additional_headers=` needs version 14.

*Fix:* import transports and the testing package lazily, declare `mcp`
directly, and add per-extra clean-install smoke tests. The current PyPI
release should be patched promptly.

**C2 — Python pipelines let any MCP client read server process globals.**
*security · V (re-run)*
`python/src/afd/core/pipeline.py:398-429` (`get_nested_value`) resolves path
segments with `getattr`. The same pattern exists in `direct.py:765`.

Through the remote `afd-pipe` tool, `$prev.__class__.__init__.__globals__.sys.modules.__main__.SECRET_TOKEN`
returned the secret whenever a prior step returned a pydantic model, which is
the documented pattern. `...os.environ._data` leaks environment variables
through validation error text. `when` conditions give a boolean oracle over
the same paths even when no command echoes its input.

*Fix:* `model_dump(mode="json")` step data before it enters the pipeline
context; follow only dict keys and list indices; reject `_`-prefixed
segments. Apply the same fix to DirectClient.

**C3 — Two incompatible `CommandError` classes break Python error handling.**
*correctness · V (re-run)*
`python/src/afd/core/errors.py:23` and `core/result.py:45` each define
`CommandError`. `CommandResult.error` only accepts the second one, but every
error factory and `afd.CommandError` produce the first.

So `failure(not_found_error('Todo', '42'))`, the docstring example, raises
`ValidationError`. The consequences:

- Every DirectClient error path raises instead of returning a failure.
- Server batch `timeout` and `stopOnError` crash the whole call
  (`server/factory.py:413-421,450-469`).

The 09-05 round's #214 fix for Python batch controls is therefore not
effective, and no test covers `BATCH_TIMEOUT` or `COMMAND_SKIPPED`.

*Fix:* keep a single class, and add regression tests for
`failure(<factory>())`, DirectClient errors, and batch timeout/skip.

### High

| ID | Area | Finding | Evidence | Fix |
| --- | --- | --- | --- | --- |
| H1 | TS server · security/perf | Unauthenticated CPU denial of service through fuzzy matching of unknown command names (`core/src/similarity.ts:11-45`, reached from `server/src/tool-router.ts:153` and `lazy-tools.ts:473-482`). Routable under every tool strategy. | V (re-run): one 879 KB `afd-detail` request blocked the event loop for 22 s; a 200 KB `afd-call` name, 5.3 s. The same algorithm is in `client/src/unknown-tool.ts` (6.3 s) and `packages/rust/src/similarity.rs` (7.2 s). | Cap names at 128 chars before matching; length-ratio pre-filter; two-row DP; stop echoing the unbounded name. |
| H2 | TS server · correctness | `validateInputEnhanced` runs outside the `try` (`server/src/execution.ts:79` vs `:125`). A throwing `.refine`/`.transform` makes `executeCommand` reject. | V: `/batch` returns HTTP 500 **after** a prior mutation ran (the #219 class again). `afd-pipe` and `/stream` put raw exception text in errors with `devMode: false`. Four routes give four different shapes. | Move validation into the `try` and map it to `VALIDATION_ERROR`; sanitize by `devMode` in `pipeline-executor.ts:203-211` and `execution.ts:338-347`. |
| H3 | TS server · security/arch | Context scoping is one process-global stack shared by every HTTP client (`server/src/server.ts:61`, `bootstrap/afd-context.ts:27-42`). The stack is unbounded and accepts duplicates. | V: client A's `afd-context-enter` changes client B's `tools/list`, and B's calls return `COMMAND_NOT_IN_CONTEXT`. | Key context state per MCP session, or refuse `contexts` on HTTP; cap depth. |
| H4 | TS core/testing · security | Windows command injection: `exec()` spawns with `shell: isWindows` (`core/src/platform.ts:138`). `GitHubConnector.issueCreate`/`prCreate` pass title, body and labels, and `PackageManagerConnector` passes package names. `testing/src/runner/cli-wrapper.ts:200-208` does the same with `JSON.stringify(step.input)` from scenario YAML. | P: the Node `shell: true` concatenation was reproduced on Linux; `cmd.exe` `&`/`\|` semantics follow. | Never use `shell: true`; resolve `.cmd` shims explicitly (cross-spawn style); insert `--` before positional arguments. |
| H5 | TS server · agent contract | Input JSON Schemas are generated in Zod *output* mode (`server/src/schema.ts:331`). | V: `z.number().default(20)` is advertised as required, so the todo example's `todo-list` lists `sortBy`, `sortOrder`, `limit` and `offset` as required. Any `.transform()` in an input schema makes `defineCommand` throw. | `z.toJSONSchema(schema, { target: 'draft-7', io: 'input' })` for inputs (confirmed to fix both problems); add `'integer'` to the core `JsonSchema.type` union. |
| H6 | CLI · safety | `afd validate` calls **every exposed tool** with `{}`, including mutations (`cli/src/commands/validate.ts:231`). | V: against a test server, it ran a `mutation: true` `db-reset` tool, which wiped the data. | Never execute by default; add an `--execute` flag that skips `mutation`/`destructive` tools and uses `_meta.examples` inputs. |
| H7 | CLI · correctness | The CLI never disconnects (`cli/src/bin.ts:11` uses `program.parse()`). Over SSE, the `afd connect` default, `call`, `status`, `tools`, `batch` and `stream` print their result and then hang. | V: `call` printed "✓ Success" and was killed by a 15 s timeout (exit 124). | `await program.parseAsync()`, then `disconnect()` in a `finally`; `autoReconnect: false` for one-shot commands. |
| H8 | Python server · correctness | Batch and pipeline aggregation can raise after side effects (`server/factory.py:434-444,498-504`; `core/pipeline.py:827,886`). The pipeline's `except` path references `CommandResult`, which is never imported (ruff F821 → `NameError`). `PipelineCondition` has a `Dict[str, Any]` catch-all branch, so malformed `when` clauses fail mid-pipeline. | V: a nested `afd-batch` or a handler returning a plain dict gives `ToolError` after the writes. Parallel `gather` does not cancel siblings (a write completed 300 ms after the client got an error). | Import the missing name; coerce every item to `CommandResult`; validate conditions up front; use a TaskGroup that cancels siblings. |
| H9 | Python server · security | Discovery lists private commands: `afd-help`, `afd-docs` and `afd-schema` enumerate non-MCP-exposed commands with their schemas, and `afd-detail` (reachable via `afd-batch`) returns them in full (`server/factory.py:160,516`; `lazy_tools.py:99+`). | V. TS fixed the equivalent in #225. | Build the bootstrap commands from `list_exposed_commands('mcp')`. |
| H10 | Python server · security | Handler exception text is returned verbatim to remote clients and never logged (`server/factory.py:246-253`, `decorators.py:163-169`). Pydantic input errors surface as `COMMAND_EXECUTION_ERROR` with raw input values. | V: `"db password=hunter2 at /srv/app/db.py"` reached the client. | Log with a traceback; return a generic message outside dev mode; map `ValidationError` to `VALIDATION_ERROR` using the existing formatters in `server/validation.py`. |
| H11 | Python handoff · correctness | The handoff client does not work: WebSocket has no receive loop, SSE `connect` opens nothing, one failed reconnect sticks in `RECONNECTING` forever, `close()` during a reconnect leaves a live connection, and the token is placed in the URL (`handoff_client.py`). | V: a real WebSocket server sent a message and then closed; the client got 0 messages and stayed `CONNECTED`. | Reader tasks, reconnect generations, `_closed` rechecks after each `await`, and a kept task reference. |
| H12 | Rust · correctness | The wire format no longer matches TS/Python (`metadata.rs`, `batch.rs`, `result.rs`). Batches default to stop-on-error, `BatchResult.success` is always true, and `suggestions`/`undo*` are dropped. | V: TS JSON fails to deserialize (`missing field 'name'`, `unknown variant 'in_progress'`, `'caution'`, missing `id`). | Realign to `packages/core/src/{metadata,batch,result}.ts`; add golden fixtures (Theme 1); `#[non_exhaustive]` on public types. |
| H13 | testing · correctness | Fixture application ignores command failures and reports success (`testing/src/runner/fixture-loader.ts:282-300`). It also calls `todo.create`/`todo.toggle`, which do not exist, and double-wraps results. | V: against the real todo example, all 5 fixture commands return `COMMAND_NOT_FOUND`, yet fixture application reports success. The scenario then fails at the wrong step. `fixture-loader.test.ts:250-301` locks in the dot names. | Pass the real `CommandResult` through and fail on `!success`; delete the legacy `todo`/`violet` switch; add a test that seeds the real example. |
| H14 | testing · false greens | `isAssertionMatcher` returns true if **any** key is a matcher keyword, and the other keys are silently ignored (`testing/src/types/scenario.ts:214-231`). | V: `{user: {exists: true, name: 'Bob'}}` passes against `name: 'Alice'`, and typo'd matcher keys pass. | An object is a matcher only if all its keys are matcher keys; throw on mixed or unknown keys. |
| H15 | testing MCP tools · security | Unrestricted filesystem access. `ToolExecutionContext.cwd` is never enforced (`testing/src/mcp/tools.ts:56-62`; `commands/create.ts:350-374`; `commands/evaluate.ts:236-247`). | V: `scenario-create {name: '../escaped/evil'}` writes outside the target, `scenario-evaluate {output}` overwrites any path, and YAML parse errors echo other files' contents. A newline in `job` injects steps. The Python equivalent (`testing/commands/create.py:217-248`) has the same containment gap. | Resolve against `cwd` and reject escapes; strip source excerpts from parse errors; sanitize header comments. |
| H16 | examples · security | The examples teach insecure patterns. The todo-directclient `chat-server.ts` reflects any `Origin` (including `null`), binds to all interfaces, trusts `X-Forwarded-For`, and keeps an unbounded rate-limit map. Its `registry.ts` calls `cmd.handler(input)` with no Zod validation. Its frontend renders todo titles and LLM replies as raw HTML. | V: an evil origin gets reflected ACAO; the rate limit is bypassed by rotating XFF; `{"title": {"nested": true}}` is stored; `<img onerror>` titles are stored and rendered, so prompt injection becomes XSS. | Localhost-only defaults; a validating first-party DirectClient registry (Theme 4); `textContent` rendering. |
| H17 | examples · correctness | The Python todo backend cannot be used: dot-named, unexposed commands, and no `[build-system]`, so `todo-server` is never installed. `test:conformance:py` and `dev:py` both fail. | V. | Kebab-case names, `expose={"mcp": True}`, a build backend with a path dependency on `python/`; add it to conformance CI. |
| H18 | process | Python, Rust, the non-TS todo backends and alfred's checks run in no PR gate (Theme 1). | V: see `ci.yml`, `lefthook.yml`, `publish-python.yml`. C1–C3 and H8–H12 all shipped because of this. | Add the CI jobs listed in Theme 1. |

### Medium

**TypeScript core and server**

| Finding | Location | Status |
| --- | --- | --- |
| Bootstrap tools cannot be used with `createMcpServer`. `getBootstrapCommands()` returns core definitions with no `inputSchema` or `expose`; examples cast them `as unknown as`. Result: `afd-help` is never MCP-listed and `server.execute('afd-help')` throws. CLAUDE.md's "exposed via `afd-help`" is false. | `server/src/bootstrap/registry.ts:26-59` | V |
| `onCommand` runs inside the result `try`, so a throwing hook reports a completed write as failed. `runHandler` also mutates the handler's returned object: frozen results throw, and shared results are tagged across requests. | `server/src/execution.ts:101-127` | V |
| Pipeline resolution: `$` literals dropped; `$input` aliases the context; prototype walk; no depth limit (Theme 3). | `core/src/pipeline.ts:758-897`, `pipeline-executor.ts:121-148` | V |
| No request identity or abort signal reaches `CommandContext` from HTTP. The documented `rateLimit` examples never limit (keyed on `traceId`) or lock everyone out together (keyed on `userId`, which is never set). | `server/src/http-handler.ts:156-196`, `middleware.ts:443`, server README `:386` | V |
| The core `createCommandRegistry` is a divergent third executor: timeout ignored when `parallelism > 1`; exposure not checked in `executeBatch`/`executeStream`; `null` entries skipped; stacks leaked. Used by the testing MockServer. | `core/src/commands.ts:467-796` | V |
| `isCommandError` duck-typing accepts Node system errors, so paths serialize. `wrapError` puts stacks in `details`; `cause` serializes to `{}`. | `core/src/errors.ts:211-243` | V |
| The core root barrel pulls in `node:child_process` (connectors), so browser bundles fail. | `core/src/index.ts:64-70` | V |
| The HTTP transport does not conform to MCP: the `/sse` `endpoint` event is JSON rather than a URI; notifications get a response; protocol errors are not JSON-RPC; `protocolVersion` is hardcoded; `/sse` sockets are uncapped, with no heartbeat or timeout. | `server/src/http-handler.ts:88-147,229-257` | V |
| The default `toolStrategy: 'grouped'` advertises `params: {type: 'object'}` with no per-action schemas or `_meta`, and does not list `afd-detail`. JSDoc and README disagree on the defaults. | `server/src/tools.ts:233-281`, `server-types.ts:360` | V |
| `transport: 'auto'` (the default) picks stdio whenever stdin is not a TTY, so the HTTP port never opens under Docker without `-t`, systemd, pm2 or CI. | `server/src/server-types.ts:34`, `server.ts:205-213` | V |
| The server has no coverage thresholds and uses `globals: true`; `transport-parity.test.ts` tests the internal engine rather than a transport. | `server/vitest.config.ts`, `server/src/transport-parity.test.ts:7-9` | V |
| Duplicate and reserved command names are accepted silently: a duplicate is listed twice and the last one wins; a user command named `afd-call` is unreachable. | `server/src/server.ts:88-92` | V |

**Client, CLI and UI packages**

| Finding | Location | Status |
| --- | --- | --- |
| Server-controlled strings (errors, suggestions, reasoning, tool descriptions, stream data) reach the terminal raw, so OSC/CSI escapes are injectable. | `cli/src/output.ts:76,130`, `stream.ts:162`, `batch.ts`, `validate.ts` | V |
| DirectClient enforces no exposure and only shallow validation; `pipe` passes the caller's context as `$input`; step data is shared by reference. | `client/src/direct.ts:460-545,648-657`, `direct-validation.ts` | V |
| `batch()`/`pipe()` ignore their own timeout options and report transport errors as definite failures although the server may have run the writes. | `client/src/client.ts:309-428,641-678`, `result-parsing.ts` | V |
| `stream()`: a truncated stream ends as success; unbounded quadratic buffer; SSE spec gaps (`data:` without a space, multi-line events); a timeout is reported as cancellation; `disconnect()` does not abort streams; the base path is dropped. The parser is duplicated in `handlers.ts`. | `client/src/client.ts:457-591` | V |
| Browser WebSocket handshake failure (`error` then `close(1006)`) starts an orphaned background reconnect loop after the caller has already seen the rejection. | `client/src/handlers.ts:123-144`, `handoff.ts:450-474` | V (mock of browser event order) |
| The CLI assumes dot-separated command names for category filters, grouping and shell shorthand. | `cli/src/commands/tools.ts:40`, `validate.ts:213`, `shell.ts` | V |
| Confidence/progress bars throw `RangeError` outside [0, 1], after the command already succeeded. | `cli/src/output.ts:216`, `stream.ts`, `batch.ts`, `adapters/src/web-adapter.ts:159` | V |
| McpClient and DirectClient differ for the same situation: one throws where the other returns; `UNKNOWN_TOOL` has no `suggestion`; JSON-RPC errors become retryable `INTERNAL_ERROR` with a client stack; `DirectCallContext.timeout` is not enforced. | `client/src/*` | V |
| McpClient cannot talk to official-SDK MCP servers (406/400) but the README advertises it; `transport: 'direct'` throws. | `client/src/transport.ts`, `client.ts:722-752` | V |
| Unknown-name fuzzy matching in DirectClient (see H1). | `client/src/unknown-tool.ts:33-80` | V |
| The view-state persistence flush is not single-flight: the persisted value depends on network ordering; `destroy()` does not await in-flight flushes; any update error falls back to create. | `view-state/src/persistence.ts:20-55` | V |
| View-state commands declare no `expose` (zero MCP tools since #225), and its root entry hard-depends on `afd-server`. | `view-state/src/commands.ts`, `package.json` | V |

**Auth**

| Finding | Location | Status |
| --- | --- | --- |
| The middleware never checks `session.expiresAt`, so expired sessions are authorized. The Convex adapter invents a fixed 24 h expiry. | `auth/src/middleware.ts:199-220`, `adapters/convex.ts:46-52` | V |
| Listener fan-out has no per-listener isolation: one throwing subscriber stops later ones from seeing sign-out, and Mock `signOut()` rejects after succeeding. | `auth/src/adapters/{better-auth,mock,convex}.ts` | V |
| Convex credentials sign-in uses provider id `credentials` with no `flow`. The stock Password provider needs `password` and `flow: 'signIn'`. Convex also drops `redirectTo`, ignores `scopes`, and does no error mapping. | `auth/src/adapters/convex.ts:83-92` | V (traced against `@convex-dev/auth` 0.0.95) |
| Convex reports `unauthenticated` while `meQuery` is still loading, so signed-in users get non-retryable `UNAUTHORIZED`. | `auth/src/adapters/convex.ts:43-69` | V |
| `auth-sign-in` reads the session synchronously after `signIn` and returns stale `unauthenticated` state with the reasoning "Signed in". | `auth/src/commands.ts:262-268` | V |

**Testing package**

| Finding | Location | Status |
| --- | --- | --- |
| Scenario `timeout` uses `Promise.race` without cancelling, so the timed-out scenario keeps running mutations; the timer is never cleared; the error message is discarded. `failFast` drops skipped scenarios from the report. | `testing/src/commands/evaluate.ts:88-171` | V |
| Surface similarity is O(n²) with re-tokenization of every pair, and `push(...spread)` overflows the stack at around 600 commands. | `testing/src/surface/similarity.ts:127-206`, `validate.ts:216` | V |
| `additionalInjectionPatterns` replaces the built-in patterns instead of extending them, and patterns with the `/g` flag alternate between match and miss across calls. | `testing/src/surface/rules.ts:300`, `injection.ts:49-52` | V |
| Testing MCP tool schemas diverge from their implementations (ignored parameters, wrong enums and defaults); `validateInput` checks only that keys are present; the server replies to JSON-RPC notifications; the README is wrong in three places. | `testing/src/mcp/tools.ts:71-268`, `testing/README.md:148-167` | V |
| Directory-mode evaluation silently skips unparseable scenarios, so it exits 0 with "No scenarios to run". The default `scenario-create` template is itself unparseable. | `testing/src/commands/evaluate.ts:264-270` | V |
| `verify`, `isolation`, `dependsOn` and `timeout` scenario fields are parsed and never read (green runs with zero verification). Fixture paths resolve against `cwd`, not the scenario file. | `testing/src/parsers/yaml.ts:115-129` | V |

**Python**

| Finding | Location | Status |
| --- | --- | --- |
| The wire format is snake_case, and failures are sent with `isError: false`. | `core/batch.py`, `core/result.py`, `server/factory.py:629-637` | V |
| The MCP client turns TS failures into `TOOL_ERROR` (losing code and suggestion), drops metadata fields, rewrites `/message` to `/messages/`, never checks stream status, and never calls its reconnect. | `client.py:245-380`, `transports/_mcp_protocol.py` | V |
| The server telemetry sink defaults to `print`, which writes non-JSON lines into the stdio JSON-RPC stream. | `server/middleware.py:107` | V |
| Same-named public classes are different, incompatible types: `ConsoleTelemetrySink`, `PipelineStep`, `CommandContext`; `afd.Warning` shadows the builtin. | `afd/__init__.py`, `server/middleware.py:49-150` | V |
| Child processes are orphaned when the awaiting task is cancelled (including by batch deadlines). | `platform.py:272-290`, `testing/cli_wrapper.py:181-197` | V |
| `afd connect <name>` reports "✓ Connected" against an empty in-process server; `FastMCPTransport.run_async` calls a method that does not exist. | `cli/main.py:87`, `transports/fastmcp.py:182` | V |
| No lint, format, type or size gate applies: ruff reports 4,362 violations (including F821 ×2 and F841 ×4) and `mypy --strict` 167 errors; 11 modules exceed 500 lines. | `python/` | V |

**Rust**

| Finding | Location | Status |
| --- | --- | --- |
| A panicking handler aborts the whole batch or pipeline and loses completed results (no `catch_unwind`). | `commands.rs:729`, `pipeline.rs:1428` | V |
| The `wasm` feature adds no code, and `Instant::now()` traps on wasm32. | `Cargo.toml`, `streaming.rs:345`, `commands.rs:642`, `pipeline.rs:1308` | V |
| The registry enforces none of its metadata: no parameter validation, `expose`, timeout, middleware or context propagation. | `commands.rs:600-633` | V |
| Bootstrap commands cannot register into the registry they describe. | `bootstrap/mod.rs:21` | V |

**Alfred**

| Finding | Location | Status |
| --- | --- | --- |
| `parity` compares names only and its regex parser drops exports; `quality` skips every generic `defineCommand<...>(` call (43 of 68 example commands scanned) and walks `node_modules`. | `alfred/src/alfred/commands/parity.py:169-194`, `quality.py:74-80` | V |
| Tests import the repo's `afd` while the installed CLI pins PyPI `afd` 0.2.0. | `alfred/uv.lock`, `pyproject.toml` | V |

**Examples**

| Finding | Location | Status |
| --- | --- | --- |
| The Rust todo backend uses `CorsLayer::permissive()` with no Host check (DNS rebinding), ignores `expose`, is not an MCP server despite its README, and lacks the batch commands both frontends call. | `examples/todo/backends/rust/src/server.rs:38-41` | V |
| The todo file store uses non-atomic writes, and a parse error returns an empty store, so the next write erases everything. The default path is a git-tracked file (it was dirtied during this review). | `examples/todo/backends/typescript/src/store/file.ts:76,87`; `backends/python/src/server.py:131` | V |
| The TS todo CORS comment is false: the documented dev frontends get 403. | `examples/todo/backends/typescript/src/server.ts:57` | V |
| The chat example's side HTTP server calls handlers directly, with no body limit, `ACAO: *`, and binding to all interfaces. | `examples/chat/src/http-handler.ts:25-88` | V |

**Documentation**

| Finding | Location | Status |
| --- | --- | --- |
| Agent skills omit `expose: { mcp: true }`; the surface-validation reference disables injection checks; the directclient skill teaches unvalidated registries (Theme 8). | `.claude/skills/afd-typescript/SKILL.md`, `afd/SKILL.md`, `afd/references/{mcp-integration,surface-validation}.md` | V |

### Low

**TS server**

- Meta-tool arguments are cast without validation, so `afd-discover {search: 123}` gives HTTP 500.
- `GET /stream/<cmd>?input=` executes mutations, so link prefetchers can trigger writes.
- Dead code:
  - `PipelineStep.stream` and `onProgress` are never used.
  - "streaming" just slices the final array.
  - The `afd-call` `COMMAND_NOT_EXPOSED` branch is unreachable.
- Tool results are pretty-printed, and not-found suggestions list every command, which wastes tokens in lazy mode.
- The retry middleware backs off linearly although the comment says exponential, and it ignores `signal`.
- `zod` should be a peer dependency.

**TS core**

- `CommandResult` is not a discriminated union, so `success(undefined)` fails both `isSuccess` and `isFailure`.
- `createTimeoutController` never clears its timer.
- `exec()` buffers output without a bound and decodes chunks per buffer, which can split UTF-8 characters.

**Client / CLI**

- Config is written with mode 0644, the only way to pass auth is a token in the URL, and the transport is not persisted with the URL.
- Piped shell input exits before commands finish.
- `--stop-on-failure` cannot be disabled.
- Event emit iterates a live handler array.
- `connected` is emitted before the tools refresh.
- Backoff has no cap or jitter.
- HTTP transport never detects connection loss.

**local-db**

- `chat_messages` maps to `/chat/sessions`.
- Table names are neither own-property-checked nor URL-encoded.
- MemoryAdapter semantics differ from HttpAdapter.
- `batch()` is not atomic.

**adapters**

- `escapeHtml` returns non-strings unescaped and does not escape `'`.
- The package has no `typecheck` script or vitest config.

**auth**

- Session sync coalesces `signed-out` with later messages.
- `lockCheckDelayMs` is unused.
- A future timestamp locks refresh forever.
- The middleware blocks its own `auth-sign-in` by default.
- `context.auth` is untyped and not overwritten on excluded commands.
- `useConvexAuthAdapter` creates a new adapter on every render.

**testing**

- `testCommandMultiple` passes when an expected error does not occur.
- `scenario-suggest` is presented as "AI-powered" but is keyword matching with invented confidences and dot names.

**Python**

- DirectClient uses its own pipeline dialect, and `$prev.success` always skips the step.
- The rate-limit `windows` dict is never pruned.
- Each tool call rebuilds the router and calls `inspect.signature`: 25 µs at 10 commands, 246 µs at 1,000.
- Batches have no size or parallelism cap.

**Rust**

- `McpResponse.id` cannot be `null`.
- `McpContent` has no audio or `resource_link` variant.
- `success(Value::Null)` becomes neither success nor failure after a round trip.
- `CommandError` implements neither `Display` nor `Error`, and `thiserror` is unused.
- `HandoffCredentials` derives `Debug`, which prints the token.
- The README quick start does not compile.

**Repo**

- Three copies of Levenshtein similarity (`core/similarity.ts`, `client/unknown-tool.ts`, `rust/similarity.rs`) and a TF-IDF variant in testing.
- Three copies each of `getConfidenceBar` and `parseKeyValuePairs`; two SSE parsers.
- knip reports unused barrels (`core/src/connectors/index.ts`, `testing/src/commands/index.ts`, `testing/src/mcp/index.ts`) and an unused `@auth/core` devDependency.
- `@lushly-dev/local-db` breaks the `afd-*` naming convention.
- 326 of 1,025 tracked files are vendored generic skills under `.claude/skills`, most unrelated to AFD.
- Workflow actions are pinned to mutable tags rather than SHAs in a release job that holds `id-token: write` and an npm token.
- dependabot does not cover Cargo or the uv lockfiles.

## Metrics

| Metric | Value |
| --- | --- |
| TS source (non-test) lines, core + server | ~10.5k (tests 11.4k) |
| `packages/testing` | 11.6k source lines, 106 runtime exports + ~70 types |
| Largest TS files | `core/pipeline.ts` 965, `client/client.ts` 907, `core/commands.ts` 857, `testing/runner/executor.ts` 733, `server/middleware.ts` 737 |
| Largest Python modules | `core/pipeline.py` 974, `handoff_client.py` 880, `direct.py` 837 |
| Largest Rust files | `pipeline.rs` 2,213, `commands.rs` 1,235 |
| `as unknown as` (TS non-test) | core/server 8 (6 in bootstrap), client 3, CLI 1, testing 4, auth 1 |
| `any` (TS non-test) | 2 |
| Python broad `except Exception` | 41 (6 silently pass/continue) |
| `import afd` (Python, full extras) | ~285 ms, 436 modules |
| `import '@lushly-dev/afd-server'` | ~225 ms (core alone: ~23 ms) |
| Coverage (TS statements) | core 94.3, client 91.7, server 89.9 (no threshold), CLI 87.3 (mock-heavy), auth 84.9, testing 81.6, view-state 81.1 |

## Recommended plan

**Wave 0: release blockers (days)**

- **Python (patch release):** C1 import crash, C2 `getattr` traversal, C3
  `CommandError` duplication, H9 discovery leak, H10 exception leak.
- **TS server/core:** H1 fuzzy-match DoS (all three languages), H2 validation
  outside the `try`, H4 `shell: true`.
- **CLI:** H6 `afd validate` executing mutations, H7 hang.
- **Docs:** fix the skills that omit `expose: { mcp: true }`.

**Wave 1: gates that would have caught the above**

- Python CI: ruff, pytest on 3.10–3.12, per-extra clean install.
- Rust CI: test on the default and no-default feature builds, plus clippy.
- Coverage thresholds for `packages/server`; `typecheck` for `packages/adapters`.
- Two or three CLI end-to-end tests against a real server over SSE and HTTP.
- Golden wire fixtures round-tripped in TS, Python and Rust (Theme 1).
- Conformance runs for the TS and Python todo backends in CI.

**Wave 2: architecture**

- A single executor per language (Theme 2).
- A pipeline variable spec implemented identically in all three languages (Theme 3).
- A request-context hook plus per-session context state; a first-party
  validating DirectClient registry (Theme 4).
- A transport-free `defineCommand` entry point and a `core/connectors`
  subpath (Theme 9).
- MCP-conformant HTTP (Streamable HTTP via the SDK) on both server and
  client, or document the client as AFD-only.
- Generate input schemas in `io: 'input'` mode (H5).

**Wave 3: cleanup**

- Consolidate the similarity, SSE, output-formatting and batch helpers.
- Slim `packages/testing`: drop the legacy fixture switch, dot names, and
  unused parts of its MCP surface.
- Burn down the file-size overrides.
- Realign the Rust types; make the Python lint clean.
- Refresh the example security defaults.

## Remediation status

**Wave 0 fixes on the review branch:**

| Findings | Status |
| --- | --- |
| C1, C2, C3, H9, H10; H8 (missing import only) | Fixed with regression tests (Python 1,641 → 1,706 tests). Clean-venv base install verified. |
| H1 (TS server, DirectClient, Rust; Python fuzzy matching capped) | Fixed. The 879 KB `afd-detail` request went from about 22 s to 33 ms. |
| H2 | Fixed, with 18 route-level tests that fail on the old code. |
| H4 | Fixed with a cross-spawn-style escaper and mocked Windows tests. **Not yet exercised on real Windows.** |
| H6, H7 | Fixed, with CLI end-to-end tests against a real server over SSE and HTTP. |
| Theme 8: skills omit `expose` | Fixed in the TS skills; `error()` is now re-exported from `@lushly-dev/afd-server`. |

**Wave 1 (quality gates) on the second review branch:** Python, Rust and conformance CI; test-inclusive typecheck in every package (292 test type errors fixed); coverage thresholds for server, adapters and auth; SHA-pinned actions; H17 fixed. Two further items surfaced: the Python server rejects missing/mistyped MCP arguments with a raw FastMCP error before AFD validation (`python/src/afd/server/factory.py` `_build_input_model`), and Python results serialize unset fields as `null` alongside snake_case keys.

**Wave 2 (architecture) on the third review branch:** shared golden wire fixtures (`spec/wire`) round-tripped by TypeScript, Python and Rust (H12 and the Python wire drift fixed); one pipeline variable spec (`spec/pipeline-variables.md`) implemented in all three languages (Theme 3); per-session context and a `createContext` request hook (H3, Theme 4); JSON-RPC-conformant HTTP errors, notifications and capped SSE; input-mode schemas (H5); usable, validated bootstrap and meta-tools; `createDirectRegistry` for DirectClient; transport-free `@lushly-dev/afd-server/define` and core `/connectors` subpaths (Theme 9, root re-exports deprecated until the next major); the core registry shares the server's batch/stream executor (Theme 2); exposure resolves per flag everywhere.

**Follow-ups found while fixing:**

- `afd-detail` with a missing or non-string `command` still throws a `TypeError` (TS). Middleware exceptions on direct Python tool calls still reach FastMCP with their text.
- The TS server never emits `_meta.destructive`, so `afd validate --execute` can only skip `mutation: true` tools.
- `connect --no-reconnect` is now a no-op in the CLI. The dotted-name grouping in `printTools` and the shell shorthand remain.
- `mcp` must stay `<2` for the Python server (`mcp.server.fastmcp` was removed in 2.x).
- A Windows reviewer should manually verify:
  - `gh issue create` with a title containing `&`;
  - global `npm.cmd`/`pnpm.cmd` installs;
  - the testing `CliWrapper` against `.cmd` shims.

## Limits of this review

This is a repository review, not a penetration test. Windows-specific
command-injection findings were confirmed by mechanism, not on Windows. The
external OAuth and provider flows were checked against the installed
packages' source, not live providers. Performance figures come from single
local runs and show orders of magnitude, not benchmarks.
