# Execution Review: Quality Improvement Opportunities

> Generated 2026-02-20. Organized by effort level — start at the top, work down.

---

## Tier 3: Significant Effort (weeks, may touch architecture)

### 3.2 Add E2E tests for the demo app (Myoso)

**Gap**: The `demos/todo/` app integrates Convex, Gemini chat, MCP server, and a React frontend, but has no E2E tests verifying the full stack works together.

**Action**:
- Add Playwright tests in `demos/todo/e2e/`
- Test key flows: create todo via UI, create todo via MCP, chat with AI, toggle batch
- Use Convex dev instance for test isolation
- Run in CI with a separate workflow (slower, doesn't block core package CI)

**Why it matters**: The demo is the primary showcase. If it breaks silently, it undermines confidence in the framework. E2E tests also serve as living documentation of the integration story.

---

### 3.3 Add OpenTelemetry integration tests

**Gap**: `createTracingMiddleware()` exists but there are no tests verifying that spans are actually emitted with correct attributes, timing, and parent-child relationships.

**Action**:
- Use `@opentelemetry/sdk-trace-base` with an in-memory exporter in tests
- Verify span names match command names
- Verify error spans include error codes
- Verify pipeline execution creates parent-child span hierarchies

**Why it matters**: Observability middleware that isn't tested can silently break. In production, missing traces are invisible — you only discover the problem when you need the traces and they aren't there.

---

### 3.4 Harden the streaming implementation

**Gap**: Streaming types (`StreamChunk<T>`, `ProgressChunk`, etc.) are well-defined in core but the server-side streaming execution path and client-side consumption are less mature than the batch/pipeline paths.

**Action**:
- Add streaming command execution to `createMcpServer()` (currently commands return a single result)
- Implement `AsyncIterable<StreamChunk<T>>` as a handler return type
- Add client-side stream consumption to both `McpClient` and `DirectClient`
- Test backpressure, cancellation, and error mid-stream

**Why it matters**: Streaming is listed as a core capability (types exist, handoff protocol exists) but the execution path isn't complete. This is a gap between the type system's promise and the runtime's delivery.

---

## Tier 4: Strategic Investment (months, new capabilities)

### 4.1 Build the semantic quality validation system

**Gap**: Proposed in `docs/features/proposed/semantic-quality-validation/` but not implemented. As command registries grow, there's no automated way to detect duplicate descriptions, conflicting tool names, prompt injection risks, or poorly calibrated confidence values.

**Action**:
- Implement as a `@lushly-dev/afd-quality` package
- Lint rules: duplicate descriptions, missing suggestions on errors, confidence always 1.0 (miscalibration), overly generic command names
- Run as a CI step alongside `pnpm lint`
- Integrate with `afd validate` CLI command

**Why it matters**: This is the scaling story. At 10 commands, humans catch problems. At 100+, only automated validation works. Building this early establishes quality norms before they're needed.

---

### 4.2 Complete multi-language parity (Rust)

**Gap**: Rust implementation exists in planning/proposal stage but isn't at parity with TypeScript or Python. The `afd` crate, `CommandResult` types, and registry patterns are specified but not shipped.

**Action**:
- Implement `afd` crate with `CommandResult<T>`, `CommandError`, and registry
- Add Rust MCP server support (stdio transport first)
- Create a Rust version of the todo example for parity testing
- Publish to crates.io alongside npm packages

**Why it matters**: Rust is the target for the Mint Distribution Framework. Without a working Rust implementation, the distribution vision remains theoretical.

---

### 4.3 Build plugin discovery and lazy loading

**Gap**: Proposed in `docs/features/proposed/plugin-discovery/` and `lazy-loading-discovery/`. Currently all commands must be registered eagerly at startup. At scale (50+ commands), this creates cold-start overhead and makes it harder to compose servers from independent packages.

**Action**:
- Implement lazy command registration (schema loaded eagerly, handler loaded on first call)
- Add entry-point-based plugin discovery (`package.json` `"afd"` field)
- Support `afd install <plugin>` for adding command packages

**Why it matters**: This is the ecosystem play. Without plugin discovery, every AFD server is a monolith. With it, commands become composable packages — the npm model applied to agent tooling.
