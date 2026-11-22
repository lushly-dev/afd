"""Exercise every shared validation vector through the MCP tool router."""

import json
from pathlib import Path

import pytest

from afd import ExposeOptions, success
from afd.core.wire import to_wire
from afd.server import create_server
from afd.server.validation import ValidationError, format_enhanced_validation_error

CASES = json.loads(
    (Path(__file__).resolve().parents[2] / "spec/vectors/validation.json").read_text(encoding="utf-8")
)["cases"]
TESTS = [(case, test) for case in CASES for test in case["tests"]]


def _canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False)


def _issues(details):
    # Sibling issue and field-list order is not part of cross-language parity.
    return sorted(
        _canonical({key: issue[key] for key in ("path", "code", "expected") if key in issue})
        for issue in details["errors"]
    )


AFD_VALIDATION_ISSUE_CODES = frozenset(
    {
        "invalid_type",
        "invalid_value",
        "too_small",
        "too_big",
        "unrecognized_keys",
        "invalid_format",
        "invalid_union",
        "not_multiple_of",
        "custom",
    }
)


@pytest.mark.parametrize(
    "case,test",
    TESTS,
    ids=[f"{case['id']}[{index}]" for case in CASES for index, _ in enumerate(case["tests"])],
)
async def test_validation_vector(case, test):
    server = create_server("validation-vector")

    @server.command(
        name="vector-validate",
        description="Validate vector input",
        input_schema=case["schema"],
        expose=ExposeOptions(mcp=True),
    )
    async def echo(value):
        return success(value)

    result = await server.call_tool("vector-validate", test["input"])
    assert result.success is test["valid"]
    if test["valid"]:
        assert result.data == test["data"]
        return
    actual = to_wire(result.error)
    expected = test["error"]
    assert actual["code"] == expected["code"]
    assert actual["message"] == expected["message"]
    assert _issues(actual["details"]) == _issues(expected["details"])
    for issue in actual["details"]["errors"]:
        assert issue["code"] in AFD_VALIDATION_ISSUE_CODES
        assert isinstance(issue.get("message"), str) and len(issue["message"]) > 0
    for key in ("expectedFields", "unexpectedFields", "missingFields"):
        assert (key in actual["details"]) == (key in expected["details"])
        assert sorted(actual["details"].get(key, [])) == sorted(expected["details"].get(key, []))
    assert actual["suggestion"] == format_enhanced_validation_error(
        [ValidationError(**issue) for issue in actual["details"]["errors"]], actual["details"]
    )
    # Issue wording is advisory unless the vector explicitly pins exactMessage: true
    # (spec/validation.md).
    if test.get("exactMessage") is True:
        assert sorted(_canonical(issue) for issue in actual["details"]["errors"]) == sorted(
            _canonical(issue) for issue in expected["details"]["errors"]
        )
