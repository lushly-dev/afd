"""Issue types and parents through the gateway (#2729): issue-create's type and parent, and
issue-set, against the fake GitHub. Job 17 walks the path; these tests pin its edges."""

from __future__ import annotations

import pytest
from test_gateway_routes import REPO, Run, fixture

from botcore_factory.gateway.github import FakeGitHub, GitHubRefused
from botcore_factory.gateway.state import read_journal


@pytest.fixture
def run(tmp_path):
    def make(**overrides) -> Run:
        return Run(tmp_path / "run", fixture(**overrides))

    return make


def issue(gateway: Run, number: int) -> dict:
    return next(i for i in gateway.github()["issues"] if i["number"] == number)


def test_issue_set_is_the_foreman_s_and_the_owner_s_only(run):
    gateway = run()
    for route in ("foreman", "owner"):
        assert gateway(route, "issue-set", repo=REPO, number=101, type="Task").success
    for route in ("lane", "cell", "session", "heartbeat"):
        result = gateway(route, "issue-set", repo=REPO, number=101, type="Task")
        assert not result.success and result.error.code != "TYPE_UNKNOWN", route


def test_issue_set_needs_a_field_and_an_issue(run):
    gateway = run()
    empty = gateway("foreman", "issue-set", repo=REPO, number=101)
    assert empty.error.code == "VALIDATION_ERROR" and "null" in empty.error.suggestion
    missing = gateway("foreman", "issue-set", repo=REPO, number=999, type="Task")
    assert missing.error.code == "NOT_FOUND"


def test_a_field_left_out_is_kept_and_null_clears_it(run):
    gateway = run()
    gateway.edit(lambda d: issue_in(d, 102).update(type="Bug", parent=101))
    typed = gateway("foreman", "issue-set", repo=REPO, number=102, type="task")
    # The organization's spelling, whatever case was asked; the parent is untouched.
    assert typed.data == {
        "type": "Task",
        "parent": 101,
        "previous": {"type": "Bug", "parent": 101},
        "changed": True,
    }
    cleared = gateway("foreman", "issue-set", repo=REPO, number=102, type=None)
    assert (cleared.data["type"], cleared.data["parent"]) == (None, 101)
    assert (issue(gateway, 102)["type"], issue(gateway, 102)["parent"]) == (None, 101)
    again = gateway("foreman", "issue-set", repo=REPO, number=102, type=None)
    assert again.data["changed"] is False and "as it was" in again.reasoning


def issue_in(data: dict, number: int) -> dict:
    return next(i for i in data["issues"] if i["number"] == number)


def test_an_unknown_type_is_refused_with_the_types_there_are(run):
    gateway = run()
    result = gateway("foreman", "issue-set", repo=REPO, number=101, type="Story")
    assert result.error.code == "TYPE_UNKNOWN"
    assert result.error.details["types"] == ["Bug", "Feature", "Task", "Epic"]
    assert "Bug, Feature, Task, Epic" in result.error.suggestion
    bare = run(issueTypes=[])
    result = bare("foreman", "issue-set", repo=REPO, number=101, type="Epic")
    assert result.error.code == "TYPE_UNKNOWN" and "no issue types" in result.error.suggestion


def test_a_refused_filing_files_nothing(run):
    gateway = run()
    before = gateway.github()
    for extra, code in (({"type": "Epik"}, "TYPE_UNKNOWN"), ({"parent": 999}, "PARENT_NOT_FOUND")):
        result = gateway("foreman", "issue-create", repo=REPO, title="T", body="B", **extra)
        assert result.error.code == code
    # A pull request is not an issue, so it cannot be a parent either.
    result = gateway("foreman", "issue-create", repo=REPO, title="T", body="B", parent=47)
    assert result.error.code == "PARENT_NOT_FOUND"
    assert gateway.github() == before


def test_an_issue_is_not_its_own_ancestor_and_a_refusal_changes_nothing(run):
    gateway = run()
    assert gateway("foreman", "issue-set", repo=REPO, number=102, parent=101).success
    result = gateway("foreman", "issue-set", repo=REPO, number=101, type="Epic", parent=102)
    assert result.error.code == "GITHUB_REFUSED"
    # The attach runs first, so its refusal leaves the type unwritten too.
    assert (issue(gateway, 101).get("parent"), issue(gateway, 101).get("type")) == (None, None)


@pytest.mark.parametrize("dedupe_key", [None, "part-9"])
def test_an_attach_github_does_not_answer_names_the_issue_it_filed(run, monkeypatch, dedupe_key):
    """Repeating the filing is safe only with a dedupe_key; without one it files a second
    issue, so that answer alone is not retryable."""
    from botcore_factory.gateway.github import GitHubUnavailable

    def silent(self, repo, parent, child):
        raise GitHubUnavailable("GitHub answered 503")

    gateway = run()
    filing = {"repo": REPO, "title": "Part", "body": "B", "parent": 101}
    filing |= {"dedupe_key": dedupe_key} if dedupe_key else {}
    monkeypatch.setattr(FakeGitHub, "add_sub_issue", silent)
    result = gateway("foreman", "issue-create", **filing)
    assert result.error.code == "GITHUB_UNAVAILABLE"
    assert bool(result.error.retryable) is bool(dedupe_key)
    assert result.error.details == {"number": 105, "parent": 101}
    assert "Do not file a new issue" in result.error.suggestion
    assert ("same dedupe_key" in result.error.suggestion) is bool(dedupe_key)
    if dedupe_key:  # The retry the answer allows only attaches.
        monkeypatch.undo()
        again = gateway("foreman", "issue-create", **filing)
        assert (again.data["number"], again.data["created"], again.data["parent"]) == (
            105,
            False,
            101,
        )
        assert len(gateway.github()["issues"]) == 6


