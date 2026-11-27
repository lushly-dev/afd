"""The gateway's read costs (#2385): callers share one repository scan for
``cache.graphqlSeconds``, a write through the gateway drops it, and each read makes only the
GitHub calls its answer needs. The fake GitHub counts them, so a regression fails here."""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path

import pytest
from conftest import REPO_ROOT

from botcore_factory.gateway import GatewayConfig
from botcore_factory.gateway.cache import WRITES, CachedGitHub
from botcore_factory.gateway.github import FakeGitHub, GitHub
from botcore_factory.gateway.github_app import GitHubApp
from botcore_factory.gateway.harness import apply_fixture
from botcore_factory.gateway.service import Gateway
from botcore_factory.gateway.state import GatewayState

FIXTURES = REPO_ROOT / "docs/features/active/factory-gateway/scenarios/fixtures"
REPO = "example-org/example-repo"
HOLDER = {"branch": "fix/parser", "machine": "workstation"}


class Counting:
    """A port that records each GitHub call by method name. ``now`` is the fake's clock, which
    the App answers without GitHub, so it is not counted."""

    def __init__(self, inner: object) -> None:
        self.inner = inner
        self.calls: list[str] = []

    def __getattr__(self, name: str):
        found = getattr(self.inner, name)
        if not callable(found) or name.startswith("_") or name == "now":
            return found

        def counted(*args, **kwargs):
            self.calls.append(name)
            return found(*args, **kwargs)

        return counted


class Clock:
    def __init__(self) -> None:
        self.at = 1000.0

    def __call__(self) -> float:
        return self.at


@pytest.fixture
def world(tmp_path: Path):
    data = json.loads((FIXTURES / "gateway.json").read_text(encoding="utf-8"))
    assert apply_fixture(tmp_path / "run", {"fixture": data}).success
    config = GatewayConfig.model_validate_json((tmp_path / "run/config.json").read_text("utf-8"))
    github = Counting(FakeGitHub(tmp_path / "run/github.json", bot=config.bot))
    clock = Clock()
    port = CachedGitHub(github, config.cache.graphql_seconds, clock)
    gateway = Gateway(port, config, GatewayState(tmp_path / "run/state"), "owner")
    return gateway, github, clock


def scans(github: Counting) -> list[str]:
    return [name for name in github.calls if name in {"issues", "pulls"}]


# ── The cache ───────────────────────────────────────────────────────────


def test_claim_list_within_the_window_makes_no_second_scan(world):
    gateway, github, clock = world
    assert gateway.issue_claim(REPO, [103], HOLDER, None).success
    github.calls.clear()
    first = gateway.claim_list(REPO, None)
    clock.at += 14.9
    second = gateway.claim_list(REPO, None)
    assert first.data == second.data and first.data["claims"]
    assert github.calls == ["issues"]  # The second claim-list made no GitHub call at all.
    clock.at += 0.2  # Past cache.graphqlSeconds (15) since the scan.
    gateway.claim_list(REPO, None)
    assert scans(github) == ["issues", "issues"]


def test_a_claim_through_the_gateway_shows_at_once(world):
    gateway, github, _ = world
    before = {row["number"] for row in gateway.claim_list(REPO, None).data["claims"]}
    assert 103 not in before
    claimed = gateway.issue_claim(REPO, [103], HOLDER, None)
    assert claimed.success, claimed.error
    after = {row["number"] for row in gateway.claim_list(REPO, None).data["claims"]}
    assert after == before | {103}
    assert scans(github) == ["issues", "issues"]


def test_every_write_drops_its_repository_s_scans_even_when_it_fails():
    class Port:
        def __init__(self) -> None:
            self.reads = 0

        def issues(self, repo):
            self.reads += 1
            return [{"number": self.reads}]

        def add_comment(self, repo, number, body):
            raise RuntimeError("GitHub refused it")

    inner = Port()
    port = CachedGitHub(inner, 15, Clock())
    assert port.cached_issues(REPO) == [{"number": 1}]
    assert port.cached_issues("other/repo") == [{"number": 2}]
    with pytest.raises(RuntimeError):
        port.add_comment(REPO, 1, "body")
    assert port.cached_issues(REPO) == [{"number": 3}]
    assert port.cached_issues("other/repo") == [{"number": 2}]


