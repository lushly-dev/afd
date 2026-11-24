"""What the gateway's jobs cannot show: which route serves what, the owner's override, the
write budget, GitHub outages, the refusals a fixture cannot produce, and the journal."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from botcore.context import ExecutionContext
from conftest import REPO_ROOT

from botcore_factory.gateway import ROUTES, GatewayConfig, build_gateway_host
from botcore_factory.gateway.github import FakeGitHub
from botcore_factory.gateway.harness import apply_fixture, call
from botcore_factory.gateway.state import GatewayState, read_journal

FIXTURES = REPO_ROOT / "docs/features/active/factory-gateway/scenarios/fixtures"
REPO = "example-org/example-repo"
HOLDER = {"branch": "fix/parser", "machine": "workstation"}
PR47_HEAD = "6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c"
PR44_HEAD = "c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"


def fixture(name: str = "gateway", **overrides) -> dict:
    data = json.loads((FIXTURES / "gateway.json").read_text(encoding="utf-8"))
    if name != "gateway":
        data.update(json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8")))
    data.update(overrides)
    return data


class Run:
    def __init__(self, directory: Path, data: dict) -> None:
        self.directory = directory
        assert apply_fixture(directory, {"fixture": data}).success

    def __call__(self, route: str, command: str, **arguments):
        return call(command, arguments, self.directory, route)

    def github(self) -> dict:
        return json.loads((self.directory / "github.json").read_text(encoding="utf-8"))

    def edit(self, change) -> None:
        data = self.github()
        change(data)
        (self.directory / "github.json").write_text(json.dumps(data), encoding="utf-8")


@pytest.fixture
def run(tmp_path):
    def make(name: str = "gateway", **overrides) -> Run:
        return Run(tmp_path / "run", fixture(name, **overrides))

    return make


# ── Routes ──────────────────────────────────────────────────────────────


def test_each_host_serves_exactly_its_route_s_commands(run, tmp_path):
    run()
    from botcore_factory.gateway.harness import host_for

    for route, commands in ROUTES.items():
        host = host_for(tmp_path / "run", route)
        assert host.name == f"gateway-{route}"
        assert host.list_command_names() == sorted(commands)
        assert host.context.profile == "remote-caller"


@pytest.mark.parametrize("command", ["pr-merge", "verification-record", "branch-push", "pr-open"])
def test_the_foreman_can_land_nothing(run, command):
    result = run()("foreman", command, repo=REPO)
    assert result.error.code == "COMMAND_NOT_FOUND"


def test_a_session_claims_and_releases_and_writes_nothing_else(run):
    gateway = run()
    assert "issue-comment" not in ROUTES["session"]
    assert gateway("session", "issue-claim", repo=REPO, numbers=[101], holder=HOLDER).success
    released = gateway(
        "session", "issue-release", repo=REPO, number=101, holder=HOLDER, reason="done"
    )
    assert released.success and released.data["changed"] is True


def test_only_the_owner_may_release_by_force(run):
    gateway = run()
    assert gateway("lane", "issue-claim", repo=REPO, numbers=[101], holder=HOLDER).success
    other = {"branch": "fix/other", "machine": "laptop"}
    lane = gateway(
        "lane", "issue-release", repo=REPO, number=101, holder=other, reason="x", force=True
    )
    assert lane.error.code == "VALIDATION_ERROR" and "force" in lane.error.message
    owner = gateway(
        "owner", "issue-release", repo=REPO, number=101, holder=other, reason="stuck", force=True
    )
    assert owner.success and owner.data["changed"] is True
    assert gateway("owner", "claim-list", repo=REPO).data["claims"] == []


def test_a_host_refuses_any_profile_but_remote_caller(tmp_path):
    with pytest.raises(ValueError, match="remote-caller"):
        build_gateway_host(
            "lane",
            ExecutionContext(tmp_path, profile="trusted-local"),
            github=None,
            config=GatewayConfig(
                bot="b", owner="o", ownerEmails=["o@example.com"], repositories=[REPO]
            ),
            state=GatewayState(tmp_path),
        )


# ── Budgets, outages and refusals no fixture produces ───────────────────


def test_writes_beyond_the_hourly_budget_are_refused(run):
    gateway = run(writesPerHour={"lane": 2})
    for key in ("a", "b"):
        assert gateway(
            "lane", "issue-comment", repo=REPO, number=101, body=key, dedupe_key=key
        ).success
    refused = gateway("lane", "issue-comment", repo=REPO, number=101, body="c", dedupe_key="c")
    assert refused.error.code == "WRITE_BUDGET_EXCEEDED"
    assert "loop" in refused.error.suggestion
    # A retry of a write already made costs nothing and still answers.
    assert gateway("lane", "issue-comment", repo=REPO, number=101, body="a", dedupe_key="a").success


def test_a_github_outage_is_retryable_and_writes_nothing(run):
    gateway = run(githubUnavailable=True)
    result = gateway("lane", "issue-claim", repo=REPO, numbers=[101], holder=HOLDER)
    assert result.error.code == "GITHUB_UNAVAILABLE" and result.error.retryable is True


def test_merge_refuses_a_check_main_does_not_require(run):
    gateway = run(requiredCheck={"name": "ci-ok", "requiredOnMain": False})
    assert gateway(
        "lane", "verification-record", repo=REPO, head=PR47_HEAD, result="passed", summary="ok"
    ).success
    result = gateway("lane", "pr-merge", repo=REPO, number=47, head=PR47_HEAD)
    assert result.error.code == "CHECK_NOT_REQUIRED"


def test_merge_refuses_a_conflict(run):
    gateway = run()
    gateway.edit(
        lambda d: next(p for p in d["pullRequests"] if p["number"] == 47).update(
            mergeable="CONFLICTING"
        )
    )
    assert gateway(
        "lane", "verification-record", repo=REPO, head=PR47_HEAD, result="passed", summary="ok"
    ).success
    assert (
        gateway("lane", "pr-merge", repo=REPO, number=47, head=PR47_HEAD).error.code
        == "NOT_MERGEABLE"
    )


def test_a_failed_validation_does_not_allow_a_merge(run):
    gateway = run()
    assert gateway(
        "lane", "verification-record", repo=REPO, head=PR47_HEAD, result="failed", summary="red"
    ).success
    assert (
        gateway("lane", "pr-merge", repo=REPO, number=47, head=PR47_HEAD).error.code
        == "VALIDATION_MISSING"
    )


def test_a_clean_green_pull_request_merges_at_once_and_frees_its_claims(run):
    gateway = run()
    gateway.edit(
        lambda d: next(p for p in d["pullRequests"] if p["number"] == 44).update(branch="fix/perf")
    )
    holder = {"branch": "fix/perf", "machine": "workstation"}
    assert gateway("lane", "issue-claim", repo=REPO, numbers=[103], holder=holder).success
    gateway.edit(
        lambda d: next(p for p in d["pullRequests"] if p["number"] == 44).update(closes=[103])
    )
    assert gateway(
        "lane", "verification-record", repo=REPO, head=PR44_HEAD, result="passed", summary="ok"
    ).success
    merged = gateway("lane", "pr-merge", repo=REPO, number=44, head=PR44_HEAD)
    assert merged.data == {"state": "merged", "autoMerge": False, "changed": True}
    assert gateway("lane", "pr-status", repo=REPO, number=44).data["state"] == "merged"
    assert gateway("lane", "claim-list", repo=REPO).data["claims"] == []
    issue = gateway("lane", "issue-get", repo=REPO, number=103).data
    assert issue["state"] == "closed"
    assert "status:in-progress" not in issue["labels"]
    assert "status:planned" not in issue["labels"]
    assert "claim" not in issue
    # With no method configured the gateway merges with a merge commit, keeping every author.
    pull = next(p for p in gateway.github()["pullRequests"] if p["number"] == 44)
    assert pull["mergeMethod"] == "merge"


def test_issue_release_clears_leftover_in_progress_label_on_closed_and_open_issues(run):
    """lushly-dev/afd#1810: when the claim comment is already released but status:in-progress
    remains on the issue, issue-release removes it instead of answering changed: false."""
    gateway = run()
    assert gateway("lane", "issue-claim", repo=REPO, numbers=[101], holder=HOLDER).success
    # Release comment posted, issue closed, but status:in-progress left behind.
    assert gateway(
        "lane", "issue-release", repo=REPO, number=101, holder=HOLDER, reason="merged"
    ).success
    gateway.edit(
        lambda d: next(i for i in d["issues"] if i["number"] == 101).update(
            state="closed", labels=["area:core", "status:in-progress"]
        )
    )
    cleaned = gateway("lane", "issue-release", repo=REPO, number=101, holder=HOLDER, reason="clean")
    assert cleaned.success and cleaned.data == {
        "released": True,
        "changed": True,
        "record": {"label": None},
    }
    assert gateway("lane", "issue-get", repo=REPO, number=101).data["labels"] == ["area:core"]
    again = gateway("lane", "issue-release", repo=REPO, number=101, holder=HOLDER, reason="clean")
    assert again.success and again.data == {
        "released": True,
        "changed": False,
        "record": {"label": None},
    }

    # On an open issue with leftover status:in-progress after release, restore status:planned.
    gateway.edit(
        lambda d: next(i for i in d["issues"] if i["number"] == 101).update(
            state="open", labels=["area:core", "status:in-progress"]
        )
    )
    restored = gateway("lane", "issue-release", repo=REPO, number=101, holder=HOLDER, reason="open")
    assert restored.success and restored.data == {
        "released": True,
        "changed": True,
        "record": {"label": "status:planned"},
    }
    assert gateway("lane", "issue-get", repo=REPO, number=101).data["labels"] == [
        "area:core",
        "status:planned",
    ]


def test_issue_release_on_claimed_closed_issue_drops_in_progress_without_adding_planned(run):
    """When a PR merges asynchronously (auto-merge or merge queue) and GitHub closes the issue,
    releasing the claim drops status:in-progress and never re-adds status:planned."""
    gateway = run()
    assert gateway("lane", "issue-claim", repo=REPO, numbers=[101], holder=HOLDER).success
    gateway.edit(
        lambda d: next(i for i in d["issues"] if i["number"] == 101).update(state="closed")
    )
    released = gateway("lane", "issue-release", repo=REPO, number=101, holder=HOLDER, reason="done")
    assert released.success and released.data == {
        "released": True,
        "changed": True,
        "record": {"label": None},
    }
    assert gateway("lane", "issue-get", repo=REPO, number=101).data["labels"] == ["area:core"]


def test_owner_force_release_clears_leftover_in_progress_from_another_holder(run):
    gateway = run()
    assert gateway("lane", "issue-claim", repo=REPO, numbers=[101], holder=HOLDER).success
    assert gateway(
        "lane", "issue-release", repo=REPO, number=101, holder=HOLDER, reason="merged"
    ).success
    gateway.edit(
        lambda d: next(i for i in d["issues"] if i["number"] == 101).update(
            state="closed", labels=["area:core", "status:in-progress"]
        )
    )
    other = {"branch": "fix/other", "machine": "laptop"}
    cleaned = gateway(
        "owner", "issue-release", repo=REPO, number=101, holder=other, reason="cleanup", force=True
    )
    assert cleaned.success and cleaned.data["changed"] is True
    assert gateway("owner", "issue-get", repo=REPO, number=101).data["labels"] == ["area:core"]
    # Once clean, force-releasing an already-released issue by another holder is NOT_CLAIMED.
    refused = gateway(
        "owner", "issue-release", repo=REPO, number=101, holder=other, reason="cleanup", force=True
    )
    assert refused.error.code == "NOT_CLAIMED"


def test_enqueue_already_merged_clears_claim_and_in_progress_label(run, monkeypatch):
    gateway = behind_a_queue(run, 44, PR44_HEAD)
    gateway.edit(
        lambda d: next(p for p in d["pullRequests"] if p["number"] == 44).update(
            branch="fix/perf", closes=[101]
        )
    )
    holder = {"branch": "fix/perf", "machine": "workstation"}
    assert gateway("lane", "issue-claim", repo=REPO, numbers=[101], holder=holder).success

    def merged_at_once(self, repo, number, head):
        with self._write(repo) as data:
            self._pull(data, number).update(state="merged", mergedAt=data.get("now"))
            self._issue(data, 101)["state"] = "closed"
        return {"state": "MERGED", "position": 1}

    monkeypatch.setattr(FakeGitHub, "enqueue_pull", merged_at_once)
    merged = gateway("lane", "pr-merge", repo=REPO, number=44, head=PR44_HEAD)
    assert merged.data == {"state": "merged", "autoMerge": False, "changed": True}
    issue = gateway("lane", "issue-get", repo=REPO, number=101).data
    assert issue["state"] == "closed" and issue["labels"] == ["area:core"]
    assert "claim" not in issue


def test_pr_merge_retry_finishes_label_cleanup_after_transient_label_failure(run, monkeypatch):
    """If set_labels fails after merge_pull and add_comment succeed, retrying pr-merge clears
    the leftover status:in-progress label instead of answering changed: false."""
    from botcore_factory.gateway.github import GitHubUnavailable

    gateway = run()
    gateway.edit(
        lambda d: next(p for p in d["pullRequests"] if p["number"] == 44).update(
            branch="fix/perf", closes=[103]
        )
    )
    holder = {"branch": "fix/perf", "machine": "workstation"}
    assert gateway("lane", "issue-claim", repo=REPO, numbers=[103], holder=holder).success
    assert gateway(
        "lane", "verification-record", repo=REPO, head=PR44_HEAD, result="passed", summary="ok"
    ).success

    real_set_labels = FakeGitHub.set_labels

    def fail_once(self, repo, number, labels):
        raise GitHubUnavailable("503 while clearing labels")

    monkeypatch.setattr(FakeGitHub, "set_labels", fail_once)
    first = gateway("lane", "pr-merge", repo=REPO, number=44, head=PR44_HEAD)
    assert first.error.code == "GITHUB_UNAVAILABLE" and first.error.retryable is True
    # Merge and release comment landed, but status:in-progress is still on the closed issue.
    partial = gateway("lane", "issue-get", repo=REPO, number=103).data
    assert partial["state"] == "closed" and "status:in-progress" in partial["labels"]

    monkeypatch.setattr(FakeGitHub, "set_labels", real_set_labels)
    retried = gateway("lane", "pr-merge", repo=REPO, number=44, head=PR44_HEAD)
    assert retried.success and retried.data == {
        "state": "merged",
        "autoMerge": False,
        "changed": True,
    }
    cleaned = gateway("lane", "issue-get", repo=REPO, number=103).data
    assert "status:in-progress" not in cleaned["labels"]
    assert "status:planned" not in cleaned["labels"]
    # A second retry once clean changes nothing.
    again = gateway("lane", "pr-merge", repo=REPO, number=44, head=PR44_HEAD)
    assert again.success and again.data == {"state": "merged", "autoMerge": False, "changed": False}


def test_a_repository_configured_for_squash_is_squash_merged(run):
    gateway = run(mergeMethods={REPO: "squash"})
    assert gateway(
        "lane", "verification-record", repo=REPO, head=PR44_HEAD, result="passed", summary="ok"
    ).success
    assert gateway("lane", "pr-merge", repo=REPO, number=44, head=PR44_HEAD).success
    pull = next(p for p in gateway.github()["pullRequests"] if p["number"] == 44)
    assert pull["mergeMethod"] == "squash"


AGENT_HEAD = "e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6"


def test_a_session_hands_its_branch_to_the_lane_and_pushes_nothing_else(run):
    gateway = run()
    head = "d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3"
    queued = gateway(
        "session",
        "branch-push",
        repo=REPO,
        ref="refs/factory/queue/fix/tokens",
        head=head,
        bundle="bundle-9",
    )
    assert queued.success and queued.data["changed"] is True
    branch = gateway(
        "session",
        "branch-push",
        repo=REPO,
        ref="refs/heads/fix/tokens",
        head=head,
        bundle="bundle-9",
    )
    assert branch.error.code == "REF_NOT_ALLOWED" and "refs/factory/queue" in branch.error.message
    assert "pr-merge" not in ROUTES["session"] and "pr-open" not in ROUTES["session"]


@pytest.mark.parametrize("route", ["cell", "session", "lane", "owner"])
def test_no_route_pushes_a_commit_an_agent_authored(run, route):
    gateway = run()
    ref = "refs/factory/queue/fix/agent"
    result = gateway(
        route, "branch-push", repo=REPO, ref=ref, head=AGENT_HEAD, bundle="bundle-agent"
    )
    assert result.error.code == "COMMIT_AUTHOR_NOT_OWNER"
    assert "noreply@anthropic.com" in result.error.message
    assert "Assisted-by" in result.error.suggestion
    assert ref not in gateway.github()["refs"]


def test_commits_already_on_main_are_not_the_push_s_to_credit(run):
    # A bundle carries main's history, others' merged work included; only new commits count.
    gateway = run(mainHistory=[AGENT_HEAD])
    result = gateway(
        "cell",
        "branch-push",
        repo=REPO,
        ref="refs/factory/queue/fix/agent",
        head=AGENT_HEAD,
        bundle="bundle-agent",
    )
    assert result.success


def test_an_agent_commit_on_another_branch_is_still_refused(run):
    # Being on some branch or queue ref is not being merged: it would land with this push.
    gateway = run()
    gateway.edit(lambda d: d["refs"].update({"refs/heads/elsewhere": AGENT_HEAD}))
    result = gateway(
        "cell",
        "branch-push",
        repo=REPO,
        ref="refs/factory/queue/fix/agent",
        head=AGENT_HEAD,
        bundle="bundle-agent",
    )
    assert result.error.code == "COMMIT_AUTHOR_NOT_OWNER"


@pytest.mark.parametrize(
    "upload",
    [
        {"heads": [AGENT_HEAD], "expiresAt": "2030-02-03T11:00:00Z"},
        {"heads": [AGENT_HEAD], "expiresAt": "2030-02-03T11:00:00Z", "commits": []},
    ],
    ids=["no commit list", "commit list without the head"],
)
def test_an_upload_that_does_not_list_its_commits_pushes_nothing(run, upload):
    gateway = run(uploads={"bundle-x": upload})
    ref = "refs/factory/queue/fix/agent"
    result = gateway("cell", "branch-push", repo=REPO, ref=ref, head=AGENT_HEAD, bundle="bundle-x")
    assert result.error.code == "UPLOAD_INCOMPLETE"
    assert ref not in gateway.github()["refs"]


def test_an_upload_for_another_repository_cannot_be_pushed(run):
    upload = {
        "heads": [AGENT_HEAD],
        "commits": [{"sha": AGENT_HEAD, "authorEmail": "owner@example.com"}],
        "repo": "example-org/other",
        "expiresAt": "2030-02-03T11:00:00Z",
    }
    result = run(uploads={"bundle-x": upload})(
        "cell",
        "branch-push",
        repo=REPO,
        ref="refs/factory/queue/fix/x",
        head=AGENT_HEAD,
        bundle="bundle-x",
    )
    assert result.error.code == "UPLOAD_NOT_FOUND" and "example-org/other" in result.error.message


def test_owner_emails_match_without_regard_to_case(run):
    gateway = run(ownerEmails=["Owner@Example.com"])
    result = gateway(
        "cell",
        "branch-push",
        repo=REPO,
        ref="refs/factory/queue/fix/tokens",
        head="d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3",
        bundle="bundle-9",
    )
    assert result.success


def test_auto_merge_is_queued_by_the_repository_s_method(run):
    gateway = run(mergeMethods={REPO: "squash"})
    assert gateway(
        "lane", "verification-record", repo=REPO, head=PR47_HEAD, result="passed", summary="ok"
    ).success
    queued = gateway("lane", "pr-merge", repo=REPO, number=47, head=PR47_HEAD)
    assert queued.data["state"] == "queued"
    pull = next(p for p in gateway.github()["pullRequests"] if p["number"] == 47)
    assert pull["autoMergeMethod"] == "squash"


def test_a_head_that_moves_as_auto_merge_is_set_is_head_moved(run, monkeypatch):
    from botcore_factory.gateway.github import HeadMoved

    def moved(self, repo, number, head, method):
        raise HeadMoved("9" * 40)

    monkeypatch.setattr(FakeGitHub, "enable_auto_merge", moved)
    gateway = run()
    assert gateway(
        "lane", "verification-record", repo=REPO, head=PR47_HEAD, result="passed", summary="ok"
    ).success
    result = gateway("lane", "pr-merge", repo=REPO, number=47, head=PR47_HEAD)
    assert result.error.code == "HEAD_MOVED" and result.error.details["head"] == "9" * 40


def test_a_pull_request_github_finds_clean_on_auto_merge_merges_at_once(run, monkeypatch):
    from botcore_factory.gateway.github import AlreadyMergeable

    def clean(self, repo, number, head, method):
        raise AlreadyMergeable()

    monkeypatch.setattr(FakeGitHub, "enable_auto_merge", clean)
    gateway = run()
    assert gateway(
        "lane", "verification-record", repo=REPO, head=PR47_HEAD, result="passed", summary="ok"
    ).success
    result = gateway("lane", "pr-merge", repo=REPO, number=47, head=PR47_HEAD)
    assert result.data == {"state": "merged", "autoMerge": False, "changed": True}


@pytest.mark.parametrize("branch", ["fix/../../../pulls/1", "fix/x#y", "fix/100%", "a b"])
def test_pr_open_refuses_a_branch_that_is_not_a_branch_name(run, branch):
    result = run()("lane", "pr-open", repo=REPO, branch=branch, title="T", body="B", closes=[])
    assert result.error.code == "REF_NOT_ALLOWED"


@pytest.mark.parametrize(("number", "head"), [(44, PR44_HEAD), (47, PR47_HEAD)])
def test_a_merge_method_the_repository_refuses_is_a_refusal(run, number, head):
    gateway = run(allowedMergeMethods=["squash"])
    assert gateway(
        "lane", "verification-record", repo=REPO, head=head, result="passed", summary="ok"
    ).success
    result = gateway("lane", "pr-merge", repo=REPO, number=number, head=head)
    assert result.error.code == "MERGE_METHOD_NOT_ALLOWED"
    assert "mergeMethods" in result.error.suggestion
    pull = next(p for p in gateway.github()["pullRequests"] if p["number"] == number)
    assert pull["state"] != "merged" and not pull.get("autoMerge")


def test_merge_methods_name_only_served_repositories():
    with pytest.raises(ValueError, match="does not serve"):
        GatewayConfig.model_validate(
            {
                "bot": "b",
                "owner": "o",
                "ownerEmails": ["o@example.com"],
                "repositories": [REPO],
                "mergeMethods": {"example-org/typo": "squash"},
            }
        )


def test_a_configuration_without_owner_emails_is_refused():
    with pytest.raises(ValueError, match="ownerEmails"):
        GatewayConfig.model_validate({"bot": "b", "owner": "o", "repositories": [REPO]})


def test_a_non_fast_forward_push_to_a_branch_people_see_is_refused(run):
    gateway = run()
    result = gateway(
        "lane",
        "branch-push",
        repo=REPO,
        ref="refs/heads/fix/parser",
        head="d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3",
        bundle="bundle-7",
    )
    assert (
        result.error.code == "NOT_FAST_FORWARD" and "merge main" in result.error.suggestion.lower()
    )


def test_an_expired_or_unknown_upload_is_refused(run):
    gateway = run()
    result = gateway(
        "lane",
        "branch-push",
        repo=REPO,
        ref="refs/heads/x",
        head="d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3",
        bundle="bundle-0",
    )
    assert result.error.code == "UPLOAD_NOT_FOUND" and "/uploads" in result.error.suggestion


def test_a_short_sha_is_refused_by_the_input_schema(run):
    result = run()("lane", "pr-merge", repo=REPO, number=47, head="6b7c8d9")
    assert (
        result.error.code == "VALIDATION_ERROR"
        and result.error.details["invalidFields"][0]["field"] == "head"
    )


def test_only_allowed_variables_are_set_and_the_old_value_returned(run):
    gateway = run()
    refused = gateway("foreman", "variable-set", repo=REPO, name="NPM_TOKEN", value="x")
    assert refused.error.code == "VARIABLE_NOT_ALLOWED"
    first = gateway("foreman", "variable-set", repo=REPO, name="FACTORY_LANE_HOST", value="mini")
    again = gateway("foreman", "variable-set", repo=REPO, name="FACTORY_LANE_HOST", value="random")
    assert first.data["previous"] is None and again.data["previous"] == "mini"


@pytest.mark.parametrize(
    "secret",
    ["ghp_" + "a" * 36, "AKIA" + "B" * 16, "-----BEGIN RSA PRIVATE KEY-----"],
)
def test_built_in_secret_rules_refuse_before_any_write(run, secret):
    gateway = run()
    before = gateway.github()
    result = gateway("lane", "issue-create", repo=REPO, title="Flaky", body=f"log {secret}")
    assert result.error.code == "SECRET_IN_BODY" and secret not in result.error.message
    assert gateway.github() == before


# ── Claims between commands ─────────────────────────────────────────────


def test_the_holder_renews_and_a_lapsed_holder_cannot_finish(run):
    gateway = run("stale-claim")
    renewed = gateway("lane", "issue-claim", repo=REPO, numbers=[101], holder=HOLDER)
    again = gateway("lane", "issue-claim", repo=REPO, numbers=[101], holder=HOLDER)
    assert (
        renewed.data["claims"][0]["renewed"] is False and again.data["claims"][0]["renewed"] is True
    )


def test_a_legacy_claim_written_after_the_cutover_began_is_not_honoured(run):
    data = fixture("restart")
    for comment in data["claimComments"]:
        if comment["number"] == 104:
            comment["at"] = "2030-02-03T08:30:00Z"  # After cutover.from.
    gateway = Run(run().directory, data)
    numbers = [row["number"] for row in gateway("foreman", "claim-list", repo=REPO).data["claims"]]
    assert numbers == [101, 102]


def test_no_legacy_claim_counts_after_the_cutover_window(run):
    data = fixture("restart")
    data["cutover"] = {**data["cutover"], "legacyUntil": "2030-02-03T09:00:00Z"}
    gateway = Run(run().directory, data)
    numbers = [row["number"] for row in gateway("foreman", "claim-list", repo=REPO).data["claims"]]
    assert numbers == [101, 102]


# ── The journal ─────────────────────────────────────────────────────────


def test_every_call_is_journaled_with_the_route_s_actor(run, tmp_path):
    gateway = run()
    assert gateway("lane", "issue-claim", repo=REPO, numbers=[101], holder=HOLDER).success
    refused = gateway("lane", "issue-claim", repo=REPO, numbers=[99], holder=HOLDER)
    assert refused.error.code == "ISSUE_CLOSED"
    entries = read_journal(tmp_path / "run" / "state" / "journal")
    assert [(e.command, e.result["success"]) for e in entries] == [
        ("issue-claim", True),
        ("issue-claim", False),
    ]
    assert entries[0].actor.kind == "service" and entries[0].actor.id == "lane@workstation"
    assert entries[0].timestamp.startswith("2030-02-03T10:00:00")  # The fixture's clock.
    audit = gateway("owner", "gateway-audit", repo=REPO, issue=101).data["entries"]
    assert [row["command"] for row in audit] == ["issue-claim"]


def test_the_fake_never_writes_as_anyone_but_the_bot(run):
    gateway = run()
    gateway("lane", "issue-comment", repo=REPO, number=101, body="hello")
    comments = next(i for i in gateway.github()["issues"] if i["number"] == 101)["comments"]
    assert comments[-1]["author"] == "example-factory[bot]"
    assert FakeGitHub  # The port's only adapter until G0's App client.


def test_the_audit_traces_live_writes_to_a_pull_request_and_its_head(run):
    gateway = run()
    head = "d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3"
    pushed = gateway(
        "lane", "branch-push", repo=REPO, ref="refs/heads/fix/tokens", head=head, bundle="bundle-7"
    )
    assert pushed.success
    opened = gateway(
        "lane", "pr-open", repo=REPO, branch="fix/tokens", title="T", body="B", closes=[102]
    )
    number = opened.data["number"]
    assert gateway(
        "lane", "verification-record", repo=REPO, head=head, result="passed", summary="ok"
    ).success
    rows = gateway("owner", "gateway-audit", repo=REPO, pr=number).data["entries"]
    assert [row["command"] for row in rows] == ["pr-open", "verification-record"]
    assert all(row["actor"] == {"kind": "service", "id": "lane@workstation"} for row in rows)
    # The lane pushed fix/tokens; a push by anyone else to the bot's open pull request shows.
    gateway.edit(lambda d: d["refs"].update({"refs/heads/fix/tokens": "e" * 40}))
    outside = gateway("owner", "gateway-audit", repo=REPO, pr=number).data["outside"]
    assert outside == [{"kind": "pushed", "target": f"pr#{number}"}]


def test_pure_reads_stay_out_of_the_journal(run, tmp_path):
    """lushly-dev/afd#2413: pure reads and polling commands are excluded from the journal."""
    gateway = run()
    assert gateway("owner", "gateway-status").success
    assert gateway("owner", "issue-get", repo=REPO, number=101).success
    assert gateway("owner", "gateway-audit", repo=REPO).success
    assert gateway("owner", "gateway-wait", repo=REPO, consumer="c1", timeout_ms=0).success
    assert read_journal(tmp_path / "run" / "state" / "journal") == []


