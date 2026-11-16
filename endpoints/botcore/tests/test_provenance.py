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


def local_addition(payloads, name="src/botcore/new_local.py"):
    adaptations = json.loads(payloads["adaptations.json"])
    adaptations["files"].append(
        {
            "path": name,
            "origin": "local-after-import",
            "upstream_sha256": None,
            "staged_sha256": None,
            "current_import_sha256": "1" * 64,
            "stage_classification": "not-in-staging",
            "stage_reason": "No source-byte claim",
            "import_classification": "added-after-staging",
            "import_reason": "Reviewed local addition",
        }
    )
    return adaptations


def test_local_additions_preserve_both_immutable_manifests():
    payloads = records()
    original = {
        name: payloads[name] for name in ("upstream-selected.json", "staged-input-allowlist.json")
    }
    replace_record(payloads, "adaptations", local_addition(payloads))
    verifier().verify_records(payloads.__getitem__)
    assert all(payloads[name] == raw for name, raw in original.items())


@pytest.mark.parametrize(
    "field,value,match",
    [
        ("origin", "upstream", "Unclassified"),
        ("upstream_sha256", "1" * 64, "cannot claim"),
        ("staged_sha256", "1" * 64, "cannot claim"),
    ],
)
def test_local_additions_cannot_claim_unknown_source_bytes(field, value, match):
    payloads = records()
    adaptations = local_addition(payloads)
    adaptations["files"][-1][field] = value
    replace_record(payloads, "adaptations", adaptations)
    with pytest.raises(AssertionError, match=match):
        verifier().verify_records(payloads.__getitem__)


def test_known_source_cannot_be_reclassified_as_a_local_addition():
    payloads = records()
    adaptations = json.loads(payloads["adaptations.json"])
    adaptations["files"][0]["origin"] = "local-after-import"
    replace_record(payloads, "adaptations", adaptations)
    with pytest.raises(AssertionError, match="cannot be relabeled"):
        verifier().verify_records(payloads.__getitem__)


@pytest.mark.parametrize("name", ["../escape.py", "C:/escape.py", "src\\escape.py", "/escape.py"])
def test_adaptation_paths_cannot_escape_the_unit(name):
    payloads = records()
    replace_record(payloads, "adaptations", local_addition(payloads, name))
    with pytest.raises(AssertionError, match="Invalid adaptation path"):
        verifier().verify_records(payloads.__getitem__)


def test_refresh_records_local_bytes_and_keeps_the_mirrors_and_frozen_evidence(
    tmp_path, monkeypatch
):
    import shutil

    monkeypatch.syspath_prepend(str(ROOT / "scripts"))
    spec = importlib.util.spec_from_file_location(
        "botcore_record", ROOT / "scripts/record_provenance.py"
    )
    recorder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(recorder)
    payloads = records()
    for row in json.loads(payloads["adaptations.json"])["files"]:
        source = ROOT / row["path"]
        if source.is_file():
            target = tmp_path / row["path"]
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
    for directory in (tmp_path / "provenance", tmp_path / "src/botcore/provenance"):
        directory.mkdir(parents=True, exist_ok=True)
        for name, raw in payloads.items():
            (directory / name).write_bytes(raw)
    monkeypatch.setattr(recorder, "ROOT", tmp_path)
    local = tmp_path / "src/botcore/new_local.py"
    local.write_text("# AFD-authored fixture\n")
    recorder.refresh(["src/botcore/new_local.py"], "Fixture addition")
    first = (tmp_path / "provenance/adaptations.json").read_bytes()
    recorder.refresh(["src/botcore/new_local.py"], "Fixture addition")
    assert (tmp_path / "provenance/adaptations.json").read_bytes() == first
    refreshed = {path.name: path.read_bytes() for path in (tmp_path / "provenance").glob("*.json")}
    verifier().verify_records(refreshed.__getitem__, current=tmp_path)
    for name, raw in refreshed.items():
        assert (tmp_path / "src/botcore/provenance" / name).read_bytes() == raw
    for name in ("upstream-selected.json", "staged-input-allowlist.json"):
        assert refreshed[name] == payloads[name]
    before = dict(refreshed)
    with pytest.raises(ValueError):
        recorder.refresh(["../escape.py"], "Invalid path")
    assert {
        path.name: path.read_bytes() for path in (tmp_path / "provenance").glob("*.json")
    } == before


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
