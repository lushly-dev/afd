# Violet in Loam: status

Epic: [#1556](https://github.com/lushly-dev/afd/issues/1556). File new work for this area as its sub-issue.

Read this before the [proposal](violet-app.proposal.md). It records exactly what is done and what is
not, so an agent never has to scan the code to learn what is current. It follows the shape of the
[Pointing status](../pointing/STATUS.md).

## How to keep this file

- "Done" means merged to `main` with evidence linked. Anything else is "in progress" or "open",
  with what remains spelled out.
- Record how you verified it, the command or check, and the absolute date.
- Write down follow-ups that are not yet issues, with the date and who raised them. Link the issue
  when one exists.
- Never delete history. Mark an entry superseded and point to what replaced it.

## Status block

- **State:** active — approved by the owner on 2026-11-16, every recommendation accepted; moved from
  `proposed/` to `active/` on 2026-11-21 after the seven `violet-afd` gaps merged in
  [#1942](https://github.com/lushly-dev/afd/pull/1942). Epic
  [#1556](https://github.com/lushly-dev/afd/issues/1556) remains open: none of the four exit
  criteria in [section 10](violet-app.proposal.md#10-exit-criteria) are met yet
  (`endpoints/loam/plugins/violet/` does not exist). Last verified 2026-11-21 against `main` at
  `9e2aff93`. (Proposal written 2026-11-15 against `main` at `6eeb545d`.)
- **Done:** what exists today, verified first-hand with file and line; fifteen jobs as scenario
  files that pass the three checks; a recommended app kind; the `violet-tree` document type;
  screens by part and layout class; twenty-two drafted commands; ten gaps (G1 to G10); the
  dependencies; the home and tests; five questions for the owner with recommendations; the seven
  `violet-afd` gaps (#1322 to #1328, merged in [#1942](https://github.com/lushly-dev/afd/pull/1942)).
- **Not done:** moving Loam's tree from TypeScript to DTCG files
  ([#1974](https://github.com/lushly-dev/afd/issues/1974), question 3); then a specification in
  `endpoints/loam/plugins/violet/docs/`, and building the first slice (`slice` scenarios) in
  `endpoints/loam/plugins/violet/`.
- **Order:** the [jobs-first guide](../../../../.claude/skills/afd/references/jobs-first.md),
  steps 1 to 6 done, with one walk; step 9, the owner's ranking, done 2026-11-16; the `violet-afd`
  gaps merged 2026-11-21; moving Loam's tree to DTCG files ([#1974](https://github.com/lushly-dev/afd/issues/1974))
  and the specification next.

## Steps

| Step | State | Evidence |
| --- | --- | --- |
| What exists today, read first-hand | Done 2026-11-15 | Proposal, [section 2](violet-app.proposal.md#2-what-exists-today) |
| Jobs and drafted commands | Done 2026-11-15 | Proposal, sections 3 and 5 |
| Each job as a scenario, and the three checks | Done 2026-11-15 | [`scenarios/`](scenarios/), fifteen files, 61 steps; [How the jobs were checked](#how-the-jobs-were-checked) |
| Walk the paths with a reader who did not write them | Done 2026-11-15: one fresh reader, three seats; six blockers and eleven improvements, all applied; three jobs and four commands added | Proposal, [section 8](violet-app.proposal.md#8-what-the-walk-changed) |
| The owner ranks the jobs and answers section 12 | Done 2026-11-16 | Every recommendation accepted; proposal, [section 12](violet-app.proposal.md#12-for-the-owner) |
| The seven gaps in `violet-afd`: G1 #1322, G2 #1323, G3 #1326, G4 #1327, G8 #1328, G9 #1324, G10 #1325 | Merged 2026-11-21 in [#1942](https://github.com/lushly-dev/afd/pull/1942) | `export.tree`, `interface.check`, `token.remove`, the context's `now()` and `random()`, `INVALID_TOKEN_VALUE` on write, import and CSS export, alpha in contrast, `disabledReason`; `pnpm -F @lushly-dev/violet-afd test` 780 passed and `pnpm -F @lushly-dev/violet-core test` (its unit config) 191 passed; Loam's tree round-trips through `export.tree` and `import.tree` with the same values and files (an ad hoc check against `buildLoamTree()`) |
| Write-path hardening in `violet-core` and `violet-afd`: unsafe token ids (#1957), atomic operation sequence (#1958), `MemoryDatabase.transaction()` rollback (#1973) | Merged 2026-11-22 in [#2090](https://github.com/lushly-dev/afd/pull/2090) | `validateTokenId` refuses non-CSS and empty segments on `token.add`, `token.override`, `token.copy`, `import.json`, `import.tree`, `import.validate`, `export.tree` and CSS/SCSS export; `Database.appendOperation` allocates sequences atomically in Memory, SQLite, Postgres (`FOR UPDATE`) and `OverlayDatabase.stagingView()`; `MemoryDatabase.transaction()` snapshots, isolates and restores all mutable collections (including nested transactions); `pnpm verify` 24/24 local gates green on Node 26.13.1 |
| Move Loam's tree from TypeScript to DTCG files (question 3) | Open ([#1974](https://github.com/lushly-dev/afd/issues/1974)) | Unblocked by [#1942](https://github.com/lushly-dev/afd/pull/1942); includes measuring Loam's DTCG payload against the 256 KiB bound |
| Specification, in the plugin's folder | Open, after [#1974](https://github.com/lushly-dev/afd/issues/1974) | |
| Build: the first slice (`slice` scenarios) | Open | |

## How the jobs were checked

On 2026-11-15, at `6eeb545d`, on Node 26.13.1, after `pnpm install --frozen-lockfile` and
`pnpm -F "@lushly-dev/afd-cli..." build`:

- `node packages/cli/dist/bin.js scenario validate docs/features/proposed/violet-app/scenarios`:
  all fifteen valid (rerun after the walk).
- `validateScenario` with `checkFixtures: true` on each file: no errors.
- `scenarioCoverage` with the twenty-two drafted commands plus `document-create`, and the
  eight error codes: 15 scenarios, 61 steps; commands 23 of 23 tested, none untested; errors 8 of
  8 tested; nothing called that is not drafted.

## Dependencies

| On | State | What it gates |
| --- | --- | --- |
| Loam phases 1 and 2 (native apps, documents, SDK, test kit) | Exited 2026-11-02 and 2026-11-09 | Nothing: the first slice is buildable now |
| Loam phase 6, step 11 (the desktop lane's mounts) | Merged 2026-11-17 in [#1337](https://github.com/lushly-dev/afd/pull/1337) (`endpoints/loam/docs/STATUS.md`) | Running the app in the desktop Loam; `stdio` mounts for the later engine |
| Loam phase 5 (`calls`, plain mounts, mounted document types, the copilot) | Specification approved 2026-11-17 ([#1358](https://github.com/lushly-dev/afd/pull/1358)); steps 0a–0c and 1–2 merged, steps 9–10 not started | The mounted engine (question 2) |
| Loam's plugin-engine specification (Mail's L5) | Decided as D148 in phase 5's specification ([#1358](https://github.com/lushly-dev/afd/pull/1358)); step 9 not started | The mounted engine, as an alternative to phase 5's `calls` |
| Violet gaps G1, G2, G9 and G10 in `violet-afd` | Built 2026-11-21 in [#1942](https://github.com/lushly-dev/afd/pull/1942) (see Steps) | The slice: tree export, the interface check, replay and safe values |
| The Violet session working on `violet-elements` and packaging (#1195, #1297) | Both merged; further work may be in flight | Any change to Violet's code here waits for it |

## Follow-ups not yet issues

| Date | Raised by | Follow-up |
| --- | --- | --- |
| 2026-11-15 | This proposal | Superseded 2026-11-16: filed as #1322 (G1), #1323 (G2), #1326 (G3), #1327 (G4), #1328 (G8), #1324 (G9) and #1325 (G10) |
| 2026-11-15 | This proposal | `violet-server` answers no `afd-help` or `afd-detail`, so Loam cannot discover it as an AFD server (G5 to G7). Partially covered by [#1781](https://github.com/lushly-dev/afd/issues/1781); full AFD-server rebuild stays here until the later mounted step |
| 2026-11-15 | This proposal | Superseded 2026-11-16: the `violet` row of Loam's first-party apps is amended in #1314 |
| 2026-11-16 | Owner (question 3) | Superseded 2026-11-21: Loam's tree filed as [#1974](https://github.com/lushly-dev/afd/issues/1974) (related to [#1786](https://github.com/lushly-dev/afd/issues/1786)); Lushly's tree stays in the private Lushly repository |
| 2026-11-15 | This proposal | Measure Loam's tree, and later Lushly's, as DTCG files against the 256 KiB bound on an instance command's input. Loam's measurement folded into [#1974](https://github.com/lushly-dev/afd/issues/1974); Lushly's remains in Lushly's repository |
| 2026-11-21 | Gaps session | `export.tree` refuses a node's subtract, reset and copy operations, since `import.tree`'s files hold adds and overrides only; extend both if the app needs them. Reviewed 2026-11-21: no issue needed now (out of scope per [section 13](violet-app.proposal.md#13-out-of-scope); fails closed) |
| 2026-11-21 | Gaps session | Superseded 2026-11-21: token ids refused at CSS/SCSS export but accepted on write filed as [#1957](https://github.com/lushly-dev/afd/issues/1957) |
| 2026-11-21 | Gaps session | Superseded 2026-11-21: concurrent writes sharing a node operation sequence filed as [#1958](https://github.com/lushly-dev/afd/issues/1958) |
| 2026-11-21 | Gaps session | Split 2026-11-21: memory store `transaction()` rollback filed as [#1973](https://github.com/lushly-dev/afd/issues/1973); webhook dispatcher wall clock and `Math.random()` stays here (server-only, outside Violet in Loam's scope and replay path) |
| 2026-11-21 | Gaps session | `export.tree` lists a token's category as dropped when it has no `$type` (71 in Loam's tree); DTCG files with `$type` carry it. Reviewed 2026-11-21: resolved for Loam's tree by [#1974](https://github.com/lushly-dev/afd/issues/1974); no separate issue |
| 2026-11-21 | Gaps session | The new commands reach the `violet` CLI through `violet call` only; no subcommands, and `violet-server`'s instructions text does not name them. Reviewed 2026-11-21: covered by [#1789](https://github.com/lushly-dev/afd/issues/1789) (generated CLI subcommands) and [#1781](https://github.com/lushly-dev/afd/issues/1781) (`violet-afd` on `defineCommand` and `violet-server` update); no separate issue |

## Session log

| Date | Session | What happened |
| --- | --- | --- |
| 2026-11-15 | Proposal | Drafted the proposal, twelve scenarios and this file at `6eeb545d`; ran the three checks; one fresh reader walked the paths in three seats; applied every finding (three jobs and four commands added, undo and unsafe values fixed, agents stated plainly); reran the checks |
| 2026-11-16 | Proposal | The owner accepted every recommendation in section 12; filed the seven gaps (#1322 to #1328); amended the `violet` row of Loam's first-party apps; told the desktop-lane session the app waits on its step 11 only to run on the desktop |
| 2026-11-21 | Gaps | Built the seven gaps in `violet-afd` and `violet-core` (#1322 to #1328) in #1942 |
| 2026-11-21 | Closeout check (#1556) | Verified #1556 exit criteria against `main` (`9e2aff93`): 0 of 4 met, so #1556 stays open (`endpoints/loam/plugins/violet/` not built yet). Moved feature folder from `proposed/` to `active/`, updated Dependencies, triaged #1957 and #1958, filed #1973 (`MemoryDatabase.transaction()` rollback) and #1974 (Loam's tree to DTCG files) under #1556, and recorded dispositions for every follow-up row |
| 2026-11-22 | Write hardening (#1957, #1958, #1973) | Refused unsafe token ids on write/import/validate/export (#1957), added atomic `Database.appendOperation` across Memory/SQLite/Postgres/Overlay (#1958), and added snapshot/rollback and concurrency isolation to `MemoryDatabase.transaction()` (#1973) in [#2090](https://github.com/lushly-dev/afd/pull/2090) |