def test_journal_prunes_old_days_at_start_and_rollover(tmp_path):
    """lushly-dev/afd#2413: journal.keepDays prunes older UTC day files at start and rollover."""
    import asyncio
    from datetime import UTC, datetime

    from afd.core.journal import JournalContextDigest, JournalRecord

    from botcore_factory.gateway.state import DailyJournalSink, journal_size, prune_journal

    journal_dir = tmp_path / "journal"
    journal_dir.mkdir()
    for day in ("2030-01-01", "2030-01-02", "2030-01-03", "2030-01-04", "notes"):
        (journal_dir / f"{day}.jsonl").write_text("", encoding="utf-8")

    # keep_days=0 disables pruning.
    assert prune_journal(journal_dir, 0, now=datetime(2030, 1, 5, tzinfo=UTC)) == []
    assert (journal_dir / "2030-01-01.jsonl").exists()

    now = [datetime(2030, 1, 4, 12, 0, tzinfo=UTC)]
    sink = DailyJournalSink(journal_dir, keep_days=2, clock=lambda: now[0])
    # At start on 2030-01-04 with keep_days=2, 2030-01-03 and 2030-01-04 remain; non-date untouched.
    assert sorted(p.stem for p in journal_dir.glob("*.jsonl")) == [
        "2030-01-03",
        "2030-01-04",
        "notes",
    ]
    assert journal_size(journal_dir)[1] == "2030-01-03"

    # Rollover to 2030-01-05 prunes 2030-01-03 when writing the new day's first entry.
    now[0] = datetime(2030, 1, 5, 0, 5, tzinfo=UTC)
    record = JournalRecord(
        timestamp="2030-01-05T00:05:00Z",
        command="issue-claim",
        input={"repo": REPO, "numbers": [101]},
        context_digest=JournalContextDigest(hash="sha256:" + "0" * 64),
        result={"success": True},
        duration_ms=1.0,
    )
    asyncio.run(sink.append(record))
    assert sorted(p.stem for p in journal_dir.glob("*.jsonl")) == [
        "2030-01-04",
        "2030-01-05",
        "notes",
    ]


