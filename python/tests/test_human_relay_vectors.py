"""The language-neutral vectors in spec/vectors/human-relay.json.

The relay's pending list (spec/command-metadata.md, "The pending list") is implemented in Rust.
Python does not implement it yet: the file lists Python in its ``gaps``, and the cases are skipped
here as that documented gap until #2723 implements ``HumanRelay.pending_list`` and leaves the list
(https://github.com/lushly-dev/afd/issues/2723).
"""

from __future__ import annotations

import json
from pathlib import Path

VECTORS = json.loads(
    (Path(__file__).resolve().parents[2] / "spec" / "vectors" / "human-relay.json").read_text(
        encoding="utf-8"
    )
)


def test_python_is_a_documented_gap():
    # When Python implements pending_list, it leaves `gaps` and these tests run the cases instead.
    assert VECTORS["gaps"].get("python") == "https://github.com/lushly-dev/afd/issues/2723"
    assert VECTORS["pending"]
    assert VECTORS["invalid"]
