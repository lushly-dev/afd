"""disk-setup, disk-status, disk-run and the scheduler definitions."""

from __future__ import annotations

import asyncio
import json
import plistlib
import subprocess
import threading
import time
import tomllib
import xml.etree.ElementTree as ET
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest

from botcore.commands.disk import schedule, setup, steps
from botcore.commands.disk.settings import MachineSettings, load_machine_settings
from botcore.commands.skill_usage import store as usage_store
from tests.test_disk_report import age_worktree, repo  # noqa: F401
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
    again = run(setup.disk_run())  # every hour, due or not
    assert again["ran"] is False and again["skill_usage"]["ok"] and usage()["ok"]
    worked = again["skill_usage"]["at"]  # when it last worked: a second later, on a busy machine

    built.path.write_text("not a database")  # the harness's store stops being readable
    assert run(setup.disk_run())["skill_usage"]["ok"] is False  # and the disk job still runs
    status = run(setup.disk_status())
    assert (status["skill_usage"]["ok"], status["skill_usage"]["ok_at"]) == (False, worked)
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
    monkeypatch.setattr(setup, "RUN_SECONDS", 0.5)  # how long a run waits for what waits
    monkeypatch.setattr(setup, "QUIET_SECONDS", 0.5)
    waited = job()
    release.set()
    assert "did not finish in 0.2 seconds" in waited["error"] and order[1:] == ["collect"]
    for name, seconds in (("USAGE_SECONDS", 300), ("RUN_SECONDS", 3000), ("QUIET_SECONDS", 300)):
        monkeypatch.setattr(setup, name, seconds)
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


def _short_waits(monkeypatch: pytest.MonkeyPatch, quiet: float = 0.4, run: float = 0.8) -> None:
    """A run that waits for what waits, in under a second."""
    monkeypatch.setattr(setup, "QUIET_SECONDS", quiet)
    monkeypatch.setattr(setup, "RUN_SECONDS", run)
    monkeypatch.setattr(setup, "POLL_SECONDS", 0.05)


def test_a_disk_step_that_never_comes_back_ends_the_run_and_the_status_says_where(
    repo: dict[str, Path], state: Path, monkeypatch: pytest.MonkeyPatch, tmp_path: Path,  # noqa: F811
) -> None:
    import botcore.commands.disk.reclaim as reclaim
    import botcore.commands.skill_usage as usage

    release = threading.Event()
    order: list[str] = []
    held = "/Volumes/Shed/worktrees/a"

    async def waits(**_kwargs):
        steps.doing("reading", held)  # as a read macOS holds for the owner's answer does
        order.append("reclaim")
        release.wait(30)
        return SimpleNamespace(success=True, data={"still_low": []})

    seen: list[dict] = []

    async def collect():
        order.append("collect")
        seen.append(json.loads((state / "check.json").read_text()))
        return SimpleNamespace(success=True, data={"added": 3})

    monkeypatch.setattr(reclaim, "disk_reclaim", waits)
    monkeypatch.setattr(usage, "skill_usage_collect", collect)
    monkeypatch.setattr(schedule, "current",
                        lambda: schedule.ScheduleState("test", installed=True, where="test"))
    monkeypatch.setattr(setup, "consent_hint", lambda path: f"allow it for {path}")
    _short_waits(monkeypatch)

    began = time.monotonic()
    result = asyncio.run(setup.disk_run(force=True))
    assert time.monotonic() - began < 10  # the run ended by itself
    assert not result.success and result.error.code == "DISK_RUN_STALLED"
    assert order == ["reclaim", "collect"]  # the collection was not held
    # and the status could say what the disk work waits for before the collection began
    assert seen[0]["disk_work"]["waiting_on"]["path"] == held
    check = json.loads((state / "check.json").read_text())
    assert check["skill_usage"]["ok"] and check["skill_usage"]["added"] == 3
    work = check["disk_work"]
    assert work["ok"] is False and work["waiting_on"] == {"what": "reading", "path": held}
    assert f"reading {held}" in work["error"] and f"allow it for {held}" in work["error"]
    status = run(setup.disk_status())
    assert status["healthy"] is False and status["disk_work"]["ok"] is False
    assert any(held in found for found in status["problems"])  # at once: it needs the owner
    since = work["failing_since"]

    asyncio.run(setup.disk_run(force=True))  # an hour later it still waits: since when is kept
    assert json.loads((state / "check.json").read_text())["disk_work"]["failing_since"] == since

    release.set()  # the owner answered
    assert run(setup.disk_run(force=True))["ran"] is True
    status = run(setup.disk_status())
    assert status["disk_work"]["ok"] is True
    assert not any("disk work" in found for found in status["problems"] + status["warnings"])