def test_read_journal_since_skips_older_day_files(tmp_path):
    """lushly-dev/afd#2413: read_journal(since=...) skips reading day files before since's date."""
    import asyncio
    from datetime import UTC, datetime

    from afd.core.journal import JournalContextDigest, JournalRecord

    from botcore_factory.gateway.state import DailyJournalSink

    journal_dir = tmp_path / "journal"
    journal_dir.mkdir()
    # Corrupt older day file: if read_journal opened it, parse_journal would raise ValueError.
    (journal_dir / "2030-01-01.jsonl").write_text("{not valid json}\n", encoding="utf-8")
    sink = DailyJournalSink(
        journal_dir, keep_days=0, clock=lambda: datetime(2030, 1, 5, 10, 0, tzinfo=UTC)
    )
    asyncio.run(
        sink.append(
            JournalRecord(
                timestamp="2030-01-05T10:00:00Z",
                command="issue-claim",
                input={"repo": REPO, "numbers": [101]},
                context_digest=JournalContextDigest(hash="sha256:" + "0" * 64),
                result={"success": True},
                duration_ms=1.0,
            )
        )
    )
    entries = read_journal(journal_dir, since=datetime(2030, 1, 5, 8, 0, tzinfo=UTC))
    assert [entry.command for entry in entries] == ["issue-claim"]


