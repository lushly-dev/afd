"""Tests for botcore.commands.cdp.core — session management (no browser needed)."""

from __future__ import annotations

import re
from pathlib import Path

from botcore.commands import cdp
from botcore.commands.cdp.core import (
    CdpSession,
    ConsoleEntry,
    _clear_session,
    _load_session,
    _save_session,
)

_BROWSER_SKILL = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "botcore"
    / "skills"
    / "browser-automation"
    / "SKILL.md"
)


def test_session_roundtrip(tmp_path) -> None:
    """Save and load a CDP session from disk."""
    session = CdpSession(
        cdp_endpoint="http://127.0.0.1:9222",
        profile_dir=str(tmp_path / "profile"),
        launched_at="2026-01-01T00:00:00",
        pid=1234,
    )
    _save_session(tmp_path, session)
    loaded = _load_session(tmp_path)

    assert loaded is not None
    assert loaded.cdp_endpoint == "http://127.0.0.1:9222"
    assert loaded.pid == 1234


def test_load_session_not_found(tmp_path) -> None:
    """_load_session returns None when no session file exists."""
    assert _load_session(tmp_path) is None


def test_clear_session(tmp_path) -> None:
    """_clear_session removes the session file."""
    session = CdpSession(
        cdp_endpoint="http://127.0.0.1:9222",
        profile_dir=str(tmp_path),
        launched_at="2026-01-01T00:00:00",
    )
    _save_session(tmp_path, session)
    assert _load_session(tmp_path) is not None

    _clear_session(tmp_path)
    assert _load_session(tmp_path) is None


def test_session_with_console_log(tmp_path) -> None:
    """CdpSession preserves console log entries."""
    session = CdpSession(
        cdp_endpoint="http://127.0.0.1:9222",
        profile_dir=str(tmp_path),
        launched_at="2026-01-01T00:00:00",
        console_log=[
            ConsoleEntry(timestamp="2026-01-01", level="log", text="hello"),
            ConsoleEntry(timestamp="2026-01-01", level="error", text="oops"),
        ],
    )
    _save_session(tmp_path, session)
    loaded = _load_session(tmp_path)

    assert loaded is not None
    assert len(loaded.console_log) == 2
    assert loaded.console_log[0].text == "hello"
    assert loaded.console_log[1].level == "error"


def test_clear_session_no_file(tmp_path) -> None:
    """_clear_session is safe when no file exists."""
    _clear_session(tmp_path)  # Should not raise


def test_browser_automation_skill_names_every_cdp_command() -> None:
    """The bundled browser-automation skill names every exported cdp_* command."""
    commands = [name for name in cdp.__all__ if name.startswith("cdp_")]
    assert commands

    skill = _BROWSER_SKILL.read_text(encoding="utf-8")
    missing = [name for name in commands if not re.search(rf"\b{name}\b", skill)]
    assert not missing, f"browser-automation/SKILL.md does not name: {missing}"


def test_cdp_commands_exposed_in_all_cli_docs_and_host_policies(tmp_path: Path) -> None:
    """lushly-dev/afd#778: all cdp_* commands appear in commands.__all__, CLI, docs and host."""
    from unittest.mock import patch

    from click.testing import CliRunner

    from botcore import CDP_POLICIES, ExecutionContext, build_host
    from botcore import commands as core_commands
    from botcore.cli import cli
    from botcore.docs import CORE_DOCS
    from botcore.host import CORE_POLICIES
    from botcore.server import build_namespace

    cdp_names = [name for name in cdp.__all__ if name.startswith("cdp_")]
    assert len(cdp_names) == 33
    assert set(cdp_names) <= set(core_commands.__all__)
    assert set(cdp_names) == set(CDP_POLICIES)
    assert "cdp" in CORE_DOCS

    with patch("botcore.server.discover_plugins", return_value={}):
        namespace, _ = build_namespace()
    assert set(cdp_names) <= set(namespace)

    help_result = CliRunner().invoke(cli, ["cdp", "--help"])
    assert help_result.exit_code == 0
    for name in cdp_names:
        subcommand = name.removeprefix("cdp_").replace("_", "-")
        assert subcommand in help_result.output, f"botcore cdp missing subcommand {subcommand}"

    host = build_host(
        "browser-host",
        ExecutionContext(tmp_path, profile="inspection"),
        core_commands=(*CORE_POLICIES, *CDP_POLICIES),
    )
    assert set(cdp_names) <= set(host.list_command_names())
    assert host.policy("cdp_launch").declared() == ("browser",)
    assert "path" in host.policy("cdp_screenshot").paths


async def test_cdp_host_profile_denies_browser_effect_in_inspection(tmp_path: Path) -> None:
    """Managed host inspection profile refuses browser commands with EFFECT_DENIED."""
    from botcore import CDP_POLICIES, ExecutionContext, build_host
    from botcore.host import CORE_POLICIES

    host = build_host(
        "browser-host",
        ExecutionContext(tmp_path, profile="inspection"),
        core_commands=(*CORE_POLICIES, *CDP_POLICIES),
    )
    result = await host.execute("cdp_list_pages", {})
    assert result.success is False
    assert result.error is not None and result.error.code == "EFFECT_DENIED"


def test_cdp_cli_trace_summary_dispatch_and_root_json_flag(tmp_path: Path) -> None:
    """lushly-dev/afd#778: `botcore cdp trace-summary` passes top_slices_limit and root
    `botcore --json cdp ...` emits JSON output."""
    import json

    from click.testing import CliRunner

    from botcore.cli import cli

    missing_trace = tmp_path / "missing.json"
    summary_run = CliRunner().invoke(
        cli, ["--json", "cdp", "trace-summary", str(missing_trace), "--top-limit", "5"]
    )
    assert summary_run.exit_code == 1
    payload = json.loads(summary_run.output)
    assert payload["success"] is False
    assert payload["error"]["code"] == "CDP_TRACE_SUMMARY_MISSING_TRACE"

    resize_run = CliRunner().invoke(cli, ["--json", "cdp", "resize", "0", "720"])
    assert resize_run.exit_code == 1
    resize_payload = json.loads(resize_run.output)
    assert resize_payload["success"] is False
    assert resize_payload["error"]["code"] == "CDP_INVALID_VIEWPORT"


def test_cdp_default_profile_dir_isolated_across_targets_on_windows(
    monkeypatch, tmp_path: Path
) -> None:
    """Different targets on another drive get distinct profile dirs under LOCALAPPDATA."""
    from botcore.commands.cdp import core

    local_app = tmp_path / "localapp"
    real_a = tmp_path / "target-a"
    real_b = tmp_path / "target-b"
    real_a.mkdir()
    real_b.mkdir()

    class _FakeOtherDrivePath:
        drive = "Z:"

        def __init__(self, real: Path) -> None:
            self._real = real

        def resolve(self) -> Path:
            return self._real.resolve()

    # Force a drive letter mismatch on both Windows and POSIX CI.
    monkeypatch.setenv("LOCALAPPDATA", str(local_app) if local_app.drive else f"C:{local_app}")
    if not local_app.drive:
        monkeypatch.setattr(
            core,
            "Path",
            lambda value: tmp_path / "localapp" if str(value).startswith("C:") else Path(value),
        )

    dir_a = core._default_profile_dir(_FakeOtherDrivePath(real_a))  # type: ignore[arg-type]
    dir_b = core._default_profile_dir(_FakeOtherDrivePath(real_b))  # type: ignore[arg-type]
    assert dir_a != dir_b
    assert dir_a.name.startswith("chrome-profile-")
    assert dir_b.name.startswith("chrome-profile-")
