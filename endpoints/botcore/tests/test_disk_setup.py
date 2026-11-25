"""disk-setup, disk-status, disk-run and the scheduler definitions."""

# ruff: noqa: F811
from __future__ import annotations

import asyncio
import json
import os
import plistlib
import subprocess
import sys
import threading
import time
import tomllib
import xml.etree.ElementTree as ET
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest

from botcore.commands.disk import lock, schedule, setup, steps
from botcore.commands.disk.settings import MachineSettings, load_machine_settings
from botcore.commands.skill_usage import store as usage_store
from tests.test_disk_report import age_worktree, repo  # noqa: F401
from tests.test_skill_usage import T3Store, stamp

TASK_NS = "{http://schemas.microsoft.com/windows/2004/02/mit/task}"


@pytest.fixture(autouse=True)
def _the_job(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(setup, "POLL_SECONDS", 0.01)
    monkeypatch.setattr(setup, "REACH", False)  # the same on every system; a test turns it on
    monkeypatch.setattr(setup, "consent_hint", lambda path: None)  # likewise
    monkeypatch.setattr(setup, "_LIVE", None)


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
        skill_usage_dirs=["~/my-skills", "/opt/plugins/skills"],
    )
    assert MachineSettings(**tomllib.loads(setup.settings_toml(settings))) == settings
    assert "skill_usage_collect" not in setup.settings_toml(settings)  # the default is not written
    assert "skill_usage_away" not in setup.settings_toml(MachineSettings())
    assert "skill_usage_dirs" not in setup.settings_toml(MachineSettings())
    off = MachineSettings(skill_usage_collect=False)
    assert MachineSettings(**tomllib.loads(setup.settings_toml(off))) == off


