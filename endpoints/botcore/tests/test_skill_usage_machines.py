"""Skill usage across machines: the shared folder, one report from every machine's record,
and a machine that names itself."""

# ruff: noqa: F811 - pytest fixtures imported from the collect and triggers tests

from __future__ import annotations

import json
from pathlib import Path

import pytest

from botcore.commands.skill_usage import (
    skill_usage_collect,
    skill_usage_report,
    skill_usage_triggers,
    store,
)
from tests.test_skill_usage import (  # noqa: F401 - fixtures
    T3Store,
    checkout,
    collected,
    fail,
    rows,
    run,
    stamp,
)
from tests.test_skill_usage_triggers import (  # noqa: F401 - fixtures
    link,
    merge,
    repo,
    rule,
    session,
    why,
)


class Machines:
    """Several machines on one bench: each has its own T3 Code store, record and name, and
    all name one shared folder."""

    def __init__(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, project: Path) -> None:
        self.tmp, self.monkeypatch, self.project = tmp_path, monkeypatch, project
        self.shared = tmp_path / "shared"
        self.shared.mkdir()
        self.stores: dict[str, T3Store] = {}

    def record(self, name: str) -> Path:
        return self.tmp / f"record-{name}"

    def on(self, name: str) -> T3Store:
        """Sit down at a machine."""
        if name not in self.stores:
            self.stores[name] = T3Store(self.tmp / f"{name}.sqlite", prefix=name)
            self.stores[name].project("p1", self.project)
        self.monkeypatch.setenv(store.T3_STORE_ENV, str(self.stores[name].path))
        self.monkeypatch.setenv(store.STATE_ENV, str(self.record(name)))
        self.monkeypatch.setenv(store.MACHINE_ENV, name)
        self.monkeypatch.setenv(store.SHARED_ENV, str(self.shared))
        return self.stores[name]


@pytest.fixture
def machines(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, checkout: Path) -> Machines:
    return Machines(tmp_path, monkeypatch, checkout)


# ── the shared folder ───────────────────────────────────────────────────────


def test_collection_also_writes_the_record_to_the_shared_folder(machines: Machines) -> None:
    bench = machines.on("bench")
    bench.skill_tool(bench.thread("main"), "plant-beds", stamp(1))

    data = run(skill_usage_collect())

    folder = machines.shared / "bench"
    assert data["machine"] == "bench"
    assert data["shared"] == {"path": str(machines.shared), "exists": True, "written": True}
    assert sorted(found.name for found in folder.iterdir()) == [
        store.EVENTS_FILE, store.SESSIONS_FILE, store.STATE_FILE,
    ]  # fmt: skip
    for name in (store.EVENTS_FILE, store.SESSIONS_FILE):
        assert (folder / name).read_bytes() == (machines.record("bench") / name).read_bytes()
    # of its state a machine shares what another needs, and none of its folders
    assert sorted(json.loads((folder / store.STATE_FILE).read_text("utf-8"))) == [
        "collected_at", "machine", "recognizer", "version",
    ]  # fmt: skip
    assert str(machines.project) in (machines.record("bench") / store.STATE_FILE).read_text()
    for found in folder.iterdir():
        assert str(machines.project) not in found.read_text("utf-8")

    written = (folder / store.EVENTS_FILE).stat().st_mtime_ns
    run(skill_usage_collect())  # nothing new: nothing for a sync to send but the time
    assert (folder / store.EVENTS_FILE).stat().st_mtime_ns == written


def test_a_shared_folder_that_is_not_there_does_not_undo_the_collection(
    machines: Machines, monkeypatch: pytest.MonkeyPatch
) -> None:
    bench = machines.on("bench")
    bench.skill_tool(bench.thread("main"), "plant-beds", stamp(1))
    unmounted = machines.tmp / "unmounted" / "skill-usage"
    monkeypatch.setenv(store.SHARED_ENV, str(unmounted))

    data = run(skill_usage_collect())

    assert data["added"] == 1 and len(collected(machines.record("bench"))) == 1
    assert (data["shared"]["exists"], data["shared"]["written"]) == (False, False)
    assert "not a folder" in data["shared"]["error"]
    assert not unmounted.parent.exists()  # never made in the place of a drive that is away
    warnings = run(skill_usage_report())["warnings"]
    assert any("only this machine's record was read" in warning for warning in warnings)


