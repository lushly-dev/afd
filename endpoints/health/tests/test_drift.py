"""Dependency drift and repository-level resolution on disposable fixtures."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import jsonschema
import pytest

from lushly_health import (
    ArtifactScope,
    Policy,
    Target,
    audit,
    load_targets,
    report_schema,
    write_report,
)
from lushly_health.__main__ import main
from lushly_health.drift import _pnpm_resolution

# The privacy scan reads these sources, and a pinned package name looks like an email address.
PNPM = """lockfileVersion: '9.0'

importers:

  .:
    devDependencies:
      vitest:
        specifier: ^4.0.0
        version: 4.1.12(@types/node{at}26.6.6)

  packages/a:
    dependencies:
      '@scope/shared':
        specifier: ^1.0.0
        version: 1.0.0
      sibling:
        specifier: workspace:*
        version: link:../b
    devDependencies:
      vitest:
        specifier: ^3.0.0
        version: 3.2.4

packages:

  '@scope/shared{at}1.0.0':
    resolution: {integrity: sha512-a}

  transitive{at}1.0.0:
    resolution: {integrity: sha512-b}

  transitive{at}2.0.0:
    resolution: {integrity: sha512-c}

  vitest{at}3.2.4:
    resolution: {integrity: sha512-d}

  vitest{at}4.1.12:
    resolution: {integrity: sha512-e}

snapshots:

  ignored{at}9.9.9: {}
""".replace("{at}", "@")


def uv_lock(version: str, *, transitive: str = "1.0.0") -> str:
    return f"""version = 1

[[package]]
name = "unit"
version = "0.1.0"
source = {{ editable = "." }}
dependencies = [{{ name = "shared" }}]

[package.optional-dependencies]
dev = [{{ name = "dev-tool" }}]

[[package]]
name = "shared"
version = "{version}"
source = {{ registry = "https://pypi.org/simple" }}

[[package]]
name = "dev-tool"
version = "1.0.0"
source = {{ registry = "https://pypi.org/simple" }}

[[package]]
name = "deep"
version = "{transitive}"
source = {{ registry = "https://pypi.org/simple" }}
"""


CARGO_SPLIT = """version = 4

[[package]]
name = "app"
version = "0.1.0"
dependencies = [
 "sha2 0.10.9",
 "sha2 0.11.0",
 "serde",
]

[[package]]
name = "sha2"
version = "0.10.9"
source = "registry+https://github.com/rust-lang/crates.io-index"

[[package]]
name = "sha2"
version = "0.11.0"
source = "registry+https://github.com/rust-lang/crates.io-index"

