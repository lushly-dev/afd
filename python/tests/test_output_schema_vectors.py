"""spec/vectors/output-schema.json: the CommandResult envelope a command tool advertises as its
top-level ``outputSchema`` (``spec/command-metadata.md``, "Structured results")."""

import copy
import json
from pathlib import Path

import pytest

from afd.core.commands import command_result_output_schema

VECTORS = json.loads(
    (Path(__file__).resolve().parents[2] / "spec/vectors/output-schema.json").read_text(
        encoding="utf-8"
    )
)


@pytest.mark.parametrize("case", VECTORS["cases"], ids=lambda case: case["description"])
def test_the_envelope_matches_typescript(case):
    assert command_result_output_schema(copy.deepcopy(case["dataSchema"])) == case["outputSchema"]


def test_a_pointer_with_a_unicode_digit_is_not_followed():
    # Output schemas are not checked against the $ref subset; "²" is a digit to isdigit() only.
    schema = {"type": "object", "properties": {"p": {"$ref": "#/allOf/\u00b2"}}, "required": ["p"]}
    assert command_result_output_schema(schema)["properties"]["data"]["required"] == ["p"]
