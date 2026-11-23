"""Producer-written trend measures; Health reads files and never runs project scripts.

Measures files are JSON or TOML with ``schema_version = "1.0"``::

    schema_version = "1.0"
    source = "sweep-bloat"       # optional default producer for measures in this file
    # target = "sample-project"  # optional default target id for measures in this file

    [[measures]]
    key = "files_over_warn"
    label = "Files over size warning"
    value = 12
    unit = "files"
    direction = "lower_is_better"
    # target = "sample-project"  # optional; overrides file-level target
    # source = "sweep-bloat"     # optional; overrides file-level source
"""

from __future__ import annotations

import json
import math
import os
import re
import stat
import tomllib
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, NoReturn

MeasureDirection = Literal["higher_is_better", "lower_is_better", "neutral"]
MEASURE_DIRECTIONS: tuple[MeasureDirection, ...] = (
    "higher_is_better",
    "lower_is_better",
    "neutral",
)
MEASURES_SCHEMA_VERSION = "1.0"
# Measures files are small summaries; cap before reading so a wrong file never exhausts memory.
MAX_MEASURES_FILE_BYTES = 10 * 1024 * 1024
# IEEE-754 double safe integer range so JSON values round-trip identically in Python and JavaScript.
MAX_SAFE_MEASURE_VALUE = (1 << 53) - 1

_IDENTIFIER = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9._-]*")
_FILE_KEYS = {"schema_version", "measures", "source", "target"}
_REQUIRED_MEASURE_KEYS = {"key", "label", "value", "unit", "direction"}
_OPTIONAL_MEASURE_KEYS = {"target", "source"}


def _reject_json_constant(token: str) -> NoReturn:
    raise ValueError(f"Non-finite JSON number is not allowed: {token}")


def _validate_identifier(value: object, field_name: str) -> str:
    if not isinstance(value, str) or not _IDENTIFIER.fullmatch(value):
        raise ValueError(f"Measure {field_name} must be a stable, nonempty identifier")
    return value


@dataclass(frozen=True)
class Measure:
    """One numeric trend observation read from a producer-written measures file."""

    key: str
    label: str
    value: int | float
    unit: str
    direction: MeasureDirection
    target: str | None = None
    source: str | None = None

    def __post_init__(self) -> None:
        _validate_identifier(self.key, "key")
        if not isinstance(self.label, str) or not self.label.strip():
            raise ValueError("Measure label must be a nonempty string")
        if isinstance(self.value, bool) or not isinstance(self.value, int | float):
            raise ValueError("Measure value must be a finite number")
        if isinstance(self.value, int):
            if abs(self.value) > MAX_SAFE_MEASURE_VALUE:
                raise ValueError(
                    "Measure value must lie within "
                    f"[-{MAX_SAFE_MEASURE_VALUE}, {MAX_SAFE_MEASURE_VALUE}]"
                )
        else:
            if not math.isfinite(self.value):
                raise ValueError("Measure value must be a finite number")
            if abs(self.value) > MAX_SAFE_MEASURE_VALUE:
                raise ValueError(
                    "Measure value must lie within "
                    f"[-{MAX_SAFE_MEASURE_VALUE}, {MAX_SAFE_MEASURE_VALUE}]"
                )
            if self.value == 0.0:
                object.__setattr__(self, "value", 0.0)
        if not isinstance(self.unit, str) or not self.unit.strip():
            raise ValueError("Measure unit must be a nonempty string")
        if self.direction not in MEASURE_DIRECTIONS:
            allowed = ", ".join(MEASURE_DIRECTIONS)
            raise ValueError(f"Measure direction must be one of: {allowed}")
        if self.target is not None:
            _validate_identifier(self.target, "target")
        if self.source is not None:
            _validate_identifier(self.source, "source")

    def identity(self) -> tuple[str, str | None]:
        return (self.key, self.target)

    def describe(self) -> dict[str, object]:
        row: dict[str, object] = {
            "key": self.key,
            "label": self.label,
            "value": self.value,
            "unit": self.unit,
            "direction": self.direction,
        }
        if self.target is not None:
            row["target"] = self.target
        if self.source is not None:
            row["source"] = self.source
        return row