[[package]]
name = "serde"
version = "1.0.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
"""


def write(root: Path, relative: str, content: str) -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)


def drift(root: Path) -> dict:
    target = Target("repo", root, "typescript")
    return audit((target,), Policy(("dependency_version_drift",)))["outcomes"][0]


def test_no_lockfile_does_not_apply(tmp_path):
    outcome = drift(tmp_path)
    assert outcome["status"] == "skipped"
    assert outcome["severity"] == "advisory"


def test_drift_is_advisory_and_never_blocks_the_verdict(tmp_path):
    write(tmp_path, "pnpm-lock.yaml", PNPM)
    target = Target("repo", tmp_path, "typescript")
    report = audit((target,), Policy(("dependency_version_drift",)))
    assert report["outcomes"][0]["status"] == "warn"
    assert report["policy"]["severity"] == {"dependency_version_drift": "advisory"}
    assert report["verdict"]["status"] == "no_required_checks"
    required = Policy(
        ("dependency_version_drift",), severity={"dependency_version_drift": "required"}
    )
    assert audit((target,), required)["verdict"]["status"] == "not_passed"


def test_pnpm_direct_splits_warn_and_transitive_ones_only_count(tmp_path):
    write(tmp_path, "pnpm-lock.yaml", PNPM)
    outcome = drift(tmp_path)
    assert outcome["status"] == "warn"
    assert outcome["evidence"]["metric"] == "direct=1 all=2"
    assert "vitest (npm): 3.2.4, 4.1.12" in outcome["message"]
    assert "transitive" not in outcome["message"]
    assert "shared" not in outcome["message"]
    assert "ignored" not in outcome["message"]


def test_a_transitive_only_split_passes_and_is_counted(tmp_path):
    write(tmp_path, "pnpm-lock.yaml", PNPM.replace("version: 3.2.4", "version: 4.1.12"))
    outcome = drift(tmp_path)
    assert outcome["status"] == "passed"
    assert outcome["evidence"]["metric"] == "direct=0 all=2"


def test_uv_lockfiles_are_compared_with_each_other(tmp_path):
    write(tmp_path, "one/uv.lock", uv_lock("1.0.0"))
    write(tmp_path, "two/uv.lock", uv_lock("1.0.0", transitive="2.0.0"))
    outcome = drift(tmp_path)
    assert outcome["status"] == "passed"
    assert outcome["evidence"]["metric"] == "direct=0 all=1"
    write(tmp_path, "two/uv.lock", uv_lock("2.0.0"))
    outcome = drift(tmp_path)
    assert outcome["status"] == "warn"
    assert "shared (pypi): 1.0.0, 2.0.0" in outcome["message"]
    assert "in 2 lockfiles" in outcome["message"]


def test_cargo_names_a_version_only_when_a_lockfile_holds_several(tmp_path):
    write(tmp_path, "Cargo.lock", CARGO_SPLIT)
    outcome = drift(tmp_path)
    assert outcome["status"] == "warn"
    assert "sha2 (cargo): 0.10.9, 0.11.0" in outcome["message"]
    assert outcome["evidence"]["metric"] == "direct=1 all=1"
    assert "serde" not in outcome["message"]


def test_ecosystems_are_kept_apart(tmp_path):
    # The same name at different versions in npm and PyPI is two packages.
    write(tmp_path, "one/uv.lock", uv_lock("1.0.0").replace('"shared"', '"vitest"'))
    write(tmp_path, "pnpm-lock.yaml", PNPM.replace("version: 3.2.4", "version: 4.1.12"))
    assert drift(tmp_path)["evidence"]["metric"] == "direct=0 all=2"


def test_installed_and_hidden_trees_are_not_this_targets_lockfiles(tmp_path):
    write(tmp_path, "pnpm-lock.yaml", PNPM.replace("version: 3.2.4", "version: 4.1.12"))
    for pruned in ("node_modules/x", ".venv/x", "target/x", "dist/x", "build/x"):
        write(tmp_path, f"{pruned}/Cargo.lock", CARGO_SPLIT)
    assert drift(tmp_path)["status"] == "passed"


def test_a_long_list_is_sampled(tmp_path):
    rows = "".join(
        f"      dep{n}:\n        specifier: ^1\n        version: 1.0.0\n" for n in range(12)
    )
    other = rows.replace("1.0.0", "2.0.0")
    write(
        tmp_path,
        "pnpm-lock.yaml",
        f"lockfileVersion: '9.0'\n\nimporters:\n\n"
        f"  a:\n    dependencies:\n{rows}\n  b:\n    dependencies:\n{other}",
    )
    outcome = drift(tmp_path)
    assert "and 2 more" in outcome["message"]
    assert outcome["evidence"]["metric"] == "direct=12 all=0"


def test_a_malformed_lockfile_is_an_error_not_a_pass(tmp_path):
    write(tmp_path, "uv.lock", "[[package]\n")
    outcome = drift(tmp_path)
    assert outcome["status"] == "error"
    assert outcome["evidence"]["error_type"]


def test_an_escaping_lockfile_is_unavailable(tmp_path):
    outside = tmp_path / "outside.lock"
    outside.write_text(uv_lock("1.0.0"))
    repo = tmp_path / "repo"
    (repo / "nested").mkdir(parents=True)
    (repo / "nested/uv.lock").symlink_to(outside)
    assert drift(repo)["status"] == "unavailable"


def test_an_escaping_lockfile_in_a_tree_it_never_reads_is_ignored(tmp_path):
    outside = tmp_path / "outside.lock"
    outside.write_text(uv_lock("1.0.0"))
    repo = tmp_path / "repo"
    (repo / "node_modules/pkg").mkdir(parents=True)
    (repo / "node_modules/pkg/uv.lock").symlink_to(outside)
    write(repo, "uv.lock", uv_lock("1.0.0"))
    assert drift(repo)["status"] == "passed"


def test_a_marker_fork_is_one_requirement_not_drift(tmp_path):
    lock = """version = 1

