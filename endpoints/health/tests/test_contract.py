"""The versioned report contract, caller-owned configuration and the stdlib CLI."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import jsonschema
import pytest

from botcore_health import (
    SCHEMA_VERSION,
    ArtifactScope,
    Policy,
    Target,
    __version__,
    audit,
    load_policy,
    load_targets,
    onboard,
    report_schema,
    write_report,
)
from botcore_health.__main__ import main
from botcore_health.core import CHECKS, GENERATOR, SEVERITIES, STATUSES, CheckSpec

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = report_schema()
VALIDATOR = jsonschema.Draft202012Validator(SCHEMA)


def snapshot(root: Path) -> dict[str, bytes]:
    return {str(p.relative_to(root)): p.read_bytes() for p in root.rglob("*") if p.is_file()}


@pytest.fixture
def project(tmp_path):
    repo = tmp_path / "plain-app"
    (repo / ".github/workflows").mkdir(parents=True)
    (repo / "package.json").write_text('{"name":"plain-app","private":true}')
    (repo / ".nvmrc").write_text("24\n")
    (repo / ".github/workflows/ci.yml").write_text("steps: [test, build]\nnode-version: 24\n")
    return repo


def test_schema_is_valid_and_matches_the_emitting_code():
    jsonschema.Draft202012Validator.check_schema(SCHEMA)
    defs = SCHEMA["$defs"]
    assert SCHEMA["properties"]["schema_version"]["const"] == SCHEMA_VERSION
    assert defs["status"]["enum"] == list(STATUSES)
    assert defs["severity"]["enum"] == list(SEVERITIES)
    assert SCHEMA["properties"]["summary"]["required"] == list(STATUSES)
    assert {"name": "lushly-health", "version": __version__} == GENERATOR
    pyproject = (ROOT / "pyproject.toml").read_text()
    assert f'version = "{__version__}"' in pyproject


def test_every_check_and_status_validates_against_the_schema(project):
    def broken(*args):
        raise RuntimeError("redacted")

    with patch.dict(CHECKS, {"lefthook_configured": CheckSpec(broken)}):
        report = audit(
            (
                Target("plain-app", project, "typescript"),
                Target("python-app", project, "python"),
                Target("absent", project / "absent", "go"),
            ),
            Policy(tuple(CHECKS), frozenset({"dependabot_configured"}), {"ci_present": "advisory"}),
        )
    VALIDATOR.validate(report)
    assert {o["status"] for o in report["outcomes"]} >= {
        "passed",
        "failed",
        "skipped",
        "unavailable",
        "error",
    }


@pytest.mark.parametrize(
    "mutation",
    [
        lambda r: r.update(schema_version="2.0"),
        lambda r: r["outcomes"][0].update(status="pass"),
        lambda r: r["outcomes"][0].pop("check_id"),
        lambda r: r["outcomes"][0].update(severity="blocker"),
        lambda r: r["summary"].pop("warn"),
        lambda r: r.update(artifacts_written=["report.json"]),
        lambda r: r["outcomes"][0]["evidence"].update(message="unredacted"),
    ],
)
def test_schema_rejects_contract_drift(project, mutation):
    report = audit((Target("plain-app", project, "typescript"),), Policy(("ci_present",)))
    VALIDATOR.validate(report)
    mutation(report)
    with pytest.raises(jsonschema.ValidationError):
        VALIDATOR.validate(report)


def test_policy_and_targets_files_are_caller_owned(tmp_path, project):
    config = tmp_path / "config"
    config.mkdir()
    (config / "policy.toml").write_text(
        'schema_version = "1.0"\nchecks = ["ci_present", "gitattributes_lf"]\n'
        'disabled = ["gitattributes_lf"]\n[severity]\nci_present = "advisory"\n'
    )
    (config / "targets.json").write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "targets": [{"id": "plain-app", "path": "../plain-app", "language": "typescript"}],
            }
        )
    )
    policy = load_policy(config / "policy.toml")
    targets = load_targets(config / "targets.json")
    assert targets[0].path == project.resolve()
    report = audit(targets, policy)
    VALIDATOR.validate(report)
    assert [o["status"] for o in report["outcomes"]] == ["passed", "skipped"]
    severity = {"ci_present": "advisory", "gitattributes_lf": "required"}
    assert report["policy"]["severity"] == severity


@pytest.mark.parametrize(
    "text",
    [
        'checks = ["ci_present"]\n',
        'schema_version = "2.0"\nchecks = ["ci_present"]\n',
        'schema_version = "1.0"\nchecks = ["ci_present"]\nbaseline = "org"\n',
        'schema_version = "1.0"\nchecks = "ci_present"\n',
        'schema_version = "1.0"\nchecks = ["ci_present"]\nremediation = "fix"\n',
    ],
)
def test_invalid_policy_files_fail_before_audit(tmp_path, text):
    (tmp_path / "policy.toml").write_text(text)
    with pytest.raises(ValueError):
        load_policy(tmp_path / "policy.toml")


def test_onboarded_declaration_is_a_loadable_targets_file(tmp_path, project):
    (project / ".git").mkdir()
    before = snapshot(project)
    receipt = onboard(
        Target("plain-app", project, "typescript"), ArtifactScope(tmp_path / "own"), selected=True
    )
    assert snapshot(project) == before
    assert load_targets(receipt["artifacts_written"][0])[0].path == project.resolve()


def test_cli_audit_is_read_only_and_writes_only_the_explicit_scope(tmp_path, project, capsys):
    before = snapshot(project)
    args = ["audit", "--target", "plain-app", str(project), "typescript", "--check", "ci_present"]
    assert main(args) == 0
    printed = json.loads(capsys.readouterr().out)
    VALIDATOR.validate(printed)
    assert snapshot(project) == before
    out = tmp_path / "reports"
    assert main([*args, "--output-dir", str(out)]) == 0
    receipt = json.loads(capsys.readouterr().out)
    assert receipt["artifacts_written"] == [str(out / "health-report.json")]
    VALIDATOR.validate(json.loads((out / "health-report.json").read_text()))
    assert main([*args, "--output-dir", str(project / "reports")]) == 2
    assert snapshot(project) == before


def test_cli_fail_on_only_counts_required_checks(project, capsys):
    base = ["audit", "--target", "plain-app", str(project), "typescript"]
    assert main([*base, "--check", "dependabot_configured", "--fail-on", "failed"]) == 1
    assert main([*base, "--check", "ci_present", "--fail-on", "failed"]) == 0
    assert main([*base, "--check", "nope"]) == 2
    assert main([*base, "--check", "ci_present", "--fail-on", "bad"]) == 2
    assert main(["audit", "--check", "ci_present"]) == 2
    capsys.readouterr()


def test_cli_schema_and_capabilities(capsys):
    assert main(["schema"]) == 0
    assert json.loads(capsys.readouterr().out) == SCHEMA
    assert main(["capabilities"]) == 0
    assert json.loads(capsys.readouterr().out)["schema_version"] == SCHEMA_VERSION


def test_write_report_rejects_other_schema_versions(tmp_path, project):
    report = audit((Target("plain-app", project, "typescript"),), Policy(("ci_present",)))
    with pytest.raises(ValueError):
        write_report({**report, "schema_version": "0.9"}, ArtifactScope(tmp_path / "out"))
