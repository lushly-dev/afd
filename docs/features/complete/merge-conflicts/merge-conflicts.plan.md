# Merge conflicts: plan

Cut how often a pull request conflicts with `main`. Approved by the owner on 2026-11-19 (UTC) as five
pull requests. Progress is in [STATUS.md](STATUS.md); the epic is
[#1598](https://github.com/lushly-dev/afd/issues/1598).

## Why

`main` took 178 commits in three days. A few shared files are edited by almost
every pull request, and they are written so that unrelated edits land on the same line. Git then
reports a conflict although nothing the two branches did disagrees, and a session spends a
base-sync, a gate run and a push to say so.

## Baseline

Commits touching each file in three days, from
`git log origin/main --since='3 days ago' --name-only`. To count the same window again:
`git log 626187de --since='2026-11-15T21:30:00-08:00' --name-only`, which ends at `626187de`
(2026-11-18T20:04-08:00) and gives these figures over 178 commits:

| File | Commits | Why its edits collide |
| --- | ---: | --- |
| `endpoints/loam/docs/STATUS.md` | 31 | The decision-log row and the phase rows were each one table cell of hundreds of words that every step added to; summary sentences ("Steps 0a, 0b, 0c, 1 and 2 done") are rewritten by every step |
| Botcore's `provenance.json` and `adaptations.json`, and their packaged mirror | 29 each | Any Botcore edit changes one shared hash line |
| `endpoints/botcore/CHANGELOG.md` | 25 | Every pull request inserts at the same spot under `[Unreleased]` |
| `docs/language-parity.md` | 21 | Its "Updated" cell was one line holding every date since October |
| FAST-AF's provenance records | 16 | As Botcore's |
| `endpoints/umbel/docs/STATUS.md` | 16 | Summary sentences and shared rows |
| `docs/features/active/software-factory/STATUS.md` | 16 | As Umbel's |
| `docs/features/active/todo-reference/STATUS.md` | 15 | As Umbel's. The feature completed inside the window ([#1557](https://github.com/lushly-dev/afd/pull/1557)) and its file moved to `complete/`, so nothing edits it now: it is not reshaped and not measured again |
| `docs/features/active/mail/STATUS.md` | 11 | As Umbel's |
| `python/CHANGELOG.md` | 9 | As Botcore's changelog; `spec/CHANGELOG.md` conflicts the same way |

Merges of `main` into a branch, counted on 2026-11-18 over 100 pull requests merged from
2026-11-15 to 2026-11-18 (the first 100 GitHub's search returns for
`is:pr is:merged merged:2026-11-15..2026-11-18 -author:app/dependabot`): 40 of the 100 carried at
least one, 64 in all, at most 4 in one pull request, 0.64 per pull request. A merge of `main` is
counted by its commit headline: `Merge branch 'main'` or `Merge remote-tracking branch
'origin/main'`, `Merge commit '<sha>'` (how `start-session` merges the fetched base), or a
headline a session wrote that begins `Merge main` or `Merge origin/main`. Two merges of one
feature branch into another are left out. The headline is not checked against the commit's
parents, and not every merge resolved a conflict: the count is the base-syncs a branch needed
before it could merge.

## Ruled out

`merge=union` in `.gitattributes`. GitHub ignores it when it computes a pull request's
mergeability, and it would duplicate content in the one-line cells.

## The five pull requests

1. **Shrink the one-line cells.** In Loam's `STATUS.md` and `docs/language-parity.md`, a cell that
   every pull request added to names only the latest entry and links to the rest; history stays
   in the phase detail, the session log and git. `scripts/check-doc-lines.mjs` refuses a line over
   2,000 characters in those two files and holds the summary rows to lower caps of their own, so
   the cells cannot grow back; its policy, `scripts/policy/doc-line-limits.json`, can only be
   tightened. The rule is recorded where agents read it: no cell or sentence that every pull
   request edits.
2. **Resolve provenance records by command.** `scripts/provenance-merge.mjs` (#1410) resolves a
   merge whose only conflicts are provenance records, but only the factory lane ran it.
   `pnpm base:sync` fetches, merges `origin/main`, runs the provenance merge when the only
   unmerged paths are records and reports anything else; `prepare-pr`'s base-sync step and its
   `DIRTY` step use it. Afterwards, a question for the owner and not a change: could the
   per-manifest hash in `provenance.json` be computed at release, so the conflict disappears at
   its source?
3. **One changelog file per pull request, with Changesets** (the owner's decision: extend
   Changesets, not a separate `changes.d/` tool). Python, Botcore and the spec contract each get a
   private stub `package.json` that Changesets versions, and a script copies each new version to
   its real home. Python and Botcore still publish on their own tracks and tags. Nothing is
   published by this work: publishing is the maintainer's.
4. **One line per step in the STATUS files.** Summary sentences that every step rewrites go,
   the "Latest:" cells pull request 1 left included; each step edits only its own row. Loam,
   Umbel, Mail and software-factory (todo-reference has completed, as the baseline notes). It
   follows pull request 1 because both edit Loam's STATUS. It extends the line check to the other
   files and lowers the limit to what one entry needs once the summaries are gone, saying what
   becomes of long rows that were written once, such as session-log entries: grandfathered, or
   moved to the document that owns their detail.
5. **Merge queue** (the owner's decision: yes, after 1 to 4 land). `merge_group` is added wherever
   `ci-ok` depends on it, the commit-credit check runs on the queue's commit, and `prepare-pr`
   enqueues instead of merging directly. Until the queue is live the current merge rule stands.
   It landed in parts, since a queue turned on before CI answers on its commits blocks every
   merge: CI ready for `merge_group` (#1615), the factory's lane and gateway able to enqueue, then
   the queue itself with `prepare-pr`'s step 9.

   **Trials, 2026-11-19 UTC.** A ruleset required the queue on a throwaway branch cut from
   `main`, twice; the rulesets and the branches are deleted, and the pull requests are the
   record.

   - *First, #1617 to #1619.* Two enqueued two seconds apart merged 2 min 51 s and 7 min 37 s
     later, a third alone in 3 min 31 s. For a docs-only change every path-filtered workflow
     skipped its real jobs; for a one-line change in `python/`, the Python, Alfred, Botcore,
     Botcore factory and Health workflows and the TypeScript and Python conformance leg ran.
     The queue's squash kept a single commit's message; for two commits and a merge of the
     base it wrote the pull request's title and one bullet per commit, without the merge.
   - *Second, #1620 and #1621.* `enqueuePullRequest` with a wrong expected head was refused
     ("expected head oid does not match") and changed nothing; with the verified head it
     queued, and auto-merge was never enabled. A push to the queued pull request was refused
     by GitHub (its branch is locked while queued), and it merged at its old head. A pull
     request holding a commit by a second author got `Co-authored-by:` for that author in the
     queue's squash; `ci-ok` failed the group at its credit check and the pull request left
     the queue, still open, 50 seconds after it was enqueued.
   - *Not exercised:* a group failing in a suite, a timeout, a conflict with a pull request
     ahead, `dequeuePullRequest`, two lockfile changes, and the factory lane.

Order: 1, 2 and 3 are independent and start together; 4 follows 1; 5 is last. [STATUS.md](STATUS.md)
arrives with pull request 1, so 2 and 3 mark their own rows after they merge `main` with it.

## Rules for this work

- Merge only when CI is green and an independent review has approved that exact head:
  `gh pr merge --squash --match-head-commit <full sha>`, never GitHub auto-merge, until pull
  request 5 replaces this with the queue (then `prepare-pr`'s step 9 enqueues that head).
- After each merge, confirm it landed on `main` by content.
- Other sessions edit the same files while this lands. Pull requests 1 and 4 put their branches
  in conflict once; neither rewrites what their rows mean.

## Measure

A week after pull request 4 merges, count again and report: commits per hot file over a window of
the same length (the command above, with new bounds), and merges of `main` per pull request,
counted as in the baseline. The
figures go in
[STATUS.md](STATUS.md)'s Measure table beside the baseline.
