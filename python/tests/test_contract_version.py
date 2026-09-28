"""The AFD contract version matches ``spec/VERSION``."""

import re
from pathlib import Path

import afd
import afd.core

SPEC_VERSION = Path(__file__).resolve().parents[2] / "spec" / "VERSION"


def test_contract_version_matches_spec():
    assert afd.CONTRACT_VERSION == SPEC_VERSION.read_text(encoding="utf-8").strip()


def test_contract_version_is_major_minor():
    assert re.fullmatch(r"\d+\.\d+(?:-[0-9A-Za-z.]+)?", afd.CONTRACT_VERSION)


def test_contract_version_is_exported():
    assert "CONTRACT_VERSION" in afd.__all__
    assert "CONTRACT_VERSION" in afd.core.__all__
    assert afd.core.CONTRACT_VERSION is afd.CONTRACT_VERSION
