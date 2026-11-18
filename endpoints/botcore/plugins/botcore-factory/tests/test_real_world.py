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
from pathlib import Path

import pytest

from botcore_factory.real_system import find_node_bin, node_roots
from botcore_factory.real_world import (
    _PLAIN_DIFF,
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

    def __call__(self, args, stdin=None, check=True):
        self.calls.append((list(args), stdin))
        key = " ".join(args[:3])
        if key in self.fail and check:
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
            "git -C wt": " M src/a.ts\n?? new.ts\nR  old.ts -> moved.ts\n",
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
    assert git.uncommitted("wt") == ["src/a.ts", "new.ts", "moved.ts"]
    assert CliGit(FakeRun(fail={"git -C wt": "detached"})).branch("wt") is None


def test_git_diffs_and_pushes_the_queue_ref_as_argument_lists():
    run = FakeRun({"git -C wt": "lefthook.yml\nsrc/a.ts\n"})
    git = CliGit(run)
    assert git.changed_files("wt", "abc123") == ["lefthook.yml", "src/a.ts"]
    git.changed_files("wt")
    git.push_queue_ref("wt", "fix/a", "abc123")
    assert [args for args, _ in run.calls] == [
        ["git", "-C", "wt", *_PLAIN_DIFF, "--name-only", "abc123...HEAD"],
        ["git", "-C", "wt", *_PLAIN_DIFF, "--name-only", "origin/HEAD...HEAD"],
        [
            "git",
            "-C",
            "wt",
            "push",
            "--force",
            "--quiet",
            "origin",
            "abc123:refs/factory/queue/fix/a",
        ],
    ]


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


def test_gh_signs_in_reads_required_checks_and_drives_a_pr():
    rules = json.dumps(
        [
            {
                "type": "required_status_checks",
                "parameters": {"required_status_checks": [{"context": "ci-ok"}]},
            }
        ]
    )
    run = FakeRun(
        {
            "gh repo view": json.dumps({"nameWithOwner": "o/r"}),
            "gh api repos/o/r/rules/branches/main": rules,
            "gh pr list": "[]",
            "gh pr create": "https://github.com/o/r/pull/612\n",
            "gh pr view": json.dumps({"state": "MERGED"}),
        },
        fail={"gh api repos/o/r/branches/main/protection/required_status_checks": "HTTP 404"},
    )
    github = GhGitHub(run)
    assert github.signed_in() is True
    assert github.required_checks("main") == ["ci-ok"]
    assert github.open_pr("fix/a", "Fix a", "Body") == 612
    github.merge_pr(612, "abc")
    assert github.pr_state(612) == "MERGED"
    calls = [args for args, _ in run.calls]
    assert [
        "gh",
        "pr",
        "list",
        "--head",
        "fix/a",
        "--base",
        "main",
        "--state",
        "open",
        "--json",
        "number,isCrossRepository",
    ] in calls
    assert [
        "gh",
        "pr",
        "create",
        "--head",
        "fix/a",
        "--base",
        "main",
        "--title",
        "Fix a",
        "--body-file",
        "-",
    ] in calls
    assert ["gh", "pr", "merge", "612", "--squash", "--match-head-commit", "abc"] in calls
    assert GhGitHub(FakeRun(fail={"gh auth status": "not logged in"})).signed_in() is False


def check_run(conclusion=None, started="2030-01-01T09:00:00Z", name="ci-ok"):
    status = "completed" if conclusion else "in_progress"
    return {"name": name, "status": status, "conclusion": conclusion, "started_at": started}


CHECK_RUNS = [
    ([check_run()], "pending"),
    ([check_run("success")], "success"),
    ([check_run("failure")], "failure"),
    ([check_run("timed_out")], "failure"),
    ([check_run("cancelled")], "cancelled"),
    ([check_run("failure"), check_run("success", "2030-01-01T10:00:00Z")], "success"),
    ([check_run("success", name="other")], "missing"),
]


@pytest.mark.parametrize(
    "runs,expected", CHECK_RUNS, ids=[f"{c[1]}{i}" for i, c in enumerate(CHECK_RUNS)]
)
def test_a_check_is_read_on_the_head_itself(runs, expected):
    """B1: a check is the head's own, never the PR's latest whatever its head."""
    run = FakeRun(
        {
            "gh repo view": json.dumps({"nameWithOwner": "o/r"}),
            "gh api repos/o/r/commits/abc/check-runs?per_page=100": json.dumps(
                {"check_runs": runs}
            ),
            "gh api repos/o/r/commits/abc/status": json.dumps({"statuses": []}),
        }
    )
    assert GhGitHub(run).check_status(612, "ci-ok", "abc") == expected


def test_a_commit_status_stands_in_for_a_missing_check_run():
    run = FakeRun(
        {
            "gh repo view": json.dumps({"nameWithOwner": "o/r"}),
            "gh api repos/o/r/commits/abc/check-runs?per_page=100": json.dumps({"check_runs": []}),
            "gh api repos/o/r/commits/abc/status": json.dumps(
                {"statuses": [{"context": "ci-ok", "state": "pending"}]}
            ),
        }
    )
    assert GhGitHub(run).check_status(612, "ci-ok", "abc") == "pending"


def test_an_open_pr_for_the_branch_is_reused_but_never_a_fork_s():
    run = FakeRun({"gh pr list": json.dumps([{"number": 77, "isCrossRepository": False}])})
    assert GhGitHub(run).open_pr("fix/a", "t", "b") == 77
    assert all(args[:3] != ["gh", "pr", "create"] for args, _ in run.calls)
    fork = FakeRun(
        {
            "gh pr list": json.dumps([{"number": 78, "isCrossRepository": True}]),
            "gh pr create": "https://github.com/o/r/pull/79\n",
        }
    )
    assert GhGitHub(fork).open_pr("fix/a", "t", "b") == 79


def test_a_nondefault_base_is_bound_to_pr_lookup_and_creation():
    run = FakeRun({"gh pr list": "[]", "gh pr create": "https://github.com/o/r/pull/80\n"})
    assert GhGitHub(run).open_pr("fix/a", "t", "b", "develop") == 80
    for args, _ in run.calls:
        assert args[args.index("--base") + 1] == "develop"


def test_queue_ref_retirement_is_idempotent_and_bound_to_the_enqueued_head():
    ref = "refs/factory/queue/fix/a"
    run = FakeRun({"git ls-remote origin": f"abc\t{ref}\n"})
    CliGit(run).delete_queue_ref("fix/a", "abc")
    assert run.calls[-1][0] == [
        "git",
        "push",
        "--quiet",
        f"--force-with-lease={ref}:abc",
        "origin",
        f":{ref}",
    ]
    absent = FakeRun()
    CliGit(absent).delete_queue_ref("fix/a", "abc")
    assert len(absent.calls) == 1


def test_the_validated_head_is_pushed_from_its_checkout_by_commit_with_a_lease():
    """B1 and S1: the head pushed is the validated commit, over the lane's own last push."""
    run = FakeRun({"git -C slot-a": "merge1\n", "git -C slot-b": "merge2\n"})
    git = CliGit(run)
    git.push_head("slot-a", "fix/a", "merge1", "merge0")
    git.push_head("slot-b", "fix/b", "merge2", None)
    assert [args for args, _ in run.calls] == [
        [
            "git",
            "-C",
            "slot-a",
            "rev-parse",
            "HEAD",
        ],
        [
            "git",
            "-C",
            "slot-a",
            "push",
            "--quiet",
            "--porcelain",
            "--force-with-lease=refs/heads/fix/a:merge0",
            "origin",
            "merge1:refs/heads/fix/a",
        ],
        ["git", "-C", "slot-b", "rev-parse", "HEAD"],
        [
            "git",
            "-C",
            "slot-b",
            "push",
            "--quiet",
            "--porcelain",
            "origin",
            "merge2:refs/heads/fix/b",
        ],
    ]


def test_a_reused_checkout_is_refused_before_pushing():
    run = FakeRun({"git -C slot-a": "another-head\n"})
    with pytest.raises(WorldError, match="no longer holds"):
        CliGit(run).push_head("slot-a", "fix/a", "validated-head", None)
    assert not any("push" in args for args, _ in run.calls)


@pytest.mark.parametrize(
    "stderr,stdout",
    [
        (
            "error: failed to push some refs to 'https://github.com/o/r.git'\n"
            "hint: Updates were rejected because the tip of your current branch is behind\n",
            "",
        ),
        (
            "error: failed to push some refs to 'https://github.com/o/r.git'\n",
            "To https://github.com/o/r.git\n"
            "!\tabc:refs/heads/fix/a\t[rejected] (stale info)\nDone\n",
        ),
    ],
)
def test_git_failures_keep_rejection_diagnostics_from_both_streams(tmp_path, stderr, stdout):
    from botcore_factory.lane_base import NON_FAST_FORWARD

    code = f"import sys; sys.stderr.write({stderr!r}); sys.stdout.write({stdout!r}); sys.exit(1)"
    with pytest.raises(WorldError) as caught:
        make_runner(str(tmp_path))([sys.executable, "-c", code])
    assert NON_FAST_FORWARD.search(str(caught.value))
    assert str(caught.value).endswith((stderr.strip() + "\n" + stdout.strip()).strip())


def test_runner_failure_diagnostics_are_bounded_and_keep_the_tail(tmp_path):
    code = (
        "import sys; sys.stderr.write('noise' * 10000 + '\\n[rejected] (stale info)'); sys.exit(1)"
    )
    with pytest.raises(WorldError) as caught:
        make_runner(str(tmp_path))([sys.executable, "-c", code])
    assert str(caught.value).endswith("[rejected] (stale info)")
    assert len(str(caught.value)) < 12000


def test_the_base_is_fetched_by_the_adapter_s_branch_name():
    run = FakeRun({"git rev-parse refs/remotes/origin/develop": "base1\n"})
    assert CliGit(run).fetch_base("develop") == "base1"
    assert run.calls[0][0] == [
        "git",
        "fetch",
        "--quiet",
        "--no-tags",
        "origin",
        "+refs/heads/develop:refs/remotes/origin/develop",
    ]


def test_a_merge_that_did_not_happen_is_an_error_not_a_clean_merge():
    """S6: no conflict is not a merge; the base must be in the head's history."""

    class Unmerged(FakeRun):
        def __call__(self, args, stdin=None, check=True):
            self.calls.append((list(args), stdin))
            if "merge-base" in args:
                raise WorldError("exit 1")
            return "head1\n" if "rev-parse" in args else ""  # No unmerged paths.

    with pytest.raises(WorldError, match="did not happen"):
        CliGit(Unmerged()).merge_main("slot", "main1")

    merged = FakeRun()
    assert CliGit(merged).merge_main("slot", "main1").clean is True
    assert ["git", "-C", "slot", "merge-base", "--is-ancestor", "main1", "HEAD"] in [
        args for args, _ in merged.calls
    ]


def test_git_lists_queue_refs_and_publishes_a_host_record_without_the_checkout():
    run = FakeRun(
        {
            "git ls-remote origin": (
                "abc\trefs/factory/queue/fix/a\ndef\trefs/factory/queue/fix/b\n"
            ),
            "git hash-object -w": "blob1\n",
            "git mktree": "tree1\n",
            "git -c user.name=botcore-factory": "commit1\n",
        }
    )
    git = CliGit(run)
    assert git.queue_refs() == [
        {"branch": "fix/a", "head": "abc"},
        {"branch": "fix/b", "head": "def"},
    ]
    from botcore_factory.world import HostRecord

    git.publish_host_record(HostRecord(id="workstation", cores=16))
    calls = run.calls
    assert json.loads(calls[1][1])["id"] == "workstation"
    assert calls[2][1] == "100644 blob blob1\thost.json\n"
    assert calls[-1][0] == [
        "git",
        "push",
        "--force",
        "--quiet",
        "origin",
        "commit1:refs/factory/hosts/workstation",
    ]


def test_git_slots_sit_beside_a_bare_repository_and_never_under_git(tmp_path):
    bare = tmp_path / "afd.git"
    run = FakeRun({"git rev-parse --path-format=absolute": str(bare) + "\n"})
    assert CliGit(run, str(bare))._slot_path("2") == str(tmp_path / "afd.git.factory-slots" / "2")
    submodule = tmp_path / "super" / ".git" / "modules" / "afd"
    run = FakeRun({"git rev-parse --path-format=absolute": str(submodule) + "\n"})
    with pytest.raises(WorldError, match="submodule"):
        CliGit(run, str(tmp_path))._slot_path("1")


def test_git_prepares_a_slot_merges_main_and_reports_a_conflict(tmp_path):
    run = FakeRun(
        {
            "git rev-parse --path-format=absolute": str(tmp_path / ".git") + "\n",
            "git -C " + str(tmp_path.with_name(f"{tmp_path.name}.factory-slots") / "1"): "",
        }
    )
    git = CliGit(run, str(tmp_path))
    path = git.prepare_slot("1", "fix/a", "abc")
    # Beside the checkout, never under .git, where TypeScript refuses some declarations.
    assert path == str(tmp_path.with_name(f"{tmp_path.name}.factory-slots") / "1")
    assert ".git" not in Path(path).parts
    calls = [args for args, _ in run.calls]
    assert [
        "git",
        "fetch",
        "--quiet",
        "origin",
        "+refs/factory/queue/fix/a:refs/factory/queue/fix/a",
    ] in calls
    assert ["git", "worktree", "add", "--force", "--detach", path, "abc"] in calls

    class Conflicted(FakeRun):
        def __call__(self, args, stdin=None, check=True):
            self.calls.append((list(args), stdin))
            if args[3:5] == ["diff", "--name-only"]:
                return "src/a.ts\n"
            return ""

    conflicted = Conflicted()
    outcome = CliGit(conflicted).merge_main("slot", "main1")
    assert (outcome.clean, outcome.conflicts) == (False, ("src/a.ts",))
    assert ["git", "-C", "slot", "merge", "--abort"] in [args for args, _ in conflicted.calls]


def wait_for(predicate, seconds=30):
    import time

    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(0.05)
    return predicate()


def python(code):
    return [sys.executable, "-c", code]


def test_a_job_runs_its_steps_in_order_and_names_the_one_that_failed(tmp_path):
    processes = OsProcesses()
    steps = [
        {"label": "install", "args": python("print('installed')")},
        {"label": "validate", "args": python("import sys; print('FAIL x'); sys.exit(3)")},
    ]
    handle = processes.start_job(steps, str(tmp_path), str(tmp_path / "j.log"), label="validate")
    done = wait_for(lambda: processes.poll(handle))
    assert (done.returncode, done.step) == (3, "validate")
    assert "installed" in done.stdout and "FAIL x" in done.stdout
    with pytest.raises(WorldError):
        processes.poll(handle)  # Done and collected: a later poll has no such job.
    passed = processes.start_job(steps[:1], str(tmp_path), str(tmp_path / "p.log"), label="v")
    done = wait_for(lambda: processes.poll(passed))
    assert (done.returncode, done.step) == (0, None)


def test_an_install_that_hangs_times_out_as_the_job_s_failure(tmp_path):
    """S4: install never blocks the lane: it runs in the job, bounded by its timeout."""
    processes = OsProcesses()
    steps = [
        {"label": "install", "args": python("import time; time.sleep(60)"), "timeout": 1},
        {"label": "validate", "args": python("print('never')")},
    ]
    handle = processes.start_job(steps, str(tmp_path), str(tmp_path / "t.log"), label="validate")
    done = wait_for(lambda: processes.poll(handle))
    assert (done.returncode, done.step) == (124, "install")
    assert '"timedOut": true' in done.stdout and "never" not in done.stdout


def test_a_killed_job_is_gone(tmp_path):
    processes = OsProcesses()
    steps = [{"label": "validate", "args": python("import time; time.sleep(60)")}]
    handle = processes.start_job(steps, str(tmp_path), str(tmp_path / "k.log"), label="validate")
    pid = int(handle.split("@")[0])
    processes.kill(handle)
    assert wait_for(lambda: not processes.alive(pid), 10)
    with pytest.raises(WorldError):
        processes.poll(handle)


@pytest.mark.parametrize("timeout", [False, True], ids=["cancel", "timeout"])
def test_stopping_a_job_kills_steps_and_descendants_in_their_own_sessions(tmp_path, timeout):
    processes = OsProcesses()
    pids = tmp_path / "step-pids.json"
    code = "\n".join(
        [
            "import json, os, subprocess, sys, time",
            "child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'], "
            "start_new_session=True)",
            f"open({str(pids)!r}, 'w').write(json.dumps([os.getpid(), child.pid]))",
            "time.sleep(60)",
        ]
    )
    steps = [{"label": "install", "args": python(code), "timeout": 2 if timeout else 60}]
    handle = processes.start_job(steps, str(tmp_path), str(tmp_path / "tree.log"), label="v")
    assert wait_for(lambda: pids.exists() and pids.read_text())
    descendants = json.loads(pids.read_text())
    assert all(processes.alive(pid) for pid in descendants)
    if timeout:
        done = wait_for(lambda: processes.poll(handle))
        assert (done.returncode, done.step) == (124, "install")
    else:
        processes.kill(handle)
    assert wait_for(lambda: all(not processes.alive(pid) for pid in descendants), 10)


def test_terminate_kills_only_a_verified_process_and_its_whole_tree(tmp_path):
    """B3 and S10: the start time must match, and what the lane started dies with it."""
    processes = OsProcesses()
    assert processes.terminate(os.getpid(), None) is False  # Unverifiable: left alone.
    assert processes.terminate(os.getpid(), 0.0) is False  # Another process's pid.
    child_file = tmp_path / "child.pid"
    code = "\n".join(
        [
            "import subprocess, sys, time",
            "child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])",
            f"open({str(child_file)!r}, 'w').write(str(child.pid))",
            "time.sleep(60)",
        ]
    )
    parent = processes.start_detached(python(code), str(tmp_path), str(tmp_path / "d.log"))
    assert wait_for(lambda: child_file.exists() and child_file.read_text())
    child = int(child_file.read_text())
    started = processes.start_time(parent)
    assert started is not None and processes.alive(parent, started)
    assert processes.terminate(parent, started) is True
    assert wait_for(lambda: not processes.alive(parent), 10)
    assert wait_for(lambda: not processes.alive(child), 10)


def test_a_mac_start_time_comes_from_ps(monkeypatch):
    """B3: on macOS a reused pid is told apart by its start time too."""
    import time

    from botcore_factory import real_system
    from botcore_factory.world import Completed

    asked = []

    def ps(args, **_):
        asked.append(list(args))
        return Completed(tuple(args), 0, "Fri Nov 13 09:30:05 2026\n", "")

    monkeypatch.setattr(real_system, "run_process", ps)
    monkeypatch.setattr(real_system.sys, "platform", "darwin")
    expected = time.mktime(time.strptime("Fri Nov 13 09:30:05 2026", "%a %b %d %H:%M:%S %Y"))
    assert OsProcesses().start_time(4242) == expected
    assert asked == [["ps", "-o", "lstart=", "-p", "4242"]]


def test_this_machine_s_programs_symlinks_and_versions():
    machine = LocalMachine()
    assert machine.has_program(sys.executable) is True
    assert machine.has_program("botcore-factory-no-such-program") is False
    assert isinstance(machine.symlinks(), bool)
    assert machine.tool_version(sys.executable).count(".") == 2
    assert machine.tool_version("botcore-factory-no-such-program") is None


def suite_run(conclusion, name, suite, started="2030-01-01T09:00:00Z"):
    return {**check_run(conclusion, started, name), "check_suite": {"id": suite}}


def test_main_s_checks_on_a_merge_commit_are_read_by_name():
    runs = [
        suite_run("failure", "CI", 1),
        suite_run("success", "CI", 1, "2030-01-01T10:00:00Z"),  # A re-run: the latest wins.
        suite_run(None, "Botcore", 2),
        suite_run("skipped", "deploy", 3),
        suite_run("timed_out", "Specimen", 4),
        # One name in two workflows: a later success elsewhere never hides a failure.
        suite_run("failure", "Affected units", 5),
        suite_run("success", "Affected units", 6, "2030-01-01T11:00:00Z"),
    ]
    workflows = [
        {"name": "CI", "status": "completed", "conclusion": "success"},
        {"name": "Loam", "status": "queued", "conclusion": None},
    ]
    run = FakeRun(
        {
            "gh repo view": json.dumps({"nameWithOwner": "o/r"}),
            "gh api repos/o/r/commits/m1/check-runs?per_page=100&page=1": json.dumps(
                {"total_count": len(runs), "check_runs": runs}
            ),
            "gh api repos/o/r/commits/m1/status": json.dumps(
                {"statuses": [{"context": "legacy", "state": "error"}]}
            ),
            "gh api repos/o/r/actions/runs?head_sha=m1&per_page=100&page=1": json.dumps(
                {"total_count": 2, "workflow_runs": workflows}
            ),
            "gh pr view": json.dumps({"mergeCommit": {"oid": "m1"}}),
        }
    )
    github = GhGitHub(run)
    assert github.merge_commit(612) == "m1"
    assert github.commit_checks("m1") == {
        "CI": "success",
        "Botcore": "pending",
        "deploy": "skipped",
        "Specimen": "failure",
        "Affected units": "failure",
        "legacy": "failure",
        "workflow: CI": "success",
        "workflow: Loam": "pending",
    }


def test_main_s_checks_are_read_across_pages_and_a_short_read_raises():
    page = [suite_run("success", f"job {n}", n) for n in range(100)]
    answers = {
        "gh repo view": json.dumps({"nameWithOwner": "o/r"}),
        "gh api repos/o/r/commits/m1/check-runs?per_page=100&page=1": json.dumps(
            {"total_count": 101, "check_runs": page}
        ),
        "gh api repos/o/r/commits/m1/check-runs?per_page=100&page=2": json.dumps(
            {"total_count": 101, "check_runs": [suite_run("failure", "last", 200)]}
        ),
        "gh api repos/o/r/commits/m1/status": json.dumps({"statuses": []}),
        "gh api repos/o/r/actions/runs?head_sha=m1&per_page=100&page=1": json.dumps(
            {"total_count": 0, "workflow_runs": []}
        ),
    }
    assert GhGitHub(FakeRun(answers)).commit_checks("m1")["last"] == "failure"
    answers["gh api repos/o/r/commits/m1/check-runs?per_page=100&page=2"] = json.dumps(
        {"total_count": 101, "check_runs": []}
    )
    with pytest.raises(WorldError, match="more check_runs"):
        GhGitHub(FakeRun(answers)).commit_checks("m1")


# #1341: the Node .nvmrc names, found where fnm and nvm install it, goes first on a job's PATH.


def _install_node(root: Path, name: str, layout: str) -> Path:
    bin_dir = root / name / layout
    bin_dir.mkdir(parents=True)
    (bin_dir / ("node.exe" if sys.platform == "win32" else "node")).write_text("")
    return bin_dir


def test_the_newest_installed_node_matching_the_nvmrc_is_found(tmp_path):
    fnm, nvm = tmp_path / "fnm", tmp_path / "nvm"
    _install_node(fnm, "v24.21.0", "installation/bin")
    old = _install_node(fnm, "v26.1.0", "installation/bin")
    new = _install_node(nvm, "v26.13.0", "bin")
    _install_node(fnm, "v260.0.0", "installation/bin")
    roots = [fnm, nvm, tmp_path / "absent"]
    assert find_node_bin("26", roots) == str(new)
    assert find_node_bin("v26.1", roots) == str(old)
    assert find_node_bin(" v26.1.0\n", roots) == str(old)
    assert find_node_bin("22", roots) is None
    assert find_node_bin("lts/*", roots) is None
    twin = _install_node(tmp_path / "later", "v26.13.0", "bin")
    assert find_node_bin("26", [nvm, tmp_path / "later"]) == str(new)  # A tie: the earlier root.
    assert find_node_bin("26", [tmp_path / "later", nvm]) == str(twin)


def test_node_roots_cover_fnm_and_nvm(tmp_path):
    roots = node_roots({"FNM_DIR": "/f", "NVM_DIR": "/n"}, tmp_path)
    assert roots[0] == Path("/f/node-versions")
    assert Path("/n/versions/node") in roots
    assert tmp_path / ".local/share/fnm/node-versions" in roots
    assert tmp_path / ".nvm/versions/node" in roots


def test_a_job_step_runs_with_its_path_first(tmp_path):
    bin_dir = tmp_path / "node-bin"
    bin_dir.mkdir()
    processes = OsProcesses()
    probe = "import os; print('FIRST=' + os.environ['PATH'].split(os.pathsep)[0])"
    steps = [{"label": "validate", "args": python(probe), "path": [str(bin_dir)]}]
    handle = processes.start_job(steps, str(tmp_path), str(tmp_path / "n.log"), label="validate")
    done = wait_for(lambda: processes.poll(handle))
    assert done.returncode == 0
    assert f"FIRST={bin_dir}" in done.stdout


@pytest.mark.skipif(sys.platform == "win32", reason="a POSIX shell script stands in for node")
def test_a_job_step_s_program_is_found_on_its_own_path(tmp_path):
    bin_dir = tmp_path / "node-bin"
    bin_dir.mkdir()
    program = bin_dir / "botcore-factory-probe-node"
    program.write_text("#!/bin/sh\necho v26.13.0\n")
    program.chmod(0o755)
    processes = OsProcesses()
    steps = [{"label": "validate", "args": [program.name], "path": [str(bin_dir)]}]
    handle = processes.start_job(steps, str(tmp_path), str(tmp_path / "p.log"), label="validate")
    done = wait_for(lambda: processes.poll(handle))
    assert (done.returncode, "v26.13.0" in done.stdout) == (0, True)


# #1352: nvm-windows installs, and the toolchain check run on the .nvmrc Node's PATH.


def test_an_nvm_windows_install_is_found_in_its_version_directory(tmp_path):
    nvm_home = tmp_path / "nvm"
    _install_node(nvm_home, "v24.21.0", "")
    new = _install_node(nvm_home, "v26.13.0", "")  # nvm-windows: node.exe in v<version>/.
    assert find_node_bin("26", [nvm_home]) == str(new)


def test_node_roots_cover_nvm_windows(tmp_path):
    roots = node_roots({"NVM_HOME": "/nvm-home", "APPDATA": "/appdata"}, tmp_path)
    assert Path("/nvm-home") in roots
    assert Path("/appdata/nvm") in roots
    assert Path("/appdata/fnm/node-versions") in roots
    assert roots.index(Path("/nvm-home")) < roots.index(Path("/appdata/nvm"))


def test_node_roots_follow_nvm_windows_s_symlink_to_its_root(tmp_path):
    home = tmp_path / "elsewhere"
    version = _install_node(home, "v26.13.0", "")
    link = tmp_path / "nodejs"
    if sys.platform == "win32":  # A junction, as older nvm-windows makes: no privilege needed.
        import _winapi

        _winapi.CreateJunction(str(version), str(link))
    else:
        link.symlink_to(version, target_is_directory=True)
    roots = node_roots({"NVM_SYMLINK": str(link)}, tmp_path)
    assert home.resolve() in roots
    assert find_node_bin("26", roots) == str(version.resolve())
    assert node_roots({"NVM_SYMLINK": str(home)}, tmp_path) == node_roots({}, tmp_path)


def _tools_beside_node(bin_dir: Path) -> None:
    """A ``pnpm`` shim that runs on the first ``node`` on PATH, as the real one does."""
    bin_dir.mkdir()
    if sys.platform == "win32":
        (bin_dir / "botcore-factory-node.cmd").write_text("@echo v26.13.0\r\n")
        (bin_dir / "botcore-factory-pnpm.cmd").write_text("@call botcore-factory-node\r\n")
        return
    for name, body in (("node", "echo v26.13.0"), ("pnpm", "exec botcore-factory-node")):
        program = bin_dir / f"botcore-factory-{name}"
        program.write_text(f"#!/bin/sh\n{body}\n")
        program.chmod(0o755)


def test_a_tool_s_version_is_read_with_the_node_bin_first_on_path(tmp_path):
    bin_dir = tmp_path / "node-bin"
    _tools_beside_node(bin_dir)
    machine = LocalMachine()
    assert machine.tool_version("botcore-factory-pnpm", [str(bin_dir)]) == "26.13.0"
    assert machine.tool_version("botcore-factory-pnpm") is None  # Not on the host's PATH.
    assert machine.tool_version("botcore-factory-no-such-program", [str(bin_dir)]) is None
