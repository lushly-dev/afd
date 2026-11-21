"""skill-usage-triggers: merged changes that needed a skill, against a store shaped like
T3 Code's and a real git history."""

# ruff: noqa: F811 - pytest fixtures imported from the collect and report tests

from __future__ import annotations

import json
from pathlib import Path

import pytest
from click.testing import CliRunner

from botcore.cli import cli
from botcore.commands.skill_usage import (
    skill_usage_collect,
    skill_usage_report,
    skill_usage_triggers,
    store,
    t3,
)
from botcore.commands.skill_usage.t3 import relative_to
from botcore.config import SkillsConfig, load_config
from tests.test_skill_usage import (  # noqa: F401 - fixtures
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


def merge(root: Path, subject: str, *files: str) -> None:
    """A change merged to the default branch, as a squash merge leaves it."""
    for file in files:
        target = root / file
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(target.read_text("utf-8") + "x" if target.exists() else "x", "utf-8")
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", subject)


def session(
    built: T3Store, name: str, repo: Path, *pull_requests: int | tuple[int, str], **more: object
) -> str:
    """A session in its own worktree, linked to pull requests (a number, or one with when)."""
    extra: dict = {"worktreePath": str(repo.parent / f"worktree-{name}"), "pullRequests": []}
    for pull_request in pull_requests:
        number, linked_at = (
            pull_request if isinstance(pull_request, tuple) else (pull_request, None)
        )
        extra["pullRequests"].append(
            {"repository": "acme/garden", "number": number, "linkedAt": linked_at}
        )
    return built.thread(name, extra=extra, **more)


def checkpoint(built: T3Store, thread: str, at: str, *files: str) -> str:
    """What a turn left changed in the session's checkout, however it was changed."""
    return built.item(
        thread, t3.CHECKPOINT, at, completedAt=at, files=[{"path": file} for file in files]
    )


def change(built: T3Store, thread: str, name: str, repo: Path, file: str, at: str, **more: object):
    """The session changed a file inside its worktree."""
    path = str(repo.parent / f"worktree-{name}" / file)
    return built.item(thread, t3.CHANGE, at, fileName=path, diffStr="the-private-diff", **more)


def rule(data: dict) -> dict:
    (only,) = data["rules"]
    return only


def test_each_merged_change_is_judged_by_the_session_that_made_it(
    state: Path,
    t3_store: T3Store,
    repo: Path,
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    merge(repo, "feat: a check (#102)", "scripts/check-beds.mjs")
    merge(repo, "feat: unrelated (#103)", "notes.txt")
    merge(repo, "feat: another hook (#104)", "hooks.yml")
    merge(repo, "feat: by shell (#105)", "hooks.yml")
    merge(repo, "feat: pushed straight to main", "hooks.yml")
    first = session(t3_store, "first", repo, 101)
    t3_store.skill_tool(first, "gate-discipline", stamp(2))
    change(t3_store, first, "first", repo, "hooks.yml", stamp(2, 5))
    second = session(t3_store, "second", repo, 102)
    change(t3_store, second, "second", repo, "scripts/check-beds.mjs", stamp(2))
    t3_store.skill_tool(second, "gate-discipline", stamp(2, 30))  # at review time: too late
    session(t3_store, "fifth", repo, 105)  # linked, but no change of its is in the store
    fourth = session(t3_store, "fourth", repo, 104)  # changed by a script: only a checkpoint
    t3_store.skill_tool(fourth, "gate-discipline", stamp(2))
    checkpoint(t3_store, fourth, stamp(2, 9), "notes.txt", "hooks.yml")
    unrelated = session(t3_store, "third", repo, 103)
    change(t3_store, unrelated, "third", repo, "notes.txt", stamp(2))
    assert run(skill_usage_collect())["triggers_added"] == 3

    data = run(skill_usage_triggers(repo=str(repo)))
    found = rule(data)

    assert data["project"] == "acme/garden"
    assert (found["skill"], found["changes"]) == ("gate-discipline", 5)
    assert (found["loaded"], found["missed"], found["unknown"]) == (2, 1, 2)
    assert found["unknown_why"] == {"no_pull_request": 1, "no_session": 0, "no_recorded_change": 1}
    assert found["misses"] == [{"change": 102, "sessions": ["second"]}]
    assert found["rate"] == 0.667
    assert (found["sessions_changed"], found["sessions_loaded_first"]) == (3, 2)
    assert data["warnings"] == []
    record = (state / store.EVENTS_FILE).read_text("utf-8")
    assert "hooks.yml" not in record and "check-beds" not in record  # the skill, never the file
    assert "the-private-diff" not in record


def test_a_subagent_loads_and_changes_for_its_session(
    state: Path,
    t3_store: T3Store,
    repo: Path,
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    main = session(t3_store, "main", repo, 101)
    reader = t3_store.thread("thread:subagent:reader", parent=main)
    writer = t3_store.thread("thread:subagent:writer", parent=main)
    t3_store.read_tool(reader, "/w/.claude/skills/gate-discipline/SKILL.md", stamp(1))
    change(t3_store, writer, "main", repo, "hooks.yml", stamp(1, 10))  # in the session's worktree
    run(skill_usage_collect())

    found = rule(run(skill_usage_triggers(repo=str(repo))))

    assert (found["loaded"], found["missed"], found["unknown"]) == (1, 0, 0)


def test_a_change_is_missed_when_any_of_its_sessions_had_not_loaded_the_skill(
    state: Path,
    t3_store: T3Store,
    repo: Path,
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    careful = session(t3_store, "careful", repo, 101)
    careless = session(t3_store, "careless", repo, 101, provider="codex")
    t3_store.skill_tool(careful, "gate-discipline", stamp(1))
    change(t3_store, careful, "careful", repo, "hooks.yml", stamp(1, 5))
    t3_store.item(
        careless, t3.CHANGE, stamp(1, 6), driver="codex", fileName=str(repo.parent / "x.txt"),
        changes=[{"path": str(repo.parent / "worktree-careless" / "hooks.yml")}],
    )  # fmt: skip
    failed = change(t3_store, careless, "careless", repo, "hooks.yml", stamp(0), status="failed")
    assert failed
    run(skill_usage_collect())

    found = rule(run(skill_usage_triggers(repo=str(repo))))

    assert found["misses"] == [{"change": 101, "sessions": ["careless"]}]
    assert (found["sessions_changed"], found["sessions_loaded_first"]) == (2, 1)


def test_a_session_of_several_pull_requests_is_judged_one_at_a_time(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    merge(repo, "feat: a check (#102)", "scripts/check-beds.mjs")
    merge(repo, "feat: another hook (#103)", "hooks.yml")
    long = session(t3_store, "long", repo, (101, stamp(5)), (102, stamp(3)), (103, stamp(1)))
    watcher = session(t3_store, "watcher", repo, 101, 102, 103)  # linked them, changed nothing
    assert watcher
    checkpoint(t3_store, long, stamp(6), "hooks.yml")  # built #101 without the skill
    t3_store.skill_tool(long, "gate-discipline", stamp(4))  # then loaded it
    checkpoint(t3_store, long, stamp(3, -30), "scripts/check-beds.mjs")  # and built #102 with it
    run(skill_usage_collect())  # #103 was merged from this session with no change recorded

    found = rule(run(skill_usage_triggers(repo=str(repo))))

    assert (found["loaded"], found["missed"]) == (1, 1)
    assert found["misses"] == [{"change": 101, "sessions": ["long"]}]
    assert found["unknown_why"]["no_recorded_change"] == 1


def test_a_turn_that_merged_other_commits_is_not_read_as_the_sessions_changes(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    main = session(t3_store, "main", repo, 101)
    t3_store.run("run-merge", "claude-opus-5-5")
    t3_store.run("run-work", "claude-opus-5-5")
    t3_store.item(main, t3.COMMAND, stamp(3), input="git merge origin/main", run_id="run-merge")
    t3_store.item(  # the merge brought someone else's hook change into the checkout
        main, t3.CHECKPOINT, stamp(3, 1), completedAt=stamp(3, 1), run_id="run-merge",
        files=[{"path": "hooks.yml"}, {"path": "notes.txt"}],
    )  # fmt: skip
    t3_store.skill_tool(main, "gate-discipline", stamp(2))
    t3_store.item(
        main, t3.CHECKPOINT, stamp(1), completedAt=stamp(1), run_id="run-work",
        files=[{"path": "hooks.yml"}],
    )  # fmt: skip
    assert run(skill_usage_collect())["triggers_added"] == 1

    found = rule(run(skill_usage_triggers(repo=str(repo))))

    assert (found["loaded"], found["missed"]) == (1, 0)  # judged by its own change, after the load


def test_a_rule_follows_a_renamed_skill(
    state: Path,
    t3_store: T3Store,
    repo: Path,
) -> None:
    git(repo, "mv", ".claude/skills/gate-discipline", ".claude/skills/change-a-gate")
    (repo / "botcore.toml").write_text(RULES.replace("gate-discipline", "change-a-gate"), "utf-8")
    merge(repo, "chore: rename the skill (#100)")
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    main = session(t3_store, "main", repo, 101)
    t3_store.skill_tool(main, "gate-discipline", stamp(3))  # loaded under its old name
    change(t3_store, main, "main", repo, "hooks.yml", stamp(3, 5))
    run(skill_usage_collect())

    found = rule(run(skill_usage_triggers(repo=str(repo))))

    assert (found["skill"], found["loaded"], found["missed"]) == ("change-a-gate", 1, 0)


def test_rules_declared_after_collection_need_a_rebuild(
    state: Path,
    t3_store: T3Store,
    repo: Path,
) -> None:
    (repo / "botcore.toml").write_text("", "utf-8")
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    main = session(t3_store, "main", repo, 101)
    change(t3_store, main, "main", repo, "hooks.yml", stamp(3))
    assert run(skill_usage_collect())["triggers_added"] == 0
    assert fail(skill_usage_triggers(repo=str(repo))).code == "NO_REQUIRED_SKILLS"

    (repo / "botcore.toml").write_text(RULES, "utf-8")
    before = run(skill_usage_triggers(repo=str(repo)))
    assert rule(before)["unknown_why"]["no_recorded_change"] == 1
    assert "--rebuild" in before["warnings"][0]

    assert run(skill_usage_collect(rebuild=True))["triggers_added"] == 1
    after = run(skill_usage_triggers(repo=str(repo)))

    assert rule(after)["missed"] == 1 and after["warnings"] == []


def test_a_change_that_requires_a_skill_is_not_a_use_of_it(
    state: Path,
    t3_store: T3Store,
    repo: Path,
) -> None:
    main = session(t3_store, "main", repo)
    change(t3_store, main, "main", repo, "hooks.yml", stamp(1))
    checkpoint(t3_store, main, stamp(1, 1), "scripts\\check-beds.mjs")  # as Windows writes it
    assert run(skill_usage_collect())["triggers_added"] == 2

    data = run(skill_usage_report())

    assert data["skills"] == []
    assert "gate-discipline" in [entry["skill"] for entry in data["quiet"]]
    assert [found.path for found in collected(state)] == ["trigger", "trigger"]


def test_a_repository_the_record_never_saw_is_said_to_be_unknown(
    state: Path, t3_store: T3Store, repo: Path, tmp_path: Path
) -> None:
    t3_store.skill_tool(session(t3_store, "main", repo), "plant-beds", stamp(1))
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
    state: Path,
    t3_store: T3Store,
    repo: Path,
    tmp_path: Path,
) -> None:
    assert fail(skill_usage_triggers(repo=str(repo))).code == "NOT_COLLECTED"
    t3_store.skill_tool(session(t3_store, "main", repo), "plant-beds", stamp(1))
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


def test_the_triggers_command_runs_from_the_command_line(
    state: Path,
    t3_store: T3Store,
    repo: Path,
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    main = session(t3_store, "main", repo, 101)
    change(t3_store, main, "main", repo, "hooks.yml", stamp(1))
    run(skill_usage_collect())

    result = CliRunner().invoke(cli, ["skill-usage-triggers", "--repo", str(repo), "--json"])

    assert result.exit_code == 0
    assert json.loads(result.output)["data"]["rules"][0]["missed"] == 1


def test_a_changed_file_is_placed_inside_its_checkout() -> None:
    assert relative_to("/w/tree/scripts/check-a.mjs", [None, "/w/tree"]) == "scripts/check-a.mjs"
    assert relative_to("C:\\w\\tree\\hooks.yml", ["C:\\w\\tree\\"]) == "hooks.yml"
    assert relative_to("/w/tree-two/hooks.yml", ["/w/tree"]) is None
    assert relative_to("/elsewhere/hooks.yml", ["/w/tree", None]) is None


def test_required_skills_load_from_the_configuration(tmp_path: Path) -> None:
    assert SkillsConfig().required == []
    (tmp_path / "botcore.toml").write_text(RULES, "utf-8")
    (rule_,) = load_config(workspace=tmp_path).skills.required
    assert (rule_.skill, rule_.paths) == ("gate-discipline", ["hooks.yml", "scripts/check-*.mjs"])
    for wrong in ("skill = 'x'\n", "skill = 'x'\npaths = []\n", "paths = ['a']\n"):
        (tmp_path / "botcore.toml").write_text(f"[[skills.required]]\n{wrong}", "utf-8")
        with pytest.raises(Exception, match="required"):
            load_config(workspace=tmp_path)
