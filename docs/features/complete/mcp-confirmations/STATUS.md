# MCP confirmations: status

Read this before the [proposal](mcp-confirmations.proposal.md). Last reconciled 2026-11-13
against `main` at `1024546b`, using source, merged history and the linked issues. This audit did
not rerun the implementation suites.

## Status block

- **State:** complete (closed 2026-11-14). Phases 1 to 3 are merged; the remaining ports and the optional
  phase 4 decision continue as issues.
- **Done:** the shared contract and error codes (#410), TypeScript enforcement, client and CLI
  (#435), and Python and Rust server enforcement (#442). Caller/principal binding subsequently
  merged in #801; Rust's host-verified mode and relay merged in #810.
- **Not done:** C++ backend enforcement ([#467](https://github.com/lushly-dev/afd/issues/467)),
  Python client elicitation ([#468](https://github.com/lushly-dev/afd/issues/468)), and deciding
  whether to build, split out or drop phase 4
  ([#552](https://github.com/lushly-dev/afd/issues/552)). All three issues were open when checked.

## Evidence and next gate

`packages/server/src/confirmations.test.ts`, `python/tests/test_confirmations.py` and
`packages/rust/tests/server_confirmations.rs` cover the implemented server paths;
[confirmation cases](../../../../packages/examples/todo/spec/confirmation-cases.json) define the common
acceptance cases. Closed 2026-11-14 with three of four servers and TypeScript's client done: #467 carries C++ enforcement,
#468 Python's client, and #552 the phase 4 decision. Do not treat server completion as Python client completion.
