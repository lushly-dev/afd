# Controls: status

Epic: [#1385](https://github.com/lushly-dev/afd/issues/1385). File new work for this area as a
sub-issue of the epic.

Read this before the [proposal](controls.proposal.md). It records exactly what is done and what
is not, so an agent never has to scan the code to learn what is current.

## How to keep this file

- "Done" means merged to `main` with evidence linked. Anything else is "in progress" or "open",
  with what remains spelled out.
- Record how you verified it, the command or check, and the absolute date.
- Write down follow-ups that are not yet issues, with the date and who raised them. Link the
  issue when one exists.
- Never delete history. Mark an entry superseded and point to what replaced it.
- Edit only your step's own line under [Steps](#steps); never add a running summary line of
  which steps are done or next.

## Status block

- **State:** active. Approved by the owner on 2026-11-24 ("Agree with all six recommendations,
  proceed with phase A") and promoted from `proposed/` to `active/`.
- **Approved scope:** 18 jobs, 14 scenario files, 4 commands and 4 error codes, in the
  [proposal](controls.proposal.md) and [`packages/view-state/scenarios/controls/`](../../../../packages/view-state/scenarios/controls/), with the six decisions of
  the proposal's section 10.
- **Phase A's contract** is [spec.md](spec.md).
- **Phase A is built:** the registry and the four commands, in `@lushly-dev/afd-view-state`.
  The binder and everything after it are not.

## Steps

- **Jobs, drafted commands and scenarios.** Done 2026-11-24, merged in #2480.

- **Walks by a reader who did not write them.** Done 2026-11-24, merged in #2480: three walks
  by one reader, recorded in the proposal's section 6.

- **The owner cuts, adds and ranks the jobs.** Done 2026-11-24: agreed with all six
  recommendations of the proposal's section 10; none cut or added. Recorded in #2493.

- **Phase A's specification** ([#2487](https://github.com/lushly-dev/afd/issues/2487)). Done
  2026-11-24, merged in #2493: [spec.md](spec.md).

- **Phase A, the registry and the four commands**
  ([#2487](https://github.com/lushly-dev/afd/issues/2487)). Done 2026-11-24, merged in #2529:
  `ControlRegistry` and `createControlCommands` in `@lushly-dev/afd-view-state/controls` and
  `/controls/commands`, with the fourteen scenarios moved beside the code and passing in the
  package's tests through a `controls` fixture adapter.

- **Phase B, the binder** ([#2488](https://github.com/lushly-dev/afd/issues/2488)). Not
  started; waits on phase A.

- **Phase C, the state contract in Specimen and the library**
  ([#2489](https://github.com/lushly-dev/afd/issues/2489)). Not started; waits on phase B.

- **Phase D, in an application, with the measure**
  ([#2490](https://github.com/lushly-dev/afd/issues/2490)). Not started; waits on B and C.

## What is not done

- **The commands exist with no binder.** `control-list`, `control-set`, `control-restore` and
  `control-choices` are built in `@lushly-dev/afd-view-state/controls/commands`, over handlers
  an application writes itself. Nothing makes a handler from an element yet; that is phase B.
- **Nothing in the design direction is verified.** In particular, that dispatching a control's
  change event after a write is enough for a framework that controls its inputs.
- **The survey of `violet-elements`' components was sampled, not repeated.** The proposal's
  section 2 marks which lines were read first-hand.
- **No model has used the commands,** so nothing shows they serve a real form.
- **The fixtures can be applied only in the package's tests.** The `controls` fixture adapter
  is in `packages/view-state/src/controls/scenarios.test.ts`, so the CLI's `scenario run` has
  no adapter for them.
- **What the walks left for the specification** is listed in the proposal's sections 6 and 9,
  and what phase A's specification settled of it in its section 9.

## How it was checked

### The proposal, 2026-11-24, on a branch from `main` at `8347a597`

- **Claims about the repository** in the proposal's section 2 that carry no mark were read
  first-hand from the files they cite. The lines marked *surveyed* were read by three reader
  agents the same day, each citing its lines; a sample was checked first-hand.
- **The scenario checks,** as [jobs first](../../../../.claude/skills/afd/references/jobs-first.md)
  describes, after `pnpm -F "@lushly-dev/afd-cli..." build`, on the scenarios as merged:
  - `node packages/cli/dist/bin.js scenario validate` on the scenarios folder: "All 14
    scenario(s) are valid!"
  - the dry run with `checkFixtures`: no error in 14 files and 65 steps;
  - coverage: commands 4 of 4 tested, errors 4 of 4 tested, `not drafted: []`.
- **The walks:** one fresh reader on Claude Opus 5.5 at `high`, given the owner's words before
  the proposal, then the proposal, the scenario files and the host's own files. It walked
  three times, and the proposal's section 6 says what each walk found, what was taken and what
  was declined. The third walk found every `rev` in the fourteen files to be the control's own
  at its step and every job's sentence the same in the table and its file; its five findings
  were rules to state, which added no job and no command, so no fourth walk followed.
- **Links:** a throwaway script resolved every relative link and anchor in the proposal and
  this file, and found none broken.
- **Independent review:** two fresh read-only reviewers on one brief, Claude Opus 5.5 at
  `high` and Gemini 4 Neon at `high`, given both exchanges with the owner. Both said revise,
  with nine blockers between them, all fixed:
  - two places gave the owner the session's own choices: commands of its own under "Decided",
    and "no presses" as following from his decision;
  - the rule for secrets was stated three ways;
  - #2275 was named as this proposal's issue while its scope excluded the work, so the
    proposal was posted there as its approach;
  - job 5 was outside the first slice though a first-slice scenario names its command, and no
    phase's exit ran its scenario;
  - the error table had no row for `control-choices` on a control with no choices;
  - "never named in a refusal" contradicted a scenario that echoes the id sent;
  - the proposal said a secret never reaches the journal, which holds only while failures are
    not recorded;
  - the surveyed table called `violet-select` and others broken that follow the rules.

  Both found every unmarked claim about the repository to hold. *Improvements taken:* the
  session's reading of the owner's reply marked as the session's; the reply quoted to its
  last character; "No AFD package acts on `undoCommand`"; what the guard proves; exits for
  every scenario, the notice's actor and the view-state binder; a write put back that a
  listener has already heard; a restore's notice. *Declined:* renaming `control-choices`,
  which section 9 leaves to the specification. A focused pass by the first reviewer approved
  the fixes, and a second focused pass approved three corrections of wording it noted.

### The approval and phase A's specification, 2026-11-24, on a branch from `main` at `bd374912`

- **The owner's approval** is quoted whole in the proposal's section 10.
- **The specification against the scenarios:** each message, suggestion and reason a scenario
  asserts was read against the words the specification gives for it, and the order of checks
  against each step that depends on it (a secret before a `rev`, a state before a `rev`, a
  `rev` before a value).
- **The scenario checks** were run again after the move to `active/`: 14 of 14 valid, 65
  steps, commands 4 of 4, errors 4 of 4.
- **Links:** the same script, over the proposal, the specification, this file and the two
  Agent-First Design files that link here, found none broken.
- **Independent review:** two fresh read-only reviewers on one brief, Claude Opus 5.5 at
  `high` and Gemini 4 Neon at `high`, given the six recommendations the owner was shown and
  his reply. Both said revise: eight blockers from the first and seven from the second, three
  of the second's overlapping the first's, all fixed.
  - **In the specification:** `fix-input` recoveries with nothing to fix, which every reader
    drops; a secret, and a control changed before the call, appearing in `affected`; the
    `stop` the proposal gives `control-choices` when its caller cannot set; the registry's
    notice built a phase early; an id sent twice checked before a secret; "no new dependency"
    against a type and a test the package cannot reach; a restore's order of checks; values
    left undefined (an empty string against a format, the four formats, a number with one
    bound, a list of choices); a handler that throws on `read`, and on writing back; and an
    exit list that left `maxLength`, `offset`, the budget and duplicate ids untested.
  - **In the proposal:** section 10 marked as decided some wording longer than the owner was
    shown. It now quotes what he was shown and calls the rest this document's.

  Both traced all 65 steps of the fourteen scenarios against the specification's words and
  found each to hold, before and after the rewrite. A focused pass by the first reviewer
  found the fifteen fixed and one new blocker, a rule for a group on an empty screen that
  section 9 did not name; a second focused pass approved that fix, a write-back when a
  `read` throws, and deciding again which entries are unchanged.

### Phase A's build, 2026-11-24, on a branch from `main` at `4e29e82b`

- **The package's tests:** `pnpm -F @lushly-dev/afd-view-state test` passes 10 files and 282
  tests. The fourteen scenarios are among them, run through the commands on a direct registry
  with a fixture adapter written in the test.
- **The exit list:** each line of the specification's section 10 has a test.
  `integrity.test.ts` holds the ones the review added.
- **Red before green:** sixteen of the first nineteen tests the review added were run against
  the build as first written and failed there, as the reviewer found too; the other three
  assert what it already did. Of the four tests added for the focused pass's blocker, the two
  that show the refusal failed against the code before that fix; the other two hold behaviour
  it kept.
- **The gates:** `pnpm verify` on the `.nvmrc` Node passes all 62 steps it plans for this
  change, at `f645e5d3`: the TypeScript check over 22 packages; Loam's unit, browser (Chromium,
  Firefox and WebKit), walk, mounted and hosted suites; the hosted fixtures; alfred; the two
  Loam plugins; the desktop's cargo checks; and the todo example's conformance and interop
  suites. What it leaves to CI is what it lists as remote only.
- **Independent review:** two fresh read-only reviewers on one brief, Claude Opus 5.5 at
  `high` and Gemini 4 Neon at `high`. Each ran the built package to prove what it found. Both
  said revise: three blockers from the first and five from the second, two of them shared, all
  fixed.
  - A list in a result, a choice from `control-choices`, or a list given to a handler, was
    the registry's own. A caller that changed `previous` chose what a restore wrote, and one
    that changed `value` hid a person's next change.
  - One counter issued a `rev` to every control, a secret among them, so the gap between two
    revs told how often a secret changed. A secret now has none.
  - A call that wrote and was written back left the registry holding what it read in the
    middle. The same revs were then refused, an earlier fill could not be restored, and a
    restore that failed could not be sent again.
  - An entry checked again was checked as already resolved, not as sent, so a label could
    pick the wrong one of the choices an earlier write brought.
  - A control a write of the same call made a secret came back with its value and `rev`.
  - A control a write of the same call unregistered, or registered again, was reported with
    what it held before.

  *Improvements taken:* a `read` that returns what is not a state is `INTERNAL_ERROR`; a write
  that changed its control and then threw is put back; a choice control with no choices says
  so; a handler is told to put no value in an error; `ControlScreen` is named in the
  specification; the budget test now shows a page holds all that fits; the budget's encoder
  is made once; a test's comment is back on its constant; and the `control-choices` refusal
  for an unknown id checks its recovery as the other refusals do. No improvement was left
  out. The specification gained a rule for each of the first five.
- **The focused pass** by the first reviewer found the eight fixed and one more, older than
  the fixes and allowed by the specification as it stood: an entry whose value an earlier
  entry of the same call had changed was written with no check of its `rev`, so it could
  replace what a person typed without the caller having read it. It is now refused as
  changed, with a rule in the specification's 5.3 and four tests.
- **A second focused pass** found that fixed and one more of the same kind, in the undo: a
  restore replayed a fill in the order it was written, and where the fill's second write had
  moved its first control, it wrote over what the person had typed there. A restore now takes
  each entry at its turn and puts a control back only if it still holds what the fill gave
  it, and `undoArgs` run backwards. Four expectations in the restore's tests changed with the
  order, and of its three new tests the two that show the fix failed against the code before
  it.
- **A third focused pass** found that fixed and a fault the fix itself brought: with nothing
  forgotten when a value changed, a person who changed a value and changed it back was undone.
  A fill is now forgotten when a command's first look at a control finds something other than
  what the last writing call left, and kept through what a writing call does itself. Of the
  two tests added, the one that shows the fix failed against the code before it, and the
  other holds an undo finished in a second call, which forgetting too readily would break.
- **A fourth focused pass approved,** having tried each fix against a fresh build and found
  no further fault. It asked for one more test, of two fills undone in turn, which was added
  and seen to fail with the line it guards removed.
- **A pass on the last improvements,** once the pull request was open, approved them and found
  the first one half done: a `read` that returned an object of the wrong shape was still taken
  as a state, and a `secret` flag set to something other than true was read as false, so the
  value was listed. The registry now checks each field's type, with a rule in the
  specification's section 3. Eleven of the twelve tests added for it failed against the code
  before it; the twelfth holds that a well-formed state is still read. It also asked for a
  test of a choice control with no choices, which was added and seen to fail with its line
  removed.
- **A pass on that check** found the code right and the specification's new words ahead of
  it: a read of no object has its own message, and a flag left `undefined` is absent, as a
  false one is. It also found a list with a gap taken as a list of text. The words now say
  what the code does, a gap is refused, and the two tests for it failed with `every` alone.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-24 | The survey for this proposal | `violet-elements`' `attribute-taxonomy.jsonc` lists `violet-date-range-picker` under `name.usedBy`, and the component has no `name` attribute. Checked first-hand | Open |
| 2026-11-24 | This proposal | Whether a journal should skip `control-*` commands, whose input is a person's draft, as two recorders skip `auth-*` | Open; the proposal's section 9 |
| 2026-11-24 | This proposal | The measure in the proposal's section 7: one form filled by a model through these commands, through a workaround and through UI SDK's public benchmark task | Filed as part of [#2490](https://github.com/lushly-dev/afd/issues/2490) |
| 2026-11-24 | Phase A's review | A read of `NaN` or an infinity, as a value or a limit, is taken as a number and listed as `null`, which the output schema does not allow. Decide it with phase B's binder, which reads an empty number input | Open; for [#2488](https://github.com/lushly-dev/afd/issues/2488) |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-24 | The proposal | After the comparison with UI SDK, the owner said AFD should have a designed path for an agent to change the controls on a screen, in place of a command that sets values and code in the interface that applies them. Three surveys read how view state is used, how `violet-elements`' components hold state and how Specimen checks a component. The jobs were written as scenarios, and a reader walked them three times. The walks replaced an optional guard with a `rev` on each control, made the undo a command of its own that carries no values, and added three jobs. Nothing was built |
| 2026-11-24 | The approval and phase A's specification | The owner agreed with all six recommendations and said to proceed with phase A. The proposal moved to `active/`. Its phases were filed as #2487 to #2490 under the epic, the later three deferred on the one before, and #2275 was closed as replaced. Phase A's specification pins each command's input, result, checks in order and the words of every refusal, and settles what the proposal left to it: one screen for a registry, a fifth code for a handler that throws, and the five reasons a restore skips. Nothing was built |
| 2026-11-24 | Phase A | Built `ControlRegistry` and the four `control-*` commands to the specification, in two new entries of `@lushly-dev/afd-view-state`, with no DOM. The scenarios moved to `packages/view-state/scenarios/controls/`, and all fourteen pass in the package's tests through a fixture adapter written there; unit tests cover each line of the specification's exit list. The binder is still phase B's |
