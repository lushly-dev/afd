---
name: sweep-bloat
description: >
  Ranks oversized and copied code by size and churn, then splits the worst few in
  one PR. Use for a scheduled bloat sweep, "files are too big" or duplication;
  `check` only reports.
argument-hint: "[check] [area:<name>] [budget:<n>]"
metadata:
  source: botcore
  version: 1.0.0
  portable: true
---

<!-- Generated from skills/exports.json; edit the canonical bloat-sweeper skill. -->

# Bloat sweeper

A commit gate that blocks at the review threshold makes every feature stop and split
the file it is growing. This sweep takes that job instead: the commit only guards
runaway growth (`file_size_error`, 1,500 lines is a good value), and a periodic pass
finds what has grown, judges it, and fixes a few items with the time to do it well.
It only works if every pass ends with fixes on their way to the main branch and a
recorded measurement, so it fixes instead of filing.

| Argument | What runs |
|---|---|
| _(none)_ | Measure, record, fix the top items in one PR, report. |
| `check` | Measure and report candidates. Records and fixes nothing. |
| `area:<name>` | Work in that area instead of the one the report names. |
| `budget:<n>` | Act on at most `n` items (default 3). |

Act on at most the budget. Ranking forces the comparison that matters, which item is
worse; the next pass finds the rest again.

## 1. Measure and record

Start on a fresh branch off the main branch, then from the repository root:

```bash
node <this skill>/scripts/sweep.mjs trend             # earlier passes and the verdict
node <this skill>/scripts/sweep.mjs bloat --record    # this pass; --area <a> to choose
```

`bloat` ranks files at or over `file_size_warn` by lines past it times (1 + commits
in `churn_days`), so the big file people keep editing comes first. It lists code
copied between files, widest spread first, marks anything an open pull request
touches, and names an area: the nearest package (a directory with `package.json`,
`pyproject.toml`, `Cargo.toml` or `go.mod`) holding the top free file. `--record`
comments the measurement on the trend issue before anything changes, so the log
shows the main branch as daily work left it.

Settings are under `[sweep]` in `botcore.toml` (`[tool.botcore.sweep]` in
`pyproject.toml`): `trend_issue` (an open issue, needed for `--record` and `trend`),
`cohesive` (default `sweep-cohesive.json`), `exclude` (path prefixes),
`churn_days` (90), `extensions`, and `measures`: a command printing the
repository's own measures, such as bundle chunk sizes, as
`{"measures": [{"key", "label", "value"}], "lines": [...]}`. Those join the report
and the trend.

If `trend` says **NOT KEEPING UP**, a measure has risen three passes running and
deferral is losing. Still do the pass, then put the decision to the owner with a
recommendation: a larger budget, a second pass each week, or a per-commit check for
that one measure.

## 2. Choose

Take the top `budget` items in the named area, in this order:

1. **Copies in three or more files.** Agents copy what they find, so a spreading
   pattern is the one kind of bloat that gets more expensive each week.
2. **Oversized files**, top of the ranking first.
3. **The repository's own measures**, when `measures` reports them: a chunk every
   visit downloads that the first screen does not need, or a chunk far larger than
   its feature warrants. Growth from new features is expected and is not a finding.

Skip anything the report marks with an open pull request: a refactor under
someone's open diff costs them a conflict.

## 3. Judge before cutting

Size flags a file; it does not convict it. For each oversized candidate, name the
seam: which responsibility moves, and what stays. A file with one job that takes many
lines (a barrel, a table of definitions, one state machine) has no seam. Record it in
the cohesive file as `"<path>": { "lines": <now>, "reason": "<the one job>" }` and
take the next candidate; the report stops ranking it until it grows by a fifth.
Moving a template or a style block to a sibling file to shrink a number is not a fix;
it leaves the same component in two places.

For a copy, the fix is one shared helper and every copy in the area replaced. If the
copies differ in ways that matter, they are not one thing: leave them.

## 4. Fix with behavior unchanged

- Existing tests pass without edits. Where the code that moves has no test, commit a
  test of its current behavior first, then move it.
- Leave command schemas, a package's public exports, stored data and component APIs
  as they are. A change to any of them is a feature, not a cleanup.
- One commit per item, one PR for the pass, through the repository's usual PR flow.
- A file under a provenance record (imported source the repository tracks by hash)
  needs that record updated when it is split; the repository's AGENTS.md names the
  script.

A seam you named but did not cut goes on the trend issue as one checklist line.
File nothing else: the next measurement finds the rest again.

## Report

Also posted as a comment on the trend issue once the PR is open:

```markdown
## Bloat sweep: <area> (<date>)

- Fixed: <item, what moved where> (PR #n) | none
- Judged cohesive: <file, its one job> | none
- Left for a later pass: <seam> | none
- Trend: holding | NOT KEEPING UP (<measure>, decision put to the owner)
```