def test_gateway_config_and_host_wire_journal_keep_days(tmp_path):
    """lushly-dev/afd#2413: GatewayConfig parses journal.keepDays, rejects negatives, and
    build_gateway_host prunes old day files using config.journal.keep_days."""
    from datetime import UTC, datetime

    from botcore.context import ExecutionContext
    from pydantic import ValidationError

    from botcore_factory.gateway.config import GatewayConfig
    from botcore_factory.gateway.github import FakeGitHub, fake_world
    from botcore_factory.gateway.hosts import build_gateway_host

    base = {
        "bot": "example-factory[bot]",
        "owner": "owner",
        "repositories": [REPO],
        "ownerEmails": ["owner@example.com"],
    }
    assert GatewayConfig(**base).journal.keep_days == 365
    cfg = GatewayConfig(**base, journal={"keepDays": 2})
    assert cfg.journal.keep_days == 2
    with pytest.raises(ValidationError):
        GatewayConfig(**base, journal={"keepDays": -1})

    state_dir = tmp_path / "state"
    journal_dir = state_dir / "journal"
    journal_dir.mkdir(parents=True)
    for day in ("2030-01-01", "2030-01-03", "2030-01-04"):
        (journal_dir / f"{day}.jsonl").write_text("", encoding="utf-8")
    github_file = tmp_path / "github.json"
    github_file.write_text(json.dumps(fake_world({}, REPO)), encoding="utf-8")
    build_gateway_host(
        "owner",
        ExecutionContext(state_dir, profile="remote-caller"),
        github=FakeGitHub(github_file, bot=cfg.bot),
        config=cfg,
        state=GatewayState(state_dir),
        clock=lambda: datetime(2030, 1, 4, 12, 0, tzinfo=UTC),
    )
    assert sorted(p.stem for p in journal_dir.glob("*.jsonl")) == ["2030-01-03", "2030-01-04"]


