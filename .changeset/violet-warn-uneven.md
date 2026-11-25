---
"@lushly-dev/violet-core": minor
"@lushly-dev/violet-afd": minor
---

Implement Scales Phase 3 (Slice 2, [#2198](https://github.com/lushly-dev/afd/issues/2198), epic [#1111](https://github.com/lushly-dev/afd/issues/1111)):

- **`@lushly-dev/violet-core`:** Add optional `warnUneven: { maxRatioSpread, ignoreAbove? }` (`RampWarnUnevenSchema`) to `RampConfigSchema` (`type: 'ramp'`); add `'ramp:uneven'` to `ADVISORY_VIOLATION_CODES` and evaluate unit-matched positive ramp steps matching `config.ramp` (excluding steps `> ignoreAbove`), emitting advisory `'warning'` violations on each upper step whose adjacent ratio exceeds `min(r) * maxRatioSpread`; sort `validateConstraints` results deterministically by token id.
- **`@lushly-dev/violet-afd`:** Validate `warnUneven.maxRatioSpread > 1` in `validateConstraintSemantics` (returning `VALIDATION_ERROR` with a field-specific `suggestion` naming `maxRatioSpread` in `constraints.set` and `import.tree`, and refusing invalid stored constraints in `export.tree`); tighten `import.tree`'s strict schema to reject unrecognized nested `warnUneven` fields; move and run scenario `08-warn-uneven-ramp-jumps.scenario.yaml` in `scenarios/scales.scenarios.test.ts`.
