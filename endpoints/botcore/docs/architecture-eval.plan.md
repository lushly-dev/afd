# Botcore Architecture Evaluation — Potential Improvements

Cross-project analysis comparing Botcore and AFD patterns. Focused on architectural gaps where proven patterns from sibling projects could strengthen Botcore.

---

## 1. Per-Command Exposure Control

**Current state:** All commands in the namespace are available to any consumer. Once a command is registered, it is accessible via the `{name}-run` tool with no per-command gating.

**Pattern from AFD:** `ExposeOptions` per command — each command declares which interfaces it is available on (mcp, cli, palette, agent). MCP exposure is opt-in (false by default). The server checks exposure at execution time and rejects calls to unexposed commands.

**Proposed outcome:**
- Commands can declare visibility: `expose = {"mcp": True, "cli": True, "internal": False}`
- The `{name}-run` tool respects exposure — commands marked `mcp: False` are not executable via MCP
- The `{name}-start` tool only lists commands visible to the current interface
- Internal-only commands (used by other commands) are hidden from agent discovery
- Secure by default — new commands default to internal-only until explicitly exposed

**Why this matters:** As botcore is consumed by more plugins, not every command should be agent-visible. Dev debugging commands, destructive operations, and internal helpers need gating.

---

## 2. Structured Input Schemas for Individual Commands

**Current state:** Commands are Python async functions with typed parameters, but their schemas are not exposed to agents. The agent must read documentation to know what parameters a command accepts.

**Pattern from AFD:** Each command has a Zod/Pydantic input schema that is converted to JSON Schema for MCP tool definitions. The schema serves as both validation and documentation.

**Proposed outcome — hybrid approach:**
- Commands optionally declare a Pydantic input model
- The `{name}-docs` tool includes parameter schemas when available
- The `{name}-run` tool validates inputs against the schema before execution (when declared)
- No change to the 3-tool pattern — schemas enrich documentation, not tool enumeration

**Method:** A decorator or metadata attribute on command functions that associates a Pydantic model. The server factory reads this during namespace building and includes it in docs output. Validation happens inside `{name}-run` before dispatching to the command.

**Trade-off:** Adding schemas increases authoring burden. Keep it optional — commands without schemas work as before, commands with schemas get validation and richer docs.

---

## 3. Confidence and Trust Signals on Results

**Current state:** Commands return `CommandResult` with `success`, `data`, `error`, and `reasoning`. No confidence scoring or alternative suggestions.

**Pattern from AFD:** Every result carries `confidence` (0-1), `sources` (attribution), `alternatives` (other options considered), and `warnings` (non-fatal issues). These enable agents to make informed decisions about whether to auto-apply, ask for confirmation, or explore alternatives.

**Proposed outcome:**
- `success()` and `error()` accept optional `confidence`, `sources`, `alternatives`, `warnings`
- Agents receiving results can use confidence to decide next steps
- Low-confidence results prompt the agent to present alternatives rather than auto-applying
- Sources provide attribution for research and analysis commands

**Priority commands for confidence:** `research` (web results have variable quality), `dev_lint` (some findings are suggestions vs errors), `skill_status` (drift detection has degrees of severity).

---

## 4. Middleware Chain

**Current state:** No middleware system. Cross-cutting concerns (timing, logging, error handling) are implemented ad-hoc within each command or the server factory.

**Pattern from AFD:** Typed middleware functions wrap command execution. Applied in reverse order, each middleware can inspect input, modify context, measure timing, handle errors, or short-circuit execution. Built-in middleware covers logging, timing, retry, rate limiting, and telemetry.

**Proposed outcome:**
- `create_mcp_server()` accepts an optional middleware list
- Middleware wraps the `{name}-run` execution path
- Default middleware bundle: timing + structured logging + trace ID propagation
- Custom middleware for: rate limiting (prevent runaway agents), telemetry (track command usage), error normalization

**Method:** A middleware function takes `(command_name, input, context, next)` and returns `CommandResult`. The `next` callable invokes the next middleware or the command itself. The server factory composes middleware into a chain at startup.

---

## 5. Semantic Quality Validation for Commands

**Current state:** `skill_lint` validates skill documents (SK001-SK015). No equivalent validation for command definitions — duplicate names, ambiguous descriptions, or conflicting parameters go undetected.

**Pattern from Skills:** Jaccard similarity matrix across all skill descriptions, flagging pairs above a configurable threshold. Trigger uniqueness detection. Prompt injection scanning.

**Proposed outcome:**
- A `command_lint` pass validates the assembled namespace:
  - No two commands with descriptions similar enough to confuse an agent
  - No parameter name collisions across commands that could cause misrouting
  - Command names follow naming conventions (kebab-case, domain-verb pattern)
  - Descriptions are actionable (start with verb, include use-case guidance)
- Runs at server startup in dev mode (warnings) and in CI (errors)
- Integrates with existing `skill_lint` — one validation pass for both skills and commands

