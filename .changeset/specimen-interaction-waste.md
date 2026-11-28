---
'@lushly-dev/specimen': minor
---

The static build gates interaction support on waste instead of its 615,000-byte ceiling: almost all of it is third-party helpers (Testing Library, chai, Vitest's `expect`), so a routine bump of them no longer fails a consumer's build. A new `eager-interaction` waste check fails a build whose interaction support loads with every case, such as from a retained preview or a plugin. The shell keeps its 70,000-byte ceiling, since it is Specimen's own code. `formatBuildSizeDeltas(deltas)` renders `buildSizeDeltas`' rows as Markdown for a reviewer.
