# Mail: proposal and plan

A mail core that records what a person's mail means, who it is really from and what an agent may
do about it: an Umbel plugin in Rust that syncs, parses and indexes mail under Umbel's provenance
and approval rules, and a Loam app over it. It calls no model; models and people propose, and the
core verifies and stores.

"Mail" is a working title. The name is an open decision ([section 11](#11-for-the-owner)).

## Status

- **State:** proposed. Written 2026-11-10 against `main` at `880a18c4`, from a design discussion
  with the owner that day. Nothing is implemented and nothing is approved. [STATUS.md](STATUS.md)
  tracks progress.
- **Verified:** the facts in [What exists today](#2-what-exists-today) about this repository were
  read on `main` at `880a18c4`, in the documents each row names. No Rust or TypeScript was built or
  run. The facts about other projects were read on 2026-11-10 from their public repositories
  (README, licence file and repository metadata only). The external claims in
  [Evidence](#3-evidence) come from the sources listed there, each with its limit.
- **Not verified:** which IMAP extensions iCloud's server offers; whether Gmail still accepts an
  app password over IMAP; whether a Google OAuth client left in testing status expires its
  refresh tokens after a week; whether a client that keeps Gmail data only on the person's machine
  is exempt from Google's security assessment; the licence of Stalwart's `mail-parser` crate,
  which GitHub does not classify. Phase 0 and the plugin specification settle these.
- **Reviewed:** one independent review on 2026-11-10 (verdict: revise) raised five blockers and
  eleven improvements, each checked against the repository; all held and are applied here. The
  blockers: person-only commands over MCP (now U8 and L7), tasks (U4), the effects vocabulary
  (4.4, U6), the scale profiles (U5, Q3) and the needs of phase B. A focused check of the fixes
  the same day approved them, with three precision fixes applied.
- **Next:** the owner's answers in [section 11](#11-for-the-owner), then
  [phase 0](#8-phase-0-measure-before-specifying).

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
4. everything above works with no model at all, and gets better when one is present.

It is a good mail client's engine first. It serves the person at a terminal, any agent over MCP and
a Loam app from one set of commands.

## 2. What exists today

### In this repository

| Fact | Where it was read |
| --- | --- |
| Umbel is an empty Rust host for capability plugins, serving MCP over stdio and Streamable HTTP and a CLI from one registry, with a workspace, the journal and its per-space event log, approvals and confirmations | [Umbel README](../../../../endpoints/umbel/README.md) |
| A plugin is `compiled`, `component`, `mounted` or `pack`. A compiled plugin runs with the host's permissions; a mounted one is a separate process and declares no grants | Umbel README, "Write a plugin" |
| Umbel's principles include no model in the request path (4), a deterministic core with judgment at the edges (6), provenance on everything (7), durable knowledge changing by proposal (8) and stored content as untrusted input (9) | [Umbel architecture](../../../../endpoints/umbel/docs/architecture.md#2-principles) |
| Every stored record carries the provenance envelope, and the host refuses a store write that drops it | Umbel architecture, principle 7 and the [host services catalog](../../../../endpoints/umbel/docs/architecture.md#host-services-catalog) |
| The embedded stores are SQLite, one database per space, with a tantivy search index and a graph; the store filters by the caller's principal inside the query, before ranking | Umbel README; Umbel architecture, principle 10 and section 6 |
| Every part of a knowledge result that came from a document is labelled `trust: "content"`. Content that looks like instructions or hides text is flagged and stored, never blocked | Umbel README, "Searching them" and "Reading files into the stores" |
| The knowledge base changes only by proposal, and a drafter's claims are verified against its sources, not trusted | Umbel README, "Changing them by proposal" |
| A command only a person may run is answered at a terminal, or over MCP on a verified person page where a person login exists (D115). In mode `none`, a local deployment with no identity provider, such a command is not registered for MCP at all | Umbel decisions, D115; [Umbel phase 5 specification](../../../../endpoints/umbel/docs/phases/5-auth-hosted/spec.md), its amendment to 7.1 |
| A command declares effects from a closed set: `inspect`, `plugin-state` and `external`, and for plugins `store-write` and `workspace-write` | Umbel architecture, host services catalog; Umbel decisions, D42 and D54 |
| The host services catalog names `http` (outbound HTTP to hosts the manifest declares) and `secrets` (named deployer secrets, never the caller's tokens). Both are refused until their phase, and a grant with a network or secrets effect needs an explicit `allow` list for each instance. There is no grant for a TCP socket | Umbel architecture, host services catalog; Umbel decisions, D42 |
| The `records` grant holds a plugin's own records, namespaced by plugin instance. Spaces do not mix: every read and write names its space (principle 16) | Umbel architecture, host services catalog and principles |
| A command's input is journaled as it is, unless the command is journaled as a digest, as memory's are | Umbel README, the memory paragraph under "Access is not a security boundary yet" |
| `connectors` is a reserved manifest key. The first external integration, a mounted server or a native connector, is open decision O1 | Umbel architecture, section 5; [Umbel decisions](../../../../endpoints/umbel/docs/decisions.md), O1 |
| The curator is started by cron, CI or a session hook. The README describes no scheduler inside the host | Umbel README, "Scheduling" |
| Umbel's phases 0 to 4 are done. Phase 5 (auth and hosted) is in progress, phase 6 (backends) is approved and not started, phase 7 is not started | [Umbel status](../../../../endpoints/umbel/docs/STATUS.md) |
| A further first-class plugin has its specification at `endpoints/umbel/docs/plugins/<plugin id>/spec.md`, approved by pull request before implementation (D18, D150) | Umbel decisions |
| Umbel's scale profiles are sized in documents of about eight 300-token chunks: up to 1 000 for a team on the embedded store, about 10 000 for an organization, about 100 000 for an enterprise on a shared backend, and a million or more on dedicated search engines | [Umbel proposal](../../../../endpoints/umbel/docs/proposal.md), "Scale profiles" |
| Loam is an application shell for AFD apps. An app is native, a sandboxed view, or a mounted AFD server; Umbel is mounted, never embedded | [Loam proposal](../../../../endpoints/loam/docs/proposal.md), "Three kinds of app" and "Languages" |
| In Loam's copilot, tool results and mounted content are labelled untrusted, and every agent action follows an autonomy policy of suggest, ask or act (D41). Settings come in phase 4, enforcement in phase 5 | [Loam decisions](../../../../endpoints/loam/docs/decisions.md), D41 |
| Loam's desktop host mounts a server over HTTP, or as a stdio child it stops when the mount closes | [Loam phase 6 specification](../../../../endpoints/loam/docs/phases/6-hosts/spec.md#104-mounts-over-the-rust-host) |
| Loam's phases 0 to 2 have exited. Phase 3 (identity) and phase 6 (hosts) are in progress. Phases 4, 5 (bus, copilot, mounted servers), 7 and 8 are not started | [Loam status](../../../../endpoints/loam/docs/STATUS.md) |
| Umbel has tasks (phase 5, step 8, done 2026-11-09) where callers are identified. In mode `none` over HTTP AFD offers no tasks, and stdio keeps them for one connection. A task ends when its starting token expires, its result may carry no content, and a command that confirms or approves cannot be one (D127) | Umbel status; Umbel phase 5 specification, its amendment to 10.2; Umbel decisions, D127 |
| AFD's Rust context reports progress and cancellation. Progress notifications are not delivered for tasks | Umbel status, step 0e; [MCP Tasks](../../active/mcp-tasks/mcp-tasks.proposal.md), "Limits"; [MCP Progress](../mcp-progress/mcp-progress.proposal.md) |

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

Each is a proposal until the owner approves this document.

| | Decision | Why |
| --- | --- | --- |
| M1 | The core is an Umbel plugin, `mail`, not a server of its own | Umbel already owns what a mail core would otherwise rebuild: transport, the CLI, the journal and event log, approvals, the stores, the reader filter, the provenance envelope and trust labels. Its principles 4, 6, 7, 8 and 9 are this proposal's requirements. The alternative is in [section 10](#10-risks-and-open-points) |
| M2 | The core calls no model | Umbel's principle 4. It is also what lets the client work with no model, with the caller's own, or with a hosted one ([4.6](#46-working-without-a-model)) |
| M3 | Raw mail is an append-only log, and everything else is derived from it and can be re-derived | A better parser, extractor or model then improves old mail too, and nothing derived can damage the source |
| M4 | Text from a message is content, never an instruction, a recipient or a link to follow | E2. Umbel's principle 9 already labels stored content; mail adds rules on where a command's parameters may come from ([4.4](#44-trust-and-authority)) |
| M5 | An agent may run what can be undone; what cannot be undone needs a person | It gives autonomy a boundary a person can understand. Umbel can require a person today only at a terminal or on a verified person page, and Loam's autonomy policy (D41) does not yet reach a mounted Umbel, so the path for a person's approval from the Loam app is a need (U8, L7) |
| M6 | Understanding that needs a model enters by proposal, with source passages the core checks | Umbel's principle 8, and the way its knowledge plugin already treats a drafter |
| M7 | Recurring mail is understood once and then read by code | E3. A rule written for one sender's template runs on every later message at no model cost ([4.5](#45-extractors)) |
| M8 | Attention is decided by who a sender is to the person before what the message says | E4: a filter that reads content competes with senders using the same models. A relationship cannot be forged by writing well |
| M9 | A story is a view over mail, never a move | The message list always exists, and a wrong grouping hides nothing permanently ([4.7](#47-stories)) |
| M10 | The interface is a Loam app, specified apart from the core | The core needs none of Loam; the app needs Loam's phases 5 and 6 |
| M11 | Mail lives in a space of its own | Umbel's principle 16: a space's readers see everything in it, and mail must not sit beside a handbook. Another plugin reads mail only when a caller names the mail space and may read it |

### 4.2 Shape

```
  person at a terminal      agent over MCP         Loam mail app
          |                       |                      |
          +----------- Umbel: registry, journal, --------+
                       approvals, reader filter
                                  |
                          the `mail` plugin
        connector | log | evidence | relationships | records | stories | outbound
                                  |
              Umbel stores: documents, records, index, graph
                                  |
                  IMAP and SMTP (iCloud)   Gmail API
```

- **The `mail` plugin** is Rust, compiled into a host binary first. It holds the connector
  (accounts, sync, send), the layers below and the commands in [section 5](#5-commands-draft).
- **Packs** hold what an instance may want to change without code: the header rules that mark bulk
  mail, the category vocabulary and the default screening policy.
- **The Loam mail app** is a native Loam app in TypeScript over a mounted Umbel. It has its own
  specification later ([section 9](#9-steps)).

### 4.3 Layers

| Layer | Holds | Made by | How it changes |
| --- | --- | --- | --- |
| Log | Each message as received: its bytes by content hash, the provider's ids, and the mailbox state (read, labels, folder) as observed | The connector | Appended. A state change is a new observation; nothing is overwritten |
| Evidence | What can be read from a message without judgment: its structure, the text a person would see apart from text they would not, the provider's authentication result, list and bulk headers, links, attachment types and hashes, a template fingerprint, its thread | Code | Recomputed when the parser's version changes |
| Relationships | Senders and the organizations behind them: whether the person has written to them, reply counts, first seen, bulk or personal, and the person's screening decision | Code and the person's decisions | Counts are derived; a decision is the person's and is kept |
| Records | Typed facts, each with its source passage: a request, a commitment, a deadline, an order, a booking, a bill, a sign-in code, a category, a story membership | An extractor, or a caller's proposal | By proposal. A record is superseded, never edited |
| Authority | What each command changes and who may run it | The manifest and the host | By configuration |

Every stored item carries Umbel's provenance envelope. For the log and evidence the origin is the
message; for a record it is the extractor or the proposer, with the passages it was derived from.

**When a proposed record counts.** A record a caller proposes is stored once its passages are
found in the message it names. It carries its proposer's identity and authority, it informs views
and search, and it is never treated as something the person said. An extractor is different: it
writes records unattended for every later message, so a person approves it first
([4.5](#45-extractors)).

**Which stores.** Messages written to the document store and the index of the mail space are what
Umbel's knowledge and context plugins can read, under the reader filter. Records kept under the
`records` grant are the plugin's own and no other plugin sees them. Which layer goes where is for
the plugin specification, after [phase 0](#8-phase-0-measure-before-specifying) measures the
document store at mailbox size.

### 4.4 Trust and authority

**Labels.** In every result, text that came from a message is labelled content: the body, the
subject, a sender's display name, an attachment's name and text. The plugin's own facts are not:
ids, counts, dates it observed, the provider's authentication result. A display name is content
because anyone can write one. Text a person would not have seen (hidden by style, size or colour)
is kept apart and left out of what a caller is handed unless it asks.

**Where parameters may come from.** A command that sends, forwards or contacts a server checks
the source of its parameters itself. It does not rely on the calling model.

- A recipient is a participant of the thread being answered, an address the person has written to,
  or one the person typed in the same call. A `Reply-To` that differs from the sender is flagged.
- A message's links are returned as labelled content. The core opens none of them.
- An unsubscribe uses the message's own list headers and reports what it will contact first.

**Effects.** Umbel's closed set has five effects. Mail's commands fall into four classes:

| Class | Umbel effect | Examples | Who may run it |
| --- | --- | --- | --- |
| Read | `inspect` | List, open, search | Any caller the reader filter admits |
| Local | `store-write` | Screening decisions, record proposals, drafts, snooze | Any caller; journaled |
| Remote, can be undone | `external` | Archive, label, mark read, move to trash | Any caller under the instance's policy; journaled with its inverse |
| Remote, cannot be undone | `external` | Send, unsubscribe | A person, for each call or for a reviewed batch |

The third and fourth classes share one effect today. Telling them apart in the manifest is a need
([U6](#6-what-mail-needs)).

**Commands only a person may run.** Sending, unsubscribing, approving an extractor, adding an
account and entering a credential need a person. Umbel can require one at a terminal, or over MCP
on a verified person page in a hosted mode (D115). In mode `none`, the local deployment a single
person runs, such a command is not registered for MCP at all, so until [U8](#6-what-mail-needs) is
met these commands run only from the command line and the Loam app cannot send. A credential is
read at the terminal and never passed as command input, because the journal records input.

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

The core is the same in every row. What differs is who calls it and when.

### 4.7 Stories

A story is a stable set of messages about one thing, shown as one card with a way into its mail.

| Kind | Example | How membership is decided |
| --- | --- | --- |
| Stream | A repository's notifications, shipping updates, bank alerts | Sender, list headers and template, in code |
| Situation | An event the person hosts, a trip, a purchase | A shared thread, order number or invitation in code; otherwise a proposed membership with a closed answer of yes, no or unsure |
| Cohort | Customers asking about the same thing, guests answering an invitation | Proposed, by similarity across senders |

- A story keeps its id. Its summary says what changed since the person last looked, read from the
  event log by cursor.
- A card shows its exceptions, the messages that need the person, apart from its routine ones.
- A membership the proposer is unsure of is not stored; the message stays in the plain list.
- A story may be attached to a Loam project, so the mail about an event sits with its other work.

### 4.8 Outbound mail and reply sets

A draft is a record the plugin keeps, written by a Local command (`store-write`). Sending it is a
remote command that cannot be undone.

A **reply set** answers a cohort story:

1. A caller proposes the distinct questions the cohort asks, each with the messages that ask it.
2. The person answers each question once. A question only one message asks is marked for an
   individual answer.
3. For each recipient the plugin hands out one unit of work: the person's answers to that
   recipient's questions and that recipient's own message, and nothing from anyone else. The
   caller returns the reply's text.
4. The person reviews the set: the shared text once, then what differs per recipient. One approval
   sends the reviewed set.

The plugin records each reply's inputs and sets its recipient from the source message, so a reply
can be audited against exactly what it was written from. It cannot prove that the model composing
a reply saw nothing else; a caller that composes each unit in a fresh context is what makes
isolation real, and that is a requirement on Loam's copilot ([L6](#6-what-mail-needs)).

### 4.9 Providers

| Account | Read | Send | Sign-in |
| --- | --- | --- | --- |
| iCloud | IMAP | SMTP | An app-specific password (E7) |
| Gmail | The Gmail API: labels and threads are native, and changes come as a history | The Gmail API | OAuth with the person's own client until an app is verified (E8) |

Both sit behind one provider interface inside the plugin, so Microsoft Graph, JMAP or plain IMAP
for any other server can follow. Candidate crates, to be audited in the plugin specification:
`async-imap`, `lettre`, `mail-parser` and `ammonia`, beside the `rusqlite` and `tantivy` Umbel
already uses.

## 5. Commands (draft)

Names follow `domain-action`. The plugin specification fixes names, shapes and codes; this list
shows the surface and each command's class from [4.4](#44-trust-and-authority).

| Command | Does | Class |
| --- | --- | --- |
| `mail-account-add`, `mail-account-remove` | Connects or removes an account | A person |
| `mail-account-list`, `mail-status` | Lists accounts; reports sync state | Read |
| `mail-sync` | Brings the log up to date | Local, long-running |
| `mail-thread-list`, `mail-thread-open`, `mail-message-open`, `mail-attachment-open` | Reads mail, with labels on every part, links included | Read |
| `mail-search` | Searches messages and records the caller may read | Read |
| `mail-sender-list`, `mail-sender-show` | Reads relationships | Read |
| `mail-sender-screen` | Records the person's decision on a sender | Local |
| `mail-record-list`, `mail-record-propose` | Reads records; proposes records with passages the plugin checks | Read; local |
| `mail-extractor-propose`, `mail-extractor-list` | Proposes or lists extractors | Local; read |
| `mail-extractor-approve` | Puts an extractor into use | A person |
| `mail-story-list`, `mail-story-open`, `mail-story-changes` | Reads stories and what changed since a cursor | Read |
| `mail-thread-snooze` | Hides a thread until a time; kept by the plugin, since neither provider is known to offer it | Local |
| `mail-thread-archive`, `mail-thread-label`, `mail-thread-mark`, `mail-thread-trash` | Changes the mailbox at the provider | Remote, can be undone |
| `mail-draft-create`, `mail-draft-update`, `mail-draft-list` | Works on drafts | Local; read |
| `mail-draft-send` | Sends one draft | Remote, cannot be undone; a person |
| `mail-replyset-create`, `mail-replyset-next`, `mail-replyset-show` | Builds a reply set a unit at a time | Local; read |
| `mail-replyset-send` | Sends a reviewed set | Remote, cannot be undone; a person |
| `mail-unsubscribe` | Unsubscribes through the message's list headers | Remote, cannot be undone; a person |

## 6. What mail needs

None of these is designed here. Each is a question for the area that owns it, recorded in that
area's status file, and each that is accepted becomes that area's own specification.

**From Umbel**

| | Need | Why the catalog does not cover it today |
| --- | --- | --- |
| U1 | A grant for TLS sockets to hosts the manifest declares, with its per-instance `allow` list (D42) | IMAP and SMTP are not HTTP, and `http` is the only network grant |
| U2 | Secrets that belong to a person, entered outside command input | `secrets` are named deployer secrets, and are refused until their phase. The journal keeps a command's input |
| U3 | A way to keep a mailbox current | A scheduled `mail-sync` fits how the curator runs now. Holding a connection open for new mail needs a worker the host supervises |
| U4 | A long import on a local deployment | Tasks exist where callers are identified. In mode `none` over HTTP there are none, stdio keeps them for one connection, and a task ends with its token. A first import takes minutes, so it needs tasks without an identity provider or a sync that resumes across calls |
| U5 | Stores that hold a mailbox | A mailbox of 100 000 to 500 000 messages runs from the enterprise profile's count, about 100 000 and assuming a shared backend, to five times it, on one person's embedded deployment. The messages are far shorter than the profiles assume. Phase 0 measures it |
| U6 | Two kinds of `external` effect in the manifest: one that can be undone and one that cannot | The closed set has one `external` |
| U7 | The connector contract | `connectors` is a reserved key, and O1 is open. Mail would be the first native connector |
| U8 | A person's approval reaching a local, single-person deployment over MCP | In mode `none` a person-only command is not registered for MCP, and the verified person page needs a hosted mode with an identity provider (D115) |

**From Loam**

| | Need | Why |
| --- | --- | --- |
| L1 | The copilot reads the trust label on each part of a mounted result | D41 labels a mount's whole result untrusted; Umbel marks which parts are content |
| L2 | The label holds when content passes to another app's command | A message can ask the copilot to act in a different app |
| L3 | A surface for long-running commands: state, cancel, resume | Import here; rendering and generation in the deck and video apps the owner plans. Progress notifications are not delivered for tasks, so the surface reads state |
| L4 | A kit component for reviewing a batch of proposed changes: shared content once, the differences per item, one approval | Reply sets here; the same pattern in other apps |
| L5 | Guidance to mount a long-lived local Umbel over HTTP when its work must continue with the shell closed | A stdio child stops when the mount closes |
| L6 | The copilot composes each unit of a batch in a fresh context when a command asks for it | [4.8](#48-outbound-mail-and-reply-sets) |
| L7 | An approval a person gives in the shell is evidence a mounted Umbel accepts for a person-only command | The other half of U8. Loam's approval evidence comes from trusted shell code; Umbel accepts a person only at a terminal or on its person page |

**From AFD.** Nothing beyond what those two areas already track: tasks, progress and the approval
relay over MCP.

## 7. Measurement and exit criteria

Phase 0 decides whether to go on and what the plugin specification assumes. Its thresholds are
provisional; the owner confirms or changes them when answering [section 11](#11-for-the-owner).

| | Question | Measure | Provisional threshold |
| --- | --- | --- | --- |
| Q1 | Is enough mail templated for extractors to pay? | The share of all messages that belong to a template seen at least five times and carry no list-unsubscribe header. Templated mail that does carry one, newsletters and marketing, is reported apart: stream stories and screening handle it, not extractors | At least two in ten: extractors are in the first specification. Under one in ten: they are left out. Between: the owner decides |
| Q2 | Can screening be a lookup? | Of messages from senders the person never wrote to, the share that carry a list or bulk header or belong to a template | At least eight in ten. The rest is the size of the problem a model would have to judge |
| Q3 | Can Umbel's embedded stores hold a mailbox? | Store-side import rate, database size against the messages' bytes without attachments, and the time to list 50 threads and to search, at 100 000 and 500 000 synthetic messages shaped like the census | A list in 50 ms and a search in 200 ms at the 95th percentile; an import of 500 messages a second; a database under three times those bytes |
| Q4 | What do the providers offer? | iCloud's IMAP capabilities, read from the server; a Gmail history sync run once; each provider's fetch rate as observed and its documented limits, which bound a real import more than the store does; which sign-in Gmail accepts | Recorded, not judged |

A **template**, for the census, is the sending address or list id together with the message's MIME
structure and a hash of its HTML body's element skeleton with the text removed; a plain-text body
uses the sequence of its line shapes. The plugin specification may choose a better fingerprint;
the census needs only one that is stable and computed locally.

Later phases take their exit criteria from the plugin specification.

## 8. Phase 0: measure before specifying

Phase 0 writes no plugin. It produces numbers and one decision.

| Step | What | Output |
| --- | --- | --- |
| 0.1 | **Mailbox census.** A read-only program opens each account without changing it, reads every message's headers, structure and body, keeps only hashes and counts, and computes Q1, Q2 and the size and thread distributions | A file of counts and distributions only. No address, subject or text leaves the machine or enters this repository |
| 0.2 | **Provider probe.** Q4 | A short record beside the census |
| 0.3 | **Store measurement.** A harness that builds against Umbel's store crates by path imports synthetic messages with the census's shape into Umbel's document store and index, and into a table shaped for mail | Q3's numbers for both |
| 0.4 | **Decision.** The owner reads 0.1 to 0.3 and decides to go on, change course or stop | Recorded in [STATUS.md](STATUS.md) |

The census runs on the owner's machine against the owner's accounts. It needs a credential for
each, given at a terminal: an app-specific password for iCloud, and for Gmail either an app
password over IMAP or an OAuth client the owner creates, whichever step 0.2 finds Gmail accepts.
The census program, the synthetic generator and the store harness live in a `prototype/` folder
here, as the Component Briefs prototype does. They are measurement tools, not the plugin. The
census output does not enter the repository, beyond the counts.

## 9. Steps

Each step after phase 0 is one or more pull requests with its own specification. Order follows
dependency; the Loam app can start as soon as its row's needs are met.

| Phase | What | Needs | Headline exit |
| --- | --- | --- | --- |
| 0 | Measure ([section 8](#8-phase-0-measure-before-specifying)) | The owner's go | The decision in 0.4 |
| A | The `mail` plugin specification at `endpoints/umbel/docs/plugins/mail/spec.md`, and a proposal for each accepted need in [section 6](#6-what-mail-needs) | Phase 0 | The owner's approval by pull request (D150) |
| B | The connector and the log: accounts, a scheduled sync for iCloud and Gmail, evidence, read commands, search | A; U1, U2, U4, U5 as phase 0 decides, U7; U3 as far as a scheduled sync | The owner's real mailbox synced and searched from the command line and over MCP |
| C | Relationships, screening and stream stories | B | Stream stories on the real mailbox with no model |
| D | Reversible mailbox commands with their inverses; drafts; send from the command line | B; U6 | An agent archives and labels under policy, and cannot send; a person sends at a terminal |
| E | Records by proposal, extractors, situation stories, reply sets | C, D | A reply set sent from a reviewed batch, each reply traceable to its inputs |
| F | The Loam mail app, with its own specification | B; Loam's phases 5 and 6; L1 to L7 as accepted; U8 for sending from the app; U3's worker for mail as it arrives | Decided by that specification |

## 10. Risks and open points

- **A plugin or a server of its own (M1).** A separate Rust AFD server with its own stores,
  mounted in Umbel and Loam, would need none of U1 to U8 and could start at once. It would rebuild
  the stores, search, provenance, approvals and access rules, and Umbel's knowledge would reach
  mail only through federation. As a plugin, mail is readable by Umbel's other plugins only where
  it writes the document store and index of its space ([4.3](#43-layers)), which is what Q3
  measures. This proposal chooses the plugin. If the embedded stores cannot carry a mailbox, the
  fallbacks are phase 6's PostgreSQL backend, approved and not started, or a store shaped for mail
  behind the same grants, not a second host.
- **Umbel's prerequisites may take longer than the core.** U1, U2 and U7 are host design, and O1
  has been open since 2026-10-30. Phase B cannot start without them, nor without U4 unless the
  plugin's sync resumes across calls, as `sources-sync` does.
- **A person's approval does not reach a local Umbel over MCP (U8, L7).** Until it does, sending
  works only from the command line, and the Loam app can read, organize and draft but not send.
- **A Google OAuth client in testing status may expire its tokens weekly** (not verified). If so,
  phase B's Gmail sync needs the owner's client moved out of testing, or a sign-in each week.
- **A compiled plugin is trusted code.** It parses bytes written by strangers. The parser's
  choice, fuzzing and whether parsing can run as a sandboxed component are for the specification.
- **Isolation in reply sets is partly procedural** ([4.8](#48-outbound-mail-and-reply-sets)).
- **A wrong grouping can bury a message.** M9, exceptions on the card and the rule on unsure
  memberships reduce it; they do not remove it.
- **Extractors may not pay.** Q1 decides.
- **Offering it to others.** Holding other people's Gmail on a server brings Google's yearly
  assessment (E8). A core that runs on the person's machine avoids holding it. That it also avoids
  the assessment is not verified.
- **Mail at rest.** On a local deployment nothing vouches for the caller, and a process running as
  the same user can read the store files. Phase 5 verifies callers in hosted modes; it does not
  encrypt the document store, and only memory is sealed (D82). Mail is more sensitive than a
  handbook, so what is encrypted at rest needs its own decision in the specification.

## 11. For the owner

1. **Go on to phase 0?** It needs your mailbox, on your machine, and produces counts only.
2. **Plugin or server (M1)?** This proposal recommends the Umbel plugin.
3. **Is mail the first native connector, answering Umbel's O1?** If yes, the connector contract is
   designed with mail as its first case.
4. **Where does it live?** In this repository, as a first-class Umbel plugin and a Loam app, which
   is where this document puts it. The
   [platform decision](../../active/platform-monorepo/decision.md) keeps Lushly, a product, in its
   own repository; if mail is a product in that sense, its plugin can still build against Umbel
   from outside.
5. **The name.** "Mail" is a working title and `mail` a working plugin id.
6. **Gmail through its API or through IMAP first?** This proposal recommends the API.
7. **The thresholds in [section 7](#7-measurement-and-exit-criteria).**

## 12. Out of scope

- Hosting mailboxes or running a mail server.
- Calendar and contacts beyond what a message itself carries.
- Microsoft Graph, JMAP and other providers, until the two first accounts work.
- Shared inboxes and more than one person per mailbox.
- Message encryption and signing (PGP, S/MIME).
- A model inside the core, and training any model on mail.
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
