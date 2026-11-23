---
"lushly-botcore": minor
---

### Added

- **Health 1.0 trend measures producers in `bloat-sweeper` and `gate-discipline` skills:**
  - `bloat-sweeper/scripts/sweep.mjs` adds `--measures-out <file>` (optional `--target <id>`) and `toMeasuresDocument()` to emit `schema_version = "1.0"` Health measures for oversized files, largest source file, duplicated lines, clone groups, spreading clones, cohesive exemptions and repository `[sweep] measures`.
  - `bloat-sweeper/scripts/cognitive-complexity.mjs` records per-function Sonar-style cognitive complexity across JS/TS, Python, Rust and C++ as an advisory trend only (always exits 0; `--measures-out <file>`).
  - `gate-discipline/scripts/report-test-changes.mjs` adds `--measures-out <file>` and `toMeasuresDocument()`.
  - `gate-discipline/scripts/report-test-counts.mjs` counts tracked test files, tests, assertions, skips, unconditional skips, scenario files/steps, quarantined files and discovery exemptions and writes Health 1.0 measures.
  - `gate-discipline/scripts/report-coverage-measures.mjs` reads Istanbul (`coverage-summary.json`, `coverage-final.json`), Python `coverage.py` JSON and LCOV (`lcov.info`) artifacts and emits weighted totals plus per-unit Health 1.0 measures (#1387).
