---
"@lushly-dev/violet-core": minor
"@lushly-dev/violet-afd": patch
---

Harden Violet token writes, sequence allocation and in-memory transactions (#1957, #1958, #1973):

- `validateTokenId` now refuses token ids whose dot-separated segments are empty or contain characters outside `[A-Za-z0-9_-]`, in addition to the reserved object-key segments (`__proto__`, `constructor`, `prototype`). `token.add`, `token.override`, `token.copy` (on its target id, including an explicit empty `asTokenId`), `import.json` and `import.tree` (including with `tiers: true`) refuse unsafe ids with `VALIDATION_ERROR` and a suggestion before writing anything; `import.validate` reports them as errors; `export.tree` and the CSS/SCSS exports (`checkCssToken`) refuse legacy unsafe ids already in a store (including empty segments such as `space..m`) while `tokens.resolve`, `token.copy` (with a safe `asTokenId`) and `token.remove` still let callers inspect and clean them up (#1957).
- `Database.appendOperation` (taking `NewOperationRecord`) allocates a node's next operation sequence atomically with the insert on `MemoryDatabase`, `SQLiteDatabase`, `PostgresDatabase` (locking the node row `FOR UPDATE` and scoping active transactions via `AsyncLocalStorage`) and `OverlayDatabase.stagingView()` (reconciling staged sequences above base operations on read), and every writing command in `violet-afd` uses it so concurrent writes to one node never share a sequence (#1958). Custom `Database` adapters must implement `appendOperation()`; `doctor` checks for it and `import.json` fails closed with `INTERNAL_ERROR` if absent.
- `MemoryDatabase.transaction()` now snapshots all mutable store collections before running `fn()` and restores them on synchronous throws or async rejections, including nested savepoints, and isolates concurrent top-level transactions and outside writes where `AsyncLocalStorage` is available (#1973).
