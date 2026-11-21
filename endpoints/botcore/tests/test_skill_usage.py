"""skill-usage-collect and skill-usage-report, against a store shaped like T3 Code's."""

from __future__ import annotations

import asyncio
import json
import sqlite3
import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from click.testing import CliRunner

from botcore.cli import cli
from botcore.commands.disk.lock import RunLock
from botcore.commands.skill_usage import skill_usage_collect, skill_usage_report, store, t3
from botcore.commands.skill_usage.events import (
    Event,
    clean_skill_name,
    skill_of_file,
    skills_read_by,
    typed_skill,
)

SECRET = "the-private-prompt-text"
NOW = datetime.now(UTC)
FILE = ".claude/skills/a/SKILL.md"
WINDOWS_FILE = ".claude\\skills\\a\\SKILL.md"


def stamp(days_ago: float = 0.0, minutes: float = 0.0) -> str:
    moment = NOW - timedelta(days=days_ago) + timedelta(minutes=minutes)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


class T3Store:
    """A store with the tables and columns the reader uses, filled a row at a time."""

    def __init__(self, path: Path, prefix: str = "item") -> None:
        self.path = path
        self.prefix = prefix  # T3 Code's ids are unique across machines; a test's must be too
        self.count = 0
        with self.connect() as connection:
            connection.executescript(
                f"""
                create table {t3.ITEMS} (turn_item_id text, thread_id text, run_id text,
                    type text, updated_at text, payload_json text);
                create table {t3.THREADS} (thread_id text, project_id text,
                    default_provider text, payload_json text);
                create table {t3.SUBAGENTS} (thread_id text, child_thread_id text);
                create table {t3.RUNS} (run_id text, payload_json text);
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
        relationship: str = "subagent",
        delegated_from: str | None = None,
        lineage: bool = True,
        model: str | None = None,
        extra: dict | None = None,
    ) -> str:
        payload: dict = {"modelSelection": {"model": model}} if model else {}
        payload.update(extra or {})
        if parent and lineage:
            payload["lineage"] = {"parentThreadId": parent, "relationshipToParent": relationship}
        if delegated_from:
            payload["delegatedFrom"] = {"environmentId": "elsewhere", "threadId": delegated_from}
        with self.connect() as connection:
            connection.execute(
                f"insert into {t3.THREADS} values (?, ?, ?, ?)",
                (thread_id, project_id, provider, json.dumps(payload)),
            )
            if parent:
                connection.execute(f"insert into {t3.SUBAGENTS} values (?, ?)", (parent, thread_id))
        return thread_id

    def run(self, run_id: str, model: str) -> str:
        with self.connect() as connection:
            connection.execute(
                f"insert into {t3.RUNS} values (?, ?)",
                (run_id, json.dumps({"modelSelection": {"model": model}})),
            )
        return run_id

    def item(  # noqa: PLR0913 - one row's columns
        self,
        thread_id: str,
        kind: str,
        at: str,
        driver: str | None = "claudeAgent",
        run_id: str | None = None,
        native_id: str | None = None,
        **payload: object,
    ) -> str:
        self.count += 1
        item_id = f"{self.prefix}-{self.count}"
        body = {"startedAt": at, "updatedAt": at, "status": "completed", **payload}
        if driver:
            body["nativeItemRef"] = {"driver": driver, "nativeId": native_id or f"n-{self.count}"}
        with self.connect() as connection:
            connection.execute(
                f"insert into {t3.ITEMS} values (?, ?, ?, ?, ?, ?)",
                (item_id, thread_id, run_id, kind, at, json.dumps(body)),
            )
        return item_id

    def skill_tool(self, thread_id: str, skill: str, at: str, **more: object) -> str:
        return self.item(
            thread_id, t3.TOOL, at, toolName="Skill", input={"skill": skill, "args": SECRET}, **more
        )

    def read_tool(
        self, thread_id: str, file_path: str, at: str, tool: str = "Read", key: str = "file_path"
    ) -> str:
        return self.item(thread_id, t3.TOOL, at, toolName=tool, input={key: file_path})

    def shell(
        self, thread_id: str, command: str, at: str, driver: str = "codex", **more: object
    ) -> str:
        return self.item(thread_id, t3.COMMAND, at, driver=driver, input=command, **more)

    def message(self, thread_id: str, text: str, at: str, created_by: str = "user") -> str:
        return self.item(thread_id, t3.MESSAGE, at, driver=None, text=text, createdBy=created_by)

    def update(self, item_id: str, at: str, **changes: object) -> None:
        with self.connect() as connection:
            row = connection.execute(
                f"select payload_json from {t3.ITEMS} where turn_item_id = ?", (item_id,)
            ).fetchone()
            body = {**json.loads(row[0]), **changes}
            connection.execute(
                f"update {t3.ITEMS} set payload_json = ?, updated_at = ? where turn_item_id = ?",
                (json.dumps(body), at, item_id),
            )


@pytest.fixture
def state(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    folder = tmp_path / "state"
    monkeypatch.setenv(store.STATE_ENV, str(folder))
    monkeypatch.setenv(store.MACHINE_ENV, "bench")
    return folder


def skill_text(name: str, description: str, size: int) -> str:
    head = f"---\nname: {name}\ndescription: {description}\n---\n"
    return head + "x" * (size - len(head))


def checkout_at(root: Path) -> Path:
    for name, description, size in (
        ("plant-beds", "Plant a bed.", 200),
        ("prune-roses", "Prune the roses.", 120),
    ):
        folder = root / ".claude" / "skills" / name
        folder.mkdir(parents=True)
        (folder / "SKILL.md").write_text(skill_text(name, description, size), encoding="utf-8")
    return root


@pytest.fixture
def checkout(tmp_path: Path) -> Path:
    """A project checkout holding two skills."""
    return checkout_at(tmp_path / "garden")


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


def collected(state: Path) -> list[Event]:
    return store.load_events(state)[0]


def git(root: Path, *args: str) -> None:
    subprocess.run(
        ["git", "-C", str(root), "-c", "user.name=T", "-c", "user.email=t@example.com",
         "-c", "commit.gpgsign=false", *args],
        check=True, capture_output=True,
    )  # fmt: skip


# ── recognising a load ──────────────────────────────────────────────────────

POWERSHELL = "C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"


@pytest.mark.parametrize(
    "command",
    [
        f"/bin/zsh -lc \"sed -n '1,200p' {FILE}\"",
        f"nl -ba {FILE} | sed -n '1,80p'",
        f"cd repo && cat {FILE}",
        f"echo start; head -40 {FILE}",
        f"/bin/cat {FILE}",
        f"cat < {FILE}",
        f"sed -n '1,200p;' {FILE}",
        f"awk 'NR>=1 && NR<=120' {FILE}",
        f"/bin/zsh -lc \"awk 'NR>=1 && NR<=120' {FILE}\"",
        f'/opt/homebrew/bin/bash -lc "cat {FILE}"',
        f'/usr/bin/env bash -lc "cat {FILE}"',
        f'bash -c -- "cat {FILE}"',
        f"cat {FILE} 2>/dev/null",
        f"tail -f {FILE}",
        f"/bin/zsh -lc 'node -e '\"'\"'console.log(1|2)'\"'\"'; cat {FILE}'",
        f"/bin/zsh -lc \"python3 - <<'PY'\nprint('x')\nPY\ncat {FILE}\"",
        f"python3 - <<'PY'\nprint('x')\nPY\ncat {FILE}",
        f'$x = @"\ncat nothing\n"@\nGet-Content {WINDOWS_FILE}',
        f'zsh -lc "cat {FILE}" && echo done',
        f"cat <<< 'hi'\ncat {FILE}",
        f"cat <<A <<B\nfirst\nA\nsecond\nB\ncat {FILE}",
        f"cat {FILE} 2>&1 | head -50",
        f"cat {FILE}; cat {FILE}",
        f"git show 2a5fd60:{FILE}",
        f"git -C /repo show origin/main:{FILE} | sed -n '1,40p'",
        f"git cat-file -p HEAD:{FILE}",
        f'powershell.exe -Command "Get-Content {WINDOWS_FILE}"',
        f'{POWERSHELL} -Command "Get-Content {WINDOWS_FILE}"',
        f'"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "Get-Content -Raw {WINDOWS_FILE}"',
        f'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "gc {WINDOWS_FILE}"',
        f"cmd /c type {WINDOWS_FILE}",
        f"& Get-Content -LiteralPath {WINDOWS_FILE}",
    ],
)
def test_a_command_that_shows_the_skill_is_a_load(command: str) -> None:
    assert skills_read_by(command) == ["a"]


@pytest.mark.parametrize(
    "command",
    [
        f"rg -n contract {FILE}",
        f"git diff -- {FILE}",
        f"git show HEAD -- {FILE}",
        f"git log -p -- {FILE}",
        f"git show --stat HEAD:{FILE}",
        "wc -c .claude/skills/*/SKILL.md",
        "cat .claude/skills/a/references/gates.md",
        f"cat {FILE}.bak",
        f"cat {FILE}x",
        "cat /noskills/a/SKILL.md",
        f"catalog {FILE}",
        f"cat > {FILE} <<'EOF'\nbody\nEOF",
        f"cat notes.md >> {FILE}",
        f'Get-Content notes.md > "{WINDOWS_FILE}"',
        f"cat {FILE} > /dev/null",
        f"cat {FILE} | wc -c",
        f"cat {FILE} | Out-Null",
        f"cat {FILE} | head -5 | grep soil",
        f"cat {FILE} | head -5 > out.txt",
        f'zsh -lc "cat {FILE}" | wc -c',
        f"sed -f {FILE} notes.md",
        f"awk -f {FILE} notes.md",
        f"/bin/zsh -lc \"python3 - <<'PY'\nprint('cat {FILE}')\nPY\"",
        f'$x = @"\ncat {FILE}\n"@\nWrite-Output $x.Length',
        f'$p = "C:\\dir\\"\n$x = @"\ncat {FILE}\n"@\nWrite-Output $x.Length',
        f"cat <<A <<B\nfirst\nA\ncat {FILE}\nB",
        f"sed -n '1,5p' {FILE} | grep soil",
        f"sed -i '' 's/a/b/' {FILE}",
        f"cat /dev/null # {FILE}",
        f"head -1 notes.md # {FILE}",
        f'echo "x; cat {FILE}"',
        f'python3 - <<\'PY\'\nprint("cat {FILE}")\n("cat {FILE}\nPY',
    ],
)
def test_a_command_that_only_names_the_skill_is_not_a_load(command: str) -> None:
    assert skills_read_by(command) == []


def test_a_command_can_show_several_skills() -> None:
    command = "cat .agents/skills/a/SKILL.md .agents/skills/b/SKILL.md"
    assert skills_read_by(command) == ["a", "b"]


def test_a_file_path_names_a_skill_only_as_its_skill_file() -> None:
    assert skill_of_file("/work/repo/.claude/skills/plant-beds/SKILL.md") == "plant-beds"
    assert skill_of_file("C:\\work\\repo\\.claude\\skills\\plant-beds\\SKILL.md") == "plant-beds"
    assert skill_of_file("skills/plant-beds/SKILL.md") == "plant-beds"
    assert skill_of_file("/work/repo/.claude/skills/plant-beds/references/soil.md") is None
    assert skill_of_file("/work/repo/docs/SKILL.md") is None
    assert skill_of_file("/work/noskills/plant-beds/SKILL.md") is None
    assert skill_of_file("/work/skills/plant-beds/SKILL.md.bak") is None


def test_a_skill_input_is_kept_only_when_it_is_a_name() -> None:
    assert clean_skill_name("plant-beds") == "plant-beds"
    assert clean_skill_name("garden-tools:plant-beds") == "garden-tools:plant-beds"
    assert clean_skill_name(".claude/worktrees/task-594:plant-beds") == "plant-beds"
    assert clean_skill_name(f"plant-beds --note {SECRET}") is None
    assert clean_skill_name("a:b:c") is None
    assert clean_skill_name("") is None


def test_a_message_names_a_skill_only_at_its_start() -> None:
    assert typed_skill("$end-session") == "end-session"
    assert typed_skill("/prepare-pr quick") == "prepare-pr"
    assert typed_skill("  $run-fleet now") == "run-fleet"
    assert typed_skill("$garden-tools:plant-beds") == "garden-tools:plant-beds"
    assert typed_skill("please run $end-session") is None
    assert typed_skill("$ is the prompt") is None


# ── collecting ──────────────────────────────────────────────────────────────


def test_collect_records_each_way_a_skill_is_loaded(state: Path, t3_store: T3Store) -> None:
    main = t3_store.thread("main-1")
    first = t3_store.run("run-1", "claude-opus-5-5")
    t3_store.skill_tool(main, "plant-beds", stamp(1), run_id=first, native_id="toolu_1")
    t3_store.read_tool(main, "/w/.claude/skills/prune-roses/SKILL.md", stamp(1, 1))
    t3_store.read_tool(main, "/w/.claude/skills/prune-roses/SKILL.md", stamp(1, 2), key="filePath")
    t3_store.shell(main, f"cat .claude/skills/plant-beds/SKILL.md # {SECRET}", stamp(1, 3))
    t3_store.message(main, f"$plant-beds {SECRET}", stamp(1, 4))

    data = run(skill_usage_collect())
    events = collected(state)

    assert data["added"] == 5 and data["sources"][0]["status"] == "read"
    assert sorted((event.skill, event.path, event.harness) for event in events) == [
        ("plant-beds", "shell_read", "codex"),
        ("plant-beds", "skill_tool", "claude"),
        ("plant-beds", "typed", "claude"),
        ("prune-roses", "file_read", "claude"),
        ("prune-roses", "file_read", "claude"),
    ]
    assert {(event.project, event.machine, event.agent) for event in events} == {
        ("garden", "bench", "main")
    }
    tool = next(event for event in events if event.path == "skill_tool")
    assert tool.model == "claude-opus-5-5" and tool.native == "claude:toolu_1"
    assert {event.model for event in events if event.path != "skill_tool"} == {None}


def test_the_record_holds_no_prompt_command_or_argument(state: Path, t3_store: T3Store) -> None:
    main = t3_store.thread("main-1")
    t3_store.skill_tool(main, "plant-beds", stamp(1))
    t3_store.skill_tool(main, f"plant-beds --note {SECRET}", stamp(1, 1))  # a malformed input
    t3_store.shell(main, f"cat .claude/skills/plant-beds/SKILL.md # {SECRET}", stamp(1, 2))
    t3_store.message(main, f"$plant-beds {SECRET}", stamp(1, 3))

    assert run(skill_usage_collect())["added"] == 3

    for name in (store.EVENTS_FILE, store.STATE_FILE):
        assert SECRET not in (state / name).read_text(encoding="utf-8")


def test_an_edit_a_search_or_another_tool_is_not_a_load(state: Path, t3_store: T3Store) -> None:
    main = t3_store.thread("main-1")
    t3_store.read_tool(main, "/w/.claude/skills/plant-beds/SKILL.md", stamp(1), tool="Edit")
    t3_store.read_tool(main, "/w/.claude/skills/plant-beds/SKILL.md", stamp(1, 1), tool="Write")
    t3_store.read_tool(main, "/w/noskills/plant-beds/SKILL.md", stamp(1, 2))
    t3_store.shell(main, "rg -n soil .claude/skills/plant-beds/SKILL.md", stamp(1, 3))
    t3_store.item(
        main, t3.TOOL, stamp(1, 4), toolName="Grep",
        input={"pattern": "Skill", "path": ".claude/skills/plant-beds/SKILL.md"},
    )  # fmt: skip

    assert run(skill_usage_collect())["added"] == 0


def test_a_load_counts_once_it_completed(state: Path, t3_store: T3Store) -> None:
    main = t3_store.thread("main-1")
    t3_store.skill_tool(main, "plant-beds", stamp(1), status="failed")
    t3_store.shell(main, "cat .claude/skills/plant-beds/SKILL.md", stamp(1, 1), driver="codex")
    running = t3_store.skill_tool(main, "prune-roses", stamp(0, -5), status="running")
    cancelled = t3_store.shell(main, "cat .claude/skills/prune-roses/SKILL.md", stamp(1, 2))
    t3_store.update(cancelled, stamp(1, 2), status="cancelled")

    assert run(skill_usage_collect())["added"] == 1
    t3_store.update(running, stamp(0), status="completed")

    assert run(skill_usage_collect())["added"] == 1
    assert sorted(event.skill for event in collected(state)) == ["plant-beds", "prune-roses"]


def test_a_subagent_counts_under_its_session_and_a_delegate_is_its_own(
    state: Path, t3_store: T3Store
) -> None:
    main = t3_store.thread("main-1")
    reviewer = t3_store.thread("thread:subagent:r1", parent=main, model="claude-opus-5-5")
    cell = t3_store.thread(
        "thread:delegated-task:c1", parent=main, provider="codex", model="gpt-6.2-sol"
    )
    helper = t3_store.thread("thread:provider:codex:h1", parent=cell, provider="codex")
    t3_store.read_tool(reviewer, "/w/.claude/skills/plant-beds/SKILL.md", stamp(1))
    t3_store.shell(cell, "cat .claude/skills/plant-beds/SKILL.md", stamp(1, 1))
    t3_store.shell(helper, "cat .claude/skills/prune-roses/SKILL.md", stamp(1, 2))

    run(skill_usage_collect())
    events = {event.agent + ":" + event.skill: event for event in collected(state)}

    assert events["subagent:plant-beds"].thread == main
    assert events["subagent:plant-beds"].model == "claude-opus-5-5"  # it cannot switch
    assert events["delegate:plant-beds"].model is None  # a session can: only a run says
    assert events["delegate:plant-beds"].thread == cell
    assert events["delegate:plant-beds"].root == main
    assert events["delegate:plant-beds"].harness == "codex"
    assert events["subagent:prune-roses"].thread == cell
    assert events["subagent:prune-roses"].root == main


def test_a_fork_and_a_task_from_another_machine_are_sessions_of_their_own(
    state: Path, t3_store: T3Store
) -> None:
    main = t3_store.thread("main-1")
    fork = t3_store.thread("fork-1", parent=main, relationship="fork")
    remote = t3_store.thread("mcp:launch:abc", delegated_from="thread-on-the-other-machine")
    inside = t3_store.thread("thread:subagent:s1", parent=remote)
    t3_store.skill_tool(fork, "plant-beds", stamp(1))
    t3_store.skill_tool(remote, "prune-roses", stamp(1, 1))
    t3_store.skill_tool(inside, "plant-beds", stamp(1, 2))

    run(skill_usage_collect())
    events = {event.thread + ":" + event.agent: event for event in collected(state)}

    assert events["fork-1:main"].root == fork
    assert events["mcp:launch:abc:delegate"].root == "thread-on-the-other-machine"
    assert events["mcp:launch:abc:subagent"].root == "thread-on-the-other-machine"


def test_a_thread_with_no_lineage_is_placed_by_the_subagent_table(
    state: Path, t3_store: T3Store
) -> None:
    main = t3_store.thread("main-1")
    child = t3_store.thread("thread:subagent:old", parent=main, lineage=False)
    t3_store.skill_tool(child, "plant-beds", stamp(1))

    run(skill_usage_collect())
    (event,) = collected(state)

    assert (event.thread, event.root, event.agent) == (main, main, "subagent")


def test_a_typed_name_counts_only_when_it_is_a_skill_and_a_person_typed_it(
    state: Path, t3_store: T3Store
) -> None:
    main = t3_store.thread("main-1", provider="codex")
    t3_store.message(main, "$prune-roses", stamp(1))  # held by the checkout
    t3_store.message(main, "$water-lawn", stamp(1, 1))  # loaded another way below
    t3_store.skill_tool(main, "water-lawn", stamp(1, 2))
    t3_store.message(main, "$5 is too much", stamp(1, 3))
    t3_store.message(main, "$HOME is unset", stamp(1, 4))
    t3_store.message(main, "/compact", stamp(1, 5))
    t3_store.message(main, "$plant-beds", stamp(1, 6), created_by="agent")  # one agent's brief
    t3_store.message(main, "$plant-beds", stamp(1, 7), created_by="system")

    run(skill_usage_collect())
    typed = {event.skill: event for event in collected(state) if event.path == "typed"}

    assert sorted(typed) == ["prune-roses", "water-lawn"]
    assert typed["prune-roses"].harness == "codex"  # from the thread: a message has no driver


def test_a_typed_name_the_record_already_knows_is_a_skill(state: Path, t3_store: T3Store) -> None:
    main = t3_store.thread("main-1")
    t3_store.skill_tool(main, "water-lawn", stamp(3))  # not held by the checkout
    run(skill_usage_collect())
    t3_store.message(main, "$water-lawn", stamp(0))

    assert run(skill_usage_collect())["added"] == 1
    assert [event.path for event in collected(state)] == ["skill_tool", "typed"]


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


def test_two_items_recorded_at_the_same_moment_are_two_loads(
    state: Path, t3_store: T3Store
) -> None:
    main, other = t3_store.thread("main-1"), t3_store.thread("main-2")
    t3_store.skill_tool(main, "plant-beds", stamp(1), native_id="toolu_same")
    t3_store.skill_tool(other, "plant-beds", stamp(1), native_id="toolu_same")
    t3_store.item(main, t3.COMMAND, stamp(1), driver=None,
                  input="cat .claude/skills/plant-beds/SKILL.md")  # fmt: skip
    t3_store.item(main, t3.COMMAND, stamp(1), driver=None,
                  input="cat .claude/skills/plant-beds/SKILL.md")  # fmt: skip

    assert run(skill_usage_collect())["added"] == 4
    assert len({event.id for event in collected(state)}) == 4


def test_a_weekly_full_read_finds_a_thread_older_than_the_last_collection(
    state: Path, t3_store: T3Store
) -> None:
    main = t3_store.thread("main-1")
    t3_store.skill_tool(main, "plant-beds", stamp(0))
    run(skill_usage_collect())
    t3_store.skill_tool(main, "prune-roses", stamp(20))  # arrives with a thread moved here

    assert run(skill_usage_collect())["added"] == 0  # older than what an hourly run re-reads
    saved = store.load_state(state)
    saved["sources"][t3.SOURCE]["stores"][str(t3_store.path)]["full_at"] = stamp(8)
    store.save_state(state, saved)
    weekly = run(skill_usage_collect())

    assert weekly["added"] == 1 and weekly["sources"][0]["since"] is None


def test_since_days_rereads_and_still_adds_nothing_twice(state: Path, t3_store: T3Store) -> None:
    main = t3_store.thread("main-1")
    t3_store.skill_tool(main, "plant-beds", stamp(10))
    run(skill_usage_collect())

    again = run(skill_usage_collect(since_days=30))

    assert again["sources"][0]["found"] == 1 and again["added"] == 0


def test_another_store_is_read_from_its_start_under_its_machine(
    state: Path, t3_store: T3Store, tmp_path: Path
) -> None:
    t3_store.skill_tool(t3_store.thread("main-1"), "plant-beds", stamp(0))
    run(skill_usage_collect())
    before = store.load_state(state)["sources"][t3.SOURCE]["stores"][str(t3_store.path)]
    copied = T3Store(tmp_path / "copied.sqlite")
    copied.project("p9", tmp_path / "garden")
    copied.skill_tool(copied.thread("far-1", project_id="p9"), "prune-roses", stamp(40))

    unnamed = fail(skill_usage_collect(t3_store=str(copied.path)))
    assert unnamed.code == "INVALID_INPUT" and "machine" in unnamed.suggestion
    other = run(skill_usage_collect(t3_store=str(copied.path), machine="shed"))

    assert other["added"] == 1 and other["sources"][0]["since"] is None
    assert {event.machine for event in collected(state)} == {"bench", "shed"}
    stores = store.load_state(state)["sources"][t3.SOURCE]["stores"]
    assert stores[str(t3_store.path)] == before and str(copied.path) in stores


def test_a_machine_without_t3_code_collects_nothing_and_stays_stale(
    state: Path, t3_store: T3Store, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    t3_store.skill_tool(t3_store.thread("main-1"), "plant-beds", stamp(1))
    run(skill_usage_collect())
    before = store.load_state(state)["collected_at"]

    monkeypatch.setenv(store.T3_STORE_ENV, str(tmp_path / "missing.sqlite"))
    assert run(skill_usage_collect())["sources"][0]["status"] == "absent"
    monkeypatch.setenv(store.T3_STORE_ENV, "")
    assert run(skill_usage_collect())["sources"][0]["status"] == "off"

    assert store.load_state(state)["collected_at"] == before


def test_collect_refuses_a_store_it_cannot_trust(
    state: Path, t3_store: T3Store, tmp_path: Path
) -> None:
    main = t3_store.thread("main-1")
    t3_store.skill_tool(main, "plant-beds", stamp(1))
    run(skill_usage_collect())

    missing = fail(skill_usage_collect(t3_store=str(tmp_path / "nowhere.sqlite"), machine="x"))
    assert missing.code == "SOURCE_NOT_FOUND"
    assert fail(skill_usage_collect(since_days=-1)).code == "INVALID_INPUT"
    assert fail(skill_usage_collect(since_days=10**6)).code == "INVALID_INPUT"

    garbage = tmp_path / "garbage.sqlite"
    garbage.write_bytes(b"this is not a database" * 100)
    unreadable = fail(skill_usage_collect(t3_store=str(garbage), machine="x"))
    assert unreadable.code == "SOURCE_UNREADABLE"

    with t3_store.connect() as connection:
        connection.execute(f"alter table {t3.ITEMS} rename column payload_json to body")
    changed = fail(skill_usage_collect())
    assert changed.code == "SOURCE_SCHEMA_CHANGED"
    assert f"{t3.ITEMS}.payload_json" in changed.message
    assert len(collected(state)) == 1  # what was collected before is kept


@pytest.mark.parametrize(
    ("change", "named"),
    [
        (f"alter table {t3.SUBAGENTS} rename column child_thread_id to child", "child_thread_id"),
        (f"alter table {t3.RUNS} rename column run_id to id", "run_id"),
        (f"update {t3.ITEMS} set payload_json = replace(payload_json, 'toolName', 'tool')",
         "toolName"),
        (f"update {t3.ITEMS} set payload_json = replace(payload_json, '\"status\"', '\"state\"')",
         "status"),
        (f"update {t3.ITEMS} set payload_json = replace(payload_json, 'createdBy', 'author')",
         "createdBy"),
        (f"update {t3.ITEMS} set type = 'x-' || type", "type values"),
    ],
)  # fmt: skip
def test_a_changed_store_is_reported_not_read_as_no_use(
    state: Path, t3_store: T3Store, change: str, named: str
) -> None:
    main = t3_store.thread("main-1")
    for minute in range(20):
        t3_store.skill_tool(main, "plant-beds", stamp(1, minute))
        t3_store.shell(main, "cat .claude/skills/plant-beds/SKILL.md", stamp(1, minute))
        t3_store.message(main, "$plant-beds", stamp(1, minute))
    with t3_store.connect() as connection:
        connection.execute(change)

    changed = fail(skill_usage_collect())

    assert changed.code == "SOURCE_SCHEMA_CHANGED" and named in changed.message
    assert not (state / store.EVENTS_FILE).exists()


def test_a_store_without_its_items_table_is_a_changed_store(state: Path, t3_store: T3Store) -> None:
    with t3_store.connect() as connection:
        connection.execute(f"alter table {t3.ITEMS} rename to items_v3")

    changed = fail(skill_usage_collect())

    assert changed.code == "SOURCE_SCHEMA_CHANGED" and t3.ITEMS in changed.message


def test_subagents_that_lost_their_parents_are_a_changed_store(
    state: Path, t3_store: T3Store
) -> None:
    main = t3_store.thread("main-1")
    child = t3_store.thread("thread:subagent:r1", parent=main)
    t3_store.skill_tool(child, "plant-beds", stamp(1))
    with t3_store.connect() as connection:
        connection.execute(
            f"update {t3.THREADS} set payload_json = replace(payload_json, 'lineage', 'family')"
        )
        connection.execute(f"drop table {t3.SUBAGENTS}")

    changed = fail(skill_usage_collect())

    assert changed.code == "SOURCE_SCHEMA_CHANGED" and "lineage" in changed.message


def test_an_older_store_without_the_optional_tables_is_read(state: Path, t3_store: T3Store) -> None:
    t3_store.skill_tool(t3_store.thread("main-1"), "plant-beds", stamp(1))
    with t3_store.connect() as connection:
        connection.execute(f"drop table {t3.SUBAGENTS}")
        connection.execute(f"drop table {t3.RUNS}")

    assert run(skill_usage_collect())["added"] == 1


def test_the_store_is_opened_read_only_and_read_as_one_snapshot(t3_store: T3Store) -> None:
    main = t3_store.thread("main-1")
    t3_store.skill_tool(main, "plant-beds", stamp(1))
    with t3_store.connect() as connection:
        connection.execute("pragma journal_mode = wal")
    connection = t3.open_store(t3_store.path)
    with pytest.raises(sqlite3.OperationalError):
        connection.execute(f"delete from {t3.ITEMS}")

    t3_store.project("p2", t3_store.path.parent / "shed")  # written after the snapshot began
    t3_store.skill_tool(t3_store.thread("main-2", project_id="p2"), "prune-roses", stamp(0))
    seen = t3.read(connection, since=None)
    connection.close()

    assert [load.skill for load in seen.loads] == ["plant-beds"]
    assert list(seen.projects) == ["p1"]


def test_only_one_collection_runs_at_a_time(state: Path, t3_store: T3Store) -> None:
    t3_store.skill_tool(t3_store.thread("main-1"), "plant-beds", stamp(1))
    with RunLock(state / store.LOCK_FILE):
        assert fail(skill_usage_collect()).code == "COLLECT_RUNNING"

    assert run(skill_usage_collect())["added"] == 1


def test_a_record_folder_that_cannot_be_used_is_an_error_with_a_way_forward(
    t3_store: T3Store, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    blocked = tmp_path / "not-a-folder"
    blocked.write_text("", encoding="utf-8")
    monkeypatch.setenv(store.STATE_ENV, str(blocked))
    t3_store.skill_tool(t3_store.thread("main-1"), "plant-beds", stamp(1))

    assert fail(skill_usage_collect()).code == "RECORD_UNAVAILABLE"
    assert fail(skill_usage_report()).code == "RECORD_UNAVAILABLE"


def test_a_damaged_record_file_is_refused_or_survived(state: Path, t3_store: T3Store) -> None:
    t3_store.skill_tool(t3_store.thread("main-1"), "plant-beds", stamp(1))
    run(skill_usage_collect())

    (state / store.STATE_FILE).write_text('{"projects": {"garden": {"roots": 5}}}', "utf-8")
    assert run(skill_usage_report())["totals"]["sessions"] == 1
    assert run(skill_usage_collect())["added"] == 0  # the state is rebuilt, nothing is lost

    (state / store.SESSIONS_FILE).write_text("{ half a file", "utf-8")
    t3_store.skill_tool(t3_store.thread("main-2"), "prune-roses", stamp(0))
    before = (state / store.EVENTS_FILE).read_text("utf-8")
    assert fail(skill_usage_collect()).code == "RECORD_UNAVAILABLE"
    assert fail(skill_usage_collect(rebuild=True)).code == "RECORD_UNAVAILABLE"
    assert fail(skill_usage_report()).code == "RECORD_UNAVAILABLE"
    assert (state / store.SESSIONS_FILE).read_text("utf-8") == "{ half a file"  # not overwritten
    assert (state / store.EVENTS_FILE).read_text("utf-8") == before  # a refusal writes nothing


# ── naming projects ─────────────────────────────────────────────────────────


def test_a_project_is_named_after_its_origin_and_two_clones_are_one(
    state: Path, t3_store: T3Store, checkout: Path, tmp_path: Path
) -> None:
    clone = checkout_at(tmp_path / "second-clone")
    for root in (checkout, clone):
        git(root, "init", "-q", "-b", "main")
        git(root, "remote", "add", "origin", "git@example.com:acme/garden.git")
    t3_store.project("p2", clone)
    t3_store.skill_tool(t3_store.thread("main-1"), "plant-beds", stamp(1))
    t3_store.skill_tool(t3_store.thread("main-2", project_id="p2"), "plant-beds", stamp(1, 1))

    run(skill_usage_collect())

    assert {event.project for event in collected(state)} == {"acme/garden"}
    assert rows(run(skill_usage_report(project="garden")))["plant-beds"]["sessions"] == 2


def test_two_unrelated_folders_of_one_name_are_two_projects(
    state: Path, t3_store: T3Store, tmp_path: Path
) -> None:
    other = checkout_at(tmp_path / "elsewhere" / "garden")
    t3_store.project("p2", other)
    t3_store.skill_tool(t3_store.thread("main-1"), "plant-beds", stamp(1))
    t3_store.skill_tool(t3_store.thread("main-2", project_id="p2"), "plant-beds", stamp(1, 1))

    run(skill_usage_collect())
    names = sorted(event.project for event in collected(state))

    assert names[0] == "garden" and names[1].startswith("garden~")
    assert run(skill_usage_collect())["added"] == 0  # and the names hold on the next run
    assert sorted(store.load_state(state)["projects"]) == names


# ── the record ──────────────────────────────────────────────────────────────


def event(identifier: str, **changes: object) -> Event:
    fields = {
        "id": identifier, "at": stamp(1), "skill": "plant-beds", "path": "skill_tool",
        "harness": "claude", "source": "t3-code", "thread": "t", "root": "t", "agent": "main",
        "project": "garden", "machine": "bench",
    }  # fmt: skip
    return Event(**{**fields, **changes})


def test_the_record_skips_what_it_cannot_read_and_keeps_each_id_once(state: Path) -> None:
    store.append_events(state, [event("a"), event("a")])
    with (state / store.EVENTS_FILE).open("a", encoding="utf-8") as handle:
        handle.write('not json\n[1, 2]\n{"id": "b"}\n\n')

    events, unreadable = store.load_events(state)

    assert events == [event("a")] and unreadable == 3


def test_an_append_after_an_interrupted_write_loses_nothing(state: Path) -> None:
    store.append_events(state, [event("a")])
    with (state / store.EVENTS_FILE).open("a", encoding="utf-8") as handle:
        handle.write('{"id": "half-writ')  # the process died here

    store.append_events(state, [event("b")])
    events, unreadable = store.load_events(state)

    # the half line is taken off: the collection that died never saved how far it had got,
    # so the next one reads its events again, and no report meets a line it cannot read
    assert [found.id for found in events] == ["a", "b"] and unreadable == 0
    lines = (state / store.EVENTS_FILE).read_text(encoding="utf-8").splitlines()
    assert len(lines) == 2 and "half-writ" not in "".join(lines)

    (state / store.EVENTS_FILE).write_text('{"id": "only half a li', encoding="utf-8")
    store.append_events(state, [event("c")])  # a file that is nothing but the half line
    assert [found.id for found in store.load_events(state)[0]] == ["c"]

    # a whole event that lacks only its line ending is known already, and is kept
    whole = (state / store.EVENTS_FILE).read_text(encoding="utf-8").rstrip("\n")
    (state / store.EVENTS_FILE).write_text(whole, encoding="utf-8")
    store.append_events(state, [event("d")])
    assert store.load_events(state) == (store.load_events(state)[0], 0)
    assert [found.id for found in store.load_events(state)[0]] == ["c", "d"]


# ── reporting ───────────────────────────────────────────────────────────────


def test_report_needs_a_collection_first_and_a_sane_window(state: Path) -> None:
    assert fail(skill_usage_report()).code == "NOT_COLLECTED"
    assert fail(skill_usage_report(days=0)).code == "INVALID_INPUT"
    assert fail(skill_usage_report(days=10**6)).code == "INVALID_INPUT"
    assert fail(skill_usage_report(ending_days_ago=-1)).code == "INVALID_INPUT"
    assert fail(skill_usage_report(limit=0)).code == "INVALID_INPUT"
    assert fail(skill_usage_report(agent="reviewer")).code == "INVALID_INPUT"


def test_a_misspelled_filter_is_refused_not_answered_with_nothing(
    state: Path, t3_store: T3Store
) -> None:
    t3_store.skill_tool(t3_store.thread("main-1"), "plant-beds", stamp(1))
    run(skill_usage_collect())

    sessions = store.load_sessions(state)
    sessions["odd"] = {"created_at": stamp(1)}  # an entry with no project or harness
    store.save_sessions(state, sessions)
    for misspelled in ({"harness": "Claude"}, {"project": "gardn"}, {"skill": "plant-bed"}):
        refused = fail(skill_usage_report(**misspelled))
        assert refused.code == "INVALID_INPUT" and "Use one of" in refused.suggestion
        assert "None" not in refused.suggestion
    assert list(rows(run(skill_usage_report(skill="plant-beds", harness="claude")))) == [
        "plant-beds"
    ]
    assert run(skill_usage_report(skill="prune-roses"))["skills"] == []  # known, and quiet


def test_every_session_is_recorded_with_its_pull_requests(state: Path, t3_store: T3Store) -> None:
    used = t3_store.thread("main-1")
    t3_store.thread("main-2", provider="codex")  # loaded nothing
    t3_store.thread("thread:subagent:r1", parent=used)  # a subagent is not a session
    with t3_store.connect() as connection:
        payload = {
            "createdAt": stamp(2), "updatedAt": stamp(1),
            "pullRequests": [{"repository": "acme/garden", "number": 7, "title": SECRET}],
        }  # fmt: skip
        for thread_id in ("main-1", "main-2"):
            connection.execute(
                f"update {t3.THREADS} set payload_json = ? where thread_id = ?",
                (json.dumps(payload), thread_id),
            )
    t3_store.skill_tool(used, "plant-beds", stamp(1))

    assert run(skill_usage_collect())["sessions"] == 2
    sessions = store.load_sessions(state)
    row = rows(run(skill_usage_report()))["plant-beds"]

    assert sorted(sessions) == ["main-1", "main-2"]
    assert sessions["main-2"] == {
        "root": "main-2", "parent": None, "agent": "main", "harness": "codex", "project": "garden",
        "created_at": stamp(2), "updated_at": stamp(1), "machine": "bench",
        "pull_requests": [{"ref": "acme/garden#7", "linked_at": None, "opened": None}],
    }  # fmt: skip
    assert SECRET not in (state / store.SESSIONS_FILE).read_text(encoding="utf-8")
    assert (row["sessions"], row["of_sessions"], row["share"]) == (1, 2, 0.5)
    assert rows(run(skill_usage_report(harness="claude")))["plant-beds"]["of_sessions"] == 1


def test_a_session_that_edits_a_skill_is_writing_it_not_using_it(
    state: Path, t3_store: T3Store
) -> None:
    author, user = t3_store.thread("main-1"), t3_store.thread("main-2")
    t3_store.read_tool(author, "/w/.claude/skills/plant-beds/SKILL.md", stamp(2))
    t3_store.item(author, t3.CHANGE, stamp(2, 5), diffStr=SECRET,
                  fileName="/w/.claude/skills/plant-beds/references/soil.md")  # fmt: skip
    t3_store.read_tool(author, "/w/.claude/skills/prune-roses/SKILL.md", stamp(2, 6))
    t3_store.item(author, t3.CHANGE, stamp(2, 7), status="failed",
                  fileName="/w/.claude/skills/prune-roses/SKILL.md")  # fmt: skip
    t3_store.read_tool(author, "/w/.claude/skills/build-beds/SKILL.md", stamp(2, 8))
    t3_store.item(
        author, t3.CHANGE, stamp(2, 9), driver="codex", fileName="/w/notes.md",
        changes=[{"operation": "update", "path": "/w/notes.md"},
                 {"operation": "update", "path": "/w/.claude/skills/build-beds/SKILL.md"}],
    )  # fmt: skip
    t3_store.skill_tool(user, "plant-beds", stamp(1))
    t3_store.skill_tool(user, "build-beds", stamp(1, 1))
    gathered = run(skill_usage_collect())
    assert (gathered["loads_added"], gathered["edits_added"]) == (5, 2)

    data = run(skill_usage_report())
    found = rows(data)

    assert found["plant-beds"]["sessions"] == 1 and found["plant-beds"]["authoring_sessions"] == 1
    assert found["build-beds"]["authoring_sessions"] == 1  # second file of one Codex patch
    assert found["prune-roses"]["sessions"] == 1  # the edit that failed changed nothing
    assert data["totals"]["authoring_sessions"] == 1
    assert SECRET not in (state / store.EVENTS_FILE).read_text(encoding="utf-8")


def test_a_burst_of_reads_across_most_skills_is_an_audit_not_use(
    state: Path, t3_store: T3Store, checkout: Path
) -> None:
    for number in range(28):  # with the two it has, the checkout holds thirty skills
        folder = checkout / ".claude" / "skills" / f"skill-{number}"
        folder.mkdir()
        (folder / "SKILL.md").write_text(skill_text(f"skill-{number}", "A skill.", 80), "utf-8")
    audit, user, cell, worker = (t3_store.thread(f"main-{number}") for number in (1, 2, 3, 4))
    for number in range(20):  # two thirds of them in twenty minutes: reading the skills
        t3_store.read_tool(audit, f"/w/.claude/skills/skill-{number}/SKILL.md", stamp(1, number))
    t3_store.read_tool(audit, "/w/.claude/skills/prune-roses/SKILL.md", stamp(1, 21))
    t3_store.skill_tool(audit, "plant-beds", stamp(1, 300))  # hours later: ordinary work
    t3_store.skill_tool(user, "plant-beds", stamp(1))
    for number in range(15):  # a cell and its reviewers load fifteen in ten minutes: work
        t3_store.read_tool(cell, f"/w/.claude/skills/skill-{number}/SKILL.md", stamp(3, number))
    for number in range(12):  # with a dozen skills the checkout does not hold, still work
        t3_store.skill_tool(cell, f"plugin:tool-{number}", stamp(3, number))
    for number in range(20):  # twenty over a working day is work too
        t3_store.skill_tool(worker, f"skill-{number}", stamp(2, number * 40))
    run(skill_usage_collect())

    data = run(skill_usage_report())
    found = rows(data)

    assert found["plant-beds"]["sessions"] == 2
    assert found["skill-3"]["sessions"] == 2 and found["skill-17"]["sessions"] == 1
    assert data["totals"]["audit_sessions"] == 1
    quiet = [entry["skill"] for entry in data["quiet"]]
    assert "skill-25" in quiet and "prune-roses" in quiet  # the audit did not empty the list
    assert found["plugin:tool-3"]["sessions"] == 1
    # a filter never changes what counts as an audit
    assert rows(run(skill_usage_report(skill="skill-3")))["skill-3"]["sessions"] == 2
    assert rows(run(skill_usage_report(skill="skill-17")))["skill-17"]["sessions"] == 1
    assert rows(run(skill_usage_report(agent="main")))["skill-17"]["sessions"] == 1


def test_a_rebuild_replaces_what_was_recognised_before(state: Path, t3_store: T3Store) -> None:
    main = t3_store.thread("main-1")
    kept = t3_store.skill_tool(main, "plant-beds", stamp(3))
    t3_store.skill_tool(main, "prune-roses", stamp(3, 1))
    run(skill_usage_collect())
    gone = event("t3:water-lawn@item-deleted-from-the-store", skill="water-lawn", v=0)
    wrong = event(f"t3:not-a-load@{kept}", skill="not-a-load", v=0)
    store.append_events(state, [gone, wrong])
    saved = store.load_state(state)
    saved["recognizer"] = 0  # the record began under an older botcore
    store.save_state(state, saved)
    assert "older botcore" in run(skill_usage_report())["warnings"][0]

    rebuilt = run(skill_usage_collect(rebuild=True))

    assert (rebuilt["added"], rebuilt["removed"], rebuilt["events"]) == (0, 1, 3)
    assert run(skill_usage_report())["warnings"] == []  # what could be read again, was
    assert sorted(found.skill for found in collected(state)) == [
        "plant-beds", "prune-roses", "water-lawn",
    ]  # fmt: skip


def test_a_rewrite_is_compared_as_a_share_under_one_name(
    state: Path, t3_store: T3Store, checkout: Path
) -> None:
    git(checkout, "init", "-q", "-b", "main")
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "skills")
    git(checkout, "mv", ".claude/skills/plant-beds", ".claude/skills/build-beds")
    git(checkout, "commit", "-q", "-m", "rename")
    with t3_store.connect() as connection:  # ten sessions before the rewrite, ten after
        for number in range(20):
            days_ago = 45 if number < 10 else 5
            payload = {"createdAt": stamp(days_ago), "updatedAt": stamp(days_ago)}
            connection.execute(
                f"insert into {t3.THREADS} values (?, ?, ?, ?)",
                (f"main-{number}", "p1", "claudeAgent", json.dumps(payload)),
            )
    for number in (0, 1):
        t3_store.skill_tool(f"main-{number}", "plant-beds", stamp(45))
    for number in (10, 11, 12, 13, 14, 15):
        t3_store.skill_tool(f"main-{number}", "build-beds", stamp(5))
    run(skill_usage_collect())

    after = rows(run(skill_usage_report(days=30, skill="plant-beds")))["build-beds"]
    before = rows(run(skill_usage_report(days=30, ending_days_ago=30, skill="build-beds")))[
        "build-beds"
    ]

    assert (after["sessions"], after["of_sessions"], after["share"]) == (6, 10, 0.6)
    assert (before["sessions"], before["of_sessions"], before["share"]) == (2, 10, 0.2)
    assert before["also_loaded_as"] == ["plant-beds"]


def test_a_long_report_is_cut_and_says_so(state: Path, t3_store: T3Store) -> None:
    for number in range(4):
        t3_store.skill_tool(t3_store.thread(f"main-{number}"), f"skill-{number}", stamp(1))
    run(skill_usage_collect())

    data = run(skill_usage_report(limit=3))

    assert len(data["skills"]) == 3 and data["more"] == 1 and data["totals"]["skills"] == 4


def test_report_counts_sessions_not_reads(state: Path, t3_store: T3Store) -> None:
    main = t3_store.thread("main-1")
    other = t3_store.thread("main-2", provider="codex")
    reviewer = t3_store.thread("thread:subagent:r1", parent=main)
    for minute, part in enumerate(("1,80p", "81,160p", "161,240p")):
        t3_store.shell(
            main, f"sed -n '{part}' .claude/skills/plant-beds/SKILL.md", stamp(1, minute),
            driver="claudeAgent",
        )  # fmt: skip
    t3_store.read_tool(reviewer, "/w/.claude/skills/plant-beds/SKILL.md", stamp(1, 5))
    t3_store.shell(other, "cat .claude/skills/plant-beds/SKILL.md", stamp(2))
    run(skill_usage_collect())

    data = run(skill_usage_report(days=30))
    row = rows(data)["plant-beds"]

    assert row["sessions"] == 2 and row["loads"] == 5 and row["typed_sessions"] == 0
    assert row["of_sessions"] == 2 and row["share"] == 1.0
    assert row["harnesses"] == {"claude": 1, "codex": 1}
    assert row["machines"] == {"bench": 2}
    assert row["agents"] == {"main": 4, "subagent": 1}
    assert row["paths"] == {"file_read": 1, "shell_read": 4}
    assert row["size_bytes"] == 200 and row["max_context_bytes"] == 1000
    assert row["listing_chars"] == len("Plant a bed.")
    assert data["totals"]["sessions"] == 2 and data["totals"]["loads"] == 5
    assert data["record"]["machines"] == ["bench"]
    assert data["warnings"] == []


def test_a_typed_request_is_a_load_unless_a_tool_then_loads_the_skill(
    state: Path, t3_store: T3Store
) -> None:
    injected = t3_store.thread("main-1")  # the harness put the skill in context itself
    by_tool = t3_store.thread("main-2")  # the agent loaded it with a tool straight after
    much_later = t3_store.thread("main-3")  # a tool load an hour on is a second load
    t3_store.message(injected, "$plant-beds", stamp(1))
    t3_store.message(by_tool, "$plant-beds", stamp(1))
    t3_store.skill_tool(by_tool, "plant-beds", stamp(1, 1))
    t3_store.message(much_later, "$plant-beds", stamp(1))
    t3_store.skill_tool(much_later, "plant-beds", stamp(1, 60))
    run(skill_usage_collect())

    row = rows(run(skill_usage_report()))["plant-beds"]

    assert row["sessions"] == 3 and row["typed_sessions"] == 3
    assert row["loads"] == 4
    assert row["paths"] == {"skill_tool": 2, "typed": 2}
    assert row["max_context_bytes"] == 800


def test_report_lists_the_skills_nothing_loaded(state: Path, t3_store: T3Store) -> None:
    main = t3_store.thread("main-1")
    t3_store.skill_tool(main, "plant-beds", stamp(2))
    t3_store.skill_tool(main, "prune-roses", stamp(45))
    run(skill_usage_collect())

    data = run(skill_usage_report(days=30))

    assert list(rows(data)) == ["plant-beds"]
    assert data["quiet"] == [
        {"project": "garden", "skill": "prune-roses", "last_used": stamp(45), "size_bytes": 120,
         "listing_chars": len("Prune the roses.")}
    ]  # fmt: skip
    assert rows(run(skill_usage_report(days=60))).keys() == {"plant-beds", "prune-roses"}


def test_report_compares_two_periods(state: Path, t3_store: T3Store) -> None:
    for number, days_ago in enumerate((5, 40, 45, 50)):
        t3_store.skill_tool(t3_store.thread(f"main-{number}"), "plant-beds", stamp(days_ago))
    run(skill_usage_collect())

    after = rows(run(skill_usage_report(days=30)))["plant-beds"]
    before = rows(run(skill_usage_report(days=30, ending_days_ago=30)))["plant-beds"]

    assert (after["sessions"], before["sessions"]) == (1, 3)


def test_report_narrows_by_project_and_harness(
    state: Path, t3_store: T3Store, tmp_path: Path
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


def test_a_renamed_skill_keeps_one_identity(state: Path, t3_store: T3Store, checkout: Path) -> None:
    skills = checkout / ".claude" / "skills"
    (skills / "plant-beds" / "SKILL.md").write_text("bed rules\n" * 30, encoding="utf-8")
    git(checkout, "init", "-q", "-b", "main")
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "skills")
    git(checkout, "update-ref", "refs/remotes/origin/main", "HEAD")  # the remote lags behind
    git(checkout, "mv", ".claude/skills/plant-beds", ".claude/skills/build-beds")
    git(checkout, "commit", "-q", "-m", "rename")
    main = t3_store.thread("main-1")
    later = t3_store.thread("main-2")
    t3_store.skill_tool(main, "plant-beds", stamp(20))
    t3_store.skill_tool(later, "build-beds", stamp(1))
    t3_store.skill_tool(later, "audit-security", stamp(1, 1))  # botcore renamed this one
    run(skill_usage_collect())

    found = rows(run(skill_usage_report(days=30)))

    assert found["build-beds"]["sessions"] == 2
    assert found["build-beds"]["also_loaded_as"] == ["plant-beds"]
    assert found["security-auditor"]["also_loaded_as"] == ["audit-security"]
    assert "plant-beds" not in found


def test_a_name_the_checkout_still_holds_is_not_renamed(
    state: Path, t3_store: T3Store, checkout: Path
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


# ── the command line ────────────────────────────────────────────────────────


def test_the_commands_run_from_the_command_line(state: Path, t3_store: T3Store) -> None:
    runner = CliRunner()
    refused = runner.invoke(cli, ["skill-usage-report", "--json"])
    assert refused.exit_code == 1 and "NOT_COLLECTED" in refused.output
    out_of_range = runner.invoke(cli, ["skill-usage-report", "--days", "0", "--json"])
    assert out_of_range.exit_code == 1 and "INVALID_INPUT" in out_of_range.output

    t3_store.skill_tool(t3_store.thread("main-1"), "plant-beds", stamp(1))
    gathered = runner.invoke(cli, ["skill-usage-collect", "--json"])
    report = runner.invoke(
        cli, ["skill-usage-report", "--days", "7", "--project", "garden", "--json"]
    )

    assert gathered.exit_code == 0 and json.loads(gathered.output)["data"]["added"] == 1
    assert report.exit_code == 0
    assert [row["skill"] for row in json.loads(report.output)["data"]["skills"]] == ["plant-beds"]
