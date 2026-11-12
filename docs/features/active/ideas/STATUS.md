# Ideas: status

Read this before the [proposal](ideas.proposal.md). It records exactly what is done and what is
not, so an agent never has to scan the code to learn what is current. It follows the shape of the
[Umbel status](../../../../endpoints/umbel/docs/STATUS.md).

## How to keep this file

- "Done" means merged to `main` with evidence linked. Anything else is "in progress" or "open",
  with what remains spelled out.
- Record how you verified it, the command or check, and the absolute date.
- Write down follow-ups that are not yet issues, with the date and who raised them. Link the issue
  when one exists.
- Never delete history. Mark an entry superseded and point to what replaced it.
- What Ideas needs from Umbel is specified in Umbel's own documents, and progress on it is in the
  [Umbel status](../../../../endpoints/umbel/docs/STATUS.md). This file holds the plan's steps and
  points there for the detail; when they disagree, the area's ledger wins.
- The owner's content never enters this repository. A measurement on his corpus is recorded here
  as counts, rates and the tools that produced them. Fixtures and examples are invented.
- **Questions for the owner are queued**, not asked one at a time
  ([the queue](#questions-for-the-owner)). Work goes on past a question that has a
  recommendation, and the row says so. Work stops only at what the owner alone can do or decide.

## Status block

- **State:** active; phase 0 under way. The owner merged the proposal's third revision
  ([#1012](https://github.com/lushly-dev/afd/pull/1012)) on 2026-11-12 UTC, answered the questions
  that stood before phase 0, and directed that the work carry on through its phases, with
  questions queued (the proposal's [section 11](ideas.proposal.md#11-for-the-owner)). Nothing is
  implemented.
- **Last verified:** 2026-11-11 against `main` at `bcc1280f`. The 29 scenario files parse and pass
  the runner's dry-run validation, and every one of the 51 draft commands and 5 error codes is
  used by a job (`afd scenario validate`, and the coverage snippet in
  [`jobs-first.md`](../../../../.claude/skills/afd/references/jobs-first.md)). No code was built
  or run.
- **Done:** the [proposal and plan](ideas.proposal.md) and its [scenarios](scenarios/): first
  version in [#990](https://github.com/lushly-dev/afd/pull/990), and the revision after two walks
  of its paths in [#1012](https://github.com/lushly-dev/afd/pull/1012). Reviews are in the
  [session log](#session-log).
- **Not done:** every step below that is not marked done.
- **Follow-ups:** the [table at the end](#follow-ups-not-yet-issues).

## Steps

The plan's [section 8](ideas.proposal.md#8-phase-0-measure-before-specifying) defines phase 0
and [section 9](ideas.proposal.md#9-steps) the rest.

| Phase | Step | State |
| --- | --- | --- |
| 0 | 0.1 The unit and the types | Not started |
| 0 | 0.2 Matching | Not started |
| 0 | 0.3 Questions answered from ideas | Not started |
| 0 | 0.4 Review load, and whether attested can be trusted | Not started |
| 0 | 0.5 Themes | Not started |
| 0 | 0.6 Framings in Violet | Not started |
| 0 | 0.7 Records or documents | Not started |
| 0 | 0.8 The owner's walk of the jobs | Not started |
| 0 | 0.9 Confirming from the owner's harnesses | Not started; needs the owner at a harness |
| 0 | 0.10 Finding the store with no skill | Not started |
| A | A1 P1 as amendments to Umbel's architecture and decision log | Not started |
| A | A2 Host specifications for P2, P3 and P15 to P18 | Not started |
| A | A3 The plugin's specification, with the scenarios moved beside it | Not started |
| A | A4 P14 and the relay part of P15 as AFD changes | Not started |
| B | Matching in the host | Not started |
| C | C1 to C5, the loop, hosted | Not started; C1 needs the first instance (question Q1) |
| D | D1 to D5, the rest of the slice | Not started |
| E to G | The hierarchy: specification, engine and host, the plugin whole | Not started; waits for the owner's answer on whether it is wanted |
| H | After the exit | Not started |

## Questions for the owner

Kept in the order they will be needed. A row leaves this table when it is answered, and its
answer is recorded in the proposal's section 11 and in the session log.

| | Question | Recommendation | Needed by | State |
| --- | --- | --- | --- | --- |
| Q1 | The first instance: which machine it runs on, which authorization server it signs in through, and which directory on that machine holds the first archive | One machine with the embedded store and a persistent disk (agreed). The other two have no recommendation yet; one is due with the plugin's specification, step A3 | Step C1's hosted exit. The loop is developed over stdio until then | Open |
| Q2 | Confirm, or overturn, the answers taken on recommendation: questions 1 to 6, 8, 9, 12, 13 and 15 of the proposal's section 11 | Each as the proposal recommends | Nothing waits on it. Each is settled for good when the specification that depends on it is approved | Open |
| Q3 | Scope of P9 to P12: this plan's last phase, or plans of their own | None yet | Phase H | Open |

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-11 | Jobs-first process | `afd scenario validate` only parses, and there is no command for coverage against a command list, so the check is a library snippet. No CI job reads scenario files under `docs/` | Open. Part of P14 (step A4) |
| 2026-11-11 | Second walk | The runner resolves a step reference only in a step's input, so no expectation can use one | Open. Part of P14 (step A4) |
| 2026-11-11 | Independent review of the revision | The last set of fixes in #1012, after the focused pass, had no independent pass | Open. The plugin's specification (step A3) re-reads every command, and its review covers them |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-11 | Design discussion with the owner | The proposal and plan written against `main` at `8ef7aa68`, with twenty jobs as AFD scenarios, and merged as [#990](https://github.com/lushly-dev/afd/pull/990). Revised twice the same day on the owner's direction before that merge: matching by meaning, a thin slice first, review by use, themes, a hosted instance, and jobs as the benchmark |
| 2026-11-11 | The walks | Three fresh readers walked the plan's paths from three seats and found seven faults that broke a job. The owner agreed five decisions. The revision added jobs and commands, so three new readers walked it again and found faults in what the first walk had produced, four of them wrong claims about the host; each host claim was then checked in the host's code at `069af7b6`. An independent review found six blockers and eighteen improvements, all fixed, and a focused pass found one more contradiction, also fixed. Merged by the owner as [#1012](https://github.com/lushly-dev/afd/pull/1012): 29 jobs, 369 steps, 51 draft commands |
| 2026-11-11 | The owner's answers | The owner confirmed the second walk's changes, answered questions 7, 11 and 14 as recommended, and directed that the work carry on through its phases with questions queued. Recorded in the proposal's section 11. The feature moved from `proposed/` to `active/`, and this file was written |
