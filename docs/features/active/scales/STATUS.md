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
- Edit only your phase's own blank-line-separated bullet under [Phases](#phases); never add a running
  summary line of which phases are done or next.

## Status block

- **State:** active (approved and promoted from `proposed/` on 2026-11-22). Scaffolded 2026-11-13
  against `main` at `e5d683a8`; pivoted to the two-stage system and drafted 2026-11-22 against `main`
  at `2ba52efcb0e` after three guided walkthrough passes with the owner; walked once across all three
  seats by a fresh read-only reader and reviewed by two independent reviewers (Gemini 4 Neon `high`
  and GPT-6.2 Astra `high`), with every finding applied ([#2124](https://github.com/lushly-dev/afd/pull/2124)).
- **Epic:** [#1111](https://github.com/lushly-dev/afd/issues/1111). Work happens in its phased
  sub-issues under [Phases](#phases); each phase owns its own blank-line-separated line there so
  parallel pull requests never conflict.
- **Approved scope:**
  - Two-stage system on plain Violet references (derived-value transforms dropped): four hand-picked
    `ref.*` ramps (spacing, paired type size+line, radius, target; shell geometry and focus ring
    unramped) plus purpose-named semantic tokens with governed off-ramp reasons and `>=2` repeat
    warnings.
  - Eight jobs written as scenarios in [`scenarios/`](scenarios/) (Slice 1 = 01–07, Slice 2 = 08
    optional), zero new top-level Violet commands (8 scenario-tested + 4 Phase 1 plumbing commands).
  - Coordinated `contractVersion: 3` cutover retiring 16 makeshift ladder tokens, adding
    `space.inline.hairline` (`ref.space.2`), and renaming 25 semantic tokens across `violet-elements`,
    Loam, `health-dashboard`, `todo/frontends/shared`, `site/fast-af`, and `.claude/skills/loam-design`.
  - Standalone `violet-elements` HTML attribute taxonomy spun out as [#2120](https://github.com/lushly-dev/afd/issues/2120).
- **Follow-ups:** the [table below](#follow-ups-not-yet-issues).

## Phases

Each phase owns one blank-line-separated bullet so concurrent pull requests never edit adjacent lines.

- **Phase 1 ([#2195](https://github.com/lushly-dev/afd/issues/2195)) — Violet core, `violet-afd`, `violet-server`, and Slice 1 scenarios (01–07):** Done 2026-11-23, merged in [#2295](https://github.com/lushly-dev/afd/pull/2295). Exposed `ResolvedToken.reason` (`add`/`override`/`reset`/`copy`/`include`), added `type: 'ramp'` (without `warnUneven`), `pattern.target: 'id'`, multi-violation registry & advisory severities, core `validateConstraints`, `excludePrefixes` on `resolveTokens`/`exportTokens`, and `CheckIssue.code` snapshot keying; wired `constraints.set`, `constraints.validate` (`onlyViolating`), `analyze.violations`, `analyze.snapshot`, `tokens.resolve`, `export`, `interface.check` (`leaked`), `changes.impact`, `import.*`, and `violet-server` instructions; added `integrations/violet-afd/scenarios/violet-adapter.ts` and moved Slice 1 scenarios 01–07 beside `violet-afd` (verified via Vitest, `pnpm check`, `pnpm test:violet`, and Loam token/theme checks).

- **Phase 2 ([#2197](https://github.com/lushly-dev/afd/issues/2197)) — Loam ramps, `violet-elements`, and repo-wide contract cutover:** Done 2026-11-24, PR [#2532](https://github.com/lushly-dev/afd/pull/2532). Added the four `global.ref.*` ramps (`space`, `type`, `radius`, `target`) in `endpoints/loam/packages/theme/tree/loam.tokens.json`, updated semantic and compact overrides across `tree/*.tokens.json` to `ref.*`, attached Loam's `ramp` + positional-name constraints on `loam` in `src/tree/index.ts`, and wired `@lushly-dev/violet-core`'s `validateConstraints` into `src/outputs.ts` / `src/check.ts` (`theme:check`); bumped Loam `CONTRACT_VERSION` (`2 -> 3`), `COMPONENT_EXPORT_VERSION` (`1 -> 2`), `build-runtime-theme.mjs` (`contractVersion === 2`), `violet-elements/tokens/interface.json` (`4 -> 5`, 96 ids), and `violet-afd` `SPECIMEN_INTERFACE` (`4 -> 5`); updated `HOOK_TOKEN_TARGETS['--_space-xs']` to `'--violet-space-stack-tight'`; retired 16 ladder tokens, added `space.inline.hairline` (`ref.space.2`), and renamed 25 semantic tokens across `violet-elements`, Loam chrome/console/apps/plugins, `health-dashboard`, `todo/frontends/shared`, `site/fast-af`, `site/js/vendor/fast-af.js`, `endpoints/loam/docs/design.md`, and `.claude/skills/loam-design`.

- **Phase 3 ([#2198](https://github.com/lushly-dev/afd/issues/2198)) — Slice 2: optional uneven-jump advisory check (`warnUneven`) and scenario 08:** Done 2026-11-24, merged in [#2536](https://github.com/lushly-dev/afd/pull/2536). Added `warnUneven: { maxRatioSpread, ignoreAbove? }` (`RampWarnUnevenSchema`) and `'ramp:uneven'` advisory evaluation (`buildRampUnevenViolations`, deterministic token-id ordering, unit-matched positive step ratios, `ignoreAbove` sentinel exclusion, preserved `'warning'` severity appended after primary ramp errors) in `@lushly-dev/violet-core`; added `warnUneven.maxRatioSpread > 1` validation with field-specific `suggestion` in `validateConstraintSemantics` (`constraints.set`, `import.tree`, `export.tree`) and strict nested `warnUneven` schema validation/round-trip coverage in DTCG `import.tree`/`export.tree`; moved `08-warn-uneven-ramp-jumps.scenario.yaml` to `integrations/violet-afd/scenarios/` and enabled it in `scales.scenarios.test.ts`.

## Pre-approval steps (historical)

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
| Promote to `active/` and open sub-issues | Done 2026-11-22, merged in [#2201](https://github.com/lushly-dev/afd/pull/2201) | Promoted to `docs/features/active/scales/`; sub-issues [#2195](https://github.com/lushly-dev/afd/issues/2195), [#2197](https://github.com/lushly-dev/afd/issues/2197), [#2198](https://github.com/lushly-dev/afd/issues/2198) under [#1111](https://github.com/lushly-dev/afd/issues/1111) |

## How the jobs were checked

Run on 2026-11-22 at `2ba52efcb0e` on Node `v26.13.1` (`.nvmrc`) after applying all three-seat walk
and two-model review revisions, and re-verified on 2026-11-22 against `origin/main` at `91d30fcec87`
on Node `v26.13.0` (`.nvmrc`) after promotion to `docs/features/active/scales/`.

Parse: `node packages/cli/dist/bin.js scenario validate docs/features/active/scales/scenarios`

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

- **Promotion & DTCG alignment (2026-11-22 at `91d30fcec87`):** re-read first-hand after [#2166](https://github.com/lushly-dev/afd/pull/2166) and [#2090](https://github.com/lushly-dev/afd/pull/2090):
  - `endpoints/loam/packages/theme/{package.json,tree/loam.tokens.json,tree/loam_light_compact.tokens.json,src/{check,components,outputs,theme.test}.ts,src/tree/{index,types}.ts}`
  - `integrations/violet-afd/src/commands/{import/json.ts,import/tree.ts,export/tree.ts}`

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-12 | First Patterns draft | Raised in the [Patterns status](../patterns/STATUS.md#follow-ups-not-yet-issues); this proposal is where it is now tracked | Moved here |
| 2026-11-22 | Pass 1 Q6 / Pass 3 Q4 | `violet-elements` HTML attribute taxonomy (`size` using `xs..xl` / `sm..lg` / `compact..comfortable`, `density`, `padding` using `none`/`small`/`medium`/`large` in `foundations/fast-af/packages/violet-elements/attribute-taxonomy.jsonc`). Out of scope for Scales | Filed as [#2120](https://github.com/lushly-dev/afd/issues/2120) |
| 2026-11-22 | First walk (Seat 1) | Year-in off-ramp auditing: expose `reason` on `tokens.matrix` (`MatrixCellSchema`) or add an `onlyOffRamp` filter to `tokens.resolve` so accumulated unique reasoned off-ramp exceptions can be reviewed without dumping every token | Open (Slice 2 / follow-up) |
| 2026-11-22 | Promotion review | Round-tripping `$extensions["dev.lushly.violet"].reason` in `export.tree` (kept unchanged in Phase 1 so Loam's byte-identical round-trip and one-line `$value` override diff test stay intact; needed only if committed DTCG files later hold off-ramp literals) | Open (follow-up) |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-13 | Scaffold | After the [Patterns](../patterns/patterns.proposal.md) proposal, the owner agreed to four follow-on proposals from the same discussion: Design Decisions, Screens from Jobs, Pointing and Scales. This scaffold was written from a survey of the code, reviewed once by an independent reader, and committed with its epic |
| 2026-11-22 | Walkthrough, draft, walk & review | Ran a three-pass walkthrough with the owner locking Pass 1–3 decisions, rewrote `scales.proposal.md`, updated `STATUS.md` and `docs/features/README.md`, filed standalone attribute issue [#2120](https://github.com/lushly-dev/afd/issues/2120), wrote 8 scenarios, ran a fresh three-seat reader walk (7 blockers, 7 improvements) and a two-model independent review (Gemini 4 Neon `high` + GPT-6.2 Astra `high`; all findings applied), and re-verified all three `jobs-first` checks |
| 2026-11-22 | Promotion & sub-issues | Promoted `docs/features/proposed/scales/` to `docs/features/active/scales/`, updated `docs/features/README.md` and sibling feature links (`patterns`, `agent-first-design`, `design-decisions`), reshaped `STATUS.md` with per-phase blank-separated bullets, aligned Phase 2 & §2/§7 with [#2166](https://github.com/lushly-dev/afd/pull/2166)'s DTCG `tree/*.tokens.json` loader (caught in independent review), clarified `export.tree` round-trip behavior in Phase 1, updated epic [#1111](https://github.com/lushly-dev/afd/issues/1111) (dropped `needs:decision`, updated links and title), and filed triaged sub-issues [#2195](https://github.com/lushly-dev/afd/issues/2195) (Phase 1, `status:planned`), [#2197](https://github.com/lushly-dev/afd/issues/2197) (Phase 2, `status:deferred` / `blocked`), and [#2198](https://github.com/lushly-dev/afd/issues/2198) (Phase 3 / Slice 2, `status:deferred` / `blocked`) |
| 2026-11-23 | Phase 1 ([#2195](https://github.com/lushly-dev/afd/issues/2195), [#2295](https://github.com/lushly-dev/afd/pull/2295)) | Implemented Scales Phase 1 across `@lushly-dev/violet-core`, `@lushly-dev/violet-afd`, and `@lushly-dev/violet-server`; added `integrations/violet-afd/scenarios/violet-adapter.ts` and moved Slice 1 scenarios 01–07 beside `violet-afd`, passing all 7 scenarios and Phase 1 regression suites in Vitest |
| 2026-11-24 | Phase 3 ([#2198](https://github.com/lushly-dev/afd/issues/2198), [#2536](https://github.com/lushly-dev/afd/pull/2536)) | Implemented Scales Phase 3 / Slice 2: optional `warnUneven: { maxRatioSpread, ignoreAbove? }` and advisory `ramp:uneven` check in `@lushly-dev/violet-core`, handler validation for `maxRatioSpread > 1` and strict DTCG `import.tree`/`export.tree` round-trip in `integrations/violet-afd`, and moved/passed `08-warn-uneven-ramp-jumps.scenario.yaml` in `scales.scenarios.test.ts` |
| 2026-11-24 | Phase 2 ([#2197](https://github.com/lushly-dev/afd/issues/2197), [#2532](https://github.com/lushly-dev/afd/pull/2532)) | Implemented Scales Phase 2: four `global.ref.*` ramps and `validateConstraints` (`ramp` + positional-name guard) in `@lushly-dev/loam-theme` (`CONTRACT_VERSION: 3`, `COMPONENT_EXPORT_VERSION: 2`), `violet-elements` `tokens/interface.json` (`contractVersion: 5`, 96 ids), `violet-afd` `SPECIMEN_INTERFACE` (`5`), and repo-wide cutover retiring 16 ladder tokens, adding `space.inline.hairline`, and renaming 25 semantic tokens across `violet-elements`, Loam, `health-dashboard`, `todo/frontends/shared`, `site/fast-af`, `design.md`, and `loam-design` skill |
