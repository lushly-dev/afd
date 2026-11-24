"""skill-usage-collect and skill-usage-report, against a store shaped like T3 Code's."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import sqlite3
import stat
import subprocess
import sys
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from click.testing import CliRunner

from botcore.cli import cli
from botcore.commands.disk.lock import RunLock
from botcore.commands.skill_usage import (
    collect,
    skill_usage_collect,
    skill_usage_report,
    store,
    t3,
)
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


def _rmtree(path: Path) -> None:
    """Remove a directory tree, clearing read-only attributes on Windows (e.g. `.git/objects`)."""

    def clear_readonly(func, target: str, exc: BaseException) -> None:
        if not isinstance(exc, PermissionError):
            raise exc
        os.chmod(target, stat.S_IRWXU)
        func(target)

    if sys.version_info >= (3, 12):
        shutil.rmtree(path, onexc=clear_readonly)
    else:
        shutil.rmtree(path, onerror=lambda f, p, info: clear_readonly(f, p, info[1]))


def git(root: Path, *args: str, at: str | None = None) -> None:
    """Run git in a folder; `at` is when a commit it makes is dated."""
    dated = {"GIT_AUTHOR_DATE": at, "GIT_COMMITTER_DATE": at} if at else {}
    subprocess.run(
        ["git", "-C", str(root), "-c", "user.name=T", "-c", "user.email=t@example.com",
         "-c", "commit.gpgsign=false", *args],
        check=True, capture_output=True, env={**os.environ, **dated},
    )  # fmt: skip


def held(state: Path, project: str = "garden") -> dict:
    """What the record says a project holds."""
    return store.load_state(state)["projects"][project]["skills"]


def on_a_volume_away(state: Path, project: str, folder: Path) -> None:
    """Make a folder the record holds one that was read on a volume of its own, which is not
    mounted now: where the folder is not there, it may only be away."""
    saved = store.load_state(state)
    saved["projects"][project]["storage"][str(folder)] = {
        "volume": str(folder.parent / "a-volume-that-is-away"),
        "device": 1,
    }
    store.save_state(state, saved)


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
        f'$p = "C:\\dir\\"\nGet-Content {WINDOWS_FILE}',
        f'$p = "C:\\dir\\"; Get-Content {WINDOWS_FILE}',
        f'$p = "C:\\dir\\"\n$x = @"\nhi\n"@\nGet-Content {WINDOWS_FILE}',
        f"powershell.exe -Command '$p = \"C:\\dir\\\"; Get-Content {WINDOWS_FILE}'",
        f'pwsh -Command "$p = \\"C:\\dir\\\\\\"; Get-Content {WINDOWS_FILE}"',
        f'Set-Location "C:\\dir\\"; Get-Content {WINDOWS_FILE}',
        f'$s = "a`"b"; Get-Content {WINDOWS_FILE}',
        f'$s = "a``"\nGet-Content {WINDOWS_FILE}',
        f"Get-Content `\n{WINDOWS_FILE}",
        f'echo "a`echo hi`"; cat {FILE}',
        f'Write-Output "hello @"\nGet-Content {WINDOWS_FILE}',
        f'$p = "C:\\dir\\"\r\nGet-Content {WINDOWS_FILE}',
        f'pwd; $p = "C:\\dir\\"; Get-Content {WINDOWS_FILE}',
        f'cd "C:\\dir\\"\nGet-Content {WINDOWS_FILE}',
        f'cd "C:\\dir\\"; Get-Content {WINDOWS_FILE}',
        f'cmd /c "echo hi"\n$p = "C:\\dir\\"\nGet-Content {WINDOWS_FILE}',
        f'$p = "C:\\dir\\"\nSelect-String "<<<<<<<" file.txt\nGet-Content {WINDOWS_FILE}',
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
        (
            "cat <<'EOF' > script.ps1\n$x = @\"\nhi\n\"@\nEOF\n"
            f'echo "a\\"b"\ncat <<\'PY\'\ncat {FILE}\nPY'
        ),
        (
            'cat <<\'EOF\' > script.ps1\n$p = "C:\\dir\\"\n$x = @"\nhi\n"@\n'
            f'Get-Content foo.txt\nEOF\necho "a\\"b"\ncat <<\'PY\'\ncat {FILE}\nPY'
        ),
        f'$s = "a`"b"\n$x = @"\ncat {FILE}\n"@\nWrite-Output $x.Length',
        f'$s = "a`"b"; $x = @"\ncat {FILE}\n"@\nWrite-Output $x.Length',
        f'$s = "a``"\n$x = @"\ncat {FILE}\n"@\nWrite-Output $x.Length',
        f"$s = 'a`'\n$x = @\"\ncat {FILE}\n\"@\nWrite-Output $x.Length",
        f'powershell.exe -Command \'$s = "a`"b"\n$x = @"\ncat {FILE}\n"@\'',
        f'echo "x\\"; Get-Content {FILE}"',
        f'echo \'\n$p = "hi"\n$x = @"\nhi\n"@\n\'\necho "a\\"b; cat {FILE}"',
        f"$x = @\"\ncat <<'EOF'\ncat {FILE}\nEOF\n\"@",
        f'$x = @"\n<<<<<<< HEAD\n"\ncat {FILE}\n"@',
        f'bash -c "echo ok"\n$x = @"\ncat {FILE}\n"@',
        f'echo "a`"b"\n$x = @"\ncat {FILE}\n"@',
        f'powershell.exe -Command $s = "a`"b"\n$x = @"\ncat {FILE}\n"@',
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
    monkeypatch.setenv(store.STATE_ENV, str(blocked / "record"))  # a path through the file
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


def test_a_version_1_record_gets_the_rebuild_warning_after_recognizer_bump(
    state: Path, t3_store: T3Store
) -> None:
    main = t3_store.thread("main-1")
    t3_store.skill_tool(main, "plant-beds", stamp(1))
    run(skill_usage_collect())
    events = collected(state)
    assert events and events[0].v >= 2
    old = event(events[0].id, skill="plant-beds", v=1)
    store.rewrite_events(state, [old])
    saved = store.load_state(state)
    saved["recognizer"] = 1
    store.save_state(state, saved)

    warnings = run(skill_usage_report())["warnings"]
    assert any("older botcore" in warning and "--rebuild" in warning for warning in warnings)

    run(skill_usage_collect(rebuild=True))
    assert run(skill_usage_report())["warnings"] == []


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


# ── what a project holds ────────────────────────────────────────────────────


def test_a_project_is_listed_as_its_default_branch_has_it(
    state: Path, t3_store: T3Store, checkout: Path
) -> None:
    git(checkout, "init", "-q", "-b", "main")
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "skills")
    # work under way in the folder: a skill renamed and one grown on a branch, one not yet
    # added. None of it is the project until it is merged.
    skills = checkout / ".claude" / "skills"
    git(checkout, "checkout", "-q", "-b", "topic")
    git(checkout, "mv", ".claude/skills/prune-roses", ".claude/skills/trim-roses")
    (skills / "plant-beds" / "SKILL.md").write_text(
        skill_text("plant-beds", "Plant a bed, at length.", 900), encoding="utf-8"
    )
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "work under way")
    (skills / "draft").mkdir()
    (skills / "draft" / "SKILL.md").write_text(skill_text("draft", "A draft.", 300), "utf-8")
    t3_store.skill_tool(t3_store.thread("main-1"), "plant-beds", stamp(1))
    run(skill_usage_collect())

    data = run(skill_usage_report(days=30))

    row = rows(data)["plant-beds"]
    assert (row["size_bytes"], row["listing_chars"]) == (200, len("Plant a bed."))
    assert [(entry["skill"], entry["size_bytes"]) for entry in data["quiet"]] == [
        ("prune-roses", 120)
    ]
    found = held(state)
    assert sorted(found["held"]) == ["plant-beds", "prune-roses"]
    assert found["commit"] and found["at"].endswith("+00:00")

    git(checkout, "checkout", "-q", "main")
    git(checkout, "merge", "-q", "topic")  # merged, the work is the project
    run(skill_usage_collect())
    assert held(state)["held"] == {
        "plant-beds": [900, len("Plant a bed, at length.")],
        "trim-roses": [120, len("Prune the roses.")],
    }
    assert held(state)["renames"] == {"prune-roses": "trim-roses"}  # read from that commit


@pytest.mark.parametrize(
    "later",
    ["2026-03-01T10:00:00+00:00", "2026-03-02T10:00:00+00:00", "2026-02-28T10:00:00+00:00"],
)
def test_of_two_default_branches_the_one_ahead_is_read(
    state: Path, t3_store: T3Store, checkout: Path, later: str
) -> None:
    """A checkout that was not pushed has the remote's branch behind its own. The one the
    other leads to is ahead whatever their times: git keeps a commit's time to the second,
    so the two can share one, and a clock that runs behind dates a commit before its
    parent."""
    git(checkout, "init", "-q", "-b", "main")
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "skills", at="2026-03-01T10:00:00+00:00")
    git(checkout, "update-ref", "refs/remotes/origin/main", "HEAD")
    git(checkout, "mv", ".claude/skills/plant-beds", ".claude/skills/build-beds")
    git(checkout, "commit", "-q", "-m", "rename", at=later)
    t3_store.skill_tool(t3_store.thread("main-1"), "plant-beds", stamp(1))

    run(skill_usage_collect())

    assert sorted(held(state)["held"]) == ["build-beds", "prune-roses"]
    assert sorted(rows(run(skill_usage_report()))) == ["build-beds"]


@pytest.mark.parametrize("later", ["2026-03-02T10:00:00+00:00", "2026-02-28T10:00:00+00:00"])
def test_a_checkout_that_was_not_fetched_reads_what_it_has(
    state: Path, t3_store: T3Store, checkout: Path, later: str
) -> None:
    git(checkout, "init", "-q", "-b", "main")
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "skills", at="2026-03-01T10:00:00+00:00")
    git(checkout, "mv", ".claude/skills/plant-beds", ".claude/skills/build-beds")
    git(checkout, "commit", "-q", "-m", "rename", at=later)
    git(checkout, "update-ref", "refs/remotes/origin/main", "HEAD")  # fetched, and
    git(checkout, "reset", "-q", "--hard", "HEAD~1")  # its own branch never moved on
    t3_store.skill_tool(t3_store.thread("main-1"), "plant-beds", stamp(1))

    run(skill_usage_collect())

    assert sorted(held(state)["held"]) == ["build-beds", "prune-roses"]
    # and the rename is read from the same branch, though the checked-out one lacks it
    assert sorted(rows(run(skill_usage_report()))) == ["build-beds"]


def test_a_commit_and_a_folder_say_the_same_of_a_skill(tmp_path: Path) -> None:
    root = tmp_path / "garden"
    windows = b"---\r\nname: windows\r\ndescription: Line ends.\r\n---\r\nbody\r\n"
    no_such_day = b"---\nname: bad-date\nupdated: 2026-02-30\n---\nThe first paragraph.\n\nMore.\n"
    files = {
        ".claude/skills/plain/SKILL.md": skill_text("plain", "Plain.", 150).encode(),
        ".claude/skills/windows/SKILL.md": windows,
        ".claude/skills/odd-bytes/SKILL.md": b"---\nname: odd\ndescription: caf\xe9\n---\n\xff",
        ".claude/skills/bad-date/SKILL.md": no_such_day,
        ".claude/skills/not a name/SKILL.md": b"no load is recorded under a name like this",
        ".claude/skills/_drafts/SKILL.md": b"nor this",
        ".agents/skills/plain/SKILL.md": skill_text("plain", "Another.", 400).encode(),
        ".agents/skills/only-agents/SKILL.md": skill_text("only-agents", "Agents.", 99).encode(),
        ".claude/skills/no-file/notes.md": b"notes",
        ".claude/skills/deep/inner/SKILL.md": b"not a skill: one folder too far down",
        ".claude/skills/README.md": b"not a folder",
        "elsewhere/.claude/skills/far/SKILL.md": b"not this project's",
    }
    for name, data in files.items():
        (root / name).parent.mkdir(parents=True, exist_ok=True)
        (root / name).write_bytes(data)
    git(root, "init", "-q", "-b", "main")
    git(root, "-c", "core.autocrlf=false", "add", "-A")
    git(root, "commit", "-q", "-m", "skills")

    folder = collect.held_in_folder(root)

    assert collect.held_at(root, "HEAD") == folder
    assert sorted(folder) == ["bad-date", "odd-bytes", "only-agents", "plain", "windows"]
    # a front matter that cannot be read is none: the skill is listed by its first paragraph
    assert folder["bad-date"] == [len(no_such_day), len("The first paragraph.")]
    assert folder["plain"] == [150, len("Plain.")]  # of two folders, the first one's
    assert folder["windows"] == [len(windows) - windows.count(b"\r"), len("Line ends.")]
    (root / ".claude" / "skills" / "plain" / "SKILL.md").write_bytes(b"changed in the folder")
    assert collect.held_at(root, "HEAD") == folder  # the commit, whatever the folder holds


def test_a_git_that_does_not_answer_leaves_what_was_known(
    state: Path, t3_store: T3Store, checkout: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A busy machine's git can run out of its time. That is not a folder with no branch:
    read as it lies, a checkout with work under way would speak for the project."""
    git(checkout, "init", "-q", "-b", "main")
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "skills")
    t3_store.skill_tool(t3_store.thread("main-1"), "plant-beds", stamp(1))
    run(skill_usage_collect())
    known = held(state)
    draft = checkout / ".claude" / "skills" / "draft"
    draft.mkdir()
    (draft / "SKILL.md").write_text(skill_text("draft", "A draft.", 300), "utf-8")
    real = collect.git_out

    def slow(root: Path, *args: str, **more: object) -> str:
        if args[0] == "for-each-ref":
            raise collect.GitError("git for-each-ref: timed out")
        return real(root, *args, **more)

    monkeypatch.setattr(collect, "git_out", slow)

    run(skill_usage_collect())

    assert known["commit"] and held(state) == known


