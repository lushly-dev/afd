# Approval evidence from an approver client

> **Goal:** let one trusted MCP client, which a server names an approver, receive the approval
> token of a held call and present it on the retry after a person approved, without letting any
> other caller, an agent included, do either. And give every approver one rule for what a person
> must be able to read before approving.

| Field | Value |
| --- | --- |
| Status | Active. Proposed and implemented together on 2026-11-17 for Loam's phase 5, step 0c: TypeScript and Rust. Python and C++ parity is [#1466](https://github.com/lushly-dev/afd/issues/1466). Progress in [STATUS.md](./STATUS.md) |
| Author | jasfalk (drafted with Claude) |
| Origin | Loam's [phase 5 specification](../../../../endpoints/loam/docs/phases/5-copilot/spec.md), section 7.2 ("AFD's part"), section 12 and threat T6; decisions D146 (route (a), the owner's answer to Q1) and D150 (the display rules come to AFD, the owner's answer to Q7) |
| Spec | [`spec/command-metadata.md`](../../../../spec/command-metadata.md): [Approval evidence from an approver client](../../../../spec/approvals.md#approval-evidence-from-an-approver-client) and [Approval display](../../../../spec/approvals.md#approval-display) |
| Packages | `spec/`, `@lushly-dev/afd-core` (display rules), `@lushly-dev/afd-server` (the carrier), the `afd` crate (both) |
| Vectors | [`spec/vectors/approver-client.json`](../../../../spec/vectors/approver-client.json) |
| Related | [Approvals](../../../../spec/approvals.md), [relay evidence](../../../../spec/approvals.md#relay-evidence), [the principal binding](../../../../spec/authorization.md#m8-the-principal-binding) (#532), [#883](https://github.com/lushly-dev/afd/issues/883)'s inventory of Lushly's approval code |

## The problem

A server can hold a command until a person approves it: its approval policy makes the middleware
answer `APPROVAL_REQUIRED` with a signed, single-use `afdap1` token, and the retry runs when it
carries the token as the context's approval evidence. Two of the approval rules then stop a
trusted MCP client from carrying that decision:

- **Rule 1:** evidence is never read from tool arguments, so no MCP request can carry it;
- **Rule 6:** on MCP the result leaves the token out, because the caller is usually the agent.

Loam's mail engine is the first case. Its send is a command only a person may run, and it accepts
evidence only from its own context. Loam mounts the engine over MCP and shows the person one
confirmation for a send, with the engine's own preview. When the person confirms, Loam has no way
to receive the engine's token or to present it. The phase 5 specification considered the
alternative, the engine's `HumanRelay` handing the decision to a page, and chose this carrier
(route (a), D146).

The person-facing half has a second gap. Every approver shows an action before a person approves
it, and nothing says what it must refuse to show. Lushly has the rule in `approval-display.ts`
(69 lines): size and depth limits, and no bidirectional, zero-width or control characters. D150
brings it to AFD.

## Jobs

| # | Job | Done when |
| --- | --- | --- |
| J1 | **A shell releases a person's send.** A trusted client calls a held command for a person, shows the person the action, and on their confirm retries once with the server's token | The approver's first call returns `APPROVAL_REQUIRED` with `details.approvalToken`; its retry with `_meta["dev.afd/approval"]` runs the command once |
| J2 | **An agent cannot approve its own call.** An agent, a model or any other caller tries to present a token, or to obtain one | From a caller the server has not made an approver, the key is ignored and no token is issued; in any tool argument the key is refused |
| J3 | **A token works only where it was given.** A token issued to one approver is copied to another client, or used for another input, or twice | It is refused: `credentials-mismatch`, `input-mismatch`, `already-used` |
| J4 | **A retry cannot run more than the person saw.** A token is carried into a batch, a pipeline or a 2025-era request | Nothing runs: `APPROVAL_REQUIRED` |
| J5 | **The person reads what runs.** An approver is handed an action to show | It shows the action in full, or refuses to show it at all when it is too large, too deep or hides characters |

Each job is a case in the vectors (below), so a language proves it by running them.

## Design

### Who is an approver

A server names its approvers with a predicate over the call's context, after the server has set
the credentials and the host has mapped the actor (TypeScript `approver(context)` in
`createMcpServer`'s options; Rust `McpServer::with_approver(|context| bool)`). There are none by
default. Only an explicit `true` makes one. The predicate should read only what the server
verified: the credentials (M4), or the actor a host's own hook mapped from them. A predicate that
fails is an internal error, never a yes.

An approver is bound to its principal binding (M8): its actor, and the issuer, subject and client
of its credentials. Credentials that cannot be bound (an empty issuer, subject or client id) make no
approver: the call fails as an internal error, as M8 refuses them elsewhere.

### What changes for an approver

- **The token reaches it.** On every MCP lane, a held result to an approver carries
  `details.approvalToken`, whatever the middleware's `includeToken` says, and this takes precedence
  over the MCP elicitation relay: an approver's call is never answered with a form, single or up
  front. It is the approver that shows the person the action.
- **The retry carries the token** in `_meta["dev.afd/approval"]`. The server sets it as the call's
  evidence before the middleware runs. The command the call routes to takes it, once: a command
  that a handler runs in process never sees it.
- **Only on one command, on the modern era.** A retry carrying the key in `afd-batch`, `afd-pipe`
  or a 2025-era request fails with `APPROVAL_REQUIRED` before anything runs, as host-verified
  confirmation's step 1 refuses those calls.

### Everyone else

- **The key is ignored,** without saying so: the call runs as if it was never sent,
  and no held result carries a token (rule 6 holds).
- **The key is never input.** A `tools/call` whose arguments hold an object key `dev.afd/approval`
  at any depth, including in a meta-tool's `meta` argument, fails with `VALIDATION_ERROR` before
  anything else runs, from any caller, approvers included. A refusal rather than a silent removal
  makes a client that tries it visible. Loam's kernel applies the same rule to every input it is
  given (its 7.2).

### The binding

Rule 4 of 7.2 binds an approver's token to its credential. The token keeps its format; what its
`a` digest covers changes:

| Token issued to | `a` is the keyed digest of |
| --- | --- |
| Any caller (unchanged) | `actor\0` and the actor JSON |
| An approver | `principal\0` and the call's principal binding (M8), the canonical JSON of `{ actor, credentials }` |

Verification follows the evidence: a token presented on an approver's call (its key, or the
`approval` a host set on that call's context) is checked against the call's principal binding, and
a mismatch is `credentials-mismatch`; any other call checks the actor as before, so an approver's
token presented there is `actor-mismatch`. Command, input, expiry and single use are unchanged.

**Why not a new payload field.** A field such as `"p"` would leave older verifiers, and the
languages without the carrier, ignoring it: an approver's token copied into another caller's
context would pass as the actor's. Folding the binding into `a` makes every verifier that does not
know it refuse, with `actor-mismatch`. The token's format, its vectors and its 1024-character limit
stay as they are.

### What an approver promises

A server cannot check these; the approver role is a promise the deployer makes for that client:

- it never gives the token to an agent or a model, and never puts it in a log, store or result;
- it presents a token only on a retry that a person approved after seeing the action;
- it shows the action by the display rules below.

How much this proves is the deployment's: against an agent behind another client it is a human
gesture; against a program running as the same operating-system user, nothing more than the
credential it can read (Loam's T15).

### Display rules

What a person must be able to read in full before approving, from Lushly's `approval-display.ts`
(at `7ffae684`, 2026-11-03), rewritten here. An approver measures the action's input, and shows it
only when every rule holds; otherwise it shows nothing of it and says why:

| Rule | Limit | Refusal |
| --- | --- | --- |
| Plain JSON (approvals' rule 3) | | `not-json` |
| The canonical JSON, in UTF-16 code units | 8000 | `too-long` |
| Values, counting the input itself | 400 | `too-many-values` |
| Depth: the input is 0, its members 1 | 6 | `too-deep` |
| A string, in UTF-16 code units | 2000 | `string-too-long` |
| An object key, in UTF-16 code units | 200 | `key-too-long` |
| A string or key holding a hidden code point, or six or more combining marks in a row | | `hidden-characters` |

The hidden code points are those that make what a person reads differ from what runs, or draw
nothing: C0 and C1 controls but tab and newline, the soft hyphen, the combining grapheme joiner,
the Arabic letter mark, the Hangul and Khmer fillers, Mongolian selectors, zero-width characters
and directional marks, line and paragraph separators, bidirectional embeddings, overrides and
isolates, invisible operators, the braille blank, variation selectors other than U+FE0E and U+FE0F
(text and emoji presentation), the byte order mark, the halfwidth Hangul filler, interlinear
annotations and the unassigned specials before them, shorthand format controls, musical symbol
format controls, tags and the reserved ignorables, and unpaired surrogates. The spec lists them by
range.

Differences from Lushly's code, each for the four languages:
- sizes are measured on the canonical JSON, not on the input's own key order, so every language
  gets the same answer;
- the checks run in a fixed order (the whole size first, then depth first through keys in
  canonical order) and return the first refusal by name, where Lushly returned no reason;
- "nodes" are named values.

`afd-core` exports `approvalDisplay(input)`, `hidesCharacters(text)`, `isHiddenCodePoint(code)`
and `APPROVAL_DISPLAY_LIMITS`; the `afd` crate exports the same as `approval_display`,
`hides_characters`, `is_hidden_code_point` and `APPROVAL_DISPLAY_LIMITS`.

## Decisions made here

The phase 5 specification fixed the carrier's rules. These details were left to this proposal:

| # | Decision | Why |
| --- | --- | --- |
| A1 | The binding is carried in `a`, under the tag `principal` | Older verifiers fail closed; no format change |
| A2 | The key in tool arguments is refused at any depth, from every caller | 7.2's "refused by strict validation"; a refusal is visible |
| A3 | A non-approver's key is dropped without a word | It learns nothing about who is an approver |
| A4 | An approver's call never elicits an approval, even for a batch | 7.2: the token takes precedence over the relay |
| A5 | Unbindable credentials, or a failing predicate, are internal errors | M8's rule; fail closed |
| A6 | Display rules land in Rust as well as TypeScript, with named refusals | Step 0c is Rust and TypeScript; named refusals make the vectors language-neutral |

## Conformance

`spec/vectors/approver-client.json` holds two sections, the display verdicts from the
TypeScript reference and the token payloads built from the documented format:

- `display`: inputs and their verdict, a case for each rule and each hidden range;
- `carrier`: one MCP server per case with a held command and three callers, two of them
  approvers, and the calls of 7.2's rules 2 to 5 with what each must return, including each
  token's payload and its `a` digest.

Each language's own tests cover what the shared cases cannot: a 2025-era request, a failing
predicate and unbindable credentials. An expired token is the existing verification's, which the
approval token vectors already cover.

Python and C++ load the file, and each skips its cases as the documented gap, naming the parity
issue, until it implements them.

## Parity

Python and C++ get the same subsection, as AFD's parity rule requires:
[#1466](https://github.com/lushly-dev/afd/issues/1466). Python has an MCP server and the relay
already; C++ serves `afd::mcp_stdio`, whose single connection has no credentials, so its approver is
the stdio peer a host names.

## Out of scope

- **An approval link store** ("approve by link", Lushly's `approval-links/`): milestone C's
  amendment, when connected agents first need a person's approval (D150).
- **Approvals through Loam's hosted relay:** milestone C.
- **Loam's part of 7.2** (`approvals = "shell"`, the preview, the hold): Loam's step 5.
