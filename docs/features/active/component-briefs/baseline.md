# Component Briefs: baseline and experiment rules (step 0.1)

The record for step 0.1 of the [proposal](./component-briefs.proposal.md):
what an agent reads today, the targets set from it, and the rules of the
phase 0 experiment, fixed before any run.

## Status

- **State:** measured 2026-11-09 on `main` at `cfb70942`.
- **Verified:** every number in [Numbers](#numbers) is the output of
  [`baseline.mjs`](./baseline.mjs) on that commit. The script passes the
  repository's Biome, portability and file-size checks.
- **Not verified when written:** nothing had run against these rules. The
  budgets and the size target assumed about 475 bytes of rules and guidance
  per component, which step 0.2 then tested against guidance as actually
  written.
- **Since:** the 75 runs finished the same day; [`prototype.md`](./prototype.md)
  is their record. It resets two things set here: the size target and the
  default budget.
- **Held back until then:** the three tasks and the checks' procedures.
  They are now in [`prototype/tasks-and-acceptance.md`](./prototype/tasks-and-acceptance.md)
  ([why they were held](#what-is-held-back)).

## Numbers

Run `node docs/features/active/component-briefs/baseline.mjs` (add
`--json` for the same numbers as JSON). Bytes are UTF-8 bytes of compact
JSON, or a file's size where a file is named.

| The whole library, 77 elements | Bytes | Median per element | Largest |
| --- | --- | --- | --- |
| `custom-elements.json`, the file | 1 219 709 | | |
| The declarations | 422 127 | 3 700 | 53 762 |
| Public API with its prose | 97 293 | 1 044 | 5 889 |
| Brief floor | 33 181 | 390 | 1 102 |

| Page | Components | Declarations | Public API | Brief floor | Source and stories |
| --- | --- | --- | --- | --- | --- |
| Loam `chrome` | 22 | 99 146 | 26 330 | 9 379 | 364 180 in 64 files |
| Loam `console` | 8 | 48 848 | 13 433 | 4 478 | 151 798 in 17 files |
| Loam, every package and app | 24 | 101 293 | 27 246 | 9 826 | 413 233 in 71 files |
| Twenty-component page | 20 | 103 351 | 26 672 | 8 879 | 370 617 in 40 files |

How each is counted:

- **Declarations.** A component's whole entry in the manifest, private
  members included. One read of the 1.2 MB file, or one extraction each.
- **Public API.** Description, attributes (name, type, default,
  description), events, slots, CSS properties, and public fields (name and
  type). This is what `specimen-inspect` answers from, one call and one
  browser render per component.
- **Brief floor.** The least a brief could say from the manifest alone: a
  summary of at most 160 characters, each attribute's name, type and
  default, and slot and event names. No rule, no guidance, no evidence
  level.
- **Source and stories.** Every `.ts` file beside the component except its
  tests.
- **A page's components.** Every tag in the manifest that the page's
  sources name as a whole name (`violet-option-group` is not also
  `violet-option`; `--violet-dialog-width` is no tag), in `.ts`, `.html`
  and `.css` files that are not tests. The twenty-component page is a fixed
  list in the script: ten form, five overlay and five layout components.

## What the numbers say

- **The earlier count was low.** Loam was counted at 14 tags, from markup
  alone. By name it is 24. In `chrome`, 12 are written as markup, 2 are
  only created in code (`violet-menu-item`, `violet-tree-item`), and 8 are
  only named.
- **A name is an upper bound.** Of those 8, some are real (a table that
  loads `violet-badge` on demand) and some are not: two comments say the
  code uses plain text "not `violet-progress`" and a hand-written tab list
  "not `violet-tabs`". A brief built from names would include both. That
  costs budget and misleads no one, as the proposal says, and it is now
  measured: at most 8 of 22 entries on this page.
- **A fifth of the declarations is a workable target.** It sits between the
  floor (9.5 % of the declarations for `chrome`) and the public API
  (26.6 %).

## Targets and budgets

| What | Value | From |
| --- | --- | --- |
| Size target (exit criterion 2) | A brief is at most a fifth of the same components' declarations: 19 829 bytes for `chrome`'s 22, 9 770 for `console`'s 8, 20 670 for the twenty | Confirmed. Each is below the public API and above the floor |
| Room for rules and guidance | About 475 bytes per component at the target | The target less the floor, for `chrome` |
| Default output budget | 24 000 bytes | Holds the largest page at its target (20 670) with room for the envelope |
| Maximum output budget | 96 000 bytes | Holds the whole library: a floor of 33 181 and 475 bytes each for 77 is about 70 000 |

## The experiment's rules

Fixed here, before any run. The proposal's phase 0 has the reasoning.

**Runs.** Three tasks, five arms, five runs each: 75 sessions. Every run
uses Claude Code with Sonnet 5.5 at medium effort (the repository's
[routing](../../../operations/model-routing.md) for specified everyday
coding), the same task text, and a fresh worktree at `cfb70942`, with no
Umbel. Every agent can read the repository as it can today.

| Arm | Added to the task |
| --- | --- |
| a | Nothing |
| b | The path of the whole pack as one file, and the instruction to read it first |
| c | The brief script, and the instruction to call it once for the page before writing |
| d | The check script, and the instruction to run it on the page after writing |
| e | Both scripts and both instructions |

**Acceptance.** Five checks per run, each pass or fail, so a run scores 0
to 5 and an arm 0 to 75:

1. Complete: the mounted page has every part the task asked for, found by
   accessible role and name.
2. Mounts in Specimen with no console error.
3. The settled accessibility check (axe) passes.
4. Every tag, attribute and value on the page exists in the manifest.
5. A fresh reviewer, given only the page and `attribute-taxonomy.jsonc`,
   finds no use the taxonomy's `doNotUseFor` rules out. The reviewer is not
   told the arm.

The first check was added while writing this record: without it an empty
page passes the other four. The counts behind checks 4 and 5 are recorded
too; only pass or fail scores.

**Thresholds.**

| Word | Meaning |
| --- | --- |
| Better | An arm's score is at least 8 higher, of 75 |
| As good | The scores are within 7 |
| Cheaper | The median of a run's total tokens (input and output, the whole session) is at least 20 % lower, and the median of its tool calls is not higher |
| Costlier | The median of total tokens is at least 20 % higher |
| Beats | Better and not costlier, or as good and cheaper |

The decision rules that use "beats" are in the proposal (phase 0, "The
rules"), and the first that matches decides.

## What is held back

The tasks' text and each check's procedure (the parts each task requires,
the list of attributes every element may carry) are kept in a folder this
checkout ignores, and no run's worktree contains them. An agent in any arm,
or the agent that writes the prototype's guidance, could otherwise read
what is counted and write to it. The last run has finished, and they are
now in [`prototype/`](./prototype/tasks-and-acceptance.md) with the pack and
the scripts. The raw sessions and pages are kept by the author outside the
repository.
