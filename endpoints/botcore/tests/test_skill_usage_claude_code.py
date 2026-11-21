"""Skill usage from Claude Code's own transcripts: the sessions T3 Code did not run."""

# ruff: noqa: F811 - pytest fixtures imported from the collect tests

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from botcore.commands.skill_usage import (
    claude_code,
    skill_usage_collect,
    skill_usage_report,
    store,
)
from tests.test_skill_usage import (  # noqa: F401 - fixtures
    T3Store,
    checkout,
    collected,
    rows,
    run,
    stamp,
    state,
    t3_store,
)

PRIVATE = "the-private-text"


class Transcripts:
    """Claude Code's transcripts folder, written a line at a time as Claude Code writes it."""

    def __init__(self, root: Path, cwd: Path) -> None:
        self.root, self.cwd, self.count = root, cwd, 0
        root.mkdir()

    def file(self, session: str, subagent: str | None = None) -> Path:
        folder = self.root / "-work-garden"
        if subagent:
            return folder / session / "subagents" / f"agent-{subagent}.jsonl"
        return folder / f"{session}.jsonl"

    def write(self, session: str, row: dict, subagent: str | None = None, **more: object) -> None:
        self.count += 1
        target = self.file(session, subagent)
        target.parent.mkdir(parents=True, exist_ok=True)
        row = {
            "uuid": f"row-{self.count}", "sessionId": session, "cwd": str(self.cwd),
            "entrypoint": "claude-desktop", "isSidechain": subagent is not None, **row, **more,
        }  # fmt: skip
        with target.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row) + "\n")

    def call(  # noqa: PLR0913 - one tool call and its result
        self, session: str, tool: str, arguments: dict, at: str, call: str | None = None,
        error: bool | None = False, subagent: str | None = None, **more: object,
    ) -> str:  # fmt: skip
        """A tool call and its result; `error=None` leaves the call without one."""
        call = call or f"toolu_{self.count + 1}"
        used = {"type": "tool_use", "id": call, "name": tool, "input": arguments}
        said = {"type": "text", "text": f"I will do it: {PRIVATE}"}
        message = {"role": "assistant", "model": "claude-opus", "content": [said, used]}
        self.write(session, {"type": "assistant", "timestamp": at, "message": message},
                   subagent, **more)  # fmt: skip
        if error is not None:
            result = {"type": "tool_result", "tool_use_id": call, "is_error": error,
                      "content": f"what it printed: {PRIVATE}"}  # fmt: skip
            self.write(session, {"type": "user", "timestamp": at,
                                 "message": {"role": "user", "content": [result]}},
                       subagent, **more)  # fmt: skip
        return call

    def say(self, session: str, text: str, at: str, **more: object) -> None:
        self.write(session, {"type": "user", "timestamp": at,
                             "message": {"role": "user", "content": text}}, **more)  # fmt: skip


@pytest.fixture
def transcripts(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, checkout: Path) -> Transcripts:
    built = Transcripts(tmp_path / "claude-projects", checkout)
    monkeypatch.setenv(claude_code.DIR_ENV, str(built.root))
    return built


def skill_file(root: Path, name: str = "plant-beds") -> str:
    return str(root / ".claude" / "skills" / name / "SKILL.md")


def by_path(state: Path) -> dict[str, list[str]]:
    found: dict[str, list[str]] = {}
    for event in collected(state):
        found.setdefault(event.path, []).append(event.skill)
    return {path: sorted(skills) for path, skills in found.items()}