def test_a_repository_git_cannot_read_is_not_a_folder_with_no_branch(
    state: Path, t3_store: T3Store, checkout: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    git(checkout, "init", "-q", "-b", "main")
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "skills")
    t3_store.skill_tool(t3_store.thread("main-1"), "plant-beds", stamp(1))
    run(skill_usage_collect())
    known = held(state)
    draft = checkout / ".claude" / "skills" / "draft"
    draft.mkdir()
    (draft / "SKILL.md").write_text(skill_text("draft", "A draft.", 300), "utf-8")
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "a draft, merged")
    real = collect.git_out

    def no_file(root: Path, *args: str, **more: object) -> str:
        if args[0] == "cat-file":  # an object git lists and cannot give
            return f"{'0' * 40} missing\n"
        return real(root, *args, **more)

    monkeypatch.setattr(collect, "git_out", no_file)
    with pytest.raises(ValueError, match="cat-file"):
        collect.held_at(checkout, "HEAD")
    run(skill_usage_collect())
    assert held(state) == known  # the commit could not be read: nothing new is said

    monkeypatch.setattr(collect, "git_out", real)
    ref = checkout / ".git" / "refs" / "heads" / "main"
    ref.write_text("1" * 40 + "\n", "utf-8")  # a branch that names a commit that is not there
    with pytest.raises(collect.GitError, match="missing object"):
        collect.default_tip(checkout)
    run(skill_usage_collect())
    assert held(state) == known  # nor is the folder read as it lies, draft and all


