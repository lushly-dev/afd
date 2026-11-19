# Merge conflicts: status

Epic: [#1598](https://github.com/lushly-dev/afd/issues/1598). File new work for this area as its sub-issue.

Progress on the [plan](merge-conflicts.plan.md). This file is kept in the shape the plan argues
for:

- One line per pull request, parted from the next by a blank line: git reports a conflict when
  two branches change neighbouring lines, as it does for one line. A pull request edits its own
  line and no other.
- No sentence summarizes the lines ("1 to 3 done"): read each line's state.
- "Merged" means on `main`, with the pull request linked. A pull request marks its own line before
  it merges, so the line links the pull request, where GitHub shows the squash commit.

## Pull requests

- **1, shrink the one-line cells; the line-limit check.** Merged in [#1605](https://github.com/lushly-dev/afd/pull/1605). Left: nothing.

- **2, `pnpm base:sync`, resolving provenance records.** Merged in [#1606](https://github.com/lushly-dev/afd/pull/1606). Left: the owner's
  answer on computing the digest at release, [#1610](https://github.com/lushly-dev/afd/issues/1610).

- **3, Changesets for Python, Botcore and the spec contract.** Merged in
  [#1613](https://github.com/lushly-dev/afd/pull/1613). Left: the first Python or Botcore release
  prepared with `pnpm version-track` is its first live use.

- **4, one line per step in the STATUS files.** Merged in [#1612](https://github.com/lushly-dev/afd/pull/1612): Loam, Umbel, Mail and
  software-factory reshaped, and the line limit at 1,500 over five documents. Left: the
  measurement, a week after it merges.

- **5, merge queue.** On for `main` since 2026-11-19: a ruleset that squashes and requires
  `ci-ok` on the queue's commit. In three parts. [#1615](https://github.com/lushly-dev/afd/pull/1615): CI answers on a merge group (the
  trigger, the path gate, commit credit and the verdict on the queue's commit). [#1627](https://github.com/lushly-dev/afd/pull/1627): the
  factory's lane and gateway enqueue; the live lane was restarted on that code before the queue
  went on. [#1625](https://github.com/lushly-dev/afd/pull/1625): `prepare-pr`'s step 9 enqueues; it is the first pull request to land
  through the queue. Two trials on a throwaway branch are recorded in the plan. `release.yml` makes the commit of a
  version pull request it opened as that pull request's author ([#1643](https://github.com/lushly-dev/afd/pull/1643), for [#1624](https://github.com/lushly-dev/afd/issues/1624)). Left: a
  version pull request opened by the release App has not been through the queue.

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