def test_an_attach_github_refuses_names_the_issue_and_a_retry_finishes_it(run, monkeypatch):
    gateway = run()
    attach = FakeGitHub.add_sub_issue

    def refused(self, repo, parent, child):
        raise GitHubRefused(422, "Parent cannot have more than 100 sub-issues")

    monkeypatch.setattr(FakeGitHub, "add_sub_issue", refused)
    filing = {"repo": REPO, "title": "Part", "body": "B", "parent": 101, "dedupe_key": "part-1"}
    result = gateway("foreman", "issue-create", **filing)
    assert result.error.code == "GITHUB_REFUSED"
    assert result.error.details == {"number": 105, "parent": 101}
    assert "repeat this issue-create with one" in result.error.suggestion
    assert issue(gateway, 105)["parent"] is None  # Filed, not attached.
    monkeypatch.setattr(FakeGitHub, "add_sub_issue", attach)
    retried = gateway("foreman", "issue-create", **filing)
    assert retried.data == {"number": 105, "created": False, "type": None, "parent": 101}
    assert "finished filing it" in retried.reasoning
    assert issue(gateway, 105)["parent"] == 101


def test_a_filing_with_a_parent_spends_both_writes_before_the_first(run):
    gateway = run(writesPerHour={"foreman": 1})
    before = gateway.github()
    result = gateway("foreman", "issue-create", repo=REPO, title="T", body="B", parent=101)
    assert result.error.code == "WRITE_BUDGET_EXCEEDED"
    assert gateway.github() == before  # Refused whole: no issue filed unattached.


def test_a_retry_whose_attach_github_refuses_names_the_issue(run, monkeypatch):
    gateway = run()
    filing = {"repo": REPO, "title": "Part", "body": "B", "dedupe_key": "part-2"}
    assert gateway("foreman", "issue-create", **filing).data["number"] == 105

    def full(self, repo, parent, child):
        raise GitHubRefused(422, "Parent cannot have more than 100 sub-issues")

    monkeypatch.setattr(FakeGitHub, "add_sub_issue", full)
    result = gateway("foreman", "issue-create", **filing, parent=101)
    assert result.error.code == "GITHUB_REFUSED"
    assert result.error.details == {"number": 105, "parent": 101}
    assert "Issue 105 is filed" in result.error.message
    assert "a parent GitHub accepts" in result.error.suggestion


def test_a_retry_sets_only_what_the_issue_lacks(run):
    gateway = run()
    filing = {"repo": REPO, "title": "Epic", "body": "B", "dedupe_key": "epic-1"}
    assert gateway("foreman", "issue-create", **filing).data["type"] is None
    typed = gateway("foreman", "issue-create", **filing, type="Epic")
    assert typed.data == {"number": 105, "created": False, "type": "Epic", "parent": None}
    # A type it already has is not changed by a retry that asks for another.
    other = gateway("foreman", "issue-create", **filing, type="Task")
    assert other.data["type"] == "Epic" and "finished" not in other.reasoning


def test_issue_get_reports_the_type_parent_and_sub_issues(run):
    gateway = run()
    plain = gateway("session", "issue-get", repo=REPO, number=101).data
    assert plain["subIssues"] == {"total": 0} and "type" not in plain and "parent" not in plain
    assert gateway("foreman", "issue-set", repo=REPO, number=101, type="Epic").success
    assert gateway("foreman", "issue-set", repo=REPO, number=102, parent=101).success
    assert gateway("foreman", "issue-set", repo=REPO, number=103, parent=101).success
    epic = gateway("session", "issue-get", repo=REPO, number=101).data
    assert (epic["type"], epic["subIssues"]) == ("Epic", {"total": 2})
    assert gateway("cell", "issue-get", repo=REPO, number=102).data["parent"] == 101


def test_a_parent_in_another_repository_is_replaced_but_not_detached_here(run):
    gateway = run()
    gateway.edit(lambda d: issue_in(d, 102).update(parent="example-org/other#7"))
    result = gateway("foreman", "issue-set", repo=REPO, number=102, parent=None)
    assert result.error.code == "PARENT_IN_OTHER_REPO" and "replaces" in result.error.suggestion
    moved = gateway("foreman", "issue-set", repo=REPO, number=102, parent=101)
    assert moved.data["previous"]["parent"] == "example-org/other#7"
    assert issue(gateway, 102)["parent"] == 101


def test_issue_set_counts_each_write_and_is_journaled(run, tmp_path):
    gateway = run(writesPerHour={"foreman": 3})
    both = gateway("foreman", "issue-set", repo=REPO, number=102, type="Task", parent=101)
    assert both.success
    budget = gateway("foreman", "issue-set", repo=REPO, number=103, type="Task", parent=101)
    assert budget.error.code == "WRITE_BUDGET_EXCEEDED"
    assert issue(gateway, 103).get("type") is None  # Refused whole, before either write.
    entries = read_journal(tmp_path / "run" / "state" / "journal")
    assert [(e.command, e.result["success"]) for e in entries] == [
        ("issue-set", True),
        ("issue-set", False),
    ]
    audit = gateway("owner", "gateway-audit", repo=REPO, issue=102).data["entries"]
    assert [row["command"] for row in audit] == ["issue-set"]