def test_a_step_that_comes_back_while_the_run_waits_is_recorded_as_it_ended(
    repo: dict[str, Path], state: Path, monkeypatch: pytest.MonkeyPatch,  # noqa: F811
) -> None:
    import botcore.commands.disk.reclaim as reclaim

    release = threading.Event()

    async def waits(**_kwargs):
        steps.doing("reading", "/Volumes/Shed")
        release.wait(30)
        return SimpleNamespace(success=True, data={"still_low": []})

    monkeypatch.setattr(reclaim, "disk_reclaim", waits)
    _short_waits(monkeypatch, quiet=0.2, run=20)
    threading.Timer(0.8, release.set).start()  # the answer comes while the run still waits
    data = run(setup.disk_run(force=True))
    assert data["ran"] is True and data["skill_usage"]["ok"]
    assert json.loads((state / "check.json").read_text())["disk_work"]["ok"] is True


def test_a_step_that_is_working_is_never_cut_short(
    repo: dict[str, Path], state: Path, monkeypatch: pytest.MonkeyPatch,  # noqa: F811
) -> None:
    import botcore.commands.disk.reclaim as reclaim

    async def works(**_kwargs):
        for index in range(12):  # longer than the run's time, and never silent for long
            steps.doing("removing", f"/trees/{index}")
            time.sleep(0.1)
        return SimpleNamespace(success=True, data={"still_low": []})

    monkeypatch.setattr(reclaim, "disk_reclaim", works)
    _short_waits(monkeypatch, quiet=0.6, run=0.3)
    assert run(setup.disk_run(force=True))["ran"] is True
    assert json.loads((state / "check.json").read_text())["disk_work"]["ok"] is True

    async def prunes(**_kwargs):
        steps.doing("pruning the uv cache", allow=30)  # a command with a timeout of its own
        time.sleep(1.2)
        return SimpleNamespace(success=True, data={"still_low": []})

    monkeypatch.setattr(reclaim, "disk_reclaim", prunes)
    _short_waits(monkeypatch, quiet=0.2, run=0.3)
    assert run(setup.disk_run(force=True))["ran"] is True


