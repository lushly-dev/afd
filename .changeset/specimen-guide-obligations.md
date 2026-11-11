---
'@lushly-dev/specimen': minor
---

Guide statements are their own obligation set, `guides@1`: `specimen-coverage` reports each statement's level (`verified` or `authored`) under `guides`, with its own counts, invalid claims and `complete`, and leaves `schema-partitions@1`'s results unchanged. A claim may name `guide:<id>`, and `claim()` takes a fourth argument, the check it runs: a story's guide claim is recorded only when its check holds, fails the story when it does not, and is invalid without one.
