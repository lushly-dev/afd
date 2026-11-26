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

- **2, `pnpm base:sync`, resolving provenance records.** Merged in [#1606](https://github.com/lushly-dev/afd/pull/1606). [#1610](https://github.com/lushly-dev/afd/issues/1610)'s option 2: Botcore and FAST-AF no longer commit the `adaptations.json` digest, and Botcore's build stamps it into the wheel and sdist, in [#1658](https://github.com/lushly-dev/afd/pull/1658); the owner [decided on 2026-11-20](https://github.com/lushly-dev/afd/issues/1610#issuecomment-7034626046) not to ship provenance records in FAST-AF's npm packages for now. The owner [decided on 2026-11-22](https://github.com/lushly-dev/afd/issues/1610#issuecomment-7073040838) to do the same for Specimen and Violet, repository-only since neither ships its records, and to keep committing Botcore's mirror, in [#1916](https://github.com/lushly-dev/afd/pull/1916). Health has no `adaptations.json`; provenance-only merge gaps for Health, Violet and `lane-report` closed in [#2028](https://github.com/lushly-dev/afd/pull/2028). Left: nothing.

- **3, Changesets for Python, Botcore and the spec contract.** Merged in
  [#1613](https://github.com/lushly-dev/afd/pull/1613). First live uses of `pnpm version-track`
  merged on 2026-11-22: `lushly-botcore 0.8.0` via `pnpm version-track botcore` (22 fragments) in
  [#1938](https://github.com/lushly-dev/afd/pull/1938), and Python `afd 0.12.0` plus the
  `spec/CHANGELOG.md` fold via `pnpm version-track python` (13 fragments) and
  `pnpm version-track spec` (11 fragments) in [#2021](https://github.com/lushly-dev/afd/pull/2021).
  Left: nothing.

- **4, one line per step in the STATUS files.** Merged in [#1612](https://github.com/lushly-dev/afd/pull/1612)
  (`2026-11-19T07:42:53Z`): Loam, Umbel, Mail and software-factory reshaped, and the line limit at
  1,500 over five documents. The 1-week measurement ran on 2026-11-26: see Measure. Left: feature
  archive and epic closeout, tracked in [#2286](https://github.com/lushly-dev/afd/issues/2286).

- **5, merge queue.** On for `main` since 2026-11-19: a ruleset that squashes and requires
  `ci-ok` on the queue's commit. In three parts. [#1615](https://github.com/lushly-dev/afd/pull/1615): CI answers on a merge group (the
  trigger, the path gate, commit credit and the verdict on the queue's commit). [#1627](https://github.com/lushly-dev/afd/pull/1627): the
  factory's lane and gateway enqueue; the live lane was restarted on that code before the queue
  went on. [#1625](https://github.com/lushly-dev/afd/pull/1625): `prepare-pr`'s step 9 enqueues; it is the first pull request to land
  through the queue. Two trials on a throwaway branch are recorded in the plan. `release.yml` makes the commit of a
  version pull request it opened as that pull request's author ([#1643](https://github.com/lushly-dev/afd/pull/1643), for [#1624](https://github.com/lushly-dev/afd/issues/1624)). The first
  version pull request opened by the release App, [#1832](https://github.com/lushly-dev/afd/pull/1832), merged through the queue on 2026-11-22 with its credit check passing. Left: nothing.

## Measure

Commits touching each file over three days (the plan gives the exact window). The baseline is the
plan's table; the last column was filled on 2026-11-26, a week after pull request 4 merged.

The after window is as long as the baseline's (2 days 22 hours 34 minutes): from
`2026-11-23T09:03:03-08:00` to `2026-11-26T07:37:20-08:00`, ending at `54ada1064`. It holds 212
commits against the baseline's 178, so each count is also given as a share of its window's commits.

| File | Baseline, to 2026-11-18T20:04-08:00 (178 commits) | After, to 2026-11-26T07:37-08:00 (212 commits) |
| --- | ---: | ---: |
| `endpoints/loam/docs/STATUS.md` | 31 (17.4%) | 34 (16.0%) |
| Botcore's provenance records | 29 (16.3%) | 33 (15.6%): `adaptations.json` and its mirror; `provenance.json` 0 |
| `endpoints/botcore/CHANGELOG.md` | 25 (14.0%) | 2 (0.9%) |
| `docs/language-parity.md` | 21 (11.8%) | 29 (13.7%) |
| FAST-AF's provenance records | 16 (9.0%) | 12 (5.7%): `adaptations.json`; `provenance.json` 1 |
| `endpoints/umbel/docs/STATUS.md` | 16 (9.0%) | 15 (7.1%) |
| `docs/features/active/software-factory/STATUS.md` | 16 (9.0%) | 3 (1.4%) |
| `docs/features/active/todo-reference/STATUS.md` | 15 (8.4%) | Not measured: completed and moved |
| `docs/features/active/mail/STATUS.md` | 11 (6.2%) | 5 (2.4%) |
| `python/CHANGELOG.md` | 9 (5.1%) | 1 (0.5%) |
| Merges of `main` per pull request (100 merged 2026-11-15 to 2026-11-18, by commit headline) | 0.64; 40 of 100 had one or more | 0 of 100, which cannot be compared: see below |

[#2261](https://github.com/lushly-dev/afd/pull/2261) (for [#1803](https://github.com/lushly-dev/afd/issues/1803)) split Loam's and Umbel's STATUS into an index and archives inside the window, at 2026-11-24T02:42Z. It moved at most one edit out of the two counts: after it, no commit edited Loam's archives and one (`bd30d790b`) edited only Umbel's.

### Why the merge count cannot be compared, and what was counted instead

The after sample is the first 100 pull requests the search returned on 2026-11-26 for `is:pr is:merged merged:2026-11-23..2026-11-26 -author:app/dependabot`: numbered from #2495 to #2661 and merged from 2026-11-25T03:04Z to 2026-11-26T15:41Z. The baseline's 100, as the same search returns them now, merged from 2026-11-17T05:07Z to 2026-11-18T23:18Z, so each sample is its window's last day and a half.

Since [#1901](https://github.com/lushly-dev/afd/pull/1901) (2026-11-21) `pnpm branch:squash` folds a branch into one commit before every push, because the queue rebases. Each of the 100 pull requests holds one commit, so no merge of `main` is left for a headline to count.

Base-syncs were counted instead from every head a pull request was force-pushed from or to: a commit of `main` that a pushed head newly sat on (83), or that a head pushed before its fold had merged (6). That is 89 in 55 of the 100, at most 10 in one, 0.89 per pull request. It is a floor: a base moved before the pull request opened is not seen (a merge its first pushed head held is), and several syncs between two pushes count once. The baseline's 64 counted every merge on the branch.

Both windows were then replayed with `git merge-tree`, to see which base-syncs git could not merge by itself: a merge from its two parents, a moved head from the head pushed before it and the `main` it moved onto.

| Base-syncs that conflicted | Baseline, of 64 | After, of 89 |
| --- | ---: | ---: |
| On any path | 38, in 24 pull requests | 48, in 31 pull requests |
| On provenance records alone | 13 | 2 |
| Botcore's provenance records | 14 | 2 |
| FAST-AF's provenance records | 9 | 0 |
| Specimen's provenance records | 0 | 8 |
| `endpoints/botcore/CHANGELOG.md` | 3 | 0 |
| `python/CHANGELOG.md` | 1 | 0 |
| `docs/features/active/software-factory/STATUS.md` | 2 | 0 |
| `docs/language-parity.md` | 2 | 3 |
| `endpoints/umbel/docs/STATUS.md` | 3 | 2 |
| `endpoints/loam/docs/STATUS.md` | 6 | 20 |
| `foundations/specimen/CHANGELOG.md` | 0 | 6 |
| A file that is neither a record nor Markdown | 6 | 18 |

What the plan reshaped conflicts far less where it had: FAST-AF's records, the Botcore and Python changelogs and the software-factory STATUS not at all, and Botcore's records in 2 base-syncs against 14 (on records alone in 1 against 9), although they are edited as often as before. Umbel's STATUS and `docs/language-parity.md` conflicted rarely in both windows; Mail's STATUS in neither.

Conflicts did not fall in total. Loam's STATUS went from 6 to 20, and in every one of the 20 both sides added rows at the end of one session-log table (18 in "Sessions: every other area"), as two changelog entries under `[Unreleased]` conflicted. `foundations/specimen/CHANGELOG.md` is hand-written under `## Unreleased` and conflicts the same way (16 of its 19 commits insert after line 4).

The 18 outside records and Markdown are parallel work in one area, which no reshaping removes, mostly in Loam (7, of which 6 are the ceilings in `budget.mjs`, where two pull requests that raise one number do disagree), Specimen (6) and Python's server (5). [#2539](https://github.com/lushly-dev/afd/pull/2539) alone had 9 of the 48. Specimen's records conflicted beside its other files in 7 of their 8, since a record's row changes when its file does.

How often `pnpm base:sync` resolved records cannot be counted from commit messages, which the fold replaces. One pull request body says it did ([#2535](https://github.com/lushly-dev/afd/pull/2535)). By the replay it could have concluded at most 2 base-syncs by itself, those that conflicted on records only; the other 8 with a record also conflicted elsewhere, which a hand resolves first.

The queue adds a measure the baseline had none of: it removed these 100 pull requests 24 times for a merge conflict (16 pull requests) and 12 times for failed or timed-out checks (11).

## Follow-ups not yet issues

| Date | Raised by | Follow-up | State |
| --- | --- | --- | --- |
| 2026-11-26 | The 1-week measurement | Loam's session-log tables take every session's row at the same end, the file's most frequent conflict (20 of 89 base-syncs). Give each row its own insertion point, as Changesets did for the changelogs | Not filed: the owner's call |
| 2026-11-26 | The 1-week measurement | `foundations/specimen/CHANGELOG.md` is hand-written under `## Unreleased` (6 conflicts); `packages/rust/CHANGELOG.md` likewise (2) | Not filed: the owner's call |
| 2026-11-26 | The 1-week measurement | The plan's merge count reads 0 for any window after [#1901](https://github.com/lushly-dev/afd/pull/1901). A later measurement counts base-syncs from pushed heads, as Measure does, and the queue's `merge_conflict` removals | Not filed: the owner's call |
| 2026-11-26 | The 1-week measurement's review | Pull request 5's line above says the ruleset squashes; the queue rebases now (`prepare-pr`'s step 9) | Not filed: the owner's call |
