# Confirmations

Profile: `confirmations`. This page belongs to the `confirmations` profile of the
[contract registry](./registry.md): an implementation that does not claim the profile need not
implement it. A server claims it when it can enforce `confirmPrompt` (the `confirmations` option).

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

## Host-verified confirmation

A command sets `confirmationMode: "host-verified"` when only the host can prove that a person
decided, for example by a fresh login at the person's identity provider on a page the host serves
(Umbel's person page). A form answer and an acknowledgement prove nothing of the kind: client code
can produce either. For such a command, on every MCP surface and **whatever the server's
`confirmations` option says, `off` included**:

- The server never sends a form elicitation for it, never advertises or accepts an acknowledgement
  for it (`confirm: true`, a `confirm` list, `_meta["dev.afd/confirm"]`, `Afd-Confirm`), and never
  accepts a form answer for it. The form-mode approval relay ([Asking the human over MCP](./approvals.md#asking-the-human-over-mcp))
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
    pendingList(call) -> Approved { decisionId } | Declined | Pending { decision, url, list }
                       | CommandError | none   (optional; default none)
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
   is the unpadded base64url SHA-256 of the canonical JSON ([Approvals](./approvals.md), rule 3) of the
   validated input, so the person decides on exactly what will run.
3. **Begin.** On a call that carries no relay answer, the server calls `begin`. A `CommandError` is
   the call's result: a relay may refuse, for example for a client without URL-mode elicitation.
   Otherwise the server answers `input_required` with one URL-mode elicitation under the input key
   `relay`: `mode: "url"`, the relay's `message` and `url`, and an `elicitationId` that is the
   unpadded base64url SHA-256 of the URL, so a pending decision keeps one id. The `requestState` is
   the relay's `state`. The server never sends this to a request whose client capabilities do not
   declare URL-mode elicitation: if `begin` returns a prompt for one, the call fails with
   `CONFIRMATION_REQUIRED`, unless the relay keeps a [pending list](#the-pending-list).
4. **The retry.** A retry carrying `inputResponses.relay` and a `requestState`:
   - `decline` or `cancel` fails with `CONFIRMATION_DECLINED`, without asking the relay.
   - `accept` means only that the user agreed to open the link (MCP: URL mode is out of band, and
     the server "MUST NOT rely on" it to authorize users for themselves). It is never an answer by
     itself. The server calls `resume` with the state and this call:
     - `Approved`: the command runs. If it has an approval policy, the server sets
       [relay evidence](./approvals.md#relay-evidence) first, so one decision covers both gates.
     - `Declined`: `CONFIRMATION_DECLINED`, not retryable.
     - `Pending(prompt)`: `input_required` again with that prompt, as in step 3.
     - `Invalid`: the state is not an answer, so the server begins again (step 3), as it asks again
       for a tampered confirmation state.

What a relay guarantees:
- **Its `state`** is integrity-protected, expires within 24 hours, and binds the decision, the
  command, `inputDigest` and the call's principal binding (#532). `resume` returns `Invalid` for a
  state that does not verify, has expired, or was issued to another command, input or principal.
- **`Approved`** is returned at most once per decision, and only for a decision the person made
  after `begin`. Its `decisionId` is 1 to 128 ASCII letters, digits, `_` and `-`; the server
  answers any other with an internal error and runs nothing.
- **The URL** is an absolute `https` URL that holds no identity and is not pre-authenticated; the
  host verifies who opens it and that it is the person the call is for (MCP 2026-07-28,
  elicitation, URL mode). Its host is DNS labels of ASCII letters, digits and `-`, or a bracketed
  IPv6 address, with an optional port from 1 to 65535 and no user information; the server answers
  any other prompt with an internal error. Rust, TypeScript and Python enforce this host and port
  rule and the decision-id rule above.

## The pending list

A client that does not declare URL-mode elicitation is never sent the relay's prompt. By default its
call fails with `CONFIRMATION_REQUIRED`, as step 3 says. A relay may instead keep a list of the
person's pending decisions, on its own page, and opt in to `pendingList`; a host offers it per
deployment, off by default (#2010). On such a call, after validation (step 2), a `decline` or
`cancel` answer still ends it with `CONFIRMATION_DECLINED` without asking the relay (step 4).
Otherwise the server calls `pendingList` before `begin` or `resume`, and calls neither when it
answers:

- **`Pending`**: a live, undecided decision bound to the call's principal binding, command and
  `inputDigest`, or a new one the relay began for it when none is live. A live approved or declined
  decision bound to the call is answered first, so a newer pending decision never hides it. The
  call fails with:

  ```json
  {
    "success": false,
    "error": {
      "code": "CONFIRMATION_REQUIRED",
      "message": "'memory-erase' needs a person's confirmation through the host",
      "suggestion": "Ask the person to open their pending decisions at https://person.example.com/d/ (or this one at https://person.example.com/d/d-1), check that it is decision d-1 for 'memory-erase', and decide there; then send this same call again.",
      "retryable": true,
      "recovery": { "kind": "external" },
      "details": {
        "commands": ["memory-erase"],
        "reason": "pending-list",
        "decision": "d-1",
        "url": "https://person.example.com/d/d-1",
        "list": "https://person.example.com/d/"
      }
    }
  }
  ```

  `decision` is 1 to 128 ASCII letters, digits, `_` and `-`, and `url` and `list` are URLs as the
  guarantees above require, with a valid host and a port from 1 to 65535; anything else is an
  internal error. The suggestion names the list first, because it is a fixed address the person
  can learn and check. In this refusal it also arrives through the agent, so it protects only a
  person who already knows the address.
- **`Approved`**: such a decision the person approved after it began, which the relay spends
  atomically, so of identical calls exactly one gets it. Its `decisionId` follows the same rule as
  `decision`. The command runs as after `resume`'s
  `Approved`: with relay evidence and `approvedContext`.
- **`Declined`**: `CONFIRMATION_DECLINED`, not retryable; the relay answers it once.
- **A `CommandError`** is the call's result. **None** keeps the default refusal.

No `requestState` travels: the relay's lookup binds what the state binds, and the guarantees above
apply to it. The person still decides on the relay's page, proven as the URL guarantee requires,
so the assurance a decision records is unchanged. What the list trades is the link's provenance:
in URL mode the client shows the server's URL itself, and here the agent relays it, so a
prompt-injected agent could hand the person another link, the list's included. The relay's page
therefore names the command, what the person is shown of the input and the decision id the
refusal names, and the person signs in there as the URL guarantee requires, so another link can
lead the person astray but cannot decide for them. The cases are in
[`vectors/human-relay.json`](./vectors/human-relay.json). Rust
(`HumanRelay::pending_list`), TypeScript (`HumanRelay.pendingList`,
[#2722](https://github.com/lushly-dev/afd/issues/2722)) and Python (`HumanRelay.pending_list`,
[#2723](https://github.com/lushly-dev/afd/issues/2723)) implement this.
