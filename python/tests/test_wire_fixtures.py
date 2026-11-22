"""Round-trip the golden wire fixtures in spec/wire/ through the Python models.

Every AFD implementation must parse each fixture into its native result types
and serialize it back to exactly the same JSON (see spec/wire/README.md). The
TypeScript server produced these files; Rust and TypeScript run the same check.
"""

import json
from pathlib import Path
from typing import Any

import jsonschema
import pytest
import referencing
from referencing.jsonschema import DRAFT202012

from afd.core.batch import BatchResult
from afd.core.pipeline import PipelineResult
from afd.core.result import CommandResult
from afd.core.streaming import parse_stream_chunk
from afd.core.wire import to_wire

WIRE_DIR = Path(__file__).resolve().parents[2] / "spec" / "wire"
SCHEMA_DIR = Path(__file__).resolve().parents[2] / "spec" / "schema"

SCHEMA_FILES = (
    "error.json",
    "result.json",
    "output-envelope.json",
    "batch.json",
    "pipeline.json",
    "stream.json",
)

FIXTURE_SCHEMAS = {
    "result-success-minimal.json": "result.json",
    "result-success-full.json": "result.json",
    "result-failure.json": "result.json",
    "batch-result.json": "batch.json",
    "pipeline-result.json": "pipeline.json",
}


def _schema_validator(schema_file: str):
    registry = referencing.Registry()
    loaded = {}
    for name in SCHEMA_FILES:
        schema = json.loads((SCHEMA_DIR / name).read_text(encoding="utf-8"))
        loaded[name] = schema
        registry = registry.with_resource(
            schema["$id"], referencing.Resource.from_contents(schema, default_specification=DRAFT202012)
        )
    return jsonschema.Draft202012Validator(loaded[schema_file], registry=registry)

MODELS = {
    "result-success-minimal.json": CommandResult,
    "result-success-full.json": CommandResult,
    "result-failure.json": CommandResult,
    "batch-result.json": BatchResult,
    "pipeline-result.json": PipelineResult,
}


def _load(name: str) -> Any:
    return json.loads((WIRE_DIR / name).read_text(encoding="utf-8"))


def _snake_case_keys(value: Any) -> Any:
    """The fixture with every object key snake_cased (the old Python format)."""
    from pydantic.alias_generators import to_snake

    if isinstance(value, dict):
        return {to_snake(key): _snake_case_keys(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_snake_case_keys(item) for item in value]
    return value


def test_every_fixture_is_covered():
    on_disk = {path.name for path in WIRE_DIR.glob("*.json")}
    assert on_disk == set(MODELS) | {"stream-chunks.json"}


@pytest.mark.parametrize("name", sorted(MODELS))
def test_fixture_round_trips(name: str):
    original = _load(name)

    parsed = MODELS[name].model_validate(original)

    assert to_wire(parsed) == original


@pytest.mark.parametrize("name", sorted(MODELS))
def test_fixture_round_trips_through_json_text(name: str):
    original = _load(name)

    text = json.dumps(to_wire(MODELS[name].model_validate(original)))

    assert json.loads(text) == original


def test_stream_chunks_round_trip():
    original = _load("stream-chunks.json")

    chunks = [parse_stream_chunk(chunk) for chunk in original]

    assert [chunk.type for chunk in chunks] == ["progress", "data", "complete", "error"]
    assert [to_wire(chunk) for chunk in chunks] == original


def test_parsed_fields_use_snake_case_attributes():
    full = CommandResult.model_validate(_load("result-success-full.json"))
    assert full.undo_command == "todo-delete"
    assert full.undo_args == {"id": "todo-2"}
    assert full.metadata.execution_time_ms == 0
    assert full.metadata.trace_id == "trace-fixture"
    assert full.plan[1].depends_on == ["validate"]
    assert full.sources[0].accessed_at == "2026-01-01T00:00:00.000Z"

    batch = BatchResult.model_validate(_load("batch-result.json"))
    assert batch.summary.success_count == 1
    assert batch.results[1].result.error.suggestion == "Use todo-list to see available todos"

    pipeline = PipelineResult.model_validate(_load("pipeline-result.json"))
    assert pipeline.metadata.completed_steps == 2
    assert pipeline.metadata.reasoning_steps[0].step_index == 1
    assert pipeline.metadata.pipeline_sources[0].step_index == 1


@pytest.mark.parametrize("name", sorted(MODELS))
def test_snake_case_input_is_still_accepted(name: str):
    # Older Python servers sent snake_case keys; clients must keep parsing them.
    original = _load(name)
    legacy = _snake_case_keys(original)

    parsed = MODELS[name].model_validate(legacy)

    # Free-form dicts (data, details, undoArgs) keep the keys they were sent
    # with, so only compare the envelope fields.
    wire = to_wire(parsed)
    assert set(wire) == set(original)
    assert wire.get("success") == original.get("success")


def test_unset_fields_are_omitted_not_null():
    result = CommandResult(success=True, data={"id": "1", "note": None})

    assert to_wire(result) == {"success": True, "data": {"id": "1", "note": None}}


@pytest.mark.parametrize("name", sorted(FIXTURE_SCHEMAS))
def test_fixture_validates_against_json_schema(name: str):
    original = _load(name)
    validator = _schema_validator(FIXTURE_SCHEMAS[name])
    validator.validate(original)
    validator.validate(to_wire(MODELS[name].model_validate(original)))


def test_stream_chunks_validate_against_json_schema():
    original = _load("stream-chunks.json")
    validator = _schema_validator("stream.json")
    for chunk in original:
        validator.validate(chunk)
        validator.validate(to_wire(parse_stream_chunk(chunk)))


def test_json_schema_rejects_malformed_results_and_errors():
    result_validator = _schema_validator("result.json")
    error_validator = _schema_validator("error.json")
    stream_validator = _schema_validator("stream.json")

    assert not result_validator.is_valid({"success": True, "confidence": 1.5})
    assert not result_validator.is_valid(
        {"success": True, "error": {"code": "E", "message": "bad"}}
    )
    assert not result_validator.is_valid({"success": False})
    assert not result_validator.is_valid(
        {"success": False, "data": {}, "error": {"code": "E", "message": "bad"}}
    )
    assert not result_validator.is_valid({"success": True, "unknownField": 1})
    assert not error_validator.is_valid({"message": "missing code"})
    assert not stream_validator.is_valid({"type": "unknown"})
