"""Tests for the phase 0 tools, on invented fixtures.

    uv run --python 3.12 --with pytest --with numpy --with snowballstemmer \\
        pytest docs/features/active/ideas/prototype -q
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import corpus
import ideas
from sentences import divide, split_sentences, statement_of

NOTES = """---
title: Garden notes
---
# Soil

Check the water supply before breaking ground. Dr. Lee said 3.5 cm is enough, e.g. in clay. Is it? Yes.

- Dig a **test hole** and time how fast it drains
- Keep hens under the [fruit trees](https://example.org). They eat the windfall.

> A garden is never finished.

| Bed | Crop |
| --- | --- |
| North | Beans |

Note: this line is prose, not a turn.

```sh
echo planted
```
"""

TRANSCRIPT = "\n\n".join(
    [
        "**Ana:** Where should the orchard go? I think north.",
        "**Ben:** The south slope drains better.",
        "**Ana:** Fine. South then.",
        "**Ben:** Good.",
        "**Ana:** And hens under the trees.",
        "**Ben:** Agreed. They eat the windfall.",
    ]
)

FIELDS = "\n\n".join(f"Goal: grow item {n}.\n\nKeywords: soil, bed {n}." for n in range(4))


def test_sentences_split_without_breaking_abbreviations_or_numbers():
    assert split_sentences("Dr. Lee said 3.5 cm is enough, e.g. in clay. Is it? Yes.") == [
        "Dr. Lee said 3.5 cm is enough, e.g. in clay.",
        "Is it?",
        "Yes.",
    ]


def test_divide_numbers_each_kind_and_strips_markup():
    units, left_out = divide(NOTES)
    kinds = [u.kind for u in units]
    assert kinds == ["heading", "prose", "prose", "prose", "prose", "list", "list", "list", "quote",
                     "table", "table", "prose", "code"]
    assert [u.n for u in units] == list(range(1, len(units) + 1))
    assert units[5].text == "Dig a test hole and time how fast it drains"
    assert not units[5].ends_cleanly
    assert units[6].text == "Keep hens under the fruit trees."
    assert units[1].headings == ["Soil"]
    assert left_out["front_matter_lines"] == 3
    assert units[11].speaker is None


def test_statement_of_takes_cited_units_in_order():
    units, _ = divide(NOTES)
    assert statement_of(units, [7, 8]) == "Keep hens under the fruit trees. They eat the windfall."


def test_transcript_turns_carry_their_speaker():
    units, left_out = divide(TRANSCRIPT, transcript=True)
    assert left_out["transcript"]
    assert [u.speaker for u in units][:3] == ["Ana", "Ana", "Ben"]
    assert units[0].text == "Where should the orchard go?"


def test_whether_a_source_is_a_transcript_is_a_setting():
    # Labelled fields take turns just as speakers do, so nothing is guessed.
    units, left_out = divide(FIELDS)
    assert not left_out["transcript"] and all(u.speaker is None for u in units)
    units, _ = divide(FIELDS, transcript=True)
    assert units[0].speaker == "Goal"
    units, _ = divide(TRANSCRIPT)
    assert all(u.speaker is None for u in units)


def test_corpus_folds_copies_and_line_endings(tmp_path: Path):
    (tmp_path / "a.md").write_bytes(b"Plant beans.\nWater them.\n")
    (tmp_path / "copy.md").write_bytes(b"Plant beans.\nWater them.\n")
    (tmp_path / "crlf.md").write_bytes(b"Plant beans.  \r\nWater them.\r\n\r\n")
    (tmp_path / "other.md").write_bytes(b"Hens eat the windfall.\n")
    manifest, counts = corpus.census(tmp_path, (".md",))
    assert counts["files"] == 4
    assert counts["distinct_by_bytes"] == 3
    assert counts["distinct_after_normalising"] == 2
    assert counts["files_that_repeat_another_byte_for_byte"] == 1
    assert counts["files_that_differ_only_in_line_endings_or_trailing_space"] == 1
    assert "root" in manifest and all("path" not in k for k in counts)


def test_corpus_reports_a_later_draft(tmp_path: Path):
    body = " ".join(f"word{n}" for n in range(60))
    (tmp_path / "draft-1.md").write_text(body + "\n")
    (tmp_path / "draft-2.md").write_text(body + " and a closing line about hens\n")
    _, counts = corpus.census(tmp_path, (".md",))
    assert counts["likely_version_pairs"] == 1


@pytest.fixture
def extracted(tmp_path: Path):
    root = tmp_path / "root"
    root.mkdir()
    (root / "notes.md").write_text(NOTES)
    manifest, _ = corpus.census(root, (".md",))
    source = manifest["sources"][0]["source"]
    out = tmp_path / "a"
    out.mkdir()
    rows = [
        {"source": source, "type": "principle", "cites": [2], "tags": ["Water"]},
        {"source": source, "type": "position", "cites": [7, 8], "statement": "Hens clear fallen fruit.",
         "tags": ["hens"]},
        {"source": source, "type": "principle", "cites": [99]},
        {"source": "src-unknown", "type": "principle", "cites": [1]},
        {"source": source, "type": "opinion", "cites": [2]},
    ]
    (out / "notes.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    return manifest, root, out


def test_resolve_checks_citations_and_marks_word_for_word(extracted):
    manifest, root, out = extracted
    found, problems = ideas.resolve(manifest, root, {"a": out})
    assert len(found) == 2 and len(problems) == 3
    verbatim, restated = found
    assert verbatim["verbatim"] and verbatim["statement"] == "Check the water supply before breaking ground."
    assert verbatim["tags"] == ["water"]
    assert restated["restated"] and not restated["verbatim"]
    assert restated["cited_kinds"] == ["list"]


def test_stats_hold_numbers_only(extracted):
    manifest, root, out = extracted
    found, _ = ideas.resolve(manifest, root, {"a": out})
    text = json.dumps(ideas.stats(found, manifest, {}))
    assert "water supply" not in text and "notes.md" not in text


def test_auc_and_bands():
    match = pytest.importorskip("match")
    assert match.auc([0.9, 0.8], [0.1, 0.2]) == 1.0
    assert match.auc([0.5], [0.5]) == 0.5
    scores = [0.95, 0.40, 0.90, 0.30, 0.85]
    labels = ["same", "distinct", "same", "related", "related"]
    probes = ["p1", "p1", "p2", "p2", "p3"]
    report = match.band_report(scores, labels, probes, (0.0,))
    band = report["same_band"]["at_most_0%_wrongly_refused"]
    assert band["threshold"] == 0.9 and band["duplicates_missed"] == 0
    assert report["probes_with_a_duplicate"] == 2


def test_lexical_scores_a_statement_one_against_itself():
    match = pytest.importorskip("match")
    lane = match.Lexical(["Plant beans in spring.", "Hens eat the windfall.", "Plant beans early in spring."])
    assert lane.directed(0, 0) == pytest.approx(1.0)
    assert lane.score(0, 2) > lane.score(0, 1)
