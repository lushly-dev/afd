"""Optional Botcore adapter: explicit host admission, declared effects, target confinement."""

from __future__ import annotations

from pathlib import Path

import pytest

pytest.importorskip("botcore")

from botcore import ExecutionContext, build_host  # noqa: E402

from botcore_health import HealthPlugin  # noqa: E402
from botcore_health.commands import host_policies  # noqa: E402


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
    assert capabilities.success and capabilities.data["schema_version"] == "1.0"


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
