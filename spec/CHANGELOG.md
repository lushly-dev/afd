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
- [`output-budgets.md`](./output-budgets.md): per-command output budgets, a declaration, a per-call
  ask in `_meta["dev.afd/outputBudget"]` and the check after the handler, with the cases in
  [`output-budgets.json`](./output-budgets.json).
- [`plugin-manifest.md`](./plugin-manifest.md): the shared plugin manifest, a host-neutral core
  ([`plugin-manifest.core.v1.json`](./plugin-manifest.core.v1.json), with its own version) and the
  contract a host's closed profile meets, with the cases in
  [`plugin-manifest.json`](./plugin-manifest.json).

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

[`authorization.md`](./authorization.md) specifies MCP authorization for AFD servers on HTTP (Umbel
phase 5 step 0a, decision D106): one bearer token in one `Authorization` header, verified by explicit
rules (RFC 9068 JWT access tokens with exactly one audience, the resource; `typ`, the algorithm
list, `kid`, key fit and no `crit` or key references; required claims, skew and a lifetime cap; the
scope claim; certificate binding, with DPoP refused), or by one introspection issuer;
`CommandContext.credentials` (`issuer`, `subject`, `clientId`, `scopes`, `resource`, `expiresAt`,
`issuedAt`, `authTime`, `acr`, `cnf`), never the raw token and redacted in debug output; exact 401
and 403 `WWW-Authenticate` forms and bodies, with rule codes that are logged, never sent; RFC 9728
protected-resource metadata at both well-known URLs; static scopes, a host `ScopeResolver` that
answers `Allowed`, `Missing` or `Defer` per call, a 403 before dispatch that names every missing
scope of a whole batch, and list filtering with `cacheScope: "private"`; and the principal binding.
stdio, the CLI and in-process calls are unchanged. `command-metadata.md` gains `scopes`, `task` and
`confirmationMode: "host-verified"`; binds confirmation and approval-relay `requestState` to the actor
and the credentials' issuer, subject and client ([#532](https://github.com/lushly-dev/afd/issues/532));
specifies the host-verified mode, under which the server gate never sends a form or accepts an
acknowledgement and defers to a `HumanRelay` through URL-mode elicitation; relay evidence, which the
approval middleware accepts once in place of a token (new `details.reason` `credentials-mismatch`);
and MCP Tasks (`io.modelcontextprotocol/tasks`) with a `TaskStore`, an owner check on every
`tasks/*` request and a task that never outlives its token. `error-codes.md` lists
`INSUFFICIENT_SCOPE` and `TASK_TOKEN_EXPIRED` as specified, each joining the catalog with its four
constants in the first pull request that emits it (Rust steps 0b and 0e), so
`vectors/error-codes.json` is unchanged. `tool-strategies.md` notes the private `cacheScope` under
scope filtering. The MCP Authorization and MCP Tasks proposals move to `docs/features/active/`. It is
additive and `VERSION` does not change: no existing fixture, vector or wire field changes, and
nothing changes for a server that does not opt in, except that #532 refuses a confirmation state
presented by another principal, which was a defect. Its cases are in `authorization.json`, which stays beside
`vectors/` because no language loads it yet and C++ has no HTTP server. No language implements any of
it yet.

[`plugin-manifest.md`](./plugin-manifest.md) specifies the shared plugin manifest (Loam D58): core
version 1, JSON Schema `$defs` with every object left open and reserved keys refused, and the contract
for one closed profile per host. It also holds the rules beyond the schema, the shared grant names,
the instance rules, the collisions and the mapping onto command metadata. Umbel's manifest versions 1
and 2 conform unchanged, and Loam's phase 1 writes the second profile. It is additive and `VERSION`
does not change: no AFD package reads a manifest, and no existing fixture, vector, wire field or error
code changes. The core's version is its own. Its cases are in `plugin-manifest.json`, which stays
beside `vectors/` because Python and C++ have no reader.

[`output-budgets.md`](./output-budgets.md) specifies per-command output budgets (Umbel decision D64):
a command declares `outputBudget: { defaultBytes, maxBytes }`, shown on its tool as
`_meta["dev.afd/outputBudget"]` and by `afd-detail`; a caller asks for `{ maxBytes }` per call in the
same `_meta` key, the meta-tools' `meta` argument or an in-process call option, through the
declared-context-field plumbing and per item in batches and pipelines; the handler reads the
effective budget from its context; and the engine checks the result after the handler, measuring the
canonical JSON without `metadata`. An over-budget read is replaced by the new failure
`OUTPUT_BUDGET_EXCEEDED`, an over-budget mutation keeps its result with a warning of that code, and
nothing truncates structured output. `command-metadata.md` gains the field, `context-fields.md`
reserves `outputBudget` and lets `meta` carry the key, `journal.md` gains the optional entry field
`outputBudget` (an entry without it hashes as before), and `error-codes.md` lists the code as
specified, joining the catalog with its four constants in the first implementation. It is additive:
no existing fixture, vector, tool list or result changes. Rust implements it (Umbel phase 2 step
0b), and that pull request adds `OUTPUT_BUDGET_EXCEEDED` to the shared catalog,
`vectors/error-codes.json` (now 46 codes) and the constants in all four languages, a minor contract
change; TypeScript, Python and C++ implement nothing else yet. Its cases are in
`output-budgets.json`, which joins `vectors/` once all four languages load it.

[`mcp-resources.md`](./mcp-resources.md) specifies four opt-in additions to AFD MCP servers (Umbel
decision D47, shared with Loam): MCP resources from a provider, listed in one stable page with the
`tools/list` TTL and `cacheScope: "public"` on the result, read with `-32602` for an unknown URI on
both eras, and digested under `_meta["dev.afd/digest"]`; the Skills over MCP extension
(`io.modelcontextprotocol/skills`, SEP-2640) from a skill catalog fixed at construction, with
`skills/list`, `skills/get`, every skill file as a resource and optional directory reads; a command's
`toolMeta`, extra tool `_meta` entries under reverse-DNS keys or MCP Apps' `ui`; and an advertised
input schema kept apart from the one the registry validates with. `command-metadata.md` gains the
`toolMeta` field and the advertised schema. It is additive: no existing fixture, vector, error code or
result changes, and Rust (Umbel phase 1 step 0b) and TypeScript implement it so far. Its cases are in `mcp-resources.json`, which joins
`vectors/` once all four languages load it. Two amendments followed the Rust SDK `rmcp` 3.9.0,
which routes the Skills extension itself. S4 now lets a `skills/get` error for a URI that is not a
`SKILL.md` URI omit `data`, because `rmcp` refuses that URI before the server's handler runs and
SEP-2640 specifies only the code; that case in `mcp-resources.json` gains `dataOptional`. S2 gains
the manifest boundary: every file's URI identifies a distinct file inside the skill's directory under
RFC 3986 normalization, as SEP-2640 requires. Rust enforces it, and TypeScript does not yet.

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
