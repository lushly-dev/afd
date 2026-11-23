---
"afd-python": patch
---

### Fixed

- **`afd.core.wire.to_wire`** keeps `"data": null` on a `CommandResult`, a `StepResult` and a `PipelineResult` whose `data` was set to `None`, and still omits `data` that was never set, as TypeScript does. `success(None)` from a Python MCP server, its `afd-pipe` steps and its pipeline result now reach a client as `null`, not as absent. A pipeline that fails sends no `data` (#2073).
