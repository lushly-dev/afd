---
"@lushly-dev/specimen": minor
"@lushly-dev/specimen-afd": minor
---

Implement Patterns Phase B Step B5 Slice 1 ([#2147](https://github.com/lushly-dev/afd/issues/2147)): bump Pack Format to version 2 (`PACK_FORMAT_VERSION = 2`) with `pattern` and `copy` schemas (`@lushly-dev/specimen/pack/{pattern,copy}.schema.json`), optional component `patterns[]`, format 2 catalog `patterns[]`/`copies[]`, uniform format 1 + format 2 reader compatibility, 4 new `checkPack` problem codes (`PATTERN_MISMATCH`, `COPY_MISMATCH`, `PATTERN_UNKNOWN`, `COPY_UNKNOWN`), `PATTERN_SETUP_MISSING` build refusal, pattern-only app pack support, and per-error recovery suggestions in `@lushly-dev/specimen-afd`.
