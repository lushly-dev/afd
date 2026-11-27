# AFD contract changelog

The AFD contract is what every implementation must agree on so that an agent sees the same results
from TypeScript, Python, Rust and C++. Its version is in [`VERSION`](./VERSION). The contract
version is separate from each implementation's own package version.

## Scope

The contract is a core and optional, versioned profiles. The [registry](./registry.md) lists what
each owns (pages, vectors, fixtures, conformance cases, error codes and capabilities), and
[`registry.json`](./registry.json) is its machine-readable copy. [`VERSION`](./VERSION) is the
core's version; each profile's version is in the registry.

- **The core:** result and errors, dispatch, validation, batch and pipeline, exposure and the
  meta-tools, with the core's golden wire fixtures in [`wire/`](./wire/README.md), JSON Schemas in
  [`schema/`](./schema/README.md), behavior vectors in [`vectors/`](./vectors/README.md) and todo
  conformance cases (`packages/examples/todo/spec`, run by `conformance.yml`). The registry lists
  each profile's own fixtures, schemas, vectors and cases (the stream schema and chunks, the journal
  fixture, the approval, confirmation and task cases among them).
- **The profiles:** `authorization`, `tasks`, `output-budgets`, `approvals`, `app-calls`,
  `resources-and-skills`, `plugin-manifest`, `contexts`, `streaming`, `confirmations`, `journal`,
  `idempotency` and `http`.

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

1. Fold any entries still pending for the version in force (`pnpm version-track spec`), so they
   stay under its heading. Then change `VERSION` and record the change as a fragment (see
   "Recording a change").
2. Update the four constants.
3. Update the Contract column in `README.md` and the Contract row in `docs/language-parity.md`.

`node scripts/check-versions.mjs`, which `pnpm check` runs, fails until all of these agree.
`alfred parity` reports a constant that differs from `VERSION`.

## Recording a change

A change to the contract is recorded as one file in [`.changeset/`](../.changeset/README.md): a
fragment that names `afd-spec` with `patch` and holds the entry as prose paragraphs. Nothing is
added to this file by hand. `pnpm version-track spec` folds the pending fragments in, above the
earlier entries, under the heading of the contract version in force, and adds that heading when
`VERSION` has changed. The `patch` only counts folds in the private `package.json` beside this file: it is
not the contract version, which changes only as "Changing the version" says.

`pnpm check:tracks` compares this file with a digest that `package.json` pins, so a hand edit
fails. To correct an entry already folded, edit it and run `node scripts/release-track.mjs pin spec`
in the same pull request.

## 1.0-rc

