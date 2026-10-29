"""The Health source tree carries no private records or machine-specific paths."""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from privacy import load_deny_terms, scan_member, scan_text  # noqa: E402

IGNORED = {".venv", "__pycache__", ".pytest_cache", ".ruff_cache", "dist", "build"}


def tree_files():
    for path in sorted(ROOT.rglob("*")):
        relative = path.relative_to(ROOT)
        if (
            path.is_file()
            and not set(relative.parts) & IGNORED
            and not any(part.endswith(".egg-info") for part in relative.parts)
        ):
            yield relative.as_posix(), path.read_bytes()


def test_source_tree_has_no_private_records_or_machine_paths():
    # HEALTH_PRIVACY_DENY_FILE names caller-owned private terms kept outside the repository.
    deny = load_deny_terms(os.environ.get("HEALTH_PRIVACY_DENY_FILE"))
    findings = [item for name, data in tree_files() for item in scan_member(name, data, deny)]
    assert findings == []


def test_scanner_detects_each_class():
    users = "/" + "Users" + "/someone/app"
    assert scan_text("a", users)
    assert scan_text("b", "contact: person@" + "example.org")
    assert scan_text("c", "https://" + "internal.example.net/x")
    assert scan_text("d", "gh" + "p_" + "a" * 30)
    assert scan_text("e", "load " + "repos" + ".toml")
    assert scan_text("f", "private-project here", ["private-project"])
    assert not scan_text("g", "fixture@example.invalid and https://github.com/lushly-dev/afd")
    assert scan_member("reports/latest.json", b"{}")
    assert scan_member("dashboard.html", b"<html></html>")
