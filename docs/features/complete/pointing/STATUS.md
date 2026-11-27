# Pointing: status

Epic: [#1110](https://github.com/lushly-dev/afd/issues/1110), closed 2026-11-26 with Slices 1 and 2 merged. Slice 3's token preview (Jobs 5 and 6) is the standalone issue [#2045](https://github.com/lushly-dev/afd/issues/2045), still blocked on Specimen T09 ([#1211](https://github.com/lushly-dev/afd/issues/1211)).

Read this before the [proposal](pointing.proposal.md). It records exactly what is done and what is not, so an
agent never has to scan the code to learn what is current. It follows the shape of the
[Patterns status](../../active/patterns/STATUS.md).

## How to keep this file

- "Done" means merged to `main` with evidence linked. Anything else is "in progress" or "open",
  with what remains spelled out.
- Record how you verified it, the command or check, and the absolute date.
- Write down follow-ups that are not yet issues, with the date and who raised them. Link the issue
  when one exists.
- Never delete history. Mark an entry superseded and point to what replaced it.
- Edit only your step's own line under [Delivery steps](#delivery-steps); never add a running
  summary line of which steps are done or next.

## Status block

- **State:** complete (epic closed 2026-11-26). Earlier: active. Approved by the owner on 2026-11-22 and promoted from `proposed/` to `active/`.
- **Epic:** [#1110](https://github.com/lushly-dev/afd/issues/1110). Work happens in its sub-issues;
  this file is the source of truth for progress.
- **Approved scope:** 9 jobs, 10 commands, 13 error codes, 9 scenario files, and confirmed §4.0
  shared conventions (`endpoints/specimen-server` `#1320` as MCP host; `.specimen/` gitignored
  `#1132`). Wire contracts live in [pointing.proposal.md](pointing.proposal.md) and [`scenarios/`](scenarios/)
  (no separate `spec.md`).
- **Follow-ups:** the [table below](#follow-ups-not-yet-issues).

## Proposal history

| Step | State | Evidence |
| --- | --- | --- |
| Scaffold: problem, what exists, draft jobs | Done 2026-11-13 | [#1113](https://github.com/lushly-dev/afd/pull/1113), [`pointing.proposal.md`](pointing.proposal.md) |
| Open the epic | Done 2026-11-13 | Epic [#1110](https://github.com/lushly-dev/afd/issues/1110) |
| Draft design, commands, scenarios, walk and independent review | Done 2026-11-13 | [#1126](https://github.com/lushly-dev/afd/pull/1126), [section 7](pointing.proposal.md#7-what-the-walk-changed) |
| Owner walkthrough, decisions, promotion to `active/`, and sub-issues | Done 2026-11-22, merged in [#2066](https://github.com/lushly-dev/afd/pull/2066) | [section 8](pointing.proposal.md#8-owner-decisions-2026-11-22), [#2046](https://github.com/lushly-dev/afd/issues/2046), [#2042](https://github.com/lushly-dev/afd/issues/2042), [#2043](https://github.com/lushly-dev/afd/issues/2043), [#2044](https://github.com/lushly-dev/afd/issues/2044), [#2045](https://github.com/lushly-dev/afd/issues/2045) |

## Delivery steps

Each step is on its own blank-line-separated list item so concurrent pull requests never conflict.

- **Slice 1.1 — Host target errors ([#2046](https://github.com/lushly-dev/afd/issues/2046)):** Done 2026-11-22, merged in [#2132](https://github.com/lushly-dev/afd/pull/2132). Split `foundations/specimen/host/src/page.rs` target error into typed `TARGET_NOT_FOUND` and `TARGET_AMBIGUOUS` (with match count and suggestions), plumbed through `HostProcess`, worker IPC, and `specimen-afd`; verified with Rust host tests, Specimen bench tests, and `pnpm check` + `specimen.yml` local suites.

- **Slice 1.2 — Climb, pointer URI & Pick UI ([#2042](https://github.com/lushly-dev/afd/issues/2042)):** Done 2026-11-22, merged in [#2190](https://github.com/lushly-dev/afd/pull/2190). Implemented the shared two-step meaningful-element climb (`src/climb.ts`, `src/browser/climb-dom.ts`), `specimen:` pointer URI parser/formatter (`src/pointer.ts`, rejecting malformed pointers with `POINTER_INVALID`), review page Pick mode (`src/browser/pick.ts`, `src/browser/page.ts`, `src/browser/page.css`), unit tests (`src/pointer.test.ts`), browser + native-host agreement tests (`src/pick.test.ts`), and Specimen provenance; verified with `pnpm verify` (`ci.yml`, `specimen.yml`, `loam.yml`).

- **Slice 1.3 — Point commands & staleness ([#2043](https://github.com/lushly-dev/afd/issues/2043)):** Done 2026-11-23, merged in [#2353](https://github.com/lushly-dev/afd/pull/2353). Implemented `specimen-point`, `specimen-point-move` (checking staleness first and refusing with `POINT_STALE`), and `specimen-point-check` across the native Rust host (`host/src/point.rs`, `loadedSources`, CSS `@import`/static tracking, `resolveTarget`, `point_meta`), `foundations/specimen` (`src/point.ts`, `src/point-run.ts`, `src/point-types.ts`, `bench-runtime.ts`, worker IPC, schemas/validators), `integrations/specimen-afd` (24 commands), `endpoints/specimen-cli` (one-shot `point`, `point-move`, `point-check`), and `endpoints/specimen-server` (warm MCP bench); verified with `src/point-unit.test.ts`, `src/point.test.ts` (in-process + process), and an `InProcessExecutor` run of YAML scenarios `01`–`04` against the built commands.

- **Slice 2 — Pinned notes lifecycle ([#2044](https://github.com/lushly-dev/afd/issues/2044)):** Done 2026-11-24, merged in [#2512](https://github.com/lushly-dev/afd/pull/2512). Implemented `specimen-note-{add,list,check,move,resolve,reopen}` in `specimens/notes/<id>.json` across `foundations/specimen` (`src/note-types.ts`, `src/note.ts`, `src/note-run.ts`, `src/note-schema.ts`, `src/note-validate.ts`, `bench.ts`, `bench-runtime.ts`, worker IPC), `integrations/specimen-afd` (32 commands), `endpoints/specimen-cli` (one-shot `note-*`), and `endpoints/specimen-server` (warm MCP bench); verified with `src/note-unit.test.ts`, `src/note.test.ts` (in-process + process), `verify-artifacts.mjs`, `test:stories`, and an `InProcessExecutor` run of YAML scenarios `07`–`09` against the built commands.

- **Slice 3 — Point-scoped token preview ([#2045](https://github.com/lushly-dev/afd/issues/2045)):** Deferred, standalone since the epic closed on 2026-11-26 (`blocked` on T09 [#1211](https://github.com/lushly-dev/afd/issues/1211); #2043 has landed). Optional `point` on `specimen-impact`, `nodeId` candidate tokens, `?overrides=` review link, and scenarios 05–06.

## How the jobs were checked

Run 2026-11-22, after the Pass 1–3 updates and move to `docs/features/active/pointing/`, on Node `v26.13.1` (`.nvmrc`) with the tools built in this worktree, as the
[jobs-first guide](../../../../.claude/skills/afd/references/jobs-first.md#checking-without-a-server)
describes.

`node packages/cli/dist/bin.js scenario validate docs/features/active/pointing/scenarios`:

```text
✓ All 9 scenario(s) are valid!
```

The dry run with `checkFixtures: true` printed no errors (`0 errors`, `refInExpect=0`); all nine
scenarios declare a fixture in [`scenarios/fixtures/`](scenarios/fixtures/), and none uses a step
reference in `expect`, which the runner resolves only in `input`. Coverage, with the ten commands
and thirteen error codes:

```text
{"totalScenarios":9,"totalSteps":38,"commands":{"tested":10,"known":10,"untested":[],"coverage":100},"errors":{"tested":9,"known":13,"untested":["POINTER_INVALID","SPECIMEN_NOT_FOUND","POINT_NOT_FOUND","NOTE_NOT_FOUND"],"coverage":69.23076923076923},"jobs":{"count":9,"names":["close-a-note-with-a-reason","enough-not-everything","keep-an-orphaned-note","leave-a-note","choose-the-right-level","name-what-else-moves","point-instead-of-describe","refuse-a-stale-reference","see-the-change-first"]}}
not drafted: []
```

The four untested codes are plain lookups; the proposal's section 5 says why they have no job.
Partial list assertions are written as dotted paths (`notes.0.id`, `resolved.0.id`), because the
evaluator in `packages/testing/src/runner/evaluator.ts` compares a list under `expect.data`
exactly.

## What was read to write it

First-hand on 2026-11-13 at `f7ecbd43`: every file the proposal's section 2 cites, the
`specimen-afd` command list, Violet's `token.override` and `changes.impact` inputs, and the
scenario format in `packages/testing`. Re-verified on 2026-11-22 at `9e2aff93`:
`endpoints/specimen-server/README.md` (`#1320`) and `foundations/specimen/host/src/page.rs:415-418`.
The mechanisms in the proposal's section 4 draw on the owner's earlier editor work, read for ideas
only; no text or code was taken from it.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-13 | Scaffold survey | The Specimen host reports not-found and ambiguous targets as one untyped error (`foundations/specimen/host/src/page.rs:417`). The Patterns proposal drafts `TARGET_NOT_FOUND` and `TARGET_AMBIGUOUS` | Filed 2026-11-22 as [#2046](https://github.com/lushly-dev/afd/issues/2046) (Slice 1.1) |
| 2026-11-13 | Draft | Where notes live should match where Design Decisions stores decisions | Settled 2026-11-22: committed `specimens/notes/<id>.json`, tracked in [#2044](https://github.com/lushly-dev/afd/issues/2044) |
| 2026-11-13 | Walk | Each `specimen-point-check` from the CLI launches a browser, since the CLI creates a bench per call (`endpoints/specimen-cli/src/cli.ts:338`). Checking before every edit costs a launch each time | Settled 2026-11-22: agents use `endpoints/specimen-server` (`#1320`, warm bench); CLI stays one-shot with no daemon in Slice 1 |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-13 | Scaffold | After the [Patterns](../../active/patterns/patterns.proposal.md) proposal, the owner agreed to four follow-on proposals from the same discussion: Design Decisions, Screens from Jobs, Pointing and Scales. This scaffold was written from a survey of the code, reviewed once by an independent reader, and committed with its epic |
| 2026-11-13 | Draft | The owner asked for the proposals to be filled in and kept as draft. Section 2 verified first-hand at `f7ecbd43`; jobs tightened (every job has a "so that"; job 3 and 9 stay quiet, jobs 4 and 8 refuse; the scaffold's "leave the rest alone" became job 6, "name what else moves"); design, eight commands and nine scenarios written; the three checks pass; six recommendations made for the owner |
| 2026-11-13 | Walk | One fresh reader walked the draft as the person, the job list and the calling agent. Blockers: scenarios 01 and 02 disagreed on which element a role resolves to (fixed by one shared climb, 4.1, and a separate `accessible`); job 5 showed the person nothing (screenshots and a preview link added); job 8 ended at detection (`specimen-note-move`, bulk `ids` on resolve). Improvements: token-only correction stated; `specimen-note-add` takes a pointer; `specimen-note-check` reports `unchecked` and `weakened`; `specimen-note-reopen` and `withdrawn`; random note ids; candidate tokens from Violet's `specimen.get`; paging; the check rule in the result and description; the CLI named with its launch cost. Separately, partial list assertions rewritten as dotted paths. Checks rerun clean: ten commands, 37 steps |
| 2026-11-13 | Review | An independent review of the three drafts. Fixed here: step references in `expect` (01, 07) replaced with literal values and patterns; a refusal in 04 given its suggestion; fixtures added for every scenario (stale point, orphaned notes, one note, toolbar, inbox); element refs numbered by tag (`example-button:1` and `:2`); `specimen-impact` takes `point` optionally and is a mutation (it writes screenshots); `pt-` ids defined; `SPECIMEN_NOT_FOUND` names the nearest ids. Shared conventions with the other two proposals recorded in proposal 4.0 for the owner to confirm: random ids, `specimens/` for committed records and `.specimen/` (to be gitignored) for local data, the MCP host from Design Decisions' phase 5. Checks rerun clean |
| 2026-11-21 | Owner call | The owner confirmed `.specimen/` as the local data folder kept out of git, and [#1132](https://github.com/lushly-dev/afd/issues/1132) added it to the root `.gitignore`. Proposal 4.0's storage bullet now says so. The other shared conventions still wait on the owner. Checked with `git check-ignore -v` on a file under `.specimen/` |
| 2026-11-22 | Owner walkthrough & promotion | Three-pass walkthrough completed on [#1110](https://github.com/lushly-dev/afd/issues/1110). Owner approved all 9 jobs ranked Slice 1 Targeting (Jobs 1–4) → Slice 2 Notes (Jobs 7–9) → Slice 3 Preview (Jobs 5–6 with T09), confirmed remaining §4.0 conventions including `endpoints/specimen-server` (`#1320`) as MCP host, tightened `specimen-point-move` staleness (`POINT_STALE`), two-step climb, optional `&pin=x,y`, and unified `{ resolved, skipped }` on `specimen-note-resolve`. Promoted `proposed/pointing/` → `active/pointing/`, tightened wire contracts directly in the proposal, updated `#1110` (dropped `needs:decision`), and opened sub-issues [#2046](https://github.com/lushly-dev/afd/issues/2046), [#2042](https://github.com/lushly-dev/afd/issues/2042), [#2043](https://github.com/lushly-dev/afd/issues/2043), [#2044](https://github.com/lushly-dev/afd/issues/2044), and [#2045](https://github.com/lushly-dev/afd/issues/2045) |
| 2026-11-22 | Slice 1.1 (#2046) | Split `foundations/specimen/host/src/page.rs` target resolution errors into typed `TARGET_NOT_FOUND` and `TARGET_AMBIGUOUS` (carrying `details.count` and actionable suggestions), plumbed structured `code`, `suggestion`, and `details` through `browser.rs`, `main.rs`, `host.ts`, `bench-worker-client.ts`, and `integrations/specimen-afd/src/commands.ts`, added Rust host unit tests and Specimen bench tests (`src/targets.test.ts`), and updated Specimen provenance |
| 2026-11-22 | Slice 1.2 (#2042) | Added the shared two-step meaningful-element climb (`src/climb.ts`, `src/browser/climb-dom.ts`), `specimen:` pointer URI parser/formatter (`src/pointer.ts`, `POINTER_INVALID`), review page Pick mode (`src/browser/pick.ts`, `src/browser/page.ts`, `src/browser/page.css`), unit tests (`src/pointer.test.ts`), browser + native-host agreement tests (`src/pick.test.ts`), raised Specimen shell/total build ceilings (`68,000` / `1,330,000` bytes), and updated Specimen provenance |
| 2026-11-23 | Slice 1.3 (#2043) | Implemented `specimen-point`, `specimen-point-move` (staleness-checked with `POINT_STALE` and `NO_SUCH_LEVEL`), and `specimen-point-check` (`current` / `stale` with changed file digests and identity layers): extended the native Rust host (`bundle.rs`, `serve.rs`, `page.rs`, `browser.rs`, `main.rs`) to track loaded project source files, resolve targets to element refs, and extract bounded element texts without enlarging the static browser shell; added `.specimen/points/pt-*.json` storage, nearest-id `SPECIMEN_NOT_FOUND` suggestions, capped neighbourhoods (`pageData: true`), and zero-build CEM component/source resolution in `foundations/specimen/src/point.ts`; wired all 3 commands through `integrations/specimen-afd`, `endpoints/specimen-cli` (one-shot), and `endpoints/specimen-server` (warm bench); verified unit, browser (`in-process` and `process`), and literal YAML scenarios `01`–`04`, and updated Specimen provenance |
| 2026-11-24 | Slice 2 (#2044) | Implemented `specimen-note-add`, `specimen-note-list`, `specimen-note-check`, `specimen-note-move`, `specimen-note-resolve`, and `specimen-note-reopen` across `foundations/specimen` (`src/note-types.ts`, `src/note.ts`, `src/note-run.ts`, `src/note-schema.ts`, `src/note-validate.ts`, `bench.ts`, `bench-runtime.ts`, worker IPC), `integrations/specimen-afd` (32 commands), `endpoints/specimen-cli` (one-shot `note-*`), and `endpoints/specimen-server` (warm MCP bench): committed `specimens/notes/note-<12>.json` storage, zero-browser list/resolve/reopen, orphan/weakened/unchecked/restored detection, move & reopen history preservation, and typed errors (`NOTE_EMPTY`, `NOTE_NOT_FOUND`, `REASON_REQUIRED`, `NOTE_ALREADY_RESOLVED`, `NOTE_NOT_RESOLVED`, `POINT_STALE`); verified unit, browser (`in-process` and `process`), and literal YAML scenarios `07`–`09`, and updated Specimen provenance |
| 2026-11-26 | Close | Epic [#1110](https://github.com/lushly-dev/afd/issues/1110) closed with Slices 1 and 2 merged; folder moved from `active/` to `complete/`. Slice 3 remains as standalone [#2045](https://github.com/lushly-dev/afd/issues/2045). |