def test_a_session_outside_t3_code_is_read_from_its_transcript(
    state: Path, transcripts: Transcripts, checkout: Path
) -> None:
    transcripts.say("s1", f"please look at the beds, {PRIVATE}", stamp(2, 0))
    transcripts.call("s1", "Skill", {"skill": "plant-beds", "args": PRIVATE}, stamp(2, 1))
    transcripts.call("s1", "Read", {"file_path": skill_file(checkout, "prune-roses")}, stamp(2, 2))
    shown = f"cat {skill_file(checkout)} # {PRIVATE}"
    transcripts.call("s1", "Bash", {"command": shown}, stamp(2, 3))
    transcripts.call("s1", "Edit", {"file_path": skill_file(checkout), "old_string": PRIVATE},
                     stamp(2, 4))  # fmt: skip
    # what is no load: a call that failed, one that never came back, a file that is no skill
    transcripts.call("s1", "Skill", {"skill": "prune-roses"}, stamp(2, 5), error=True)
    transcripts.call("s1", "Skill", {"skill": "prune-roses"}, stamp(2, 6), error=None)
    transcripts.call("s1", "Read", {"file_path": str(checkout / "notes.md")}, stamp(2, 7))
    transcripts.call("s1", "Grep", {"pattern": "SKILL.md"}, stamp(2, 8))
    # a subagent's load is its session's
    transcripts.call("s1", "Skill", {"skill": "prune-roses"}, stamp(2, 9), subagent="a1")
    # a command a person typed is a load when it names a skill
    transcripts.say("s1", "<command-name>/plant-beds</command-name> and go", stamp(1, 0))
    transcripts.say("s1", "<command-name>/clear</command-name>", stamp(1, 1))
    transcripts.say("s1", "<command-name>/prune-roses</command-name>", stamp(1, 2), isMeta=True)

    data = run(skill_usage_collect())

    assert by_path(state) == {
        "skill_tool": ["plant-beds", "prune-roses"],
        "file_read": ["prune-roses"],
        "shell_read": ["plant-beds"],
        "edit": ["plant-beds"],
        "typed": ["plant-beds"],
    }
    events = collected(state)
    assert {event.thread for event in events} == {"claude-code:s1"}
    assert {(event.source, event.harness, event.machine, event.model) for event in events} == {
        ("claude-code", "claude", "bench", "claude-opus"), ("claude-code", "claude", "bench", None),
    }  # fmt: skip
    assert [event.agent for event in events if event.skill == "prune-roses"] == [
        "main", "subagent",
    ]  # fmt: skip
    assert store.load_sessions(state)["claude-code:s1"] == {
        "root": "claude-code:s1", "parent": None, "agent": "main", "harness": "claude",
        "project": "garden", "created_at": stamp(2, 0), "machine": "bench", "pull_requests": [],
        "updated_at": store.load_sessions(state)["claude-code:s1"]["updated_at"],
    }  # fmt: skip
    source = next(found for found in data["sources"] if found["source"] == "claude-code")
    assert (source["status"], source["sessions"], source["read"], source["added"]) == (
        "read", 1, 1, 6,
    )  # fmt: skip
    for name in (store.EVENTS_FILE, store.SESSIONS_FILE, store.STATE_FILE):
        assert PRIVATE not in (state / name).read_text("utf-8")  # only the load leaves it

    report = rows(run(skill_usage_report()))
    assert "plant-beds" not in report  # the session changed that skill: it was writing it
    row = report["prune-roses"]
    assert (row["sessions"], row["of_sessions"], row["harnesses"]) == (1, 1, {"claude": 1})


def test_a_session_t3_code_ran_is_left_to_its_store(
    state: Path, t3_store: T3Store, transcripts: Transcripts, monkeypatch: pytest.MonkeyPatch
) -> None:
    thread = t3_store.thread("main")
    t3_store.skill_tool(thread, "plant-beds", stamp(2), native_id="toolu_shared")
    # the same session, as Claude Code wrote it: one names T3 Code as what started it, the
    # other only holds a call the store holds too
    transcripts.call("named", "Skill", {"skill": "prune-roses"}, stamp(2), entrypoint="t3-code")
    transcripts.call("held", "Skill", {"skill": "plant-beds"}, stamp(2), call="toolu_shared",
                     entrypoint="sdk-ts")  # fmt: skip
    transcripts.call("held", "Skill", {"skill": "prune-roses"}, stamp(2), entrypoint="sdk-ts")
    transcripts.call("free", "Skill", {"skill": "prune-roses"}, stamp(2), entrypoint="sdk-cli")

    data = run(skill_usage_collect())

    assert sorted((event.thread, event.skill) for event in collected(state)) == [
        ("claude-code:free", "prune-roses"), ("main", "plant-beds"),
    ]  # fmt: skip
    assert sorted(store.load_sessions(state)) == ["claude-code:free", "main"]
    source = next(found for found in data["sources"] if found["source"] == "claude-code")
    assert (source["sessions"], source["read"], source["left_to_t3"]) == (3, 1, 2)

    # once T3 Code's, a transcript is never opened again, however it grows
    opened: list[str] = []
    real = claude_code._transcript
    monkeypatch.setattr(claude_code, "_transcript",
                        lambda files: opened.append(files[0].stem) or real(files))  # fmt: skip
    for session in ("named", "held", "free"):
        transcripts.call(session, "Skill", {"skill": "plant-beds"}, stamp(1),
                         entrypoint="claude-desktop")  # fmt: skip
    data = run(skill_usage_collect())
    assert opened == ["free"] and data["added"] == 1


def test_only_a_transcript_that_changed_is_read_again(
    state: Path, transcripts: Transcripts, monkeypatch: pytest.MonkeyPatch
) -> None:
    transcripts.call("s1", "Skill", {"skill": "plant-beds"}, stamp(2))
    transcripts.call("s2", "Skill", {"skill": "plant-beds"}, stamp(2))
    assert run(skill_usage_collect())["added"] == 2
    opened: list[str] = []
    real = claude_code._transcript
    monkeypatch.setattr(claude_code, "_transcript",
                        lambda files: opened.append(files[0].stem) or real(files))  # fmt: skip

    assert run(skill_usage_collect())["added"] == 0 and opened == []

    transcripts.call("s2", "Skill", {"skill": "prune-roses"}, stamp(1), subagent="a1")
    data = run(skill_usage_collect())  # a subagent's file beside it is the session's too
    source = next(found for found in data["sources"] if found["source"] == "claude-code")
    assert opened == ["s2"] and (source["read"], source["unchanged"], data["added"]) == (1, 1, 1)
    assert len(collected(state)) == 3  # and what it held before is not added twice