def test_the_write_list_names_every_write_the_ports_have():
    reads = {
        "issue", "issues", "pull", "pulls", "repo_labels", "comments", "ref", "has_commit",
        "on_main", "check_runs", "variable", "issue_events", "comment_feed", "actions_status",
        "rate_limit", "ages", "now", "issue_types",
    }  # fmt: skip
    # Not GitHub writes: the App's credentials and its local mirror, and the fake's file read.
    local = {"token", "token_age", "key_age", "fetch_main", "refresh"}
    for port in (GitHub, GitHubApp, FakeGitHub):
        methods = {name for name in vars(port) if not name.startswith("_")}
        assert methods - reads - local == WRITES, port.__name__


def test_a_scan_that_a_write_overtook_is_not_kept():
    class Port:
        def __init__(self) -> None:
            self.reads = 0
            self.during: object = None

        def issues(self, repo):
            self.reads += 1
            if self.reads == 1 and self.during:
                self.during()  # A write lands while GitHub answers the first scan.
            return [{"number": self.reads}]

    inner = Port()
    port = CachedGitHub(inner, 15, Clock())
    inner.during = lambda: port.forget(REPO)
    assert port.cached_issues(REPO) == [{"number": 1}]
    assert port.cached_issues(REPO) == [{"number": 2}]  # The overtaken scan was not kept.
    assert port.cached_issues(REPO) == [{"number": 2}]


def test_callers_that_arrive_during_a_scan_wait_for_it():
    started, release = threading.Event(), threading.Event()

    class Port:
        reads = 0

        def pulls(self, repo):
            Port.reads += 1
            started.set()
            release.wait(5)
            return [{"number": 1}]

    port = CachedGitHub(Port(), 15)
    results: list = []
    arrived = threading.Event()

    def second() -> None:
        arrived.set()
        results.append(port.cached_pulls(REPO))

    threads = [threading.Thread(target=lambda: results.append(port.cached_pulls(REPO)))]
    threads[0].start()
    assert started.wait(5)
    threads += [threading.Thread(target=second)]
    threads[1].start()
    assert arrived.wait(5)
    time.sleep(0.05)  # Let the second caller reach the cache while the first scan still runs.
    release.set()
    for thread in threads:
        thread.join(5)
    assert Port.reads == 1 and results == [[{"number": 1}], [{"number": 1}]]


def test_a_plain_scan_reads_github_and_refreshes_the_cache():
    class Port:
        reads = 0

        def issues(self, repo):
            Port.reads += 1
            return [{"number": Port.reads}]

    port = CachedGitHub(Port(), 15, Clock())
    assert port.cached_issues(REPO) == [{"number": 1}]
    assert port.issues(REPO) == [{"number": 2}]  # Writes de-duplicate on a fresh read.
    assert port.cached_issues(REPO) == [{"number": 2}]


def test_callers_get_copies_and_zero_seconds_turns_the_cache_off():
    class Port:
        reads = 0

        def issues(self, repo):
            Port.reads += 1
            return [{"number": 1, "labels": []}]

    port = CachedGitHub(Port(), 15, Clock())
    port.cached_issues(REPO)[0]["labels"].append("changed")
    assert port.cached_issues(REPO) == [{"number": 1, "labels": []}]
    off = CachedGitHub(Port(), 0, Clock())
    off.cached_issues(REPO)
    off.cached_issues(REPO)
    assert Port.reads == 3


def test_a_waited_poll_reads_its_own_repository_again():
    class Port:
        reads: list = []
        refreshed = 0

        def pulls(self, repo):
            Port.reads.append(repo)
            return []

        def refresh(self):
            Port.refreshed += 1

    port = CachedGitHub(Port(), 15, Clock())
    port.cached_pulls(REPO)
    port.cached_pulls("other/repo")
    port.refresh(REPO)
    port.cached_pulls(REPO)
    port.cached_pulls("other/repo")
    assert Port.reads == [REPO, "other/repo", REPO] and Port.refreshed == 1


