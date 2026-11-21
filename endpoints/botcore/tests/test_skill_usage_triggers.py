"""skill-usage-triggers: merged changes that needed a skill, against a store shaped like
T3 Code's and a real git history."""

# ruff: noqa: F811 - pytest fixtures imported from the collect and report tests

from __future__ import annotations

import json
import os
import subprocess
from datetime import timedelta
from pathlib import Path

import pytest
from click.testing import CliRunner

from botcore.cli import cli
from botcore.commands.skill_usage import (
    skill_usage_collect,
    skill_usage_report,
    skill_usage_triggers,
    store,
)
from botcore.config import SkillsConfig, load_config
from tests.test_skill_usage import (  # noqa: F401 - fixtures
    NOW,
    T3Store,
    checkout,
    collected,
    fail,
    git,
    rows,
    run,
    skill_text,
    stamp,
    state,
    t3_store,
)

RULES = """
[[skills.required]]
skill = "gate-discipline"
paths = ["hooks.yml", "scripts/check-*.mjs"]
"""
PRIVATE = "the-private-text"
SKILL_FILE = "/w/.claude/skills/gate-discipline/SKILL.md"


@pytest.fixture
def repo(checkout: Path) -> Path:
    """A checkout with an origin, a required skill and its rule."""
    folder = checkout / ".claude" / "skills" / "gate-discipline"
    folder.mkdir()
    (folder / "SKILL.md").write_text(skill_text("gate-discipline", "Change a gate.", 90), "utf-8")
    (checkout / "botcore.toml").write_text(RULES, "utf-8")
    git(checkout, "init", "-q", "-b", "main")
    git(checkout, "remote", "add", "origin", "git@example.com:acme/garden.git")
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "start")
    return checkout


def merge(root: Path, subject: str, *files: str, days_ago: float = 0) -> None:
    """A change merged to the default branch, as a squash merge leaves it: now, or then."""
    for file in files:
        target = root / file
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(target.read_text("utf-8") + "x" if target.exists() else "x", "utf-8")
    git(root, "add", "-A")
    when = (NOW - timedelta(days=days_ago)).strftime("%Y-%m-%dT%H:%M:%S+00:00")
    subprocess.run(
        ["git", "-C", str(root), "-c", "user.name=T", "-c", "user.email=t@example.com",
         "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", subject],
        check=True, capture_output=True,
        env={**os.environ, "GIT_AUTHOR_DATE": when, "GIT_COMMITTER_DATE": when},
    )  # fmt: skip


def session(built: T3Store, name: str, *links: tuple[int, str | None], **more: object) -> str:
    """A session linked to pull requests, each with when it linked it."""
    extra = {
        "pullRequests": [
            {"repository": "acme/garden", "number": number, "linkedAt": at, "title": PRIVATE}
            for number, at in links
        ]
    }
    return built.thread(name, extra=extra, **more)


def rule(data: dict) -> dict:
    (only,) = data["rules"]
    return only


def judged(found: dict) -> tuple[int, int, int]:
    return found["loaded"], found["missed"], found["unknown"]


# ── judging a merged change ─────────────────────────────────────────────────


