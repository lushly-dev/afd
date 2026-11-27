"""skill-usage-effect: how often merged changes made a mistake a skill names, with and without
the skill loaded, against a store shaped like T3 Code's and a real git history."""

# ruff: noqa: F811 - pytest fixtures imported from the collect, report and triggers tests

from __future__ import annotations

import asyncio
import json
import os
import subprocess
from datetime import timedelta
from pathlib import Path

import pytest
from click.testing import CliRunner

from botcore.cli import cli
from botcore.commands.skill_usage import skill_usage_collect, skill_usage_effect
from tests.test_skill_usage import (  # noqa: F401 - fixtures
    NOW,
    T3Store,
    checkout,
    git,
    run,
    skill_text,
    stamp,
    state,
    t3_store,
)
from tests.test_skill_usage_triggers import folded, session

TRAPS = r"""
[[skills.traps]]
id = "unquarantined-skip"
skill = "gate-discipline"
paths = ["tests/**"]
added_pattern = '\.skip\('
unless_paths = ["policy/quarantine.json"]

[[skills.traps]]
id = "credited-agent"
skill = "gate-discipline"
paths = ["**"]
commit_pattern = '(?im)^co-authored-by:'
"""


@pytest.fixture
def repo(checkout: Path) -> Path:
    """A checkout with an origin, the skill and its traps."""
    folder = checkout / ".claude" / "skills" / "gate-discipline"
    folder.mkdir()
    (folder / "SKILL.md").write_text(skill_text("gate-discipline", "Change a gate.", 90), "utf-8")
    (checkout / "botcore.toml").write_text(TRAPS, "utf-8")
    git(checkout, "init", "-q", "-b", "main")
    git(checkout, "remote", "add", "origin", "git@example.com:acme/garden.git")
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "start")
    return checkout


def change(root: Path, message: str, files: dict[str, str], days_ago: float = 0) -> None:
    """A change merged now, or days ago, adding the given text to each file."""
    for name, text in files.items():
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        before = target.read_text("utf-8") if target.exists() else ""
        target.write_text(before + text + "\n", "utf-8")
    git(root, "add", "-A")
    when = (NOW - timedelta(days=days_ago)).strftime("%Y-%m-%dT%H:%M:%S+00:00")
    subprocess.run(
        ["git", "-C", str(root), "-c", "user.name=T", "-c", "user.email=t@example.com",
         "-c", "commit.gpgsign=false", "commit", "-q", "-F", "-"],
        input=message, text=True, check=True, capture_output=True,
        env={**os.environ, "GIT_AUTHOR_DATE": when, "GIT_COMMITTER_DATE": when},
    )  # fmt: skip


def opened(built: T3Store, name: str, number: int, loaded: bool) -> str:
    """A session that opened a pull request, having loaded the skill before, or never."""
    thread = session(built, name, (number, stamp(2)))
    if loaded:
        built.skill_tool(thread, "gate-discipline", stamp(3))
    return thread


def trap(data: dict, name: str) -> dict:
    return next(row for row in data["traps"] if row["trap"] == name)