def test_gateway_audit_since_skips_older_day_files(run, tmp_path):
    """lushly-dev/afd#2413: gateway-audit(since=...) skips opening day files before since."""
    gateway = run()
    gateway.edit(lambda d: d.update({"pullRequests": []}))
    assert gateway("lane", "issue-claim", repo=REPO, numbers=[101], holder=HOLDER).success
    journal_dir = tmp_path / "run" / "state" / "journal"
    # Plant a corrupt older day file; gateway-audit with a later `since` must never open it.
    (journal_dir / "2020-01-01.jsonl").write_text("{corrupt\n", encoding="utf-8")
    audit = gateway("owner", "gateway-audit", repo=REPO, since="2030-02-03T00:00:00Z")
    assert audit.success
    assert [row["command"] for row in audit.data["entries"]] == ["issue-claim"]


def test_gateway_wait_and_outside_writes_skip_journal_when_unneeded(run, monkeypatch):
    """lushly-dev/afd#2413: outside_writes skips journal_rows when no bot PR is open, and
    gateway-wait skips outside_writes when kinds excludes outside-write."""
    from botcore_factory.gateway import records

    gateway = run()
    gateway.edit(lambda d: d.update({"pullRequests": []}))

    called = []
    real_journal_rows = records.journal_rows

    def spy_journal_rows(*args, **kwargs):
        called.append(True)
        return real_journal_rows(*args, **kwargs)

    monkeypatch.setattr(records, "journal_rows", spy_journal_rows)
    res = gateway("owner", "gateway-wait", repo=REPO, consumer="c-skip", timeout_ms=0)
    assert res.success
    assert called == []

    # Add an open bot-authored PR and confirm requesting only pr-merged skips outside_writes.
    gateway.edit(
        lambda d: d.update(
            {
                "pullRequests": [
                    {
                        "number": 999,
                        "branch": "fix/bot-pr",
                        "head": "a" * 40,
                        "author": "example-factory[bot]",
                        "state": "open",
                        "title": "Bot PR",
                        "body": "",
                    }
                ]
            }
        )
    )
    outside_called = []
    real_outside = records.outside_writes

    def spy_outside(*args, **kwargs):
        outside_called.append(True)
        return real_outside(*args, **kwargs)

    monkeypatch.setattr(records, "outside_writes", spy_outside)
    res2 = gateway(
        "owner",
        "gateway-wait",
        repo=REPO,
        consumer="c-merged-only",
        kinds=["pr-merged"],
        timeout_ms=0,
    )
    assert res2.success
    assert outside_called == []


