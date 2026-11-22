"""Skill usage across machines: the shared folder, one report from every machine's record,
and a machine that names itself."""

# ruff: noqa: F811 - pytest fixtures imported from the collect and triggers tests

from __future__ import annotations

import json
import shutil
import subprocess
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
    checkout_at,
    collected,
    fail,
    git,
    rows,
    run,
    skill_text,
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
    shared_state = json.loads((folder / store.STATE_FILE).read_text("utf-8"))
    assert sorted(shared_state) == [
        "collected_at", "files", "machine", "recognizer", "record_id", "renames", "skills",
        "unreadable", "version",
    ]  # fmt: skip
    assert shared_state["skills"] == {
        "garden": {
            "at": None,
            "commit": None,
            "held": {
                "plant-beds": [200, len("Plant a bed.")],
                "prune-roses": [120, len("Prune the roses.")],
            },
            "renames": {},
        }
    }
    assert sorted(shared_state["files"]) == [store.EVENTS_FILE, store.SESSIONS_FILE]
    assert (shared_state["machine"], shared_state["unreadable"]) == ("bench", 0)
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
    (machines.shared / "Old Notes").mkdir()  # nor is a folder no machine could be named
    machines.on("bench")

    data = run(skill_usage_report())

    assert data["record"]["machines"] == ["bench", "shed", "tower"]
    (warning,) = data["warnings"]
    assert warning.startswith(f"shed last collected {stamp(3)}") and "disk-status" in warning
    assert rule(run(skill_usage_triggers(repo=str(repo))))["changes"] == 1

    # the shed's own record has a line that cannot be read, and it shares it as it is
    machines.on("shed")
    with (machines.record("shed") / store.EVENTS_FILE).open("a", encoding="utf-8") as handle:
        handle.write('{"id": "a lost load\n')
    run(skill_usage_collect())
    machines.on("bench")

    warnings = run(skill_usage_report())["warnings"]
    assert "1 lines of shed's record could not be read and were skipped" in warnings
    damaged = fail(skill_usage_triggers(repo=str(repo)))  # a lost load would make a miss
    assert damaged.code == "RECORD_DAMAGED" and "(shed)" in damaged.message


