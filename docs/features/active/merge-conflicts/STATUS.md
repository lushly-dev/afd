# Merge conflicts: status

Epic: [#1598](https://github.com/lushly-dev/afd/issues/1598). File new work for this area as its sub-issue.

Progress on the [plan](merge-conflicts.plan.md). This file is kept in the shape the plan argues
for:

- One row per pull request. A pull request edits its own row and no other line, so two of them
  never touch the same line.
- No sentence or cell summarizes the rows ("1 to 3 done"): read the State column.
- "Merged" means on `main`, with the pull request linked. A pull request marks its own row before
  it merges, so the row links the pull request, where GitHub shows the squash commit.

## Pull requests

| # | Work | State | Evidence | Left |
| --- | --- | --- | --- | --- |
| 1 | Shrink the one-line cells; the line-limit check | In review | Branch `lush/conflicts-plan` | Nothing |
| 2 | `pnpm base:sync`, resolving provenance records | In progress | Branch `lush/base-sync` | The owner question on computing the hash at release |
| 3 | Changesets for Python, Botcore and the spec contract | In progress | Branch `lush/changesets-private-tracks` | Nothing yet |
| 4 | One line per step in the STATUS files | Not started | None | Starts when 1 has merged |
| 5 | Merge queue | Not started | None | Starts when 1 to 4 have merged; turning it on in branch protection may be the owner's |

## Measure

Commits touching each file over three days (the plan gives the exact window). The baseline is the
plan's table; the last column is filled a week after pull request 4 merges.

| File | Baseline, to 2026-11-18T20:04-08:00 | After |
| --- | ---: | ---: |
| `endpoints/loam/docs/STATUS.md` | 31 | |
| Botcore's provenance records | 29 | |
| `endpoints/botcore/CHANGELOG.md` | 25 | |
| `docs/language-parity.md` | 21 | |
| FAST-AF's provenance records | 16 | |
| `endpoints/umbel/docs/STATUS.md` | 16 | |
| `docs/features/active/software-factory/STATUS.md` | 16 | |
| `docs/features/active/todo-reference/STATUS.md` | 15 | Not measured: completed and moved |
| `docs/features/active/mail/STATUS.md` | 11 | |
| `python/CHANGELOG.md` | 9 | |
| Merges of `main` per pull request (100 merged 2026-11-15 to 2026-11-18, by commit headline) | 0.64; 40 of 100 had one or more | |

## Follow-ups not yet issues

| Date | Raised by | Follow-up | State |
| --- | --- | --- | --- |
