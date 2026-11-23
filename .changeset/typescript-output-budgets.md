---
"@lushly-dev/afd-core": minor
"@lushly-dev/afd-server": minor
"@lushly-dev/afd-client": minor
---

Implement per-command output budgets (`spec/output-budgets.md`, rules B1–B8) across TypeScript core, server, and client (#1989):

- **`@lushly-dev/afd-core`**: Export `OutputBudget`, `AFD_OUTPUT_BUDGET_META_KEY`, and `MAX_OUTPUT_BUDGET_BYTES`; add `CommandDefinition.outputBudget`, `CommandContext.outputBudget`, `ResultMetadata["dev.afd/outputBudget"]`, and `JournalEntry.outputBudget`; validate `outputBudget` on `createCommandRegistry.register`, emit `_meta["dev.afd/outputBudget"]` in `commandToolMeta`, and include `outputBudget` in `createContextDigest` only when present.
- **`@lushly-dev/afd-server`**: Support `outputBudget` on `defineCommand` and `defineCommandWithSchema` (browser-safe `/define` and `/direct`), validate at definition and registration, reserve `outputBudget` in `contextFields`, read `_meta["dev.afd/outputBudget"]` across MCP `/mcp` and stdio (both eras), AFD HTTP lanes (`/message`, `/rpc`, `/batch`, `/stream`), meta-tools' `meta` argument (`afd-call`, `afd-batch`, `afd-pipe`), and `createDirectRegistry` `execute(..., { outputBudget })`, run the post-handler canonical-JSON check in `runHandler` (replacing over-budget reads with `OUTPUT_BUDGET_EXCEEDED`, appending a `caution` warning on over-budget mutations, attaching `metadata["dev.afd/outputBudget"]`, skipping B5 on buffered `executeStream`), report `outputBudget` in `afd-detail`, `afd-help` (`full`), and `afd-docs`, and record/restore `outputBudget` in the journal and `replayJournal`.
- **`@lushly-dev/afd-client`**: Add `outputBudget` call option to `DirectCallContext` and `DirectExecuteOptions`, forwarded by `DirectClient.call` and `DirectClient.pipe`.
