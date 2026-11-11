# Jobs first

A feature that adds or changes commands starts from the jobs it serves. Each job is written as a
scenario file before the commands are specified, so the plan is tested against the work it is
for while changing it is still cheap. The same files become the feature's acceptance tests.

Skip this for work with no commands: tooling, CI, releases, documentation. Earlier proposals
have no scenarios; add them when one is next revised, not as a side task.

## Steps

1. **Name the jobs.** One sentence each: "When *situation*, I want *capability*, so that
   *outcome*", from the side of the person or agent doing the work. Include what the feature
   must refuse and what it must stay quiet about. Those are jobs too, and they are where a
   design most often has no answer.
2. **Draft the commands** the jobs seem to need: names, inputs, result shapes and error codes,
   as a table in the proposal. A draft is enough to write scenarios against. The exact
   specification comes after approval, once the jobs have changed the draft.
3. **Write each job as a scenario**, one file per job, in a `scenarios/` folder beside the
   proposal or specification: `docs/features/proposed/<feature>/scenarios/<job>.scenario.yaml`.
   `name` is a short title, `job` is the job's slug and `description` is its sentence; the
   parser requires all three. The steps call the drafted commands and assert the drafted
   shapes. This repository is public: invent the data, and take nothing from a private corpus.
4. **Check the files** (below). Nothing is built yet, so they are checked, not run.
5. **Change the plan where the writing shows a gap.** A job that cannot be written with the
   drafted commands is a gap in the design: fix the design rather than bending the job. A
   drafted command no job uses is cut, or the proposal says why it stays.