def test_setup_registers_the_repository_and_its_volumes(
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
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
    assert again["updated_volumes"] == {}
    assert again["changed_tools"] == {}


def test_setup_migrates_macos_root_snapshot_volume_id_without_touching_external_volumes(
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """lushly-dev/afd#2267: rerunning `disk-setup` replaces an ephemeral macOS APFS snapshot
    UUID on an internal `/` volume with `APFSVolumeGroupID`, while leaving external volumes,
    external-boot `/` volumes and `id=None` entries untouched."""
    from botcore.commands.disk import scan

    monkeypatch.chdir(repo["main"])
    monkeypatch.setattr(scan.sys, "platform", "darwin")
    monkeypatch.setattr(scan.os.path, "ismount", lambda _p: True)

    # Booted from an external drive (Internal=False): `/` must NOT be overwritten.
    monkeypatch.setattr(
        scan,
        "_darwin_diskutil_info",
        lambda _m: {
            "APFSSnapshot": True,
            "APFSSnapshotUUID": "EXT-SNAP",
            "APFSVolumeGroupID": "EXTERNAL-BOOT-GROUP",
            "Internal": False,
            "VolumeUUID": "EXT-SNAP",
        },
    )
    external_boot = MachineSettings(
        repos=[str(repo["main"])],
        volume=[
            {"mount": "/", "id": "RECORDED-GROUP", "low_space_gb": 46.0},
            {"mount": "/Volumes/Dev", "id": "EXTERNAL-OLD-UUID", "low_space_gb": 93.0},
        ],
    )
    repo["settings"].write_text(setup.settings_toml(external_boot), encoding="utf-8")
    ext_data = run(setup.disk_setup(install_schedule=False))
    assert ext_data["updated_volumes"] == {}
    assert {v.mount: v.id for v in load_machine_settings()[0].volume}["/"] == "RECORDED-GROUP"

    # Unset id=None on `/` must stay None.
    monkeypatch.setattr(
        scan,
        "_darwin_diskutil_info",
        lambda _m: {
            "APFSSnapshot": True,
            "APFSSnapshotUUID": "SNAP-NEW",
            "APFSVolumeGroupID": "GROUP-UUID-STABLE",
            "Internal": True,
            "VolumeUUID": "SNAP-NEW",
        },
    )
    no_id = MachineSettings(
        repos=[str(repo["main"])],
        volume=[{"mount": "/", "id": None, "low_space_gb": 46.0}],
    )
    repo["settings"].write_text(setup.settings_toml(no_id), encoding="utf-8")
    no_id_data = run(setup.disk_setup(install_schedule=False))
    assert no_id_data["updated_volumes"] == {}
    assert {v.mount: v.id for v in load_machine_settings()[0].volume}["/"] is None

    # Internal `/` with an ephemeral snapshot UUID migrates to APFSVolumeGroupID; external stays.
    initial = MachineSettings(
        repos=[str(repo["main"])],
        volume=[
            {"mount": "/", "id": "OLD-SNAPSHOT-UUID", "low_space_gb": 46.0},
            {"mount": "/Volumes/Dev", "id": "EXTERNAL-OLD-UUID", "low_space_gb": 93.0},
        ],
    )
    repo["settings"].write_text(setup.settings_toml(initial), encoding="utf-8")
    data = run(setup.disk_setup(install_schedule=False))
    assert data["updated_volumes"] == {
        "/": {"was": "OLD-SNAPSHOT-UUID", "now": "GROUP-UUID-STABLE"}
    }
    saved = {v.mount: v.id for v in load_machine_settings()[0].volume}
    assert saved["/"] == "GROUP-UUID-STABLE"
    assert saved["/Volumes/Dev"] == "EXTERNAL-OLD-UUID"

    again = run(setup.disk_setup(install_schedule=False))
    assert again["updated_volumes"] == {}

    # Schedule-install failure after writing disk.toml still reports updated_volumes in details.
    repo["settings"].write_text(setup.settings_toml(initial), encoding="utf-8")
    monkeypatch.setattr(setup.shutil, "which", lambda _name: None)
    failed = asyncio.run(setup.disk_setup(install_schedule=True))
    assert not failed.success and failed.error.code == "DISK_TOOL_NOT_INSTALLED"
    assert failed.error.details["updated_volumes"] == {
        "/": {"was": "OLD-SNAPSHOT-UUID", "now": "GROUP-UUID-STABLE"}
    }


def test_setup_rerun_keeps_usable_tools_and_reports_changes(
    repo: dict[str, Path],
    state: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """lushly-dev/afd#1934: a rerun from a different shell PATH keeps existing usable [tools]
    entries, only filling in missing or broken ones, and reports any entry it changed."""

    def make_tool(folder: Path, name: str, executable: bool = True) -> Path:
        folder.mkdir(parents=True, exist_ok=True)
        suffix = ".cmd" if sys.platform == "win32" else ""
        path = folder / f"{name}{suffix}"
        script = "@echo ok\r\n" if sys.platform == "win32" else "#!/bin/sh\n"
        path.write_text(script, encoding="utf-8")
        path.chmod(0o755 if executable else 0o644)
        return path

    owner_bin = tmp_path / "owner-bin"
    agent_bin = tmp_path / "agent-bin"
    owner_node = make_tool(owner_bin, "node")
    owner_pnpm = make_tool(owner_bin, "pnpm")
    owner_git = make_tool(owner_bin, "git")
    agent_node = make_tool(agent_bin, "node")
    agent_pnpm = make_tool(agent_bin, "pnpm")
    agent_uv = make_tool(agent_bin, "uv")
    custom_cargo = make_tool(owner_bin, "cargo")

    # Avoid treating tmp_path (under TEMP/TMPDIR) as a shell-session path.
    monkeypatch.setattr(setup, "_session_path", lambda path: "session-only" in path)
    monkeypatch.chdir(repo["main"])

    # Seed disk.toml with owner's choices plus one broken entry (gh) and one missing entry (uv).
    initial = MachineSettings(
        repos=[str(repo["main"])],
        tools={
            "node": str(owner_node),
            "pnpm": str(owner_pnpm),
            "git": str(owner_git),
            "gh": str(tmp_path / "deleted" / "gh"),
            "cargo": str(custom_cargo),
        },
    )
    repo["settings"].write_text(setup.settings_toml(initial), encoding="utf-8")

    # Rerun from an agent shell whose PATH points to different node/pnpm, adds uv, and lacks git/gh.
    shell_tools = {"node": str(agent_node), "pnpm": str(agent_pnpm), "uv": str(agent_uv)}
    monkeypatch.setattr(setup.shutil, "which", shell_tools.get)
    data = run(setup.disk_setup(install_schedule=False))

    assert data["tools"] == {
        "node": str(owner_node),
        "pnpm": str(owner_pnpm),
        "git": str(owner_git),
        "uv": str(agent_uv),
        "cargo": str(custom_cargo),
    }
    assert data["changed_tools"] == {
        "gh": {"was": str(tmp_path / "deleted" / "gh"), "now": None},
        "uv": {"was": None, "now": str(agent_uv)},
    }
    assert load_machine_settings()[0].tools == data["tools"]

    # A second rerun with the same tools reports no changes.
    again = run(setup.disk_setup(install_schedule=False))
    assert again["changed_tools"] == {}

    # A broken existing entry (deleted or session-only or non-executable on POSIX) is replaced.
    owner_node.unlink()
    replaced = run(setup.disk_setup(install_schedule=False))
    assert replaced["tools"]["node"] == str(agent_node)
    assert replaced["changed_tools"] == {"node": {"was": str(owner_node), "now": str(agent_node)}}

    if sys.platform == "win32":
        # An extensionless POSIX shim cannot run directly on Windows and must be replaced.
        posix_shim = owner_bin / "pnpm"
        posix_shim.write_text("#!/bin/sh\n", encoding="utf-8")
        current = load_machine_settings()[0]
        current.tools["pnpm"] = str(posix_shim)
        repo["settings"].write_text(setup.settings_toml(current), encoding="utf-8")
        fixed_shim = run(setup.disk_setup(install_schedule=False))
        assert fixed_shim["tools"]["pnpm"] == str(agent_pnpm)
        assert fixed_shim["changed_tools"] == {
            "pnpm": {"was": str(posix_shim), "now": str(agent_pnpm)}
        }
    else:
        owner_pnpm.chmod(0o644)
        fixed_mode = run(setup.disk_setup(install_schedule=False))
        assert fixed_mode["tools"]["pnpm"] == str(agent_pnpm)
        assert fixed_mode["changed_tools"] == {
            "pnpm": {"was": str(owner_pnpm), "now": str(agent_pnpm)}
        }

    # When schedule installation fails after disk.toml was written, report changed_tools in details.
    current = load_machine_settings()[0]
    gone = str(tmp_path / "gone" / "gh")
    current.tools["gh"] = gone
    repo["settings"].write_text(setup.settings_toml(current), encoding="utf-8")
    failed = asyncio.run(setup.disk_setup(install_schedule=True))
    assert not failed.success and failed.error.code == "DISK_TOOL_NOT_INSTALLED"
    assert failed.error.details == {
        "settings": str(repo["settings"]),
        "changed_tools": {"gh": {"was": gone, "now": None}},
    }


def test_setup_refuses_a_botcore_from_uvs_cache(
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cache = repo["tmp"] / "uv-cache"
    exe = cache / "archive-v0" / "bin" / "botcore"
    exe.parent.mkdir(parents=True)
    exe.write_text("#!/bin/sh\n")
    real_which = setup.shutil.which
    monkeypatch.setattr(
        setup.shutil, "which", lambda name: str(exe) if name == "botcore" else real_which(name)
    )
    monkeypatch.setattr(setup, "uv_cache_dir", lambda: str(cache))
    monkeypatch.chdir(repo["main"])
    result = asyncio.run(setup.disk_setup())
    assert not result.success and result.error.code == "DISK_TOOL_NOT_INSTALLED"


def test_status_reports_problems_until_a_run_succeeds(
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(schedule, "current", lambda: schedule.ScheduleState("test", True, "here"))
    data = run(setup.disk_status())
    assert not data["healthy"]
    assert "no successful run in the last 48 hours" in data["problems"]
    state.mkdir(parents=True)
    now = setup.datetime.now(setup.UTC).isoformat(timespec="seconds")
    (state / "status.json").write_text(json.dumps({"last_apply": {"at": now, "ok": True}}))
    assert run(setup.disk_status())["healthy"]


def test_the_job_only_reclaims_when_due(
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
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
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
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
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
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
    order.clear()
    waited = run(setup.disk_run(force=True, own_process=True))["skill_usage"]
    release.set()
    assert "made no progress for 0.2 seconds" in waited["error"] and order == ["reclaim", "collect"]
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


class Looks:
    """What the job sees of its steps, said by the test: no test here waits for a clock to
    call a step waiting. `held` names the steps that have gone quiet."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.held: set[str] = set()
        self.acted_on = False
        self.seen: list[tuple[str, str]] = []
        self.on_look = lambda step, look: None
        monkeypatch.setattr(setup, "_look", self)

    def __call__(self, step: steps.Step):
        seen = step.seen()  # what it said, and which word: as the job's own look takes them
        if step.done:
            look = "done"
        elif seen is None or step.name not in self.held:
            look = "working"  # (one that has not said a word yet is not waiting)
        else:
            look = "waiting"
        # whether this is a look the run acts on, and not one it takes while it waits
        self.acted_on = sys._getframe(1).f_code.co_name == "_run"  # noqa: SLF001
        self.seen.append((step.name, look))
        self.on_look(step, look)
        if look == "done" or seen is None:
            return look, None, None
        return look, seen[:3], seen[4]


@pytest.fixture
def alive(monkeypatch: pytest.MonkeyPatch):
    """How many of the steps this test's runs started, by name, are still going. Its own
    steps only: a worker an earlier test left behind is not this test's."""
    made: list[steps.Step] = []

    class Recorded(steps.Step):
        def __init__(self, name: str, work) -> None:
            made.append(self)
            super().__init__(name, work)

    monkeypatch.setattr(setup, "Step", Recorded)
    return lambda name: sum(step.name == name and not step.done for step in made)


def check_file(state: Path) -> dict:
    return json.loads((state / "check.json").read_text())


@pytest.fixture
def at_once(monkeypatch: pytest.MonkeyPatch):
    """For work that has started to wait: the job's limit is up now. No test waits for a
    limit measured in tenths of a second to pass at the right moment."""
    live = [True]

    def now(name: str) -> None:
        if live[0]:  # (a worker a test left behind changes nothing in the next test)
            monkeypatch.setattr(setup, name, 0)

    yield now
    live[0] = False


def test_a_disk_step_that_only_waits_is_left_and_the_status_says_where(
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    import botcore.commands.disk.reclaim as reclaim
    import botcore.commands.skill_usage as usage

    release = threading.Event()
    order: list[str] = []
    held = "/Volumes/Shed/worktrees/a"
    looks = Looks(monkeypatch)

    async def held_by_the_system(**_kwargs):
        steps.doing("reading", held)  # as a read macOS holds for the owner's answer does
        if not release.is_set():
            looks.held = {"disk-work"}  # and from here on it says nothing
        order.append("reclaim")
        release.wait(30)
        return SimpleNamespace(success=True, data={"still_low": []})

    seen: list[dict] = []

    async def collect():
        order.append("collect")
        seen.append(check_file(state))
        return SimpleNamespace(success=True, data={"added": 3})

    monkeypatch.setattr(reclaim, "disk_reclaim", held_by_the_system)
    monkeypatch.setattr(usage, "skill_usage_collect", collect)
    monkeypatch.setattr(
        schedule, "current", lambda: schedule.ScheduleState("test", installed=True, where="test")
    )
    monkeypatch.setattr(setup, "consent_hint", lambda path: f"allow it for {path}")

    result = asyncio.run(setup.disk_run(force=True, own_process=True))  # it ended by itself
    assert not result.success and result.error.code == "DISK_RUN_STALLED"
    assert held in result.error.message
    assert order == ["reclaim", "collect"]  # the collection was not held
    # and the status could say what the disk work waits for before the collection began
    assert seen[0]["disk_work"]["waiting_on"]["path"] == held
    logged = capsys.readouterr().err  # where it stopped, for the job's log
    assert "the disk work was left waiting here" in logged and "held_by_the_system" in logged
    check = check_file(state)
    assert check["skill_usage"]["ok"] and check["skill_usage"]["added"] == 3
    work = check["disk_work"]
    assert work["ok"] is False and work["waiting_on"] == {"what": "reading", "path": held}
    assert f"reading {held}" in work["error"] and f"allow it for {held}" in work["error"]
    assert work["error"] in result.error.message  # one look, said the same in both places
    status = run(setup.disk_status())
    assert status["healthy"] is False and status["disk_work"]["ok"] is False
    told = [found for found in status["problems"] if "disk work is waiting" in found]
    assert told and held in told[0] and "hours" not in told[0]  # at once: it needs the owner
    since = work["failing_since"]

    asyncio.run(setup.disk_run(force=True, own_process=True))  # an hour later it still waits
    assert check_file(state)["disk_work"]["failing_since"] == since  # since when is kept
    check = check_file(state)
    check["disk_work"]["failing_since"] = (
        setup.datetime.now(setup.UTC) - timedelta(hours=3)
    ).isoformat()
    (state / "check.json").write_text(json.dumps(check))
    assert any("(for 3 hours)" in found for found in run(setup.disk_status())["problems"])

    release.set()  # the owner answered
    looks.held = set()
    assert run(setup.disk_run(force=True, own_process=True))["ran"] is True
    status = run(setup.disk_status())
    assert status["disk_work"]["ok"] is True and "waiting_on" not in status["disk_work"]
    assert not any("disk work" in found for found in status["problems"] + status["warnings"])


def test_disk_work_that_is_working_is_waited_for_and_never_recorded_as_waiting(
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import botcore.commands.disk.reclaim as reclaim
    import botcore.commands.skill_usage as usage

    finish = threading.Event()
    order: list[str] = []
    looks = Looks(monkeypatch)
    records: list[dict] = []

    def after_some_looks(step: steps.Step, look: str) -> None:
        if step.name == "disk-work" and look == "working":
            if (state / "check.json").exists():
                records.append(check_file(state))
            if len(looks.seen) >= 6:
                finish.set()  # it has been seen working six times, and then it is done

    looks.on_look = after_some_looks

    async def works(**_kwargs):
        order.append("reclaim")
        finish.wait(30)
        order.append("reclaimed")
        return SimpleNamespace(success=True, data={"still_low": []})

    async def collect():
        order.append("collect")
        return SimpleNamespace(success=True, data={"added": 0})

    monkeypatch.setattr(reclaim, "disk_reclaim", works)
    monkeypatch.setattr(usage, "skill_usage_collect", collect)
    assert run(setup.disk_run(force=True, own_process=True))["ran"] is True
    assert order == ["reclaim", "reclaimed", "collect"]  # the collection waited for it
    before = check_file(state)["disk_work"]
    assert before["ok"] is True
    finish.clear()
    looks.seen.clear()
    records.clear()
    assert run(setup.disk_run(force=True, own_process=True))["ran"] is True
    # while it worked nothing was written of it: working is no outcome
    assert records and all(record["disk_work"] == before for record in records)


def test_a_step_that_was_left_starts_nothing_more(
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    alive,
) -> None:
    import botcore.commands.disk.reclaim as reclaim
    import botcore.commands.skill_usage as usage

    release, told = threading.Event(), threading.Event()
    begun: list[str] = []
    looks = Looks(monkeypatch)

    async def waits_then_would_work(**_kwargs):
        steps.doing("reading", "/Volumes/Shed")
        looks.held = {"disk-work"}
        release.wait(30)
        try:  # the owner answers, after the run has gone on without this step
            steps.doing("removing", "/Volumes/Shed/worktrees/a/dist")
        except steps.Left:
            told.set()
            raise
        begun.append("removing")
        return SimpleNamespace(success=True, data={"still_low": []})

    async def collect_as_the_owner_answers():
        release.set()
        assert told.wait(20)
        return SimpleNamespace(success=True, data={"added": 0})

    monkeypatch.setattr(reclaim, "disk_reclaim", waits_then_would_work)
    monkeypatch.setattr(usage, "skill_usage_collect", collect_as_the_owner_answers)
    result = asyncio.run(setup.disk_run(force=True, own_process=True))
    assert begun == [] and not alive("disk-work")  # it stopped at its next word
    # the log holds where it was when it was left, though it has ended since
    assert ", in waits_then_would_work\n" in capsys.readouterr().err
    # and it is recorded as it was left, not as the stop it was told to make
    assert result.error.code == "DISK_RUN_STALLED" and "/Volumes/Shed" in result.error.message
    work = check_file(state)["disk_work"]
    assert work["waiting_on"] == {"what": "reading", "path": "/Volumes/Shed"}
    assert "Left" not in work["error"] and "Left" not in result.error.message


def test_a_collection_that_reports_progress_finishes_past_usage_seconds(
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """lushly-dev/afd#2160: a collection that keeps reporting progress (e.g. reading a multi-GB
    T3 store on a busy machine) runs past USAGE_SECONDS until it finishes instead of being cut
    short by a flat wall-clock timeout."""
    import botcore.commands.disk.reclaim as reclaim
    import botcore.commands.skill_usage as usage

    async def fake_reclaim(**_kwargs):
        return SimpleNamespace(success=True, data={"still_low": []})

    ticks = 0

    async def slow_but_working():
        nonlocal ticks
        # Total ~0.40s, well past USAGE_SECONDS=0.25, speaking every 0.04s.
        for _ in range(10):
            steps.doing("reading T3 Code's store", "/stores/t3.sqlite")
            ticks += 1
            time.sleep(0.04)
        return SimpleNamespace(success=True, data={"added": 7})

    monkeypatch.setattr(reclaim, "disk_reclaim", fake_reclaim)
    monkeypatch.setattr(usage, "skill_usage_collect", slow_but_working)
    monkeypatch.setattr(setup, "USAGE_SECONDS", 0.25)
    found = run(setup.disk_run(force=True, own_process=True))["skill_usage"]
    assert ticks == 10
    assert found["ok"] is True and found["added"] == 7
    assert check_file(state)["skill_usage"] == found


def test_a_collection_that_stops_making_progress_is_left_and_writes_nothing_more(
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """lushly-dev/afd#2160: a collection that goes quiet for USAGE_SECONDS (truly waiting) is
    left, recorded with what it was waiting on, and stopped at its next word."""
    import botcore.commands.disk.reclaim as reclaim
    import botcore.commands.skill_usage as usage

    release, told = threading.Event(), threading.Event()
    wrote: list[str] = []
    looks = Looks(monkeypatch)

    async def fake_reclaim(**_kwargs):
        return SimpleNamespace(success=True, data={"still_low": []})

    async def stalled():
        steps.doing("reading T3 Code's store", "/stores/t3.sqlite")
        looks.held = {"skill-usage-collect"}
        release.wait(30)
        try:
            steps.doing("writing its record")
        except steps.Left:
            told.set()
            raise
        wrote.append("record")
        return SimpleNamespace(success=True, data={"added": 0})

    monkeypatch.setattr(reclaim, "disk_reclaim", fake_reclaim)
    monkeypatch.setattr(usage, "skill_usage_collect", stalled)
    monkeypatch.setattr(setup, "USAGE_SECONDS", 300)
    found = run(setup.disk_run(force=True, own_process=True))["skill_usage"]
    assert found["ok"] is False
    assert found["error"] == (
        "it made no progress for 300 seconds: it was reading T3 Code's store /stores/t3.sqlite"
    )
    assert check_file(state)["skill_usage"] == found  # what was returned is what was kept
    release.set()
    assert told.wait(20) and wrote == []  # left, it writes nothing more


def test_in_a_process_that_lives_on_nothing_is_left_running(
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
    alive,
) -> None:
    import botcore.commands.disk.reclaim as reclaim
    import botcore.commands.skill_usage as usage

    release = threading.Event()
    looks = Looks(monkeypatch)

    async def waits(**_kwargs):
        steps.doing("reading", "/Volumes/Shed")
        looks.held = {"disk-work"}
        release.wait(30)
        steps.doing("removing", "/Volumes/Shed/build")  # it was not left: it goes on
        return SimpleNamespace(success=True, data={"still_low": []})

    async def waits_too():
        steps.doing("reading T3 Code's store", "/stores/t3.sqlite")
        looks.held.add("skill-usage-collect")
        release.wait(30)
        return SimpleNamespace(success=True, data={"added": 1})

    monkeypatch.setattr(reclaim, "disk_reclaim", waits)
    monkeypatch.setattr(usage, "skill_usage_collect", waits_too)
    monkeypatch.setattr(setup, "USAGE_SECONDS", 300)
    returned: list = []
    call = threading.Thread(target=lambda: returned.append(asyncio.run(setup.disk_run(force=True))))
    call.start()
    until = time.monotonic() + 20
    while time.monotonic() < until and not (
        (state / "check.json").exists() and "skill_usage" in check_file(state)
    ):
        time.sleep(0.01)
    check = check_file(state)  # what they wait for is on record, as in the scheduler's run
    assert check["disk_work"]["waiting_on"]["path"] == "/Volumes/Shed"
    assert check["skill_usage"]["ok"] is False
    assert call.is_alive() and not returned  # and the call has not come back without them
    release.set()
    call.join(20)
    assert returned and returned[0].success and returned[0].data["skill_usage"]["added"] == 1
    assert not alive("disk-work") and not alive("skill-usage-collect")
    check = check_file(state)
    assert check["disk_work"]["ok"] is True and check["skill_usage"]["ok"] is True

    # disk work that is working again when the record is written has no outcome yet: what
    # is on record of it stays, and nothing fails
    release.clear()
    looks.held = set()
    finish = threading.Event()

    async def waits_then_works(**_kwargs):
        steps.doing("reading", "/Volumes/Shed")
        looks.held = {"disk-work"}
        release.wait(30)
        steps.doing("removing", "/Volumes/Shed/build")
        finish.wait(30)
        return SimpleNamespace(success=True, data={"still_low": []})

    async def collect_as_the_owner_answers():
        looks.held = set()
        release.set()
        return SimpleNamespace(success=True, data={"added": 4})

    monkeypatch.setattr(reclaim, "disk_reclaim", waits_then_works)
    monkeypatch.setattr(usage, "skill_usage_collect", collect_as_the_owner_answers)
    monkeypatch.setattr(setup, "USAGE_SECONDS", 300)
    returned.clear()
    call = threading.Thread(target=lambda: returned.append(asyncio.run(setup.disk_run(force=True))))
    call.start()
    until = time.monotonic() + 20
    while time.monotonic() < until and check_file(state)["skill_usage"].get("added") != 4:
        time.sleep(0.01)
    check = check_file(state)
    assert check["skill_usage"]["added"] == 4
    assert check["disk_work"]["waiting_on"]["path"] == "/Volumes/Shed"  # as it last was
    assert call.is_alive() and not returned
    finish.set()
    call.join(20)
    assert returned and returned[0].success and check_file(state)["disk_work"]["ok"] is True


def test_a_call_that_is_cancelled_tells_its_steps_to_stop(
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
    alive,
) -> None:
    import botcore.commands.disk.reclaim as reclaim

    Looks(monkeypatch)
    working, stopped = threading.Event(), threading.Event()
    removed: list[int] = []

    async def works(**_kwargs):
        try:
            for number in range(100000):
                steps.doing("removing", f"/trees/{number}")
                removed.append(number)
                working.set()
                time.sleep(0.001)
        except steps.Left:
            stopped.set()
            raise
        return SimpleNamespace(success=True, data={"still_low": []})

    monkeypatch.setattr(reclaim, "disk_reclaim", works)

    async def cancelled() -> None:
        task = asyncio.ensure_future(setup.disk_run(force=True))
        while not working.is_set():
            await asyncio.sleep(0.01)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(cancelled())  # in a process that lives on: it waits for those that can stop
    assert stopped.is_set() and not alive("disk-work")
    count = len(removed)
    time.sleep(0.05)
    assert len(removed) == count  # nothing more was begun after the call came back


def test_the_jobs_own_files_cannot_hold_the_scheduled_run(
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
    at_once,
) -> None:
    import botcore.commands.disk.reclaim as reclaim

    release = threading.Event()

    async def fake_reclaim(**_kwargs):
        return SimpleNamespace(success=True, data={"still_low": []})

    monkeypatch.setattr(reclaim, "disk_reclaim", fake_reclaim)
    load = setup.load_machine_settings

    def settings_on_a_drive_that_is_away():
        at_once("STATE_SECONDS")
        release.wait(30)
        return load()

    monkeypatch.setattr(setup, "STATE_SECONDS", 30)
    monkeypatch.setattr(setup, "load_machine_settings", settings_on_a_drive_that_is_away)
    result = asyncio.run(setup.disk_run(own_process=True))
    assert result.error.code == "DISK_STATE_UNANSWERED"
    assert str(repo["settings"]) in result.error.message
    monkeypatch.setattr(setup, "load_machine_settings", load)
    monkeypatch.setattr(setup, "STATE_SECONDS", 30)

    update = setup._update_check
    writers: list[threading.Thread] = []

    def state_on_a_drive_that_is_away(change) -> None:
        if threading.current_thread().name == "job-files":  # the run's own record
            writers.append(threading.current_thread())
            at_once("STATE_SECONDS")
            release.wait(30)
        update(change)

    monkeypatch.setattr(setup, "_update_check", state_on_a_drive_that_is_away)
    result = asyncio.run(setup.disk_run(force=True, own_process=True))
    assert result.error.code == "DISK_STATE_UNANSWERED" and "check.json" in result.error.message
    release.set()
    for writer in writers:
        writer.join(20)
    assert writers and not any(writer.is_alive() for writer in writers)
    monkeypatch.setattr(setup, "_update_check", update)

    # a state file that cannot be written (a full disk) is said, and stops nothing
    monkeypatch.setattr(setup, "STATE_SECONDS", 30)
    (state / "check.json").unlink()
    (state / "check.json").mkdir()
    for own in (True, False):
        result = asyncio.run(setup.disk_run(force=True, own_process=own))
        assert result.error.code == "DISK_STATE_UNANSWERED"
        assert "The run's state was not written" in result.error.message


def test_every_run_on_macos_reads_the_folders_it_will_need_before_anything_else(
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    import botcore.commands.disk.reclaim as reclaim

    aged, extra = tmp_path / "cache", tmp_path / "elsewhere"
    aged.mkdir()
    extra.mkdir()
    before = repo["settings"].read_text(encoding="utf-8")
    repo["settings"].write_text(
        f"worktree_roots = [{json.dumps(str(extra))}]\n{before}"
        f"\n[[volume]]\nmount = {json.dumps(str(tmp_path))}\n"
        f"\n[[aged]]\npath = {json.dumps(str(aged) + '/*')}\nmax_age_days = 7\n",
        encoding="utf-8",
    )
    settings = load_machine_settings()[0]
    folders = [str(folder) for folder in setup.job_folders(settings)]
    wanted = [
        str(tmp_path),
        str(repo["main"]),
        str(repo["old"]),
        str(repo["fresh"]),
        str(extra),
        str(aged),
    ]
    at = [folders.index(folder) for folder in wanted]  # volumes, worktrees, then the rest
    assert at[0] < at[1] < min(at[2:4]) and max(at[2:4]) < min(at[4:])
    assert len(set(folders)) == len(folders)

    # a place is named before anything reads it: a read that waits is of the folder named
    listed: list[Path] = []
    list_worktrees = setup.list_worktrees
    yielded: list[str] = []
    when: dict[str, object] = {}
    t3_settings = tmp_path / "t3-settings.json"
    t3_settings.write_text("{}", encoding="utf-8")

    def cargo(_settings):  # Cargo's settings are read from every worktree
        when.setdefault("cargo", list(yielded))  # the first time it is asked
        return []

    with monkeypatch.context() as patch:
        patch.setattr(
            setup, "list_worktrees", lambda path: listed.append(path) or list_worktrees(path)
        )
        named = setup.job_folders(settings)
        assert [str(next(named)), str(next(named))] == wanted[:2] and listed == []
        assert str(next(named)) in wanted[2:4] and listed == [repo["main"]]
        patch.setenv("BOTCORE_DISK_T3_SETTINGS", str(t3_settings))
        patch.setattr(setup, "cargo_roots", cargo)
        said: list[tuple[str, str]] = []
        patch.setattr(steps, "SAID", said)
        for folder in setup.job_folders(settings):
            yielded.append(str(folder))
        assert ("reading", str(t3_settings)) in said  # T3 Code's settings, where they are read
    assert set(wanted[:4]) <= set(when["cargo"])

    async def fake_reclaim(**_kwargs):
        now = setup.datetime.now(setup.UTC).isoformat(timespec="seconds")
        state.mkdir(parents=True, exist_ok=True)
        (state / "status.json").write_text(json.dumps({"last_apply": {"at": now, "ok": True}}))
        return SimpleNamespace(success=True, data={"still_low": []})

    monkeypatch.setattr(reclaim, "disk_reclaim", fake_reclaim)
    read: list[str] = []
    release = threading.Event()
    peek = setup._peek
    looks = Looks(monkeypatch)

    def held(folder):
        read.append(str(folder))
        if str(folder) == str(repo["old"]):
            looks.held = {"disk-work"}
            release.wait(30)  # the system wants the owner's answer before this one is read
        return peek(folder)

    assert run(setup.disk_run())["ran"] is True
    monkeypatch.setattr(setup, "_peek", held)
    assert run(setup.disk_run())["ran"] is False and read == []  # not on other systems
    monkeypatch.setattr(setup, "REACH", True)
    # a run that has nothing to reclaim reads them all the same: the question comes up in
    # the first run, with the owner there, and not a day later
    result = asyncio.run(setup.disk_run(own_process=True))
    assert read[0] == str(tmp_path) and read[-1] == str(repo["old"]) and str(aged) not in read
    assert result.error.code == "DISK_RUN_STALLED" and str(repo["old"]) in result.error.message
    work = check_file(state)["disk_work"]
    assert work["waiting_on"] == {"what": "reading", "path": str(repo["old"])}
    release.set()
    looks.held = set()
    read.clear()

    def refused(folder):
        read.append(str(folder))
        raise PermissionError(13, "Operation not permitted")

    monkeypatch.setattr(setup, "_peek", refused)  # refused is an answer: the run goes on
    assert run(setup.disk_run(own_process=True))["ran"] is False and set(wanted[:4]) <= set(read)
    assert check_file(state)["disk_work"]["ok"] is True  # and it clears what it waited for


def test_how_the_disk_work_ended_is_what_the_status_says(
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
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
    logged = capsys.readouterr().err  # where it was raised, for the job's log
    assert "Traceback" in logged and "RuntimeError: the volume fell over" in logged
    assert ", in raises" in logged and "raise RuntimeError" not in logged  # no source is read
    check = check_file(state)
    assert check["skill_usage"]["added"] == 2 and check["disk_work"]["ok"] is False
    assert "waiting_on" not in check["disk_work"]
    status = run(setup.disk_status())
    assert any("disk work failed: RuntimeError" in found for found in status["warnings"])
    assert not any("disk work" in found for found in status["problems"])  # it came back

    async def refused(**_kwargs):  # a reclaim that came back with an error, as a held lock does
        return SimpleNamespace(
            success=False,
            data=None,
            error=SimpleNamespace(
                code="DISK_RUN_IN_PROGRESS", message="another disk run holds the lock"
            ),
        )

    monkeypatch.setattr(reclaim, "disk_reclaim", refused)
    result = asyncio.run(setup.disk_run(force=True))
    assert result.error.code == "DISK_RUN_IN_PROGRESS"
    work = check_file(state)["disk_work"]
    assert work["ok"] is False and work["error"] == "another disk run holds the lock"
    assert any("holds the lock" in found for found in run(setup.disk_status())["warnings"])

    def reclaim_with(failures: list, ok: bool):
        async def fake(**_kwargs):
            now = setup.datetime.now(setup.UTC).isoformat(timespec="seconds")
            (state / "status.json").write_text(json.dumps({"last_apply": {"at": now, "ok": ok}}))
            return SimpleNamespace(success=True, data={"still_low": [], "failures": failures})

        return fake

    monkeypatch.setattr(reclaim, "disk_reclaim", reclaim_with([], True))
    assert run(setup.disk_run(force=True))["reclaim_ok"] is True
    worked = check_file(state)["disk_work"]
    assert worked["ok"] is True and worked["ran"] is True
    monkeypatch.setattr(reclaim, "disk_reclaim", reclaim_with([{}, {}], False))
    data = run(setup.disk_run(force=True))  # it came back, and could not do everything
    assert data["reclaim_ok"] is False and data["failures"] == 2
    work = check_file(state)["disk_work"]
    assert work["ok"] is False and work["ok_at"] == worked["ok_at"]  # not a time it worked
    assert work["error"] == "the reclaim had 2 failures: read its receipt"
    status = run(setup.disk_status())  # told once, by the receipt
    assert "the last run had failures: read its receipt" in status["problems"]
    assert not any("disk work" in found for found in status["warnings"])
    assert run(setup.disk_run())["ran"] is False  # an hour with nothing due knows no better
    assert check_file(state)["disk_work"] == work
    monkeypatch.setattr(reclaim, "disk_reclaim", reclaim_with([], True))
    run(setup.disk_run(force=True))  # another reclaim does
    assert check_file(state)["disk_work"]["ok"] is True


def test_a_shared_folder_that_does_not_answer_is_told_apart_from_a_collection_that_failed(
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    at_once,
) -> None:
    import botcore.commands.disk.reclaim as reclaim
    import botcore.commands.skill_usage as usage
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
    publish, collecting = collect.publish, usage.skill_usage_collect
    release, ended = threading.Event(), threading.Event()

    def held_by_the_system(*args):
        at_once("USAGE_SECONDS")
        release.wait(30)  # as a cloud drive's folder is until the owner allows the read
        return publish(*args)

    async def collection():
        try:
            return await collecting()
        finally:
            ended.set()

    monkeypatch.setattr(collect, "publish", held_by_the_system)
    monkeypatch.setattr(usage, "skill_usage_collect", collection)
    monkeypatch.setattr(setup, "consent_hint", lambda path: f"allow it for {path}")
    monkeypatch.setattr(setup, "USAGE_SECONDS", 300)
    found = run(setup.disk_run(force=True, own_process=True))["skill_usage"]
    assert found["ok"] is False
    assert found["error"].startswith("this machine's record was collected, but the shared folder")
    assert str(shared) in found["error"] and f"allow it for {shared}" in found["error"]
    assert len(usage_store.load_events(usage_store.state_dir())[0]) == 1  # collected here
    assert any(str(shared) in line for line in run(setup.disk_status())["warnings"])
    release.set()  # the owner answers; the collection that was left shares nothing now
    assert ended.wait(20) and not (shared / "bench").exists()

    # this machine's own record not answering is not the shared folder not answering
    monkeypatch.setattr(collect, "publish", publish)
    monkeypatch.setattr(setup, "USAGE_SECONDS", 300)
    release.clear()
    ended.clear()
    load_state = usage_store.load_state

    def own_record_held(directory):
        at_once("USAGE_SECONDS")
        release.wait(30)
        return load_state(directory)

    monkeypatch.setattr(usage_store, "load_state", own_record_held)
    found = run(setup.disk_run(force=True, own_process=True))["skill_usage"]
    assert "this machine's record in" in found["error"] and "shared folder" not in found["error"]
    assert str(usage_store.state_dir()) in found["error"]
    release.set()
    assert ended.wait(20)
    monkeypatch.setattr(usage_store, "load_state", load_state)

    # and back at the shared folder, after its own record was read, it is the shared folder
    monkeypatch.setattr(setup, "USAGE_SECONDS", 300)
    release.clear()
    ended.clear()
    load_json = usage_store._load_json

    def shared_copy_held(path):
        if str(path).startswith(str(shared)):
            at_once("USAGE_SECONDS")
            release.wait(30)
        return load_json(path)

    monkeypatch.setattr(usage_store, "_load_json", shared_copy_held)
    found = run(setup.disk_run(force=True, own_process=True))["skill_usage"]
    assert found["error"].startswith("this machine's record was collected, but the shared folder")
    release.set()
    assert ended.wait(20)
    monkeypatch.setattr(usage_store, "_load_json", load_json)

    monkeypatch.setattr(setup, "USAGE_SECONDS", 300)
    found = run(setup.disk_run(force=True, own_process=True))["skill_usage"]  # the next hour
    assert found["ok"] is True and (shared / "bench" / "state.json").exists()


def test_the_status_does_not_wait_at_what_it_is_asked_about(
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
    at_once,
    alive,
) -> None:
    import botcore.commands.disk.reclaim as reclaim

    async def fake_reclaim(**_kwargs):
        return SimpleNamespace(success=True, data={"still_low": []})

    monkeypatch.setattr(reclaim, "disk_reclaim", fake_reclaim)
    installed = SimpleNamespace(
        installed=True, where="test", detail=None, as_dict=lambda: {"installed": True}
    )
    monkeypatch.setattr(schedule, "current", lambda: installed)
    # a job that is installed and has never checked in
    assert any(
        "no scheduled check is recorded yet" in found
        for found in run(setup.disk_status())["warnings"]
    )
    run(setup.disk_run(force=True))
    status = run(setup.disk_status())
    assert (
        not any("scheduled check" in found or "checked in" in found for found in status["warnings"])
        and status["volumes"] == []
    )
    check = check_file(state)
    check["last_check"] = (setup.datetime.now(setup.UTC) - timedelta(hours=4)).isoformat()
    check["disk_work"] = {
        "ok": False,
        "error": "it has been reading /Volumes/Shed",
        "waiting_on": {"what": "reading", "path": "/Volumes/Shed"},
    }
    (state / "check.json").write_text(json.dumps(check))
    counted = {
        "at": setup.datetime.now(setup.UTC).isoformat(),
        "count": 30,
        "checkout": str(repo["main"]),
        "warning": "30 worktrees idle 3 days or more",
    }
    file = state / "status.json"
    saved = json.loads(file.read_text()) if file.exists() else {}
    saved["worktree_warnings"] = {"repos": {str(repo["main"]): counted}}
    file.write_text(json.dumps(saved))
    warnings = run(setup.disk_status())["warnings"]
    assert "the scheduled job last checked in 4 hours ago" in warnings
    assert "30 worktrees idle 3 days or more" in warnings
    installed.installed = False  # a job that is not installed is said in its own words
    status = run(setup.disk_status())
    assert not any("checked in" in found for found in status["warnings"])
    assert "the schedule is not installed: run disk-setup" in status["problems"]

    release = threading.Event()
    live = setup._live

    def waits(settings, status):
        steps.doing("checking the volume", "/Volumes/Shed")
        at_once("STATUS_SECONDS")
        release.wait(30)
        return live(settings, status)

    monkeypatch.setattr(setup, "_live", waits)
    monkeypatch.setattr(setup, "STATUS_SECONDS", 20)
    monkeypatch.setattr(setup, "consent_hint", lambda path: f"allow it for {path}")
    status = run(setup.disk_status())
    assert status["healthy"] is False and status["schedule"] is None and status["volumes"] == []
    assert "did not answer in 0 seconds" in status["problems"][0]
    assert "checking the volume /Volumes/Shed" in status["problems"][0]
    assert "allow it for /Volumes/Shed" in status["problems"][0]
    # what the job wrote is still told, and nothing is said of a schedule that was not read
    assert any("disk work is waiting" in found for found in status["problems"])
    assert "the schedule is not installed: run disk-setup" not in status["problems"]
    assert "30 worktrees idle 3 days or more" in status["warnings"]  # what a reclaim counted
    # asked again, it waits for the read it has and starts no other
    wait = setup._wait

    async def no_longer_for_the_machine(waited, until) -> None:
        if waited[0].name == "disk-status":
            at_once("STATUS_SECONDS")  # (its own files were read within the limit)
        await wait(waited, until)

    monkeypatch.setattr(setup, "STATUS_SECONDS", 20)
    monkeypatch.setattr(setup, "_wait", no_longer_for_the_machine)
    assert "did not answer" in run(setup.disk_status())["problems"][0]
    assert alive("disk-status") == 1

    async def comes_back_meanwhile(waited, until) -> None:
        if waited[0].name == "disk-status":
            release.set()  # once this call has taken up the read it had, the read comes back
        await wait(waited, until)

    monkeypatch.setattr(setup, "_wait", comes_back_meanwhile)
    monkeypatch.setattr(setup, "STATUS_SECONDS", 20)
    status = run(setup.disk_status())  # the same read answers the call that waited for it
    monkeypatch.setattr(setup, "_wait", wait)
    assert status["schedule"] == {"installed": True} and alive("disk-status") == 0

    def fails(settings, status):
        raise RuntimeError("the scheduler fell over")

    monkeypatch.setattr(setup, "_live", fails)
    with pytest.raises(RuntimeError, match="the scheduler fell over"):
        asyncio.run(setup.disk_status())


def test_the_status_does_not_wait_at_its_own_files(
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
    at_once,
) -> None:
    release = threading.Event()
    saved_files = setup._saved

    def files_on_a_drive_that_is_away():
        steps.doing("reading", state / "status.json")
        at_once("STATUS_SECONDS")
        release.wait(30)
        return saved_files()

    monkeypatch.setattr(setup, "STATUS_SECONDS", 20)
    monkeypatch.setattr(setup, "_saved", files_on_a_drive_that_is_away)
    result = asyncio.run(setup.disk_status())
    release.set()
    assert result.error.code == "DISK_STATE_UNANSWERED"
    assert f"reading {state / 'status.json'}" in result.error.message
    monkeypatch.setattr(setup, "_saved", saved_files)
    monkeypatch.setattr(setup, "STATUS_SECONDS", 20)
    repo["settings"].write_text("repos = 3\n", encoding="utf-8")  # as it was before: said plainly
    assert asyncio.run(setup.disk_status()).error.code == "DISK_SETTINGS_INVALID"


def test_check_json_keeps_every_writers_update(
    state: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    writers = [
        threading.Thread(target=setup._write_check, args=({f"thread{n}": n},)) for n in range(12)
    ]
    for writer in writers:
        writer.start()
    for writer in writers:
        writer.join()
    assert {f"thread{n}" for n in range(12)} <= set(check_file(state))

    # two runs at once, one started by hand while the scheduler's is going
    script = (
        "import sys\n"
        "from botcore.commands.disk import setup\n"
        "for n in range(40):\n"
        "    setup._update_check(lambda data: data.update({f'{sys.argv[1]}{n}': n}))\n"
    )
    runs = [subprocess.Popen([sys.executable, "-c", script, name]) for name in ("a", "b")]
    assert [run_.wait(120) for run_ in runs] == [0, 0]
    kept = set(check_file(state))
    assert {f"a{n}" for n in range(40)} | {f"b{n}" for n in range(40)} <= kept

    held, path = threading.Event(), state / "check.lock"
    release = threading.Event()

    def holds() -> None:
        with lock.waited_lock(path, 5) as mine:
            assert mine
            held.set()
            release.wait(30)

    holder = threading.Thread(target=holds)
    holder.start()
    assert held.wait(10)
    with lock.waited_lock(path, 0.1) as mine:  # a writer never waits long for another
        assert mine is False
    # and it never writes without the lock: that is how another writer's update is lost
    monkeypatch.setattr(setup, "CHECK_LOCK_SECONDS", 0.1)
    before = (state / "check.json").read_text()
    with pytest.raises(setup.StateBusy):
        setup._update_check(lambda data: data.update({"late": 1}))
    setup._write_check({"late": 2})  # the disk work's own note: not written, and no failure
    assert (state / "check.json").read_text() == before
    release.set()
    holder.join()
    with lock.waited_lock(path, 5) as mine:
        assert mine is True
    setup._write_check({"late": 3})
    assert check_file(state)["late"] == 3 and "thread0" in check_file(state)

    # nor over a file it could not read: only a missing one starts empty
    (state / "check.json").unlink()
    (state / "check.json").mkdir()
    with pytest.raises(OSError, match="check.json"):
        setup._update_check(lambda data: data.update({"over": 1}))
    assert (state / "check.json").is_dir()
    (state / "check.json").rmdir()
    (state / "check.json").write_text("not json")  # which holds nothing to keep
    setup._update_check(lambda data: data.update({"fresh": 1}))
    assert check_file(state)["fresh"] == 1


@pytest.mark.skipif(os.name == "nt", reason="these are macOS paths")
@pytest.mark.parametrize(
    ("path", "said"),
    [
        ("/Volumes/Shed/worktrees/a", "an external or network volume"),
        ("~/Library/CloudStorage/Drive-someone/My Drive/usage", "a cloud drive's app manages"),
        ("~/Library/Mobile Documents/com~apple~CloudDocs/usage", "a cloud drive's app manages"),
        ("~/Documents/checkouts/a", "this folder"),
    ],
)
def test_what_to_do_about_a_read_macos_holds(path: str, said: str) -> None:
    hint = steps.consent_hint(str(Path(path).expanduser()), "darwin")
    assert said in hint and "Full Disk Access" in hint and steps.PROGRAM in hint


@pytest.mark.skipif(os.name == "nt", reason="these are macOS paths")
@pytest.mark.parametrize(
    "path", ["~/dev/checkouts/a", "~/Documentsx", "/Volumesx/a", "~/Shared/skill-usage"]
)
def test_a_path_that_may_lead_there_by_a_link_gets_the_short_hint(path: str) -> None:
    hint = steps.consent_hint(str(Path(path).expanduser()), "darwin")
    assert hint.startswith("If macOS is asking") and "Full Disk Access" not in hint


def test_no_hint_where_macos_is_not_asking() -> None:
    assert steps.consent_hint("", "darwin") is None
    for system in ("linux", "win32"):
        assert steps.consent_hint("/Volumes/Shed/worktrees/a", system) is None


class Clock:
    """Time for the steps module, moved by the test."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.at = 1000.0
        monkeypatch.setattr(steps, "time", SimpleNamespace(monotonic=lambda: self.at))


def test_a_step_keeps_what_it_did_and_says_how_long_it_has_been_silent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clock = Clock(monkeypatch)
    said, go = threading.Event(), threading.Event()

    def pause() -> None:  # tell the test, then wait for it
        go.clear()
        said.set()
        go.wait(30)

    def work() -> int:
        with steps.command("pruning the uv cache", allow=30):
            pause()
        pause()
        steps.doing("reading", "/trees/a")
        pause()
        return 7

    def next_word() -> None:
        said.clear()
        go.set()
        assert said.wait(10)

    step = steps.Step("test", work)
    assert said.wait(10)
    clock.at += 20
    assert step.now() == ("pruning the uv cache", "", 20.0) and step.quiet() == 0
    assert step.seen() == ("pruning the uv cache", "", 20.0, 0.0, 2)
    where = step.where()  # the stack, and no line of source: reading one opens a file
    assert ", in pause\n" in where and "go.wait" not in where
    clock.at += 25  # past what the command was allowed
    assert step.quiet() == 15.0
    next_word()  # the command is back: its allowance does not outlive it
    assert step.now()[:2] == ("working after pruning the uv cache", "") and step.quiet() == 0
    clock.at += 4
    assert step.quiet() == 4.0  # a read that waits just after does not pass for the command
    next_word()
    clock.at += 720
    assert step.seen()[:4] == ("reading", "/trees/a", 720.0, 720.0)
    assert steps.describe(step.now()) == "reading /trees/a for 12 minutes"
    assert steps.describe(("reading", "/trees/a", 12.0)) == "reading /trees/a for 12 seconds"
    assert steps.describe(("starting", "", 3.0)) == "starting for 3 seconds"
    assert steps.describe(("reading", "/two  spaces", 3.0)) == "reading /two  spaces for 3 seconds"

    # what another thread says is not this step's: a word belongs to the step that said it
    steps.doing("reading", "/elsewhere")
    assert step.now()[:2] == ("reading", "/trees/a")
    go.set()
    assert step.wait(5) and step.outcome == {"result": 7}
    assert step.now() is None and step.quiet() == 0 and step.seen() is None

    def fails() -> None:
        try:
            with steps.command("running git in", "/repo", allow=30):
                raise OSError("no git")
        finally:
            pause()

    said.clear()
    failed = steps.Step("test", fails)
    assert said.wait(10)
    clock.at += 9
    assert failed.quiet() == 9.0  # the allowance ends also when the command failed
    go.set()
    assert failed.wait(5) and isinstance(failed.outcome["raised"], OSError)
    text = steps.raised_text(failed.outcome["raised"])
    assert text.startswith("Traceback") and text.endswith("OSError: no git\n")
    assert ", in fails\n" in text and "raise OSError" not in text

    def interrupted() -> None:
        raise KeyboardInterrupt  # whatever a step raises is kept, never raised in the job

    other = steps.Step("test", interrupted)
    assert other.wait(5) and isinstance(other.outcome["raised"], KeyboardInterrupt)


def test_a_step_that_is_left_stops_at_its_next_word(monkeypatch: pytest.MonkeyPatch) -> None:
    said, go = threading.Event(), threading.Event()
    begun: list[str] = []

    def work() -> None:
        for name in steps.each("removing", "/trees/a", ["one", "two", "three"]):
            begun.append(name)
            go.clear()
            said.set()
            go.wait(30)

    step = steps.Step("test", work)
    assert said.wait(10) and begun == ["one"]
    step.leave()
    go.set()
    assert step.wait(5) and begun == ["one"]  # the next was not begun
    assert isinstance(step.outcome["raised"], steps.Left)
    assert not isinstance(step.outcome["raised"], Exception)  # no handler takes it for a failure
    # being left belongs to the step, not to its thread's number, which the next thread gets
    numbers = set()
    for _ in range(50):
        other = steps.Step("test", lambda: steps.doing("reading", "/trees/b") or "went on")
        assert other.wait(5) and other.outcome == {"result": "went on"}
        numbers.add(other._thread.ident)  # noqa: SLF001
        other.leave()  # leaving one that is done tells no later thread anything
    steps.doing("reading", "/trees/a")  # nor is a thread that runs no step ever told

    listed = list(steps.each("reading", "/trees/a", iter(["one", "two"])))
    assert listed == ["one", "two"]

    # one that is left before its first word is kept as a step that was left, like any other
    doing, starting, release = steps.doing, threading.Event(), threading.Event()

    def held_before_its_first_word(what, path="", allow=0.0):
        if what == "starting":
            starting.set()
            release.wait(30)
        doing(what, path, allow)

    monkeypatch.setattr(steps, "doing", held_before_its_first_word)
    early = steps.Step("test", lambda: begun.append("never"))
    assert starting.wait(10)
    early.leave()
    release.set()
    assert early.wait(5) and isinstance(early.outcome.get("raised"), steps.Left)
    assert begun == ["one"]


def test_a_step_is_waiting_once_it_has_said_nothing_for_long_enough(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clock = Clock(monkeypatch)
    said, go = threading.Event(), threading.Event()

    def work() -> None:
        steps.doing("reading", "/Volumes/Shed")
        said.set()
        go.wait(30)

    step = steps.Step("test", work)
    assert said.wait(10)
    clock.at += setup.QUIET_SECONDS - 1
    quiet = setup.QUIET_SECONDS
    assert setup._look(step) == ("working", ("reading", "/Volumes/Shed", quiet - 1), 2)
    clock.at += 1
    assert setup._look(step) == ("waiting", ("reading", "/Volumes/Shed", quiet), 2)
    go.set()
    assert step.wait(5) and setup._look(step) == ("done", None, None)


def _plain(path: str) -> str:
    """A path as the walkers spell it on Windows (long_path), back in ordinary syntax:
    `\\\\?\\C:\\...` is `C:\\...`, and `\\\\?\\UNC\\server\\...` is `\\\\server\\...`."""
    if path.startswith("\\\\?\\UNC\\"):
        return "\\\\" + path[len("\\\\?\\UNC\\") :]
    return path.removeprefix("\\\\?\\")


@pytest.mark.parametrize("handles", [True, False], ids=["by-handle", "by-path"])
def test_the_disk_work_says_what_it_does_as_it_goes(
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
    handles: bool,
) -> None:
    """A reclaim that stopped saying what it does would pass for one that waits, and be left
    behind while it works. Both walkers say it: Windows has only the one by path."""
    import botcore.commands.disk.reclaim as reclaim
    import botcore.commands.disk.remove as remove

    if handles and not remove.HANDLES:
        pytest.skip("this system has no walk by folder handle")
    monkeypatch.setattr(remove, "HANDLES", handles)

    age_worktree(repo["main"], repo["old"])  # idle long enough to be stripped
    heard: list[tuple[str, str]] = []
    monkeypatch.setattr(steps, "SAID", heard)
    result = asyncio.run(reclaim.disk_reclaim(tier=1, apply=True))
    assert result.success, result.error
    stripped = [a["target"] for a in result.data["actions"] if a["outcome"] == "done"]
    assert stripped, result.data["actions"]
    # (on Windows the walkers spell a path with the long-path prefix)
    said = [(what, _plain(path)) for what, path in heard]
    words = {what for what, _path in said}
    assert {"running git in", "checking the volume", "reading", "inspecting", "removing"} <= words
    assert {"opening", "reclaiming", "clearing", "looking at"} <= words
    for name in ("main", "old", "fresh"):  # the first read of a worktree, then its inspection
        assert ("opening", str(repo[name])) in said and ("inspecting", str(repo[name])) in said
    for target in stripped:
        file = str(Path(target) / "bundle.js")
        # the action; the folder as it is opened, as each entry of it arrives, and before it
        # goes; each file before it is looked at, and again right before it goes
        assert ("reclaiming", target) in said and ("clearing", target) in said
        assert said.count(("removing", target)) >= 2
        assert said.index(("looking at", file)) < said.index(("removing", file))
    assert any(what.startswith("working after running git in") for what in words)


def test_a_step_is_left_only_if_it_has_said_nothing_since_it_was_seen(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clock = Clock(monkeypatch)
    said, go = threading.Event(), threading.Event()
    begun: list[str] = []

    def pause() -> None:
        go.clear()
        said.set()
        go.wait(30)

    def work() -> str:
        steps.doing("reading", "/Volumes/Shed")
        pause()
        steps.doing("opening", "/Volumes/Shed")
        pause()
        with steps.command("running git in", "/repo", allow=30):
            pause()
            ref = "the ref it made"  # what the command did goes back to its caller
        begun.append(ref)
        steps.doing("removing", "/Volumes/Shed/build")
        begun.append("removing")
        return "went on"

    def next_word() -> None:
        said.clear()
        go.set()
        assert said.wait(10)

    step = steps.Step("test", work)
    assert said.wait(10)
    same_tick = step.seen()[4]
    next_word()  # spoke again within the same clock tick (Windows time.monotonic ~15.6 ms)
    assert step.leave(same_tick) is False  # still working, even without the clock advancing
    assert step.now()[:2] == ("opening", "/Volumes/Shed")
    seen_at = step.seen()[4]
    clock.at += 400
    next_word()  # it spoke again just as the job made up its mind
    assert step.leave(seen_at) is False  # so it is working, and is not left
    assert step.now()[:2] == ("running git in", "/repo")
    assert step.leave(step.seen()[4]) is True  # this time nothing was said since
    go.set()
    assert step.wait(5)
    # the command that was under way came back to its caller; the next thing was not begun
    assert begun == ["the ref it made"] and isinstance(step.outcome["raised"], steps.Left)


@pytest.mark.parametrize("handles", [True, False], ids=["by-handle", "by-path"])
def test_a_step_left_in_a_read_removes_and_shares_nothing_when_the_read_comes_back(
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    handles: bool,
) -> None:
    """A read the system holds cannot be told anything. When it comes back, the step is
    told before it does what the read was for."""
    import botcore.commands.disk.remove as remove

    if handles and not remove.HANDLES:
        pytest.skip("this system has no walk by folder handle")
    monkeypatch.setattr(remove, "HANDLES", handles)
    folder = tmp_path / "trees" / "dist"
    folder.mkdir(parents=True)
    (folder / "bundle.js").write_bytes(b"x" * 100)
    held, release = threading.Event(), threading.Event()

    class Held:  # a folder entry whose metadata the system holds
        def __init__(self, entry) -> None:
            self.name, self.path, self._entry = entry.name, entry.path, entry

        def stat(self, follow_symlinks: bool = True):
            held.set()
            release.wait(30)
            return self._entry.stat(follow_symlinks=follow_symlinks)

    if handles:  # the walk by handle reads each entry's metadata from the listing
        monkeypatch.setattr(remove, "each", lambda what, path, entries: [Held(e) for e in entries])
    else:  # the walk by path reads it again, by name, just before it decides
        lstat, bundle = os.lstat, str(folder / "bundle.js")

        def held_lstat(path, *args, **more):
            if _plain(str(path)) == bundle:
                held.set()
                release.wait(30)
            return lstat(path, *args, **more)

        monkeypatch.setattr(remove.os, "lstat", held_lstat)
    step = steps.Step("disk-work", lambda: remove.remove_inside(folder, tmp_path / "trees"))
    assert held.wait(10)
    step.leave()  # as a run that ends does, and a call that is cancelled
    release.set()
    assert step.wait(10) and isinstance(step.outcome["raised"], steps.Left)
    assert (folder / "bundle.js").exists()  # it was not removed after the step was left

    directory, shared = tmp_path / "record", tmp_path / "drive"
    directory.mkdir()
    shared.mkdir()
    usage_store.save_state(directory, {"record_id": "r1", "collected_at": stamp(1)})
    load_json = usage_store._load_json
    held.clear()
    release.clear()

    def shared_copy_held(path):
        if str(path).startswith(str(shared)):
            held.set()
            release.wait(30)
        return load_json(path)

    monkeypatch.setattr(usage_store, "_load_json", shared_copy_held)
    step = steps.Step(
        "skill-usage-collect", lambda: usage_store.publish(directory, shared, "bench")
    )
    assert held.wait(10)
    step.leave()
    release.set()
    assert step.wait(10) and isinstance(step.outcome["raised"], steps.Left)
    assert not (shared / "bench").exists()  # nothing was shared after it was left
    monkeypatch.setattr(usage_store, "_load_json", load_json)
    assert usage_store.publish(directory, shared, "bench") is True  # as it would have been


def test_every_removal_and_every_shared_write_asks_first_whether_the_step_was_left(
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    import botcore.commands.disk.remove as remove
    import botcore.commands.skill_usage.collect as collect

    held, release = threading.Event(), threading.Event()

    def left_while(work, hold) -> steps.Step:
        """Run `work` as a step, leave it while `hold` has it waiting, then let it go."""
        held.clear()
        release.clear()
        step = steps.Step("test", work)
        assert held.wait(10), hold
        step.leave()
        release.set()
        assert step.wait(10) and isinstance(step.outcome.get("raised"), steps.Left), step.outcome
        return step

    def waits(*_args, **_kwargs) -> None:
        held.set()
        release.wait(30)

    # an emptied folder is not removed
    empty = tmp_path / "trees" / "empty"
    empty.mkdir(parents=True)
    with monkeypatch.context() as patch:
        patch.setattr(remove, "each", lambda what, path, entries: waits() or list(entries))
        left_while(lambda: remove.remove_inside(empty, tmp_path / "trees"), "the listing")
    assert empty.is_dir()

    # nor is anything by the walker that goes by path (Windows)
    file, link = tmp_path / "trees" / "file", tmp_path / "trees" / "link"
    file.write_text("x")
    link.symlink_to(file)
    for path, removal in ((file, remove._unlink_path), (link, remove._remove_link_path)):
        info = os.lstat(path)
        left_while(
            lambda path=path, removal=removal, info=info: (
                steps.doing("reading", path),
                waits(),
                removal(str(path), info, remove.Removal(str(path))),
            ),
            "its metadata",
        )
        assert os.path.lexists(path)

    # a file of the shared copy is not replaced after the copy that lies there was read
    directory, shared = tmp_path / "record", tmp_path / "drive"
    directory.mkdir()
    shared.mkdir()
    usage_store.save_state(directory, {"record_id": "r1", "collected_at": stamp(1)})
    assert usage_store.publish(directory, shared, "bench") is True
    usage_store.save_state(directory, {"record_id": "r1", "collected_at": stamp(2)})
    before = (shared / "bench" / "state.json").read_bytes()
    copy_bytes = usage_store._copy_bytes
    with monkeypatch.context() as patch:
        patch.setattr(
            usage_store,
            "_copy_bytes",
            lambda path: (path.name == "state.json" and waits()) or copy_bytes(path),
        )
        left_while(lambda: usage_store.publish(directory, shared, "bench"), "the copy")
    assert (shared / "bench" / "state.json").read_bytes() == before

    # a collection left during the last thing it reads writes nothing of its record: the
    # command it was running comes back, and the record is the next thing it would begin
    built = T3Store(tmp_path / "t3.sqlite")
    built.project("p1", repo["main"])
    built.skill_tool(built.thread("main"), "plant-beds", stamp(1))
    monkeypatch.setenv(usage_store.T3_STORE_ENV, str(built.path))
    name_projects = collect._name_projects

    def projects_held(*args, **kwargs):
        named = name_projects(*args, **kwargs)
        waits()  # the last thing it reads before it writes
        return named

    with monkeypatch.context() as patch:
        patch.setattr(collect, "_name_projects", projects_held)
        left_while(lambda: asyncio.run(collect.skill_usage_collect()), "the projects")
    assert usage_store.load_events(usage_store.state_dir())[0] == []
    assert asyncio.run(collect.skill_usage_collect()).data["added"] == 1  # as it would have


def test_a_left_step_writes_no_receipt_replaces_no_copy_and_retries_no_removal(
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    import botcore.commands.disk.reclaim as reclaim
    import botcore.commands.disk.remove as remove

    held, release = threading.Event(), threading.Event()

    def waits() -> None:
        held.set()
        release.wait(30)

    def left_while(work) -> steps.Step:
        held.clear()
        release.clear()
        step = steps.Step("test", work)
        assert held.wait(10)
        step.leave()
        release.set()
        assert step.wait(10) and isinstance(step.outcome.get("raised"), steps.Left), step.outcome
        return step

    # a reclaim left while the volumes are read one last time records nothing: a receipt and
    # a status would say it ran, and put off the next one
    idle_after = reclaim._idle_after

    def read_once_more(data, run_):
        found = idle_after(data, run_)
        waits()
        return found

    with monkeypatch.context() as patch:
        patch.setattr(reclaim, "_idle_after", read_once_more)
        left_while(lambda: asyncio.run(reclaim.disk_reclaim(tier=1, apply=True)))
    assert not list(state.glob("receipts/*.json")) and not (state / "status.json").exists()
    assert asyncio.run(reclaim.disk_reclaim(tier=1, apply=True)).success  # the lock was let go

    # a file of the shared copy written beside the one it replaces does not replace it
    directory, shared = tmp_path / "record", tmp_path / "drive"
    directory.mkdir()
    shared.mkdir()
    usage_store.save_state(directory, {"record_id": "r1", "collected_at": stamp(1)})
    assert usage_store.publish(directory, shared, "bench") is True
    usage_store.save_state(directory, {"record_id": "r1", "collected_at": stamp(2)})
    before = (shared / "bench" / "state.json").read_bytes()
    write_bytes = usage_store._write_bytes
    with monkeypatch.context() as patch:
        patch.setattr(
            usage_store, "_write_bytes", lambda path, data: (write_bytes(path, data), waits())[0]
        )
        left_while(lambda: usage_store.publish(directory, shared, "bench"))
    assert (shared / "bench" / "state.json").read_bytes() == before
    stale = list((shared / "bench").glob("*.tmp"))
    assert len(stale) == 1  # what it had written beside it lies there

    # nor is what an earlier publish left lying cleared away
    leftovers = usage_store._leftovers
    with monkeypatch.context() as patch:
        patch.setattr(usage_store, "_leftovers", lambda folder: (leftovers(folder), waits())[0])
        left_while(lambda: usage_store.publish(directory, shared, "bench"))
    assert stale[0].exists()
    assert usage_store.publish(directory, shared, "bench") is True and not stale[0].exists()

    # a file that could not be removed at first is not tried again (Windows: read-only files)
    file = tmp_path / "read-only"
    file.write_text("x")
    file.chmod(0o444)
    info, mode = os.lstat(file), os.lstat(file).st_mode
    unlink = os.unlink

    def refused_after_a_wait(path, *args, **kwargs):
        if str(path) == str(file):
            waits()
            raise PermissionError(13, "Permission denied")
        return unlink(path, *args, **kwargs)

    with monkeypatch.context() as patch:
        patch.setattr(remove.os, "unlink", refused_after_a_wait)
        left_while(lambda: remove._unlink_path(str(file), info, remove.Removal(str(file))))
    assert file.exists() and os.lstat(file).st_mode == mode  # nor was its mode changed

    # nor after its mode was changed, when that is what waited
    chmod = os.chmod

    def refused(path, *args, **kwargs):
        if str(path) == str(file):
            raise PermissionError(13, "Permission denied")
        return unlink(path, *args, **kwargs)

    def mode_change_waits(path, *args, **kwargs):
        chmod(path, *args, **kwargs)
        if str(path) == str(file):
            waits()

    with monkeypatch.context() as patch:
        patch.setattr(remove.os, "unlink", refused)
        patch.setattr(remove.os, "chmod", mode_change_waits)
        left_while(lambda: remove._unlink_path(str(file), info, remove.Removal(str(file))))
    assert file.exists()


def test_disk_work_that_speaks_again_as_the_job_decides_is_not_left(
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import botcore.commands.disk.reclaim as reclaim

    first, second = threading.Event(), threading.Event()
    looks = Looks(monkeypatch)
    did: list[str] = []

    async def waits_then_works(**_kwargs):
        steps.doing("reading", "/Volumes/Shed")
        looks.held = {"disk-work"}
        first.wait(30)  # the owner answers at the moment the job looks
        steps.doing("removing", "/Volumes/Shed/build")
        looks.held = set()
        did.append("removing")
        second.wait(30)
        return SimpleNamespace(success=True, data={"still_low": []})

    def the_owner_answers(step: steps.Step, look: str) -> None:
        if step.name != "disk-work":
            return
        if look == "waiting" and looks.acted_on:
            # seen waiting by the look the run acts on, and it speaks again before the run
            # can leave it
            first.set()
            until = time.monotonic() + 10
            while time.monotonic() < until and (step.now() or ("",))[0] != "removing":
                time.sleep(0.005)
        elif did:
            second.set()

    looks.on_look = the_owner_answers
    monkeypatch.setattr(reclaim, "disk_reclaim", waits_then_works)
    data = run(setup.disk_run(force=True, own_process=True))
    assert data["ran"] is True and did == ["removing"]  # it was waited for, to its end
    assert check_file(state)["disk_work"]["ok"] is True


def test_disk_work_that_ends_just_after_it_was_seen_waiting_is_recorded_as_it_ended(
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
    alive,
) -> None:
    import botcore.commands.disk.reclaim as reclaim
    import botcore.commands.skill_usage as usage

    release = threading.Event()
    looks = Looks(monkeypatch)
    collected = threading.Event()

    async def waits(**_kwargs):
        steps.doing("reading", "/Volumes/Shed")
        looks.held = {"disk-work"}
        release.wait(30)
        return SimpleNamespace(success=True, data={"still_low": []})

    async def collect():
        collected.set()
        return SimpleNamespace(success=True, data={"added": 0})

    def ends_right_after_the_look(step: steps.Step, look: str) -> None:
        if step.name == "disk-work" and look == "waiting" and collected.is_set():
            release.set()  # seen waiting; done before the job acts on what it saw
            step.wait(10)

    looks.on_look = ends_right_after_the_look
    monkeypatch.setattr(reclaim, "disk_reclaim", waits)
    monkeypatch.setattr(usage, "skill_usage_collect", collect)
    data = run(setup.disk_run(force=True))  # in a process that lives on
    assert data["ran"] is True
    assert check_file(state)["disk_work"]["ok"] is True and not alive("disk-work")


def test_the_status_of_a_machine_that_does_not_answer_reads_no_path(
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    at_once,
    alive,
) -> None:
    state.mkdir(parents=True, exist_ok=True)
    now = setup.datetime.now(setup.UTC).isoformat()
    gone = tmp_path / "no-longer-registered"
    (state / "status.json").write_text(
        json.dumps(
            {
                "last_apply": {"at": now, "ok": True, "receipt": "second.json"},
                "worktree_warnings": {
                    "repos": {
                        str(repo["main"]): {
                            "at": now,
                            "count": 30,
                            "checkout": str(repo["main"]),
                            "warning": "30 worktrees idle 3 days or more",
                        },
                        str(gone): {
                            "at": now,
                            "count": 40,
                            "checkout": str(gone / "checkout"),
                            "warning": "40 worktrees idle 3 days or more",
                        },
                    }
                },
            }
        )
    )
    # what a reclaim could not do is the receipt's to tell, for as long as that reclaim is
    # the last one: a later one that worked has the last word
    setup._write_check(
        {
            "disk_work": {
                "ok": False,
                "ran": True,
                "reclaim_ok": False,
                "error": "the reclaim had 1 failures: read its receipt",
            }
        }
    )
    status = run(setup.disk_status())
    assert "30 worktrees idle 3 days or more" in status["warnings"]
    assert "40 worktrees idle 3 days or more" not in status["warnings"]  # not registered now
    assert not any("disk work" in found for found in status["warnings"] + status["problems"])

    resolved: list[str] = []
    path_key = setup.path_key
    monkeypatch.setattr(
        setup, "path_key", lambda path: resolved.append(str(path)) or path_key(path)
    )
    release = threading.Event()
    live = setup._live

    def waits(settings, saved):
        steps.doing("checking the volume", "/Volumes/Shed")
        at_once("STATUS_SECONDS")
        release.wait(30)
        return live(settings, saved)

    monkeypatch.setattr(setup, "_live", waits)
    monkeypatch.setattr(setup, "STATUS_SECONDS", 20)
    status = run(setup.disk_status())
    # every count is given, and no path was resolved to choose among them: resolving reads
    # the volume the repository is on, which may be the one that does not answer
    assert {"30 worktrees idle 3 days or more", "40 worktrees idle 3 days or more"} <= set(
        status["warnings"]
    )
    assert resolved == [] and alive("disk-status") == 1

    # nor are counts a reclaim has written since: asked again while the old read still
    # waits, the status starts another, and gives what is on file now
    saved = json.loads((state / "status.json").read_text())
    saved["worktree_warnings"]["repos"][str(repo["main"])]["warning"] = "50 worktrees idle"
    (state / "status.json").write_text(json.dumps(saved))
    monkeypatch.setattr(setup, "_live", live)
    monkeypatch.setattr(setup, "STATUS_SECONDS", 20)
    threading.Timer(0.3, release.set).start()  # the old read comes back during this call
    status = run(setup.disk_status())
    assert "50 worktrees idle" in status["warnings"]
    assert "30 worktrees idle 3 days or more" not in status["warnings"]
    until = time.monotonic() + 20  # the old read is let finish before anything else changes
    while alive("disk-status") and time.monotonic() < until:
        time.sleep(0.01)
    assert alive("disk-status") == 0
    release.clear()

    # a path it resolves is named first, the recorded ones too: what does not answer is said
    monkeypatch.setattr(setup, "path_key", path_key)
    monkeypatch.setattr(setup, "_LIVE", None)

    for recorded in (gone / "checkout", gone):  # the checkout it wrote down, and the main

        def does_not_answer(path, recorded=recorded):
            if str(path) == str(recorded):
                at_once("STATUS_SECONDS")
                release.wait(30)
            return path_key(path)

        release.clear()
        monkeypatch.setattr(setup, "_LIVE", None)
        monkeypatch.setattr(setup, "path_key", does_not_answer)
        monkeypatch.setattr(setup, "STATUS_SECONDS", 20)
        status = run(setup.disk_status())
        assert f"resolving {recorded} " in status["problems"][0]
        release.set()
        until = time.monotonic() + 20
        while alive("disk-status") and time.monotonic() < until:
            time.sleep(0.01)
    monkeypatch.setattr(setup, "path_key", path_key)
    monkeypatch.setattr(setup, "_LIVE", None)
    monkeypatch.setattr(setup, "_live", waits)
    monkeypatch.setattr(setup, "STATUS_SECONDS", 20)
    release.clear()
    run(setup.disk_status())  # (a read that waits, for what follows)
    assert alive("disk-status") >= 1

    # settings that changed are not answered from a read started with the old ones
    with repo["settings"].open("a", encoding="utf-8") as handle:
        handle.write("idle_worktree_limit = 5\n")
    monkeypatch.setattr(setup, "_live", live)
    monkeypatch.setattr(setup, "STATUS_SECONDS", 20)
    status = run(setup.disk_status())
    assert status["schedule"] is not None and alive("disk-status") >= 1  # the old one waits on
    release.set()

    # T3 Code's worktree folder is named before its path is resolved
    t3_settings = tmp_path / "t3-settings.json"
    shed = str(tmp_path / "Shed" / "worktrees")  # absolute on every system, as T3 Code needs
    t3_settings.write_text(json.dumps({"worktreesDirectory": shed}))
    monkeypatch.setenv("BOTCORE_DISK_T3_SETTINGS", str(t3_settings))
    said: list[tuple[str, str]] = []
    monkeypatch.setattr(steps, "SAID", said)
    setup.t3_worktree_roots(load_machine_settings()[0])
    assert said.index(("reading", str(t3_settings))) < said.index(("resolving", shed))


def test_whether_a_folder_can_be_read_takes_one_entry(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import botcore.commands.disk.report as report

    folder = tmp_path / "many"
    folder.mkdir()
    for number in range(20):
        (folder / f"file{number}").write_text("x")
    asked: list[int] = []

    class Counting:
        def __init__(self, entries) -> None:
            self._entries = entries

        def __enter__(self):
            return self

        def __exit__(self, *_exc) -> None:
            self._entries.close()

        def __iter__(self):
            return self

        def __next__(self):
            asked.append(1)
            return next(self._entries)

    scandir = os.scandir
    monkeypatch.setattr(setup.os, "scandir", lambda path: Counting(scandir(path)))
    setup._peek(folder)
    assert asked == [1]  # however many it holds
    assert report._presence(folder) == ("present", None) and asked == [1, 1]
    assert report._presence(tmp_path / "absent")[0] == "missing"

    def refused(path):
        raise PermissionError(13, "Operation not permitted")

    monkeypatch.setattr(setup.os, "scandir", refused)
    assert report._presence(folder) == ("unreadable", "Operation not permitted")
    with pytest.raises(PermissionError):
        setup._peek(folder)


def test_the_command_line_runs_the_job_as_a_process_of_its_own(
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Only the scheduler's own process may leave a step behind: the command it runs says
    that is what it is, and nothing else does."""
    from click.testing import CliRunner

    import botcore.commands.disk as disk
    from botcore.cli import cli

    asked: list[dict] = []

    async def fake(**kwargs):
        asked.append(kwargs)
        return SimpleNamespace(
            success=True,
            data={"ran": False},
            error=None,
            reasoning=None,
            warnings=None,
            suggestions=None,
        )

    monkeypatch.setattr(disk, "disk_run", fake)
    out = CliRunner().invoke(cli, ["disk-run", "--force", "--json"])
    assert out.exit_code == 0, out.output
    assert asked == [{"force": True, "own_process": True}]
    assert setup.disk_run.__kwdefaults__ is None  # (its own default is a process that lives on)
    assert setup.disk_run.__defaults__ == (False, False)


def test_setup_writes_the_machines_name_down_once(
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
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
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
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
    monkeypatch.setattr(
        schedule,
        "_run",
        lambda args, stdin=None: ran.append(args) or subprocess.CompletedProcess(args, 0, "", ""),
    )
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
    monkeypatch.setattr(
        schedule.shutil, "which", lambda name: None if name == "systemctl" else name
    )
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    assert schedule._linux_install("/home/u/.local/bin/botcore", "/usr/bin").installed
    assert "other-job" in table["text"] and schedule.CRON_MARK in table["text"]
    schedule._linux_install("/home/u/.local/bin/botcore", "/usr/bin")
    assert table["text"].count(schedule.CRON_MARK) == 1
    schedule._linux_uninstall()
    assert schedule.CRON_MARK not in table["text"] and "other-job" in table["text"]
