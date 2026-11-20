"""disk-setup, disk-status, disk-run and the scheduler definitions."""

from __future__ import annotations

import asyncio
import json
import plistlib
import subprocess
import tomllib
import xml.etree.ElementTree as ET
from pathlib import Path
from types import SimpleNamespace

import pytest

from botcore.commands.disk import schedule, setup
from botcore.commands.disk.settings import MachineSettings, load_machine_settings
from tests.test_disk_report import repo  # noqa: F401

TASK_NS = "{http://schemas.microsoft.com/windows/2004/02/mit/task}"


@pytest.fixture
def state(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    folder = tmp_path / "state"
    monkeypatch.setenv("BOTCORE_DISK_STATE", str(folder))
    return folder


def run(coro) -> dict:
    result = asyncio.run(coro)
    assert result.success, result.error
    return result.data


def test_settings_toml_round_trips() -> None:
    settings = MachineSettings(
        repos=["/a b/repo", 'C:\\x\\"y"'],
        strip_after_days=2.5,
        volume=[{"mount": "/Volumes/Dev", "id": "UUID-1", "low_space_gb": 80}],
        aged=[{"path": "/Volumes/Dev/cache/*", "max_age_days": 7}],
    )
    assert MachineSettings(**tomllib.loads(setup.settings_toml(settings))) == settings


def test_setup_registers_the_repository_and_its_volumes(
    repo: dict[str, Path], state: Path, monkeypatch: pytest.MonkeyPatch,  # noqa: F811
) -> None:
    repo["settings"].unlink()
    monkeypatch.chdir(repo["old"])  # from a worktree: the main checkout is what gets registered
    data = run(setup.disk_setup(install_schedule=False))
    assert data["added_repos"] == [str(repo["main"])]
    settings, _path, found = load_machine_settings()
    assert found and settings.repos == [str(repo["main"])]
    assert settings.volume and all(v.low_space_gb >= 20 for v in settings.volume)
    again = run(setup.disk_setup(install_schedule=False))
    assert again["added_repos"] == [] and again["added_volumes"] == []


def test_setup_refuses_a_botcore_from_uvs_cache(
    repo: dict[str, Path], state: Path, monkeypatch: pytest.MonkeyPatch,  # noqa: F811
) -> None:
    cache = repo["tmp"] / "uv-cache"
    exe = cache / "archive-v0" / "bin" / "botcore"
    exe.parent.mkdir(parents=True)
    exe.write_text("#!/bin/sh\n")
    monkeypatch.setattr(setup.shutil, "which", lambda name: str(exe) if name == "botcore" else name)
    monkeypatch.setattr(setup.subprocess, "run",
                        lambda *a, **k: SimpleNamespace(stdout=str(cache), returncode=0))
    monkeypatch.chdir(repo["main"])
    result = asyncio.run(setup.disk_setup())
    assert not result.success and result.error.code == "DISK_TOOL_NOT_INSTALLED"


def test_status_reports_problems_until_a_run_succeeds(
    repo: dict[str, Path], state: Path, monkeypatch: pytest.MonkeyPatch,  # noqa: F811
) -> None:
    monkeypatch.setattr(schedule, "current",
                        lambda: schedule.ScheduleState("test", True, "here"))
    data = run(setup.disk_status())
    assert not data["healthy"]
    assert "no successful run in the last 48 hours" in data["problems"]
    state.mkdir(parents=True)
    now = setup.datetime.now(setup.UTC).isoformat(timespec="seconds")
    (state / "status.json").write_text(json.dumps({"last_apply": {"at": now, "ok": True}}))
    assert run(setup.disk_status())["healthy"]


def test_the_job_only_reclaims_when_due(
    repo: dict[str, Path], state: Path, monkeypatch: pytest.MonkeyPatch,  # noqa: F811
) -> None:
    calls = []

    async def fake_reclaim(**kwargs):
        calls.append(kwargs)
        stamp = setup.datetime.now(setup.UTC).isoformat(timespec="seconds")
        state.mkdir(parents=True, exist_ok=True)
        (state / "status.json").write_text(json.dumps({"last_apply": {"at": stamp, "ok": True}}))
        return SimpleNamespace(success=True, data={"still_low": [], "receipt": "r.json"})

    import botcore.commands.disk.reclaim as reclaim

    monkeypatch.setattr(reclaim, "disk_reclaim", fake_reclaim)
    assert run(setup.disk_run())["ran"] is True  # never ran before
    assert run(setup.disk_run())["ran"] is False  # ran a moment ago
    assert run(setup.disk_run(force=True))["ran"] is True
    assert [c["apply"] for c in calls] == [True, True]
    assert json.loads((state / "status.json").read_text())["last_check"]


def test_the_job_notifies_once_while_space_stays_low(
    repo: dict[str, Path], state: Path, monkeypatch: pytest.MonkeyPatch,  # noqa: F811
) -> None:
    notices = []

    async def fake_reclaim(**_kwargs):
        return SimpleNamespace(success=True, data={"still_low": ["/Volumes/Dev"]})

    import botcore.commands.disk.reclaim as reclaim

    monkeypatch.setattr(reclaim, "disk_reclaim", fake_reclaim)
    monkeypatch.setattr(setup, "notify", lambda title, message: notices.append(message))
    run(setup.disk_run(force=True))
    run(setup.disk_run(force=True))
    assert len(notices) == 1 and "/Volumes/Dev" in notices[0]


# ── Scheduler definitions ───────────────────────────────────────────────────


def test_windows_task_runs_hidden_on_battery_without_elevation() -> None:
    xml = schedule.windows_task_xml(r"C:\Users\j\.local\bin\botcore.exe", "HERO\\j")
    root = ET.fromstring(xml.replace('encoding="UTF-16"', ""))
    settings = root.find(f"{TASK_NS}Settings")
    assert settings.find(f"{TASK_NS}DisallowStartIfOnBatteries").text == "false"
    assert settings.find(f"{TASK_NS}StopIfGoingOnBatteries").text == "false"
    assert settings.find(f"{TASK_NS}Hidden").text == "true"
    principal = root.find(f"{TASK_NS}Principals/{TASK_NS}Principal")
    assert principal.find(f"{TASK_NS}RunLevel").text == "LeastPrivilege"
    exec_ = root.find(f"{TASK_NS}Actions/{TASK_NS}Exec")
    assert exec_.find(f"{TASK_NS}Command").text.endswith("conhost.exe")
    assert "--headless" in exec_.find(f"{TASK_NS}Arguments").text
    assert "disk-run" in exec_.find(f"{TASK_NS}Arguments").text


def test_macos_agent_definition(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(schedule.Path, "home", lambda: tmp_path)
    ran = []
    monkeypatch.setattr(schedule, "_run", lambda args, stdin=None: (
        ran.append(args) or subprocess.CompletedProcess(args, 0, "", "")
    ))
    monkeypatch.setattr(schedule.os, "getuid", lambda: 501, raising=False)
    state = schedule._macos_install("/u/.local/bin/botcore", tmp_path / "logs", "/usr/bin:/bin")
    assert state.installed
    body = plistlib.loads(Path(state.where).read_bytes())
    assert body["ProgramArguments"] == ["/u/.local/bin/botcore", "disk-run"]
    assert body["StartInterval"] == 3600 and body["RunAtLoad"] is True
    assert body["EnvironmentVariables"]["PATH"] == "/usr/bin:/bin"
    assert ["launchctl", "bootstrap", "gui/501", state.where] in ran


def test_linux_falls_back_to_crontab(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    table = {"text": "0 1 * * * other-job\n"}

    def fake_run(args, stdin=None):
        if args[:2] == ["crontab", "-l"]:
            return subprocess.CompletedProcess(args, 0, table["text"], "")
        if args[:2] == ["crontab", "-"]:
            table["text"] = stdin
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(schedule, "_run", fake_run)
    monkeypatch.setattr(schedule.shutil, "which",
                        lambda name: None if name == "systemctl" else name)
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    assert schedule._linux_install("/home/u/.local/bin/botcore", "/usr/bin").installed
    assert "other-job" in table["text"] and schedule.CRON_MARK in table["text"]
    schedule._linux_install("/home/u/.local/bin/botcore", "/usr/bin")
    assert table["text"].count(schedule.CRON_MARK) == 1
    schedule._linux_uninstall()
    assert schedule.CRON_MARK not in table["text"] and "other-job" in table["text"]
