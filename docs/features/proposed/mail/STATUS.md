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

- **State:** proposed. Nothing is implemented and nothing is approved. The owner decided the shape
  on 2026-11-10: a Loam plugin with an engine of its own, not an Umbel plugin, with Umbel optional.
- **Last verified:** 2026-11-10 against `main` at `880a18c4`. Read: `packages/rust` (its README,
  `Cargo.toml` features and the command metadata in `src/commands.rs`) and `spec/command-metadata.md`
  ("Approvals"); the Loam proposal, architecture (sections 8 and 9), decisions (D20, D41, D56, D63,
  D95, D100, D106), the phase 1 specification (sections 2 and 7), the phase 6 specification
  (section 10.4) and status; the Umbel README, architecture (principles, section 5) and decisions
  (D106, D115); the MCP Tasks proposal; the feature index. No code was built or run.
- **Done:** the [proposal and plan](mail.proposal.md): its first version merged 2026-11-10 in
  [#969](https://github.com/lushly-dev/afd/pull/969). The revision of the same day is done when its
  pull request merges. Reviews are in the [session log](#session-log).
- **Not done:** the owner's answers to the proposal's section 11; every step below.
- **Follow-ups:** the [table at the end](#follow-ups-not-yet-issues).

## Steps

| Phase | Step | State |
| --- | --- | --- |
| 0 | 0.1 Mailbox census | Not started; waits on the owner's go |
| 0 | 0.2 Provider probe | Not started |
| 0 | 0.3 Store measurement | Not started |
| 0 | 0.4 The owner's decision | Not started |
| A | The engine's specification | Not started; waits on phase 0 |
| B to E | The connector and log; relationships and stream stories; reversible commands and send; records, extractors and reply sets | Not started; need no other area |
| F | The Loam plugin: the mount and the native app | Not started; needs Loam's phases 5 and 6 |
| G | Composition with a connected Umbel | Not started |

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-10 | Design discussion with the owner | The owner's answers to the proposal's section 11: go on to phase 0, plugin or server, whether mail answers Umbel's O1, where it lives, the name, Gmail through its API or IMAP first, and the phase 0 thresholds | Partly closed 2026-11-10: plugin or server, and O1, are settled by the owner's direction (the next row). Open: phase 0, where it lives, the name, Gmail's API or IMAP first, the thresholds and, added with the revision, how the engine gets installed |
| 2026-11-10 | Design discussion with the owner | Whether mail is an Umbel plugin or a server of its own | Closed 2026-11-10 by the owner: a Loam plugin with an engine of its own; Umbel optional (the proposal's M1, M10 and M11) |
| 2026-11-10 | Design discussion with the owner | Umbel's needs U1 to U8 are recorded in the Umbel status; none is accepted or designed | Superseded 2026-11-10: the revision asks nothing of Umbel, and the Umbel status rows are marked superseded |
| 2026-11-10 | Design discussion with the owner | Loam's needs L1 to L7 are recorded in the Loam status; none is accepted or designed | Open; the list was revised 2026-11-10 with the proposal |
| 2026-11-10 | Review of the revision | AFD's needs: a carrier for approval evidence from a trusted MCP client to a mounted server (A1), and tasks in the TypeScript client (A2). Neither is proposed yet; A2 is the MCP Tasks proposal's next phase | Open |
| 2026-11-10 | Design discussion with the owner | Audit the candidate crates' licences and maintenance in the plugin specification; `mail-parser`'s licence is not classified by GitHub | Open; now for the engine's specification |
| 2026-11-10 | Design discussion with the owner | Read iCloud's IMAP capabilities from the server in step 0.2; no source checked lists them | Open |
| 2026-11-10 | Independent review | Check in step 0.2 which sign-in Gmail accepts for the census, and whether a Google OAuth client in testing status expires its refresh tokens weekly; neither was verified | Open |
| 2026-11-10 | Revision | Decide in the engine's specification how it gets a command line: its own, or `@lushly-dev/afd-cli` over MCP; the `afd` crate has none, and adding one there would be a third AFD need | Open |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-10 | Design discussion with the owner | Six open-source mail projects and two commercial engines read as references; research on mail volume, trust in AI summaries, attacks through mail and agent identity; the owner's direction recorded (iCloud and Gmail first, commands before interface, a client that works without a model, stories and reply sets, a Loam app among several). The proposal and plan, this file and the feature index row written; needs recorded in the Umbel and Loam status files. One independent review (revise), its findings checked against the repository and applied: person-only commands over MCP (U8, L7), tasks on a local deployment (U4), the five effects, the scale profiles, and the needs of each phase. Planning only: no code |
| 2026-11-10 | Revision on the owner's direction | The first version merged as [#969](https://github.com/lushly-dev/afd/pull/969). The owner, who had also said he plans deck and video apps, that Violet may get a Loam app and that each instance chooses its apps, directed that mail is a Loam plugin, not an Umbel plugin: Umbel is primarily an MCP harness for tools shared across harnesses and its instances will typically be remote, Loam is for local tools with interfaces people work in, and a Loam app does not take Umbel as its core; mail may use Umbel's features when an instance is connected. The proposal rewritten to that shape: an engine of its own on the `afd` crate, mounted by Loam, a native app over it, Umbel optional, composed by the caller and sharing no code with the engine. The eight needs on Umbel's host dropped, and the Umbel status left unchanged; Loam's needs revised to L1 to L7. One independent review of the revision (revise; three blockers and nine improvements, all applied): the approval route (L7, and AFD's A1 and A2), Loam's rules against a plugin adding its own server (L5, D56, D63, D106), and the wording of what the owner decided. A focused check of those fixes (revise; two narrow blockers and one improvement, applied): no option to share Umbel's command line, and the full list of Loam rules an installing plugin would need amended. Planning only: no code |
