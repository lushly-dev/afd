---
"@lushly-dev/afd-server": minor
---

Fix four `afd-server` bugs:

- **Journal uncopyable-result handling (#865):** `createJournalMiddleware` now records a failed entry with the new exported `JOURNAL_RESULT_UNSERIALIZABLE` error code (and still reports the underlying error to `onError` without altering the live command return value or leaking the exception message) when copying a command's result to JSON throws or fails to produce a `CommandResult` object, instead of dropping the entry. `replayJournal` still executes such entries, attaches an advisory note that the original result could not be captured, reports `error` if the replayed result is also unserializable, `different` if it is serializable, and `same` (with the note) if a recorded-answer target returns the entry verbatim.
- **Lazy Zod error-map containment (#1170):** `applyContextFields` now keeps `safeParse`, lazy `parsed.error.issues` materialization, and `parsed.data` assignment inside its `try` boundary so a throwing Zod error callback resolves to the standard `VALIDATION_ERROR` result without running the command handler.
- **SkillCatalog RFC 3986 manifest boundary (#1984):** `SkillCatalog` now enforces `spec/mcp-resources.md` S2 under RFC 3986 §6.2.2 percent-encoding normalization, refusing percent-encoded dot segments that escape the skill directory, empty or dot trailing segments before `?` or `#`, and duplicate normalized file URIs.
- **Logging middleware output (#1540):** `createLoggingMiddleware` now calls `log(message)` with a single argument when `logInput` and `logResult` are off instead of passing a stray trailing `undefined`.
