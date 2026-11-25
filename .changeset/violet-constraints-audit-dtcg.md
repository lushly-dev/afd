---
"@lushly-dev/violet-afd": minor
---

Record audit events on `constraints.set` and round-trip node constraints in `export.tree` and `import.tree` DTCG files ([#2329](https://github.com/lushly-dev/afd/issues/2329), [#2330](https://github.com/lushly-dev/afd/issues/2330)):

- **`constraints.set`:** appends a `constraint_set` audit event via `db.addAuditEvent` using the command context's `now()` and `random()` for deterministic replay, recording the actor, target node, previous and new local constraint sets, and `merge` mode so constraint changes appear in `audit.list`.
- **`export.tree` and `import.tree`:** serialize each node's non-empty constraints in `$extensions["dev.lushly.violet"].constraints` in deterministic ID order with `dropped: []`, validate and restore them on `import.tree` (preserving rule IDs, `applyTo`, `severity`, `enabled`, `disabledReason`, and `config` including `contrast` and `ramp`), and fail closed with `VALIDATION_ERROR` on invalid or unsafe constraint definitions before writing any node.
