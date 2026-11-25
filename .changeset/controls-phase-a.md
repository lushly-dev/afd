---
"@lushly-dev/afd-view-state": minor
---

Add Controls, an agent's path to read and fill the form a person is looking at, in two new browser-safe entries of `@lushly-dev/afd-view-state` (#2487).

- **`@lushly-dev/afd-view-state/controls`:** `ControlRegistry`, where an application registers a synchronous handler for each control it lets an agent see (`read()` returns its kind, label, value, limits and choices; `write(value)` sets it) and names the screen and the command its form is for with `setScreen`. The registry issues each control a `rev` that changes whenever anything about the control changes, made of a counter and random bytes (`token` option for tests). Also the types `ControlHandler`, `ControlState`, `Control`, `ControlKind`, `ControlValue`, `ControlFormat` and `ControlChoice`.
- **`@lushly-dev/afd-view-state/controls/commands`:** `createControlCommands(registry, { expose })` returns `control-list` (paged, with an output budget), `control-set` (1 to 50 values, all or none, each with the `rev` it was read with; refuses secrets, controls the person could not change, a stale `rev`, a value the control does not take and a caller whose actor is `human`, with a `suggestion`, a `recovery` and every refusal in `details.refused`; reports `changed`, `unchanged`, `affected` and `missing`, and `undoCommand: 'control-restore'`), `control-restore` (puts back what a fill replaced, skipping with one of five reasons any control changed since) and `control-choices` (searches a long list of choices). They go to the in-app agent by default, `control-restore` to the command palette as well, and to MCP only with `expose`.
- The root entry and `/commands` are unchanged.
