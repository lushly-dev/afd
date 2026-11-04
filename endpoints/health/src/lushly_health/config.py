"""Caller-owned policy and target files. Nothing here ships an inventory or a baseline.

Both formats are TOML or JSON. Relative target paths resolve against the directory of
the file that declares them, never against the package or the current directory.

Policy::

    schema_version = "1.0"
    checks = ["node_version_alignment", "gitattributes_lf"]
    disabled = []                      # optional; must be selected checks
    remediation = "none"               # optional; the only implemented value
    [severity]                         # optional; default "required"
    gitattributes_lf = "advisory"

Targets::

    schema_version = "1.0"
    [[targets]]
    id = "sample-project"
    path = "../sample-project"
    language = "typescript"
    # repository_root = "../monorepo"  # optional; for a unit inside a larger repository
"""

from __future__ import annotations

import json
import tomllib
from collections.abc import Mapping
from pathlib import Path

from .core import CONFIG_SCHEMA_VERSION, Policy, Target

_POLICY_KEYS = {"schema_version", "checks", "disabled", "severity", "remediation"}
_TARGET_KEYS = {"id", "path", "language"}
_OPTIONAL_TARGET_KEYS = {"repository_root"}


def _read(path: Path) -> dict:
    path = Path(path)
    text = path.read_text(encoding="utf-8")
    data = json.loads(text) if path.suffix == ".json" else tomllib.loads(text)
    if not isinstance(data, dict):
        raise ValueError("Configuration must be an object")
    if data.get("schema_version") != CONFIG_SCHEMA_VERSION:
        raise ValueError(f"Configuration schema_version must be {CONFIG_SCHEMA_VERSION}")
    return data


def _strings(value, name: str) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError(f"{name} must be a list of strings")
    return value


def policy_from_mapping(data: Mapping) -> Policy:
    unknown = set(data) - _POLICY_KEYS
    if unknown:
        raise ValueError(f"Unknown policy keys: {sorted(unknown)}")
    severity = data.get("severity", {})
    if not isinstance(severity, Mapping):
        raise ValueError("severity must be a table of check ids")
    remediation = data.get("remediation", "none")
    if not isinstance(remediation, str):
        raise ValueError("remediation must be a string")
    return Policy(
        tuple(_strings(data.get("checks"), "checks")),
        frozenset(_strings(data.get("disabled", []), "disabled")),
        dict(severity),
        remediation,
    )


def load_policy(path: str | Path) -> Policy:
    return policy_from_mapping(_read(Path(path)))


def targets_from_mapping(data: Mapping, base: Path) -> tuple[Target, ...]:
    if set(data) - {"schema_version", "targets"}:
        raise ValueError("Targets files contain only schema_version and targets")
    rows = data.get("targets")
    if not isinstance(rows, list) or not rows:
        raise ValueError("targets must be a nonempty list")
    result = []
    for row in rows:
        if (
            not isinstance(row, Mapping)
            or not set(row) >= _TARGET_KEYS
            or set(row) - _TARGET_KEYS - _OPTIONAL_TARGET_KEYS
        ):
            raise ValueError(
                "Each target declares id, path and language, and optionally repository_root"
            )
        if not all(isinstance(value, str) for value in row.values()):
            raise ValueError("Target id, path, language and repository_root must be strings")
        root = row.get("repository_root")
        result.append(
            Target(
                row["id"],
                Path(base) / row["path"],
                row["language"],
                Path(base) / root if root is not None else None,
            )
        )
    return tuple(result)


def load_targets(path: str | Path) -> tuple[Target, ...]:
    path = Path(path).resolve()
    return targets_from_mapping(_read(path), path.parent)
