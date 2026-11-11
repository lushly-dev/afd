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
- The interface is a Loam plugin, and what mail needs from Loam is in the
  [Loam status](../../../../endpoints/loam/docs/STATUS.md). This file holds the plan's steps and
  points there for the detail; when they disagree, the area's ledger wins.

## Status block

- **State:** active; phase 0 in progress. The owner answered the proposal's section 11 on
  2026-11-10 and said to go on. Nothing of the engine or the app is implemented.
- **Last verified:** 2026-11-10 against `main` at `880a18c4`. Read: `packages/rust` (its README,
  `Cargo.toml` features and the command metadata in `src/commands.rs`) and `spec/command-metadata.md`
  ("Approvals"); the Loam proposal, architecture (sections 8 and 9), decisions (D20, D41, D56, D63,
  D95, D100, D106), the phase 1 specification (sections 2 and 7), the phase 6 specification
  (section 10.4) and status; the Umbel README, architecture (principles, section 5) and decisions
  (D106, D115); the MCP Tasks proposal; the feature index. No code was built or run.
- **Done:** the [proposal and plan](mail.proposal.md): its first version merged 2026-11-10 in
  [#969](https://github.com/lushly-dev/afd/pull/969), and its revision to a Loam plugin the same day
  in [#973](https://github.com/lushly-dev/afd/pull/973). Reviews are in the
  [session log](#session-log).
- **Not done:** every step below that is not marked done.
- **Follow-ups:** the [table at the end](#follow-ups-not-yet-issues).

## Steps

| Phase | Step | State |
| --- | --- | --- |
| 0 | 0.1 Mailbox census | In progress: iCloud run 2026-11-10 ([results](prototype/README.md#the-icloud-run)): Q1 3.9%, under the 1 in 10 that leaves extractors out of the first specification; Q2 98.4%, met. One mailbox of GitHub notifications is 93% of the account; without it Q1 is 12.1%, between the thresholds, and Q2 is 60.9%, not met. Gmail run 2026-11-11: 17 937 messages, Q1 3.7%, Q2 85.3%, met. Awaiting the owner's decision in step 0.4 |
| 0 | 0.2 Provider probe | In progress: iCloud's capabilities read from the server (CONDSTORE, QRESYNC and IDLE among them; in `prototype/icloud.counts.json`). Gmail's IMAP capabilities read too (CONDSTORE, IDLE and MOVE, not QRESYNC), and an app password signs in. Gmail's API, which the owner chose to build on first, is not yet probed |
| 0 | 0.3 Store measurement | Run 2026-11-10 with a default shape: every Q3 threshold met at 100 000 and 500 000 messages ([results](prototype/README.md#the-store-measurement)). Run again 2026-11-11 with the iCloud census's shape: every threshold met |
| 0 | 0.4 The owner's decision | Not started |
| A | The engine's specification | Not started; waits on phase 0 |
| B to E | The connector and log; relationships and stream stories; reversible commands and send; records, extractors and reply sets | Not started; need no other area |
| F | The Loam plugin: the mount and the native app | Not started; needs Loam's phases 5 and 6 |
| G | Composition with a connected Umbel | Not started |

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-10 | Design discussion with the owner | The owner's answers to the proposal's section 11: go on to phase 0, plugin or server, whether mail answers Umbel's O1, where it lives, the name, Gmail through its API or IMAP first, and the phase 0 thresholds | Closed 2026-11-10: the owner answered every question (the proposal's section 11 lists six decisions and one direction). Nothing is open for the owner until phase 0's numbers are in |
| 2026-11-10 | Design discussion with the owner | Whether mail is an Umbel plugin or a server of its own | Closed 2026-11-10 by the owner: a Loam plugin with an engine of its own; Umbel optional (the proposal's M1, M10 and M11) |
| 2026-11-10 | Design discussion with the owner | Umbel's needs U1 to U8 are recorded in the Umbel status; none is accepted or designed | Superseded 2026-11-10: the revision asks nothing of Umbel, and the Umbel status rows are marked superseded |
| 2026-11-10 | Design discussion with the owner | Loam's needs L1 to L7 are recorded in the Loam status; none is accepted or designed | Open; the list was revised 2026-11-10 with the proposal, and L8 (a place and a CI lane for plugins) added with the owner's answers. The owner has directed L5 and asked for L8; Loam specifies them |
| 2026-11-10 | Review of the revision | AFD's needs: a carrier for approval evidence from a trusted MCP client to a mounted server (A1), and tasks in the TypeScript client (A2). Neither is proposed yet; A2 is the MCP Tasks proposal's next phase | Open |
| 2026-11-10 | Design discussion with the owner | Audit the candidate crates' licences and maintenance in the plugin specification; `mail-parser`'s licence is not classified by GitHub | Open; now for the engine's specification |
| 2026-11-10 | Design discussion with the owner | Read iCloud's IMAP capabilities from the server in step 0.2; no source checked lists them | Done 2026-11-10: read by the census, in `prototype/icloud.counts.json` |
| 2026-11-10 | Independent review | Check in step 0.2 which sign-in Gmail accepts for the census, and whether a Google OAuth client in testing status expires its refresh tokens weekly; neither was verified || Open in part: an app password signed in for the census 2026-11-11; the refresh-token question is not checked |
| 2026-11-10 | Revision | Decide in the engine's specification how it gets a command line: its own, or `@lushly-dev/afd-cli` over MCP; the `afd` crate has none, and adding one there would be a third AFD need | Open |
| 2026-11-11 | The owner, on the census results | Requirement from the owner: act on a whole mailbox or a whole selection at once, such as deleting every message in a folder. Apple Mail deletes only the few hundred messages it has loaded, which makes emptying a folder of 300 000 nearly impossible. For the engine's specification: a selection is defined by a query, not by the rows on screen; the command reports the count before it runs, runs as a task, and moves to the trash where the provider allows so that it can be undone. The owner is keeping his folder of 283 000 GitHub messages as the test for large folders and, later, for this delete; it also holds the messages iCloud lists and does not return | Open |
| 2026-11-11 | The owner, on the census results | The owner's account was flooded with mail in 2024 or 2025 to bury the alerts for a card fraud, and has had more spam since. Proposed for the engine's specification, not yet confirmed by the owner: mail from a sender with a history stays above a burst of strangers; a burst of first-time senders becomes one story; and the burst itself is flagged as a possible sign of fraud. The census skips Junk and Trash, so it does not measure this; count Junk apart in the next runs | Open |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-10 | Design discussion with the owner | Six open-source mail projects and two commercial engines read as references; research on mail volume, trust in AI summaries, attacks through mail and agent identity; the owner's direction recorded (iCloud and Gmail first, commands before interface, a client that works without a model, stories and reply sets, a Loam app among several). The proposal and plan, this file and the feature index row written; needs recorded in the Umbel and Loam status files. One independent review (revise), its findings checked against the repository and applied: person-only commands over MCP (U8, L7), tasks on a local deployment (U4), the five effects, the scale profiles, and the needs of each phase. Planning only: no code |
| 2026-11-10 | Revision on the owner's direction | The first version merged as [#969](https://github.com/lushly-dev/afd/pull/969). The owner, who had also said he plans deck and video apps, that Violet may get a Loam app and that each instance chooses its apps, directed that mail is a Loam plugin, not an Umbel plugin: Umbel is primarily an MCP harness for tools shared across harnesses and its instances will typically be remote, Loam is for local tools with interfaces people work in, and a Loam app does not take Umbel as its core; mail may use Umbel's features when an instance is connected. The proposal rewritten to that shape: an engine of its own on the `afd` crate, mounted by Loam, a native app over it, Umbel optional, composed by the caller and sharing no code with the engine. The eight needs on Umbel's host dropped, and the Umbel status left unchanged; Loam's needs revised to L1 to L7. One independent review of the revision (revise; three blockers and nine improvements, all applied): the approval route (L7, and AFD's A1 and A2), Loam's rules against a plugin adding its own server (L5, D56, D63, D106), and the wording of what the owner decided. A focused check of those fixes (revise; two narrow blockers and one improvement, applied): no option to share Umbel's command line, and the full list of Loam rules an installing plugin would need amended. Planning only: no code |
| 2026-11-10 | The owner's answers | The owner answered section 11: go on to phase 0; mail lives in this repository, organized so plugins do not bloat it or each other's CI; the name is Mail, Loam Mail in full, with `loam_mail` as its unique identifier; Gmail through its API first; the thresholds as written; and, as a direction, Loam's rules should change so that a plugin can bring an engine. Recorded in the proposal (M13, M14, L5, L8, section 11) and in the Loam status. The feature moved from proposed to active. Step 0.1's design refined: headers and structure for every message, bodies sampled under a byte cap, because Gmail limits IMAP downloads to 2 500 MB a day. The census tool written, with tests. One independent review (revise; four blockers and its improvements, all applied): a search line too long for imaplib on a large mailbox, Q1's denominator, a dropped connection silently losing the rest of a mailbox, and two rows that attributed more to the owner than he said. A focused check of the fixes (revise; two blockers, applied with a test for each): a mailbox that could not be listed, and structures that could not be fetched, each left the run marked complete |
| 2026-11-10 | Phase 0, step 0.3 | The store harness written (`prototype/store-bench`, Rust, on the `rusqlite` and `tantivy` versions Umbel pins) and run at 100 000 and 500 000 synthetic messages with a default shape. At 500 000: import 11 443 messages a second, a list of 50 threads in 7.36 ms and a search in 1.82 ms at the 95th percentile, and 1.61 times the messages' bytes on disk; every threshold met. Not independently reviewed. The census was not run: a request for the owner's iCloud address went unanswered for half an hour |
| 2026-11-11 | Phase 0, steps 0.1 to 0.3 | The census ran on the owner's iCloud account, whole and complete: 296 697 messages read. Q1 is 3.9% and Q2 is 98.4%. The server listed 8 259 more messages than it returned, all in one mailbox; a second pass found the same ones, and the owner deleted nothing, so the tool no longer calls them deleted (`listed_not_returned`, tool version 4). The engine's sync must tolerate listed messages that never arrive. The store measurement repeated with the census's shape at 500 000 messages: every threshold met. The census's rewording and this run's numbers were not independently reviewed. Gmail is not yet run |
| 2026-11-11 | Phase 0, step 0.1 | The owner identified the largest mailbox, 93% of the account, as GitHub mail filed by an automation, which he means to delete. The census gained `--skip-over` (tool version 5, with a test) and ran again without that mailbox: 21 248 messages, complete, none listed and not returned. Q1 is 12.1%, between its thresholds; Q2 is 60.9%, under its eight in ten. Which run describes the mail the client is for is the owner's decision in step 0.4. Not independently reviewed |
| 2026-11-11 | Phase 0, step 0.1 | The census ran on the owner's Gmail account: 17 937 messages, complete, none listed and not returned. Q1 is 3.7%, under one in ten; Q2 is 85.3%, met. Mail there rose from 1 536 messages in 2024 to 4 964 in 2025. All three runs are in the prototype's README. Not independently reviewed |
