# Mail: proposal and plan

A mail core that records what a person's mail means, who it is really from and what an agent may
do about it. It is a Loam plugin with an engine of its own: a Rust AFD server that syncs, parses
and indexes mail on the person's machine, mounted by Loam, with a native Loam app over it. The
engine calls no model; models and people propose, and it verifies and stores. An Umbel instance,
when one is connected, adds knowledge, memory and context and is never required.

"Mail" is a working title. The name is an open decision ([section 11](#11-for-the-owner)).

## Status

- **State:** proposed. Written 2026-11-10 against `main` at `880a18c4`, from a design discussion
  with the owner that day. The first version merged as
  [#969](https://github.com/lushly-dev/afd/pull/969); this one revises it the same day on the
  owner's direction ([Revision](#revision-of-2026-11-10)). Nothing is implemented, and nothing is
  approved beyond that direction.
  [STATUS.md](STATUS.md) tracks progress.
- **Verified:** the facts in [What exists today](#2-what-exists-today) about this repository were
  read on `main` at `880a18c4`, in the documents and files each row names. No Rust or TypeScript
  was built or run. The facts about other projects were read on 2026-11-10 from their public
  repositories (README, licence file and repository metadata only). The external claims in
  [Evidence](#3-evidence) come from the sources listed there, each with its limit.
- **Not verified:** which IMAP extensions iCloud's server offers; whether Gmail still accepts an
  app password over IMAP; whether a Google OAuth client left in testing status expires its
  refresh tokens after a week; whether a client that keeps Gmail data only on the person's machine
  is exempt from Google's security assessment; the licence of Stalwart's `mail-parser` crate,
  which GitHub does not classify. Phase 0 and the engine's specification settle these.
- **Reviewed:** the first version had one independent review (revise; five blockers and eleven
  improvements, all applied) and a focused check of the fixes (approve). The revision's reviews
  are recorded in [STATUS.md](STATUS.md).
- **Next:** the owner's answers in [section 11](#11-for-the-owner), then
  [phase 0](#8-phase-0-measure-before-specifying).

### Revision of 2026-11-10

The first version made the core an Umbel plugin. The owner's direction the same day: Umbel is
primarily an MCP harness, for distributed tools that many harnesses share, run locally only in
some developer setups, so its instances will typically be remote; Loam is for local tools with
interfaces people work in. A Loam app does not take Umbel as its core. Mail is a Loam plugin, which
may use Umbel's features when an instance is connected. This version follows that. What the review of the first version found supports it:
[section 10](#10-risks-and-open-points) keeps the record.

## 1. Problem and goal

A mail client's core today mirrors the server: folders, messages and flags, kept in step and
searched. Features that read mail for the person (summaries, categories, drafts, a chat panel) sit
on top of that mirror, and an agent with tools sits on top of those. Three things follow.

- **An agent that reads mail and can act is one crafted message from misuse.** Mail is the channel
  where anyone can put text in front of someone else's agent
  ([Evidence](#3-evidence), E2).
- **Understanding is thrown away or trusted blindly.** A summary is generated on demand and
  discarded, or shown with no way to check it. Few people fully trust one (E1).
- **Volume is handled a message at a time.** Most mail is written by machines from templates (E3),
  yet each message is read as if it were new.

**Goal.** A mail core in which:

1. every piece of text carries where it came from and whether a person would have seen it;
2. what the mail means is stored as typed records with their source passages, made once and
   re-made when the method improves;
3. an agent may act freely on what can be undone and never, by itself, on what cannot;
4. everything above works with no model at all, and gets better when one is present;
5. the mail stays on the person's machine unless they choose otherwise.

It is a good mail client's engine first. It serves the person at a terminal, any agent over MCP and
a Loam app from one set of commands.

## 2. What exists today

### In this repository

| Fact | Where it was read |
| --- | --- |
| The `afd` crate gives a Rust program the result and error types, a command registry that enforces each command's metadata, the journal, approval policies with signed tokens, and (feature `server`) an MCP server over Streamable HTTP and stdio | [`packages/rust/README.md`](../../../../packages/rust/README.md); `packages/rust/Cargo.toml` |
| A command's metadata in that crate includes `mutation`, `destructive`, `undoable`, `confirm_prompt`, an approval policy, a confirmation mode, `task`, `scopes` and an output budget | `packages/rust/src/commands.rs` |
| A command held by an approval policy fails with `APPROVAL_REQUIRED` and a signed token that the server's own middleware issues, under a key the application supplies, until trusted code retries the call with that token as context evidence. Evidence is never read from tool arguments, and the token reaches the approver outside the MCP result. Behind the MCP server, a command in host-verified confirmation mode is confirmed only by the host's `HumanRelay`; with `ApprovalRelay::McpElicitation` an approval-policy command asks the human behind an MCP client through a form elicitation | `packages/rust/README.md`, "Features"; [`spec/command-metadata.md`](../../../../spec/command-metadata.md), "Approvals" |
| Over MCP, an elicitation's answer is the client's, not a person's | [Umbel architecture](../../../../endpoints/umbel/docs/architecture.md), section 5, amended for D106 and D115 |
| Loam is an application shell for AFD apps. An app is native (an ES module rendering FAST-AF elements), a sandboxed view, or a mounted AFD server. A manifest with no `ui` is a headless app, valid in every kind | [Loam proposal](../../../../endpoints/loam/docs/proposal.md), "Three kinds of app"; [Loam phase 1 specification](../../../../endpoints/loam/docs/phases/1-app-contract/spec.md), section 2 |
| A browser host reaches a mounted instance only at a same-origin route, served by the hosted server or, on the desktop, by Tauri's Rust host over IPC. With nothing serving it the instance is `MOUNT_UNREACHABLE` | Loam phase 1 specification, [section 7.1](../../../../endpoints/loam/docs/phases/1-app-contract/spec.md#71-how-a-browser-reaches-an-instance) |
| Loam's desktop host mounts a server over HTTP, or as a stdio child it stops when the mount closes. A stdio instance is trusted code that only the workspace's owner may add (D56), and a shared provider-mode workspace refuses one (D95) | [Loam phase 6 specification](../../../../endpoints/loam/docs/phases/6-hosts/spec.md#104-mounts-over-the-rust-host); [Loam decisions](../../../../endpoints/loam/docs/decisions.md) |
| In Loam's copilot, tool results and mounted content are labelled untrusted, and every agent action follows an autonomy policy of suggest, ask or act (D41). Over MCP, approval evidence comes from trusted shell code, never from tool arguments | Loam decisions, D41; [Loam architecture](../../../../endpoints/loam/docs/architecture.md), section 8, "Security" |
| One app calls another's commands only under a `calls` grant, in phase 5. Calls to mounted servers are journaled but cannot be replayed | Loam architecture, section 9 and section 8, "Determinism and replay" |
| Loam's phases 0 to 2 have exited. Phase 3 (identity) and phase 6 (hosts) are in progress. Phases 4, 5 (bus, copilot, mounted servers), 7 and 8 are not started | [Loam status](../../../../endpoints/loam/docs/STATUS.md) |
| Umbel is a Rust host for capability plugins over MCP and a CLI, with knowledge, memory and context as first-party plugins. Every part of a result that came from a document is labelled `trust: "content"`, and every stored record carries a provenance envelope | [Umbel README](../../../../endpoints/umbel/README.md); Umbel architecture, principles 7 and 9 |
| Long-running commands as MCP tasks are an active AFD feature, with a Rust pilot; its TypeScript phase is not done. Over HTTP the Rust server offers tasks only with authorization or when its hook identifies callers. Progress notifications are not delivered for tasks | [MCP Tasks](../../active/mcp-tasks/mcp-tasks.proposal.md), its status and "Limits"; `packages/rust/README.md`, "Features" |
| A manifest names exactly one kind and cannot carry a mount's command line, location or credential: those are the deployer's entry. The app list is the deployer's file and no command writes an entry (D63); on the desktop the webview can write no command line (D106) | Loam phase 1 specification, section 2; Loam decisions, D63 and D106 |
| A call to a mounted server has a 60-second deadline, and over the desktop mount a message is at most 1 MiB and a reply 4 MiB | Loam phase 1 specification, section 7.3; Loam phase 6 specification, section 10.4 |

### Outside it

Six open-source mail projects were read as references. None is a base to fork: each brings an
engine in another language, a React interface, or a licence that would bind this work. As Loam does
(its D20), this proposal takes ideas from their public documentation and imports no code.

| Project | Core language | Licence | What it shows |
| --- | --- | --- | --- |
| Godwit | Go | Apache-2.0 | A local command API, skills, permissioned plugins, an MCP server whose sends wait for confirmation, and masking of text before a cloud model sees it |
| EmailOps | Rust, with Tauri | Apache-2.0 | One service layer under both the app and a command line, with one result envelope |
| Zero | TypeScript | MIT | Gmail, Microsoft and IMAP drivers behind one interface |
| Inbox Zero | TypeScript | AGPL-3.0 with added terms | Rules for triage, and a core split from its interface. Its added terms bar selling a derivative, so it is read for ideas only |
| MailCopilot | TypeScript, with Electron | AGPL-3.0 | Little; its public repository is a release mirror |
| GigaMail | Python | AGPL-3.0 | An MCP server with no model of its own, and tools tiered into reads, audited writes and writes behind approval |

Two self-hosted engines sold as headless email APIs, EmailEngine and RustMailer, are not open
source. Four of the six projects above were created in 2026, and they share most of one shape:
mail synced into a local database, a model that reads it and a way for agents to reach it. That
shape is not where this proposal competes.

## 3. Evidence

Each row is a claim this proposal leans on, its source and how far the source can carry it.
All were retrieved 2026-11-10.

| | Claim | Source | Limit |
| --- | --- | --- | --- |
| E1 | 55% of consumers act on an AI summary of an email without reading it, 10% fully trust such summaries and 15% have turned AI mail features off | Validity, consumer research, June 2026 | A vendor's survey; its method was not checked |
| E2 | A crafted email made Microsoft 365 Copilot send data out with no click (EchoLeak, CVE-2025-32711). A second flaw, in Copilot's email summaries (CVE-2026-26133), was patched in March 2026 | The EchoLeak paper (arXiv 2509.10540); Permiso Security's report | The second is the reporter's account |
| E3 | 87% of email traffic is automated | Hostinger, 2026, reported by TechRadar | A vendor's analysis with no published method |
| E4 | AI-written phishing rose from under 5% of attempts through most of 2025 to 56% in December 2025 | Hoxhunt, reported by Expert Insights | One vendor's reported attacks; other vendors disagree on total volume |
| E5 | A design that tracks where each value came from and lets policies gate tool calls completed 77% of a benchmark's tasks with provable security, against 84% undefended | CaMeL, "Defeating Prompt Injections by Design" (arXiv 2503.18813) | A research system; an earlier version of the paper says 67% |
| E6 | Gmail's AI Inbox groups updates into topics such as finances and purchases and lists suggested to-dos | TechCrunch, 2026-01-08 | Gmail only |
| E7 | iCloud Mail offers IMAP and SMTP to other clients, signed in with an app-specific password | Apple's support page on iCloud Mail server settings; Nylas's iCloud guide | Neither lists the server's IMAP extensions |
| E8 | Google requires a yearly security assessment of an app that stores or sends restricted Gmail data through a server; assessors charge 500 to 4 500 US dollars; personal use is exempt | Google's restricted-scope verification and app verification pages | That a client keeping data only on the person's machine is exempt is an inference from the wording |
| E9 | A Gmail extension replies to up to 100 selected emails with AI-adjusted versions saved as drafts. No mail client was found that clusters mail and does this itself | cloudHQ's Bulk Email Reply guide; one search | The search was not exhaustive |

Links are in [Sources](#sources).

## 4. Design

### 4.1 Decisions made in this plan

The owner directed on 2026-11-10 that mail is a Loam plugin, not an Umbel plugin, and that it may
use Umbel's features when an instance is connected. How that is built, M1's engine on the `afd`
crate and M10's mounted server among it, is this plan's proposal, as is every other row, until the
owner approves this document.

| | Decision | Why |
| --- | --- | --- |
| M1 | The core is not an Umbel plugin (the owner's direction). It is an engine of its own: a Rust AFD server on the `afd` crate, running on the person's machine (this plan) | Umbel instances will typically be remote, so a plugin there would put a person's mailbox on a server and make remote MCP the path for every read. The crate already supplies the registry, journal, approvals and MCP server |
| M2 | The engine calls no model | It is what lets the client work with no model, with the caller's own, or with a hosted one ([4.6](#46-working-without-a-model)). Umbel holds the same rule (its principle 4) |
| M3 | Raw mail is an append-only log, and everything else is derived from it and can be re-derived | A better parser, extractor or model then improves old mail too, and nothing derived can damage the source |
| M4 | Text from a message is content, never an instruction, a recipient or a link to follow | E2. The engine labels content as Umbel does and adds rules on where a command's parameters may come from ([4.4](#44-trust-and-authority)) |
| M5 | An agent may run what can be undone; what cannot be undone needs a person | It gives autonomy a boundary a person can understand, and AFD's metadata already carries it: `undoable`, `destructive`, an approval policy and a host-verified confirmation |
| M6 | Understanding that needs a model enters by proposal, with source passages the engine checks | The way Umbel's knowledge plugin treats a drafter: claims are verified, not trusted |
| M7 | Recurring mail is understood once and then read by code | E3. A rule written for one sender's template runs on every later message at no model cost ([4.5](#45-extractors)) |
| M8 | Attention is decided by who a sender is to the person before what the message says | E4: a filter that reads content competes with senders using the same models. A relationship cannot be forged by writing well |
| M9 | A story is a view over mail, never a move | The message list always exists, and a wrong grouping hides nothing permanently ([4.7](#47-stories)) |
| M10 | Mail is a Loam plugin (the owner's direction): the engine as a mounted server and a native app over it (this plan) | The interface belongs in the shell with the owner's other apps; the engine stays usable without the shell, from a terminal or an agent |
| M11 | Umbel is optional (the owner's direction) | With an instance connected, mail gains knowledge, memory and context ([4.10](#410-with-an-umbel-connected)); with none, nothing is missing that this document promises |
| M12 | The engine shares no code with Umbel. It follows two of its conventions: the `trust: "content"` label and the fields of its provenance envelope | The owner's direction keeps Umbel out of the core. The conventions cost nothing and let a caller, Loam's copilot above all, read both servers the same way |

### 4.2 Shape

```
  person at a terminal      agent over MCP         Loam: the mail app
          |                       |                      |  (mount)
          +---------------- the mail engine -------------+
              `afd` crate: registry, journal, approvals, MCP server
        connector | log | evidence | relationships | records | stories | outbound
                                  |
                 its own store, on the person's machine
                                  |
                  IMAP and SMTP (iCloud)   Gmail API

  optional, reached by the caller and never by the engine:
        an Umbel instance: knowledge, memory, context
```

- **The engine** is one Rust program built on the `afd` crate. It holds the connector (accounts,
  sync, send), the layers below and the commands in [section 5](#5-commands-draft), and serves
  them over MCP and to a command line.
- **The Loam plugin** mounts the engine and adds a native app in TypeScript: the message list,
  story cards and the review of reply sets. It has its own specification later
  ([section 9](#9-steps)).
- **Rules that an instance may want to change** (the headers that mark bulk mail, the category
  vocabulary, the default screening policy) are data the engine reads, not code.

### 4.3 Layers

| Layer | Holds | Made by | How it changes |
| --- | --- | --- | --- |
| Log | Each message as received: its bytes by content hash, the provider's ids, and the mailbox state (read, labels, folder) as observed | The connector | Appended. A state change is a new observation; nothing is overwritten |
| Evidence | What can be read from a message without judgment: its structure, the text a person would see apart from text they would not, the provider's authentication result, list and bulk headers, links, attachment types and hashes, a template fingerprint, its thread | Code | Recomputed when the parser's version changes |
| Relationships | Senders and the organizations behind them: whether the person has written to them, reply counts, first seen, bulk or personal, and the person's screening decision | Code and the person's decisions | Counts are derived; a decision is the person's and is kept |
| Records | Typed facts, each with its source passage: a request, a commitment, a deadline, an order, a booking, a bill, a sign-in code, a category, a story membership | An extractor, or a caller's proposal | By proposal. A record is superseded, never edited |
| Authority | What each command changes and who may run it | The command's metadata | By configuration |

Every stored item carries a provenance record, with the fields of Umbel's envelope where they
apply (M12). For the log
and evidence the origin is the message; for a record it is the extractor or the proposer, with the
passages it was derived from.

**When a proposed record counts.** A record a caller proposes is stored once its passages are
found in the message it names. It carries its proposer's identity, it informs views and search,
and it is never treated as something the person said. An extractor is different: it writes records
unattended for every later message, so a person approves it first ([4.5](#45-extractors)).

**Where it is kept.** In the engine's own store on the person's machine: SQLite and a search
index, in tables shaped for mail. [Phase 0](#8-phase-0-measure-before-specifying) measures them at
mailbox size.

### 4.4 Trust and authority

**Labels.** In every result, text that came from a message is labelled content, in the vocabulary
Umbel uses (`trust: "content"`): the body, the subject, a sender's display name, an attachment's
name and text. The engine's own facts are not: ids, counts, dates it observed, the provider's
authentication result. A display name is content because anyone can write one. Text a person would
not have seen (hidden by style, size or colour) is kept apart and left out of what a caller is
handed unless it asks.

**Where parameters may come from.** A command that sends, forwards or contacts a server checks
the source of its parameters itself. It does not rely on the calling model.

- A recipient is a participant of the thread being answered, an address the person has written to,
  or one the person typed in the same call. A `Reply-To` that differs from the sender is flagged.
- A message's links are returned as labelled content. The engine opens none of them.
- An unsubscribe uses the message's own list headers and reports what it will contact first.

**Classes.** Every command falls into one of four, declared in AFD's command metadata:

| Class | Examples | Who may run it |
| --- | --- | --- |
| Read | List, open, search | Any caller |
| Local | Screening decisions, record proposals, drafts, snooze | Any caller; journaled |
| Remote, can be undone (`undoable`) | Archive, label, mark read, move to trash | Any caller under the person's policy; journaled with its inverse |
| Remote, cannot be undone (`destructive`, with an approval policy) | Send, unsubscribe | A person, for each call or for a reviewed batch |

The crate enforces an approval policy and a confirmation mode. The rest is the engine's own check:
it holds the person's policy for undoable remote commands and applies it to every caller, since
Loam's autonomy policy reaches only Loam's copilot.

**Commands only a person may run.** Sending, unsubscribing, approving an extractor, adding or
removing an account and entering a credential need a person; [section 5](#5-commands-draft) marks
them "a person" beside their class. At a terminal the engine asks. Over MCP an elicitation's answer
is the client's, not a person's, so the engine does not accept one from an arbitrary agent: the
command is held by its approval policy, the engine issues a token, and the call runs only when
trusted code presents that token back as context evidence, or when the engine's own `HumanRelay`
confirms. Neither path exists yet for a caller that is the Loam shell
([L7 and A1](#6-what-mail-needs)). How much a relay proves is a choice too: an agent can drive a
terminal, and any local program can open a loopback page. Umbel's `terminal` and `verified`
assurances (D115) are the model, and the engine's specification chooses. A credential is read at
the terminal and never passed as command input, because the journal keeps input.

### 4.5 Extractors

An extractor is data: a sender, a template fingerprint, and for each field a selector over the
message's structure and the record type it fills. It is proposed like any record, with example
messages; a person approves it once; code then runs it on every matching message, past and future.
Where a template changes, the extractor stops matching and the messages fall back to no record
until a new one is approved.

A model is used once, to write the proposal. Whether enough mail is templated for this to pay is
the first thing [phase 0](#8-phase-0-measure-before-specifying) measures.

### 4.6 Working without a model

| What is present | What works |
| --- | --- |
| No model | Sync, search, threads, relationships and screening, stream stories, approved extractors, reversible actions, drafts written by the person, send |
| The caller's own agent, over MCP | The above, plus asking questions with cited answers, proposing records and extractors, composing drafts, all while a session is open |
| A model that runs unattended (the person's key in a Loam run or automation, a local model, a hosted service) | The above, plus stories that update as mail arrives and reply sets |

The engine is the same in every row. What differs is who calls it and when. It is also the same
with and without Loam: a terminal and an agent reach every command the app does.

### 4.7 Stories

A story is a stable set of messages about one thing, shown as one card with a way into its mail.

| Kind | Example | How membership is decided |
| --- | --- | --- |
| Stream | A repository's notifications, shipping updates, bank alerts | Sender, list headers and template, in code |
| Situation | An event the person hosts, a trip, a purchase | A shared thread, order number or invitation in code; otherwise a proposed membership with a closed answer of yes, no or unsure |
| Cohort | Customers asking about the same thing, guests answering an invitation | Proposed, by similarity across senders |

- A story keeps its id. Its summary says what changed since the person last looked, read by cursor
  from the engine's record of changes.
- A card shows its exceptions, the messages that need the person, apart from its routine ones.
- A membership the proposer is unsure of is not stored; the message stays in the plain list.
- A story may be attached to a Loam project, so the mail about an event sits with its other work.

### 4.8 Outbound mail and reply sets

A draft is a record the engine keeps, written by a Local command. Sending it is a remote command
that cannot be undone.

A **reply set** answers a cohort story:

1. A caller proposes the distinct questions the cohort asks, each with the messages that ask it.
2. The person answers each question once. A question only one message asks is marked for an
   individual answer.
3. For each recipient the engine hands out one unit of work: the person's answers to that
   recipient's questions and that recipient's own message, and nothing from anyone else. The
   caller returns the reply's text.
4. The person reviews the set: the shared text once, then what differs per recipient. One approval
   sends the reviewed set.

The engine records each reply's inputs and sets its recipient from the source message, so a reply
can be audited against exactly what it was written from. It cannot prove that the model composing
a reply saw nothing else; a caller that composes each unit in a fresh context is what makes
isolation real, and that is a requirement on Loam's copilot ([L6](#6-what-mail-needs)).

### 4.9 Providers

| Account | Read | Send | Sign-in |
| --- | --- | --- | --- |
| iCloud | IMAP | SMTP | An app-specific password (E7) |
| Gmail | The Gmail API: labels and threads are native, and changes come as a history | The Gmail API | OAuth with the person's own client until an app is verified (E8) |

Both sit behind one provider interface inside the engine, so Microsoft Graph, JMAP or plain IMAP
for any other server can follow. Candidate crates, to be audited in the engine's specification:
`async-imap`, `lettre`, `mail-parser` and `ammonia`, beside `rusqlite` and `tantivy`.

### 4.10 With an Umbel connected

The engine holds no Umbel client. The caller, Loam's copilot or the mail app or an agent's harness,
composes the two servers, and mail leaves the machine for an Umbel only by the person's action.

| With Umbel's | Mail gains |
| --- | --- |
| Knowledge and context | Drafts and reply sets that answer from the team's documents, with the passages cited |
| Memory | The person's preferences and what they have said about a correspondent, private to them |
| Proposals | A way to put something learned from mail into the knowledge base: the person picks the passage, and Umbel's own approval decides |

## 5. Commands (draft)

Names follow `domain-action`. The engine's specification fixes names, shapes and codes; this list
shows the surface and each command's class from [4.4](#44-trust-and-authority).

| Command | Does | Class |
| --- | --- | --- |
| `mail-account-add`, `mail-account-remove` | Connects or removes an account | Local; a person |
| `mail-account-list`, `mail-status` | Lists accounts; reports sync state | Read |
| `mail-sync` | Brings the log up to date; resumes where it stopped | Local, long-running |
| `mail-thread-list`, `mail-thread-open`, `mail-message-open`, `mail-attachment-open` | Reads mail, with labels on every part, links included | Read |
| `mail-search` | Searches messages and records | Read |
| `mail-sender-list`, `mail-sender-show` | Reads relationships | Read |
| `mail-sender-screen` | Records the person's decision on a sender | Local |
| `mail-record-list`, `mail-record-propose` | Reads records; proposes records with passages the engine checks | Read; local |
| `mail-extractor-propose`, `mail-extractor-list` | Proposes or lists extractors | Local; read |
| `mail-extractor-approve` | Puts an extractor into use | Local; a person |
| `mail-story-list`, `mail-story-open`, `mail-story-changes` | Reads stories and what changed since a cursor | Read |
| `mail-thread-snooze` | Hides a thread until a time; kept by the engine, since neither provider is known to offer it | Local |
| `mail-thread-archive`, `mail-thread-label`, `mail-thread-mark`, `mail-thread-trash` | Changes the mailbox at the provider | Remote, can be undone |
| `mail-draft-create`, `mail-draft-update`, `mail-draft-list` | Works on drafts | Local; read |
| `mail-draft-send` | Sends one draft | Remote, cannot be undone; a person |
| `mail-replyset-create`, `mail-replyset-next`, `mail-replyset-show` | Builds a reply set a unit at a time | Local; read |
| `mail-replyset-send` | Sends a reviewed set | Remote, cannot be undone; a person |
| `mail-unsubscribe` | Unsubscribes through the message's list headers | Remote, cannot be undone; a person |

## 6. What mail needs

None of these is designed here. Each is a question for the area that owns it, and each that is
accepted becomes that area's own specification. Loam's are recorded in the Loam status file;
AFD's are tracked in this feature's [STATUS.md](STATUS.md) until AFD takes them up. The engine
itself needs nothing from another area to start: phases B to E in [section 9](#9-steps) build on
the `afd` crate alone, with sends made at a terminal.

**From Loam**

| | Need | Why |
| --- | --- | --- |
| L1 | The copilot reads the trust label on each part of a mounted server's result | D41 labels a mount's whole result untrusted; the engine, like Umbel, marks which parts are content |
| L2 | The label holds when content passes to another app's command | A message can ask the copilot to act in a different app |
| L3 | A surface for long-running commands: state, cancel, resume | Import here; rendering and generation in the deck and video apps the owner said he plans. Progress notifications are not delivered for tasks, so the surface reads state. It needs tasks in the TypeScript client (A2) |
| L4 | A kit component for reviewing a batch of proposed changes: shared content once, the differences per item, one approval | Reply sets here; the same pattern in other apps |
| L5 | A plugin whose engine is a local server | No app today brings a program of its own, and Loam's rules forbid one from adding it: a manifest names one kind and carries no command line or location, the app list is the deployer's and no command writes an entry (D63), only the workspace's owner adds a stdio instance (D56), and the desktop webview can write no command line (D106). So either the person or deployer writes the engine's mount entry by hand, or those decisions are amended so a plugin can bring its engine. Either way the plugin is two manifests, a mounted one and a native one joined by a phase 5 `calls` grant; mail must sync with the shell shut, so the engine is a long-lived server mounted over HTTP, not a stdio child; and reads must fit a mounted call's 60-second deadline and 4 MiB reply |
| L6 | The copilot composes each unit of a batch in a fresh context when a command asks for it | [4.8](#48-outbound-mail-and-reply-sets) |
| L7 | An approval a person gives in the shell releases a mounted server's command that only a person may run | Loam's approval evidence comes from trusted shell code, but the engine issues its own tokens and reads evidence only from its context, and Loam's mount relay forwards a fixed list of headers. Two routes: the shell returns the engine's token over a carrier AFD defines (A1), or the engine's `HumanRelay` hands the decision to a page the shell serves |

**From AFD**

| | Need | Why |
| --- | --- | --- |
| A1 | A defined carrier for approval evidence from a trusted MCP client to a mounted server | The token route of L7. Today evidence is a context value only the server's own surface sets, and nothing says how a trusted client presents a token over MCP. Loam mounts any AFD server, so the convention is AFD's |
| A2 | Tasks in the TypeScript client | L3. The MCP Tasks proposal has its Rust pilot; its TypeScript phase is next |

The engine otherwise uses the crate's registry, journal, approvals, tasks and MCP server as they
are. The crate has no command line. Whether the engine builds its own or is driven by
`@lushly-dev/afd-cli` over MCP is for its specification; a command line in the crate itself would
be a third AFD need.

**From Umbel.** Nothing. The engine links no Umbel code and holds no Umbel client.

## 7. Measurement and exit criteria

Phase 0 decides whether to go on and what the engine's specification assumes. Its thresholds are
provisional; the owner confirms or changes them when answering [section 11](#11-for-the-owner).

| | Question | Measure | Provisional threshold |
| --- | --- | --- | --- |
| Q1 | Is enough mail templated for extractors to pay? | The share of all messages that belong to a template seen at least five times and carry no list-unsubscribe header. Templated mail that does carry one, newsletters and marketing, is reported apart: stream stories and screening handle it, not extractors | At least two in ten: extractors are in the first specification. Under one in ten: they are left out. Between: the owner decides |
| Q2 | Can screening be a lookup? | Of messages from senders the person never wrote to, the share that carry a list or bulk header or belong to a template | At least eight in ten. The rest is the size of the problem a model would have to judge |
| Q3 | Does a local store hold a mailbox? | For SQLite tables shaped for mail with a tantivy index: store-side import rate, database size against the messages' bytes without attachments, and the time to list 50 threads and to search, at 100 000 and 500 000 synthetic messages shaped like the census | A list in 50 ms and a search in 200 ms at the 95th percentile; an import of 500 messages a second; a database under three times those bytes |
| Q4 | What do the providers offer? | iCloud's IMAP capabilities, read from the server; a Gmail history sync run once; each provider's fetch rate as observed and its documented limits, which bound a real import more than the store does; which sign-in Gmail accepts | Recorded, not judged |

A **template**, for the census, is the sending address or list id together with the message's MIME
structure and a hash of its HTML body's element skeleton with the text removed; a plain-text body
uses the sequence of its line shapes. The engine's specification may choose a better fingerprint;
the census needs only one that is stable and computed locally.

Later phases take their exit criteria from the engine's specification.

## 8. Phase 0: measure before specifying

Phase 0 writes no engine. It produces numbers and one decision.

| Step | What | Output |
| --- | --- | --- |
| 0.1 | **Mailbox census.** A read-only program opens each account without changing it, reads every message's headers, structure and body, keeps only hashes and counts, and computes Q1, Q2 and the size and thread distributions | A file of counts and distributions only. No address, subject or text leaves the machine or enters this repository |
| 0.2 | **Provider probe.** Q4 | A short record beside the census |
| 0.3 | **Store measurement.** A harness imports synthetic messages with the census's shape into SQLite tables shaped for mail and a tantivy index | Q3's numbers |
| 0.4 | **Decision.** The owner reads 0.1 to 0.3 and decides to go on, change course or stop | Recorded in [STATUS.md](STATUS.md) |

The census runs on the owner's machine against the owner's accounts. It needs a credential for
each, given at a terminal: an app-specific password for iCloud, and for Gmail either an app
password over IMAP or an OAuth client the owner creates, whichever step 0.2 finds Gmail accepts.
The census program, the synthetic generator and the store harness live in a `prototype/` folder
here, as the Component Briefs prototype does. They are measurement tools, not the engine. The
census output does not enter the repository, beyond the counts.

## 9. Steps

Each step after phase 0 is one or more pull requests with its own specification. The engine's
phases depend on no other area; the Loam app can start as soon as its row's needs are met.

| Phase | What | Needs | Headline exit |
| --- | --- | --- | --- |
| 0 | Measure ([section 8](#8-phase-0-measure-before-specifying)) | The owner's go | The decision in 0.4 |
| A | The engine's specification, at the place decision 2 of [section 11](#11-for-the-owner) gives it | Phase 0 | The owner's approval by pull request |
| B | The connector and the log: accounts, a resumable sync for iCloud and Gmail, evidence, read commands, search, a command line and MCP | A | The owner's real mailbox synced and searched from the command line and by an agent over MCP |
| C | Relationships, screening and stream stories | B | Stream stories on the real mailbox with no model |
| D | Reversible mailbox commands with their inverses; drafts; send for a person at a terminal | B | An agent archives and labels under policy, and cannot send; a person sends at a terminal |
| E | Records by proposal, extractors, situation stories, reply sets | C, D | A reply set sent from a reviewed batch, each reply traceable to its inputs |
| F | The Loam plugin: the mount and the native app, with its own specification | B; Loam's phase 5, and phase 6's desktop lane (its milestone M3) or a hosted profile run locally; L1 to L7 as accepted; A1 and A2 | Decided by that specification. Sending from the app waits on L7 |
| G | Composition with a connected Umbel ([4.10](#410-with-an-umbel-connected)) | F; an Umbel instance | Decided with the app's specification |

## 10. Risks and open points

- **Why not an Umbel plugin (M1).** Recorded so the choice is not reopened without new facts. The
  first version proposed it, to reuse Umbel's stores, journal, approvals, provenance and labels.
  Against it: Umbel is primarily an MCP harness for tools shared across harnesses and its
  instances will typically be remote, so a person's whole mailbox would sit on a server and every
  read in the interface would cross the network; a Loam app should not have Umbel as its core; mail would not work without an
  Umbel; and its review found the local case unserved, since in mode `none` Umbel registers no
  person-only command for MCP (D115) and offers no tasks over HTTP, and the plugin needed eight
  changes to the host. The task rule is the crate's, so it binds the engine too: over HTTP,
  `mail-sync` is a task only if the engine identifies its callers, which is why its sync resumes
  across calls. What is given up is real: the engine now owns its store, its record of
  changes and its command line.
- **A second Rust program on the `afd` crate.** It can drift from Umbel's conventions. One label
  vocabulary and one set of provenance fields are the guard; the specification names each.
- **The engine parses bytes written by strangers.** The parser's choice and its fuzzing are for
  the specification.
- **Loam's phases gate the interface, not the engine.** Phases B to E need none of them. Phase F
  needs phases 5 and 6, and sending from the app needs L7.
- **A browser-only Loam cannot reach a local engine.** With nothing serving the mount route the
  instance is unreachable; mail runs on the desktop host or against a hosted engine. Loam's
  desktop lane is milestone M3 of its phase 6, which gates nothing before phase 7 (D100), so it
  may come late.
- **"Installable" runs into Loam's rules (L5).** Today a person or deployer writes the engine's
  mount entry by hand. A plugin that installs its own engine needs the manifest profile (phase 1,
  section 2), D63 and D56 amended, and D106's desktop path with them, which is the owner's and
  Loam's decision.
- **Isolation in reply sets is partly procedural** ([4.8](#48-outbound-mail-and-reply-sets)).
- **A wrong grouping can bury a message.** M9, exceptions on the card and the rule on unsure
  memberships reduce it; they do not remove it.
- **Extractors may not pay.** Q1 decides.
- **Offering it to others.** Holding other people's Gmail on a server brings Google's yearly
  assessment (E8). An engine on the person's machine avoids holding it. That it also avoids the
  assessment is not verified.
- **Mail at rest.** A process running as the same user can read the engine's files. Mail is more
  sensitive than most local data, so what is encrypted at rest needs its own decision in the
  specification.
- **A Google OAuth client in testing status may expire its tokens weekly** (not verified). If so,
  phase B's Gmail sync needs the owner's client moved out of testing, or a sign-in each week.

## 11. For the owner

Decided 2026-11-10: mail is a Loam plugin with an engine of its own, not an Umbel plugin (M1,
M10), and Umbel is optional (M11). Still open:

1. **Go on to phase 0?** It needs your mailbox, on your machine, and produces counts only.
2. **Where does it live?** In this repository, as an engine under `endpoints/` and an app beside
   Loam's, which is where this document assumes. The
   [platform decision](../../active/platform-monorepo/decision.md) keeps Lushly, a product, in its
   own repository; if mail is a product in that sense, it can build against the `afd` crate and
   Loam from outside.
3. **The name.** "Mail" is a working title and `mail` a working command domain.
4. **Gmail through its API or through IMAP first?** This proposal recommends the API.
5. **The thresholds in [section 7](#7-measurement-and-exit-criteria).**
6. **How the engine gets installed (L5).** A person or deployer writes its mount entry, as Loam's
   rules require today, or Loam amends its manifest profile, D63 and D56, and D106's desktop path
   with them, so a plugin can bring its engine. An installable client depends on the answer.

## 12. Out of scope

- Hosting mailboxes or running a mail server.
- Calendar and contacts beyond what a message itself carries.
- Microsoft Graph, JMAP and other providers, until the two first accounts work.
- Shared inboxes and more than one person per mailbox.
- Message encryption and signing (PGP, S/MIME).
- A model inside the engine, and training any model on mail.
- Deleting mail for good. Moving to trash is offered; emptying it is left to the provider.
- The Loam app's design, which its own specification owns.

## Sources

Retrieved 2026-11-10.

| | Source |
| --- | --- |
| E1 | [Validity, consumer research press release](https://www.validity.com/press-releases/validity-research-reveals-consumers-let-ai-curate-their-inboxes-while-marketers-struggle-to-keep-up/) |
| E2 | [EchoLeak paper](https://arxiv.org/abs/2509.10540); [Permiso Security on Copilot email summaries](https://permiso.io/blog/copilot-prompt-injection-ai-email-phishing) |
| E3 | [TechRadar on Hostinger's study](https://www.techradar.com/pro/email-is-at-an-inflection-point-new-study-finds-only-13-percent-of-emails-sent-worldwide-were-actually-written-by-humans) |
| E4 | [Expert Insights on Hoxhunt's findings](https://expertinsights.com/news/ai-generated-phishing-surges-hoxhunt-finds) |
| E5 | [CaMeL: Defeating Prompt Injections by Design](https://arxiv.org/abs/2503.18813) |
| E6 | [TechCrunch on Gmail's AI Inbox](https://techcrunch.com/2026/01/08/gmail-debuts-a-personalized-ai-inbox-ai-overviews-in-search-and-more) |
| E7 | [Apple, iCloud Mail server settings](https://support.apple.com/en-us/102525); [Nylas, iCloud messages guide](https://developer.nylas.com/docs/cookbook/email/messages/list-messages-icloud/) |
| E8 | [Google, restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification); [Google, security assessment](https://support.google.com/cloud/answer/13465431) |
| E9 | [cloudHQ, Bulk Email Reply](https://support.cloudhq.net/getting-started-with-bulk-email-reply-how-to-set-up-reply-to-multiple-emails-at-once) |
| Projects | [Godwit](https://github.com/godwit-email/godwit), [EmailOps](https://github.com/emailops/emailops), [Zero](https://github.com/Mail-0/Zero), [Inbox Zero](https://github.com/elie222/inbox-zero), [MailCopilot](https://github.com/mailcopilot/mailcopilot), [GigaMail](https://github.com/adecubed/gigamail) |
