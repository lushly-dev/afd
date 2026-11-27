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

- **State:** active (Phase 0 step 0.5 **go with changes** approved 2026-11-22 on
  [#1966](https://github.com/lushly-dev/afd/issues/1966); Phase A specification
  [#2133](https://github.com/lushly-dev/afd/issues/2133) merged in
  [#2139](https://github.com/lushly-dev/afd/pull/2139); Phase B Step B1
  [#2144](https://github.com/lushly-dev/afd/issues/2144) merged in
  [#2203](https://github.com/lushly-dev/afd/pull/2203); Phase B Step B2
  [#2145](https://github.com/lushly-dev/afd/issues/2145) merged in
  [#2306](https://github.com/lushly-dev/afd/pull/2306); Phase B Step B3
  [#2146](https://github.com/lushly-dev/afd/issues/2146) merged in
  [#2525](https://github.com/lushly-dev/afd/pull/2525); Phase B Step B5 Slice 1
  [#2147](https://github.com/lushly-dev/afd/issues/2147) and Phase C Step C1
  [#2148](https://github.com/lushly-dev/afd/issues/2148) merged in
  [#2565](https://github.com/lushly-dev/afd/pull/2565); Phase C Step C2 Slice 1
  [#2149](https://github.com/lushly-dev/afd/issues/2149) merged in
  [#2573](https://github.com/lushly-dev/afd/pull/2573); Phase C Step C3 Slice 1
  [#2150](https://github.com/lushly-dev/afd/issues/2150) merged in
  [#2581](https://github.com/lushly-dev/afd/pull/2581)).
- **Epic:** [#1073](https://github.com/lushly-dev/afd/issues/1073). Work happens in its sub-issues;
  this file is the source of truth for progress.
- **Done:** the proposal; owner walkthrough decisions (section 12 and decisions 1–20); ten jobs as
  scenario files; three-seat reader walks and two-model independent review ([#1133](https://github.com/lushly-dev/afd/issues/1133),
  [#2020](https://github.com/lushly-dev/afd/pull/2020)); Phase 0 steps 0.1–0.5 ([#1966](https://github.com/lushly-dev/afd/issues/1966),
  [#2122](https://github.com/lushly-dev/afd/pull/2122), closed with 2026-11-22 **go with changes**
  decision recorded on `#1966`); Phase A specification, companion amendments, and revised scenarios
  ([#2133](https://github.com/lushly-dev/afd/issues/2133), [#2139](https://github.com/lushly-dev/afd/pull/2139));
  Phase B Step B1 pattern schema, `patternSources`, and static `specimen-validate` checks
  ([#2144](https://github.com/lushly-dev/afd/issues/2144), [#2203](https://github.com/lushly-dev/afd/pull/2203));
  Phase B Step B2 `press`, capture 0.10 ARIA states, role sets/name matchers, and portable expectations with host-climb ([#2145](https://github.com/lushly-dev/afd/issues/2145), [#2306](https://github.com/lushly-dev/afd/pull/2306));
  Phase B Step B3 gate setups, filtered `specimen-list`, native portable gate run, `patterns@1` coverage, `specimen-suggest` setup stubs, PA-8 capture skip, and P0-4 fixture upgrades ([#2146](https://github.com/lushly-dev/afd/issues/2146), [#2525](https://github.com/lushly-dev/afd/pull/2525));
  Phase B Step B5 Slice 1 Pack Format 2 and Phase C Step C1 Umbel format 2 reader & cross-library aggregation ([#2147](https://github.com/lushly-dev/afd/issues/2147), [#2148](https://github.com/lushly-dev/afd/issues/2148), [#2565](https://github.com/lushly-dev/afd/pull/2565));
  Phase C Step C2 Slice 1 `components-pattern-list` and `components-pattern-open` ([#2149](https://github.com/lushly-dev/afd/issues/2149), [#2573](https://github.com/lushly-dev/afd/pull/2573));
  Phase C Step C3 Slice 1 patterns in `components-brief` and `components-open` ([#2150](https://github.com/lushly-dev/afd/issues/2150), [#2581](https://github.com/lushly-dev/afd/pull/2581)).
- **Not done:** Phase B Slice 2 (B4 saved copies, B5 Slice 2), Phase C Slice 2 (`content.copies`, `components-check` `OUTDATED_COPIES`), and Phase D. See [Delivery steps](#delivery-steps) and
  [What is not done](#what-is-not-done).
- **Last verified:** 2026-11-25 on Rust 1.100.0: C3 Slice 1 (#2150) patterns in `components-brief` and `components-open` (compact vs `out-of-context` object links, deduplicated `content.patterns`, `known` statement ids, cross-library owner envelope, `detail: "api"` omissions, Phase 0.4 shedding order Step 5b `patternCustomize` before `usage` / Step 10b `patternKeep` after `ruleText` / Step 13 `patterns` link, `minimum_basis` preserving `out-of-context`, `render: "text"` quoting & golden files, D153 canary containment, and compiled vs `.wasm` parity).
- **Follow-ups:** the [table below](#follow-ups-not-yet-issues).

## Delivery steps

Each step sits on its own blank-line-separated list item so concurrent pull requests never conflict.

- **Phase A — Specifications and Pack Format 2 ([#2133](https://github.com/lushly-dev/afd/issues/2133)):** Done 2026-11-22 ([#2139](https://github.com/lushly-dev/afd/pull/2139)). [`spec.md`](spec.md), [Umbel Amendment A31](../../../../endpoints/umbel/docs/plugins/components/spec.md#amendment-a31-patterns-and-saved-copies-1073), [Design Decisions gate-case skip](../../complete/design-decisions/design-decisions.proposal.md), and all 10 revised scenarios merged.

- **Phase B — Specimen (B1–B5):** In progress. B1 ([#2144](https://github.com/lushly-dev/afd/issues/2144), merged in [#2203](https://github.com/lushly-dev/afd/pull/2203)) pattern schema/validation; B2 ([#2145](https://github.com/lushly-dev/afd/issues/2145), [#2306](https://github.com/lushly-dev/afd/pull/2306)) `press`, capture 0.10 ARIA states (incl. `invalid`), `a11y`/`focus`/`layout` + host-climb; B3 ([#2146](https://github.com/lushly-dev/afd/issues/2146), merged in [#2525](https://github.com/lushly-dev/afd/pull/2525)) setups, filtered `specimen-list`, native gate `specimen-run`, `patterns@1` (`patternLibrary`), upgraded `fixtures/pack-library/{select,field}.js` stubs (P0-4); B4 (Slice 2, not yet filed) `specimen-pattern-save` (zero-error remount, `tokens`, `pack.localElements`, downgrade guard, batch refresh); B5 Slice 1 ([#2147](https://github.com/lushly-dev/afd/issues/2147), merged in [#2565](https://github.com/lushly-dev/afd/pull/2565)) Pack Format 2 (`docs/pack-format.md`, `checkPack`, `PATTERN_SETUP_MISSING`, per-error suggestions; Slice 2 copy records and `fingerprintsOnly` follow with B4).

- **Phase C — Umbel `components` plugin (C1–C3):** In progress. C1 ([#2148](https://github.com/lushly-dev/afd/issues/2148), merged in [#2565](https://github.com/lushly-dev/afd/pull/2565)) format 2 reader & cross-library aggregation; C2 Slice 1 ([#2149](https://github.com/lushly-dev/afd/issues/2149), merged in [#2573](https://github.com/lushly-dev/afd/pull/2573)) `components-pattern-list` & `components-pattern-open`; C3 Slice 1 ([#2150](https://github.com/lushly-dev/afd/issues/2150), merged in [#2581](https://github.com/lushly-dev/afd/pull/2581)) `components-brief` patterns (compact links, `patternCustomize` shed before `usage`, `out-of-context` vs `minimum_basis`), with Slice 2 `content.copies` & `components-check` `OUTDATED_COPIES` following Slice 2.

- **Phase D — First consumers (D1–D3):** Not started (gated on Phases B & C). D1 `violet-elements` (`select`, `field`, `dialog.modal` + builder re-measurement per P0-7); D2 Loam (`pack.localElements`, saved copies, checklist gates); D3 second consumer library (Lushly).

- **Amendment — Agent-First Design Phase A (approved 2026-11-24, Epic [#2544](https://github.com/lushly-dev/afd/issues/2544)):** Applied in [`spec.md` §8](spec.md#8-amendment-agent-first-design-phase-a-approved-2026-11-24): `afd-defaults@<semver>` (10 result-state patterns), `approvalStatus` + Pack Format 2 schema updates + `components-brief` `patterns[]` / `includeProposed`, copied patterns (`derivedFrom`, `waivedKeep`, `WAIVER_REASON_REQUIRED`, `specimen-pattern-fork`/`compare`/`merge`), and compiled `patternBindings` for WASI Umbel. Implementation follows under [#2544](https://github.com/lushly-dev/afd/issues/2544).

## Steps (pre-implementation history)

| Step | State | Evidence |
| --- | --- | --- |
| Draft the proposal | Done 2026-11-12 | [`patterns.proposal.md`](patterns.proposal.md) |
| Write the jobs as scenarios | Done 2026-11-12; revised 2026-11-21 and 2026-11-22 | [`scenarios/`](scenarios/), ten files, 44 steps |
| Check the scenarios | Done 2026-11-21; re-run 2026-11-22 for Phase A | [How the jobs were checked](#how-the-jobs-were-checked) |
| Save as a proposal and open the epic | Done 2026-11-12 | Epic [#1073](https://github.com/lushly-dev/afd/issues/1073) |
| The owner cuts, adds and ranks the jobs, and answers the proposal's section 12 | Done 2026-11-21 | Proposal, sections 4, 8 and 12 (all 7 questions resolved, decisions 1–20 ratified) |
| Walk the paths with readers who did not write them | Done 2026-11-21 ([#1133](https://github.com/lushly-dev/afd/issues/1133), [#2020](https://github.com/lushly-dev/afd/pull/2020)) | Pass 1: three fresh read-only readers (Person, Job List, Calling Agent); Pass 2: one fresh read-only reader over post-walk additions ([The walk](#the-walk)) |
| Independent review of the proposal | Done 2026-11-21 ([#1133](https://github.com/lushly-dev/afd/issues/1133), [#2020](https://github.com/lushly-dev/afd/pull/2020)) | Two-model first review (`gemini-4-neon` + `claude-opus-5-5` `high`) + focused verification passes ([The review](#the-review)) |
| Phase 0, steps 0.1 to 0.5 | Done 2026-11-22 ([#1966](https://github.com/lushly-dev/afd/issues/1966), [#2122](https://github.com/lushly-dev/afd/pull/2122), merged as `cfdb77d8b9`) | [Phase 0 findings](#phase-0-findings) ($2.89 of $25.00 cap spent on 0.3; step 0.5 owner decision recorded 2026-11-22: **go with changes**) |
| Phase A, specify | Done 2026-11-22 ([#2133](https://github.com/lushly-dev/afd/issues/2133), [#2139](https://github.com/lushly-dev/afd/pull/2139)) | [`spec.md`](spec.md), [Umbel Amendment A31](../../../../endpoints/umbel/docs/plugins/components/spec.md#amendment-a31-patterns-and-saved-copies-1073), [Design Decisions amendment](../../complete/design-decisions/design-decisions.proposal.md), revised [`scenarios/`](scenarios/) |
| Phases B to D | In progress (B1 [#2144](https://github.com/lushly-dev/afd/issues/2144) in [#2203](https://github.com/lushly-dev/afd/pull/2203); B2 [#2145](https://github.com/lushly-dev/afd/issues/2145) in [#2306](https://github.com/lushly-dev/afd/pull/2306); B3 [#2146](https://github.com/lushly-dev/afd/issues/2146) in [#2525](https://github.com/lushly-dev/afd/pull/2525)) | [`spec.md` §7](spec.md#7-phase-deliverables-and-measurement-gates) |

## What is not done

- **Phase B remaining steps:** Slice 2 saved copies (`specimen-pattern-save`) and Pack Format 2 ([#2147](https://github.com/lushly-dev/afd/issues/2147)) remain open.
- **Phases C and D:** Umbel `components` plugin format-2 reader and pattern commands
  ([#2148](https://github.com/lushly-dev/afd/issues/2148)–[#2150](https://github.com/lushly-dev/afd/issues/2150))
  and first consumers (`violet-elements`, Loam, Lushly) remain open.

## Phase 0 findings

Measured 2026-11-22 against `main` at `3a7c3e54be` on Node 26.13.0, Chromium headless shell (rev
1255), Specimen's built native host (`specimen-host` release build), and Umbel's
`umbel-plugin-components` `fast_af` test suite. Results were not re-run after syncing the branch
onto `49857af555` (which includes `9355c5835` adjusting `violet-text-field` narrow-grid CSS and
regenerating dark theme tokens). Each step's go/no-go rule was fixed during this session before
running its measurement (not pre-published in `#1966`). All measurement scripts were throwaway
harnesses kept outside the repository; only this record is committed.

### Session-fixed go/no-go rules

| Step | Go | Go with changes | Stop |
| --- | --- | --- | --- |
| 0.1 Portable gates | >= 60% of each pattern's drafted `keep` statements portable; runs unchanged on both pairs; >= 4/5 seeded faults caught per component (>= 16/20); focus observable across shadow roots | >= 80% fault detection on real components or >= 50% portable, but target matching or capture extensions need Phase A adjustments | < 50% portable, < 3/5 faults caught on real components, or focus/ARIA unreadable |
| 0.2 Saved regions | >= 70% (>= 14/20) remount with identical roles/states and 0% false `complete` | 40%–69% reproduce cleanly, or theme/manifest rules need Phase A changes, with 0% false `complete` | < 40% reproduce cleanly or remount yields false `complete` |
| 0.3 Builder ($25 cap) | Arm (c) >= +15 pp over Arm (a) at <= 2x median cost/tokens; OR Arm (b) >= +10 pp or >= 20% fewer median tokens at >= equal score | Arm (c) >= +10 pp over Arm (a) while Arm (b) shows no gain | Neither Arm (b) nor (c) improves pass rate (> 5 pp) or cuts median tokens/cost >= 20% |
| 0.4 Brief size | Loam `chrome` default brief <= post-A24 baseline (96k whole and 40k budget) and `api` <= 50% of declarations | Grows <= 5% due to link overhead or added `customize` prose, fixable via shedding/compact links | Grows > 5% or exceeds declarations |

### Step 0.1: Portable gates (`select` and `field`)

**Verdict: Go with changes.**

- **Focus capture works today across open shadow roots.** Verified live via Specimen's
  `createInProcessBench` (`foundations/specimen/src/browser/capture.ts:112-123` walks
  `document.activeElement` through `shadowRoot.activeElement` and populates
  `ElementObservation.state.focused`):
  - `violet-select` (`components-select--overview`):
    `root/div:1/form:1/violet-select:1/shadow/div:1/div:2/button:1` → `state.focused: true`,
    `accessibility: { role: "button", name: "Propagation path Direct seed" }`.
  - `violet-text-field` (`components-text-field--overview`):
    `root/violet-text-field:1/shadow/div:1/div:1/input:1` → `state.focused: true`,
    `accessibility: { role: "searchbox", name: "Plant name" }`.
  - `example-select` (`checks--select-open`): `accessibility: { role: "combobox", name: "Size" }`,
    `state.focused: false` (stub lacks `tabindex`).
  - `example-field` (`example-field--default`): `accessibility: { role: "textbox", name: "Email" }`,
    `state.focused: false` (stub lacks `tabindex`).
- **ARIA states gap is wider than the proposal assumed.** `foundations/specimen/host/src/aria.rs:344-348`
  records only `{ role, name }` on `ElementObservation.accessibility`. Its snapshot formatter
  (`aria.rs:8-9,52-58`) emits only Playwright's states (`checked`, `pressed`, `selected`, `expanded`,
  `disabled`, and `level`) into the page-level YAML `a11y.snapshot` string; `invalid` hits `_ => None`
  and is absent from both `ElementObservation.accessibility` and `a11y.snapshot` (available only in
  raw CDP `Accessibility.getFullAXTree`). Phase B2 must surface structured ARIA states—including
  `invalid`—directly from CDP `Accessibility.getFullAXTree`.
- **Statement portability (reported on both denominators for Step 0.5 clarity):**
  - **Against drafted pattern `keep` statements (rule denominator):** 8/8 `select` (100%) and 8/8
    `field` (100%) ran as zero-tag, zero-selector portable gates (`select`: `named`,
    `opens-on-click`, `escape-closes`, `keyboard-select`, `form-submits-value`, `disabled-inert`,
    `invalid-validity`, `fits-narrow`; `field`: `named`, `form-submits-initial`, `focusable`,
    `accepts-text-and-commits`, `disabled-inert`, `invalid-aria`, `invalid-validity`,
    `fits-narrow`).
  - **Against existing `violet-elements` guide files:**
    - `violet-select.guide.json` (8 statements: 5 `usage`, 3 `a11y`): **5/8 (62.5%)** map to
      portable pattern behaviors (`select.value`, `select.open`, `select.typeahead`, `select.name`,
      `select.focus`) and **3/8** stay component-specific (`select.unmatched` raw-value property
      handling, `select.events` JS `selectValue()` + `CustomEvent.detail.value`, `select.error`
      `error-text` description ordering).
    - `violet-text-field.guide.json` (5 statements: 4 `usage`, 1 `a11y`): **2/5 (40.0%)** map to
      portable pattern behaviors (`text-field.validation`, `text-field.commit`) and **3/5** stay
      component-specific (`text-field.error`'s no-`error-text`/danger-colour styling detail,
      `text-field.before` named slot, `text-field.describedby` host ARIA element reflection).
      However, `violet-text-field`'s core field contract lives in `shared.guide.json`, where **5/7**
      applicable field/form rules (`field.label`, `field.placeholder`, `field.supporting-text`,
      `form.participation`, `form.invalid`) express portable pattern behaviors (combined
      `violet-text-field` guide + shared field/form rules: **7/12 = 58.3%**; `text-field.error`'s
      core `aria-invalid` + linked-reason wording is duplicated verbatim in `violet-text-area.guide.json`
      and is evaluated in Step 0.4 S3 as a shared statement, while its danger-colour detail remains
      unportable for gates).
- **Baseline pass rates & 20 seeded faults (5 per component):**

| Component | Baseline shared gates passed | Caught by unchanged shared gates | Fault-to-gate mapping |
| --- | --- | --- | --- |
| `violet-select` | 8/8 (7/8 before `validity` host-climb) | **5/5** (4/5 before fix) | `F1-missing-label`→`named`, `F2-no-open`→`opens-on-click`, `F3-escape-drops-focus`→`escape-closes`, `F4-no-form-value`→`keyboard-select`/`form-submits-value`, `F5-validity-ignored`→`invalid-validity` |
| `example-select` | 5/8 (`escape-closes`, `keyboard-select`, `invalid-validity` fail on stub) | **4/5** (+1 via stub-only check) | Shared: `F1-missing-label`→`named`, `F2-no-open`→`opens-on-click`, `F4-no-form-value`→`form-submits-value`, `F5-narrow-overflow`→`fits-narrow`. Stub-only: `F3-no-change-event` caught only by a stub `click`→`change` check (`violet-select` fires `change` on choice, not open) |
| `violet-text-field` | 8/8 (7/8 before `layout` host-climb) | **5/5** (4/5 before fix) | `F1-missing-label`→`named`, `F2-no-form-value`→`form-submits-initial`/`accepts-text-and-commits`, `F3-no-change-event`→`accepts-text-and-commits`, `F4-validity-broken`→`invalid-aria`/`invalid-validity`, `F5-narrow-overflow`→`fits-narrow` |
| `example-field` | 5/8 (`focusable`, `accepts-text-and-commits`, `invalid-validity` fail on stub) | **4/5** (+1 via stub-only check) | Shared: `F1-missing-label`→`named`, `F2-no-form-value`→`form-submits-initial`, `F3-missing-invalid-state`→`invalid-aria`, `F5-narrow-overflow`→`fits-narrow`. Stub-only: `F4-no-change-event` caught only by a stub `click`→`change` check (stub lacks `<input>` editing) |
| **Total** | **26/32** (16/16 on real Violet components) | **18/20 (90%)** shared (20/20 incl. 2 stub-only) | Meets pre-registered >= 4/5 per component and >= 16/20 overall on strictly shared portable gates |

- **Four portability/engine gaps uncovered (must be folded into Phase A):**
  1. **Strict `{ role, name }` target matching fails across real implementations:**
     `{ role: "combobox", name: "Fruit" }` matched `example-select` and failed `violet-select`
     (whose trigger is `<button aria-haspopup="listbox">` with accessible name
     `"Fruit Select an option"` / `"Fruit Direct seed"`). Pattern setup targets need role sets
     (e.g. `["combobox", "button"]`, `["textbox", "searchbox"]`) and name prefix/contains matchers
     (`nameStartsWith` / `nameContains`).
  2. **`validity` expectation must host-climb to form-associated custom elements:** Resolving
     `violet-select`'s trigger hits the inner shadow `<button>`, whose native
     `HTMLButtonElement.checkValidity()` always returns `true` and masks
     `<violet-select>.checkValidity() === false`. Climbing to the enclosing `formAssociated` custom
     element (aligning with
     [Pointing §4.1](../../complete/pointing/pointing.proposal.md#41-one-rule-for-what-is-selected))
     fixed baseline `violet-select` (7/8 → 8/8) and caught `F5-validity-ignored`.
  3. **`layout` expectation must host-climb for custom elements:** On `violet-text-field`, the inner
     shadow `<input>` has `height: 19px` inside a `36px` `.control-frame`, false-failing
     `minHeight: 24` until `layout` measured the host custom element box (7/8 → 8/8; caught
     `F5-narrow-overflow`).
  4. **Fixture stub completeness:** `foundations/specimen/fixtures/pack-library/{select,field}.js`
     (51 and 40 lines) lack `tabindex`, keyboard handlers, text editing, and `checkValidity()`.
     Upgrading those fixture stubs (or pairing with a second full library) is needed before Slice 1
     exit criterion 1 can run the full gate set against both pairs.
- **Step kinds & expectations needed beyond today's `foundations/specimen/src/types.ts:43-106`:**
  action `press` (key/chord); expectations `a11y` (`nameNonEmpty`, `nameIncludes`, `expanded`,
  `disabled`, `invalid`, `selected`, `checked`), `focus` (boolean), `layout` (`noOverflow`,
  `minHeight`, `noOuterMargin`, with host-climb), plus `validity` host-climb and existing
  `form`/`event` (with `absent`).

### Step 0.2: Saved region reproduction (20 regions)

**Verdict: Go with changes.**

Captured 20 regions via Specimen (`createInProcessBench`, light and dark themes), extracted light
DOM with Specimen's `exampleMarkup()`, and remounted each standalone in Chromium both with and
without its theme stylesheet:

| Source (10 each) | Same roles & 0 errors | Same box (<= 2px) | Complete (strict `violet` CEM) | Complete (with app-local tags) | Theme-dependent (light vs dark) | Visually shifts unthemed (light) | External tokens referenced |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Loam chrome** | 7/10 (70%) | 9/10 (90%) | **0/10 (0%)** | **7/10 (70%)** | 10/10 (100%) | 10/10 (100%) | 11–68 per region |
| **`violet-elements`** | 8/10 (80%) | 9/10 (90%) | **8/10 (80%)** | **8/10 (80%)** | 10/10 (100%) | 3/10 (30%) | 42–85 per region |
| **Combined (20)** | **15/20 (75%)** | **18/20 (90%)** | **8/20 (40%)** | **15/20 (75%)** | **20/20 (100%)** | **13/20 (65%)** | **11–85 per region** |

- **Stripped breakdown across all 20 regions:** `0` `<script>` tags and `0` inline `on*` event
  handlers were found in any of the 20 regions. All 10 `violet-elements` regions had `0` stripped
  items. All 10 Loam chrome regions triggered `unmanifested-element` (`1–2` `loam-*` tags per
  region) because Loam has no Custom Elements Manifest of its own (`pack.dependencies` covers only
  `violet-elements`).
- **Cleanly reproduced (15/20 with app-local tags):** Loam `empty-state`, `notice`, `statusbar`,
  `sidebar`, `titlebar`, `panel`, `resize-handle`; `violet-elements` `components-button--overview`,
  `alert--overview`, `card--overview`, `empty-state--overview`, `text-field--invalid`,
  `select--disabled`, `checkbox--overview`, `badge--overview`.
- **Cleanly caught as `draft` (5/20; 0/20 silent false `complete`):**
  - **4 property-driven regions** whose data is set via JS properties and not reflected in HTML
    attributes: Loam `app-list` (`.items` lost → renders empty paragraph), `app-part-header`
    (`.actions` lost → 0 buttons), `app-list-failed` (`.failure` lost → renders empty paragraph),
    and `violet-elements` `components-data-grid-attachment-cell--overview` (attachments lost →
    renders `"Add attachments"`).
  - **1 runtime remount error:** `components-tabs--overview` matched accessible roles and box height
    on remount, **but threw `PAGEERROR: tab.syncPresentation is not a function`** (the known library
    defect noted in Component Briefs' `prototype.md`). Proves remount verification must fail on any
    console/page error, not only DOM/role diffs.
- **Two mandatory Phase A adjustments for Slice 2:**
  1. **App-local custom elements (`0/10` strict CEM on Loam):** Under §5.4 step 3's strict manifest
     filter, all 10 Loam regions drop to `draft` because `loam-*` tags are unmanifested. Phase A
     must allow declared app-local custom elements (e.g. local CEM or explicit app tag list) so Loam
     can save complete copies.
  2. **Theme tokens must be recorded on saved copies:** 20/20 regions are theme-sensitive and read
     11–85 external `--color-*`/`--shell-*`/`--space-*`/`--radius-*`/`--font-*` custom properties;
     10/10 Loam regions and 3/10 `violet-elements` regions (`empty-state`, `text-field--invalid`,
     `select--disabled`) visibly degrade even in light mode without the theme stylesheet. Pack
     format 2 copy records should record referenced external tokens and/or required theme stylesheet.

### Step 0.3: Builder experiment ($25 hard cap)

**Verdict: Go.**

Ran 15 isolated `claude -p --model sonnet --effort medium` sessions (3 arms x 5 interleaved runs)
building a standalone zero-dependency Web Component (`<acme-select>` + `<acme-option>`). Scored
every output in real Chromium against 8 pattern gates (held back from Arms a and b; runnable by
Arm c via `node run-gates.mjs`) plus 4 transfer/edge-case gates held back from all three arms
(`HB1` disabled option skipped on `ArrowDown`, `HB2` `form.reset()` restores initial value, `HB3`
outside click closes popup, `HB4` `End` key selects last enabled option). Total spend: **$2.8915**
(sum of unrounded per-run costs; arm totals below round to `$2.8916`), **11.6%** of the **$25.00**
hard cap (circuit breaker at $20.00).

| Arm (5 runs each) | Pattern gates (of 40) | Held-back gates (of 20) | Combined (of 60) | Flawless runs (12/12) | Median total tokens (range) | Median tool calls | Total cost (5 runs) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **a. Source alone** | 38/40 (95.0%) | 20/20 (100%) | **58/60 (96.7%)** | 3/5 | **251 101** (108 519–273 317) | 12 | **$1.0943** |
| **b. Pattern + reference** | 40/40 (100%) | 20/20 (100%) | **60/60 (100%)** | 5/5 | **115 014** (73 167–149 067) | 5 | **$0.9054** |
| **c. Pattern + ref + gates** | 40/40 (100%) | 20/20 (100%) | **60/60 (100%)** | 5/5 | **142 162** (103 970–212 088) | 7 | **$0.8919** |

- **Session-fixed Go rule satisfied:** Arm (b) achieved **100% (60/60, 5/5 flawless)** vs Arm (a)'s
  **96.7% (58/60, 3/5 flawless)** while cutting median total tokens by **54.2%** (115 014 vs
  251 101; threshold >= 20%), tool calls by **58%** (5 vs 12), and total cost by **17.3%** ($0.9054
  vs $1.0943). Arm (c) also hit **100% (60/60, 5/5 flawless, 20/20 held-back with zero overfitting)**
  with **43.4%** fewer median tokens (142 162 vs 251 101) and the lowest total cost (**$0.8919**,
  -18.5% vs Arm a).
- **Root cause of Arm (a)'s defects:** Both failing source-only runs (`a-1`, `a-2`) missed the exact
  same requirement (`invalid-validity: a11y-invalid`, leaving `aria-invalid="false"` on the trigger
  while invalid). That requirement is buried in 846 lines of FAST-AF template/lifecycle code in
  `violet-select.ts`, whereas `select.pattern.json` stated it directly in one `keep` sentence.
- **Measurement transparency notes:**
  - During runs 1–3, the first evaluator version reused one page across gates without
    `page.goto('about:blank')`, triggering `CustomElementRegistry` duplicate-definition errors on
    implementations without `if (!customElements.get(...))` (causing 1 extra fix cycle in `c-2` and
    `c-3` and an initial harness failure on `b-3`). Fixed with `page.goto('about:blank')` per gate;
    all 15 produced files were scored identically on the clean evaluator, and runs 4–5 ran
    end-to-end on the clean evaluator (`c-4`: 103 970 tokens, 4 calls; `c-5`: 128 570 tokens, 5
    calls; both 8/8 on first gate run).
  - Because Sonnet 5.5 already reached 96.7% on Arm (a) when given full reference source, step 0.3
    demonstrates a large efficiency gain and elimination of subtle a11y omissions rather than a wide
    raw accuracy gap. Step D1 should re-measure on a harder pattern (`dialog.modal` or an unfamiliar
    target without direct source).

### Step 0.4: Brief size check (post-A24 baseline)

**Verdict: Go with changes.**

Verified post-A24 Rust baseline via `cargo test -p umbel-plugin-components --test fast_af -- --nocapture`
at `3a7c3e54be` (note: `detail: "api"` is now `36.7%–39.7%` vs `33%–37%` noted in
`patterns.proposal.md:180` because `#1147` expanded attribute value lists, as `fast_af.rs:173`
records). Then simulated moving shared `violet-elements` field statements into a `field` pattern:

| Page (post-A24 Rust `fast_af.rs` baseline) | Declarations | Whole (96k B, % of decls) | Default (40k B) | `detail: "api"` (% of decls) |
| --- | ---: | ---: | ---: | ---: |
| **Loam `chrome`** (22 components) | 99 146 B | **92 302 B** (93.1%) | **37 473 B** | **38 901 B** (39.2%) |
| Loam `console` (8 components) | 48 848 B | 39 834 B (81.5%) | 39 834 B | 17 911 B (36.7%) |
| Loam, every package and app (24 components) | 101 293 B | 62 955 B (sheds examples) | 39 493 B | 40 231 B (39.7%) |
| Twenty-component page (20 components) | 103 351 B | 81 323 B (78.7%) | 39 080 B | 38 680 B (37.4%) |

- **Simulator calibration on Loam `chrome`:** un-shed whole = `91 667 B` vs Rust `92 302 B`
  (`-635 B`, `-0.69%`), `api` = `38 266 B` vs Rust `38 901 B` (`-635 B`, `-1.63%`)—a constant ~29 B
  per-component envelope offset (`library`/scan metadata) shared identically by baseline and pattern
  variants, so byte deltas cancel it cleanly. At the 40 000 B budget, that `-635 B` offset left the
  simulator one discrete shedding step higher (`39 372 B` vs Rust `37 473 B`, `+5.07%`). All
  percentages below are computed against the Rust `fast_af.rs` baseline (`92 302 B` whole /
  `37 473 B` default 40k).

Measured deltas on **Loam `chrome`** (22 components) when moving shared field statements from
`shared.guide.json:194-303` into a `field` pattern (S3–S6 move the 5 shared rules `field.label`,
`field.placeholder`, `field.supporting-text`, `field.value-attribute`, `field.input-change` plus the
verbatim duplicate `text-field.error`/`text-area.error` wording):

| Variant | Whole (96k B) delta | Default (40k B) delta | `detail: "api"` delta |
| --- | ---: | ---: | ---: |
| S1: Move 3 shared field rules (`field.label`, `field.placeholder`, `field.supporting-text`), `keep` only, object links | **-85 B** (-0.09%) | **-85 B** (-0.23%) | -29 B |
| S2: S1 + 2 new `customize` statements (~343 B), object links | +258 B (+0.28%) | +258 B (+0.69%) | -29 B |
| S3: Move 5 shared field rules + duplicate `error` wording + 2 `customize`, object links (`customize` sheds after `slots`) | **-255 B** (-0.28%) | +240 B (+0.64%) | -119 B |
| S4: S3 with compact same-library links (`"patterns": ["field"]`) (`customize` sheds after `slots`) | **-375 B** (-0.41%) | +120 B (+0.32%) | -239 B |
| S5: S4 + shed `content.patterns[].customize` before `usage` (measured) | **-375 B** (-0.41%) | **-223 B** (-0.60%) | -239 B |
| S6: S3 (object links) + shed `content.patterns[].customize` before `usage` (measured) | **-255 B** (-0.28%) | **-103 B** (-0.27%) | -119 B |

- **Takeaway:** Under the draft shedding order (S3/S4), 40k-budget briefs grew `+120 B` to `+240 B`
  because `usage` had already been shed while `content.patterns[].customize` stayed until after
  `slots`. Reordering `patternCustomize` to shed before `usage` (measured in S5 and S6) makes all
  four pages in `pages.json` strictly smaller than the post-A24 baseline at both 96k and 40k budgets
  even with object links (`-103 B` at 40k, `-255 B` whole on Loam `chrome`), and compact
  same-library links save an extra `120 B` (`-223 B` at 40k, `-375 B` whole, `-239 B` api).

### Step 0.5: Owner decision (approved 2026-11-22)

**Owner decision (2026-11-22, via Focus; recorded on [#1966](https://github.com/lushly-dev/afd/issues/1966)): Approved — go with changes.**
Proceed to Phase A specification ([#2133](https://github.com/lushly-dev/afd/issues/2133)), folding
in all seven concrete adjustments proven by Phase 0 (Phases B–D stay gated on Phase A exit):

1. **Role sets & prefix/substring name matchers** on pattern setup targets (0.1) → [`spec.md` §2.4](spec.md#24-setup-targets).
2. **Host-climb for `validity` (form-associated host) and `layout` (custom element host)** (0.1) → [`spec.md` §3.2](spec.md#32-expectations-and-host-climb).
3. **Structured ARIA states (including `invalid`) on `ElementObservation.accessibility`** from CDP
   `Accessibility.getFullAXTree` (focus already works via `state.focused`) (0.1) → [`spec.md` §3.4](spec.md#34-capture-010-structured-aria-states).
4. **Upgrade `fixtures/pack-library` stubs** (`example-select`, `example-field`) with `tabindex`,
   keyboard handling, text editing, and `checkValidity()` before Slice 1 exit (0.1) → [`spec.md` §7](spec.md#7-phase-deliverables-and-measurement-gates) (Step B3).
5. **Require zero remount page/console errors**, record referenced theme tokens/stylesheets on saved
   copies, and define app-local custom element handling for apps without a CEM like Loam (0.2) → [`spec.md` §1.2, §5.1, §6.5](spec.md#51-specimen-pattern-save).
6. **Shed `content.patterns[].customize` before `usage`** and allow compact same-library string
   pattern links in `components-brief` (0.4) → [Umbel Amendment A31.5](../../../../endpoints/umbel/docs/plugins/components/spec.md#a315-components-brief-extensions-components-open-section-and-phase-04-shedding-order-step-c3).
7. **Re-measure builder value on a harder pattern (`dialog.modal`) in step D1** to test correctness
   separation beyond `select`'s 96.7% source-only baseline (0.3) → [`spec.md` §7](spec.md#7-phase-deliverables-and-measurement-gates) (Step D1).

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
| 2026-11-22 | Fresh two-model review (`gemini-4-neon` + `claude-opus-5-5` `high`; `gpt-6.2-astra` absent from local Codex catalog) | Phase A [`spec.md`](spec.md), Umbel Amendment A31, Design Decisions amendment, promoted `active/patterns/`, and 10 revised scenarios (`#2133`) | Revise | 8 deduplicated blockers (A31.1 sort order vs Job 9, on-disk `CopySourceRecord` schema & copy lifecycle, `refreshStale` edit protection, callable `omitted[]` recovery & `detail: "api"` / Step 13, `minimum_basis` & `out-of-context` brief visibility, `SuiteStory` / `runOutputSchema` extensions, canonical `fingerprint`/`revision` hash alignment, `agent-os/STATUS.md` link) + improvements — all applied |
| 2026-11-22 | Focused verification pass (`claude-opus-5-5` `high`) | Post-fix Phase A diff verifying all 8 blockers + spot-checked improvements | Approve | 8/8 blockers resolved, 0 blockers, 3 minor improvements (Section 10 wording, catalog vs host file-cap note, unique `SuiteStory` gate names — all applied) |

## How the jobs were checked

Re-run 2026-11-22 in this worktree at `da52418b1` after revising the scenarios to the Phase A
contracts (`patternLibrary` on `specimen-coverage`, compact same-library `patterns` links on
`components-brief`, `remount.errors` on `specimen-pattern-save`) and moving `patterns/` to
`docs/features/active/patterns/`, on Node 26.13.0 (`.nvmrc`) with `@lushly-dev/afd-cli` built:

```text
$ node packages/cli/dist/bin.js scenario validate docs/features/active/patterns/scenarios
✓ All 10 scenario(s) are valid!

$ (the dry-run, expect-ref scan and coverage script from jobs-first.md, run in packages/testing)
dry run: 10 files, 0 with errors; expect refs: 0
{"totalScenarios":10,"totalSteps":44,
 "commands":{"tested":12,"known":12,"untested":[],"coverage":100},
 "errors":{"tested":5,"known":9,"untested":["TARGET_NOT_FOUND","SPECIMEN_NOT_FOUND","COPY_DOWNGRADE_REFUSED","PATTERN_AMBIGUOUS"],"coverage":55.55555555555556},
 "jobs":{"count":10,…}}
not drafted: []
```

*(Earlier runs: 2026-11-21 at `9e2aff933` — 10 files, 44 steps, 12/12 commands, 5/8 errors, 0 dry-run
errors; 2026-11-12 at `d152f3dc` — 9 files, 28 steps, 9/11 commands, 3/5 errors, 0 dry-run errors.)*

The known commands given to the script are the twelve in [`spec.md`](spec.md) and
[Umbel Amendment A31](../../../../endpoints/umbel/docs/plugins/components/spec.md#amendment-a31-patterns-and-saved-copies-1073)
(the Slice 2 `components-check` `OUTDATED_COPIES` warning extends A30's existing check command and is
covered by Umbel's `tests/check.rs`), and the known errors are the nine Patterns-owned command error
codes checked by scenarios (plus `COPY_NOT_FOUND` and `COPY_REFRESH_UNSUPPORTED` unit-tested in B4;
`POINT_STALE` is owned by Pointing; `OUTDATED_COPIES` is a warning). Phase A additions that add no
new jobs or commands (`COPY_DOWNGRADE_REFUSED`, `refreshStale`, pattern/copy deprecation,
`components-check` `OUTDATED_COPIES`, and Design Decisions `skipped.gates`) are verified by Phase
B/C unit and integration tests rather than extra scenario files. Because `afd-testing`'s evaluator
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
| 2026-11-12 | First draft | Sizes named by position (`xs` to `xl`) are hard to extend and seldom say what a size is for. A separate proposal could state a scale as a Violet constraint, name tokens by purpose and derive one size from another; Violet refuses a reference with a transform today (`NOT_IMPLEMENTED`). Raised with the owner, who dislikes position names; out of this proposal's scope | Moved 2026-11-13 to the [Scales](../../complete/scales/scales.proposal.md) proposal ([#1111](https://github.com/lushly-dev/afd/issues/1111)) |
| 2026-11-12 | First draft | Loam's screen specimens set up state with a stub client, separately from the scenario files that assert the same commands. Specimen's application-command runner (T11) would let one scenario drive a screen to a state. The proposal lists it under Later | Moved 2026-11-13 to the [Screens from Jobs](../../complete/screens-from-jobs/screens-from-jobs.proposal.md) proposal ([#1109](https://github.com/lushly-dev/afd/issues/1109)). Correction: Loam has no scenario files; its job tests are Vitest |
| 2026-11-12 | First draft | The [design-to-code proposal](../../proposed/design-to-code/00-overview.md) assumes designs are authored in a drawing tool. This proposal assumes the rendered screen is the medium. Whether to retire or rewrite that proposal is the owner's call | Filed 2026-11-21 as [#1968](https://github.com/lushly-dev/afd/issues/1968) (assigned to owner, `needs:decision`) |
| 2026-11-12 | First draft | `violet-elements`' README still tells a reader to run Storybook, and its one performance baseline names a story that no longer exists. Found while surveying; not this proposal's work | Tracked in [#1085](https://github.com/lushly-dev/afd/issues/1085) |
| 2026-11-21 | Owner walkthrough | Pointer type (`coarse` / `fine`) is not part of Specimen's context model; touch pattern gates rely on viewport alone until added | Filed 2026-11-21 as [#1967](https://github.com/lushly-dev/afd/issues/1967) (sub-issue of `#1073`, deferred until multi-device gates) |
| 2026-11-21 | Owner walkthrough | 45 of `violet-elements`' 77 pack records have no role (`pack/GAPS.md:15`; does not block gates, which read the live tree) | Tracked in [#1146](https://github.com/lushly-dev/afd/issues/1146) |
| 2026-11-21 | Walk & Review | Phase A specification items deferred past Phase 0: pattern/copy deprecation (`status: deprecated` / `replacedBy`), outdated-copy warnings in `components-check`, batch copy refresh, `patternLibrary` naming in `specimen-coverage`, and amending Design Decisions (`#1108`) so unfiltered `specimen-capture` skips gate cases | Specified 2026-11-22 in Phase A ([#2133](https://github.com/lushly-dev/afd/issues/2133)): [`spec.md`](spec.md), [Umbel Amendment A31](../../../../endpoints/umbel/docs/plugins/components/spec.md#amendment-a31-patterns-and-saved-copies-1073), and [Design Decisions](../../complete/design-decisions/design-decisions.proposal.md) |
| 2026-11-21 | Owner walkthrough | Drop `needs:decision` label on epic [#1073](https://github.com/lushly-dev/afd/issues/1073) once [#2020](https://github.com/lushly-dev/afd/pull/2020) lands (Phases A–D stay gated on Phase 0.5) | Done 2026-11-22 ([#2020](https://github.com/lushly-dev/afd/pull/2020) merged) |
| 2026-11-22 | Phase 0.1 ([#1966](https://github.com/lushly-dev/afd/issues/1966)) | Phase A gate specification updates: role sets & prefix/substring name matchers on setup targets; host-climb for `validity` (form-associated host) and `layout` (custom element host); structured ARIA states (including `invalid`) from CDP `Accessibility.getFullAXTree` | Specified 2026-11-22 in [`spec.md` §2.4, §3.2, §3.4](spec.md) ([#2133](https://github.com/lushly-dev/afd/issues/2133)); implementation in Phase B2 |
| 2026-11-22 | Phase 0.1 ([#1966](https://github.com/lushly-dev/afd/issues/1966)) | Upgrade `foundations/specimen/fixtures/pack-library/{select,field}.js` stubs with `tabindex`, keyboard handling, text input, and `checkValidity()` (or pair with a second full library) so Slice 1 exit criterion 1 can run the full gate suite across both pairs | Done 2026-11-24 in Step B3 ([#2146](https://github.com/lushly-dev/afd/issues/2146) / [#2525](https://github.com/lushly-dev/afd/pull/2525)): 32/32 baseline gates pass across `example-*` and divergent `alt-*` pairs and catch 10/10 seeded faults |
| 2026-11-22 | Phase 0.2 ([#1966](https://github.com/lushly-dev/afd/issues/1966)) | Define app-local custom element handling (local CEM or `pack.localElements`), zero-error remount enforcement, and referenced theme token/stylesheet metadata on saved copies in pack format 2 | Specified 2026-11-22 in [`spec.md` §1.2, §5.1, §6.5](spec.md) ([#2133](https://github.com/lushly-dev/afd/issues/2133)); implementation in Phases B4/B5 |
| 2026-11-22 | Phase 0.3 & 0.4 ([#1966](https://github.com/lushly-dev/afd/issues/1966)) | Shed `content.patterns[].customize` before `usage` and allow compact same-library pattern links in `components-brief` (Phase A); re-measure builder value on a harder pattern (`dialog.modal`) in step D1 | Shedding & compact links specified 2026-11-22 in [Umbel Amendment A31.5](../../../../endpoints/umbel/docs/plugins/components/spec.md#a315-components-brief-extensions-components-open-section-and-phase-04-shedding-order-step-c3) ([#2133](https://github.com/lushly-dev/afd/issues/2133)); `dialog.modal` re-measurement tracked in [`spec.md` §7](spec.md#7-phase-deliverables-and-measurement-gates) (Step D1) |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-12 | First draft | A discussion with the owner on how interfaces are built when agents do the building led to this proposal: components stay; guidance, requirements and gates are separated from a component's code; a working region can be saved as a reference; reuse is by instance or by copy. The proposal, nine scenario files and this file were written, and the scenario checks run. Then committed as a proposal, and epic #1073 opened |
| 2026-11-21 | Walkthrough & `#1133` | Walked the proposal section by section with the owner, resolving all seven section 12 questions (decisions 1–20), reconciling shared conventions with Design Decisions / Screens from Jobs / Pointing, and filing Phase 0 ([#1966](https://github.com/lushly-dev/afd/issues/1966)), pointer context ([#1967](https://github.com/lushly-dev/afd/issues/1967)) and design-to-code ([#1968](https://github.com/lushly-dev/afd/issues/1968)). Ran three-seat reader walks (pass 1 + pass 2 on additions) and two-model independent review (`gemini-4-neon` + `claude-opus-5-5` `high`), applied all blockers and improvements, updated `docs/features/README.md`, and verified all 10 scenarios (44 steps, 12/12 commands, 5/8 errors, 0 dry-run errors) |
| 2026-11-22 | Phase 0 (`#1966`) | Executed Phase 0 steps 0.1–0.4 via throwaway measurement harnesses with session-fixed go/no-go rules: (0.1) confirmed Specimen focus capture across open shadow roots, documented the `aria.rs` `invalid` gap, ran portable `select`/`field` gates catching 18/20 faults via shared gates (10/10 on real `violet-*`, 4/5 on each `example-*` stub, plus 2 stub-only click-change checks), and identified 4 Phase A gate/target gaps; (0.2) tested 20 saved regions (10 Loam chrome + 10 `violet-elements`), finding 15/20 (75%) faithful remount with app tags (8/20 strict CEM), 0/20 false `complete`, and 20/20 theme-token dependency; (0.3) ran 15 isolated Sonnet 5.5 builder sessions ($2.89 of $25.00 cap), cutting median tokens 43%–54% and reaching 60/60 (100%) on both pattern arms vs 58/60 (96.7%) source-only; (0.4) verified post-A24 Rust `fast_af.rs` baseline and measured `field` brief size (-103 B to -223 B at 40k and -255 B to -375 B whole once `customize` sheds before `usage`). Recorded findings and **go with changes** recommendation for step 0.5 in `STATUS.md` (merged in [#2122](https://github.com/lushly-dev/afd/pull/2122) as `cfdb77d8b9`) |
| 2026-11-22 | Step 0.5 & Phase A (`#2133`) | Recorded owner's step 0.5 **go with changes** decision on [#1966](https://github.com/lushly-dev/afd/issues/1966) and in `STATUS.md`; promoted `docs/features/proposed/patterns/` → `docs/features/active/patterns/`, updated `docs/features/README.md` and all sibling links; opened sub-issue [#2133](https://github.com/lushly-dev/afd/issues/2133) under [#1073](https://github.com/lushly-dev/afd/issues/1073). Authored Phase A [`spec.md`](spec.md) (Specimen pattern schema, portable gates, capture 0.10 ARIA states, Slice 2 saved copies, Pack Format 2), [Umbel Amendment A31](../../../../endpoints/umbel/docs/plugins/components/spec.md#amendment-a31-patterns-and-saved-copies-1073), and [Design Decisions gate-case skip amendment](../../complete/design-decisions/design-decisions.proposal.md), folding in all seven Phase 0 adjustments and all deferred Phase A items. Revised all 10 scenarios (`patternLibrary`, compact same-library `patterns` links, `remount.errors`) and verified 10/10 valid, 0 dry-run errors, 0 expect refs, 12/12 commands (100%), 5/9 errors on Node 26.13.0 |
| 2026-11-22 | Phase B Step B1 (`#2144`) | Implemented static pattern files (`pattern.json` Zod schema and `@lushly-dev/specimen/pattern.schema.json`), all 9 ASCII format-2 identifier forms (including split-on-`/` <= 64 `qualifiedPattern`), `PatternTarget` role sets and mutually exclusive name matchers (P0-1), `BenchConfig` `patterns`/`patternSources` and manifest-less app `pack` config (`dependencies`/`localElements`/`themeStylesheet`), `guideComponentSchema` `implements`/`contexts`, offline `patternSources` loading, static `parameters.specimen.{patternSetup,contexts}` extraction in `specimen-host`, and zero-browser `specimen-validate` portability/reference checks passing Job 5 (`05-refuse-an-unportable-gate`). Recorded newly minted [#2144](https://github.com/lushly-dev/afd/issues/2144)–[#2150](https://github.com/lushly-dev/afd/issues/2150) beside the Delivery steps (merged in [#2203](https://github.com/lushly-dev/afd/pull/2203)) |
| 2026-11-23 | Phase B Step B2 (`#2145`) | Bumped `CAPTURE_VERSION` to `'0.10'` and extracted structured `ElementObservation.accessibility.states` (`checked`, `pressed`, `selected`, `expanded`, `disabled`, `invalid` incl. `grammar`/`spelling`, `readonly`, `required`, `level`) from CDP `Accessibility.getFullAXTree` in `specimen-host/src/aria.rs` (note: Chromium 146's Blink `AXNodeObject` normalizes authored `aria-invalid="grammar"`/`"spelling"` on `<input>` to CDP boolean `true`, while `specimen-host` Rust tests verify exact `"grammar"`/`"spelling"` CDP token preservation); implemented `{ press, target? }` keyboard chords in `keyboard.rs`/`page.rs` (verifying target focus before dispatch, dispatching native `keyDown`/`keyUp` for printable keys including literal Space and non-US Unicode, and preserving retained-play Playwright parity); added role sets (`role: string \| string[]`) and `nameStartsWith`/`nameContains` target matching preserving `TARGET_NOT_FOUND`/`TARGET_AMBIGUOUS`; and implemented portable `a11y`, `focus`, and `layout` expectations plus host-climb for `validity`, `layout`, `form` (including external `form="..."` owners), and `event` (origin-scoped host fallback and expectation step-id intervals), verified in Chromium on `example-*`, shadow form-associated controls, and real `violet-select`/`violet-text-field` ([#2306](https://github.com/lushly-dev/afd/pull/2306)) |
| 2026-11-24 | Phase B Step B3 (`#2146`) | Implemented setup bindings (`patternSetup`/`contexts` on native specimens via config or static OXC extraction in `host/src/csf/native.rs` and on play-free retained stories), synthesized lowercase `PACK_PATTERNS.story`-validated gate cases (`<case>--gate--<gate>`, max 200 chars), filtered & cursor-paginated `specimen-list` (`kind`/`component`/`pattern`/`match`/`limit`/`after`/`next`), native portable gate execution in `specimen-host` (`host/src/gate.rs`, `host/src/a11y_expect.rs`, retiring `page.rs` from `file-size-limits.json`) and `specimen-run` (`capture: 'none'` default, pre-launch `out-of-context`, `SuiteRun.counts.outOfContext`), `patterns@1` coverage keeping `schema-partitions@1`/`guides@1` byte-identical, `specimen-suggest` component and tagless setup stubs, PA-8 `specimen-capture` default gate skipping with explicit gate capture + axe, CLI flags, and P0-4 `fixtures/pack-library/{select,field}.js` stub upgrades passing 32/32 cross-pair baseline gates and catching 10/10 seeded faults ([#2525](https://github.com/lushly-dev/afd/pull/2525)) |
