"""Verify the immutable upstream -> frozen staged input -> current import chain.

The repository commits the sha256 of the two frozen manifests in provenance.json, never that of
adaptations.json, which changes with every edit: its one line made any two branches that recorded
different files conflict (lushly-dev/afd#1610). The build stamps it into the packaged copy
(hatch_build.py), so a built wheel or sdist must carry it, computed from the adaptations.json
beside it. `python scripts/verify_provenance.py --artifacts dist` checks the built lushly-botcore
wheel and sdist.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import tarfile
import zipfile
from collections.abc import Callable
from pathlib import Path

# The checks are assert statements, which `python -O` (or PYTHONOPTIMIZE) removes: refuse to run,
# here, so record_provenance.py and package_smoke.py, which import this module, refuse too.
if not __debug__:
    raise SystemExit(
        "provenance: these checks are assert statements, which python -O removes; "
        "run without -O and with PYTHONOPTIMIZE unset"
    )

# Each record's manifest has one name; a digest is checked against that file and no other.
MANIFESTS = {
    "upstream": "upstream-selected.json",
    "staged_input": "staged-input-allowlist.json",
    "adaptations": "adaptations.json",
}
REPAIR = (
    "adaptations.json's digest is stamped when packaged; do not commit it. A merge made by an "
    "older pnpm base:sync puts it back: run `python scripts/record_provenance.py --refresh` "
    "from endpoints/botcore, which removes it from both copies"
)

REVISION = "7d5c54cae8aae90e145374467456af619cf54e41"
UPSTREAM_MANIFEST_SHA256 = "860ae21493bc9092558c5da3be50be62b218783b4ca04ae82d453af317226514"
STAGED_MANIFEST_SHA256 = "343a1ef0f35d0e069f70e85c73acbac70a30c778ec72a30620207a0aa6dabc45"
# Publisher authority moved to AFD for lushly-botcore alone; the release inventory gates the route.
PUBLISHER_AUTHORITY = (
    "lushly-dev/afd for lushly-botcore (handoff from lushly-dev/botcore); "
    "no publisher for the other distributions"
)
PUBLICATION_STATE = "lushly-botcore admitted; other distributions quarantined"


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


def verify_records(
    read: Callable[[str], bytes], current: Path | None = None, *, packaged: bool = False
) -> dict:
    """Pinned source/staging digests cannot be replaced by rehashing a false claim.

    `packaged` reads a built artifact's records, whose envelope must carry adaptations.json's
    digest; the repository's must not.
    """
    envelope = json.loads(read("provenance.json"))
    assert envelope["source_revision"] == REVISION
    assert envelope["publisher_authority"] == PUBLISHER_AUTHORITY
    assert envelope["publication_state"] == PUBLICATION_STATE
    records = {}
    assert set(envelope["records"]) == set(MANIFESTS), "Unexpected provenance records"
    for key, name in MANIFESTS.items():
        reference = envelope["records"][key]
        assert reference["manifest"] == name, f"The {key} record must name {name}"
        raw = read(name)
        digest = hashlib.sha256(raw).hexdigest()
        if key == "adaptations" and not packaged:
            assert "sha256" not in reference, REPAIR
        else:
            assert "sha256" in reference, f"Missing advertised {key} digest"
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
        assert (
            isinstance(name, str)
            and name
            and "\\" not in name
            and ":" not in name
            and all(part not in {"", ".", ".."} for part in name.split("/"))
        ), f"Invalid adaptation path: {name}"
        selected = name in upstream_files or name in absent
        if selected:
            assert "origin" not in row, f"Frozen selection cannot be relabeled local: {name}"
        else:
            # New AFD-authored files have no source-byte claim. Do not extend or
            # reinterpret the immutable selected-source manifest to record them.
            assert row.get("origin") == "local-after-import", f"Unclassified upstream path: {name}"
            assert row["upstream_sha256"] is None and row["staged_sha256"] is None, (
                f"Local addition cannot claim source or staged bytes: {name}"
            )
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


PACKAGE = "lushly_botcore"
RECORDS = ("provenance.json", "upstream-selected.json", "staged-input-allowlist.json")


def packaged_records(artifact: Path) -> dict[str, bytes]:
    """The provenance records a built lushly-botcore wheel or sdist ships."""
    if artifact.name.endswith(".whl"):
        with zipfile.ZipFile(artifact) as archive:
            prefix = "botcore/provenance/"
            return {
                name[len(prefix) :]: archive.read(name)
                for name in archive.namelist()
                if name.startswith(prefix) and "/" not in name[len(prefix) :]
            }
    with tarfile.open(artifact) as archive:
        records = {}
        for member in archive.getmembers():
            parts = member.name.split("/")
            if member.isfile() and parts[1:-1] == ["src", "botcore", "provenance"]:
                records[parts[-1]] = archive.extractfile(member).read()
        return records


def verify_artifacts(directory: Path) -> list[str]:
    """Every built lushly-botcore wheel and sdist carries its stamped records; both must exist."""
    built = sorted(
        path
        for path in directory.iterdir()
        if path.name.startswith(f"{PACKAGE}-") and path.name.endswith((".whl", ".tar.gz"))
    )
    kinds = {path.name.endswith(".whl") for path in built}
    assert kinds == {True, False}, f"Expected a {PACKAGE} wheel and sdist in {directory}"
    for artifact in built:
        records = packaged_records(artifact)
        missing = sorted({*RECORDS, "adaptations.json"} - set(records))
        assert not missing, f"{artifact.name} lacks provenance records: {missing}"
        try:
            verify_records(records.__getitem__, packaged=True)
        except AssertionError as error:
            raise AssertionError(f"{artifact.name}: {error}") from error
    return [path.name for path in built]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", type=Path, required=True)
    options = parser.parse_args()
    try:
        names = verify_artifacts(options.artifacts)
    except AssertionError as error:
        raise SystemExit(f"provenance: {error}") from None
    for name in names:
        print(f"provenance: {name} carries its stamped records")


if __name__ == "__main__":
    main()
