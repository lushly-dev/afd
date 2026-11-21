"""disk-setup, disk-status, disk-run and the scheduler definitions."""

from __future__ import annotations

import asyncio
import json
import plistlib
import subprocess
import threading
import tomllib
import xml.etree.ElementTree as ET
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest

from botcore.commands.disk import schedule, setup
from botcore.commands.disk.settings import MachineSettings, load_machine_settings
from botcore.commands.skill_usage import store as usage_store
from tests.test_disk_report import repo  # noqa: F401
from tests.test_skill_usage import T3Store, stamp

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
        tools={"git": "/usr/bin/git", "pnpm": "C:\\Program Files\\pnpm.cmd"},
        volume=[{"mount": "/Volumes/Dev", "id": "UUID-1", "low_space_gb": 80}],
        aged=[{"path": "/Volumes/Dev/cache/*", "max_age_days": 7}],
        skill_usage_machine="random",
        skill_usage_shared="~/Shared Drive/🌱/skill\x7fusage",  # what TOML has no escape for
        skill_usage_away=["hero", "attic"],
    )
    assert MachineSettings(**tomllib.loads(setup.settings_toml(settings))) == settings
    assert "skill_usage_collect" not in setup.settings_toml(settings)  # the default is not written
    assert "skill_usage_away" not in setup.settings_toml(MachineSettings())
    off = MachineSettings(skill_usage_collect=False)
    assert MachineSettings(**tomllib.loads(setup.settings_toml(off))) == off


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
    real_which = setup.shutil.which
    monkeypatch.setattr(setup.shutil, "which",
                        lambda name: str(exe) if name == "botcore" else real_which(name))
    monkeypatch.setattr(setup, "uv_cache_dir", lambda: str(cache))
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
    assert json.loads((state / "check.json").read_text())["last_check"]
    assert "last_check" not in json.loads((state / "status.json").read_text())


def test_the_job_collects_skill_usage_and_the_status_tells_a_failure_that_lasts(
    repo: dict[str, Path], state: Path, monkeypatch: pytest.MonkeyPatch, tmp_path: Path,  # noqa: F811
) -> None:
    async def fake_reclaim(**_kwargs):
        now = setup.datetime.now(setup.UTC).isoformat(timespec="seconds")
        state.mkdir(parents=True, exist_ok=True)
        (state / "status.json").write_text(json.dumps({"last_apply": {"at": now, "ok": True}}))
        return SimpleNamespace(success=True, data={"still_low": []})

    import botcore.commands.disk.reclaim as reclaim

    monkeypatch.setattr(reclaim, "disk_reclaim", fake_reclaim)
    built = T3Store(tmp_path / "t3.sqlite")
    built.project("p1", repo["main"])
    built.skill_tool(built.thread("main"), "plant-beds", stamp(1))
    monkeypatch.setenv(usage_store.T3_STORE_ENV, str(built.path))

    def usage() -> dict:
        return run(setup.disk_status())["skill_usage"]

    def write_check(**changed: object) -> None:
        check = json.loads((state / "check.json").read_text())
        check["skill_usage"].update(changed)
        (state / "check.json").write_text(json.dumps(check))

    first = run(setup.disk_run())["skill_usage"]
    assert first["ok"] and first["added"] == 1
    assert len(usage_store.load_events(usage_store.state_dir())[0]) == 1
    assert run(setup.disk_run())["ran"] is False and usage()["ok"]  # every hour, due or not

    built.path.write_text("not a database")  # the harness's store stops being readable
    assert run(setup.disk_run())["skill_usage"]["ok"] is False  # and the disk job still runs
    status = run(setup.disk_status())
    assert (status["skill_usage"]["ok"], status["skill_usage"]["ok_at"]) == (False, first["at"])
    assert any("skill usage is not being collected" in found for found in status["warnings"])
    assert not any("skill usage" in found for found in status["problems"])  # not yet

    long_ago = (setup.datetime.now(setup.UTC) - timedelta(hours=30)).isoformat()
    write_check(ok_at=long_ago)  # it last worked before a long sleep, and failed on waking
    began = usage()["failing_since"]
    run(setup.disk_run())  # still failing an hour later: since when is kept
    assert usage()["failing_since"] == began and usage()["ok_at"] == long_ago
    assert not any("skill usage" in found for found in run(setup.disk_status())["problems"])

    write_check(failing_since=long_ago)  # failing for over a day is a problem
    run(setup.disk_run())
    assert usage()["failing_since"] == long_ago
    problems = run(setup.disk_status())["problems"]
    assert any("skill usage is not being collected" in found for found in problems)
    write_check(ok_at=None)  # and so is one that never worked, as long
    assert any("skill usage" in found for found in run(setup.disk_status())["problems"])

    with repo["settings"].open("a", encoding="utf-8") as handle:
        handle.write("skill_usage_collect = false\n")  # a machine may turn it off
    assert "skill_usage" not in run(setup.disk_run())
    status = run(setup.disk_status())
    assert status["skill_usage"] is None
    assert not any("skill usage" in found for found in status["problems"] + status["warnings"])


