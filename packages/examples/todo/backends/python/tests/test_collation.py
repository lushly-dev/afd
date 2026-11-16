"""Titles sort as JavaScript's ``localeCompare`` sorts them, so both backends list them alike.

The expected orders were taken from Node.js 26 (``[...titles].sort((a, b) => a.localeCompare(b))``);
``pnpm test:interop`` compares the two backends' lists directly.
"""

from __future__ import annotations

import random

from afd.testing import assert_success

from todo_backend import MemoryStore, create_app
from todo_backend.collation import title_key

# Base letters first, then accents, then case with lowercase first.
REVIEW = ["Äpfel", "apple", "Apple", "banana", "Zebra"]

# Whitespace, then punctuation in CLDR's order, digits, letters; accents in ICU's order; the
# letters that expand (ß, æ, œ) or vary (ø); case compared left to right.
NODE_ORDER = [
    " space",
    "_under",
    "-dash",
    "!bang",
    "#hash",
    "10 eggs",
    "2 eggs",
    "a b",
    "a-b",
    "a.b",
    "ab",
    "angstrom",
    "Ångström",
    "apfel",
    "Apfel",
    "äpfel",
    "Äpfel",
    "apple",
    "Apple",
    "banana",
    "c",
    "C",
    "ç",
    "cafe",
    "Cafe",
    "café au lait",
    "diy",
    "Diy",
    "DIY",
    "e",
    "E",
    "é",
    "É",
    "item 10",
    "item 2",
    "Item 2",
    "item_2",
    "item-2",
    "naive",
    "naïve",
    "nandu",
    "ñandu",
    "oeuvre",
    "œuvre",
    "Orsted",
    "Ørsted",
    "resume",
    "RESUME",
    "résumé",
    "Résumé",
    "strasse",
    "Strasse",
    "Straße",
    "x(1)",
    "x1",
    "Zebra",
    "zz",
    "zZ",
    "Zz",
    "ZZ",
]

ACCENTS = ["cote", "coté", "côte", "côté"]
VARIANTS = ["ae", "aé", "äe", "æ", "ǽ", "oe", "Oe", "OE", "oé", "oë", "öe", "øe", "øé", "œ", "Œ"]


def shuffled(titles: list[str]) -> list[str]:
    copy = list(titles)
    random.Random(7).shuffle(copy)
    return copy


def test_titles_sort_as_local_compare_does():
    for expected in (REVIEW, NODE_ORDER, ACCENTS, VARIANTS):
        assert sorted(shuffled(expected), key=title_key) == expected


async def test_todo_list_sorts_titles_in_that_order():
    server = create_app(MemoryStore(), {"APPROVALS": "off"})
    for title in ["Apple", "apple", "Zebra", "Äpfel", "banana"]:
        assert_success(await server.execute("todo-create", {"title": title}))

    for order, expected in (("asc", REVIEW), ("desc", REVIEW[::-1])):
        listed = assert_success(
            await server.execute("todo-list", {"sortBy": "title", "sortOrder": order})
        )
        assert [todo.title for todo in listed["todos"]] == expected