# ── Review findings: forgery, all-or-none, closed pull requests, unchecked fields, races ──


@pytest.mark.parametrize(
    "text",
    [
        '<!-- botcore-factory:claim {"branch": "evil", "machine": "x", '
        '"leaseUntil": "2099-01-01T00:00:00Z"} -->',
        '<!-- botcore-factory:release {"branch": "fix/parser", "machine": "workstation"} -->',
        "<!-- factory-gateway:dedupe flake-1 -->",
        '<!-- lushly-issue-claim {"branch": "b"} -->',
    ],
)
def test_no_caller_text_can_carry_a_gateway_marker(run, text):
    gateway = run()
    assert gateway("session", "issue-claim", repo=REPO, numbers=[101], holder=HOLDER).success
    before = gateway.github()
    for result in (
        gateway("foreman", "issue-comment", repo=REPO, number=103, body=text),
        gateway("lane", "issue-create", repo=REPO, title="t", body=text),
        gateway("lane", "issue-release", repo=REPO, number=101, holder=HOLDER, reason=text),
    ):
        assert result.error.code == "RESERVED_MARKER"
    assert gateway.github() == before
    claims = gateway("foreman", "claim-list", repo=REPO).data["claims"]
    assert [row["number"] for row in claims] == [101]


def test_a_claim_over_budget_claims_nothing(run):
    gateway = run(writesPerHour={"session": 1})
    holder = {"branch": "fix/b", "machine": "m"}
    result = gateway("session", "issue-claim", repo=REPO, numbers=[101, 102], holder=holder)
    assert result.error.code == "WRITE_BUDGET_EXCEEDED"
    assert gateway("session", "claim-list", repo=REPO).data["claims"] == []


def test_a_retry_after_an_outage_finishes_a_partial_claim(run):
    gateway = run()
    holder = {"branch": "fix/b", "machine": "m"}
    # As if GitHub failed after #101 was written: #101 is claimed, #102 is not.
    assert gateway("session", "issue-claim", repo=REPO, numbers=[101], holder=holder).success
    retried = gateway("session", "issue-claim", repo=REPO, numbers=[101, 102], holder=holder)
    assert [(row["number"], row["renewed"]) for row in retried.data["claims"]] == [
        (101, True),
        (102, False),
    ]


def test_a_closed_pull_request_is_never_merged_or_queued(run):
    gateway = run()
    head = "2222222222222222222222222222222222222222"
    result = gateway("owner", "pr-merge", repo=REPO, number=42, head=head)
    assert result.error.code == "PR_CLOSED" and "pr-status" in result.error.suggestion


def test_the_lane_can_turn_auto_merge_off_after_the_branch_moved(run):
    gateway = run()
    assert gateway(
        "lane", "verification-record", repo=REPO, head=PR47_HEAD, result="passed", summary="ok"
    ).success
    assert (
        gateway("lane", "pr-merge", repo=REPO, number=47, head=PR47_HEAD).data["state"] == "queued"
    )
    gateway.edit(
        lambda d: next(p for p in d["pullRequests"] if p["number"] == 47).update(head="f" * 40)
    )
    cancelled = gateway("lane", "pr-merge", repo=REPO, number=47, head=PR47_HEAD, cancel=True)
    assert cancelled.data == {"state": "open", "autoMerge": False, "changed": True}


@pytest.mark.parametrize(
    "command,arguments",
    [
        (
            "issue-claim",
            {"numbers": [101], "holder": {"branch": "ghp_" + "a" * 36, "machine": "m"}},
        ),
        ("issue-comment", {"number": 101, "body": "ok", "dedupe_key": "AKIA" + "B" * 16}),
        ("pr-open", {"branch": "ghp_" + "c" * 36, "title": "t", "body": "b"}),
    ],
)
def test_every_text_field_is_checked_for_secrets(run, command, arguments):
    gateway = run()
    before = gateway.github()
    assert gateway("lane", command, repo=REPO, **arguments).error.code == "SECRET_IN_BODY"
    assert gateway.github() == before


@pytest.mark.parametrize(
    "ref", ["refs/factory/queue/../../heads/main", "refs/heads/a b", "refs/heads/x.lock"]
)
def test_a_malformed_ref_is_refused_before_the_upload_is_read(run, ref):
    result = run()(
        "lane",
        "branch-push",
        repo=REPO,
        ref=ref,
        head="d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3",
        bundle="bundle-7",
    )
    assert result.error.code == "REF_NOT_ALLOWED"


def test_pr_open_writes_the_closing_lines_and_refuses_its_callers(run):
    gateway = run()
    gateway.edit(lambda d: d["refs"].update({"refs/heads/fix/x": "a" * 40}))
    refused = gateway("lane", "pr-open", repo=REPO, branch="fix/x", title="t", body="Fixes #101")
    assert refused.error.code == "CLOSING_KEYWORD_IN_BODY"
    opened = gateway(
        "lane", "pr-open", repo=REPO, branch="fix/x", title="t", body="b", closes=[101]
    )
    assert gateway("lane", "pr-status", repo=REPO, number=opened.data["number"]).data["closes"] == [
        101
    ]


def test_pr_open_leaves_a_pull_request_it_did_not_open(run):
    gateway = run()
    gateway.edit(lambda d: d["refs"].update({"refs/heads/fix/hand": "b" * 40}))
    gateway.edit(
        lambda d: d["pullRequests"].append(
            {
                "number": 60,
                "state": "open",
                "branch": "fix/hand",
                "head": "b" * 40,
                "author": "example-owner",
            }
        )
    )
    result = gateway("lane", "pr-open", repo=REPO, branch="fix/hand", title="t", body="b")
    assert result.error.code == "NOT_GATEWAY_PR"


def test_release_needs_the_same_branch_and_machine(run):
    gateway = run()
    assert gateway("lane", "issue-claim", repo=REPO, numbers=[101], holder=HOLDER).success
    other_machine = {"branch": "fix/parser", "machine": "laptop"}
    result = gateway(
        "lane", "issue-release", repo=REPO, number=101, holder=other_machine, reason="x"
    )
    assert result.error.code == "NOT_HOLDER"


def test_a_bad_cursor_or_time_is_a_validation_error(run):
    gateway = run()
    assert (
        gateway("cell", "comment-list", repo=REPO, number=103, cursor="x").error.code
        == "VALIDATION_ERROR"
    )
    assert (
        gateway("owner", "gateway-audit", repo=REPO, since="yesterday").error.code
        == "VALIDATION_ERROR"
    )


@pytest.mark.parametrize(
    "comment_at,live", [("2030-02-03T07:30:00Z", True), ("2030-02-03T09:00:00Z", False)]
)
def test_a_lushly_lease_lives_on_activity_before_the_cutover_only(run, comment_at, live):
    data = fixture("restart")
    data["now"] = "2030-02-03T11:15:00Z"  # 4.25 hours after the lease started at 07:00.
    data["claimComments"].append(
        {"number": 104, "author": "example-owner", "at": comment_at, "marker": "note", "claim": {}}
    )
    gateway = Run(run().directory, data)
    claims = {row["number"] for row in gateway("foreman", "claim-list", repo=REPO).data["claims"]}
    assert (104 in claims) is live