def test_waiters_that_refreshed_before_a_scan_share_it():
    class Port:
        reads = 0

        def pulls(self, repo):
            Port.reads += 1
            return [{"number": Port.reads}]

    port = CachedGitHub(Port(), 15, Clock())
    port.cached_pulls(REPO)
    port.refresh(REPO)
    port.refresh(REPO)  # Two waiters wake together.
    assert port.cached_pulls(REPO) == [{"number": 2}]
    assert port.cached_pulls(REPO) == [{"number": 2}]
    assert Port.reads == 2


def test_a_value_stored_after_a_failed_scan_serves_the_callers_behind_it():
    started, release, arrived = threading.Event(), threading.Event(), threading.Event()

    class Port:
        reads = 0

        def issues(self, repo):
            Port.reads += 1
            if Port.reads == 1:
                started.set()
                release.wait(5)
                raise RuntimeError("GitHub timed out")
            return [{"number": Port.reads}]

    port = CachedGitHub(Port(), 15)
    results: list = []

    def first() -> None:
        try:
            port.cached_issues(REPO)
        except RuntimeError as exc:
            results.append(str(exc))

    def queued() -> None:
        arrived.set()
        results.append(port.cached_issues(REPO))

    threads = [threading.Thread(target=first)]
    threads[0].start()
    assert started.wait(5)
    threads.append(threading.Thread(target=queued))
    threads[1].start()
    assert arrived.wait(5)
    time.sleep(0.05)
    assert port.issues(REPO) == [{"number": 2}]  # A write's fresh read stores a value.
    release.set()
    for thread in threads:
        thread.join(5)
    assert results == ["GitHub timed out", [{"number": 2}]] and Port.reads == 2


def test_callers_queued_behind_a_failed_scan_share_its_failure():
    started, release = threading.Event(), threading.Event()

    class Port:
        reads = 0

        def issues(self, repo):
            Port.reads += 1
            started.set()
            release.wait(5)
            raise RuntimeError("GitHub timed out")

    port = CachedGitHub(Port(), 15)
    failures: list = []
    arrivals = threading.Semaphore(0)

    def call():
        arrivals.release()
        try:
            port.cached_issues(REPO)
        except RuntimeError as exc:
            failures.append(str(exc))

    first = threading.Thread(target=call)
    first.start()
    assert started.wait(5)
    queued = [threading.Thread(target=call) for _ in range(3)]
    for thread in queued:
        thread.start()
    for _ in range(4):
        assert arrivals.acquire(timeout=5)
    time.sleep(0.05)  # Let the queued callers reach the cache while the first scan runs.
    release.set()
    for thread in [first, *queued]:
        thread.join(5)
    assert Port.reads == 1 and failures == ["GitHub timed out"] * 4
    with pytest.raises(RuntimeError):
        port.cached_issues(REPO)  # A caller that arrives later tries GitHub again.
    assert Port.reads == 2


def test_an_entry_is_as_old_as_the_scan_s_start():
    clock = Clock()

    class Port:
        reads = 0

        def issues(self, repo):
            Port.reads += 1
            clock.at += 10  # A slow scan: its data is from when it started.
            return []

    port = CachedGitHub(Port(), 15, clock)
    port.cached_issues(REPO)
    clock.at += 5.1  # 15.1 s after the scan started, 5.1 s after it ended.
    port.cached_issues(REPO)
    assert Port.reads == 2


def test_one_cache_is_shared_by_every_route(world, tmp_path):
    gateway, github, _ = world
    other = Gateway(gateway.github, gateway.config, gateway.state, "foreman")
    assert other.github is gateway.github
    gateway.claim_list(REPO, None)
    other.claim_list(REPO, None)
    assert scans(github) == ["issues"]


