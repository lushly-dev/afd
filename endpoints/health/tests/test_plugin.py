"""Optional Botcore adapter: explicit host admission, declared effects, target confinement."""

from __future__ import annotations

from pathlib import Path

import pytest

pytest.importorskip("botcore")

from botcore import ExecutionContext, build_host  # noqa: E402

from lushly_health import HealthPlugin  # noqa: E402
from lushly_health.commands import host_policies  # noqa: E402


def snapshot(root: Path) -> dict[str, bytes]:
    return {str(p.relative_to(root)): p.read_bytes() for p in root.rglob("*") if p.is_file()}


@pytest.fixture
def workspace(tmp_path):
    app = tmp_path / "workspace" / "app"
    app.mkdir(parents=True)
    (app / "package.json").write_text('{"name":"app","private":true}')
    (app / ".gitattributes").write_text("* text=auto eol=lf\n")
    return tmp_path / "workspace"


def selection(path="app", check_ids=("gitattributes_lf",)):
    return {
        "targets": [{"id": "app", "path": path, "language": "typescript"}],
        "check_ids": list(check_ids),
    }


def test_plugin_declares_host_context_safety():
    assert HealthPlugin.host_context_safe is True


def test_health_is_absent_unless_explicitly_admitted(workspace):
    host = build_host("consumer", ExecutionContext(workspace))
    assert "health_audit" not in host.list_command_names()


def test_admission_requires_declared_effects(workspace):
    with pytest.raises(ValueError, match="Declare command effects"):
        build_host("consumer", ExecutionContext(workspace), plugins=("health",))


async def test_admitted_audit_is_inspection_only_and_confined(workspace):
    host = build_host(
        "consumer", ExecutionContext(workspace), plugins=("health",), policies=host_policies()
    )
    catalog = {row["name"]: row for row in host.catalog()}
    assert catalog["health_audit"]["effects"] == ["inspect", "subprocess"]
    assert catalog["health_audit"]["effects_depend_on_arguments"] is True
    assert catalog["health_capabilities"]["effects"] == ["inspect"]
    before = snapshot(workspace)

    result = await host.direct_client().call("health_audit", selection())
    assert result.success, result.error
    assert result.data["outcomes"][0]["status"] == "passed"
    assert result.data["targets"][0]["path"] == str((workspace / "app").resolve())
    assert snapshot(workspace) == before

    outside = await host.execute("health_audit", selection(path=str(workspace.parent)))
    assert outside.error.code == "INVALID_AUDIT_SELECTION"
    escape = await host.execute("health_audit", selection(path="../.."))
    assert escape.error.code == "INVALID_AUDIT_SELECTION"

    denied = await host.execute("health_audit", selection(check_ids=("last_commit",)))
    assert denied.error.code == "EFFECT_DENIED"
    capabilities = await host.execute("health_capabilities", {})
    assert capabilities.success and capabilities.data["schema_version"] == "1.3"


async def test_admitted_audit_reads_confined_measures_files_only(workspace):
    import json

    host = build_host(
        "consumer", ExecutionContext(workspace), plugins=("health",), policies=host_policies()
    )
    measures_file = workspace / "measures.json"
    measures_file.write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "source": "sweep",
                "measures": [
                    {
                        "key": "files_over_warn",
                        "label": "Files over size warning",
                        "value": 3,
                        "unit": "files",
                        "direction": "lower_is_better",
                        "target": "app",
                    }
                ],
            }
        )
    )
    outside = workspace.parent / "outside-measures.json"
    outside.write_text(measures_file.read_text())
    link = workspace / "escape.json"
    link.symlink_to(outside)

    ok = await host.execute("health_audit", {**selection(), "measures_files": ["measures.json"]})
    assert ok.success, ok.error
    assert ok.data["measures"][0]["key"] == "files_over_warn"

    escaped = await host.execute(
        "health_audit", {**selection(), "measures_files": ["../outside-measures.json"]}
    )
    assert escaped.error.code == "INVALID_AUDIT_SELECTION"

    symlink_escaped = await host.execute(
        "health_audit", {**selection(), "measures_files": ["escape.json"]}
    )
    assert symlink_escaped.error.code == "INVALID_AUDIT_SELECTION"

    missing = await host.execute(
        "health_audit", {**selection(), "measures_files": ["missing.json"]}
    )
    assert missing.error.code == "INVALID_AUDIT_SELECTION"
    assert str(workspace) not in missing.error.message

    wrong_type = await host.execute(
        "health_audit", {**selection(), "measures_files": "measures.json"}
    )
    assert wrong_type.error.code == "VALIDATION_ERROR"

    from lushly_health.commands import health_audit

    direct_wrong_type = await health_audit(
        targets=[{"id": "app", "path": str(workspace / "app"), "language": "typescript"}],
        check_ids=["gitattributes_lf"],
        measures_files="measures.json",  # type: ignore[arg-type]
    )
    assert direct_wrong_type.error.code == "INVALID_AUDIT_SELECTION"

    for name, raw_value in (("huge.json", str(10**309)), ("unsafe.json", "9007199254740993")):
        bad = workspace / name
        bad.write_text(
            '{"schema_version":"1.0","measures":[{"key":"k","label":"K",'
            f'"value":{raw_value},"unit":"count","direction":"neutral"}}]}}'
        )
        rejected = await host.execute("health_audit", {**selection(), "measures_files": [name]})
        assert rejected.error.code == "INVALID_AUDIT_SELECTION"


async def test_trusted_local_host_may_run_the_git_metric(workspace):
    host = build_host(
        "consumer",
        ExecutionContext(workspace, profile="trusted-local"),
        plugins=("health",),
        policies=host_policies(),
    )
    result = await host.execute("health_audit", selection(check_ids=("last_commit",)))
    assert result.success
    assert result.data["outcomes"][0]["status"] in {"passed", "unavailable"}
