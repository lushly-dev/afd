# Pointing: status

Read this before the [proposal](pointing.proposal.md). It records exactly what is done and what is not, so an
agent never has to scan the code to learn what is current. It follows the shape of the
[Patterns status](../patterns/STATUS.md).

## How to keep this file

- "Done" means merged to `main` with evidence linked. Anything else is "in progress" or "open",
  with what remains spelled out.
- Record how you verified it, the command or check, and the absolute date.
- Write down follow-ups that are not yet issues, with the date and who raised them. Link the issue
  when one exists.
- Never delete history. Mark an entry superseded and point to what replaced it.

## Status block

- **State:** scaffold. Written 2026-11-13 against `main` at `e5d683a8`. Not reviewed, not
  approved.
- **Epic:** [#1110](https://github.com/lushly-dev/afd/issues/1110). Its checklist mirrors the steps below; this file
  stays the source of truth.
- **Done:** the problem, what exists today and draft jobs.
- **Not done:** the owner's ranking of the jobs, drafted commands, scenario files, the checks,
  reader walks, a full review and any design. One independent reader reviewed the scaffold.
- **Order:** the owner cuts and ranks the draft jobs before commands are drafted. That is an
  order chosen for these early proposals; the [jobs-first guide](../../../../.claude/skills/afd/references/jobs-first.md)
  puts the owner's ranking after the scenarios and the reader walks, and they still follow.
- **Follow-ups:** the [table below](#follow-ups-not-yet-issues).

## Steps

| Step | State | Evidence |
| --- | --- | --- |
| Scaffold: problem, what exists, draft jobs | Done 2026-11-13 | [`pointing.proposal.md`](pointing.proposal.md) |
| Open the epic | Done 2026-11-13 | Epic [#1110](https://github.com/lushly-dev/afd/issues/1110) |
| The owner cuts, adds and ranks the jobs and answers the open questions | Not started | Proposal, sections 3 and 5 |
| Draft the commands against the ranked jobs | Not started | |
| Write each job as a scenario and run the checks | Not started | [Jobs first](../../../../.claude/skills/afd/references/jobs-first.md) |
| Walk the paths with readers who did not write them | Not started | Three seats |
| Independent review | Scaffold reviewed 2026-11-13 (one pass, findings fixed); a full review after drafting not started | |

## What was read to write it

Surveyed 2026-11-13 at `e5d683a8` by another agent, read-only; its findings are in the proposal's
section 2 with a file for each claim. The ideas in the proposal's section 4 come from the owner's earlier editor work, read for ideas only; no text or code was taken from it.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-13 | Scaffold survey | The Specimen host reports not-found and ambiguous targets as one untyped error (`foundations/specimen/host/src/page.rs:404`). The Patterns proposal drafts `TARGET_NOT_FOUND` and `TARGET_AMBIGUOUS` | Open; proposal question 5 |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-13 | Scaffold | After the [Patterns](../patterns/patterns.proposal.md) proposal, the owner agreed to four follow-on proposals from the same discussion: Design Decisions, Screens from Jobs, Pointing and Scales. This scaffold was written from a survey of the code, reviewed once by an independent reader, and committed with its epic |
