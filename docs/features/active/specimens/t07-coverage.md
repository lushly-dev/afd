# T07 coverage and rule replacement

**State, 2026-11-02:** in progress. Step 1, `specimen-coverage`, is done and merged in [#692](https://github.com/lushly-dev/afd/pull/692). Step 2, claims and waivers, is implemented on branch `lush/specimens-t07-claims`. The remaining steps are listed [below](#remaining-steps).

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
| "Form participation MUST use actual FormData/validity evidence" | A `form` expectation builds real `FormData` from the target's form; a `validity` one calls its `checkValidity()`. A play's claim alone stays `asserted` until step 3 |
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

## Remaining steps

1. ~~`specimen-coverage` from observed evidence.~~ Merged in #692.
2. ~~Claims and waivers.~~ Implemented on branch.
3. **Rule replacement.** Each rule above gets a replacement with equivalent executable evidence, a passing and a failing fixture, and a retirement record, run beside Fastbot on the FAST-AF snapshot. FormData and validity become runtime evidence rather than text.
4. **`specimen-suggest` and the scaffold.** Proposed specimens and claims stay unverified until run. The scaffold emits supported specimens with meaningful assertions.