def test_every_run_reads_the_folders_it_will_need_before_anything_else(
    repo: dict[str, Path], state: Path, monkeypatch: pytest.MonkeyPatch, tmp_path: Path,  # noqa: F811
) -> None:
    import botcore.commands.disk.reclaim as reclaim

    aged = tmp_path / "cache"
    aged.mkdir()
    with repo["settings"].open("a", encoding="utf-8") as handle:
        handle.write(f"\n[[volume]]\nmount = {json.dumps(str(tmp_path))}\n")
        handle.write(f"\n[[aged]]\npath = {json.dumps(str(aged) + '/*')}\nmax_age_days = 7\n")
    settings = load_machine_settings()[0]
    folders = [str(folder) for folder in setup.job_folders(settings)]
    wanted = [str(tmp_path), str(repo["main"]), str(repo["old"]), str(repo["fresh"]), str(aged)]
    at = [folders.index(folder) for folder in wanted]  # volumes, then worktrees, then aged
    assert at[0] < at[1] < min(at[2:4]) and max(at[2:4]) < at[4]
    assert len(set(folders)) == len(folders)
    listed: list[Path] = []
    list_worktrees = setup.list_worktrees
    monkeypatch.setattr(setup, "list_worktrees",
                        lambda path: listed.append(path) or list_worktrees(path))
    named = setup.job_folders(settings)
    # a repository is named before git reads it: a read that waits is of the folder named
    assert [str(next(named)), str(next(named))] == wanted[:2] and listed == []
    assert str(next(named)) in wanted[2:4] and listed == [repo["main"]]
    monkeypatch.setattr(setup, "list_worktrees", list_worktrees)

    async def fake_reclaim(**_kwargs):
        now = setup.datetime.now(setup.UTC).isoformat(timespec="seconds")
        state.mkdir(parents=True, exist_ok=True)
        (state / "status.json").write_text(json.dumps({"last_apply": {"at": now, "ok": True}}))
        return SimpleNamespace(success=True, data={"still_low": []})

    monkeypatch.setattr(reclaim, "disk_reclaim", fake_reclaim)
    read: list[str] = []
    release = threading.Event()
    listdir = setup.os.listdir

    def held(folder):
        read.append(str(folder))
        if str(folder) == str(repo["old"]):
            release.wait(30)  # the system wants the owner's answer before this one is read
        return listdir(folder)

    assert run(setup.disk_run())["ran"] is True
    monkeypatch.setattr(setup.os, "listdir", held)
    _short_waits(monkeypatch)
    # a run that has nothing to reclaim reads them all the same: the question comes up in
    # the first run, with the owner there, and not a day later
    result = asyncio.run(setup.disk_run())
    release.set()
    assert result.error.code == "DISK_RUN_STALLED" and str(repo["old"]) in result.error.message
    assert read[0] == str(tmp_path) and read[-1] == str(repo["old"]) and str(aged) not in read
    work = json.loads((state / "check.json").read_text())["disk_work"]
    assert work["waiting_on"] == {"what": "reading", "path": str(repo["old"])}
    monkeypatch.setattr(setup.os, "listdir", listdir)
    read.clear()

    def gone(folder):
        read.append(str(folder))
        raise PermissionError(13, "Operation not permitted")

    monkeypatch.setattr(setup.os, "listdir", gone)  # refused is an answer: the run goes on
    assert run(setup.disk_run())["ran"] is False and set(wanted) <= set(read)


def test_the_disk_work_failing_never_stops_the_collection(
    repo: dict[str, Path], state: Path, monkeypatch: pytest.MonkeyPatch,  # noqa: F811
) -> None:
    import botcore.commands.disk.reclaim as reclaim
    import botcore.commands.skill_usage as usage

    async def raises(**_kwargs):
        raise RuntimeError("the volume fell over")

    async def collect():
        return SimpleNamespace(success=True, data={"added": 2})

    monkeypatch.setattr(reclaim, "disk_reclaim", raises)
    monkeypatch.setattr(usage, "skill_usage_collect", collect)
    result = asyncio.run(setup.disk_run(force=True))
    assert result.error.code == "DISK_RUN_FAILED" and "the volume fell over" in result.error.message
    check = json.loads((state / "check.json").read_text())
    assert check["skill_usage"]["added"] == 2 and check["disk_work"]["ok"] is False
    assert "waiting_on" not in check["disk_work"]
    status = run(setup.disk_status())
    assert any("the volume fell over" in found for found in status["warnings"])
    assert not any("disk work" in found for found in status["problems"])  # it came back

    async def refused(**_kwargs):  # a reclaim that came back with an error, as a held lock does
        return SimpleNamespace(success=False, data=None, error=SimpleNamespace(
            code="DISK_RUN_IN_PROGRESS", message="another disk run holds the lock"))

    monkeypatch.setattr(reclaim, "disk_reclaim", refused)
    result = asyncio.run(setup.disk_run(force=True))
    assert result.error.code == "DISK_RUN_IN_PROGRESS"
    work = json.loads((state / "check.json").read_text())["disk_work"]
    assert work["ok"] is False and work["error"] == "another disk run holds the lock"
    assert any("holds the lock" in found for found in run(setup.disk_status())["warnings"])