def test_each_merged_change_is_judged_by_the_sessions_that_published_it(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    merge(repo, "feat: a check (#102)", "scripts/check-beds.mjs")
    merge(repo, "feat: unrelated (#103)", "notes.txt")
    merge(repo, "feat: another hook (#104)", "hooks.yml")
    merge(repo, "feat: by another machine (#105)", "hooks.yml")
    merge(repo, "feat: pushed straight to main", "hooks.yml")
    first = session(t3_store, "first", (101, stamp(2)))
    t3_store.skill_tool(first, "gate-discipline", stamp(3))  # before it published the change
    second = session(t3_store, "second", (102, stamp(2)))
    t3_store.skill_tool(second, "gate-discipline", stamp(1))  # only afterwards, at review
    session(t3_store, "fourth", (104, stamp(2)))  # never
    t3_store.skill_tool(session(t3_store, "third", (103, stamp(2))), "plant-beds", stamp(3))
    run(skill_usage_collect())

    data = run(skill_usage_triggers(repo=str(repo)))
    found = rule(data)

    assert data["project"] == "acme/garden"
    assert (found["skill"], found["changes"]) == ("gate-discipline", 5)
    assert judged(found) == (1, 1, 3)
    assert found["unknown_why"] == {
        "no_pull_request": 1, "no_session": 1, "no_link_time": 0, "after_publication": 1,
    }  # fmt: skip
    assert found["misses"] == [{"change": 104, "sessions": ["fourth"]}]
    assert found["rate"] == 0.5 and found["paths"] == ["hooks.yml", "scripts/check-*.mjs"]
    assert data["warnings"] == []


def test_a_subagent_loads_for_its_session_and_a_sibling_task_does_not(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    merge(repo, "feat: a check (#102)", "scripts/check-beds.mjs")
    foreman = t3_store.thread("foreman")
    cell = session(t3_store, "thread:delegated-task:cell", (101, stamp(2)), parent=foreman)
    reader = t3_store.thread("thread:subagent:reader", parent=cell)
    t3_store.read_tool(reader, SKILL_FILE, stamp(3))
    session(t3_store, "thread:delegated-task:other", (102, stamp(2)), parent=foreman)
    run(skill_usage_collect())

    found = rule(run(skill_usage_triggers(repo=str(repo))))

    assert judged(found) == (1, 1, 0)  # the cell's load does not answer for the other cell
    assert found["misses"] == [{"change": 102, "sessions": ["thread:delegated-task:other"]}]


def test_the_session_that_worked_on_the_branch_answers_when_another_published_it(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    merge(repo, "feat: a check (#102)", "scripts/check-beds.mjs")
    branch = f"lush/{PRIVATE}"  # a branch is often named after its task
    links = [
        {"repository": "acme/garden", "number": number, "linkedAt": stamp(2),
         "snapshot": {"headBranch": f"{branch}-{number}", "title": PRIVATE}}
        for number in (101, 102)
    ]  # fmt: skip
    t3_store.thread("foreman", extra={"pullRequests": links})  # it only published them
    careful = t3_store.thread("cell-1", extra={"branch": f"{branch}-101"})
    t3_store.thread("cell-2", extra={"branch": f"{branch}-102"})
    t3_store.skill_tool(careful, "gate-discipline", stamp(3))
    run(skill_usage_collect())

    found = rule(run(skill_usage_triggers(repo=str(repo))))

    assert judged(found) == (1, 1, 0)
    assert found["misses"] == [{"change": 102, "sessions": ["cell-2", "foreman"]}]
    for name in (store.SESSIONS_FILE, store.EVENTS_FILE, store.STATE_FILE):
        assert PRIVATE not in (state / name).read_text("utf-8")  # a branch is kept as a hash


def test_one_session_that_had_loaded_the_skill_answers_for_the_change(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    merge(repo, "feat: a check (#102)", "scripts/check-beds.mjs")
    author = session(t3_store, "author", (101, stamp(2)), (102, stamp(1)))
    t3_store.skill_tool(author, "gate-discipline", stamp(3))  # once, before both
    session(t3_store, "watcher", (101, stamp(2)), (102, stamp(1)))  # linked them, loaded nothing
    run(skill_usage_collect())

    assert judged(rule(run(skill_usage_triggers(repo=str(repo))))) == (2, 0, 0)


def test_a_load_after_the_change_merged_is_no_load(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml", days_ago=3)
    merge(repo, "feat: a check (#102)", "scripts/check-beds.mjs", days_ago=3)
    late = session(t3_store, "late", (101, stamp(4)))
    t3_store.skill_tool(late, "gate-discipline", stamp(2))  # a day after it merged
    closing = session(t3_store, "closing", (102, stamp(1)))  # linked it only when wrapping up
    t3_store.skill_tool(closing, "gate-discipline", stamp(2))
    run(skill_usage_collect())

    found = rule(run(skill_usage_triggers(repo=str(repo))))

    assert judged(found) == (0, 2, 0)
    assert sorted(miss["change"] for miss in found["misses"]) == [101, 102]


def test_a_link_without_a_time_cannot_say_whether_the_load_came_first(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    merge(repo, "feat: a check (#102)", "scripts/check-beds.mjs")
    t3_store.skill_tool(t3_store.thread("loaded"), "gate-discipline", stamp(2))
    t3_store.skill_tool(t3_store.thread("never"), "plant-beds", stamp(2))
    run(skill_usage_collect())
    sessions = store.load_sessions(state)  # as an earlier botcore wrote its links
    sessions["loaded"]["pull_requests"] = ["acme/garden#101"]
    sessions["never"]["pull_requests"] = ["acme/garden#102"]
    store.save_sessions(state, sessions)

    found = rule(run(skill_usage_triggers(repo=str(repo))))

    assert judged(found) == (0, 1, 1)
    assert found["unknown_why"]["no_link_time"] == 1
    assert found["misses"] == [{"change": 102, "sessions": ["never"]}]


def test_a_rule_follows_a_renamed_skill_and_two_declarations_are_one_rule(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    git(repo, "mv", ".claude/skills/gate-discipline", ".claude/skills/change-a-gate")
    two = """
[[skills.required]]
skill = "change-a-gate"
paths = ["hooks.yml"]

[[skills.required]]
skill = "change-a-gate"
paths = ["scripts/check-*.mjs"]
"""
    (repo / "botcore.toml").write_text(two, "utf-8")
    merge(repo, "chore: rename the skill (#100)")
    merge(repo, "feat: a hook and a check (#101)", "hooks.yml", "scripts/check-beds.mjs")
    main = session(t3_store, "main", (101, stamp(2)))
    t3_store.skill_tool(main, "gate-discipline", stamp(3))  # loaded under its old name
    run(skill_usage_collect())

    found = rule(run(skill_usage_triggers(repo=str(repo))))  # one row, one change

    assert (found["skill"], found["changes"]) == ("change-a-gate", 1)
    assert judged(found) == (1, 0, 0)
    assert found["paths"] == ["hooks.yml", "scripts/check-*.mjs"]


def test_a_rule_declared_today_judges_what_was_collected_before(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    (repo / "botcore.toml").write_text("", "utf-8")
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    session(t3_store, "main", (101, stamp(2)))
    t3_store.skill_tool("main", "plant-beds", stamp(3))
    run(skill_usage_collect())
    assert fail(skill_usage_triggers(repo=str(repo))).code == "NO_REQUIRED_SKILLS"

    (repo / "botcore.toml").write_text(RULES, "utf-8")  # nothing to collect again

    assert rule(run(skill_usage_triggers(repo=str(repo))))["missed"] == 1


# ── reading git ─────────────────────────────────────────────────────────────


def test_only_what_merged_to_the_default_branch_is_a_merged_change(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    t3_store.skill_tool(t3_store.thread("main"), "plant-beds", stamp(1))
    run(skill_usage_collect())
    git(repo, "remote", "remove", "origin")  # a local main only, and a topic branch checked out
    git(repo, "switch", "-q", "-c", "topic")
    merge(repo, "feat: not merged yet (#7)", "hooks.yml")

    assert rule(run(skill_usage_triggers(repo=str(repo))))["changes"] == 0

    git(repo, "branch", "-q", "-m", "main", "trunk")  # nothing says which branch is the default
    assert fail(skill_usage_triggers(repo=str(repo))).code == "GIT_FAILED"


def test_a_renamed_or_oddly_named_file_still_matches(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    (repo / "botcore.toml").write_text(RULES.replace("hooks.yml", "café.yml"), "utf-8")
    merge(repo, "feat: long ago (#99)", "café.yml", days_ago=45)  # outside the window
    merge(repo, "feat: a named file (#101)", "café.yml")
    merge(repo, "feat: a check (#102)", "scripts/check-beds.mjs")
    git(repo, "mv", "scripts/check-beds.mjs", "notes.txt")
    merge(repo, "chore: move the check away (#103)")
    t3_store.skill_tool(t3_store.thread("main"), "plant-beds", stamp(1))
    run(skill_usage_collect())

    assert rule(run(skill_usage_triggers(repo=str(repo))))["changes"] == 3
    assert rule(run(skill_usage_triggers(days=60, repo=str(repo))))["changes"] == 4


# ── what the record must be to be judged from ───────────────────────────────


def test_a_damaged_record_judges_nothing(state: Path, t3_store: T3Store, repo: Path) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    main = session(t3_store, "main", (101, stamp(1)))
    t3_store.skill_tool(main, "gate-discipline", stamp(2))
    run(skill_usage_collect())
    with (state / store.EVENTS_FILE).open("a", encoding="utf-8") as handle:
        handle.write('{"id": "a lost load\n')

    damaged = fail(skill_usage_triggers(repo=str(repo)))
    assert damaged.code == "RECORD_DAMAGED" and "--rebuild" in damaged.suggestion

    run(skill_usage_collect(rebuild=True))
    assert judged(rule(run(skill_usage_triggers(repo=str(repo))))) == (1, 0, 0)


def test_only_a_load_counts_as_a_load(state: Path, t3_store: T3Store, repo: Path) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    main = session(t3_store, "main", (101, stamp(1)))
    t3_store.skill_tool(main, "plant-beds", stamp(2))
    t3_store.item(main, "file_change", stamp(2, 1), fileName=SKILL_FILE)  # it edited the skill
    run(skill_usage_collect())
    load = next(found for found in collected(state) if found.path == "skill_tool")
    unknown = {**load.to_json(), "id": "newer", "skill": "gate-discipline", "path": "something-new"}
    with (state / store.EVENTS_FILE).open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(unknown) + "\n")

    assert rule(run(skill_usage_triggers(repo=str(repo))))["missed"] == 1
    assert "gate-discipline" not in rows(run(skill_usage_report()))  # nor a use of it


def test_nothing_but_a_time_and_a_number_is_kept_of_a_link(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    session(t3_store, "main", (101, f"2026-01-01 and {PRIVATE}"), (102, "2026-11-01T10:00:00Z"))
    t3_store.skill_tool("main", "plant-beds", stamp(1))
    run(skill_usage_collect())

    assert PRIVATE not in (state / store.SESSIONS_FILE).read_text("utf-8")
    assert store.load_sessions(state)["main"]["pull_requests"] == [
        {"ref": "acme/garden#101", "linked_at": None, "branch": None},
        {"ref": "acme/garden#102", "linked_at": "2026-11-01T10:00:00.000Z", "branch": None},
    ]


# ── refusals, warnings, the command line ────────────────────────────────────


def test_a_repository_the_record_never_saw_is_said_to_be_unknown(
    state: Path, t3_store: T3Store, repo: Path, tmp_path: Path
) -> None:
    t3_store.skill_tool(t3_store.thread("main"), "plant-beds", stamp(1))
    run(skill_usage_collect())
    other = tmp_path / "orchard"
    other.mkdir()
    (other / "botcore.toml").write_text(RULES, "utf-8")
    git(other, "init", "-q", "-b", "main")
    git(other, "remote", "add", "origin", "git@example.com:acme/orchard.git")
    merge(other, "feat: a hook (#7)", "hooks.yml")

    data = run(skill_usage_triggers(repo=str(other)))

    assert rule(data)["unknown_why"]["no_session"] == 1
    assert any("holds nothing for acme/orchard" in warning for warning in data["warnings"])
    assert any("acme/garden" in warning for warning in data["warnings"])


def test_triggers_refuse_what_they_cannot_answer(
    state: Path, t3_store: T3Store, repo: Path, tmp_path: Path
) -> None:
    assert fail(skill_usage_triggers(repo=str(repo))).code == "NOT_COLLECTED"
    t3_store.skill_tool(t3_store.thread("main"), "plant-beds", stamp(1))
    run(skill_usage_collect())

    assert fail(skill_usage_triggers(days=0, repo=str(repo))).code == "INVALID_INPUT"
    assert fail(skill_usage_triggers(repo=str(tmp_path / "nowhere"))).code == "NO_WORKSPACE"
    plain = tmp_path / "plain"
    plain.mkdir()
    (plain / "botcore.toml").write_text(RULES, "utf-8")
    assert fail(skill_usage_triggers(repo=str(plain))).code == "GIT_FAILED"
    (plain / "botcore.toml").write_text("[[skills.required]]\nskill = 'x'\n", "utf-8")
    broken = fail(skill_usage_triggers(repo=str(plain)))
    assert broken.code == "CONFIG_INVALID" and "paths" in broken.message


def test_an_odd_or_old_record_does_not_break_the_report(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    t3_store.skill_tool(session(t3_store, "main", (101, stamp(1))), "plant-beds", stamp(2))
    run(skill_usage_collect())
    saved = store.load_state(state)
    saved["projects"]["acme/garden"]["roots"] = 7
    saved["collected_at"] = stamp(3)
    store.save_state(state, saved)
    sessions = store.load_sessions(state)
    sessions["odd"] = {"pull_requests": 7, "project": None}
    store.save_sessions(state, sessions)

    data = run(skill_usage_triggers(repo=str(repo)))

    assert rule(data)["missed"] == 1 and "Last collected" in data["warnings"][0]
    (state / store.SESSIONS_FILE).write_text("{ half a file", "utf-8")
    assert fail(skill_usage_triggers(repo=str(repo))).code == "RECORD_UNAVAILABLE"


def test_the_triggers_command_runs_from_the_command_line(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    t3_store.skill_tool(session(t3_store, "main", (101, stamp(1))), "plant-beds", stamp(2))
    run(skill_usage_collect())

    result = CliRunner().invoke(cli, ["skill-usage-triggers", "--repo", str(repo), "--json"])

    assert result.exit_code == 0
    assert json.loads(result.output)["data"]["rules"][0]["missed"] == 1


def test_required_skills_load_from_the_configuration(tmp_path: Path) -> None:
    assert SkillsConfig().required == []
    (tmp_path / "botcore.toml").write_text(RULES, "utf-8")
    (rule_,) = load_config(workspace=tmp_path).skills.required
    assert (rule_.skill, rule_.paths) == ("gate-discipline", ["hooks.yml", "scripts/check-*.mjs"])
    wrong = (
        "skill = 'x'\n",
        "skill = 'x'\npaths = []\n",
        "paths = ['a']\n",
        f"skill = '/work/{PRIVATE}.md'\npaths = ['a']\n",  # only a skill's name is accepted
    )
    for body in wrong:
        (tmp_path / "botcore.toml").write_text(f"[[skills.required]]\n{body}", "utf-8")
        with pytest.raises(Exception, match="required"):
            load_config(workspace=tmp_path)
