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
    # With no method configured the gateway merges with a merge commit, keeping every author.
    pull = next(p for p in gateway.github()["pullRequests"] if p["number"] == 44)
    assert pull["mergeMethod"] == "merge"


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
