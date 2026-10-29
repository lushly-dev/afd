"""Immutable source evidence must not be confused with reviewed staged additions."""

from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def verifier():
    path = ROOT / "scripts/verify_provenance.py"
    spec = importlib.util.spec_from_file_location("botcore_verify_provenance", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def records():
    return {path.name: path.read_bytes() for path in (ROOT / "provenance").glob("*.json")}


def replace_record(payloads, key, value):
    envelope = json.loads(payloads["provenance.json"])
    name = envelope["records"][key]["manifest"]
    payloads[name] = (json.dumps(value, indent=2) + "\n").encode()
    envelope["records"][key]["sha256"] = hashlib.sha256(payloads[name]).hexdigest()
    payloads["provenance.json"] = json.dumps(envelope).encode()


def test_upstream_staged_and_current_bytes_are_classified_and_packaged_identically():
    payloads = records()
    result = verifier().verify_records(payloads.__getitem__, current=ROOT)
    assert result["staged_files"] == 541
    for name, raw in payloads.items():
        assert (ROOT / "src/botcore/provenance" / name).read_bytes() == raw
    adaptations = json.loads(payloads["adaptations.json"])
    by_path = {row["path"]: row for row in adaptations["files"]}
    host = by_path["src/botcore/host.py"]
    assert host["upstream_sha256"] is None
    assert host["staged_sha256"] is not None
    assert host["stage_classification"] == "added-in-staging"
    assert host["import_classification"] == "modified-after-staging"
    server = by_path["src/botcore/server.py"]
    assert server["upstream_sha256"] != server["staged_sha256"]
    assert server["staged_sha256"] != server["current_import_sha256"]
    assert server["stage_classification"] == "modified-upstream"
    assert server["import_classification"] == "modified-after-staging"


@pytest.mark.parametrize(
    "key,name",
    [("upstream", "upstream-selected.json"), ("staged_input", "staged-input-allowlist.json")],
)
def test_rehashing_modified_immutable_evidence_is_still_rejected(key, name):
    payloads = records()
    value = json.loads(payloads[name])
    value["files"][0]["sha256"] = "0" * 64
    replace_record(payloads, key, value)
    with pytest.raises(AssertionError, match="baseline changed|evidence changed"):
        verifier().verify_records(payloads.__getitem__)


def test_rehashing_false_unchanged_classification_is_rejected():
    payloads = records()
    adaptations = json.loads(payloads["adaptations.json"])
    host = next(row for row in adaptations["files"] if row["path"] == "src/botcore/host.py")
    host["stage_classification"] = "unchanged-upstream"
    replace_record(payloads, "adaptations", adaptations)
    with pytest.raises(AssertionError, match="Incorrect adaptation classification"):
        verifier().verify_records(payloads.__getitem__)


def test_known_license_bytes_match_immutable_git_blob_and_sha256():
    baseline = json.loads(records()["upstream-selected.json"])
    license_row = next(row for row in baseline["files"] if row["path"] == "LICENSE")
    raw = (ROOT / "LICENSE").read_bytes()
    blob = b"blob " + str(len(raw)).encode() + b"\0" + raw
    assert hashlib.sha1(blob).hexdigest() == license_row["git_blob"]
    assert hashlib.sha256(raw).hexdigest() == license_row["sha256"]
