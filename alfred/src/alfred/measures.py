"""Health 1.0 trend measures produced from Alfred's read-only check outputs."""

from __future__ import annotations

import json
import math
import re
from collections.abc import Mapping
from pathlib import Path
from typing import Any

MEASURES_SCHEMA_VERSION = "1.0"
DEFAULT_SOURCE = "alfred"
_IDENTIFIER_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]*$")
_MAX_SAFE_VALUE = (1 << 53) - 1


def _validate_identifier(value: str, field_name: str) -> str:
    if not isinstance(value, str) or not _IDENTIFIER_RE.fullmatch(value):
        raise ValueError(f"Measure {field_name} must be a stable, nonempty identifier: {value!r}")
    return value


def _number(value: Any, field_name: str) -> int | float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ValueError(f"Measure value for {field_name} must be a finite number")
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError(f"Measure value for {field_name} must be a finite number")
    if abs(value) > _MAX_SAFE_VALUE:
        raise ValueError(f"Measure value for {field_name} exceeds safe IEEE-754 bounds")
    return value


def _measure(
    key: str,
    label: str,
    value: int | float,
    unit: str,
    direction: str,
) -> dict[str, Any]:
    return {
        "key": _validate_identifier(key, "key"),
        "label": label,
        "value": _number(value, key),
        "unit": unit,
        "direction": direction,
    }


def measures_from_lint(data: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Extract Health 1.0 measures from an ``alfred_lint`` result payload."""
    suppressed = data.get("suppressed") or {}
    return [
        _measure(
            "alfred_lint_files_checked",
            "Alfred lint files checked",
            data.get("files_checked", 0),
            "files",
            "neutral",
        ),
        _measure(
            "alfred_lint_errors",
            "Alfred lint errors",
            data.get("error_count", 0),
            "errors",
            "lower_is_better",
        ),
        _measure(
            "alfred_lint_warnings",
            "Alfred lint warnings",
            data.get("warning_count", 0),
            "warnings",
            "lower_is_better",
        ),
        _measure(
            "alfred_lint_suppressed",
            "Alfred suppressed lint findings",
            suppressed.get("total", 0),
            "findings",
            "lower_is_better",
        ),
    ]


def measures_from_parity(data: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Extract Health 1.0 measures from an ``alfred_parity`` result payload."""
    wire = data.get("wire_fixtures") or {}
    vectors = data.get("vectors") or {}
    contract = data.get("contract_version") or {}
    return [
        _measure(
            "alfred_parity_gaps",
            "Alfred parity gaps",
            data.get("total_gaps", 0),
            "gaps",
            "lower_is_better",
        ),
        _measure(
            "alfred_parity_name_gaps",
            "Alfred parity name gaps",
            data.get("name_gaps", 0),
            "gaps",
            "lower_is_better",
        ),
        _measure(
            "alfred_parity_wire_gaps",
            "Alfred wire-fixture gaps",
            wire.get("gaps", 0),
            "gaps",
            "lower_is_better",
        ),
        _measure(
            "alfred_parity_vector_gaps",
            "Alfred behavior-vector gaps",
            vectors.get("gaps", 0),
            "gaps",
            "lower_is_better",
        ),
        _measure(
            "alfred_parity_contract_gaps",
            "Alfred contract-version gaps",
            contract.get("gaps", 0),
            "gaps",
            "lower_is_better",
        ),
    ]


def measures_from_quality(data: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Extract Health 1.0 measures from an ``alfred_quality`` result payload."""
    return [
        _measure(
            "alfred_commands_scanned",
            "AFD commands scanned",
            data.get("commands_scanned", 0),
            "commands",
            "neutral",
        ),
        _measure(
            "alfred_quality_issues",
            "Alfred command quality issues",
            data.get("issue_count", 0),
            "issues",
            "lower_is_better",
        ),
        _measure(
            "alfred_quality_warnings",
            "Alfred command quality warnings",
            data.get("warning_count", 0),
            "warnings",
            "lower_is_better",
        ),
    ]


def build_measures_document(
    *,
    lint: Mapping[str, Any] | None = None,
    parity: Mapping[str, Any] | None = None,
    quality: Mapping[str, Any] | None = None,
    source: str = DEFAULT_SOURCE,
    target: str | None = None,
) -> dict[str, Any]:
    """Assemble a Health ``schema_version = "1.0"`` measures document."""
    _validate_identifier(source, "source")
    if target is not None:
        _validate_identifier(target, "target")
    measures: list[dict[str, Any]] = []
    if lint is not None:
        measures.extend(measures_from_lint(lint))
    if parity is not None:
        measures.extend(measures_from_parity(parity))
    if quality is not None:
        measures.extend(measures_from_quality(quality))
    document: dict[str, Any] = {
        "schema_version": MEASURES_SCHEMA_VERSION,
        "source": source,
        "measures": measures,
    }
    if target is not None:
        document["target"] = target
    return document


def write_measures_file(path: str | Path, document: Mapping[str, Any]) -> Path:
    """Write a Health 1.0 measures document as UTF-8 JSON with a trailing newline."""
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    return destination
