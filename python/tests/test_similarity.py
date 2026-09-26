"""Fuzzy name matching and truncation, pinned to the TypeScript reference.

Expected values come from packages/core/src/similarity.ts, which counts
lengths and edit distance in UTF-16 code units. An emoji is one Python
character but two code units.
"""

import pytest

from afd.core.similarity import (
    MAX_SIMILARITY_INPUT_LENGTH,
    calculate_similarity,
    find_similar_tools,
    truncate_name,
)

GRIN = "\U0001f600"
BEAM = "\U0001f601"


class TestCalculateSimilarity:
    @pytest.mark.parametrize(
        ("a", "b", "expected"),
        [
            ("todo-create", "todo-create", 1.0),
            ("Todo-Create", "todo-create", 1.0),
            ("", "", 1.0),
            ("abc", "", 0.0),
            ("todo-craete", "todo-create", 1 - 2 / 11),
            # The emoji differ only in their low surrogate: 1 edit in 3 units.
            ("a" + GRIN, "a" + BEAM, 0.6666666666666667),
            (GRIN * 2, BEAM * 2, 0.5),
        ],
    )
    def test_matches_typescript(self, a, b, expected):
        assert calculate_similarity(a, b) == expected

    def test_counts_a_lone_surrogate_as_one_unit(self):
        assert calculate_similarity("\ud83d", "\ud83d" + "x") == 0.5


class TestFindSimilarTools:
    def test_suggests_emoji_names_that_share_high_surrogates(self):
        assert find_similar_tools(GRIN * 2, [BEAM * 2]) == [BEAM * 2]

    def test_matches_names_of_exactly_128_units(self):
        assert MAX_SIMILARITY_INPUT_LENGTH == 128
        assert find_similar_tools(GRIN * 64, [GRIN * 64]) == [GRIN * 64]
        assert find_similar_tools("a" * 128, ["a" * 128]) == ["a" * 128]

    def test_skips_names_over_128_units(self):
        assert find_similar_tools(GRIN * 65, [GRIN * 65]) == []
        assert find_similar_tools("a" * 129, ["a" * 129]) == []

    def test_sorts_by_similarity_and_keeps_input_order_for_ties(self):
        tools = ["todo-list", "todo-crate", "todo-creat", "todo-create"]

        assert find_similar_tools("todo-create", tools) == [
            "todo-create",
            "todo-crate",
            "todo-creat",
        ]

    def test_limits_suggestions(self):
        tools = ["todo-create", "todo-crate", "todo-creat"]

        assert find_similar_tools("todo-create", tools, max_suggestions=1) == ["todo-create"]

    def test_drops_names_below_threshold(self):
        assert find_similar_tools("todo-create", ["user-delete", "x"]) == []


class TestTruncateName:
    def test_keeps_names_up_to_the_limit(self):
        assert truncate_name("a" * 128) == "a" * 128
        assert truncate_name(GRIN * 64) == GRIN * 64

    def test_cuts_to_128_units_with_an_ellipsis(self):
        assert truncate_name("a" * 200) == "a" * 128 + "…"

    def test_never_splits_a_surrogate_pair(self):
        assert truncate_name("a" * 127 + GRIN + "tail") == "a" * 127 + "…"
        assert truncate_name(GRIN * 65) == GRIN * 64 + "…"

    def test_honors_a_custom_limit(self):
        assert truncate_name("abcdef", 3) == "abc…"
        assert truncate_name(GRIN * 2, 1) == "…"
