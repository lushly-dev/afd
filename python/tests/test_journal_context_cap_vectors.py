"""The language-neutral vectors in spec/vectors/journal-context-cap.json.

spec/vectors/generate-journal-context-cap.mjs pads each value to a set number of bytes from the
journal's 4096-byte cap, measured as UTF-8 canonical JSON with numbers as JavaScript writes them,
and records what TypeScript keeps (spec/journal.md, "Declared context fields";
spec/vectors/README.md).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from afd.core.commands import CommandContext
from afd.core.journal import JournalContextFields, canonical_json
from afd.server import MAX_JOURNAL_CONTEXT_BYTES, journal_context_fields

VECTORS = json.loads(
    (
        Path(__file__).resolve().parents[2] / "spec" / "vectors" / "journal-context-cap.json"
    ).read_text(encoding="utf-8")
)
FIELD = VECTORS["field"]


def test_the_vectors_use_the_cap_the_journal_applies():
    assert VECTORS["maxBytes"] == MAX_JOURNAL_CONTEXT_BYTES


@pytest.mark.parametrize("case", VECTORS["cases"], ids=lambda case: case["description"])
def test_the_cap_measures_and_keeps_as_typescript_does(case: dict[str, Any]):
    value = json.loads(case["json"])
    assert len(canonical_json(value).encode("utf-8")) == case["bytes"]

    journaled = journal_context_fields(CommandContext(extra={FIELD: value}), [FIELD])
    if case["expected"] == "kept":
        assert journaled == JournalContextFields(context={FIELD: value})
    else:
        assert journaled == JournalContextFields(context_omitted=[FIELD])
