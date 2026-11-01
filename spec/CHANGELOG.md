# AFD contract changelog

The AFD contract is what every implementation must agree on so that an agent sees the same results
from TypeScript, Python, Rust and C++. Its version is in [`VERSION`](./VERSION). The contract
version is separate from each implementation's own package version.

## Scope

- [`wire/`](./wire/README.md): the golden wire fixtures;
- [`pipeline-variables.md`](./pipeline-variables.md), [`validation.md`](./validation.md),
  [`execution-controls.md`](./execution-controls.md) and the
  behavior vectors in [`vectors/`](./vectors/README.md);
- the todo conformance suite (`packages/examples/todo/spec`, run by `conformance.yml`).

- [`journal.md`](./journal.md): the command journal format and replay rules, with the fixture
  `wire/journal.jsonl` (all four implementations);
- [`error-codes.md`](./error-codes.md): the shared error-code catalog, checked by
  `vectors/error-codes.json`, and the rules for unknown and unexposed commands.
- [`context-fields.md`](./context-fields.md): declared context fields, request values a host
  declares, validated on every surface and kept by the journal when declared `journal: true`;
- [`tool-strategies.md`](./tool-strategies.md): the MCP tool strategies (`individual`, `grouped`,
  `lazy` and `hybrid`), their tool lists, routing, contexts and cache hints, with the meta-tool
  definitions in [`meta-tools.json`](./meta-tools.json) and the hybrid cases in
  [`tool-strategies.json`](./tool-strategies.json).
- [`mcp-resources.md`](./mcp-resources.md): MCP resources, the Skills over MCP extension, extra
  `_meta` entries on a command's tool, and advertised input schemas apart from validation schemas,
  with the cases in [`mcp-resources.json`](./mcp-resources.json).

The bounded TypeScript/Python protocol acceptance inventory is recorded in
[`protocol-conformance.md`](./protocol-conformance.md); it does not claim full MCP certification.

## Version format

`MAJOR.MINOR`.

- **Minor:** an additive change that breaks nothing. Examples: a new optional field, a new error
  code, or a new vector for existing behavior.
- **Major:** an existing fixture or vector changes, or a wire field is removed or renamed.
- **1.0** is declared once every language loads every vector file. Until then the version is
  `1.0-rc`.

## Where the version appears

| Implementation | Constant |
|---|---|
| TypeScript | `AFD_CONTRACT_VERSION` from `@lushly-dev/afd-core` |
| Python | `afd.CONTRACT_VERSION` |
| Rust | `afd::CONTRACT_VERSION` |
| C++ | `afd::contract_version` (`afd/version.hpp`) |

The `afd-help` bootstrap command returns it as `contractVersion` in TypeScript, Python and Rust. C++
has no bootstrap commands yet. The Contract column of the root `README.md` and the Contract row of
`docs/language-parity.md` show it as well.

## Changing the version

In the same pull request:

1. Change `VERSION` and add an entry below.
2. Update the four constants.
3. Update the Contract column in `README.md` and the Contract row in `docs/language-parity.md`.

`node scripts/check-versions.mjs`, which `pnpm check` runs, fails until all of these agree.
`alfred parity` reports a constant that differs from `VERSION`.

## 1.0-rc

[`mcp-resources.md`](./mcp-resources.md) specifies four opt-in additions to AFD MCP servers (Umbel
decision D47, shared with Loam): MCP resources from a provider, listed in one stable page with the
`tools/list` TTL and `cacheScope: "public"` on the result, read with `-32602` for an unknown URI on
both eras, and digested under `_meta["dev.afd/digest"]`; the Skills over MCP extension
(`io.modelcontextprotocol/skills`, SEP-2640) from a skill catalog fixed at construction, with
`skills/list`, `skills/get`, every skill file as a resource and optional directory reads; a command's
`toolMeta`, extra tool `_meta` entries under reverse-DNS keys or MCP Apps' `ui`; and an advertised
input schema kept apart from the one the registry validates with. `command-metadata.md` gains the
`toolMeta` field and the advertised schema. It is additive: no existing fixture, vector, error code or
result changes, and no language implements it yet. Its cases are in `mcp-resources.json`, which joins
`vectors/` once all four languages load it.

[`vectors/journal-context-cap.json`](./vectors/journal-context-cap.json) pins the journal's 4096-byte
cap on a declared context field's value for existing behavior (#578): 19 values just at, under and
over the cap, where JavaScript's number spelling, multibyte UTF-8 or escaped characters decide whether
a value is kept or omitted. All four languages load it. Rust measured with serde's number spelling and
C++ measured an integer beyond 2^53 as written; both now measure as JavaScript writes the value. No
fixture, wire field or error code changes.

