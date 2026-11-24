"""A validation the gateway recorded counts at once (#2401): GitHub's list of check runs can miss
a run created a second earlier, so ``pr-merge`` right after ``verification-record`` must not
read the list alone. The fake GitHub here hides check runs the way GitHub's lag does."""

from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path

import pytest
from conftest import REPO_ROOT

from botcore_factory.gateway import GatewayConfig
from botcore_factory.gateway.claims import iso
from botcore_factory.gateway.github import FakeGitHub
from botcore_factory.gateway.harness import apply_fixture
from botcore_factory.gateway.service import Gateway, Refusal
from botcore_factory.gateway.state import GatewayState

FIXTURES = REPO_ROOT / "docs/features/active/factory-gateway/scenarios/fixtures"
REPO = "example-org/example-repo"
PR47_HEAD = "6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c"


class Lagging:
    """A port whose check-runs list, after ``lag``, shows only the runs it listed before."""

    def __init__(self, inner: FakeGitHub) -> None:
        self.inner = inner
        self.hidden = False
        self.shown: dict[str, int] = {}

    def __getattr__(self, name: str):
        return getattr(self.inner, name)

    def lag(self) -> None:
        """From now on, list no run created after this call."""
        self.hidden = True

    def check_runs(self, repo: str, head: str):
        runs = self.inner.check_runs(repo, head)
        if not self.hidden:
            self.shown[head] = len(runs)
        return runs[: self.shown.get(head, 0)] if self.hidden else runs


@pytest.fixture
def world(tmp_path: Path):
    data = json.loads((FIXTURES / "gateway.json").read_text(encoding="utf-8"))
    assert apply_fixture(tmp_path / "run", {"fixture": data}).success
    config = GatewayConfig.model_validate_json((tmp_path / "run/config.json").read_text("utf-8"))
    github = Lagging(FakeGitHub(tmp_path / "run/github.json", bot=config.bot))
    state = GatewayState(tmp_path / "run/state")
    return Gateway(github, config, state, "lane"), github, tmp_path / "run/state"


def verifications(github: Lagging) -> list[str | None]:
    """The conclusions GitHub lists for PR 47's head's ``factory/verification`` runs."""
    runs = github.check_runs(REPO, PR47_HEAD)
    return [run.get("conclusion") for run in runs if run["name"] == "factory/verification"]


def record(gateway: Gateway, result: str):
    return gateway.verification_record(REPO, PR47_HEAD, result, "pnpm verify")


def test_a_merge_right_after_its_record_is_not_refused(world):
    gateway, github, _ = world
    github.check_runs(REPO, PR47_HEAD)
    github.lag()
    assert record(gateway, "passed").success
    assert verifications(github) == []  # GitHub has not listed the run yet.
    result = gateway.pr_merge(REPO, 47, PR47_HEAD, False)
    assert result.success, result.error
    assert result.data["state"] in {"merged", "queued"}


def test_a_failed_record_wins_over_a_pass_github_still_lists(world):
    gateway, github, _ = world
    assert record(gateway, "passed").success
    github.check_runs(REPO, PR47_HEAD)
    github.lag()
    assert record(gateway, "failed").success
    assert verifications(github) == ["success"]  # GitHub's list still shows only the pass.
    with pytest.raises(Refusal) as refused:
        gateway.pr_merge(REPO, 47, PR47_HEAD, False)
    error = refused.value.result.error
    assert error and error.code == "VALIDATION_MISSING"


def test_github_answers_for_a_head_the_gateway_kept_no_record_of(world):
    gateway, github, _ = world
    assert not gateway.validated(REPO, PR47_HEAD)
    github.inner.create_check_run(
        REPO, PR47_HEAD, {"name": "factory/verification", "conclusion": "success"}
    )
    assert gateway.validated(REPO, PR47_HEAD)


def test_the_record_survives_a_restart_and_ignores_case(world):
    gateway, github, directory = world
    github.check_runs(REPO, PR47_HEAD)
    github.lag()
    assert record(gateway, "passed").success
    again = Gateway(github, gateway.config, GatewayState(directory), "lane")
    assert again.validated(REPO.upper(), PR47_HEAD.upper())


def test_records_older_than_a_week_are_dropped_on_the_next_record(world):
    gateway, _, directory = world
    state = GatewayState(directory)
    state.put(
        "verifications",
        {
            "example-org/example-repo@" + "0" * 40: {
                "conclusion": "success",
                "at": "2000-01-01T00:00:00Z",
            }
        },
    )
    fresh = Gateway(gateway.github, gateway.config, state, "lane")
    assert record(fresh, "passed").success
    assert list(state.get("verifications")) == [f"{REPO}@{PR47_HEAD}"]


@pytest.mark.parametrize(("days", "decides"), [(6.9, True), (7, False)])
def test_a_record_decides_for_a_week_then_github_answers(world, days, decides):
    gateway, _, _ = world
    at = gateway.now() - timedelta(days=days)
    gateway.state.put(
        "verifications",
        {f"{REPO}@{PR47_HEAD}": {"conclusion": "success", "at": iso(at)}},
    )
    # GitHub lists no verification for the head, so only the record can pass it.
    assert gateway.validated(REPO, PR47_HEAD) is decides


def test_a_failure_is_kept_even_when_github_refuses_its_check_run(world, monkeypatch):
    gateway, github, _ = world
    assert record(gateway, "passed").success

    def refused(*_args, **_kwargs):
        raise RuntimeError("GitHub refused the check run")

    monkeypatch.setattr(github.inner, "create_check_run", refused)
    with pytest.raises(RuntimeError):
        record(gateway, "failed")
    assert not gateway.validated(REPO, PR47_HEAD)