def test_collection_never_holds_or_fails_the_disk_work(
    repo: dict[str, Path], state: Path, monkeypatch: pytest.MonkeyPatch, tmp_path: Path,  # noqa: F811
) -> None:
    order: list[str] = []

    async def fake_reclaim(**_kwargs):
        order.append("reclaim")
        return SimpleNamespace(success=True, data={"still_low": []})

    import botcore.commands.disk.reclaim as reclaim
    import botcore.commands.skill_usage as usage

    collect = usage.skill_usage_collect
    monkeypatch.setattr(reclaim, "disk_reclaim", fake_reclaim)

    def job() -> dict:
        order.clear()
        data = run(setup.disk_run(force=True))
        assert data["ran"] is True and order[0] == "reclaim"  # the disk work, and first
        return data["skill_usage"]

    async def raises() -> None:
        order.append("collect")
        raise RuntimeError("the store fell over")

    monkeypatch.setattr(usage, "skill_usage_collect", raises)
    assert job()["error"] == "RuntimeError: the store fell over" and order[1:] == ["collect"]

    release = threading.Event()

    async def hangs() -> None:
        order.append("collect")
        release.wait(30)  # as a read of a drive that is away does

    monkeypatch.setattr(usage, "skill_usage_collect", hangs)
    monkeypatch.setattr(setup, "USAGE_SECONDS", 0.2)
    waited = job()
    release.set()
    assert "did not finish in 0.2 seconds" in waited["error"] and order[1:] == ["collect"]
    monkeypatch.setattr(setup, "USAGE_SECONDS", 300)
    monkeypatch.setattr(usage, "skill_usage_collect", collect)

    # a name that cannot be a machine's stops the collection, and never the disk work
    monkeypatch.delenv(usage_store.MACHINE_ENV)
    before = repo["settings"].read_text(encoding="utf-8")
    repo["settings"].write_text(before + 'skill_usage_machine = "my machine"\n', encoding="utf-8")
    assert "cannot name a machine" in job()["error"]
    assert run(setup.disk_status())["skill_usage"]["ok"] is False
    repo["settings"].write_text(before, encoding="utf-8")
    monkeypatch.setenv(usage_store.MACHINE_ENV, "bench")

    # nor does a shared folder that is away: the status says so, and a success clears it
    built = T3Store(tmp_path / "t3.sqlite")
    built.project("p1", repo["main"])
    built.skill_tool(built.thread("main"), "plant-beds", stamp(1))
    monkeypatch.setenv(usage_store.T3_STORE_ENV, str(built.path))
    monkeypatch.setenv(usage_store.SHARED_ENV, str(tmp_path / "away"))
    assert job()["error"].startswith("the shared folder could not be written")
    assert any("skill usage" in found for found in run(setup.disk_status())["warnings"])
    (tmp_path / "away").mkdir()
    assert job()["ok"] is True
    status = run(setup.disk_status())
    assert status["skill_usage"]["ok"] is True
    assert not any("skill usage" in found for found in status["warnings"] + status["problems"])


def test_setup_writes_the_machines_name_down_once(
    repo: dict[str, Path], state: Path, monkeypatch: pytest.MonkeyPatch,  # noqa: F811
) -> None:
    monkeypatch.chdir(repo["main"])
    monkeypatch.setattr(usage_store.platform, "node", lambda: "Shed.local")
    run(setup.disk_setup(install_schedule=False))
    assert load_machine_settings()[0].skill_usage_machine == "shed"
    # a hostname changes with the network: the record keeps the name the machine began with
    monkeypatch.setattr(usage_store.platform, "node", lambda: "shed-2.guest.network")
    run(setup.disk_setup(install_schedule=False))
    assert load_machine_settings()[0].skill_usage_machine == "shed"


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
