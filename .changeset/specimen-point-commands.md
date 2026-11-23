---
"@lushly-dev/specimen": minor
"@lushly-dev/specimen-afd": minor
"@lushly-dev/specimen-cli": minor
---

Add `specimen-point`, `specimen-point-move`, and `specimen-point-check` (and matching `SpecimenBench` methods, CLI subcommands `point` / `point-move` / `point-check`, and warm-bench MCP tools in `endpoints/specimen-server`) to resolve `specimen:` pointer URIs or named targets through the shared two-step climb, persist bounded point records in `.specimen/points/pt-<12>.json` with zero-build CEM component/source info and loaded-file digests, move across relative levels (`parent`, `child`, `next`, `previous`, `component`), and detect stale references (`POINT_STALE`, `NO_SUCH_LEVEL`, `POINT_NOT_FOUND`, nearest-id `SPECIMEN_NOT_FOUND`) ([#2043](https://github.com/lushly-dev/afd/issues/2043)).
