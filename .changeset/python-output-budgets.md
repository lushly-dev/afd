---
"afd-python": minor
---

### Added

- **Output budgets (`spec/output-budgets.md`, B1–B8)** across core, server, DirectClient, and journal (#1990):
  - `OutputBudget(default_bytes=..., max_bytes=...)`, `AFD_OUTPUT_BUDGET_META_KEY`, and `MAX_OUTPUT_BUDGET_BYTES` exported from `afd`, `afd.core`, and `afd.server`; `output_budget` declaration on `CommandDefinition`, `define_command`, and `@server.command`, validated at definition and registration.
  - Declaration surfacing in `_meta["dev.afd/outputBudget"]` on individual and hybrid first-class tools and grouped `_meta.actions` entries, plus `outputBudget` in `afd-detail`, `afd-help` (`full`), and `afd-docs`.
  - Per-call ask from MCP `_meta["dev.afd/outputBudget"]` (both eras over Streamable HTTP, SSE, and stdio), the meta-tools' `meta` argument (`afd-call`, `afd-batch`, `afd-pipe`), `context_hook`, and in-process `output_budget=` call options (`MCPServer.execute`, `CommandRegistry.execute`, `DirectCommandRegistry.execute`, `DirectClient.call`/`pipe`, `DirectCallContext`), validated before middleware with `context.output_budget: int | None` exposed to handlers and `output_budget`/`outputBudget` reserved in `check_context_fields`.
  - Post-handler B5/B6 check before metadata stamping measuring canonical JSON without `metadata`: attaches `metadata["dev.afd/outputBudget"]` on passing budgeted results, replaces over-budget reads with `ErrorCodes.OUTPUT_BUDGET_EXCEEDED`, keeps over-budget mutations with a caution warning, and applies per item in `afd-batch` and per step in `afd-pipe`.
  - Journal `outputBudget` field on `JournalRecord`/`JournalEntry`, included in the context digest only when present, and restored as the per-call ask in `replay_journal`.
