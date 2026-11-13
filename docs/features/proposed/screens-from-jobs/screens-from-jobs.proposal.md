# Screens from Jobs: the screen in a job's state as the unit that is seen and checked

## Status

- **State:** scaffold. Written 2026-11-13 against `main` at `e5d683a8`. It states the problem,
  what exists and draft jobs. It has no design, no drafted commands and no scenario files yet.
  [STATUS.md](STATUS.md) tracks progress.
- **Verified:** that Python's `afd.testing` also reads scenario files (`python/tests/test_scenario_*.py`).
  The rest of [What exists today](#2-what-exists-today) comes from a survey another agent made
  on 2026-11-13 at `e5d683a8`; each claim names its file.
- **Next:** the owner cuts, adds and ranks the [jobs](#3-jobs-draft), and decides how this relates
  to Specimen's T11 ([question 1](#5-open-questions)).

| Field | Value |
| --- | --- |
| Epic | [#1109](https://github.com/lushly-dev/afd/issues/1109) |
| Units likely touched | `packages/testing` (and Python's `afd.testing` for parity), `foundations/specimen`, `integrations/specimen-afd`, `endpoints/loam` |
| Related | [Specimens status](../../active/specimens/STATUS.md) (T11), [Patterns](../patterns/patterns.proposal.md), [Design Decisions](../design-decisions/design-decisions.proposal.md), [Pointing](../pointing/pointing.proposal.md) |
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

## 2. What exists today

### AFD scenario files

- **Format** (`packages/testing/src/types/scenario.ts`, enforced by `src/parsers/yaml.ts:46-59`,
  which rejects unknown keys). A step has `command`, `input`, `description`, `expect` and
  `continueOnFailure`. `expect` asserts `success`, `data` matchers, `error`, `reasoning` and
  `confidence`. `verify`, `isolation` and `dependsOn` are declared but refused as unsupported.
- **Running:** `InProcessExecutor` calls a command handler in process and `ScenarioExecutor` goes
  through the CLI; both share `runScenario` (`runner/scenario-runner.ts:334`). A step can read an
  earlier step's output with `${{ steps[N].path }}`.
- **Hooks:** `onStepComplete(step, result)` exists (`scenario-runner.ts:43`, called at 411). It is
  synchronous and not awaited, and it fires for skipped steps too, so an asynchronous capture
  could not hold the next step.
- **Coverage** (`commands/coverage.ts`) counts commands, errors and jobs.
- **Python** reads the same files in `afd.testing`, so a change to the format is a parity change.

### Specimen

- **T11, the application-command runner,** is "Not started, optional" and not needed for cutover
  ([status](../../active/specimens/STATUS.md)). The plan asks it to "prove explicit
  application-command/view-state dispatch, structured results and cancellation"
  (`docs/features/active/specimens/implementation.md:85`). The proposal says command steps name
  their runner (`runner: 'afd'`), reuse `afd-testing` "through a new browser-step adapter", and
  land only with a consuming scenario (`docs/features/proposed/specimens/specimens.proposal.md:58,93,396`).
  Its scope is an open question in the status (line 223).
- **Command steps today** run against one element: `CommandRunner.run(element, name, input)`
  (`foundations/specimen/src/plugin.ts:66-69`). Only the FAST-AF and fixture runners exist.
- **`integrations/specimen-afd`** binds Specimen's own 19 commands. None runs application commands.
- **Coverage** (`src/coverage.ts:184-192`) collects every observed element with a tag in every
  case and checkpoint, so a component counts wherever it renders. A `command:` obligation stays
  `unknown`: "No claim links a command step to this component".
- **Checkpoints:** `mount`, a named capture, or `after-run`.

### Loam

- **123 screen specimens:** 115 in `endpoints/loam/packages/chrome/specimens/specimen.config.json`
  and 8 in `endpoints/loam/apps/notes/specimens/specimen.config.json`. Their states are built in
  three ways:
  - Commands on a real test kernel: `shellFixture` (`support.ts:61-90`); `Shell` runs
    `appearance-set` and two `layout-set` calls.
  - Properties set directly: `ListFailed` sets `element.failure`.
  - Stub clients: the notes editor's `contextOver()` answers `notes-content-get`
    (`apps/notes/specimens/notes.specimens.ts:58-74`).
- **No scenario files.** Loam's job tests are Vitest: `apps/*/test/app.test.ts` and the Chromium
  suites under `packages/web/test/browser/`.
- **One state built twice:** "This note changed elsewhere".
  - The specimen fakes it with a stub and a hand-fired `documentChanged`
    (`notes.specimens.ts:76-115`).
  - The browser test reaches it for real: it creates a note, opens it in two groups, types a
    draft and calls `notes-content-set` as the agent (`packages/web/test/browser/documents/editor.test.ts:2495-2542`).
- **A runner could drive Loam directly.** The kernel's `call(name, input)` returns a
  `CommandResult` (`packages/kernel/src/types.ts:548-557`), close to the testing package's
  handler shape. `createTestKernel` and `createAppTestKernel` give a seeded, in-memory kernel,
  and a mounted shell exposes `loam-shell.kernel` to browser tests.

## 3. Jobs (draft)

For the owner to cut, add and rank.

1. **See a job's states.** When a job's scenario runs, I want the screen captured at each step I
   mark, so that the job's states can be seen and checked without building them by hand.
2. **Build a state once.** When a screen specimen and a job test need the same state, I want one
   definition that both use, so that they cannot drift.
3. **Check a state where it occurs.** When a capture at a step fails a gate, I want the failure
   reported against that job step, so that I know which job is affected.
4. **Find what no job reaches.** When I ask which job states render a component, I want the
   list, and the component states no job reaches, so that each one is questioned.
5. **Say when a step cannot be seen.** When a step has no screen (a headless command, or a state
   the app does not render), I want that said, so that a missing capture is never read as a pass.
6. **Keep scenarios runnable without a browser.** When no browser is available, I want the
   scenario to run as it does today, so that capture is something added, never required.

## 4. Starting points

Not a design.

- **Where capture is declared:** an optional per-step key in the scenario format (the parser
  rejects unknown keys, so this is a format and parity change), or a separate file that maps
  steps to captures and leaves the format alone.
- **Which side drives:** the scenario runner drives the app and asks Specimen to capture, which
  needs an awaited after-step hook; or Specimen drives the app through T11's `afd` runner and
  reads the scenario.
- **Loam first:** its kernel already answers `call` with a `CommandResult`, and `shellFixture`
  already mounts the real shell after running commands. The notes conflict is the first pair to
  unify.
- **Coverage:** a new coverage set that counts, per component, the job steps that render it.

## 5. Open questions

1. **Is this T11?** Whether this proposal becomes T11's design or a separate feature T11 serves.
2. **Who drives**, as in the starting points above.
3. **Parity:** whether TypeScript only first is acceptable for a scenario format change, given
   that Python reads the same files.
4. **Loam's job tests:** whether Loam moves its job tests to scenario files to use this, or the
   runner accepts its Vitest tests as they are.
5. **Data:** a screen in a real state needs data. Whether fixtures are shared between the
   scenario and the capture, or the capture runs on the scenario's own fixture.

## 6. Out of scope

- Replacing isolated stories. They stay the cheap place to cover every value of every argument.
