"""The language-neutral vectors in spec/vectors/idempotency.json.

Idempotency keys (spec/idempotency.md) are implemented in no language yet. The file lists Python
in its ``gaps``, and every case here is skipped as that documented gap until Python implements
them and leaves the list (https://github.com/lushly-dev/afd/issues/2676).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

VECTORS = json.loads(
    (Path(__file__).resolve().parents[2] / "spec" / "vectors" / "idempotency.json").read_text(
        encoding="utf-8"
    )
)
GAP = VECTORS["gaps"].get("python")

SECTIONS = {
    "declaration": VECTORS["declaration"]["cases"],
    "key.form": VECTORS["key"]["form"],
    "key.derived": VECTORS["key"]["derived"],
    "key.delivery": VECTORS["key"]["delivery"],
    "step": VECTORS["step"]["cases"],
    "step.options": VECTORS["step"]["options"],
    "retry": VECTORS["retry"]["cases"],
    "timeoutRecovery": VECTORS["timeoutRecovery"]["cases"],
    "journal": VECTORS["journal"]["cases"],
}
CASES = [
    pytest.param(
        section,
        case,
        id=f"{section}: {case.get('description') or case.get('expected')} (gap #2676)",
    )
    for section, cases in SECTIONS.items()
    for case in cases
]


def test_python_is_a_documented_gap():
    # When Python implements idempotency keys, it leaves `gaps` and these tests run the cases
    # instead of skipping them.
    assert GAP == "https://github.com/lushly-dev/afd/issues/2676"


def test_every_section_has_cases_and_the_meta_key_is_named():
    assert VECTORS["metaKey"] == "dev.afd/idempotencyKey"
    assert all(SECTIONS.values())


@pytest.mark.parametrize(("section", "case"), CASES)
def test_case(section, case):
    assert case
    pytest.skip(f"idempotency {section}: documented Python gap, {GAP}")