def test_a_merge_racing_a_push_is_reported_as_head_moved(tmp_path):
    from botcore_factory.gateway.github import HeadMoved

    assert apply_fixture(tmp_path / "run", {"fixture": fixture()}).success
    github = FakeGitHub(tmp_path / "run" / "github.json", bot="example-factory[bot]")
    with pytest.raises(HeadMoved) as moved:
        github.merge_pull(REPO, 47, "0" * 40, "merge")
    assert moved.value.head == PR47_HEAD


async def test_concurrent_claims_on_one_issue_leave_one_holder(tmp_path):
    import asyncio

    from afd import Actor
    from afd.core.commands import CommandContext

    from botcore_factory.gateway.harness import apply_fixture as apply

    assert apply(tmp_path / "run", {"fixture": fixture()}).success
    directory = tmp_path / "run"
    config = GatewayConfig.model_validate_json((directory / "config.json").read_text("utf-8"))
    state = GatewayState(directory / "state")
    # One process: one GitHub client and one state, shared by every route's host.
    shared = FakeGitHub(directory / "github.json", bot=config.bot)
    lane, foreman = (
        build_gateway_host(
            route,
            ExecutionContext(directory / "state", profile="remote-caller"),
            github=shared,
            config=config,
            state=state,
        )
        for route in ("lane", "foreman")
    )
    calls = [
        host.execute(
            "issue-claim",
            {"repo": REPO, "numbers": [101], "holder": {"branch": f"fix/{i}", "machine": "m"}},
            CommandContext(actor=Actor(kind="agent", id=f"caller-{i}")),
        )
        for i, host in enumerate([lane, foreman] * 4)
    ]
    results = await asyncio.gather(*calls)
    assert sum(result.success for result in results) == 1
    assert {r.error.code for r in results if not r.success} == {"ALREADY_CLAIMED"}


# ── A merge queue on main ───────────────────────────────────────────────


def behind_a_queue(run, number: int, head: str, **overrides):
    """A gateway whose pull request ``number`` targets a base with a merge queue, validated."""
    gateway = run(**overrides)
    gateway.edit(
        lambda d: next(p for p in d["pullRequests"] if p["number"] == number).update(
            mergeQueue={"required": True}
        )
    )
    assert gateway(
        "lane", "verification-record", repo=REPO, head=head, result="passed", summary="ok"
    ).success
    return gateway


def test_without_a_queue_pr_merge_and_pr_status_name_none(run):
    gateway = run()
    assert gateway(
        "lane", "verification-record", repo=REPO, head=PR44_HEAD, result="passed", summary="ok"
    ).success
    assert "mergeQueue" not in gateway("lane", "pr-status", repo=REPO, number=44).data
    merged = gateway("lane", "pr-merge", repo=REPO, number=44, head=PR44_HEAD)
    assert merged.data == {"state": "merged", "autoMerge": False, "changed": True}


def test_behind_a_queue_a_green_pull_request_is_queued_never_merged_directly(run, monkeypatch):
    def direct(self, repo, number, head, method):
        raise AssertionError("A required merge queue refuses a direct merge")

    monkeypatch.setattr(FakeGitHub, "merge_pull", direct)
    gateway = behind_a_queue(run, 44, PR44_HEAD, mergeMethods={REPO: "squash"})
    queued = gateway("lane", "pr-merge", repo=REPO, number=44, head=PR44_HEAD)
    # Its check passed: into the queue itself, bound to the head, and no auto-merge.
    assert queued.data == {
        "state": "queued",
        "autoMerge": False,
        "changed": True,
        "mergeQueue": {"required": True, "queued": True, "state": "QUEUED", "position": 1},
    }
    assert "Added 44 to the merge queue" in queued.reasoning
    pull = next(p for p in gateway.github()["pullRequests"] if p["number"] == 44)
    assert pull["state"] == "open" and pull["mergeQueue"]["head"] == PR44_HEAD
    # The caller waits on pr-status, which carries the same entry while it is open.
    status = gateway("lane", "pr-status", repo=REPO, number=44).data
    assert status["state"] == "open" and status["mergeQueue"] == queued.data["mergeQueue"]
    again = gateway("lane", "pr-merge", repo=REPO, number=44, head=PR44_HEAD)
    assert again.data["changed"] is False and again.data["mergeQueue"]["queued"] is True
    assert "already in the merge queue" in again.reasoning


def test_behind_a_queue_a_pull_request_whose_check_runs_waits_to_join_it(run):
    gateway = behind_a_queue(run, 47, PR47_HEAD)
    queued = gateway("lane", "pr-merge", repo=REPO, number=47, head=PR47_HEAD)
    assert queued.data == {
        "state": "queued",
        "autoMerge": True,
        "changed": True,
        "mergeQueue": {"required": True, "queued": False},
    }
    assert "once its checks pass" in queued.reasoning
    pull = next(p for p in gateway.github()["pullRequests"] if p["number"] == 47)
    assert pull["autoMergeHead"] == PR47_HEAD and pull["state"] == "open"


def test_behind_a_queue_nothing_left_to_wait_for_is_enqueued_at_the_head(run, monkeypatch):
    from botcore_factory.gateway.github import AlreadyMergeable

    def clean(self, repo, number, head, method):
        raise AlreadyMergeable()

    monkeypatch.setattr(FakeGitHub, "enable_auto_merge", clean)
    gateway = behind_a_queue(run, 47, PR47_HEAD)  # Its check still ran when it was read.
    queued = gateway("lane", "pr-merge", repo=REPO, number=47, head=PR47_HEAD)
    assert queued.data["state"] == "queued" and queued.data["autoMerge"] is False
    assert queued.data["mergeQueue"]["queued"] is True
    pull = next(p for p in gateway.github()["pullRequests"] if p["number"] == 47)
    assert pull["state"] == "open" and pull["mergeQueue"]["head"] == PR47_HEAD


def test_behind_a_queue_a_head_that_moves_is_head_moved(run, monkeypatch):
    from botcore_factory.gateway.github import HeadMoved

    def moved(self, repo, number, head):
        raise HeadMoved("9" * 40)

    monkeypatch.setattr(FakeGitHub, "enqueue_pull", moved)
    gateway = behind_a_queue(run, 44, PR44_HEAD)
    result = gateway("lane", "pr-merge", repo=REPO, number=44, head=PR44_HEAD)
    assert result.error.code == "HEAD_MOVED" and result.error.details["head"] == "9" * 40
    assert "before it was queued" in result.error.message


def test_a_queued_pull_request_keeps_its_claim_until_it_merges(run):
    gateway = behind_a_queue(run, 44, PR44_HEAD)
    gateway.edit(
        lambda d: next(p for p in d["pullRequests"] if p["number"] == 44).update(branch="fix/perf")
    )
    holder = {"branch": "fix/perf", "machine": "workstation"}
    assert gateway("lane", "issue-claim", repo=REPO, numbers=[103], holder=holder).success
    gateway.edit(
        lambda d: next(p for p in d["pullRequests"] if p["number"] == 44).update(closes=[103])
    )
    assert gateway("lane", "pr-merge", repo=REPO, number=44, head=PR44_HEAD).data["state"] == (
        "queued"
    )
    claims = gateway("lane", "claim-list", repo=REPO).data["claims"]
    assert [claim["number"] for claim in claims] == [103]