def test_a_repository_git_refuses_is_read_as_it_lies(
    state: Path, t3_store: T3Store, checkout: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Git refuses every command in a folder another account owns, for good. Its project
    holds what its folder does, which is all there is to know, until git answers there."""
    git(checkout, "init", "-q", "-b", "main")
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "skills")
    (checkout / ".claude" / "skills" / "plant-beds" / "SKILL.md").write_text(
        skill_text("plant-beds", "Plant a bed, at length.", 900), encoding="utf-8"
    )  # work under way: the folder says 900 where the commit says 200
    t3_store.skill_tool(t3_store.thread("main-1"), "plant-beds", stamp(1))
    real = collect.git_out

    def refused(root: Path, *args: str, **more: object) -> str:
        raise collect.GitError(f"git {args[0]}: fatal: detected dubious ownership in repository")

    monkeypatch.setattr(collect, "git_out", refused)
    run(skill_usage_collect())

    data = run(skill_usage_report())
    assert rows(data)["plant-beds"]["size_bytes"] == 900  # noqa: PLR2004
    assert [entry["skill"] for entry in data["quiet"]] == ["prune-roses"]
    assert (held(state)["at"], held(state)["commit"]) == (None, None)
    draft = checkout / ".claude" / "skills" / "draft"
    draft.mkdir()
    (draft / "SKILL.md").write_text(skill_text("draft", "A draft.", 300), "utf-8")
    run(skill_usage_collect())  # and again each time, while that is all it has said
    assert sorted(held(state)["held"]) == ["draft", "plant-beds", "prune-roses"]

    monkeypatch.setattr(collect, "git_out", real)  # the folder is made the owner's own
    run(skill_usage_collect())
    assert held(state)["commit"] and held(state)["held"]["plant-beds"][0] == 200  # noqa: PLR2004

    known = held(state)
    monkeypatch.setattr(collect, "git_out", refused)  # and a commit on record is kept,
    run(skill_usage_collect())
    assert known["commit"] and held(state) == known
    run(skill_usage_collect(rebuild=True))  # though everything else is read again
    assert held(state) == known


@pytest.mark.skipif(not hasattr(os, "mkfifo"), reason="no named pipes here")
def test_a_pipe_named_like_a_skill_file_is_not_read(checkout: Path) -> None:
    """Opening one waits for a writer, and would hold the collection for as long."""
    pipe = checkout / ".claude" / "skills" / "piped"
    pipe.mkdir()
    os.mkfifo(pipe / "SKILL.md")
    found: list[dict] = []
    reader = threading.Thread(target=lambda: found.append(collect.held_in_folder(checkout)))
    reader.daemon = True

    reader.start()
    reader.join(10)

    waiting = reader.is_alive()
    if waiting:  # let it go: a writer that opens and closes ends the read
        try:
            os.close(os.open(pipe / "SKILL.md", os.O_WRONLY | os.O_NONBLOCK))
        except OSError:
            pass  # the reader had not opened it yet: the failure below says what happened
        reader.join(10)
    assert not waiting
    assert sorted(found[0]) == ["plant-beds", "prune-roses"]


def test_no_other_branch_speaks_for_the_default_one(
    state: Path, t3_store: T3Store, checkout: Path
) -> None:
    """The remote says which branch is the default. A branch that happens to be called
    `main`, however new, is not it."""
    git(checkout, "init", "-q", "-b", "trunk")
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "skills", at="2026-03-01T10:00:00+00:00")
    git(checkout, "update-ref", "refs/remotes/origin/trunk", "HEAD")
    git(checkout, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk")
    git(checkout, "checkout", "-q", "-b", "main")
    git(checkout, "mv", ".claude/skills/plant-beds", ".claude/skills/other-beds")
    git(checkout, "commit", "-q", "-m", "elsewhere", at="2026-03-09T10:00:00+00:00")
    t3_store.skill_tool(t3_store.thread("main-1"), "plant-beds", stamp(1))

    run(skill_usage_collect())

    assert sorted(held(state)["held"]) == ["plant-beds", "prune-roses"]
    assert collect.default_tip(checkout)[0] == "refs/remotes/origin/trunk"


@pytest.mark.parametrize(
    ("theirs", "ours", "read"),
    [
        ("2026-03-03T10:00:00+00:00", "2026-03-02T10:00:00+00:00", "their-beds"),
        ("2026-03-02T10:00:00+00:00", "2026-03-03T10:00:00+00:00", "our-beds"),
        ("2026-03-02T10:00:00+00:00", "2026-03-02T10:00:00+00:00", "their-beds"),
    ],
)
def test_of_two_default_branches_that_parted_the_newer_is_read(
    checkout: Path, theirs: str, ours: str, read: str
) -> None:
    """Neither leads to the other (the remote's was rewritten, or the checkout's has work
    not pushed): the newer, and of two as new the remote's."""
    git(checkout, "init", "-q", "-b", "main")
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "skills", at="2026-03-01T10:00:00+00:00")
    git(checkout, "checkout", "-q", "-b", "remote")
    git(checkout, "mv", ".claude/skills/plant-beds", ".claude/skills/their-beds")
    git(checkout, "commit", "-q", "-m", "theirs", at=theirs)
    git(checkout, "update-ref", "refs/remotes/origin/main", "HEAD")
    git(checkout, "checkout", "-q", "main")
    git(checkout, "mv", ".claude/skills/plant-beds", ".claude/skills/our-beds")
    git(checkout, "commit", "-q", "-m", "ours", at=ours)

    account = collect.skill_inventory(checkout)

    assert sorted(account["held"]) == sorted([read, "prune-roses"])
    assert account["renames"] == {"plant-beds": read}


def test_a_rename_to_a_name_no_load_is_recorded_under_is_not_followed(checkout: Path) -> None:
    """Neither list holds such a folder, so neither report may call a skill by its name."""
    git(checkout, "init", "-q", "-b", "main")
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "skills", at="2026-03-01T10:00:00+00:00")
    git(checkout, "mv", ".claude/skills/plant-beds", ".claude/skills/Beds, see the notes")
    git(checkout, "commit", "-q", "-m", "set aside", at="2026-03-02T10:00:00+00:00")

    account = collect.skill_inventory(checkout)

    assert (sorted(account["held"]), account["renames"]) == (["prune-roses"], {})
    assert collect.skill_renames(checkout) == {}


def test_an_older_clone_never_takes_a_project_back(
    state: Path, t3_store: T3Store, checkout: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    git(checkout, "init", "-q", "-b", "main")
    git(checkout, "remote", "add", "origin", "git@example.com:acme/garden.git")
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "skills", at="2026-04-01T10:00:00+00:00")
    old = checkout.parent / "old" / "garden"  # cloned then, and never fetched since
    subprocess.run(["git", "clone", "-q", str(checkout), str(old)], check=True)
    git(old, "remote", "set-url", "origin", "git@example.com:acme/garden.git")
    git(checkout, "mv", ".claude/skills/plant-beds", ".claude/skills/build-beds")
    git(checkout, "commit", "-q", "-m", "rename", at="2026-04-02T10:00:00+00:00")
    t3_store.project("p2", old)
    t3_store.skill_tool(t3_store.thread("main-1"), "plant-beds", stamp(1))
    t3_store.skill_tool(t3_store.thread("main-2", project_id="p2"), "plant-beds", stamp(1))
    run(skill_usage_collect())
    newest = held(state, "acme/garden")
    assert sorted(newest["held"]) == ["build-beds", "prune-roses"]

    on_a_volume_away(state, "acme/garden", checkout)
    away = checkout.parent / "not-mounted"
    checkout.rename(away)  # the volume with the newest is away this time
    run(skill_usage_collect())
    assert held(state, "acme/garden") == newest  # what it said last still speaks

    away.rename(checkout)
    real = collect.git_out

    def busy(root: Path, *args: str, **more: object) -> str:
        if Path(root) == checkout and args[0] == "for-each-ref":
            raise collect.GitError("git for-each-ref: timed out")
        return real(root, *args, **more)

    monkeypatch.setattr(collect, "git_out", busy)  # nor when git does not answer in it
    run(skill_usage_collect())
    assert held(state, "acme/garden") == newest

    monkeypatch.setattr(collect, "git_out", real)
    git(checkout, "reset", "-q", "--hard", "HEAD~1")  # the folder itself says otherwise now
    run(skill_usage_collect())
    assert sorted(held(state, "acme/garden")["held"]) == ["plant-beds", "prune-roses"]


def test_a_folder_that_was_removed_says_nothing_more(
    state: Path, t3_store: T3Store, checkout: Path
) -> None:
    """Its volume is there and it is not: no report goes on listing what it held."""
    git(checkout, "init", "-q", "-b", "main")
    git(checkout, "remote", "add", "origin", "git@example.com:acme/garden.git")
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "skills", at="2026-04-01T10:00:00+00:00")
    old = checkout.parent / "old" / "garden"
    subprocess.run(["git", "clone", "-q", str(checkout), str(old)], check=True)
    git(old, "remote", "set-url", "origin", "git@example.com:acme/garden.git")
    git(checkout, "mv", ".claude/skills/plant-beds", ".claude/skills/build-beds")
    git(checkout, "commit", "-q", "-m", "rename", at="2026-04-02T10:00:00+00:00")
    t3_store.project("p2", old)
    t3_store.skill_tool(t3_store.thread("main-1"), "plant-beds", stamp(1))
    t3_store.skill_tool(t3_store.thread("main-2", project_id="p2"), "plant-beds", stamp(1))
    run(skill_usage_collect())
    assert sorted(held(state, "acme/garden")["held"]) == ["build-beds", "prune-roses"]

    _rmtree(checkout)
    run(skill_usage_collect())
    # the clone that is left speaks for the project, old as it is
    assert sorted(held(state, "acme/garden")["held"]) == ["plant-beds", "prune-roses"]

    _rmtree(old)
    run(skill_usage_collect())
    data = run(skill_usage_report())
    assert held(state, "acme/garden") == {"at": None, "commit": None, "held": {}, "renames": {}}
    (row,) = data["skills"]  # its loads are still counted, under the name the skill last had
    assert (row["skill"], row["sessions"]) == ("build-beds", 2) and "size_bytes" not in row
    assert data["quiet"] == [] and data["warnings"] == []


