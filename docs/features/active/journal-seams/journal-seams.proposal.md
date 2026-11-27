# Journal seams: what a host needs to build a durable record on AFD's journal

Epic: [#2677](https://github.com/lushly-dev/afd/issues/2677).

> **Goal**: A host can build a stricter record than AFD's journal (written before the effect,
> tamper-evident, naming who approved) without forking the recorder and without AFD's journal
> changing for anyone who does not ask.

| Field | Value |
|---|---|
| Status | Approved 2026-11-26: the owner accepted decisions J1 to J6 as recommended, and J2 holds every member of the journal entry and the result ([Approved and held](#approved-and-held)). The dispatch id and the approval hook are built in TypeScript, Rust and C++, with Python to follow; progress is in [STATUS.md](./STATUS.md). |
| Author | jasfalk (drafted with Claude) |
| Packages | `spec/`, `packages/core`, `packages/server`, `packages/client`, `python/`, `packages/rust`, `packages/cpp` |
| Related | [`spec/journal.md`](../../../../spec/journal.md), [`spec/dispatch.md`](../../../../spec/dispatch.md), [approvals](../../../../spec/command-metadata.md#approvals), Umbel decisions D66 and D208 ([decisions](../../../../endpoints/umbel/docs/decisions.md)), [Loam OS](../loam-os/loam-os.proposal.md#what-umbel-and-afd-need), [idempotency keys](../idempotency-keys/idempotency-keys.proposal.md) |

## Why

AFD's journal is for replay and for a best-effort audit: it is written after the command, and a
sink failure never changes a command's result. Two decisions keep it that way. Umbel's D66 keeps
the journal fail-open, and D208 (2026-11-25) puts the Loam OS write-ahead record in Umbel, "not a
change to `spec/journal.md`", because "a schema change in `spec/journal.md` would bind all four
languages for a need only this host has".

This proposal does not revisit either. It asks a narrower question: when a host builds its own
stricter record beside AFD's journal, as D208 does, what does it have to work around?

One host has asked: Loam OS, which needs an intent written before a command that starts
something. A second is prospective and not in this repository: a product that keeps books on AFD
(the question came from assessing an ERP built as a separate project on top). It would need the
same, plus a record nobody can edit unnoticed and the name of whoever approved a held action.
Neither record belongs in AFD. Both need four small things from it. J2 builds now the parts
that touch no entry and no result, and holds the rest until the owner decides to build the
layered product.

## Today

What a host can already do, in every language:

| Need | How | Evidence |
|---|---|---|
| Run a step before the handler that sees the validated input and can refuse the call | A middleware: it runs after validation (stage 8) and may return without calling `next` | [`spec/dispatch.md`](../../../../spec/dispatch.md), stages 6 to 8 and rule 8 |
| Record its own values with each entry | A declared context field with `journal: true`, which trusted host code may set | [`spec/context-fields.md`](../../../../spec/context-fields.md) |
| Attach its own metadata to a command and read it at dispatch | `toolMeta`, under the reverse-DNS key rule | [`spec/command-metadata.md`](../../../../spec/command-metadata.md#fields) |
| Store entries anywhere | The `JournalSink` interface: `append` and `read` | `packages/core/src/journal.ts` |

What it cannot do:

| # | Gap | Evidence |
|---|---|---|
| G1 | **No id is unique to one dispatch.** The trace id is the caller's to set. A batch item gets `<trace>-<index>`. A pipeline step differs by language: TypeScript gives every step the caller's trace id when there is one, and Rust gives step `i` `<pipeline id>-step-<i>`, where the pipeline id falls back to the start time in milliseconds. D208 works around this by refusing a required call whose trace id it has seen | `packages/core/src/command-execution.ts` (`batchTraceId`), `packages/core/src/pipeline-executor.ts` (step context), `packages/rust/src/pipeline/execute.rs`, D208 |
| G2 | **A reader drops what a host adds to an entry.** Python, Rust and C++ build an entry from its known members only, so a chain hash or an approver a sink wrote is gone after one read and write. TypeScript checks only the known members and keeps the object | `python/src/afd/core/journal.py`, `packages/rust/src/journal.rs`, `packages/cpp/src/journal.cpp`, `packages/core/src/journal.ts` (`isJournalEntry`) |
| G3 | **Nothing reports that an approval was accepted.** The one hook, `onApprovalRequired`, fires when a call is held. The nonce store sees a nonce and an expiry. A token binds the requesting actor, not the approver. So no record can say which decision admitted a call | `packages/server/src/approval.ts`; [approvals](../../../../spec/command-metadata.md#approvals), rule 2 |
| G4 | **A call the engine stopped waiting for leaves no agreed trace.** The spec says what the caller gets at a deadline (`TIMEOUT`, `BATCH_TIMEOUT`, `PIPELINE_TIMEOUT`) and nothing about the journal. TypeScript's deadline sits outside the middleware, so the entry, when the handler finishes, holds the handler's result and not the `TIMEOUT` the caller was given. D208 records that Rust writes no entry | `packages/server/src/command-timeout.ts`; [`spec/execution-controls.md`](../../../../spec/execution-controls.md); D208 |

Two more limits are deliberate and stay: the recorder's order (handler, then append) and its
fail-open rule. In Rust the recorder is part of the registry and a middleware cannot replace the
clock, so an outside crate cannot build a second recorder with a tape; the seams below go on the
built-in recorder for that reason.

## Jobs

The feature adds no commands and its seams face the host, not the caller, so its jobs are stated
here and checked by shared vectors, not by scenario files
([jobs first](../../../../.claude/skills/afd/references/jobs-first.md) skips work with no
commands, and a scenario cannot read a journal file or a hook).

1. **Match an intent to its outcome.** When a command that starts something is about to run, I
   want an id no other dispatch shares, so that after a crash I can match each intent I wrote to
   exactly one settled entry, or to none.
2. **Keep what I add.** When my deployment needs tamper evidence, I want my sink to add a chain
   hash to each entry and every AFD reader and tool to keep it, so that a verified journal is
   still verifiable after `afd replay` or a copy between sinks touched it.
3. **Name the decision.** When a held call runs because a person approved it, I want the entry
   to name the approval that admitted it, so that an auditor can go from an effect to who
   allowed it.
4. **See what was abandoned.** When the engine stops waiting for a handler at a deadline, I want
   the record to say so, so that I never read a missing entry as "it did not run".
5. **Stay quiet.** When a host asks for none of this, I want every result and every journal
   byte unchanged, so that existing journals, fixtures and context digests still match.
6. **Keep secrets out.** I want none of the new members to carry what the entry itself may not,
   so that a seam never becomes a way around the journal's allowlist or its redaction.

## Proposal

Four additions. No result and no entry changes unless the host turns one on. Two values are
always present and change neither: the `dispatchId` on the context (S1) and the `approvalId` on a
held call's request (S3).

### Approved and held

Decided by the owner on 2026-11-26 (J2):

- **Built now:** what touches no entry and no result. S1's `dispatchId` on the context, and S3's
  `onApprovalAccepted` hook with the `approvalId` on a held call's request. Phase 0
  ([#2678](https://github.com/lushly-dev/afd/issues/2678)), which only states what each language records at a deadline today,
  goes ahead too.
- **Held** until the owner decides to build the layered product
  ([#2725](https://github.com/lushly-dev/afd/issues/2725)): every member of the journal entry and the result. That is
  S2 (`ext` and `annotate`), S4 (`recordAbandoned`), and S1's `dispatchIds` option that stamps the
  id on results and entries. The worked example ([#2683](https://github.com/lushly-dev/afd/issues/2683)) needs `ext`, so it is
  held with them.

The held parts stay specified below, so they can be picked up without a new proposal. Until
then a host keeps its own record beside the journal, keyed by the `dispatchId`. For D208 that
means settling an intent in its own record after the call returns, since the journal entry does
not carry the id; Umbel's decision log says whether it does that or keeps its trace-id refusal.

Two details were added while recording J2 and were not put to the owner as questions:

- `onApprovalAccepted` is also given the call's `dispatchId` (S3). With `annotate` held, the hook
  is the only place an approval can meet its dispatch.
- The vectors for what is built now are named under [Spec changes](#spec-changes). The
  proposal named only `vectors/journal-ext.json`, which is held.

### S1. A dispatch id

The engine gives every dispatch a `dispatchId`: 128 random bits, base64url, set by the engine
and never taken from the caller. It does not come from `context.random`, so no tape changes. It
is a reserved context name beside `traceId`, readable by middleware and the handler. A batch
item and a pipeline step are each a dispatch and get their own. The trace id keeps its meaning:
it correlates the calls of one request, so sharing it across steps is correct.

By default that is all: the id is on the context, its name is left out of the context digest's
`keys`, and no result or entry changes. With the server or registry option `dispatchIds: true`
(held, [#2725](https://github.com/lushly-dev/afd/issues/2725)), the id is also stamped on the result as `metadata.dispatchId` and written to the entry as
`dispatchId`. Replay sets the recorded id through the engine's own replay path, the one that
feeds back the tape, never through anything a caller can send. A middleware, such as D208's,
needs only the context value.

### S2. Entry extensions

Held ([#2725](https://github.com/lushly-dev/afd/issues/2725)).

An entry gains an optional `ext` object. Its keys follow `toolMeta`'s
[key rule](../../../../spec/mcp-resources.md#t2-the-key-rule) (a reverse-DNS prefix, never
`dev.afd/`), and its values are JSON. Two parties may set it:

- **The recorder's `annotate` option**, a function that returns the members to add. It runs once
  the result is known, before `redact` and `append`. It is given the record at that point,
  which holds only what the journal's allowlist admits, plus the `dispatchId` and the approval
  summary (S3). It is not given the context, so the rule "a journal never stores a value from the
  command context outside an allowlist" stands unamended.
- **The sink**, which assigns `seq` and may add members that depend on the entry's position,
  such as the hash of the entry before it.

Rules:

- Every reader keeps `ext` exactly as written, and every writer that copies an entry writes it
  back unchanged. Replay ignores it.
- The canonical JSON of `ext` is capped at 4096 bytes, the cap a journaled context value has. A
  larger one is left out and the entry gains `extOmitted: true`, so an omission is visible.
- For a `secret` command, `annotate` runs only when the recorder has `redact`, since no entry
  is written otherwise, and `redact` then receives `ext` with the rest of the entry.
- AFD reads none of it. A chain hash, an approver, a posting period or a tenant is the host's.

With `ext` and a sink of its own, a host can make the journal tamper-evident without AFD
defining a hash chain.

### S3. An approval summary

When the approval step admits a call, it calls an optional `onApprovalAccepted` hook with the
summary below and the call's `dispatchId`, so a host that keeps its own record can file the
approval beside the dispatch. Once S2 is built, the recorder's `annotate` is given the same
summary:

| Member | Value |
|---|---|
| `via` | `token`, `elicitation`, `relay` or `direct` (a DirectClient's `onApprovalNeeded`) |
| `command` | The command's name |
| `inputDigest` | The unpadded base64url SHA-256 of the canonical validated input, as a relay is given |
| `approvalId` | The unpadded base64url SHA-256 of `approval\0` and the evidence's single-use key: the nonce for `token`, `elicitation` and `direct`, and `relay:<decisionId>` for `relay`. The decision id itself is not in the summary: relay evidence is never serialized |
| `issuedAt`, `expiresAt` | Epoch milliseconds, each present only when the evidence carries it: a token carries both, relay evidence neither |

It holds no token, nonce, key or credential, so it is safe to journal, and it grants nothing: no
engine code reads it back.

`approvalId` names the approval, not the admission. A server that allows a token to be reused
until it expires admits several calls under one, and `dispatchId` tells those apart.

AFD still does not know who the approver is on the token path, where the surface obtains the
decision. The summary gives the host the join key, and whoever asks the person can have it:

- **`token`:** `onApprovalRequired`'s request gains the `approvalId`, and an approver client that
  is handed the token derives the same id from the token's nonce.
- **`direct`:** DirectClient's approval request gains it.
- **`relay`:** the host's relay holds its decision id and computes the same hash.
- **`elicitation`:** no host hook runs, because the server asks the calling client's own user.
  That client cannot portably obtain the id: the nonce travels inside the `requestState`, which
  is opaque to clients and which Python seals. The entry's `actor` is the only join.

The surface keeps the id beside the person. The host's own record holds it beside the dispatch
now, and the journal holds it beside the effect once S2 is built.

### S4. Abandoned calls

Held ([#2725](https://github.com/lushly-dev/afd/issues/2725)), except phase 0, which states today's behaviour.

`spec/journal.md` gains a rule for a call whose caller was given a deadline failure in place of
the handler's result: the command's own deadline (`TIMEOUT`), a batch's (`BATCH_TIMEOUT`), a
pipeline's (`PIPELINE_TIMEOUT`) or a stream's (`STREAM_TIMEOUT`). With the recorder's
`recordAbandoned` option set:

- When the engine settles the call with that failure, the recorder appends an entry at once,
  whose `result` is the failure the caller was given and whose `abandoned` is `true`. That
  covers a language that stops waiting and one that waits and then replaces the result, as C++
  does.
- If the handler later settles and the language can observe it, the recorder appends a second
  entry with the same `dispatchId` and the handler's result, marked `late: true`.

Three cases are out of scope. A batch item or pipeline step that never started did not run, so
having no entry is correct. A client's own `TIMEOUT` or `STREAM_TIMEOUT` never reaches the
engine, so the entry holds the handler's result. A task stopped at its token's expiry
(`TASK_TOKEN_EXPIRED`) has the same mismatch between its entry and what its caller is told, but
the caller reads a task's outcome from the task; the held issue ([#2725](https://github.com/lushly-dev/afd/issues/2725)) decides whether to mark it.
Caller cancellation is not part of this either. After a handler starts, cancellation is cooperative
and the engine keeps the handler's actual result
([execution controls](../../../../spec/execution-controls.md)), so nothing is abandoned.

Without the option, each language keeps what it does today, and the spec states what that is
([#2678](https://github.com/lushly-dev/afd/issues/2678)), so a host no longer has to find out by
reading four implementations. Replay skips `abandoned` entries with a note and replays a `late`
one as an ordinary call.

## What stays out

- **A write-ahead or fail-closed mode in AFD's journal.** D208 decided it is the host's. A
  middleware and `dispatchId` are what the host needs from AFD.
- **A hash chain, signatures or retention.** The host's sink does them, in `ext`.
- **The approver's identity.** AFD has no person on the token path. S3 gives the join key.
- **A hook around a whole batch or pipeline.** None exists in any language, and a host that
  needs several writes to commit together should make them one command. Listed as J4.
- **Event sourcing**, as `spec/journal.md` already says.

## Spec changes

Built now (the first pull request; phase 0 separately adds to `spec/journal.md` what each
language records at a deadline today):

- `spec/context-fields.md`: `dispatchId` joins the reserved names.
- `spec/dispatch.md`: the engine sets `dispatchId` before stage 1. A batch item and a pipeline
  step each get their own.
- `spec/journal.md`: one sentence, that `dispatchId` is left out of the context digest's `keys`,
  so no hash changes.
- `spec/command-metadata.md`, Approvals: the summary, `onApprovalAccepted` (given the summary
  and the call's `dispatchId`), and `approvalId` on the held-call requests.
- Vectors: a new `vectors/journal-seams.json` with a section for the id (present on a single
  dispatch, distinct per batch item and pipeline step, absent from the context digest's `keys`)
  and one for the approval summary, since `vectors/dispatch.json` covers single-command order
  only; and the `approvalId` of each binding in `vectors/approval-tokens.json`. The spec pull
  request chose one file for both sections, so each language has one gap to close.

Held ([#2725](https://github.com/lushly-dev/afd/issues/2725)):

- `spec/journal.md`: the `dispatchId`, `ext`, `extOmitted`, `abandoned` and `late` members, the
  reader rule for `ext`, what `annotate` is given, the abandoned-call rule, and what replay does
  with each.
- `spec/dispatch.md`: with `dispatchIds`, the engine stamps `metadata.dispatchId` at stage 12.
- `spec/wire/journal.jsonl` gains lines with the new members; its existing lines keep their
  bytes. A new `vectors/journal-ext.json` holds entries on either side of the cap and the
  round trip every reader must pass.
- `spec/schema/result.json`: `metadata.dispatchId`.

## Phases

| # | Phase | Exit |
|---|---|---|
| 0 | State and pin what each language records at a deadline today ([#2678](https://github.com/lushly-dev/afd/issues/2678)) | `spec/journal.md` says it per language, and each has a test |
| 1 | Spec and vectors for the dispatch id and the approval hook ([#2679](https://github.com/lushly-dev/afd/issues/2679)) | The "built now" spec changes are merged and the new vector cases load in every language's suite, each skipped with its tracking issue |
| 2 | TypeScript ([#2680](https://github.com/lushly-dev/afd/issues/2680)): the dispatch id and the approval hook | The vector cases pass, and `wire/journal.jsonl` is byte-identical |
| 3 | Rust ([#2681](https://github.com/lushly-dev/afd/issues/2681)), which Loam OS M1 consumes first | The vector cases pass, and Umbel's D208 middleware uses `dispatchId` or its decision log says why not |
| 4 | Python and C++ ([#2682](https://github.com/lushly-dev/afd/issues/2682)) | The vector cases pass, and the parity page shows no gap |
| Held | The entry members, in the spec and four languages ([#2725](https://github.com/lushly-dev/afd/issues/2725)) | An entry with `ext` written by each language is read and rewritten unchanged by the other three, and `wire/journal.jsonl`'s existing lines are byte-identical |
| Held | A worked example ([#2683](https://github.com/lushly-dev/afd/issues/2683)): the `pond` example chains entries by hash | A test edits one journal line and the check names it, using only public API |

## Decisions

Decided by the owner on 2026-11-26, each as recommended. J3 and J5 describe the held parts and
apply when those are built.

| # | Question | Decision |
|---|---|---|
| J1 | A new `dispatchId`, or random trace ids for pipeline steps (the other option D208 names)? | A `dispatchId`. The trace id is correlation and callers set it; changing it per step breaks tracing and still lets a caller repeat one. |
| J2 | D208 kept `spec/journal.md` unchanged "for a need only this host has". One host has asked and a second is only prospective. Is that enough for optional members on the entry? | Split. Built now: S1's context value and S3's hook, which touch no entry. Held: the entry members (S2, S4, and S1's opt-in stamp), until the owner decides to build the layered product. |
| J3 | Is the `dispatchId` written to results and entries only when the host opts in, or always? | Opt-in. Always-on changes every recorded result and breaks the byte-compared fixture for a value most hosts never read. |
| J4 | A begin and end hook around a batch or pipeline, for a host that wants the group to commit together? | Not now. No consumer needs it, and "one command, one transaction" is the simpler rule to teach. |
| J5 | Is `ext` one open object, or does AFD name the members a host is likely to want (`prevHash`, `approver`)? | One open object. Naming them makes AFD responsible for a chain format and an approver model it does not have. |
| J6 | Does Rust go before Python, against the usual TypeScript, Python, Rust, C++ order? | Yes: Loam OS M1 is the first consumer and it is Rust. |

## Exit criteria

For what is built now:

- Every new vector case passes in all four languages.
- Every server returns the same results and writes the same journal bytes as before:
  `wire/journal.jsonl` and every context digest are unchanged.
- Umbel's D208 middleware uses `dispatchId` in place of its trace-id refusal, or its decision
  log says why not.

For the held parts, when they are built:

- Every case in `vectors/journal-ext.json` and every new `wire/journal.jsonl` line passes in all
  four languages.
- A server that turns nothing on still returns the same results and journal bytes.
- An entry with `ext` written by each language is read and rewritten unchanged by the other
  three.
- The `pond` example detects an edited journal line using only public API.
