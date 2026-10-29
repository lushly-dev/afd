#!/usr/bin/env python3
"""Fail closed at native publishing boundaries; no authentication or upload occurs here.

Requires Python 3.11+ for stdlib TOML parsing. Receipts describe local inspection,
not registry publication or proof of the bytes uploaded by Cargo's repackaging.
"""

import argparse
from email.parser import BytesParser
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile
import tomllib
import zipfile


TRACKS = {
    "afd-python": {
        "route": "pypi-tag",
        "prefix": "python-v",
        "registry": "pypi",
        "format": "python",
        "manifest": "python/pyproject.toml",
        "section": "project",
    },
    "afd-rust": {
        "route": "crates-tag",
        "prefix": "rust-v",
        "registry": "crates",
        "format": "rust",
        "manifest": "packages/rust/Cargo.toml",
        "section": "package",
    },
}
AUTHORITY = "github: lushly-dev/afd"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def git(root, *args):
    return subprocess.run(
        ["git", "-C", str(root), *args], check=True, capture_output=True
    ).stdout


def tracked_bytes(root, file):
    return git(root, "show", f"HEAD:{file}")


def normalize_name(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def semver_parts(version):
    """Parse the inventory's SemVer versions without a Node runtime dependency."""
    require(isinstance(version, str), "Release version must be a SemVer string")
    number = r"(0|[1-9][0-9]*)"
    match = re.fullmatch(
        rf"{number}\.{number}\.{number}"
        r"(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
        r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?", version,
    )
    require(match is not None, f"Unsupported release SemVer: {version}")
    core = tuple(int(match[index]) for index in (1, 2, 3))
    require(all(value <= 9007199254740991 for value in core),
            f"Unsupported release SemVer: {version}")
    prerelease = match[4].split(".") if match[4] else []
    require(all(not value.isdigit() or value == "0" or not value.startswith("0")
                for value in prerelease), f"Unsupported release SemVer: {version}")
    return core, prerelease


def version_less_than(version, baseline):
    core, prerelease = semver_parts(version)
    baseline_core, baseline_prerelease = semver_parts(baseline)
    if core != baseline_core:
        return core < baseline_core
    if not prerelease or not baseline_prerelease:
        return bool(prerelease) and not baseline_prerelease
    for left, right in zip(prerelease, baseline_prerelease):
        if left != right:
            left_key = (0, int(left)) if left.isdigit() else (1, left)
            right_key = (0, int(right)) if right.isdigit() else (1, right)
            return left_key < right_key
    return len(prerelease) < len(baseline_prerelease)


def assert_metadata(data, name, version):
    metadata = BytesParser().parsebytes(data)
    require(metadata.get_all("Name") == [name], "Artifact metadata name mismatch")
    require(metadata.get_all("Version") == [version], "Artifact metadata version mismatch")


def safe_members(names):
    seen = set()
    for name in names:
        path = PurePosixPath(name)
        require(
            name and not path.is_absolute() and ".." not in path.parts and "\\" not in name,
            f"Unsafe archive member: {name}",
        )
        canonical = str(path)
        require(canonical not in seen, f"Duplicate archive member: {name}")
        seen.add(canonical)


def tar_contents(file):
    with tarfile.open(file, "r:gz") as archive:
        members = archive.getmembers()
        safe_members([member.name for member in members])
        require(
            all(member.isfile() or member.isdir() for member in members),
            "Archive contains a link or special file",
        )
        return {
            member.name: archive.extractfile(member).read()
            for member in members
            if member.isfile()
        }


def inspect_python(files, name, version, manifest_bytes):
    wheels = [file for file in files if file.name.endswith(".whl")]
    sdists = [file for file in files if file.name.endswith(".tar.gz")]
    require(len(files) == 2 and len(wheels) == 1 and len(sdists) == 1,
            "Expected exactly one wheel and one sdist, with no other artifacts")
    stem = f"{name.replace('-', '_')}-{version}"
    require(re.fullmatch(re.escape(stem) + r"-[^-]+-[^-]+-[^-]+\.whl", wheels[0].name),
            "Wheel filename identity/version mismatch")
    require(sdists[0].name == f"{name}-{version}.tar.gz", "Sdist filename identity/version mismatch")
    with zipfile.ZipFile(wheels[0]) as wheel:
        members = wheel.infolist()
        safe_members([member.filename for member in members])
        require(not any((member.external_attr >> 16) & 0o170000 == 0o120000 for member in members),
                "Wheel contains a symbolic link")
        expected = f"{stem}.dist-info/METADATA"
        metadata = [member.filename for member in members if member.filename.endswith(".dist-info/METADATA")]
        require(metadata == [expected], "Wheel must contain exactly the expected METADATA")
        assert_metadata(wheel.read(expected), name, version)
    contents = tar_contents(sdists[0])
    expected = f"{name}-{version}/PKG-INFO"
    require([key for key in contents if key.endswith("/PKG-INFO")] == [expected],
            "Sdist must contain exactly the expected PKG-INFO")
    require(all(key.startswith(f"{name}-{version}/") for key in contents), "Sdist root mismatch")
    assert_metadata(contents[expected], name, version)
    require(contents.get(f"{name}-{version}/pyproject.toml") == manifest_bytes,
            "Sdist manifest differs from candidate source")


def inspect_rust(files, name, version, root, manifest, manifest_bytes, source):
    require(len(files) == 1 and files[0].name == f"{name}-{version}.crate",
            "Expected exactly the selected crate archive, with no other artifacts")
    contents = tar_contents(files[0])
    prefix = f"{name}-{version}/"
    require(all(key.startswith(prefix) for key in contents), "Crate root mismatch")
    require(prefix + "Cargo.toml" in contents, "Crate Cargo.toml is missing")
    package = tomllib.loads(contents[prefix + "Cargo.toml"].decode())["package"]
    require(package.get("name") == name and package.get("version") == version,
            "Crate manifest identity/version mismatch")
    require(package.get("publish") in (None, ["crates-io"]),
            "Crate manifest does not admit crates.io publication")
    require(contents.get(prefix + "Cargo.toml.orig") == manifest_bytes,
            "Crate original manifest differs from candidate source")
    vcs = json.loads(contents.get(prefix + ".cargo_vcs_info.json", b"{}"))
    require(vcs.get("git", {}).get("sha1") == source and not vcs.get("git", {}).get("dirty", False),
            "Crate source revision is missing, dirty, or differs from candidate")
    parent = str(PurePosixPath(manifest).parent)
    require(vcs.get("path_in_vcs") == parent, "Crate source path mismatch")
    payload = 0
    generated = {"Cargo.toml", "Cargo.toml.orig", "Cargo.lock", ".cargo_vcs_info.json"}
    for key, data in contents.items():
        relative = key[len(prefix):]
        if relative not in generated:
            require(data == tracked_bytes(root, f"{parent}/{relative}"),
                    f"Crate payload differs from candidate source: {relative}")
            payload += 1
    require(payload > 0, "Crate contains no candidate source payload")


def inspect(args):
    root = Path(args.root).resolve()
    require(args.unit in TRACKS, f"Unknown native release unit: {args.unit}")
    track = TRACKS[args.unit]
    require(args.route == track["route"], "Unsupported native publication route")
    require(args.tag.startswith(track["prefix"]), "Tag does not belong to this unit")
    version = args.tag[len(track["prefix"]):]
    require(version and re.fullmatch(r"[0-9][A-Za-z0-9.+-]*", version), "Invalid release version tag")
    source = git(root, "rev-parse", "HEAD").decode().strip()
    tag_source = git(root, "rev-parse", f"refs/tags/{args.tag}^{{commit}}").decode().strip()
    require(source == tag_source, "Checkout is not the exact release tag source")
    inventory_file = "scripts/release/inventory.json"
    inventory_bytes = (root / inventory_file).read_bytes()
    require(inventory_bytes == tracked_bytes(root, inventory_file), "Inventory differs from candidate source")
    inventory = json.loads(inventory_bytes)
    units = inventory.get("units", [])
    selected = [unit for unit in units if unit.get("id") == args.unit]
    require(len(selected) == 1, "Unknown or duplicate release unit")
    unit = selected[0]
    require(unit.get("state") == "admitted", "Native release unit is not admitted (held/quarantined/unknown)")
    require(unit.get("authority") == AUTHORITY, "Native release authority mismatch")
    require(unit.get("protocol") == "language-tag-v1", "Native release protocol mismatch")
    require(args.route in unit.get("routes", []), "Native release route is not admitted")
    prerequisites = unit.get("prerequisites", [])
    require(isinstance(prerequisites, list), "Native release prerequisites must be a list")
    require(not prerequisites,
            "Native prerequisites require a configured read-only registry evidence adapter")
    distributions = unit.get("distributions", [])
    require(len(distributions) == 1, "Native release unit must own exactly one distribution")
    distribution = distributions[0]
    for key, expected in {"name": "afd", "registry": track["registry"], "format": track["format"],
                          "manifest": track["manifest"]}.items():
        require(distribution.get(key) == expected, f"Distribution {key} identity mismatch")
    owners = [item for owner in units for item in owner.get("distributions", [])
              if item.get("manifest") == track["manifest"] or
              (item.get("registry") == track["registry"] and
               normalize_name(item.get("name", "")) == "afd")]
    require(len(owners) == 1, "Distribution has ambiguous inventory ownership")
    manifest_bytes = (root / track["manifest"]).read_bytes()
    require(manifest_bytes == tracked_bytes(root, track["manifest"]), "Manifest differs from candidate source")
    require(not git(root, "status", "--porcelain", "--untracked-files=all", "--",
                    str(PurePosixPath(track["manifest"]).parent)).strip(),
            "Candidate source has uncommitted changes")
    metadata = tomllib.loads(manifest_bytes.decode())[track["section"]]
    require(metadata.get("name") == "afd", "Source manifest name mismatch")
    require(metadata.get("version") == version, "Source manifest version does not match tag")
    held_versions = unit.get("heldVersions", [])
    require(isinstance(held_versions, list) and all(isinstance(item, str) for item in held_versions),
            "Native release heldVersions must be a list of exact versions")
    require(version not in held_versions, f"Release candidate is held: {args.unit} {version}")
    if distribution.get("initialVersion"):
        require(not version_less_than(version, distribution["initialVersion"]),
                f"Version progression reset: {track['manifest']}")
    if track["format"] == "rust":
        require(metadata.get("publish") in (None, ["crates-io"]),
                "Source manifest does not admit crates.io publication")
    artifacts = []
    if args.artifacts:
        directory = Path(args.artifacts)
        require(directory.is_dir() and not directory.is_symlink(), "Artifact directory is missing or a link")
        files = sorted(directory.iterdir())
        require(all(file.is_file() and not file.is_symlink() for file in files),
                "Artifact set contains a directory, link, or special file")
        if track["format"] == "python":
            inspect_python(files, "afd", version, manifest_bytes)
        else:
            inspect_rust(files, "afd", version, root, track["manifest"], manifest_bytes, source)
        artifacts = [{"file": file.name, "sha256": digest(file.read_bytes())} for file in files]
    receipt = {
        "schemaVersion": 1, "unit": args.unit, "route": args.route, "tag": args.tag,
        "source": source, "name": "afd", "registry": track["registry"], "version": version,
        "manifestSha256": digest(manifest_bytes), "inventorySha256": digest(inventory_bytes),
        "artifacts": artifacts, "evidence": "local-native-artifact-inspection",
    }
    if args.verify_receipt:
        require(args.artifacts, "Receipt verification requires artifacts")
        require(json.loads(Path(args.verify_receipt).read_text()) == receipt,
                "Artifact receipt no longer matches candidate inputs")
    if args.receipt:
        require(args.artifacts, "Artifact receipt requires artifacts")
        destination = Path(args.receipt)
        require(destination.resolve().parent != Path(args.artifacts).resolve(),
                "Keep inspection receipts outside the upload artifact set")
        destination.write_text(json.dumps(receipt, indent=2) + "\n")
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".")
    parser.add_argument("--unit", required=True)
    parser.add_argument("--route", required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--artifacts")
    parser.add_argument("--receipt")
    parser.add_argument("--verify-receipt")
    args = parser.parse_args()
    try:
        receipt = inspect(args)
        print(json.dumps(receipt, indent=2))
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError, tarfile.TarError,
            zipfile.BadZipFile) as error:
        print(f"Native release admission rejected: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
