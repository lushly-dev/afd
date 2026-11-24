"""spec/vectors/recovery.json (spec/recovery.md): every valid CommandError passes the error schema
and round-trips through ``CommandError`` unchanged; every invalid one fails the schema."""

from __future__ import annotations

import json
from pathlib import Path

import jsonschema
import pytest

from afd import CommandError, Recovery, is_command_recovery
from afd.core.wire import to_wire

SPEC = Path(__file__).resolve().parents[2] / "spec"
VECTORS = json.loads((SPEC / "vectors" / "recovery.json").read_text(encoding="utf-8"))
VALIDATOR = jsonschema.Draft202012Validator(
    json.loads((SPEC / "schema" / "error.json").read_text(encoding="utf-8"))
)


def test_there_are_cases_of_both_kinds():
    assert VECTORS["valid"] and VECTORS["invalid"]


@pytest.mark.parametrize("case", VECTORS["valid"], ids=lambda c: c["name"])
def test_a_valid_error_passes_the_schema_and_round_trips(case):
    VALIDATOR.validate(case["error"])
    parsed = CommandError.model_validate(case["error"])
    if "recovery" in case["error"]:
        assert isinstance(parsed.recovery, Recovery)
    assert to_wire(parsed) == case["error"]


@pytest.mark.parametrize("case", VECTORS["normalizes"], ids=lambda c: c["name"])
def test_a_normalized_error_passes_the_schema_and_reads_as_given(case):
    VALIDATOR.validate(case["error"])
    assert to_wire(CommandError.model_validate(case["error"])) == case["readsAs"]


@pytest.mark.parametrize("case", VECTORS["invalid"], ids=lambda c: c["name"])
def test_an_invalid_error_fails_the_schema_and_reads_leniently(case):
    assert not VALIDATOR.is_valid(case["error"]), case["rule"]
    assert to_wire(CommandError.model_validate(case["error"])) == case["readsAs"], case["rule"]


RECOVERY_VALIDATOR = jsonschema.Draft202012Validator(
    {
        **{k: v for k, v in VALIDATOR.schema.items() if k in ("$schema", "$defs")},
        "$ref": "#/$defs/recovery",
    }
)


def _recoveries(error):
    if "recovery" in error:
        yield error["recovery"]
    if isinstance(error.get("cause"), dict):
        yield from _recoveries(error["cause"])


def test_python_reads_a_recovery_exactly_when_the_schema_accepts_it():
    every = [
        r
        for kind in ("valid", "normalizes", "invalid")
        for c in VECTORS[kind]
        for r in _recoveries(c["error"])
    ]
    assert len(every) > 30
    for recovery in every:
        read = CommandError.model_validate({"code": "X", "message": "m", "recovery": recovery})
        assert (read.recovery is not None) == RECOVERY_VALIDATOR.is_valid(recovery), recovery
        assert is_command_recovery(recovery) == RECOVERY_VALIDATOR.is_valid(recovery), recovery


def test_a_recovery_this_version_cannot_read_is_no_recovery():
    error = CommandError.model_validate(
        {"code": "X", "message": "m", "suggestion": "s", "recovery": {"kind": "reboot"}}
    )
    assert error.recovery is None and error.suggestion == "s"
    assert (
        CommandError.model_validate(
            {"code": "X", "message": "m", "recovery": {"kind": "call"}}
        ).recovery
        is None
    )


def test_a_recovery_built_in_python_keeps_its_fields_to_their_kind():
    with pytest.raises(ValueError):
        Recovery(kind="stop", command="issue-check")
    with pytest.raises(ValueError):
        Recovery(kind="call")
    with pytest.raises(ValueError):
        Recovery(kind="fix-input")
    with pytest.raises(ValueError):
        Recovery(kind="fix-input", input={"confirm": True})
    with pytest.raises(ValueError):
        Recovery(kind="retry", after_ms="30")  # type: ignore[arg-type]
    assert to_wire(Recovery(kind="retry", after_ms=5)) == {"kind": "retry", "afterMs": 5}


def test_a_recovery_changed_after_it_was_built_is_checked_as_written():
    changed = Recovery(kind="call", command="issue-check")
    changed.command = ""
    assert not is_command_recovery(changed)
    with pytest.raises(ValueError):
        CommandError(code="X", message="m", recovery=changed)
    assert is_command_recovery(Recovery(kind="call", command="issue-check", then_retry=True))