def test_cancel_takes_a_pull_request_out_of_the_queue(run):
    gateway = behind_a_queue(run, 44, PR44_HEAD)
    assert gateway("lane", "pr-merge", repo=REPO, number=44, head=PR44_HEAD).success
    cancelled = gateway("lane", "pr-merge", repo=REPO, number=44, head=PR44_HEAD, cancel=True)
    assert cancelled.data == {
        "state": "open",
        "autoMerge": False,
        "changed": True,
        "mergeQueue": {"required": True, "queued": False},
    }
    pull = next(p for p in gateway.github()["pullRequests"] if p["number"] == 44)
    assert pull["mergeQueue"] == {"required": True} and pull["autoMerge"] is False
    # Open, not queued and no auto-merge: what a pull request the queue let go looks like.
    status = gateway("lane", "pr-status", repo=REPO, number=44).data
    assert (status["state"], status["autoMerge"]) == ("open", False)
    assert status["mergeQueue"] == {"required": True, "queued": False}
    again = gateway("lane", "pr-merge", repo=REPO, number=44, head=PR44_HEAD, cancel=True)
    assert again.data["changed"] is False


def test_pr_status_says_why_the_queue_let_a_pull_request_go(run):
    gateway = behind_a_queue(run, 44, PR44_HEAD)
    gone = {"at": "2030-02-03T10:01:00Z", "reason": "failed_checks"}
    gateway.edit(
        lambda d: next(p for p in d["pullRequests"] if p["number"] == 44).update(
            mergeQueue={"required": True, "removed": gone}
        )
    )
    status = gateway("lane", "pr-status", repo=REPO, number=44).data
    assert status["mergeQueue"] == {"required": True, "queued": False, "removed": gone}


def test_cancel_follows_auto_merge_into_the_queue(run, monkeypatch):
    """Auto-merge became a queue entry between the read and the write: cancelling reads again
    and takes it out of the queue, and reports what GitHub then shows."""
    gateway = behind_a_queue(run, 47, PR47_HEAD)
    assert gateway("lane", "pr-merge", repo=REPO, number=47, head=PR47_HEAD).data["autoMerge"]
    disable = FakeGitHub.disable_auto_merge

    def raced(self, repo, number):
        # GitHub turned auto-merge into a queue entry first, so it refuses to turn it off.
        with self._write(repo) as data:
            pull = self._pull(data, number)
            pull.update(autoMerge=False, autoMergeHead=None)
            self._enqueue(pull, PR47_HEAD)
        disable(self, repo, number)

    monkeypatch.setattr(FakeGitHub, "disable_auto_merge", raced)
    cancelled = gateway("lane", "pr-merge", repo=REPO, number=47, head=PR47_HEAD, cancel=True)
    assert cancelled.data == {
        "state": "open",
        "autoMerge": False,
        "changed": True,
        "mergeQueue": {"required": True, "queued": False},
    }
    pull = next(p for p in gateway.github()["pullRequests"] if p["number"] == 47)
    assert pull["mergeQueue"] == {"required": True}


def test_cancel_that_cannot_dequeue_says_it_is_still_queued(run, monkeypatch):
    monkeypatch.setattr(FakeGitHub, "dequeue_pull", lambda self, repo, number: None)
    gateway = behind_a_queue(run, 44, PR44_HEAD)
    assert gateway("lane", "pr-merge", repo=REPO, number=44, head=PR44_HEAD).success
    result = gateway("lane", "pr-merge", repo=REPO, number=44, head=PR44_HEAD, cancel=True)
    assert result.error.code == "STILL_QUEUED" and "pr-status" in result.error.suggestion


def test_a_pull_request_closed_as_it_was_queued_is_not_reported_queued(run, monkeypatch):
    enqueue = FakeGitHub.enqueue_pull

    def closed(self, repo, number, head):
        entry = enqueue(self, repo, number, head)
        with self._write(repo) as data:
            self._pull(data, number).update(state="closed", mergeQueue={"required": True})
        return entry

    monkeypatch.setattr(FakeGitHub, "enqueue_pull", closed)
    gateway = behind_a_queue(run, 44, PR44_HEAD)
    result = gateway("lane", "pr-merge", repo=REPO, number=44, head=PR44_HEAD)
    assert result.error.code == "PR_CLOSED" and "pr-status" in result.error.suggestion


def test_an_enqueue_github_answered_is_reported_though_the_next_read_trails(run, monkeypatch):
    def trailing(self, repo, number, head):
        return {"state": "QUEUED", "position": 3}  # Taken; the read after shows nothing yet.

    monkeypatch.setattr(FakeGitHub, "enqueue_pull", trailing)
    gateway = behind_a_queue(run, 44, PR44_HEAD)
    queued = gateway("lane", "pr-merge", repo=REPO, number=44, head=PR44_HEAD)
    assert queued.data["mergeQueue"] == {
        "required": True,
        "queued": True,
        "state": "QUEUED",
        "position": 3,
    }


def test_auto_merge_github_does_not_show_is_not_reported_queued(run, monkeypatch):
    monkeypatch.setattr(FakeGitHub, "enable_auto_merge", lambda self, *args: None)
    gateway = behind_a_queue(run, 47, PR47_HEAD)
    result = gateway("lane", "pr-merge", repo=REPO, number=47, head=PR47_HEAD)
    assert result.error.code == "NOT_QUEUED" and "pr-merge again" in result.error.suggestion


def test_a_refusal_to_turn_auto_merge_off_is_reported_not_swallowed(run, monkeypatch):
    from botcore_factory.gateway.github import GitHubRefused

    def forbidden(self, repo, number):
        raise GitHubRefused(200, "Resource not accessible by integration")

    gateway = behind_a_queue(run, 47, PR47_HEAD)
    assert gateway("lane", "pr-merge", repo=REPO, number=47, head=PR47_HEAD).data["autoMerge"]
    monkeypatch.setattr(FakeGitHub, "disable_auto_merge", forbidden)
    result = gateway("lane", "pr-merge", repo=REPO, number=47, head=PR47_HEAD, cancel=True)
    assert result.error.code == "STILL_QUEUED"
    assert "Resource not accessible by integration" in result.error.message
    assert result.error.details["refused"] == "Resource not accessible by integration"
    assert "permission" in result.error.suggestion


def test_gateway_status_reports_deterministic_ages_and_graphql_rate_limit_on_every_route(run):
    gateway = run()
    for route in ROUTES:
        result = gateway(route, "gateway-status")
        assert result.success, result
        assert result.data["ages"] == {"appKey": 0, "token": 3600}
        assert "readOnlyToken" not in result.data["ages"]
        assert result.data["rateLimit"] == {
            "remaining": 5000,
            "resetAt": "2030-02-03T11:00:00Z",
            "graphql": {"remaining": 5000, "resetAt": "2030-02-03T11:00:00Z"},
        }


def test_gateway_status_respects_fixture_ages_and_rate_limit_overrides(run):
    gateway = run(
        ages={"appKey": 86400, "token": 1800},
        rateLimit={
            "remaining": 4200,
            "resetAt": "2030-02-03T10:45:00Z",
            "graphql": {"remaining": 3100, "resetAt": "2030-02-03T10:50:00Z"},
        },
    )
    data = gateway("owner", "gateway-status").data
    assert data["ages"] == {"appKey": 86400, "token": 1800}
    assert data["rateLimit"] == {
        "remaining": 4200,
        "resetAt": "2030-02-03T10:45:00Z",
        "graphql": {"remaining": 3100, "resetAt": "2030-02-03T10:50:00Z"},
    }
    rest_only = run(rateLimit={"remaining": 4100, "resetAt": "2030-02-03T10:40:00Z"})
    rest_data = rest_only("cell", "gateway-status").data
    assert rest_data["rateLimit"] == {"remaining": 4100, "resetAt": "2030-02-03T10:40:00Z"}
    assert "graphql" not in rest_data["rateLimit"]
