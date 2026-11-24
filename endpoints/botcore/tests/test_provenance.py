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
    """Replaces a manifest; the envelope hashes it unless it is adaptations.json (build-stamped)."""
    envelope = json.loads(payloads["provenance.json"])
    name = envelope["records"][key]["manifest"]
    payloads[name] = (json.dumps(value, indent=2) + "\n").encode()
    if key != "adaptations":
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
    local.write_text("# AFD-authored fixture\n", encoding="utf-8", newline="\n")
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


HATCHLING = [
    "hatchling",
    "hatchling.builders",
    "hatchling.builders.hooks",
    "hatchling.builders.hooks.plugin",
    "hatchling.builders.hooks.plugin.interface",
]


def stamp_hook():
    """hatch_build.py, with hatchling's hook base stubbed: the tests do not install hatchling."""
    import sys
    import types

    saved = {name: sys.modules.get(name) for name in HATCHLING}
    for name in HATCHLING:
        sys.modules[name] = types.ModuleType(name)
    sys.modules[HATCHLING[-1]].BuildHookInterface = object
    try:
        spec = importlib.util.spec_from_file_location(
            "botcore_hatch_build", ROOT / "hatch_build.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    finally:
        for name, value in saved.items():
            if value is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = value
    return module


def stamped(payloads):
    """The records as the build packages them (hatch_build.py's stamp)."""
    shipped = dict(payloads)
    shipped["provenance.json"] = stamp_hook().stamp(
        payloads["provenance.json"], payloads["adaptations.json"]
    )
    return shipped


def test_the_repository_does_not_commit_the_adaptations_digest():
    # Its one line made any two branches that recorded different files conflict (#1610).
    payloads = records()
    envelope = json.loads(payloads["provenance.json"])
    assert "sha256" not in envelope["records"]["adaptations"]
    envelope["records"]["adaptations"]["sha256"] = hashlib.sha256(
        payloads["adaptations.json"]
    ).hexdigest()
    payloads["provenance.json"] = json.dumps(envelope).encode()
    with pytest.raises(AssertionError, match="stamped when packaged; do not commit it") as refused:
        verifier().verify_records(payloads.__getitem__)
    # The refusal names the one command that repairs it, and why it happens.
    assert "older pnpm base:sync" in str(refused.value)
    assert "record_provenance.py --refresh" in str(refused.value)


def recorder_over_a_copy(tmp_path, monkeypatch, envelope=None):
    """record_provenance.py over a copy of the endpoint's recorded files and both record copies."""
    import shutil

    monkeypatch.syspath_prepend(str(ROOT / "scripts"))
    spec = importlib.util.spec_from_file_location(
        "botcore_record_copy", ROOT / "scripts/record_provenance.py"
    )
    recorder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(recorder)
    payloads = records()
    if envelope is not None:
        payloads["provenance.json"] = envelope
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
    return recorder


def test_refresh_removes_a_digest_an_older_base_sync_merged_back(tmp_path, monkeypatch):
    # The old resolver recomputed every record's sha256, adaptations.json's included, and wrote
    # the envelope in the records' serialization to both copies. That is this envelope.
    payloads = records()
    envelope = json.loads(payloads["provenance.json"])
    envelope["records"]["adaptations"]["sha256"] = hashlib.sha256(
        payloads["adaptations.json"]
    ).hexdigest()
    old_shape = (json.dumps(envelope, indent=2) + "\n").encode()
    recorder = recorder_over_a_copy(tmp_path, monkeypatch, old_shape)
    copies = (tmp_path / "provenance", tmp_path / "src/botcore/provenance")
    merged = {path.name: path.read_bytes() for path in copies[0].glob("*.json")}
    with pytest.raises(AssertionError, match="do not commit it"):
        verifier().verify_records(merged.__getitem__)
    assert recorder.refresh([], None) is True
    for directory in copies:
        assert (directory / "provenance.json").read_bytes() == payloads["provenance.json"]
        assert (directory / "adaptations.json").read_bytes() == payloads["adaptations.json"]
    repaired = {path.name: path.read_bytes() for path in copies[0].glob("*.json")}
    verifier().verify_records(repaired.__getitem__, current=tmp_path)
    assert recorder.refresh([], None) is False


@pytest.mark.parametrize(
    "script,arguments",
    [
        ("verify_provenance.py", ["--artifacts", "."]),
        ("record_provenance.py", ["--refresh"]),
        ("package_smoke.py", []),
    ],
)
def test_the_checks_refuse_to_run_optimized(tmp_path, script, arguments):
    # python -O strips assert statements, which these checks are made of.
    import subprocess
    import sys

    result = subprocess.run(
        [sys.executable, "-O", str(ROOT / "scripts" / script), *arguments],
        cwd=tmp_path,
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
    assert "python -O removes" in result.stderr


def test_packaged_records_need_the_stamped_digest_of_the_adaptations_they_ship():
    payloads = records()
    with pytest.raises(AssertionError, match="Missing advertised adaptations digest"):
        verifier().verify_records(payloads.__getitem__, packaged=True)
    shipped = stamped(payloads)
    verifier().verify_records(shipped.__getitem__, packaged=True)
    # The stamp leaves the committed envelope otherwise byte for byte.
    envelope = json.loads(shipped["provenance.json"])
    del envelope["records"]["adaptations"]["sha256"]
    assert (json.dumps(envelope, indent=2) + "\n").encode() == payloads["provenance.json"]
    shipped["adaptations.json"] += b" "
    with pytest.raises(AssertionError, match="Invalid advertised adaptations digest"):
        verifier().verify_records(shipped.__getitem__, packaged=True)


def test_the_build_hook_stamps_wheels_and_sdists_and_not_editable_installs(tmp_path):
    hook = stamp_hook().ProvenanceStampHook()
    hook.root = str(ROOT)
    expected = stamped(records())["provenance.json"]
    for target, version, stamps in [
        ("wheel", "standard", True),
        ("sdist", "standard", True),
        ("wheel", "editable", False),
    ]:
        hook.target_name = target
        build_data = {"force_include": {}}
        hook.initialize(version, build_data)
        assert bool(build_data["force_include"]) == stamps, (target, version)
        for source, destination in build_data["force_include"].items():
            assert destination == "src/botcore/provenance/provenance.json"
            assert Path(source).read_bytes() == expected
        hook.finalize(version, build_data, str(tmp_path))
        assert not any(Path(source).exists() for source in build_data["force_include"])


def write_artifacts(directory, payloads, version="9.9.9"):
    import io
    import tarfile
    import zipfile

    directory.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(directory / f"lushly_botcore-{version}-py3-none-any.whl", "w") as wheel:
        for name, raw in payloads.items():
            wheel.writestr(f"botcore/provenance/{name}", raw)
    with tarfile.open(directory / f"lushly_botcore-{version}.tar.gz", "w:gz") as sdist:
        for name, raw in payloads.items():
            info = tarfile.TarInfo(f"lushly_botcore-{version}/src/botcore/provenance/{name}")
            info.size = len(raw)
            sdist.addfile(info, io.BytesIO(raw))


def test_built_artifacts_are_checked_for_their_stamped_records(tmp_path):
    shipped = stamped(records())
    write_artifacts(tmp_path / "good", shipped)
    assert verifier().verify_artifacts(tmp_path / "good") == [
        "lushly_botcore-9.9.9-py3-none-any.whl",
        "lushly_botcore-9.9.9.tar.gz",
    ]
    write_artifacts(tmp_path / "unstamped", records())
    with pytest.raises(AssertionError, match="Missing advertised adaptations digest"):
        verifier().verify_artifacts(tmp_path / "unstamped")
    write_artifacts(tmp_path / "stale", dict(shipped, **{"adaptations.json": b"{}"}))
    with pytest.raises(AssertionError, match="Invalid advertised adaptations digest"):
        verifier().verify_artifacts(tmp_path / "stale")
    # The envelope pointed at a kept copy of the old bytes, the shipped adaptations.json changed.
    renamed = dict(shipped)
    renamed["adaptations-old.json"] = shipped["adaptations.json"]
    renamed["adaptations.json"] = b'{"files": []}\n'
    envelope = json.loads(shipped["provenance.json"])
    envelope["records"]["adaptations"]["manifest"] = "adaptations-old.json"
    renamed["provenance.json"] = (json.dumps(envelope, indent=2) + "\n").encode()
    with pytest.raises(AssertionError, match="The adaptations record must name adaptations.json"):
        verifier().verify_records(renamed.__getitem__, packaged=True)
    renamed_only = {k: v for k, v in renamed.items() if k != "adaptations-old.json"}
    write_artifacts(tmp_path / "renamed", renamed_only)
    with pytest.raises(AssertionError, match="The adaptations record must name adaptations.json"):
        verifier().verify_artifacts(tmp_path / "renamed")
    partial = {name: raw for name, raw in shipped.items() if name != "adaptations.json"}
    write_artifacts(tmp_path / "partial", partial)
    with pytest.raises(AssertionError, match="lacks provenance records"):
        verifier().verify_artifacts(tmp_path / "partial")
    (tmp_path / "good" / "lushly_botcore-9.9.9.tar.gz").unlink()
    with pytest.raises(AssertionError, match="Expected a lushly_botcore wheel and sdist"):
        verifier().verify_artifacts(tmp_path / "good")


def _write_crafted_artifacts(
    directory: Path,
    wheel_entries: list[tuple[str, bytes]],
    sdist_entries: list[tuple[str, bytes]],
    version: str = "9.9.9",
) -> None:
    import io
    import tarfile
    import zipfile

    directory.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(directory / f"lushly_botcore-{version}-py3-none-any.whl", "w") as wheel:
        for member_name, raw in wheel_entries:
            wheel.writestr(member_name, raw)
    with tarfile.open(directory / f"lushly_botcore-{version}.tar.gz", "w:gz") as sdist:
        for member_name, raw in sdist_entries:
            info = tarfile.TarInfo(member_name)
            info.size = len(raw)
            sdist.addfile(info, io.BytesIO(raw))


@pytest.mark.parametrize("target", ["wheel", "sdist"])
@pytest.mark.parametrize(
    "case,extra_member,before,match",
    [
        ("case-collision", "Adaptations.json", False, "Unexpected provenance archive member"),
        ("dot-segment", "./adaptations.json", False, "Unexpected provenance archive member"),
        ("unexpected-extra", "adaptations-old.json", False, "Unexpected provenance archive member"),
        ("nested-member", "sub/adaptations.json", False, "Unexpected provenance archive member"),
        ("duplicate-bad-first", "adaptations.json", True, "Duplicate provenance archive member"),
        ("duplicate-good-first", "adaptations.json", False, "Duplicate provenance archive member"),
    ],
)
def test_artifact_check_refuses_unexpected_and_duplicate_provenance_members(
    tmp_path, target, case, extra_member, before, match
):
    shipped = stamped(records())
    version = "9.9.9"
    evil = b'{"evil": true}\n'
    good_wheel = [(f"botcore/provenance/{name}", raw) for name, raw in shipped.items()]
    good_sdist = [
        (f"lushly_botcore-{version}/src/botcore/provenance/{name}", raw)
        for name, raw in shipped.items()
    ]
    if target == "wheel":
        bad_entry = (f"botcore/provenance/{extra_member}", evil)
        wheel_entries = [bad_entry, *good_wheel] if before else [*good_wheel, bad_entry]
        sdist_entries = good_sdist
    else:
        bad_entry = (f"lushly_botcore-{version}/src/botcore/provenance/{extra_member}", evil)
        wheel_entries = good_wheel
        sdist_entries = [bad_entry, *good_sdist] if before else [*good_sdist, bad_entry]
    out = tmp_path / f"{target}-{case}"
    _write_crafted_artifacts(out, wheel_entries, sdist_entries, version=version)
    with pytest.raises(AssertionError, match=match):
        verifier().verify_artifacts(out)


def test_artifact_check_refuses_case_mismatched_dir_leading_dot_and_symlinks(tmp_path):
    import io
    import tarfile
    import zipfile

    shipped = stamped(records())
    version = "9.9.9"
    evil = b'{"evil": true}\n'
    good_wheel = [(f"botcore/provenance/{name}", raw) for name, raw in shipped.items()]
    good_sdist = [
        (f"lushly_botcore-{version}/src/botcore/provenance/{name}", raw)
        for name, raw in shipped.items()
    ]

    # Case-mismatched provenance directory in wheel.
    _write_crafted_artifacts(
        tmp_path / "case-dir-whl",
        [*good_wheel, ("Botcore/Provenance/adaptations.json", evil)],
        good_sdist,
    )
    with pytest.raises(AssertionError, match="Unexpected provenance archive member"):
        verifier().verify_artifacts(tmp_path / "case-dir-whl")

    # Leading ./ before botcore/provenance in wheel.
    _write_crafted_artifacts(
        tmp_path / "leading-dot-whl",
        [*good_wheel, ("./botcore/provenance/adaptations.json", evil)],
        good_sdist,
    )
    with pytest.raises(AssertionError, match="Unexpected provenance archive member"):
        verifier().verify_artifacts(tmp_path / "leading-dot-whl")

    # Symlink member at an exact allowlisted record name inside sdist provenance directory.
    sym_dir = tmp_path / "symlink-sdist"
    sym_dir.mkdir()
    with zipfile.ZipFile(sym_dir / f"lushly_botcore-{version}-py3-none-any.whl", "w") as wheel:
        for member_name, raw in good_wheel:
            wheel.writestr(member_name, raw)
    with tarfile.open(sym_dir / f"lushly_botcore-{version}.tar.gz", "w:gz") as sdist:
        for member_name, raw in good_sdist:
            if member_name.endswith("/adaptations.json"):
                continue
            info = tarfile.TarInfo(member_name)
            info.size = len(raw)
            sdist.addfile(info, io.BytesIO(raw))
        link = tarfile.TarInfo(f"lushly_botcore-{version}/src/botcore/provenance/adaptations.json")
        link.type = tarfile.SYMTYPE
        link.linkname = "provenance.json"
        sdist.addfile(link)
    with pytest.raises(AssertionError, match="Unexpected provenance archive member"):
        verifier().verify_artifacts(sym_dir)

    # Symlink member (Unix S_IFLNK external_attr) at an exact record name inside wheel.
    import stat

    sym_whl_dir = tmp_path / "symlink-wheel"
    sym_whl_dir.mkdir()
    with zipfile.ZipFile(sym_whl_dir / f"lushly_botcore-{version}-py3-none-any.whl", "w") as wheel:
        for member_name, raw in good_wheel:
            if member_name.endswith("/adaptations.json"):
                zinfo = zipfile.ZipInfo(member_name)
                zinfo.external_attr = (stat.S_IFLNK | 0o777) << 16
                wheel.writestr(zinfo, b"provenance.json")
            else:
                wheel.writestr(member_name, raw)
    with tarfile.open(sym_whl_dir / f"lushly_botcore-{version}.tar.gz", "w:gz") as sdist:
        for member_name, raw in good_sdist:
            info = tarfile.TarInfo(member_name)
            info.size = len(raw)
            sdist.addfile(info, io.BytesIO(raw))
    with pytest.raises(AssertionError, match="Unexpected provenance archive member"):
        verifier().verify_artifacts(sym_whl_dir)

    # Exact provenance directory entries themselves are accepted alongside the 4 record files.
    dir_ok = tmp_path / "dir-entries-ok"
    dir_ok.mkdir()
    with zipfile.ZipFile(dir_ok / f"lushly_botcore-{version}-py3-none-any.whl", "w") as wheel:
        wheel.writestr("botcore/provenance/", b"")
        for member_name, raw in good_wheel:
            wheel.writestr(member_name, raw)
    with tarfile.open(dir_ok / f"lushly_botcore-{version}.tar.gz", "w:gz") as sdist:
        dir_info = tarfile.TarInfo(f"lushly_botcore-{version}/src/botcore/provenance")
        dir_info.type = tarfile.DIRTYPE
        sdist.addfile(dir_info)
        for member_name, raw in good_sdist:
            info = tarfile.TarInfo(member_name)
            info.size = len(raw)
            sdist.addfile(info, io.BytesIO(raw))
    assert verifier().verify_artifacts(dir_ok) == [
        f"lushly_botcore-{version}-py3-none-any.whl",
        f"lushly_botcore-{version}.tar.gz",
    ]


def test_refresh_refuses_crlf_in_text_files_and_accepts_lf_and_binary(tmp_path, monkeypatch):
    """lushly-dev/afd#2390: Windows checkouts must not record CRLF digests that fail Linux CI."""
    recorder = recorder_over_a_copy(tmp_path, monkeypatch)
    before = {path.name: path.read_bytes() for path in (tmp_path / "provenance").glob("*.json")}
    crlf_file = tmp_path / "src/botcore/crlf_fixture.py"
    crlf_file.write_bytes(b"# line one\r\n# line two\r\n")
    with pytest.raises(ValueError, match="CRLF"):
        recorder.refresh(["src/botcore/crlf_fixture.py"], "CRLF fixture")
    # Provenance files remain untouched on refusal.
    for directory in (tmp_path / "provenance", tmp_path / "src/botcore/provenance"):
        assert {path.name: path.read_bytes() for path in directory.glob("*.json")} == before

    # Converting to LF succeeds and passes verification.
    crlf_file.write_bytes(b"# line one\n# line two\n")
    recorder.refresh(["src/botcore/crlf_fixture.py"], "LF fixture")
    refreshed = {path.name: path.read_bytes() for path in (tmp_path / "provenance").glob("*.json")}
    verifier().verify_records(refreshed.__getitem__, current=tmp_path)

    # Binary files are accepted via either suffix (no NUL) or NUL byte (non-binary suffix).
    suffix_binary = tmp_path / "src/botcore/fixture.png"
    suffix_binary.write_bytes(b"PNG-HEADER\r\nNO-NUL\r\n")
    nul_binary = tmp_path / "src/botcore/fixture.bin"
    nul_binary.write_bytes(b"\x00\x01\r\n\x02")
    recorder.refresh(["src/botcore/fixture.png", "src/botcore/fixture.bin"], "Binary fixtures")
    refreshed_bin = {
        path.name: path.read_bytes() for path in (tmp_path / "provenance").glob("*.json")
    }
    verifier().verify_records(refreshed_bin.__getitem__, current=tmp_path)
