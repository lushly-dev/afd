# Component Briefs: status

Read this before the [proposal](component-briefs.proposal.md). It records exactly what is done and
what is not, so an agent never has to scan the code to learn what is current. It follows the shape
of the [Umbel status](../../../../endpoints/umbel/docs/STATUS.md).

## How to keep this file

- "Done" means merged to `main` with evidence linked. Anything else is "in progress" or "open",
  with what remains spelled out.
- Record how you verified it, the command or check, and the absolute date.
- Write down follow-ups that are not yet issues, with the date and who raised them. Link the issue
  when one exists.
- Never delete history. Mark an entry superseded and point to what replaced it.
- The work spans two areas, each with its own ledger: Specimen's half is
  [T12](../specimens/implementation.md#ordered-implementation-queue) in the
  [Specimens status](../specimens/STATUS.md), and Umbel's half is the
  [`components` plugin specification](../../../../endpoints/umbel/docs/plugins/components/spec.md)
  in the [Umbel status](../../../../endpoints/umbel/docs/STATUS.md). This file holds the plan's
  steps and points to those for the detail; when the two disagree, the area's ledger wins.

## Status block

- **State:** active. Phase 0 and steps A1, A2 and B1 are done. The rest of phases B and C, and phase D, are not done.
- **Last verified:** 2026-11-10 against `main` at `d4c31d9e`, which contains #949 (step A1) and #964
  (step A2). Read:
  `foundations/specimen/docs/pack-format.md`, `foundations/specimen/fixtures/pack/` and its
  `invalid/cases.json` (25 cases), and the Umbel code the plugin specification lists in its status
  block.
- **Done:** see [Steps](#steps).
- **Not done:** steps B2 to B4, and every step of phases C and D.
- **Follow-ups:** the [table below](#follow-ups-not-yet-issues).

## Steps

| Step | State | Evidence |
| --- | --- | --- |
| 0.1. Baseline, tasks and rules | Done 2026-11-09 | [`baseline.md`](baseline.md), printed by [`baseline.mjs`](baseline.mjs) at `cfb70942` |
| 0.2. Prototype | Done 2026-11-09 | [`prototype.md`](prototype.md); scripts in [`prototype/`](prototype/) |
| 0.3. Four unknowns | Done 2026-11-09, except macOS against Linux, moved to step B3's exit | [`prototype.md`](prototype.md#step-03-the-four-unknowns) |
| 0.4. Decision | Done 2026-11-09: the owner decided go, the brief as planned | [Proposal, Status](component-briefs.proposal.md#status) |
| A1. Pack format, version 0 | Done 2026-11-10 | [#949](https://github.com/lushly-dev/afd/pull/949), merged as `a1c52b37`: [the format](../../../../foundations/specimen/docs/pack-format.md), `@lushly-dev/specimen/pack`, its JSON Schema files and `foundations/specimen/fixtures/pack/` |
| A2. Specifications | Done 2026-11-10: the owner approved them by merging [#964](https://github.com/lushly-dev/afd/pull/964), as `d4c31d9e` | The [plugin specification](../../../../endpoints/umbel/docs/plugins/components/spec.md) and Umbel decisions D150 to D156; [T12](../specimens/implementation.md#ordered-implementation-queue) in the Specimens plan and status; this folder moved from `proposed/` to `active/` with this file |
| B1. Guides | Done 2026-11-10 | [#968](https://github.com/lushly-dev/afd/pull/968): the `guides` key, the guide schema, the loader and the static checks in `specimen-validate`, with `src/guides.test.ts` |
| B2. Guide obligations | Not started | Specimen's T12 |
| B2a. Roles in a capture | Not started | Specimen's T12 |
| B3. `specimen-pack` | Not started | Specimen's T12 |
| B4. FAST-AF's pack | Not started | Specimen's T12 |
| C1. Plugin skeleton and reader | Not started | Plugin specification, section 12 |
| C2. `components-brief` | Not started | Plugin specification, section 12 |
| C3. Skill and surfaces | Not started | Plugin specification, section 12 |
| C4. Exit tests | Not started; needs B4 | Plugin specification, section 12 |
| C5. First consumer | Not started; needs B4 | Plugin specification, section 12 |
| D1 to D4 | Not started; each its own decision after the exit | [Proposal, Phase D](component-briefs.proposal.md#phase-d-after-the-exit) |

What can run next: B1 in Specimen, and C1 in Umbel, side by side. C4 and C5 need B4's pack.

## What step A2 settled

- **Where the plugin's specification lives:** `endpoints/umbel/docs/plugins/components/spec.md`
  (D150).
- **The plugin reads a library whole on every call** and runs every check of the format, with the
  same codes as Specimen's `checkPack`, whose code is the normative source, and must agree exactly
  with it on Specimen's 25 invalid fixtures (D152). A library with a problem refuses the call: the owner decided
  that on 2026-11-10, and that the failure is handled gracefully (the plugin specification's sections 9.1 and 13).
- **No declared scope.** The proposal expected a per-command scope rule from Umbel's phase 5; phase
  5 decided scopes are resolved per call and never declared (D112). The plugin's `inspect` commands
  need `umbel:read` (D155). The proposal's risk table now says so.
- **Two requirements on Specimen** found while writing the reader, both in T12: a lone-surrogate
  invalid fixture case, and an export that keeps the deployer's `pack.toml`.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-10 | Step A2 | Specimen's fixtures have no case for an unpaired surrogate escape in text; the format says `TEXT_INVALID`, and the Rust reader must be held to the same answer | Open; Umbel's step C1 adds the case with a changeset (T12 lists it) |
| 2026-11-10 | Step A2 | `specimen-pack-export` swaps the whole pack directory; it must carry the deployment's `pack.toml` across, or Umbel loses the space override | Open; T12, step B3 |
| 2026-11-10 | Step A2 | Whether reading every record on every call is fast enough: the plugin's step C2 measures a 990-component library (`scale.rs`) | Open; C2 |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-09 | Proposal and phase 0 | The proposal written and revised after two independent reviews; steps 0.1 to 0.3 run and recorded; the owner decided go (step 0.4) |
| 2026-11-10 | Step A1 | The pack format, version 0, in Specimen ([#949](https://github.com/lushly-dev/afd/pull/949)) |
| 2026-11-10 | Step A2 | The plugin specification and D150 to D156; T12 in the Specimens plan and status; the folder moved to `active/`; this file. Sent for the owner's approval |
| 2026-11-10 | Step A2 approved | The owner merged #964 and answered the plugin specification's section 13: refuse the call, gracefully. Recorded, with the specification's section 9.1 |
| 2026-11-10 | Step B1 | Guide files in Specimen: the `guides` key, a JSON Schema for each kind, the loader and `specimen-validate`'s static checks. A statement may list the members it names in `members`, which is how the "names a member that does not exist" check knows them; an unknown member is `deferred` when the project has plugins, since a plugin's schema source runs in the page |
