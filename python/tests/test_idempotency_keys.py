"""The idempotency key's shared definitions, its form (K2) and derived keys (K4), against
``spec/vectors/idempotency.json``. ``test_idempotency_vectors.py`` runs every section of that file
against the engine; ``test_idempotency_engine.py`` covers what the vectors leave to each language.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from afd import (
    AFD_IDEMPOTENCY_KEY_META_KEY,
    ErrorCodes,
    derive_idempotency_key,
    invalid_idempotency_key_error,
    is_idempotency_key,
    is_idempotency_support,
)

VECTORS = json.loads(
    (Path(__file__).resolve().parents[2] / "spec" / "vectors" / "idempotency.json").read_text(
        encoding="utf-8"
    )
)


@pytest.mark.parametrize("case", VECTORS["key"]["form"], ids=lambda case: case["description"])
def test_key_form(case):
    key = case["repeat"] * case["times"] if "repeat" in case else case["key"]
    assert is_idempotency_key(key) is case["valid"]


@pytest.mark.parametrize(
    "case",
    VECTORS["key"]["derived"],
    ids=lambda case: f"{case['base']} {case['kind']} {case['index']}",
)
def test_derived_key(case):
    assert derive_idempotency_key(case["base"], case["kind"], case["index"]) == case["expected"]


def test_meta_key_and_declarations():
    assert VECTORS["metaKey"] == AFD_IDEMPOTENCY_KEY_META_KEY
    assert is_idempotency_support("natural") and is_idempotency_support("keyed")
    assert not is_idempotency_support("always")


def test_invalid_key_error():
    error = invalid_idempotency_key_error()
    assert error.code == ErrorCodes.VALIDATION_ERROR
    assert error.retryable is False
    assert error.suggestion
    assert error.details == {"field": "idempotencyKey", "meta": AFD_IDEMPOTENCY_KEY_META_KEY}
