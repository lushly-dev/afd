"""AFD/Botcore adapters (the ``botcore`` extra); authority stays in explicit arguments."""

from __future__ import annotations

from pathlib import Path
from typing import Any, cast

from afd import error, success
from botcore.context import current_context

from .core import Policy, Target, audit, capabilities
from .measures import load_measures_files


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
    measures_files: list[str] | None = None,
):
    """Audit explicitly selected targets with an explicit check policy (read-only)."""
    try:
        selection = tuple(
            Target(
                t["id"],
                _selected_path(t["path"]),
                t["language"],
                _selected_path(t["repository_root"]) if t.get("repository_root") else None,
            )
            for t in targets
        )
        policy = Policy(
            tuple(check_ids), frozenset(disabled or []), cast(Any, dict(severity or {}))
        )
        if measures_files is not None and (
            not isinstance(measures_files, list)
            or not all(isinstance(path, str) for path in measures_files)
        ):
            raise ValueError("measures_files must be a list of path strings")
        resolved_measures = [_selected_path(path) for path in (measures_files or ())]
        try:
            measures = load_measures_files(resolved_measures)
        except OSError as exc:
            return error(
                "INVALID_AUDIT_SELECTION",
                f"Measures file could not be read: {type(exc).__name__}",
                suggestion="Pass readable measures files inside the selected target",
            )
        return success(
            data=audit(selection, policy, measures=measures),
            reasoning="Audited explicitly selected targets",
        )
    except (KeyError, TypeError, ValueError) as exc:
        return error(
            "INVALID_AUDIT_SELECTION",
            str(exc),
            suggestion=(
                "Pass explicit target ids, paths, languages, known check ids "
                "and valid measures files"
            ),
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
