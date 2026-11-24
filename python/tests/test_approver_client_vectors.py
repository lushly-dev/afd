"""The language-neutral vectors in spec/vectors/approver-client.json.

Approval evidence from an approver client and the approval display rules
(spec/command-metadata.md; Loam phase 5, step 0c) are implemented in TypeScript and Rust. Python
has neither yet: the file lists Python in its ``gaps``, and every case here is skipped as that
documented gap until Python implements them and leaves the list
(https://github.com/lushly-dev/afd/issues/1466).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

VECTORS = json.loads(
    (Path(__file__).resolve().parents[2] / "spec" / "vectors" / "approver-client.json").read_text(
        encoding="utf-8"
    )
)
GAP = VECTORS["gaps"].get("python")


def test_python_is_a_documented_gap():
    # When Python implements the carrier and the display rules, it leaves `gaps` and these tests
    # run the cases instead of skipping them.
    assert GAP == "https://github.com/lushly-dev/afd/issues/1466"


@pytest.mark.parametrize("case", VECTORS["display"]["cases"], ids=lambda case: case["description"])
def test_display(case):
    assert case["expected"]
    pytest.skip(f"approval display rules: documented Python gap, {GAP}")


@pytest.mark.parametrize("case", VECTORS["carrier"]["cases"], ids=lambda case: case["description"])
def test_carrier(case):
    assert case["steps"]
    pytest.skip(f"approver carrier: documented Python gap, {GAP}")