[[package]]
name = "unit"
version = "0.1.0"
source = { editable = "." }
dependencies = [
    { name = "ws", version = "16.0", marker = "python_version < '3.12'" },
    { name = "ws", version = "17.0", marker = "python_version >= '3.12'" },
]

[[package]]
name = "ws"
version = "16.0"
source = { registry = "r" }

[[package]]
name = "ws"
version = "17.0"
source = { registry = "r" }
"""
    write(tmp_path, "uv.lock", lock)
    outcome = drift(tmp_path)
    assert outcome["status"] == "passed"
    assert outcome["evidence"]["metric"] == "direct=0 all=1"


def test_peer_metadata_is_not_a_package(tmp_path):
    lock = PNPM.replace(
        "  transitive{at}1.0.0:".replace("{at}", "@"),
        "  transitive{at}1.0.0:\n    peerDependenciesMeta:\n      '@scope/x{at}1':\n"
        "        optional: true".replace("{at}", "@"),
    ).replace("{at}", "@")
    write(tmp_path, "pnpm-lock.yaml", lock)
    assert drift(tmp_path)["evidence"]["metric"] == "direct=1 all=2"


@pytest.mark.parametrize(
    ("version", "package", "resolved"),
    [
        ("link:../b", None, None),
        ("file:vendor/x.tgz", None, None),
        ("other{at}file:vendor/x.tgz", None, None),
        ("1.2.3(peer{at}2.0.0)", "dep", "1.2.3"),
        ("other{at}4.0.0", "other", "4.0.0"),
        (
            "git+ssh://git{at}host.invalid/o/r.git#abc",
            "dep",
            "git+ssh://git{at}host.invalid/o/r.git#abc",
        ),
    ],
)
def test_pnpm_importer_versions(version, package, resolved):
    version = version.replace("{at}", "@")
    expected = (package, resolved.replace("{at}", "@")) if package else None
    assert _pnpm_resolution("dep", version) == expected


def test_an_older_pnpm_lockfile_warns_instead_of_passing_empty(tmp_path):
    write(tmp_path, "pnpm-lock.yaml", "lockfileVersion: '6.0'\n\npackages:\n\n  /foo/1.0.0:\n")
    outcome = drift(tmp_path)
    assert outcome["status"] == "warn"
    assert "version 6" in outcome["message"]


def test_drift_audit_reads_only(tmp_path):
    write(tmp_path, "pnpm-lock.yaml", PNPM)
    before = {p: p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()}
    with patch("socket.socket", side_effect=AssertionError("Audit must not use network")):
        drift(tmp_path)
    assert {p: p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()} == before


@pytest.fixture
def monorepo(tmp_path):
    repo = tmp_path / "monorepo"
    write(repo, ".gitattributes", "* text=auto eol=lf\n")
    write(repo, "uv.lock", uv_lock("1.0.0"))
    write(repo, "python/pyproject.toml", "[project]\nname='unit'\n[tool.ruff]\n")
    write(repo, "python/uv.lock", uv_lock("2.0.0"))
    return repo


def test_repository_checks_read_the_root_and_target_checks_read_the_unit(monorepo):
    unit = Target("python", monorepo / "python", "python", monorepo)
    plain = Target("plain", monorepo / "python", "python")
    checks = ("gitattributes_lf", "linter_strict", "dependency_version_drift")
    report = audit((unit, plain), Policy(checks))
    jsonschema.Draft202012Validator(report_schema()).validate(report)
    results = {(o["target"], o["check_id"]): o for o in report["outcomes"]}
    assert results["python", "gitattributes_lf"]["status"] == "passed"
    assert results["python", "gitattributes_lf"]["evidence"]["base"] == "repository_root"
    assert results["python", "linter_strict"]["status"] == "passed"
    assert "base" not in results["python", "linter_strict"]["evidence"]
    assert results["python", "dependency_version_drift"]["status"] == "warn"
    assert results["plain", "gitattributes_lf"]["status"] == "failed"
    assert "base" not in results["plain", "gitattributes_lf"]["evidence"]
    assert report["targets"][0]["repository_root"] == str(monorepo.resolve())
    assert "repository_root" not in report["targets"][1]


def test_typescript_units_use_root_tooling_and_python_units_their_own(monorepo):
    write(monorepo, "biome.json", '{"noUnusedImports": 1, "noExplicitAny": 1}')
    write(monorepo, "package.json", '{"devDependencies": {"knip": "1"}}')
    (monorepo / "ts").mkdir()
    write(monorepo, "ts/package.json", "{}")
    ts = Target("ts", monorepo / "ts", "typescript", monorepo)
    py = Target("py", monorepo / "python", "python", monorepo)
    report = audit((ts, py), Policy(("linter_strict", "dead_code_tool")))
    results = {(o["target"], o["check_id"]): o for o in report["outcomes"]}
    assert results["ts", "linter_strict"]["status"] == "passed"
    assert results["ts", "dead_code_tool"]["status"] == "passed"
    assert results["ts", "linter_strict"]["evidence"]["base"] == "repository_root"
    assert results["py", "linter_strict"]["status"] == "passed"
    assert "base" not in results["py", "linter_strict"]["evidence"]
    assert results["py", "dead_code_tool"]["status"] == "failed"


def test_a_target_must_lie_within_its_repository_root(tmp_path, monorepo):
    with pytest.raises(ValueError, match="within its repository_root"):
        Target("away", tmp_path, "python", monorepo)


def test_the_boundary_follows_the_directory_a_check_reads(monorepo, tmp_path):
    (tmp_path / "shared").mkdir()
    (monorepo / ".github").mkdir()
    (monorepo / ".github/workflows").symlink_to(tmp_path / "shared")
    unit = Target("python", monorepo / "python", "python", monorepo)
    assert audit((unit,), Policy(("ci_present",)))["outcomes"][0]["status"] == "unavailable"


def test_a_missing_unit_is_unavailable_even_when_its_root_exists(monorepo):
    unit = Target("python", monorepo / "python", "python", monorepo)
    (monorepo / "python").rename(monorepo.parent / "moved")
    report = audit((unit,), Policy(("gitattributes_lf",)))
    assert report["outcomes"][0]["status"] == "unavailable"


def test_reports_stay_outside_the_repository_root(monorepo):
    unit = Target("python", monorepo / "python", "python", monorepo)
    report = audit((unit,), Policy(("gitattributes_lf",)))
    with pytest.raises(ValueError, match="outside audited targets"):
        write_report(report, ArtifactScope(monorepo / "reports"))
    assert not (monorepo / "reports").exists()


def test_targets_files_and_the_cli_declare_a_root(monorepo, capsys):
    declared = monorepo.parent / "targets.json"
    declared.write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "targets": [
                    {
                        "id": "python",
                        "path": "monorepo/python",
                        "language": "python",
                        "repository_root": "monorepo",
                    }
                ],
            }
        )
    )
    (target,) = load_targets(declared)
    assert target.repository_root == monorepo.resolve()

    base = ["audit", "--check", "gitattributes_lf", "--require-pass"]
    unit = ["--target", "python", str(monorepo / "python"), "python"]
    assert main([*base, *unit]) == 1
    assert main([*base, *unit, "--repository-root", str(monorepo)]) == 0
    capsys.readouterr()
    assert main([*base, "--targets", str(declared), "--repository-root", str(monorepo)]) == 2
    assert "targets file" in capsys.readouterr().err
