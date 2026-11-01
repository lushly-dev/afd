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
| `requires` | string[] of command names | None | `_meta`, afd-help (brief and full). Metadata only: not enforced at runtime |
| `mutation` | boolean | `false` | `_meta`, afd-detail, afd-discover (`includeMutation`), afd-help (full), afd-docs |
| `destructive` | boolean | `false` | `_meta`, afd-detail, afd-help (full), afd-docs, `DirectRegistry.listCommands()`, `afd tools`. `afd validate --execute` never calls it |
| `confirmPrompt` | string | None; a frontend MAY show a generic prompt | afd-detail, afd-docs |
| `undoable` | boolean | `false` | `_meta`, afd-detail, afd-help (full), afd-docs, `DirectRegistry.listCommands()`, `afd tools` |
| `approval` | `required`, `not-required`, or a function of the validated input and context returning one of them | `not-required` | `_meta`, afd-detail, afd-docs, as `required`, `not-required` or `conditional` (a function). `afd validate` warns when a `mutation` or `destructive` command declares none. Enforced only by the approval middleware; see [Approvals](#approvals) |
| `executionTime` | `instant`, `fast`, `slow` or `long-running` | None | afd-detail |
| `handoff` | boolean | `false` | afd-detail; adds the `handoff` tag |
| `handoffProtocol` | `websocket`, `webrtc`, `sse`, `http-stream` or another string | None | afd-detail; adds the `handoff:<protocol>` tag |
| `expose` | `palette`, `agent`, `mcp`, `cli` booleans | `palette` and `agent` true, `mcp` and `cli` false, per flag | Not reported. It decides which surfaces list and run the command; afd-detail reports the result as `callable` |
| `examples` | `{ title, input }[]` | None | `_meta`, afd-help (full). Each `input` must pass the input schema when the command is defined |
| `contexts` | string[] | None: the command is visible in every context | `_meta`; calls, afd-discover, afd-detail, the context tools and the individual and grouped tools/list scope on it; the hybrid tools/list does not ([H4](./tool-strategies.md#h4-contexts-a-fixed-list-scoped-calls)) |
| `toolMeta` | object: `_meta` key to JSON value | None | Merged into the command tool's `_meta`, a grouped action entry and afd-detail (`toolMeta`). Keys follow the [key rule](./mcp-resources.md#t2-the-key-rule): reverse-DNS prefixed keys outside `dev.afd/`, or the MCP Apps key `ui`; anything else is refused at registration ([T1](./mcp-resources.md#t1-extra-entries-on-a-commands-tool)) |
| `outputBudget` | `{ defaultBytes, maxBytes }`, positive integers, `defaultBytes ≤ maxBytes` | None: the result is not checked | `_meta["dev.afd/outputBudget"]`, afd-detail (`outputBudget`). Callers ask per call in `_meta["dev.afd/outputBudget"]`; an over-budget read becomes `OUTPUT_BUDGET_EXCEEDED`, a mutation keeps its result with a warning ([output budgets](./output-budgets.md)) |

`destructive`, `confirmPrompt` and `undoable` are declarations for frontends and agents. AFD does
not act on `destructive` or `undoable`: an undo mechanism belongs to the consumer. A server MAY
enforce `confirmPrompt` on its MCP surfaces, as [Confirmations](#confirmations) describes; it does
not by default. `approval` is the pre-execution gate: where the approval middleware is installed, a
call it requires is held before the handler runs, as [Approvals](#approvals) describes.

## Reporting rules

- **Unset is omitted.** A surface reports a field only when the command sets it, never as `null`.
  Consumers read an absent boolean as its default. An explicit `false` is reported as `false`.
- **Two exceptions:** afd-detail always reports `mutation`, and afd-discover reports it when
  `includeMutation` is set. Both use `false` when it is unset.
- **`_meta` omits empty arrays** (`requires`, `examples`, `contexts`).
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
| tools/list `_meta` | `category`, `requires`, `mutation`, `destructive`, `undoable`, `approval`, `examples`, `outputSchema`, `contexts`, `dev.afd/outputBudget` ([B1](./output-budgets.md#b1-the-declaration)), and the command's `toolMeta` entries |
| tools/list `title` | `title`, on a command's own tool (individual, and first-class under hybrid); the meta-tools carry fixed titles |
| afd-detail | `name`, `title`, `description`, `category`, `tags`, `mutation`, `executionTime`, `errors`, `inputSchema` (the advertised schema), `outputSchema`, `destructive`, `confirmPrompt`, `undoable`, `approval`, `handoff`, `handoffProtocol`, `version`, `callable`, `toolMeta`, `outputBudget` |
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
   of the validated input, the principal when there is one, and an expiry. When the retry carries an
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
`requestState` is never accepted as a confirmation: TypeScript and Rust ask again, and Python, whose
MCP SDK seals and checks the state before the handler runs, rejects the request with JSON-RPC
`-32602`.

A 2025-era request elicits only where its connection can carry a server-sent request (stdio, or
stateful HTTP). Over stateless HTTP it gets the acknowledgement path.

## Approvals

Confirmations ask whether an action is intended; approvals hold an action until a human signs off.
A command's `approval` policy decides, per call, whether it needs approval. The approval
middleware enforces it on every surface the middleware runs on (MCP, the HTTP routes and
in-process registries alike). Without the middleware, `approval` is a declaration only.

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
`already-used`, and the result carries a fresh token. A human's refusal relayed over MCP is
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
   another way.

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
`relay: 'mcp-elicitation'`). The relay is opt-in: it trusts the client application to show the
question to a person, and a server cannot tell a person's answer from client code that answers on
its own.

When a call to a single command (its tool, individual or first-class, `afd-call` or a grouped
tool) needs approval and the
request can carry a form elicitation, the server answers as for a confirmation: `input_required` on
MCP 2026-07-28, or a server-sent elicitation on a 2025-era stdio connection. The form uses the
input key `approval` and one required boolean property `approve`. Its message is the summary
followed by the command name and its validated input (canonical JSON, truncated), so the human sees
what exactly would run. No approval token is issued. Its `requestState` is integrity-protected and
bound to the method and to the authenticated client when there is one. It carries:

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

Some calls fall back to `APPROVAL_REQUIRED` without a token:

- a request that cannot elicit: no form elicitation capability, or a 2025-era request over
  stateless HTTP;
- a step of `afd-batch` or `afd-pipe`. A policy is evaluated on the validated input when the step
  runs, and asking mid-run would run the earlier steps again on the retry;
- a command run by another command in the same tool call. Only the command the tool call routes to
  may ask, and only once.

An accepted approval that has expired or was already used is asked again, and the question says
so.

The result is an ordinary failed `CommandResult`, so it needs no wire fixture of its own.

| | TypeScript | Python | Rust | C++ |
| --- | --- | --- | --- | --- |
| `approval` field and `_meta.approval` | Yes | Yes | Yes | Yes (`_meta.approval` in the todo backend) |
| Approval middleware | Yes (`createApprovalMiddleware`) | Yes (`create_approval_middleware`) | Yes (`create_approval_middleware`) | Yes (`create_approval_middleware`) |
| DirectClient approval hook and private exchange | Yes | Yes (`on_approval_needed`) | Yes (`with_on_approval_needed`) | Yes (`on_approval_needed`) |
| CLI approval flow (`afd call --module`, in-process only) | Yes | Yes (`--approve` or interactive prompt) | N/A: no CLI | N/A: no CLI |
| MCP relay (form elicitation) | Yes (`relay: 'mcp-elicitation'`) | Planned | Planned | Planned |

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
   gives the rules; TypeScript, Python and Rust implement it (C++ has no MCP server).
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
  envelope, with `data` typed by the command's output schema:

  ```json
  {
    "type": "object",
    "properties": {
      "success": { "type": "boolean" },
      "data": "<the command's output schema>",
      "error": { "type": "object" },
      "metadata": { "type": "object" }
    },
    "required": ["success"]
  }
  ```

  Clients validate `structuredContent` against it, so a handler whose `data` does not match its
  declared output schema fails on the client. A server MAY switch the top-level `outputSchema` off;
  `_meta.outputSchema` (the schema of `data` alone) is always reported.

### Implementation status

Python's, Rust's and C++'s `mutation` is a plain boolean with no unset state, so they report
annotations only for `mutation: true` and never claim `readOnlyHint: true`. `destructiveHint`
follows `destructive`, `false` when it is unset.

| | TypeScript | Python | Rust | C++ |
| --- | --- | --- | --- | --- |
| Tool `title` | Yes | Yes | Yes | Yes (`title` on the definition; todo backend tool lists) |
| Annotations | Yes | `mutation: true` only, with `destructive` | `mutation: true` only, with `destructive`, from `CommandRegistry::get_tool` | `mutation: true` only, with `destructive` (todo backend) |
| Confirmations | Yes (`confirmations`, `confirmationKey`; client `onElicitation`, CLI prompt) | Yes (`create_server(confirmations=..., confirmation_key=...)`); individual, grouped and meta-tools | Yes (`McpServer::with_confirmations`, `with_confirmations_key`); individual, grouped and meta-tools | Planned (todo backend) |
| `structuredContent` | Yes | Planned | Yes (`McpServer`, every tool result of every route, meta-tools, batch and pipeline included) | Planned |
| Top-level `outputSchema` | Yes (`advertiseOutputSchema`) | Planned | Yes, for commands with `returns` under the individual strategy, as in TypeScript (`McpServer::with_advertise_output_schema`) | Planned |
| `toolMeta` and the advertised schema ([`mcp-resources.md`](./mcp-resources.md)) | Yes (`toolMeta`, `advertisedInputSchema`) | Planned | Yes (`with_tool_meta`, `register_with_schemas`) | Planned |
| `outputBudget` and the check after the handler ([`output-budgets.md`](./output-budgets.md)) | Planned | Planned | Yes (Umbel phase 2 step 0b) | Planned |
| Hybrid first-class tools: command tools with these fields, `confirm` and the single-command approval relay ([tool strategies](./tool-strategies.md#hybrid)) | Yes | Yes | Yes | Planned |

