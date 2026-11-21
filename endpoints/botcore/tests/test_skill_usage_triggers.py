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
)
from botcore.commands.skill_usage.changes import CHANGE, CHECKPOINT, inside
from botcore.commands.skill_usage.events import moves_checkout
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
PRIVATE = "the-private-diff"


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


def edit(built: T3Store, thread: str, name: str, repo: Path, file: str, at: str, **more: object):
    """A tool edited a file inside the session's worktree: seen at the moment it happened."""
    path = str(repo.parent / f"worktree-{name}" / file)
    return built.item(thread, CHANGE, at, fileName=path, diffStr=PRIVATE, **more)


def checkpoint(built: T3Store, thread: str, at: str, *files: str, **more: object) -> str:
    """What a turn left changed in the session's checkout, however it was changed."""
    return built.item(thread, CHECKPOINT, at, files=[{"path": file} for file in files], **more)


def rule(data: dict) -> dict:
    (only,) = data["rules"]
    return only


def triggers(state: Path) -> list:
    return store.load_triggers(state)[0]


def judged(found: dict) -> tuple[int, int, int]:
    return found["loaded"], found["missed"], found["unknown"]


# ── judging a merged change ─────────────────────────────────────────────────


def test_each_merged_change_is_judged_by_the_session_that_made_it(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    merge(repo, "feat: a check (#102)", "scripts/check-beds.mjs")
    merge(repo, "feat: unrelated (#103)", "notes.txt")
    merge(repo, "feat: another hook (#104)", "hooks.yml")
    merge(repo, "feat: by another machine (#105)", "hooks.yml")
    merge(repo, "feat: pushed straight to main", "hooks.yml")
    first = session(t3_store, "first", repo, 101)
    t3_store.skill_tool(first, "gate-discipline", stamp(2))
    edit(t3_store, first, "first", repo, "hooks.yml", stamp(2, 5))
    second = session(t3_store, "second", repo, 102)
    edit(t3_store, second, "second", repo, "scripts/check-beds.mjs", stamp(2))
    t3_store.skill_tool(second, "gate-discipline", stamp(2, 30))  # at review time: too late
    session(t3_store, "fourth", repo, 104)  # linked, but no change of its is in the store
    unrelated = session(t3_store, "third", repo, 103)
    edit(t3_store, unrelated, "third", repo, "notes.txt", stamp(2))
    assert run(skill_usage_collect())["triggers_added"] == 2

    data = run(skill_usage_triggers(repo=str(repo)))
    found = rule(data)

    assert data["project"] == "acme/garden"
    assert (found["skill"], found["changes"]) == ("gate-discipline", 5)
    assert judged(found) == (1, 1, 3)
    assert found["unknown_why"] == {
        "no_pull_request": 1, "no_session": 1, "no_link_time": 0, "no_recorded_change": 1,
        "same_turn": 0,
    }  # fmt: skip
    assert found["misses"] == [{"change": 102, "sessions": ["second"]}]
    assert found["rate"] == 0.5
    assert (found["sessions_changed"], found["sessions_loaded_first"]) == (2, 1)
    assert data["warnings"] == []
    for name in (store.TRIGGERS_FILE, store.EVENTS_FILE, store.SESSIONS_FILE):
        record = (state / name).read_text("utf-8")
        assert "hooks.yml" not in record and "check-beds" not in record  # the skill, not the file
        assert PRIVATE not in record


def test_a_change_seen_only_at_the_end_of_its_turn_is_judged_only_when_the_order_is_known(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    for number in (101, 102, 103, 104):
        merge(repo, f"feat: a hook (#{number})", "hooks.yml")
    before = session(t3_store, "before", repo, 101)
    t3_store.skill_tool(before, "gate-discipline", stamp(3))
    checkpoint(t3_store, before, stamp(2, 30), "notes.txt")  # the turn before ended here
    checkpoint(t3_store, before, stamp(2, 40), "hooks.yml")  # changed by a script in this turn
    during = session(t3_store, "during", repo, 102)
    checkpoint(t3_store, during, stamp(2, 30), "notes.txt")
    t3_store.skill_tool(during, "gate-discipline", stamp(2, 35))  # loaded in the same turn
    checkpoint(t3_store, during, stamp(2, 40), "hooks.yml")
    never = session(t3_store, "never", repo, 103)
    checkpoint(t3_store, never, stamp(2, 40), "hooks.yml")
    instant = session(t3_store, "instant", repo, 104)
    t3_store.skill_tool(instant, "gate-discipline", stamp(2))
    edit(t3_store, instant, "instant", repo, "hooks.yml", stamp(2))  # the very same moment
    run(skill_usage_collect())

    found = rule(run(skill_usage_triggers(repo=str(repo))))

    assert judged(found) == (1, 1, 2)
    assert found["unknown_why"]["same_turn"] == 2
    assert found["misses"] == [{"change": 103, "sessions": ["never"]}]
    assert found["sessions_order_unknown"] == 2


def test_a_subagent_loads_and_changes_for_its_session_and_a_sibling_task_does_not(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    merge(repo, "feat: a check (#102)", "scripts/check-beds.mjs")
    foreman = session(t3_store, "foreman", repo)
    cell = session(t3_store, "thread:delegated-task:cell", repo, 101, parent=foreman)
    reader = t3_store.thread("thread:subagent:reader", parent=cell)
    writer = t3_store.thread("thread:subagent:writer", parent=cell)
    t3_store.read_tool(reader, "/w/.claude/skills/gate-discipline/SKILL.md", stamp(1))
    path = str(repo.parent / "worktree-thread:delegated-task:cell" / "hooks.yml")
    t3_store.item(writer, CHANGE, stamp(1, 10), fileName=path)  # in its session's checkout
    other = session(t3_store, "thread:delegated-task:other", repo, 102, parent=foreman)
    edit(t3_store, other, "thread:delegated-task:other", repo, "scripts/check-beds.mjs", stamp(1))
    run(skill_usage_collect())

    found = rule(run(skill_usage_triggers(repo=str(repo))))

    assert judged(found) == (1, 1, 0)  # the cell's load does not answer for the other cell
    assert found["misses"] == [{"change": 102, "sessions": ["thread:delegated-task:other"]}]


def test_a_change_is_missed_when_any_of_its_sessions_had_not_loaded_the_skill(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    careful = session(t3_store, "careful", repo, 101)
    careless = session(t3_store, "careless", repo, 101, provider="codex")
    failing = session(t3_store, "failing", repo, 101)
    t3_store.skill_tool(careful, "gate-discipline", stamp(1))
    edit(t3_store, careful, "careful", repo, "hooks.yml", stamp(1, 5))
    t3_store.item(
        careless, CHANGE, stamp(1, 6), driver="codex", fileName=str(repo.parent / "x.txt"),
        changes=[{"path": str(repo.parent / "worktree-careless" / "hooks.yml")}],
    )  # fmt: skip
    edit(t3_store, failing, "failing", repo, "hooks.yml", stamp(1), status="failed")
    run(skill_usage_collect())

    found = rule(run(skill_usage_triggers(repo=str(repo))))

    assert found["misses"] == [{"change": 101, "sessions": ["careless"]}]  # not the failed edit
    assert (found["sessions_changed"], found["sessions_loaded_first"]) == (2, 1)


def test_a_session_of_several_pull_requests_is_judged_one_at_a_time(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    merge(repo, "feat: a check (#102)", "scripts/check-beds.mjs")
    merge(repo, "feat: another hook (#103)", "hooks.yml")
    long = session(t3_store, "long", repo, (101, stamp(5)), (102, stamp(3)), (103, stamp(1)))
    session(t3_store, "watcher", repo, (101, stamp(5)), (102, stamp(3)))  # changed nothing
    edit(t3_store, long, "long", repo, "hooks.yml", stamp(6))  # built #101 without the skill
    t3_store.skill_tool(long, "gate-discipline", stamp(4))  # then loaded it
    edit(t3_store, long, "long", repo, "scripts/check-beds.mjs", stamp(3, -30))  # #102, with it
    edit(t3_store, long, "long", repo, "hooks.yml", stamp(-1))  # after everything had merged
    run(skill_usage_collect())

    found = rule(run(skill_usage_triggers(repo=str(repo))))

    assert judged(found) == (1, 1, 1)
    assert found["misses"] == [{"change": 101, "sessions": ["long"]}]
    assert found["unknown_why"]["no_recorded_change"] == 1  # #103: nothing before it merged


def test_links_without_a_time_cannot_tell_which_change_built_which(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    merge(repo, "feat: another hook (#102)", "hooks.yml")
    merge(repo, "feat: a third hook (#103)", "hooks.yml")
    older = session(t3_store, "older", repo)
    edit(t3_store, older, "older", repo, "hooks.yml", stamp(2))
    single = session(t3_store, "single", repo)
    edit(t3_store, single, "single", repo, "hooks.yml", stamp(2))
    run(skill_usage_collect())
    sessions = store.load_sessions(state)  # as an earlier botcore wrote them
    sessions["older"]["pull_requests"] = ["acme/garden#101", "acme/garden#102"]
    sessions["single"]["pull_requests"] = ["acme/garden#103"]
    store.save_sessions(state, sessions)

    found = rule(run(skill_usage_triggers(repo=str(repo))))

    assert judged(found) == (0, 1, 2)
    assert found["unknown_why"]["no_link_time"] == 2
    assert found["misses"] == [{"change": 103, "sessions": ["single"]}]


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
    main = session(t3_store, "main", repo, 101)
    t3_store.skill_tool(main, "gate-discipline", stamp(3))  # loaded under its old name
    edit(t3_store, main, "main", repo, "hooks.yml", stamp(3, 5))
    edit(t3_store, main, "main", repo, "scripts/check-beds.mjs", stamp(3, 6))
    run(skill_usage_collect())

    found = rule(run(skill_usage_triggers(repo=str(repo))))  # one row, one change

    assert (found["skill"], found["changes"]) == ("change-a-gate", 1)
    assert judged(found) == (1, 0, 0)
    assert found["paths"] == ["hooks.yml", "scripts/check-*.mjs"]


def test_a_session_that_spans_the_window_is_counted(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    main = session(t3_store, "main", repo)
    edit(t3_store, main, "main", repo, "hooks.yml", stamp(40))
    edit(t3_store, main, "main", repo, "hooks.yml", stamp(1))
    run(skill_usage_collect())

    found = rule(run(skill_usage_triggers(repo=str(repo))))

    assert (found["sessions_changed"], found["sessions_loaded_first"]) == (1, 0)


# ── what counts as a session's own change ───────────────────────────────────


@pytest.mark.parametrize(
    "command",
    [
        "git merge --ff-only abc123",
        "git -C /work pull",
        "git -c core.editor=true rebase origin/main",
        "git rebase --continue",
        "git cherry-pick abc123",
        "git reset --hard origin/main",
        "git checkout main",
        "git switch other",
        "git checkout --detach HEAD^",
        "git switch -c fix origin/main",
        "git switch -C codex/fix origin/main",
        "git checkout -b fix origin/main",
        "git checkout origin/main -- hooks.yml",
        "gh pr checkout 5",
        "gh pr merge 5 --squash --delete-branch",
        "pnpm base:sync",
        "node scripts/base-sync.mjs",
        '/bin/zsh -lc "cd work && git merge main"',
    ],
)
def test_a_command_that_moves_the_checkout_to_other_commits(command: str) -> None:
    assert moves_checkout(command)


@pytest.mark.parametrize(
    "command",
    [
        "git merge-base main HEAD",
        "git merge --abort",
        "git checkout -b new",
        "git switch -c new",
        "git checkout -- hooks.yml",
        "git reset HEAD~1",
        "git stash pop",
        "git status",
        "git log --merges",
        'echo "git merge main"',
        'git commit -m "git pull before the fix"',
        'rg "git rebase" docs',
        "pnpm test",
    ],
)
def test_a_command_that_leaves_the_checkout_where_it_was(command: str) -> None:
    assert not moves_checkout(command)


def test_a_turn_that_moved_the_checkout_is_not_read_as_the_sessions_changes(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    main = session(t3_store, "main", repo, 101)
    helper = t3_store.thread("thread:subagent:helper", parent=main)
    t3_store.shell(main, "git merge origin/main", stamp(5))
    checkpoint(t3_store, main, stamp(5, 1), "hooks.yml", "notes.txt")  # someone else's change
    t3_store.shell(helper, "git switch -C fix origin/main", stamp(4))  # its subagent moved it
    checkpoint(t3_store, main, stamp(4, 1), "hooks.yml")
    t3_store.shell(main, "git merge origin/main", stamp(3), status="failed")  # moved nothing
    t3_store.shell(main, 'echo "git merge main"', stamp(3, 1))
    t3_store.skill_tool(main, "gate-discipline", stamp(3, 2))
    checkpoint(t3_store, main, stamp(3, 3), "notes.txt")
    checkpoint(t3_store, main, stamp(2), "hooks.yml")  # its own change, after the load
    assert run(skill_usage_collect())["triggers_added"] == 1

    found = rule(run(skill_usage_triggers(repo=str(repo))))

    assert judged(found) == (1, 0, 0)


def test_a_move_before_the_window_still_hides_its_turn(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    main = session(t3_store, "main", repo)
    checkpoint(t3_store, main, stamp(9), "notes.txt")
    t3_store.shell(main, "git pull", stamp(4))  # older than what the next collection re-reads
    t3_store.skill_tool(main, "plant-beds", stamp(1))
    run(skill_usage_collect())
    checkpoint(t3_store, main, stamp(0), "hooks.yml")  # the same turn ends now

    assert run(skill_usage_collect())["triggers_added"] == 0


def test_one_change_is_one_trigger_however_many_things_show_it(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    main = session(t3_store, "main", repo)
    t3_store.run("turn-1", "claude-opus-5-5")
    edit(t3_store, main, "main", repo, "hooks.yml", stamp(1), run_id="turn-1")
    edit(t3_store, main, "main", repo, "scripts/check-beds.mjs", stamp(1, 1), run_id="turn-1")
    checkpoint(t3_store, main, stamp(1, 5), "hooks.yml", "scripts/check-beds.mjs", run_id="turn-1")

    assert run(skill_usage_collect())["triggers_added"] == 1  # one turn, one skill
    (only,) = triggers(state)
    assert (only.at, only.since) == (stamp(1), None)  # at the edit's own time
    assert run(skill_usage_collect())["triggers_added"] == 0


def test_an_edit_belongs_to_the_checkout_of_the_session_that_made_it(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    mine = session(t3_store, "mine", repo)
    session(t3_store, "theirs", repo)
    other = str(repo.parent / "worktree-theirs" / "hooks.yml")
    t3_store.item(mine, CHANGE, stamp(1), fileName=other)  # in another session's checkout
    assert run(skill_usage_collect())["triggers_added"] == 0

    t3_store.item(mine, CHANGE, stamp(1, 1), fileName="scripts/check-beds.mjs")  # relative
    assert run(skill_usage_collect())["triggers_added"] == 1


def test_a_changed_file_is_placed_inside_its_checkout() -> None:
    assert inside("/w/tree/scripts/check-a.mjs", [None, "/w/tree"]) == "scripts/check-a.mjs"
    assert inside("scripts/check-a.mjs", ["/w/tree"]) == "scripts/check-a.mjs"
    assert inside("./hooks.yml", []) == "hooks.yml"
    assert inside("C:\\w\\tree\\hooks.yml", ["c:\\W\\Tree\\"]) == "hooks.yml"
    assert inside("/w/Tree/hooks.yml", ["/w/tree"]) is None  # a POSIX path keeps its case
    assert inside("/w/tree-two/hooks.yml", ["/w/tree"]) is None
    assert inside("/elsewhere/hooks.yml", ["/w/tree", None]) is None


def test_a_checkpoint_path_written_by_windows_matches(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    main = session(t3_store, "main", repo)
    checkpoint(t3_store, main, stamp(1), "scripts\\check-beds.mjs")

    assert run(skill_usage_collect())["triggers_added"] == 1


# ── reading git ─────────────────────────────────────────────────────────────


def test_only_what_merged_to_the_default_branch_is_a_merged_change(
    state: Path, t3_store: T3Store, repo: Path, tmp_path: Path
) -> None:
    t3_store.skill_tool(session(t3_store, "main", repo), "plant-beds", stamp(1))
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
    merge(repo, "feat: a named file (#101)", "café.yml")
    merge(repo, "feat: a check (#102)", "scripts/check-beds.mjs")
    git(repo, "mv", "scripts/check-beds.mjs", "notes.txt")
    git(repo, "commit", "-q", "-m", "chore: move the check away (#103)")
    t3_store.skill_tool(session(t3_store, "main", repo), "plant-beds", stamp(1))
    run(skill_usage_collect())

    assert rule(run(skill_usage_triggers(repo=str(repo))))["changes"] == 3


# ── rules that change, records that age ─────────────────────────────────────


def test_rules_declared_after_collection_need_a_full_read(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    (repo / "botcore.toml").write_text("", "utf-8")
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    main = session(t3_store, "main", repo, 101)
    edit(t3_store, main, "main", repo, "hooks.yml", stamp(3))
    t3_store.skill_tool(main, "plant-beds", stamp(0))
    assert run(skill_usage_collect())["triggers_added"] == 0
    assert fail(skill_usage_triggers(repo=str(repo))).code == "NO_REQUIRED_SKILLS"

    (repo / "botcore.toml").write_text(RULES, "utf-8")
    assert run(skill_usage_collect())["triggers_added"] == 0  # an hourly run reads a day back
    before = run(skill_usage_triggers(repo=str(repo)))
    assert rule(before)["unknown_why"]["no_recorded_change"] == 1
    assert "--rebuild" in before["warnings"][0]  # and the warning outlives that run

    assert run(skill_usage_collect(rebuild=True))["triggers_added"] == 1
    after = run(skill_usage_triggers(repo=str(repo)))

    assert rule(after)["missed"] == 1 and after["warnings"] == []


def test_evidence_gathered_under_other_paths_is_not_judged(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    main = session(t3_store, "main", repo, 101)
    edit(t3_store, main, "main", repo, "hooks.yml", stamp(3))
    t3_store.skill_tool(main, "plant-beds", stamp(0))
    run(skill_usage_collect())
    assert rule(run(skill_usage_triggers(repo=str(repo))))["missed"] == 1

    (repo / "botcore.toml").write_text(RULES.replace("hooks.yml", "new.yml"), "utf-8")
    run(skill_usage_collect())
    changed = run(skill_usage_triggers(repo=str(repo)))

    assert judged(rule(changed)) == (0, 0, 0)  # hooks.yml no longer requires the skill
    assert "--rebuild" in changed["warnings"][0]


def test_a_damaged_record_judges_nothing(state: Path, t3_store: T3Store, repo: Path) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    main = session(t3_store, "main", repo, 101)
    t3_store.skill_tool(main, "gate-discipline", stamp(2))
    edit(t3_store, main, "main", repo, "hooks.yml", stamp(1))
    run(skill_usage_collect())
    with (state / store.EVENTS_FILE).open("a", encoding="utf-8") as handle:
        handle.write('{"id": "a lost load\n')

    damaged = fail(skill_usage_triggers(repo=str(repo)))
    assert damaged.code == "RECORD_DAMAGED" and "--rebuild" in damaged.suggestion

    run(skill_usage_collect(rebuild=True))
    assert judged(rule(run(skill_usage_triggers(repo=str(repo))))) == (1, 0, 0)


def test_only_a_load_counts_as_a_load(state: Path, t3_store: T3Store, repo: Path) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    main = session(t3_store, "main", repo, 101)
    edit(t3_store, main, "main", repo, "hooks.yml", stamp(1))
    t3_store.skill_tool(main, "plant-beds", stamp(2))
    run(skill_usage_collect())
    (load,) = collected(state)
    unknown = {**load.to_json(), "id": "newer", "skill": "gate-discipline", "path": "something-new"}
    with (state / store.EVENTS_FILE).open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(unknown) + "\n")

    assert rule(run(skill_usage_triggers(repo=str(repo))))["missed"] == 1
    assert "gate-discipline" not in rows(run(skill_usage_report()))


def test_nothing_but_a_time_and_a_name_reaches_the_record(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    session(
        t3_store, "main", repo, (101, f"2026-01-01 and {PRIVATE}"), (102, "2026-11-01T10:00:00Z")
    )
    t3_store.skill_tool("main", "plant-beds", stamp(1))
    run(skill_usage_collect())

    assert PRIVATE not in (state / store.SESSIONS_FILE).read_text("utf-8")
    assert store.load_sessions(state)["main"]["pull_requests"] == [
        {"ref": "acme/garden#101", "linked_at": None},
        {"ref": "acme/garden#102", "linked_at": "2026-11-01T10:00:00.000Z"},
    ]


def test_a_change_that_requires_a_skill_is_not_a_use_of_it(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    main = session(t3_store, "main", repo)
    edit(t3_store, main, "main", repo, "hooks.yml", stamp(1))
    assert run(skill_usage_collect())["triggers_added"] == 1

    data = run(skill_usage_report())

    assert data["skills"] == [] and collected(state) == []  # in a file of its own
    assert "gate-discipline" in [entry["skill"] for entry in data["quiet"]]
    assert [found.skill for found in triggers(state)] == ["gate-discipline"]


# ── refusals, warnings, the command line ────────────────────────────────────


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
    state: Path, t3_store: T3Store, repo: Path, tmp_path: Path
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


def test_an_odd_or_old_record_does_not_break_the_report(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    t3_store.skill_tool(session(t3_store, "main", repo, 101), "plant-beds", stamp(1))
    run(skill_usage_collect())
    saved = store.load_state(state)
    saved["projects"]["acme/garden"]["roots"] = 7
    saved["collected_at"] = stamp(3)
    store.save_state(state, saved)

    data = run(skill_usage_triggers(repo=str(repo)))

    assert rule(data)["unknown_why"]["no_recorded_change"] == 1
    assert "Last collected" in data["warnings"][0]
    (state / store.SESSIONS_FILE).write_text("{ half a file", "utf-8")
    assert fail(skill_usage_triggers(repo=str(repo))).code == "RECORD_UNAVAILABLE"


def test_the_triggers_command_runs_from_the_command_line(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    main = session(t3_store, "main", repo, 101)
    edit(t3_store, main, "main", repo, "hooks.yml", stamp(1))
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
        f"skill = '/work/{PRIVATE}.md'\npaths = ['a']\n",  # only a name goes in the record
    )
    for body in wrong:
        (tmp_path / "botcore.toml").write_text(f"[[skills.required]]\n{body}", "utf-8")
        with pytest.raises(Exception, match="required"):
            load_config(workspace=tmp_path)