def test_a_copy_that_a_sync_has_only_half_delivered_is_not_read(
    machines: Machines, repo: Path
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    shed = machines.on("shed")
    shed.skill_tool(shed.thread("early"), "plant-beds", stamp(2))
    run(skill_usage_collect())
    before = {name: (machines.shared / "shed" / name).read_bytes() for name in store.RECORD_FILES}
    opener = session(shed, "opener", (101, stamp(2)))
    shed.skill_tool(opener, "gate-discipline", stamp(3))
    run(skill_usage_collect())
    after = {name: (machines.shared / "shed" / name).read_bytes() for name in before}
    bench = machines.on("bench")
    bench.skill_tool(bench.thread("idle"), "plant-beds", stamp(1))
    run(skill_usage_collect())
    assert rule(run(skill_usage_triggers(repo=str(repo))))["loaded"] == 1

    # the sync has brought the shed's new sessions, and not yet its new events: read as they
    # lie, the session that opened the pull request would have loaded nothing
    (machines.shared / "shed" / store.EVENTS_FILE).write_bytes(before[store.EVENTS_FILE])

    data = run(skill_usage_triggers(repo=str(repo)))
    assert why(rule(data)) == {"no_session": 1} and rule(data)["missed"] == 0
    assert any("shed in the shared folder is not a whole copy" in w for w in data["warnings"])
    report = run(skill_usage_report())
    assert report["record"]["machines"] == ["bench"]
    assert any("shed in the shared folder is not a whole copy" in w for w in report["warnings"])

    # nor is one whose state is the older one, or has not arrived at all
    (machines.shared / "shed" / store.EVENTS_FILE).write_bytes(after[store.EVENTS_FILE])
    (machines.shared / "shed" / store.STATE_FILE).write_bytes(before[store.STATE_FILE])
    assert run(skill_usage_report())["record"]["machines"] == ["bench"]
    (machines.shared / "shed" / store.STATE_FILE).unlink()
    assert run(skill_usage_report())["record"]["machines"] == ["bench"]
    (machines.shared / "shed" / store.STATE_FILE).write_bytes(after[store.STATE_FILE])
    assert run(skill_usage_report())["record"]["machines"] == ["bench", "shed"]  # all arrived
    # and the other way about: its new events, and not yet the sessions they belong to
    (machines.shared / "shed" / store.SESSIONS_FILE).write_bytes(before[store.SESSIONS_FILE])
    assert run(skill_usage_report())["record"]["machines"] == ["bench"]


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
    monkeypatch.delenv(store.SHARED_ENV)
    monkeypatch.delenv(store.AWAY_ENV)
    for wrong, code in (
        ('skill_usage_machine = "../elsewhere"\n', "INVALID_INPUT"),
        ('skill_usage_machine = "nul.txt"\n', "INVALID_INPUT"),  # a device, to Windows
        ('skill_usage_machine = "bench."\n', "INVALID_INPUT"),  # and `bench` again
        ('skill_usage_shared = "records/here"\n', "INVALID_INPUT"),  # where a job runs differs
        ("skill_usage_machine = \n", "MACHINE_SETTINGS_INVALID"),
        (b"skill_usage_machine = \xff\n", "MACHINE_SETTINGS_INVALID"),  # not text at all
    ):
        settings.write_bytes(wrong if isinstance(wrong, bytes) else wrong.encode())
        for refused in (
            skill_usage_collect,
            skill_usage_report,
            lambda: skill_usage_triggers(repo=str(repo)),
        ):
            assert fail(refused()).code == code, wrong
    settings.write_text('skill_usage_machine = "Random"\nskill_usage_away = ["Hero"]\n', "utf-8")
    here = store.local()  # a shared drive does not tell Random from random
    assert (here.machine, here.away) == ("random", frozenset({"hero"}))
    settings.write_text('skill_usage_away = ["a machine"]\n', "utf-8")
    assert fail(skill_usage_triggers(repo=str(repo))).code == "INVALID_INPUT"


# ── what a machine may write to the shared folder ───────────────────────────


def test_a_machine_shares_what_it_understood_and_never_a_line_it_could_not_read(
    machines: Machines,
) -> None:
    bench = machines.on("bench")
    bench.skill_tool(bench.thread("main"), "plant-beds", stamp(1))
    run(skill_usage_collect())
    with (machines.record("bench") / store.EVENTS_FILE).open("a", encoding="utf-8") as handle:
        handle.write('{"id": "half a line of the-private-text\n')
    sessions = store.load_sessions(machines.record("bench"))
    sessions["gone"] = {  # a session the harness has dropped, with what a hand added to it
        "root": "gone",
        "title": "the-private-text",
        "pull_requests": [{"ref": "acme/garden#7", "opened": True, "title": "the-private-text"}],
    }
    store.save_sessions(machines.record("bench"), sessions)

    run(skill_usage_collect())

    folder = machines.shared / "bench"
    for found in folder.iterdir():
        assert "the-private-text" not in found.read_text("utf-8")
    assert json.loads((folder / store.SESSIONS_FILE).read_text("utf-8"))["gone"] == {
        "root": "gone", "parent": None, "agent": None, "harness": None, "project": None,
        "created_at": None, "updated_at": None, "machine": "bench",
        "pull_requests": [{"ref": "acme/garden#7", "linked_at": None, "opened": True}],
    }  # fmt: skip
    assert json.loads((folder / store.STATE_FILE).read_text("utf-8"))["unreadable"] == 1
    assert "the-private-text" in (machines.record("bench") / store.EVENTS_FILE).read_text()


def test_a_store_copied_from_another_system_names_its_projects_by_folder(
    machines: Machines, tmp_path: Path
) -> None:
    bench = machines.on("bench")
    bench.project("p2", Path(r"C:\Users\somebody\code\orchard"))  # as Windows writes it
    bench.skill_tool(bench.thread("main", project_id="p2"), "plant-beds", stamp(1))

    run(skill_usage_collect())

    assert [event.project for event in collected(machines.record("bench"))] == ["orchard"]
    assert "somebody" not in (machines.shared / "bench" / store.EVENTS_FILE).read_text("utf-8")


def test_a_machine_writes_no_folder_but_its_own(
    machines: Machines, monkeypatch: pytest.MonkeyPatch
) -> None:
    shed = machines.on("shed")
    shed.skill_tool(shed.thread("shed-0"), "plant-beds", stamp(1))
    run(skill_usage_collect())
    folder = machines.shared / "shed"
    (folder / "events.jsonl.999.tmp").write_text("left by a write that was cut short", "utf-8")
    theirs = (folder / store.SESSIONS_FILE).read_bytes()

    # another machine that took the same name, in whatever case: it would hide the first
    impostor = machines.on("tower")
    impostor.skill_tool(impostor.thread("tower-0"), "plant-beds", stamp(1))
    monkeypatch.setenv(store.MACHINE_ENV, "Shed")
    data = run(skill_usage_collect())

    assert data["machine"] == "shed" and data["shared"]["written"] is False
    assert "another machine named shed" in data["shared"]["error"]
    assert (folder / store.SESSIONS_FILE).read_bytes() == theirs
    assert [found.name.lower() for found in machines.shared.iterdir()] == ["shed"]

    # nor its own record, where the shared folder was pointed at the folder that holds it
    monkeypatch.setenv(store.MACHINE_ENV, "bench")
    monkeypatch.setenv(store.STATE_ENV, str(machines.shared / "bench"))
    bench = machines.stores["bench"] = T3Store(machines.tmp / "bench.sqlite", prefix="bench")
    bench.project("p1", machines.project)
    bench.skill_tool(bench.thread("bench-0"), "plant-beds", stamp(1))
    monkeypatch.setenv(store.T3_STORE_ENV, str(bench.path))
    data = run(skill_usage_collect())
    assert "keeps its own record" in data["shared"]["error"]
    assert "projects" in store.load_state(machines.shared / "bench")  # its state is whole

    machines.on("shed")  # the machine whose folder it is writes it again, and tidies it
    assert run(skill_usage_collect())["shared"]["written"] is True
    assert not list(folder.glob("*.tmp"))


def test_a_record_with_no_load_yet_is_a_whole_copy(machines: Machines) -> None:
    shed = machines.on("shed")
    session(shed, "opener", (101, stamp(2)))  # a session, and no skill loaded anywhere
    run(skill_usage_collect())
    assert (machines.shared / "shed" / store.EVENTS_FILE).read_bytes() == b""

    machines.on("bench")  # a machine that has collected nothing reads it all the same
    data = run(skill_usage_report())

    assert data["record"]["machines"] == ["shed"] and data["record"]["sessions"] == 1
    assert any(warning.startswith("Last collected never") for warning in data["warnings"])


# ── reading every machine alike ─────────────────────────────────────────────


def test_a_copy_is_parsed_from_the_bytes_that_were_checked(
    machines: Machines, monkeypatch: pytest.MonkeyPatch
) -> None:
    shed = machines.on("shed")
    shed.skill_tool(shed.thread("shed-0"), "plant-beds", stamp(1))
    run(skill_usage_collect())
    machines.on("bench")
    reads: list[str] = []
    read_bytes = Path.read_bytes

    def counted(path: Path) -> bytes:
        if path.parent == machines.shared / "shed":
            reads.append(path.name)
        return read_bytes(path)

    monkeypatch.setattr(Path, "read_bytes", counted)

    record = store.load_record(machines.record("bench"), store.local())

    # once each: a sync that lands between a check and a second read would undo the check
    assert sorted(reads) == [store.EVENTS_FILE, store.SESSIONS_FILE]
    assert [event.thread for event in record.events] == ["shed-0"]


def test_two_machines_entries_for_one_session_merge_the_same_from_either_side() -> None:
    earlier = {
        "root": "main", "parent": "main", "agent": "delegate", "updated_at": stamp(3),
        "pull_requests": [
            {"ref": "acme/garden#7", "linked_at": stamp(2), "opened": True},
            {"ref": "acme/garden#8", "linked_at": stamp(2), "opened": None},
        ],
    }  # fmt: skip
    later = {
        "root": "main", "parent": None, "agent": "delegate", "updated_at": stamp(1),
        "pull_requests": [
            {"ref": "acme/garden#7", "linked_at": stamp(4), "opened": True},  # another time
            {"ref": "acme/garden#8", "linked_at": stamp(1), "opened": False},
            "acme/garden#9",
        ],
    }  # fmt: skip

    merged = store._merged(earlier, later)

    assert merged == store._merged(later, earlier)
    assert merged["parent"] == "main"  # what the later entry does not know is kept
    assert merged["updated_at"] == stamp(1)
    assert merged["pull_requests"] == [
        {"ref": "acme/garden#7", "linked_at": stamp(4), "opened": True},  # the earlier opening
        {"ref": "acme/garden#8", "linked_at": stamp(1), "opened": False},  # the one that says
        "acme/garden#9",
    ]


def test_every_machine_reads_the_same_record(machines: Machines, repo: Path) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    # one load, as two machines hold it: the shed for the opener, the attic for a worker
    shed = machines.on("shed")
    shed.skill_tool(session(shed, "opener", (101, stamp(2))), "gate-discipline", stamp(3))
    run(skill_usage_collect())
    attic = machines.on("attic")
    attic.prefix = "shed"
    attic.skill_tool(attic.thread("worker"), "gate-discipline", stamp(3))
    run(skill_usage_collect())

    seen = []
    for name in ("shed", "attic", "bench"):
        machines.on(name)
        found = rule(run(skill_usage_triggers(repo=str(repo))))
        seen.append((found["loaded"], found["missed"]))

    assert seen == [(1, 0)] * 3  # and never a miss for the load one copy gives the opener


def what(data: dict) -> tuple:
    """What a report says of the skills: not where this machine keeps its record, nor what
    it warns of its own."""
    return data["skills"], data["totals"], data["quiet"]


def test_machines_whose_checkouts_differ_report_the_same(machines: Machines, repo: Path) -> None:
    # the attic's clone was made before a skill was renamed, was never fetched since, and
    # sits on a branch of its own with work under way
    stale = machines.tmp / "attic" / "garden"
    subprocess.run(["git", "clone", "-q", str(repo), str(stale)], check=True)
    git(stale, "remote", "set-url", "origin", "git@example.com:acme/garden.git")
    git(stale, "checkout", "-q", "-b", "topic")
    (stale / ".claude" / "skills" / "plant-beds" / "SKILL.md").write_text(
        skill_text("plant-beds", "Plant a bed, at length.", 900), "utf-8"
    )
    git(stale, "add", "-A")
    git(stale, "commit", "-q", "-m", "work under way")
    git(repo, "mv", ".claude/skills/gate-discipline", ".claude/skills/gates")
    merge(repo, "chore: rename the skill (#100)", days_ago=-1)  # the shed has it: merged later
    shed = machines.on("shed")
    shed.skill_tool(shed.thread("shed-0"), "gates", stamp(1))
    run(skill_usage_collect())
    attic = machines.stores["attic"] = T3Store(machines.tmp / "attic.sqlite", prefix="attic")
    attic.project("p1", stale)
    machines.on("attic")
    attic.skill_tool(attic.thread("attic-0"), "gate-discipline", stamp(2))  # by its old name
    attic.skill_tool(attic.thread("attic-1"), "plant-beds", stamp(2))
    run(skill_usage_collect())

    seen = {}
    for name in ("shed", "attic", "bench"):  # the bench has the shared folder, and no record
        machines.on(name)
        data = run(skill_usage_report(days=30))
        seen[name] = what(data)
        assert data["warnings"] == [] or name == "bench"  # which only says it never collected

    assert seen["shed"] == seen["attic"] == seen["bench"]
    skills, totals, quiet = seen["attic"]
    found = {row["skill"]: row for row in skills}
    assert sorted(found) == ["gates", "plant-beds"] and totals["loads"] == 3  # noqa: PLR2004
    assert found["gates"]["sessions"] == 2 and found["gates"]["size_bytes"] == 90  # noqa: PLR2004
    assert found["plant-beds"]["size_bytes"] == 200  # noqa: PLR2004 - as merged
    assert [entry["skill"] for entry in quiet] == ["prune-roses"]


def test_a_checkout_behind_names_a_rule_as_the_newest_record_does(
    machines: Machines, repo: Path
) -> None:
    stale = machines.tmp / "attic" / "garden"  # it has the hook's change, and not the rename
    subprocess.run(["git", "clone", "-q", str(repo), str(stale)], check=True)
    git(stale, "remote", "set-url", "origin", "git@example.com:acme/garden.git")
    merge(stale, "feat: a hook (#101)", "hooks.yml")
    git(stale, "update-ref", "refs/remotes/origin/main", "HEAD")
    git(repo, "mv", ".claude/skills/gate-discipline", ".claude/skills/gates")
    merge(repo, "chore: rename the skill (#100)", days_ago=-1)
    shed = machines.on("shed")
    shed.skill_tool(session(shed, "opener", (101, stamp(2))), "gates", stamp(3))
    run(skill_usage_collect())
    attic = machines.stores["attic"] = T3Store(machines.tmp / "attic.sqlite", prefix="attic")
    attic.project("p1", stale)
    machines.on("attic")  # it never collected: the rule and the folder here say the old name

    found = rule(run(skill_usage_triggers(repo=str(stale))))

    assert (found["skill"], found["loaded"], found["missed"]) == ("gates", 1, 0)


def test_a_state_changed_by_hand_shares_no_text(machines: Machines) -> None:
    bench = machines.on("bench")
    bench.skill_tool(bench.thread("main"), "plant-beds", stamp(1))
    run(skill_usage_collect())
    shutil.rmtree(machines.project)  # nothing is read again: what the file says stands
    saved = store.load_state(machines.record("bench"))
    garden = saved["projects"]["garden"]
    garden["accounts"][str(machines.project)] = {
        "at": "tell nobody: the launch is in March",
        "commit": "/home/someone/private",
        "held": {
            "/home/someone/notes": [1, 1],
            "a sentence someone wrote": [1, 1],
            "plant-beds": [200, -1],
            "prune-roses": [120, 16],
        },
        "renames": {"some private words": "x", "../up": "x", "fine-old": "fine-new"},
    }
    garden["renames"] = {"more private words": "x", "kept-old": "kept-new"}
    store.save_state(machines.record("bench"), saved)

    run(skill_usage_collect())

    shared = (machines.shared / "bench" / store.STATE_FILE).read_text("utf-8")
    for text in ("launch", "someone", "sentence", "private", "../up"):
        assert text not in shared
    told = json.loads(shared)
    assert told["skills"] == {
        "garden": {
            "at": None,
            "commit": None,
            "held": {"prune-roses": [120, 16]},
            "renames": {"fine-old": "fine-new"},
        }
    }
    assert told["renames"] == {"garden": {"kept-old": "kept-new"}}


def test_a_skills_name_now_is_read_with_the_list_it_is_looked_up_in(machines: Machines) -> None:
    """Two machines' histories can say otherwise of one old name. The one whose list of the
    project is used says what the skill is called now, whichever machine reads."""
    for name in ("attic", "shed"):
        built = machines.on(name)
        built.skill_tool(built.thread(f"{name}-0"), "old-beds", stamp(1))
        run(skill_usage_collect())
    for name, day, new in (("attic", "01", "first-beds"), ("shed", "02", "second-beds")):
        path = machines.shared / name / store.STATE_FILE
        told = json.loads(path.read_text("utf-8"))
        told["renames"] = {"garden": {"old-beds": new}}
        told["skills"] = {
            "garden": {
                "at": f"2026-04-{day}T10:00:00+00:00",
                "commit": day * 20,
                "held": {new: [100, 10]},
                "renames": {"old-beds": new},
            }
        }
        path.write_text(json.dumps(told), "utf-8")

    machines.on("bench")  # it has the shared folder and no record of its own
    data = run(skill_usage_report())

    (row,) = data["skills"]
    assert (row["skill"], row["sessions"], row["size_bytes"]) == ("second-beds", 2, 100)
    assert data["quiet"] == []  # and no list holds the name the other machine gives it


def test_machines_with_folders_that_are_no_repository_report_the_same(machines: Machines) -> None:
    other = checkout_at(machines.tmp / "attic" / "garden")
    (other / ".claude" / "skills" / "plant-beds" / "SKILL.md").write_text(
        skill_text("plant-beds", "Plant a bed, at length.", 900), "utf-8"
    )
    shed = machines.on("shed")
    shed.skill_tool(shed.thread("shed-0"), "plant-beds", stamp(1))
    run(skill_usage_collect())
    attic = machines.stores["attic"] = T3Store(machines.tmp / "attic.sqlite", prefix="attic")
    attic.project("p1", other)
    machines.on("attic")
    attic.skill_tool(attic.thread("attic-0"), "plant-beds", stamp(2))
    run(skill_usage_collect())

    seen = {}
    for name in ("shed", "attic", "bench"):
        machines.on(name)
        seen[name] = what(run(skill_usage_report(days=30)))

    assert seen["shed"] == seen["attic"] == seen["bench"]
    (row,) = seen["shed"][0]  # neither folder is newer: the first machine by name speaks
    assert (row["sessions"], row["size_bytes"]) == (2, 900)


def test_a_reader_with_no_record_of_its_own_knows_a_renamed_skill(
    machines: Machines, repo: Path
) -> None:
    shed = machines.on("shed")
    shed.skill_tool(session(shed, "opener", (101, stamp(2))), "gate-discipline", stamp(3))
    run(skill_usage_collect())
    subprocess.run(
        ["git", "-C", str(repo), "mv", ".claude/skills/gate-discipline", ".claude/skills/gates"],
        check=True,
    )
    (repo / "botcore.toml").write_text(
        '[[skills.required]]\nskill = "gates"\npaths = ["hooks.yml"]\n', "utf-8"
    )
    merge(repo, "chore: rename the skill (#100)")
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    run(skill_usage_collect())  # the shed collects again, after the merge

    machines.on("bench")  # it has the checkout and the shared folder, and never collected
    found = rule(run(skill_usage_triggers(repo=str(repo))))

    assert (found["skill"], found["loaded"], found["missed"]) == ("gates", 1, 0)


def test_an_odd_entry_in_the_shared_folder_stops_no_report(machines: Machines) -> None:
    shed = machines.on("shed")
    shed.skill_tool(shed.thread("shed-0"), "plant-beds", stamp(1))
    run(skill_usage_collect())
    bench = machines.on("bench")
    bench.skill_tool(bench.thread("bench-0"), "plant-beds", stamp(1))
    run(skill_usage_collect())
    (machines.shared / "empty").mkdir()
    (machines.shared / "a-file").write_text("not a folder", "utf-8")
    (machines.shared / "linked").symlink_to(machines.shared / "shed", target_is_directory=True)
    (machines.shared / "notes").mkdir()
    (machines.shared / "notes" / store.STATE_FILE).write_text('{"files": {}}', "utf-8")
    (machines.shared / "knot").mkdir()
    (machines.shared / "knot" / store.STATE_FILE).mkdir()  # a folder where a file should be
    shutil.copytree(machines.shared / "shed", machines.shared / "copied")  # the shed's, twice
    (machines.shared / "Not A Machine").mkdir()  # a folder no machine could be named

    data = run(skill_usage_report())

    assert data["record"]["machines"] == ["bench", "shed"]
    named = [warning.split(" ")[0] for warning in data["warnings"] if "not a whole copy" in warning]
    # each is named, and none is read: `empty` may be a machine a sync has yet to fill
    assert named == ["copied", "empty", "knot", "notes"]


# ── a miss needs the whole record ───────────────────────────────────────────


def test_no_change_is_a_miss_while_a_machines_record_is_not_all_here(
    machines: Machines, repo: Path
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    # the thread loaded the skill on the shed, was moved to the tower, and opened its pull
    # request there: the tower knows the opener, and only the shed knows the load
    shed = machines.on("shed")
    shed.skill_tool(shed.thread("moved"), "gate-discipline", stamp(3))
    run(skill_usage_collect())
    tower = machines.on("tower")
    session(tower, "moved", (101, stamp(2)))
    tower.skill_tool("moved", "plant-beds", stamp(2))
    run(skill_usage_collect())  # and the report is read on the tower

    def judged_now() -> tuple[int, int, dict]:
        found = rule(run(skill_usage_triggers(repo=str(repo))))
        return found["loaded"], found["missed"], why(found)

    assert judged_now() == (1, 0, {})
    state_file = machines.shared / "shed" / store.STATE_FILE
    whole = state_file.read_bytes()

    state_file.unlink()  # the shed's copy is part way through a sync
    assert judged_now() == (0, 0, {"incomplete_record": 1})
    state_file.write_bytes(whole)

    machines.monkeypatch.setenv(store.SHARED_ENV, str(machines.tmp / "unmounted"))
    assert judged_now() == (0, 0, {"incomplete_record": 1})  # the shared drive is away
    machines.monkeypatch.setenv(store.SHARED_ENV, str(machines.shared))

    # the shed is whole and an hour behind: it collected before the change merged
    behind = {**json.loads(whole), "collected_at": stamp(0, minutes=-60)}
    (machines.shared / "shed" / store.EVENTS_FILE).write_bytes(b"")
    behind["files"][store.EVENTS_FILE] = store._digest(b"")
    state_file.write_text(json.dumps(behind), "utf-8")
    assert judged_now() == (0, 0, {"incomplete_record": 1})

    # nor does it stop waiting for a machine that has been silent for days: the shed may
    # have been working all the while, with its collection stopped
    state_file.write_text(json.dumps({**behind, "collected_at": stamp(3)}), "utf-8")
    assert judged_now() == (0, 0, {"incomplete_record": 1})
    warnings = run(skill_usage_triggers(repo=str(repo)))["warnings"]
    assert any(warning.startswith("shed last collected") for warning in warnings)
    assert any("shed had not" in warning and "skill_usage_away" in warning for warning in warnings)

    # until the owner says the shed is switched off: then what is here is all there is
    machines.monkeypatch.setenv(store.AWAY_ENV, " Shed ,attic")
    assert judged_now() == (0, 1, {})


def test_a_thread_moved_to_this_machine_is_read_from_its_start(machines: Machines) -> None:
    tower = machines.on("tower")
    tower.skill_tool(tower.thread("here"), "plant-beds", stamp(0))
    run(skill_usage_collect())
    # whatever the move made of the thread's own dates, its items are as old as they were
    tower.skill_tool(tower.thread("moved"), "prune-roses", stamp(19))

    data = run(skill_usage_collect())  # the load is weeks behind where this read would begin

    assert data["added"] == 1
    assert sorted(event.skill for event in collected(machines.record("tower"))) == [
        "plant-beds", "prune-roses",
    ]  # fmt: skip


def test_a_machine_whose_state_was_lost_is_not_shut_out_of_its_own_folder(
    machines: Machines,
) -> None:
    shed = machines.on("shed")
    shed.skill_tool(session(shed, "shed-0", (7, stamp(2))), "plant-beds", stamp(1))
    run(skill_usage_collect())
    first = store.load_state(machines.record("shed"))["record_id"]
    (machines.record("shed") / store.STATE_FILE).write_text("{ half a file", "utf-8")
    shed.skill_tool(shed.thread("shed-1"), "plant-beds", stamp(0))

    data = run(skill_usage_collect())  # it begins a new id, and reads everything again

    assert store.load_state(machines.record("shed"))["record_id"] != first
    assert data["shared"] == {"path": str(machines.shared), "exists": True, "written": True}
    machines.on("bench")
    assert run(skill_usage_report())["record"]["sessions"] == 2


def test_a_reader_with_no_checkout_knows_a_skills_new_name(machines: Machines, repo: Path) -> None:
    shed = machines.on("shed")
    shed.skill_tool(shed.thread("shed-0"), "gate-discipline", stamp(3))
    subprocess.run(
        ["git", "-C", str(repo), "mv", ".claude/skills/gate-discipline", ".claude/skills/gates"],
        check=True,
    )
    merge(repo, "chore: rename the skill (#100)")
    run(skill_usage_collect())  # the shed has the checkout, and with it the rename
    renames = json.loads((machines.shared / "shed" / store.STATE_FILE).read_text("utf-8"))
    assert renames["renames"] == {"acme/garden": {"gate-discipline": "gates"}}

    machines.on("bench")  # it never collected, so it knows no checkout of the project

    assert sorted(rows(run(skill_usage_report()))) == ["gates"]
