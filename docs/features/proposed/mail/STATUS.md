# Mail: status

Read this before the [proposal](mail.proposal.md). It records exactly what is done and what is
not, so an agent never has to scan the code to learn what is current. It follows the shape of the
[Umbel status](../../../../endpoints/umbel/docs/STATUS.md).

## How to keep this file

- "Done" means merged to `main` with evidence linked. Anything else is "in progress" or "open",
  with what remains spelled out.
- Record how you verified it, the command or check, and the absolute date.
- Write down follow-ups that are not yet issues, with the date and who raised them. Link the issue
  when one exists.
- Never delete history. Mark an entry superseded and point to what replaced it.
- The work spans two areas, each with its own ledger. What mail needs from Umbel is in the
  [Umbel status](../../../../endpoints/umbel/docs/STATUS.md), and what it needs from Loam is in
  the [Loam status](../../../../endpoints/loam/docs/STATUS.md). This file holds the plan's steps
  and points to those for the detail; when they disagree, the area's ledger wins.

## Status block

- **State:** proposed. Nothing is implemented and nothing is approved.
- **Last verified:** 2026-11-10 against `main` at `880a18c4`. Read: the Umbel README, architecture
  (principles, host services catalog, interfaces), proposal, decisions (D18, D150, O1) and status;
  the Loam proposal, decisions (D20, D41, D56, D95), phase 6 specification (section 10.4) and
  status; the feature index. After the review: Umbel's decisions D42, D54, D82, D115 and D127, and
  its phase 5 specification's amendments on mode `none` and tasks. No code was built or run.
- **Done:** the [proposal and plan](mail.proposal.md), written 2026-11-10 and revised the same day after one
  independent review (verdict: revise; five blockers and eleven improvements, all applied) and a
  focused check of the fixes (verdict: approve; three precision fixes, applied).
- **Not done:** the owner's answers to the proposal's section 11; every step below.
- **Follow-ups:** the [table at the end](#follow-ups-not-yet-issues).

## Steps

| Phase | Step | State |
| --- | --- | --- |
| 0 | 0.1 Mailbox census | Not started; waits on the owner's go |
| 0 | 0.2 Provider probe | Not started |
| 0 | 0.3 Store measurement | Not started |
| 0 | 0.4 The owner's decision | Not started |
| A | The `mail` plugin specification and a proposal for each accepted need | Not started; waits on phase 0 |
| B to F | The connector and log; relationships and stream stories; reversible commands and send; records, extractors and reply sets; the Loam app | Not started |

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-10 | Design discussion with the owner | The owner's answers to the proposal's section 11: go on to phase 0, plugin or server, whether mail answers Umbel's O1, where it lives, the name, Gmail through its API or IMAP first, and the phase 0 thresholds | Open, owner's decision |
| 2026-11-10 | Design discussion with the owner | Umbel's needs U1 to U8 are recorded in the Umbel status; none is accepted or designed | Open |
| 2026-11-10 | Design discussion with the owner | Loam's needs L1 to L7 are recorded in the Loam status; none is accepted or designed | Open |
| 2026-11-10 | Design discussion with the owner | Audit the candidate crates' licences and maintenance in the plugin specification; `mail-parser`'s licence is not classified by GitHub | Open |
| 2026-11-10 | Design discussion with the owner | Read iCloud's IMAP capabilities from the server in step 0.2; no source checked lists them | Open |
| 2026-11-10 | Independent review | Check in step 0.2 which sign-in Gmail accepts for the census, and whether a Google OAuth client in testing status expires its refresh tokens weekly; neither was verified | Open |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-10 | Design discussion with the owner | Six open-source mail projects and two commercial engines read as references; research on mail volume, trust in AI summaries, attacks through mail and agent identity; the owner's direction recorded (iCloud and Gmail first, commands before interface, a client that works without a model, stories and reply sets, a Loam app among several). The proposal and plan, this file and the feature index row written; needs recorded in the Umbel and Loam status files. One independent review (revise), its findings checked against the repository and applied: person-only commands over MCP (U8, L7), tasks on a local deployment (U4), the five effects, the scale profiles, and the needs of each phase. Planning only: no code |