6. **Have the paths walked by readers who did not write them**
   ([Walking the paths](#walking-the-paths)), for a new proposal and for a revision that adds
   jobs or commands. Passing the checks shows that the commands can express each job once. It
   does not show that the jobs are the right ones, or that a person gets through the whole
   path. Take what the readers find back to steps 1 to 5 and rerun the checks. Walk again only
   if the fixes added jobs or commands.
7. **Put the result in the proposal:** the jobs, what writing them changed, which seats walked
   them, what that changed and what was declined and why, what a scenario could not express
   (the limits below), and what scenarios cannot show at all. Quality and scale need measures,
   not scenarios.
8. **Tie the exit criteria to them.** They start from "every scenario passes". Tag the scenarios
   a first slice must pass (`slice`, say) and name the tag in the criteria, so the slice has a
   definition.
9. **Ask the owner to cut, add and rank the jobs**, as a decision in the proposal's section for
   the owner. A list an agent drafted is a draft, and the ranking decides what is built first.

## A job as a scenario

```yaml
name: Save a note without losing an earlier one
description: >-
  When I save a note under a title I have already used, I want to be told and shown the way
  forward, so that I never overwrite an earlier note by accident.
job: save-without-overwriting
tags: [slice]
steps:
  - description: The first note is saved
    command: note-create
    input: { title: Seed order, body: Order tomatoes by March. }
    expect:
      success: true
      data:
        id: { matches: '^note-' }
  - description: A second note under the same title is refused, with the way forward
    command: note-create
    input: { title: Seed order, body: Order beans too. }
    expect:
      success: false
      error:
        code: ALREADY_EXISTS
        suggestion: { contains: note-update }
  - description: The first note is unchanged
    command: note-get
    input: { id: "${{ steps[0].data.id }}" }
    expect:
      success: true
      data:
        body: Order tomatoes by March.
```

Fields, matchers, fixtures and step references are in
[`packages/testing/README.md`](../../../../packages/testing/README.md#jtbd-scenario-runner).

## Checking without a server

Build the tools once: `pnpm -F "@lushly-dev/afd-cli..." build`.

```bash
node packages/cli/dist/bin.js scenario validate docs/features/proposed/<feature>/scenarios
```

That command only parses. The parser is strict, so a misspelled field fails, but a step that
references a later step passes, and it knows nothing about the command list. Run the dry-run
check and the coverage report as well, from `packages/testing` so the import resolves:

```bash
cd packages/testing && node --input-type=module -e "
import { readdirSync } from 'node:fs';
import { parseScenarioFile, scenarioCoverage, validateScenario } from '@lushly-dev/afd-testing';

const directory = '../../docs/features/proposed/<feature>/scenarios';
const knownCommands = ['<domain>-<action>']; // every command the proposal drafts
const knownErrors = ['NOT_FOUND']; // every error code those commands return

for (const file of readdirSync(directory).filter((name) => name.endsWith('.scenario.yaml'))) {
  const parsed = await parseScenarioFile(directory + '/' + file);
  const errors = parsed.success
    ? (await validateScenario(parsed.scenario, { checkFixtures: true })).errors
    : [parsed.error];
  if (errors.length > 0) console.log(file, errors);
}

const { data } = await scenarioCoverage({ directory, knownCommands, knownErrors });
console.log(data.summary);
console.log('not drafted:', data.commandCoverage.map((entry) => entry.command)
  .filter((command) => !knownCommands.includes(command)));
"
```

- `summary.commands.untested`: drafted commands no job uses.
- `summary.errors.untested`: refusals no job shows.
- `not drafted`: commands a scenario calls that the proposal does not draft, usually a
  misspelling or a command the proposal forgot. Coverage counts them as tested without comment.

Paste what the checks print into the pull request's test plan. No CI job reads scenario files
under `docs/`, and a reviewer reads them and does not run them.

## Walking the paths

Brief fresh readers as `review-code` describes, before the owner is asked to decide. Give each
reader its seat's paragraph below as its task, with the proposal and the scenario files and
without your conclusions. Three seats find different things:

- **The person.** Walk the journeys end to end at the volume the proposal expects: the first
  week from nothing, an ordinary day, a session of many decisions in a row, a year in, and
  things going wrong (a mistake by the person, by an agent, by a bulk run). At each step, name
  the command or rule that serves it, or say that nothing does.
- **The job list.** This reader gets the owner's request first, in the owner's words, and
  drafts its own list of jobs before it opens the proposal. Then it compares: jobs that are
  missing, features dressed as jobs, and jobs whose last step stops short of their "so that".
- **The calling agent.** This reader also gets the specification of the host that will serve
  the commands. It reads how that host lists tools, asks a person to confirm, and bounds input
  and output. Then, for each job at volume, it estimates the calls, the tokens and the
  person-only interruptions, and says what a model must know when no skill is installed.

What these readers tend to find, and writing the scenarios does not:

- A job that ends at detection: a finding is reported, and no command clears it or records "no".
- A guarantee that holds only when the caller asks in the right way.
- A person-only step that the plan makes frequent, where each confirmation takes the person out
  of the conversation.
- Content the agent must read and repeat as input, because no command takes it by reference.
- No way back from a mistake.

Keep that list out of the briefs, so the readers are not led to it, and use it afterwards to
see what none of them looked at. Check what a reader says about the host against the host's
own specification before acting on it. For a feature of a few commands, one reader covering
all three seats is enough.

## What a scenario cannot express

The allowed keys are the `*_KEYS` lists in `packages/testing/src/parsers/yaml.ts`. Three limits
shape what a job can show:

- `expect` reaches `success`, `data`, `error` (`code`, `message`, `suggestion`), `reasoning` and
  `confidence`. It cannot assert `warnings`, `alternatives`, `sources` or an error's `details`.
- Every step runs as `actor: { kind: 'test' }`, so one scenario cannot show an agent refused
  and a person allowed.
- The clock cannot move between steps. A job about time passing needs the design to offer a
  read as of a date, or it stays unshown.

When a job needs one of these, write the steps that can be written, say what is missing in a
comment at the top of the file, and list it in the proposal. Don't drop the job.

## Once the feature is built

Move the files beside the code (`<unit>/scenarios/`) and run them in the unit's tests, as
`packages/view-state/src/scenarios.test.ts` does, or against a server with
`afd scenario run <dir> --server <url>`. A command is done when its feature's scenarios pass.
