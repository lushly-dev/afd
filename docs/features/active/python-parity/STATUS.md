# Python name parity status

**State:** Active, effectively a sub-item of [parity closure](../parity-closure/STATUS.md) Wave 2 ("export cleanup"). Wave 1 is done; Waves 2–4 are open. The plan's exit is `missing_from_python` at 20 (parity-closure Tracking) or an explicitly justified residual list.
**Last updated:** 2026-10-31, against `origin/main` `5875e301`.

The [plan](./python-parity.plan.md) tracks name parity only; behavior is in [`docs/language-parity.md`](../../../language-parity.md).

## Done / merged

| Item | Evidence |
| --- | --- |
| Wave 1: core ergonomics (registry, middleware, `WarningSeverity`, `ErrorCode`, timeout controller, progress-with-steps, `validate_command_name` warning) | #405 (closed #348, 2026-10-26) |
| New TypeScript names that Python matched as they landed: context primitives, journal and replay, approval policy | #400 → #413; #425 → #439; #420 → #449 |
| Budget lowered 97 → 88 | `alfred/tests/test_parity.py` (`missing_from_python: 88`), history comments in that file |

## Not done

Tracked in #550 (2026-10-31).

- **Wave 2:** `default_reconnect_policy` (and `create_handoff` applying it); MCP error-code constants, notification and list types.
- **Wave 3:** export the implemented pipeline contract (38 names). Blocked by root-name collisions: `afd.PipelineStep`, `PipelineResult`, `CommandDefinition` and `CommandContext` resolve to the `afd.direct` dataclasses. `DirectClient.pipe` is still a second pipeline engine.
- **Wave 4:** export the 4 similarity names; final `__init__.py` cleanup.
- **New since the plan:** `execute_batch`, `execute_stream`, executor/registry options types, `is_exposed_to`, `is_mcp_exposed`, `commands_to_mcp_tools`.
- Breakdown of the 88 (per `docs/language-parity.md`, "Name parity"): 56 exist but are not exported, 13 are real gaps, 19 are TypeScript typing artifacts.

## Verification evidence

- Budget read from `alfred/tests/test_parity.py` on `5875e301`. `alfred parity` was not re-run in this audit, so the live count is unverified beyond the enforced budget.
- Issue states read with `gh` on 2026-10-31.

## Observed issues

- The plan's count table stopped at 2026-09-26 (97); a 2026-10-31 row with the current budget was added.

## Follow-ups

- Decide the `afd.direct` collision (rename or move the dataclasses) so Wave 3 can export; this is the largest block (38 names).
- Consider folding this plan into parity closure and moving it to `complete/` once the budget reaches 20, as parity-closure's Tracking section already says.
