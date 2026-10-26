# MCP confirmations and input requests

> **Goal**: Make `confirmPrompt` mean something. A command that declares it does not run over MCP until the caller confirms, through an MCP 2026-07-28 elicitation when the client can show one, and through an explicit acknowledgement otherwise.

| Field | Value |
|---|---|
| Status | Active: accepted 2026-10-25 with every recommendation (C1–C6). Phase 1 (spec, error codes, Python and Rust fields) implemented on `claude/mcp-confirmations-phase1`. Ranked 1 of 4 among the [MCP 2026-07-28 Phase 7 follow-ons](../mcp-2026-07-28/proposal.md#phase-7-optional-follow-ons-each-its-own-proposal). Resolves decision D10 of that plan. |
| Author | jasfalk (drafted with Claude) |
| Spec | [MRTR](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr), [elicitation](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation) |
| Packages | `spec/`, `packages/core`, `packages/server`, `packages/client`, `packages/cli`, `python/`, `packages/rust`, the C++ todo backend |
| Related | [Command trust config](../../complete/command-trust-config/) (added `destructive` and `confirmPrompt`), [command exposure and undo](../../complete/command-exposure-undo/), [MCP authorization](../../proposed/mcp-authorization/mcp-authorization.proposal.md) (supplies the principal that confirmations bind to) |

## Why this is first

| Criterion | Assessment |
|---|---|
| Value | High. Every AFD server with a destructive command gains a real safeguard. Today `destructive` and `confirmPrompt` are advertised and then ignored, so an agent can wipe data in one call. |
| Readiness | High. All three SDKs ship MRTR (`input_required`) helpers and a signed `requestState` codec, and the Phase 0 spike already drove a full confirm round trip through the TypeScript SDK. |
| Effort | M. Spec and error codes first, then one server hook per language. |
| Dependencies | None. Authorization makes the principal binding stronger but is not required. |

## Today

- `spec/command-metadata.md` defines `mutation`, `destructive`, `confirmPrompt` and `undoable`, and says AFD carries them without acting on them. `confirmPrompt` is kept out of `_meta` and appears only in `afd-detail` and docs.
- TypeScript and C++ have all four fields. Python and Rust have neither `destructive`, `confirm_prompt` nor `undoable`, although the spec's spelling table lists `confirm_prompt` for them.
- No error code covers confirmation or input. The catalog has 42 codes.
- The AFD client declares no elicitation capability, and the CLI has no prompt for confirmations.
- The only confirmation in the repository is an example command that takes `confirm: z.literal(true)` as ordinary input.

## Proposal

### Behavior

A server option turns enforcement on: `confirmations: 'off' | 'enforce' | 'require-human'`, `'off'` by default in 2.x.

When it is on and a call reaches a command with `confirmPrompt`:

1. **The call carries a valid confirmation.** The command runs.
2. **The request declares form elicitation.** The server answers `input_required` with one elicitation: the command's `confirmPrompt` as the message and a single boolean field. `requestState` is signed with the SDK codec and binds the command name, a digest of the validated input, the principal when there is one, and a short TTL.
3. **The client accepts.** The retry carries `inputResponses` and the same `requestState`. The server verifies the state, checks that the input digest still matches, and runs the command.
4. **The client declines or cancels.** The result is a failure with `CONFIRMATION_DECLINED`, whose suggestion tells the agent not to retry without asking the user.
5. **The request cannot carry an elicitation** (no capability, legacy HTTP, or a client that ignores `input_required`). Under `'enforce'` the result is a failure with `CONFIRMATION_REQUIRED`. Its suggestion says to repeat the call with the acknowledgement described below. Under `'require-human'` there is no acknowledgement path, and the suggestion says the client must support elicitation.

### The acknowledgement path

An acknowledgement is not human consent: the agent can send it on its own. The spec text and the error suggestion say so plainly. It exists so that confirm-gated commands stay usable from clients without elicitation, and it forces the agent to make a deliberate second call.

- **Individual tools.** A command with `confirmPrompt` advertises an optional `confirm: boolean` property in its tool `inputSchema`. The server strips it before validation, so command schemas are unchanged.
- **Meta-tools.** `afd-call` gains an optional `confirm` field. `afd-batch` and `afd-pipe` gain a `confirm` list of command names.
- **`_meta`.** `_meta["dev.afd/confirm"]: true` is accepted on every tool call, for clients that can set `_meta`.

### Batches and pipelines

A batch or pipeline that contains a confirm-gated command asks once, before any step runs. The elicitation message lists every gated command. Asking in the middle would leave earlier steps applied while the user decides.

### Client and CLI

- The AFD client declares form elicitation when an elicitation handler is registered, and fulfils `input_required` through it.
- Without a handler, an `input_required` result becomes a failure with a new `INPUT_REQUIRED` code that carries the `inputRequests`, so callers see what was asked.
- The CLI registers a handler that prompts on a TTY and declines otherwise.

### Surfaces that do not enforce

DirectClient and the in-process registry do not enforce confirmations. The host application owns that boundary, as it does today. The `/stream` and REST routes follow the MCP behavior with the acknowledgement path only, because they have no elicitation channel.

## Spec and catalog changes (first PR)

- `spec/command-metadata.md`: a "Confirmations" section with the behavior above, the acknowledgement fields, and the batch rule. Fix the spelling table so it matches what Python and Rust actually have.
- `spec/error-codes.md` and `spec/vectors/error-codes.json`: add `CONFIRMATION_REQUIRED` and `CONFIRMATION_DECLINED` to the shared catalog, which brings it to 44 codes. Every language's catalog test then fails until it adds them. `INPUT_REQUIRED` is an MCP client code, listed with the transport-specific codes, because only an MCP client produces it.
- Python and Rust gain `destructive`, `confirm_prompt` and `undoable`, with the same annotation and `_meta` rules as TypeScript.

## Per language

| Language | Server hook | `requestState` |
|---|---|---|
| TypeScript | `inputRequired.elicit(...)` and `acceptedContent(...)` in the `/mcp` `tools/call` handler; capability check on `ctx.mcpReq` | `createRequestStateCodec` (HMAC-SHA256), with input digest and principal in `bind` |
| Python | An `InputRequiredResult` returned from the generic tool wrapper, because `Resolve(Elicit(...))` parameters do not fit AFD's wrapped handlers | The SDK's default `RequestStateSecurity` (AES-256-GCM), with a configured key in place of the per-process default |
| Rust | `InputRequiredResult` through `CallToolResponse`, which the server already returns | rmcp's `request-state` feature, enabled by the `server` feature |
| C++ todo backend | The acknowledgement path only, with elicitation added once the C++ MCP library target (#341) exists | None |

Keys come from server options. A server with several instances needs a shared key, and the docs say so.

## Phases

1. Spec, error codes, and the missing Python and Rust fields. **Done (2026-10-25):** `spec/command-metadata.md` has the "Confirmations" section; `CONFIRMATION_REQUIRED` and `CONFIRMATION_DECLINED` are in the shared catalog (44 codes) in all four languages; `INPUT_REQUIRED` is listed as a planned MCP client code; Python and Rust have `destructive`, `confirm_prompt` and `undoable`, and a mutation's `destructiveHint` follows `destructive`. Rust tools still carry no `_meta`, so Rust reports the fields through annotations, afd-help and afd-docs.
2. TypeScript server and client, CLI prompt, and conformance cases: a confirm-gated `todo-clear` in `confirm` mode for every backend, covering accept, decline, the acknowledgement path, and a replayed `requestState` with changed input.
3. Python and Rust servers.
4. Optional, and its own decision: elicitation beyond confirmation. That covers asking for missing required input instead of returning `VALIDATION_ERROR`, and offering the result's `undoCommand` after an undoable command. Undo has no machinery to build on yet: results carry `undoCommand` and `undoArgs`, but nothing runs them.

## Decisions

| # | Question | Decision (accepted 2026-10-25) |
|---|---|---|
| C1 | Is enforcement opt-in in 2.x? | Yes, `'off'` by default. Consider `'enforce'` as the 3.0 default. |
| C2 | How does a client without elicitation confirm? | The acknowledgement path above: a stripped `confirm` property, meta-tool fields, and `_meta["dev.afd/confirm"]`. |
| C3 | Is `requestState` integrity-protected? | Yes, always. The digest binding stops a confirmation from one input being reused on another. |
| C4 | Does a batch ask once or per step? | Once, before any step runs. |
| C5 | Is a decline a separate code? | Yes, `CONFIRMATION_DECLINED`, so agents can tell "ask again" from "the user said no". |
| C6 | Does DirectClient enforce? | No. The host owns in-process calls. |

## Out of scope

Sampling and roots through MRTR, which AFD does not use. URL-mode elicitation, which is for secrets and authorization flows. Confirmations inside Tasks, which belong to the [Tasks proposal](../../proposed/mcp-tasks/mcp-tasks.proposal.md).

## Sources

- [MRTR](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr): `input_required`, `requestState` integrity, the TTL and principal binding, and the rule against assuming a retry.
- [Elicitation](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation): per-request capability, form-mode limits, and accept, decline and cancel.
- The SDKs as installed: TypeScript `@modelcontextprotocol/server` 2.4.0 (`inputRequired`, `acceptedContent`, `createRequestStateCodec`), Python `mcp` 2.3.0 (`RequestStateSecurity`), rmcp 3.7.0 (`model/mrtr.rs`, `model/request_state.rs`).
