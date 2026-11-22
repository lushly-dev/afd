# Agent OS: status

Read this before the [proposal](agent-os.proposal.md). It records exactly what is done and what is
not, so an agent never has to scan the code to learn what is current. It follows the shape of the
[Patterns status](../../active/patterns/STATUS.md).

## How to keep this file

- "Done" means merged to `main` with evidence linked. Anything else is "in progress" or "open",
  with what remains spelled out.
- Record how you verified it, the command or check, and the absolute date.
- Write down follow-ups that are not yet issues, with the date and who raised them. Link the issue
  when one exists.
- Never delete history. Mark an entry superseded and point to what replaced it.
- Each step has its own line in [Steps](#steps), made before the step starts. No sentence here
  says which steps are done or next.

## Status block

- **State:** proposed. A first draft, written 2026-11-21 against `main` at `a91acface` and revised
  the same day after five readers walked its jobs in three passes, the owner answered three of
  its questions and two independent reviewers read it. Not approved.
- **Epic:** none. It is opened when the feature moves to `active/`.
- **Decided by the owner, 2026-11-21:** commands first with no interface; a machine per session as
  the first form; authority outside the machine; a separate binary on Umbel's host library; a
  branch's validation run as the first workload; AFD inside a machine from M3 and not before;
  Umbel's journal rule and principle 11 bend for this binary; from M1 a cell may repeat a
  failed run in a machine of its own. The proposal's
  [Decisions](agent-os.proposal.md#decisions) has the table.
- **Built:** nothing. Nothing is implemented and nothing is measured.
- **Last verified:** 2026-11-21, the scenario checks below, on `main` at `8f59df5e7` with the
  tools built at `a91acface` (neither the CLI nor the testing package changed between the two),
  on Node 26.13.1.

## Steps

| Step | State | Evidence |
| --- | --- | --- |
| Draft the proposal | Merged in [#1912](https://github.com/lushly-dev/afd/pull/1912) | [`agent-os.proposal.md`](agent-os.proposal.md) |
| Write the jobs as scenarios | Merged in [#1912](https://github.com/lushly-dev/afd/pull/1912) | [`scenarios/`](scenarios/), 18 files, 128 steps |
| Check the scenarios | Run 2026-11-21, last after the independent reviews' revision | [How the jobs were checked](#how-the-jobs-were-checked) |
| Walk the paths with readers who did not write them | Walked 2026-11-21 by three readers, one in each seat, a second pass by a fourth after the revision, and a walk of job 18 by a fifth | Proposal, [Walking the paths](agent-os.proposal.md#walking-the-paths) |
| Independent review of the proposal | Reviewed 2026-11-21 by two reviewers and revised; a focused pass then checked the fixes | [How it was reviewed](#how-it-was-reviewed) |
| The owner cuts, adds and ranks the jobs, and answers the proposal's [For the owner](agent-os.proposal.md#for-the-owner) | Three questions answered 2026-11-21; the ranking and nine questions remain | Proposal, [Decisions](agent-os.proposal.md#decisions) |
| M0: stand it up | Not started; needs the owner's go | Proposal, [M0](agent-os.proposal.md#m0-stand-it-up) |
| M1: validation in a machine | Not started | Proposal, [M1](agent-os.proposal.md#m1-mvp-validation-in-a-machine) |
| M2: warm starts | Not started | Proposal, [M2](agent-os.proposal.md#m2-warm-starts) |
| M3 to M5 | Direction only, with no scenarios and no exit. M3 is specified when M1 exits, M4 when M3 exits and M5 when M4 exits | Proposal, [Milestones](agent-os.proposal.md#milestones) |

## How the jobs were checked

On 2026-11-21, after `pnpm -F "@lushly-dev/afd-cli..." build`, again after the walks' revision,
after job 18 was added and revised, and last after the independent reviews' revision:

- `node packages/cli/dist/bin.js scenario validate docs/features/proposed/agent-os/scenarios`:
  all 18 files parse.
- The dry-run check of [jobs first](../../../../.claude/skills/afd/references/jobs-first.md#checking-without-a-server)
  (`validateScenario` with `checkFixtures: true`): no errors in 18 files and 128 steps.
- The coverage report (`scenarioCoverage`), given the 15 drafted commands, Umbel's `event-list`
  and the 19 error codes: 15 of 16 commands used (`run-settle` is called only by the host's own
  supervisor), all 19 error codes used, and no scenario calls an undrafted command.

Nothing runs the scenarios: no host exists. No CI job reads scenario files under `docs/`.

## How the paths were walked

On 2026-11-21 three readers (Opus 5.5 at medium effort, read-only) each got the proposal, the
scenario files and one seat's task from
[jobs first](../../../../.claude/skills/afd/references/jobs-first.md#walking-the-paths), without
the drafting session's conclusions. The people's seat read the lane's code, the job list's seat
drafted its own jobs from the owner's words before opening the proposal, and the calling agent's
seat read Umbel's code and documents. The drafting session spot-checked the claims it acted on in
the code. That walk was of the first draft's fourteen jobs, and its revision added three jobs (15
to 17) and two commands.

A fourth reader (the same model and effort, read-only) then made a second pass over the revision
in all three seats, checking the revised statements against Umbel's and the lane's code and
walking the new and reworded jobs. Its findings were applied without adding a job or a command,
and the scenario checks were run again afterwards.

The owner's answer of 2026-11-21 on repairing a failure that only happens on Linux added job 18.
A fifth reader (the same model and effort, read-only) walked it in all three seats against the
factory's code and the cell brief. It found that a cell had no way to learn the commit, base
or steps of the lane's failed run; the job and the proposal were revised without adding a
command, and the checks were run again.

## How it was reviewed

On 2026-11-21 two fresh reviewers read the whole change read-only, with the acceptance criteria
and without the drafting session's reasoning: Opus 5.5 and GPT-6.2 Astra, both at high effort.
Each traced the proposal's statements about existing code and ran the scenario checks. Their
blockers were checked against the code and fixed, and the proposal's
[Walking the paths](agent-os.proposal.md#walking-the-paths) lists what changed and what was
declined. The revision added one refusal (`RUN_NOT_CONFIGURED`) and no job or command. A
focused pass by Opus 5.5 at high effort then checked the fixes. Its verdict was to revise:
sixteen of seventeen findings were settled, two passages still gave the old checkpoint rule, and
it raised five smaller notes. All were corrected, and the same reviewer confirmed that.

## What is not verified

The proposal's [Status](agent-os.proposal.md#status) lists what nobody has measured, and M0
settles it. The rows of [What Umbel and AFD need](agent-os.proposal.md#what-umbel-and-afd-need)
come from one reader's reading of Umbel's code, spot-checked and not built against.

## Follow-ups not yet issues

| Date | Raised by | Follow-up |
| --- | --- | --- |
| 2026-11-21 | The drafting session | Readers of the repository for this proposal reported eleven stale statements in READMEs, the parity document, a changelog and a proposal. Corrected the same day, at the owner's request: each was checked against the code and status files, with seven more places that stated the same facts. The ones under `docs/` merged with this proposal in [#1912](https://github.com/lushly-dev/afd/pull/1912); the ones inside units are in a second pull request. Left as it is: a completed feature's archive (`complete/declared-context-fields/STATUS.md`). The owner kept host-verified confirmation for C++ at N/A in the parity document, 2026-11-21 |

## Session log

| Date | Session | What |
| --- | --- | --- |
| 2026-11-21 | The drafting session | Drafted the proposal and its jobs from the owner's decisions, had them walked in two passes and revised. Wrote the owner's three further answers in, added job 18 and had it walked. Two independent reviews and their revision. Corrected the stale statements found on the way |
