"""skill-usage-triggers: merged changes that needed a skill, against a store shaped like
T3 Code's and a real git history."""

# ruff: noqa: F811 - pytest fixtures imported from the collect and report tests

from __future__ import annotations

import json
import os
import subprocess
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from click.testing import CliRunner

from botcore.cli import cli
from botcore.commands.disk import scan
from botcore.commands.skill_usage import (
    skill_usage_collect,
    skill_usage_report,
    skill_usage_triggers,
    store,
    triggers,
)
from botcore.config import SkillsConfig, load_config
from tests.test_skill_usage import (  # noqa: F401 - fixtures
    NOW,
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


def link(number: int, at: str | None, source: str | None = "created", **more: object) -> dict:
    """A pull request as T3 Code links it to a thread: `created` on the one that opened it."""
    found = {"repository": "acme/garden", "number": number, "linkedAt": at, "title": PRIVATE}
    return {**found, **({"source": source} if source else {}), **more}


def session(built: T3Store, name: str, *opened: tuple[int, str | None], **more: object) -> str:
    """A session that opened pull requests, each with when."""
    extra = {"pullRequests": [link(number, at) for number, at in opened]}
    return built.thread(name, extra=extra, **more)


def attached(built: T3Store, name: str, *numbers: int, **more: object) -> str:
    """A session that attached itself to pull requests something else opened."""
    extra = {"pullRequests": [link(number, stamp(2), "agent") for number in numbers]}
    return built.thread(name, extra=extra, **more)


def rule(data: dict) -> dict:
    (only,) = data["rules"]
    return only


def judged(found: dict) -> tuple[int, int, int]:
    return found["loaded"], found["missed"], found["unknown"]


def why(found: dict) -> dict[str, int]:
    return {reason: count for reason, count in found["unknown_why"].items() if count}


# ── judging a merged change ─────────────────────────────────────────────────


def test_a_skill_is_named_as_the_default_branch_names_it(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    """Not as the checked-out files do: a checkout left on an old branch still holds the
    skill's folder under the name it had. Nor as the record does where the checkout knows
    more: nothing was collected since the rename."""
    git(repo, "branch", "old")
    t3_store.skill_tool(session(t3_store, "first", (101, stamp(2))), "gate-discipline", stamp(3))
    run(skill_usage_collect())
    git(repo, "mv", ".claude/skills/gate-discipline", ".claude/skills/gates")
    merge(repo, "chore: rename the skill (#100)", days_ago=-1)
    merge(repo, "feat: a hook (#101)", "hooks.yml", days_ago=-1)
    git(repo, "checkout", "-q", "old")  # its rule and its folder name the skill the old way
    saved = store.load_state(state)  # and an older history, another machine's, another name
    saved["projects"]["acme/garden"]["renames"] = {"gate-discipline": "elsewhere"}
    store.save_state(state, saved)

    found = rule(run(skill_usage_triggers(repo=str(repo), days=40)))

    assert (found["skill"], judged(found)) == ("gates", (1, 0, 0))


def test_a_checkout_git_stops_answering_in_is_named_by_the_record(
    state: Path, t3_store: T3Store, repo: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    git(repo, "mv", ".claude/skills/gate-discipline", ".claude/skills/gates")
    merge(repo, "chore: rename the skill (#100)")
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    t3_store.skill_tool(session(t3_store, "first", (101, stamp(2))), "gate-discipline", stamp(3))
    run(skill_usage_collect())
    git(repo, "checkout", "-q", "-b", "old", "HEAD~2")  # where the skill has its old name

    def busy(root: Path, last: dict | None = None) -> dict:
        raise triggers.GitError("git for-each-ref: timed out")

    monkeypatch.setattr(triggers, "skill_inventory", busy)

    found = rule(run(skill_usage_triggers(repo=str(repo))))

    assert (found["skill"], judged(found)) == ("gates", (1, 0, 0))


def test_a_subject_with_two_numbers_names_its_pull_request_last(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    """A queue that rebases lands a commit as written, so the fold ends its subject with the
    pull request's number, after any number the author wrote there."""
    merge(repo, "fix: mend the hook (#7) (#101)", "hooks.yml")
    t3_store.skill_tool(session(t3_store, "first", (101, stamp(2))), "gate-discipline", stamp(3))
    session(t3_store, "other", (7, stamp(2)))  # opened #7, and loaded nothing
    run(skill_usage_collect())

    found = rule(run(skill_usage_triggers(repo=str(repo))))

    assert judged(found) == (1, 0, 0)


def test_each_merged_change_is_judged_by_the_session_that_opened_it(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    merge(repo, "feat: a check (#102)", "scripts/check-beds.mjs")
    merge(repo, "feat: unrelated (#103)", "notes.txt")
    merge(repo, "feat: another hook (#104)", "hooks.yml")
    merge(repo, "feat: by another machine (#105)", "hooks.yml")
    merge(repo, "feat: pushed straight to main", "hooks.yml")
    first = session(t3_store, "first", (101, stamp(2)))
    t3_store.skill_tool(first, "gate-discipline", stamp(3))  # before it opened the pull request
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
        "no_pull_request": 1, "no_session": 1, "opened_elsewhere": 0, "no_link_time": 0,
        "after_opening": 1, "possibly_loaded": 0, "incomplete_record": 0,
    }  # fmt: skip
    assert found["misses"] == [{"change": 104, "sessions": ["fourth"]}]
    assert found["rate"] == 0.5 and found["paths"] == ["hooks.yml", "scripts/check-*.mjs"]
    assert found["loaded_by_subagent"] == 0
    assert data["merged"]["branch"] == "main" and data["merged"]["latest"] >= stamp(1)[:19]
    assert data["warnings"] == []


def folded(root: Path, subject: str, threads: list[str], file: str, handed: float) -> None:
    """A fleet cell's change as its merge lane lands it: the commit the lane folded, naming
    the cell's threads and authored when the cell handed it over (`handed` days ago), merged
    now by a queue that rebases, with no number in its subject."""
    target = root / file
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(target.read_text("utf-8") + "x" if target.exists() else "x", "utf-8")
    git(root, "add", "-A")
    body = "\n".join(f"{triggers.SESSION_TRAILER}: {triggers.session_tag(t)}" for t in threads)
    message = f"{subject}\n\nWhat it does.\n\nAssisted-by: Codex\n{body}\n"
    authored = (NOW - timedelta(days=handed)).strftime("%Y-%m-%dT%H:%M:%S+00:00")
    subprocess.run(
        ["git", "-C", str(root), "-c", "user.name=T", "-c", "user.email=t@example.com",
         "-c", "commit.gpgsign=false", "commit", "-q", "-F", "-"],
        input=message, text=True, check=True, capture_output=True,
        env={**os.environ, "GIT_AUTHOR_DATE": authored,
             "GIT_COMMITTER_DATE": NOW.strftime("%Y-%m-%dT%H:%M:%S+00:00")},
    )  # fmt: skip


def test_a_fleet_cells_change_is_judged_by_the_sessions_its_fold_names(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    """#1887: the lane opens a cell's pull request, so nothing links the cell's thread to it.
    The commit the lane folds names the cell's threads, and its author time is when the cell
    handed the change over: a load before it counts, one after it is at a repair."""
    foreman = t3_store.thread("foreman")
    careful = t3_store.thread("thread:delegated-task:careful", parent=foreman)
    t3_store.skill_tool(careful, "gate-discipline", stamp(3))
    careless = t3_store.thread("thread:delegated-task:careless", parent=foreman)
    late = t3_store.thread("thread:delegated-task:late", parent=foreman)
    t3_store.skill_tool(late, "gate-discipline", stamp(1))  # after it handed the change over
    first = t3_store.thread("thread:delegated-task:first", parent=foreman)
    repairer = t3_store.thread("thread:delegated-task:repairer", parent=foreman)
    t3_store.skill_tool(repairer, "gate-discipline", stamp(2.5))  # the repair loaded it
    folded(repo, "feat: a careful hook", [careful], "hooks.yml", handed=2)
    folded(repo, "feat: a careless check", [careless], "scripts/check-a.mjs", handed=2)
    folded(repo, "feat: a late hook", [late], "hooks.yml", handed=2)
    folded(repo, "feat: from elsewhere", ["thread:delegated-task:gone"], "hooks.yml", handed=2)
    folded(repo, "fix: a repaired hook", [first, repairer], "hooks.yml", handed=2)
    # One its record does not hold may be the one that loaded it: never a miss, though a load
    # by another stands.
    folded(repo, "feat: half held", [careless, "thread:delegated-task:away"], "hooks.yml", 2)
    folded(repo, "feat: half held, loaded", [careful, "thread:delegated-task:away"], "hooks.yml", 2)
    run(skill_usage_collect())

    found = rule(run(skill_usage_triggers(repo=str(repo))))

    assert judged(found) == (3, 1, 3)
    assert why(found) == {"no_session": 1, "after_opening": 1, "incomplete_record": 1}
    (miss,) = found["misses"]
    commit = subprocess.run(
        ["git", "-C", str(repo), "log", "-1", "--format=%H", "--grep=careless"],
        check=True, capture_output=True, text=True,
    ).stdout.strip()  # fmt: skip
    assert miss == {"change": None, "commit": commit[:12], "sessions": [careless]}


def test_a_link_to_the_session_that_opened_it_outranks_a_fold_trailer(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    """A branch published through prepare-pr may carry a trailer from an earlier fleet fold:
    the session the harness says opened the pull request is the one judged."""
    opener = session(t3_store, "opener", (101, stamp(2)))
    t3_store.skill_tool(opener, "gate-discipline", stamp(3))
    cell = t3_store.thread("thread:delegated-task:cell", parent=t3_store.thread("foreman"))
    folded(repo, "feat: a hook (#101)", [cell], "hooks.yml", handed=2)
    run(skill_usage_collect())

    found = rule(run(skill_usage_triggers(repo=str(repo))))

    assert judged(found) == (1, 0, 0) and found["misses"] == []


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
    assert found["loaded_by_subagent"] == 1  # a reviewer is a subagent too


def test_a_pull_request_a_subagent_opened_is_its_sessions(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    main = attached(t3_store, "main", 101)  # the session's own thread only attached itself
    t3_store.skill_tool(main, "gate-discipline", stamp(3))
    opener = {"pullRequests": [link(101, stamp(2)), link(101, stamp(1), "agent")]}
    t3_store.thread("thread:subagent:shipper", parent=main, extra=opener)
    run(skill_usage_collect())

    assert store.load_sessions(state)["main"]["pull_requests"] == [
        {"ref": "acme/garden#101", "linked_at": stamp(2), "opened": True}
    ]
    assert judged(rule(run(skill_usage_triggers(repo=str(repo))))) == (1, 0, 0)


def test_a_session_that_only_attached_itself_to_a_pull_request_is_not_judged(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    merge(repo, "feat: a check (#102)", "scripts/check-beds.mjs")
    merge(repo, "feat: another hook (#103)", "hooks.yml")
    # 101: a script or another machine opened it; this session only repaired and merged it
    attached(t3_store, "repairer", 101, 102)
    t3_store.skill_tool("repairer", "gate-discipline", stamp(3))
    session(t3_store, "careless", (102, stamp(2)))  # 102: the repairer's load is not its own
    author = session(t3_store, "author", (103, stamp(2)))
    t3_store.skill_tool(author, "gate-discipline", stamp(3))
    attached(t3_store, "watcher", 103)  # 103: a watcher that loaded nothing takes nothing away
    run(skill_usage_collect())

    found = rule(run(skill_usage_triggers(repo=str(repo))))

    data = run(skill_usage_triggers(repo=str(repo)))
    found = rule(data)

    assert judged(found) == (1, 1, 1)
    assert why(found) == {"opened_elsewhere": 1}
    assert found["misses"] == [{"change": 102, "sessions": ["careless"]}]
    assert data["warnings"] == []  # a link that says it attached itself does say


def test_working_on_the_same_branch_ties_no_session_to_a_change(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    merge(repo, "feat: a check (#102)", "scripts/check-beds.mjs")
    branch = f"lush/{PRIVATE}"  # a branch is often named after its task
    head = {"snapshot": {"headBranch": branch, "title": PRIVATE}}
    # 101: its author never loaded the skill; an earlier session that used the branch's name
    # did, and so did a session that attached itself to the pull request from that branch
    t3_store.thread(
        "author", extra={"branch": branch, "pullRequests": [link(101, stamp(2), **head)]}
    )
    earlier = t3_store.thread("earlier", extra={"branch": branch})
    t3_store.skill_tool(earlier, "gate-discipline", stamp(9))
    helper = {"branch": branch, "pullRequests": [link(101, stamp(2), "agent", **head)]}
    t3_store.skill_tool(t3_store.thread("helper", extra=helper), "gate-discipline", stamp(3))
    # 102: a script opened it from a cell's branch, and the foreman attached itself to it
    t3_store.thread("foreman", extra={"pullRequests": [link(102, stamp(2), "agent", **head)]})
    cell = t3_store.thread(
        "thread:delegated-task:cell", parent="foreman", extra=head | {"branch": branch}
    )
    t3_store.skill_tool(cell, "gate-discipline", stamp(3))
    run(skill_usage_collect())

    found = rule(run(skill_usage_triggers(repo=str(repo))))

    assert judged(found) == (0, 1, 1)
    assert found["misses"] == [{"change": 101, "sessions": ["author"]}]
    assert why(found) == {"opened_elsewhere": 1}
    for name in (store.SESSIONS_FILE, store.EVENTS_FILE, store.STATE_FILE):
        assert PRIVATE not in (state / name).read_text("utf-8")  # no branch is kept


def test_a_load_near_the_opener_is_neither_a_load_nor_a_miss(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    for number in range(101, 106):
        merge(repo, f"feat: a hook (#{number})", "hooks.yml")
    # 101: the opener sent the work to a task, and the task had loaded the skill
    owner = session(t3_store, "owner", (101, stamp(2)))
    task = t3_store.thread("thread:delegated-task:impl", parent=owner)
    deeper = t3_store.thread("thread:delegated-task:deeper", parent=task)
    t3_store.skill_tool(deeper, "gate-discipline", stamp(3))
    # 102: a person's fork of a fork opened it; a task of the thread it first came from
    # had loaded the skill
    origin = t3_store.thread("origin")
    helper = t3_store.thread("thread:delegated-task:helper", parent=origin)
    t3_store.skill_tool(helper, "gate-discipline", stamp(3))
    t3_store.thread("fork-1", parent=origin, relationship="fork")
    fork = {"pullRequests": [link(102, stamp(2))]}
    t3_store.thread("fork", parent="fork-1", relationship="fork", extra=fork)
    # 103 and 104: two cells of one foreman. Neither a sibling's load nor the foreman's is a
    # cell's own, and a task does not carry its delegator's conversation
    foreman = t3_store.thread("foreman")
    t3_store.skill_tool(foreman, "gate-discipline", stamp(3))
    session(t3_store, "thread:delegated-task:cell-a", (103, stamp(2)), parent=foreman)
    cell_b = session(t3_store, "thread:delegated-task:cell-b", (104, stamp(2)), parent=foreman)
    t3_store.skill_tool(cell_b, "gate-discipline", stamp(3))
    # 105: the task loaded it only after the change had merged
    late = session(t3_store, "late", (105, stamp(2)))
    slow = t3_store.thread("thread:delegated-task:slow", parent=late)
    run(skill_usage_collect())
    t3_store.skill_tool(slow, "gate-discipline", stamp(-1))  # tomorrow
    run(skill_usage_collect())

    found = rule(run(skill_usage_triggers(repo=str(repo))))

    assert judged(found) == (1, 2, 2)
    assert why(found) == {"possibly_loaded": 2}
    assert [miss["change"] for miss in found["misses"]] == [103, 105]
    assert store.load_sessions(state)["fork"]["parent"] == "fork-1"
    assert store.load_sessions(state)["thread:delegated-task:deeper"]["parent"] == task


def test_several_openers_of_one_pull_request_are_judged_together(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    merge(repo, "feat: a check (#102)", "scripts/check-beds.mjs")
    merge(repo, "feat: another hook (#103)", "hooks.yml")
    careful = session(t3_store, "careful", (101, stamp(2)), (102, stamp(2)))
    t3_store.skill_tool(careful, "gate-discipline", stamp(3))  # by the opening of 101
    session(t3_store, "careless", (101, stamp(2)), (103, stamp(2)))  # never
    t3_store.skill_tool(session(t3_store, "late", (103, stamp(2))), "gate-discipline", stamp(1))
    t3_store.skill_tool(session(t3_store, "later", (102, stamp(2))), "gate-discipline", stamp(1))
    run(skill_usage_collect())

    found = rule(run(skill_usage_triggers(repo=str(repo))))

    # one that had loaded it answers; where none had, one unknown keeps it from being a miss
    assert judged(found) == (2, 0, 1) and why(found) == {"after_opening": 1}


def test_a_load_after_the_change_merged_is_no_load(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml", days_ago=3)
    merge(repo, "feat: a check (#102)", "scripts/check-beds.mjs", days_ago=3)
    late = session(t3_store, "late", (101, stamp(4)))
    t3_store.skill_tool(late, "gate-discipline", stamp(2))  # a day after it merged
    # two clocks: a load a few minutes after the merge may have come before it
    close = session(t3_store, "close", (102, stamp(4)))
    t3_store.skill_tool(close, "gate-discipline", stamp(3, minutes=3))
    run(skill_usage_collect())

    found = rule(run(skill_usage_triggers(repo=str(repo))))

    assert judged(found) == (0, 1, 1) and why(found) == {"after_opening": 1}
    assert found["misses"] == [{"change": 101, "sessions": ["late"]}]


def test_a_change_merged_since_the_last_collection_is_not_yet_a_miss(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml", days_ago=3)
    session(t3_store, "main", (101, stamp(4)), (102, stamp(1)))
    t3_store.skill_tool("main", "plant-beds", stamp(4))
    run(skill_usage_collect())
    merge(repo, "feat: a check (#102)", "scripts/check-beds.mjs", days_ago=-1)  # after it

    found = rule(run(skill_usage_triggers(repo=str(repo))))

    # what the session loaded between the collection and the merge is not in the record
    assert judged(found) == (0, 1, 1) and why(found) == {"incomplete_record": 1}
    assert found["misses"] == [{"change": 101, "sessions": ["main"]}]


def test_this_machine_is_never_away(
    state: Path, t3_store: T3Store, repo: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    session(t3_store, "main", (101, stamp(1)))
    t3_store.skill_tool("main", "plant-beds", stamp(4))
    run(skill_usage_collect())
    merge(repo, "feat: a hook (#101)", "hooks.yml", days_ago=-1)  # after it collected
    monkeypatch.setenv(store.AWAY_ENV, "bench")  # its own name

    data = run(skill_usage_triggers(repo=str(repo)))

    assert why(rule(data)) == {"incomplete_record": 1}  # it can collect: it is waited for
    assert any("bench had not" in warning for warning in data["warnings"])


def test_an_opening_the_record_puts_after_the_merge_is_not_judged(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml", days_ago=3)
    merge(repo, "feat: a check (#102)", "scripts/check-beds.mjs", days_ago=3)
    merge(repo, "feat: another hook (#103)", "hooks.yml", days_ago=3)
    closing = session(t3_store, "closing", (101, stamp(1)))  # linked when wrapping up
    t3_store.skill_tool(closing, "gate-discipline", stamp(4))  # yet loaded before the merge
    session(t3_store, "idle", (102, stamp(1)))  # linked as late, and never loaded
    session(t3_store, "undated", (103, "no time at all"))
    run(skill_usage_collect())

    found = rule(run(skill_usage_triggers(repo=str(repo))))

    assert judged(found) == (0, 0, 3)  # neither a load nor a miss can be placed
    assert why(found) == {"no_link_time": 3}


def test_a_session_filed_under_another_project_answers_with_its_loads(
    state: Path, t3_store: T3Store, repo: Path, tmp_path: Path
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    merge(repo, "feat: a check (#102)", "scripts/check-beds.mjs")
    t3_store.project("p2", checkout_at(tmp_path / "orchard"))  # where the sessions started
    visitor = t3_store.thread(
        "visitor", project_id="p2", extra={"pullRequests": [link(101, stamp(2))]}
    )
    t3_store.skill_tool(visitor, "gate-discipline", stamp(3))
    cased = {"pullRequests": [link(102, stamp(2), repository="Acme/Garden")]}
    t3_store.thread("stranger", project_id="p2", extra=cased)  # the name in another case
    run(skill_usage_collect())

    found = rule(run(skill_usage_triggers(repo=str(repo))))

    assert judged(found) == (1, 1, 0)
    assert found["misses"] == [{"change": 102, "sessions": ["stranger"]}]


def test_links_that_do_not_say_who_opened_them_judge_nothing(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    merge(repo, "feat: a check (#102)", "scripts/check-beds.mjs")
    t3_store.skill_tool(t3_store.thread("loaded"), "gate-discipline", stamp(2))
    t3_store.thread("never", extra={"pullRequests": [link(102, stamp(2), source=None)]})
    run(skill_usage_collect())
    sessions = store.load_sessions(state)  # as an earlier botcore wrote its links
    sessions["loaded"]["pull_requests"] = ["acme/garden#101"]
    store.save_sessions(state, sessions)

    data = run(skill_usage_triggers(repo=str(repo)))

    assert judged(rule(data)) == (0, 0, 2)
    assert why(rule(data)) == {"opened_elsewhere": 2}
    assert "2 links" in data["warnings"][0] and "skill-usage-collect" in data["warnings"][0]


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


def test_a_merge_commit_names_its_pull_request_too(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    merge(repo, "Merge pull request #101 from acme/a-hook", "hooks.yml")
    merge(repo, "fix: see #7 for the reason", "hooks.yml")  # a mention is not its number
    session(t3_store, "main", (101, stamp(2)), (7, stamp(2)))
    t3_store.skill_tool("main", "gate-discipline", stamp(3))
    run(skill_usage_collect())

    found = rule(run(skill_usage_triggers(repo=str(repo))))

    assert judged(found) == (1, 0, 1) and why(found) == {"no_pull_request": 1}


def test_a_merge_commit_is_one_change_and_the_fetched_branch_is_the_one_read(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    session(t3_store, "main", (101, stamp(2)), (55, stamp(2)))
    t3_store.skill_tool("main", "plant-beds", stamp(3))
    git(repo, "switch", "-q", "-c", "topic")
    merge(repo, "wip: a hook, as its branch named it (#55)", "hooks.yml")
    git(repo, "switch", "-q", "main")
    git(repo, "merge", "-q", "--no-ff", "-m", "Merge pull request #101 from acme/topic", "topic")
    git(repo, "update-ref", "refs/remotes/origin/main", "HEAD")
    git(repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main")
    git(repo, "reset", "-q", "--hard", "HEAD~1")  # a local main that was not pulled
    run(skill_usage_collect())

    data = run(skill_usage_triggers(repo=str(repo)))

    assert data["merged"]["branch"] == "origin/main"
    assert rule(data)["misses"] == [{"change": 101, "sessions": ["main"]}]  # and not #55 too
    assert rule(data)["changes"] == 1


def test_a_number_that_is_not_one_changes_own_judges_nothing(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    merge(repo, "feat: a hook (#101)", "notes.txt", days_ago=45)  # before the window
    merge(repo, "chore: tidy the hooks after (#101)", "hooks.yml")  # pushed later, naming it
    merge(repo, f"feat: a number no forge writes (#{'9' * 5000})", "hooks.yml")
    session(t3_store, "main", (101, stamp(2)))
    t3_store.skill_tool("main", "plant-beds", stamp(3))
    run(skill_usage_collect())
    sessions = store.load_sessions(state)
    sessions["main"]["pull_requests"] += [
        {"ref": "acme/garden#²", "opened": True},  # a digit, and not a number
        {"ref": f"acme/garden#{'9' * 5000}", "opened": True},
    ]
    store.save_sessions(state, sessions)

    found = rule(run(skill_usage_triggers(repo=str(repo))))

    assert judged(found) == (0, 0, 2) and why(found) == {"no_pull_request": 2}


def test_a_path_is_matched_by_case_on_every_system(
    state: Path, t3_store: T3Store, repo: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    merge(repo, "feat: not the hook file (#101)", "HOOKS.YML")
    t3_store.skill_tool(t3_store.thread("main"), "plant-beds", stamp(1))
    run(skill_usage_collect())

    assert rule(run(skill_usage_triggers(repo=str(repo))))["changes"] == 0
    monkeypatch.setattr(scan, "os", SimpleNamespace(name="nt"))  # where a [disk] glob is not
    assert scan.compile_pattern("hooks.yml").match("HOOKS.YML")
    assert not triggers._matcher("hooks.yml").match("HOOKS.YML")
    assert triggers._matcher("scripts/**/check-*.mjs").match("scripts/a/b/check-x.mjs")


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

    found = rule(run(skill_usage_triggers(repo=str(repo))))

    # an event of a kind a newer botcore wrote may be a load: no miss, and no use either
    assert judged(found) == (0, 0, 1) and why(found) == {"possibly_loaded": 1}
    assert "gate-discipline" not in rows(run(skill_usage_report()))


def test_events_an_older_botcore_recognised_are_warned_of(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    merge(repo, "feat: a hook (#101)", "hooks.yml")
    t3_store.skill_tool(session(t3_store, "main", (101, stamp(1))), "plant-beds", stamp(2))
    run(skill_usage_collect())
    assert run(skill_usage_triggers(repo=str(repo)))["warnings"] == []
    lines = [
        json.loads(line)
        for line in (state / store.EVENTS_FILE).read_text("utf-8").split("\n")
        if line
    ]
    (state / store.EVENTS_FILE).write_text(
        "".join(json.dumps({**line, "v": 0}) + "\n" for line in lines), "utf-8"
    )
    saved = store.load_state(state)
    store.save_state(state, {**saved, "recognizer": 0})

    (warning,) = run(skill_usage_triggers(repo=str(repo)))["warnings"]

    assert "older botcore" in warning and "--rebuild" in warning


def test_nothing_but_a_time_a_number_and_who_opened_it_is_kept_of_a_link(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    links = [
        link(101, f"2026-01-01 and {PRIVATE}"),
        link(102, "2026-11-01T10:00:00Z", "agent"),
        link(103, "0001-01-01T00:00:00+23:59", PRIVATE),  # a time before the calendar starts
        link(104, None, source=None),
        link(True, None),  # not a number
    ]
    t3_store.thread("main", extra={"pullRequests": links, "branch": PRIVATE})
    t3_store.skill_tool("main", "plant-beds", stamp(1))
    run(skill_usage_collect())

    assert PRIVATE not in (state / store.SESSIONS_FILE).read_text("utf-8")
    assert store.load_sessions(state)["main"]["pull_requests"] == [
        {"ref": "acme/garden#101", "linked_at": None, "opened": True},
        {"ref": "acme/garden#102", "linked_at": "2026-11-01T10:00:00.000Z", "opened": False},
        {"ref": "acme/garden#103", "linked_at": None, "opened": False},
        {"ref": "acme/garden#104", "linked_at": None, "opened": None},
    ]
    assert "branch" not in store.load_sessions(state)["main"]


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
    sessions["odder"] = {"pull_requests": [7, None, {"ref": 7}, {"ref": "acme/garden#x"}]}
    store.save_sessions(state, sessions)

    data = run(skill_usage_triggers(repo=str(repo)))

    # collected three days before the change merged: what the session did since is not here
    assert judged(rule(data)) == (0, 0, 1) and why(rule(data)) == {"incomplete_record": 1}
    assert "Last collected" in data["warnings"][0]
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
        "skill = 'x'\npaths = ['./hooks.yml']\n",  # a path as git writes it, or no change matches
        "skill = 'x'\npaths = ['/hooks.yml']\n",
        "skill = 'x'\npaths = ['scripts\\\\check-*.mjs']\n",
        "skill = 'x'\npaths = ['']\n",
    )
    for body in wrong:
        (tmp_path / "botcore.toml").write_text(f"[[skills.required]]\n{body}", "utf-8")
        with pytest.raises(Exception, match="required"):
            load_config(workspace=tmp_path)
