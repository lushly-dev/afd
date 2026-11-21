"""skill-usage-collect and skill-usage-report, against a store shaped like T3 Code's."""

from __future__ import annotations

import asyncio
import json
import sqlite3
import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from botcore.commands.skill_usage import skill_usage_collect, skill_usage_report, store, t3
from botcore.commands.skill_usage.events import (
    Event,
    skill_of_file,
    skills_read_by,
    typed_skill,
)

SECRET = "the-private-prompt-text"
NOW = datetime.now(UTC)


def stamp(days_ago: float = 0.0, minutes: float = 0.0) -> str:
    moment = NOW - timedelta(days=days_ago) + timedelta(minutes=minutes)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


class T3Store:
    """A store with the tables and columns the reader uses, filled a row at a time."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.count = 0
        with self.connect() as connection:
            connection.executescript(
                f"""
                create table {t3.ITEMS} (turn_item_id text, thread_id text, type text,
                    updated_at text, payload_json text);
                create table {t3.THREADS} (thread_id text, project_id text,
                    default_provider text, payload_json text);
                create table {t3.SUBAGENTS} (thread_id text, child_thread_id text);
                create table {t3.PROJECTS} (project_id text, workspace_root text);
                """
            )

    def connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path)

    def project(self, project_id: str, root: Path) -> None:
        with self.connect() as connection:
            connection.execute(f"insert into {t3.PROJECTS} values (?, ?)", (project_id, str(root)))

    def thread(  # noqa: PLR0913 - one row's columns
        self,
        thread_id: str,
        project_id: str = "p1",
        provider: str = "claudeAgent",
        parent: str | None = None,
        root: str | None = None,
        model: str = "claude-opus-5-5",
    ) -> str:
        payload: dict = {"modelSelection": {"model": model}}
        if parent:
            payload["lineage"] = {"parentThreadId": parent, "rootThreadId": root or parent}
        with self.connect() as connection:
            connection.execute(
                f"insert into {t3.THREADS} values (?, ?, ?, ?)",
                (thread_id, project_id, provider, json.dumps(payload)),
            )
            if parent:
                connection.execute(f"insert into {t3.SUBAGENTS} values (?, ?)", (parent, thread_id))
        return thread_id

    def item(
        self,
        thread_id: str,
        kind: str,
        at: str,
        driver: str | None = "claudeAgent",
        **payload: object,
    ) -> None:
        self.count += 1
        body = {"startedAt": at, "updatedAt": at, **payload}
        if driver:
            body["nativeItemRef"] = {"driver": driver, "nativeId": f"native-{self.count}"}
        with self.connect() as connection:
            connection.execute(
                f"insert into {t3.ITEMS} values (?, ?, ?, ?, ?)",
                (f"item-{self.count}", thread_id, kind, at, json.dumps(body)),
            )

    def skill_tool(self, thread_id: str, skill: str, at: str) -> None:
        self.item(
            thread_id, "dynamic_tool", at, toolName="Skill", input={"skill": skill, "args": SECRET}
        )

    def read_tool(self, thread_id: str, file_path: str, at: str, tool: str = "Read") -> None:
        self.item(thread_id, "dynamic_tool", at, toolName=tool, input={"file_path": file_path})

    def shell(self, thread_id: str, command: str, at: str, driver: str = "codex") -> None:
        self.item(thread_id, "command_execution", at, driver=driver, input=command)

    def message(self, thread_id: str, text: str, at: str, created_by: str = "user") -> None:
        self.item(thread_id, "user_message", at, driver=None, text=text, createdBy=created_by)


@pytest.fixture
def state(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    folder = tmp_path / "state"
    monkeypatch.setenv(store.STATE_ENV, str(folder))
    monkeypatch.setenv(store.MACHINE_ENV, "bench")
    return folder


@pytest.fixture
def checkout(tmp_path: Path) -> Path:
    """A project checkout holding two skills."""
    root = tmp_path / "garden"
    for name, body in (("plant-beds", "x" * 100), ("prune-roses", "y" * 40)):
        folder = root / ".claude" / "skills" / name
        folder.mkdir(parents=True)
        (folder / "SKILL.md").write_text(body, encoding="utf-8")
    return root


@pytest.fixture
def t3_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, checkout: Path) -> T3Store:
    built = T3Store(tmp_path / "statev2.sqlite")
    built.project("p1", checkout)
    monkeypatch.setenv(store.T3_STORE_ENV, str(built.path))
    return built


def run(coro) -> dict:
    result = asyncio.run(coro)
    assert result.success, result.error
    return result.data


def fail(coro) -> object:
    result = asyncio.run(coro)
    assert not result.success
    assert result.error.suggestion
    return result.error


def rows(data: dict) -> dict[str, dict]:
    return {row["skill"]: row for row in data["skills"]}


# ── recognising a load ──────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("command", "expected"),
    [
        ("/bin/zsh -lc \"sed -n '1,200p' .claude/skills/prepare-pr/SKILL.md\"", ["prepare-pr"]),
        ("cat .agents/skills/a/SKILL.md .agents/skills/b/SKILL.md", ["a", "b"]),
        ("nl -ba .claude/skills/a/SKILL.md | sed -n '1,80p'", ["a"]),
        ("cd repo && cat .claude/skills/a/SKILL.md", ["a"]),
        ("echo start; head -40 .claude/skills/a/SKILL.md", ["a"]),
        ('powershell.exe -Command "Get-Content .claude\\skills\\a\\SKILL.md"', ["a"]),
        ("cat .claude/skills/a/SKILL.md; cat .claude/skills/a/SKILL.md", ["a"]),
        ("git show 2a5fd60:.claude/skills/a/SKILL.md", ["a"]),
        ("git -C /repo show origin/main:.claude/skills/a/SKILL.md | sed -n '1,40p'", ["a"]),
        ("git cat-file -p HEAD:.claude/skills/a/SKILL.md", ["a"]),
        ("git show HEAD -- .claude/skills/a/SKILL.md", []),
        ("git log -p -- .claude/skills/a/SKILL.md", []),
        ("rg -n contract .claude/skills/a/SKILL.md", []),
        ("git diff -- .claude/skills/a/SKILL.md", []),
        ("wc -c .claude/skills/*/SKILL.md", []),
        ("cat .claude/skills/a/references/gates.md", []),
        ("cat > .claude/skills/a/SKILL.md <<'EOF'", []),
        ("cat notes.md >> .claude/skills/a/SKILL.md", []),
        ("catalog .claude/skills/a/SKILL.md", []),
    ],
)
def test_a_shell_command_counts_only_when_it_reads_the_skill(
    command: str,
    expected: list[str],
) -> None:
    assert skills_read_by(command) == expected


def test_a_file_path_names_a_skill_only_as_its_skill_file() -> None:
    assert skill_of_file("/work/repo/.claude/skills/plant-beds/SKILL.md") == "plant-beds"
    assert skill_of_file("C:\\work\\repo\\.claude\\skills\\plant-beds\\SKILL.md") == "plant-beds"
    assert skill_of_file("/work/repo/.claude/skills/plant-beds/references/soil.md") is None
    assert skill_of_file("/work/repo/docs/SKILL.md") is None


def test_a_message_names_a_skill_only_at_its_start() -> None:
    assert typed_skill("$end-session") == "end-session"
    assert typed_skill("/prepare-pr quick") == "prepare-pr"
    assert typed_skill("  $run-fleet now") == "run-fleet"
    assert typed_skill("please run $end-session") is None
    assert typed_skill("$PATH is wrong") is None
    assert typed_skill("$5 is too much") == "5"  # the collector decides whether it is a skill


# ── collecting ──────────────────────────────────────────────────────────────


def test_collect_records_each_way_a_skill_is_loaded(state: Path, t3_store: T3Store) -> None:
    main = t3_store.thread("main-1")
    t3_store.skill_tool(main, "plant-beds", stamp(1))
    t3_store.read_tool(main, "/w/.claude/skills/prune-roses/SKILL.md", stamp(1, 1))
    t3_store.shell(
        main,
        f"cat .claude/skills/plant-beds/SKILL.md # {SECRET}",
        stamp(1, 2),
        driver="claudeAgent",
    )
    t3_store.message(main, f"$plant-beds {SECRET}", stamp(1, 3))

    data = run(skill_usage_collect())
    events, unreadable = store.load_events(state)

    assert data["added"] == 4 and unreadable == 0
    assert data["sources"][0]["status"] == "read"
    assert sorted((event.skill, event.path) for event in events) == [
        ("plant-beds", "shell_read"),
        ("plant-beds", "skill_tool"),
        ("plant-beds", "typed"),
        ("prune-roses", "file_read"),
    ]
    assert {event.harness for event in events} == {"claude"}
    assert {(event.project, event.machine, event.agent) for event in events} == {
        ("garden", "bench", "main")
    }
    assert {event.model for event in events} == {"claude-opus-5-5"}


def test_the_record_holds_no_prompt_command_or_argument(state: Path, t3_store: T3Store) -> None:
    main = t3_store.thread("main-1")
    t3_store.skill_tool(main, "plant-beds", stamp(1))
    t3_store.shell(main, f"cat .claude/skills/plant-beds/SKILL.md # {SECRET}", stamp(1, 1))
    t3_store.message(main, f"$plant-beds {SECRET}", stamp(1, 2))

    run(skill_usage_collect())

    for name in (store.EVENTS_FILE, store.STATE_FILE):
        assert SECRET not in (state / name).read_text(encoding="utf-8")


def test_an_edit_a_search_or_another_tool_is_not_a_load(state: Path, t3_store: T3Store) -> None:
    main = t3_store.thread("main-1")
    t3_store.read_tool(main, "/w/.claude/skills/plant-beds/SKILL.md", stamp(1), tool="Edit")
    t3_store.read_tool(main, "/w/.claude/skills/plant-beds/SKILL.md", stamp(1, 1), tool="Write")
    t3_store.shell(main, "rg -n soil .claude/skills/plant-beds/SKILL.md", stamp(1, 2))
    t3_store.item(
        main,
        "dynamic_tool",
        stamp(1, 3),
        toolName="Grep",
        input={"pattern": "Skill", "path": ".claude/skills/plant-beds/SKILL.md"},
    )

    assert run(skill_usage_collect())["added"] == 0


def test_a_subagent_counts_under_its_session_and_a_delegate_is_its_own(
    state: Path,
    t3_store: T3Store,
) -> None:
    main = t3_store.thread("main-1")
    reviewer = t3_store.thread("thread:subagent:r1", parent=main)
    cell = t3_store.thread(
        "thread:delegated-task:c1", parent=main, provider="codex", model="gpt-6.2-sol"
    )
    helper = t3_store.thread("thread:provider:codex:h1", parent=cell, root=main, provider="codex")
    t3_store.read_tool(reviewer, "/w/.claude/skills/plant-beds/SKILL.md", stamp(1))
    t3_store.shell(cell, "cat .claude/skills/plant-beds/SKILL.md", stamp(1, 1))
    t3_store.shell(helper, "cat .claude/skills/prune-roses/SKILL.md", stamp(1, 2))

    run(skill_usage_collect())
    events = {event.agent + ":" + event.skill: event for event in store.load_events(state)[0]}

    assert events["subagent:plant-beds"].thread == main
    assert events["delegate:plant-beds"].thread == cell
    assert events["delegate:plant-beds"].root == main
    assert events["delegate:plant-beds"].harness == "codex"
    assert events["delegate:plant-beds"].model == "gpt-6.2-sol"
    assert events["subagent:prune-roses"].thread == cell
    assert events["subagent:prune-roses"].root == main


def test_a_typed_name_counts_only_when_it_is_a_skill(state: Path, t3_store: T3Store) -> None:
    main = t3_store.thread("main-1")
    t3_store.message(main, "$prune-roses", stamp(1))  # held by the checkout
    t3_store.message(main, "$water-lawn", stamp(1, 1))  # loaded another way below
    t3_store.skill_tool(main, "water-lawn", stamp(1, 2))
    t3_store.message(main, "$5 is too much", stamp(1, 3))
    t3_store.message(main, "$HOME is unset", stamp(1, 4))
    t3_store.message(main, "/compact", stamp(1, 5))
    t3_store.message(main, "$plant-beds", stamp(1, 6), created_by="agent")  # one agent's brief

    run(skill_usage_collect())
    typed = sorted(e.skill for e in store.load_events(state)[0] if e.path == "typed")

    assert typed == ["prune-roses", "water-lawn"]


def test_collecting_again_adds_only_what_is_new(state: Path, t3_store: T3Store) -> None:
    main = t3_store.thread("main-1")
    t3_store.skill_tool(main, "plant-beds", stamp(3))
    assert run(skill_usage_collect())["added"] == 1
    assert run(skill_usage_collect())["added"] == 0

    t3_store.skill_tool(main, "prune-roses", stamp(0))
    again = run(skill_usage_collect())

    assert again["added"] == 1 and again["events"] == 2
    assert again["sources"][0]["since"] is not None
    assert len((state / store.EVENTS_FILE).read_text(encoding="utf-8").splitlines()) == 2


def test_a_weekly_full_read_finds_a_thread_older_than_the_last_collection(
    state: Path,
    t3_store: T3Store,
) -> None:
    main = t3_store.thread("main-1")
    t3_store.skill_tool(main, "plant-beds", stamp(0))
    run(skill_usage_collect())
    t3_store.skill_tool(main, "prune-roses", stamp(20))  # arrives with a thread moved here

    assert run(skill_usage_collect())["added"] == 0  # older than what an hourly run re-reads
    saved = store.load_state(state)
    saved["sources"][t3.SOURCE]["full_at"] = stamp(8)
    store.save_state(state, saved)
    weekly = run(skill_usage_collect())

    assert weekly["added"] == 1 and weekly["sources"][0]["since"] is None


def test_since_days_rereads_and_still_adds_nothing_twice(state: Path, t3_store: T3Store) -> None:
    main = t3_store.thread("main-1")
    t3_store.skill_tool(main, "plant-beds", stamp(10))
    run(skill_usage_collect())

    again = run(skill_usage_collect(since_days=30))

    assert again["sources"][0]["found"] == 1 and again["added"] == 0


def test_collect_survives_a_machine_without_t3_code(
    state: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(store.T3_STORE_ENV, str(tmp_path / "missing.sqlite"))
    assert run(skill_usage_collect())["sources"][0]["status"] == "absent"

    monkeypatch.setenv(store.T3_STORE_ENV, "")
    assert run(skill_usage_collect())["sources"][0]["status"] == "off"


def test_collect_refuses_a_store_it_cannot_trust(
    state: Path,
    t3_store: T3Store,
    tmp_path: Path,
) -> None:
    main = t3_store.thread("main-1")
    t3_store.skill_tool(main, "plant-beds", stamp(1))
    run(skill_usage_collect())

    assert fail(skill_usage_collect(t3_store=str(tmp_path / "nowhere.sqlite"))).code == (
        "SOURCE_NOT_FOUND"
    )
    assert fail(skill_usage_collect(since_days=-1)).code == "INVALID_INPUT"

    garbage = tmp_path / "garbage.sqlite"
    garbage.write_bytes(b"this is not a database" * 100)
    assert fail(skill_usage_collect(t3_store=str(garbage))).code == "SOURCE_UNREADABLE"

    with t3_store.connect() as connection:
        connection.execute(f"alter table {t3.ITEMS} rename column payload_json to body")
    changed = fail(skill_usage_collect())
    assert changed.code == "SOURCE_SCHEMA_CHANGED"
    assert f"{t3.ITEMS}.payload_json" in changed.message
    assert len(store.load_events(state)[0]) == 1  # what was collected before is kept


def test_the_store_is_opened_read_only(t3_store: T3Store) -> None:
    connection = t3.open_store(t3_store.path)
    with pytest.raises(sqlite3.OperationalError):
        connection.execute(f"delete from {t3.ITEMS}")
    connection.close()


# ── the record ──────────────────────────────────────────────────────────────


def test_the_record_skips_what_it_cannot_read_and_keeps_each_id_once(state: Path) -> None:
    event = Event(
        id="a",
        at=stamp(1),
        skill="plant-beds",
        path="skill_tool",
        harness="claude",
        source="t3-code",
        thread="t",
        root="t",
        agent="main",
        project="garden",
        machine="bench",
    )
    store.append_events(state, [event, event])
    with (state / store.EVENTS_FILE).open("a", encoding="utf-8") as handle:
        handle.write('not json\n[1, 2]\n{"id": "b"}\n\n')

    events, unreadable = store.load_events(state)

    assert events == [event] and unreadable == 3


# ── reporting ───────────────────────────────────────────────────────────────


def test_report_needs_a_collection_first(state: Path) -> None:
    assert fail(skill_usage_report()).code == "NOT_COLLECTED"
    assert fail(skill_usage_report(days=0)).code == "INVALID_INPUT"


def test_report_counts_sessions_not_reads(state: Path, t3_store: T3Store) -> None:
    main = t3_store.thread("main-1")
    other = t3_store.thread("main-2", provider="codex")
    reviewer = t3_store.thread("thread:subagent:r1", parent=main)
    for minute, part in enumerate(("1,80p", "81,160p", "161,240p")):
        t3_store.shell(
            main,
            f"sed -n '{part}' .claude/skills/plant-beds/SKILL.md",
            stamp(1, minute),
            driver="claudeAgent",
        )
    t3_store.read_tool(reviewer, "/w/.claude/skills/plant-beds/SKILL.md", stamp(1, 5))
    t3_store.shell(other, "cat .claude/skills/plant-beds/SKILL.md", stamp(2))
    t3_store.message(other, "$plant-beds", stamp(2, 1))
    run(skill_usage_collect())

    data = run(skill_usage_report(days=30))
    row = rows(data)["plant-beds"]

    assert row["threads"] == 2 and row["loads"] == 5 and row["typed_threads"] == 1
    assert row["harnesses"] == {"claude": 1, "codex": 1}
    assert row["agents"] == {"main": 4, "subagent": 1}
    assert row["paths"] == {"file_read": 1, "shell_read": 4}
    assert row["size_bytes"] == 100 and row["context_bytes"] == 500
    assert data["totals"]["threads"] == 2 and data["totals"]["loads"] == 5
    assert data["record"]["machines"] == ["bench"]
    assert data["warnings"] == []


def test_report_lists_the_skills_nothing_loaded(state: Path, t3_store: T3Store) -> None:
    main = t3_store.thread("main-1")
    t3_store.skill_tool(main, "plant-beds", stamp(2))
    t3_store.skill_tool(main, "prune-roses", stamp(45))
    run(skill_usage_collect())

    data = run(skill_usage_report(days=30))

    assert list(rows(data)) == ["plant-beds"]
    assert data["quiet"] == [{"project": "garden", "skill": "prune-roses", "last_used": stamp(45)}]
    assert rows(run(skill_usage_report(days=60))).keys() == {"plant-beds", "prune-roses"}


def test_report_narrows_by_project_and_harness(
    state: Path,
    t3_store: T3Store,
    tmp_path: Path,
) -> None:
    t3_store.project("p2", tmp_path / "shed")
    main = t3_store.thread("main-1")
    elsewhere = t3_store.thread("main-2", project_id="p2", provider="codex")
    t3_store.skill_tool(main, "plant-beds", stamp(1))
    t3_store.shell(elsewhere, "cat .claude/skills/sharpen-tools/SKILL.md", stamp(1))
    run(skill_usage_collect())

    assert {row["project"] for row in run(skill_usage_report())["skills"]} == {"garden", "shed"}
    assert list(rows(run(skill_usage_report(project="shed")))) == ["sharpen-tools"]
    assert list(rows(run(skill_usage_report(harness="claude")))) == ["plant-beds"]
    assert run(skill_usage_report(project="shed"))["quiet"] == []


def git(root: Path, *args: str) -> None:
    subprocess.run(
        [
            "git",
            "-C",
            str(root),
            "-c",
            "user.name=T",
            "-c",
            "user.email=t@example.com",
            "-c",
            "commit.gpgsign=false",
            *args,
        ],
        check=True,
        capture_output=True,
    )


def test_a_renamed_skill_keeps_one_identity(state: Path, t3_store: T3Store, checkout: Path) -> None:
    skills = checkout / ".claude" / "skills"
    (skills / "plant-beds" / "SKILL.md").write_text("bed rules\n" * 30, encoding="utf-8")
    git(checkout, "init", "-q", "-b", "main")
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "skills")
    git(checkout, "mv", ".claude/skills/plant-beds", ".claude/skills/build-beds")
    git(checkout, "commit", "-q", "-m", "rename")
    main = t3_store.thread("main-1")
    later = t3_store.thread("main-2")
    t3_store.skill_tool(main, "plant-beds", stamp(20))
    t3_store.skill_tool(later, "build-beds", stamp(1))
    t3_store.skill_tool(later, "audit-security", stamp(1, 1))  # botcore renamed this one
    run(skill_usage_collect())

    found = rows(run(skill_usage_report(days=30)))

    assert found["build-beds"]["threads"] == 2
    assert found["build-beds"]["also_loaded_as"] == ["plant-beds"]
    assert found["security-auditor"]["also_loaded_as"] == ["audit-security"]
    assert "plant-beds" not in found


def test_a_name_the_checkout_still_holds_is_not_renamed(
    state: Path,
    t3_store: T3Store,
    checkout: Path,
) -> None:
    folder = checkout / ".claude" / "skills" / "audit-security"
    folder.mkdir()
    (folder / "SKILL.md").write_text("ours", encoding="utf-8")
    t3_store.skill_tool(t3_store.thread("main-1"), "audit-security", stamp(1))
    run(skill_usage_collect())

    assert "audit-security" in rows(run(skill_usage_report()))


def test_report_warns_when_the_record_is_old(state: Path, t3_store: T3Store) -> None:
    t3_store.skill_tool(t3_store.thread("main-1"), "plant-beds", stamp(1))
    run(skill_usage_collect())
    saved = store.load_state(state)
    saved["collected_at"] = stamp(3)
    store.save_state(state, saved)
    with (state / store.EVENTS_FILE).open("a", encoding="utf-8") as handle:
        handle.write("not json\n")

    warnings = run(skill_usage_report())["warnings"]

    assert len(warnings) == 2
    assert "skill-usage-collect" in warnings[0] and "1 lines" in warnings[1]