**Method — Similarity detection:** Tokenize each command's description, compute pairwise Jaccard similarity. Flag pairs above threshold (e.g., 30%). Report which commands need disambiguation. This catches the "two commands that do almost the same thing" problem before agents encounter it.

---

## 6. Prompt Security Scanning

**Current state:** No validation that skill content or command descriptions are safe from prompt injection.

**Pattern from Skills:** `scan_prompt_security.py` checks skill documents for patterns that could manipulate agent behavior — hidden instructions, role overrides, system prompt leaks.

**Proposed outcome:**
- Skill content is scanned during `skill_lint` for injection patterns
- Command descriptions are scanned during `command_lint`
- Plugin-contributed content is scanned at registration time
- Flagged content requires explicit acknowledgment to proceed

**Why this matters:** As the plugin ecosystem grows, third-party plugins could (intentionally or accidentally) include descriptions that manipulate agent behavior. Scanning at registration time is the right boundary.

---

## 7. Streaming / Progress Reporting

**Current state:** Commands run to completion and return a single result. Long-running operations (lint across a monorepo, full test suite, research queries) provide no intermediate feedback.

**Pattern from AFD:** `StreamChunk` types — data (partial results), progress (percentage + message), complete (final metadata), error (mid-stream failure). Delivered via SSE for HTTP transport, async generator for in-process.

**Proposed outcome:**
- Commands can yield progress updates during execution
- The `{name}-run` tool streams output chunks as they arrive
- Agents see intermediate results and can abort long-running operations
- Progress messages appear in real-time rather than after a long silence

**Method:** Commands that support streaming return an async generator instead of a single result. The server factory detects generator returns and streams chunks. Non-streaming commands work unchanged. The `{name}-run` tool buffers or streams based on the command's return type.

**Trade-off:** Streaming adds complexity to the execution path. Reserve for commands where latency exceeds ~5 seconds (test suites, research, large lint passes).

---

## 8. Batch and Pipeline Execution

**Current state:** The `{name}-run` tool executes arbitrary Python code, which can call multiple commands sequentially. No structured batch or pipeline primitive.

**Pattern from AFD:** `afd-batch` runs multiple commands in parallel with configurable concurrency and stop-on-error. `afd-pipe` chains commands with variable resolution (`$prev`, `$prev.field`, `$steps[n]`) and conditional execution.

**Proposed outcome — adapted for 3-tool pattern:**
- Pipeline support as a convention within `{name}-run` rather than a separate tool
- A `pipe()` helper function available in the execution namespace
- Variable resolution between steps (`$prev` pattern)
- Parallel execution via `asyncio.gather` for independent steps

**Method:** Add a `pipe(steps)` function to the execution namespace. Each step is a dict with `command`, `input`, and optional `when` condition. The pipe function resolves variables between steps and executes sequentially (or in parallel where declared independent). Returns an aggregate result with per-step outcomes.

**Why adapted, not copied:** AFD exposes batch/pipe as separate MCP tools because it uses individual tool registration. Botcore's single-run pattern means pipeline support is better as a namespace function than a new tool.

---

## 9. Multi-Tool Registration Automation

**Current state:** Users manually configure their AI tool to connect to a botcore MCP server. Each tool (Claude Code, Cursor, VS Code, Copilot CLI) has a different config format and location.

**Pattern from Skills:** Registration scripts detect installed AI tools and write appropriate config files. Handle transport selection, auth configuration, and idempotent re-runs.

**Proposed outcome:**
- `botcore register` command detects installed AI tools and writes MCP config
- Supports the stdio transport (primary for local dev tooling)
- Writes config to the correct location per tool
- Plugin-aware — registered server includes the full plugin namespace
- Idempotent — safe to re-run after installing new plugins

---

## 10. Undo Standardization

**Current state:** `undo.py` exists as a command module. Commands do not systematically declare undo capability.

**Pattern from AFD:** Results carry `undoCommand` and `undoArgs` fields. Any command that mutates state can declare how to reverse itself. The undo information is serializable — it works over MCP, not just in-process.

**Proposed outcome:**
- Mutation commands return undo metadata in their results
- The undo command can replay the declared undo operation
- Agents can offer "undo last action" without understanding the specific reversal logic
- Undo metadata flows through the result type, not a separate tracking system

---

## Priority Assessment

| Improvement | Impact | Effort | Priority |
|---|---|---|---|
| Per-command exposure control | High — security boundary as plugins grow | Medium | 1 |
| Semantic quality validation | High — prevents agent confusion | Medium | 2 |
| Middleware chain | High — eliminates ad-hoc cross-cutting code | Medium | 3 |
| Confidence and trust signals | Medium — enriches agent decision-making | Low | 4 |
| Prompt security scanning | Medium — protects against plugin injection | Low | 5 |
| Structured input schemas | Medium — improves validation and docs | Medium | 6 |
| Streaming / progress | Medium — UX for long-running commands | High | 7 |
| Multi-tool registration | Medium — reduces onboarding friction | Low | 8 |
| Batch and pipeline | Low — code execution already enables this | Medium | 9 |
| Undo standardization | Low — narrow use case currently | Low | 10 |
