# MCP 2026-07-28 upgrade: status

Read this before the [proposal](proposal.md). Last reconciled 2026-11-13 against `main` at
`1024546b`, using merged history, the shared contract and GitHub issue state. This audit did not
rerun protocol or conformance suites.

## Delivery

| Scope | State | Evidence / remaining gate |
| --- | --- | --- |
| Phases 0 to 6: spike, dual-era servers and clients, tool fields, conformance and migration docs | Done for the recorded scope | #391 to #396; [migration guide](migration.md), [protocol acceptance index](../../../../spec/protocol-conformance.md) |
| Phase 5's deferred structured results | Done | Rust implemented `structuredContent` and `outputSchema` in #523; Python and C++ (`afd::mcp_stdio`) on branch `lush/fleet-465-structured-content-parity`, closing [#465](https://github.com/lushly-dev/afd/issues/465) |
| Phase 5's deferred metadata | Partially delivered | `title` (#585) and the meta-tool `meta` argument (#589) landed; `x-mcp-header` was not adopted. See [command metadata](../../../../spec/command-metadata.md) |
| Phase 7: separate follow-on proposals | Proposals delivered (#407), implementations tracked separately | [Confirmations](../mcp-confirmations/STATUS.md), [authorization](../mcp-authorization/STATUS.md), [progress](../../proposed/mcp-progress/mcp-progress.proposal.md), [tasks](../mcp-tasks/STATUS.md) |
| Phase 8: legacy removal | Not started; next major and owner decision required | [#469](https://github.com/lushly-dev/afd/issues/469) remains open; dual-era support is still intentional |

## Closure

Closed as complete on 2026-11-14 for phases 0 to 7. Phase 8, removing the legacy lanes in the next major, is the owner's decision in [#469](https://github.com/lushly-dev/afd/issues/469); Python and C++ structured results, which continued in [#465](https://github.com/lushly-dev/afd/issues/465), are done. #469 also tracks the
remaining maintenance decisions; authorization in 2.x has since been approved and implemented in
Rust and TypeScript, so that part of the original question is answered. Follow-on proposals being
written does not mean their implementations are complete.
