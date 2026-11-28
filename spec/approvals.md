# Approvals

Profile: `approvals`. This page belongs to the `approvals` profile of the
[contract registry](./registry.md): an implementation that does not claim the profile need not
implement it. A server claims it when it runs an approval step for commands that declare an `approval` policy.
One part of this page is the core's and binds an implementation without the profile too: a command whose policy is not `not-required`
runs only when an approval step admitted the call, and is refused with `APPROVAL_UNAVAILABLE`
otherwise, as the next paragraphs say ([registry](./registry.md#the-core), dispatch rule 9).

Confirmations ask whether an action is intended; approvals hold an action until a human signs off.
A command's `approval` policy decides, per call, whether it needs approval. The approval
middleware enforces it on every surface the middleware runs on (MCP, the HTTP routes and
in-process registries alike), deciding from the policy of the command the call runs.

A server engine never runs a command whose declared policy is not `not-required` unless its
approval step admitted that call. Each call is admitted on its own: a batch item, a pipeline step
and a command run from inside another command's handler are each checked, and none inherits the
admission of the call around it. A server with no approval step, or whose approval step did not
see the call, answers before the handler runs with:

```json
{
  "success": false,
  "error": {
    "code": "APPROVAL_UNAVAILABLE",
    "message": "todo-delete needs a person's approval, and this server cannot ask for it",
    "suggestion": "Tell the user that todo-delete needs their approval and this server has no approval step; do not retry. The operator adds the approval middleware (createApprovalMiddleware) or removes the command's approval policy.",
    "retryable": false,
    "details": { "reason": "no-approval-step" }
  }
}
```

When an approval step ran but did not admit this dispatch (a retry, a different command or an
input changed after it), `details.reason` is `admission-mismatch` and the suggestion tells the
operator to move such middleware before the approval step. This holds whether the policy that
gates the command is its own or one the approval middleware is given for it. The approval step
answers the same way, without asking anyone, when the input changed while it was deciding (inside a
policy function or a store it awaited), so a person is never shown one input while a token binds
another.

An approval step admits only a call a policy it holds may gate. Behind a second approval
middleware that does not gate the command, the first one's admission still decides; neither can
replace or restore the other's. One approval middleware per engine is the supported setup: two that
both gate a command's own policy would each ask for it.

When a call needs approval and its validated input has no canonical JSON form (rule 3 below), no
token or relayed approval can bind it, so the approval step answers before the handler, without
asking the person, for a single call and for a step of an `afd-batch` or `afd-pipe` approved up
front alike:

```json
{
  "success": false,
  "error": {
    "code": "APPROVAL_UNAVAILABLE",
    "message": "todo-tag needs a person's approval, and this input cannot be bound to one",
    "suggestion": "Do not retry with this input: it has no exact canonical form, so an approval cannot be bound to it. Send the input in a form canonical JSON accepts (for example, an integer a JavaScript number cannot hold exactly, such as 2^53 + 1, as a string).",
    "retryable": false,
    "details": { "reason": "input-not-canonical" }
  }
}
```

A call whose policy lets it through runs on such an input; the engine then compares the input it
dispatches with the one admitted in the language's own way (the same object, or an equal copy), and
a difference is `admission-mismatch`. Where the comparison is by identity, a change inside the same
object is not seen.

This check reads the declaration alone: a policy function is not evaluated, so a command that
declares one needs an approval step even for calls the function would let through. The suggestion
names the language's own approval middleware.

When a call needs approval and its context carries no valid approval token, the handler does not
run and the call fails with:

```json
{
  "success": false,
  "error": {
    "code": "APPROVAL_REQUIRED",
    "message": "todo-delete needs approval before it runs",
    "suggestion": "Ask the user to approve \"Delete todo 42 (permanent)\"; once they approve, the application retries the same call with the same input and details.approvalToken as its approval evidence (tool arguments cannot carry it). The token expires at 2026-10-26T12:05:00.000Z and works once.",
    "retryable": false,
    "details": {
      "approvalToken": "afdap1.eyJj….3q2-…",
      "expiresAt": "2026-10-26T12:05:00.000Z",
      "summary": "Delete todo 42 (permanent)"
    }
  }
}
```

The surface obtains the human's decision and retries the same call with the token as the
context's approval evidence (TypeScript `context.approval`). A server may leave
`details.approvalToken` out and deliver the token to the approver another way. When the call
carried a token that was not accepted, `details.reason` says why: `malformed`,
`invalid-signature`, `expired`, `command-mismatch`, `input-mismatch`, `actor-mismatch` or
`already-used`, and the result carries a fresh token. Refused [relay evidence](#relay-evidence)
gives `command-mismatch`, `input-mismatch`, `actor-mismatch`, `credentials-mismatch` or
`already-used`. A human's refusal relayed over MCP is
`declined` (see "Asking the human over MCP").

Rules:

1. **Evidence comes from trusted code.** The approval evidence is a context value that only the
   surface sets, after a human approved. It is never read from tool arguments: whoever holds a
   valid token can run the call.
2. **A token is signed and bound.** It is an HMAC-SHA256 over a payload naming the command, a keyed
   digest of the canonical JSON of the validated input, a keyed digest of the actor's `kind`, `id`
   and `onBehalfOf` (not `label`), an issue time, an expiry and a random nonce. The key is
   supplied by the application; there is no default. Every comparison is constant-time.
3. **Canonical JSON** sorts object keys at every depth and otherwise follows `JSON.stringify`
   (`toJSON` honoured, `undefined` members dropped, `undefined` array items as `null`). It accepts
   only plain objects, arrays, strings, finite numbers, booleans, `null` and values with `toJSON`;
   any other value (a bigint, a non-finite number, a map, set, regular expression, typed array or
   class instance) fails the call rather than risk two inputs sharing a digest. Binding the
   validated input means defaults and key order do not change the digest.
4. **Short-lived and single-use by default.** A token expires (five minutes by default, at most
   24 hours) and runs the command once; a second use is `already-used`. A server may allow reuse
   until expiry instead. Single-use tracking is per middleware instance unless the instances share
   a store. Expiry uses the server's clock, never a clock the caller can supply.
5. **Policies fail closed.** A policy function that returns anything other than `not-required`
   holds the call; one that throws fails the call before the handler.
6. **The agent does not get the token by default.** On MCP calls the result leaves
   `details.approvalToken` out unless the server opts in, and the token goes to the approver
   another way. A caller the server named an approver gets it, and carries it back in `_meta`
   ([Approval evidence from an approver client](#approval-evidence-from-an-approver-client)): the
   server sets that as the evidence, never tool arguments.

The token is `afdap1.<payload>.<mac>`, both parts base64url without padding. The payload is the
JSON `{"c","i","a","iat","exp","n"}` in that order: the command, the base64url HMAC-SHA256 of
`input\0` and the canonical input JSON, the same for `actor\0` and the actor JSON (`null` without
an actor), the issue and expiry times in epoch milliseconds, and a 128-bit nonce. The MAC is
HMAC-SHA256 over `afdap1.<payload>`, compared in its encoded form so a token has one valid
spelling. [`vectors/approval-tokens.json`](./vectors/approval-tokens.json) pins the format, canonical
JSON and every rejection reason, and all four languages load it.

## Private in-process approval exchange

DirectClient in all four languages reserves approval authority for trusted application code.
Public `call` and `pipe` contexts, and TypeScript/Python direct-registry `execute` contexts,
strip caller-provided `approval`; their
held results omit `details.approvalToken`, even when middleware sets `includeToken: true`.
The client invokes its configured `onApprovalNeeded` hook with public decision metadata.
Only an explicit `true` permits one private retry. The middleware still verifies the signed
credential's input/actor/command binding, expiry and single-use nonce. Denial, missing hooks,
hook errors, cancellation and expired retries never return a transferable credential.

The in-process CLI binds the same exchange when loading a module. Trusted host execution
without that exchange retains the token-based API above. Applications must own the hook,
registry and authenticated context: this is not isolation from arbitrary same-process code.
Custom registries must implement the exchange; legacy token-in-result registries remain held
by DirectClient, which removes their credential field. Use matching client/core/server versions.

The Python hook is `DirectClientOptions.on_approval_needed`; the Rust builder is
`DirectClient::with_on_approval_needed` (`Ok(true)` approves, errors and panics decline);
C++ uses `DirectClientOptions::on_approval_needed`. All receive token-free
`DirectApprovalRequest` metadata. Python copies the hook input, and Rust/C++ pass owned
input, so a hook cannot silently change the retried payload. Each call owns its exchange;
concurrent calls and pipeline steps do not share authority. Disposed markers remain
recognizable after cancellation, so late middleware cannot fall back to public tokens.

Python `create_direct_registry` wraps decorated commands in the validating server engine.
Rust and C++ `CommandRegistry::execute` remain trusted host APIs, just like Python
`server.execute`; use DirectClient as the agent-facing boundary. Rust's new DirectClient
provides approval-aware `call`, without adding a pipeline client, MCP client or CLI.
The deadline covers the initial attempt, the decision and the retry. Rust drops the flow on
cancellation; Python ignores late decisions; C++ hooks are synchronous and must cooperate
with `request.cancellation`, and a late answer never releases a retry.

Python `afd call --module <file.py>` loads an exported `registry`. An explicit `--approve`
authorizes one retry; otherwise it prompts only with interactive input/stderr and without
`--json`. Noninteractive calls remain held. `--timeout` is the total deadline in milliseconds.
Remote Python calls reject `--approve`; accepting a remote response is never approval evidence.
Rust and C++ have no CLI. MCP approval relay remains a separate capability.

## Asking the human over MCP

A server MAY relay the approval to the human behind the MCP client (TypeScript
`relay: 'mcp-elicitation'`, Python `relay="mcp-elicitation"`, Rust
`ApprovalRelay::McpElicitation`, C++ `ApprovalRelay::mcp_elicitation`). The relay is opt-in: it trusts the client application to show the
question to a person, and a server cannot tell a person's answer from client code that answers on
its own.

When a call to a single command (its tool, individual or first-class, `afd-call` or a grouped
tool) needs approval and the
request can carry a form elicitation, the server answers as for a confirmation: `input_required` on
MCP 2026-07-28, or a server-sent elicitation on a 2025-era stdio connection. The form uses the
input key `approval` and one required boolean property `approve`. Its message is the summary
followed by the command name and its validated input (canonical JSON, truncated), so the human sees
what exactly would run. No approval token is issued. Its `requestState` is integrity-protected and
bound to the method and to the call's principal binding (#532, as for a confirmation). It
carries:

- a digest of the command name, the canonical validated input and the actor, keyed with the
  approval secret;
- a random nonce and the approval's expiry, under a MAC keyed with the approval secret, so the
  state's own key alone cannot mint an approval;
- the time its question was asked: an answer counts for 10 minutes from then, however many later
  rounds carry it.

The command runs when the retry carries:

- a `requestState` that verifies and names this command, input and actor;
- a nonce and expiry whose MAC verifies under one of the approval keys;
- an approval that has not expired on the server's clock;
- the answer `accept` with `approve: true`;
- a nonce not yet spent (single-use unless the server allows reuse until expiry).

A missing, stale, altered or mismatched `requestState` is not an answer, and the server asks again.
An answer to a confirmation is never an approval: the input keys, form fields and digests differ.
One `requestState` carries the answers of earlier rounds, so a call that needs a confirmation and
an approval asks for each in turn.

A declined or cancelled form, or an accepted form with `approve` not `true`, fails the call with
`APPROVAL_REQUIRED`, `details.reason: "declined"` and `retryable: false`, and the agent must not
retry without asking the user.

Some calls fall back to `APPROVAL_REQUIRED` without a token (unless the server opts in under rule 6):

- a request that cannot elicit: no form elicitation capability, or a 2025-era request over
  stateless HTTP;
- a command run by another command in the same tool call. Only the command the tool call routes to
  may ask, and only once.

### One approval up front for `afd-batch` and `afd-pipe`

Asking mid-run would run the earlier steps again on the retry, so a batch or pipeline that can
elicit is approved up front, as a whole, or not at all (#459). Before any step's handler runs, the
server works out every step's validated input (a pipeline step's `$input` references resolved) and
evaluates each step's policy on it:

1. **A gated step whose input is not known.** A pipeline step whose input references an earlier
   step (`$prev`, `$first` or `$steps`, by the grammar of
   [pipeline variables](./pipeline-variables.md)) and whose command has an approval policy other
   than `not-required` (a policy function cannot be evaluated on an input that does not exist yet)
   cannot be shown to the human. Nothing runs, and the call fails with `APPROVAL_REQUIRED`,
   `details.reason: "input-not-known"`, `details.step` (its 0-based index) and `details.command`,
   and a suggestion to split the pipeline before that step. A step that references an earlier step
   but whose command has no such policy does not stop the pipeline, and a step naming a command
   the caller cannot run is never named here: it fails as a missing name.
2. **No gated step.** The call runs as usual.
3. **Ask once.** Otherwise the server answers with one form elicitation under the key `approval`.
   Its message says each listed step runs once, exactly as shown, and nothing runs without
   approval (and, for a pipeline with `when` conditions, that a condition may skip a step), then
   lists each gated step's position (1-based), summary, command and canonical validated input
   (truncated, as for one command). The `requestState` carries one question per gated step, each
   as for a single command but with its own binding: a keyed digest of the whole request as sent
   (the tool, its steps or commands, their inputs, conditions and options), the command, the input
   and the actor. So an approval covers this exact request: never another batch or pipeline, the
   same steps reordered or with other options, or a call to the command on its own. One answer
   covers them all. More than 20 gated steps are not asked about: nothing runs, and the call fails
   with `APPROVAL_REQUIRED`, `details.reason: "too-many-approvals"` and `details.limit`.
4. **The retry runs** only when, for every gated step, the request carries a distinct accepted
   question whose binding is that step's, whose MAC verifies and which has not expired. Two
   identical steps need two questions. Every nonce is spent before any step runs, so a replay of
   the retry runs nothing and is asked again. A step whose input is known up front and whose
   command has an approval policy then runs on the input validated up front, not on the result
   of the validation made when it runs, so the input a gated step runs on is the one the human
   was shown (#1414). The step is still validated when it runs, both as sent and on the input it
   is about to run (#1511), which the schema must read back to the same canonical JSON, and a
   step that no longer validates (its schema checks state an earlier step changed, even where only
   the approved value fails, such as a default id that has since been taken) fails with
   `VALIDATION_ERROR`, as it does on its own. So does a gated step whose schema changes a value it
   reads back (a transform that is not idempotent, or one that changes the type): called on its
   own it still runs; a step of a command without an approval policy runs on its own validation
   (TypeScript and Python count `not-required` as no policy here; Rust counts any declared
   policy, which changes nothing since its validation gives one result). Steps sent alike (the
   same command and input) take their approved inputs in the order they run, so where one is
   skipped by a `when` condition or they run in parallel, a step may run on the input shown for
   its twin: every input that runs was shown and approved, once.
   Each gated step runs on one unused approval of its own binding, once; a gated step without one
   (a policy that changed its mind) fails with `APPROVAL_REQUIRED` and runs nothing, though
   earlier steps may have run. A step whose batch or pipeline already timed out or was cancelled
   never starts.

   A schema whose defaults differ from one validation to the next (a random id, the time) gives
   the retry another input than the one approved, since the retry validates the request anew.
   TypeScript and Python, whose schemas can compute a default, therefore keep each gated step's
   index and canonical validated input with its question in the `requestState`, beside a digest
   of the whole request as sent, at most 32,768 characters of input for one question (UTF-16 code
   units in TypeScript, code points in Python; steps are kept in order while they fit). The retry
   of that same request gives the step the kept input, read back through the command's schema,
   when the schema reads it back to the same canonical JSON; a step whose kept input is missing,
   too long or not read back unchanged is validated as sent, and asked about again when the
   result differs from what was approved. A retry that carries accepted approvals but whose gated
   step had no kept input, now has the binding of none of them (it validated to another input: a
   random default), and is too long to be kept with a new question either would be asked about
   again without end, so it is refused instead (#1511): `APPROVAL_REQUIRED`, `retryable: false`,
   `details: { reason: "input-not-kept", step, command }`, a suggestion to call that command on
   its own, and nothing runs. An approval of the step's own binding that only expired is asked
   about again. The kept input is only where a step's input comes
   from: the step still needs an accepted question of its own binding, so a kept input that is
   not the one approved is asked about, never run. A replay of an approved retry is asked about
   the same kept input again. TypeScript's `requestState` is signed, not encrypted, so the client
   can read the kept input in full, where the question shows its first 1,000 characters; Python's
   is sealed. Rust's and C++'s validation computes nothing (a default is a constant of the
   schema), so the retry validates to the same input and nothing is kept: validating the input as
   sent validates the one that runs, and no retry fails to match for that reason; C++ runs each
   step on the validation made when it runs, which is that same input.
5. **Anything else is asked again**, saying why when the request carried approvals that did not
   hold: an expired, spent or mismatched approval, or one for a changed batch.

A declined, cancelled or unchecked answer to any gated step fails the whole call with
`APPROVAL_REQUIRED`, `details.reason: "declined"`, `retryable: false`, and nothing runs. A refusal
or decline is the call's whole result: a batch result with no item results and the error, or a
pipeline with one synthetic step at index -1, as for a refused confirmation. A request that cannot
elicit keeps the fallback above, step by step. A step's handler never sees the up-front approval,
so a command it runs falls back as a nested command does. The approval middleware removes it from
the step's context before the step runs, so a server has one approval middleware with the relay,
and a retry middleware placed before it retries a step as a single command, which is held again. Confirmations are checked first, so a
batch that needs both asks for each in turn.

An accepted approval that has expired or was already used is asked again, and the question says
so.

The result is an ordinary failed `CommandResult`, so it needs no wire fixture of its own.

<!-- generated:capabilities:spec.approvals.policy:start -->
|  | TypeScript | Python | Rust | C++ |
| --- | --- | --- | --- | --- |
| `approval` field and `_meta.approval` | Yes | Yes | Yes | Yes (`_meta.approval` from `command_to_mcp_tool`) |
| Approval middleware | Yes (`createApprovalMiddleware`) | Yes (`create_approval_middleware`) | Yes (`create_approval_middleware`) | Yes (`create_approval_middleware`) |
| Declared policy held without the middleware (`APPROVAL_UNAVAILABLE`) | Yes (`createMcpServer`, `createDirectRegistry`; the middleware's `commands` option is optional) | Yes (`create_server`, `create_direct_registry`; `create_approval_middleware`'s `commands` is optional; [#1886](https://github.com/lushly-dev/afd/issues/1886)) | Yes (`CommandRegistry::execute`, [#1886](https://github.com/lushly-dev/afd/issues/1886); the middleware's list is optional: `ApprovalMiddlewareOptions::from_secret`) | Yes (`CommandRegistry::execute`, so `DirectClient`, batches, pipelines and `afd::mcp_stdio` too; `ApprovalMiddlewareOptions::commands` is optional, [#1886](https://github.com/lushly-dev/afd/issues/1886)) |
| DirectClient approval hook and private exchange | Yes | Yes (`on_approval_needed`) | Yes (`with_on_approval_needed`) | Yes (`on_approval_needed`) |
| CLI approval flow (`afd call --module`, in-process only) | Yes | Yes (`--approve` or interactive prompt) | N/A: no CLI | N/A: no CLI |
| MCP relay (form elicitation) | Yes (`relay: 'mcp-elicitation'`) | Yes (`create_approval_middleware(relay="mcp-elicitation")`; one SDK-sealed, principal-bound `requestState` per call carries confirmation and approval answers; in band on 2025 stdio or stateful HTTP) | Yes (Umbel phase 5 step 0d: `ApprovalMiddlewareOptions::with_relay(ApprovalRelay::McpElicitation)`; one principal-bound `requestState` per call; in band on 2025 stdio) | Yes (`ApprovalMiddlewareOptions::relay = ApprovalRelay::mcp_elicitation` with `afd::mcp_stdio`; one principal-bound `requestState` per call; in band on 2025 stdio) |
| Up-front approval of `afd-batch` and `afd-pipe` (#459) | Yes | Yes (on 2026-07-28 and in band on a 2025 stdio or stateful HTTP connection) | Yes (on 2026-07-28 and in band on a 2025 stdio connection) | Yes (on 2026-07-28 and in band on a 2025 stdio connection; `afd::mcp_stdio` with `ApprovalRelay::mcp_elicitation`) |
| Relay evidence from a `HumanRelay` ([below](#relay-evidence)) | Yes ([#2263](https://github.com/lushly-dev/afd/issues/2263)): an off-object private `WeakMap` carrier the server sets after `Approved`, which `createApprovalMiddleware` checks in rule 3's order and spends once as `relay:<decisionId>` (24h TTL regardless of `replay`); cleared before the handler runs | Yes ([#2264](https://github.com/lushly-dev/afd/issues/2264)): an off-object private weakref carrier the server sets after `RelayApproved`, which `create_approval_middleware` checks in rule 3's order and spends once as `relay:<decision_id>` (24h TTL regardless of `replay`); cleared before the handler runs | Yes (step 0d): a crate-private `CommandContext` field the server sets after `Approved`, which `create_approval_middleware` checks in rule 3's order and spends once as `relay:<decisionId>`; removed before the handler runs | N/A: no `HumanRelay` |
<!-- generated:capabilities:spec.approvals.policy:end -->

## Relay evidence

When a `HumanRelay` decision ([Host-verified confirmation](./confirmations.md#host-verified-confirmation)) covers a
command with an approval policy, the same decision is its approval. Approval tokens play no part,
and a server that keeps them off on MCP (the default under rule 6) still issues none.

The server sets **relay evidence** on the call's context once `resume` returns `Approved`:

| Field | Value |
| --- | --- |
| `command` | The command's name |
| `inputDigest` | The digest the relay was given: unpadded base64url SHA-256 of the canonical JSON of the validated input |
| `actor` | The actor JSON approval tokens bind (`kind`, `id`, `onBehalfOf`), or `null` |
| `credentialsBinding` | The canonical JSON of `{ issuer, subject, clientId }` from the call's credentials, or `null` ([authorization, M8](./authorization.md#m8-the-principal-binding)) |
| `decisionId` | The relay's decision id |

Rules:
1. **Private.** Only the server sets it, after `resume` returned `Approved` for this call. It is
   never read from tool arguments, `_meta`, a header or a `requestState`, never serialized, and no
   public API sets it (Rust: a crate-private context field), as with the private in-process
   exchange (#460).
2. **The only evidence.** When relay evidence is present, the approval middleware considers it and
   nothing else.
3. **Bound to the call.** The middleware accepts it only when, checked in this order, its
   `command` equals the call's (else `command-mismatch`), its `inputDigest` equals the digest of the
   validated input the middleware holds (`input-mismatch`), its `actor` equals the call's actor JSON
   (`actor-mismatch`), and its `credentialsBinding` equals the call's (`credentials-mismatch`).
   With rule 4, a command the handler calls in process never runs on it.
4. **Once.** The middleware then consumes `relay:<decisionId>` in its nonce store, kept for 24
   hours, the longest a relay decision lives; a second use is `already-used`. Single use holds
   whatever the middleware's `replay` setting. The prefix keeps it apart from a key the relay
   itself spends for the same decision in a shared store.
5. **Refused evidence** fails the call with `APPROVAL_REQUIRED` and that `details.reason`, with no
   token unless the server includes tokens. Evidence on a command whose policy does not require
   approval is ignored.

## Approval evidence from an approver client

A server MAY name approvers: MCP clients it trusts to show a person a held action and to carry
the person's decision back. Loam's shell is one, for a mounted server's command only a person may
run (Loam's phase 5 specification, 7.2, D146). The
[proposal](../docs/features/active/approver-client/approver-client.proposal.md) gives the jobs and
the reasons.

1. **An approver is a caller the server marks,** by its own mapping of a verified credential
   (TypeScript `approver(context)` in `createMcpServer`'s options; Rust
   `McpServer::with_approver(|context| bool)`). The predicate sees the call's context once the
   server has set its credentials and the host its actor, and only `true` makes an approver. There
   are none by default. A predicate that throws or panics fails the call as an internal error. An
   approver is bound to the call's [principal binding](./authorization.md#m8-the-principal-binding);
   credentials that cannot be bound (an empty issuer, subject or client id) fail an approver's call
   as an internal error whose message names no one.
2. **For an approver only:**
   - an `APPROVAL_REQUIRED` result carries `details.approvalToken` on every MCP lane, whatever the
     middleware's `includeToken` option says, and the server never answers an approver's call with
     the [MCP elicitation relay](#asking-the-human-over-mcp)'s form, for one command or up front;
   - a `tools/call` whose `_meta["dev.afd/approval"]` holds a value has it set as the context's
     approval evidence before the middleware runs. The command the call routes to takes it, once:
     a command its handler runs in process never sees it. The first approval middleware the call
     reaches takes it, so a server with two takes the evidence in the outer one only, and the
     retry is held again (it fails closed).

   **From any other caller, the key is ignored,** silently, and no token is included
   (rule 6 of [Approvals](#approvals) holds).
3. **One command, modern era,** as [host-verified confirmation](./confirmations.md#host-verified-confirmation)'s
   step 1: an approver's `afd-batch`, `afd-pipe` or 2025-era request carrying the key fails with
   `APPROVAL_REQUIRED`, `retryable: false`, before anything runs, the suggestion saying to retry
   the approved command on its own from a 2026-07-28 client. Its own tool, a hybrid first-class
   tool, a grouped tool and `afd-call` carry it. A host-verified command takes only its relay's
   decision ([relay evidence](#relay-evidence), rule 2), so the key never stands for that.
4. **Bound to the approver's credential.** A token issued on an approver's call keeps the
   [format](#approvals), but its `a` is the keyed digest of `principal\0` and the call's principal
   binding (M8), instead of `actor\0` and the actor JSON. On an approver's call every token, from
   the key or from an `approval` the host set, is verified against that binding, and a mismatch is
   `credentials-mismatch`; on any other call `a` is checked as before, so an approver's token is
   `actor-mismatch` there. With the input digest, single use and the expiry, only the principal
   that received a token can redeem it, only for that input, once, before it expires. A verifier
   that does not know this rule refuses an approver's token, with `actor-mismatch`. **Without
   credentials the binding is the actor alone** (M8): two approvers the server tells apart only
   by an actor its hook maps can redeem each other's tokens if they share that actor, so over HTTP
   name only callers with verified credentials approvers. Over stdio the process boundary is the
   credential.
5. **The key is never input.** A `tools/call` whose arguments hold an object key
   `dev.afd/approval` at any depth (a meta-tool's `meta` argument included, and a member named
   `__proto__`, checked before a parser could turn it into a prototype) fails with
   `VALIDATION_ERROR` before anything else runs, from any caller, approvers included.
6. **What an approver promises,** which a server cannot check: it never gives the token to an agent
   or a model, nor puts it in a log, a store or a result; it presents a token only on a retry that
   a person approved after seeing the action, shown by the [display rules](#approval-display).
   A server that journals results outside the approval middleware records an approver's held
   result with its token: redact `details.approvalToken` there.

`details.reason` keeps its meaning: a non-approver's ignored key is no evidence, so its held
result has no `reason`. [`vectors/approver-client.json`](./vectors/approver-client.json) pins
rules 2 to 5 in its `carrier` section, each token's payload included.

<!-- generated:capabilities:spec.approvals.approver:start -->
|  | TypeScript | Python | Rust | C++ |
| --- | --- | --- | --- | --- |
| Approver carrier (rules 1 to 5) | Yes (`createMcpServer({ approver })`; `AFD_APPROVAL_META_KEY`) | Planned ([#1466](https://github.com/lushly-dev/afd/issues/1466)) | Yes (`McpServer::with_approver`; `AFD_APPROVAL_META_KEY`) | Planned ([#1466](https://github.com/lushly-dev/afd/issues/1466)) |
<!-- generated:capabilities:spec.approvals.approver:end -->

## The approval summary

A journal can show that a held call ran. Nothing in it says which approval admitted the call, and
a token binds the actor who asked, not the person who answered. The approval summary is the join
between the two: a value the approval step makes when it admits a call, which a host can record
beside the call and the asking surface can record beside the person.

When the approval step admits a call that a policy held (an approval token it accepted, an
accepted answer over the [MCP relay](#asking-the-human-over-mcp), [relay evidence](#relay-evidence),
or a DirectClient's [private exchange](#private-in-process-approval-exchange)), it builds the
summary and, before the next link runs, calls the middleware's `onApprovalAccepted` option
(`on_approval_accepted` in Python, Rust and C++) with the summary and the call's
[`dispatchId`](./dispatch.md#the-dispatch-id). A call no policy held gets no summary.

| Member | Value |
| --- | --- |
| `via` | `token`, `elicitation`, `relay` or `direct` |
| `command` | The command's name |
| `inputDigest` | The unpadded base64url SHA-256 of the canonical JSON (rule 3 of [Approvals](#approvals)) of the validated input, the digest a [`HumanRelay`](./confirmations.md#host-verified-confirmation) is given |
| `approvalId` | The unpadded base64url SHA-256 of the UTF-8 bytes of `approval`, a zero byte and the evidence's single-use key: the key the step spends in its nonce store when it enforces single use, and the same key when the server allows reuse and spends nothing. That is the token's nonce (its payload's `n`) for `token` and `direct`, the hold's nonce for `elicitation`, and `relay:<decisionId>` for `relay` |
| `issuedAt` | Epoch milliseconds, only when the evidence carries an issue time: a token's `iat`. The time an elicitation's question was asked is not one |
| `expiresAt` | Epoch milliseconds, only when the evidence carries an expiry: a token's `exp`, the elicitation hold's expiry. Relay evidence carries neither time |

Rules:

1. **It holds no credential and grants nothing.** The summary never carries a token, a nonce, a
   key, a decision id or a credential, and no engine code reads it back. `inputDigest` is an
   unkeyed digest of the whole input, so guesses at a short or predictable input can be checked
   against it: a host that stores the summary leaves the digest out, or redacts it, wherever it
   would redact the input itself (a command that declares `secret`).
2. **The hook fails closed.** The step waits for `onApprovalAccepted`. The hook refuses by its
   language's own failure signal: a throw or a rejection in TypeScript and Python, an `Err` in
   Rust, an error return in C++, which is built without exceptions. A refusal fails the call with
   `COMMAND_EXECUTION_ERROR` before the handler runs, with the message an uncaught middleware
   exception gets ([dispatch](./dispatch.md#middleware-approval-admission-and-exceptions), rule
   10), so a host that must record an approval before the action can rely on the handler not
   running without the record. The refusal is reported to `onError` as a thrown middleware error
   is, and `onCommand` is not called (dispatch, rule 12). Where single use is enforced the
   evidence is already spent: the token is `already-used` on a retry.
3. **`approvalId` names the approval, not the admission.** Where a server allows a token to be
   reused until it expires, every call it admits carries the same `approvalId`, and their
   `dispatchId`s tell them apart. Under such a server, a retry middleware outside the approval
   step can have one call admitted twice: the hook is then called twice with the same
   `approvalId` and the same `dispatchId`, and a host that needs one record per admission counts
   the calls.
4. **One per admitted step.** In an `afd-batch` or `afd-pipe` approved up front, each gated step
   gets its own summary and its own call to the hook as that step is admitted.
5. **The asking side can know the id.** A held call's request carries the `approvalId` its token
   will have: the request `onApprovalRequired` is given, and the request a DirectClient's
   `onApprovalNeeded` hook is given. An approver client that is handed a token derives the id from
   the payload's `n`, and a `HumanRelay` from its own decision id. An admission that comes as
   relay evidence carries the relay's id, not that of a token an earlier hold of the same call
   issued, so a host joins a relayed approval through its relay. Over the MCP relay the server
   asks through the calling client, so `onApprovalRequired` is not called and no host code holds
   the id when the question is put; `onApprovalAccepted` still runs when the answer admits the
   call. That client cannot portably obtain the id, since the nonce travels inside the
   `requestState`. There the summary joins the approval to the call and not to a person: the
   call's `actor`, when it has one, is who asked, and the server cannot tell a person's answer
   from client code that answers by itself.

[`vectors/approval-tokens.json`](./vectors/approval-tokens.json) gives the `approvalId` of each of
its bindings, and [`vectors/journal-seams.json`](./vectors/journal-seams.json) pins the rules
above in its `approvalSummary` section. TypeScript, Python, Rust and C++ build the summary; no
language is listed in that file's `gaps`.

<!-- generated:capabilities:spec.approvals.summary:start -->
|  | TypeScript | Python | Rust | C++ |
| --- | --- | --- | --- | --- |
| The dispatch id on the command context | Yes (`context.dispatchId`) | Yes (`context.dispatch_id`) | Yes (`CommandContext::dispatch_id`) | Yes (`CommandContext::dispatch_id`, `DispatchId`) |
| The approval summary and `onApprovalAccepted` | Yes (`onApprovalAccepted(summary, dispatchId)`, `ApprovalSummary`) | Yes (`create_approval_middleware(on_approval_accepted=...)`, `ApprovalSummary`, `ApprovalRequest.approval_id`, `DirectApprovalRequest.approval_id`, `approval_id`) | Yes (`ApprovalMiddlewareOptions::with_on_approval_accepted`, `ApprovalSummary`, `ApprovalRequest::approval_id`, `DirectApprovalRequest::approval_id`, `approval_id`) | Yes (`ApprovalMiddlewareOptions::on_approval_accepted`, `ApprovalSummary`, `ApprovalRequest::approval_id`, `DirectApprovalRequest::approval_id`, `approval_id`) |
<!-- generated:capabilities:spec.approvals.summary:end -->

## Approval display

What a person must be able to read in full before approving an action (D150, from Lushly's
`approval-display.ts`). An approver, or any surface that shows a person a held call, measures the
call's validated input and shows it only when every rule below holds. Otherwise it shows none of
it, says which rule failed, and offers no approval: a person cannot approve what they cannot see.
Truncating is not showing.

| Check, in this order | Limit | Refusal |
| --- | --- | --- |
| The input is plain JSON: approvals' canonical JSON accepts it (rule 3) | | `not-json` |
| Its canonical JSON, in UTF-16 code units | 8000 | `too-long` |
| Then depth first, through object keys in canonical order, for each value: | | |
| &nbsp;&nbsp;values visited so far, the input itself included | 400 | `too-many-values` |
| &nbsp;&nbsp;its depth: the input is 0, its members and items 1 | 6 | `too-deep` |
| &nbsp;&nbsp;a string, in UTF-16 code units | 2000 | `string-too-long` |
| &nbsp;&nbsp;a string that hides characters (below) | | `hidden-characters` |
| &nbsp;&nbsp;for an object, each key in UTF-16 code units, before its value | 200 | `key-too-long` |
| &nbsp;&nbsp;a key that hides characters, before its value | | `hidden-characters` |

The first failure is the refusal. An absent input (TypeScript `undefined`) is `{}`.

Text **hides characters** when it holds a hidden code point, or a run of six or more combining
marks (Unicode general category M, by the language's own Unicode tables, so a mark newer than
one language's tables may be judged differently), which draw over the lines around them. The hidden code points
are U+0000 to U+001F but tab (U+0009) and line feed (U+000A); U+007F to U+009F; U+00AD; U+034F;
U+061C; U+115F; U+1160; U+17B4; U+17B5; U+180B to U+180F; U+200B to U+200F; U+2028; U+2029;
U+202A to U+202E; U+2060 to U+206F; U+2800; U+3164; U+D800 to U+DFFF (an unpaired surrogate);
U+FE00 to U+FE0D; U+FEFF; U+FFA0; U+FFF0 to U+FFFB; U+1BCA0 to U+1BCA3; U+1D173 to U+1D17A; and
U+E0000 to U+E0FFF.

[`vectors/approver-client.json`](./vectors/approver-client.json)'s `display` section pins every
rule and range.

<!-- generated:capabilities:spec.approvals.display:start -->
|  | TypeScript | Python | Rust | C++ |
| --- | --- | --- | --- | --- |
| Display rules | Yes (`@lushly-dev/afd-core`: `approvalDisplay`, `hidesCharacters`, `isHiddenCodePoint`, `APPROVAL_DISPLAY_LIMITS`) | Planned ([#1466](https://github.com/lushly-dev/afd/issues/1466)) | Yes (`approval_display`, `hides_characters`, `is_hidden_code_point`, `APPROVAL_DISPLAY_LIMITS`) | Planned ([#1466](https://github.com/lushly-dev/afd/issues/1466)) |
<!-- generated:capabilities:spec.approvals.display:end -->
