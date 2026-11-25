# Violet in Loam: status

Epic: [#1556](https://github.com/lushly-dev/afd/issues/1556). File new work for this area as its sub-issue.

Read this before the [proposal](violet-app.proposal.md). It records exactly what is done and what is
not, so an agent never has to scan the code to learn what is current. It follows the shape of the
[Pointing status](../../active/pointing/STATUS.md).

## How to keep this file

- "Done" means merged to `main` with evidence linked. Anything else is "in progress" or "open",
  with what remains spelled out.
- Record how you verified it, the command or check, and the absolute date.
- Write down follow-ups that are not yet issues, with the date and who raised them. Link the issue
  when one exists.
- Never delete history. Mark an entry superseded and point to what replaced it.

## Status block

- **State:** complete — approved by the owner on 2026-11-16, every recommendation accepted; moved
  from `proposed/` to `active/` on 2026-11-21 after the seven `violet-afd` gaps merged in
  [#1942](https://github.com/lushly-dev/afd/pull/1942), and moved from `active/` to `complete/` on
  2026-11-24 after all 15 sub-issues under epic
  [#1556](https://github.com/lushly-dev/afd/issues/1556) merged and the owner accepted closeout
  (`spec.md` [section 9.3](../../../../endpoints/loam/plugins/violet/docs/spec.md#93-exit-criterion-4-the-owners-desktop-loam)).
  Exit criterion 3 is met by [#1974](https://github.com/lushly-dev/afd/issues/1974)
  ([#2166](https://github.com/lushly-dev/afd/pull/2166)), the plugin specification
  ([#2205](https://github.com/lushly-dev/afd/issues/2205)) merged in
  [#2251](https://github.com/lushly-dev/afd/pull/2251) (`2b134a7`), the first slice build
  ([#2207](https://github.com/lushly-dev/afd/issues/2207)) meets exit criteria 1 and 2 in
  `endpoints/loam/plugins/violet/app/` (merged in [#2355](https://github.com/lushly-dev/afd/pull/2355)),
  post-slice constraint follow-ups ([#2329](https://github.com/lushly-dev/afd/issues/2329),
  [#2330](https://github.com/lushly-dev/afd/issues/2330)) merged in
  [#2513](https://github.com/lushly-dev/afd/pull/2513) (`3f584d4`), and exit criterion 4 was
  accepted by the owner on 2026-11-24 against `main` at `3f584d4` (`7e1b834f`). Existing repo
  contracts last verified 2026-11-23 against `main` at `2b134a7`. (Proposal written 2026-11-15
  against `main` at `6eeb545d`.)
- **Done:** what exists today, verified first-hand with file and line; fifteen jobs as scenario
  files that pass the three checks; a recommended app kind; the `violet-tree` document type;
  screens by part and layout class; twenty-two drafted commands; ten gaps (G1 to G10); the
  dependencies; the home and tests; five questions for the owner with recommendations; the seven
  `violet-afd` gaps (#1322 to #1328, merged in [#1942](https://github.com/lushly-dev/afd/pull/1942));
  write-path hardening (#1957, #1958, #1973 in [#2090](https://github.com/lushly-dev/afd/pull/2090));
  Loam's token tree moved from TypeScript to DTCG files ([#1974](https://github.com/lushly-dev/afd/issues/1974),
  [#2166](https://github.com/lushly-dev/afd/pull/2166), exit criterion 3 verified); the approved
  [plugin specification](../../../../endpoints/loam/plugins/violet/docs/spec.md)
  ([#2205](https://github.com/lushly-dev/afd/issues/2205), owner UX sign-off U1 to U6 and Q4 to Q13
  accepted 2026-11-23, merged in [#2251](https://github.com/lushly-dev/afd/pull/2251)); the
  first slice in `endpoints/loam/plugins/violet/app/` ([#2207](https://github.com/lushly-dev/afd/issues/2207),
  [#2355](https://github.com/lushly-dev/afd/pull/2355)): manifest v2 + 22 command handlers over `@lushly-dev/violet-afd/worker`,
  `token-tree-main`/`token-tree-editor`/`token-tree-inspector`, D109 one-way boundary check in
  `architecture.json` + `scripts/check-boundaries.mjs`, `violet` job in `loam-plugins.yml` +
  `scripts/affected/suites.mjs`, 15/15 scenarios (10/10 `slice`) with deterministic `replay()`
  (exit criterion 1), and 72 Specimen captures + 72 axe checks (60 desktop + 12 narrow) with
  scoped preview isolation (exit criterion 2); post-slice constraint follow-ups
  ([#2329](https://github.com/lushly-dev/afd/issues/2329),
  [#2330](https://github.com/lushly-dev/afd/issues/2330), merged in
  [#2513](https://github.com/lushly-dev/afd/pull/2513)): atomic `constraints.set`
  `constraint_set` audit events (surfaced as `constraint-set` in `violet-change-list`) and
  DTCG constraint round-trip in `export.tree` / `import.tree` (`dropped: []` in
  `violet-tree-export`, strict schema validation, seed merge, and 50-rule Loam cap); and exit
  criterion 4 (`spec.md` §9.3) accepted by the owner on 2026-11-24 against `main` at `3f584d4`
  (`7e1b834f`): packed app + desktop deployment + `loam-desktop.exe` debug build (step 1), live
  `loam-desktop mcp` verification of `violet-tree` (22 commands) and all 3 templates in `new-list`,
  owner confirmation of desktop scaffold creation via shell `New` and quit-and-reopen persistence
  (deviation from `spec.md` §9.3 step 4's D160 SQLite wording: current `loam-desktop` persists in
  WebView2 IndexedDB per `endpoints/loam/packages/desktop/src-tauri/src/lib.rs:473`, observed
  `000003.log` at 821,883 B, because D160 SQLite `#1928` has not yet landed), and Q12 growth
  measured at 137,649 B (13.13% of 1 MiB, step 6). Not individually verified manually on desktop
  WebView2: step 2's full five-view walkthrough and dark-in-light preview isolation, step 3
  (WebView2 file input/download and exported 1-line diff), step 4's history-list inspection, and
  step 5 (manual 800 px / 500 px desktop resize); the owner waived these manual checks on
  2026-11-24 and accepted closing [#1556](https://github.com/lushly-dev/afd/issues/1556) with
  15/15 scenarios, `theme.test.ts`, and the 72 Specimen captures (including 12 narrow captures and
  scoped preview isolation) covering those behaviors, fixing any desktop issues later as
  encountered.
- **Not done:** none for epic [#1556](https://github.com/lushly-dev/afd/issues/1556). Follow-on work
  outside `#1556`: mounting `violet-server` behind the same engine port (waits for Loam phase 5 or
  the plugin-engine specification, plus `violet-server` AFD discovery in
  [#1781](https://github.com/lushly-dev/afd/issues/1781)) and Lushly's own token tree (in the
  private Lushly repository).
- **Order:** the [jobs-first guide](../../../../.claude/skills/afd/references/jobs-first.md),
  steps 1 to 6 done, with one walk; step 9, the owner's ranking, done 2026-11-16; the `violet-afd`
  gaps merged 2026-11-21; Loam's tree moved to DTCG files ([#1974](https://github.com/lushly-dev/afd/issues/1974))
  2026-11-22; the specification ([#2205](https://github.com/lushly-dev/afd/issues/2205)) merged
  2026-11-23 in [#2251](https://github.com/lushly-dev/afd/pull/2251); the first slice build
  ([#2207](https://github.com/lushly-dev/afd/issues/2207)) merged in
  [#2355](https://github.com/lushly-dev/afd/pull/2355); constraint follow-ups
  ([#2329](https://github.com/lushly-dev/afd/issues/2329),
  [#2330](https://github.com/lushly-dev/afd/issues/2330)) merged 2026-11-24 in
  [#2513](https://github.com/lushly-dev/afd/pull/2513); owner accepted closeout on 2026-11-24
  after the desktop Loam check (§9.3), closing epic
  [#1556](https://github.com/lushly-dev/afd/issues/1556) upon merge.

## Steps

| Step | State | Evidence |
| --- | --- | --- |
| What exists today, read first-hand | Done 2026-11-15 | Proposal, [section 2](violet-app.proposal.md#2-what-exists-today) |
| Jobs and drafted commands | Done 2026-11-15 | Proposal, sections 3 and 5 |
| Each job as a scenario, and the three checks | Done 2026-11-15 | [`endpoints/loam/plugins/violet/app/scenarios/`](../../../../endpoints/loam/plugins/violet/app/scenarios/), fifteen files, 61 steps (moved from `scenarios/` in `#2207`); [How the jobs were checked](#how-the-jobs-were-checked) |
| Walk the paths with a reader who did not write them | Done 2026-11-15: one fresh reader, three seats; six blockers and eleven improvements, all applied; three jobs and four commands added | Proposal, [section 8](violet-app.proposal.md#8-what-the-walk-changed) |
| The owner ranks the jobs and answers section 12 | Done 2026-11-16 | Every recommendation accepted; proposal, [section 12](violet-app.proposal.md#12-for-the-owner) |
| The seven gaps in `violet-afd`: G1 #1322, G2 #1323, G3 #1326, G4 #1327, G8 #1328, G9 #1324, G10 #1325 | Merged 2026-11-21 in [#1942](https://github.com/lushly-dev/afd/pull/1942) | `export.tree`, `interface.check`, `token.remove`, the context's `now()` and `random()`, `INVALID_TOKEN_VALUE` on write, import and CSS export, alpha in contrast, `disabledReason`; `pnpm -F @lushly-dev/violet-afd test` 780 passed and `pnpm -F @lushly-dev/violet-core test` (its unit config) 191 passed; Loam's tree round-trips through `export.tree` and `import.tree` with the same values and files (an ad hoc check against `buildLoamTree()`) |
| Write-path hardening in `violet-core` and `violet-afd`: unsafe token ids (#1957), atomic operation sequence (#1958), `MemoryDatabase.transaction()` rollback (#1973) | Merged 2026-11-22 in [#2090](https://github.com/lushly-dev/afd/pull/2090) | `validateTokenId` refuses non-CSS and empty segments on `token.add`, `token.override`, `token.copy`, `import.json`, `import.tree`, `import.validate`, `export.tree` and CSS/SCSS export; `Database.appendOperation` allocates sequences atomically in Memory, SQLite, Postgres (`FOR UPDATE`) and `OverlayDatabase.stagingView()`; `MemoryDatabase.transaction()` snapshots, isolates and restores all mutable collections (including nested transactions); `pnpm verify` 24/24 local gates green on Node 26.13.1 |
| Move Loam's tree from TypeScript to DTCG files (question 3) | Merged 2026-11-22 in [#2166](https://github.com/lushly-dev/afd/pull/2166) ([#1974](https://github.com/lushly-dev/afd/issues/1974)) | Seven DTCG files in `endpoints/loam/packages/theme/tree/` (`loam.tokens.json`, `loam_{light,dark,high-contrast}.tokens.json`, `loam_<theme>_compact.tokens.json`) carrying `$type` on every root token and `$extensions["dev.lushly.violet"].category` for the 71 non-derivable categories (`spacing`, `radius`, `z-index`, dimension `typography`), loaded by `buildLoamTree()` via `import.tree`; byte-identical generated outputs (`theme:check` passes); exit criterion 3 verified in `endpoints/loam/packages/theme/src/theme.test.ts` (round-trip without edits is byte-identical with `dropped: []` and all categories intact in `tokens.catalog`, and one `token.override` + `export.tree` yields a 1-line diff in `loam_dark.tokens.json`); payload size 39,674 B raw UTF-8 (38.74 KiB, 15.13% of 256 KiB) and 45,642 B as JSON-serialized `{ content: { files } }` input (44.57 KiB, 17.41% of Loam's 256 KiB bound) |
| Specification, in the plugin's folder | Merged 2026-11-23 in [#2251](https://github.com/lushly-dev/afd/pull/2251) ([#2205](https://github.com/lushly-dev/afd/issues/2205)) | [`endpoints/loam/plugins/violet/docs/spec.md`](../../../../endpoints/loam/plugins/violet/docs/spec.md), checked against `violet-afd/worker`, `violet-core`, `loam-sdk`, `loam-testing`, `loam-manifest`, `loam-plugins.yml` and `check-boundaries.mjs` at `2e63c766` and re-checked at `73f71572`; twenty-one findings (F1 to F21) resolved; owner approved U1 to U6 and Q4 to Q13 on 2026-11-23; two-model review (Gemini 4 Neon `high` + GPT-6.2 Astra `high`) findings applied |
| Build: the first slice (`slice` scenarios, Specimen fixtures, D109 boundary, `loam-plugins.yml` job) | Merged 2026-11-23 in [#2355](https://github.com/lushly-dev/afd/pull/2355) ([#2207](https://github.com/lushly-dev/afd/issues/2207)) | `endpoints/loam/plugins/violet/app/` (`@lushly-dev/loam-app-violet`): `loam app check` / `run pack` pass; `lint:tokens` 23 files, 0 violations; `test` runs `templates/write.mjs --check` + 33/33 Vitest tests passing (15/15 scenarios including 10/10 `slice` with deterministic `replay()`, full undo/port/cache/suggestion/grant/bundled-interface/selection-bus units, engine boundary test, Q12 measured at 137,649 B / 134.42 KiB = 13.13% of 1 MiB after 50 overrides on `afd-default`); `test:specimen` 72/72 captures (20 specimens × 3 themes + 12 narrow at 800 px / 500 px) + 72/72 axe checks (60 desktop + 12 narrow) with 0 violations + scoped preview computed-style isolation proved; repo-wide D109 `oneWay` boundary check in `architecture.json` + `scripts/check-boundaries.mjs` (49/49 tests in `affected.test.mjs` + `check-boundaries.test.mjs`, `check-boundaries` 87 distributions clean). Manual desktop Loam run (`spec.md` §9.3, exit criterion 4) remains for the owner's desktop build |
| Post-slice follow-ups: `constraints.set` audit events (#2329) and DTCG constraint round-trip in `export.tree` / `import.tree` (#2330) | Merged 2026-11-24 in [#2513](https://github.com/lushly-dev/afd/pull/2513) | `constraints.set` appends `constraint_set` audit events atomically inside `db.transaction` using context `now()` / `random()`; `export.tree` and `import.tree` serialize, strictly validate (failing closed with `VALIDATION_ERROR` before writes), and restore `$extensions["dev.lushly.violet"].constraints` with `dropped: []`; `loam-app-violet` maps `constraint_set` → `constraint-set` in `violet-change-list`, stops dropping constraints in `violet-tree-export`, merges file-embedded and seed constraints, enforces Loam's 50-rule local cap, and keeps `extractRecords` prototype-safe |
| Exit criterion 4: owner's desktop Loam check (`spec.md` §9.3) and epic closeout (#1556) | Accepted 2026-11-24 against `main` at `3f584d4` (`7e1b834f`) | Packed `endpoints/loam/plugins/violet/app` (`loam app pack`) and wrote desktop deployment (`loam deployment write --host desktop`); built `loam-desktop.exe` debug binary (`pnpm -F @lushly-dev/loam-desktop build:site` + `build:app`, step 1); verified `violet-tree` (22 commands) and all 3 templates (`Blank tree`, `Example tree`, `AFD default tree`) via live `loam-desktop mcp` (`document-type-list`, `new-list`); owner verified scaffold creation via shell `New` and quit-and-reopen persistence (deviation from `spec.md` §9.3 step 4's D160 SQLite wording: current `loam-desktop` persists in WebView2 IndexedDB per `lib.rs:473`, observed `000003.log` 821,883 B, as D160 SQLite `#1928` is not yet landed); Q12 measured at 137,649 B (13.13% of 1 MiB, step 6) in `port.test.ts`. Not individually checked manually on WebView2: step 2's full five-view walkthrough / dark-in-light preview isolation, step 3 (file input/download + 1-line diff), step 4's history-list inspection, and step 5 (manual 800 px / 500 px resize); owner waived these manual checks on 2026-11-24 (covered by 15/15 scenarios, `theme.test.ts`, and 72 Specimen captures including 12 narrow captures and scoped preview isolation) |

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
| Loam phase 5 (`calls`, plain mounts, mounted document types, the copilot) | Specification approved 2026-11-17 ([#1358](https://github.com/lushly-dev/afd/pull/1358)); step 0a done (spike), steps 0b–0c and 1–6 merged, steps 9–10 not started | The mounted engine (question 2) |
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
| 2026-11-15 | This proposal | Measure Loam's tree, and later Lushly's, as DTCG files against the 256 KiB bound on an instance command's input. Loam measured 2026-11-22 in [#1974](https://github.com/lushly-dev/afd/issues/1974): 39,674 B raw UTF-8 across 7 files, 45,642 B as JSON `{ content: { files } }` payload (17.41% of 262,144 B); Lushly's remains in Lushly's repository |
| 2026-11-21 | Gaps session | `export.tree` refuses a node's subtract, reset and copy operations, since `import.tree`'s files hold adds and overrides only; extend both if the app needs them. Reviewed 2026-11-21: no issue needed now (out of scope per [section 13](violet-app.proposal.md#13-out-of-scope); fails closed) |
| 2026-11-21 | Gaps session | Superseded 2026-11-21: token ids refused at CSS/SCSS export but accepted on write filed as [#1957](https://github.com/lushly-dev/afd/issues/1957) |
| 2026-11-21 | Gaps session | Superseded 2026-11-21: concurrent writes sharing a node operation sequence filed as [#1958](https://github.com/lushly-dev/afd/issues/1958) |
| 2026-11-21 | Gaps session | Split 2026-11-21: memory store `transaction()` rollback filed as [#1973](https://github.com/lushly-dev/afd/issues/1973); webhook dispatcher wall clock and `Math.random()` stays here (server-only, outside Violet in Loam's scope and replay path) |
| 2026-11-21 | Gaps session | `export.tree` lists a token's category as dropped when it has no `$type` (71 in Loam's tree); DTCG files with `$type` carry it. Resolved 2026-11-22 in [#1974](https://github.com/lushly-dev/afd/issues/1974): `export.tree` / `import.tree` now preserve non-derivable categories in `$extensions["dev.lushly.violet"].category` (`dropped: []` and all 71 categories intact in `tokens.catalog`, verified in `theme.test.ts` and `export/tree.test.ts`); no separate issue |
| 2026-11-21 | Gaps session | The new commands reach the `violet` CLI through `violet call` only; no subcommands, and `violet-server`'s instructions text does not name them. Reviewed 2026-11-21: covered by [#1789](https://github.com/lushly-dev/afd/issues/1789) (generated CLI subcommands) and [#1781](https://github.com/lushly-dev/afd/issues/1781) (`violet-afd` on `defineCommand` and `violet-server` update); no separate issue |
| 2026-11-23 | Specification (#2205) | Superseded 2026-11-23: constraints in DTCG tree files (F9 / Q8) filed as [#2330](https://github.com/lushly-dev/afd/issues/2330) under #1556 |
| 2026-11-23 | Specification (#2205) | Superseded 2026-11-23: `constraints.set` audit events (F14 / Q10) filed as [#2329](https://github.com/lushly-dev/afd/issues/2329) under #1556 |

## Session log

| Date | Session | What happened |
| --- | --- | --- |
| 2026-11-15 | Proposal | Drafted the proposal, twelve scenarios and this file at `6eeb545d`; ran the three checks; one fresh reader walked the paths in three seats; applied every finding (three jobs and four commands added, undo and unsafe values fixed, agents stated plainly); reran the checks |
| 2026-11-16 | Proposal | The owner accepted every recommendation in section 12; filed the seven gaps (#1322 to #1328); amended the `violet` row of Loam's first-party apps; told the desktop-lane session the app waits on its step 11 only to run on the desktop |
| 2026-11-21 | Gaps | Built the seven gaps in `violet-afd` and `violet-core` (#1322 to #1328) in #1942 |
| 2026-11-21 | Closeout check (#1556) | Verified #1556 exit criteria against `main` (`9e2aff93`): 0 of 4 met, so #1556 stays open (`endpoints/loam/plugins/violet/` not built yet). Moved feature folder from `proposed/` to `active/`, updated Dependencies, triaged #1957 and #1958, filed #1973 (`MemoryDatabase.transaction()` rollback) and #1974 (Loam's tree to DTCG files) under #1556, and recorded dispositions for every follow-up row |
| 2026-11-22 | Write hardening (#1957, #1958, #1973) | Refused unsafe token ids on write/import/validate/export (#1957), added atomic `Database.appendOperation` across Memory/SQLite/Postgres/Overlay (#1958), and added snapshot/rollback and concurrency isolation to `MemoryDatabase.transaction()` (#1973) in [#2090](https://github.com/lushly-dev/afd/pull/2090) |
| 2026-11-22 | Loam DTCG tree (#1974) | Moved Loam's token tree from TypeScript modules to seven DTCG `.tokens.json` files in `endpoints/loam/packages/theme/tree/` loaded via `import.tree`, preserved all 71 non-derivable Violet token categories via `$extensions["dev.lushly.violet"].category` in `violet-afd`, verified byte-identical generated outputs, zero dropped fields, byte-identical round-trip, 1-line override diff (exit criterion 3), and measured payload size (39,674 B raw / 45,642 B JSON input = 17.41% of 256 KiB bound) in [#2166](https://github.com/lushly-dev/afd/pull/2166) |
| 2026-11-22 | Closeout check (#1556) | Verified #1556 exit criteria against `main` (`ae4cdd4d`, rechecked at `dbc846114` with no diff in `endpoints/loam/packages/theme/`) after #2166: 1 of 4 met (exit criterion 3 live-verified at `ae4cdd4d` via `pnpm -F @lushly-dev/loam-theme theme:check` and `test`, 65/65 passing; criteria 1, 2 and 4 unmet because `endpoints/loam/plugins/violet/` does not exist yet). Epic #1556 stays open; filed [#2205](https://github.com/lushly-dev/afd/issues/2205) (plugin specification, `status:planned`) and [#2207](https://github.com/lushly-dev/afd/issues/2207) (first slice build, `status:deferred` blocked on #2205) as sub-issues under #1556, and refreshed `STATUS.md`, `violet-app.proposal.md`, and `docs/features/README.md` |
| 2026-11-23 | Specification (#2205) | Wrote `endpoints/loam/plugins/violet/docs/spec.md` against `main` at `2e63c766`: manifest version 2, the `violet-tree` type and its content schema, the engine port, the twenty-two commands with input, output, error and undo contracts mapped to all fifteen scenarios, the screens and a 60-capture Specimen matrix (pending UX sign-off), the D109 boundary check and `loam-plugins.yml` job, and the plan for exit criteria 1, 2 and 4. Checking the proposal against the code found twenty contradictions (F1 to F20, four of them from the independent review), among them `export_command` being a query, `token.reset` records that `export.tree` refuses, and `size.focus.width` missing from the interface; each resolved in the spec, the ones that change an approved choice listed as Q4 to Q13; one independent review (revise, five blockers) fixed in the same pull request |
| 2026-11-23 | Specification approval (#2205 / #2251) | Owner accepted UX sign-off U1 to U6 and technical resolutions Q4 to Q13 as recommended; synced PR #2251 with `main` (`73f71572`), filed post-slice follow-ups [#2330](https://github.com/lushly-dev/afd/issues/2330) (Q8) and [#2329](https://github.com/lushly-dev/afd/issues/2329) (Q10) under #1556, ran two-model review (Gemini 4 Neon `high` + GPT-6.2 Astra `high`), applied all blockers and improvements, and merged PR [#2251](https://github.com/lushly-dev/afd/pull/2251) (`2b134a7`) |
| 2026-11-23 | First slice build (#2207) | Implemented `@lushly-dev/loam-app-violet` in `endpoints/loam/plugins/violet/app/` (manifest v2, 22 command schemas & handlers over `@lushly-dev/violet-afd/worker`, `token-tree-main`, `token-tree-editor`, `token-tree-inspector`, `templates/write.mjs`, moved all 15 scenarios with Q7 amendments, 20 Specimen fixtures + 72 captures + 72 axe checks with scoped preview isolation), added repo-wide D109 `oneWay` boundary check (`architecture.json`, `scripts/check-boundaries.mjs`) and `violet` job in `.github/workflows/loam-plugins.yml` + `scripts/affected/suites.mjs`. Resolved all findings from two-model independent review (Gemini 4 Neon `high` + GPT-6.2 Astra `high`), measured Q12 at 137,649 B (134.42 KiB, 13.13% of 1 MiB) after 50 overrides on `afd-default`, and verified exit criteria 1 and 2 locally; exit criterion 4 (`spec.md` §9.3 manual desktop Loam check) remains for the owner's desktop build |
| 2026-11-24 | Post-slice constraint follow-ups (#2329, #2330) | Recorded atomic `constraint_set` audit events on `constraints.set` with context `now()`/`random()` (#2329) and added strict DTCG constraint serialization, validation, and restoration under `$extensions["dev.lushly.violet"].constraints` in `export.tree` and `import.tree` (#2330); wired `constraint-set` history mapping, `dropped: []` export, mixed seed constraint merging, 50-rule import/seed cap, and prototype-safe record extraction in `@lushly-dev/loam-app-violet` ([#2513](https://github.com/lushly-dev/afd/pull/2513)). Exit criterion 4 (`spec.md` §9.3 manual desktop Loam verification by the owner) remains open, so epic #1556 stays open |
| 2026-11-24 | Desktop Loam check and closeout (#1556) | Built desktop Loam (`loam-desktop.exe`) at `3f584d4` (`7e1b834f`), packed Violet (`loam app pack`) and wrote a desktop deployment (`loam deployment write --host desktop`), verified `document-type-list` (`violet-tree`, 22 commands) and `new-list` (3 templates) over `loam-desktop mcp`, and ran through creation and quit-and-reopen persistence with the owner (deviation from `spec.md` §9.3 step 4's D160 SQLite wording: persisted in WebView2 IndexedDB `000003.log`, 821,883 B, as D160 SQLite `#1928` has not yet landed; noted Windows `MAX_PATH` on a 206-char `LOAM_DESKTOP_DATA_DIR` and taskbar-pin fallback to `%APPDATA%\dev.lushly.loam` without the env var). Not individually checked manually on WebView2: step 2's five-view / dark-in-light preview walkthrough, step 3 (file input/download), step 4's history list, and step 5 (800/500 px resize); owner accepted closeout on 2026-11-24 (15/15 sub-issues closed, closing epic #1556 upon merge). Moved `docs/features/active/violet-app/` to `docs/features/complete/violet-app/` and updated `docs/features/README.md`, `endpoints/loam/docs/proposal.md`, and `endpoints/loam/plugins/violet/docs/spec.md` |
