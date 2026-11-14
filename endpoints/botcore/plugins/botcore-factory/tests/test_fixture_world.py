"""The fixture world: the scenario fixture format, read as GitHub, git, clock, machine, plans
and processes, with every write persisted for the next process."""

from __future__ import annotations

import os

import pytest
from conftest import FIXTURES, fixture

from botcore_factory.claims import current_claim
from botcore_factory.fixture_world import (
    FixtureWorld,
    deep_merge,
    load_fixture,
    normalize_world,
    split_fixture,
)
from botcore_factory.world import (
    Clock,
    Git,
    GitHub,
    Machine,
    Plans,
    Processes,
    WorldError,
)


def test_merging_matches_afd_s_fixture_loader():
    merged = deep_merge(
        {"lane": {"running": False, "runId": None}, "issues": [1, 2], "keep": 1},
        {"lane": {"running": True}, "issues": [3]},
    )
    assert merged == {"lane": {"running": True, "runId": None}, "issues": [3], "keep": 1}


def test_a_fixture_inherits_its_base():
    data = load_fixture(FIXTURES / "backlog.json", "fresh.json")
    assert data["repository"] == "example-org/example-repo"  # From fresh.json.
    assert [issue["number"] for issue in data["issues"]][:2] == [201, 202]  # Replaced.
    assert data["lane"] == {
        "running": True,
        "paused": True,
        "pauseReason": "gh sign-in expired",
        "runId": "run-4",
    }


@pytest.mark.parametrize("name", sorted(p.stem for p in FIXTURES.glob("*.json")))
def test_every_job_fixture_splits_into_world_and_lane_state(name):
    world, state = split_fixture(fixture(name))
    assert world and set(world).isdisjoint(state)


def test_an_unknown_fixture_key_is_refused():
    with pytest.raises(ValueError, match="mystery"):
        split_fixture({"mystery": 1})


def test_claims_become_claim_comments_once():
    world, _ = split_fixture(fixture("backlog"))
    normalized = normalize_world(world)
    assert "claims" not in normalized and normalize_world(normalized) == normalized
    issue = next(i for i in normalized["issues"] if i["number"] == 205)
    assert "fix/client-timeout" in issue["comments"][0]["body"]
    deferred = next(i for i in normalized["issues"] if i["number"] == 204)
    assert [c["author"] for c in deferred["comments"]] == ["factory", "owner"]


@pytest.fixture
def backlog(tmp_path):
    world, _ = split_fixture(fixture("backlog"))
    return FixtureWorld.create(tmp_path / "world.json", world)


def test_the_world_satisfies_every_protocol(backlog):
    world = backlog.world()
    for part, protocol in (
        (world.github, GitHub),
        (world.git, Git),
        (world.clock, Clock),
        (world.machine, Machine),
        (world.plans, Plans),
        (world.processes, Processes),
    ):
        assert isinstance(part, protocol)


def test_github_reads_issues_comments_prs_and_variables(backlog):
    github = backlog.world().github
    assert github.repository() == "example-org/example-repo"
    assert [issue.number for issue in github.list_issues()] == list(range(201, 209))
    assert github.get_issue(204).assignees == ("owner",)
    assert current_claim(github.comments(208)).branch == "fix/cli-help"
    assert github.open_pull_requests() == []
    assert github.get_variable("FACTORY_LANE_HOST") == "workstation"
    with pytest.raises(WorldError):
        github.get_issue(999)


def test_writes_persist_for_the_next_process(backlog):
    github = backlog.world().github
    github.edit_labels(206, add=["status:in-progress"], remove=["status:planned"])
    github.add_comment(206, "claimed")
    github.set_variable("FACTORY_LANE_HOST", "mini")
    github.set_variable("OTHER", "x")
    reread = FixtureWorld(backlog.path).world().github
    assert reread.get_issue(206).labels == (
        "execution:bounded",
        "priority:1",
        "area:server",
        "status:in-progress",
    )
    assert reread.comments(206)[-1].body == "claimed"
    assert reread.comments(206)[-1].created_at == "2030-01-03T00:00:00Z"
    assert reread.get_variable("FACTORY_LANE_HOST") == "mini"
    assert reread.get_variable("OTHER") == "x"


def test_open_prs_come_from_issues_and_listed_prs(tmp_path):
    world = FixtureWorld.create(
        tmp_path / "w.json",
        {
            "issues": [
                {"number": 1, "openPrs": [900]},
                {"number": 2, "openPrs": [{"number": 901}]},
            ],
            "pullRequests": [{"number": 900, "branch": "fix/a", "closes": [3]}],
        },
    ).world()
    prs = {pr.number: pr for pr in world.github.open_pull_requests()}
    assert prs[900].closes == (1, 3) and prs[900].branch == "fix/a"
    assert prs[901].closes == (2,)


def test_clock_machine_plans_and_git(backlog, tmp_path):
    world = backlog.world()
    assert world.clock.now().isoformat() == "2030-01-03T00:00:00+00:00"
    assert world.machine.id() == "workstation"
    assert (world.machine.cores(), world.machine.memory_gb()) == (16, 64)
    assert world.machine.free_memory_gb() == 40
    assert world.machine.free_disk_gb(".") == 2800
    assert [plan.id for plan in world.plans.read()] == ["plan-a", "plan-b"]
    assert world.plans.read()[0].room == 70
    records = {record.id: record for record in world.git.host_records()}
    assert records["workstation"].suggested_slots == 4
    assert records["laptop"].missing == ("gh sign-in",)
    bare = FixtureWorld.create(tmp_path / "bare.json", {"plansUnreadable": True}).world()
    with pytest.raises(WorldError):
        bare.plans.read()
    with pytest.raises(WorldError, match="freeMemoryGb"):
        bare.machine.free_memory_gb()
    assert bare.clock.now().isoformat() == "2030-01-01T00:00:00+00:00"


def test_worktrees_and_processes(tmp_path):
    world = FixtureWorld.create(
        tmp_path / "w.json",
        {
            "worktrees": {
                "wt/a": {"head": "abc", "branch": "fix/a", "clean": False},
                "wt/b": {
                    "head": "b",
                    "branch": "fix/b",
                    "uncommitted": ["src/x.ts"],
                    "gatePathsChanged": ["lefthook.yml"],
                    "changed": ["src/y.ts"],
                },
            },
            "processes": {"alive": [77], "results": {"pnpm lint": {"returncode": 1}}},
        },
    ).world()
    assert (world.git.head("wt/a"), world.git.branch("wt/a")) == ("abc", "fix/a")
    assert world.git.uncommitted("wt/a") == ["(uncommitted changes)"]
    assert world.git.uncommitted("wt/b") == ["src/x.ts"]
    assert world.git.changed_files("wt/b", "abc") == ["lefthook.yml", "src/y.ts"]
    world.git.push_queue_ref("wt/b", "fix/b", "b")
    assert FixtureWorld(tmp_path / "w.json").data["originQueueRefs"] == [
        {"branch": "fix/b", "head": "b"}
    ]
    with pytest.raises(WorldError):
        world.git.head("wt/none")
    assert world.processes.alive(77) and world.processes.alive(os.getpid())
    assert not world.processes.alive(78) and world.processes.start_time(77) is None
    assert world.processes.run(["pnpm", "lint"], ".").returncode == 1
    with pytest.raises(WorldError):
        world.processes.run(["pnpm", "test"], ".")


def test_a_missing_world_file_is_a_world_error(tmp_path):
    with pytest.raises(WorldError):
        FixtureWorld(tmp_path / "absent.json")