def test_a_folder_that_may_only_be_away_speaks_for_a_month(
    state: Path, t3_store: T3Store, checkout: Path
) -> None:
    """Nothing shows it was removed: its volume is away too, or nothing was recorded of what
    it was on. It keeps speaking from when it was first found missing, and no longer than
    that: a record must not list for ever what a checkout that is gone held."""
    t3_store.skill_tool(t3_store.thread("main-1"), "plant-beds", stamp(1))
    run(skill_usage_collect())
    on_a_volume_away(state, "garden", checkout)
    shutil.rmtree(checkout)

    run(skill_usage_collect())
    saved = store.load_state(state)
    since = datetime.fromisoformat(saved["projects"]["garden"]["missing"][str(checkout)])
    assert NOW - timedelta(minutes=5) < since < datetime.now(UTC)
    assert sorted(held(state)["held"]) == ["plant-beds", "prune-roses"]

    for days, speaks in ((29, True), (31, False)):
        saved["projects"]["garden"]["missing"][str(checkout)] = (
            datetime.now(UTC) - timedelta(days=days)
        ).isoformat()
        store.save_state(state, saved)
        run(skill_usage_collect())
        assert bool(held(state)["held"]) is speaks, days
    after = store.load_state(state)["projects"]["garden"]
    assert (after["accounts"], after["storage"], after["missing"]) == ({}, {}, {})

    # an account an earlier botcore wrote says nothing of what its folder was on: the same
    del saved["projects"]["garden"]["storage"], saved["projects"]["garden"]["missing"]
    store.save_state(state, saved)
    run(skill_usage_collect())
    assert sorted(held(state)["held"]) == ["plant-beds", "prune-roses"]
    assert str(checkout) in store.load_state(state)["projects"]["garden"]["missing"]


def test_a_folder_that_is_back_is_read_again_and_missed_no_more(
    state: Path, t3_store: T3Store, checkout: Path
) -> None:
    t3_store.skill_tool(t3_store.thread("main-1"), "plant-beds", stamp(1))
    run(skill_usage_collect())
    on_a_volume_away(state, "garden", checkout)
    away = checkout.parent / "not-mounted"
    checkout.rename(away)
    run(skill_usage_collect())
    assert str(checkout) in store.load_state(state)["projects"]["garden"]["missing"]

    away.rename(checkout)
    (checkout / ".claude" / "skills" / "prune-roses" / "SKILL.md").unlink()
    run(skill_usage_collect())

    garden = store.load_state(state)["projects"]["garden"]
    assert garden["missing"] == {} and sorted(held(state)["held"]) == ["plant-beds"]
    # and what it is kept on is recorded again, as it is now: a volume that is mounted
    assert os.path.ismount(garden["storage"][str(checkout)]["volume"])


@pytest.mark.skipif(os.name == "nt" or os.geteuid() == 0, reason="needs a folder not to be read")
def test_a_folder_the_user_may_not_look_at_is_not_a_folder_that_is_gone(
    state: Path, t3_store: T3Store, checkout: Path
) -> None:
    """Whether it is there cannot be told, so nothing is taken from it; and the collection
    goes on, where an older Python raises from the very question."""
    vault = checkout.parent / "vault"  # not the folder the record and the store are in
    orchard = checkout_at(vault / "orchard")
    t3_store.project("p2", orchard)
    t3_store.skill_tool(t3_store.thread("main-1", project_id="p2"), "plant-beds", stamp(1))
    run(skill_usage_collect())
    known = held(state, "orchard")
    t3_store.project("p3", vault / "shed")  # and one the collection has never seen
    t3_store.skill_tool(t3_store.thread("main-2", project_id="p3"), "plant-beds", stamp(0.5))
    vault.chmod(0o000)
    try:
        assert collect.folder_there(orchard) is None
        assert run(skill_usage_collect())["machine"] == "bench"
    finally:
        vault.chmod(0o755)

    projects = store.load_state(state)["projects"]
    assert held(state, "orchard") == known and projects["orchard"]["missing"] == {}
    assert projects["shed"]["skills"]["held"] == {}  # named by its folder, and holding nothing


def test_a_folder_of_another_system_is_no_place_on_this_one() -> None:
    """A store copied from another machine names its folders that machine's way. Nothing on
    this one says they were removed: not the folder the collection happens to run in."""
    account = {"at": None, "commit": None, "held": {"plant-beds": [200, 12]}, "renames": {}}
    foreign = ["Z:\\repos\\garden", "\\\\server\\share\\garden"]
    if os.name == "nt":
        foreign = ["/Users/someone/garden"]
    previous = {
        "garden": {
            "roots": foreign,
            "accounts": dict.fromkeys(foreign, account),
            "missing": dict.fromkeys(foreign, "2020-01-01T00:00:00+00:00"),  # long ago
        }
    }

    projects, _ = collect._name_projects(previous, {})

    assert sorted(projects["garden"]["accounts"]) == sorted(foreign)
    assert projects["garden"]["skills"]["held"] == {"plant-beds": [200, 12]}


