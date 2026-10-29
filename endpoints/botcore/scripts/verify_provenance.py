"""Verify the immutable upstream -> frozen staged input -> current import chain."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from pathlib import Path

REVISION = "7d5c54cae8aae90e145374467456af619cf54e41"
UPSTREAM_MANIFEST_SHA256 = "860ae21493bc9092558c5da3be50be62b218783b4ca04ae82d453af317226514"
STAGED_MANIFEST_SHA256 = "343a1ef0f35d0e069f70e85c73acbac70a30c778ec72a30620207a0aa6dabc45"


def classify(upstream, staged, current):
    stage = (
        "not-in-staging"
        if staged is None
        else (
            "added-in-staging"
            if upstream is None
            else ("unchanged-upstream" if upstream == staged else "modified-upstream")
        )
    )
    imported = (
        "added-after-staging"
        if staged is None
        else (
            "deleted-after-staging"
            if current is None
            else ("unchanged-staged" if staged == current else "modified-after-staging")
        )
    )
    return stage, imported


def verify_records(read: Callable[[str], bytes], current: Path | None = None) -> dict:
    """Pinned source/staging digests cannot be replaced by rehashing a false claim."""
    envelope = json.loads(read("provenance.json"))
    assert envelope["source_revision"] == REVISION
    assert envelope["publication_state"] == "quarantined"
    records = {}
    for key in ("upstream", "staged_input", "adaptations"):
        reference = envelope["records"][key]
        raw = read(reference["manifest"])
        digest = hashlib.sha256(raw).hexdigest()
        assert digest == reference["sha256"], f"Invalid advertised {key} digest"
        records[key] = json.loads(raw)
        if key == "upstream":
            assert digest == UPSTREAM_MANIFEST_SHA256, "Immutable upstream baseline changed"
        if key == "staged_input":
            assert digest == STAGED_MANIFEST_SHA256, "Frozen staged-input evidence changed"
    upstream = records["upstream"]
    assert upstream["revision"] == REVISION
    assert upstream["kind"] == "immutable-git-object-baseline"
    upstream_files = {row["path"]: row["sha256"] for row in upstream["files"]}
    absent = set(upstream["absent_at_revision"])
    staged_files = {row["path"]: row["sha256"] for row in records["staged_input"]["files"]}
    rows = records["adaptations"]["files"]
    assert len({row["path"] for row in rows}) == len(rows)
    assert set(staged_files).issubset({row["path"] for row in rows})
    for row in rows:
        name = row["path"]
        assert name in upstream_files or name in absent, f"Unclassified upstream path: {name}"
        assert row["upstream_sha256"] == upstream_files.get(name)
        assert row["staged_sha256"] == staged_files.get(name)
        assert (row["stage_classification"], row["import_classification"]) == classify(
            row["upstream_sha256"], row["staged_sha256"], row["current_import_sha256"]
        ), f"Incorrect adaptation classification: {name}"
        assert row["stage_reason"] and row["import_reason"]
        if current is not None:
            path = current / name
            actual = hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None
            assert actual == row["current_import_sha256"], f"Current import changed: {name}"
    return {
        "upstream_files": len(upstream_files),
        "staged_files": len(staged_files),
        "classified_files": len(rows),
    }