def test_a_shared_folder_that_does_not_answer_is_told_apart_from_a_collection_that_failed(
    repo: dict[str, Path], state: Path, monkeypatch: pytest.MonkeyPatch, tmp_path: Path,  # noqa: F811
) -> None:
    import botcore.commands.disk.reclaim as reclaim
    import botcore.commands.skill_usage.collect as collect

    async def fake_reclaim(**_kwargs):
        return SimpleNamespace(success=True, data={"still_low": []})

    monkeypatch.setattr(reclaim, "disk_reclaim", fake_reclaim)
    built = T3Store(tmp_path / "t3.sqlite")
    built.project("p1", repo["main"])
    built.skill_tool(built.thread("main"), "plant-beds", stamp(1))
    shared = tmp_path / "drive"
    shared.mkdir()
    monkeypatch.setenv(usage_store.T3_STORE_ENV, str(built.path))
    monkeypatch.setenv(usage_store.SHARED_ENV, str(shared))
    publish = collect.publish
    release = threading.Event()

    def waits(*args):
        release.wait(30)  # as a cloud drive's folder does until the owner allows the read
        return publish(*args)

    monkeypatch.setattr(collect, "publish", waits)
    monkeypatch.setattr(setup, "consent_hint", lambda path: f"allow it for {path}")
    monkeypatch.setattr(setup, "USAGE_SECONDS", 0.3)
    _short_waits(monkeypatch)
    found = run(setup.disk_run(force=True))["skill_usage"]
    assert found["ok"] is False
    assert found["error"].startswith("this machine's record was collected, but the shared folder")
    assert str(shared) in found["error"] and f"allow it for {shared}" in found["error"]
    assert len(usage_store.load_events(usage_store.state_dir())[0]) == 1  # collected here
    assert not (shared / "bench").exists()
    assert any(str(shared) in line for line in run(setup.disk_status())["warnings"])
    release.set()

    # the owner answers while the run still waits: the same run shares the record
    release = threading.Event()
    built.skill_tool(built.thread("second"), "plant-beds", stamp(2))
    _short_waits(monkeypatch, quiet=0.2, run=20)
    threading.Timer(0.9, release.set).start()
    found = run(setup.disk_run(force=True))["skill_usage"]
    assert found["ok"] is True and (shared / "bench" / "state.json").exists()


def test_the_status_says_when_the_job_has_stopped_checking_in(
    repo: dict[str, Path], state: Path, monkeypatch: pytest.MonkeyPatch,  # noqa: F811
) -> None:
    import botcore.commands.disk.reclaim as reclaim

    async def fake_reclaim(**_kwargs):
        return SimpleNamespace(success=True, data={"still_low": []})

    monkeypatch.setattr(reclaim, "disk_reclaim", fake_reclaim)
    installed = SimpleNamespace(installed=True, where="test", detail=None,
                                as_dict=lambda: {"installed": True})
    monkeypatch.setattr(schedule, "current", lambda: installed)
    run(setup.disk_run(force=True))
    assert not any("checked in" in found for found in run(setup.disk_status())["warnings"])
    check = json.loads((state / "check.json").read_text())
    check["last_check"] = (setup.datetime.now(setup.UTC) - timedelta(hours=4)).isoformat()
    (state / "check.json").write_text(json.dumps(check))
    assert any("last checked in 4 hours ago" in f for f in run(setup.disk_status())["warnings"])
    installed.installed = False  # a job that was never installed is said in its own words
    assert not any("checked in" in found for found in run(setup.disk_status())["warnings"])


@pytest.mark.parametrize(("path", "said"), [
    ("/Volumes/Shed/worktrees/a", "an external or network volume"),
    ("~/Library/CloudStorage/Drive-someone/My Drive/usage", "a cloud drive's app manages"),
    ("~/Library/Mobile Documents/com~apple~CloudDocs/usage", "a cloud drive's app manages"),
    ("~/Documents/checkouts/a", "this folder"),
    ("~/dev/checkouts/a", None),
    ("~/Documentsx", None),
    ("", None),
])
def test_what_to_do_about_a_read_macos_holds(path: str, said: str | None) -> None:
    full = str(Path(path).expanduser()) if path else ""
    hint = steps.consent_hint(full, "darwin")
    assert (said in hint and "Full Disk Access" in hint) if said else hint is None
    assert steps.consent_hint(full, "linux") is None and steps.consent_hint(full, "win32") is None


