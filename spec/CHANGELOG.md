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
  `wire/journal.jsonl` (TypeScript and C++ so far);
- [`error-codes.md`](./error-codes.md): the shared error-code catalog, checked by
  `vectors/error-codes.json`, and the rules for unknown and unexposed commands.

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
