"""The language-neutral vectors in spec/vectors/pipeline-variables.json.

The TypeScript implementation generated the expected values; any difference
between Python and TypeScript on these inputs fails here. TypeScript, Rust and
C++ load the same file (see spec/vectors/README.md).
"""

import json
from pathlib import Path
from typing import Any, Dict, List

import pytest

from afd.core.pipeline import (
    PipelineContext,
    StepResult,
    StepStatus,
    evaluate_condition,
    resolve_variable,
    resolve_variables,
)

VECTORS = json.loads(
    (Path(__file__).resolve().parents[2] / "spec" / "vectors" / "pipeline-variables.json").read_text(
        encoding="utf-8"
    )
)


def _context(spec: Dict[str, Any]) -> PipelineContext:
    steps: List[StepResult] = [
        StepResult(
            index=entry["index"],
            alias=entry.get("alias"),
            command=f"step-{entry['index']}",
            status=StepStatus(entry["status"]),
            data=entry.get("data"),
        )
        for entry in spec["steps"]
    ]
    return PipelineContext(
        pipeline_input=spec["input"], steps=steps, previous_result=steps[spec["previous"]]
    )


def _same(actual: Any, expected: Any) -> bool:
    """JSON equality that, unlike ==, tells True from 1 and 1 from 1.0."""
    return json.dumps(actual, sort_keys=True) == json.dumps(expected, sort_keys=True)


def _label(text: str) -> str:
    printable = json.dumps(text)
    return f"{printable[:40]}... ({len(text)} chars)" if len(printable) > 60 else printable


CONTEXT = _context(VECTORS["context"])


def test_vectors_have_the_expected_number_of_cases():
    assert len(VECTORS["references"]) >= 40
    assert len(VECTORS["conditions"]) >= 20


@pytest.mark.parametrize(
    "vector", VECTORS["references"], ids=[_label(v["reference"]) for v in VECTORS["references"]]
)
def test_reference(vector: Dict[str, Any]):
    reference = vector["reference"]
    # resolve_variable returns None for both null and an unresolved reference;
    # inside a step input, an unresolved reference is omitted from its object.
    resolved = resolve_variables({"value": reference}, CONTEXT)
    if vector["resolved"]:
        assert _same(resolved, {"value": vector["value"]})
        assert _same(resolve_variable(reference, CONTEXT), vector["value"])
    else:
        assert resolved == {}
        assert resolve_variable(reference, CONTEXT) is None


@pytest.mark.parametrize(
    "vector", VECTORS["conditions"], ids=[json.dumps(v["condition"]) for v in VECTORS["conditions"]]
)
def test_condition(vector: Dict[str, Any]):
    assert evaluate_condition(vector["condition"], CONTEXT) is vector["expected"]
