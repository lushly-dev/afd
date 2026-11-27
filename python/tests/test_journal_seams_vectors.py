"""The language-neutral vectors in spec/vectors/journal-seams.json.

The dispatch id (spec/dispatch.md, "The dispatch id") and the approval summary
(spec/command-metadata.md, "The approval summary") are implemented in no language yet. The file
lists Python in its ``gaps``, and every case here is skipped as that documented gap until Python
implements them and leaves the list (https://github.com/lushly-dev/afd/issues/2682).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

VECTORS = json.loads(
    (Path(__file__).resolve().parents[2] / "spec" / "vectors" / "journal-seams.json").read_text(
        encoding="utf-8"
    )
)
GAP = VECTORS["gaps"].get("python")


def test_python_is_a_documented_gap():
    # When Python implements the dispatch id and the approval summary, it leaves `gaps` and
    # these tests run the cases instead of skipping them.
    assert GAP == "https://github.com/lushly-dev/afd/issues/2682"


def test_the_id_pattern_is_usable():
    id_format = VECTORS["dispatchId"]["format"]
    assert id_format["length"] == 22
    assert re.fullmatch(id_format["pattern"], "A" * 22)
    # Sixteen bytes leave two bits for the last character, so most letters cannot end an id.
    assert not re.fullmatch(id_format["pattern"], "B" * 22)


@pytest.mark.parametrize(
    "case", VECTORS["dispatchId"]["cases"], ids=lambda case: case["description"]
)
def test_dispatch_id(case):
    assert case["run"] and case["expect"]
    pytest.skip(f"dispatch id: documented Python gap, {GAP}")


@pytest.mark.parametrize(
    "case", VECTORS["approvalSummary"]["cases"], ids=lambda case: case["description"]
)
def test_approval_summary(case):
    assert case["run"] and case["expect"]
    pytest.skip(f"approval summary: documented Python gap, {GAP}")
