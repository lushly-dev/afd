# Screens from Jobs: the screen in a job's state as the unit that is seen and checked

## Status

- **State:** draft. First written as a scaffold on 2026-11-13. It was filled in the same day
  against `main` at `f7ecbd43`, with a design, drafted commands and jobs as scenario files.
- **Walked, reviewed and revised.** One fresh reader walked it the same day, taking all three
  seats ([section 4](#4-what-the-walk-and-the-review-changed)). An independent review of the
  three drafts followed. It was revised after each.
- **Shared with Design Decisions.** It now uses that proposal's capture sets, review and answers
  for baselines, under conventions the coordinator set across the proposals. These are for the
  owner to confirm ([section 12](#12-for-the-owner)).
- **Not approved.** [STATUS.md](STATUS.md) tracks progress.
- **Verified:** the claims in [What exists today](#2-what-exists-today) were read first-hand at
  `f7ecbd43` on 2026-11-13, except the Python claim, which was read at `e5d683a8`. The walk's
  and the review's citations were checked first-hand as well. The three scenario checks pass;
  their output is in [STATUS.md](STATUS.md#how-the-jobs-were-checked).
- **Next:** the owner confirms the shared conventions, cuts, adds and ranks the jobs, and answers
  [For the owner](#12-for-the-owner).

| Field | Value |
| --- | --- |
| Epic | [#1109](https://github.com/lushly-dev/afd/issues/1109) |
| Units likely touched | `foundations/specimen`, `integrations/specimen-afd`, `endpoints/specimen-cli`, a new integration for the `afd` runner, `packages/testing` (a browser-safe entry and two awaited hooks), `endpoints/loam` (the first consumer) |
| Related | [Design Decisions](../design-decisions/design-decisions.proposal.md) (capture sets, review, answers and the MCP host this builds on), [Specimens status](../../active/specimens/STATUS.md) (T11), [Patterns](../patterns/patterns.proposal.md), [Pointing](../pointing/pointing.proposal.md) |
| Rank among the four | Second. Reviewing at the level of a screen needs screens in real states |

## 1. Problem

A story shows one component, alone, in one state. A job passes through states, and each state
has a screen. In the Component Briefs prototype the faults that dominated appeared only in
composition, while every isolated story passed. Judgements such as "the shell recedes" are
about a screen, not a component.

1. **Each screen state is built twice.** Loam's screen specimens build their states by hand,
   some with stub clients. Its browser tests build the same states for real by calling
   commands. The two can drift.
2. **Nothing links a screen to a job step.** No record says "this screen is step 3 of that job".
3. **Component coverage does not come from jobs.** Specimen counts a component wherever a
   specimen renders it. AFD's scenario coverage counts commands, errors and jobs. Neither says
   which job states render which components, so a component state no job reaches is never
   questioned.

**Goal:** a job's scenario file is the one definition of the states it passes through.

- Specimen runs it once in a browser and saves a capture at each step a person marks, as a
  [Design Decisions](../design-decisions/design-decisions.proposal.md) capture set that every
  check reads.
- A change to the app is shown through that proposal's review: what changed at each step, before
  and after, for a person to answer.
- The same file still runs headless where there is no browser.

## 2. What exists today

### AFD scenario files

- **Format.** The types are in `packages/testing/src/types/scenario.ts`. The parser
  (`src/parsers/yaml.ts`, lines 46 to 59) rejects any key not in its lists.
  - A step has `command`, `input`, `description`, `expect` and `continueOnFailure`.
  - `expect` asserts `success`, `data`, `error`, `reasoning` and `confidence`.
  - `verify`, `isolation` and `dependsOn` are declared in the types but refused as unsupported
    (`scenario.ts`, lines 256 to 262).
  - A step has no id. Its `description` is optional free text.
- **Running.** `runScenario` (`runner/scenario-runner.ts:334`) is shared by `InProcessExecutor`,
  which calls a command handler in process, and `ScenarioExecutor`, which goes through the CLI.
  - Steps are numbered from 1 (`stepId`, line 366).
  - A step marked `continueOnFailure` lets later steps run after it fails (line 403).
  - A step can read an earlier step's output with `${{ steps[N].path }}`, in `input` only. The
    runner resolves references there and nowhere else (line 308).
  - `RunConfig` takes an `AbortSignal`.
  - The package exports `parseScenarioFile`, `evaluateResult` and `applyFixture`. It does not
    export `resolveStepReferences`.
- **Lists in expectations.** A list under `expect.data` is compared by deep equality: same
  length, same keys (`runner/evaluator.ts:432`). A dotted path such as `steps.1.status` reaches
  one element.
- **Hooks.** `onStepComplete(step, result)` is declared at line 43 and called at line 411.
  - It returns `void`, and the runner does not await it.
  - It is called for skipped steps too.
- **Coverage** (`commands/coverage.ts`) counts commands, errors and jobs.
- **MCP.** The package's own server offers `scenario-list`, `scenario-evaluate`,
  `scenario-coverage`, `scenario-create` and `scenario-suggest`. `scenario-evaluate` fails with
  `HANDLER_NOT_CONFIGURED` unless the server was given the application's command handler
  (`src/mcp/tools.ts:178`).
- **Python.** `afd.testing` reads the same files (`python/tests/test_scenario_*.py`), so a change
  to the format is a parity change.

### Specimen

- **Native scenarios** (`foundations/specimen/src/types.ts`, lines 44 to 63) already have four
  kinds of step:
  - `action`: `click`, `focus`, `hover`, `fill`;
  - `command`: `{runner, name, target, input}`, through a named plugin runner;
  - `expect`;
  - `capture`, a named checkpoint.
- **A command runner** is `{ commands?(element), run(element, name, input) }`
  (`src/plugin.ts:66-69`). Registered runners are a map by id (`src/browser/plugins.ts:6`). Only
  the FAST-AF runner and the fixture runner exist.
- **Every operation is one request in a fresh context.**
  - The worker dispatches render, run, a11y, themes, coverage and the rest, one request each
    (`src/bench-worker.ts:47-59`).
  - A render captures at a single checkpoint (`src/bench-runtime.ts:236-250`).
  - `specimen-a11y` captures again for each checkpoint it checks (`accessibilityReport`, lines
    491 to 505).
  - There is no live page that a caller can step through, and no capture is kept between
    requests.
- **Random values are seeded and the clock is real.** `Math.random` starts from a fixed seed
  (`src/browser/index.ts:100-125`). The capture's environment records `clock: 'real'`
  (`src/types.ts:633`).
- **Configuration entries** allow six keys: `id`, `title`, `module`, `exportName`, `component`
  and `themes` (`src/validate.ts:445-452`). `specimen-list` passes each entry through with
  `{...entry}` (`src/bench.ts:300`) into a strict output schema. An unknown key would fail the
  whole list.
- **Coverage waivers** exist, with a reason per component and obligation
  (`src/schema.ts:582-589`).
- **`specimen-render`'s input** requires `id`, and its `screenshot` is a path to write to
  (`src/schema.ts:33-39`).
- **`.specimen/` is not ignored by git.** The root `.gitignore` has no entry for it.
- **T11, the application-command runner,** is "Not started, optional"
  ([status](../../active/specimens/STATUS.md), line 23).
  - The plan asks it to "prove explicit application-command/view-state dispatch, structured
    results and cancellation" and to settle where it is distributed "without conflating the
    existing `specimen-afd` command bindings with this runner"
    (`docs/features/active/specimens/implementation.md:85`).
  - The Specimens proposal makes `fast-af` and `afd` distinct runner ids
    (`docs/features/proposed/specimens/specimens.proposal.md:93`).
  - It reuses `afd-testing` "through a new browser-step adapter" (line 58), and the runner
    "lands only with a consuming scenario" (line 396).
- **Layering.** Specimen is a foundation, so it depends on nothing in AFD (`architecture.json`).
  Reading AFD scenario files therefore belongs in an integration.
- **`integrations/specimen-afd`** binds Specimen's 19 commands (`src/commands.ts`). None runs
  application commands.
  - `specimen-validate` returns `issues` with a `severity`, a `code`, a `message` and a
    `suggestion`.
  - `specimen-a11y` returns one report per entry and checkpoint, with `status` `passed`,
    `warning`, `failed` or `not-run` (`foundations/specimen/src/schema.ts:330-358`).
- **Hosts.** Nothing serves Specimen over MCP in this repository: `.mcp.json` lists only `umbel`.
  - `endpoints/specimen-cli` dispatches each command by hand and prints the whole result, with
    no budget (`src/cli.ts:549`).
  - A render returns every observed element's styles.
- **Coverage** (`src/coverage.ts:184-192`) collects every observed element with a given tag, in
  every case and checkpoint. So a component counts wherever it renders.

### Loam

- **123 screen specimens:** 115 in `endpoints/loam/packages/chrome/specimens/specimen.config.json`
  and 8 in `endpoints/loam/apps/notes/specimens/specimen.config.json`. Their states are built in
  three ways:
  - Commands on a real test kernel. `shellFixture` (`packages/chrome/specimens/support.ts:61-90`)
    runs each call through `kernel.call`, or `kernel.agent.call` for an agent's call, and then
    mounts the real shell.
  - Properties set directly.
  - Stub clients. The notes editor's `contextOver()` answers `notes-content-get`
    (`apps/notes/specimens/notes.specimens.ts:58-74`).
- **No scenario files.** Loam's job tests are Vitest: `apps/*/test/app.test.ts` and the Chromium
  suites under `packages/web/test/browser/`.
- **One state built twice:** "This note changed elsewhere".
  - **The specimen fakes it.** It uses a stub, types a draft and calls `documentChanged` by hand
    (`notes.specimens.ts:76-115`).
  - **The browser test reaches it for real** (`packages/web/test/browser/documents/editor.test.ts:2496-2542`).
    It creates a note, opens it in two groups, types a draft in the second, and calls
    `notes-content-set` as the agent.
  - The state needs a person's typing as well as commands.
- **The kernel answers commands directly.** `call(name, input)` returns a `CommandResult`
  (`packages/kernel/src/types.ts:551-555`). The testing package exports `createTestKernel` and
  `createAppTestKernel`.

## 3. Jobs

Each job is a scenario file in [`scenarios/`](scenarios/), written against the commands drafted
in [section 6](#6-drafted-commands).

- **The data is invented.** It centres on a job specimen, `example-keep-a-draft`, in an example
  notes app, with a four-step scenario.
- **Steps are numbered from 1,** as the scenario runner numbers them. A capture is keyed
  `<job>/<step>`.
- **Lists are asserted by dotted index paths,** because a list under `data` must match exactly.
- **Step references appear only in `input`.**
- **The `slice` tags are tentative** until the owner ranks the jobs.

Jobs 4, 5, 7 and 10 use Design Decisions' `specimen-review` and `decision-record`, and job 7
also uses its `specimen-capture`. They are this proposal's jobs, served by that proposal's
commands.

| # | Job | Sentence | Slice |
| --- | --- | --- | --- |
| 1 | `see-a-jobs-states` | When a job's scenario runs, I want the screen captured once at each step I mark, kept, and listed in step order, with steps I did not mark left alone and a marked step that changed nothing said, so that the job's states can be seen and checked without building them by hand | yes |
| 2 | `build-a-state-once` | When a screen specimen and a job test need the same commands to reach a state, I want one scenario that both run, the job entry written from it, and a capture point that no longer matches it refused, so that the commands cannot drift apart | yes |
| 3 | `check-a-state-where-it-occurs` | When a capture at a job step fails a check, I want the failure reported against that job step, on the screen that was captured, so that I know which job is affected | yes |
| 4 | `see-what-changed-since-accepted` | When I change the app, I want each job step's screen compared with the one on main, before and after, so that I see what my change did to every state a job passes through | yes |
| 5 | `accept-a-steps-screen` | When a step's screen changed as I meant it to, I want to accept it with a reason, and a screen that was never captured offered for nothing, so that the next review starts from what I agreed | yes |
| 6 | `pin-the-clock` | When a job's screens show times or generated values, I want the clock and random values fixed for every run, so that a difference between two runs is the app's and not the clock's | yes |
| 7 | `sort-a-bulk-change` | When one change alters many screens across jobs, I want the differences grouped by cause, and a group accepted at once without accepting anything else a screen in it changed, so that I judge each kind of change once and a mistake stands apart | no |
| 8 | `refuse-a-capture-from-the-wrong-state` | When a step fails, or any step before it failed, I want no capture taken or checked as if the state were sound, and the reason given, so that a broken state is never reviewed as a screen | yes |
| 9 | `run-without-a-browser` | When no browser is available, I want the job's scenario to run as it does today and only the captures refused, so that capture is something added, never required | no |
| 10 | `stay-quiet-about-what-was-accepted` | When a job step's screen is the same as on main, or a change to it was already answered, I want it left out of what I am shown and only counted, so that my attention goes only to what changed | no |
| 11 | `find-what-no-job-reaches` | When I ask which job states render a component, I want the list, the component states no job reaches, and the ones I already answered left answered, so that each gap is questioned once | no |

- **Refusals:** jobs 2, 5, 8 and 9 carry them.
- **Staying quiet:** job 10, and the unmarked steps in job 1.
- **Why jobs 8 and 9 stand alone.** Their situations differ from job 1's: a broken app and a
  machine with no browser. Each ends in a refusal that job 1 never reaches.
- **Why the coverage job is outside the slice.** It answers a question across many jobs, so it
  pays only once several job specimens exist. The slice proves one job end to end first. It is
  the owner's original bullet, so the owner may move it up.

**What writing them changed:**

- **Capture points name a step by its description, not its number.** With numbers, inserting a
  step moved every later capture silently onto the wrong state. Writing job 2 added the refusal
  `CAPTURE_STEP_UNKNOWN`, and `STEP_HAS_NO_DESCRIPTION` for a step that has nothing to name.
- **Person actions joined the design,** with a stated limit ([5.2](#52-a-job-specimen)). The
  notes conflict needs a person's typing, and a scenario step can only be a command.
- **No check command was drafted.** Each capture is an ordinary checkpoint in a set, which the
  existing checks read.

**What a scenario could not express:**

- Job 9 needs a machine with no browser. The file says so in a comment.
- **Who acted.** Every scenario step runs as `actor: { kind: 'test' }`. So job 1 cannot show that
  the typing is a person's and the save is an agent's; the capture shows it through `actions`.
  Jobs 5 and 7 cannot show the person's confirmation that `decision-record` asks for.
- **Which checkout.** Jobs 4 and 5 run one job on a checkout of `main` and once on the branch.
  The files say so in comments.
- **Which server.** `scenario-evaluate` in jobs 2 and 9 runs on the example app's own
  `afd-testing` server, with the app's handler configured. A scenario cannot say which server a
  step goes to.

**What scenarios cannot show at all:** whether a capture of a real state finds faults that
isolated stories miss. [Section 10](#10-measurement-and-exit-criteria) measures it.

## 4. What the walk and the review changed

### The walk

One fresh reader walked the first draft on 2026-11-13, taking all three seats: the person, the
job list and the calling agent. The verdict was "revise". The reader's citations were checked
first-hand before acting.

**Blockers, all fixed:**

1. **There was no live page to send commands into.**
   - The first draft ran the step loop in Node and sent each command "into the page". Every
     Specimen operation is a single request in a fresh context.
   - Fix: the step loop now runs inside the page, in one render ([5.1](#51-who-drives)).
     Section 7 lists the new capability this needs.
2. **Captures were thrown away.**
   - Every look or check replayed the job, and `specimen-a11y` captured afresh. So the screen
     checked might not be the one reported, and at volume one a11y pass cost about 225 step
     runs.
   - Fix: a run keeps its captures, and every check reads them. The review then replaced the run
     id with a Design Decisions capture set ([5.3](#53-runs-are-capture-sets)).
3. **The slice scenarios could not pass.** Partial lists under `data` fail deep equality. Every
   list assertion is now a dotted index path.
4. **`specimen-list` would break on a `job` key.** The configuration parser and the strict list
   schema are now both extended, and the change is drafted in section 6.

**Improvements:**

- **Five jobs were added:**
  - see what changed at a step since it was accepted (4);
  - accept a step's screen (5);
  - pin the clock (6);
  - sort a bulk change (7);
  - see a job's screens in order, folded into job 1.
- **Earlier jobs were folded in.**
  - The first draft's jobs 5 ("a step that changed nothing") and 8 ("unmarked steps") were
    properties of job 1, and are now its steps.
  - The stay-quiet job is now job 10, about accepted screens.
  - Jobs 8 and 9 stay separate, for the reason given in section 3.
- **The coverage job** stays outside the slice, with the reason now stated in section 3.
- **Job 8 now covers `continueOnFailure`.** No capture is taken after any failed step, even
  when later steps run.
- **The measure** now includes a person's look at the captures in order, because axe cannot see
  layout or hierarchy. The limit is stated ([section 10](#10-measurement-and-exit-criteria)).
- **`jobs@1` uses coverage waivers,** so an `unreached` question is answered once (job 11).
- **Scaffolding.** `specimen-job-create` writes the job entry from the scenario, so a step's
  description is not typed twice.
- **Superseded by the review.** The walk's fix for jobs 4, 5 and 7 drafted `specimen-job-diff`,
  `specimen-job-accept` and a committed baseline. The review replaced all three with Design
  Decisions' sets, review and answers.
- **Hosts.** `endpoints/specimen-cli` joins the units touched. The job commands return
  references, not observations.
- **`BROWSER_UNAVAILABLE`'s suggestion** now names `afd scenario run` or the app's own test, not
  `scenario-evaluate`, which needs a configured handler.
- **Layering.** The runner integration parses scenarios for both `specimen-validate` and
  `specimen-job-run`; the foundation never reads a scenario file.
- **Numbering.** Steps are numbered from 1 everywhere, matching the runner's `stepId`.
- **Descriptions.** The command descriptions now say three things:
  - a capture matches the exact description text;
  - a failed step is still a successful command;
  - a render with no set is refused for a job specimen.

**Declined:** none of the findings.

### The review

An independent review of the three drafts followed, on 2026-11-13.

**It found two parallel baseline systems.** This draft had its own: a committed
`jobs/<id>/<capture>.json`, `specimen-job-accept` with no confirmation, and groups with no
target. Design Decisions had capture sets, `specimen-review` and answers a person confirms.

The coordinator settled the shared conventions across the proposals; the owner has yet to
confirm them ([section 12](#12-for-the-owner)):

- **Baselines and review belong to Design Decisions.**
  - A run saves its captures as an ordinary capture set: a content-addressed `set-` id of twelve
    hex digits, with each capture keyed `<job>/<step>`. The run's own id is gone.
  - `specimen-job-accept`, `specimen-job-diff` and the committed baseline are dropped.
  - Seeing what changed and accepting it go through `specimen-review` and `decision-record`,
    which a person confirms.
  - Groups are by cause, and the way a capture with several causes is split is stated
    ([5.3](#53-runs-are-capture-sets)).
- **Storage.** Local data lives under `.specimen/`, which must be added to `.gitignore`.
  Committed records live under `specimens/`.
- **Job specimens in a capture set.** `specimen-capture` with no ids skips job specimens until the
  runner exists, and then runs them through it.
- **The MCP host** is Design Decisions' phase 5.
- **A command that writes files is a mutation.**

**Fixes particular to this draft:**

1. **The person's typing lives outside the scenario.** So the headless run never reaches the
   conflict state. The limit is now stated ([5.2](#52-a-job-specimen)). Job 2 now claims one
   definition of the commands only, and exit criterion 3 is corrected.
2. **`specimen-render`** is called with `id`, which its schema requires. Job runs take no
   `screenshot` input, which would clash with render's path string. A set keeps a screenshot per
   capture.
3. **The refusal of a step with no description** has a code, `STEP_HAS_NO_DESCRIPTION`, and a
   suggestion.
4. **Step references are in `input` only,** in every scenario.


## 5. Design

### 5.1 Who drives

**Recommendation: one render in one fresh context, with `afd-testing`'s step loop running inside
the page.**

1. **Node side.** The runner integration parses the scenario in Node. It sends the parsed
   steps, the scenario's fixture and the capture plan with the render request.
2. **In the page.** Its browser plugin runs `runScenario` from a new browser-safe entry of
   `afd-testing`, with an executor that calls the application's `call(name, input)` through the
   `afd` command runner.
3. **Between steps.** Two new awaited hooks in `RunConfig` do the work around each step.
   `beforeStep` runs the person actions declared for the next step. `afterStep` asks the host
   to take a capture when the step is marked and every step so far has passed.
4. **Specimen's new capability.** A render may keep several named checkpoints in one pass. The
   page signals each one, and the host captures it (observation, accessibility tree, axe and a
   screenshot) into the run's capture set before the page continues ([5.3](#53-runs-are-capture-sets)).

This keeps one fresh context per run, which is Specimen's model, and it reuses the runner's step
references, fixtures, skip rules and cancellation rather than copying them.

The alternatives each need something the first draft assumed:

- **The step loop in Node** needs a live-page session that Specimen does not have.
- **Copying the loop into Specimen** would let the two drift.

**This becomes T11's design.** T11 asks for explicit application-command dispatch, structured
results, cancellation and one consuming scenario:

- **Dispatch:** the `afd` runner.
- **Structured results:** each step's `CommandResult`, evaluated by `afd-testing`.
- **Cancellation:** the run's `AbortSignal`, tied to the render's deadline.
- **The consuming scenario:** Loam's notes conflict.

T11 stays the Specimens task that tracks the build. Its row would link here once the owner
agrees. That `STATUS.md` is provenance-tracked, so this draft does not edit it.

### 5.2 A job specimen

A job specimen is an entry in `specimen.config.json` with a `job` key. `specimen-job-create`
writes it from the scenario, copying the descriptions of the steps it is given by number. It
refuses a step with no description (`STEP_HAS_NO_DESCRIPTION`). The configuration parser and
`specimen-list`'s output schema both accept the key.

```json
{
  "id": "example-keep-a-draft",
  "title": "Example/Notes/Keep a draft",
  "module": "./app.specimens.ts",
  "exportName": "NotesApp",
  "job": {
    "scenario": "../scenarios/keep-a-draft.scenario.yaml",
    "target": "app",
    "pin": { "clock": "2026-03-02T09:00:00Z" },
    "captures": [
      { "after": "The note opens beside itself", "name": "two-editors" },
      {
        "after": "Another writer saves the note",
        "name": "conflict-notice",
        "before": [{ "action": { "fill": "second-editor", "value": " draft" } }]
      }
    ]
  }
}
```

- **The `afd` runner** uses the existing contract, `run(element, name, input)`. `target` names
  the application's root element, and the runner calls that element's `call(name, input)`.
  - For Loam this is one line in the specimen module, which exposes the kernel's `call` on the
    shell.
  - Whether a step calls through Loam's agent interface is a setting of the mount.
- **The scenario's own `fixture`** is applied in the page through the same runner with
  `applyFixture`. So the browser run and the headless run start from the same data.
- **`pin.clock`** fixes `Date` and timers in the page to the given instant. `Math.random` is
  already seeded. A run reports what it pinned, as `pinned`.
- **`after` must match a step's `description` exactly,** character for character.
  - A description that matches no step is `CAPTURE_STEP_UNKNOWN`.
  - A description that matches two steps is `CAPTURE_STEP_AMBIGUOUS`.
  - `specimen-validate` reports both with no browser, and `specimen-job-run` refuses to run
    either one.
- **`before` lists Specimen's existing `action` steps,** run before that step's command. They
  are a person's input, which a scenario cannot hold, because its steps are commands.

**The limit of person actions.** Part of a state can live outside the scenario.

- In the notes conflict, the draft typed into the second editor is in the Specimen entry. So the
  headless run of the same scenario reaches every state the commands build, but not the conflict
  notice: the agent's save lands on an editor with no draft.
- The scenario is therefore one definition of the commands, not of the whole state. The browser
  test and the job specimen cannot drift on commands. The person's part is declared once, in the
  entry, and only the browser run exercises it.
- Moving it into the scenario would need an application command that types into an editor. That
  is a command invented for testing, which [decision 7](#8-decisions-made-in-this-draft)
  declines. An application that already has such a command can use it, and then its states live
  wholly in the scenario.

### 5.3 Runs are capture sets

A run of `specimen-job-run` saves its captures as an ordinary capture set, as Design Decisions
defines it ([its section 6.2](../design-decisions/design-decisions.proposal.md#62-capture-sets)).
The two proposals keep one baseline and review system.

- **The set.**
  - Its id is `set-` and twelve hex digits, a hash over the context, the checkpoint and each
    capture's content. So two runs that render the same screens give the same set.
  - Each capture is keyed `<job>/<step>` (for example `keep-a-draft/4`), and keeps its `name` as
    the checkpoint name.
  - A `label`, such as `main` or `branch`, is a local pointer to a set id.
  - Axe runs as each capture is taken, and a screenshot is kept for each capture.
- **Where it is stored.** The set lives under `.specimen/sets/`. `.specimen/` is not ignored by
  git today, and it must be added to `.gitignore`. Committed records, such as decisions and their
  evidence, live under `specimens/`.
- **A capture is taken only when its step passed and no earlier step failed.**
  - Otherwise it is `not-taken`, with the reason. That holds even when a `continueOnFailure`
    step let later steps run.
  - In the set, a capture that was not taken is `unavailable`, which the review counts as
    blocking, not as a question.
  - A capture equal to the previous one (by `specimen-diff`'s structured channels) is
    `unchanged`, with the reason. It is reported, not failed: an unchanged screen can be correct.
- **Checks read the set.**
  - `specimen-a11y`, given `set`, reports the axe result recorded when each capture was taken.
  - `specimen-render`, given `id`, `set` and `checkpoint`, returns the kept observation.
  - Neither replays the job. A capture that was not taken is `not-run`, with its reason.
- **Seeing what changed and accepting it** use Design Decisions' commands unchanged
  ([its section 6.5](../design-decisions/design-decisions.proposal.md#65-review)).
  - `specimen-review { before, after }` compares a set on `main` with one on the branch. It lists
    only the open items, each with its before and after captures, and counts the rest.
  - `decision-record { items, chosen, reason }` answers an item. It asks a person to confirm.
    While the item's fingerprint matches, later reviews count it as `answered`.
- **Groups are by cause:** channel, target, property and the before and after values.
  - A capture whose differences have several causes appears in one item per cause.
  - Accepting one cause settles only that cause's part. The capture stays in the review while any
    of its causes is open. So accepting a bulk change cannot also accept a mistake on the same
    screen (job 7).
- **Job specimens in `specimen-capture`.** Until the runner exists, `specimen-capture` with no
  ids skips job specimens. After that, it runs each one through the runner, as one capture per
  marked step.
- **Coverage (`jobs@1`) reads the job captures in a named set,** such as `main`.
  - For each component it lists `reachedBy` (capture keys) and `unreached`.
  - A component that no job renders gets an empty `reachedBy` and a `reason`.
  - Existing coverage waivers apply, with the obligation `unreached:<partition>`.
  - It is its own obligation set, so the results of `schema-partitions@1` and `guides@1` do not
    change. Its input is `obligations: jobs@1`, which keeps it apart from a capture set.

### 5.4 Without a browser

- **The scenario file's format does not change.** So `afd scenario run`, `scenario-evaluate`
  with the app's handler, Python's `afd.testing` and in-process tests all run it as they do
  today.
- **Without a browser, `specimen-job-run` is refused** with `BROWSER_UNAVAILABLE`.

### 5.5 Hosts and output size

- **Today an agent reaches Specimen's commands through `endpoints/specimen-cli`.** The CLI
  dispatches each command by hand, so each new command needs a verb there.
- **The MCP host is Design Decisions' phase 5,** which a person's confirmation needs.
- **The job commands return references,** never observations: set ids, capture keys, step
  numbers, statuses and screenshot paths.
- **An observation is returned only when asked for,** by `specimen-render` with a set and a
  checkpoint. Bounding a render's size is out of scope here.

## 6. Drafted commands

These names, inputs and results are a draft to write jobs against. The exact contracts follow
approval. This proposal adds two commands and extends six. It uses Design Decisions'
`specimen-review` and `decision-record` unchanged.

| Command | Unit | New | Input | Result |
| --- | --- | --- | --- | --- |
| `specimen-job-create` | `specimen-afd` | Yes, mutation (writes the configuration) | `id`, `scenario`, `module`, `exportName`, `target`, `captures` (step numbers), optional `pin` | `written`, `entry` |
| `specimen-job-run` | `specimen-afd` | Yes, mutation (writes a set) | `id`; optional `label`, `context`, `timeoutMs` | `set`, `label`, `id`, `job`, `scenario`, `status`, `pinned`, `steps[]` (`step`, `description`, `command`, `status`, optional `capture`: `key`, `name`, `status`, `reason`, `actions`), `captures[]` in step order (`key`, `name`, `step`, `status`, `screenshot`) |
| `specimen-list` | `specimen-afd` | Extended | Optional `kind` (`job` or `component`) | Entries carry `kind` and, for a job specimen, `job` |
| `specimen-validate` | `specimen-afd` | Extended | As today | Issues for job entries: `CAPTURE_STEP_UNKNOWN`, `CAPTURE_STEP_AMBIGUOUS`, `JOB_SCENARIO_INVALID`, `RUNNER_MISSING` |
| `specimen-render` | `specimen-afd` | Extended | `id` as today; optional `set`; `checkpoint` may name a capture | The kept observation, whose manifest gains `job` and `set` |
| `specimen-a11y` | `specimen-afd` | Extended | Optional `set` | One report per capture, read from the set, each with `job`; a capture that was not taken is `not-run` with the reason |
| `specimen-coverage` | `specimen-afd` | Extended | Optional `obligations` (`jobs@1`) and `captures` (a set id or label) | `components[].jobs`: `reachedBy`, `unreached`, `reason`; `waived` as today |
| `specimen-capture` | `specimen-afd` | Extended (drafted in Design Decisions) | As drafted there | Job specimens run through the runner once it exists; before then they are skipped with the reason |
| `specimen-review` | `specimen-afd` | Design Decisions', unchanged | `before`, `after`, `ids` | Job captures appear in items by their keys |
| `decision-record` | `specimen-afd` | Design Decisions', unchanged | `items`, `chosen`, `reason`, and the rest as drafted there | As drafted there |
| `scenario-evaluate` | `afd-testing` | Unchanged | | On the app's own server with its handler; used by jobs 2 and 9 |

**What the descriptions say:**

- **`specimen-job-run`:** "Run a job specimen's scenario once in a fresh browser context, and
  save a capture at each marked step into a capture set, keyed `<job>/<step>`. A capture point
  matches a step's description exactly. A capture is taken only when its step passed and no
  earlier step failed. A failed step is a successful command: read `data.status` and each step's
  `capture`. Compare sets with `specimen-review`."
- **`specimen-render`:** "For a job specimen, give a `set` and a `checkpoint`: it returns that
  capture from the set. A job specimen with no set is refused, because its states exist only
  inside a run."
- **`specimen-job-create`:** "Write a job entry from a scenario, copying the description of each
  step you mark, so it is typed once. A step with no description cannot be marked."

**Errors:**

| Error | From | Recovery the suggestion names |
| --- | --- | --- |
| `NOT_A_JOB` | `specimen-job-run` | `specimen-list` with `kind: job` to find job specimens; `specimen-render` for a component specimen |
| `JOB_NEEDS_RUN` | `specimen-render` | Run `specimen-job-run`, then render its `set` at a capture's name |
| `CAPTURE_STEP_UNKNOWN` | `specimen-job-run` | Run `specimen-validate`; name the step by its exact `description`, or rewrite the entry with `specimen-job-create` |
| `STEP_HAS_NO_DESCRIPTION` | `specimen-job-create` | Add a `description` to that step in the scenario; it does not change the format |
| `BROWSER_UNAVAILABLE` | `specimen-job-run` | Install the browser Specimen uses; or run the scenario headless with `afd scenario run`, or in the app's own test |
| `REVIEW_ITEM_NOT_FOUND` | `decision-record` (Design Decisions') | `specimen-review` for the items the two sets raise |

**Errors no job shows yet:**

- `CAPTURE_STEP_AMBIGUOUS`, `JOB_SCENARIO_INVALID` and `RUNNER_MISSING` are validation issues.
  `specimen-job-run` refuses the same conditions with the same codes. They are kept because each
  one guards a capture from landing on the wrong state.
- An unknown set is Design Decisions' `CAPTURE_SET_NOT_FOUND`.

## 7. What each unit contributes

| Unit | Already has | This adds |
| --- | --- | --- |
| `afd-testing` (TypeScript) | Parsing, fixtures, step references, `runScenario`, cancellation | A browser-safe entry that exports `runScenario`, the evaluator and step references without file access; awaited `beforeStep` and `afterStep` hooks in `RunConfig`. `onStepComplete` stays as it is |
| `afd.testing` (Python) | The same file format | Nothing. The format does not change |
| Specimen | Native actions, command steps, named checkpoints, checks, coverage sets and waivers, a seeded `Math.random` | Several kept checkpoints in one render, saved as a Design Decisions capture set; `pin.clock`; job entries in the configuration parser; the `unchanged` and `not-taken` states; `jobs@1` |
| `specimen-afd` | The 19 command bindings | Two new commands and six extended ones |
| `specimen-cli` | Hand-written dispatch, per command | Verbs for the two new commands, and the new inputs |
| Design Decisions' work | Capture sets, `specimen-review`, `decision-record`, the MCP host (its phase 5) | Nothing beyond job captures keyed `<job>/<step>`, and `specimen-capture` running job specimens |
| A new integration (working name `specimen-afd-runner`) | | The `afd` runner, the in-page step loop, and the scenario parsing that both `specimen-validate` and `specimen-job-run` use, through a plugin point. The foundation never reads a scenario. It is kept apart from `specimen-afd`, as T11 requires |
| The repository | | `.specimen/` added to `.gitignore` |
| Loam | Screen specimens, test kernels, browser tests | Its first job specimen: the notes conflict, written as a scenario file that its Vitest test also runs |

## 8. Decisions made in this draft

| # | Decision | Instead of | Why |
| --- | --- | --- | --- |
| 1 | The step loop runs inside the page, in one render | Driving a page from Node | Specimen has no live-page session, and one fresh context per run is its model |
| 2 | A run saves a Design Decisions capture set, and checks read it | Replaying the job for each look, or a separate store | The screen checked must be the screen captured, and one baseline and review system serves both proposals |
| 3 | Captures are declared in Specimen's configuration | A new key in the scenario format | No parity change, and the file keeps its headless meaning |
| 4 | A capture point names its step by its exact description | By number | An inserted step would silently move later captures |
| 5 | No capture after any failed step | Capturing whatever runs | `continueOnFailure` would otherwise put a broken state in front of a person |
| 6 | Accepting is a review answer a person confirms | A command that writes a baseline | An agent must not accept its own change |
| 7 | Person actions are Specimen actions in the entry, with the limit stated | Commands invented for typing | The state needs a person's input, and the scenario stays an agent's job |
| 8 | An unchanged capture is reported, not failed | Failing it | An unchanged screen can be correct |
| 9 | `jobs@1` is its own set and uses existing waivers | Adding to `schema-partitions@1` | Existing coverage must not change, and an answered gap stays answered |
| 10 | This is T11's design | A separate runner | T11 asks for exactly this dispatch and a consuming scenario |

## 9. Phases

These come after Design Decisions' phase 1 (capture sets) and phase 4 (review), which they build
on.

1. **`afd-testing`.** The browser-safe entry and the two awaited hooks, with tests showing that
   the hooks are awaited and are not called for skipped steps.
2. **Specimen.** Several kept checkpoints in one render saved as a set, `pin.clock`, and job
   entries in the parser and in `specimen-list`.
3. **The runner integration.** The `afd` runner, the in-page step loop and validation of job
   entries.
4. **Commands.** `specimen-job-create`, `specimen-job-run` and the extended results, with their
   CLI verbs. `specimen-capture` starts running job specimens.
5. **Loam.** The notes conflict becomes a scenario file, a job specimen and a Vitest test that
   runs the file. A `main` set is captured, and the hand-built `EditorConflict` specimens are
   removed.
6. **Coverage.** `jobs@1`.

## 10. Measurement and exit criteria

Exit starts from the jobs: **every scenario tagged `slice` passes** against the built commands.
Then:

1. **The notes conflict's commands are defined once.** The hand-built conflict specimens are gone,
   and the job specimen's capture at step 4 shows the notice.
2. **Renaming a step** that a capture names fails `specimen-validate`.
3. **The scenario passes headless,** with no browser, in TypeScript and in Python. This shows
   that the commands run, not that the conflict state is reached: that state needs the person's
   typing, which only the browser run performs ([5.2](#52-a-job-specimen)).
4. **One a11y pass over a run's set** reads its captures and replays no step.
5. **One measurement, taken once on Loam's notes job,** of the faults found at the capture
   points that no isolated notes specimen shows:
   - (a) the faults `specimen-a11y` reports;
   - (b) the faults a person finds by looking at the captures in step order, recorded with the
     step and a sentence each. This one can see layout and hierarchy, which axe cannot.

   Report both counts, including zero.

**The limit:** no automated check here can judge layout or hierarchy. A review shows that a
screen changed, not that it is wrong. Patterns' layout expectations and the Design Decisions
review are where such judgements would gain a check.

## 11. Risks and open points

| Risk or open point | Response |
| --- | --- |
| Descriptions are optional free text, so a scenario may have none to name | `STEP_HAS_NO_DESCRIPTION` says to add one. Adding one does not change the format |
| Part of a state lives in the Specimen entry, not the scenario | Stated in [5.2](#52-a-job-specimen). The headless run proves the commands only |
| Sets fill the disk | They live under `.specimen/`, once it is ignored. Clearing it loses nothing committed: decisions and their evidence live under `specimens/` |
| A job run is slower than a story | One run serves every check; only marked steps are captured; the headless run stays the quick path |
| The app's data differs between the browser and headless runs | Both apply the scenario's own fixture through the same commands |
| An agent reads a whole observation through the CLI | Job commands return references only. A budget for `specimen-render` is a separate follow-up |
| Which interface a step calls through (Loam's agent or person interface) | A setting of the mount. Open whether a step ever needs to choose |
| Pinning the clock can hide a fault that only appears at real times | Pinning is per entry, and the entry says the instant it uses |
| This proposal depends on Design Decisions' sets and review | Its phases come after that proposal’s phases 1 and 4. Jobs 1, 2, 3, 8 and 9 need only its phase 1 (sets), not its review |

## 12. For the owner

**The coordinator's shared conventions,** set across Design Decisions, Screens from Jobs and
Pointing, for the owner to confirm. Design Decisions states them in full
([its section 5](../design-decisions/design-decisions.proposal.md#5-shared-conventions-the-owners-to-confirm)).
The ones this proposal relies on are:

1. Design Decisions owns the one baseline and review system. A job run saves a capture set,
   keyed `<job>/<step>`, and is reviewed and answered there.
2. Local data lives under `.specimen/`, which Design Decisions' phase 1 adds to `.gitignore`.
   Committed records live under `specimens/`.
3. `specimen-capture` skips job specimens until the runner exists, then runs them through it.
4. The MCP host is Design Decisions' phase 5.
5. A command that writes files is a mutation.

**Recommendations for this proposal,** each for the owner to decide:

1. **The jobs.** Cut, add and rank the eleven. The ranking decides the slice; jobs 1 to 6 and 8
   are tagged tentatively.
2. **Is this T11?** Recommended: yes. This becomes T11's design, and T11 stays the task that
   tracks the build.
3. **Who drives?** Recommended: one render per run, with `afd-testing`'s step loop inside the
   page ([5.1](#51-who-drives)).
4. **Parity.** Recommended: no format change, so Python is not affected. The browser-safe entry
   and the two hooks are TypeScript `afd-testing` API, which no agent sees. A Python equivalent
   waits until something in Python needs it.
5. **Loam's job tests.** Recommended: Loam writes a scenario file only for a state it wants seen,
   starting with the notes conflict. It runs that file in a Vitest test through `afd-testing`
   against `createTestKernel`. Its other Vitest and browser tests stay as they are.
6. **Data.** Recommended: the capture runs on the scenario's own fixture, applied through the
   same runner. There is no separate specimen data.
7. **Where the runner lives.** Recommended: a new integration, `specimen-afd-runner` as a
   working name, kept apart from the `specimen-afd` command bindings as T11 requires.
8. **Person actions.** Recommended: keep them in the Specimen entry, with the stated limit,
   rather than adding application commands to type.

## 13. Out of scope

- Replacing isolated stories. They stay the cheap place to cover every value of every argument.
- Pixel comparison. `unchanged` and the review use `specimen-diff`'s structured channels.
- The MCP host, which is Design Decisions' phase 5, and a size budget for `specimen-render`.
- A second baseline or review system. Both belong to Design Decisions.
- Recording a person's session into a scenario.
