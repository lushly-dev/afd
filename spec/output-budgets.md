# Output budgets

How a command bounds the size of what it returns: a command **declares** a budget, a caller **asks**
for a smaller or larger one per call, the handler **fits** its result to the effective budget, and
the engine **checks** the result afterwards. An over-budget read becomes a failure that tells the
agent how to narrow its request; an over-budget mutation keeps its result, with a warning, because
the work is done. **Nothing truncates structured output.** A command without a budget is unchanged.
Which languages implement it is in [Implementation status](#implementation-status).

Every rule here is new and normative. **MUST**, **MUST NOT**, **SHOULD** and **MAY** are used as in
RFC 2119. The [output budgets proposal](../docs/features/active/output-budgets/output-budgets.proposal.md)
explains why, records the choices this page makes, and tracks progress in its
[status](../docs/features/active/output-budgets/STATUS.md). Every AFD server is dual-era
([protocol conformance](./protocol-conformance.md#eras)): unless a rule names an era, it holds on
both.

MCP 2026-07-28 sets no size limit on a tool result and says nothing about truncation. It requires a
server that advertises an `outputSchema` to return `structuredContent` that conforms to it, which a
truncated result would break; the failure B5 returns conforms to AFD's envelope schema
([Structured results](./command-metadata.md#structured-results)), whose only required member is
`success`.

## Terms

| Term | Meaning |
| --- | --- |
| Declaration | A command's `outputBudget`: `{ defaultBytes, maxBytes }` |
| Ask | A caller's per-call request, `{ maxBytes }` |
| Effective budget | The number of bytes the call's result may use, from the declaration and the ask (B3) |
| Measured size | The length in bytes of a result's canonical JSON, `metadata` left out (B5) |
| Report | `metadata["dev.afd/outputBudget"]`: `{ limitBytes, usedBytes }` on a budgeted result (B6) |

The key `dev.afd/outputBudget` carries three shapes in three places, each fixed below: the
declaration on a tool's `_meta`, the ask on a call's `_meta`, and the report in a result's
`metadata`. They never meet in one object, so a reader always knows which it holds.

## B1. The declaration

A command MAY declare `outputBudget: { "defaultBytes": d, "maxBytes": m }`.

- `d` and `m` MUST be integers with `1 ≤ d ≤ m ≤ 9007199254740991` (2^53 − 1), and the object MUST
  have no other member. Anything else fails when the command is defined or registered, with an error
  naming the command and the field; it is a construction error, not a `CommandError`.
- The declaration is part of the command's definition: fixed while the server runs, the same for
  every caller and context.

It surfaces as follows; unset is omitted, as the
[reporting rules](./command-metadata.md#reporting-rules) require:

| Where | Emitted |
| --- | --- |
| A command tool: the individual strategy, and the first-class tools of the hybrid strategy | `_meta["dev.afd/outputBudget"] = { "defaultBytes", "maxBytes" }` |
| A grouped tool | The same entry in the command's entry of `_meta.actions`, with the other per-command `_meta` fields, where the language emits `_meta.actions` |
| `afd-detail` | `outputBudget: { "defaultBytes", "maxBytes" }`, on every strategy |
| afd-help (`full`), afd-docs | `outputBudget`, where the language reports the other planning fields there; MAY be omitted |
| Meta-tools, context tools, the grouped tool itself, afd-discover | Never |

A command's `toolMeta` can never supply this entry: the [key rule](./mcp-resources.md#t2-the-key-rule)
refuses every key under `dev.afd/`. A hybrid first-class tool still equals the individual tool for
the same command ([H3](./tool-strategies.md#h3-the-tool-list-and-its-order)), this entry included.

## B2. The ask

A caller asks for a budget per call with `{ "maxBytes": n }`, where `n` is an integer with
`1 ≤ n ≤ 9007199254740991` and the object has no other member. The ask reuses the plumbing of
[declared context fields](./context-fields.md): it is read from the same places, at the same point
in dispatch, with the same precedence, and fails the same way.

- **MCP `tools/call`, both eras, stdio and HTTP.** `params._meta["dev.afd/outputBudget"]`.
- **AFD's HTTP lanes** (TypeScript `/message`, `/rpc`, `/batch` and `/stream`): from `_meta` where
  [Values](./context-fields.md#values) says each lane reads it.
- **The meta-tools' `meta` argument** (`afd-call`, `afd-batch`, `afd-pipe`): `meta` accepts the key
  `dev.afd/outputBudget` beside `dev.afd/context` and the declared fields' keys, applied as if sent in
  `_meta`, with the same rule for a key sent in both places (the same JSON value, or
  `VALIDATION_ERROR` with `details: { "meta": "dev.afd/outputBudget" }`). On `afd-discover` and
  `afd-detail` it has no effect, as a declared field has none.
- **In process.** A call option on the language's registry and `DirectClient` (see
  [Options](#options)), standing for `_meta`.

`null`, absent, or a call to a command with no declaration: no ask. An ask on a call to a command
without a declaration is validated and then ignored, so one ask can cover a batch of mixed commands.

**Validation.** The ask is validated before middleware and the handler run, on every surface, as a
declared context field's value is. An invalid ask fails the call with `VALIDATION_ERROR`, whose
`details` are `{ "field": "outputBudget", "meta": "dev.afd/outputBudget" }` and whose suggestion
gives the expected shape, `{ "maxBytes": <positive integer> }`. No new error code is added for it.

**Trusted code wins.** A value the host's own code sets (TypeScript `createContext`, Rust's context
hook, or the in-process caller) is never overwritten by a value from `_meta`. The ask is never read
from HTTP headers.

**Lists do not vary.** An ask never changes `tools/list`, `server/discover` or their cache hints.

**Trust.** An ask is a claim by the caller, like a declared field ([Trust](./context-fields.md#trust)).
It can only move the budget within the bounds the command declared.

The name `outputBudget` (`output_budget` in Python, Rust and C++) joins the
[reserved context names](./context-fields.md#declaration): a host cannot declare a context field
with it.

## B3. The effective budget

For a call to a command with a declaration `{ d, m }`:

- with an ask `n`: `min(n, m)`;
- without an ask: `d`.

A call to a command with no declaration has no effective budget. An ask above `m` is not an error:
it is clamped, and the report's `limitBytes` shows the result.

## B4. The handler fits its output

The engine puts the effective budget in the command context before middleware and the handler run:

| | TypeScript | Python | Rust | C++ |
| --- | --- | --- | --- | --- |
| Effective budget | `context.outputBudget`: `number \| undefined` | `context.output_budget`: `int \| None` | `CommandContext::output_budget() -> Option<u64>` | `context.output_budget`: `std::optional<std::uint64_t>` |

A handler of a budgeted command SHOULD fit its result to the effective budget **structurally**:
fewer items (with a cursor or a warning saying so), shorter excerpts, a smaller window with a way to
read on. It MUST NOT cut a JSON value in the middle, and a result it returns MUST be valid JSON for
its output schema. A handler that cannot fit a result returns it anyway and lets B5 decide.

## B5. The check after the handler

After the handler returns, and before any middleware sees the result, the engine checks it: in the
innermost step of the middleware chain, where every engine already stamps `metadata` after the
handler, and before that stamping. The check runs where the handler runs, so every surface gets it: each MCP route (a command tool, a
grouped tool's action, `afd-call`, each `afd-batch` item and each `afd-pipe` step), the AFD HTTP
lanes, `DirectClient` and in-process registry calls: wherever the engine validates input and
applies declared context fields (TypeScript's core `createCommandRegistry`, which does neither, is
out of scope as it is for context fields). Middleware, the journal recorder and `onCommand`-style
hooks see the result B5 produced.

1. **No effective budget, or a failure.** The result passes unchanged and gets no report. A
   handler's own failure is never replaced: its error is what the agent needs.
2. **Measure.** The measured size is the UTF-8 byte length of the canonical JSON of the
   `CommandResult` with its `metadata` member removed. Canonical JSON is the journal's
   ([Declared context fields](./journal.md#declared-context-fields)): object keys sorted, no
   whitespace, strings escaped as JavaScript's `JSON.stringify` escapes them (only `"`, `\`, control
   characters and lone surrogates; other characters are written as UTF-8), numbers as JavaScript
   writes them. `metadata` is left out because the engine, not the handler, fills most of it, and
   languages fill it differently.
3. **Within budget** (measured size ≤ effective budget): the result passes, with the report (B6).
4. **Over budget, not a mutation** (`mutation` unset or `false`): the result is **replaced** by:

   ```json
   {
     "success": false,
     "error": {
       "code": "OUTPUT_BUDGET_EXCEEDED",
       "message": "The result is <actual> bytes, over this call's output budget of <limit> bytes",
       "suggestion": "<see below>",
       "retryable": false,
       "details": { "limitBytes": <limit>, "actualBytes": <actual>, "maxBytes": <m> }
     }
   }
   ```

   The suggestion is `Narrow the request (fewer results, a smaller window or a filter), or ask for
   up to <m> bytes with _meta["dev.afd/outputBudget"] = { "maxBytes": <m> }.` when `limit < m`, and
   `Narrow the request (fewer results, a smaller window or a filter); <m> bytes is this command's
   largest output budget.` when `limit = m`. The replaced result's `data`, `sources`, `warnings` and
   every other member are dropped; the engine then stamps `metadata` as it stamps any failure.
5. **Over budget, a mutation** (`mutation: true`): the result is **kept** and gains a warning,
   appended after the handler's own:

   ```json
   {
     "code": "OUTPUT_BUDGET_EXCEEDED",
     "message": "The result is <actual> bytes, over this call's output budget of <limit> bytes; the change was made",
     "severity": "caution",
     "details": { "limitBytes": <limit>, "actualBytes": <actual> }
   }
   ```

   and the report. The warning is not counted in the measured size.

An implementation MUST NOT truncate, elide or summarise any part of a result to fit a budget.

## B6. The report

A result that passes B5 with an effective budget carries, in `metadata`:

```json
"dev.afd/outputBudget": { "limitBytes": <effective budget>, "usedBytes": <measured size> }
```

The replacement failure of B5 rule 4 carries no report; its `details` say the same. Over MCP the
report travels in `structuredContent` and in the text content, like the rest of `metadata`.

## B7. Batches, pipelines and grouped tools

The ask applies **per item**, as declared context fields apply to every item and step
([Values](./context-fields.md#values)):

- **`afd-batch`.** One ask, from the request's `_meta` or the `meta` argument, applies to every
  item. Each item's effective budget comes from its own command's declaration (B3), and each item's
  result is checked on its own (B5). A replaced item is a failed item, with the usual consequences
  (`stopOnError`). The batch result as a whole is not measured.
- **`afd-pipe`.** The same, per step. A replaced step is a failed step: the pipeline stops there
  unless the step continues on failure. Only the step results the pipeline returns reach the agent,
  but every step is checked, so a pipeline behaves like the same calls made one by one.
- **Grouped tools and `afd-call`.** The budget is the routed command's.
- **The meta-tools themselves** carry no declaration, and `afd-batch`'s and `afd-pipe`'s envelopes
  are not measured.
- **Streams.** A streamed command's chunks are not checked in this version; B5 applies to a
  command executed without streaming.

## B8. The journal

A journal entry ([`journal.md`](./journal.md#entry)) gains one optional field, written after
`contextOmitted` and before `result`:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `outputBudget` | integer ≥ 1 | no | The call's effective budget. Omitted when the call had none |

The recorded `result` is the one B5 produced. In the context digest, when the entry has
`outputBudget`, the hashed object gains `"outputBudget": <n>` and the context key that holds it
leaves `keys`. An entry without it hashes exactly as before, so existing journals and the fixture
lines keep their hashes.

**Replay** restores `outputBudget` as the call's ask (`{ "maxBytes": <n> }`), so the replayed call
gets the same effective budget unless the command's declaration has since lowered `maxBytes`, in
which case the replayed result can differ and the report shows why.

## Options

| | TypeScript | Python | Rust | C++ |
| --- | --- | --- | --- | --- |
| Declaration | `defineCommand({ outputBudget: { defaultBytes, maxBytes } })` | `@server.command(output_budget=OutputBudget(default_bytes=..., max_bytes=...))` | `CommandDefinition::with_output_budget(default_bytes, max_bytes)` | `CommandDefinition::output_budget` |
| In-process ask | `execute(name, input, context, { outputBudget: { maxBytes } })` on `createDirectRegistry`; `DirectClient` call option `outputBudget` | `DirectClient.call(..., output_budget=n)`; registry `execute(..., output_budget=n)` | `CommandContext::with_output_budget_ask(max_bytes)`; a `DirectClient` call option | `CommandContext::output_budget_ask` |
| Effective budget (B4) | `context.outputBudget` | `context.output_budget` | `CommandContext::output_budget()` | `context.output_budget` |

The Rust names are binding: Umbel's [phase 2 plan](../endpoints/umbel/docs/phases/2-knowledge/spec.md#step-0-afd-first-d25-d64)
builds on them. The other languages' names are proposed; each language's step may adjust the
idiom, never the behavior.

## Error code

`OUTPUT_BUDGET_EXCEEDED` is new: retryable no, emitted by the engine (B5) as a failure for a
read and as a warning for a mutation. It is listed in [`error-codes.md`](./error-codes.md#specified-not-yet-in-the-catalog)
and joins the shared catalog and [`vectors/error-codes.json`](./vectors/error-codes.json), with its
constant in all four languages, in the first pull request that implements this page, as
[Changing this page](./error-codes.md#changing-this-page) requires.

## Conformance

[`output-budgets.json`](./output-budgets.json) pins what a language can get subtly wrong: which
declarations and asks are refused, the effective budget, the measured size (number spelling,
multibyte UTF-8, escapes, `metadata` left out), what B5 does with each result, the per-item rule in a
batch, and the journal field. It is written by hand from this page; every `bytes` value was computed
with Node's `Buffer.byteLength(JSON.stringify(value))` over the parsed value, which is the canonical
length because key order does not change it. Each language's step adds its loader.

It sits beside [`mcp-resources.json`](./mcp-resources.json), not in [`vectors/`](./vectors/README.md),
because `alfred parity` requires every file in `vectors/` to be loaded by all four languages. It moves
to `vectors/` in the pull request that makes the fourth language load it.

The file's sections and what a loader checks:

- **`declarations`:** defining a command with `outputBudget` set to `value` succeeds when `valid` is
  `true` and fails, naming the field, when it is `false`.
- **`asks`:** for the declaration `declaration` (or none when `null`), a call with the `_meta` value
  `ask` (absent when the member is missing) has the effective budget `effective` (`null` for none),
  or fails with `VALIDATION_ERROR` when `effective` is `"VALIDATION_ERROR"`.
- **`measure`:** the canonical JSON of the result parsed from `json`, with `metadata` removed, is
  `bytes` long.
- **`checks`:** a command with `declaration` and `mutation`, whose handler returns `result`, called
  with `ask`, produces `expected` (compared as JSON, with `metadata` compared only on the
  `dev.afd/outputBudget` member, which must equal `expected.metadata["dev.afd/outputBudget"]` or be
  absent when that is absent).
- **`batch`:** an `afd-batch` request with the `_meta` ask runs `items`; each item's result is
  checked as in `checks`, against its own command's declaration.
- **`journal`:** the entry recorded for the call has `outputBudget` equal to `expected` (absent
  when `null`).

## Implementation status

| Rule | TypeScript | Python | Rust | C++ |
| --- | --- | --- | --- | --- |
| Declaration and its surfaces (B1) | Planned | Planned | Yes (Umbel phase 2 step 0b) | Planned |
| The ask over MCP and in process (B2, B3) | Planned | Planned | Yes (step 0b) | Planned (in process; MCP after [#341](https://github.com/lushly-dev/afd/issues/341)) |
| Effective budget in the context (B4) | Planned | Planned | Yes (step 0b) | Planned |
| Check, replacement, warning and report (B5, B6) | Planned | Planned | Yes (step 0b) | Planned |
| Batches and pipelines (B7) | Planned | Planned | Yes (step 0b) | Planned |
| Journal and replay (B8) | Planned | Planned | Yes (step 0b) | Planned |
| Loads [`output-budgets.json`](./output-budgets.json) | Planned | Planned | Yes (step 0b) | Planned |

Rust implements output budgets (Umbel phase 2 step 0b): `packages/rust` `src/output_budget.rs`, with
`tests/output_budget.rs` loading every case of [`output-budgets.json`](./output-budgets.json) in
process and over Streamable HTTP and stdio in both MCP eras. Its one skipped case is the measure
case with a lone surrogate, which a Rust string cannot hold. TypeScript, Python and C++ implement
nothing yet: none has a declaration, an ask, a size check or a truncation of command results. The
proposal's
[current behavior](../docs/features/active/output-budgets/output-budgets.proposal.md#how-engines-behave-today)
records what each does instead.
