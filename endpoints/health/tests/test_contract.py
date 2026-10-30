"""The versioned report contract, caller-owned configuration and the stdlib CLI."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import jsonschema
import pytest

from lushly_health import (
    REPORT_SCHEMA_VERSIONS,
    SCHEMA_VERSION,
    ArtifactScope,
    Policy,
    Target,
    __version__,
    aggregate_verdict,
    audit,
    load_policy,
    load_targets,
    onboard,
    report_schema,
    write_report,
)
from lushly_health.__main__ import main
from lushly_health.core import CHECKS, GENERATOR, SEVERITIES, STATUSES, VERDICTS, CheckSpec

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
    assert SCHEMA["properties"]["verdict"]["properties"]["status"]["enum"] == list(VERDICTS)
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
        "disabled",
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
        lambda r: r.pop("generated_at"),
        lambda r: r.update(generated_at="2026-01-01T00:00:00+02:00"),
        lambda r: r.pop("verdict"),
        lambda r: r["verdict"].update(status="pass"),
        lambda r: r["summary"].pop("disabled"),
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
    assert [o["status"] for o in report["outcomes"]] == ["passed", "disabled"]
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


def outcome(status: str, severity: str = "required") -> dict:
    return {"status": status, "severity": severity}


@pytest.mark.parametrize(
    ("outcomes", "expected"),
    [
        ([], ("no_required_checks", 0, 0)),
        ([outcome("failed", "advisory")], ("no_required_checks", 0, 0)),
        ([outcome("disabled")], ("no_required_checks", 0, 0)),
        ([outcome("passed"), outcome("disabled")], ("passed", 1, 0)),
        ([outcome("passed"), outcome("failed", "advisory")], ("passed", 1, 0)),
        ([outcome("passed"), outcome("skipped")], ("not_passed", 2, 1)),
        ([outcome("passed"), outcome("warn"), outcome("error")], ("not_passed", 3, 2)),
    ],
)
def test_verdict_excludes_disabled_and_advisory_but_skipped_blocks(outcomes, expected):
    verdict = aggregate_verdict(outcomes)
    assert (verdict["status"], verdict["required_count"], verdict["blocking_count"]) == expected


def test_disabled_required_check_no_longer_prevents_a_pass(project):
    report = audit(
        (Target("plain-app", project, "typescript"),),
        Policy(("ci_present", "dependabot_configured"), frozenset({"dependabot_configured"})),
    )
    VALIDATOR.validate(report)
    assert report["summary"]["disabled"] == 1
    assert report["verdict"] == {"status": "passed", "required_count": 1, "blocking_count": 0}


def test_generated_at_is_utc_and_can_be_pinned(project):
    selection = ((Target("plain-app", project, "typescript"),), Policy(("ci_present",)))
    local = datetime(2026, 1, 2, 3, 4, 5, 678, tzinfo=timezone(timedelta(hours=2)))
    assert audit(*selection, generated_at=local)["generated_at"] == "2026-01-02T01:04:05Z"
    before = datetime.now(UTC).replace(microsecond=0)
    stamp = audit(*selection)["generated_at"]
    parsed = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    assert before <= parsed <= datetime.now(UTC)
    with pytest.raises(ValueError):
        audit(*selection, generated_at=datetime(2026, 1, 1))


def test_earlier_report_schemas_stay_available():
    assert REPORT_SCHEMA_VERSIONS == ("1.0", SCHEMA_VERSION)
    earlier = report_schema("1.0")
    jsonschema.Draft202012Validator.check_schema(earlier)
    assert earlier["properties"]["schema_version"]["const"] == "1.0"
    with pytest.raises(ValueError):
        report_schema("0.9")


def test_cli_require_pass_follows_the_verdict(project, capsys):
    base = ["audit", "--target", "plain-app", str(project), "typescript", "--require-pass"]
    assert main([*base, "--check", "ci_present"]) == 0
    assert main([*base, "--check", "dependabot_configured"]) == 1
    disabled = ["--check", "ci_present", "--check", "dependabot_configured"]
    assert main([*base, *disabled, "--disable", "dependabot_configured"]) == 0
    assert main([*base, "--check", "ci_present", "--disable", "ci_present"]) == 1
    capsys.readouterr()
