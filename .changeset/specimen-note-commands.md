---
"@lushly-dev/specimen": minor
"@lushly-dev/specimen-afd": minor
"@lushly-dev/specimen-cli": minor
---

Add Pointing Slice 2 pinned notes lifecycle and orphan detection (`specimen-note-add`, `specimen-note-list`, `specimen-note-check`, `specimen-note-move`, `specimen-note-resolve`, and `specimen-note-reopen`, plus matching `SpecimenBench` methods, CLI subcommands, and warm-bench MCP tools in `endpoints/specimen-server`) storing committed notes under `specimens/notes/note-<12>.json` with zero-browser listing/resolution/reopening, orphan/weakened/unchecked/restored detection, move and reopen history preservation, and typed errors (`NOTE_EMPTY`, `NOTE_NOT_FOUND`, `REASON_REQUIRED`, `NOTE_ALREADY_RESOLVED`, `NOTE_NOT_RESOLVED`, `POINT_STALE`) ([#2044](https://github.com/lushly-dev/afd/issues/2044)).