def test_a_step_keeps_what_it_did_and_says_how_long_it_has_been_silent() -> None:
    release = threading.Event()

    def work() -> int:
        steps.doing("pruning the uv cache", allow=30)
        release.wait(30)
        steps.doing("reading", "/trees/a")
        release.clear()
        release.wait(30)
        return 7

    step = steps.Step("test", work)
    time.sleep(0.2)
    what, path, seconds = step.now()
    assert (what, path) == ("pruning the uv cache", "") and seconds >= 0.2
    assert step.quiet() == 0 and "release.wait" in step.where()  # within what it allowed
    release.set()
    time.sleep(0.3)
    assert step.now()[:2] == ("reading", "/trees/a") and step.quiet() >= 0.2
    assert steps.describe(("reading", "/trees/a", 12.0)) == "reading /trees/a for 12 seconds"
    assert steps.describe(("reading", "/trees/a", 720.0)) == "reading /trees/a for 12 minutes"
    release.set()
    assert step.wait(5) and step.outcome == {"result": 7}
    assert step.now() is None and step.quiet() == 0
    # another thread may be given the same number: what it says is not this step's
    steps._NOW[step._thread.ident] = ("reading", "/elsewhere", time.monotonic() - 99, 0.0)  # noqa: SLF001
    assert step.now() is None and step.quiet() == 0
    del steps._NOW[step._thread.ident]  # noqa: SLF001

    def fails() -> None:
        raise KeyboardInterrupt  # whatever a step raises is kept, never raised in the job

    failed = steps.Step("test", fails)
    assert failed.wait(5) and isinstance(failed.outcome["raised"], KeyboardInterrupt)


def test_the_disk_work_says_what_it_does_as_it_goes(
    repo: dict[str, Path], state: Path, monkeypatch: pytest.MonkeyPatch,  # noqa: F811
) -> None:
    """A reclaim that stopped saying what it does would pass for one that waits, and be left
    behind while it works."""
    import botcore.commands.disk.reclaim as reclaim

    age_worktree(repo["main"], repo["old"])  # idle long enough to be stripped
    said: list[tuple[str, str]] = []
    monkeypatch.setattr(steps, "SAID", said)
    result = asyncio.run(reclaim.disk_reclaim(tier=1, apply=True))
    assert result.success, result.error
    stripped = [a["target"] for a in result.data["actions"] if a["outcome"] == "done"]
    assert stripped, result.data["actions"]
    words = {what for what, _path in said}
    assert {"running git in", "checking the volume", "reading", "inspecting", "removing"} <= words
    assert "opening" in words
    for name in ("main", "old", "fresh"):  # the first read of a worktree, then its inspection
        assert ("opening", str(repo[name])) in said and ("inspecting", str(repo[name])) in said
    for target in stripped:  # each action, and each folder as it is cleared
        assert said.count(("removing", target)) >= 2
    assert any(what.startswith("working after running git in") for what in words)


def test_a_commands_allowance_ends_when_the_command_comes_back() -> None:
    release = threading.Event()

    def work() -> None:
        with steps.command("running git in", "/repo", allow=30):
            pass
        release.wait(30)  # a read that waits just after must not pass for the command

    step = steps.Step("test", work)
    time.sleep(0.3)
    assert step.now()[:2] == ("working after running git in", "/repo")
    assert step.quiet() >= 0.2
    release.set()
    assert step.wait(5)

    def raises() -> None:
        try:
            with steps.command("running git in", "/repo", allow=30):
                raise OSError("no git")
        except OSError:
            release.clear()
            release.wait(30)

    step = steps.Step("test", raises)
    time.sleep(0.3)
    assert step.quiet() >= 0.2  # also when the command failed
    release.set()
    assert step.wait(5)


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
