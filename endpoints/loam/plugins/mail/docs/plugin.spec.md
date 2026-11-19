# Mail: the plugin's specification (step F)

Step F of the [Mail proposal](../../../../../docs/features/active/mail/mail.proposal.md#9-steps):
the engine mounted on Loam's desktop, and the native app. It follows the
[engine's specification](engine.spec.md), whose numbering of decisions it continues, and
[Loam's phase 5 specification](../../../docs/phases/5-copilot/spec.md), whose
[7.2](../../../docs/phases/5-copilot/spec.md#72-a-mounted-command-only-a-person-may-run-l7-a1-d146)
names what the engine must give. Read the [status](../../../../../docs/features/active/mail/STATUS.md)
first.

## Status

- **State:** draft, revised after its first review, for review again. Nothing in it is approved
  or built.
- **Written:** 2026-11-19, against `main` at `d890d02d`. **Revised** the same day after two
  independent reviews (both "revise"; [Review 2026-11-19](#review-2026-11-19)), with `main` merged
  in at `5a631f89`.
- **Covers:** the engine's changes that phase 5 relies on (sections 4 to 11), in full; how the
  person mounts the engine by hand until Loam's step 9 (section 12); the native app's shape, its
  manifest, what it calls, and the minimal send surface phase 5's acceptance run needs (section
  13); what is left for Loam's step 9 (section 14).
- **Does not cover:** the native app's views beyond that send surface, which get their own
  amendment once phase 5's step 7 runs; composition with Umbel (phase G).
- **Read for this document:** `AGENTS.md`; the `afd` skill and its `jobs-first.md`; Loam's
  phase 5 specification (3.2, 5.1 to 5.3, 6.1, 7.1 to 7.5, 8, 14, 15, 18, 19, Q1 and Q2, and the
  scenarios `approve-mail-send`, `person-sends-mail`, `reply-set-fresh-context` and
  `mail-cannot-act-elsewhere`); phase 1's 7.4 and its deployment file's instance keys; phase 6's
  10.4 (`deployment write --host desktop`); the engine's specification (3.1 to 3.5, 7.3, 9.4,
  9.5, 10, 11, 12, 13, 15); the Mail proposal's 4.4, 4.8 and 6; the mail status file;
  `spec/command-metadata.md` (Approvals, "Approval evidence from an approver client", "Approval
  display") and `spec/authorization.md`'s M8; Loam's decision log (D109, D132, D135, D146 to D148;
  no later decision names mail). In code: the `afd` crate's `McpServer::with_approver`,
  `server/approver.rs`, the approval middleware's `include_token` rule, `credentials.rs` and its
  bootstrap commands; the engine's `lib.rs` (its registry and approval middleware), `rules.rs`,
  `serve.rs`, `tokens.rs`, `home.rs`, `screening.rs`, `changes.rs`, `operations.rs` and
  `tests/proposals.rs`; Loam's `kernel/src/apps/mounted.ts` (discovery) and
  `web/src/mount-desktop.ts` (the desktop's MCP protocol version); AFD's scenario runner
  (`packages/testing/src/runner/scenario-runner.ts`, `evaluator.ts`).
- **Not verified:** everything about drafts, sending, unsubscribing and reply sets as built. Step
  D3's first part (drafts, migration 15, `DRAFT_CHANGED` for an update from a stale revision) is
  in review on another branch, and E3 is not started. Where this document names a field of
  theirs, it states what step F needs, and the step F pull request that touches it aligns with
  what merged.
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
| Claim | The secret a unit's submit carries, which proves the submit answers that unit (section 9) |

## 1. Decisions of this specification

They continue the engine's M15 to M29. All are proposed, for review.

| | Decision | Why |
| --- | --- | --- |
| M30 | A token has a role, `agent` or `approver`, chosen by the person when it is made at the terminal. An approver token is an agent's token that the engine also names to the crate as an approver | Phase 5's 7.2 asks for "an approver token, made only at its terminal". A role on the existing tokens reuses their storage, listing and revocation |
| M31 | Four person's commands are listed over MCP and held by their approval policies for every caller: `mail-draft-send`, `mail-replyset-send`, `mail-unsubscribe`, `mail-operation-approve`. The others stay at the terminal. This amends M18 | Phase 5's 7.2, item 2. Only evidence from the terminal or from an approver releases them |
| M32 | Each released command has a preview read that shows its whole target, never a page or a window, and whose result changes only when its target changes. A target too large to show whole is refused when it is built | Loam shows the preview and re-reads it while the instance is held; AFD's display rules say truncating is not showing |
| M33 | A draft and a reply set carry a revision; an unsubscribe target and a proposal carry a digest. Each released command names it in its input. It is checked before the call is held, so a token is only ever bound to a current value, and again before anything is sent; a mismatch is `PREVIEW_CHANGED` | Phase 5's 7.2, item 4, and the first review's B1 |
| M34 | A held command runs only on evidence from the terminal or from an approver, which the engine treats as the person's | Phase 5's 7.2, item 5. The engine cannot tell a person's approval from an approver that did not ask one (section 17, F8) |
| M35 | `mail-replyset-next` becomes a read that returns one unit with a single-use claim; a new `mail-replyset-submit` stores text only against a current claim and records what it was written from, without claiming how it was composed | Phase 5's 7.3, and the proposal's 4.8 |
| M36 | Taint per account: **pending [Q1](#q1-taint-per-account)**. Section 10 weighs four options and recommends one | The residual risk of phase 5's 5.3 |
| M37 | Over MCP, a held result to a caller that is not an approver carries no approval token, and its suggestion says where the person runs it | The crate's default includes the token for every MCP caller (section 5.2) |
| M38 | The mounted instance is `mail`, with the command prefix `mail`; the native app's id is `mailapp`. The engine registers AFD's bootstrap commands, so Loam can discover it | Phase 1 keeps app ids and prefixes unique; Loam's discovery starts with `afd-help` |

## 2. What phase 5 asks, and what exists

Phase 5's 7.2 ends with a list headed "What the mail engine needs". This document answers each
item, and 7.3's unit:

| Phase 5 asks | Answered in |
| --- | --- |
| An approver token, made only at its terminal | [Section 4](#4-the-approver-token) |
| Exactly four person-only commands listed over MCP, held for every caller; the others not listed | [Section 5](#5-the-four-released-commands) |
| A preview read for each released command, its target in labelled parts | [Section 6](#6-previews) |
| Each released command's input names a revision or the preview's digest, checked by the engine | [Section 7](#7-revisions-and-digests) |
| A call carrying an approver's evidence counts as the person's against the agent limits; "a person's own bulk change through Loam is therefore not counted as an agent's" | [Section 8](#8-a-held-command-acts-as-the-persons). **Partly met:** held calls only. A person's own change through Loam that is not held is charged to Loam's one agent ([Q4](#q4-a-persons-own-changes-through-loam)) |
| A reply set that returns units (7.3; step 7 waits for it) | [Section 9](#9-units-from-a-reply-set) |
| Per-account taint sources, left to mail's step F (5.3, section 17) | [Section 10](#10-taint-per-account), [Q1](#q1-taint-per-account) |
| The engine mounted by hand (7.4), and P5-A9's runs against the real engine | Sections [12](#12-mounting-by-hand-until-loams-step-9) and [13](#13-the-native-app) |

**What exists in AFD.** Phase 5's step 0c is merged ([#1475](https://github.com/lushly-dev/afd/pull/1475)).
In the `afd` crate the engine builds on (0.2.1, by path):

- `McpServer::with_approver(|context| bool)` exists. For a caller it names, a held result carries
  `details.approvalToken` and never becomes a form elicitation, and a `tools/call` whose
  `_meta["dev.afd/approval"]` holds a token has it set as the call's evidence (`AFD_APPROVAL_META_KEY`).
  The key in tool arguments is refused with `VALIDATION_ERROR` from every caller. **The key is
  accepted only on a call to one command from an MCP 2026-07-28 client:** a batch, a pipe or a
  2025-era request carrying it fails with `APPROVAL_REQUIRED` before anything runs
  (`server/approver.rs`).
- A token issued on an approver's call binds the call's principal binding (`spec/authorization.md`,
  M8): the actor, and the credentials when there are any.
- Whether an approver's evidence was used is not visible to a handler: the call's approver state
  is the crate's own (`pub(crate)`). The engine does not need it (section 8).
- The approval middleware's `include_token` defaults to `true`, which gives every held MCP result
  its token unless a relay is set. The engine sets no relay. Section 5.2 handles it, and an AFD
  issue is filed by F1 (section 20, item 6).
- The bootstrap commands `afd-help`, `afd-docs` and `afd-schema` exist
  (`register_bootstrap_commands`), but **the engine does not register them today** (`lib.rs`), and
  its registry rules require every command's name to start with `mail-` (`rules.rs`).

**What exists in Loam.**

- **Discovery** calls `afd-help { format: "full" }` first and fails with `MOUNT_NOT_AFD` when it
  gives no command list (`kernel/src/apps/mounted.ts`). The engine must answer it (section 12.1).
- **The desktop's mount transport speaks MCP `2025-06-18`** (`web/src/mount-desktop.ts`,
  `DESKTOP_PROTOCOL_VERSION`). On that protocol the crate refuses approval evidence, so **no
  approval can be redeemed through Loam's desktop until its transport speaks MCP 2026-07-28.**
  That is a dependency of phase 5's step 5 that its specification does not name (section 20,
  item 12), and of step F's acceptance (F-T12).

So the engine waits on nothing in AFD. It waits on its own steps D3 (drafts, send and unsubscribe)
and E3 (reply sets), and on Loam's phase 5 steps 4 and 5 and its desktop transport (section 12).

## 3. Jobs and scenarios

The jobs are written as scenario files, one per job, in [`scenarios/`](scenarios/), as
`jobs-first.md` asks. Phase 5 already holds the jobs as Loam serves them, against its `mailfix`
fixture (`approve-mail-send`, `person-sends-mail`, `reply-set-fresh-context`,
`mail-cannot-act-elsewhere`); these are the engine's side of the same jobs, run against
`loam-mail serve` itself. Ranked by what they protect, sends first; the owner ranks them in
[Q5](#q5-the-jobs-and-their-order).

| # | Job | When … I want … so that … | File |
| --- | --- | --- | --- |
| 1 | An agent cannot send | When an agent connected over MCP asks the mail engine to send, I want the send held for me whatever the agent does, so that nothing leaves my account unless I decided it | [`agent-cannot-send`](scenarios/agent-cannot-send.scenario.yaml) |
| 2 | Only what I saw is sent | When I approve sending a draft, I want exactly the version I saw to go, with the account and recipients I saw, so that a change made after I looked can never go out under my approval | [`send-what-i-saw`](scenarios/send-what-i-saw.scenario.yaml) |
| 3 | Approve exactly what an agent proposed | When an agent proposes a change larger than it may make alone, I want to approve it from a preview that says what it touches, and have exactly that run, so that a change steered by a message or altered after I looked cannot run under my approval | [`approve-what-was-proposed`](scenarios/approve-what-was-proposed.scenario.yaml) |
| 4 | See what an unsubscribe will contact | When I'm asked to unsubscribe from a list, I want to see exactly what the engine will contact and how, so that an unsubscribe never reaches a place I did not see | [`unsubscribe-target-shown`](scenarios/unsubscribe-target-shown.scenario.yaml) |
| 5 | Hand out each reply with only its own inputs | When an agent writes the replies of a reply set, I want each handed out with only its own sender's message and my answers to it, and recorded with what it was written from, so that I can check every reply against exactly its inputs before I send the set | [`compose-replies-apart`](scenarios/compose-replies-apart.scenario.yaml) |

**How they run.** Each is tagged `mail-engine`: it runs with `afd scenario run <dir> --server <url>`
against `loam-mail serve` on the scripted IMAP server, seeded as `mail-f-base`, with an ordinary
agent's token. The seed and the run in the engine's workflow are built by the step F pull requests
(section 18). Until then they are checked, not run.

**Checked on 2026-11-19, after the revision,** with AFD's parser (`afd scenario validate`), the
dry-run validation and the coverage report: all five parse and validate, 29 steps. Against the
commands this document adds or changes (`mail-token-create`, `mail-token-list`, `mail-status`,
the four released commands and their previews, `mail-replyset-next`, `mail-replyset-submit`) and
the codes it adds:

- **Commands no job uses:** `mail-token-list`, a terminal read a scenario over MCP cannot reach,
  and `mail-status`, whose only change is two counts of tokens (F-T2).
- **Codes no job shows:** `PREVIEW_TOO_LARGE`, which needs a target larger than a seed should hold
  (F-T6), and `SELECTION_SPANS_ACCOUNTS`, which exists only if Q1 is answered (c). A stale revision
  or digest is shown before the hold (section 7), so `PREVIEW_CHANGED` is shown by jobs 2 to 4.
- **Commands the files call that this document does not draft** are earlier steps':
  `mail-draft-create`, `mail-draft-update`, `mail-policy-set`, `mail-selection-create` and
  `mail-trash`.

**What writing them changed.** `mail-replyset-next` became a read, since phase 5's `mailfix`
scenario expects it to act without asking (section 9.1); `mail-unsubscribe` and
`mail-operation-approve` gained a required `digest`, which job 3 and 4's refusals of a call
without one exposed; each recipient in the draft's preview gained its `basis`, which job 2 needed
to say why a recipient is allowed; the unit's id is repeated outside Loam's marker, which the
matcher cannot reach; and, after the review, the revision check moved before the hold, which job 2
now shows.

**What the scenarios cannot show,** and where it is shown instead:

- an approver's evidence releasing a command, since every step runs as one caller and the runner
  cannot set `_meta` (tests F-T4 and F-T7, and Loam's P5-A9);
- that a held result carries no token, since a scenario cannot assert an error's `details` (F-T3);
- the `"dev.loam/unit"` marker and its claim, since the matcher reads a key holding a dot as a
  path; the files assert the unit's id where the result repeats it (F-T9);
- making a token at the terminal, which is a person's command with no MCP surface (F-T1);
- an expectation that names an earlier step's value, since the runner resolves step references in
  inputs only; such checks are in the tests.

**Walked.** Two independent reviewers read the files with this document on 2026-11-19; what they
found is in [Review 2026-11-19](#review-2026-11-19). The three seats of `jobs-first.md` were not
run as separate walks.

## 4. The approver token

### 4.1 Made at the terminal

- **`mail-token-create` gains `role`:** `{ name, role? }`, `role` one of `"agent"` (the default)
  and `"approver"`. It stays a person's command, exposed to `cli` alone and held for approval, as
  step B5 built it.
- **The summary says what the token can do, and what it cannot stop,** in the engine's words:
  "Make an approver token named "<name>". Whoever holds it can send mail, unsubscribe and approve
  agents' proposals from this computer, with no limit, while `loam-mail serve` runs and until you
  revoke it. The engine cannot check that you were asked: give it only to Loam, which asks you
  before each one." An agent's token keeps its summary.
- **Its form.** An approver token is `lmail_approver_` and 64 hex digits from the operating
  system's random source; its id is `tok_` and 16 hex digits, as an agent's. The prefix says
  what a token found in a file is.
- **Stored as tokens are:** the `token` table gains `role` (`agent` or `approver`, not null, every
  existing row `agent`), in a migration that takes the next number free when its pull request
  merges (D3's first part takes 15). The store keeps the hash alone. The token is shown once and
  its result is removed from the journal, as now.
- **Written to a file.** The command line gains `--out <file>` for `mail-token-create`: it creates
  a new file, refusing one that exists, private to the person before any byte of the token is
  written, and prints the path instead of the token. On Unix the file is created with mode `0600`.
  **On Windows `--out` is refused** until the engine creates the file with an access list that
  names only the person; the engine's private files are private only on Unix today (`home.rs`).
  The path is the command line's flag, never command input, so the journal never holds it.
- **A role is not changed.** To move from one role to the other, make a new token and revoke the
  old one. Several approver tokens may exist, one per Loam installation, for example.

### 4.2 How the engine marks an approver

- The layer of [3.4](engine.spec.md#34-the-http-surface) is unchanged: it finds the caller from the
  bearer's hash. The engine's in-memory map of hashes gains each token's role, read when the
  server starts and again after a token is made or revoked, as now.
- The context hook is unchanged: it sets the actor `{ kind: agent, id: <the token's id> }`.
- The engine registers `McpServer::with_approver(is_approver)`, where `is_approver(context)` is
  true exactly when the call came over HTTP and its actor's id is a token whose role is `approver`.
  The same function decides section 5.2's stripping, so the two never disagree. Over stdio there
  is no approver: `loam-mail mcp`'s one caller is never one.
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
  already issued to it cannot be redeemed, since the layer refuses the retry before the crate
  sees it.
- **Revoke when it may have leaked.** An approver token lasts until revoked, unlike `cli.token`,
  which is made afresh at each start. It sits in two places on the person's disk: the file
  `--out` wrote, and Loam's `mounts.json`, which `deployment write` copies the bearer into
  (phase 5's T15). If either may have been read by another program, the person revokes the token
  and makes a new one.

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

**The registry rule** of `rules.rs` changes from "a command with an approval policy is exposed to
`cli` only" to: **a command with any approval policy (`Required` or `Conditional`) that is exposed
to `mcp`, `agent` or `palette` is one of the four, is exposed to `mcp` alone of those three, and
has `ApprovalPolicy::Required`**, which no input can turn off. It is checked when the registry is
built, as now.

### 5.2 What a caller that is not an approver gets

- **`APPROVAL_REQUIRED`,** `retryable: false`, with `details.summary` and `details.expiresAt`.
- **No `details.approvalToken`.** The crate includes it because `include_token` defaults to
  `true` and the engine sets no relay. A token on a non-approver's call is bound to that caller's
  actor and could not be presented over MCP, where only an approver's `_meta` is read, so it is
  useless to the agent. It is removed all the same, so that no token for a send ever reaches an
  agent or its transcript. The engine wraps its approval middleware with its own, which, for a call
  on the `mcp` interface for which `is_approver` (section 4.2) is false, removes
  `details.approvalToken` and replaces the suggestion. The command line's route keeps the token,
  which it needs for its retry.
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
   `details.approvalToken` in `_meta["dev.afd/approval"]`, from an MCP 2026-07-28 client. The crate
   verifies it against the input, the approver's actor, the expiry (the engine's 30 minutes) and
   single use.

Nothing else sets evidence: tool arguments cannot, a non-approver's `_meta` is ignored, a 2025-era
request or a batch carrying the key is refused, and the engine's own code never sets
`context.approval`. **The engine cannot check that an approver asked anyone** (AFD's approver
rule 6): it trusts Loam to have shown the person the preview. Section 17's F8 says what that costs.

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
exists (AFD's approver carrier and Loam's 7.2), once Loam's desktop transport speaks MCP
2026-07-28. The engine's 3.5, 11 and the phase B exit test "a person's command is not listed or
callable over MCP" are amended to match (section 15).

## 6. Previews

Each preview is a read, exposed to `cli` and `mcp`, whose input keys are the keys Loam's entry
names (`preview = { command, input = [...] }`, phase 5's 7.2). Each returns its target with
everything a person needs to decide, every value from mail in a part labelled `"trust": "content"`.

**Whole, never paged.** Loam calls a preview with the listed keys alone, so the first answer is
all the person sees. A preview is therefore never paged or windowed: it returns its whole target
or fails with **`PREVIEW_TOO_LARGE`**, and Loam then has no preview and releases nothing
(phase 5's `MOUNT_APPROVAL_UNAVAILABLE`). So that a preview never fails in practice, a target is
capped when it is built, well within a read's largest output budget (1.75 MiB, the engine's 3.2)
and a reply's 4 MiB, which counts the text and structured copies both:

- a draft's subject and body together at most 256 KiB of UTF-8, refused at `mail-draft-create` and
  `mail-draft-update` with `PREVIEW_TOO_LARGE` (a cap D3 should apply; if it has not, F2 adds it);
- a reply set at most 50 replies, and its shared text and every reply's text together at most
  768 KiB of UTF-8, refused when a reply is added or a text submitted or edited past it;
- an unsubscribe target and a proposal's preview are small by construction: the proposal's preview
  is counts and names, not its items.

A preview that would still exceed the budget (for example after a parser change) fails rather than
truncates. F-T6 shows the largest allowed draft and set through a preview over HTTP within both
limits.

**Stable for an unchanged target.** Loam calls the preview again under its hold and compares the
two results' canonical digests. So a preview's result holds no time of reading, no cursor that
moves on its own and no count of anything outside its target. Two reads of an unchanged target are
equal in canonical JSON (test F-T6). For a proposal, the counts by screening class and by known
senders are derived and can change while sync runs; they are shown, but Loam's re-read can then
mark the confirmation "Changed since you looked", which is true, and the digest the approval checks
does not cover them (section 7).

| Preview | Input keys (`preview.input`) | Returns |
| --- | --- | --- |
| `mail-draft-show` | `["draft"]` | `draft`: `id`, `revision`, `state`; `account`: the sending account's `id` and provider, and its address in a labelled part; `recipients`, each with its `role` (`to`, `cc`, `bcc`), its `basis` (section 8.2) and its address and display name in a labelled part; the thread or message it answers, by id; `content`, labelled: subject and body; who wrote each part (the engine's 9.5) |
| `mail-replyset-show` | `["replyset"]` | `replyset`: `id`, `revision`, `state`, the account, the shared text in a labelled part, and every reply, each with its id, `recipient` (labelled; stored when the set was made, section 9.4), `text` (labelled), `differs` (whether its text differs from the shared text), `source` (`submitted` or `edited`), and its `inputs` (section 9.4) |
| `mail-unsubscribe-show` (new) | `["message"]` | `unsubscribe`: `message`, `account`, `method` (`one-click` for an HTTPS post the message declares with `List-Unsubscribe-Post`, or `mail`), the target URL or address in a labelled part, the list's id in a labelled part, and `digest` |
| `mail-operation-show` | `["operation"]` | As step D1's third part built it, its `preview` gaining `proposal` (the proposal's generation, section 7) and `digest` |

- **`mail-unsubscribe-show`** takes `{ message }`. A message with no usable `List-Unsubscribe`
  header fails with the code D3 gives `mail-unsubscribe` for it. It contacts nothing: it reads the
  message's held headers.
- **`mail-operation-show`'s items.** Called with `{ operation }` alone it returns its first page of
  items as now. The items are not what the person approves from; the preview's counts are, and they
  cover the whole frozen set.
- **Display.** Loam measures each held call's input by AFD's display rules before it shows a
  confirmation. Every released command's input is ids, an integer and a 43-character digest, so
  it always passes.

## 7. Revisions and digests

| Command | Input | Names | Checked against |
| --- | --- | --- | --- |
| `mail-draft-send` | `{ draft, revision }` | The draft's revision | The draft's current `revision` |
| `mail-replyset-send` | `{ replyset, revision }` | The set's revision | The set's current `revision` |
| `mail-unsubscribe` | `{ message, digest }` | The digest of the target shown | The digest of `{ message, account, method, target }` as `mail-unsubscribe-show` derives it now |
| `mail-operation-approve` | `{ operation, digest }` | The digest of the proposal | The digest of `{ operation, proposal, proposer, command, arguments, query, items }` now, where `items` is the digest of the frozen set's places in order |

- **Drafts,** as step D3 is building them: a draft carries an integer `revision`, from 1, raised by
  every `mail-draft-update`, returned by `mail-draft-show`, and `mail-draft-send` takes
  `{ draft, revision }`. D3's `DRAFT_CHANGED` refuses an update from a stale revision; a send from
  one is `PREVIEW_CHANGED`. A draft's revision is also raised when anything the preview shows changes
  without an update: a recipient's `basis` (section 8.2) is fixed when the recipient is added and
  stored with the draft, so it does not change by itself.
- **Reply sets** carry the same: an integer `revision`, raised by every change to the set (its
  questions, the person's answers, a reply's text by `mail-replyset-submit` or an edit, a reply
  added or removed), returned by `mail-replyset-show`. Recipients are stored when the set is made,
  so re-deriving a message changes no reply's recipient.
- **A proposal's generation.** A proposal is an operation in the state `proposed`, and a proposed
  resume keeps its operation's id: dismissed and proposed again, by the same caller or another, it
  is the same id with the same aggregates (`tests/proposals.rs`). So the operation gains
  `proposal`, an integer raised each time it enters `proposed`, kept with the proposer and the
  time. The digest covers it, so an approval read for one proposal never releases the next. The
  digest covers the proposal's own frozen target, not the derived counts by class, which change as
  sync runs.
- **Why a digest for the last two.** An unsubscribe target is derived from a message's headers,
  which can be derived again by a newer parser without any command on the message; a proposal is
  identified by its operation, its generation and its frozen set, none of which is a single
  counter. So the engine digests what was shown.
- **When it is checked: twice.**
  1. **Before the call is held.** A middleware that runs before the approval middleware reads the
     target and refuses a call whose revision or digest is not current with `PREVIEW_CHANGED`, so
     no approval token is ever issued for a value that is not current. Without this, a caller could
     name a revision one ahead of the draft's, have Loam show the current one, and then have a
     second writer outside Loam's hold raise the draft to the named revision before the retry.
  2. **In the handler,** after the approval is accepted and before anything is sent, contacted or
     changed, inside the same store transaction as the change of state (the draft or set marked
     sending, the operation moved from `proposed` to running), so nothing can change between the
     check and the act.
- **The order for `mail-operation-approve`,** at both points: the proposal is open
  (`PROPOSAL_NOT_OPEN`: dismissed, expired, approved, or no such id, as now); screening is ready
  (`SCREENING_NOT_READY`, retryable, as now); then the digest (`PREVIEW_CHANGED`). A proposal
  dismissed and proposed again is open, under a new generation, so its old digest fails with
  `PREVIEW_CHANGED`.
- **The code.** **`PREVIEW_CHANGED`**, added to the engine's 12.3, `retryable: false`: "The draft
  changed since its preview was read. Nothing was sent. Read it again with `mail-draft-show` and
  ask the person again." The suggestion names the command's preview. One code for the four keeps
  one rule for Loam and for agents.
- **At the terminal.** `revision` and `digest` are required inputs. When the person leaves one
  out, the command line reads the preview first, fills it in from what it will show, and then runs
  the command, so that the token is bound to the input that includes it.
- **Outside Loam too.** Any call naming a stale revision or digest fails, whoever carried the
  approval, so a change made by another caller between the preview and the send fails the send at
  the terminal as well as in Loam.

## 8. A held command acts as the person's

### 8.1 The rule

A released command's handler runs only after the approval middleware has accepted evidence from the
terminal or from an approver. The engine treats such a call as the person's, whoever carried it. It
does not need to see which; it knows the handler is held. For the policy of
[9.4](engine.spec.md#94-the-policy):

- **`mail-operation-approve`** already runs the operation as the person's: no limit applies, and
  it counts against no caller's day, approved at the terminal or through Loam.
- **`mail-draft-send`, `mail-replyset-send` and `mail-unsubscribe`** are not under the policy's
  limits; nothing changes for them.
- **A person's own change through Loam that is not held** (archiving, labelling, marking, trashing
  from the app) is a change from Loam's approver token, which is an agent's for every call that is
  not held. **It is counted as an agent's:** within the limits it runs and is charged to Loam's
  agent, its trash to Loam's day; over a limit it becomes a proposal, whose approval in Loam then
  runs it as the person's. So phase 5's sentence "a person's own bulk change through Loam is
  therefore not counted as an agent's" is met for the change over a limit, once approved, and not
  for one within the limits. Whether that is acceptable is [Q4](#q4-a-persons-own-changes-through-loam).

### 8.2 Recipients

The engine's 9.5 allows a recipient that is a participant of the thread being answered, an address
the person has written to, or one the person typed at the terminal for this send. Through Loam the
person types into the mail app, which reaches the engine with the approver token like everything
else, so the engine cannot tell the person's typing from the copilot's.

- **Each recipient in `mail-draft-show` carries `basis`:** `thread`, `written-to` or `new`, fixed
  when the recipient is added to the draft.
- **`thread` is not a guarantee.** A thread's participants are whoever wrote into it, including an
  address a stranger put in a header of a message in that thread. A steered copilot can therefore
  add a stranger's address that is marked `thread`, not `new`. The preview labels every address as
  content, and Loam shows it.
- **Whether a send released by an approver's evidence may include `new` recipients** is
  [Q2](#q2-new-recipients-from-loam). Until it is answered, F2 refuses them with
  `RECIPIENT_NOT_ALLOWED`, as the terminal rule does for an address not typed there.
- At the terminal the rule is unchanged: the command line asks the person to type a new address.
- A send from any caller still never takes a recipient from a message's text: `Reply-To` is
  flagged as now, and a reply set's recipients are set by the engine.

### 8.3 One caller for everything Loam does

Loam has one bearer per instance. Its copilot, its apps and the person's own gestures in Loam
therefore reach the engine as one agent, the approver token's actor. That means:

- the per-call limits apply to each call alike;
- the day's trash is shared by all of them, so a steered copilot can use it up, and the person's
  own small trash from the app then becomes a proposal;
- the five proposals waiting are shared, so five proposals from the copilot make a sixth from the
  person's own bulk change fail with `POLICY_LIMIT`, until the person approves or dismisses one;
- a proposal is listed as "proposed by the agent with the token "Loam"", whichever of them made it;
- **a draft's "who wrote each part"** (the engine's 9.5) records the token for every part written
  through Loam, so the engine cannot tell the person's words from the copilot's. Loam's journal
  records which of them called.

These are the costs [Q4](#q4-a-persons-own-changes-through-loam) weighs.

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
    "claim": "<43 characters>",
    "dev.loam/unit": {
      "id": "rsu_3_1_2",
      "submit": {
        "command": "mail-replyset-submit",
        "input": { "replyset": 3, "reply": 1, "unit": "rsu_3_1_2", "claim": "<43 characters>" },
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

  `unit` and `claim` repeat the id and the claim outside the marker, for callers that do not read
  Loam's key (AFD's scenario references cannot reach a key holding a dot). Phase 5's 7.3 gives the
  parent none of the result: it gets `{ unit: <id>, state }`, never the claim.
- **The unit's id** is `rsu_<set>_<reply>_<generation>`. The reply's generation is an integer
  raised whenever the reply's inputs change (its answers, its source text as derived) and whenever
  its text is set, by a submit or an edit. So a unit is current only until the reply is answered or
  its inputs change.
- **The claim** is the HMAC-SHA256, unpadded base64url, of the unit's id and the digest of the
  source text handed out, under a key the engine keeps in its store (made once, from the operating
  system's random source, never in a result but this one). It is derived, so `next` stores nothing;
  it cannot be guessed from the id; it survives a restart.
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
- **Input** `{ replyset, reply, unit, claim, text }`, `text` 1 to 32,768 characters, the composer's
  limit. No recipient, subject or account: the engine sets them.
- **Checked,** in one store transaction: the set exists and is not sent (E3's code for a sent set);
  `unit` is the reply's current unit and `claim` is its claim, or the submit fails with
  **`UNIT_NOT_OPEN`**, whose suggestion is "Call `mail-replyset-next` again: the reply was answered,
  edited, or its inputs changed since this unit was handed out"; the set's size cap (section 6).
- **Effect:** the reply's text becomes `text`, its `source` becomes `submitted`, its generation is
  raised (so the claim is spent: a second submit with it fails), and the set's revision is raised,
  so an approval read before it no longer sends. A composer's late result after the person edited
  the reply fails, since the edit raised the generation.
- **Result:** `{ reply: { reply, source, unit }, revision }`. Never the text.
- **What it does not claim.** The engine records that the text was submitted against a unit, with
  the claim; it cannot know whether a fresh context composed it. Any caller that called
  `mail-replyset-next` holds the claim. So `source: submitted` means "submitted against unit
  `<id>`", not "composed apart". Whether the copilot's parent can submit directly is Loam's to
  stop (section 20, item 13): the parent never sees a claim, so it cannot submit against a unit
  unless it calls `mail-replyset-next` through a path whose result Loam does not hide.
- An edit of a reply's text by any other command (E3's) sets `source: edited`, raises the
  generation and the set's revision, and takes a revision of the set, so it cannot overwrite a
  change it did not see.

### 9.3 Who may call them

Any caller over MCP or at the terminal. Isolation is real only when the caller composes each unit
in a fresh context, which Loam's copilot does and an arbitrary agent may not (the proposal's 4.8).
The engine cannot prove it; it records who submitted, and the set's preview marks every reply whose
text differs from the shared text, so the person reviews the differences before the one approval.

### 9.4 What the engine records per reply

For audit, as the proposal's 4.8 asks:

- **When the set is made:** each reply's recipient, as the engine derived it from the source
  message then, kept with the reply.
- **Every submission,** kept with the reply until the set is removed: the unit id; the inputs it
  was handed (the source message's id and the digest of the source text handed out, each answer's
  id and revision, the instructions' version); the submitter (the actor's kind and token id); when;
  and the digest of the text.
- **Every edit:** the editor, when, and the digest of the text.

`mail-replyset-show` gives the latest per reply as `unit`, `source` and `inputs`, and the number of
earlier submissions and edits. The submit's input, with its text and claim, is journaled as every
mutation's is ([13.1](engine.spec.md#131-the-journal)); the claim is spent by then, and the
journal's redaction removes it all the same.

## 10. Taint per account

Phase 5's 5.3 records a residual risk: taint's source is the instance, so with one engine holding
work and personal accounts, a message in the personal account that the copilot read can steer
archiving or trashing in the work account, within mail's policy, without a confirmation. Four ways
to answer it:

| | Option | Engine's cost | Loam's cost | What it gives up |
| --- | --- | --- | --- | --- |
| (a) | **One engine per account:** each runs with its own `LOAM_MAIL_HOME`, port, tokens and instance entry | None in code. Two processes, two stores, two indexes, two syncs; step 9's install must install a plugin's engine twice | None for taint: two instances are two sources. Each needs its own prefix (phase 1's 7.4), so the second's commands are renamed (`mailwork-draft-send`), and the native app needs a grant and a client per instance. Under taint, phase 5 lowers **reads** of another instance to `ask` too, so reading the work account after reading a personal message asks | One unified inbox (the app merges two), the engine's identity of a message across accounts (its 4.2), and one knowledge of senders: a sender known at work is a stranger at home, and the other way |
| (b) | **A source per account in Loam:** the engine puts the account on every labelled part, and Loam's kernel records `<instance>/<account>` as the source and lowers a call that touches another account | Every content part carries its account; every mutation reports which accounts its input touches, before it runs | A change to 5.3 and its tests: the kernel must learn, from the server, which accounts a call's input (a selection's id, message ids) touches. That is a server's claim about its own input, which 5.1 lets a `per-part` server make, but it puts the boundary on the server's word | Nothing on the engine's side; Loam's taint rule grows a mail-shaped exception |
| (c) | **Keep one source, and limit in the engine:** per-account agent limits, and no agent's or script's change across accounts | A migration: the policy gains an optional row per account (each number of 9.4, falling back to the default row); `mail-policy-set` takes `account`. A change, a resume or an undo by an agent or a script whose set spans accounts fails with `SELECTION_SPANS_ACCOUNTS` before anything is asked of the provider, **whether or not any account is guarded**, so an agent that works across accounts makes one selection per account | None | Protection is opt-in: with the default limits the risk is as 5.3 states. Limits of 0 cover archive, label, mark and trash; an agent can still cancel a running operation, which stops a change rather than making one, and edit a local draft, which a person's send must still approve |
| (d) | **One engine, a token per account, two instances in Loam:** a token gains an optional set of accounts; every command a token runs sees and changes only those accounts. Loam mounts the one engine twice, one entry per account, each with its own token | The largest: every read and change filtered by the token's accounts (lists, search, threads, senders, stories, proposals, operations, status), with tests that nothing of another account leaks; senders and stories, which span accounts, must be split or hidden per token | As (a): two instances, two prefixes, reads of the other instance lowered under taint | Less than (a): one store, one sync, one identity of a message. A sender's knowledge is still one store's, but each instance sees only its accounts' side of it |

**Recommended: (c),** with (a) open to anyone who wants the hard boundary today. Reasons:

- (b) asks Loam's kernel to trust a server's account report for the boundary it enforces, and is
  the most work on both sides for one server's shape.
- (d) gives (a)'s boundary with one store, but filtering every command by account is the largest
  engine change here, and a missed filter leaks one account into the other.
- (a) is available now without any change, but it costs the unified client D135 asks for and
  splits the knowledge of senders that screening rests on.
- (c) is small, local to the engine, and turns the risk into the person's setting: an account the
  person guards cannot be changed by an agent without their approval, however the agent was
  steered. A change in the account the content came from stays within the policy, as it does
  today for one account.

The choice is the owner's: [Q1](#q1-taint-per-account). M36 records it when he answers. Reads
carry nothing out of the machine under any option, and a draft goes nowhere until a person
approves its send.

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

### 12.1 What the engine adds for Loam

- **Discovery.** The engine registers AFD's bootstrap commands (`register_bootstrap_commands`:
  `afd-help`, `afd-docs`, `afd-schema`), so Loam's `afd-help { format: "full" }` lists its
  commands. `rules.rs`'s naming rule exempts exactly AFD's bootstrap names
  (`AFD_BOOTSTRAP_COMMAND_NAMES`), and every other rule still applies to them: they are reads, hold
  nothing and are exposed to `mcp` and `cli`. Test F-T13 discovers the real engine as Loam's kernel
  does, with an ordinary token and with an approver token, and finds the same commands.
- **A mount package** with a manifest of kind `mounted` (section 12.3).

### 12.2 The person's steps

What the person does on the desktop, once Loam's phase 5 steps 4 and 5 accept the entry's new keys,
Loam's desktop transport speaks MCP 2026-07-28, and the engine has the changes of section 18:

1. Run `loam-mail serve --port 7461` (a port the person chooses; the entry names it).
2. At the engine's terminal (macOS or Linux; `--out` is refused on Windows, section 4.1):
   `loam-mail mail-token-create '{"name":"Loam","role":"approver"}' --out <file>`, and approve.
3. Write the instance in `loam.deployment.toml` (below), with `[host] kind = "desktop"`, then run
   `loam deployment check` and `loam deployment write --host desktop --dist <the app's bundled dist> --out <app data>/site --mounts-out <app data>/mounts.json`
   (phase 6's 10.4). `deployment write` copies the bearer into `mounts.json`, which is as secret as
   the token file (section 4.3).

### 12.3 The entry

In phase 1's form. Phase 5's 7.4 sketched it as `[[instances]]`; phase 1's deployment file writes
an instance as a table under `apps`, and a mounted instance needs `package` and `audience`. Its
`prefix` defaults to the manifest's `mount.prefix` for the first instance of an app; it is written
here so that the entry says it:

```toml
[apps.mail]
app = "mail"
package = "<the engine's mount package, built from endpoints/loam/plugins/mail/mount/>"
prefix = "mail"
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

# The unit's submit, which 7.3 requires the entry to name. Only the composer calls it.
[apps.mail.commands."mail-replyset-submit"]
expose = { agent = true }
```

**Every other mutation the person wants reachable** is named the same way, with
`expose = { agent = true, palette = true, apps = true }`. The engine's mutations exposed over MCP
are: `mail-sync`, `mail-selection-create`, `mail-archive`, `mail-label`, `mail-mark`, `mail-trash`,
`mail-operation-dismiss`, `mail-operation-undo`, `mail-operation-resume`, `mail-operation-cancel`,
`mail-thread-snooze`, `mail-draft-create`, `mail-draft-update`, `mail-draft-discard`,
`mail-draft-restore`, `mail-sender-suggest`, `mail-sender-dismiss`, `mail-record-propose`,
`mail-record-withdraw`, `mail-story-propose`, `mail-story-dismiss`, `mail-replyset-create`, and
step E3's commands for recording answers and editing a reply. A command left out stays hidden from
Loam's agents and apps, as phase 1's 7.4 says.

**The mount package.** Step F adds `endpoints/loam/plugins/mail/mount/` with a manifest of kind
`mounted`: `plugin.id = "mail"`, `domains = ["mail"]`, `mount = { prefix = "mail", transport = "http" }`,
and `mount.tools[]` effects for the commands above, so that Loam's precedence (its 7.4) agrees with
the engine's reports. The prefix equals the commands' domain, so the final names are the engine's
own.

**A fixed port.** The engine picks a port when `--port` is absent and records it in `server.json`.
A hand mount needs `--port`, since the entry is written once. Step 9's install chooses the port and
writes both.

## 13. The native app

The full app follows phase 5's step 7; this section fixes its shape so that the engine's commands
and the instance entry need no change for it, and names the slice that must exist before step 7.

- **Two manifests, one plugin** (phase 5's 7.5): the mounted instance `mail` (section 12) and a
  native app, `mailapp`, titled "Mail", in `endpoints/loam/plugins/mail/app/`.
- **It holds no mail.** Everything it shows comes from the engine through its `calls` grant; it
  keeps only view state (which mailbox is open, a draft being typed before its first save).
- **It renders no stranger's markup as markup.** It shows the engine's cleaned HTML (the engine's
  B4) in a sandboxed frame, or text, and labels values from mail as the engine labels them.
  Whether a native app or a view kind serves that better is the app's amendment to decide.

### 13.1 The send slice, before Loam's step 7

Phase 5's P5-A9 needs "a send … the person makes in the mail app" against the real engine. So
before step 7 the plugin ships **`mailapp`'s first slice**: one view that opens a thread by id,
writes a reply as a draft (`mail-draft-create`, `mail-draft-update`), shows it with
`mail-draft-show`, and sends it with `mail-draft-send { draft, revision }`, the confirmation coming
from Loam's 7.2 path for a human gesture. Its manifest is section 13.2's, with the grant narrowed
to `mail-thread-open`, `mail-draft-create`, `mail-draft-update`, `mail-draft-show` and
`mail-draft-send`. That slice, not phase 5's `mailfixapp`, satisfies P5-A9's person's send; it is
F6 in the plan.

### 13.2 Its manifest's grant

In the form phase 5's 7.5 describes (`[[calls]]` naming an instance and its commands; the exact key
is phase 5's step 4's):

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
  "mail-operation-list", "mail-operation-show", "mail-record-list",
  # syncing and changing the mailbox, under the policy
  "mail-sync", "mail-selection-create", "mail-archive", "mail-label", "mail-mark", "mail-trash",
  "mail-operation-undo", "mail-operation-resume", "mail-operation-cancel", "mail-operation-dismiss",
  "mail-thread-snooze", "mail-sender-suggest", "mail-sender-dismiss",
  # writing and sending
  "mail-draft-list", "mail-draft-show", "mail-draft-create", "mail-draft-update",
  "mail-draft-discard", "mail-draft-restore", "mail-draft-send",
  # reply sets, with E3's commands for recording answers and editing a reply
  "mail-replyset-create", "mail-replyset-show", "mail-replyset-send",
  # the person's other releases
  "mail-unsubscribe-show", "mail-unsubscribe", "mail-operation-approve",
]
```

- **What it does not call:** `mail-replyset-next` and `mail-replyset-submit`, which are the
  composer's path; `mail-record-propose` and `mail-story-propose`, which are agents'; and every
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
- **The service at sign-in** (phase 5's Q2), per operating system.
- **Windows and Linux.** The engine keeps credentials in the macOS keychain only (its section 2),
  and its private files, `--out` included, are private only on Unix. The desktop lane runs on
  Windows and Linux too, so mail there needs a keychain store per platform and owner-only access
  lists on Windows first.
- **Upgrades:** a new engine binary is a new install (7.4); the data directory is kept.

## 15. Amendments to the engine's specification

Applied by the pull request that builds each, so as not to collide with D3 and E3:

| Engine section | Change | By |
| --- | --- | --- |
| M18 | Section 5.4's text | F2a |
| 3.3 | Tokens have a role; an approver token's form; the `with_approver` mapping; `--out` | F1 |
| 3.5 | Four commands also listed over MCP; what a non-approver gets; the check before the hold; the command line fills a revision or digest | F2a, F2b, F3 |
| 9.4 | A held command acts as the person's; one caller for Loam; a proposal's generation; per-account limits and single-account changes, if Q1 is answered (c) | F2a, F4 |
| 9.5 | Recipients' `basis`; the draft's size cap; `new` recipients as Q2 is answered | F2b |
| 10.3 | Reply sets' revision, size cap and stored recipients; units, claims and `mail-replyset-submit`; what is recorded per reply | F3 |
| 11 | Exposure of the four; `mail-unsubscribe-show`, `mail-replyset-submit`; `mail-replyset-next` a read; `mail-token-create`'s `role`; AFD's bootstrap commands | F1 to F3 |
| 12.3 | `PREVIEW_CHANGED`, `PREVIEW_TOO_LARGE`, `UNIT_NOT_OPEN`, and `SELECTION_SPANS_ACCOUNTS` if Q1 is answered (c) | F2a to F4 |
| 14 | Phase B's "a person's command is not listed or callable over MCP" becomes "only the four are listed, and none runs without evidence from the terminal or an approver" | F2a |

## 16. Error codes

Added to the engine's 12.3. Each failure carries a suggestion in the engine's words and no content.

| Code | When | Retryable |
| --- | --- | --- |
| `PREVIEW_CHANGED` | A released command names a revision or digest that does not match its target, before the hold or after the approval (section 7) | No: read the preview again and ask the person again |
| `PREVIEW_TOO_LARGE` | A draft or reply set would grow past what its preview shows whole, or a preview would exceed the read budget (section 6) | No: shorten the text, or split the set |
| `UNIT_NOT_OPEN` | `mail-replyset-submit` names a unit or claim that is not the reply's current one (section 9.2) | No: call `mail-replyset-next` again |
| `SELECTION_SPANS_ACCOUNTS` | Only if Q1 is answered (c): an agent's or a script's change, resume or undo whose set spans accounts | No: make one selection per account |

`APPROVAL_REQUIRED`, `VALIDATION_ERROR` and `COMMAND_NOT_FOUND` keep the crate's meanings;
`RECIPIENT_NOT_ALLOWED`, `POLICY_LIMIT`, `PROPOSAL_NOT_OPEN` and `SCREENING_NOT_READY` keep the
engine's.

## 17. Security

What changes against the engine's section 13 and phase 5's section 15. "Content" is text a stranger
wrote.

| # | An attacker tries | Through | What stops it | Test |
| --- | --- | --- | --- | --- |
| F1 | To send, unsubscribe or approve as an agent | Calling a released command over MCP | Held for every caller; a non-approver gets no token, and its `_meta` is ignored | F-T3, F-T4 |
| F2 | To become an approver | `mail-token-create` over MCP | Not listed; made only at the terminal, with a summary that names the power | F-T1 |
| F3 | To redeem another caller's token | A token from a log or another approver | Bound to the approver's actor, single use, 30 minutes; removed from the journal and from every non-approver's result | F-T3, F-T4 |
| F4 | To send what the person did not see | A change to the draft, the set, the target or the proposal after the preview, or a call naming a revision ahead of the draft's | The revision or digest, checked before the hold and again in the act's transaction; a proposal's generation; `PREVIEW_CHANGED`; Loam's hold and re-read besides | F-T7 |
| F5 | To add a stranger's address to a send | Content steering the copilot to edit a draft | A `new` address is refused through Loam until Q2 is answered; a `thread` address a stranger forged into the thread is shown, labelled, in the preview the person approves | F-T8, Q2 |
| F6 | To carry one sender's text into another's reply | A reply set | Each unit holds one reply's inputs; a submit needs the reply's current unit and its claim, which the parent never sees; an edit or a submit spends it; the preview marks replies that differ | F-T9, F-T10 |
| F7 | To change the guarded account through content from the other | The copilot under taint from one account | With Q1's (c): per-account agent limits and no change across accounts; with (a) or (d): separate instances | F-T11 |
| F8 | To act as the person with Loam's bearer | A program running as the person reads the token file or Loam's `mounts.json` | **Not stopped.** The approver token carries the person's authority for the four commands, with no person asked: it can draft a reply and send it (to `new` addresses too, if Q2 allows them through Loam), propose a change as an agent and approve it itself, lifting every limit, and unsubscribe. It lasts until revoked, unlike `cli.token`. The same boundary as `cli.token` today (the engine's 3.5) and phase 5's T15. Mitigations: files private to the person, `--out` refused where they cannot be made so, `mail-status`'s count of approvers, and revoking (section 4.3) | Documented; F-T1 for the file |

## 18. Implementation plan

Each is one pull request, built in this session after review, that updates the engine's
specification (section 15) and adds its own line to the status file when it starts. Each runs
`cargo fmt --check`, clippy with `-D warnings` and `cargo test --locked` in `loam-plugins.yml`, and
`pnpm verify` before push.

| PR | Contents | Needs |
| --- | --- | --- |
| F1 | **Approver tokens and discovery.** The `role` column (the next free migration); `mail-token-create`'s `role` and summary; `--out`, refused on Windows; `mail-token-list`'s role; `mail-status`'s token counts; `with_approver`; the middleware that strips a held result's token for a non-approver over MCP and gives the engine's suggestion; AFD's bootstrap commands and `rules.rs`'s exemption for them; an AFD issue for `include_token`'s default (section 20, item 6). Tests F-T1 to F-T4 on a held test command, since no person's command is listed yet, and F-T13 | Step B5 only |
| F2a | **Approving proposals released.** `mail-operation-approve` listed over MCP; the proposal's generation; `mail-operation-show`'s `proposal` and `digest`; the check before the hold and in the transaction; `PREVIEW_CHANGED`; the command line filling the digest; M18 and the phase B exit test amended; the new registry rule of section 5.1. Scenario file 3 with the `mail-f-base` seed, run in the workflow. Tests F-T5 to F-T7 for it. This proves the approval path before any send exists | F1; D1 (merged) |
| F2b | **Sends and unsubscribes released.** `mail-draft-send` and `mail-unsubscribe` listed; `mail-unsubscribe-show`; the draft's revision checks, recipients' `basis` and size cap; `PREVIEW_TOO_LARGE`; `new` recipients as Q2 is answered. Scenario files 1, 2 and 4. Tests F-T3 to F-T8 for both | F2a; **D3** (drafts, send, unsubscribe) |
| F3 | **Reply sets released, and units.** `mail-replyset-send` listed, with the set's revision, size cap and stored recipients; `mail-replyset-show` as the preview; `mail-replyset-next` as a read returning the unit and its claim; `mail-replyset-submit`; the claim's key; the per-reply records (migration); `UNIT_NOT_OPEN`. Scenario file 5. Tests F-T3, F-T4, F-T6 and F-T7 rerun for the set's send; F-T9 and F-T10 | F2a; **E3** (reply sets) |
| F4 | **Taint per account,** as the owner answers Q1. For (c): per-account agent limits (migration), `mail-policy-set`'s `account`, `SELECTION_SPANS_ACCOUNTS`; F-T11. For (a): documentation of two instances, and step 9's amendment notes an install per account. For (b) or (d): this specification is amended first | D1 (merged); Q1's answer |
| F5 | **The mount package.** `endpoints/loam/plugins/mail/mount/` with its manifest, and the plugin's README section with section 12's steps | F1; Loam's phase 5 steps 4 and 5, for `labels`, `approvals`, `preview` and `expose.apps` in the entry |
| F6 | **`mailapp`'s send slice** (section 13.1) | F2b, F5; Loam's phase 5 step 4 (`calls` grants to mounts) |

**Order.** F1 now; F2a after F1; F4 once Q1 is answered; F2b after D3; F3 after E3; F5 when Loam's
step 5 merges; F6 after F2b and F5. Loam's step 7 (P5-A9) mounts the engine after F3, F5 and F6,
and needs Loam's desktop transport on MCP 2026-07-28 (F-T12). **Trust review** for F1, F2a, F2b
and F3, which change who can send.

**The rest of the native app** is not in this plan. Its amendment, with its jobs and views, follows
Loam's step 7.

## 19. Tests

| # | Test | Passes when |
| --- | --- | --- |
| F-T1 | Approver tokens are made only at the terminal | `mail-token-create` over MCP is `COMMAND_NOT_FOUND`; at the command line with no terminal, `PERSON_REQUIRED`; with one, it asks with the approver's summary; the store holds the hash and `role`; the token starts `lmail_approver_`; its result is not in the journal; `--out` creates a new `0600` file before writing, refuses one that exists, prints no token, and on Windows is refused |
| F-T2 | The approver mapping | An approver token's call is an approver to the crate; an agent token's, the command line's route and stdio's are not; a revoked approver is refused with `401` from the next request, and its outstanding hold cannot be redeemed; `mail-token-list` and `mail-status` give the role and the counts |
| F-T3 | A non-approver's held result | Over MCP, an agent's call to each released command gives `APPROVAL_REQUIRED`, `retryable: false`, a summary with no content, the engine's suggestion and no `approvalToken`, and no elicitation; over stdio the same; on the command line's route the token is present |
| F-T4 | An approver's release | An approver's held result carries the token; a retry with it in `_meta["dev.afd/approval"]` from an MCP 2026-07-28 request runs once; a second retry is refused; another approver token's retry with it is refused; the same retry on a 2025-era request, in `afd-batch` and in `afd-pipe` is refused and runs nothing; an agent's `_meta` is ignored; the key in tool arguments is `VALIDATION_ERROR` |
| F-T5 | Exposure | The registry rule of section 5.1, by a registry built with a fifth command that breaks it; the eight of section 5.1 stay `cli` only; `tools/list` over HTTP agrees; M29's test still passes |
| F-T6 | Previews | Each preview gives its whole target in labelled parts and nothing from mail outside them; two reads of an unchanged target are equal in canonical JSON; the largest allowed draft and the largest allowed set are shown whole over HTTP within the read budget and the 4 MiB reply; one larger is refused when built with `PREVIEW_TOO_LARGE`; `mail-unsubscribe-show` contacts nothing (the scripted HTTP target records no request) |
| F-T7 | Revisions and digests | For each released command: a call naming a revision ahead of or behind the target, or another digest, fails with `PREVIEW_CHANGED` before any hold, and no token is issued; a target changed between the hold and the approved retry (the draft updated by another token, the unsubscribe target re-derived to another URL, the proposal dismissed and proposed again under the same id, by its proposer and by another) fails with `PREVIEW_CHANGED` and sends, contacts or changes nothing (no `outbound` row, no request to either scripted target, the proposal still waiting); an unchanged target runs and uses the target that was checked; a dismissed or expired proposal is `PROPOSAL_NOT_OPEN`, as now; the command line fills a missing revision or digest from the preview |
| F-T8 | The person's | An approved `mail-operation-approve` from an approver runs past every limit and counts against no day; the approver token's own trash below the call's limit runs and is charged to its day, and above it becomes a proposal; a `new` recipient on an approver's send follows Q2's answer; the same draft at the terminal asks for the address |
| F-T9 | Units | `mail-replyset-next` is a read and not journaled; its result has the marker with `submit.command` `mail-replyset-submit`, `field` `text`, the claim in `submit.input` and instructions within 4,096 characters; the returned `unit` and `claim` equal the marker's exactly, and the unit stored with a submission equals the one handed out; `mail-replyset-submit` is a non-destructive mutation with no approval; a guessed claim, another reply's claim, a spent claim, a claim from before the reply's answers changed and a composer's late result after a person's edit are each `UNIT_NOT_OPEN`; a text over 32,768 characters is refused; the input cannot set a recipient; each submission is recorded with its inputs; the set's revision rises |
| F-T10 | Units hold one reply's inputs | In a set of two senders, each unit's parts hold only its own sender's message and the answers to their questions, by search of the result for the other sender's text and address |
| F-T11 | Per account (Q1's (c)) | An agent's limits of 0 on one account make its change there a proposal while the other account keeps the default; an agent's selection over two accounts cannot be changed, guarded or not; the person's can |
| F-T12 | One real confirmation, one send | In Loam's desktop suite (phase 5's step 7), with the real engine mounted by section 12's entry: a person's confirmation of a send produces exactly one message at the scripted SMTP server; Loam's transport on MCP 2025-06-18 cannot redeem the token, and the engine refuses it |
| F-T13 | Discovery | Loam's `discoverInstance` against `loam-mail serve`, with an ordinary token and with an approver token, lists the engine's commands with the four released ones and no terminal-only one; `rules.rs` passes with the bootstrap commands registered |
| Scenarios | The five files | Each passes against `loam-mail serve` on `mail-f-base` in the workflow, from F2a (file 3), F2b (files 1, 2 and 4) and F3 (file 5) |

Loam's side, the mount on the desktop with its confirmation, hold and units, is phase 5's P5-A6,
P5-A7 and P5-A9.

## 20. Points in phase 5's contract this document reads one way

Phase 5 is approved; these are places where its text could be read otherwise, said so that its
owner can confirm or amend them.

1. **The entry's form.** 7.4 sketches `[[instances]]`; phase 1's deployment file writes
   `[apps.<instance>]` and requires `package` and `audience` for a mounted instance, with `prefix`
   defaulting to the manifest's. Section 12.3 writes phase 1's form.
2. **The app's id.** Phase 1 keeps app ids and prefixes unique, so with the mount's prefix `mail` the
   native app cannot be `mail`; phase 5's own fixture pairs `mailfix` with `mailfixapp`. This
   document names the app `mailapp`.
3. **"Counts as the person's against its agent limits."** Evidence exists only on a held call, and
   of the four held commands only `mail-operation-approve` is under 9.4's limits, which it already
   escapes. A person's own change through Loam that is not held is an agent's (section 8.1;
   [Q4](#q4-a-persons-own-changes-through-loam)).
4. **One caller for everything Loam does.** Phase 5 does not say that the copilot, its apps and the
   person's gestures share the engine's per-caller limits, its day and the five proposals, nor that
   a draft's authorship cannot tell them apart (section 8.3).
5. **Credentials for an approver.** AFD's rule 4 advises naming over HTTP only callers with
   verified credentials. The engine verifies its own bearer and maps each token to its own actor,
   and sets no `Credentials` (section 4.2).
6. **The token for a non-approver.** AFD's carrier says no token is included for another caller,
   but the crate's middleware still includes one for any MCP caller when `include_token` is true,
   its default. That reads as a nonconformance of the crate with the approver rule 2. F1 files an
   AFD issue; the engine strips the token meanwhile.
7. **A preview's stability and wholeness.** 7.2 compares two preview reads by digest but does not
   require a preview to be stable for an unchanged target, nor whole. Section 6 requires both of
   the engine; any other server Loam releases commands for needs the same.
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
12. **The desktop transport's protocol.** Loam's desktop mount transport speaks MCP 2025-06-18, and
    AFD's carrier accepts approval evidence only from 2026-07-28 requests. Phase 5's step 5 needs
    the transport moved first; it is not listed among the step's needs.
13. **A unit's submit outside the composer.** 7.3 says a unit's submit runs under the copilot's actor
    with `act` by default. The kernel should refuse, or always ask for, a copilot call to an entry's
    unit-submit command that does not come from the composer, so the parent cannot write a reply
    the person will take as composed apart. The engine's claim (section 9.1) already keeps a parent
    that never saw a unit's payload from submitting against it.

## Review 2026-11-19

Two independent reviewers read the first draft (`95154c06`), each with verdict "revise": nine
blockers and one more, and improvements. Each was checked against the documents and code before
anything changed.

| Finding | Held? | What changed |
| --- | --- | --- |
| A1: Loam's discovery needs `afd-help`, which the engine does not register | Yes (`mounted.ts`, `lib.rs`) | 12.1; F1; F-T13 |
| A2: the desktop transport speaks MCP 2025-06-18, on which evidence is refused | Yes (`mount-desktop.ts`, `server/approver.rs`) | Section 2; 20, item 12; F-T4, F-T12 |
| A3: an old approval can release a resume proposed again under the same id | Yes (`tests/proposals.rs`) | The proposal's generation (section 7); the order of checks; F-T7 |
| A4, B5: a unit's submit can be forged, and `composedVia: unit` overclaims | Yes | Claims, generations and `source` (9.1, 9.2); 20, item 13; F-T9 |
| A5, B2: the approver summary promised a check the engine cannot make | Yes; `home.rs` is private only on Unix | 4.1's summary and `--out`; M34; 4.3; F8 |
| A6, B4: a person's own change through Loam is counted as an agent's | Yes | 8.1 and section 2 corrected; [Q4](#q4-a-persons-own-changes-through-loam) |
| A7, B3: a preview may not show the whole target | Yes | Whole previews and caps (section 6); `PREVIEW_TOO_LARGE`; F-T6 |
| A8: the reply scenario could not pass as written | Yes: flow maps split at the comma, and expectations are not resolved | The file rewritten |
| A9: the app P5-A9 needs was deferred | Yes | 13.1's send slice; F6 |
| B1: a revision checked only after approval lets an unseen revision be sent | Yes | The check before the hold (section 7); F-T7 |

Improvements taken: the operation's digest covers its frozen target, not derived counts; stored
reply recipients; `include_token` as an AFD issue, with one predicate for marking and stripping;
migration numbers in merge order; the registry rule worded as `rules.rs` works; F-T4's pipe and
legacy cases and F3's reruns; Q1's fourth option and its notes; Q2's `thread` caveat and a Loam-side
option; the `prefix` default and `deployment write`'s arguments; `mail-replyset-submit` exposed to
`agent` alone; the grant's missing commands; F2 split so approvals are proven on D1 alone; tests of
real target changes; the jobs' ranking as Q5 and what writing them changed; a held reply-set send
in scenario 5; the draft's authorship in 8.3; the status file's lines.

## Questions for the owner

### Q1. Taint per account

Blocks F4. If the copilot reads a message in your personal account, can it then archive or trash in
your work account without asking? Today, yes, within mail's limits (500 archived or 50 trashed a
call, 200 trashed a day), because Loam sees one mail engine.

- **(a) Run one mail engine per account.** Separate processes, stores and entries; Loam then asks
  before the copilot changes, or even reads, the other account after reading one.
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
    Agents working across accounts make one selection per account.
  - Cost: one engine pull request (F4).
- **(d) One engine, mounted twice in Loam with a token per account.** Loam sees two sources, as in
  (a), but there is one store and one sync.
  - Tradeoff: as (a) in Loam; and a missed filter in the engine would show one account to the other.
  - Cost: the largest engine change here: every command filtered by account.

**Recommendation:** (c). It is the smallest change, keeps one inbox and one knowledge of senders,
and turns the risk into your setting. (a) stays possible for anyone who wants a hard wall today.
**Confidence:** medium. If you want protection on by default, (c) can ship with every account but
the first guarded, at the cost of more proposals to approve.

### Q2. New recipients from Loam

Blocks F2b's recipient rule. At the terminal, mail sends only to people in the thread, people you
have written to, or an address you type. In Loam you type into the mail app, which the engine cannot
tell from the copilot.

- **(a) Allow a new address on a send you approve in Loam, marked "new" in what you approve
  (recommended).**
  - Tradeoff: if a message steers the copilot to add an address, the only check is that you notice
    the "new" mark before approving. An address a stranger wrote into the thread is not marked new.
  - Cost: in F2b.
- **(b) New addresses only at the terminal.**
  - Tradeoff: you cannot write to someone new from Loam, so Loam is not your only mail client.
  - Cost: none.
- **(c) Loam asks once more for each new address** before the send's confirmation, as a separate
  gesture.
  - Tradeoff: one more click per new person; a phase 5 amendment, since the engine cannot see the
    gesture.
  - Cost: Loam's work, and (a) in the engine.

**Recommendation:** (a). Every send is already a decision you make with the recipients in front of
you, and the mark makes a new one stand out; (c) adds little that the mark does not. Until you
answer, F2b refuses new addresses through Loam. **Confidence:** medium.

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
  - Cost: an amendment to phase 5 before its step 5, and part of F2a.

**Recommendation:** (a). The send path should be proven first, and screening's volume needs a batch
surface Loam has not decided (its L4). **Confidence:** medium.

### Q4. A person's own changes through Loam

Not blocking F1 to F3. When you archive or trash from Loam's mail app, the engine sees Loam's token,
the same one the copilot uses. So your own small changes count against the agent limits, your trash
against the agent's 200 a day, and a copilot steered by a message could use up that day so that your
own trash becomes a proposal you then approve. Phase 5 says your own bulk change through Loam is not
counted as an agent's; today that holds only once you approve a proposal.

- **(a) Accept it for step F (recommended).** Your change still happens: within the limits at once,
  over them after one approval in Loam.
  - Tradeoff: the copilot and you share one budget; a steered copilot can make you approve changes
    you would otherwise make directly.
  - Cost: none; phase 5's sentence is amended to say "once approved".
- **(b) A second token for your own gestures,** used by Loam only for calls a person's gesture
  makes, which the engine counts as yours.
  - Tradeoff: Loam must choose a token per call by gesture, and that token, read from disk, acts as
    you with no limit at all.
  - Cost: a phase 1 and phase 5 amendment (two credentials per instance) and an engine role.
- **(c) Amend phase 5 to drop the sentence,** and treat everything through Loam as an agent's.
  - Tradeoff: as (a), stated as the rule rather than an exception.
  - Cost: a sentence.

**Recommendation:** (a). The limits are generous for one person's day, nothing is lost when they are
reached, and (b) puts an unlimited credential on disk for a convenience. **Confidence:** medium.

### Q5. The jobs and their order

The five jobs in [section 3](#3-jobs-and-scenarios) are ranked: an agent cannot send; only what I
saw is sent; approve exactly what an agent proposed; see what an unsubscribe will contact; hand out
each reply with only its own inputs.

- **Recommendation:** keep them and the ranking. The first two guard every send, the third guards the
  one release that lifts every limit, and the last two follow the order of the plan (F2b, F3).
- Cut, add or reorder as you see fit; the ranking decides what is built first after F1.
- Not a job here, since it is Loam's: approving in Loam's own dialog, which phase 5's
  `approve-mail-send` and `person-sends-mail` hold.

**Confidence:** medium-high.