# ── one report from every machine ───────────────────────────────────────────


def test_a_report_counts_the_sessions_of_every_machine_once(machines: Machines) -> None:
    skill_file = machines.project / ".claude" / "skills" / "plant-beds" / "SKILL.md"
    for name, providers in (
        ("bench", ("claudeAgent", "claudeAgent", "codex")),
        ("shed", ("claudeAgent", "codex")),
        ("tower", ("claudeAgent", "codex")),
    ):
        built = machines.on(name)
        for number, provider in enumerate(providers):
            thread = built.thread(f"{name}-{number}", provider=provider)
            if provider == "codex":  # Codex has no Skill tool: it reads the file
                built.shell(thread, f"cat {skill_file}", stamp(1))
            else:
                built.skill_tool(thread, "plant-beds", stamp(1))
        run(skill_usage_collect())
    # a thread that moved from the shed to the tower is in both stores, item for item
    tower = machines.on("tower")
    tower.prefix, tower.count = "shed", 0
    tower.skill_tool(tower.thread("shed-0"), "plant-beds", stamp(1))
    assert run(skill_usage_collect())["added"] == 1

    machines.on("bench")
    data = run(skill_usage_report(project="garden"))
    row = rows(data)["plant-beds"]

    assert data["record"]["machines"] == ["bench", "shed", "tower"]
    assert sorted(data["record"]["collected"]) == ["bench", "shed", "tower"]
    assert data["record"]["shared"] == str(machines.shared)
    assert (row["sessions"], row["of_sessions"], row["loads"]) == (7, 7, 7)
    assert row["harnesses"] == {"claude": 4, "codex": 3}
    assert row["machines"] == {"bench": 3, "shed": 2, "tower": 2}
    assert data["warnings"] == []

    machines.monkeypatch.setenv(store.SHARED_ENV, "")  # with no shared folder, this machine
    alone = run(skill_usage_report(project="garden"))
    assert rows(alone)["plant-beds"]["sessions"] == 3 and alone["record"]["machines"] == ["bench"]


def test_a_machine_whose_record_is_old_or_damaged_is_named(machines: Machines, repo: Path) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    for name in ("bench", "shed", "tower"):
        built = machines.on(name)
        built.skill_tool(built.thread(f"{name}-0"), "plant-beds", stamp(1))
        run(skill_usage_collect())
    shed_state = machines.shared / "shed" / store.STATE_FILE
    old = {**json.loads(shed_state.read_text("utf-8")), "collected_at": stamp(3)}
    shed_state.write_text(json.dumps(old), "utf-8")
    (machines.shared / ".DS_Store").write_text("not a machine", "utf-8")
    (machines.shared / "notes").mkdir()  # nor is a folder that holds no record
    machines.on("bench")

    data = run(skill_usage_report())

    assert data["record"]["machines"] == ["bench", "shed", "tower"]
    (warning,) = data["warnings"]
    assert warning.startswith(f"shed last collected {stamp(3)}") and "disk-status" in warning
    assert rule(run(skill_usage_triggers(repo=str(repo))))["changes"] == 1

    with (machines.shared / "tower" / store.EVENTS_FILE).open("a", encoding="utf-8") as handle:
        handle.write('{"id": "half a line')
    (machines.shared / "shed" / store.SESSIONS_FILE).write_text("{ half a file", "utf-8")

    warnings = run(skill_usage_report())["warnings"]
    assert "1 lines of shed's record could not be read and were skipped" in warnings
    assert "1 lines of tower's record could not be read and were skipped" in warnings
    damaged = fail(skill_usage_triggers(repo=str(repo)))  # a lost load would make a miss
    assert damaged.code == "RECORD_DAMAGED" and "shed, tower" in damaged.message


