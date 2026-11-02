# T07 coverage and rule replacement

**State, 2026-11-02:** complete. All of T07's acceptance is met, on main at `4a26cc0b`, with [what it leaves open](#what-t07-leaves-open) listed at the end. Step 1, `specimen-coverage`, is done and merged in [#692](https://github.com/lushly-dev/afd/pull/692). Step 2, claims and waivers, is done and merged in [#695](https://github.com/lushly-dev/afd/pull/695). Step 3, rule replacement, is done and merged in [#696](https://github.com/lushly-dev/afd/pull/696). Step 4, `specimen-suggest` and the adapter, is done and merged in [#697](https://github.com/lushly-dev/afd/pull/697).

**One decision for the owner:** a real story bug needs fixing or waiving before FAST-AF's cutover. See [the finding](#finding-a-disabled-story-that-disables-nothing).

T07's acceptance comes from the [implementation plan](implementation.md#ordered-implementation-queue): distinguish represented, asserted, verified, missing and unknown obligations; add coverage, suggest and Fastbot adapters; and give each existing required rule positive and failing detection evidence and a retirement record before deletion. Unknown required obligations MUST block acceptance.

## What has to be replaced

Fastbot's `fastaf_validate_story_contract` is the rule set in force, on FAST-AF's pre-commit hook. Lushly has no story contract lint. The profile rules were replaced in [T06 step 4](t06-full-runner.md#step-4-specimen-profile).

| Rule | What Fastbot checks today | How it checks |
| --- | --- | --- |
| `MISSING_STORY` | A component has a co-located story file | File exists |
| `MISSING_GLOBAL_A11Y_ERROR_POLICY` | The preview sets `a11y.test = 'error'` | Regular expression over the preview |
| `MISSING_AUTODOCS_TAG` | The story file has the `autodocs` tag | Text search |
| `MISSING_PLAY_FUNCTION` | The file has at least one play | Regular expression |
| `MISSING_DOCS_DESCRIPTION` (warning) | The file has a docs description | Text search |
| `MISSING_STORY_EXPORT` | The file exports a story | Regular expression |
| `MISSING_BASELINE_STORY` | A story named like `Overview` or `Default` | Export names |
| `MISSING_STATE_STORY` | A story named for each of `disabled`, `invalid`, `readonly`, `checked`, `selected` and `busy` the component registers | Export names |
| `MISSING_FORMDATA_ASSERTION` | A form-associated component's story file mentions `FormData(` | Text search |
| `MISSING_VALIDITY_ASSERTION` | The same for `checkValidity()` | Text search |
| `UNDOCUMENTED_A11Y_EXCEPTION` | A story turning axe off documents why | Regular expressions |

Each is a check of source text. The proposal asks for more than the same check in a new place: "form participation MUST use actual FormData/validity evidence", and "assertion presence elsewhere in the file is insufficient".

## Two separate questions

The proposal separates these, and T07 keeps them apart.

- **Parity:** does each Fastbot rule have a replacement with equivalent executable evidence, which passes on FAST-AF's snapshot and detects a deliberately failing fixture? This is what blocks retiring a rule, and what T08's cutover depends on.
- **Coverage:** what does a run actually show of each component's required partitions? This is a new, stronger measure. "Stronger new coverage rules MAY be introduced separately from migration parity, with their scope stated explicitly." So today's stories are measured by it and not failed by it: a legacy play stays `unknown` for what it asserts.

## Step 1: `specimen-coverage`

`bench.coverage()`, `specimen-coverage` and `specimen coverage [TAG]` run the selected cases and report each component's required partitions at the level those runs earn. The [README](../../../../foundations/specimen/README.md#report-coverage) describes it. A pure function, `computeCoverage`, derives the report from a schema and captures.

| Obligation (`schema-partitions@1`) | Evidence |
| --- | --- |
| `default` | An element with every finite member at its default |
| `property:NAME=VALUE`, for each finite value of a property or attribute | The live property, or else the attribute, on the element |
| `slot:NAME=filled`, `slot:NAME=empty` | The slot's own assigned nodes, ignoring whitespace |
| `event:NAME` | The event in a case's declared history |
| `command:ID` | None yet; needs a claim |
| `form:participation`, `form:validity` | None yet; required once an element is seen to be form-associated |

Capture 0.6 adds what this needs to an element's `state`: `slot:NAME` with the count of assigned nodes, and `formAssociated`. A coverage run also reads each component's finite properties live, as `prop:NAME`. Other captures do not, so they stay the same size and run no extra getters.

### On the consumers

Every case passed in both, so all of this is from passing runs.

| | FAST-AF `24e4eb86` | Lushly `0eede7f0` |
| --- | --- | --- |
| Components in the manifest | 77 | 114 |
| Rendered by some case | 77 | 112 |
| Obligations | 943 | 1,418 |
| `represented` | 668 | 760 |
| `missing` | 150 | 293 |
| `unknown` | 125 | 365 |
| `verified` | 0 | 0 |
| Time, two workers | 45 s | 201 s |

These are measurements and not failures, and nothing gates on them yet. `verified` is 0 because no claim exists yet (step 2).

- **The `missing` results are specific.** No FAST-AF story shows `violet-button` as `type=reset` or with an empty default slot, for instance. Some of these are not worth a story, and step 2's versioned waivers are where to say so; none is waived automatically.
- **The `unknown` results are events, forms and a little else.** Reading properties live took property `unknown`s from 263 to 0 on FAST-AF and from 637 to 2 on Lushly. The rest are events (97 and 363), which no story declares, and FAST-AF's form obligations (28).
- **The manifest limits this.** Types the manifest writes as an alias, such as `VioletButtonAppearance`, have no finite values, so they are open-ended here. The FAST-AF plugin's Definition Schema knows more, and is not yet consulted.

## Step 2: claims and waivers

`asserted` and `verified` now exist. A claim binds a target, an obligation, a checkpoint and expectation ids, and the [README](../../../../foundations/specimen/README.md#report-coverage) shows the format. The proposal's distinctions are each tested:

| The proposal says | What happens |
| --- | --- |
| "Assertion presence elsewhere in the file is insufficient" | Evidence comes from expectations that ran in this case. One about another target leaves the obligation `asserted` |
| "Disabled represented MUST NOT imply activation suppressed" | `represented` proves the state only. An `absent` event expectation is what proves inertness, and it fails if the event fires |
| "Form participation MUST use actual FormData/validity evidence" | A `form` expectation builds real `FormData` from the target's form; a `validity` one calls its `checkValidity()`. A play's claim alone reaches `verified` only when the run saw that happen |
| "Slots MUST be inspected at their targets" | From step 1: each slot's assigned nodes |
| "Legacy plays without it retain test results but MUST report unproven coverage as unknown" | A play with no `claim` adds no claim. Its stories count as `represented` for what they show, and nothing more |
| "No automatic waivers for migration gaps" | Waivers come only from the configuration, versioned, and appear in the report with any that match nothing |

**A false claim credits nothing.** A first version let a claim about a state its target was not in raise the obligation to `asserted`, displacing real evidence. A test found that, and such a claim now goes in `invalidClaims`, along with one whose expectations did not run or that names an obligation the component does not have. Any of these keeps a run from being complete.

`validateSpecimen` refuses what cannot work before anything runs: an undeclared target, an obligation a report could not name, an unknown checkpoint, and an expectation after the checkpoint it would prove.

A plugin's schema now joins the obligations when a case names the component. On the FAST-AF plugin's fixture, that is how `command:fixture.press` comes to be required, and verified by a command step followed by an expectation. The T01 snapshots' figures in [step 1](#on-the-consumers) are unchanged: neither consumer has a claim, and their configurations there have no plugin.

Capture 0.7 adds `channels.evidence`: the expectations that held, the claims, and the commands run. Comparison does not read it.

**The budgets moved, and one is getting close.** The proposal counts scenario support as interaction support, loaded only for cases that need it, so element expectations and claim validation are a lazy chunk rather than part of the shell. They first went in the shell, which reached 47,992 of 50,000.

| Category | Ceiling | FAST-AF | Lushly |
| --- | --- | --- | --- |
| Shell | 50,000 | 44,885 | 44,885 |
| Interaction support | 600,000 | 496,750 | 594,147 |
| Accessibility | 650,000 | 586,666 | 586,666 |
| **Total** | **1,300,000** | **1,128,301** | **1,225,698** |

Lushly has 5,853 bytes of interaction support left, because `storybook/test` takes 575,816 of it. Replacing that helper at T08 should free most of it, and until then a larger Storybook release could fail Lushly's build.

## Step 3: rule replacement

`bench.contract()`, `specimen-contract` and `specimen contract [TAG]` report what Fastbot's story contract would, on evidence from a run. Each finding's code is the rule it replaces, so the two can run side by side. The [README](../../../../foundations/specimen/README.md#check-the-story-contract) lists the evidence for each.

This asks only what Fastbot asks, so it is the parity half of [the two questions above](#two-separate-questions), and nothing in it depends on coverage's stronger levels. Every obligation it reports is decided, so none is `unknown`.

### Side by side on FAST-AF

`experiments/check-contract.mjs` runs Fastbot's real rule, from the snapshot's own plugin, and the replacement on a throwaway clone of FAST-AF `24e4eb86`. It runs them first as the clone is, and then with one rule deliberately broken at a time.

| | Fastbot | Replacement |
| --- | --- | --- |
| Components | 77 | 77 |
| Story files | 79 | 79 |
| Stories run | None, it reads source | 407, all passed, in 50 s with two workers |
| Errors, unbroken | 0 | 1, [the finding below](#finding-a-disabled-story-that-disables-nothing) |
| Warnings, unbroken | 0 | 0 |

| Rule | Breakage on the clone | Fastbot reports it | Replacement reports it |
| --- | --- | --- | --- |
| `MISSING_STORY` | Delete `violet-badge`'s story file | Yes | Yes |
| `MISSING_GLOBAL_A11Y_ERROR_POLICY` | Set the preview's policy to `todo` | Yes | Yes |
| `MISSING_AUTODOCS_TAG` | Remove the tag | Yes | Yes |
| `MISSING_PLAY_FUNCTION` | Rename every `play` | Yes | Yes |
| `MISSING_DOCS_DESCRIPTION` | Rename every `description` | Yes | Yes, as a warning |
| `MISSING_STORY_EXPORT` | Leave only a default export | Yes | Yes |
| `MISSING_BASELINE_STORY` | Rename `Overview` | Yes | Yes |
| `MISSING_STATE_STORY` | Remove `violet-button`'s `disabled` | Yes | Yes |
| `MISSING_FORMDATA_ASSERTION` | Read `violet-text-field`'s form without `FormData` | Yes | Yes |
| `MISSING_VALIDITY_ASSERTION` | Use `:valid` in place of `checkValidity()` | Yes | Yes |
| `UNDOCUMENTED_A11Y_EXCEPTION` | Turn axe off on a story | Yes | Yes |

Two notes on reading this. Renaming `play` also made two stories fail, because the replacement refuses the unknown `unplayed` annotation my breakage introduced. And an empty story file makes Fastbot report four codes where the replacement reports one, since the file's other rules have nothing to apply to.

### Finding: a `Disabled` story that disables nothing

**The one disagreement on the unbroken snapshot is a real bug in a FAST-AF story, which Fastbot cannot see.** `violet-calendar`'s `Disabled` story passes `disabled: true`, and its meta's `render` builds an HTML string from a list of args that leaves `disabled` out. So the story renders an enabled calendar: 0 of its 44 inner buttons are disabled. Fastbot accepts it because the export's name contains the word.

This is the owner's to act on. Fixing the story upstream, or waiving it with a reason, is required before the replacement can gate FAST-AF, and it is not fixed here: AFD's evidence is bound to the snapshot, and the story's source is FAST-AF's. Waivers cover coverage today, not this contract, so a waiver would need adding.

The first run flagged three more, and those were limits of my evidence, now fixed:

- `violet-data-grid-pill-select`'s play sets `invalid`, asserts on it and clears it, so a capture at the end cannot see it. A contract run now records attributes set on watched tags.
- `violet-color-picker` and `violet-file-upload` show invalidity through a derived `data-invalid`, which now counts.

### Where evidence replaces text

| Rule | Fastbot passes | The replacement also requires |
| --- | --- | --- |
| `MISSING_STATE_STORY` | A story name containing the word | The element really in that state, at some point in a story of that file |
| `MISSING_FORMDATA_ASSERTION` | `FormData(` anywhere in the file, a comment included | `new FormData(form)` ran, with the component in the form |
| `MISSING_VALIDITY_ASSERTION` | `checkValidity()` anywhere in the file | Its validity was checked as the case ran, directly or through an inner control |
| `MISSING_PLAY_FUNCTION` | `play:` anywhere in the file | A play ran |
| `MISSING_AUTODOCS_TAG` | The word anywhere in the file | The tag in a story's index entry |

Form evidence is observed by wrapping `FormData` and the `checkValidity` and `reportValidity` methods, which still call the real ones. Only coverage and contract runs install these wrappers, from the lazy scenario support chunk, so an ordinary capture runs nothing extra. A play's claim about a form now reaches `verified` when the run saw this, and stays `asserted` when it did not. Capture 0.8 records these in `channels.evidence`.

### Budgets after this step

The form evidence went into the lazy scenario support chunk, so the shell stays under its ceiling. Lushly's interaction support has 4,353 bytes left, as [step 2](#step-2-claims-and-waivers) warned.

| Category | Ceiling | FAST-AF | Lushly |
| --- | --- | --- | --- |
| Shell | 50,000 | 45,329 | 45,329 |
| Interaction support | 600,000 | 498,250 | 595,647 |
| Accessibility | 650,000 | 586,666 | 586,666 |
| **Total** | **1,300,000** | **1,130,245** | **1,227,642** |

### Retirement records

Every rule has its replacement, a passing example, a failing fixture in `compat/contract/` that `src/contract.test.ts` runs in CI, and the side-by-side result above. **No rule is retired by this.** The proposal keeps Fastbot's rules running beside these through parity qualification, so deletion is T08's, and Fastbot lives in FAST-AF's repository.

| Rule | Passing example | Failing fixture | Ready to retire at T08? |
| --- | --- | --- | --- |
| `MISSING_STORY` | `x-good` | `x-no-story` | Yes |
| `MISSING_GLOBAL_A11Y_ERROR_POLICY` | `specimen.config.json` | `specimen.no-policy.config.json` | Yes |
| `MISSING_AUTODOCS_TAG` | `x-good` | `x-no-autodocs` | Only once docs are operational, as the proposal says; `specimen-inspect` exists, and generated docs do not |
| `MISSING_PLAY_FUNCTION` | `x-good` | `x-no-play` | Yes |
| `MISSING_DOCS_DESCRIPTION` | `x-good` | `x-no-docs` | Yes |
| `MISSING_STORY_EXPORT` | `x-good` | `x-no-export` | Yes |
| `MISSING_BASELINE_STORY` | `x-good` | `x-no-baseline` | Yes |
| `MISSING_STATE_STORY` | `x-good`, `x-state-cleared`, `x-state-derived` | `x-no-state` | After the calendar story is fixed or waived |
| `MISSING_FORMDATA_ASSERTION` | `x-form-good` | `x-form-silent`, `x-form-text-only` | Yes |
| `MISSING_VALIDITY_ASSERTION` | `x-form-good` | `x-form-silent`, `x-form-text-only` | Yes |
| `UNDOCUMENTED_A11Y_EXCEPTION` | `x-a11y-documented` | `x-a11y-off` | Yes |

Fastbot's other commands are out of this step's scope: token, FAST-pattern, attribute and form-parity validation read component source, not stories. Its profile rules were replaced in [T06](t06-full-runner.md#step-4-specimen-profile). Lushly has no story contract, and this was not run on it.

## Step 4: `specimen-suggest` and the Fastbot adapter

`bench.suggest()`, `specimen-suggest` and `specimen suggest TAG` propose native specimens and claims for a component's gaps, as the [README](../../../../foundations/specimen/README.md#propose-specimens) describes. It is also the scaffold's replacement: `--out` writes the module beside a new component.

The proposal requires that generation "MUST NOT mark coverage complete". A test holds each part of that:

| Requirement | How it holds |
| --- | --- |
| Proposals are unverified | Every result says `status: 'unverified'`, and running `suggest` changes nothing coverage reports |
| The agent runs and corrects them | Saved and run on the fixture, everything the schema could decide reaches `verified` on its merits. The one thing it could not, a form's submitted value, fails with `REPLACE_WITH_WHAT_THIS_SHOULD_BE` until replaced |
| Complete only after correction | With that value corrected, the same run reports `complete: true`, the only way to get there |
| Meaningful assertions | Each proposal asserts the state it claims, and a state it cannot derive is never written as something that passes vacuously |

### The adapter

`experiments/inputs/fastbot-adapter.py` turns `specimen contract`'s output into what Fastbot's `fastaf_validate_story_contract` returns, so that Fastbot's hooks and callers keep the shape they read. `check-contract.mjs` holds it to the real command: on FAST-AF's snapshot its keys and its `stats` equal Fastbot's, and each of the 11 breakages comes through it.

It is ready for FAST-AF to adopt at T08, and is not installed: Fastbot lives in FAST-AF's repository. A profile adapter is not needed yet. [T06 found](t06-full-runner.md#findings-on-the-consumers) that neither consumer's hooks, CI or scripts call the profile validators, so there is no active gate to adapt.

## What T07 leaves open

Each of T07's requirements is met, on the evidence above. These stay open:

- **Your decision: the calendar story.** [`violet-calendar`'s `Disabled` story](#finding-a-disabled-story-that-disables-nothing) needs fixing upstream, or a waiver the contract does not yet support, before the contract can gate FAST-AF.
- **Consumers have no claims yet.** Coverage on both consumers tops out at `represented`, so nothing is `verified`. Adopting `claim` or native specimens is migration work, and no gate depends on it: the proposal keeps this separate from parity.
- **Coverage and FAST-AF's plugin.** The plugin's schema path is tested on its fixture, not on the real FAST-AF stories, so `VioletButtonAppearance`-style aliases are open-ended in the [figures above](#on-the-consumers).
- **Fastbot's source-reading rules.** Its token, FAST-pattern, attribute and form-parity commands read component source and are out of this task's scope.
- **Installing the adapter and retiring rules,** which are T08's, in FAST-AF's repository.
- **Lushly's budget.** [4,353 bytes of interaction support remain](#budgets-after-this-step), until T08's native helper entry.

## Remaining steps

None.

1. ~~`specimen-coverage` from observed evidence.~~ Merged in #692.
2. ~~Claims and waivers.~~ Merged in #695.
3. ~~Rule replacement.~~ Merged in #696.
4. ~~`specimen-suggest` and the adapter.~~ Merged in #697.