def test_each_arm_is_counted_and_compared_once_both_have_enough(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    """Twenty changes from sessions that had loaded the skill, two of which skipped a test;
    twenty from sessions that never had, twelve of which did."""
    for n in range(20):
        text = "it.skip('flaky', () => {})" if n < 2 else "it('works', () => {})"
        change(repo, f"test: loaded {n} (#{100 + n})", {f"tests/a{n}.test.mjs": text})
        opened(t3_store, f"careful-{n}", 100 + n, loaded=True)
    for n in range(20):
        text = "it.skip('flaky', () => {})" if n < 12 else "it('works', () => {})"
        change(repo, f"test: missed {n} (#{200 + n})", {f"tests/b{n}.test.mjs": text})
        opened(t3_store, f"careless-{n}", 200 + n, loaded=False)
    # Registered in the quarantine file: done the right way, and not counted
    change(
        repo,
        "test: quarantined (#300)",
        {"tests/c.test.mjs": "it.skip('known', () => {})", "policy/quarantine.json": "{}"},
    )
    opened(t3_store, "quarantining", 300, loaded=False)
    change(repo, "test: nobody's (#301)", {"tests/d.test.mjs": "it.skip('x', () => {})"})
    run(skill_usage_collect())

    data = run(skill_usage_effect(repo=str(repo)))
    found = trap(data, "unquarantined-skip")

    assert data["project"] == "acme/garden"
    assert (found["skill"], found["changes"], found["exempt"]) == ("gate-discipline", 42, 1)
    assert found["loaded"] == {"changes": 20, "hits": 2, "rate": 0.1}
    assert found["missed"] == {"changes": 20, "hits": 12, "rate": 0.6}
    assert found["unknown"] == {"changes": 1, "hits": 1}
    assert found["unknown_why"]["no_session"] == 1
    assert found["delta"] == 0.5
    assert len(found["examples"]) == 15
    assert [(e["change"], e["arm"]) for e in found["examples"][:3]] == [
        (301, "unknown"), (211, "missed"), (210, "missed"),
    ]  # fmt: skip
    assert found["examples"][-1] == {
        "change": 100,
        "commit": found["examples"][-1]["commit"],
        "arm": "loaded",
        "sessions": ["careful-0"],
    }
    assert found["examples"][1]["sessions"] == ["careless-11"]
    assert found["examples"][0]["sessions"] == []
    assert len(found["examples"][0]["commit"]) == 12
    assert "flaky" not in json.dumps(data)  # no matched line is reported
    assert not [w for w in data["warnings"] if w.startswith("unquarantined-skip")]


def test_what_a_change_added_is_read_whatever_git_is_told_to_do(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    """A file moved or renamed into a trap's paths adds only what the move changed, even where
    git's own settings turn rename detection off; an added line that starts with `++` is still
    an added line; a removed line, or a line added outside the trap's paths, is none; and a
    path is a path, not a pattern."""
    git(repo, "config", "diff.renames", "false")
    git(repo, "config", "diff.mnemonicPrefix", "true")
    change(repo, "chore: elsewhere (#700)", {"src/old.ts": "it.skip('kept', () => {})\none\ntwo"})
    change(repo, "test: kept (#701)", {"tests/kept.test.ts": "it.skip('kept', () => {})"})
    git(repo, "mv", "src/old.ts", "tests/moved.test.ts")
    change(repo, "test: moved in (#702)", {})
    git(repo, "mv", "tests/kept.test.ts", "tests/renamed.test.ts")
    change(repo, "test: renamed (#703)", {})
    change(repo, "test: counts (#704)", {"tests/pp.test.ts": "++i; it.skip('pp', () => {})"})
    change(repo, "test: elsewhere (#705)", {"tests/[id].test.ts": "ok", "src/i.ts": "it.skip(x)"})
    (repo / "tests" / "renamed.test.ts").write_text("", "utf-8")
    change(repo, "test: removed (#706)", {})
    for number in range(700, 707):
        opened(t3_store, f"s{number}", number, loaded=False)
    run(skill_usage_collect())

    found = trap(run(skill_usage_effect(repo=str(repo))), "unquarantined-skip")

    assert sorted(e["change"] for e in found["examples"]) == [701, 704]
    assert found["changes"] == 6  # #700 touches no trap path


def test_a_commit_message_trap_and_a_fleet_cells_change(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    """A trap over the commit message, and a change the lane merged, judged by its fold."""
    change(repo, "feat: credited (#401)\n\nCo-authored-by: Agent <a@example.org>", {"x.txt": "x"})
    opened(t3_store, "crediting", 401, loaded=False)
    foreman = t3_store.thread("foreman")
    cell = t3_store.thread("thread:delegated-task:cell", parent=foreman)
    t3_store.skill_tool(cell, "gate-discipline", stamp(3))
    folded(repo, "feat: by a cell", [cell], "y.txt", handed=2)
    run(skill_usage_collect())

    found = trap(run(skill_usage_effect(repo=str(repo))), "credited-agent")

    assert found["missed"] == {"changes": 1, "hits": 1, "rate": 1.0}
    assert found["loaded"] == {"changes": 1, "hits": 0, "rate": 0.0}
    assert found["delta"] is None  # one change an arm says nothing
    (example,) = found["examples"]
    assert (example["change"], example["arm"], example["sessions"]) == (
        401,
        "missed",
        ["crediting"],
    )


def test_too_few_judged_changes_are_not_compared_and_say_so(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    change(repo, "test: one (#501)", {"tests/e.test.mjs": "it.skip('x', () => {})"})
    opened(t3_store, "one", 501, loaded=True)
    run(skill_usage_collect())

    result = asyncio.run(skill_usage_effect(repo=str(repo)))

    assert result.success and trap(result.data, "unquarantined-skip")["delta"] is None
    assert any("unquarantined-skip" in w and "20 before" in w for w in result.data["warnings"])
    assert "only what reached the default branch" in (result.reasoning or "")


def test_effect_refuses_what_it_cannot_answer(
    state: Path, t3_store: T3Store, repo: Path, tmp_path: Path
) -> None:
    run(skill_usage_collect())
    (repo / "botcore.toml").write_text("", "utf-8")
    none = asyncio.run(skill_usage_effect(repo=str(repo)))
    assert none.error.code == "NO_TRAPS" and "skills.traps" in none.error.suggestion
    (repo / "botcore.toml").write_text(TRAPS.replace(r"'\.skip\('", "'(('"), "utf-8")
    bad = asyncio.run(skill_usage_effect(repo=str(repo)))
    assert bad.error.code == "CONFIG_INVALID" and "regular expression" in bad.error.message
    nothing = TRAPS.replace("added_pattern = '\\.skip\\('\n", "")
    (repo / "botcore.toml").write_text(nothing, "utf-8")
    empty = asyncio.run(skill_usage_effect(repo=str(repo)))
    assert empty.error.code == "CONFIG_INVALID" and "checks nothing" in empty.error.message
    assert asyncio.run(skill_usage_effect(days=0, repo=str(repo))).error.code == "INVALID_INPUT"
    nowhere = asyncio.run(skill_usage_effect(repo=str(tmp_path / "nowhere")))
    assert nowhere.error.code == "NO_WORKSPACE" and "repo" in nowhere.error.suggestion
    twice = TRAPS.replace('id = "credited-agent"', 'id = "unquarantined-skip"')
    (repo / "botcore.toml").write_text(twice, "utf-8")
    again = asyncio.run(skill_usage_effect(repo=str(repo)))
    assert again.error.code == "CONFIG_INVALID" and "given twice" in again.error.message
    outside = TRAPS.replace('"policy/quarantine.json"', '"/etc/quarantine.json"')
    (repo / "botcore.toml").write_text(outside, "utf-8")
    absolute = asyncio.run(skill_usage_effect(repo=str(repo)))
    assert (
        absolute.error.code == "CONFIG_INVALID" and "repository-relative" in absolute.error.message
    )


def test_a_trap_whose_skill_the_project_never_heard_of_is_named(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    (repo / "botcore.toml").write_text(TRAPS.replace('"gate-discipline"', '"gate-disciplin"', 1))
    run(skill_usage_collect())
    data = run(skill_usage_effect(repo=str(repo)))
    assert any("no skill named gate-disciplin" in w for w in data["warnings"])


def test_the_effect_command_runs_from_the_command_line(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    run(skill_usage_collect())
    out = CliRunner().invoke(cli, ["skill-usage-effect", "--repo", str(repo), "--json"])
    assert out.exit_code == 0, out.output
    assert [row["trap"] for row in json.loads(out.output)["data"]["traps"]] == [
        "unquarantined-skip",
        "credited-agent",
    ]


def test_a_change_older_than_the_window_is_not_read(
    state: Path, t3_store: T3Store, repo: Path
) -> None:
    change(repo, "test: old (#600)", {"tests/f.test.mjs": "it.skip('x', () => {})"}, days_ago=3)
    change(repo, "test: recent (#601)", {"tests/g.test.mjs": "it.skip('x', () => {})"})
    run(skill_usage_collect())
    found = trap(run(skill_usage_effect(repo=str(repo), days=1)), "unquarantined-skip")
    assert found["changes"] == 1 and [e["change"] for e in found["examples"]] == [601]
