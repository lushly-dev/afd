"""AFD/Botcore adapters (the ``botcore`` extra); authority stays in explicit arguments."""

from __future__ import annotations

from pathlib import Path

from afd import error, success
from botcore.context import current_context

from .core import Policy, Target, audit, capabilities


async def health_capabilities():
    """Declared Health checks, statuses, tool requirements and effects."""
    return success(data=capabilities(), reasoning="Declared local checks and effects")


def _selected_path(value: str) -> Path:
    # Inside a Botcore host the audited target must lie within the host's selected target.
    context = current_context()
    return Path(context.resolve_path(value)) if context is not None else Path(value)


async def health_audit(
    targets: list[dict[str, str]],
    check_ids: list[str],
    disabled: list[str] | None = None,
    severity: dict[str, str] | None = None,
):
    """Audit explicitly selected targets with an explicit check policy (read-only)."""
    try:
        selection = tuple(
            Target(t["id"], _selected_path(t["path"]), t["language"]) for t in targets
        )
        policy = Policy(tuple(check_ids), frozenset(disabled or []), dict(severity or {}))
        return success(
            data=audit(selection, policy), reasoning="Audited explicitly selected targets"
        )
    except (KeyError, TypeError, ValueError) as exc:
        return error(
            "INVALID_AUDIT_SELECTION",
            str(exc),
            suggestion="Pass explicit target ids, paths, languages and known check ids",
        )


def _audit_effects(arguments: dict) -> tuple[str, ...]:
    selected = set(arguments.get("check_ids") or ()) - set(arguments.get("disabled") or ())
    return ("inspect", "subprocess") if "last_commit" in selected else ("inspect",)


def host_policies() -> dict:
    """Declared effects for explicit Botcore/Alfred host admission of this plugin."""
    from botcore.host import CommandPolicy

    return {
        "health_capabilities": CommandPolicy(),
        "health_audit": CommandPolicy(
            _audit_effects,
            capabilities=("explicit-targets",),
            possible_effects=("inspect", "subprocess"),
        ),
    }
