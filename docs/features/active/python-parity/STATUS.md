# Python name parity: status

Read this before the [plan](python-parity.plan.md). Last reconciled 2026-11-13 against `main`
at `1024546b`. The September counts in the plan are historical. A fresh Alfred run found **88 missing Python names** (228 TypeScript and 233 Python exports),
matching the upper budget of 88 in `alfred/tests/test_parity.py`. All four contract constants
match `1.0-rc`, and the wire/vector loader checks report zero coverage gaps.

## Delivery

| Scope | State | Evidence / remaining gate |
| --- | --- | --- |
| Wave 1: core ergonomics | Done | #348; `python/src/afd/__init__.py` and `afd.core.commands` |
| Wave 2: handoff and MCP helpers | Partial | Several MCP types exist; default reconnect behavior and remaining public names are still open |
| Wave 3: pipeline exports | Implemented internally, public export cleanup open | `python/src/afd/core/pipeline.py`; collisions with the root `afd.direct` dataclasses must be resolved |
| Wave 4: similarity exports | Internal helpers exist, root exports open | `python/src/afd/core/similarity.py` |
| Shared executors and other missing runtime behavior | Open, owned by parity closure | [Wave 2](../parity-closure/parity-closure.plan.md#wave-2-engine-alignment), [#545](https://github.com/lushly-dev/afd/issues/545) |

## Ownership and closure

The broader [parity closure plan](../parity-closure/STATUS.md) owns behavior and includes this
export cleanup. Name cleanup is tracked in [#550](https://github.com/lushly-dev/afd/issues/550).
This remains an active subplan: its [tracking rule](../parity-closure/parity-closure.plan.md#tracking)
only archives it when `missing_from_python` reaches 20. No decision to drop the remaining names
was found. Use `uv run --project alfred alfred --workspace . parity --path .` for a fresh measurement and the
[matrix](../../../language-parity.md) for intended differences.