def validate_measures(
    measures: Iterable[Measure], *, known_targets: set[str] | None = None
) -> tuple[Measure, ...]:
    """Validate Measure instances, uniqueness by (key, target), and optional target membership."""
    validated: list[Measure] = []
    seen: set[tuple[str, str | None]] = set()
    for item in measures:
        if not isinstance(item, Measure):
            raise ValueError("Each measure must be a Measure instance")
        identity = item.identity()
        if identity in seen:
            scope = f" for target {item.target!r}" if item.target is not None else ""
            raise ValueError(f"Duplicate measure {item.key!r}{scope}")
        if (
            known_targets is not None
            and item.target is not None
            and item.target not in known_targets
        ):
            raise ValueError(f"Measure {item.key!r} names unknown target {item.target!r}")
        seen.add(identity)
        validated.append(item)
    return tuple(validated)


def _optional_string(data: Mapping, key: str, context: str) -> str | None:
    if key not in data:
        return None
    value = data[key]
    if not isinstance(value, str):
        raise ValueError(f"{context} {key} must be a string")
    return value


def measures_from_mapping(data: Mapping) -> tuple[Measure, ...]:
    """Parse and validate a measures mapping against the 1.0 measures-file contract."""
    if not isinstance(data, Mapping):
        raise ValueError("Measures data must be an object")
    unknown = set(data) - _FILE_KEYS
    if unknown:
        raise ValueError(f"Unknown measures file keys: {sorted(unknown)}")
    if data.get("schema_version") != MEASURES_SCHEMA_VERSION:
        raise ValueError(f"Measures schema_version must be {MEASURES_SCHEMA_VERSION}")
    default_source = _optional_string(data, "source", "Measures file")
    default_target = _optional_string(data, "target", "Measures file")
    if default_source is not None:
        _validate_identifier(default_source, "source")
    if default_target is not None:
        _validate_identifier(default_target, "target")
    rows = data.get("measures")
    if not isinstance(rows, list):
        raise ValueError("measures must be a list")
    result: list[Measure] = []
    for index, row in enumerate(rows):
        if not isinstance(row, Mapping):
            raise ValueError(f"measures[{index}] must be an object")
        row_keys = set(row)
        missing = _REQUIRED_MEASURE_KEYS - row_keys
        if missing:
            raise ValueError(f"measures[{index}] is missing required keys: {sorted(missing)}")
        extra = row_keys - _REQUIRED_MEASURE_KEYS - _OPTIONAL_MEASURE_KEYS
        if extra:
            raise ValueError(f"measures[{index}] has unknown keys: {sorted(extra)}")
        target = (
            _optional_string(row, "target", f"measures[{index}]")
            if "target" in row
            else default_target
        )
        source = (
            _optional_string(row, "source", f"measures[{index}]")
            if "source" in row
            else default_source
        )
        result.append(
            Measure(
                key=row["key"],
                label=row["label"],
                value=row["value"],
                unit=row["unit"],
                direction=row["direction"],
                target=target,
                source=source,
            )
        )
    return validate_measures(result)


def load_measures(path: str | Path) -> tuple[Measure, ...]:
    """Read one caller-selected regular JSON or TOML measures file."""
    file_path = Path(path)
    st = file_path.stat()
    if not stat.S_ISREG(st.st_mode):
        raise ValueError("Measures path must be a regular file")
    if st.st_size > MAX_MEASURES_FILE_BYTES:
        raise ValueError(f"Measures file exceeds {MAX_MEASURES_FILE_BYTES} bytes")
    with file_path.open("rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError("Measures path must be a regular file")
        raw = stream.read(MAX_MEASURES_FILE_BYTES + 1)
    if len(raw) > MAX_MEASURES_FILE_BYTES:
        raise ValueError(f"Measures file exceeds {MAX_MEASURES_FILE_BYTES} bytes")
    text = raw.decode("utf-8")
    data = (
        json.loads(text, parse_constant=_reject_json_constant)
        if file_path.suffix.lower() == ".json"
        else tomllib.loads(text)
    )
    if not isinstance(data, dict):
        raise ValueError("Measures file must contain a JSON or TOML object")
    return measures_from_mapping(data)


def load_measures_files(paths: Iterable[str | Path]) -> tuple[Measure, ...]:
    """Read zero or more measures files in order and reject duplicate (key, target) pairs."""
    if isinstance(paths, str | bytes | Path):
        raise ValueError("paths must be an iterable of file paths, not a single path")
    combined: list[Measure] = []
    for path in paths:
        combined.extend(load_measures(path))
    return validate_measures(combined)
