# Scales: status

Epic: [#1111](https://github.com/lushly-dev/afd/issues/1111). File new work for this area as its sub-issue.

Read this before the [proposal](scales.proposal.md). It records exactly what is done and what is not, so an
agent never has to scan the code to learn what is current. It follows the shape of the
[Patterns status](../patterns/STATUS.md).

## How to keep this file

- "Done" means merged to `main` with evidence linked. Anything else is "in progress" or "open",
  with what remains spelled out.
- Record how you verified it, the command or check, and the absolute date.
- Write down follow-ups that are not yet issues, with the date and who raised them. Link the issue
  when one exists.
- Never delete history. Mark an entry superseded and point to what replaced it.

## Status block

- **State:** draft (walked and independently reviewed, on branch `t3/scales-proposal-walkthrough`).
  Scaffolded 2026-11-13 against `main` at `e5d683a8`; pivoted to the two-stage system and drafted
  2026-11-22 against `main` at `2ba52efcb0e` after three guided walkthrough passes with the owner;
  walked once across all three seats by a fresh read-only reader and reviewed by two independent
  reviewers (Gemini 4 Neon `high` and GPT-6.2 Astra `high`), with every finding applied. Held in
  `proposed/` until implementation is scheduled.
- **Epic:** [#1111](https://github.com/lushly-dev/afd/issues/1111). Its checklist mirrors the steps below; this file
  stays the source of truth.
- **Done:**
  - Owner direction and core design choices locked (Pass 1, 2026-11-22).
  - Eight jobs cut, rewritten, ranked and split into Slice 1 (1–7) and Slice 2 (8) (Pass 2, 2026-11-22).
  - Command extensions, Violet `type: 'ramp'` design, and `contractVersion: 3` cutover map locked (Pass 3, 2026-11-22).
  - Proposal rewritten, eight scenario files written in `scenarios/`, and all three `jobs-first` checks passing (100% command and error coverage, 0 `REF IN EXPECT`).
  - Fresh three-seat reader walk (2026-11-22) and two-model independent review (2026-11-22) completed with every finding applied and scenario checks re-verified.
  - Standalone `violet-elements` HTML attribute issue filed as [#2120](https://github.com/lushly-dev/afd/issues/2120).
- **Not done:**
  - Owner approval to promote to `docs/features/active/scales/` and open Slice 1 / Slice 2 sub-issues under `#1111` (held until implementation is scheduled, per Pass 3 Q5 Option A).
  - Anything implemented.
- **Follow-ups:** the [table below](#follow-ups-not-yet-issues).

## Steps

| Step | State | Evidence |
| --- | --- | --- |
| Scaffold: problem, what exists, draft jobs | Done 2026-11-13 | [`scales.proposal.md`](scales.proposal.md) |
| Open the epic | Done 2026-11-13 | Epic [#1111](https://github.com/lushly-dev/afd/issues/1111) |
| The owner answers the direction and core choices (Pass 1) | Done 2026-11-22 | `#1111` comment (2026-11-13) + Pass 1 walkthrough (2026-11-22) |
| The owner cuts, adds and ranks the jobs (Pass 2) | Done 2026-11-22 | Proposal, section 3 (8 jobs; Slice 1 = 1–7, Slice 2 = 8) |
| Draft the design, command extensions and cutover map (Pass 3) | Done 2026-11-22, merged in [#2124](https://github.com/lushly-dev/afd/pull/2124) | Proposal, sections 5–7 |
| Write each job as a scenario and run the checks | Done 2026-11-22, merged in [#2124](https://github.com/lushly-dev/afd/pull/2124) | [`scenarios/`](scenarios/), eight files; [How the jobs were checked](#how-the-jobs-were-checked) |
| Walk the paths with readers who did not write them | Done 2026-11-22 (three seats), merged in [#2124](https://github.com/lushly-dev/afd/pull/2124) | [The walk](#the-walk), proposal section 4 |
| Independent review | Done 2026-11-22 (two-model review), merged in [#2124](https://github.com/lushly-dev/afd/pull/2124) | [The review](#the-review), proposal section 4 |
| Promote to `active/` and open sub-issues | Held until implementation is scheduled | Per Pass 3 Q5 (Option A) |

## How the jobs were checked

Run on 2026-11-22 at `2ba52efcb0e` on Node `v26.13.1` (`.nvmrc`), with `@lushly-dev/afd-cli` and
`@lushly-dev/afd-testing` built in this worktree, after applying all three-seat walk and two-model
review revisions.

Parse: `node packages/cli/dist/bin.js scenario validate docs/features/proposed/scales/scenarios`

```text
✓ All 8 scenario(s) are valid!
```

Dry run (`checkFixtures: true`), `REF IN EXPECT` scan, and coverage report from `packages/testing`
([jobs-first guide](../../../../.claude/skills/afd/references/jobs-first.md#checking-without-a-server)):
- `knownCommands`: `token.add`, `token.override`, `token.remove`, `tokens.resolve`, `constraints.set`, `constraints.validate`, `interface.check`, `export`.
- `knownErrors`: `VALIDATION_ERROR`, `TOKEN_REFERENCE_NOT_FOUND`, `CIRCULAR_REFERENCE`.

Dry run and `REF IN EXPECT` scan printed no errors. Coverage:

```text
{"totalScenarios":8,"totalSteps":58,"commands":{"tested":8,"known":8,"untested":[],"coverage":100},"errors":{"tested":3,"known":3,"untested":[],"coverage":100},"jobs":{"count":8,"names":["add-between-steps","allow-reasoned-off-ramp","choose-by-purpose","refuse-broken-or-leaked-ramp","retune-ramp-step","stay-quiet-when-compliant","warn-uneven-ramp-jumps","flag-repeated-off-ramp"]}}
not drafted: []
```

Scenarios tagged `slice`: 01–07. Tagged `quiet`: 05. Tagged `refuse`: 07. Tagged `optional`: 08.
All partial list assertions use dotted index paths (`tokens.0.*`, `results.0.*`, `leaked.0.*`).

## The review

| Date | Reviewer | Scope | Findings |
| --- | --- | --- | --- |
| 2026-11-22 | Gemini 4 Neon (`high`, fresh read-only) | Full draft, `STATUS.md`, fixture, 8 scenarios at `2ba52efcb0e` | 2 blockers, 5 improvements (all applied) |
| 2026-11-22 | GPT-6.2 Astra (`high`, fresh read-only) | Same brief at `2ba52efcb0e` | 7 blockers, 2 improvements (9 valid, 3 overlapping, 0 noise; all applied) |

Key fixes applied from the two-model review: fixed broken links to promoted `screens-from-jobs` and `pointing` proposals plus section 7 anchor and `docs/features/README.md`; made the `app: 'violet'` fixture adapter an explicit Phase 1 deliverable; added `build-runtime-theme.mjs:27` and green `theme:build` + `cem:analyze` exit criteria; added repo-wide consumers (`health-dashboard`, `todo/frontends/shared`, `site/fast-af`, `loam-design` skill); added `space.inline.hairline` (`ref.space.2`) for existing `2px` callers; resolved `changes.impact` (`stageChange` vs `applyStep`, reason-only `diffViolations`, sub-check `code` in `violationKey`) and historical `'Imported from JSON'` sentinel handling; clarified unconditional `interface.check`/Loam export boundaries vs optional `excludePrefixes`; fixed leading-segment positional regex and Scenario 03; retained `pairWith` in Scenario 08; specified `leaked` sort/dedup/precedence and `warnUneven` upper-step target; reconciled §6 command counts (8 scenario-tested + 4 Phase 1 plumbing) and §2 line numbers.

## The walk

| Date | Reader | Seats | Verdict | Findings |
| --- | --- | --- | --- | --- |
| 2026-11-22 | One fresh read-only reader who did not write the draft | The person, the job list, the calling agent | Revise | 7 blockers, 7 improvements (all applied; none declined) |

The 7 blockers:
1. `constraints.validate` overwrote violation severity with `constraint.severity`, allowed only one violation per constraint, and never dispatched `warnUneven` on `config.ramp` tokens (`validate.ts:145-174`).
2. `import.json` / `import.tree` stamped `reason: 'Imported from JSON'`, silently defeating `requireOffRampReason: true`.
3. Broken ramp step references set both `aliasOf` and `referenceError`, so checking `aliasOf` before `referenceError` let broken references pass `constraints.validate`.
4. Scenario 07 step 1 asserted a field-specific `error.suggestion` that Zod-stage `registry.ts:208` did not produce.
5. `changes.impact` lacked `reason` on `add`/`override` and skipped `diffViolations` when `[value, resolvedValue]` did not change.
6. `ResolvedToken.reason` semantics were undefined for `reset`, `copy`, `include` and child `override` without `reason`.
7. `@lushly-dev/loam-theme` depends only on `@lushly-dev/violet-core` (no `validateConstraints` export yet), and §7 omitted `HOOK_TOKEN_TARGETS['--_space-xs']`, Loam's `CONTRACT_VERSION` bump, `TreeToken.reason`, `metadataFor` categories, `size.focus-ring.width`, switching `size.target.*`/`radius.round`/`density.ts`/`shell.ts` literals to `ref.*`, and explicit `applyTo` rules for the 4 shell bars.

All 7 blockers and 7 improvements were applied to [scales.proposal.md](scales.proposal.md) and [`scenarios/`](scenarios/) (summarized in proposal [section 4](scales.proposal.md#4-what-the-walk-and-review-changed)).

## What was read to write it

- **Scaffold (2026-11-13 at `e5d683a8`):** surveyed by another agent, read-only.
- **Draft, walk & review (2026-11-22 at `2ba52efcb0e`):** re-read first-hand:
  - `foundations/violet/packages/core/src/types/{constraint,token,token-id}.ts`, `src/tokens.ts`
  - `foundations/violet/packages/core/src/constraints/{validators,pattern-safety}.ts`
  - `foundations/violet/packages/core/src/engine/resolver.ts`, `src/export/transformers/css.ts`
  - `integrations/violet-afd/src/commands/{registry,constraints/{set,validate},analyze/{interface,violations},token/{add,override,resolve,catalog,matrix},export/export,import/{json,tree},changes/impact}.ts`
  - `endpoints/violet-server/src/server.ts`, `packages/testing/src/runner/fixture-loader.ts`
  - `endpoints/loam/packages/theme/{package.json,contract/tokens.json,scripts/lint-tokens.mjs,src/{check,components,outputs}.ts,src/tree/{index,primitives,components,density,shell,types}.ts}` and `endpoints/loam/packages/chrome/src/elements/entry-styles.ts`
  - `foundations/fast-af/packages/violet-elements/{tokens/interface.json,attribute-taxonomy.jsonc,scripts/build-runtime-theme.mjs}`
  - Repo-wide CSS consumer audit (`endpoints/health-dashboard/src/styles.css`, `packages/examples/todo/frontends/shared/src/styles.css`, `site/fast-af/*`, `.claude/skills/loam-design/*`).

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-12 | First Patterns draft | Raised in the [Patterns status](../patterns/STATUS.md#follow-ups-not-yet-issues); this proposal is where it is now tracked | Moved here |
| 2026-11-22 | Pass 1 Q6 / Pass 3 Q4 | `violet-elements` HTML attribute taxonomy (`size` using `xs..xl` / `sm..lg` / `compact..comfortable`, `density`, `padding` using `none`/`small`/`medium`/`large` in `foundations/fast-af/packages/violet-elements/attribute-taxonomy.jsonc`). Out of scope for Scales | Filed as [#2120](https://github.com/lushly-dev/afd/issues/2120) |
| 2026-11-22 | First walk (Seat 1) | Year-in off-ramp auditing: expose `reason` on `tokens.matrix` (`MatrixCellSchema`) or add an `onlyOffRamp` filter to `tokens.resolve` so accumulated unique reasoned off-ramp exceptions can be reviewed without dumping every token | Open (Slice 2 / follow-up) |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-13 | Scaffold | After the [Patterns](../patterns/patterns.proposal.md) proposal, the owner agreed to four follow-on proposals from the same discussion: Design Decisions, Screens from Jobs, Pointing and Scales. This scaffold was written from a survey of the code, reviewed once by an independent reader, and committed with its epic |
| 2026-11-22 | Walkthrough, draft, walk & review | Ran a three-pass walkthrough with the owner locking Pass 1–3 decisions, rewrote `scales.proposal.md`, updated `STATUS.md` and `docs/features/README.md`, filed standalone attribute issue [#2120](https://github.com/lushly-dev/afd/issues/2120), wrote 8 scenarios, ran a fresh three-seat reader walk (7 blockers, 7 improvements) and a two-model independent review (Gemini 4 Neon `high` + GPT-6.2 Astra `high`; all findings applied), and re-verified all three `jobs-first` checks |
