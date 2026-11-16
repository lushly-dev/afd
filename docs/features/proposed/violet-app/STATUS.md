# Violet in Loam: status

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

- **State:** draft, for the owner to approve. Written 2026-11-15 against `main` at `6eeb545d`.
  Nothing is implemented, and no Violet code is changed.
- **Done:** what exists today, verified first-hand with file and line; fifteen jobs as scenario
  files that pass the three checks; a recommended app kind; the `violet-tree` document type;
  screens by part and layout class; twenty-two drafted commands; ten gaps (G1 to G10); the
  dependencies; the home and tests; five questions for the owner with recommendations.
- **Not done:** the owner's ranking of the jobs and answers to the five questions. Then a
  specification in `endpoints/loam/plugins/violet/docs/`, and the build.
- **Order:** the [jobs-first guide](../../../../.claude/skills/afd/references/jobs-first.md),
  steps 1 to 6 done, with one walk; step 9, the owner's ranking, next.

## Steps

| Step | State | Evidence |
| --- | --- | --- |
| What exists today, read first-hand | Done 2026-11-15 | Proposal, [section 2](violet-app.proposal.md#2-what-exists-today) |
| Jobs and drafted commands | Done 2026-11-15 | Proposal, sections 3 and 5 |
| Each job as a scenario, and the three checks | Done 2026-11-15 | [`scenarios/`](scenarios/), fifteen files, 61 steps; [How the jobs were checked](#how-the-jobs-were-checked) |
| Walk the paths with a reader who did not write them | Done 2026-11-15: one fresh reader, three seats; six blockers and eleven improvements, all applied; three jobs and four commands added | Proposal, [section 8](violet-app.proposal.md#8-what-the-walk-changed) |
| The owner ranks the jobs and answers section 12 | Open | |
| Specification, in the plugin's folder | Open, after approval | |
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
| Loam phase 6, step 11 (the desktop lane's mounts) | In progress, by the owner's brief; Loam's STATUS.md lists steps 4 to 13 as not done at `6eeb545d` | Running the app in the desktop Loam; `stdio` mounts for the later engine |
| Loam phase 5 (`calls`, plain mounts, mounted document types, the copilot) | Not started | The mounted engine (question 2) |
| Loam's plugin-engine specification (Mail's L5) | Open since 2026-11-10 | The mounted engine, as an alternative to phase 5's `calls` |
| Violet gaps G1, G2, G9 and G10 in `violet-afd` | Not filed | The slice: tree export, the interface check, replay and safe values |
| The Violet session working on `violet-elements` and packaging (#1195, #1297) | Both merged; further work may be in flight | Any change to Violet's code here waits for it |

## Follow-ups not yet issues

| Date | Raised by | Follow-up |
| --- | --- | --- |
| 2026-11-15 | This proposal | File G1 to G4 and G8 to G10 against `violet-afd` once the owner answers question 4 |
| 2026-11-15 | This proposal | `violet-server` answers no `afd-help` or `afd-detail`, so Loam cannot discover it as an AFD server (G5 to G7) |
| 2026-11-15 | This proposal | Amend the `violet` row of Loam's first-party apps (`endpoints/loam/docs/proposal.md:674`) if question 2 is answered as recommended |
| 2026-11-15 | This proposal | Measure Loam's tree, and later Lushly's, as DTCG files against the 256 KiB bound on an instance command's input |

## Session log

| Date | Session | What happened |
| --- | --- | --- |
| 2026-11-15 | Proposal | Drafted the proposal, twelve scenarios and this file at `6eeb545d`; ran the three checks; one fresh reader walked the paths in three seats; applied every finding (three jobs and four commands added, undo and unsafe values fixed, agents stated plainly); reran the checks |
