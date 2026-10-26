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
| `category` | string | None; grouping falls back to the name's first segment | `_meta`, afd-detail, afd-discover, afd-help (full), afd-docs headings, grouped tool names, `afd tools` groups |
| Input schema | JSON Schema object (TypeScript: Zod `input`, or core `parameters`) | Required | Tool `inputSchema`, afd-detail, afd-schema, afd-docs parameter table |
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
| `contexts` | string[] | None: the command is visible in every context | `_meta`; tools/list and the context tools scope on it |

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

## Surfaces

| Surface | Fields |
| --- | --- |
| tools/list `_meta` | `category`, `requires`, `mutation`, `destructive`, `undoable`, `approval`, `examples`, `outputSchema`, `contexts` |
| afd-detail | `name`, `description`, `category`, `tags`, `mutation`, `executionTime`, `errors`, `inputSchema`, `outputSchema`, `destructive`, `confirmPrompt`, `undoable`, `approval`, `handoff`, `handoffProtocol`, `version`, `callable` |
| afd-discover | `name`, `description`, `category`, and `mutation` with `includeMutation` |
| afd-help | `name`, `description`, `requires`; the `full` format adds `category`, `tags`, `mutation`, `destructive`, `undoable`, `examples` |
| afd-docs | `category`, `name`, `description`, `tags`, `mutation`, `destructive`, `confirmPrompt`, `undoable`, `approval`, parameters |
| afd-schema | `name`, `description`, `inputSchema` |

## Confirmations

A server MAY enforce `confirmPrompt` with the option `confirmations`: `off` (the default), `enforce`
or `require-human`. Enforcement applies to the MCP surfaces (individual tools, the meta-tools and
grouped tools) and to the HTTP `/stream` and REST routes. DirectClient and in-process registries
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

- **Individual tools.** A command with `confirmPrompt` advertises an optional boolean `confirm`
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
`already-used`, and the result carries a fresh token.

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

The result is an ordinary failed `CommandResult`, so it needs no wire fixture of its own.

| | TypeScript | Python | Rust | C++ |
| --- | --- | --- | --- | --- |
| `approval` field and `_meta.approval` | Yes | Yes | Planned (#421) | Planned (#422) |
| Approval middleware | Yes (`createApprovalMiddleware`) | Yes (`create_approval_middleware`) | Planned (#421) | Planned (#422) |
| CLI approval flow, MCP relay, DirectClient `onApprovalNeeded` | Planned (#417, #418, #419) | Planned | Planned | Planned |

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
commands; their per-command metadata stays in `_meta.actions`.

### Structured results

- **`structuredContent`:** a `tools/call` result for a command carries the whole `CommandResult` as
  `structuredContent`, and the same JSON as text in `content[0]` for clients that only read text.
- **`outputSchema`:** a command with an output schema (`returns`), listed as its own tool
  (individual strategy), advertises a top-level `outputSchema` that describes the `CommandResult`
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
| Annotations | Yes | `mutation: true` only, with `destructive` | `mutation: true` only, with `destructive`, from `CommandRegistry::get_tool` | `mutation: true` only, with `destructive` (todo backend) |
| Confirmations | Yes (`confirmations`, `confirmationKey`; client `onElicitation`, CLI prompt) | Yes (`create_server(confirmations=..., confirmation_key=...)`); individual, grouped and meta-tools | Yes (`McpServer::with_confirmations`, `with_confirmations_key`); individual tools, the only strategy the `server` feature serves | Planned (todo backend) |
| `structuredContent` | Yes | Planned | Planned | Planned |
| Top-level `outputSchema` | Yes (`advertiseOutputSchema`) | Planned | Planned | Planned |

