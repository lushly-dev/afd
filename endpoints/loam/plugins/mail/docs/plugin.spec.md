# Mail: the plugin's specification (step F)

Step F of the [Mail proposal](../../../../../docs/features/active/mail/mail.proposal.md#9-steps):
the engine mounted on Loam's desktop, and the native app. It follows the
[engine's specification](engine.spec.md), whose numbering of decisions it continues, and
[Loam's phase 5 specification](../../../docs/phases/5-copilot/spec.md), whose
[7.2](../../../docs/phases/5-copilot/spec.md#72-a-mounted-command-only-a-person-may-run-l7-a1-d146)
names what the engine must give. Read the [status](../../../../../docs/features/active/mail/STATUS.md)
first.

## Status

- **State:** draft, for review. Nothing in it is approved or built.
- **Written:** 2026-11-19, against `main` at `d890d02d`.
- **Covers:** the engine's changes that phase 5 relies on (sections 4 to 11), in full; how the
  person mounts the engine by hand until Loam's step 9 (section 12); the native app's shape, its
  manifest and what it calls (section 13), in outline, since the app waits for phase 5's
  milestone A; what is left for Loam's step 9 (section 14).
- **Does not cover:** the native app's views and their design, which get their own amendment
  once phase 5's step 7 runs; composition with Umbel (phase G).
- **Read for this document:** `AGENTS.md`; the `afd` skill and its `jobs-first.md`; Loam's
  phase 5 specification (3.2, 5.1 to 5.3, 6.1, 7.1 to 7.5, 8, 14, 15, 18, 19, Q1 and Q2, and the
  scenarios `approve-mail-send`, `person-sends-mail`, `reply-set-fresh-context` and
  `mail-cannot-act-elsewhere`); phase 1's 7.4 and its deployment file's instance keys; the
  engine's specification (3.1 to 3.5, 7.3, 9.4, 9.5, 10, 11, 12, 13, 15); the Mail proposal's
  4.4, 4.8 and 6; the mail status file; `spec/command-metadata.md` (Approvals, "Approval evidence
  from an approver client", "Approval display") and `spec/authorization.md`'s M8; Loam's decision
  log (D109, D132, D135, D146 to D148; no later decision names mail). In code: the `afd` crate's
  `McpServer::with_approver`, `server/approver.rs`, the approval middleware's `include_token`
  rule and `credentials.rs`; the engine's `serve.rs`, `tokens.rs`, `lib.rs` (its approval
  middleware), `screening.rs` (`person_at_terminal`, `proposer_of`), `changes.rs` and
  `operations.rs` (the proposal and its approval).
- **Not verified:** everything about drafts, sending, unsubscribing and reply sets as built. Steps
  D3 and E3 are being built while this is written; where this document names a field of theirs,
  it states what step F needs, and the step F pull request that touches it aligns with what
  merged.
- **Scenario files:** five, in [`scenarios/`](scenarios/), checked with AFD's parser, the dry-run
  validation and the coverage report on 2026-11-19 ([section 3](#3-jobs-and-scenarios)).

## Terms

Terms follow the engine's specification and phase 5's.

| Term | Meaning |
| --- | --- |
| Approver | An MCP caller the engine names to the `afd` crate's `with_approver` hook: one holding an approver token (section 4) |
| Released command | One of the four person's commands listed over MCP and held for every caller (section 5) |
| Preview | The read whose result a person sees before a released command runs (section 6) |
| Revision | An integer the engine raises on every change to a draft or a reply set |
| Digest | The unpadded base64url SHA-256 of a value's canonical JSON, as `afd::input_digest` computes it (43 characters) |
| Unit | A result marked `"dev.loam/unit"`, composed by Loam in a fresh context (phase 5's 7.3) |

## 1. Decisions of this specification

They continue the engine's M15 to M29. All are proposed, for review.

| | Decision | Why |
| --- | --- | --- |
| M30 | A token has a role, `agent` or `approver`, chosen by the person when it is made at the terminal. An approver token is an agent's token that the engine also names to the crate as an approver | Phase 5's 7.2 asks for "an approver token, made only at its terminal". A role on the existing tokens reuses their storage, listing and revocation |
| M31 | Four person's commands are listed over MCP and held by their approval policies for every caller: `mail-draft-send`, `mail-replyset-send`, `mail-unsubscribe`, `mail-operation-approve`. The others stay at the terminal. This amends M18 | Phase 5's 7.2, item 2. Only a person's approval releases them: at the terminal, or an approver's evidence |
| M32 | Each released command has a preview read whose result changes only when its target changes, with its target in labelled parts | Loam shows the preview and re-reads it while the instance is held; a preview that varies by itself would show every send as "Changed since you looked" |
| M33 | A draft and a reply set carry a revision; an unsubscribe target and a proposal's preview carry a digest. Each released command names it in its input and fails with `PREVIEW_CHANGED` when it no longer matches | Phase 5's 7.2, item 4. A record the engine edits by command has a cheap exact counter; what is derived from changing data needs a digest of what was shown |
| M34 | A held command runs only on a person's approval, so it acts as the person's, whoever carried the approval | Phase 5's 7.2, item 5. The handler runs only after the approval middleware has accepted evidence |
| M35 | `mail-replyset-next` becomes a read that returns one unit, whose id is derived from the reply's inputs; a new `mail-replyset-submit` stores the composed text and records what it was written from | Phase 5's 7.3, and the proposal's 4.8. A read keeps the default mode `act` in Loam (its 6.1) |
| M36 | Taint stays per instance. The engine adds per-account agent limits, and an agent's or a script's change may not span accounts | The residual risk of phase 5's 5.3. Recommended, not decided: [Q1](#q1-taint-per-account) |
| M37 | Over MCP, a held result to a caller that is not an approver carries no approval token, and its suggestion says where the person runs it | The crate's default would include the token for every MCP caller once these commands are listed (section 5.2) |
| M38 | The mounted instance is `mail`, with the command prefix `mail`; the native app's id is `mailapp` | Phase 1 keeps app ids and prefixes unique, so the app cannot also be `mail` |

## 2. What phase 5 asks, and what exists

Phase 5's 7.2 ends with a list headed "What the mail engine needs". This document answers each
item, and 7.3's unit:

| Phase 5 asks | Answered in |
| --- | --- |
| An approver token, made only at its terminal | [Section 4](#4-the-approver-token) |
| Exactly four person-only commands listed over MCP, held for every caller; the others not listed | [Section 5](#5-the-four-released-commands) |
| A preview read for each released command, its target in labelled parts | [Section 6](#6-previews) |
| Each released command's input names a revision or the preview's digest, checked by the engine | [Section 7](#7-revisions-and-digests) |
| A call carrying an approver's evidence counts as the person's against the agent limits | [Section 8](#8-a-held-command-acts-as-the-persons) |
| A reply set that returns units (7.3; step 7 waits for it) | [Section 9](#9-units-from-a-reply-set) |
| Per-account taint sources, left to mail's step F (5.3, section 17) | [Section 10](#10-taint-per-account) |

**What exists in AFD.** Phase 5's step 0c is merged ([#1475](https://github.com/lushly-dev/afd/pull/1475)).
In the `afd` crate the engine builds on (0.2.1, by path):

- `McpServer::with_approver(|context| bool)` exists. For a caller it names, a held result carries
  `details.approvalToken` and never becomes a form elicitation, and a `tools/call` whose
  `_meta["dev.afd/approval"]` holds a token has it set as the call's evidence (`AFD_APPROVAL_META_KEY`).
  The key in tool arguments is refused with `VALIDATION_ERROR` from every caller, and a batch, a
  pipe or a 2025-era request carrying it is refused.
- A token issued on an approver's call binds the call's principal binding (`spec/authorization.md`,
  M8): the actor, and the credentials when there are any.
- Whether an approver's evidence was used is not visible to a handler: the call's approver state
  is the crate's own (`pub(crate)`). The engine does not need it (section 8).
- The approval middleware's `include_token` defaults to `true`, which gives every held MCP result
  its token unless a relay is set. The engine sets no relay. Section 5.2 handles it.

So the engine waits on nothing in AFD. It waits on its own steps D3 (drafts, send and unsubscribe)
and E3 (reply sets), and on Loam's phase 5 steps 4 and 5 for the instance entry's new keys
(section 12).

## 3. Jobs and scenarios

The jobs are written as scenario files, one per job, in [`scenarios/`](scenarios/), as
`jobs-first.md` asks. Phase 5 already holds the jobs as Loam serves them, against its `mailfix`
fixture (`approve-mail-send`, `person-sends-mail`, `reply-set-fresh-context`,
`mail-cannot-act-elsewhere`); these are the engine's side of the same jobs, run against
`loam-mail serve` itself.

| # | Job | When … I want … so that … | File |
| --- | --- | --- | --- |
| 1 | An agent cannot send | When an agent connected over MCP asks the mail engine to send, I want the send held for me whatever the agent does, so that nothing leaves my account unless I decided it | [`agent-cannot-send`](scenarios/agent-cannot-send.scenario.yaml) |
| 2 | Only what I saw is sent | When I approve sending a draft, I want exactly the version I saw to go, with the account and recipients I saw, so that a change made after I looked can never go out under my approval | [`send-what-i-saw`](scenarios/send-what-i-saw.scenario.yaml) |
| 3 | See what an unsubscribe will contact | When I'm asked to unsubscribe from a list, I want to see exactly what the engine will contact and how, so that an unsubscribe never reaches a place I did not see | [`unsubscribe-target-shown`](scenarios/unsubscribe-target-shown.scenario.yaml) |
| 4 | Approve exactly what an agent proposed | When an agent proposes a change larger than it may make alone, I want to approve it from a preview that says what it touches, and have exactly that run, so that a change steered by a message or altered after I looked cannot run under my approval | [`approve-what-was-proposed`](scenarios/approve-what-was-proposed.scenario.yaml) |
| 5 | Hand out each reply with only its own inputs | When an agent writes the replies of a reply set, I want each handed out with only its own sender's message and my answers to it, and recorded with what it was written from, so that I can check every reply against exactly its inputs before I send the set | [`compose-replies-apart`](scenarios/compose-replies-apart.scenario.yaml) |

**How they run.** Each is tagged `mail-engine`: it runs with `afd scenario run <dir> --server <url>`
against `loam-mail serve` on the scripted IMAP server, seeded as `mail-f-base`, with an ordinary
agent's token. The seed and the run in the engine's workflow are built by the step F pull requests
(section 18). Until then they are checked, not run.

**Checked on 2026-11-19** with AFD's parser (`afd scenario validate`), the dry-run validation and
the coverage report: all five parse and validate, 22 steps. Against the commands this document
adds or changes and the codes it adds:

- **Commands no job uses:** `mail-token-list` and `mail-replyset-send`. The first is a terminal
  read, which a scenario over MCP cannot reach; the second is held for every caller the runner
  can be, as the other sends are, and job 5 covers its preview.
- **Codes no job shows:** `PREVIEW_CHANGED`, since only an approved call reaches the check, and no
  scenario step can carry an approval.
- **Commands the files call that this document does not draft** are earlier steps':
  `mail-draft-create`, `mail-draft-update`, `mail-policy-set`, `mail-selection-create` and
  `mail-trash`.

**What the scenarios cannot show,** and where it is shown instead:

- an approver's evidence releasing a command, since every step runs as one caller and the runner
  cannot set `_meta` (tests F-T4 and F-T7, and Loam's P5-A9);
- that a held result carries no token, since a scenario cannot assert an error's `details` (F-T3);
- the `"dev.loam/unit"` marker, since the matcher reads a key holding a dot as a path; the files
  assert the unit's id where the result repeats it (F-T9);
- making a token at the terminal, which is a person's command with no MCP surface (F-T1).

**Not walked.** `jobs-first.md` asks for the paths to be walked by readers who did not write them.
That has not been done; it belongs to this document's review.

## 4. The approver token

### 4.1 Made at the terminal

- **`mail-token-create` gains `role`:** `{ name, role? }`, `role` one of `"agent"` (the default)
  and `"approver"`. It stays a person's command, exposed to `cli` alone and held for approval, as
  step B5 built it.
- **The summary says what an approver can do,** in the engine's words: "Make an approver token
  named "<name>": a client holding it can send mail, unsubscribe and approve proposals once it has
  shown you the action and you agreed, while `loam-mail serve` runs. Give it only to Loam." An
  agent's token keeps its summary.
- **Its form.** An approver token is `lmail_approver_` and 64 hex digits from the operating
  system's random source; its id is `tok_` and 16 hex digits, as an agent's. The prefix says
  what a token found in a file is.
- **Stored as tokens are:** the `token` table gains `role` (`agent` or `approver`, not null, every
  existing row `agent`), in a migration numbered after D3's and E3's. The store keeps the hash
  alone. The token is shown once and its result is removed from the journal, as now.
- **Written to a file.** The command line gains `--out <file>` for `mail-token-create`: it writes
  the token to a new file, mode `0600`, refusing a file that exists, and prints the path instead
  of the token. This is how the person makes Loam's `bearer_file` (section 12) without copying a
  secret through a clipboard. The path is the command line's flag, never command input, so the
  journal never holds it.
- **A role is not changed.** To move from one role to the other, make a new token and revoke the
  old one. Several approver tokens may exist, one per Loam installation, for example.

### 4.2 How the engine marks an approver

- The layer of [3.4](engine.spec.md#34-the-http-surface) is unchanged: it finds the caller from the
  bearer's hash. The engine's in-memory map of hashes gains each token's role, read when the
  server starts and again after a token is made or revoked, as now.
- The context hook is unchanged: it sets the actor `{ kind: agent, id: <the token's id> }`.
- The engine registers `McpServer::with_approver(|context| …)`, true exactly when the call came
  over HTTP and its actor's id is a token whose role is `approver`. Over stdio there is no
  approver: `loam-mail mcp`'s one caller is never one.
- **No credentials are set.** The crate's rule 4 binds an approver's token to the call's principal
  binding, which without credentials is the actor alone, and advises naming over HTTP only callers
  with verified credentials. The engine's layer has verified the bearer, and its hook gives each
  token its own actor, so two approver tokens never share a binding: one cannot redeem the
  other's token. Setting `Credentials` would claim an OAuth issuer the engine does not have. Test
  F-T4 holds the engine to this.
- An approver's token is also an agent's token for every other call: Loam's copilot, its apps and
  the person's own gestures in Loam all reach the engine with it (section 8.3).

### 4.3 Listed and revoked

- `mail-token-list` gives each token's `role` beside its id, name and time. It stays a terminal read.
- `mail-status` gains `tokens: { agents, approvers }`, counts only, so a person or an agent reading
  the status sees that an approver exists, and a second one they did not make stands out.
- `mail-token-revoke` is unchanged: a revoked approver is refused from the next request, so
  Loam's mount fails with `401 UNAUTHORIZED` and Loam reports the instance unreachable. A hold
  already issued to it is refused on retry, since the call's actor is then unknown to the layer.

## 5. The four released commands

### 5.1 Exposure

| Command | Exposed to | Held | Preview |
| --- | --- | --- | --- |
| `mail-draft-send` | `cli`, `mcp` | Every call (`ApprovalPolicy::Required`) | `mail-draft-show` |
| `mail-replyset-send` | `cli`, `mcp` | Every call | `mail-replyset-show` |
| `mail-unsubscribe` | `cli`, `mcp` | Every call | `mail-unsubscribe-show` (new) |
| `mail-operation-approve` | `cli`, `mcp` | Every call | `mail-operation-show` |

`agent` and `palette`, the crate's in-process surfaces, stay false. Each keeps its class: the first
three remote and destructive, `mail-operation-approve` remote and undoable, as M29 and the engine's
section 11 have them.

**Not listed, unchanged:** `mail-token-create`, `mail-token-revoke`, `mail-token-list`,
`mail-policy-set`, `mail-account-add`, `mail-account-remove`, `mail-sender-screen` and
`mail-sender-accept`. Their results or effects are credentials, the person's rules, or the person's
own decisions on senders, as phase 5's 7.2 says. `mail-rebuild` stays a terminal command too.

A test over the registry fails the build unless the person's commands exposed to `mcp` are exactly
these four and each has `ApprovalPolicy::Required`, which no input can turn off.

### 5.2 What a caller that is not an approver gets

- **`APPROVAL_REQUIRED`,** `retryable: false`, with `details.summary` and `details.expiresAt`.
- **No `details.approvalToken`.** The crate includes it because `include_token` defaults to
  `true` and the engine sets no relay. A token on a non-approver's call is bound to that caller's
  actor and could not be presented over MCP, where only an approver's `_meta` is read, so it is
  useless to the agent. It is removed all the same, so that no token for a send ever reaches an
  agent or its transcript. The engine wraps its approval middleware with its own, which, for a call
  on the `mcp` interface whose caller is not an approver, removes `details.approvalToken` and
  replaces the suggestion. The command line's route keeps the token, which it needs for its retry.
- **The suggestion,** in the engine's words: "Only the person can do this: at the terminal with
  `loam-mail <command>`, or in Loam, which shows them the preview and asks." No elicitation form
  is offered: the engine sets no MCP elicitation relay, since an answer to one is the client's, not
  a person's (M18's reason, which still holds).
- **The summary holds no content,** as [3.5](engine.spec.md#35-commands-only-a-person-may-run)
  requires: "Send draft 12 from account 1 to 3 recipients", "Send reply set 3: 14 replies",
  "Unsubscribe message 41 by a one-click post", "Approve operation 12: move 283721 messages to the
  trash, proposed by the agent with the token "laptop" (tok_…)". The last names a token's name,
  the person's own words, as now.

### 5.3 What releases them

Only two things:

1. **The person at the terminal,** as now: the command line reads the preview, shows it, asks, and
   retries with the token on its private route.
2. **An approver's evidence:** the approver retries the same call, with the same input, carrying
   `details.approvalToken` in `_meta["dev.afd/approval"]`. The crate verifies it against the
   input, the approver's actor, the expiry (the engine's 30 minutes) and single use.

Nothing else sets evidence: tool arguments cannot, a non-approver's `_meta` is ignored, and the
engine's own code never sets `context.approval`.

### 5.4 M18, amended

The engine's M18 becomes, when the first pull request of section 18 that releases a command
merges:

> Commands only a person may run are exposed to `cli` alone, except four, which are also listed
> over MCP: `mail-draft-send`, `mail-replyset-send`, `mail-unsubscribe` and
> `mail-operation-approve`. Each is held by its approval policy for every caller, and only the
> person at the terminal or an approver's evidence (the plugin's specification, section 5)
> releases it. A caller that is not an approver gets `APPROVAL_REQUIRED` with no token. The
> approval's summary holds no content.

M18's reason changes with it: the route by which a shell's approval reaches a mounted server now
exists (AFD's approver carrier and Loam's 7.2). The engine's 3.5, 11 and the phase B exit test
"a person's command is not listed or callable over MCP" are amended to match (section 15).

## 6. Previews

Each preview is a read, exposed to `cli` and `mcp`, whose input keys are the keys Loam's entry
names (`preview = { command, input = [...] }`, phase 5's 7.2). Each returns its target with
everything a person needs to decide, every value from mail in a part labelled `"trust": "content"`.

**Stable for an unchanged target.** Loam calls the preview again under its hold and compares the
two results' canonical digests. So a preview's result holds no time of reading, no cursor that
moves on its own and no count of anything outside its target. Two reads of an unchanged target are
equal in canonical JSON (test F-T6).

| Preview | Input keys (`preview.input`) | Returns |
| --- | --- | --- |
| `mail-draft-show` | `["draft"]` | `draft`: `id`, `revision`, `state`; `account`: the sending account's `id` and provider, and its address in a labelled part; `recipients`, each with its `role` (`to`, `cc`, `bcc`), its `basis` (section 8.2) and its address and display name in a labelled part; the thread or message it answers, by id; `content`, labelled: subject and body; who wrote each part (the engine's 9.5) |
| `mail-replyset-show` | `["replyset"]` | `replyset`: `id`, `revision`, `state`, the account, the shared text in a labelled part, and `replies`, each with its id, `recipient` (labelled; set by the engine from the source message), `text` (labelled), `differs` (whether its text differs from the shared text), `composedVia` (`unit` or `edited`), its `unit` and its `inputs` (section 9.4) |
| `mail-unsubscribe-show` (new) | `["message"]` | `unsubscribe`: `message`, `account`, `method` (`one-click` for an HTTPS post the message declares with `List-Unsubscribe-Post`, or `mail`), the target URL or address in a labelled part, the list's id in a labelled part, and `digest` |
| `mail-operation-show` | `["operation"]` | As step D1's third part built it, its `preview` gaining `digest` |

- **`mail-unsubscribe-show`** takes `{ message }`. A message with no usable `List-Unsubscribe`
  header fails with the code D3 gives `mail-unsubscribe` for it. It contacts nothing: it reads the
  message's held headers.
- **`mail-operation-show`'s first page.** Called with `{ operation }` alone it returns its first
  page of items, which for a proposal does not change, since the set is frozen. Its `preview` is
  what the digest covers (section 7).
- **Display.** Loam measures each held call's input by AFD's display rules before it shows a
  confirmation. Every released command's input is ids, an integer and a 43-character digest, so
  it always passes.

## 7. Revisions and digests

| Command | Input | Names | Checked against |
| --- | --- | --- | --- |
| `mail-draft-send` | `{ draft, revision }` | The draft's revision | The draft's current `revision` |
| `mail-replyset-send` | `{ replyset, revision }` | The set's revision | The set's current `revision` |
| `mail-unsubscribe` | `{ message, digest }` | The digest of the target shown | The digest of `{ message, account, method, target }` as `mail-unsubscribe-show` derives it now |
| `mail-operation-approve` | `{ operation, digest }` | The digest of the proposal's preview | The digest of the `preview` `mail-operation-show` would give now, without `digest` itself |

- **Drafts,** as step D3 is building them: a draft carries an integer `revision`, from 1, raised by
  every `mail-draft-update`, returned by `mail-draft-show`, and `mail-draft-send` takes
  `{ draft, revision }`. Step F adds nothing to the draft's revision; it adds `basis` to each
  recipient if D3 has not (section 8.2).
- **Reply sets** carry the same: an integer `revision`, raised by every change to the set (its
  questions, the person's answers, a reply's text by `mail-replyset-submit` or an edit, a reply
  removed), returned by `mail-replyset-show`.
- **Why a digest for the other two.** An unsubscribe target is derived from a message's headers,
  which can be derived again by a newer parser without any command on the message; a proposal's
  preview counts messages by screening class and known senders, which change when the person
  decides on a sender. Neither has a record a counter could follow, so the engine digests what it
  showed.
- **When it is checked.** In the handler, first, after the approval has been accepted and before
  anything is sent, contacted or changed, inside the store's lock for drafts and reply sets. A
  revision that is lower or higher than the current one fails alike. The approval token is bound
  to the input, so a revision named in a held call cannot be changed on the retry.
- **The code.** A mismatch fails with **`PREVIEW_CHANGED`**, added to the engine's 12.3,
  `retryable: false`: "The draft changed since its preview was read. Nothing was sent. Read it
  again with `mail-draft-show` and ask the person again." The suggestion names the command's
  preview. One code for the four keeps one rule for Loam and for agents. Step D3 should use it for
  a draft's revision; if D3 merges with another name, the first step F pull request moves the
  draft's check to `PREVIEW_CHANGED` and records it.
- **At the terminal.** `revision` and `digest` are required inputs. When the person leaves one
  out, the command line reads the preview first, fills it in from what it will show, and then runs
  the command, so that the token is bound to the input that includes it.
- **Outside Loam too.** Any approved call naming a stale revision or digest fails, whoever carried
  the approval, so a change made by another caller between the preview and the send fails the
  send at the terminal as well as in Loam.

## 8. A held command acts as the person's

### 8.1 The rule

A released command's handler runs only after the approval middleware has accepted evidence: the
person's at the terminal, or an approver's. So the handler acts as the person's whoever carried
it. The engine does not need to see whether evidence was used; it knows the handler is held. For
the policy of [9.4](engine.spec.md#94-the-policy):

- **`mail-operation-approve`** already runs the operation as the person's: no limit applies, and
  it counts against no caller's day, approved at the terminal or through Loam.
- **`mail-draft-send`, `mail-replyset-send` and `mail-unsubscribe`** are not under the policy's
  limits; nothing changes for them.
- **A person's own bulk change through Loam** is a change from Loam's approver token, which is an
  agent's for every call that is not held. Over a limit it becomes a proposal, and the person's
  approval of that proposal in Loam runs it as the person's. So it is never counted as an agent's
  change, but it takes the shape of a proposal and an approval. A proposal made this way counts
  against no caller's day, as any proposal does.

### 8.2 Recipients

The engine's 9.5 allows a recipient that is a participant of the thread being answered, an address
the person has written to, or one the person typed at the terminal for this send. Through Loam the
person types into the mail app, which reaches the engine with the approver token like everything
else, so the engine cannot tell the person's typing from the copilot's.

- **Each recipient in `mail-draft-show` carries `basis`:** `thread`, `written-to` or `new`.
- **A send released by an approver's evidence may include `new` recipients,** since the person saw
  each one, marked new, in the preview they approved. Loam's confirmation shows the preview's parts
  ([Q2](#q2-new-recipients-from-loam)).
- At the terminal the rule is unchanged: the command line asks the person to type a new address.
- A send from any caller still never takes a recipient from a message's text: `Reply-To` is
  flagged as now, and a reply set's recipients are set by the engine.

### 8.3 One caller for everything Loam does

Loam has one bearer per instance. Its copilot, its apps and the person's own gestures in Loam
therefore reach the engine as one agent, the approver token's actor. For the policy that means:

- the per-call limits apply to each call alike;
- the day's trash is shared by all of them;
- the five proposals waiting are shared, so five proposals from the copilot make a sixth from the
  person's own bulk change fail with `POLICY_LIMIT`, until the person approves or dismisses one;
- a proposal is listed as "proposed by the agent with the token "Loam"", whichever of them made it.

Accepted for step F: Loam's journal records which of them called, and the engine's limits are for
what an agent does with nobody present. Loam presenting a person's gesture as evidence on a call
that is not held would need an AFD change and is not proposed.

## 9. Units from a reply set

### 9.1 `mail-replyset-next`

- **A read,** exposed to `cli` and `mcp`, no longer Local as the engine's section 11 lists it. As a
  read it is not journaled, and in Loam it keeps the default `act` of a `per-part` instance's reads
  (phase 5's 6.1), as phase 5's `reply-set-fresh-context` scenario expects of `mailfix`.
- **Input** `{ replyset }`. It returns the first reply, in the set's order, that has no text, or
  `{ replyset, done: true }` when every reply has text.
- **Result:**

  ```json
  {
    "replyset": 3,
    "reply": 1,
    "unit": "rsu_3_1_2",
    "dev.loam/unit": {
      "id": "rsu_3_1_2",
      "submit": {
        "command": "mail-replyset-submit",
        "input": { "replyset": 3, "reply": 1, "unit": "rsu_3_1_2" },
        "field": "text"
      },
      "instructions": "<the engine's text, below>"
    },
    "content": {
      "trust": "content",
      "recipient": { "address": "ada@example.com", "name": "Ada" },
      "message": { "subject": "…", "text": "…" },
      "answers": [ { "question": "…", "answer": "…" } ]
    }
  }
  ```

  `unit` repeats the id outside the marker, for callers that do not read Loam's key.
- **The unit's id** is `rsu_<set>_<reply>_<inputs>`, where `<inputs>` is the reply's inputs
  revision: an integer raised when the answers that reply uses or its source message change. It
  is derived, so `next` stores nothing, and a unit stays valid until the reply's inputs change.
- **What the unit holds:** the recipient's own message (its visible text, within the read budget),
  and the person's answers to the questions that recipient asked, nothing from any other reply or
  message. All of it is in one labelled part. The answers are labelled too: step E3 decides who may
  record them, and a part a caller could have written is content to Loam's composer, which treats
  every part as content anyway (7.3).
- **`instructions`,** at most 4,096 characters, fixed by the engine and versioned: write a reply
  from the person to the message in this unit, using only the answers given; add no recipient,
  link, promise or fact that is not in the answers; reply in the message's language; return the
  reply's text alone. Loam gives it to the composer as the server's claim.

### 9.2 `mail-replyset-submit` (new)

- **Local,** a mutation, not destructive, not held; exposed to `cli` and `mcp`. Phase 5's 7.3
  requires a submit that is none of destructive, held or of another instance.
- **Input** `{ replyset, reply, unit, text }`, `text` 1 to 32,768 characters, the composer's
  limit. No recipient, subject or account: the engine sets them.
- **Checked:** the set exists and is not sent (`PROPOSAL_NOT_OPEN` is not reused; the set's own
  state code from E3 applies); `unit` equals the reply's current unit id, or the submit fails with
  **`UNIT_NOT_OPEN`**, whose suggestion is "Call `mail-replyset-next` again: the person's answers or
  the message changed since this unit was handed out".
- **Effect:** the reply's text becomes `text`, `composedVia` becomes `unit`, and the set's revision
  is raised, so an approval read before it no longer sends.
- **Result:** `{ reply: { reply, composedVia, unit }, revision }`. Never the text, so that Loam's
  composer's submit returns nothing worth reading to the parent (7.3 hides it anyway).
- A submit for a reply that already has text replaces it; the earlier submission stays in the
  reply's record (9.4). An edit of a reply's text by any other command sets `composedVia: edited`.

### 9.3 Who may call them

Any caller over MCP or at the terminal. Isolation is real only when the caller composes each unit
in a fresh context, which Loam's copilot does and an arbitrary agent may not (the proposal's 4.8).
The engine cannot prove it; it records who submitted, and the set's preview marks every reply whose
text differs from the shared text, so the person reviews the differences before the one approval.

### 9.4 What the engine records per reply

For audit, as the proposal's 4.8 asks: every submission, kept with the reply until the set is
removed, holds the unit id; the inputs it was handed (the source message's id, each answer's id and
revision, the instructions' version); the submitter (the actor's kind and token id); when; and the
digest of the text. `mail-replyset-show` gives the latest per reply as `unit` and `inputs`, and the
number of earlier submissions. The submit's input, with its text, is journaled as every mutation's
is ([13.1](engine.spec.md#131-the-journal)).

## 10. Taint per account

Phase 5's 5.3 records a residual risk: taint's source is the instance, so with one engine holding
work and personal accounts, a message in the personal account that the copilot read can steer
archiving or trashing in the work account, within mail's policy, without a confirmation. Three
ways to answer it:

| | Option | Engine's cost | Loam's cost | What it gives up |
| --- | --- | --- | --- | --- |
| (a) | **One engine per account:** each runs with its own `LOAM_MAIL_HOME`, port, tokens and instance entry | None in code. Two processes, two stores, two indexes, two syncs; step 9's install must install a plugin's engine twice | None for taint: two instances are two sources. Each needs its own prefix (phase 1's 7.4), so the second's commands are renamed (`mailwork-draft-send`), and the native app needs a grant and a client per instance | One unified inbox (the app merges two), the engine's identity of a message across accounts (its 4.2), and one knowledge of senders: a sender known at work is a stranger at home, and the other way |
| (b) | **A source per account in Loam:** the engine puts the account on every labelled part, and Loam's kernel records `<instance>/<account>` as the source and lowers a call that touches another account | Every content part carries its account; every mutation reports which accounts its input touches, before it runs | A change to 5.3 and its tests: the kernel must learn, from the server, which accounts a call's input (a selection's id, message ids) touches. That is a server's claim about its own input, which 5.1 lets a `per-part` server make, but it puts the boundary on the server's word | Nothing on the engine's side; Loam's taint rule grows a mail-shaped exception |
| (c) | **Keep one source, and limit in the engine:** per-account agent limits, and no agent's or script's change across accounts | A migration: the policy gains an optional row per account (each number of 9.4, falling back to the default row); `mail-policy-set` takes `account`. A change, a resume or an undo by an agent or a script whose set spans accounts fails with `SELECTION_SPANS_ACCOUNTS` before anything is asked of the provider. The proposal's preview already counts by account | None | Protection is opt-in: with the default limits the risk is as 5.3 states. A person who sets the work account's agent limits to 0 makes every agent change there a proposal, approved in Loam with its account shown |

**Recommended: (c),** with (a) open to anyone who wants the hard boundary today. Reasons:

- (b) asks Loam's kernel to trust a server's account report for the boundary it enforces, and is
  the most work on both sides for one server's shape.
- (a) is available now without any change, but it costs the unified client D135 asks for and
  splits the knowledge of senders that screening rests on.
- (c) is small, local to the engine, and turns the risk into the person's setting: an account the
  person guards cannot be changed by an agent without their approval, however the agent was
  steered. A change in the account the content came from stays within the policy, as it does
  today for one account.

Whether the protection should be opt-in, and which way to go, is the owner's call:
[Q1](#q1-taint-per-account). The decision is recorded as M36 when he answers. Reads are unaffected
by any option: reading mail carries nothing out of the machine, and a draft goes nowhere until a
person approves its send.

## 11. Labels per part

Loam's entry says `labels = "per-part"`, by which the deployer vouches for three things
(phase 5's 5.1):

1. **Every stranger-written value is in a labelled part.** The engine's 12.1 already requires it in
   every result, and the phase B test checks that no content appears outside a labelled part. Step
   F's new results follow it: the unsubscribe target, the unit's parts and the reply set's texts.
2. **Its `mutation` reports are true.** Each command declares `as_mutation()` when it changes
   anything; `mail-replyset-next` stops being one (section 9.1). The engine's test over the
   registry gains: every command that writes the store is a mutation, checked by name against a
   list, as M29's test checks the destructive flag.
3. **Its `destructive` reports are true:** M29's test, unchanged.

What `per-part` then gives the engine in Loam: its reads run without asking (6.1), its own
non-destructive mutations keep its own policy under taint (5.3), and its units are composed (7.3).
Loam reads only `structuredContent`; the text duplicate the crate sends is never given to a model.

## 12. Mounting by hand, until Loam's step 9

What the person does on the desktop, once Loam's phase 5 steps 4 and 5 accept the entry's new keys
and the engine has the changes of section 18:

1. Run `loam-mail serve --port 7461` (a port the person chooses; the entry names it).
2. At the engine's terminal: `loam-mail mail-token-create '{"name":"Loam","role":"approver"}' --out <file>`,
   and approve. The file is the person's alone.
3. Write the instance in `loam.deployment.toml` (below), then run Loam's `deployment check` and
   `deployment write`.

The entry, in phase 1's form. Phase 5's 7.4 sketched it as `[[instances]]`; phase 1's deployment
file writes an instance as a table under `apps`, and a mounted instance needs `package`, `prefix`
and `audience` too:

```toml
[apps.mail]
app = "mail"
package = "<the engine's mount package, built from endpoints/loam/plugins/mail/mount/>"
audience = "person"
transport = "http"
url = "http://127.0.0.1:7461/mcp"
bearer_file = "<the file mail-token-create wrote>"
labels = "per-part"
approvals = "shell"
expose = { agent = true, palette = true, apps = true }   # the reads

# The four released commands, each with its preview.
[apps.mail.commands."mail-draft-send"]
expose = { agent = true, apps = true }
preview = { command = "mail-draft-show", input = ["draft"] }

[apps.mail.commands."mail-replyset-send"]
expose = { agent = true, apps = true }
preview = { command = "mail-replyset-show", input = ["replyset"] }

[apps.mail.commands."mail-unsubscribe"]
expose = { agent = true, apps = true }
preview = { command = "mail-unsubscribe-show", input = ["message"] }

[apps.mail.commands."mail-operation-approve"]
expose = { agent = true, apps = true }
preview = { command = "mail-operation-show", input = ["operation"] }

# The unit's submit, which 7.3 requires the entry to name.
[apps.mail.commands."mail-replyset-submit"]
expose = { agent = true, apps = true }
```

**Every other mutation the person wants reachable** is named the same way, with
`expose = { agent = true, palette = true, apps = true }`. The engine's mutations exposed over MCP
are: `mail-sync`, `mail-selection-create`, `mail-archive`, `mail-label`, `mail-mark`, `mail-trash`,
`mail-operation-dismiss`, `mail-operation-undo`, `mail-operation-resume`, `mail-operation-cancel`,
`mail-thread-snooze`, `mail-draft-create`, `mail-draft-update`, `mail-draft-discard`,
`mail-draft-restore`, `mail-sender-suggest`, `mail-sender-dismiss`, `mail-record-propose`,
`mail-record-withdraw`, `mail-story-propose`, `mail-story-dismiss`, `mail-replyset-create`, and
step E3's command for recording answers. A command left out stays hidden from Loam's agents and
apps, as phase 1's 7.4 says.

**The mount package.** Loam mounts an instance from a package with a manifest of kind `mounted`.
Step F adds `endpoints/loam/plugins/mail/mount/` with that manifest: `plugin.id = "mail"`,
`domains = ["mail"]`, `mount = { prefix = "mail", transport = "http" }`, and `mount.tools[]`
effects for the commands above, so that Loam's precedence (its 7.4) agrees with the engine's
reports. The prefix equals the commands' domain, so the final names are the engine's own.

**Not served by a fixed port.** The engine picks a port when `--port` is absent and records it in
`server.json`. A hand mount needs `--port`, since the entry is written once. Step 9's install
chooses the port and writes both.

## 13. The native app

The app is built after phase 5's step 7 has mounted the engine on the desktop; this section fixes
its shape so that the engine's commands and the instance entry need no change for it. Its views
and their design get their own amendment.

- **Two manifests, one plugin** (phase 5's 7.5): the mounted instance `mail` (section 12) and a
  native app, `mailapp`, titled "Mail", in `endpoints/loam/plugins/mail/app/`.
- **It holds no mail.** Everything it shows comes from the engine through its `calls` grant; it
  keeps only view state (which mailbox is open, a draft being typed before its first save).
- **It renders no stranger's markup as markup.** It shows the engine's cleaned HTML (the engine's
  B4) in a sandboxed frame, or text, and labels values from mail as the engine labels them.
  Whether a native app or a view kind serves that better is the app's amendment to decide.

**Its manifest's grant,** in the form phase 5's 7.5 describes (`[[calls]]` naming an instance and
its commands; the exact key is phase 5's step 4's):

```toml
[[grants]]
name = "calls"
reason = "Reaches your mail engine's commands through Loam."

[[calls]]
instance = "mail"
commands = [
  # reading
  "mail-status", "mail-account-list", "mail-message-list", "mail-thread-list", "mail-thread-open",
  "mail-message-open", "mail-attachment-open", "mail-search", "mail-sender-list", "mail-sender-show",
  "mail-story-list", "mail-story-open", "mail-story-changes", "mail-policy-show",
  "mail-operation-list", "mail-operation-show",
  # changing the mailbox, under the policy
  "mail-selection-create", "mail-archive", "mail-label", "mail-mark", "mail-trash",
  "mail-operation-undo", "mail-operation-resume", "mail-operation-cancel", "mail-operation-dismiss",
  "mail-thread-snooze", "mail-sender-suggest", "mail-sender-dismiss",
  # writing and sending
  "mail-draft-list", "mail-draft-show", "mail-draft-create", "mail-draft-update",
  "mail-draft-discard", "mail-draft-restore", "mail-draft-send",
  # reply sets
  "mail-replyset-create", "mail-replyset-show", "mail-replyset-send",
  # the person's other releases
  "mail-unsubscribe-show", "mail-unsubscribe", "mail-operation-approve",
]
```

- **What it does not call:** `mail-replyset-next` and `mail-replyset-submit`, which are the
  copilot's path; `mail-record-propose` and `mail-story-propose`, which are agents'; and every
  command that is not listed over MCP.
- **The person's send** is phase 5's 7.2 path for a human gesture: the app calls
  `mail-draft-send { draft, revision }` with the revision it last showed, Loam shows the
  confirmation in the slot with `mail-draft-show`'s preview, and on confirm presents the engine's
  token. A changed draft gives `PREVIEW_CHANGED`, and the app shows the draft again.
- **What the person cannot do in the app,** under phase 5's 7.2: decide on a sender
  (`mail-sender-screen`, `mail-sender-accept`), change the policy, or manage accounts and tokens.
  The app can suggest a decision on a sender, which the person then accepts at the terminal. This
  falls short of "the owner's only mail client" (D135) for screening: [Q3](#q3-sender-decisions-in-the-app).

## 14. What remains for Loam's step 9

Step 9 adds `loam plugin install` (phase 5's 7.4), and Q2's condition requires an amendment that
gives it a path with no terminal first. For mail it must provide:

- **The plugin manifest** (`loam-plugin.toml`): the app `mailapp`, the mount package, and the
  engine: the `loam-mail` artifact and its SHA-256, `kind = "http-service"`. The engine already
  takes `serve --port <port>`, as 7.4's start line needs.
- **The entry's declarations,** which the install writes: section 12's `labels`, `approvals`,
  previews and exposures, declared by the plugin rather than typed by the person.
- **The approver token with no terminal.** Today only `mail-token-create` at the engine's terminal
  makes one. The amendment decides how the trusted installer obtains one after the person agrees
  in the installer's own dialog: for example, a `loam-mail pair --role approver --out <file>`
  mode the installer runs. That carries the same assurance as the terminal (Umbel's `terminal`;
  phase 5's T15), and no more. Not specified here.
- **The service at sign-in** (Q2's answer), per operating system.
- **The keychain on Windows and Linux.** The engine keeps credentials in the macOS keychain only
  (its section 2); on another platform adding an account says there is no keychain yet. The
  desktop lane runs on Windows and Linux too, so mail there needs those stores first.
- **Upgrades:** a new engine binary is a new install (7.4); the data directory is kept.

## 15. Amendments to the engine's specification

Applied by the pull request that builds each, so as not to collide with D3 and E3:

| Engine section | Change | By |
| --- | --- | --- |
| M18 | Section 5.4's text | F2 |
| 3.3 | Tokens have a role; an approver token's form; the `with_approver` mapping | F1 |
| 3.5 | Four commands also listed over MCP; what a non-approver gets; the command line fills a revision or digest | F2, F3 |
| 9.4 | A held command acts as the person's; one caller for Loam; per-account limits and single-account changes, if Q1 is answered (c) | F2, F4 |
| 9.5 | Recipients' `basis`; `new` recipients on a send released by an approver | F2 |
| 10.3 | Reply sets' revision; units; `mail-replyset-submit`; what is recorded per reply | F3 |
| 11 | Exposure of the four; `mail-unsubscribe-show`, `mail-replyset-submit`; `mail-replyset-next` a read; `mail-token-create`'s `role` | F1 to F3 |
| 12.3 | `PREVIEW_CHANGED`, `UNIT_NOT_OPEN`, and `SELECTION_SPANS_ACCOUNTS` if Q1 is answered (c) | F2 to F4 |
| 14 | Phase B's "a person's command is not listed or callable over MCP" becomes "only the four are listed, and none runs without a person's approval" | F2 |

## 16. Error codes

Added to the engine's 12.3. Each failure carries a suggestion in the engine's words and no content.

| Code | When | Retryable |
| --- | --- | --- |
| `PREVIEW_CHANGED` | An approved release names a revision or digest that no longer matches its target (section 7) | No: read the preview again and ask the person again |
| `UNIT_NOT_OPEN` | `mail-replyset-submit` names a unit that is not the reply's current one (section 9.2) | No: call `mail-replyset-next` again |
| `SELECTION_SPANS_ACCOUNTS` | Only if Q1 is answered (c): an agent's or a script's change, resume or undo whose set spans accounts | No: make one selection per account |

`APPROVAL_REQUIRED`, `VALIDATION_ERROR` and `COMMAND_NOT_FOUND` keep the crate's meanings;
`RECIPIENT_NOT_ALLOWED`, `POLICY_LIMIT` and `PROPOSAL_NOT_OPEN` keep the engine's.

## 17. Security

What changes against the engine's section 13 and phase 5's section 15. "Content" is text a stranger
wrote.

| # | An attacker tries | Through | What stops it | Test |
| --- | --- | --- | --- | --- |
| F1 | To send, unsubscribe or approve as an agent | Calling a released command over MCP | Held for every caller; a non-approver gets no token, and its `_meta` is ignored | F-T3, F-T4 |
| F2 | To become an approver | `mail-token-create` over MCP | Not listed; made only at the terminal, with a summary that names the power | F-T1 |
| F3 | To redeem another caller's token | A token from a log or another approver | Bound to the approver's actor, single use, 30 minutes; removed from the journal and from every non-approver's result | F-T3, F-T4 |
| F4 | To send what the person did not see | A change to the draft, the set, the target or the proposal after the preview | The revision or digest in the bound input; `PREVIEW_CHANGED`; Loam's hold and re-read besides | F-T7 |
| F5 | To add a stranger's address to a send | Content steering the copilot to edit a draft | The address is shown as `new` in the preview the person approves; at the terminal the person types it | F-T8, Q2 |
| F6 | To carry one sender's text into another's reply | A reply set | Each unit holds one reply's inputs; a submit needs the reply's current unit; the preview marks replies that differ | F-T9, F-T10 |
| F7 | To change the guarded account through content from the other | The copilot under taint from one account | With Q1's (c): per-account agent limits and no change across accounts; with (a): separate instances | F-T11 |
| F8 | To act as Loam from the person's account | Reading Loam's bearer file | **Not stopped**: the approver token carries a person's authority for the four commands. The same as `cli.token` today (the engine's 3.5) and phase 5's T15 | Documented |

## 18. Implementation plan

Each is one pull request, built in this session after review, that updates the engine's
specification (section 15) and its line in the status file. Each runs `cargo fmt --check`, clippy
with `-D warnings` and `cargo test --locked` in `loam-plugins.yml`, and `pnpm verify` before push.

| PR | Contents | Needs |
| --- | --- | --- |
| F1 | **Approver tokens.** The `role` column (migration); `mail-token-create`'s `role` and summary; `--out`; `mail-token-list`'s role; `mail-status`'s token counts; `with_approver`; the middleware that strips a held result's token for a non-approver over MCP and gives the engine's suggestion. Tests F-T1 to F-T4, on a held test command, since no person's command is listed yet | Step B5 only; can merge before D3 |
| F2 | **Sends, unsubscribes and approvals released.** `mail-draft-send`, `mail-unsubscribe` and `mail-operation-approve` listed over MCP; `mail-unsubscribe-show`; the draft's revision check and recipients' `basis`; the operation preview's digest and `mail-operation-approve`'s `digest`; `PREVIEW_CHANGED`; the command line filling a revision or digest; `new` recipients on an approver's send; M18 and the phase B exit test amended; the registry test of section 5.1 for three commands. Scenario files 1 to 4 with the `mail-f-base` seed, run in the workflow. Tests F-T5 to F-T8 | F1; **D3** (drafts, send, unsubscribe) |
| F3 | **Reply sets released, and units.** `mail-replyset-send` listed, with the set's revision; `mail-replyset-show` as the preview; `mail-replyset-next` as a read returning the unit; `mail-replyset-submit`; the per-reply submission record (migration); `UNIT_NOT_OPEN`; the registry test for four. Scenario file 5. Tests F-T9, F-T10 | F2; **E3** (reply sets) |
| F4 | **Taint per account,** as the owner answers Q1. For (c): per-account agent limits (migration), `mail-policy-set`'s `account`, `SELECTION_SPANS_ACCOUNTS`. Test F-T11. For (a): documentation of two instances, and step 9's amendment notes an install per account. For (b): this specification is amended first | F1; D1 (merged) |
| F5 | **The mount package.** `endpoints/loam/plugins/mail/mount/` with its manifest, and the plugin's README section with section 12's steps | Loam's phase 5 steps 4 and 5, for `labels`, `approvals`, `preview` and `expose.apps` in the entry |

**Order.** F1 now; F4 beside it once Q1 is answered; F2 after D3; F3 after E3; F5 when Loam's
step 5 merges. Loam's step 7 (P5-A9) mounts the engine after F3 and F5. **Trust review** for F1, F2
and F3, which change who can send.

**The native app** is not in this plan. Its amendment, with its jobs and views, follows Loam's
step 7.

## 19. Tests

| # | Test | Passes when |
| --- | --- | --- |
| F-T1 | Approver tokens are made only at the terminal | `mail-token-create` over MCP is `COMMAND_NOT_FOUND`; at the command line with no terminal, `PERSON_REQUIRED`; with one, it asks with the approver's summary; the store holds the hash and `role`; the token starts `lmail_approver_`; its result is not in the journal; `--out` writes a new `0600` file, refuses one that exists, and prints no token |
| F-T2 | The approver mapping | An approver token's call is an approver to the crate; an agent token's, the command line's route and stdio's are not; a revoked approver is refused with `401` from the next request; `mail-token-list` and `mail-status` give the role and the counts |
| F-T3 | A non-approver's held result | Over MCP, an agent's call to each released command gives `APPROVAL_REQUIRED`, `retryable: false`, a summary with no content, the engine's suggestion and no `approvalToken`, and no elicitation; over stdio the same; on the command line's route the token is present |
| F-T4 | An approver's release | An approver's held result carries the token; a retry with it in `_meta["dev.afd/approval"]` runs once; a second retry is refused; another approver token's retry with it is refused (`credentials-mismatch` or `actor-mismatch`); an agent's `_meta` is ignored; the key in tool arguments is `VALIDATION_ERROR`; `afd-batch` is `ONE_COMMAND_PER_CALL` |
| F-T5 | Exposure | The registry test: the person's commands exposed to `mcp` are exactly the released ones, each `ApprovalPolicy::Required`; the eight of section 5.1 stay `cli` only; `tools/list` over HTTP agrees; M29's test still passes |
| F-T6 | Previews | Each preview gives its target in labelled parts and nothing from mail outside them; two reads of an unchanged target are equal in canonical JSON; `mail-unsubscribe-show` contacts nothing (the scripted HTTP target records no request) |
| F-T7 | Revisions and digests | For each released command, an approved call naming a stale or future revision, or another digest, fails with `PREVIEW_CHANGED` and sends, contacts or changes nothing (no `outbound` row, no request to the scripted target, the proposal still waiting); the command line fills a missing one from the preview |
| F-T8 | The person's | An approver's approved send with a `new` recipient runs; the same draft at the terminal asks for the address; an approved `mail-operation-approve` from an approver runs past every limit and counts against no day; a person's bulk change from the approver token over a limit becomes a proposal |
| F-T9 | Units | `mail-replyset-next` is a read and not journaled; its result has the marker with `submit.command` `mail-replyset-submit`, `field` `text` and instructions within 4,096 characters; `mail-replyset-submit` is a non-destructive mutation with no approval; a unit id from before a change of answers is `UNIT_NOT_OPEN`; a text over 32,768 characters is refused; the input cannot set a recipient; each submission is recorded with its inputs; the set's revision rises |
| F-T10 | Units hold one reply's inputs | In a set of two senders, each unit's parts hold only its own sender's message and the answers to their questions, by search of the result for the other sender's text and address |
| F-T11 | Per account (Q1's (c)) | An agent's limits of 0 on one account make its change there a proposal while the other account keeps the default; an agent's selection over two accounts cannot be changed; the person's can |
| Scenarios | The five files | Each passes against `loam-mail serve` on `mail-f-base` in the workflow, from F2 (files 1 to 4) and F3 (file 5) |

Loam's side, the mount on the desktop with its confirmation, hold and units, is phase 5's P5-A6,
P5-A7 and P5-A9.

## 20. Points in phase 5's contract this document reads one way

Phase 5 is approved; these are places where its text could be read otherwise, said so that its
owner can confirm or amend them.

1. **The entry's form.** 7.4 sketches `[[instances]]` with `app = "mail"`; phase 1's deployment file
   writes `[apps.<instance>]` and requires `package`, `prefix` and `audience` for a mounted instance.
   Section 12 writes phase 1's form.
2. **The app's id.** Phase 1 keeps app ids and prefixes unique, so with the mount's prefix `mail` the
   native app cannot be `mail`; phase 5's own fixture pairs `mailfix` with `mailfixapp`. This
   document names the app `mailapp`.
3. **"Counts as the person's against its agent limits."** Evidence exists only on a held call, and
   of the four held commands only `mail-operation-approve` is under 9.4's limits, which it already
   escapes. A person's own bulk change through Loam is an agent's change until the person approves
   its proposal (section 8.1). The item holds in that sense only.
4. **One caller for everything Loam does.** Phase 5 does not say that the copilot, its apps and the
   person's gestures share the engine's per-caller limits and the five proposals (section 8.3).
5. **Credentials for an approver.** AFD's rule 4 advises naming over HTTP only callers with
   verified credentials. The engine verifies its own bearer and maps each token to its own actor,
   and sets no `Credentials` (section 4.2).
6. **The token for a non-approver.** The carrier's "no token is included" is for the carrier; the
   crate's middleware still includes a token for any MCP caller when `include_token` is true, its
   default. Every server that lists a held command over MCP for callers that are not approvers has
   to know this. An AFD follow-up could make a non-approver's MCP result carry no token by default.
7. **A preview's stability.** 7.2 compares two preview reads by digest but does not require a
   preview to be stable for an unchanged target. Section 6 requires it of the engine; any other
   server Loam releases commands for needs the same.
8. **Units and the scenario matcher.** `"dev.loam/unit"` holds a dot, which AFD's scenario matcher
   reads as a path, so no scenario can assert the marker; phase 5's own `reply-set-fresh-context`
   does not either.
9. **`mail-replyset-next`'s kind.** 6.1's default `act` covers reads; the engine's section 11 lists
   the command as Local. Section 9.1 makes it a read; otherwise every unit would ask.
10. **The `calls` key for a mounted callee.** 7.5 says a native app's `[[calls]]` "names an instance";
    section 9 writes `[[calls]] app = …`. Section 13 writes `instance`, for phase 5's step 4 to fix.
11. **Taint per account** is listed in 5.3 and section 17 as "a follow-up for mail's step F", but
    taint's source is Loam's to define: only option (b) changes it, and that would be Loam's
    amendment, not mail's.

## Questions for the owner

### Q1. Taint per account

Blocks F4. If the copilot reads a message in your personal account, can it then archive or trash in
your work account without asking? Today, yes, within mail's limits (500 archived or 50 trashed a
call), because Loam sees one mail engine.

- **(a) Run one mail engine per account.** Separate processes, stores and entries; Loam then asks
  before the copilot changes the other account after reading one.
  - Tradeoff: no single inbox across accounts in Loam, and a sender you know at work is a stranger
    in the personal account.
  - Cost: nothing in the engine; Loam's install and the mail app must handle two instances.
- **(b) Teach Loam to track accounts inside one engine.**
  - Tradeoff: Loam would rely on the engine's report of which accounts a call touches.
  - Cost: the most: a change to Loam's taint rule and the engine's results.
- **(c) Keep one engine, and let you guard an account (recommended).** You can set an account's
  agent limits to 0, so any agent change there becomes a proposal you approve in Loam, shown with
  its account; and an agent's change may never span two accounts.
  - Tradeoff: you must choose to guard an account; with the defaults the risk stays as it is today.
  - Cost: one engine pull request (F4).

**Recommendation:** (c). It is the smallest change, keeps one inbox and one knowledge of senders,
and turns the risk into your setting. (a) stays possible for anyone who wants a hard wall today.
**Confidence:** medium. If you want protection on by default, (c) can ship with every account but
the first guarded, at the cost of more proposals to approve.

### Q2. New recipients from Loam

Blocks F2's recipient rule. At the terminal, mail sends only to people in the thread, people you
have written to, or an address you type. In Loam you type into the mail app, which the engine cannot
tell from the copilot.

- **(a) Allow a new address on a send you approve in Loam, marked "new" in what you approve
  (recommended).**
  - Tradeoff: if a message steers the copilot to add an address, the only check is that you notice
    the "new" mark before approving.
  - Cost: in F2.
- **(b) New addresses only at the terminal.**
  - Tradeoff: you cannot write to someone new from Loam, so Loam is not your only mail client.
  - Cost: none.

**Recommendation:** (a). Every send is already a decision you make with the recipients in front of
you, and the mark makes a new one stand out. **Confidence:** medium-high.

### Q3. Sender decisions in the app

Not blocking step F. Phase 5 keeps your decisions on senders (screen in or out, accept a suggestion)
and the policy at the engine's terminal. So in Loam's mail app you can only suggest a decision and
then accept it at the terminal.

- **(a) Keep them at the terminal for step F, and revisit after Loam's milestone A (recommended).**
  - Tradeoff: screening needs a terminal for now.
  - Cost: none now; later, an amendment to phase 5's list and one engine pull request.
- **(b) Release `mail-sender-screen` and `mail-sender-accept` through Loam's approval now,** as the
  four are.
  - Tradeoff: a screening decision would ask for an approval each time in Loam, which is many
    approvals for a routine task; phase 5 deliberately left them out.
  - Cost: an amendment to phase 5 before its step 5, and part of F2.

**Recommendation:** (a). The send path should be proven first, and screening's volume needs a batch
surface Loam has not decided (its L4). **Confidence:** medium.