[`command-metadata.md`](./command-metadata.md), "Implementation status": record the Python MCP
Tasks implementation (`TaskSupport`, `TaskStore`, `InMemoryTaskStore`, `TaskOptions`, `tasks/*`,
`McpClient` task polling, and the shared todo `--suite tasks --mode modern` acceptance suite
passing across TypeScript, Rust and Python; #1972). Additive status update, so the version stays.

[`command-metadata.md`](./command-metadata.md), "Implementation status", and
[`error-codes.md`](./error-codes.md), "MCP client": record the TypeScript MCP Tasks implementation
(`TaskSupport`, `TaskStore`, `tasks/*`, client polling, and the shared todo `--suite tasks`
acceptance suite across TypeScript and Rust) and add `MISSING_CLIENT_CAPABILITY` (`-32021`,
non-retryable) for servers requiring an undeclared client capability such as
`io.modelcontextprotocol/tasks`. Additive, so the version stays.

[`mcp-resources.md`](./mcp-resources.md), "Implementation status", and
[`vectors/mcp-resources.json`](./vectors/mcp-resources.json), `catalogFailures`: record that TypeScript's
`SkillCatalog` enforces the S2 RFC 3986 §6.2.2 manifest boundary alongside Rust (`rmcp`), and add
the `%2e%2e/x.md`, `refs/%2E`, and `%41.md` beside `A.md` cases to `catalogFailures` (#1984).

[`journal.md`](./journal.md), "Replay", and [`error-codes.md`](./error-codes.md), "Middleware and
telemetry": document `JOURNAL_RESULT_UNSERIALIZABLE` for TypeScript journal entries whose live
result could not be serialized to JSON and how `replayJournal` reports them (#865). Additive, so
the version stays.

[`command-metadata.md`](./command-metadata.md), "Approvals": the support table marks Rust's
`CommandRegistry::execute` as holding a declared approval policy without the approval middleware,
so all four languages now enforce `APPROVAL_UNAVAILABLE`
([#1886](https://github.com/lushly-dev/afd/issues/1886)). Additive, so the version stays.

[`validation.md`](./validation.md) states that a boolean schema may appear wherever a schema may ([#2047](https://github.com/lushly-dev/afd/issues/2047)):

- **`true`** is `{}`: it accepts any value, and an absent required property under it is reported as `nonoptional`.
- **`false`** is `not: {}`: it accepts no value, with an `invalid_type` issue and `expected: "never"`.
- **What stays as it was:** `additionalProperties: false` keeps its `unrecognized_keys` rule, and the root of an input schema stays an object.
- **New vector case:** `vectors/validation.json` adds `boolean-schemas`. TypeScript generates it from `z.unknown()` and `z.never()` and rewrites their schemas to `true` and `false`.

[`pipeline-variables.md`](./pipeline-variables.md) now states that a reference to a successful step with no `data` is absent, while a step whose `data` is `null` resolves to `null`.

[`vectors/pipeline-variables.json`](./vectors/pipeline-variables.json) also adds two steps that succeeded, one with `null` data and one with none ([#1961](https://github.com/lushly-dev/afd/issues/1961)). The out-of-bounds index case moves to `$steps[5]`.

Behaviour change: in all four languages, a boolean schema is now validated wherever a schema may appear, and a step that succeeded with `null` data resolves to `null`. Before, Python and Rust refused `true` and `false` except as `additionalProperties`, C++ reported `false` as `invalid_value`, and Python read a `null`-data step as absent. The two vector files gain cases for these: `boolean-schemas`, and the null-data and no-data steps.

Move TypeScript (#2128), Python (#2129), Rust (#2130), and C++ batch limits and validation issue cap (#2131) from `gaps` to executed in `spec/vectors/execution-controls.json` and `spec/execution-controls.md`, leaving only C++ single-command deadlines and cancellation tracked in #1766.

Regenerate `spec/vectors/validation.json` to replace `issue-count-uncapped` with `issue-count-capped`, pinning the default `maxValidationIssues = 100` cap, `details.truncated`, `details.limit`, `details.totalErrors`, and truncation suggestion notice across all four languages.

Promote `spec/output-budgets.json` to `spec/vectors/output-budgets.json` now that all four languages (TypeScript, Python, Rust and C++) implement B1–B8 and load the shared vectors (#1993). Add `dev.afd/outputBudget` to the `meta` argument description of all five meta-tools in `spec/meta-tools.json`, update `spec/context-fields.md`, `spec/output-budgets.md`, `spec/protocol-conformance.md` and `spec/vectors/README.md`, and move the feature documentation to `docs/features/complete/output-budgets/`.

The CommandResult envelope and local `$ref` follow one rule for schema resources ([#1910](https://github.com/lushly-dev/afd/issues/1910)):

- **[`command-metadata.md`](./command-metadata.md#structured-results):** an output schema keeps its definitions inside `data` only when it starts a schema resource, meaning a string `$id` that is not a bare fragment. This is the validators' test; before, any `$id` counted. In any other output schema, a `"$ref": "#"` that named its root becomes `"#/properties/data"` (in every schema position, draft-07 `dependencies` included), since `#` names the envelope once `data` is nested in it.
- **New vector:** [`vectors/output-schema.json`](./vectors/output-schema.json) holds the envelope each language builds.
- **[`validation.md`](./validation.md):** a `$ref` of `#/$defs/<name>` or `#/definitions/<name>` takes exactly one JSON Pointer token. A deeper pointer fails at registration, such as one that reaches into a nested `$id` subschema and would resolve its references in the wrong resource.

[`pipeline-variables.md`](./pipeline-variables.md), "Limits", says exactly how the expansion budget is counted, so all four implementations reach the same verdict at its boundaries ([#1722](https://github.com/lushly-dev/afd/issues/1722)):

- **Template values:** each one costs a value, and literal strings and object keys also cost their characters.
- **References:** a resolved reference costs a value, and an unresolved one costs a value only in an array.
- **Repeats:** a referenced value is charged in full only when the step input has already expanded it. An object or array counts as the same by its location, so `$prev` and `$steps[N]` naming one step reach the same values. TypeScript compares objects by identity, so in-process data sharing one object counts once there. A non-empty string counts as the same when it is equal.
- **Cycles:** a reference may pass through circular in-process step data, but copying a cycle into a step input fails as nested too deep.
- **Characters:** counted in UTF-16 code units.
- **Error details:** the failure is `{ stepIndex, limit }`, where `limit` is `"depth"`, `"nodes"` or `"chars"`.

The conformance minimum adds three cases: a referenced value nested 65 levels deep, repeated fan-out over the value budget, and one large reference under it.

[`pipeline-variables.md`](./pipeline-variables.md) now names the exact whitespace set forbidden in
pipeline reference keys and step aliases ([#1962](https://github.com/lushly-dev/afd/issues/1962)):
JavaScript's `\s` (ECMAScript `WhiteSpace` and `LineTerminator`, 25 code points: `U+0009`–`U+000D`,
`U+0020`, `U+00A0`, `U+1680`, `U+2000`–`U+200A`, `U+2028`, `U+2029`, `U+202F`, `U+205F`, `U+3000`
and `U+FEFF`). Characters outside this set (such as `U+001C`–`U+001F` and `U+0085`) are allowed in
keys and aliases; `U+00A0` and `U+FEFF` are whitespace.

[`vectors/pipeline-variables.json`](./vectors/pipeline-variables.json) adds keys and vectors for
`U+0085`, `U+001C`, `U+00A0` and `U+FEFF` (both reference resolution and `$exists` conditions).

Behaviour change: Python and Rust now use the explicit 25-code-point ECMAScript `\s` class for
pipeline reference keys and aliases, matching TypeScript and C++. Before, Python's `re` `\s` treated
`U+001C`–`U+001F` and `U+0085` as whitespace and omitted `U+FEFF`, while Rust's `regex` `\s` treated
`U+0085` as whitespace and omitted `U+FEFF`. `spec/vectors/pipeline-variables.json` adds cases for
these characters.

[`vectors/approval-tokens.json`](./vectors/approval-tokens.json) adds `tokenDelivery` vectors pinning Approvals rule 6 ([`command-metadata.md`](./command-metadata.md#approvals), [#1665](https://github.com/lushly-dev/afd/issues/1665)): MCP calls omit `details.approvalToken` by default unless the server opts in, while non-MCP calls include it unless opted out. All four implementations load and pass them. [`vectors/dispatch.json`](./vectors/dispatch.json) removes Rust's `approvalUnavailable` gap now that all four implementations refuse unadmitted gated commands with `APPROVAL_UNAVAILABLE` ([#1886](https://github.com/lushly-dev/afd/issues/1886)). Additive, so the version stays.

Behaviour change: Rust and Python approval middleware now omit `details.approvalToken` on MCP calls by default unless the server opts in (`with_include_token(true)` / `include_token=True`), matching TypeScript and C++, and Rust aligns MCP relay fallback opt-in with the other implementations.

Align `spec/mcp-resources.md` R3 and R4 with MCP authorization's per-caller resource providers (`list_for`/`read_for`, #1880): modern-era `resources/list` and provider-backed `resources/read` results carry `cacheScope: "private"` whenever a `ResourceProvider` is attached on a server that supports per-caller providers and authorization is configured or the request carries verified credentials, while static `SkillCatalog` reads, `resources/templates/list`, `skills/*`, `resources/directory/read`, and unauthenticated or skills-only servers keep `cacheScope: "public"` (#1905).

Promote `spec/mcp-resources.json` to `spec/vectors/mcp-resources.json` now that TypeScript, Python, Rust and C++ all load and pass every case (`#1986`, closing `#1554`).

`spec/error-codes.md` updates the TypeScript MCP client `OUTCOME_UNKNOWN` entry to cover single `call()` requests not positively declared read-only (`_meta.mutation: false`), in addition to `batch` and `pipeline` (#1750).

Define the specification-authored vs. mechanically generated vector provenance rule in `spec/vectors/README.md`, establish AFD's nine-code validation issue catalog in `spec/validation.md` with advisory issue wording, and add the CI drift and behaviour-change changeset guard (`scripts/check-vector-drift.mjs`) (#1734).

Define server default deadlines (`30000` ms), cooperative cancellation propagation, batch ceilings (`maxBatchSize = 500`, `maxBatchParallelism = 16`) and the non-silent validation issue cap (`maxValidationIssues = 100`) in `spec/execution-controls.md`, with specification-authored vectors in `spec/vectors/execution-controls.json` loaded by all four languages (#1737).

Add the shared protocol conformance case file (`spec/protocol-conformance.json`) covering discovery, exposure and D4 hiding, batch, pipe, contexts in both MCP eras, and JSON Schema validation against `spec/schema/{result,batch,pipeline,stream}.json`, plus packed-artifact verification in `.github/workflows/release.yml` (#1739).

[`wire/README.md`](./wire/README.md), "Contract": state that `data` on a `CommandResult`, a
pipeline step and a pipeline result is the exception to "unset fields are omitted, never `null`":
`data` set to `null` is sent as `"data": null`, and only `data` never set is omitted, as
TypeScript already sends it. Python now does too (#2073). Clarifies the existing TypeScript
behaviour, so the version stays.

[`plugin-manifest.md`](./plugin-manifest.md) and both core schemas
([`plugin-manifest.core.v1.json`](./plugin-manifest.core.v1.json),
[`plugin-manifest.core.v2.json`](./plugin-manifest.core.v2.json)) add `"non-human"` to `approval`
on commands and mounted tools (K3, C7, [#1329](https://github.com/lushly-dev/afd/issues/1329)).
`"non-human"` maps to a conditional AFD approval policy that lets a direct `Human` caller run
without holding and holds every other caller (agents, services, scripts, tests, agents acting
`on_behalf_of` a human, and absent actors). Additive, so the contract version stays: existing
manifests and profiles that restrict `approval` (such as Loam's `["none"]`) are unchanged.

[`command-metadata.md`](./command-metadata.md)'s reporting rules name `afd-help`: like `_meta` and `afd-detail`, it omits empty command-metadata arrays: `requires`, and in its `full` format `tags` and `examples` ([#1480](https://github.com/lushly-dev/afd/issues/1480)).

[`authorization.md`](./authorization.md), "TypeScript", and [`error-codes.md`](./error-codes.md):
an HTTP session can be displaced only by the same subject's `initialize`. One issuer and subject,
across its clients, holds at most `maxSessionsPerOwner` sessions (default 100); at that quota or the
session cap its least recently used session is evicted, and a subject with none is refused while the
store is full, with HTTP 503, `Retry-After` and JSON-RPC `-32000` carrying the request's `id` and
`data.code: "SESSION_LIMIT_REACHED"`. The MCP client reports that as the retryable
`SESSION_LIMIT_REACHED`, from that status and `data.code` only. Additive, so the version stays.

`spec/pipeline-variables.md` and `spec/error-codes.md` bound referenced-value nesting depth (64 levels, at most 128 levels combined) and repeated reference expansion (100,000 values and 16 MiB of string/key characters) during pipeline variable resolution, failing the step with `VALIDATION_ERROR` without invoking the command (#1704).

[`command-metadata.md`](./command-metadata.md), "Approvals", and [`error-codes.md`](./error-codes.md):
`APPROVAL_UNAVAILABLE` gains a third `details.reason`, `input-not-canonical`: the approval step's
answer when a call needs approval and its validated input has no canonical JSON form, so no approval
can be bound to it and the person is not asked. A call its policy lets through still runs on such an
input. The admission rule also covers a policy given only to the approval middleware, an input
changed while the approval step decides, and a second approval middleware, which admits only what it
may gate. Additive, so the version stays.

[`command-metadata.md`](./command-metadata.md), "Approvals": a declared approval policy now holds
without the approval middleware. A server engine never runs a command whose policy is not
`not-required` unless its approval step admitted that call; each batch item, pipeline step and
command run from inside another command's handler is admitted on its own. Without such a step the
engine answers `APPROVAL_UNAVAILABLE` before the handler runs, not retryable, reading the
declaration alone (a policy function is not evaluated). `APPROVAL_UNAVAILABLE` joins
[`error-codes.md`](./error-codes.md)'s catalog and `vectors/error-codes.json` (50 codes), with its
constant in all four languages. TypeScript enforces it; Python, Rust and C++ define the constant
and their enforcement follows in [#1886](https://github.com/lushly-dev/afd/issues/1886). Additive, so the version stays.

[`command-metadata.md`](./command-metadata.md) adds app-to-app calls (Loam phase 5 step 0b, D30,
[#884](https://github.com/lushly-dev/afd/issues/884)): `expose.apps`, default `false`, is a
command's declaration that another app may call it; `apps` is an interface a host's trusted code
names for an app's call; and the registry takes a host predicate, `callGrant(command, context)`,
over the caller's grants. A call with the `apps` interface runs only when the command exists, sets
`expose.apps` and the predicate returns `true`; every other one, invalid input included, gets one
fixed `CALL_NOT_GRANTED` refusal before lookup and validation. `CALL_NOT_GRANTED` joins
[`error-codes.md`](./error-codes.md)'s catalog and `vectors/error-codes.json` (49 codes), with its
constant in all four languages, and D4 gains an `apps` row. [`plugin-manifest.md`](./plugin-manifest.md)
adds core version 2, [`plugin-manifest.core.v2.json`](./plugin-manifest.core.v2.json): version 1 with
`expose.apps` defined, defaulting to `false` in every profile; both profiles stay on version 1. New
vector file [`vectors/app-calls.json`](./vectors/app-calls.json), with a documented gap for Python
and C++ ([#1513](https://github.com/lushly-dev/afd/issues/1513)). Additive, so the version stays:
nothing changes for a call that does not name the `apps` interface.

[`spec/schema/`](./schema/README.md) adds JSON Schema 2020-12 definitions for `CommandError`
(`error.json`), `CommandResult` (`result.json`), the standalone MCP `outputSchema` envelope
(`output-envelope.json`), `BatchResult` (`batch.json`), `PipelineResult` (`pipeline.json`), and
`StreamChunk` (`stream.json`), with every `spec/wire/*.json` fixture and the todo conformance runner
validated against them (#1733). [`command-metadata.md`](./command-metadata.md) and every language's
`commandResultOutputSchema` now type `error` (`code`, `message`, `suggestion`, `retryable`).

[`vectors/error-codes.json`](./vectors/error-codes.json) now carries `{ code, retryable, profile }`
for every code and the reserved `hostPrefix` (`"HOST_"`), and [`error-codes.md`](./error-codes.md)
separates the 33-code core catalog from the 17-code profile catalogs and reserves `HOST_` for
host-defined codes (#1740).

[`dispatch.md`](./dispatch.md) and [`vectors/dispatch.json`](./vectors/dispatch.json) specify
single-command dispatch order and pin it with 19 shared registry and MCP vectors run across
TypeScript, Python, Rust, and C++ (#1736). Additive, so `spec/VERSION` stays.

[`tool-strategies.md`](./tool-strategies.md) records Python's bootstrap tools as opt-in (parity decision D5, [#542](https://github.com/lushly-dev/afd/issues/542)): `create_server(..., bootstrap=True)` registers `afd-help`, `afd-docs` and `afd-schema`, as TypeScript's `bootstrap: true`, and Python's default `server/discover` instructions now add the bootstrap sentence only then. The implementation table and the vector notes no longer say Python always registers them. The contract itself is unchanged.

`spec/tool-strategies.md`, "Reserved names": Python now refuses the bootstrap names with `bootstrap=True` and the context names with `contexts`, as TypeScript does (#1731).

[`validation.md`](./validation.md): a string `$id` starts a schema resource, as in Draft 2020-12, and a local `$ref` resolves against the nearest one around it, or else the root ([#1700](https://github.com/lushly-dev/afd/issues/1700)). Before, the subset said `$id` did not change how `$ref` resolves. A bare fragment such as `"#node"`, a draft-07 anchor, starts no resource, and the `$id` value is never resolved as a URI. `$id` leaves the list of annotations with no effect. The new `ref-embedded-resource` case in `vectors/validation.json`, the CommandResult envelope advertised for a `data` schema with its own `$id` and `$defs`, runs in all four languages, and TypeScript also checks it with Ajv.

An output schema with its own `$id` keeps its definitions inside `data` so local references resolve within that schema (#1474).

[`tool-strategies.json`](./vectors/tool-strategies.json), the hybrid strategy's cases, moves into
`vectors/` now that C++ serves the strategy and all four languages load it
([#1202](https://github.com/lushly-dev/afd/issues/1202)). Its content does not change, so the
version stays.

[`tool-strategies.md`](./tool-strategies.md) makes the individual, grouped and lazy lists normative
([#533](https://github.com/lushly-dev/afd/issues/533), decided by the owner on 2026-11-17): every
strategy lists the five meta-tools first, in the hybrid order (`afd-discover`, `afd-detail`,
`afd-call`, `afd-batch`, `afd-pipe`); `lazy` is the hybrid list with no first-class tools (the
meta-tools and the context tools); grouped tools take TypeScript's shape, with `_meta.actions` and
groups in order of their first command; and `grouped` is every language's default. TypeScript
serves the lists; Python, Rust and C++ follow in their own steps, and the "Alignment" table records
which. Clients that read `tools/list` see `afd-discover` and `afd-detail` in every strategy, so the
version stays.

[`command-metadata.md`](./command-metadata.md) adds approval evidence from an approver client and
the approval display rules (Loam phase 5 step 0c, D146 and D150): a server may name approvers,
which get `details.approvalToken` on every held MCP result, are never asked with a form, and carry
the token back in `_meta["dev.afd/approval"]` on a one-command MCP 2026-07-28 call; any other
caller's key is ignored, and the key in tool arguments is refused with `VALIDATION_ERROR`. A token
issued on an approver's call binds `principal\0` and the call's principal binding in `a`, verified
with `credentials-mismatch`. The display rules bound what a person is shown before approving (8000
UTF-16 code units of canonical JSON, 400 values, depth 6, strings of 2000 and keys of 200, no
hidden code points or stacked marks). New vector file
[`vectors/approver-client.json`](./vectors/approver-client.json), with a documented gap for Python
and C++ ([#1466](https://github.com/lushly-dev/afd/issues/1466)); additive, so the version stays.

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
`vectors/` because only Rust loads it and C++ has no HTTP server. Rust implements M1 to M7 (Umbel
phase 5 step 0b, the `server-auth` feature) and loads every case, and that pull request adds
`INSUFFICIENT_SCOPE` to the shared catalog, `vectors/error-codes.json` (now 47 codes) and the
constants in all four languages, a minor contract change; TypeScript and Python implement nothing
else yet. Step 0b also settles six readings in `authorization.md`, each the stricter one and none
changing a case: the HTTP layer strips the `Authorization` header; a JOSE header or claims set with
a repeated member name is refused; the key's own `kid` must match and unusable key material is
`key`; a `cnf` other than `x5t#S256` or `jkt` is `binding`; `requiredScopes` apply under a resolver
and an unresolvable grouped call is decided under the group's name rather than deferred, with
unexposed commands naming no scope; and `afd-docs` and `afd-schema` are filtered too. A security
review of the step added more, also stricter and changing no case: credentials count only when the
server's own HTTP layer admitted them, and a transport other than HTTP or stdio must be marked
trusted (M1); `exp` before `iat` is `lifetime`; any `Missing` refuses, and a 403 with no valid
scope to name leaves `scope=` out; a resolver is asked again at execution on the validated input;
suggestions never name a hidden command; a JSON-RPC batch is 400; and a resource provider sees the
caller's credentials. Umbel phase 5 step 0c then implements #532 in TypeScript, Python and Rust: each
binds confirmation state (and TypeScript's approval-relay state, which shares it) to the principal
binding as integrity-protected input, never as readable identity, refuses a mismatch as it refuses a
tampered state, and loads the `principalBindings` cases. No case, fixture or wire field changes.
Umbel phase 5 step 0e implements Tasks in Rust and adds `TASK_TOKEN_EXPIRED` to the shared catalog,
`vectors/error-codes.json` (now 48 codes) and the constants in all four languages, a minor contract
change. It writes back into the Tasks section of `command-metadata.md` the readings it settled, each
the stricter one: a 2025 request never declares the extension, whatever it declared at
`initialize`; credentials that cannot be bound get no task; the server stops the handler when the
signal fires, and a task is gone when its `ttlMs` ends; a task whose token expired before it started
completes with `TASK_TOKEN_EXPIRED` without running, and a result that arrives after `expiresAt` is
not delivered; `TASK_TOKEN_EXPIRED`'s retryable value is "Varies", `false` for a mutation whose
handler started; a handler that returned before a `tasks/cancel` took effect keeps its result; the
unknown-task answer is `-32602`, and the server checks the owner and the TTL again whatever the store
returned; on an authorized server the owner must still hold what the task's command needs to read or
update it, but not to cancel it; a server that cannot tell its callers apart (HTTP without credentials
or a host's declaration that its hook identifies callers) creates no task, declares no extension, runs
an `optional` command inline and refuses a `required` one with `UNAUTHORIZED`;
and the default store is bounded, dropping finished tasks to make room before a full store fails the
call with `RATE_LIMITED`, with a limit on the tasks one process runs.
Umbel phase 5's follow-up of 2026-11-08 adds [hidden commands](./authorization.md#hidden-commands) to
M6: with filtered listings and a resolver, a command for which the resolver's new
`known(command, credentials)` (default `visible`) is false does not exist for that caller, and every
route (a command's own tool, a hybrid first-class tool, a grouped action, `afd-call`, `afd-batch`
and `afd-pipe` steps, `afd-detail` and the listings) answers it byte for byte as a name that does not
exist, before validation and before any middleware, confirmation, relay or task. `visible` and
`known` must be pure functions of the command and the credentials, and the server decides them once
per request (a task runs with that answer); a command name that does not exist for the caller
(unknown, unexposed or hidden) is decided on `requiredScopes` alone, the resolver never asked about
it; `resolve` still decides calls to commands that exist; `requires` names only commands that exist
for the caller; a `tasks/*` request on a task whose command no longer exists for its owner gets the
unknown-task answer; and `afd-help`'s `firstClassTools` names only first-class tools the caller's
list shows. Because `known` defaults to `visible`, it is a behaviour change for a server with
filtered listings and a resolver: a command the caller cannot list, which it could still call (or
be refused with a 403 naming a scope), is now unknown to it unless the resolver overrides `known`.
`error-codes.md` (D4), `command-metadata.md` (`requires`, Tasks) and `tool-strategies.md` point to
it. Rust implements it; it changes no case, fixture or wire field, and nothing for a server without
filtered listings, a resolver or credentials.

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