def test_the_server_gives_every_route_one_cache(world, tmp_path, monkeypatch):
    from botcore_factory.gateway import server

    gateway, github, _ = world
    seen = []
    real = server.build_gateway_host

    def build(route, context, **kwargs):
        seen.append(kwargs["github"])
        return real(route, context, **kwargs)

    monkeypatch.setattr(server, "build_gateway_host", build)
    server.build_gateway_app(tmp_path / "data", gateway.config, github)
    from botcore_factory.gateway.commands import ROUTES

    assert len(seen) == len(ROUTES) and all(port is seen[0] for port in seen)
    assert isinstance(seen[0], CachedGitHub) and seen[0].inner is github


def test_the_setting_is_cache_graphql_seconds():
    config = GatewayConfig.model_validate(
        {"bot": "b[bot]", "owner": "o", "ownerEmails": ["o@example.com"], "repositories": [REPO]}
    )
    assert config.cache.graphql_seconds == 15
    fields = config.model_dump(by_alias=True)
    off = config.model_validate({**fields, "cache": {"graphqlSeconds": 0}})
    assert off.cache.graphql_seconds == 0
    with pytest.raises(ValueError):
        config.model_validate({**fields, "cache": {"graphqlSeconds": -1}})


# ── What each read costs ────────────────────────────────────────────────


def test_issue_get_reads_only_the_issue(world):
    gateway, github, _ = world
    assert gateway.issue_claim(REPO, [102], HOLDER, None).success
    github.calls.clear()
    result = gateway.issue_get(REPO, 102)
    assert result.success, result.error
    assert result.data["linkedPrs"] == [47]
    assert result.data["claim"]["holder"]["branch"] == HOLDER["branch"]
    assert github.calls == ["issue"]


def test_issue_get_links_closed_and_merged_pull_requests_too(world):
    gateway, github, _ = world
    pulls = {pull["number"]: pull for pull in github.inner._data["pullRequests"]}
    assert pulls[41]["state"] == "merged" and pulls[42]["state"] == "closed"
    pulls[41]["closes"], pulls[42]["closes"] = [104], [104]
    assert gateway.issue_get(REPO, 104).data["linkedPrs"] == [41, 42]
    assert gateway.issue_get(REPO, 101).data["linkedPrs"] == [48]
    assert gateway.issue_get(REPO, 103).data["linkedPrs"] == []


def test_pr_status_reads_check_runs_once(world):
    gateway, github, _ = world
    result = gateway.pr_status(REPO, 47)
    assert result.success and result.data["state"] == "open", result.error
    assert "requiredCheck" in result.data
    assert github.calls.count("check_runs") == 1
    assert github.calls.count("pull") == 1


# ── Stale scans and outside pushes ──────────────────────────────────────


@pytest.fixture
def pushed_by_the_gateway(world, monkeypatch):
    """PR 48 (fix/parser) as the bot's, its branch pushed through the gateway, and the pull
    requests already scanned into the cache."""
    from botcore_factory.gateway import records

    gateway, github, _ = world
    data = github.inner._data
    pull = next(p for p in data["pullRequests"] if p["number"] == 48)
    pull["author"] = gateway.config.bot
    row = {"command": "branch-push", "success": True, "target": "refs/heads/fix/parser"}
    monkeypatch.setattr(records, "journal_rows", lambda gateway, repo: [row])
    gateway.scans.cached_pulls(REPO)
    return gateway, data, pull


def test_a_merge_the_queue_made_is_not_an_outside_push(pushed_by_the_gateway):
    from botcore_factory.gateway.records import outside_writes

    gateway, data, pull = pushed_by_the_gateway
    # GitHub merges it and deletes the branch, with no gateway write to drop the scan.
    pull["state"], pull["mergedAt"] = "merged", "2030-02-03T10:00:00Z"
    del data["refs"]["refs/heads/fix/parser"]
    assert outside_writes(gateway, REPO, None) == []


def test_a_push_by_someone_else_still_shows_through_a_stale_scan(pushed_by_the_gateway):
    from botcore_factory.gateway.records import outside_writes

    gateway, data, pull = pushed_by_the_gateway
    data["refs"]["refs/heads/fix/parser"] = "e" * 40  # As the routes' audit test pushes.
    assert outside_writes(gateway, REPO, None) == [{"kind": "pushed", "target": "pr#48"}]