def test_a_load_two_sources_show_is_one_load(
    state: Path, t3_store: T3Store, transcripts: Transcripts, monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:  # fmt: skip
    t3_store.skill_tool(t3_store.thread("main"), "plant-beds", stamp(2), native_id="toolu_one")
    run(skill_usage_collect())
    # T3 Code has since dropped the thread; Claude Code still has the session's transcript
    emptied = T3Store(tmp_path / "later.sqlite")
    monkeypatch.setenv(store.T3_STORE_ENV, str(emptied.path))
    transcripts.call("s1", "Skill", {"skill": "plant-beds"}, stamp(2), call="toolu_one")
    transcripts.call("s1", "Skill", {"skill": "prune-roses"}, stamp(2), call="toolu_two")

    run(skill_usage_collect())

    assert sorted((event.source, event.skill) for event in collected(state)) == [
        ("claude-code", "prune-roses"), ("t3-code", "plant-beds"),
    ]  # fmt: skip


def test_a_rebuild_reads_every_transcript_again_and_keeps_what_is_gone(
    state: Path, transcripts: Transcripts
) -> None:
    transcripts.call("stays", "Skill", {"skill": "plant-beds"}, stamp(2))
    transcripts.call("goes", "Skill", {"skill": "prune-roses"}, stamp(2))
    run(skill_usage_collect())
    transcripts.file("goes").unlink()  # Claude Code clears old transcripts
    recognised = collected(state)
    stale = [{**event.to_json(), "id": f"{event.id}-old", "skill": "an-old-reading"}
             for event in recognised]  # fmt: skip
    with (state / store.EVENTS_FILE).open("a", encoding="utf-8") as handle:
        handle.writelines(json.dumps(event) + "\n" for event in stale)

    data = run(skill_usage_collect(rebuild=True))

    kept = sorted((event.thread, event.skill) for event in collected(state))
    assert kept == [
        ("claude-code:goes", "an-old-reading"),  # nothing left to read it again from
        ("claude-code:goes", "prune-roses"),
        ("claude-code:stays", "plant-beds"),  # read again: the old reading is replaced
    ]
    assert data["removed"] == 1


def test_a_session_is_filed_under_the_repository_it_ran_in(
    state: Path, transcripts: Transcripts, checkout: Path, tmp_path: Path
) -> None:
    for command in (["init", "-q", "-b", "main"],
                    ["remote", "add", "origin", "git@example.com:acme/garden.git"]):  # fmt: skip
        subprocess.run(["git", "-C", str(checkout), *command], check=True)
    gone = checkout / ".claude" / "worktrees" / "a-worktree-since-removed"
    transcripts.call("inside", "Skill", {"skill": "plant-beds"}, stamp(2), cwd=str(gone))
    transcripts.call("nowhere", "Skill", {"skill": "plant-beds"}, stamp(2),
                     cwd=str(tmp_path / "never" / "a" / "repository"))  # fmt: skip
    transcripts.call("odd", "Skill", {"skill": "plant-beds"}, stamp(2), cwd="not a path")

    run(skill_usage_collect())

    sessions = store.load_sessions(state)
    assert sessions["claude-code:inside"]["project"] == "acme/garden"
    assert sessions["claude-code:nowhere"]["project"] == "unknown"
    assert sessions["claude-code:odd"]["project"] == "unknown"
    assert str(tmp_path) not in (state / store.EVENTS_FILE).read_text("utf-8")


def test_either_source_alone_is_enough_and_neither_is_nothing(
    state: Path, transcripts: Transcripts, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    transcripts.call("s1", "Skill", {"skill": "plant-beds"}, stamp(2))
    transcripts.file("broken").write_text('{"type": "assistant", "half a li', "utf-8")

    data = run(skill_usage_collect())  # no T3 Code on this machine

    assert data["added"] == 1
    assert [(found["source"], found["status"]) for found in data["sources"]] == [
        ("claude-code", "read"), ("t3-code", "off"),
    ]  # fmt: skip

    monkeypatch.setenv(claude_code.DIR_ENV, str(tmp_path / "no-claude-code-here"))
    data = run(skill_usage_collect())
    assert data["added"] == 0 and not (state / store.STATE_FILE).read_text("utf-8") == ""
    assert [(found["source"], found["status"]) for found in data["sources"]] == [
        ("t3-code", "off"), ("claude-code", "absent"),
    ]  # fmt: skip

    built = T3Store(tmp_path / "copied.sqlite")  # a store copied from another machine
    built.skill_tool(built.thread("theirs"), "plant-beds", stamp(1))
    monkeypatch.setenv(claude_code.DIR_ENV, str(transcripts.root))
    transcripts.call("s2", "Skill", {"skill": "prune-roses"}, stamp(1))
    data = run(skill_usage_collect(t3_store=str(built.path), machine="tower"))
    assert [found["source"] for found in data["sources"]] == ["t3-code"]  # read alone
    assert "claude-code:s2" not in store.load_sessions(state)