def test_a_change_opened_on_another_machine_is_judged_here(machines: Machines, repo: Path) -> None:
    for number in (101, 102, 103):
        merge(repo, f"feat: a hook (#{number})", "hooks.yml")
    shed = machines.on("shed")
    careful = session(shed, "careful", (101, stamp(2)))
    shed.skill_tool(careful, "gate-discipline", stamp(3))
    session(shed, "careless", (102, stamp(2)))
    # a thread that opened its pull request on the shed and was then moved to the tower,
    # where the link did not come with it
    moved = {"pullRequests": [link(103, stamp(2))], "updatedAt": stamp(2)}
    shed.skill_tool(shed.thread("moved", extra=moved), "gate-discipline", stamp(3))
    run(skill_usage_collect())
    tower = machines.on("tower")
    tower.skill_tool(tower.thread("moved", extra={"updatedAt": stamp(1)}), "plant-beds", stamp(1))
    run(skill_usage_collect())
    bench = machines.on("bench")
    bench.skill_tool(bench.thread("idle"), "plant-beds", stamp(1))
    run(skill_usage_collect())

    data = run(skill_usage_triggers(repo=str(repo)))
    found = rule(data)

    assert (found["loaded"], found["missed"], found["unknown"]) == (2, 1, 0)
    assert found["misses"] == [{"change": 102, "sessions": ["careless"]}]
    assert data["record"]["machines"] == ["bench", "shed", "tower"]

    machines.monkeypatch.setenv(store.SHARED_ENV, "")  # this machine alone saw none of them
    assert why(rule(run(skill_usage_triggers(repo=str(repo))))) == {"no_session": 3}


# ── a machine that names itself ─────────────────────────────────────────────


def test_a_machine_names_itself_and_its_shared_folder_in_its_settings(
    machines: Machines, repo: Path, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    bench = machines.on("bench")
    bench.skill_tool(bench.thread("main"), "plant-beds", stamp(1))
    monkeypatch.delenv(store.MACHINE_ENV)
    monkeypatch.delenv(store.SHARED_ENV)
    settings = tmp_path / "machine.toml"
    monkeypatch.setenv("BOTCORE_DISK_SETTINGS", str(settings))
    shared = json.dumps(str(machines.shared))
    settings.write_text(f'skill_usage_machine = "random"\nskill_usage_shared = {shared}\n', "utf-8")

    data = run(skill_usage_collect())

    assert data["machine"] == "random" and data["shared"]["written"]
    assert [event.machine for event in collected(machines.record("bench"))] == ["random"]
    assert (machines.shared / "random" / store.EVENTS_FILE).exists()

    settings.write_text("", "utf-8")  # no name anywhere: its hostname, made fit for a folder
    monkeypatch.setattr(store.platform, "node", lambda: "The Shed's Mac.local")
    assert store.local() == store.Local("the-shed-s-mac", None)
    monkeypatch.setenv(store.SHARED_ENV, "")  # the environment speaks first
    monkeypatch.setenv(store.MACHINE_ENV, "tower")
    settings.write_text('skill_usage_machine = "random"\nskill_usage_shared = "/x"\n', "utf-8")
    assert store.local() == store.Local("tower", None)

    monkeypatch.setenv(store.MACHINE_ENV, "up/../and/out")  # a name is a folder's name
    assert fail(skill_usage_collect()).code == "INVALID_INPUT"
    assert fail(skill_usage_report()).code == "INVALID_INPUT"
    monkeypatch.setenv(store.MACHINE_ENV, "tower")
    copied = fail(skill_usage_collect(t3_store=str(bench.path), machine="../elsewhere"))
    assert copied.code == "INVALID_INPUT"

    monkeypatch.delenv(store.MACHINE_ENV)
    settings.write_text('skill_usage_machine = "../elsewhere"\n', "utf-8")
    for refused in (
        skill_usage_collect(),
        skill_usage_report(),
        skill_usage_triggers(repo=str(repo)),
    ):
        assert fail(refused).code == "MACHINE_SETTINGS_INVALID"
