"""Skill usage from Claude Code's own transcripts: the sessions T3 Code did not run."""

# ruff: noqa: F811 - pytest fixtures imported from the collect tests

from __future__ import annotations

import json
import os
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
        """A row of `session`, in its own file unless `into` names another transcript's."""
        self.count += 1
        target = self.file(str(more.pop("into", session)), subagent)
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
    subprocess.run(["git", "-C", str(checkout), "init", "-q", "-b", "main"], check=True)
    built = Transcripts(tmp_path / "claude-projects", checkout)
    monkeypatch.setenv(claude_code.DIR_ENV, str(built.root))
    return built


def source(data: dict) -> dict:
    return next(found for found in data["sources"] if found["source"] == "claude-code")


def opens(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """The transcripts the reader opens from here on."""
    opened: list[str] = []
    real = claude_code._transcript
    monkeypatch.setattr(
        claude_code, "_transcript",
        lambda home, files, others: opened.append(home) or real(home, files, others),
    )  # fmt: skip
    return opened


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
    found = source(data)
    assert (found["status"], found["transcripts"], found["read"], found["added"]) == (
        "read", 1, 1, 6,
    )  # fmt: skip
    for name in (store.EVENTS_FILE, store.SESSIONS_FILE, store.STATE_FILE):
        assert PRIVATE not in (state / name).read_text("utf-8")  # only the load leaves it

    report = rows(run(skill_usage_report()))
    assert "plant-beds" not in report  # the session changed that skill: it was writing it
    row = report["prune-roses"]
    assert (row["sessions"], row["of_sessions"], row["harnesses"]) == (1, 1, {"claude": 1})


def test_what_t3_code_ran_is_left_to_its_store(
    state: Path, t3_store: T3Store, transcripts: Transcripts, monkeypatch: pytest.MonkeyPatch
) -> None:
    thread = t3_store.thread("main")
    t3_store.skill_tool(thread, "plant-beds", stamp(2), native_id="toolu_shared")
    t3_store.skill_tool(thread, "plant-beds", stamp(2), native_id="toolu_mixed")
    t3_store.shell(thread, "true", stamp(2), native_id="toolu_codex")  # a Codex item's id
    # a session T3 Code ran, as Claude Code wrote it: one names T3 Code as what started it,
    # the other only holds a call the store holds too
    transcripts.call("named", "Skill", {"skill": "prune-roses"}, stamp(2), entrypoint="t3-code")
    transcripts.call("held", "Skill", {"skill": "plant-beds"}, stamp(2), call="toolu_shared",
                     entrypoint="sdk-ts")  # fmt: skip
    # one T3 Code never ran, though a Codex item of the store carries the id of its call
    transcripts.call("free", "Skill", {"skill": "prune-roses"}, stamp(2), call="toolu_codex",
                     entrypoint="sdk-cli")  # fmt: skip
    # one that began under T3 Code and was continued elsewhere: what it did there is its own
    transcripts.call("mixed", "Skill", {"skill": "plant-beds"}, stamp(2), call="toolu_mixed",
                     entrypoint="t3-code")  # fmt: skip
    transcripts.call("mixed", "Skill", {"skill": "prune-roses"}, stamp(1))
    # and one whose own transcript is gone: one copy of its rows holds what T3 Code ran of
    # it, another what it did elsewhere. It is ours for the second, whatever the first says
    transcripts.call("split", "Skill", {"skill": "plant-beds"}, stamp(2), into="p",
                     entrypoint="t3-code")  # fmt: skip
    transcripts.call("split", "Skill", {"skill": "prune-roses"}, stamp(1), into="q")

    data = run(skill_usage_collect())

    assert sorted((event.thread, event.skill) for event in collected(state)) == [
        ("claude-code:free", "prune-roses"),
        ("claude-code:mixed", "prune-roses"),
        ("claude-code:split", "prune-roses"),
        ("main", "plant-beds"),
        ("main", "plant-beds"),
    ]
    assert sorted(store.load_sessions(state)) == [
        "claude-code:free", "claude-code:mixed", "claude-code:split", "main",
    ]  # fmt: skip
    found = source(data)
    assert (found["transcripts"], found["read"], found["calls_left_to_t3"]) == (6, 6, 4)

    opened = opens(monkeypatch)  # a transcript that did not change is not opened again
    assert run(skill_usage_collect())["added"] == 0 and opened == []

    # the copy that holds T3 Code's part grows, and is read alone: the session is still ours
    transcripts.call("split", "Skill", {"skill": "plant-beds"}, stamp(1), into="p",
                     entrypoint="t3-code")  # fmt: skip
    run(skill_usage_collect())
    assert opened == ["p"] and "claude-code:split" in store.load_sessions(state)


def test_a_session_t3_code_turns_out_to_have_run_leaves_the_record(
    state: Path, t3_store: T3Store, transcripts: Transcripts, monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:  # fmt: skip
    # the transcript is read while T3 Code's store is not there
    monkeypatch.setenv(store.T3_STORE_ENV, "")
    transcripts.call("s1", "Skill", {"skill": "plant-beds"}, stamp(2), call="toolu_one",
                     entrypoint="sdk-ts")  # fmt: skip
    transcripts.say("s1", "<command-name>/plant-beds</command-name>", stamp(2),
                    entrypoint="sdk-ts")  # fmt: skip
    # a later session holds a copy of that row, as one continued from it does
    transcripts.call("s1", "Skill", {"skill": "plant-beds"}, stamp(2), call="toolu_one",
                     entrypoint="sdk-ts", into="free")  # fmt: skip
    transcripts.call("free", "Skill", {"skill": "prune-roses"}, stamp(2))
    run(skill_usage_collect())
    assert sorted(store.load_sessions(state)) == ["claude-code:free", "claude-code:s1"]

    # the store is there again, and holds the call: the session was T3 Code's all along
    t3_store.skill_tool(t3_store.thread("main"), "plant-beds", stamp(2), native_id="toolu_one")
    monkeypatch.setenv(store.T3_STORE_ENV, str(t3_store.path))
    data = run(skill_usage_collect())  # the transcript itself has not changed

    assert sorted((event.source, event.thread) for event in collected(state)) == [
        ("claude-code", "claude-code:free"), ("t3-code", "main"),
    ]  # fmt: skip
    assert sorted(store.load_sessions(state)) == ["claude-code:free", "main"]
    assert source(data)["removed"] == 2  # the load, and the command typed in that session

    # and the other way about: T3 Code drops the thread before a second transcript of the
    # session is ever seen. The record still knows the call was T3 Code's
    emptied = T3Store(tmp_path / "later.sqlite")
    monkeypatch.setenv(store.T3_STORE_ENV, str(emptied.path))
    transcripts.call("s2", "Skill", {"skill": "plant-beds"}, stamp(2), call="toolu_one",
                     entrypoint="sdk-ts")  # fmt: skip
    run(skill_usage_collect())
    assert sorted(store.load_sessions(state)) == ["claude-code:free", "main"]
    assert len(collected(state)) == 2


def test_only_a_transcript_that_changed_is_read_again(
    state: Path, transcripts: Transcripts, monkeypatch: pytest.MonkeyPatch
) -> None:
    transcripts.call("s1", "Skill", {"skill": "plant-beds"}, stamp(2))
    transcripts.call("s2", "Skill", {"skill": "plant-beds"}, stamp(2))
    transcripts.call("s2", "Skill", {"skill": "plant-beds"}, stamp(2), subagent="a1")
    assert run(skill_usage_collect())["added"] == 3
    opened = opens(monkeypatch)

    assert run(skill_usage_collect())["added"] == 0 and opened == []

    transcripts.call("s2", "Skill", {"skill": "prune-roses"}, stamp(1), subagent="a2")
    data = run(skill_usage_collect())  # a subagent's file beside it is the session's too
    found = source(data)
    assert opened == ["s2"] and (found["read"], found["unchanged"], data["added"]) == (1, 1, 1)
    assert len(collected(state)) == 4  # and what it held before is not added twice

    # a change that keeps a file's size, in a file older than the newest, is a change
    older = transcripts.file("s2", "a1")
    text = older.read_text("utf-8")
    assert "plant-beds" in text
    opened.clear()
    older.write_text(text.replace("plant-beds", "prune-rose"), "utf-8")  # as many characters
    run(skill_usage_collect())
    assert opened == ["s2"]


def test_a_load_leaves_the_record_only_when_its_call_is_read_and_is_no_longer_one(
    state: Path, transcripts: Transcripts
) -> None:
    transcripts.call("s1", "Skill", {"skill": "plant-beds"}, stamp(2), call="toolu_a")
    transcripts.call("s1", "Skill", {"skill": "prune-roses"}, stamp(2), call="toolu_b")
    transcripts.call("s1", "Skill", {"skill": "prune-roses"}, stamp(2), call="toolu_c",
                     subagent="a1")  # fmt: skip
    transcripts.call("s1", "Skill", {"skill": "prune-roses"}, stamp(2), call="toolu_d",
                     into="agent-a2", isSidechain=True)  # fmt: skip
    run(skill_usage_collect())
    assert len(collected(state)) == 4

    # Claude Code clears part of the session: a subagent's file, in either layout, and a call
    # from the transcript itself. What was collected of them stays: that is what a record is
    transcripts.file("s1", "a1").unlink()
    transcripts.file("agent-a2").unlink()
    text = transcripts.file("s1").read_text("utf-8")
    lines = [line for line in text.splitlines() if "toolu_b" not in line]
    transcripts.file("s1").write_text("\n".join(lines) + "\n", "utf-8")
    data = run(skill_usage_collect())
    assert len(collected(state)) == 4 and (source(data)["read"], source(data)["removed"]) == (1, 0)
    assert run(skill_usage_collect(rebuild=True))["removed"] == 0

    # a call that is still there and now shows another skill is read as it is now
    text = transcripts.file("s1").read_text("utf-8")
    transcripts.file("s1").write_text(text.replace("plant-beds", "prune-roses"), "utf-8")
    data = run(skill_usage_collect())
    assert sorted((event.id.partition("@")[2], event.skill) for event in collected(state)) == [
        ("toolu_a", "prune-roses"), ("toolu_b", "prune-roses"), ("toolu_c", "prune-roses"),
        ("toolu_d", "prune-roses"),
    ]  # fmt: skip
    assert (source(data)["removed"], data["added"]) == (1, 1)


def test_a_transcript_that_appears_after_its_copy_loses_nothing(
    state: Path, transcripts: Transcripts
) -> None:
    # only the continued session's transcript is here, holding the first one's rows
    transcripts.call("first", "Skill", {"skill": "plant-beds"}, stamp(3), call="toolu_a",
                     into="second")  # fmt: skip
    run(skill_usage_collect())
    # then the first one's own transcript appears, and the second goes on
    transcripts.call("first", "Skill", {"skill": "plant-beds"}, stamp(3), call="toolu_a")
    run(skill_usage_collect())
    transcripts.call("second", "Skill", {"skill": "prune-roses"}, stamp(1), call="toolu_b")

    data = run(skill_usage_collect())

    assert sorted((event.thread, event.skill) for event in collected(state)) == [
        ("claude-code:first", "plant-beds"), ("claude-code:second", "prune-roses"),
    ]  # fmt: skip
    assert source(data)["removed"] == 0


def test_a_call_t3_codes_store_missed_is_no_session_of_its_own(
    state: Path, t3_store: T3Store, transcripts: Transcripts, checkout: Path
) -> None:
    thread = t3_store.thread("main")
    for number in range(5):
        t3_store.skill_tool(thread, "plant-beds", stamp(2, number), native_id=f"toolu_{number}")
        transcripts.call("s1", "Skill", {"skill": "plant-beds"}, stamp(2, number),
                         call=f"toolu_{number}", entrypoint="sdk-ts")  # fmt: skip
    # T3 Code ran the whole session, and its store missed this call and this command
    transcripts.call("s1", "Read", {"file_path": skill_file(checkout, "prune-roses")}, stamp(1),
                     entrypoint="sdk-ts")  # fmt: skip
    transcripts.say("s1", "<command-name>/prune-roses</command-name>", stamp(1),
                    entrypoint="sdk-ts")  # fmt: skip

    run(skill_usage_collect())

    assert sorted(store.load_sessions(state)) == ["main"]
    assert {event.source for event in collected(state)} == {"t3-code"}

    # until the session is continued in another program: that part is a session of its own
    transcripts.call("s1", "Read", {"file_path": skill_file(checkout, "prune-roses")}, stamp(0))
    run(skill_usage_collect())
    assert sorted(store.load_sessions(state)) == ["claude-code:s1", "main"]
    assert [(event.thread, event.skill) for event in collected(state)
            if event.source == "claude-code"] == [("claude-code:s1", "prune-roses")]  # fmt: skip


def test_git_that_does_not_answer_leaves_a_transcript_for_the_next_time(
    state: Path, transcripts: Transcripts, monkeypatch: pytest.MonkeyPatch
) -> None:
    transcripts.call("s1", "Skill", {"skill": "plant-beds"}, stamp(2))
    transcripts.call("s2", "Skill", {"skill": "plant-beds"}, stamp(2),
                     cwd=str(transcripts.cwd / ".claude"))  # fmt: skip
    asked: list[str] = []

    def stalls(folder: Path, *args: str, **more: object) -> str:
        asked.append(str(folder))
        raise claude_code.GitError("git rev-parse --git-common-dir: timed out after 10 seconds")

    with monkeypatch.context() as patch:
        patch.setattr(claude_code, "git_out", stalls)
        data = run(skill_usage_collect())

    assert (source(data)["not_read"], data["added"], len(asked)) == (2, 0, 1)  # asked once
    assert run(skill_usage_collect())["added"] == 2  # and read when git answers again


def test_a_transcript_that_cannot_be_read_whole_is_left_as_it_was(
    state: Path, transcripts: Transcripts, monkeypatch: pytest.MonkeyPatch
) -> None:
    transcripts.call("s1", "Skill", {"skill": "plant-beds"}, stamp(2))
    transcripts.call("s1", "Skill", {"skill": "prune-roses"}, stamp(2), subagent="a1")
    run(skill_usage_collect())
    stamped = store.load_state(state)["sources"]["claude-code"]["files"]["s1"]
    agent = transcripts.file("s1", "a1")
    kept = agent.read_bytes()

    real_open = Path.open

    def refuse(path: Path, *args: object, **more: object):
        if path == agent:
            raise PermissionError(13, "not allowed", str(path))
        return real_open(path, *args, **more)

    # Windows has no named pipe in a folder (os.mkfifo); the other three are on every system
    kinds = (
        ("unreadable", "a folder", "a pipe", "a loop")
        if hasattr(os, "mkfifo")
        else ("unreadable", "a folder", "a loop")
    )
    for broken in kinds:
        agent.unlink()
        if broken == "unreadable":
            agent.write_bytes(kept + b"\n")
        elif broken == "a folder":
            agent.mkdir()
        elif broken == "a pipe":
            os.mkfifo(agent)  # opening one with no writer waits for ever
        else:
            agent.symlink_to(agent)

        with monkeypatch.context() as patch:  # only this, and only for this collection
            if broken == "unreadable":
                patch.setattr(Path, "open", refuse)
            data = run(skill_usage_collect(rebuild=True))

        assert len(collected(state)) == 2, broken  # what it gave is still here
        assert (source(data)["not_read"], data["removed"]) == (1, 0), broken
        files = store.load_state(state)["sources"]["claude-code"]["files"]
        assert files["s1"] == stamped, broken  # and it is tried again
        if agent.is_dir() and not agent.is_symlink():
            agent.rmdir()
        else:
            agent.unlink()
        agent.write_bytes(kept)

    transcripts.call("s1", "Skill", {"skill": "plant-beds"}, stamp(1), subagent="a1")
    assert run(skill_usage_collect())["added"] == 1  # readable again: read again


def test_a_subagents_file_is_its_sessions_wherever_it_lies(
    state: Path, transcripts: Transcripts
) -> None:
    transcripts.call("s1", "Skill", {"skill": "plant-beds"}, stamp(3))
    # as older versions wrote a subagent: beside the transcript, under a name of its own,
    # each row naming the session it worked for
    transcripts.call("s1", "Skill", {"skill": "prune-roses"}, stamp(2), into="agent-a1",
                     isSidechain=True)  # fmt: skip
    # one whose session's transcript is gone still names its session
    transcripts.call("lost", "Skill", {"skill": "prune-roses"}, stamp(2), into="agent-a2",
                     isSidechain=True)  # fmt: skip
    # a sidechain row in the transcript itself is a subagent's too
    transcripts.call("s1", "Read", {"file_path": "/w/.claude/skills/plant-beds/SKILL.md"},
                     stamp(1), isSidechain=True)  # fmt: skip
    transcripts.say("s1", "<command-name>/plant-beds</command-name>", stamp(1), isSidechain=True)

    data = run(skill_usage_collect())

    assert sorted(store.load_sessions(state)) == ["claude-code:lost", "claude-code:s1"]
    assert sorted((event.thread, event.skill, event.agent) for event in collected(state)) == [
        ("claude-code:lost", "prune-roses", "subagent"),
        ("claude-code:s1", "plant-beds", "main"),
        ("claude-code:s1", "plant-beds", "subagent"),
        ("claude-code:s1", "prune-roses", "subagent"),
    ]
    assert source(data)["transcripts"] == 2  # the session's, and the stray subagent's


def test_history_copied_into_a_continued_session_is_counted_once(
    state: Path, transcripts: Transcripts
) -> None:
    transcripts.call("first", "Skill", {"skill": "plant-beds"}, stamp(3), call="toolu_a")
    # the session was continued as another: its rows were copied, still naming the first
    transcripts.call("first", "Skill", {"skill": "plant-beds"}, stamp(3), call="toolu_a",
                     into="second")  # fmt: skip
    transcripts.call("second", "Skill", {"skill": "prune-roses"}, stamp(2), call="toolu_b")
    # and the first went on, after the copy was taken
    transcripts.call("first", "Skill", {"skill": "prune-roses"}, stamp(2), call="toolu_d")
    # and one whose first transcript is gone: its copied rows are all there is of it
    transcripts.call("gone", "Skill", {"skill": "plant-beds"}, stamp(3), call="toolu_c",
                     into="third")  # fmt: skip
    transcripts.call("gone", "Skill", {"skill": "plant-beds"}, stamp(3), call="toolu_c",
                     into="fourth")  # fmt: skip
    transcripts.call("gone", "Skill", {"skill": "prune-roses"}, stamp(2), call="toolu_e",
                     into="fourth")  # fmt: skip

    data = run(skill_usage_collect())

    held = [
        ("claude-code:first", "plant-beds"),
        ("claude-code:first", "prune-roses"),
        ("claude-code:gone", "plant-beds"),
        ("claude-code:gone", "prune-roses"),
        ("claude-code:second", "prune-roses"),
    ]
    assert sorted((event.thread, event.skill) for event in collected(state)) == held
    assert data["added"] == 5
    lines = (state / store.EVENTS_FILE).read_text("utf-8").splitlines()
    assert len(lines) == 5  # written once, however many files hold the call
    # the session's own transcript says how long it ran, not the copy of its beginning
    assert store.load_sessions(state)["claude-code:first"]["updated_at"] == stamp(2)
    assert run(skill_usage_collect(rebuild=True))["removed"] == 0

    # a copy read again does not speak for the session it was copied from, nor one copy of a
    # lost session for the other
    transcripts.say("second", "and on", stamp(1))
    transcripts.say("gone", "and on", stamp(1), into="third")
    data = run(skill_usage_collect())
    assert sorted((event.thread, event.skill) for event in collected(state)) == held
    assert (source(data)["read"], source(data)["removed"]) == (2, 0)


def test_only_what_is_shaped_like_an_id_or_a_name_is_kept(
    state: Path, transcripts: Transcripts, checkout: Path, tmp_path: Path
) -> None:
    transcripts.call("s1", "Skill", {"skill": "plant-beds"}, stamp(2), call=f"an id, {PRIVATE}")
    transcripts.call("s1", "Skill", {"skill": f"a sentence, {PRIVATE}"}, stamp(2))
    transcripts.say("s1", "<command-name>/plant-beds</command-name>", stamp(2),
                    uuid=f"a row, {PRIVATE}")  # fmt: skip
    transcripts.say("s1", f"<command-name>/{PRIVATE} words</command-name>", stamp(2))
    transcripts.call("s1", "Skill", {"skill": "prune-roses"}, stamp(2))
    with transcripts.file("s1").open(encoding="utf-8") as handle:
        rows = [json.loads(line) for line in handle]
    for row in rows:  # a model's name is the harness's to give: this one is not a name
        if isinstance(row.get("message"), dict) and "model" in row["message"]:
            row["message"]["model"] = f"a model, {PRIVATE}"
    transcripts.file("s1").write_text("".join(json.dumps(row) + "\n" for row in rows), "utf-8")
    transcripts.call(f"a session {PRIVATE}", "Skill", {"skill": "plant-beds"}, stamp(2))
    # a worktree named after its branch, and a folder in no repository at all
    branch = tmp_path / f"worktree-{PRIVATE}"
    subprocess.run(["git", "-C", str(checkout), "-c", "user.name=T", "-c", "user.email=t@e.x",
                    "commit", "-q", "--allow-empty", "-m", "start"], check=True)  # fmt: skip
    subprocess.run(["git", "-C", str(checkout), "worktree", "add", "-q", str(branch)], check=True)
    transcripts.call("tree", "Skill", {"skill": "plant-beds"}, stamp(2), cwd=str(branch))
    home = tmp_path / f"home-of-{PRIVATE}"
    home.mkdir()
    transcripts.call("anywhere", "Skill", {"skill": "plant-beds"}, stamp(2), cwd=str(home))

    run(skill_usage_collect())

    for name in (store.EVENTS_FILE, store.SESSIONS_FILE):
        assert PRIVATE not in (state / name).read_text("utf-8"), name
    sessions = store.load_sessions(state)
    assert sorted(sessions) == ["claude-code:anywhere", "claude-code:s1", "claude-code:tree"]
    assert sessions["claude-code:tree"]["project"] == "garden"  # the repository, not the tree
    assert sessions["claude-code:anywhere"]["project"] == "unknown"
    assert [(event.skill, event.model) for event in collected(state)
            if event.thread == "claude-code:s1"] == [("prune-roses", None)]  # fmt: skip
    roots = json.dumps(store.load_state(state)["projects"])
    assert PRIVATE not in roots  # nor is either folder remembered as a project's


def test_a_typed_command_is_the_one_claude_code_writes(
    state: Path, t3_store: T3Store, transcripts: Transcripts, checkout: Path
) -> None:
    (checkout / ".claude" / "skills" / "prune-roses" / "SKILL.md").unlink()
    # the only word that `prune-roses` is a skill comes from T3 Code, in this same read
    t3_store.skill_tool(t3_store.thread("main"), "prune-roses", stamp(3))
    transcripts.say("s1", "<command-name>/prune-roses</command-name>\n<command-message>go"
                    "</command-message>", stamp(2, 0))  # fmt: skip
    transcripts.say("s1", "<command-message>plant</command-message>\n<command-name>/plant-beds"
                    "</command-name>", stamp(2, 1))  # fmt: skip
    # what is not one: a sentence that quotes the tag, a tag with no slash, a row T3 Code ran
    transcripts.say("s1", "what does <command-name>/plant-beds</command-name> do?", stamp(2, 2))
    transcripts.say("s1", "<command-name>plant-beds</command-name>", stamp(2, 3))
    transcripts.say("s1", "<command-name>/plant-beds</command-name>", stamp(2, 4),
                    entrypoint="t3-code")  # fmt: skip

    run(skill_usage_collect())

    typed = sorted(event.skill for event in collected(state) if event.path == "typed")
    assert typed == ["plant-beds", "prune-roses"]


def test_a_long_transcript_is_read_to_its_end(
    state: Path, transcripts: Transcripts, checkout: Path
) -> None:
    for number in range(120):  # nothing in these rows says where the session ran, or how
        transcripts.write("s1", {"type": "progress", "note": f"step {number}"}, cwd=None,
                          entrypoint=None)  # fmt: skip
    transcripts.write("s1", {"type": "progress", "note": "and here it is said"})
    # the tag as a writer that escapes `<` leaves it, and the other tools that change a file
    typed = {"role": "user", "content": "<command-name>/plant-beds</command-name>"}
    row = {"type": "user", "uuid": "row-x", "sessionId": "s1", "message": typed,
           "timestamp": stamp(2), "cwd": str(checkout), "entrypoint": "cli"}  # fmt: skip
    escaped = json.dumps(row)
    with transcripts.file("s1").open("a", encoding="utf-8") as handle:
        handle.write(escaped.replace("<", "\\u003c") + "\n")
    skill = str(checkout / ".claude" / "skills" / "prune-roses")
    transcripts.call("s1", "Write", {"file_path": f"{skill}/SKILL.md"}, stamp(1, 0))
    transcripts.call("s1", "MultiEdit", {"file_path": f"{skill}/notes.md"}, stamp(1, 1))
    transcripts.call("s1", "NotebookEdit", {"notebook_path": f"{skill}/book.ipynb"}, stamp(1, 2))

    run(skill_usage_collect())

    assert by_path(state) == {"typed": ["plant-beds"], "edit": ["prune-roses"] * 3}
    assert store.load_sessions(state)["claude-code:s1"]["project"] == "garden"


def test_a_load_two_sources_show_is_one_load(
    state: Path, t3_store: T3Store, transcripts: Transcripts, monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:  # fmt: skip
    t3_store.skill_tool(t3_store.thread("main"), "plant-beds", stamp(2), native_id="toolu_one")
    run(skill_usage_collect())
    # T3 Code has since dropped the thread; Claude Code still has the session's transcript
    emptied = T3Store(tmp_path / "later.sqlite")
    monkeypatch.setenv(store.T3_STORE_ENV, str(emptied.path))
    transcripts.call("s1", "Skill", {"skill": "plant-beds"}, stamp(2), call="toolu_one",
                     entrypoint="t3-code")  # fmt: skip
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
    # as an older botcore read the same calls: the same call, another name for the skill
    stale = [{**event.to_json(), "id": f"cc:an-old-reading@{event.id.partition('@')[2]}",
              "skill": "an-old-reading"} for event in recognised]  # fmt: skip
    with (state / store.EVENTS_FILE).open("a", encoding="utf-8") as handle:
        handle.writelines(json.dumps(event) + "\n" for event in stale)

    data = run(skill_usage_collect(rebuild=True))

    kept = sorted((event.thread, event.skill) for event in collected(state))
    assert kept == [
        ("claude-code:goes", "an-old-reading"),  # nothing left to read it again from
        ("claude-code:goes", "prune-roses"),
        ("claude-code:stays", "plant-beds"),  # read again: the old reading is replaced
    ]
    assert (data["removed"], source(data)["removed"]) == (1, 1)
    assert [found.get("removed") for found in data["sources"]] == [1, None]  # by source


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


def test_a_session_keeps_its_project_when_its_checkout_is_moved(
    state: Path, transcripts: Transcripts, checkout: Path, tmp_path: Path
) -> None:
    subprocess.run(["git", "-C", str(checkout), "remote", "add", "origin",
                    "git@example.com:acme/garden.git"], check=True)  # fmt: skip
    transcripts.call("s1", "Skill", {"skill": "prune-roses"}, stamp(2))
    transcripts.say("s1", "<command-name>/plant-beds</command-name>", stamp(2))
    run(skill_usage_collect())
    before = sorted((event.skill, event.path, event.project) for event in collected(state))
    assert before == [
        ("plant-beds", "typed", "acme/garden"), ("prune-roses", "skill_tool", "acme/garden"),
    ]  # fmt: skip

    checkout.rename(tmp_path / "moved-away")  # where the session ran leads nowhere now

    data = run(skill_usage_collect(rebuild=True))  # as after an upgrade

    assert sorted((event.skill, event.path, event.project) for event in collected(state)) == before
    assert data["removed"] == 0
    assert store.load_sessions(state)["claude-code:s1"]["project"] == "acme/garden"


def test_a_call_t3_code_comes_to_hold_late_is_one_load(
    state: Path, t3_store: T3Store, transcripts: Transcripts, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(store.T3_STORE_ENV, "")  # collected while T3 Code's store is away
    for number in range(40):  # more calls than are kept to look for later
        transcripts.call("s1", "Bash", {"command": f"echo {number}"}, stamp(3, number),
                         call=f"toolu_other_{number}", entrypoint="sdk-ts")  # fmt: skip
    transcripts.call("s1", "Skill", {"skill": "plant-beds"}, stamp(2), call="toolu_late",
                     entrypoint="sdk-ts")  # fmt: skip
    run(skill_usage_collect())
    kept = store.load_state(state)["sources"]["claude-code"]["files"]["s1"]["calls"]
    assert kept[0] == "toolu_late" and len(kept) == claude_code.SAMPLE  # a load is kept first

    t3_store.skill_tool(t3_store.thread("main"), "plant-beds", stamp(2), native_id="toolu_late")
    monkeypatch.setenv(store.T3_STORE_ENV, str(t3_store.path))
    run(skill_usage_collect())  # the store is back, holding only that call

    assert [(event.source, event.thread) for event in collected(state)] == [("t3-code", "main")]
    assert sorted(store.load_sessions(state)) == ["main"]


def test_a_load_t3_code_shows_too_goes_even_when_its_transcript_is_not_read_again(
    state: Path, t3_store: T3Store, transcripts: Transcripts, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(store.T3_STORE_ENV, "")
    transcripts.call("s1", "Skill", {"skill": "plant-beds"}, stamp(2), call="toolu_late")
    run(skill_usage_collect())
    saved = store.load_state(state)
    saved["sources"]["claude-code"]["files"]["s1"]["calls"] = []  # nothing kept to look for
    store.save_state(state, saved)
    t3_store.skill_tool(t3_store.thread("main"), "plant-beds", stamp(2), native_id="toolu_late")
    monkeypatch.setenv(store.T3_STORE_ENV, str(t3_store.path))
    opened = opens(monkeypatch)

    data = run(skill_usage_collect())

    assert opened == []  # the transcript did not change, and was not opened
    assert [(event.source, event.thread) for event in collected(state)] == [("t3-code", "main")]
    assert source(data)["removed"] == 1


def test_claude_code_read_reports_progress_inside_a_transcript_and_stops_when_left(
    transcripts: Transcripts, monkeypatch: pytest.MonkeyPatch
) -> None:
    """lushly-dev/afd#2160: reading a single large Claude Code transcript reports progress
    periodically inside the line loop and stops with steps.Left when the step is left."""
    from botcore.commands.disk import steps

    for idx in range(30):
        transcripts.say("big", f"step {idx}", stamp(2, idx % 60))
    transcripts.call("big", "Skill", {"skill": "plant-beds"}, stamp(1))

    said: list[tuple[str, str]] = []
    monkeypatch.setattr(claude_code, "LINE_PROGRESS_EVERY", 5)
    monkeypatch.setattr(steps, "SAID", said)
    found = claude_code.read(transcripts.root, {}, set())
    assert [load.skill for load in found.loads] == ["plant-beds"]
    folder_words = [
        word
        for word in said
        if word == ("reading Claude Code's transcripts in", str(transcripts.file("big").parent))
    ]
    # folder scan + file open + >= 6 line-loop heartbeats (32 lines / 5)
    assert len(folder_words) >= 8, folder_words

    step = steps.Step("left-claude", lambda: None)
    step.wait(10)
    step.leave()
    steps._HERE.step = step  # noqa: SLF001
    try:
        with pytest.raises(steps.Left):
            claude_code.read(transcripts.root, {}, set())
    finally:
        steps._HERE.step = None  # noqa: SLF001
