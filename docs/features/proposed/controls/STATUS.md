# Controls: status

Epic: [#1385](https://github.com/lushly-dev/afd/issues/1385). Its issue is
[#2275](https://github.com/lushly-dev/afd/issues/2275), whose approach this proposal is; file
new work for this area as a sub-issue of the epic.

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

- **State:** proposed. A scaffold with jobs and a design direction, written 2026-11-24 against
  `8347a597`. The owner has not ranked the jobs or approved it.
- **Scope drafted:** 18 jobs, 14 scenario files, 4 commands and 4 error codes, all in the
  [proposal](controls.proposal.md) and [`scenarios/`](scenarios/).
- **Nothing is built.**

## Steps

- **Jobs, drafted commands and scenarios.** Done 2026-11-24, merged in #2480.

- **Walks by a reader who did not write them.** Done 2026-11-24, merged in #2480: three walks
  by one reader, recorded in the proposal's section 6.

- **The owner cuts, adds and ranks the jobs.** Open. The six questions are in the proposal's
  section 10.

- **Phase A, the specification and the commands on a registry.** Not started.

- **Phase B, the binder.** Not started.

- **Phase C, the state contract in Specimen and the library.** Not started.

- **Phase D, in an application, with the measure.** Not started.

## What is not done

- **No command exists.** `control-list`, `control-set`, `control-restore` and
  `control-choices` are drafts.
- **Nothing in the design direction is verified.** In particular, that dispatching a control's
  change event after a write is enough for a framework that controls its inputs.
- **The survey of `violet-elements`' components was sampled, not repeated.** The proposal's
  section 2 marks which lines were read first-hand.
- **No model has used the commands,** so nothing shows they serve a real form.
- **The fixtures cannot be applied.** They are files the dry run loads; the adapter that turns
  one into a screen is phase A's.
- **What the walks left for the specification** is listed in the proposal's sections 6 and 9.

## How it was checked

Run 2026-11-24 on a branch from `main` at `8347a597`.

- **Claims about the repository** in the proposal's section 2 that carry no mark were read
  first-hand from the files they cite. The lines marked *surveyed* were read by three reader
  agents the same day, each citing its lines; a sample was checked first-hand.
- **The scenario checks,** as [jobs first](../../../../.claude/skills/afd/references/jobs-first.md)
  describes, after `pnpm -F "@lushly-dev/afd-cli..." build`, on the scenarios as merged:
  - `node packages/cli/dist/bin.js scenario validate docs/features/proposed/controls/scenarios`:
    "All 14 scenario(s) are valid!"
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
    proposal is now posted there as its approach;
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

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-24 | The survey for this proposal | `violet-elements`' `attribute-taxonomy.jsonc` lists `violet-date-range-picker` under `name.usedBy`, and the component has no `name` attribute. Checked first-hand | Open |
| 2026-11-24 | This proposal | Whether a journal should skip `control-*` commands, whose input is a person's draft, as two recorders skip `auth-*` | Open; the proposal's section 9 |
| 2026-11-24 | This proposal | The measure in the proposal's section 7: one form filled by a model through these commands, through a workaround and through UI SDK's public benchmark task | Open; phase D |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-24 | The proposal | After the comparison with UI SDK, the owner said AFD should have a designed path for an agent to change the controls on a screen, in place of a command that sets values and code in the interface that applies them. Three surveys read how view state is used, how `violet-elements`' components hold state and how Specimen checks a component. The jobs were written as scenarios, and a reader walked them three times. The walks replaced an optional guard with a `rev` on each control, made the undo a command of its own that carries no values, and added three jobs. Nothing was built |