In-process context scoping (#527, part 3): TypeScript's `createDirectRegistry` takes the active
context of each call as a call option, refusing an unknown name with `CONTEXT_NOT_FOUND`
([`error-codes.md`](./error-codes.md#contexts)), and with `createDirectToolSurface` lists and routes
the same tools as an MCP server ([`tool-strategies.md`](./tool-strategies.md), H8). Its suggestions
name `afd-discover` and the context tools only where that surface serves them. No fixture, vector or
wire field changes.

[`context-fields.md`](./context-fields.md) specifies declared context fields (#528): a host declares
a field's context name, `_meta` key, schema, `journal` and `required` flags, and AFD validates the
value before middleware runs, failing an invalid or missing required one with `VALIDATION_ERROR`.
Journal entries gain the optional `context` and `contextOmitted` ([`journal.md`](./journal.md#declared-context-fields)):
the values of fields declared `journal: true`, capped at 4096 bytes each, which replay restores.
The hash of an entry without them is unchanged, so `wire/journal.jsonl` keeps its first four lines
and gains two, with a kept and an omitted field. TypeScript, Python, Rust and C++ implement the
declaration and the journal; `_meta` delivery over MCP and discovery follow.

[`vectors/approval-tokens.json`](./vectors/approval-tokens.json) pins the approval token format
for existing behavior (#458): canonical JSON, the keyed digests and payload layout of 11 calls, and
31 verification cases covering single use, expiry, each mismatch and the order they are checked in,
key rotation, changed and respelled MACs, and malformed tokens. `command-metadata.md` now states the
token layout. All four languages load the file; no token, result or error code changes.

[`tool-strategies.md`](./tool-strategies.md) specifies the MCP tool strategies. It records the
individual, grouped and lazy strategies as TypeScript, Python and Rust serve them, with the
TypeScript/Python differences in their lists as current behavior until #533 decides them, and adds
the `hybrid` strategy: the five meta-tools, the context tools when contexts are configured, then at
most 8 first-class command tools named by a server option, in a list that does not vary by context
and keeps the default `ttlMs` under contexts. `afd-help` gains `toolStrategy` on every strategy and
`firstClassTools` and `firstClass` on hybrid servers. The change is additive: no existing fixture,
vector, error code or result changes, and no language serves the hybrid strategy yet. Its cases are
in `tool-strategies.json`, which joins `vectors/` once all four languages load it.

Stabilization resolves validation ordering and issue caps (#332), pins the UTF-16 pipeline reference
boundary (#283), accepts fractional timeouts (#329), lets in-flight work finish after `stopOnError`
(#330), and stops scheduling queued work after caller cancellation (#363). The existing
`COMMAND_CANCELLED` code describes unstarted cancelled work; no wire shape or public JSON type changes.
The contract remains a release candidate while all languages are being aligned.

`ResultMetadata` gains the optional `actorKind` (`human`, `agent`, `service`, `script` or `test`):
the kind of principal that called the command (#271). It is additive. The fixtures now carry
`"actorKind": "agent"`, which the TypeScript server stamps on MCP calls; the other languages
round-trip it as extra metadata until they stamp it themselves.

The shared catalog gains `CONFIRMATION_REQUIRED` and `CONFIRMATION_DECLINED`, for servers that
enforce `confirmPrompt` (`command-metadata.md`, "Confirmations"). Enforcement is opt-in and off by
default, so no existing result changes. Python and Rust gain the `destructive`, `confirm_prompt`
and `undoable` command fields.

Commands gain the `approval` field (`required`, `not-required` or a function; `not-required` by
default), reported as `_meta.approval`, and the shared catalog gains `APPROVAL_REQUIRED` (45
codes), returned by the approval middleware before the handler runs (`command-metadata.md`,
"Approvals"; #272). The middleware is opt-in, so no existing result changes. TypeScript implements
it; the other languages define the code.

The command journal (#273, TypeScript only for now): a JSON Lines record of executed commands,
with a context digest that keeps no secrets and a tape of clock and random values for replay
(`journal.md`, fixture `wire/journal.jsonl`). It is additive; no existing shape changes.

The first versioned contract. It covers:

- the six fixtures in `wire/`: minimal, full and failed `CommandResult`, `BatchResult`,
  `PipelineResult` and the four `StreamChunk` kinds;
- the pipeline variables in `pipeline-variables.md`, with 51 references and 27 conditions in
  `vectors/pipeline-variables.json`;
- the batch and pipeline execution controls, with 24 batch and 25 pipeline cases in
  `vectors/batch-controls.json`;
- the 34 cases of the todo conformance suite;
- command input validation in `validation.md`, with 34 cases and 130 tests in
  `vectors/validation.json`. Its former open questions are settled in `validation.md`;
- the 45 codes of the shared error-code catalog in `error-codes.md` and
  `vectors/error-codes.json`, and its rules for unknown and unexposed commands (D4).

Every language round-trips the wire fixtures, loads `vectors/pipeline-variables.json`,
`vectors/batch-controls.json` and `vectors/error-codes.json`, and passes the conformance suite.
Only TypeScript loads `vectors/validation.json` so far. The contract stays at `1.0-rc` until every
language loads the validation vectors (#310, #311, #312).
