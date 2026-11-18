"""The language-neutral vectors in spec/vectors/app-calls.json.

App-to-app calls and the ``apps`` exposure flag (spec/command-metadata.md, "App-to-app calls";
Loam phase 5, step 0b) are implemented in TypeScript and Rust. Python has neither yet: the file
lists Python in its ``gaps``, and every case here is skipped as that documented gap until Python
implements them and leaves the list (https://github.com/lushly-dev/afd/issues/1513). Meanwhile
``apps`` names no surface, so a call naming it is refused as for any such interface:
``COMMAND_NOT_FOUND`` for a missing command, ``COMMAND_NOT_EXPOSED`` for one that exists.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from afd.core.errors import ErrorCodes

VECTORS = json.loads(
    (Path(__file__).resolve().parents[2] / "spec" / "vectors" / "app-calls.json").read_text(
        encoding="utf-8"
    )
)
GAP = VECTORS["gaps"].get("python")


def test_python_is_a_documented_gap():
    # When Python implements app-to-app calls, it leaves `gaps` and these tests run the cases
    # instead of skipping them.
    assert GAP == "https://github.com/lushly-dev/afd/issues/1513"
    assert VECTORS["refusal"]["code"] == ErrorCodes.CALL_NOT_GRANTED


@pytest.mark.parametrize("case", VECTORS["exposure"], ids=lambda case: case["description"])
def test_exposure(case):
    assert case["exposed"]
    pytest.skip(f"the apps exposure flag: documented Python gap, {GAP}")


@pytest.mark.parametrize(
    "case", VECTORS["calls"] + VECTORS["batches"], ids=lambda case: case["description"]
)
def test_calls(case):
    assert case["expect"]
    pytest.skip(f"app-to-app calls: documented Python gap, {GAP}")
