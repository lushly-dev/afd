# Output budgets

> **Goal**: a command can bound the size of its result. It declares a budget, a caller asks for
> a smaller or larger one per call, the handler fits its result to it, and the engine checks the
> result afterwards: an over-budget read becomes a failure that says how to narrow the request, and
> an over-budget mutation keeps its result with a warning. Nothing truncates structured output.
> Specified once in [`spec/output-budgets.md`](../../../../spec/output-budgets.md), then implemented
> in Rust first (for Umbel), then TypeScript, Python and C++.

| Field | Value |
|---|---|
| Status | Approved 2026-11-01 under the owner's delegation of 2026-10-31: the owner approved this direction with the [Umbel phase 2 specification](../../../../endpoints/umbel/docs/phases/2-knowledge/spec.md#step-0-afd-first-d25-d64) (decision D64), merged in [#625](https://github.com/lushly-dev/afd/pull/625) as `e996aad1`. Spec step written in the pull request that adds this file; no language implements it yet. Progress is in [STATUS.md](STATUS.md) |
| Author | jasfalk (drafted with Claude) |
| Requested by | [Umbel](../../../../endpoints/umbel/docs/STATUS.md), decision [D64](../../../../endpoints/umbel/docs/decisions.md) and step 0a of its [phase 2 plan](../../../../endpoints/umbel/docs/phases/2-knowledge/spec.md#step-0-afd-first-d25-d64): the knowledge plugin's search, open and graph commands can return arbitrarily large results, and Umbel's principle 12 asks for small, measured surfaces. Under Umbel's D25 it lands in AFD, spec first, for every language |
| Packages | `spec/`, `packages/core`, `packages/server`, `packages/client`, `python/`, `packages/rust`, `packages/cpp` (with the todo backends) |
| Related | [Declared context fields](../../complete/declared-context-fields/proposal.md), whose plumbing the ask reuses; [MCP resources, skills and tool `_meta`](../mcp-resources-skills/mcp-resources-skills.proposal.md), whose key rule keeps `dev.afd/` keys AFD's and whose shape this follows; [Hybrid tool strategy](../hybrid-tool-strategy/hybrid-tool-strategy.proposal.md); [Language parity](../../../language-parity.md) item D2 (C++ `afd::mcp_stdio`, [#341](https://github.com/lushly-dev/afd/issues/341)) |

## Problem

An agent pays for every byte a tool returns, in context and in money, and a large result can push
out what the agent needed to keep. A command often cannot know in advance how much it will return:
a search with many hits, a window into a long document, an outline of a large file. Today AFD gives
a command no way to say how much is acceptable, a caller no way to ask for less or more, and the
engine no way to notice when a result is too large.

The usual fix, cutting the text at a limit, is wrong for AFD: a `CommandResult` is structured, MCP
2026-07-28 requires `structuredContent` to conform to a tool's `outputSchema`, and half a JSON value
conforms to nothing. The [build-mcp-servers](../../../../.claude/skills/build-mcp-servers/SKILL.md)
skill already says to bound prose output without truncating structured output. What is missing is
the mechanism.

## How engines behave today

Read from the code on `main` at `e996aad1`, 2026-11-01.

No language has an output budget: no declaration, no per-call ask, no size check and no truncation
of command results. A search of `packages/server/src`, `packages/core/src`, `packages/client/src`,
`python/src/afd`, `packages/rust/src`, `packages/cpp` and the C++ todo backend for `budget`,
`truncat`, `maxBytes` and `max_bytes` finds only unrelated limits: request bodies
(`readJsonBody(req, maxBytes)` in `http-security.ts`), the grouped tool's 8,192-character inline
schema budget (`GROUPED_PARAMS_SCHEMA_BUDGET` in TypeScript `tools.ts` and Rust
`server/strategy.rs`), `afd-discover`'s 120-character descriptions (`lazy-tools.ts`), name
truncation in error messages (`truncateName`), the journal's 4096-byte context cap and tape limit,
the rate limiter, Python's stream timeout budget, and C++'s 16 MiB JSON parse limit
(`afd/json.hpp`). None touches a result.

What the spec builds on, per language:

| Concern | TypeScript | Python | Rust | C++ |
|---|---|---|---|---|
| Where a handler's result first exists | `runHandler` in `executeCommand` (`packages/server/src/execution.ts`), the innermost link of the middleware chain, which stamps `executionTimeMs`, `commandVersion`, `traceId` and `actorKind` right after the handler | `_run_handler` (`python/src/afd/server/factory.py`), innermost, stamps the same | The innermost link of `middleware_chain` in `CommandRegistry::execute` (`packages/rust/src/commands.rs`), which stamps `actorKind` only | `run_handler` inside `run_chain` (`packages/cpp/src/registry.cpp`), innermost, stamps the same four as TypeScript |
| Journal | Recording middleware, which sees what the inner chain returns | `create_journal_middleware` | A registry-level recorder that starts before the chain and finishes after it, outside every middleware | `create_journal_middleware` |
| Declared context fields read from `_meta` and the `meta` argument, validated before middleware | Yes, every MCP route and the AFD HTTP lanes | Yes, every MCP route | Yes, every MCP route, after the context hook | In process only (no MCP server, #341) |
| Request values applied to every batch item and pipeline step | Yes | Yes | Yes | Yes (in process) |
| `mutation` on the definition | Optional boolean | Boolean | Boolean | Boolean |
| A canonical-JSON byte measure | The journal's context cap (`spec/vectors/journal-context-cap.json`, loaded by all four) | Same | Same | Same |

What follows for the spec:

- **Every engine has one innermost point after the handler** where it already stamps `metadata`.
  B5 puts the check there, so every surface (MCP routes, batch items, pipeline steps, the HTTP
  lanes, `DirectClient`, in-process calls) gets it once, and every journal, Rust's recorder included,
  records the checked result.
- **Engines stamp different `metadata`** (Rust stamps only `actorKind`), so measuring it would give
  four different sizes for the same result. B5 measures the result without `metadata`.
- **All four languages already measure canonical JSON the same way** for the journal's context cap,
  so B5 reuses that measure instead of defining a new one.
- **The declared-field plumbing exists everywhere** it is needed: the ask rides on it (B2) rather
  than adding a second path through every router.

## Proposal

[`spec/output-budgets.md`](../../../../spec/output-budgets.md) carries the normative rules, B1 to
B8. This section explains the choices.

### Declare, ask, fit, check

A command declares `outputBudget: { defaultBytes, maxBytes }` (B1). The declaration is reported
where an agent plans: on the command's tool as `_meta["dev.afd/outputBudget"]`, in its grouped
action entry and in `afd-detail`. A caller asks for `{ maxBytes }` per call (B2); the effective
budget is `min(ask, maxBytes)`, or `defaultBytes` without an ask (B3). The handler reads it from its
context (B4) and fits its result **structurally**: fewer hits, shorter excerpts, a smaller window
with a cursor to read on. The engine's check (B5) is the backstop for a handler that did not, or
could not.

Bytes, not tokens: every language can count bytes the same way, and tokens depend on the model.

### What happens over budget

- **A read** (`mutation` unset or `false`) is replaced by an `OUTPUT_BUDGET_EXCEEDED` failure with
  `limitBytes`, `actualBytes` and `maxBytes` in its details, and a suggestion that says either to
  narrow the request or to ask for up to `maxBytes`. Nothing was changed, so asking again is cheap,
  and a failure is something an agent knows how to act on. An oversized result the agent cannot use
  would cost the same context as the problem the budget exists to prevent.
- **A mutation** keeps its result and gains an `OUTPUT_BUDGET_EXCEEDED` warning. The change was
  made; replacing the result with a failure would tell the agent it was not, and a retry would make
  the change twice.
- **A handler's own failure** passes unchanged: its error is what the agent needs, and replacing it
  would hide the cause.

### The ask reuses the context-field plumbing

The ask is read from `_meta["dev.afd/outputBudget"]` exactly where declared context fields are read,
including the meta-tools' `meta` argument for clients that cannot set `_meta`, and in process from a
call option. It is validated at the same point, fails with the same `VALIDATION_ERROR`, loses to a
value trusted code sets, and applies per item in `afd-batch` and per step in `afd-pipe`. It is not a
declared context field, because AFD fixes its key, shape and meaning; a host does not declare it.

### The key carries three shapes

`dev.afd/outputBudget` is the declaration on a tool's `_meta`, the ask on a call's `_meta`, and the
report in a result's `metadata`. They live in three different objects and never meet, and one key
lets an agent connect them. `dev.afd/` is AFD's prefix; the
[key rule](../../../../spec/mcp-resources.md#t2-the-key-rule) already refuses it in a command's
`toolMeta`, so no command can forge the declaration.

### Measured without `metadata`

The check measures the canonical JSON of the result without `metadata`, the same canonical JSON the
journal's context cap uses. The handler controls everything it measures, the four engines agree on
the number, and the measure does not depend on how long the call took (`executionTimeMs`) or on the
report it is about to add.

### Journaled

A journal entry records the effective budget as `outputBudget`, and replay restores it as the ask,
so a replayed call gets the same budget and the same check (B8). An entry without a budget hashes
exactly as before.

## Spec changes, landing before any language

This pull request:

| File | Change |
|---|---|
| New [`spec/output-budgets.md`](../../../../spec/output-budgets.md) | B1 to B8, options, conformance and implementation status |
| New [`spec/output-budgets.json`](../../../../spec/output-budgets.json) | Hand-written cases: 12 declarations, 19 asks, 10 measured sizes, 11 checks, a four-item batch and 3 journal cases. Beside `mcp-resources.json`, not in `vectors/`, until all four languages load it |
| [`spec/command-metadata.md`](../../../../spec/command-metadata.md) | The `outputBudget` field in [Fields](../../../../spec/command-metadata.md#fields) and [Surfaces](../../../../spec/command-metadata.md#surfaces) |
| [`spec/context-fields.md`](../../../../spec/context-fields.md) | `outputBudget` reserved as a context name; the `meta` argument accepts `dev.afd/outputBudget` |
| [`spec/journal.md`](../../../../spec/journal.md) | The optional `outputBudget` entry field, its place in the context digest and its replay |
| [`spec/error-codes.md`](../../../../spec/error-codes.md) | `OUTPUT_BUDGET_EXCEEDED`, specified and not yet in the catalog (below) |
| [`spec/protocol-conformance.md`](../../../../spec/protocol-conformance.md) | Three acceptance rows, all Planned |
| [`spec/CHANGELOG.md`](../../../../spec/CHANGELOG.md) | An entry under `1.0-rc`, and the new page in the scope. `spec/VERSION` stays `1.0-rc`: additive changes during the release candidate are recorded under it, as the hybrid strategy's and resources' were, and `scripts/check-versions.mjs` checks only that the four constants equal `VERSION` |
| [`docs/language-parity.md`](../../../language-parity.md) | Two rows, Planned in every language |

No wire fixture, existing vector or tool list changes. [`meta-tools.json`](../../../../spec/meta-tools.json)
does not change either: its `meta` description stays as it is until every language accepts the key
(see [choices](#choices-this-proposal-made)). The 34-case todo conformance suite does not change.

## Implementation plan

| Step | Language | Work | Size | Depends on |
|---|---|---|---|---|
| 0 | `spec/` | This pull request | M | Owner approval (given through D64) |
| 1 | Rust | Umbel phase 2 step 0b: `CommandDefinition::with_output_budget`, `CommandContext::output_budget()` and `with_output_budget_ask`, the ask on every MCP route and the `meta` argument, the check in the innermost link of `CommandRegistry::execute`'s chain, the report, the journal field and replay, `afd-detail` and tool `_meta`; `OUTPUT_BUDGET_EXCEEDED` added to the shared catalog, `vectors/error-codes.json` and the constant in all four languages (one line each, which the catalog rule requires in one pull request); `tests/output_budget.rs` loading `output-budgets.json` over stdio and Streamable HTTP in both eras and in process; CHANGELOG, parity rows, `afd-rust` skill. With it, the public frontmatter reader Umbel also needs | M | Step 0 |
| 2 | TypeScript | `defineCommand({ outputBudget })`, `context.outputBudget`, the call option on `createDirectRegistry` and `DirectClient`, the check in `runHandler`, every MCP route and HTTP lane, the journal; loader; changeset; `/direct` budgets kept | M | Step 1 (the error-code constant) |
| 3 | Python | `output_budget=` on the decorator, `context.output_budget`, the check in `_run_handler`, the routes, the journal; loader | M | Step 1 |
| 4 | C++ | `CommandDefinition::output_budget`, the check in `run_handler`, the in-process ask, the journal; MCP after parity D2 ([#341](https://github.com/lushly-dev/afd/issues/341)); loader | M | Step 1 |
| 5 | All | Move `output-budgets.json` into `vectors/`; the `meta` description in `meta-tools.json` names `dev.afd/outputBudget` in every language at once; conformance rows filled; skills document the option | S | Steps 1 to 4 |

Steps 2, 3 and 4 can run in parallel after step 1. Step 1 is the one Umbel needs; the others do not
block it, as for the hybrid strategy.

## Acceptance

- Each language loads `spec/output-budgets.json` and matches it.
- A command without a declaration lists the same tool and returns the same result as before, byte
  for byte, with or without an ask.
- On each language's server, over stdio and Streamable HTTP in both eras: a budgeted command's tool
  carries `_meta["dev.afd/outputBudget"]`; a `tools/call` with `_meta["dev.afd/outputBudget"]`
  reaches the handler as the effective budget; an over-budget read is an `OUTPUT_BUDGET_EXCEEDED`
  tool result with `isError: true`; an invalid ask is a `VALIDATION_ERROR` tool result naming
  `dev.afd/outputBudget`; the same through `afd-call`'s `meta` argument and per item through
  `afd-batch`.
- A journal of a budgeted call holds `outputBudget`, and its replay is `same`.

## Rollback

Every part is opt-in and additive. A command that declares nothing never changed. Removing the
feature is a minor change per language.

## Out of scope

- Budgets on streamed chunks (B7). A streaming command can bound its own chunks.
- Token budgets, or budgets that depend on the model or the client.
- Truncation, summarisation or elision by the engine, in any form.
- A server-wide default budget for commands that declare none. A host that wants one can set the
  declaration on every command it registers.
- Budgets on resources and `skills/get`, which return content a server already decided to publish
  ([R4](../../../../spec/mcp-resources.md#r4-resourcesread)).
- Mounted MCP servers' tools in Umbel, which carry no AFD declaration; phase 2 of Umbel budgets
  compiled plugins only.

## Choices this proposal made

The phase 2 plan of Umbel fixed the shape (D64 and its revision N10). It left these open; each is
recorded here and in the spec.

1. **Where the check runs:** in the innermost link of the middleware chain, before the engine
   stamps `metadata`, rather than "in the server" (B5). Every surface then gets it, in-process calls
   included, and every journal records the checked result. The plan said "the server measures"; this
   is the same check, placed where all four engines can do it once.
2. **What is measured:** the canonical JSON of the result without `metadata`, using the journal's
   canonical form (B5).
3. **Failures pass unchanged** and get no report; only successful results are checked (B5).
4. **The replacement failure's details add `maxBytes`** to the plan's `limitBytes` and
   `actualBytes`, so an agent can ask for the most it may without another `afd-detail`; the
   suggestion has two fixed texts, one when the call can ask for more and one when it cannot (B5).
5. **The mutation warning** has severity `caution`, is appended after the handler's own warnings,
   and is not counted in the measure (B5).
6. **An ask to a command with no declaration** is validated and then ignored, so one ask covers a
   mixed batch (B2).
7. **Ask bounds:** integers from 1 to 2^53 − 1, with no other member; the same bounds for the
   declaration (B1, B2). An ask above `maxBytes` is clamped, not refused (B3).
8. **The journal field** holds the effective budget as an integer, `outputBudget`, after
   `contextOmitted`; it joins the context digest only when present, and replay restores it as the
   ask (B8).
9. **`OUTPUT_BUDGET_EXCEEDED` is listed but not yet catalogued.** The shared catalog requires a new
   code's constant in all four languages in one pull request, which a documents-only pull request
   cannot add. The code is specified in [`error-codes.md`](../../../../spec/error-codes.md#specified-not-yet-in-the-catalog)
   and joins the catalog in step 1, which adds the four constants.
10. **`meta-tools.json` is unchanged** until step 5. TypeScript and Rust compare their meta-tool
    definitions with it byte for byte, so changing the `meta` description now would fail their
    tests before either implements the ask; the rule that `meta` accepts the key is in the spec
    from now on.
11. **Streams are not checked** in this version (B7).
12. **The proposal lives in `active/`**, not `proposed/` as the phase 2 plan wrote, because it is
    approved through D64, as the resources proposal was through D47.
