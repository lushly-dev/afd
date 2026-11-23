---
"@lushly-dev/afd-client": minor
"@lushly-dev/afd-server": minor
---

Add browser-safe result-state normalisation (`normalizeResultState`, `loadingResultState`) and full `DirectRegistryCommand` metadata (`confirmPrompt`, `examples`, `requires`, `tags`) across `@lushly-dev/afd-client` and `@lushly-dev/afd-server` (#2274).

- **`@lushly-dev/afd-client` (root and `/direct`):** Export `normalizeResultState` and `loadingResultState` (plus `NormalizedResultState`, `SettledResultState`, `LoadingResultState`, `ReadyResultState`, `EmptyResultState`, `ErrorResultState`, `ResultEnvelopeFields`, `NormalizeResultOptions`, `ResultStateStatus`, `DirectCommandSummary`, and `UnknownToolFailureResult`) to map command results into `loading`, `ready`, `empty`, or `error` states without dropping any `CommandResult` field. Narrow `DirectClient.call()`'s unknown-tool failure arm to `UnknownToolFailureResult`, preserve `DirectCommandSummary[]` metadata on `DirectClient.listCommands()`, and keep `DirectTransport.listTools()` spec-compliant (`title` at top level, display-only `confirmPrompt`/`tags` excluded from `_meta`).
- **`@lushly-dev/afd-server` (root and `/direct`):** Carry `confirmPrompt`, `examples`, `requires`, and `tags` on `DirectRegistryCommand` returned by `createDirectRegistry().listCommands()`.
