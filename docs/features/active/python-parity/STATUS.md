# Python name parity: status

Epic: [#1551](https://github.com/lushly-dev/afd/issues/1551) (this plan is part of Language parity closure). File new work for this area as its sub-issue.

Read this before the [plan](python-parity.plan.md). Last reconciled 2026-11-25 against `main`
after [#1535](https://github.com/lushly-dev/afd/issues/1535) and [#550](https://github.com/lushly-dev/afd/issues/550) PR 1. A fresh Alfred run finds **10 missing Python names** (5 colliding root names kept behind one-minor deprecation shims for PR 2 until Botcore migrates off `#2455`, plus 5 approval-display helpers tracked in [#1466](https://github.com/lushly-dev/afd/issues/1466)), matching the lowered budget of 10 in `alfred/tests/test_parity.py`. All four contract constants
match `1.0-rc`, and the wire/vector loader checks report zero coverage gaps.

## Delivery

| Scope | State | Evidence / remaining gate |
| --- | --- | --- |
| Wave 1: core ergonomics | Done | #348; `python/src/afd/__init__.py` and `afd.core.commands` |
| Wave 2: handoff and MCP helpers | Done | `DEFAULT_RECONNECT_POLICY`, `CreateHandoffOptions`, `is_reconnect_policy`, `McpErrorCodes`, `McpNotification`, `McpToolsListResult`, MCP aliases/factories/guards exported from `afd` and `afd.core` (#550 PR 1) |
| Wave 3: pipeline exports | Non-colliding done; 5 colliding root names in PR 2 | All non-colliding pipeline types, condition guards and helpers exported from `afd` and `afd.core` (#550 PR 1); `CommandDefinition`, `CommandContext`, `CommandParameter`, `PipelineStep` and `PipelineResult` stay behind `__getattr__` deprecation shims until Botcore migrates `endpoints/botcore/src/botcore/host.py:21` to `DirectContext` |
| Wave 4: similarity exports | Done | `MAX_SIMILARITY_INPUT_LENGTH`, `calculate_similarity`, `find_similar_tools`, `truncate_name` exported from `afd` and `afd.core` (#550 PR 1) |
| Shared executors | Done | Consolidated in #2546 (#1535) |

## Ownership and closure

The broader [parity closure plan](../parity-closure/STATUS.md) owns behavior and includes this
export cleanup. Name cleanup is tracked in [#550](https://github.com/lushly-dev/afd/issues/550).
`missing_from_python` is now 10 (below the 20-name threshold), and this subplan stays active only
until `#550` PR 2 swaps the 5 colliding root names to `afd.core` once Botcore migrates off the
`#2455` deprecation shim. Use `uv run --project alfred alfred --workspace . parity --path .` for a
fresh measurement and the [matrix](../../../language-parity.md) for intended differences.
