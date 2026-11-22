"""Specification-authored execution-controls vectors (spec/vectors/execution-controls.json).

Runs every batch-limit case Python implements today (maxBatchSize = 500, maxBatchParallelism = 16)
and verifies that remaining gaps stay documented under gaps.python (#2129).
"""

import json
from pathlib import Path
from typing import Any

import pytest

from afd import ExposeOptions, success
from afd.server import create_server
from afd.server.factory import DEFAULT_MAX_BATCH_PARALLELISM, DEFAULT_MAX_BATCH_SIZE

VECTORS = json.loads(
    (
        Path(__file__).resolve().parents[2] / "spec" / "vectors" / "execution-controls.json"
    ).read_text(encoding="utf-8")
)

EXECUTED_CONTROLS = {"batchLimits"}
BATCH_LIMIT_CASES = [c for c in VECTORS["cases"] if c["control"] == "batchLimits"]


def test_defaults_and_documented_gaps():
    defaults = VECTORS["defaults"]
    assert DEFAULT_MAX_BATCH_SIZE == defaults["maxBatchSize"] == 500
    assert DEFAULT_MAX_BATCH_PARALLELISM == defaults["maxBatchParallelism"] == 16
    assert defaults["defaultTimeoutMs"] == 30000
    assert defaults["maxValidationIssues"] == 100
    gaps = VECTORS["gaps"]["python"]
    assert gaps == {
        "deadline": "https://github.com/lushly-dev/afd/issues/2129",
        "defaultDeadline": "https://github.com/lushly-dev/afd/issues/2129",
        "singleCancellation": "https://github.com/lushly-dev/afd/issues/2129",
        "batchCancellation": "https://github.com/lushly-dev/afd/issues/2129",
        "validationIssueCap": "https://github.com/lushly-dev/afd/issues/2129",
    }
    gapped = set(gaps)
    for case in VECTORS["cases"]:
        control = case["control"]
        assert (control in EXECUTED_CONTROLS) ^ (control in gapped), (
            f"control {control!r} must be either executed or listed in gaps.python"
        )


@pytest.mark.parametrize("case", BATCH_LIMIT_CASES, ids=[c["id"] for c in BATCH_LIMIT_CASES])
async def test_batch_limits(case: dict[str, Any]):
    limits = case["limits"]
    server = create_server(
        "execution-controls-vectors",
        max_batch_size=limits["maxBatchSize"],
        max_batch_parallelism=limits["maxBatchParallelism"],
    )
    calls = 0

    @server.command(name="work-run", description="Echo input", expose=ExposeOptions(mcp=True))
    async def work_run(input: Any):
        nonlocal calls
        calls += 1
        return success(input)

    request = {
        "commands": [
            {"command": "work-run", "input": {"index": i}} for i in range(case["commandCount"])
        ],
        "options": {"parallelism": case["parallelism"]},
    }
    result = await server.call_tool("afd-batch", request)
    expected = case["expect"]

    assert result.success is expected["success"]
    if expected["success"]:
        assert result.summary.total == expected["total"]
        assert result.summary.success_count == expected["successCount"]
        assert calls == expected["total"]
    else:
        assert result.error is not None
        assert result.error.code == expected["code"]
        assert bool(result.error.retryable) is expected["retryable"]
        assert calls == expected["calls"]
        assert len(result.results) == expected["resultsLength"]
