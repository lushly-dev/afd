# AFD contract changelog

The AFD contract is what every implementation must agree on so that an agent sees the same results
from TypeScript, Python, Rust and C++. Its version is in [`VERSION`](./VERSION). The contract
version is separate from each implementation's own package version.

## Scope

- [`wire/`](./wire/README.md): the golden wire fixtures;
- [`pipeline-variables.md`](./pipeline-variables.md), [`validation.md`](./validation.md) and the
  behavior vectors in [`vectors/`](./vectors/README.md);
- the todo conformance suite (`packages/examples/todo/spec`, run by `conformance.yml`).

- [`error-codes.md`](./error-codes.md): the shared error-code catalog, checked by
  `vectors/error-codes.json`, and the rules for unknown and unexposed commands.

A protocol conformance tier joins the contract when it is written.

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

The first versioned contract. It covers:

- the six fixtures in `wire/`: minimal, full and failed `CommandResult`, `BatchResult`,
  `PipelineResult` and the four `StreamChunk` kinds;
- the pipeline variables in `pipeline-variables.md`, with 48 references and 27 conditions in
  `vectors/pipeline-variables.json`;
- the batch and pipeline execution controls, with 21 batch and 22 pipeline cases in
  `vectors/batch-controls.json`;
- the 34 cases of the todo conformance suite;
- command input validation in `validation.md`, with 32 cases and 126 tests in
  `vectors/validation.json`. Its open questions are listed at the end of `validation.md`;
- the 42 codes of the shared error-code catalog in `error-codes.md` and
  `vectors/error-codes.json`, and its rules for unknown and unexposed commands (D4).

Every language round-trips the wire fixtures, loads `vectors/pipeline-variables.json`,
`vectors/batch-controls.json` and `vectors/error-codes.json`, and passes the conformance suite.
Only TypeScript loads `vectors/validation.json` so far. The contract stays at `1.0-rc` until every
language loads the validation vectors (#310, #311, #312).
