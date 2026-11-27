# Scales: two-stage ramps, purpose-named semantic tokens and governed off-ramp exceptions

## Status

- **State:** active (approved and promoted from `proposed/` on 2026-11-22). Scaffolded 2026-11-13 against `main` at `e5d683a8`. Pivoted to the owner's two-stage direction (`#1111`) and drafted 2026-11-22 against `main` at `2ba52efcb0e` after a three-pass walkthrough with the owner; walked once across all three seats by a fresh read-only reader and reviewed by two independent reviewers (Gemini 4 Neon `high` and GPT-6.2 Astra `high`), with every finding applied ([#2124](https://github.com/lushly-dev/afd/pull/2124)). [STATUS.md](STATUS.md) tracks progress.
- **Verified:**
  - Every claim in [What exists today](#2-what-exists-today) was verified first-hand against `main` at `2ba52efcb0e`, cross-checked during the fresh reader walk and two-model independent review, and re-verified against `main` at `91d30fcec87` after [#2166](https://github.com/lushly-dev/afd/pull/2166) migrated Loam's tree to DTCG `.tokens.json` files.
  - All 41 position-named tokens in Loam and repo-wide CSS consumers were audited on 2026-11-22.
  - All eight scenario files pass the three `jobs-first` checks plus a `REF IN EXPECT` scan ([STATUS.md](STATUS.md#how-the-jobs-were-checked)).
  - Fresh three-seat reader walk and two-model independent review completed ([section 4](#4-what-the-walk-and-review-changed)); every blocker and improvement was applied and the checks re-run clean.
- **Not verified:** None — Phase 1 ([#2295](https://github.com/lushly-dev/afd/pull/2295)), Phase 3 / Slice 2 ([#2536](https://github.com/lushly-dev/afd/pull/2536)), and Phase 2 ([#2532](https://github.com/lushly-dev/afd/pull/2532)) cover all eight scenarios (`01`–`08`) and the repo-wide `contractVersion: 3` cutover.

| Field | Value |
| --- | --- |
| Epic | [#1111](https://github.com/lushly-dev/afd/issues/1111) |
| Units touched | `foundations/violet`, `integrations/violet-afd`, `endpoints/violet-server`, `foundations/fast-af/packages/violet-elements`, `endpoints/loam/packages/theme`, Loam chrome/consumers, `endpoints/health-dashboard`, `packages/examples/todo/frontends/shared`, `site/fast-af`, `.claude/skills/loam-design` |
| Related | [Patterns](../../active/patterns/patterns.proposal.md) ([#1073](https://github.com/lushly-dev/afd/issues/1073)), [Design Decisions](../design-decisions/design-decisions.proposal.md) ([#1108](https://github.com/lushly-dev/afd/issues/1108)), [Screens from Jobs](../screens-from-jobs/screens-from-jobs.proposal.md) ([#1109](https://github.com/lushly-dev/afd/issues/1109)), [Pointing](../pointing/pointing.proposal.md) ([#1110](https://github.com/lushly-dev/afd/issues/1110)) |
| Rank among the four | Fourth. Small, separate, and only Violet, `violet-elements`, Loam and their theme consumers need it |

---

## 1. Problem

Size names that state a position (`xs` to `xl`, `sm`/`md`/`lg`) try to do two jobs at once — limit the choices and express what a size is for — and do both badly:

1. **They are seldom semantic.** `space.stack.sm` says where a value sits in a list, not what role it plays.
2. **Nothing fits between two steps.** When AFD's Refined theme (D159, 2026-11-17) needed a `13px` label between `size.font.sm` (`12px`) and `size.font.md` (`14px`), `type.label.sm.size` had to bypass the scale and hardcode `'13px'` (`endpoints/loam/packages/theme/tree/loam.tokens.json`).
3. **Position tags drift from values.** In the same file, `type.caption.xs.size` now points to `size.font.sm` (`12px`), contradicting its own `.xs` suffix.
4. **Public contracts leak raw ladders.** Loam exports 16 positional ladder tokens (`size.font.{xs..xl}`, `size.line.{xs..xl}`, `size.space.{xs..xl}`, `space.inline.lg`) alongside semantic `type.*` and `space.*` tokens; seven of those 16 have zero consumers outside `endpoints/loam/packages/theme/`.

### Direction (owner decisions, Passes 1–3)

Scales uses a **two-stage system** built on plain Violet references (no derived-value transform DSL):

- **Stage 1 — The ramp (`ref.*`).** Hand-picked ladders of approved steps setting rhythm only. Code and component contracts never read a ramp step directly. Unused steps are fine and reported by nothing.
  - **Four ramps:** spacing (`ref.space.*`), type with paired size + line height (`ref.type.<step>.{size,line}`), corner radius (`ref.radius.*`) and target size (`ref.target.*`). Shell layout geometry (`shell.size.sidebar.*`, `main.min`, etc.) and `size.focus-ring.width` stay unramped.
  - **Step naming:** pixel values for spacing, radius and targets (`ref.space.8`, `ref.radius.8`, `ref.target.32`); step numbers for type (`ref.type.100`, `200`, `250`, `300`, …) because type ramps get retuned and pair size with line height.
- **Stage 2 — Semantic tokens.** Purpose-named tokens that code and exports actually consume. Each points to a step on its family's ramp via a plain Violet reference (`{ ref: 'ref.space.8' }`), or holds an **off-ramp literal with a non-empty `reason`**.
- **Governance:** Non-blocking Violet checks (`constraints.validate`, `analyze.violations`, `interface.check`), never write-blocking. Off-ramp literals without a `reason` fail validation with nearest unit-matched ramp steps; `>=2` semantic tokens sharing the same off-ramp literal emit a non-blocking `warning`; cross-step type `.size`/`.line` pairings require a `reason`; an optional Slice 2 check warns on uneven jumps across a hand-picked ramp.
- **Cutover:** Rename the 25 semantic position-named tokens, add `space.inline.hairline` (`ref.space.2`) for existing `2px` callers, and retire the 16 makeshift ladder tokens across `violet-elements/tokens/interface.json`, Loam, and repo-wide CSS consumers in a single coordinated `contractVersion: 3` cutover.

---

## 2. What exists today

Verified first-hand on 2026-11-22 against `main` at `2ba52efcb0e`, with Loam's DTCG tree and `import.*` lines re-verified at `91d30fcec87` (after [#2166](https://github.com/lushly-dev/afd/pull/2166) and [#2090](https://github.com/lushly-dev/afd/pull/2090)).

### Violet (`foundations/violet`, `integrations/violet-afd`, `endpoints/violet-server`)

- **Constraints** (`foundations/violet/packages/core/src/types/constraint.ts:13-86, 100-110`): `enum`, `range`, `pattern`, `scale { base, tolerance }`, `contrast { against, min, backdrop? }` and `reference { token }`, each with `severity`, `applyTo` glob, `enabled` and `disabledReason` (`#1327`).
  - `scale` (`constraints/validators.ts:172-214`) checks multiples of a base only; `parseNumericValue` (`validators.ts:375-391`) strips units without comparing them.
  - `reference` (`constraints/validators.ts:300-321`) checks only that a named token exists, not that the validated token aliases a ramp family.
  - `validateValue` (`validators.ts:341-366`) returns a single `ConstraintViolation | null`, and `constraints.validate` (`integrations/violet-afd/src/commands/constraints/validate.ts:145-174`) overwrites `violation.severity` with `constraint.severity`, skips tokens outside `constraint.applyTo`, and returns every passing token (`violations: []`) with no `onlyViolating` option.
  - `@lushly-dev/violet-core` exports `resolveTokens` and `exportTokens` (`foundations/violet/packages/core/src/tokens.ts`), but **not** a node-level constraint validation entry point; `constraints.validate` lives only in `violet-afd`.
  - `analyze.violations` (`integrations/violet-afd/src/commands/analyze/violations.ts:110-177`) validates an entire node tree in one call and returns only failing tokens.
- **Resolved tokens** (`types/token.ts:137-165`, `engine/resolver.ts:236-440`): `ResolvedToken` already exposes `aliasOf?: string` and `referenceError?: TokenReferenceError` (`TOKEN_REFERENCE_NOT_FOUND`, `CIRCULAR_REFERENCE`, `NOT_IMPLEMENTED`). Note that a broken reference sets **both** `aliasOf` and `referenceError`. `ResolvedToken` does **not** yet carry the winning operation's `reason` (though `OperationRecord.reason` is stored in the database), and `validate.ts:18-26` (`ResolvedTokenOutput`) currently omits `aliasOf`, `referenceError` and `reason`.
- **Bulk imports** (`integrations/violet-afd/src/commands/import/json.ts:222`, `import/tree.ts:368-371`): unconditionally write `reason: 'Imported from JSON'` on every `add`/`override` operation, which would silently satisfy `requireOffRampReason: true` for both new and historically imported trees if left unhandled. `export.tree` (`integrations/violet-afd/src/commands/export/tree.ts:231-238`) emits `$type`, `$value`, `$description`, and `$extensions["dev.lushly.violet"].category` only (no `reason`).
- **Impact previews** (`integrations/violet-afd/src/commands/changes/impact.ts:29-39, 186-188, 247-309, 440-464`): `ImpactChangeSchema` omits `reason` on `add`/`override`; `stageChange` (`:297-309`) stages changes onto the overlay while `applyStep` (`:247-274`) formats returned apply commands (dropping `reason`); `valueKey(cell)` (`:186-188`) keys on `[cell.value, cell.resolvedValue]` via `MatrixCell` (which has no `reason` field), skipping violation checks on reason-only edits; and `diffViolations` (`:440-441`) keys on `${tokenId}\u0000${constraintId}` alone, collapsing multiple violations from one `ramp` constraint.
- **Interface check** (`integrations/violet-afd/src/commands/analyze/interface.ts`, landed in `#1942`): verifies every id in a component `interface.json` resolves cleanly with a valid CSS value in every theme node (`missing`, `invalid`). It does not yet flag private/ramp tokens (`ref.*` or `tier: 'global'`) leaked into an interface.
- **Export & resolve** (`commands/export/export.ts`, `commands/token/resolve.ts`, `core/src/tokens.ts`): support `filter` (include glob), and `export` fails on broken/cyclic references (`TOKEN_REFERENCE_NOT_FOUND`, `CIRCULAR_REFERENCE`), while `cssTransformer` (`export/transformers/css.ts:28,35`) already falls back to resolved literals when an alias target is not in the exported set. Neither command nor core helper has `excludePrefixes` yet (one of the two reasons Loam renders its own outputs alongside override diffs, `endpoints/loam/packages/theme/src/outputs.ts:1-4`).
- **Reference transforms** (`types/token.ts:44-47`, `engine/resolver.ts:584-590`): throw `NOT_IMPLEMENTED`. Explicitly out of scope for Scales (Pass 1, Q1).

### Loam, `violet-elements` and other theme consumers

- **Loam's contract** (`endpoints/loam/packages/theme/contract/tokens.json`): **136 tokens** (`CONTRACT_VERSION = 1` in `outputs.ts:19`), of which **41 are position-named**:
  - 16 makeshift ladders: `size.font.{xs..xl}` (5), `size.line.{xs..xl}` (5), `size.space.{xs..xl}` (5), `space.inline.lg` (1). Seven (`size.font.{xs,lg,xl}`, `size.line.{xs,lg,xl}`, `space.inline.lg`) have zero consumers outside `endpoints/loam/packages/theme/`.
  - 25 semantic tokens with positional names/tags: 15 `type.*` (`caption.xs`, `label.sm`, `body.md`, `title.sm`, `title.md` × `{size,line,weight}`), 3 `radius.{sm,md,lg}`, 2 `space.inline.{sm,md}`, 3 `space.stack.{xs,sm,md}`, 2 `space.layout.{sm,md}`.
- **`violet-elements` interface & theme build:** `foundations/fast-af/packages/violet-elements/tokens/interface.json` (**96 tokens**, `contractVersion: 2`) contains **26 of the 41** position-named tokens. `theme:check` enforces parity between Loam's tree and `interface.json`, including `HOOK_TOKEN_TARGETS['--_space-xs'] = '--space-stack-xs'` (`endpoints/loam/packages/theme/src/components.ts:118`). `foundations/fast-af/packages/violet-elements/scripts/build-runtime-theme.mjs:27` explicitly throws if `violet-theme.export.json`'s `contractVersion !== 1`.
- **Other monorepo CSS consumers** (repo-wide `git grep` on 2026-11-22): `endpoints/health-dashboard/src/styles.css` and `packages/examples/todo/frontends/shared/src/styles.css` read `--radius-md`, `--space-layout-sm` and `--type-body-md-size`; `site/fast-af/*` and `site/js/vendor/fast-af.js` carry vendored FAST-AF theme files; `.claude/skills/loam-design/{SKILL.md,references/patterns.md}` reference the current token names.
- **Existing primitives & CSS lint:** `global.ref.space.{2,4,6,8,12,16,24}` already exists in `endpoints/loam/packages/theme/tree/loam.tokens.json` (with `$extensions["dev.lushly.violet"].category: "spacing"`) and is excluded from export (`isPrimitive` in `src/tree/types.ts:27`). `endpoints/loam/packages/theme/scripts/lint-tokens.mjs:217-227` already enforces *"code uses semantic tokens only"* via its `primitive` rule (forbidding `--ref-*` in CSS/TS). Type, radius and target sizes have no `ref.*` ramps yet.
- **DTCG tree loader & constraints:** After [#2166](https://github.com/lushly-dev/afd/pull/2166) (`#1974`), Loam's seven nodes live in `endpoints/loam/packages/theme/tree/*.tokens.json` (`loam.tokens.json`, `loam_{light,dark,high-contrast}.tokens.json`, and `loam_{light,dark,high-contrast}_compact.tokens.json`). `@lushly-dev/loam-theme/package.json:35-36` depends on `@lushly-dev/violet-afd` and `@lushly-dev/violet-core`; `buildLoamTree()` (`src/tree/index.ts:114-137`) loads the DTCG files via `importTreeCommand` and currently declares no Violet constraints, while `src/theme.test.ts:406-468` verifies byte-identical `import.tree` ↔ `export.tree` round-trips and a one-line `$value`-only diff on `token.override`.
- **Component attributes** (`foundations/fast-af/packages/violet-elements/attribute-taxonomy.jsonc:419-440, 773-782, 904-913`): out of scope for Scales (Pass 1, Q6); tracked in standalone issue [#2120](https://github.com/lushly-dev/afd/issues/2120).

---

## 3. Jobs

Approved and ranked by the owner in Pass 2 (2026-11-22). Each job is written as a scenario against an invented example design system (`studio`, fixture [`studio.json`](../../../../integrations/violet-afd/scenarios/fixtures/studio.json)): all eight scenarios (`01`–`07` `slice`, `08` `optional`) live beside `violet-afd` in `integrations/violet-afd/scenarios/`.

| Rank | Job | Sentence | Scenario | Tags | Slice |
| --- | --- | --- | --- | --- | --- |
| 1 | `add-between-steps` | When a new size is needed between two existing steps, I want to add a ramp step and point a purpose-named semantic token at it, so that nothing existing is renamed. | [01](../../../../integrations/violet-afd/scenarios/01-add-between-steps.scenario.yaml) | `slice` | Slice 1 |
| 2 | `retune-ramp-step` | When I retune a ramp step or point a density node at lower steps, I want every semantic token referencing it to update automatically, so that rhythm holds across themes and densities. | [02](../../../../integrations/violet-afd/scenarios/02-retune-ramp-step.scenario.yaml) | `slice` | Slice 1 |
| 3 | `choose-by-purpose` | When an agent or author picks a size, I want only purpose-named semantic tokens exposed on semantic queries and filtered exports (never `ref.*` steps or positional `xs`–`xl` names), so that every choice explains what it is for. | [03](../../../../integrations/violet-afd/scenarios/03-choose-by-purpose.scenario.yaml) | `slice` | Slice 1 |
| 4 | `allow-reasoned-off-ramp` | When no ramp step fits a semantic token (or a type role intentionally pairs size and line height from different steps), I want to set an off-ramp value with a reason and have checks flag any unreasoned exception with the nearest ramp steps, so that exceptions stay deliberate. | [04](../../../../integrations/violet-afd/scenarios/04-allow-reasoned-off-ramp.scenario.yaml) | `slice` | Slice 1 |
| 5 | `stay-quiet-when-compliant` | When semantic tokens point to their family's ramp, an off-ramp value has a unique reason, and some ramp steps are unused, I want checks to report nothing, so that only real drift draws attention. | [05](../../../../integrations/violet-afd/scenarios/05-stay-quiet-when-compliant.scenario.yaml) | `slice`, `quiet` | Slice 1 |
| 6 | `flag-repeated-off-ramp` | When two or more semantic tokens in a family share the same off-ramp literal, I want checks to warn and list them, so that I see when the ramp is missing a step and can promote it to clear the warning. | [06](../../../../integrations/violet-afd/scenarios/06-flag-repeated-off-ramp.scenario.yaml) | `slice` | Slice 1 |
| 7 | `refuse-broken-or-leaked-ramp` | When a semantic token references a missing step, wrong ramp family, or cycle, or a `ref.*` / global-tier token leaks into a component interface, I want it refused or failed with the cause and fix, so that broken or raw ramp values never ship in a public contract. | [07](../../../../integrations/violet-afd/scenarios/07-refuse-broken-or-leaked-ramp.scenario.yaml) | `slice`, `refuse` | Slice 1 |
| 8 | `warn-uneven-ramp-jumps` | When I check a hand-picked ramp's progression, I want uneven jumps between adjacent steps surfaced as an optional warning, so that accidental gaps or crowding are caught without forcing a strict ratio. | [08](../../../../integrations/violet-afd/scenarios/08-warn-uneven-ramp-jumps.scenario.yaml) | `optional` | Slice 2 |

---

## 4. What the walk and review changed

### Fresh three-seat reader walk (2026-11-22)

One fresh read-only reader walked the initial draft across all three seats (the person, the job list, the calling agent) with verdict **Revise** (7 blockers, 7 improvements; all applied, none declined):

- Multi-violation `ConstraintViolation[]` with preserved advisory `'warning'` severities and `warnUneven` dispatch on `config.ramp` tokens; `import.json`/`import.tree` defaulting to `reason: null`; checking `token.referenceError` before `aliasOf`; handler-level `constraints.set` validation; `changes.impact` reason support; exact `ResolvedToken.reason` propagation across `add`/`override`/`reset`/`copy`/`include`; `@lushly-dev/violet-core` `validateConstraints` export; Loam cutover details (`HOOK_TOKEN_TARGETS`, `CONTRACT_VERSION`, `TreeToken.reason`, `metadataFor`, shell bar `applyTo`, `size.focus-ring.width`); `tokens.resolve` `excludePrefixes`; `constraints.validate` `onlyViolating`; unit-matched nearest-step computation; symmetric `pairWith`; and tightened Scenarios 01, 03, 04, 07, and 08.

### Two-model independent pre-PR review (2026-11-22)

Two fresh independent reviewers reviewed the post-walk draft at `6900a6a4` over `origin/main` (`2ba52efcb0e`) — **Gemini 4 Neon (`high`)** (2 blockers, 5 improvements) and **GPT-6.2 Astra (`high`)** (7 blockers, 2 improvements; 9 valid, 3 overlapping, 0 noise) — and every finding was applied:

- **Broken links & anchor:** Fixed `screens-from-jobs` and `pointing` paths (`../../active/...`), the `#7-loam-and-violet-elements-cutover-contractversion-3` anchor, and `docs/features/README.md` line 93.
- **Fixture adapter deliverable:** Made the Violet scenario fixture adapter (`app: 'violet'`) and its unit test an explicit Phase 1 deliverable alongside `scenarios/fixtures/studio.json`.
- **`changes.impact` & legacy import reasons:** Distinguished `stageChange` (overlay) from `applyStep` (returned apply payload + `--reason` flag); specified running `diffViolations` on nodes touched by any staged `add`/`override` without contradicting the `MatrixCellSchema.reason` deferral; added violation sub-check `code` (`ramp:unreasoned`, `ramp:repeat`, etc.) to `diffViolations`'s key so clearing an error while a warning remains is never masked; and treated historical `'Imported from JSON'` sentinel strings as blank in `requireOffRampReason`.
- **Cutover completeness:** Added `violet-elements/scripts/build-runtime-theme.mjs:27` (`contractVersion` reader bump) and a green `theme:build` + `cem:analyze` exit criterion; added `space.inline.hairline` (`ref.space.2`) so existing `2px` callers (`entry-styles.ts:34,37`) keep their exact geometry; added repo-wide consumers (`endpoints/health-dashboard/src/styles.css`, `packages/examples/todo/frontends/shared/src/styles.css`, `site/fast-af/*`, `.claude/skills/loam-design/*`) and a zero-stale-var grep check to Slice 1 exit criteria.
- **Public-export boundary clarity:** Clarified how unconditional contract boundaries (`interface.check` defaulting `privatePrefixes: ['ref.']` + `global-tier` check, Loam `outputs.ts` `isPrimitive`, `lint-tokens.mjs`) enforce the guarantee while Violet's generic `export` / `tokens.resolve` / core helpers provide `excludePrefixes` for callers.
- **Positional-name regex & Scenario 03/08 polish:** Fixed the regex to `^(?!(?:xs|sm|md|lg|xl)(?:\.|$))(?!.*\.(?:xs|sm|md|lg|xl)(?:\.|$)).+$` (zero nested quantifiers, catches leading `sm.stack` and bare `xs`) and added a leading-segment check to Scenario 03; retained `pairWith` in Scenario 08 when enabling `warnUneven` on `type-size-ramp`.
- **Precision polish:** Specified `interface.check` `leaked` dedup/sort/precedence (`'private-prefix'` over `'global-tier'`), exact `warnUneven` upper-step target rule, reconciled §6 command counts (8 scenario-tested + 4 Phase 1 plumbing commands), added `excludePrefixes` parity on `@lushly-dev/violet-core` `resolveTokens`/`exportTokens`, and corrected §2 line numbers.

---

## 5. Design

### 5.1 Two-stage model in Violet

No new top-level Violet commands are added. Every job runs on Violet's existing command surface via targeted core and command extensions:

1. **Expose `reason` on `ResolvedToken` with exact inheritance semantics.**
   - `ResolvedToken` (`foundations/violet/packages/core/src/types/token.ts`) gains `reason?: string`.
   - Propagation rules in `engine/resolver.ts`:
     - `add` / `override`: sets `reason` to the trimmed `OperationRecord.reason`, or `undefined` when `null`/whitespace-only — **explicitly clearing any ancestor's prior reason** so an unreasoned child override never inherits an old justification.
     - `reset` / `copy` / `include`: propagates the resolved `reason` of the ancestor/source token it pulls from.
   - `tokens.resolve` includes `reason` on each returned token when set, and `validate.ts`'s `ResolvedTokenOutput` carries `aliasOf`, `referenceError`, and `reason`.

2. **New `ConstraintConfig` variant: `type: 'ramp'`, multi-violation engine, and core export.**
   - Added to `ConstraintConfigSchema` (`types/constraint.ts`):

     ```ts
     export const RampConfigSchema = z.object({
       type: z.literal('ramp'),
       /** Glob matching allowed Stage 1 ramp tokens, e.g. 'ref.space.*' or 'ref.type.*.size' */
       ramp: z.string(),
       /** Require a non-empty human OperationRecord.reason on off-ramp literals (default: true) */
       requireOffRampReason: z.boolean().default(true),
       /** Warn when >= N semantic tokens in applyTo share the same off-ramp literal (default: 2) */
       repeatThreshold: z.number().int().default(2),
       /** Optional sibling pairing check (e.g. type.*.size paired with type.*.line on the same step) */
       pairWith: z.object({
         fromSuffix: z.string().min(1),
         toSuffix: z.string().min(1),
         /** Ramp glob for the sibling token, e.g. 'ref.type.*.line' */
         rampTarget: z.string().min(1),
       }).optional(),
       /** Slice 2: optional progression check across ordered steps matching `ramp` */
       warnUneven: z.object({
         /** Max ratio between the largest and smallest adjacent step multiplier (must be > 1, e.g. 1.5) */
         maxRatioSpread: z.number(),
         /** Skip numeric sentinel steps above this value (e.g. 1000 skips 9999px pill radius) */
         ignoreAbove: z.number().positive().optional(),
       }).optional(),
     });
     ```

   - **Handler-level config checks in `constraints.set`:** Following `set.ts`'s existing pattern for `disabledReason` and `checkPattern`, `constraints.set` checks that `ramp` is a non-empty glob, `repeatThreshold >= 2`, and `warnUneven.maxRatioSpread > 1`, returning `VALIDATION_ERROR` with a field-specific `suggestion` (naming `repeatThreshold`, `maxRatioSpread`, or `ramp`).
   - **Multi-violation, sub-check `code`, and severity preservation:** Extend Violet's validator engine so a validator returns `ConstraintViolation[]`, each `ConstraintViolation` carries an optional stable `code` (for `ramp`: `'ramp:broken-ref'`, `'ramp:wrong-family'`, `'ramp:unreasoned'`, `'ramp:pair'`, `'ramp:repeat'`, `'ramp:uneven'`), and advisory sub-checks (`'ramp:repeat'`, `'ramp:uneven'`) keep `severity: 'warning'` instead of being overwritten by `constraint.severity` (`error`). A token that is both unreasoned off-ramp *and* repeated emits both violations (1 `error`, 1 `warning`).
   - **Core entry point:** Export `validateConstraints(db, nodeId, { filter?, onlyViolating? })` from `@lushly-dev/violet-core` (mirroring `resolveTokens` and `exportTokens`) and have `constraints.validate` and `analyze.violations` call it. This lets direct `@lushly-dev/violet-core` callers — including `@lushly-dev/loam-theme`'s `theme:check` — run Violet constraints directly alongside `resolveTokens` and `exportTokens`.
   - **Evaluation order for `type: 'ramp'`:**
     1. **Scope:** Semantic checks run on tokens matching `constraint.applyTo` (ignoring `ref.*` ramp tokens; unused ramp steps report nothing). When `config.pairWith` is set, pairing checks also evaluate tokens matching `applyTo` with `fromSuffix` swapped to `toSuffix` so filtering on either `.size` or `.line` catches cross-step mismatches.
     2. **Broken reference first (`ramp:broken-ref`):** If `token.referenceError` is set (`TOKEN_REFERENCE_NOT_FOUND` or `CIRCULAR_REFERENCE`), immediately emit an `error` naming the `referenceError.code` and message and stop evaluating this token against the ramp.
     3. **Resolve terminal ramp target:** Follow semantic `aliasOf` chains (with cycle guard) to the terminal target.
        - **On-ramp (terminal alias matches `config.ramp`):** Passes. If `pairWith` is set and the sibling token exists and terminates on `pairWith.rampTarget` at a *different* wildcard step (e.g. `ref.type.250.size` vs `ref.type.200.line`), require a non-empty human `reason` on the cross-step token (or its sibling); if neither carries one, emit an `error` (`ramp:pair`) naming both tokens and their steps. (If the sibling token does not exist, `pairWith` stays quiet; missing contract tokens are checked by `interface.check`.)
        - **Wrong-family alias (`ramp:wrong-family`):** If `aliasOf` is set and its terminal target does not match `config.ramp`, emit an `error` (`expected: "alias matching <config.ramp>"`, `actual: <aliasOf>`).
     4. **Off-ramp literal (`aliasOf` is undefined):**
        - **Unreasoned check (`ramp:unreasoned`):** Treat absent/blank `reason` *and* the legacy auto-generated sentinel `'Imported from JSON'` (written by pre-Scales bulk imports) as unreasoned. If `requireOffRampReason` is true and unreasoned, emit an `error`. Compute nearest lower and higher ramp steps from `config.ramp` using **unit-matched numeric comparison** (`px` with `px`, `rem` with `rem`). When units match, include both nearest bounds (e.g. `nearest: ref.space.4 (4px), ref.space.6 (6px)`); when no ramp step shares the token's unit, report the unit mismatch and list available ramp units/steps.
        - **Repeat clustering (`ramp:repeat`):** Across all tokens in `allTokens` matching `constraint.applyTo` that hold an off-ramp literal (regardless of `filter`), normalize each resolved value (`String(resolvedValue).trim().toLowerCase().replace(/\s+/g, ' ')`) and group. Whenever a group reaches size `>= config.repeatThreshold`, emit a `warning` (never `error`) on each checked token in the group naming all peer token ids sharing that value.
     5. **Slice 2 — `warnUneven` (`ramp:uneven`):** Evaluated against tokens matching `config.ramp` (not `constraint.applyTo`), sorted deterministically by token id. Collect unit-matched positive numeric steps (excluding any step `> ignoreAbove`), sort ascending by value, compute adjacent ratios `r_i = v[i] / v[i-1]`, and emit a `warning` on each upper step token `v[i]` whose adjacent ratio `r_i` exceeds `min(r) * maxRatioSpread`.

3. **Unconditional public-contract boundary in `interface.check` (plus Loam's `outputs.ts` and `lint-tokens.mjs`).**
   - `interface.check` gains optional `privatePrefixes: z.array(z.string().min(1)).default(['ref.'])` (enforced by default with zero caller opt-in).
   - Any token id in `input.interface.tokens` starting with a `privatePrefixes` entry (`reason: 'private-prefix'`) or resolving with `metadata.tier === 'global'` in any checked node (`reason: 'global-tier'`) is recorded in a new output array `leaked: Array<{ token: string; reason: 'private-prefix' | 'global-tier' }>`, deduplicated per token id, sorted alphabetically by token id, with `'private-prefix'` taking precedence when both match.
   - `complete` is `true` only when `missing`, `invalid` and `leaked` are all empty.
   - In Loam, `endpoints/loam/packages/theme/src/outputs.ts` (`isPrimitive`) unconditionally strips `ref.*` from all generated CSS/JSON exports and `scripts/lint-tokens.mjs` unconditionally bans `--ref-*` in CSS/TS.

4. **Exclusion filter on `export`, `tokens.resolve`, and core helpers, plus `onlyViolating` on `constraints.validate`.**
   - `export`, `tokens.resolve`, and `@lushly-dev/violet-core`'s native `resolveTokens` / `exportTokens` gain optional `excludePrefixes: z.array(z.string().min(1)).optional()` (e.g. `['ref.']`) so callers invoking Violet's generic exporter or browsing semantic sizes can filter out private ramps without breaking existing callers that export global tokens. References resolve against the full node before filtering; `cssTransformer` (`export/transformers/css.ts:28,35`) already emits resolved literals instead of `var(--ref-...)` when `outputReferences: true` targets an excluded token.
   - `constraints.validate` gains optional `onlyViolating: z.boolean().default(false)` so agents and scripts can omit passing tokens (`violations: []`) without flooding context.

5. **Bulk import hygiene & `changes.impact` parity.**
   - `import.json` / `import.tree`: stop stamping `'Imported from JSON'`; write `reason: null` on imported operations unless a token carries `$extensions['dev.lushly.violet'].reason`. (Historical stores already containing `'Imported from JSON'` are treated as unreasoned by `ramp:unreasoned` above.) `export.tree` stays unchanged in Phase 1 (emitting `$type`, `$value`, `$description`, and `category` only) so Loam's byte-identical round-trip and one-line `$value`-only `token.override` diff tests (`endpoints/loam/packages/theme/src/theme.test.ts:406-468`) remain intact; Phase 2 puts all semantic Loam sizes on `ref.*` ramps with no off-ramp literals, and round-tripping `$extensions['dev.lushly.violet'].reason` on `export.tree` is tracked as a follow-up in [STATUS.md](STATUS.md#follow-ups-not-yet-issues).
   - `changes.impact`:
     - Add optional `reason` to `add` and `override` in `ImpactChangeSchema` (`stageChange` already spreads `{ nodeId, ...change }` onto the overlay; update `applyStep` so the returned apply `input` and CLI string preserve `reason` / `--reason`).
     - Run `diffViolations` on every node reached by any staged `add`/`override` even when `valueKey` (`[cell.value, cell.resolvedValue]`) did not change (avoiding any Phase 1 dependency on `MatrixCellSchema.reason`, which stays a Slice 2 follow-up).
     - Key `diffViolations` on `${tokenId}\u0000${constraintId}\u0000${code ?? ''}\u0000${severity}` so clearing `ramp:unreasoned` (`error`) while `ramp:repeat` (`warning`) remains is reported accurately in `resolved`.
   - `endpoints/violet-server/src/server.ts` instructions and `constraints.set` examples: document `type: 'ramp'`, `merge: true` (so agents don't overwrite existing constraints), `excludePrefixes: ['ref.']`, and `analyze.violations` for multi-node validation.

6. **Scenario fixture adapter (Phase 1 deliverable).**
   - Register a Violet fixture adapter (`app: 'violet'`) in `integrations/violet-afd/scenarios/violet-adapter.ts` (with its own unit test) that seeds `nodes`, `tokens`, and `constraints` from `studio.json` through `afd-testing`'s `registerAdapter()`, so scenarios 01–08 execute directly in Vitest without converting fixtures into verbose `setup` arrays.

### 5.2 Positional-name guard (opt-in on Loam)

`PatternConfig` (`types/constraint.ts`) gains optional `target: z.enum(['value', 'id']).default('value')`. Loam attaches an opt-in `pattern` constraint (`target: 'id'`, `pattern: "^(?!(?:xs|sm|md|lg|xl)(?:\\.|$))(?!.*\\.(?:xs|sm|md|lg|xl)(?:\\.|$)).+$"`, zero nested quantifiers, verified safe by `checkPattern`, catching leading, middle and trailing positional segments) to its root node so positional names cannot creep back into Loam while Violet stays generic for outside consumers.

---

## 6. Command extensions (draft)

Zero new top-level commands. All **8 scenario-tested commands** and **4 Phase 1 plumbing commands** already exist in `integrations/violet-afd`:

### Scenario-tested commands (8 — 100% covered in `scenarios/`)

| Command | Additions for Scales | Errors tested |
| --- | --- | --- |
| `token.add` | None (already accepts `reason?: string` and `{ ref }`) | — |
| `token.override` | None (already accepts `reason?: string` and `{ ref }`) | — |
| `token.remove` | None (used to remove a misplaced positional token) | — |
| `tokens.resolve` | Include `reason?: string` on resolved tokens; add `excludePrefixes?: string[]` | — |
| `constraints.set` | Accept `config.type: 'ramp'` (handler-validated) and `pattern.target?: 'value' \| 'id'` | `VALIDATION_ERROR` |
| `constraints.validate` | Call core `validateConstraints` (multi-violation, sub-check `code`, advisory severities, `ramp`, `pattern.target: 'id'`); add `onlyViolating?: boolean` | — |
| `interface.check` | Add `privatePrefixes` (default `['ref.']`) and sorted/deduped `leaked` output; `complete` requires `leaked.length === 0` | — |
| `export` | Add `excludePrefixes?: string[]`; aliases to excluded tokens emit resolved literals under `outputReferences: true` | `TOKEN_REFERENCE_NOT_FOUND`, `CIRCULAR_REFERENCE` |

### Phase 1 plumbing commands (4 — verified by Phase 1 unit tests)

| Command | Additions for Scales | Planned verification |
| --- | --- | --- |
| `analyze.violations` | Delegates to core `validateConstraints` (preferred multi-node agent check at volume) | Phase 1 multi-node Vitest suite |
| `changes.impact` | `reason` on `add`/`override` (`ImpactChangeSchema` + `applyStep`), run `diffViolations` on reason-only overrides, key violations with `code` + `severity` | Phase 1 regression test (reason-only override & error+warning diff) |
| `import.json` | Write `reason: null` unless `$extensions['dev.lushly.violet'].reason` is set | Phase 1 regression test (new import + historical `'Imported from JSON'` check) |
| `import.tree` | Inherits `import.json`'s `reason: null` default | Phase 1 regression test |

---

## 7. Loam and `violet-elements` cutover (`contractVersion: 3`)

### 7.1 Four Stage 1 ramps in Loam (`endpoints/loam/packages/theme/tree/loam.tokens.json`)

| Ramp | Naming | Initial Refined steps | DTCG `$extensions["dev.lushly.violet"].category` | Semantic `applyTo` rules |
| --- | --- | --- | --- | --- |
| Spacing | Value (`ref.space.<px>`) | `2, 4, 6, 8, 12, 16, 24` | `'spacing'` | `space.*` |
| Type | Step (`ref.type.<step>.{size,line}`) | `100` (`11px`/`14px`), `200` (`12px`/`16px`), `250` (`13px`/`16px`), `300` (`14px`/`20px`), `400` (`18px`/`24px`), `500` (`24px`/`32px`) | `'typography'` | `type.*.size` (with `pairWith`), `type.*.line` |
| Radius | Value (`ref.radius.<px>`) | `4, 8, 12, 9999` | `'radius'` | `radius.*` |
| Target | Value (`ref.target.<px>`) | `24, 28, 32, 40, 44, 48, 56` | `'spacing'` | `size.target.*`, plus explicit rules for the 4 shell bars: `shell.size.titlebar`, `shell.size.statusbar`, `shell.size.rail`, `shell.size.tabbar` |

- **Explicitly unramped:** shell layout geometry (`shell.size.sidebar.*`, `inspector.*`, `panel.*`, `main.min`, `drawer.max`, `handle`, `focus`) and `size.focus-ring.width` (`2px`).
- **Existing literals switched to `ref.*`:** `size.target.{compact,natural,comfortable}`, `radius.round`, and the 4 shell bar heights in `tree/loam.tokens.json`, plus compact overrides in `tree/loam_{light,dark,high-contrast}_compact.tokens.json`.
- **DTCG tree & constraint attachment:** Add the new `global.ref.{type,radius,target}.*` steps directly in `tree/loam.tokens.json` with their `$extensions["dev.lushly.violet"].category` (`'typography'`, `'radius'`, `'spacing'`; any future off-ramp literal in a DTCG file can carry `$extensions["dev.lushly.violet"].reason` for `import.tree`). Attach Loam's `ramp` constraints and opt-in positional-name `pattern` (`target: 'id'`) constraint on the `loam` root node inside `buildLoamTree()` (`src/tree/index.ts`, or a dedicated `attachLoamConstraints(db)` helper called by `buildLoamTree()` / `check.ts`) so `theme:check` (`src/check.ts`) validates every node via `@lushly-dev/violet-core`'s `validateConstraints`.

### 7.2 Retire 16 makeshift ladder tokens

| Retired tokens | Count | Migration for current callers |
| --- | --- | --- |
| `size.font.{xs,sm,md,lg,xl}` | 5 (`xs`/`lg`/`xl` unused) | Migrate `sm`/`md` callers to `type.caption.size` / `type.label.size` / `type.body.size` |
| `size.line.{xs,sm,md,lg,xl}` | 5 (`xs`/`lg`/`xl` unused) | Migrate `sm`/`md` callers to `type.caption.line` / `type.body.line` |
| `size.space.{xs,sm,md,lg,xl}` | 5 | Migrate `xs` (`2px`) callers (e.g. `endpoints/loam/packages/chrome/src/elements/entry-styles.ts:34,37`) to `space.inline.hairline`; migrate `sm`–`xl` callers to purpose-named `space.{inline,stack,layout}.*` |
| `space.inline.lg` | 1 (unused) | Drop |

### 7.3 Rename 25 semantic tokens (+ 1 new `2px` role) (`contractVersion: 3`)

| Current id | New purpose id | Stage 1 ref (Refined light) | Compact density ref |
| --- | --- | --- | --- |
| `type.caption.xs.{size,line,weight}` | `type.caption.{size,line,weight}` | `ref.type.200.{size,line}`, `weight.regular` | — |
| `type.label.sm.{size,line,weight}` | `type.label.{size,line,weight}` | `ref.type.250.{size,line}`, `weight.medium` | — |
| `type.body.md.{size,line,weight}` | `type.body.{size,line,weight}` | `ref.type.300.{size,line}`, `weight.regular` | — |
| `type.title.sm.{size,line,weight}` | `type.heading.section.{size,line,weight}` | `ref.type.400.{size,line}`, `weight.semibold` | — |
| `type.title.md.{size,line,weight}` | `type.heading.page.{size,line,weight}` | `ref.type.500.{size,line}`, `weight.semibold` | — |
| `radius.sm` | `radius.inset` | `ref.radius.4` | — |
| `radius.md` | `radius.control` | `ref.radius.8` | — |
| `radius.lg` | `radius.floating` | `ref.radius.12` | — |
| *(new, replaces `size.space.xs` 2px uses)* | `space.inline.hairline` | `ref.space.2` | `ref.space.2` |
| `space.inline.sm` | `space.inline.tight` | `ref.space.4` | `ref.space.2` |
| `space.inline.md` | `space.inline.group` | `ref.space.8` | `ref.space.6` |
| `space.stack.xs` | `space.stack.tight` | `ref.space.4` | `ref.space.2` |
| `space.stack.sm` | `space.stack.group` | `ref.space.8` | `ref.space.4` |
| `space.stack.md` | `space.stack.section` | `ref.space.12` | `ref.space.8` |
| `space.layout.sm` | `space.layout.panel` | `ref.space.12` | — |
| `space.layout.md` | `space.layout.page` | `ref.space.24` | — |

### 7.4 Coordinated cutover checklist

Lands as one coordinated cutover across every producer and consumer in the monorepo:
- `foundations/fast-af/packages/violet-elements`:
  - `tokens/interface.json` (`contractVersion: 2 → 3`), component styles, fallbacks, generated theme, CEM, and `foundations/fast-af/provenance/adaptations.json`.
  - `scripts/build-runtime-theme.mjs:27` updated to accept `contractVersion === 2` from `violet-theme.export.json`.
- `endpoints/loam/packages/theme`:
  - `src/outputs.ts` (`CONTRACT_VERSION: 1 → 2` for `contract/tokens.json` and `violet-theme.export.json`), `src/components.ts` (`HOOK_TOKEN_TARGETS['--_space-xs']` → `'--space-stack-tight'`), `tree/*.tokens.json` (four `global.ref.*` ramps, renamed semantic tokens, compact overrides), `src/tree/index.ts` (attaching Loam's `ramp` + positional-name constraints on `loam`), and `src/check.ts` (calling `@lushly-dev/violet-core`'s `validateConstraints` across all 7 Loam nodes).
- Loam chrome and app CSS/TS consumers, verified by `theme:check` and `lint-tokens.mjs` (which already enforces zero `--ref-*` usage in CSS/TS).
- **Other monorepo consumers of renamed runtime CSS custom properties:**
  - `endpoints/health-dashboard/src/styles.css` (`--radius-md`, `--space-layout-sm`, `--type-body-md-size`)
  - `packages/examples/todo/frontends/shared/src/styles.css` (`--radius-md`, `--space-layout-sm`, `--type-body-md-size`)
  - `site/fast-af/*` and `site/js/vendor/fast-af.js`
  - `.claude/skills/loam-design/SKILL.md` and `.claude/skills/loam-design/references/patterns.md`

---

## 8. Phases and exit criteria

### Slice 1 (Jobs 1–7)

1. **Phase 1 ([#2195](https://github.com/lushly-dev/afd/issues/2195)) — Violet core, `violet-afd` & `violet-server`:** Expose `ResolvedToken.reason` with exact `add`/`override`/`reset`/`copy`/`include` rules; add `type: 'ramp'` (excluding `warnUneven`), `pattern.target: 'id'`, multi-violation + sub-check `code` + advisory severity preservation, `excludePrefixes` on core `resolveTokens`/`exportTokens`, and `validateConstraints` export in `@lushly-dev/violet-core`; wire `constraints.set`, `constraints.validate` (`onlyViolating`), `analyze.violations`, `tokens.resolve` (`excludePrefixes`), `export` (`excludePrefixes`), `interface.check` (`leaked`), `changes.impact` (`reason` + reason-only `diffViolations` + `code`/`severity` key), `import.json`/`import.tree` (`reason: null` default + historical `'Imported from JSON'` sentinel handling), and `violet-server` instructions. Add the `app: 'violet'` fixture adapter (`integrations/violet-afd/scenarios/violet-adapter.ts`) with its own test, move scenarios 01–07 beside `violet-afd`, and pass them in Vitest alongside the Phase 1 regression tests.
2. **Phase 2 ([#2197](https://github.com/lushly-dev/afd/issues/2197)) — Loam, `violet-elements` & repo-wide `contractVersion: 3` cutover:** Add the four `global.ref.*` ramps (with `$extensions["dev.lushly.violet"].category`) in `endpoints/loam/packages/theme/tree/loam.tokens.json`, update semantic and compact overrides across `tree/*.tokens.json`, attach Loam's `ramp` + positional-name constraints on `loam` in `src/tree/index.ts` (or a shared helper), and wire `validateConstraints` into `src/check.ts` (`theme:check`); update `HOOK_TOKEN_TARGETS`, `CONTRACT_VERSION`, and `build-runtime-theme.mjs:27`; retire the 16 ladder tokens, add `space.inline.hairline`, and rename the 25 semantic tokens across `violet-elements`, Loam, `health-dashboard`, `todo/frontends/shared`, `site/fast-af`, and `.claude/skills/loam-design`.

**Slice 1 exit criteria:**
- Every scenario tagged `slice` (01–07) passes against `violet-afd` via the `app: 'violet'` fixture adapter, plus Phase 1 regression tests for `changes.impact` and `import.*`.
- `pnpm -F @lushly-dev/loam-theme theme:check` passes with `validateConstraints` returning 0 errors across all 7 Loam nodes, and `lint-tokens.mjs` reports zero `--ref-*` uses.
- `pnpm -F @lushly-dev/violet-elements theme:build` and `cem:analyze` pass against `contractVersion: 2` export / `contractVersion: 3` `interface.json`, with zero positional (`xs`/`sm`/`md`/`lg`/`xl`) token ids and zero `ref.*` leaks.
- Repo-wide `git grep` across non-doc sources finds zero remaining references to any retired or renamed CSS custom property.

### Slice 2 (Job 8 — optional)

3. **Phase 3 ([#2198](https://github.com/lushly-dev/afd/issues/2198)) — Uneven-jump advisory check:** Add `warnUneven: { maxRatioSpread, ignoreAbove? }` to `type: 'ramp'`. Pass scenario 08 (`optional`).

---

## 9. Limits and what scenarios cannot show

- **Scenario matcher limits** (`jobs-first.md`): `expect` cannot assert `CommandResult.warnings` or `suggestions`, so repeat-off-ramp and uneven-jump findings are structured inside `constraints.validate`'s `data.results` and `data.summary.warnings` where scenarios assert them directly.
- **Fixture adapter:** `scenarios/fixtures/studio.json` uses `"app": "violet"`; until Phase 1 ships `integrations/violet-afd/scenarios/violet-adapter.ts`, the scenarios are validated by `afd scenario validate` and `validateScenario({ checkFixtures: true })` without running `applyFixture`.
- **Visual rhythm & naming quality:** Scenarios verify structural compliance (on-ramp, reasoned off-ramp, repeat warnings, no `ref.*` leaks, no positional suffixes), not whether a chosen semantic name reads well to humans or looks balanced on screen (those belong to Specimen review and Design Decisions `#1108`).
- **Component CSS cutover & bulk import / impact plumbing:** Scenarios run against Violet's 8 core commands; `violet-elements` fallbacks, theme builds, and `--ref-*` CSS bans are verified by `theme:check`, `theme:build`, and `lint-tokens.mjs`, while `import.*`, `changes.impact`, and `analyze.violations` are verified by Phase 1 Vitest suites.
- **Year-in off-ramp auditing:** Compliant unique reasoned off-ramps stay silent by design (Job 5); a filtered audit view (`tokens.matrix` `MatrixCellSchema.reason` or `tokens.resolve` `onlyOffRamp`) is tracked as a follow-up in [STATUS.md](STATUS.md#follow-ups-not-yet-issues).

---

## 10. Out of scope

- **Derived-value reference transforms** (`multiply(1.5)`, `add(8px)` in `engine/resolver.ts:584-590`). Dropped per Pass 1 (Q1).
- **Colour scales.** Colour already uses purpose names throughout Loam's contract.
- **`violet-elements` HTML attributes** (`size`, `density`, `padding` in `attribute-taxonomy.jsonc`). Tracked separately in [#2120](https://github.com/lushly-dev/afd/issues/2120) per Pass 1 (Q6) and Pass 3 (Q4).
- **Per-value repeat-warning suppression store.** Deferred; if needed later, belongs to Design Decisions (`#1108`).
