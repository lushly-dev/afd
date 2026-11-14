"""The real world, without reaching GitHub, git remotes or T3 Code.

gh and git are answered by a recording fake ``run``: the tests check the exact argument lists
the plugin would run. The clock, this machine's memory and disk, and its processes are real.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import UTC, datetime

import pytest

from botcore_factory.real_world import (
    CliGit,
    GhGitHub,
    LocalMachine,
    OsProcesses,
    SystemClock,
    T3Plans,
    make_runner,
    real_world,
    resolve_program,
    run_process,
)
from botcore_factory.world import World, WorldError


class FakeRun:
    """Answers argument lists from a table; records every call."""

    def __init__(self, answers=None, fail=None):
        self.answers = answers or {}
        self.fail = fail or {}
        self.calls: list[tuple[list[str], str | None]] = []

    def __call__(self, args, stdin=None):
        self.calls.append((list(args), stdin))
        key = " ".join(args[:3])
        if key in self.fail:
            raise WorldError(self.fail[key])
        return self.answers.get(key, "")


def issue_row(number, labels=(), assignees=()):
    return {
        "number": number,
        "title": f"Issue {number}",
        "state": "OPEN",
        "labels": [{"name": name} for name in labels],
        "assignees": [{"login": login} for login in assignees],
        "createdAt": "2030-01-01T09:00:00Z",
    }


def test_gh_reads_issues_as_argument_lists():
    run = FakeRun({"gh issue list": json.dumps([issue_row(5, ["status:planned"], ["owner"])])})
    issues = GhGitHub(run).list_issues()
    assert issues[0].labels == ("status:planned",) and issues[0].assigned
    assert run.calls == [
        (
            [
                "gh",
                "issue",
                "list",
                "--state",
                "open",
                "--limit",
                "2000",
                "--json",
                "number,title,state,labels,assignees,createdAt",
            ],
            None,
        )
    ]


def test_a_read_at_the_limit_is_refused_as_possibly_cut():
    rows = json.dumps([issue_row(n) for n in range(1, 2001)])
    with pytest.raises(WorldError, match="read limit"):
        GhGitHub(FakeRun({"gh issue list": rows})).list_issues()
    with pytest.raises(WorldError, match="read limit"):
        GhGitHub(
            FakeRun({"gh pr list": json.dumps([{"number": n} for n in range(2000)])})
        ).open_pull_requests()


def test_a_failed_or_garbled_read_raises():
    with pytest.raises(WorldError, match="HTTP 502"):
        GhGitHub(FakeRun(fail={"gh issue list": "HTTP 502"})).list_issues()
    with pytest.raises(WorldError, match="not JSON"):
        GhGitHub(FakeRun({"gh issue list": "<html>"})).list_issues()


def test_gh_issue_view_comments_and_prs():
    run = FakeRun(
        {
            "gh issue view": json.dumps(
                {
                    **issue_row(7),
                    "comments": [
                        {"id": "IC_1", "body": "hi", "author": {"login": "jason"}, "createdAt": "t"}
                    ],
                }
            ),
            "gh pr list": json.dumps(
                [{"number": 9, "headRefName": "fix/a", "closingIssuesReferences": [{"number": 7}]}]
            ),
            "gh repo view": json.dumps({"nameWithOwner": "lushly-dev/afd"}),
        }
    )
    github = GhGitHub(run)
    assert github.get_issue(7).number == 7
    assert github.comments(7)[0].author == "jason"
    assert github.open_pull_requests()[0].closes == (7,)
    assert github.repository() == "lushly-dev/afd" == github.repository()
    assert [args[:3] for args, _ in run.calls].count(["gh", "repo", "view"]) == 1


def test_gh_writes_labels_comments_and_variables():
    run = FakeRun({"gh issue comment": "https://github.com/o/r/issues/7#issuecomment-123\n"})
    github = GhGitHub(run)
    github.edit_labels(7, add=["status:in-progress"], remove=["status:planned", "status:triage"])
    comment = github.add_comment(7, "body text")
    github.set_variable("FACTORY_LANE_HOST", "workstation")
    assert comment.id == "123"
    assert run.calls == [
        (
            [
                "gh",
                "issue",
                "edit",
                "7",
                "--add-label",
                "status:in-progress",
                "--remove-label",
                "status:planned",
                "--remove-label",
                "status:triage",
            ],
            None,
        ),
        (["gh", "issue", "comment", "7", "--body-file", "-"], "body text"),
        (["gh", "variable", "set", "FACTORY_LANE_HOST", "--body", "workstation"], None),
    ]


def test_an_unset_variable_is_none_but_a_failed_read_raises():
    assert (
        GhGitHub(FakeRun({"gh variable get": "workstation\n"})).get_variable("X") == "workstation"
    )
    unset = FakeRun(fail={"gh variable get": "variable X was not found"})
    assert GhGitHub(unset).get_variable("X") is None
    with pytest.raises(WorldError):
        GhGitHub(FakeRun(fail={"gh variable get": "HTTP 401"})).get_variable("X")


def test_git_reads_host_records_from_origin_refs_and_worktrees():
    record = {"id": "workstation", "cores": 16, "suggestedSlots": 4, "missing": ["x"]}
    run = FakeRun(
        {
            "git for-each-ref --format=%(refname)": "refs/factory/hosts/workstation\n",
            "git show refs/factory/hosts/workstation:host.json": json.dumps(record),
            "git -C wt": "",
        }
    )
    git = CliGit(run)
    [found] = git.host_records()
    assert (found.id, found.cores, found.suggested_slots, found.missing) == (
        "workstation",
        16,
        4,
        ("x",),
    )
    assert run.calls[0][0] == [
        "git",
        "fetch",
        "--quiet",
        "--no-tags",
        "origin",
        "+refs/factory/hosts/*:refs/factory/hosts/*",
    ]
    assert git.is_clean("wt")
    assert CliGit(FakeRun(fail={"git -C wt": "detached"})).branch("wt") is None


def test_the_system_clock_is_utc():
    assert SystemClock().now().tzinfo is not None


def test_this_machine_reports_itself():
    machine = LocalMachine()
    assert machine.id()
    assert machine.cores() >= 1
    assert machine.memory_gb() > 0 and 0 < machine.free_memory_gb() <= machine.memory_gb()
    assert machine.free_disk_gb(".") > 0


def test_processes_are_alive_until_they_exit():
    processes = OsProcesses()
    me = os.getpid()
    assert processes.alive(me)
    assert processes.alive(me, processes.start_time(me))
    child = subprocess.Popen([sys.executable, "-c", "pass"])
    child.wait()
    assert not processes.alive(child.pid)


def test_a_reused_pid_is_not_the_lock_holder():
    processes = OsProcesses()
    me = os.getpid()
    if processes.start_time(me) is None:
        pytest.skip("This platform does not report process start times")
    assert not processes.alive(me, processes.start_time(me) - 3600)


def test_processes_run_argument_lists_without_a_shell(tmp_path):
    done = OsProcesses().run([sys.executable, "-c", "print('ok')"], str(tmp_path))
    assert (done.returncode, done.stdout.strip()) == (0, "ok")
    out = make_runner(str(tmp_path))([sys.executable, "-c", "print('two')"])
    assert out.strip() == "two"
    with pytest.raises(WorldError, match="failed"):
        make_runner(str(tmp_path))([sys.executable, "-c", "import sys; sys.exit('bad')"])


def test_a_missing_program_is_a_world_error():
    with pytest.raises(WorldError, match="not on PATH"):
        resolve_program("botcore-factory-no-such-program")
    with pytest.raises(WorldError):
        run_process(["botcore-factory-no-such-program"])


class FixedClock:
    def now(self):
        return datetime(2030, 1, 4, tzinfo=UTC)


def test_plans_come_from_t3_code_s_weekly_windows(tmp_path):
    week = {"kind": "weekly", "windowDurationMins": 10080}
    (tmp_path / "claudeAgent.json").write_text(
        json.dumps(
            {
                "usageLimits": {
                    "windows": [
                        {
                            **week,
                            "id": "seven_day",
                            "usedPercent": 40,
                            "resetsAt": "2030-01-07T12:00:00Z",
                        },
                        {"id": "five_hour", "kind": "session", "usedPercent": 90, "resetsAt": "x"},
                    ]
                }
            }
        )
    )
    (tmp_path / "codex.json").write_text(json.dumps({"usageLimits": {"windows": []}}))
    (tmp_path / "broken.json").write_text("{")
    [plan] = T3Plans(FixedClock(), tmp_path).read()
    assert (plan.id, plan.provider, plan.used) == ("claudeAgent:seven_day", "claudeAgent", 40)
    assert plan.elapsed == 50.0 and plan.resets_at == "2030-01-07T12:00:00Z"


def test_no_plan_windows_is_unreadable(tmp_path):
    with pytest.raises(WorldError, match="No weekly plan windows"):
        T3Plans(FixedClock(), tmp_path).read()


def test_the_real_world_is_assembled_for_a_target(tmp_path):
    world = real_world(tmp_path, caches=tmp_path)
    assert isinstance(world, World) and isinstance(world.plans, T3Plans)
