---
"@lushly-dev/specimen": minor
"@lushly-dev/specimen-afd": minor
"@lushly-dev/specimen-cli": minor
---

Implement Patterns Phase B Step B3 (#2146): synthesize native gate cases (`<case>--gate--<gate>`) from native specimens and play-free retained stories bound via `patternSetup` / `contexts`, extend `specimen-list` with `kind`, `component`, `pattern`, `match`, and `limit`/`after`/`next` cursor pagination, execute portable pattern gates natively in `specimen-host` and `specimen-run` (single-id defaulting `capture: 'none'`, suite `filter.kind`/`filter.pattern`, pre-launch `out-of-context` checking, and `SuiteRun.counts.outOfContext`), add `patterns@1` coverage (`patternLibrary`, leaving `schema-partitions@1` and `guides@1` unchanged), extend `specimen-suggest` with `pattern:*` setup stubs (component and tagless), skip synthesized gate cases by default in `specimen-capture` (`skipped.gates`, `gatesNext: 'specimen-run'`), and upgrade `fixtures/pack-library/{select,field}.js` stubs with `delegatesFocus`, keyboard navigation, text editing, and form validity (P0-4).
