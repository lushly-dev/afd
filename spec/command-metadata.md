# Command metadata

The canonical fields of a command definition, their types and defaults, and where each one surfaces.
Every AFD implementation carries these fields. Which ones each language has today is tracked in the
[language parity matrix](../docs/language-parity.md#command-definition).

Names below are the wire (JSON) spelling. Code may use the language's own casing, such as
`confirm_prompt` in Python, Rust and C++, and C++ calls `requires` `prerequisites`. Anything
serialized uses the names below. Python and Rust spell the three trust fields `destructive`,
`confirm_prompt` and `undoable`, and hold `destructive` and `undoable` as optional booleans so that
an unset field stays distinguishable from an explicit `false`.

## Fields

| Field | Type | Default | Where it surfaces |
| --- | --- | --- | --- |
| `name` | string, `domain-action` kebab-case | Required | Every surface |
| `description` | string | Required | Every surface; afd-discover shortens it to its first sentence, at most 120 characters |
| `title` | string, a short human-readable label | None; nothing is derived from the name | The MCP tool `title` of the command's own tool, afd-detail, afd-help (full), `DirectRegistry.listCommands()`. Display text, so never in `_meta` ([Tool titles](#tool-titles)) |
| `category` | string | None; grouping falls back to the name's first segment | `_meta`, afd-detail, afd-discover, afd-help (full), afd-docs headings, grouped tool names, `afd tools` groups |
| Input schema | JSON Schema object (TypeScript: Zod `input`, or core `parameters`) | Required | Tool `inputSchema`, afd-detail, afd-schema, afd-docs parameter table. A command MAY add an advertised schema, shown on those surfaces while the registry validates with this one ([V1](./mcp-resources.md#v1-two-schemas-one-command)) |
| Output schema (`returns`) | JSON Schema of `CommandResult.data` | None | `_meta.outputSchema`, afd-detail `outputSchema` |
| `errors` | string[] of error codes | None | afd-detail |
| `version` | string | None | afd-detail; results carry it as `metadata.commandVersion` |
| `tags` | string[] | None | afd-detail, afd-help (full), afd-docs; afd-discover filters on it |
| `requires` | string[] of command names | None | `_meta`, afd-detail, afd-help (brief and full). Metadata only: not enforced at runtime. On an authorized server, only the commands that exist for the caller ([hidden commands](./authorization.md#hidden-commands)) |
| `mutation` | boolean | `false` | `_meta`, afd-detail, afd-discover (`includeMutation`), afd-help (full), afd-docs |
| `destructive` | boolean | `false` | `_meta`, afd-detail, afd-help (full), afd-docs, `DirectRegistry.listCommands()`, `afd tools`. `afd validate --execute` never calls it |
| `secret` | boolean | `false` | Not reported. The command takes or returns a secret (a password argument, an issued token): a journal never records a call to it unless the recorder also has `redact`, which removes the secret; a `filter` alone never admits it ([journal](./journal.md#entry)) |
| `confirmPrompt` | string | None; a frontend MAY show a generic prompt | afd-detail, afd-docs |
| `undoable` | boolean | `false` | `_meta`, afd-detail, afd-help (full), afd-docs, `DirectRegistry.listCommands()`, `afd tools` |
| `approval` | `required`, `not-required`, or a function of the validated input and context returning one of them | `not-required` | `_meta`, afd-detail, afd-docs, as `required`, `not-required` or `conditional` (a function). `afd validate` warns when a `mutation` or `destructive` command declares none. The approval middleware decides it; without an approval step that admits the call, a server engine refuses a command whose policy is not `not-required` with `APPROVAL_UNAVAILABLE`. See [Approvals](#approvals) |
| `executionTime` | `instant`, `fast`, `slow` or `long-running` | None | afd-detail |
| `handoff` | boolean | `false` | afd-detail; adds the `handoff` tag |
| `handoffProtocol` | `websocket`, `webrtc`, `sse`, `http-stream` or another string | None | afd-detail; adds the `handoff:<protocol>` tag |
| `expose` | `palette`, `agent`, `mcp`, `cli`, `apps` booleans | `palette` and `agent` true, `mcp`, `cli` and `apps` false, per flag | Not reported. It decides which surfaces list and run the command; afd-detail reports the result as `callable`. `apps` lets another app call the command under a host's grant ([App-to-app calls](#app-to-app-calls)) |
| `examples` | `{ title, input }[]` | None | `_meta`, afd-detail, afd-help (full). Each `input` must pass the input schema when the command is defined |
| `contexts` | string[] | None: the command is visible in every context | `_meta`, afd-detail. Calls, afd-discover, afd-detail, the context tools and the individual and grouped tools/list scope on it; the hybrid tools/list does not ([H4](./tool-strategies.md#h4-contexts-a-fixed-list-scoped-calls)) |
| `toolMeta` | object: `_meta` key to JSON value | None | Merged into the command tool's `_meta`, a grouped action entry and afd-detail (`toolMeta`). Keys follow the [key rule](./mcp-resources.md#t2-the-key-rule): reverse-DNS prefixed keys outside `dev.afd/`, or the MCP Apps key `ui`; anything else is refused at registration ([T1](./mcp-resources.md#t1-extra-entries-on-a-commands-tool)) |
| `scopes` | string[] of OAuth scope names | None: the command needs no scope of its own | `_meta`, afd-detail. Enforced only on authorized HTTP: the scopes a caller's token needs, beside the server's `requiredScopes`. A host `ScopeResolver` may decide each call instead ([Scopes](#scopes)) |
| `confirmationMode` | `host-verified` | None: the server's `confirmations` option applies | `_meta`, afd-detail. Only the host's `HumanRelay` may confirm the command over MCP ([Host-verified confirmation](#host-verified-confirmation)) |
| `task` | `never`, `optional` or `required` | `never` | `_meta`, afd-detail. Whether an MCP call may run as a task ([Tasks](#tasks)). Refused at registration beside `confirmPrompt`, an `approval` other than `not-required`, or `confirmationMode` |
| `outputBudget` | `{ defaultBytes, maxBytes }`, positive integers, `defaultBytes ≤ maxBytes` | None: the result is not checked | `_meta["dev.afd/outputBudget"]`, afd-detail (`outputBudget`). Callers ask per call in `_meta["dev.afd/outputBudget"]`; an over-budget read becomes `OUTPUT_BUDGET_EXCEEDED`, a mutation keeps its result with a warning ([output budgets](./output-budgets.md)) |

`destructive`, `confirmPrompt` and `undoable` are declarations for frontends and agents. AFD does
not act on `destructive` or `undoable`: an undo mechanism belongs to the consumer. A server MAY
enforce `confirmPrompt` on its MCP surfaces, as [Confirmations](#confirmations) describes; it does
not by default. `approval` is the pre-execution gate: a call it requires is held before the handler
runs, and a server with no approval step refuses it, as [Approvals](#approvals) describes.

## Reporting rules

- **Unset is omitted.** A surface reports a field only when the command sets it, never as `null`.
  Consumers read an absent boolean as its default. An explicit `false` is reported as `false`.
- **Two exceptions:** afd-detail always reports `mutation`, and afd-discover reports it when
  `includeMutation` is set. Both use `false` when it is unset.
- **Empty command-metadata arrays are omitted:** from `_meta` (`requires`, `examples`, `contexts`,
  `scopes`), from afd-detail (those, `tags` and `errors`) and from afd-help (`requires`, and in its
  `full` format `tags` and `examples`).
- **`_meta` carries planning signals, not display text.** It has `destructive` and `undoable` but
  not `confirmPrompt`, which is for a frontend's confirmation dialog. Agents get it from afd-detail.
- **Grouped tools** (`toolStrategy: 'grouped'`) carry the per-command `_meta` fields on each entry
  of `_meta.actions`, not on the tool.
- **Extra entries** (`toolMeta`) sit beside the fields above on the same tool or action entry. The
  key rule keeps them from replacing any of them ([T2](./mcp-resources.md#t2-the-key-rule)).
- **First-class tools** (`toolStrategy: 'hybrid'`) are command tools: each carries `_meta`,
  `annotations` and `outputSchema` exactly as the individual strategy's tool for that command
  ([tool strategies, H3](./tool-strategies.md#h3-the-tool-list-and-its-order)).

## Surfaces

| Surface | Fields |
| --- | --- |
| tools/list `_meta` | `category`, `requires`, `mutation`, `destructive`, `undoable`, `approval`, `examples`, `outputSchema`, `contexts`, `scopes`, `confirmationMode`, `task`, `dev.afd/outputBudget` ([B1](./output-budgets.md#b1-the-declaration)), and the command's `toolMeta` entries |
| tools/list `title` | `title`, on a command's own tool (individual, and first-class under hybrid); the meta-tools carry fixed titles |
| afd-detail | `name`, `title`, `description`, `category`, `tags`, `mutation`, `executionTime`, `errors`, `inputSchema` (the advertised schema), `outputSchema`, `destructive`, `confirmPrompt`, `undoable`, `approval`, `handoff`, `handoffProtocol`, `version`, `callable`, `requires`, `examples`, `contexts`, `toolMeta`, `outputBudget`, `scopes`, `confirmationMode`, `task` |
| afd-discover | `name`, `description`, `category`, and `mutation` with `includeMutation` |
| afd-help | `name`, `description`, `requires`; the `full` format adds `title`, `category`, `tags`, `mutation`, `destructive`, `undoable`, `examples`. On a hybrid server, `firstClass: true` for a first-class command, in both formats; next to `commands`, the server's `toolStrategy` and, on a hybrid server, `firstClassTools` ([H8](./tool-strategies.md#h8-what-afd-help-serverdiscover-and-afd-detail-report)) |
| afd-docs | `category`, `name`, `description`, `tags`, `mutation`, `destructive`, `confirmPrompt`, `undoable`, `approval`, parameters |
| afd-schema | `name`, `description`, `inputSchema` |

## Confirmations

A server MAY enforce `confirmPrompt` with the option `confirmations`: `off` (the default), `enforce`
or `require-human`. Enforcement applies to the MCP surfaces (individual tools, the hybrid
strategy's first-class tools, the meta-tools and grouped tools) and to the HTTP `/stream` and REST routes. DirectClient and in-process registries
never enforce it: the host owns in-process calls.

When enforcement is on, a call to a command with `confirmPrompt` runs only with a confirmation:

1. **An accepted elicitation.** If the request declares the form elicitation capability, the server
   answers `input_required` with one form elicitation: `confirmPrompt` as the message and one
   boolean property. Its `requestState` is integrity-protected and binds the command name, a digest
   of the validated input, the call's principal binding (below) and an expiry. When the retry carries an
   accepted response and a `requestState` that verifies and still matches the input, the command
   runs.
2. **An acknowledgement** (`enforce` only). The call sets `confirm: true` in the tool arguments, or
   `_meta["dev.afd/confirm"]: true`. An agent can send an acknowledgement without asking anyone, so
   it is a deliberate second call, not human consent. `require-human` accepts elicitations only.

Otherwise the call fails before the handler runs:

| Situation | Code | Suggestion |
| --- | --- | --- |
| The user declined or cancelled the elicitation | `CONFIRMATION_DECLINED` | Do not retry without asking the user |
| No elicitation was possible, under `enforce` | `CONFIRMATION_REQUIRED` | Repeat the call with `confirm: true` once the action is intended |
| No elicitation was possible, under `require-human` | `CONFIRMATION_REQUIRED` | Use a client that supports elicitation |

Where the acknowledgement goes:

- **Individual and first-class tools.** A command with `confirmPrompt` advertises an optional boolean `confirm`
  property in its tool `inputSchema`. The server removes it before validating the input, so the
  command's own schema never sees it.
- **`afd-call`.** An optional `confirm` boolean next to `command` and `input`.
- **`afd-batch` and `afd-pipe`.** An optional `confirm` array of the command names being
  confirmed. A batch or pipeline with any confirm-gated command asks once, before any step runs,
  and its elicitation message lists every gated command.
- **Grouped tools.** An optional `confirm` boolean next to `action` and `params`.
- **HTTP routes** (`/rpc`, `/batch`, `/stream`). The header `Afd-Confirm` with the confirmed
  command names, comma-separated.

A command whose own input schema declares a `confirm` property keeps it: the server leaves the
input intact and reads `confirm: true` in it as the acknowledgement.

`requestState` is opaque to clients and is never trusted unverified. A stale, altered or mismatched
`requestState` is never accepted as a confirmation: TypeScript, Rust and C++ ask again, and Python, whose
MCP SDK seals and checks the state before the handler runs, rejects the request with JSON-RPC
`-32602`.

**The principal binding ([#532](https://github.com/lushly-dev/afd/issues/532)).** The state binds
the actor and, when the call has [credentials](./authorization.md#m4-credentials), their `issuer`,
`subject` and `clientId`: the [principal binding](./authorization.md#m8-the-principal-binding),
sealed inside the state or as its associated data. A retry whose principal binding differs from the
one the state was issued to (another actor, or another issuer, subject or client) is refused exactly
as a tampered state is, in the same language. So a confirmation one caller answered cannot let
another caller skip the question, even a different client of the same person. Without credentials
the binding is the actor alone, which still separates the actors a context hook admits. Credentials
missing an issuer, subject or client id are never bound: such a call gets no state, and its retry
is refused with an internal error (M8).

A 2025-era request elicits only where its connection can carry a server-sent request (stdio, or
stateful HTTP). Over stateless HTTP it gets the acknowledgement path.

### Host-verified confirmation

A command sets `confirmationMode: "host-verified"` when only the host can prove that a person
decided, for example by a fresh login at the person's identity provider on a page the host serves
(Umbel's person page). A form answer and an acknowledgement prove nothing of the kind: client code
can produce either. For such a command, on every MCP surface and **whatever the server's
`confirmations` option says, `off` included**:

- The server never sends a form elicitation for it, never advertises or accepts an acknowledgement
  for it (`confirm: true`, a `confirm` list, `_meta["dev.afd/confirm"]`, `Afd-Confirm`), and never
  accepts a form answer for it. The form-mode approval relay ([Asking the human over MCP](#asking-the-human-over-mcp))
  never asks for it either.
- It is gated whether or not it declares `confirmPrompt`.
- Only the server's `HumanRelay`, which the host installs, can confirm it. Without one, the call
  fails with `CONFIRMATION_REQUIRED`, whose suggestion says the server cannot confirm this command
  over MCP. DirectClient and in-process registries are unchanged: the host owns in-process calls.

```text
HumanRelay
    begin(call) -> RelayPrompt { url, message, state } | CommandError
    resume(state, call) -> Approved { decisionId } | Declined | Pending(RelayPrompt) | Invalid
RelayCall { command, inputDigest, actor, credentials?, clientCapabilities, input, context }
    approvedContext(decisionId, call) -> extra fields   (optional; default none)
```

A relay is given the validated `input` its `inputDigest` names, so it can keep what its person must be
shown, and the call's `context` after the context hook, so it can read who the caller is by its own
mapping. After an `Approved`, the server sets the fields the relay's `approvedContext` returns in the
call's `extra` before anything runs (Umbel records the decision and `humanPresent` there). They are not
evidence: the server and the approval middleware never read them, and unlike relay evidence they stay on
the context of a command the handler runs in process, so a host reading them checks that they name the
command and input before it. Rust (`RelayCall::input`, `RelayCall::context`,
`HumanRelay::approved_context`), TypeScript (`RelayCall.input`, `RelayCall.context`,
`HumanRelay.approvedContext`, [#2263](https://github.com/lushly-dev/afd/issues/2263)) and Python
(`RelayCall.input`, `RelayCall.context`, `HumanRelay.approved_context`,
[#2264](https://github.com/lushly-dev/afd/issues/2264)) implement this.

A call goes through these steps:

1. **One command, modern era.** Only a call that routes to the one command can be relayed: its own
   tool, a hybrid first-class tool, a grouped tool or `afd-call`, on an MCP 2026-07-28 request. A
   step of `afd-batch` or `afd-pipe`, a 2025-era request and the HTTP routes (`/rpc`, `/batch`,
   `/stream`) fail with `CONFIRMATION_REQUIRED` before any step runs, the suggestion saying to call
   the command on its own from a 2026-07-28 client.
2. **Validation first.** The server validates the input against the command's schema, as the
   registry will, before asking anyone. Invalid input fails with `VALIDATION_ERROR`. `inputDigest`
   is the unpadded base64url SHA-256 of the canonical JSON ([Approvals](#approvals), rule 3) of the
   validated input, so the person decides on exactly what will run.
3. **Begin.** On a call that carries no relay answer, the server calls `begin`. A `CommandError` is
   the call's result: a relay may refuse, for example for a client without URL-mode elicitation.
   Otherwise the server answers `input_required` with one URL-mode elicitation under the input key
   `relay`: `mode: "url"`, the relay's `message` and `url`, and an `elicitationId` that is the
   unpadded base64url SHA-256 of the URL, so a pending decision keeps one id. The `requestState` is
   the relay's `state`. The server never sends this to a request whose client capabilities do not
   declare URL-mode elicitation: if `begin` returns a prompt for one, the call fails with
   `CONFIRMATION_REQUIRED`.
4. **The retry.** A retry carrying `inputResponses.relay` and a `requestState`:
   - `decline` or `cancel` fails with `CONFIRMATION_DECLINED`, without asking the relay.
   - `accept` means only that the user agreed to open the link (MCP: URL mode is out of band, and
     the server "MUST NOT rely on" it to authorize users for themselves). It is never an answer by
     itself. The server calls `resume` with the state and this call:
     - `Approved`: the command runs. If it has an approval policy, the server sets
       [relay evidence](#relay-evidence) first, so one decision covers both gates.
     - `Declined`: `CONFIRMATION_DECLINED`, not retryable.
     - `Pending(prompt)`: `input_required` again with that prompt, as in step 3.
     - `Invalid`: the state is not an answer, so the server begins again (step 3), as it asks again
       for a tampered confirmation state.

What a relay guarantees:
- **Its `state`** is integrity-protected, expires within 24 hours, and binds the decision, the
  command, `inputDigest` and the call's principal binding (#532). `resume` returns `Invalid` for a
  state that does not verify, has expired, or was issued to another command, input or principal.
- **`Approved`** is returned at most once per decision, and only for a decision the person made
  after `begin`.
- **The URL** is an absolute `https` URL that holds no identity and is not pre-authenticated; the
  host verifies who opens it and that it is the person the call is for (MCP 2026-07-28,
  elicitation, URL mode).

## Approvals

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

### Private in-process approval exchange

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

### Asking the human over MCP

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

#### One approval up front for `afd-batch` and `afd-pipe`

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
   was shown (#1414). The step is still validated as sent when it runs, and a step that no longer
   validates (its schema checks state an earlier step changed) fails with `VALIDATION_ERROR`, as
   it does on its own; a step of a command without an approval policy runs on its own validation
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
   result differs from what was approved. The kept input is only where a step's input comes
   from: the step still needs an accepted question of its own binding, so a kept input that is
   not the one approved is asked about, never run. A replay of an approved retry is asked about
   the same kept input again. TypeScript's `requestState` is signed, not encrypted, so the client
   can read the kept input in full, where the question shows its first 1,000 characters; Python's
   is sealed. Rust's and C++'s validation computes nothing (a default is a constant of the
   schema), so the retry validates to the same input and nothing is kept; C++ runs each step on
   the validation made when it runs, which is that same input.
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

<!-- generated:capabilities:spec.command-metadata.approvals:start -->
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
<!-- generated:capabilities:spec.command-metadata.approvals:end -->

### Relay evidence

When a `HumanRelay` decision ([Host-verified confirmation](#host-verified-confirmation)) covers a
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

### Approval evidence from an approver client

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
3. **One command, modern era,** as [host-verified confirmation](#host-verified-confirmation)'s
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

<!-- generated:capabilities:spec.command-metadata.approver:start -->
|  | TypeScript | Python | Rust | C++ |
| --- | --- | --- | --- | --- |
| Approver carrier (rules 1 to 5) | Yes (`createMcpServer({ approver })`; `AFD_APPROVAL_META_KEY`) | Planned ([#1466](https://github.com/lushly-dev/afd/issues/1466)) | Yes (`McpServer::with_approver`; `AFD_APPROVAL_META_KEY`) | Planned ([#1466](https://github.com/lushly-dev/afd/issues/1466)) |
<!-- generated:capabilities:spec.command-metadata.approver:end -->

### Approval display

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

<!-- generated:capabilities:spec.command-metadata.approval-display:start -->
|  | TypeScript | Python | Rust | C++ |
| --- | --- | --- | --- | --- |
| Display rules | Yes (`@lushly-dev/afd-core`: `approvalDisplay`, `hidesCharacters`, `isHiddenCodePoint`, `APPROVAL_DISPLAY_LIMITS`) | Planned ([#1466](https://github.com/lushly-dev/afd/issues/1466)) | Yes (`approval_display`, `hides_characters`, `is_hidden_code_point`, `APPROVAL_DISPLAY_LIMITS`) | Planned ([#1466](https://github.com/lushly-dev/afd/issues/1466)) |
<!-- generated:capabilities:spec.command-metadata.approval-display:end -->

## Tasks

A command's `task` says whether an MCP `tools/call` to it may run as a task under the Tasks
extension (`io.modelcontextprotocol/tasks`,
[SEP-2663](https://modelcontextprotocol.io/seps/2663-tasks-extension), revision 2026-07-28):

| `task` | A request that declares the extension in its client capabilities | One that does not |
| --- | --- | --- |
| `never` (default) | Inline | Inline |
| `optional` | A task | Inline |
| `required` | A task | JSON-RPC `-32021` (missing required client capability), naming the extension |

**What may be a task.** Registration refuses `optional` and `required` on a command that declares
`confirmPrompt`, an `approval` other than `not-required`, or `confirmationMode`: a task never asks
a person, so no AFD task is ever `input_required`. Only a `tools/call` that routes to one command
(its own tool, a hybrid first-class tool, a grouped tool or `afd-call`) can become a task.
`afd-batch` and `afd-pipe` never do: an `optional` step runs inline, and a step naming a `required`
command fails the whole request with `INVALID_BATCH_REQUEST` or `INVALID_PIPELINE_REQUEST` before
any step runs. The HTTP routes, `DirectClient`, in-process registries and the CLI always run
inline. The server never answers with a task to a request that did not declare the extension.
A request declares it in its own `_meta` client capabilities on MCP 2026-07-28; a 2025 request
never does, whatever its session declared at `initialize` (the extension is not defined for
2025-11-25), so it is treated as not declaring it, `tasks/*` included (`-32021`).

**Only for callers the server can tell apart.** A task's owner protects it only if the server can
tell its callers apart, so a server creates no task otherwise:
- without an HTTP request (stdio, or another transport with one client per connection), callers
  are told apart by their connection, and tasks work as this section says;
- over HTTP, the call must carry verified credentials ([authorization](./authorization.md)), or
  the host must declare that its per-request hook identifies every caller (Rust:
  `TaskOptions::with_callers_identified_by_hook`, which counts only while a hook is installed).
  The declaration is a promise that every distinct caller maps to a distinct actor.

A server that cannot tell its HTTP callers apart behaves as a server without the extension: it
does not declare it, `tasks/get`, `tasks/update` and `tasks/cancel` answer `-32601`, and an
`optional` command runs inline. A `required` command, which cannot run inline, fails before
anything runs with `UNAUTHORIZED` (`retryable: false`), whose suggestion says to configure
authorization or the hook declaration, whether or not the request declared the extension. This is
decided per request, from the configuration and the request: a `required` command is never
refused at registration, since authorization may be configured later.

**Creating one.** Everything an inline call meets before dispatch happens first: the HTTP layer's
403 ([authorization, M6](./authorization.md#m6-scopes)), the context hook and the scope check.
Then:
- the task id holds at least 128 bits from a cryptographic random source, so it cannot be guessed;
- the record is in the `TaskStore` before the server answers with `CreateTaskResult`; a store that
  cannot record it fails the call, and nothing runs;
- the record's **owner** is the call's [principal binding](./authorization.md#m8-the-principal-binding),
  and it holds no token. Credentials that cannot be bound (M8) get no task: the call fails with
  an internal error that names no one, and nothing runs.

**Running one.** The command runs through the normal executor (validation, middleware, handler)
with a fresh context carrying the call's actor, credentials and trace. A task's **run budget**
(`maxRunMs`, default one hour) is separate from how long its finished result is kept
(**post-completion retention**, `ttlMs` on `TaskOptions`, default one hour):
- **Initial and finished `ttlMs`.** On `CreateTaskResult` and while `working`, the wire `ttlMs`
  (counted from `createdAt`, per SEP-2663) is `maxRunMs + retention` (two hours by default), capped
  by any host token-expiry grace and the JSON safe-integer ceiling (`2^53 - 1`). Once the task
  reaches a terminal status (`completed`, `failed` or `cancelled`) at `finishedAt`, its stored and
  reported `ttlMs` is tightened atomically to `min(maxRunMs, max(0, finishedAt - createdAt)) +
  retention` (still capped by any token-expiry grace and never wider than the initial `ttlMs`), so
  a task that finishes near its run budget stays readable for the full retention period after
  finishing and expires once `finishedAt + retention` passes without ever widening past its
  advertised TTL.
- **Cancellation and deadlines.** The task's cancellation signal fires on `tasks/cancel`, when its
  run budget (`createdAt + maxRunMs`) ends, when its `ttlMs` ends, and at `credentials.expiresAt`,
  and the server then stops the handler. If the run budget ends while the task is still working
  (before token expiry and before `ttlMs`), it completes with the failure `TIMEOUT` (retryable
  unless the command is a `mutation` whose handler started, whose suggestion then says to check its
  effect), kept for the retention period; a handler that had already returned before the run budget
  stopped it keeps its result as long as the token and `ttlMs` still hold. When its `ttlMs` ends
  the task is gone.
- **Its result** is the `CallToolResult` an inline call would return, `structuredContent` included,
  with status `completed`; a failed `CommandResult` is `completed` with `isError: true`, as the
  extension says. `failed` is only for a JSON-RPC error. A task stopped by `tasks/cancel` is
  `cancelled`; a handler that had already returned when the cancel arrived keeps its result.
- **The token bounds it.** A task never outlives the token that started it: when
  `credentials.expiresAt` passes while it is working, it is stopped and completes with the failure
  `TASK_TOKEN_EXPIRED` ([error codes](./error-codes.md#tasks)): start it again with a new token.
  A task whose token expired before it could start completes the same way without running, and
  a result that arrives after `expiresAt` is not delivered. The failure is retryable unless the
  command is a `mutation` whose handler started, since it may have made its change. A host may
  also end the task's `ttlMs` there, or a grace after it.
- **Progress** updates `statusMessage` and `lastUpdatedAt`; no progress or log notification is sent
  for a task (the extension delivers none).

**`tasks/get`, `tasks/update` and `tasks/cancel`.** Each request passes the same authorization as a
`tools/call` ([M6, other methods](./authorization.md#other-methods)), and then the **owner check**:
the store returns a task only when the caller's principal binding equals its owner. A task owned by
anyone else, an expired task and an unknown id get the same answer, the extension's answer for an
unknown task (`-32602`), so an id reveals nothing. The server checks the owner and the TTL again
itself, whatever the store returned. On an authorized server the owner must also still hold what a
call of the task's command needs, as far as it is known without the input, to read or update it: the
command's `scopes`, or under a resolver its `visible` and `known` (else the request is refused with
`INSUFFICIENT_SCOPE`, as a request that names no command is for its required scopes). `tasks/cancel`
does not ask that, since stopping a task only takes authority away. A task whose command no longer
exists for its owner ([hidden commands](./authorization.md#hidden-commands)) gets the unknown-task
answer on all three. `tasks/update` finds no task
waiting for input, and answers as the extension says for that. `tasks/cancel` requests cooperative
cancellation; a finished task is unchanged. `Mcp-Name` carries the task id on Streamable HTTP.

**The store.**

```text
TaskStore
    create(record)                      // durable before it returns
    get(id, owner) -> record | none     // none when the owner differs
    update(id, owner, change)
    expire(now) -> count                // removes tasks past their ttl
```

The default store is in memory and serves one process, and it is bounded so that one principal
cannot exhaust it: a store may refuse a new task when its owner, or the store, holds as many as it
allows, and the call then fails with `RATE_LIMITED` (retryable) and nothing runs. It may drop a
finished task before its `ttlMs` ends to make room, so finished results cannot keep other callers
out. A server also bounds how many tasks one process runs at once, whatever its store allows. A host
with several processes behind one URL supplies a shared store; a `tasks/cancel` answered by another
process reaches the task through the store.

## Scopes

`scopes` names the OAuth scopes a caller's token needs to run the command over HTTP on a server
configured with [authorization](./authorization.md). A call needs the server's `requiredScopes`
and then the command's `scopes`, compared exactly. A host `ScopeResolver`, when installed, decides
every call instead, from the command, its input and the credentials, and may answer `Defer` to let
the registry answer. A missing scope is an HTTP 403 before dispatch wherever HTTP can carry it, and
`INSUFFICIENT_SCOPE` otherwise, never a handler call ([M6](./authorization.md#m6-scopes)). stdio,
the CLI, `DirectClient` and in-process registries ignore `scopes`.

## App-to-app calls

A host that runs several apps, such as Loam, lets one app call another's command only when both
sides agree: the callee's command sets `expose.apps`, and the host has given the caller a grant
naming it ([proposal](../docs/features/active/apps-exposure/apps-exposure.proposal.md)).

- **The flag.** `expose.apps` is the callee's declaration that another app may call the command.
  It defaults to `false`, no other flag implies it, and a host or manifest profile MUST NOT default
  it to `true`.
- **The interface.** `apps` is an interface a call can name, beside `palette`, `agent`, `mcp` and
  `cli`. Only a host's trusted code names it, for a call it received from an app it has identified.
  Who called is the host's to record, in a [declared context field](./context-fields.md) such as
  Loam's `caller`; AFD reserves no context name for it.
- **The grant.** The registry takes a host predicate, `callGrant(command, context)`, that answers
  whether the caller in `context` holds a grant naming `command`. AFD does not define a grant's
  shape. The predicate is synchronous and reads only what trusted code put on the context. It runs
  before the declared context fields are validated, so it checks the type of what it reads. A
  registry without one refuses every app call. A request's own values never reach it: an app's
  batch carries no context the predicate reads (Rust drops a batch request's `context` for an
  `apps` call).

A call whose interface is `apps` runs only when the command exists for the caller, sets
`expose.apps`, and `callGrant` returns `true`; a value other than `true`, a throw or a panic is a
refusal. Otherwise the call returns this failure, the same bytes in every case:

```json
{
  "code": "CALL_NOT_GRANTED",
  "message": "This app may not call that command",
  "suggestion": "Ask the deployer for a calls grant that names the command; the command must also set expose.apps",
  "retryable": false
}
```

The check comes first: before lookup and its suggestions, the active context, input validation,
declared context fields, middleware and the handler. So a command that does not exist, one not
exposed to apps, one the caller is not granted, and any of these called with invalid input all
answer alike, so the caller learns nothing about commands it may not call. This
is the `apps` interface's form of [D4](./error-codes.md#unknown-and-unexposed-commands-d4): an app
is an untrusted caller. A granted call then runs as any other, with `apps` as its interface. A batch
or pipeline checks each command it runs; a refused one fails as that item or step.

Listings by exposure (TypeScript `listByExposure('apps')`, `createAppCallRegistry`'s
`listCommands`) hold the commands exposed to apps, whatever any caller is granted. A host never
shows an app another app's commands from them; it builds a list from its grants.

TypeScript's in-process registry for app calls is `createAppCallRegistry(commands, { callGrant,
...options })`, `createDirectRegistry`'s options less `interface` and `tools`. It throws without
`callGrant`, serves no tool surface (an app calls commands one by one), and answers `hasCommand`
with `true` for every name. Whatever cannot run the check refuses the `apps` interface rather
than answer an app: `createDirectRegistry` throws for it; `DirectClient` and `DirectTransport`
refuse to wrap an app-call registry, since their `allow` option, middleware and `tools/list` would
answer first; and `createMcpServer`'s in-process `execute` and `executePipeline` give the one
refusal.

A journaled app call replays with the `apps` interface, so the replaying registry runs the check
again and needs the same `callGrant` ([journal replay](./journal.md#replay)); a target that cannot
check it refuses the entry before any handler runs, whatever context the replay adds (TypeScript:
any target but `createAppCallRegistry`, the core registry included; Python: any target but
`CommandRegistry` or `MCPServer`; C++: any bare `CommandExecutor`). In Rust, `ExposeOptions`
serializes `apps` only when it is `true`, so a serialized default stays valid where core manifest
version 1 refuses the key. A refusal is returned before
middleware, so AFD's journal middleware never records one; a host that journals refusals, as Loam
does, records it where it receives the app's call.

The shared plugin manifest carries the flag from [core version 2](./plugin-manifest.md#k5-exposure).

<!-- generated:capabilities:spec.command-metadata.app-calls:start -->
|  | TypeScript | Python | Rust | C++ |
| --- | --- | --- | --- | --- |
| App-to-app calls (`expose.apps`, `apps` interface, `CALL_NOT_GRANTED`) | Yes (`ExposeOptions.apps`, `createCommandRegistry({ callGrant })` and `createAppCallRegistry` in `@lushly-dev/afd-server` and `/direct`) | Yes (`ExposeOptions.apps`, `create_command_registry(call_grant=...)` and `create_server(..., call_grant=...)`) | Yes (`ExposeOptions::apps`, `CommandInterface::Apps` and `CommandRegistry::set_call_grant`) | Yes (`ExposeOptions::apps`, `Interface::apps`, `CommandRegistryOptions::call_grant` and `CommandRegistry::set_call_grant`) |
<!-- generated:capabilities:spec.command-metadata.app-calls:end -->

The cases are in [`vectors/app-calls.json`](./vectors/app-calls.json).

## Decisions on the tool surface (#466)

Phase 5 of the MCP 2026-07-28 plan deferred three items. The owner decided them on 2026-10-31:

1. **Tool `title`: adopted.** An optional `title` field (above), reported as described in
   [Tool titles](#tool-titles).
2. **A request-values argument on the meta-tools: adopted as one `meta` object.** `afd-call`,
   `afd-batch`, `afd-pipe`, `afd-discover` and `afd-detail` take an optional `meta` argument whose
   keys are `dev.afd/context` and the declared context fields' `_meta` keys
   ([`context-fields.md`](./context-fields.md#clients-that-cannot-set-_meta)), applied as if sent
   in `_meta`, for clients that cannot set `_meta`. Only `dev.afd/context` has an effect on
   `afd-discover` and `afd-detail`. A key sent both ways must agree, or the call fails with
   `VALIDATION_ERROR`. [`context-fields.md`](./context-fields.md#clients-that-cannot-set-_meta)
   gives the rules; TypeScript, Python and Rust implement it, and C++'s `afd::mcp_stdio` lifts
   `dev.afd/context` only (it reads no declared context fields from `_meta`).
3. **`x-mcp-header: "Afd-Command"` on `afd-call.command`: not adopted.** A server that declares it
   makes clients mirror the value into an `Mcp-Param-Afd-Command` header and rejects a call whose
   header is missing or differs, so a client without support could no longer use `afd-call`; client
   support has not been verified. Gateways already route every command tool by `Mcp-Name`; only
   calls through the meta-tools are opaque to them. The same answer covers declared context fields:
   they are read from `_meta` only, never mirrored into headers. Revisit when a gateway needs
   per-command routing through `afd-call` and the clients AFD supports mirror `x-mcp-header`.

## MCP tool fields (MCP 2026-07-28 tool surface)

An MCP tool for a command also carries standard MCP fields, derived from the metadata above. They
complement `_meta`, which stays unchanged, so clients that only read `_meta` see no difference.

### Annotations

MCP's annotation defaults differ from AFD's: MCP assumes a tool that is not read-only may be
destructive. AFD therefore reports an annotation only from a field the command sets, never from a
default:

| Command | `annotations` |
| --- | --- |
| `mutation: false` set explicitly | `readOnlyHint: true` |
| `mutation: true` | `readOnlyHint: false`, `destructiveHint: <destructive, false when unset>` |
| `mutation` unset | none (`destructive` alone is reported only in `_meta`) |

`idempotentHint` and `openWorldHint` are not derived. Annotations are hints for clients and are
never enforced. Grouped and meta-tools carry no annotations, because one tool covers several
commands; their per-command metadata stays in `_meta.actions`. The hybrid strategy's first-class
tools are command tools and carry annotations as individual tools do.

### Tool titles

A command's own tool (the individual strategy's, and a first-class tool under hybrid) carries the
command's `title` as the MCP tool `title`, a display label for clients. A command without `title`
gets none: the name is not turned into one, so adding the field changes no existing tool list. A
grouped tool has no title, as one tool covers several commands. The five meta-tools carry the fixed
titles in [`meta-tools.json`](./meta-tools.json), which every implementation lists.

`annotations.title` is not set: the tool's top-level `title` takes precedence in MCP.

### Structured results

- **`structuredContent`:** a `tools/call` result for a command carries the whole `CommandResult` as
  `structuredContent`, and the same JSON as text in `content[0]` for clients that only read text.
- **`outputSchema`:** a command with an output schema (`returns`), listed as its own tool
  (the individual strategy, or first-class in the hybrid strategy), advertises a top-level
  `outputSchema` that describes the `CommandResult`
  envelope ([`spec/schema/output-envelope.json`](./schema/output-envelope.json); full result schema
  in [`spec/schema/README.md`](./schema/README.md)), with `data` typed by the command's output
  schema and `error` typed with `code`, `message`, `suggestion` and `retryable`:

  ```json
  {
    "type": "object",
    "properties": {
      "success": { "type": "boolean" },
      "data": "<the command's output schema>",
      "error": {
        "type": "object",
        "properties": {
          "code": { "type": "string" },
          "message": { "type": "string" },
          "suggestion": { "type": "string" },
          "retryable": { "type": "boolean" }
        },
        "required": ["code", "message"]
      },
      "metadata": { "type": "object" }
    },
    "required": ["success"]
  }
  ```

  Clients validate `structuredContent` against it, so a handler whose `data` does not match its
  declared output schema fails on the client. To preserve local references, an output schema that
  starts a schema resource (a string `$id` that is not a bare fragment, the test of
  [`validation.md`](./validation.md#annotations)) keeps its `$id`, `$defs` and `definitions` inside
  `data`. Any other output schema moves `$defs` and `definitions` to the envelope's root, and each
  `"$ref": "#"` in it that named its root, outside a nested schema resource and in a schema
  position (not inside `const`, `enum`, `default` or `examples`), becomes
  `"#/properties/data"`, since `#` now names the envelope.
  [`vectors/output-schema.json`](./vectors/output-schema.json) holds the envelope each language
  builds. A server MAY switch the top-level
  `outputSchema` off; `_meta.outputSchema` (the schema of `data` alone) is always reported.

### Implementation status

Python's, Rust's and C++'s `mutation` is a plain boolean with no unset state, so they report
annotations only for `mutation: true` and never claim `readOnlyHint: true`. `destructiveHint`
follows `destructive`, `false` when it is unset.

<!-- generated:capabilities:spec.command-metadata.tool-fields:start -->
|  | TypeScript | Python | Rust | C++ |
| --- | --- | --- | --- | --- |
| Tool `title` | Yes | Yes | Yes | Yes (`title` on `CommandDefinition`; `afd::mcp_stdio` tool lists) |
| Annotations | Yes | Yes (`mutation: true` only, with `destructive`; [#1741](https://github.com/lushly-dev/afd/issues/1741)) | Yes (`mutation: true` only, with `destructive`, from `CommandRegistry::get_tool`; [#1741](https://github.com/lushly-dev/afd/issues/1741)) | Yes (`mutation: true` only, with `destructive`; [#1741](https://github.com/lushly-dev/afd/issues/1741)) |
| Confirmations | Yes (`confirmations`, `confirmationKey`; client `onElicitation`, CLI prompt) | Yes (`create_server(confirmations=..., confirmation_key=...)`; individual, grouped and meta-tools) | Yes (`McpServer::with_confirmations`, `with_confirmations_key`; individual, grouped and meta-tools) | Yes (`StdioServerOptions::confirmations` on `afd::mcp_stdio`: individual, grouped, `afd-call`, `afd-batch` and `afd-pipe` in both eras) |
| `structuredContent` | Yes | Yes (every tool result of every route, meta-tools, batch and pipeline included) | Yes (`McpServer`, every tool result of every route, meta-tools, batch and pipeline included) | Yes (`afd::mcp_stdio`, every tool result; the todo backend runs on it) |
| Top-level `outputSchema` | Yes (`advertiseOutputSchema`) | Yes, for commands with `returns` listed as their own tool, individual or first-class under hybrid (`create_server(advertise_output_schema=False)` opts out); the envelope does not require a property that accepts `null`, because Python's wire format omits model fields set to `None` | Yes, for commands with `returns` listed as their own tool, individual or first-class under hybrid (`McpServer::with_advertise_output_schema`) | Yes, for commands with `output_schema` (`StdioServerOptions::advertise_output_schema`) |
| `toolMeta` and the advertised schema ([`mcp-resources.md`](./mcp-resources.md)) | Yes (`toolMeta`, `advertisedInputSchema`) | Yes (`tool_meta`, `advertised_input_schema`; #1981) | Yes (`with_tool_meta`, `register_with_schemas`) | Yes (`CommandDefinition::tool_meta`, `advertised_input_schema`; #1983) |
| `outputBudget` and the check after the handler ([`output-budgets.md`](./output-budgets.md)) | Yes (`outputBudget`, #1989) | Yes ([#1990](https://github.com/lushly-dev/afd/issues/1990), #2186) | Yes (Umbel phase 2 step 0b) | Yes ([#1991](https://github.com/lushly-dev/afd/issues/1991), #2187) |
| Hybrid first-class tools: command tools with these fields, `confirm` and the single-command approval relay ([tool strategies](./tool-strategies.md#hybrid)) | Yes | Yes | Yes | Yes |
| `scopes` and its surfaces ([Scopes](#scopes)) | Yes (#1050: `defineCommand({ scopes })`, in `_meta`, grouped `_meta.actions` and `afd-detail`; enforced with `auth`) | Yes ([#2155](https://github.com/lushly-dev/afd/issues/2155): `scopes` on `CommandDefinition`, `@define_command` and `@server.command`, checked at registration, in `_meta`, grouped `_meta.actions`, `afd-detail` and `afd-help`; enforced with `auth`) | Yes (Umbel phase 5 step 0b: `CommandDefinition::with_scopes`, checked at registration, in `_meta`, grouped `_meta.actions` and `afd-detail`; enforced with `server-auth`) | N/A: no HTTP server |
| Confirmation state bound to the principal ([#532](https://github.com/lushly-dev/afd/issues/532)) | Yes (Umbel phase 5 step 0c): confirmation and approval-relay state, the actor (`createContext`'s or the `actor` option) and `createContext`'s `credentials`, in the state's HMAC bind tag; `principalBinding` | Yes (step 0c, [#800](https://github.com/lushly-dev/afd/issues/800), [#2154](https://github.com/lushly-dev/afd/issues/2154)): the hook's actor (or server `actor`) and verified credentials (AFD `auth` or SDK token), through the SDK's `bind_principal`; a mismatch is `-32602` as tampering is | Yes (step 0c): the hook's actor and `CommandContext::credentials`, in the state's HMAC associated data; since step 0d the same state carries the form-mode approval relay's answers | Partial: `afd::mcp_stdio` signs `requestState` (HMAC) bound to command, input and actor; stdio carries no HTTP credentials |
| `confirmationMode: "host-verified"` and `HumanRelay` ([Host-verified confirmation](#host-verified-confirmation)) | Yes ([#2263](https://github.com/lushly-dev/afd/issues/2263): `confirmationMode: 'host-verified'`, `createMcpServer({ humanRelay })`, `inputDigest`) | Yes ([#2264](https://github.com/lushly-dev/afd/issues/2264): `confirmation_mode="host-verified"`, `create_server(..., human_relay=...)`, `input_digest`) | Yes (Umbel phase 5 step 0d: `CommandDefinition::with_confirmation_mode(CommandConfirmationMode::HostVerified)`, `McpServer::with_human_relay`, `afd::input_digest`) | N/A: `afd::mcp_stdio` has no `HumanRelay` |
| `task`, `TaskStore` and the `tasks/*` handlers ([Tasks](#tasks)) | Yes ([#1971](https://github.com/lushly-dev/afd/issues/1971): `TaskSupport`, `TaskStore`, `InMemoryTaskStore` (32/owner, 256 total), `taskStore`/`taskOptions`, `CommandContext.reportProgress`, `McpClient({ tasks: true })`; `tasks.test.ts`, `tasks-client.test.ts`, todo `--suite tasks`) | Yes ([#1972](https://github.com/lushly-dev/afd/issues/1972): `TaskSupport`, `TaskStore`, `InMemoryTaskStore` (32/owner, 256 total), `task_store`/`task_options`, `CommandContext.report_progress`/`cancel`, `McpClient(McpClientConfig(tasks=True))`; `test_tasks.py`, `test_tasks_client.py`, todo `--suite tasks`) | Yes (Umbel phase 5 step 0e: `CommandDefinition::with_task(TaskSupport)`, `afd::server::tasks` (`TaskStore`, `InMemoryTaskStore` 32/owner, 256 total), `with_task_store`/`with_task_options`, `report_progress` and `cancellation`; `tests/server_tasks.rs`, todo `--suite tasks`) | N/A: not planned for C++ ([MCP Tasks proposal](../docs/features/complete/mcp-tasks/mcp-tasks.proposal.md)) |
<!-- generated:capabilities:spec.command-metadata.tool-fields:end -->