def test_what_a_folder_is_kept_on_is_its_volume_or_its_cloud_drive(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    top = tmp_path.resolve()
    volume = top / "volume"
    repo = volume / "repos" / "garden"
    drive = top / "home" / "Library" / "CloudStorage" / "Drive-someone"
    synced = drive / "My Drive" / "garden"
    for folder in (repo, synced):
        folder.mkdir(parents=True)
    (top / "home" / "garden").symlink_to(repo)  # a link to a checkout on the volume
    mounted = {str(volume)}
    monkeypatch.setattr(collect.os.path, "ismount", lambda path: str(path) in mounted)
    current_id: dict[str, str | None] = {str(volume): "VOL-A"}
    monkeypatch.setattr(collect, "volume_id", lambda path: current_id.get(str(path)))

    on_volume_id = {"volume": str(volume), "id": "VOL-A"}
    assert collect.storage_of(repo) == on_volume_id
    assert collect.storage_of(top / "home" / "garden") == on_volume_id  # as its link resolves
    assert collect.storage_of(synced) == {"folder": str(drive)}
    assert collect.storage_of(top / "home") is None  # no volume above it is known
    assert collect.storage_of(top / "not-there") is None

    assert collect.storage_there(on_volume_id)
    assert collect.storage_there({"folder": str(drive)})
    # another disk at the same mount point is not the volume the folder was on
    assert not collect.storage_there({"volume": str(volume), "id": "VOL-B"})
    current_id[str(volume)] = None  # a disk with no identifier does not match one that had one
    assert not collect.storage_there(on_volume_id)
    assert not collect.storage_there({"volume": str(volume), "id": ""})
    assert not collect.storage_there({"volume": str(volume), "id": 5})

    # where the system gives no volume identifier, fall back to the device number
    on_volume = {"volume": str(volume), "device": os.stat(volume).st_dev}
    assert collect.storage_of(repo) == on_volume
    assert collect.storage_of(top / "home" / "garden") == on_volume
    assert collect.storage_there(on_volume)
    assert not collect.storage_there({**on_volume, "device": on_volume["device"] + 1})
    assert not collect.storage_there({"volume": str(volume), "device": True})
    assert not collect.storage_there({"volume": str(volume)})

    current_id[str(volume)] = "VOL-A"
    mounted.clear()  # the volume is away: its mount point may stay behind, an empty folder
    assert not collect.storage_there(on_volume_id)
    assert not collect.storage_there(on_volume)
    # Windows calls every drive letter a mount point by its name, there or not: the root is
    # looked at too
    monkeypatch.setattr(collect.os.path, "ismount", lambda path: True)
    assert not collect.storage_there({"volume": str(top / "no-such-drive"), "id": "VOL-A"})
    assert not collect.storage_there({"volume": str(top / "no-such-drive"), "device": 1})
    assert collect.storage_there(on_volume_id)
    assert collect.storage_there(on_volume)
    shutil.rmtree(drive)  # the drive's app signed out
    assert not collect.storage_there({"folder": str(drive)})
    assert not collect.storage_there({"folder": "/f\x00x"})
    assert not collect.storage_there({"volume": "/v\x00x", "id": "VOL-A"})
    assert not collect.storage_there({"volume": "/v\x00x", "device": 1})
    assert not collect.storage_there({}) and not collect.storage_there({"volume": 5})
    # and of a state changed by hand, only what a collection writes is read
    odd = {
        "a": {"volume": "/v", "device": 7},
        "b": {"volume": 5, "device": 7},
        "c": "x",
        4: {"folder": "/f"},
        "d": {"other": "/x"},
        "e": {"folder": "/f"},
        "f": {"volume": "/v"},
        "g": {"volume": "/v", "device": True},
        "h": {"folder": 5},
        "i": {"volume": "/v", "id": "VOL-A"},
        "j": {"volume": "/v", "id": "VOL-A", "device": 7},
        "k": {"volume": "/v", "id": ""},
        "l": {"volume": "/v", "id": "", "device": 7},
        "m": {"volume": "/v", "id": 5},
        "n": {"volume": 5, "id": "VOL-A"},
        "o": {"volume": "/v\x00x", "id": "VOL-A"},
        "p": {"folder": "/f\x00x"},
        "q": {"volume": "", "id": "VOL-A"},
        "r": {"folder": ""},
    }
    assert collect._storage(odd) == {
        "a": {"volume": "/v", "device": 7},
        "e": {"folder": "/f"},
        "i": {"volume": "/v", "id": "VOL-A"},
        "j": {"volume": "/v", "id": "VOL-A"},
    }
    assert collect._storage("x") == {}

    assert collect.folder_there(repo) is True
    assert collect.folder_there(top / "not-there") is False
    (top / "a-file").write_text("x", "utf-8")
    assert collect.folder_there(top / "a-file") is False  # a file where the folder was
    assert collect.folder_there(top / "a-file" / "under") is False


def test_a_volume_remounted_under_another_device_number_is_still_recognised(
    state: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When a volume remounts under a different st_dev, its identifier still matches so a
    checkout removed from it drops at the next collection instead of waiting 30 days."""
    volume = (tmp_path / "volume").resolve()
    repo = checkout_at(volume / "garden")
    built = T3Store(tmp_path / "remount.sqlite")
    built.project("p1", repo)
    built.skill_tool(built.thread("main-1"), "plant-beds", stamp(1))
    monkeypatch.setenv(store.T3_STORE_ENV, str(built.path))
    real_ismount = os.path.ismount
    real_stat = os.stat
    device = [100]

    class FakeStat:
        def __init__(self, inner: os.stat_result, dev: int) -> None:
            self._inner = inner
            self.st_dev = dev

        def __getattr__(self, name: str) -> object:
            return getattr(self._inner, name)

    def fake_stat(path: object, *args: object, **kwargs: object) -> object:
        result = real_stat(path, *args, **kwargs)
        if str(path) == str(volume):
            return FakeStat(result, device[0])
        return result

    monkeypatch.setattr(
        collect.os.path, "ismount", lambda path: str(path) == str(volume) or real_ismount(path)
    )
    monkeypatch.setattr(collect.os, "stat", fake_stat)
    monkeypatch.setattr(
        collect, "volume_id", lambda path: "VOL-A" if str(path) == str(volume) else None
    )

    run(skill_usage_collect())
    garden = store.load_state(state)["projects"]["garden"]
    assert garden["storage"][str(repo)] == {"volume": str(volume), "id": "VOL-A"}
    assert sorted(held(state)["held"]) == ["plant-beds", "prune-roses"]

    shutil.rmtree(repo)
    device[0] = 200  # volume came back under another device number
    run(skill_usage_collect())
    after = store.load_state(state)["projects"]["garden"]
    assert held(state)["held"] == {}
    assert (after["accounts"], after["storage"], after["missing"]) == ({}, {}, {})


def test_another_disk_at_the_same_mount_point_is_not_the_volume(
    state: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Another disk mounted at the same mount point, even with the same st_dev, is not
    mistaken for the original volume: the checkout's account stays instead of being dropped."""
    volume = (tmp_path / "volume").resolve()
    repo = checkout_at(volume / "garden")
    built = T3Store(tmp_path / "other-disk.sqlite")
    built.project("p1", repo)
    built.skill_tool(built.thread("main-1"), "plant-beds", stamp(1))
    monkeypatch.setenv(store.T3_STORE_ENV, str(built.path))
    real_ismount = os.path.ismount
    current_id: list[str | None] = ["VOL-A"]
    monkeypatch.setattr(
        collect.os.path, "ismount", lambda path: str(path) == str(volume) or real_ismount(path)
    )
    monkeypatch.setattr(
        collect, "volume_id", lambda path: current_id[0] if str(path) == str(volume) else None
    )

    run(skill_usage_collect())
    assert store.load_state(state)["projects"]["garden"]["storage"][str(repo)] == {
        "volume": str(volume),
        "id": "VOL-A",
    }

    shutil.rmtree(repo)
    current_id[0] = "VOL-B"  # another disk at the same mount point, with the exact same st_dev
    run(skill_usage_collect())
    assert sorted(held(state)["held"]) == ["plant-beds", "prune-roses"]
    assert str(repo) in store.load_state(state)["projects"]["garden"]["missing"]

    current_id[0] = None  # or another disk with no identifier at all
    run(skill_usage_collect())
    assert sorted(held(state)["held"]) == ["plant-beds", "prune-roses"]


@pytest.mark.parametrize("swap_device", [100, 200])
def test_a_disk_swap_during_one_collection_does_not_drop_a_missing_checkout(
    state: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, swap_device: int
) -> None:
    """If volume A is replaced by volume B mid-collection (whether st_dev changes or is
    reused), `storage_there` checks live instead of reusing volume A's cached identifier."""
    volume = (tmp_path / "volume").resolve()
    alpha = checkout_at(volume / "alpha")
    beta = checkout_at(volume / "beta")
    built = T3Store(tmp_path / "mid-swap.sqlite")
    built.project("p1", alpha)
    built.project("p2", beta)
    built.skill_tool(built.thread("main-1", project_id="p1"), "plant-beds", stamp(1))
    built.skill_tool(built.thread("main-2", project_id="p2"), "plant-beds", stamp(1))
    monkeypatch.setenv(store.T3_STORE_ENV, str(built.path))
    real_ismount = os.path.ismount
    real_stat = os.stat
    device = [100]
    current_id: list[str | None] = ["VOL-A"]

    class FakeStat:
        def __init__(self, inner: os.stat_result, dev: int) -> None:
            self._inner = inner
            self.st_dev = dev

        def __getattr__(self, name: str) -> object:
            return getattr(self._inner, name)

    def fake_stat(path: object, *args: object, **kwargs: object) -> object:
        result = real_stat(path, *args, **kwargs)
        if str(path) == str(volume):
            return FakeStat(result, device[0])
        return result

    monkeypatch.setattr(
        collect.os.path, "ismount", lambda path: str(path) == str(volume) or real_ismount(path)
    )
    monkeypatch.setattr(collect.os, "stat", fake_stat)
    monkeypatch.setattr(
        collect, "volume_id", lambda path: current_id[0] if str(path) == str(volume) else None
    )
    run(skill_usage_collect())
    assert sorted(held(state, "beta")["held"]) == ["plant-beds", "prune-roses"]

    # During the next collection: alpha is read on VOL-A, then VOL-B swaps in before beta is
    # checked (beta is missing on VOL-B). Beta's account must NOT be dropped.
    real_folder_there = collect.folder_there

    def swap_before_beta(path: Path) -> bool | None:
        if path == beta:
            current_id[0] = "VOL-B"
            device[0] = swap_device
            shutil.rmtree(beta, ignore_errors=True)
        return real_folder_there(path)

    monkeypatch.setattr(collect, "folder_there", swap_before_beta)
    run(skill_usage_collect())
    assert sorted(held(state, "beta")["held"]) == ["plant-beds", "prune-roses"]
    assert str(beta) in store.load_state(state)["projects"]["beta"]["missing"]


def test_a_malformed_volume_path_in_saved_state_does_not_stop_collection(
    state: Path, t3_store: T3Store, checkout: Path
) -> None:
    """An embedded NUL in saved storage is discarded on load so a missing checkout follows
    the normal 30-day grace period instead of raising ValueError."""
    t3_store.skill_tool(t3_store.thread("main-1"), "plant-beds", stamp(1))
    run(skill_usage_collect())
    saved = store.load_state(state)
    saved["projects"]["garden"]["storage"][str(checkout)] = {
        "volume": "/v\x00bad",
        "id": "VOL-A",
    }
    store.save_state(state, saved)
    shutil.rmtree(checkout)

    run(skill_usage_collect())
    after = store.load_state(state)["projects"]["garden"]
    assert sorted(held(state)["held"]) == ["plant-beds", "prune-roses"]
    assert str(checkout) in after["missing"]
    assert str(checkout) not in after["storage"]


def test_a_transient_volume_id_failure_preserves_recorded_identifier(
    state: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """If volume_id transiently returns None (e.g. diskutil timeout) while a checkout is
    present, keep its recorded identifier for that mount instead of downgrading to st_dev."""
    volume = (tmp_path / "volume").resolve()
    repo = checkout_at(volume / "garden")
    built = T3Store(tmp_path / "transient.sqlite")
    built.project("p1", repo)
    built.skill_tool(built.thread("main-1"), "plant-beds", stamp(1))
    monkeypatch.setenv(store.T3_STORE_ENV, str(built.path))
    real_ismount = os.path.ismount
    current_id: list[str | None] = ["VOL-A"]
    monkeypatch.setattr(
        collect.os.path, "ismount", lambda path: str(path) == str(volume) or real_ismount(path)
    )
    monkeypatch.setattr(
        collect, "volume_id", lambda path: current_id[0] if str(path) == str(volume) else None
    )

    run(skill_usage_collect())
    assert store.load_state(state)["projects"]["garden"]["storage"][str(repo)] == {
        "volume": str(volume),
        "id": "VOL-A",
    }

    current_id[0] = None  # transient lookup timeout while checkout is still present
    run(skill_usage_collect())
    assert store.load_state(state)["projects"]["garden"]["storage"][str(repo)] == {
        "volume": str(volume),
        "id": "VOL-A",
    }

    # Later a replacement disk at the same mount point (same st_dev) is NOT mistaken for VOL-A
    shutil.rmtree(repo)
    current_id[0] = "VOL-B"
    run(skill_usage_collect())
    assert sorted(held(state)["held"]) == ["plant-beds", "prune-roses"]
    assert str(repo) in store.load_state(state)["projects"]["garden"]["missing"]


def test_a_device_record_upgrades_to_volume_id_and_asks_once_per_mount(
    state: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An earlier device-only entry works for removal, upgrades to the volume identifier on
    the next read, and a collection queries each mount's identifier once for present roots."""
    volume = (tmp_path / "volume").resolve()
    garden = checkout_at(volume / "garden")
    orchard = checkout_at(volume / "orchard")
    built = T3Store(tmp_path / "upgrade.sqlite")
    built.project("p1", garden)
    built.project("p2", orchard)
    built.skill_tool(built.thread("main-1", project_id="p1"), "plant-beds", stamp(1))
    built.skill_tool(built.thread("main-2", project_id="p2"), "plant-beds", stamp(1))
    monkeypatch.setenv(store.T3_STORE_ENV, str(built.path))
    real_ismount = os.path.ismount
    monkeypatch.setattr(
        collect.os.path, "ismount", lambda path: str(path) == str(volume) or real_ismount(path)
    )
    calls: list[str] = []

    def fake_volume_id(path: Path) -> str | None:
        calls.append(str(path))
        return "VOL-A" if str(path) == str(volume) else None

    # First collection with no volume id available -> records device number
    monkeypatch.setattr(collect, "volume_id", lambda _path: None)
    run(skill_usage_collect())
    saved = store.load_state(state)
    assert saved["projects"]["garden"]["storage"][str(garden)] == {
        "volume": str(volume),
        "device": os.stat(volume).st_dev,
    }

    # Next collection with volume id available -> upgrades both and queries the mount once
    monkeypatch.setattr(collect, "volume_id", fake_volume_id)
    run(skill_usage_collect())
    saved = store.load_state(state)
    assert saved["projects"]["garden"]["storage"][str(garden)] == {
        "volume": str(volume),
        "id": "VOL-A",
    }
    assert saved["projects"]["orchard"]["storage"][str(orchard)] == {
        "volume": str(volume),
        "id": "VOL-A",
    }
    assert calls == [str(volume)]


@pytest.mark.skipif(os.name == "nt", reason="a link needs a privilege on Windows")
def test_a_link_to_a_checkout_on_a_volume_that_is_away_keeps_speaking(
    state: Path, t3_store: T3Store, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The link is there, on a disk that is there, and leads nowhere: the checkout was on
    the volume, and the volume is what is asked after."""
    volume = (tmp_path / "volume").resolve()
    repo = checkout_at(volume / "garden")
    link = tmp_path / "home" / "garden"
    link.parent.mkdir()
    link.symlink_to(repo)
    built = T3Store(tmp_path / "linked.sqlite")
    built.project("p1", link)
    built.skill_tool(built.thread("main-1"), "plant-beds", stamp(1))
    monkeypatch.setenv(store.T3_STORE_ENV, str(built.path))
    real = os.path.ismount
    mounted = {str(volume)}
    monkeypatch.setattr(collect.os.path, "ismount", lambda path: str(path) in mounted or real(path))
    monkeypatch.setattr(
        collect, "volume_id", lambda path: "VOL-LINK" if str(path) == str(volume) else None
    )
    run(skill_usage_collect())
    garden = store.load_state(state)["projects"]["garden"]
    assert garden["storage"][str(link)] == {"volume": str(volume), "id": "VOL-LINK"}

    volume.rename(volume.with_name("unmounted"))
    mounted.clear()
    run(skill_usage_collect())
    assert sorted(held(state)["held"]) == ["plant-beds", "prune-roses"]  # away, not removed

    volume.mkdir()  # the volume is back, and the checkout is not on it
    mounted.add(str(volume))
    run(skill_usage_collect())
    assert held(state)["held"] == {}


def test_a_branch_that_has_not_moved_is_not_read_again(
    state: Path, t3_store: T3Store, checkout: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    git(checkout, "init", "-q", "-b", "main")
    git(checkout, "remote", "add", "origin", "git@example.com:acme/garden.git")
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "skills", at="2026-03-01T10:00:00+00:00")
    other = checkout.parent / "garden-2"
    git(checkout, "worktree", "add", "-q", "-b", "topic", str(other))
    t3_store.project("p2", other)
    t3_store.skill_tool(t3_store.thread("main-1"), "plant-beds", stamp(1))
    t3_store.skill_tool(t3_store.thread("main-2", project_id="p2"), "plant-beds", stamp(1))
    read: list[Path] = []
    real = collect.held_at

    def reading(root: Path, commit: str) -> dict:
        read.append(root)
        return real(root, commit)

    monkeypatch.setattr(collect, "held_at", reading)

    run(skill_usage_collect())
    assert sorted(read) == [checkout, other]  # each folder says what it holds itself
    first = held(state, "acme/garden")
    run(skill_usage_collect())
    assert len(read) == 2 and held(state, "acme/garden") == first  # noqa: PLR2004

    git(checkout, "mv", ".claude/skills/plant-beds", ".claude/skills/build-beds")
    git(checkout, "commit", "-q", "-m", "rename", at="2026-03-02T10:00:00+00:00")
    run(skill_usage_collect())
    assert len(read) == 4 and "build-beds" in held(state, "acme/garden")["held"]  # noqa: PLR2004
    run(skill_usage_collect(rebuild=True))  # everything again, under the rules of this botcore
    assert len(read) == 6  # noqa: PLR2004


@pytest.mark.skipif(os.name == "nt", reason="a link needs a privilege on Windows")
def test_a_link_is_not_followed_in_a_commit(tmp_path: Path) -> None:
    root = checkout_at(tmp_path / "garden")
    skills = root / ".claude" / "skills"
    (skills / "linked").mkdir()
    (skills / "linked" / "SKILL.md").symlink_to("../plant-beds/SKILL.md")
    (root / ".codex").mkdir()
    (root / ".codex" / "skills").symlink_to("../.claude/skills")  # one folder under two names
    git(root, "init", "-q", "-b", "main")
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "skills")

    assert sorted(collect.held_at(root, "HEAD")) == ["plant-beds", "prune-roses"]


def test_a_folder_inside_a_repository_holds_its_own_skills(tmp_path: Path) -> None:
    """A project can be a folder inside a repository. It holds the skills under it, not the
    repository's, as its folder would if it were read as it lies."""
    root = checkout_at(tmp_path / "garden")
    inner = root / "packages" / "shed" / ".claude" / "skills" / "mend-shed"
    inner.mkdir(parents=True)
    (inner / "SKILL.md").write_text(skill_text("mend-shed", "Mend the shed.", 80), "utf-8")
    git(root, "init", "-q", "-b", "main")
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "skills")
    shed = root / "packages" / "shed"

    tip = collect.default_tip(shed)

    assert tip is not None and tip == collect.default_tip(root)
    assert collect.skill_inventory(shed)["held"] == collect.held_in_folder(shed)
    assert sorted(collect.skill_inventory(shed)["held"]) == ["mend-shed"]
    assert sorted(collect.skill_inventory(root)["held"]) == ["plant-beds", "prune-roses"]
    assert collect.default_tip(tmp_path) is None  # no repository: read as it lies


def test_a_report_reads_the_record_and_no_checkout(
    state: Path, t3_store: T3Store, checkout: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    t3_store.skill_tool(t3_store.thread("main-1"), "plant-beds", stamp(1))
    run(skill_usage_collect())
    assert held(state) == {
        "at": None,  # a folder that is no repository, read as it lies
        "commit": None,
        "held": {
            "plant-beds": [200, len("Plant a bed.")],
            "prune-roses": [120, len("Prune the roses.")],
        },
        "renames": {},
    }
    on_a_volume_away(state, "garden", checkout)
    shutil.rmtree(checkout)  # its volume is away

    data = run(skill_usage_report())

    assert rows(data)["plant-beds"]["size_bytes"] == 200
    assert [entry["skill"] for entry in data["quiet"]] == ["prune-roses"]
    assert data["warnings"] == []
    run(skill_usage_collect())  # with no folder to read, what was known stands
    assert sorted(held(state)["held"]) == ["plant-beds", "prune-roses"]


def test_a_project_no_folder_speaks_for_holds_nothing_and_says_so(
    state: Path, t3_store: T3Store, checkout: Path
) -> None:
    shutil.rmtree(checkout)
    t3_store.skill_tool(t3_store.thread("main-1"), "plant-beds", stamp(1))
    run(skill_usage_collect())

    data = run(skill_usage_report())

    assert held(state) == {"at": None, "commit": None, "held": {}, "renames": {}}
    assert "size_bytes" not in rows(data)["plant-beds"]
    assert data["warnings"] == []  # it was looked for: nothing is missing from the record


def test_sessions_no_project_is_known_for_are_not_a_record_that_does_not_say(
    state: Path, t3_store: T3Store
) -> None:
    t3_store.skill_tool(t3_store.thread("main-1", project_id="gone"), "plant-beds", stamp(1))
    run(skill_usage_collect())

    data = run(skill_usage_report())

    assert [row["project"] for row in data["skills"]] == ["unknown"]
    assert data["warnings"] == []  # no collection could ever say what "unknown" holds


def test_a_record_that_does_not_say_what_a_project_holds_is_named(
    state: Path, t3_store: T3Store
) -> None:
    t3_store.skill_tool(t3_store.thread("main-1"), "plant-beds", stamp(1))
    run(skill_usage_collect())
    saved = store.load_state(state)  # as a botcore before this wrote it
    del saved["projects"]["garden"]["skills"], saved["projects"]["garden"]["accounts"]
    store.save_state(state, saved)

    data = run(skill_usage_report())

    (warning,) = data["warnings"]
    assert "which skills these projects hold: garden." in warning
    assert "size_bytes" not in rows(data)["plant-beds"] and data["quiet"] == []
    run(skill_usage_collect())
    assert run(skill_usage_report())["warnings"] == []


def test_a_project_with_sessions_and_no_load_is_named_too(state: Path, t3_store: T3Store) -> None:
    """An empty `quiet` list would read as no skill unused."""
    seen = {"createdAt": stamp(2), "updatedAt": stamp(1)}
    t3_store.message(t3_store.thread("main-1", extra=seen), "hello", stamp(1))
    run(skill_usage_collect())
    saved = store.load_state(state)
    del saved["projects"]["garden"]["skills"], saved["projects"]["garden"]["accounts"]
    store.save_state(state, saved)

    data = run(skill_usage_report())

    assert (data["skills"], data["quiet"], data["totals"]["sessions_seen"]) == ([], [], 1)
    assert "which skills these projects hold: garden." in data["warnings"][0]


def test_the_newest_account_of_a_project_is_the_one_read() -> None:
    old = {"at": "2026-01-01T00:00:00+00:00", "commit": "a", "held": {"a": [1, 1]}}
    new = {"at": "2026-01-02T00:00:00+00:00", "commit": "b", "held": {}}
    east = {"at": "2026-01-02T05:00:00+09:00", "commit": "c", "held": {"c": [1, 1]}}
    folder = {"at": None, "commit": None, "held": {"d": [1, 1]}}
    empty = {"at": None, "commit": None, "held": {}}

    assert store.newest_inventory([old, east, folder, empty, new]) is new  # a moment, not text
    assert store.newest_inventory([empty, folder, {"at": "soon", "held": {}}]) is folder
    assert store.newest_inventory([folder, dict(folder)]) is folder  # of two alike, the first
    assert store.newest_inventory([]) is None
    assert store.as_inventory({"held": []}) is None and store.as_inventory("x") is None


def test_only_what_a_collection_writes_is_kept_of_an_account() -> None:
    """It is shared: nothing a hand put in the file reaches another machine."""
    commit = "a" * 40
    odd = {
        "at": "2026-01-02T05:00:00+09:00",
        "commit": commit,
        "held": {
            "a": [1, 2], "b": [1], "c": ["1", 2], 4: [1, 2], "d": [True, 1], "e": [-1, 2],
            "/home/someone/notes": [1, 1], "a sentence someone wrote": [1, 1], "x" * 101: [1, 1],
        },
        "renames": {"old": "new", "old name": "new", "older": "../up", 5: "new", "elder": 5},
        "folder": "/home/someone",
    }  # fmt: skip

    assert store.as_inventory(odd) == {
        "at": "2026-01-01T20:00:00+00:00",  # one way of writing a moment
        "commit": commit,
        "held": {"a": [1, 2]},
        "renames": {"old": "new"},
    }
    # a time with no commit, or a commit with no time, is neither
    for at, named in (("soon", commit), ("2026-01-02T05:00:00+09:00", "/home/someone"), (5, 5)):
        found = store.as_inventory({**odd, "at": at, "commit": named})
        assert (found["at"], found["commit"]) == (None, None)


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


def test_t3_read_reports_progress_and_stops_when_left(
    t3_store: T3Store, monkeypatch: pytest.MonkeyPatch
) -> None:
    """lushly-dev/afd#2160: SQLite reads report progress via steps.doing so the hourly job
    never times out a busy collection, and abort immediately with steps.Left when left."""
    from botcore.commands.disk import steps

    thread = t3_store.thread("main-1")
    for idx in range(60):
        t3_store.skill_tool(thread, "plant-beds", stamp(1, idx))

    said: list[tuple[str, str]] = []
    monkeypatch.setattr(t3, "PROGRESS_STEPS", 10)
    monkeypatch.setattr(t3, "ROW_PROGRESS_EVERY", 10)
    monkeypatch.setattr(steps, "SAID", said)
    read = collect._read_t3(t3_store.path, since=None, natives=True)
    assert len(read.loads) == 60
    t3_words = [word for word in said if word[0] == "reading T3 Code's store"]
    assert len(t3_words) >= 6
    assert all(word[1] == str(t3_store.path) for word in t3_words), t3_words

    # When the step has been left, the SQLite progress handler interrupts the query and raises
    # steps.Left instead of wrapping it as StoreUnreadable.
    def interrupt() -> None:
        conn = t3.open_store(t3_store.path)
        try:
            with t3.progress(conn, t3_store.path):
                conn.execute(
                    "with recursive c(x) as ("
                    "select 1 union all select x + 1 from c where x < 50000"
                    ") select count(*) from c"
                ).fetchall()
        finally:
            conn.close()

    step = steps.Step("left-t3", lambda: None)
    step.wait(10)
    step.leave()
    steps._HERE.step = step  # noqa: SLF001
    try:
        with pytest.raises(steps.Left):
            interrupt()
    finally:
        steps._HERE.step = None  # noqa: SLF001


def test_t3_native_ids_finds_unicode_escaped_key(t3_store: T3Store) -> None:
    """lushly-dev/afd#2160: _native_ids LIKE prefilter still matches valid JSON rows whose
    nativeItemRef key uses RFC 8259 \\uXXXX escapes, while excluding codex items."""
    thread = t3_store.thread("main-1")
    claude_payload = (
        '{"status":"completed","native\\u0049temRef":'
        '{"driver":"claude","nativeId":"toolu_escaped"}}'
    )
    codex_payload = (
        '{"status":"completed","native\\u0049temRef":'
        '{"driver":"codex","nativeId":"toolu_codex_escaped"}}'
    )
    with t3_store.connect() as conn:
        conn.execute(
            f"insert into {t3.ITEMS} (turn_item_id, thread_id, type, updated_at, payload_json)"
            " values (?, ?, ?, ?, ?)",
            ("item-escaped-claude", thread, t3.TOOL, stamp(1, 0), claude_payload),
        )
        conn.execute(
            f"insert into {t3.ITEMS} (turn_item_id, thread_id, type, updated_at, payload_json)"
            " values (?, ?, ?, ?, ?)",
            ("item-escaped-codex", thread, t3.TOOL, stamp(1, 1), codex_payload),
        )
        conn.commit()
        found = t3._native_ids(conn)
    assert found == {"toolu_escaped"}


def test_project_upgrades_from_folder_name_once_origin_resolves(
    state: Path, t3_store: T3Store, checkout: Path
) -> None:
    """lushly-dev/afd#2052: a folder first seen without a readable origin moves from its
    folder name to owner/name once an origin is present, and refiles earlier loads and
    sessions — even those T3 Code has since dropped."""
    git(checkout, "init", "-q", "-b", "main")
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "skills", at="2026-04-01T10:00:00+00:00")
    first_thread = t3_store.thread("main-1")
    t3_store.skill_tool(first_thread, "plant-beds", stamp(1))

    run(skill_usage_collect())
    assert [event.project for event in collected(state)] == ["garden"]
    assert store.load_sessions(state)[first_thread]["project"] == "garden"

    # Drop the first thread from T3 Code's store before origin is added so refiling must
    # preserve and move records T3 Code no longer holds.
    with t3_store.connect() as conn:
        conn.execute(f"delete from {t3.ITEMS} where thread_id = ?", (first_thread,))
        conn.execute(f"delete from {t3.THREADS} where thread_id = ?", (first_thread,))
        conn.commit()
    second_thread = t3_store.thread("main-2")
    t3_store.skill_tool(second_thread, "plant-beds", stamp(2))

    git(checkout, "remote", "add", "origin", "git@example.com:acme/garden.git")
    run(skill_usage_collect())

    saved = store.load_state(state)
    assert "garden" not in saved["projects"]
    assert saved["projects"]["acme/garden"]["remote"] is True
    assert str(checkout) in saved["projects"]["acme/garden"]["roots"]
    assert {event.project for event in collected(state)} == {"acme/garden"}
    assert len(collected(state)) == 2
    sessions = store.load_sessions(state)
    assert sessions[first_thread]["project"] == "acme/garden"
    assert sessions[second_thread]["project"] == "acme/garden"

    report = run(skill_usage_report())
    assert [(row["project"], row["skill"], row["sessions"]) for row in report["skills"]] == [
        ("acme/garden", "plant-beds", 2)
    ]
    assert [(row["project"], row["skill"]) for row in report["quiet"]] == [
        ("acme/garden", "prune-roses")
    ]


def test_second_checkout_without_a_readable_origin_merges_into_remote_project(
    state: Path, t3_store: T3Store, checkout: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """lushly-dev/afd#2052: when one of two clones of an origin has no readable origin on first
    collection, it is named after its folder temporarily; once origin resolves, it merges into
    owner/name and its duplicate quiet skills disappear."""
    git(checkout, "init", "-q", "-b", "main")
    git(checkout, "remote", "add", "origin", "git@example.com:acme/garden.git")
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "skills", at="2026-04-01T10:00:00+00:00")
    second = checkout.parent / "second" / "garden"
    subprocess.run(["git", "clone", "-q", str(checkout), str(second)], check=True)
    git(second, "remote", "set-url", "origin", "git@example.com:acme/garden.git")
    t3_store.project("p2", second)
    t3_store.skill_tool(t3_store.thread("main-1"), "plant-beds", stamp(1))
    t3_store.skill_tool(t3_store.thread("main-2", project_id="p2"), "plant-beds", stamp(2))

    real_remote = collect.project_remote

    def unreadable(root: Path) -> str | None:
        if Path(root) == second:
            return None
        return real_remote(root)

    monkeypatch.setattr(collect, "project_remote", unreadable)
    run(skill_usage_collect())
    before = run(skill_usage_report())
    assert {(row["project"], row["skill"]) for row in before["quiet"]} == {
        ("acme/garden", "prune-roses"),
        ("garden", "prune-roses"),
    }

    monkeypatch.setattr(collect, "project_remote", real_remote)
    run(skill_usage_collect())

    saved = store.load_state(state)
    assert "garden" not in saved["projects"]
    assert set(saved["projects"]["acme/garden"]["roots"]) == {str(checkout), str(second)}
    after = run(skill_usage_report())
    assert [(row["project"], row["skill"], row["sessions"]) for row in after["skills"]] == [
        ("acme/garden", "plant-beds", 2)
    ]
    assert [(row["project"], row["skill"]) for row in after["quiet"]] == [
        ("acme/garden", "prune-roses")
    ]


def test_staged_multi_root_upgrade_does_not_misattribute_history(tmp_path: Path) -> None:
    """lushly-dev/afd#2052: if a legacy remote:false project has two roots that upgrade to
    different origins across separate collections, historical records are not blindly refiled
    to the second destination."""
    one = tmp_path / "one" / "shared"
    two = tmp_path / "two" / "shared"
    one.mkdir(parents=True)
    two.mkdir(parents=True)
    git(one, "init", "-q", "-b", "main")
    git(one, "remote", "add", "origin", "git@example.com:acme/one.git")
    git(two, "init", "-q", "-b", "main")

    previous = {"shared": {"remote": False, "roots": [str(one), str(two)]}}
    refiled_first: dict[str, str] = {}
    projects, _ = collect._name_projects(previous, {}, refiled=refiled_first)
    assert refiled_first == {}
    assert projects["shared"].get("split") is True
    assert projects["shared"]["roots"] == [str(two)]
    assert str(one) in projects["acme/one"]["roots"]

    git(two, "remote", "add", "origin", "git@example.com:acme/two.git")
    refiled_second: dict[str, str] = {}
    projects2, _ = collect._name_projects(projects, {}, refiled=refiled_second)
    assert refiled_second == {}
    assert str(two) in projects2["acme/two"]["roots"]
    assert projects2["shared"]["roots"] == []


def test_remote_upgrade_preserves_unreadable_event_lines(
    state: Path, t3_store: T3Store, checkout: Path
) -> None:
    """lushly-dev/afd#2052: automatic refiling during normal collection preserves unreadable
    lines in events.jsonl so damage evidence is never silently dropped."""
    git(checkout, "init", "-q", "-b", "main")
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "skills", at="2026-04-01T10:00:00+00:00")
    t3_store.skill_tool(t3_store.thread("main-1"), "plant-beds", stamp(1))

    run(skill_usage_collect())
    events_path = state / store.EVENTS_FILE
    events_path.write_text(
        events_path.read_text(encoding="utf-8") + "{corrupted-json-line\n", encoding="utf-8"
    )

    git(checkout, "remote", "add", "origin", "git@example.com:acme/garden.git")
    run(skill_usage_collect())

    events, unreadable = store.load_events(state)
    assert unreadable == 1
    assert [event.project for event in events] == ["acme/garden"]


def test_project_remote_reads_git_config_on_dubious_ownership(
    state: Path, t3_store: T3Store, checkout: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """lushly-dev/afd#2370: when git refuses a clone with dubious ownership, project_remote
    reads [remote "origin"] directly from .git/config (and follows worktree gitdir/commondir),
    so clones merge under owner/name without splitting or duplicating quiet skills."""
    git(checkout, "init", "-q", "-b", "main")
    git(checkout, "remote", "add", "origin", "https://github.com/acme/garden.git")
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "skills", at="2026-04-01T10:00:00+00:00")

    worktree = checkout.parent / "wt-garden"
    git(checkout, "worktree", "add", "-q", "-b", "topic", str(worktree))
    t3_store.project("p2", worktree)
    t3_store.skill_tool(t3_store.thread("main-1"), "plant-beds", stamp(1))
    t3_store.skill_tool(t3_store.thread("main-2", project_id="p2"), "plant-beds", stamp(2))

    real = collect.git_out

    def dubious(root: Path, *args: str, **more: object) -> str:
        if Path(root) == worktree:
            raise collect.GitError("git: fatal: detected dubious ownership in repository")
        return real(root, *args, **more)

    monkeypatch.setattr(collect, "git_out", dubious)
    assert collect.project_remote(worktree) == "acme/garden"

    run(skill_usage_collect())
    saved = store.load_state(state)
    assert list(saved["projects"]) == ["acme/garden"]
    assert set(saved["projects"]["acme/garden"]["roots"]) == {str(checkout), str(worktree)}

    report = run(skill_usage_report())
    assert [(row["project"], row["skill"], row["sessions"]) for row in report["skills"]] == [
        ("acme/garden", "plant-beds", 2)
    ]
    assert [(row["project"], row["skill"]) for row in report["quiet"]] == [
        ("acme/garden", "prune-roses")
    ]


def test_cached_folder_fallback_upgrades_via_git_config_on_dubious_ownership(
    state: Path, t3_store: T3Store, checkout: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """lushly-dev/afd#2370: a pre-existing remote:false folder-name entry in state.json
    upgrades cleanly to owner/name even while git still refuses dubious ownership."""
    git(checkout, "init", "-q", "-b", "main")
    git(checkout, "remote", "add", "origin", "https://github.com/acme/garden.git")
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "skills", at="2026-04-01T10:00:00+00:00")

    # Seed state as if an older botcore version cached the dubious-ownership clone under its
    # folder name (`remote: false`).
    store.save_state(
        state,
        {
            "version": collect.STATE_VERSION,
            "projects": {
                "garden": {
                    "remote": False,
                    "roots": [str(checkout)],
                    "renames": {},
                    "accounts": {},
                    "storage": {},
                    "missing": {},
                }
            },
        },
    )
    t3_store.skill_tool(t3_store.thread("main-1"), "plant-beds", stamp(1))

    def dubious(root: Path, *args: str, **more: object) -> str:
        raise collect.GitError("git: fatal: detected dubious ownership in repository")

    monkeypatch.setattr(collect, "git_out", dubious)
    run(skill_usage_collect())

    saved = store.load_state(state)
    assert "garden" not in saved["projects"]
    assert saved["projects"]["acme/garden"]["remote"] is True
    assert [event.project for event in collected(state)] == ["acme/garden"]
