# The session log as one file per session

- Date: 2026-11-27
- Area: every other area
- Pull request: [#2845](https://github.com/lushly-dev/afd/pull/2845), on `t3/loam-session-log-insertion-point`, for [#2665](https://github.com/lushly-dev/afd/issues/2665) under epic [#1598](https://github.com/lushly-dev/afd/issues/1598)

The session log's tables were the repository's most frequent merge conflict: every session added
its row at the end of one table, so any two open Loam pull requests conflicted there (20 of 89
base-syncs in the merge-conflicts epic's one-week measurement). Each session now records itself
in its own file in this folder, and the tables from 2026-11-23 to 2026-11-27 moved verbatim to
[STATUS.archive-2026-11-sessions-5.md](../STATUS.archive-2026-11-sessions-5.md). Umbel's log took
the same shape in the same pull request.

`scripts/check-doc-lines.mjs` gained a `directories` key, so every `.md` file in this folder is
held to the line limit without an entry per file in `scripts/policy/doc-line-limits.json`, which
every session would otherwise edit. `STATUS.md`'s rules and `prepare-pr`'s "No line that every
pull request edits" say where a session writes.

Verified on 2026-11-27: in a scratch repository, two branches cut from one base, each adding a
session file, merged cleanly and rebased cleanly in both orders; the same two sessions written as
rows at the end of the old table conflicted in all four. `node --test scripts/check-doc-lines.test.mjs`
passes, and `node scripts/check-doc-lines.mjs` passes on the tree.
