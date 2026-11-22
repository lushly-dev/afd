# Patterns: status

Epic: [#1073](https://github.com/lushly-dev/afd/issues/1073). File new work for this area as its sub-issue.

Read this before the [proposal](patterns.proposal.md). It records exactly what is done and what is
not, so an agent never has to scan the code to learn what is current. It follows the shape of the
[Component Briefs status](../../complete/component-briefs/STATUS.md).

## How to keep this file

- "Done" means merged to `main` with evidence linked. Anything else is "in progress" or "open",
  with what remains spelled out.
- Record how you verified it, the command or check, and the absolute date.
- Write down follow-ups that are not yet issues, with the date and who raised them. Link the issue
  when one exists.
- Never delete history. Mark an entry superseded and point to what replaced it.

## Status block

- **State:** proposed (owner decisions recorded, walked and reviewed, 2026-11-21; [#1133](https://github.com/lushly-dev/afd/issues/1133)).
  Drafted 2026-11-12 against `main` at `d152f3dc`; revised 2026-11-21 against `main` at `9e2aff933`.
- **Epic:** [#1073](https://github.com/lushly-dev/afd/issues/1073). Its checklist mirrors the steps
  below; this file stays the source of truth.
- **Done:** the proposal; owner walkthrough decisions (section 12 and decisions 1–20); ten jobs as
  scenario files; three-seat reader walks (pass 1 + pass 2 on post-walk additions); two-model
  independent review with all blockers applied; scenario checks; Phase 0
  ([#1966](https://github.com/lushly-dev/afd/issues/1966)) and follow-up issues filed.
- **Not done:** Phase 0 measurements ([#1966](https://github.com/lushly-dev/afd/issues/1966));
  Phases A to D (gated on Phase 0.5). See [What is not done](#what-is-not-done).
- **Last verified:** 2026-11-21, the scenario checks below, with the tools built in this worktree
  at `9e2aff933` on Node 26.13.0.
- **Follow-ups:** the [table below](#follow-ups-not-yet-issues).

## Steps

| Step | State | Evidence |
| --- | --- | --- |
| Draft the proposal | Done 2026-11-12 | [`patterns.proposal.md`](patterns.proposal.md) |
| Write the jobs as scenarios | Done 2026-11-12; revised 2026-11-21 | [`scenarios/`](scenarios/), ten files, 44 steps |
| Check the scenarios | Done 2026-11-21 | [How the jobs were checked](#how-the-jobs-were-checked) |
| Save as a proposal and open the epic | Done 2026-11-12 | Epic [#1073](https://github.com/lushly-dev/afd/issues/1073) |
| The owner cuts, adds and ranks the jobs, and answers the proposal's section 12 | Done 2026-11-21 | Proposal, sections 4, 8 and 12 (all 7 questions resolved, decisions 1–20 ratified) |
| Walk the paths with readers who did not write them | Done 2026-11-21 ([#1133](https://github.com/lushly-dev/afd/issues/1133), [#2020](https://github.com/lushly-dev/afd/pull/2020)) | Pass 1: three fresh read-only readers (Person, Job List, Calling Agent); Pass 2: one fresh read-only reader over post-walk additions ([The walk](#the-walk)) |
| Independent review of the proposal | Done 2026-11-21 ([#1133](https://github.com/lushly-dev/afd/issues/1133), [#2020](https://github.com/lushly-dev/afd/pull/2020)) | Two-model first review (`gemini-4-neon` + `claude-opus-5-5` `high`) + focused verification passes ([The review](#the-review)) |
| Phase 0, steps 0.1 to 0.5 | Planned ([#1966](https://github.com/lushly-dev/afd/issues/1966)); $25 cap on step 0.3 | Proposal, section 9 |
| Phases A to D | Not started; gated on phase 0.5's owner decision | Proposal, section 9 |

## What is not done

- **Every claim about what a gate can read is unproven.** The proposal's section 5.2 says which
  parts exist today. Whether focus can be read from a capture is checked in Phase 0.1
  ([#1966](https://github.com/lushly-dev/afd/issues/1966)).
- **Nothing in it is measured or implemented.** Phase 0 ([#1966](https://github.com/lushly-dev/afd/issues/1966))
  exists to measure gate portability, copy remount fidelity, builder value and brief size before
  Phase A specifies format 2.

## The walk

| Date | Reader | Seats | Verdict | Findings |
| --- | --- | --- | --- | --- |
| 2026-11-21 | Three fresh read-only subagents (`research`, `gemini-4-neon`), one per seat, briefed separately without author conclusions | The person, the job list, the calling agent | Revise (all three) | 14 blockers (10 root issues), 15 improvements |
| 2026-11-21 | One fresh read-only subagent (`research`, `gemini-4-neon`) walking the post-walk additions (Job 10, `specimen-list`, `PATTERN_SETUP_MISSING`, `PATTERN_UNKNOWN`, `fingerprintsOnly`) | All three seats | Revise | 2 blockers (4 coverage levels vs 3 packable bases; Job 10 single-bench scoping + `kind: case`/`case`), 6 improvements — both blockers and all 6 improvements applied |

All 14 blockers were applied to [`patterns.proposal.md`](patterns.proposal.md) and [`scenarios/`](scenarios/)
(see proposal [section 4](patterns.proposal.md#4-jobs)). Dispositions for all 15 improvements:

| Improvement (seat) | Disposition | Reason / Change |
| --- | --- | --- |
| Person I1: facet governance, `scope`/`limit` on `components-pattern-list` | Applied (partial) | Added `scope` filter and `availableFacets` on unfiltered/empty answers; facet vocabulary governance stays open for Phase A |
| Person I2: `createPattern` guard, `complete`→`draft` guard, `screenshot`, missing errors | Applied (partial) | Added `createPattern: true` + `PATTERN_UNKNOWN`, `screenshot` on save, and `SPECIMEN_NOT_FOUND`; `complete`→`draft` downgrade guard on `replace: true` deferred to Phase A |
| Person I3: `stale[]` origin fields, static no-browser staleness check, batch refresh | Applied (partial) | Added `pattern`, `name`, `origin` to `stale[]` and `fingerprintsOnly: true` static mode; batch copy refresh deferred to Phase A |
| Person I4: pattern/copy deprecation (`status: deprecated` / `replacedBy`) | Deferred to Phase A | Tracked in Phase A and Follow-ups; not needed before Phase 0 proves the format |
| Person I5: library-qualified `known`/`patterns@1`, provenance stamping, diffability | Applied (partial) | Adopted `<library>/<id>` in `known`/`patterns@1` and `components-pattern-open` stamping (plus in-repo disk rule); revision change notes deferred to Phase A |
| Person I6: `specimen-list` in §6, `specimen-capture` skip, validation codes, 2-pass cost | Applied (partial) | Added filtered `specimen-list` (`kind: story \| native \| gate`) and logged Design Decisions `specimen-capture` skip as a Phase A follow-up; extra static codes (`GATE_UNKNOWN`, `TARGET_UNKNOWN`) belong in Phase A schema |
| Person I7: `STATUS.md` stale against proposal | Applied | Synced `STATUS.md` with 2026-11-21 revision |
| Job List I1: Scenarios 2, 3, 8, 9 stopped short of outcomes | Applied | Asserted `customize` + component `patterns` (02), `setups`/`gates` + `specimen-run` (03), `keep` + `css` (08), `specimen-run` + `patterns.complete` + `out-of-context` basis (09) |
| Job List I2: missing refusal/authoring/quiet scenarios | Applied (partial) | Added `PATTERN_SETUP_MISSING` (03), `PATTERN_UNKNOWN` + draft promotion (06), and `guides.obligations: guides@1` (04); `PATTERN_AMBIGUOUS` and unreadable-pack remain sibling/unit tests in Phase A |
| Job List I3: `use-when`/`avoid-when` kebab mismatch & stale `STATUS.md` | Applied | Fixed `gaps` to camelCase (`useWhen`, `avoidWhen`) in 06 and synced `STATUS.md` |
| Calling Agent I1: first-class tool cap, `availableFacets`, `components-check` overlap | Applied (partial) | Stated non-first-class placement (7/8 cap) and `availableFacets`; outdated-copy warnings in `components-check` deferred to Phase A |
| Calling Agent I2: §3 stale on A28 `content.guidance` and A30 `components-check` | Applied | Updated §3 for A28/A30 and documented `content.guidance` vs `content.patterns` boundary |
| Calling Agent I3: `components-brief` `known`/A24 `omitted`/`detail: "api"`/`sections` | Applied | Added `sections: ["patterns"]`, `detail: "api"` rule, dropped fragile `omitted: { length: 0 }` in 02 |
| Calling Agent I4: bracket field paths, `--gate--` separator, browserless check, 3 packable bases | Applied | Changed `05` to `scenario[0]`, gate ids to `--gate--`, added `fingerprintsOnly: true`, preserved the 3 packable bases in format 2 while `missing` blocks packing |
| Calling Agent I5: Umbel reload requirement after `specimen-pack-export` | Applied | Noted server reload requirement in `06-save-a-working-region.scenario.yaml` header and §3 |

## The review

| Date | Reviewer | Scope | Verdict | Findings |
| --- | --- | --- | --- | --- |
| 2026-11-21 | Fresh read-only reviewer (`gemini-4-neon` `high`) | `patterns.proposal.md`, `STATUS.md`, all 10 scenarios at `537536a65` vs `main` `9e2aff933` | Revise | 4 blockers, 9 improvements — all 4 blockers and all 9 improvements applied |
| 2026-11-21 | Cross-provider reviewer (`claude-opus-5-5` `high`; note: `gpt-6.2-astra` absent from local Codex catalog) | Same brief and commit | Revise | 6 blockers (3 overlapping with above), 13 improvements — all 6 blockers and all 13 improvements applied |
| 2026-11-21 | Focused verification pass (`gemini-4-neon` `high`) | Post-fix diff (7 named blockers + full link/count check) | Approve | 7/7 blockers resolved, 0 blockers, 1 minor improvement (`Person I2` disposition wording — applied) |

## How the jobs were checked

Run 2026-11-21 in this worktree at `9e2aff933`, after `pnpm install --frozen-lockfile` and
`pnpm -F "@lushly-dev/afd-cli..." build` on Node 26.13.0.

```text
$ node packages/cli/dist/bin.js scenario validate docs/features/proposed/patterns/scenarios
✓ All 10 scenario(s) are valid!

$ (the dry-run, expect-ref scan and coverage script from jobs-first.md, run in packages/testing)
dry run: 10 files, 0 with errors; expect refs: 0
{"totalScenarios":10,"totalSteps":44,
 "commands":{"tested":12,"known":12,"untested":[],"coverage":100},
 "errors":{"tested":5,"known":8,"untested":["TARGET_NOT_FOUND","SPECIMEN_NOT_FOUND","PATTERN_AMBIGUOUS"],"coverage":62.5},
 "jobs":{"count":10,…}}
not drafted: []
```

*(Earlier run, 2026-11-12 at `d152f3dc`: 9 files, 28 steps, 9 of 11 commands, 3 of 5 errors, 0 dry-run errors.)*

The known commands given to the script are the twelve in the proposal's section 6, and the known
errors its eight error codes. Because `afd-testing`'s evaluator
(`packages/testing/src/runner/evaluator.ts:180-220,452-462`) requires exact array lengths when
matching object arrays and compares plain arrays whole, partial lists use dotted index paths; step
references are resolved in `input` only (`scenario-runner.ts:308`), and the scan confirmed zero
`${{` references in `expect`.

## What was read to write it

Read on `main` at `d152f3dc` (2026-11-12) and re-verified at `9e2aff933` (2026-11-21):

- Specimen: `README.md`, `docs/pack-format.md` (version 1), `schema/guide/*.schema.json`,
  `src/types.ts`, `src/schema.ts`, `src/validate.ts`, `src/bench-runtime.ts`, `src/guides.ts`,
  `src/pack-types.ts`, `src/pack-schema.ts`, `integrations/specimen-afd/src/commands.ts`,
  `endpoints/specimen-cli/src/cli.ts` and `endpoints/specimen-server/README.md`.
- Component Briefs: `STATUS.md` (completed 2026-11-13), `prototype.md` and `first-consumer.md`.
- Umbel: `endpoints/umbel/docs/plugins/components/spec.md`, `umbel-plugin.toml`, `src/*.rs`,
  `tests/fast_af.rs` and `first-party/tests/first_class.rs`.
- Sibling proposals: `design-decisions`, `screens-from-jobs`, `pointing` and `scales`.
- FAST-AF: the combobox guide, `src/shared.guide.json`, the button's stories, `pack/GAPS.md` and `README.md`.
- Loam: `endpoints/loam/packages/chrome/specimens/support.ts`, screen specimens and the design skill.
- AFD: `jobs-first.md`, `.gitignore`, `docs/features/README.md`, `packages/testing/src/runner/{evaluator,scenario-runner}.ts`.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-12 | First draft | Sizes named by position (`xs` to `xl`) are hard to extend and seldom say what a size is for. A separate proposal could state a scale as a Violet constraint, name tokens by purpose and derive one size from another; Violet refuses a reference with a transform today (`NOT_IMPLEMENTED`). Raised with the owner, who dislikes position names; out of this proposal's scope | Moved 2026-11-13 to the [Scales](../scales/scales.proposal.md) proposal ([#1111](https://github.com/lushly-dev/afd/issues/1111)) |
| 2026-11-12 | First draft | Loam's screen specimens set up state with a stub client, separately from the scenario files that assert the same commands. Specimen's application-command runner (T11) would let one scenario drive a screen to a state. The proposal lists it under Later | Moved 2026-11-13 to the [Screens from Jobs](../screens-from-jobs/screens-from-jobs.proposal.md) proposal ([#1109](https://github.com/lushly-dev/afd/issues/1109)). Correction: Loam has no scenario files; its job tests are Vitest |
| 2026-11-12 | First draft | The [design-to-code proposal](../design-to-code/00-overview.md) assumes designs are authored in a drawing tool. This proposal assumes the rendered screen is the medium. Whether to retire or rewrite that proposal is the owner's call | Filed 2026-11-21 as [#1968](https://github.com/lushly-dev/afd/issues/1968) (assigned to owner, `needs:decision`) |
| 2026-11-12 | First draft | `violet-elements`' README still tells a reader to run Storybook, and its one performance baseline names a story that no longer exists. Found while surveying; not this proposal's work | Tracked in [#1085](https://github.com/lushly-dev/afd/issues/1085) |
| 2026-11-21 | Owner walkthrough | Pointer type (`coarse` / `fine`) is not part of Specimen's context model; touch pattern gates rely on viewport alone until added | Filed 2026-11-21 as [#1967](https://github.com/lushly-dev/afd/issues/1967) (sub-issue of `#1073`, deferred until Phase 0.5) |
| 2026-11-21 | Owner walkthrough | 45 of `violet-elements`' 77 pack records have no role (`pack/GAPS.md:15`; does not block gates, which read the live tree) | Tracked in [#1146](https://github.com/lushly-dev/afd/issues/1146) |
| 2026-11-21 | Walk & Review | Phase A specification items deferred past Phase 0: pattern/copy deprecation (`status: deprecated` / `replacedBy`), outdated-copy warnings in `components-check`, batch copy refresh, `patternLibrary` naming in `specimen-coverage`, and amending Design Decisions (`#1108`) so unfiltered `specimen-capture` skips gate cases | Deferred to Phase A (gated on [#1966](https://github.com/lushly-dev/afd/issues/1966) step 0.5) |
| 2026-11-21 | Owner walkthrough | Drop `needs:decision` label on epic [#1073](https://github.com/lushly-dev/afd/issues/1073) once [#2020](https://github.com/lushly-dev/afd/pull/2020) lands (Phases A–D stay gated on Phase 0.5) | Pending merge of [#2020](https://github.com/lushly-dev/afd/pull/2020) |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-12 | First draft | A discussion with the owner on how interfaces are built when agents do the building led to this proposal: components stay; guidance, requirements and gates are separated from a component's code; a working region can be saved as a reference; reuse is by instance or by copy. The proposal, nine scenario files and this file were written, and the scenario checks run. Then committed as a proposal, and epic #1073 opened |
| 2026-11-21 | Walkthrough & `#1133` | Walked the proposal section by section with the owner, resolving all seven section 12 questions (decisions 1–20), reconciling shared conventions with Design Decisions / Screens from Jobs / Pointing, and filing Phase 0 ([#1966](https://github.com/lushly-dev/afd/issues/1966)), pointer context ([#1967](https://github.com/lushly-dev/afd/issues/1967)) and design-to-code ([#1968](https://github.com/lushly-dev/afd/issues/1968)). Ran three-seat reader walks (pass 1 + pass 2 on additions) and two-model independent review (`gemini-4-neon` + `claude-opus-5-5` `high`), applied all blockers and improvements, updated `docs/features/README.md`, and verified all 10 scenarios (44 steps, 12/12 commands, 5/8 errors, 0 dry-run errors) |
