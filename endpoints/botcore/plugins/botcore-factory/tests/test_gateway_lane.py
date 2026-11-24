"""The lane's health in gateway-status: what ``lane-heartbeat`` keeps, when a lane counts as
stopped, and who may report one. Job 16 walks the main path; these pin its edges."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from conftest import REPO_ROOT

from botcore_factory.gateway import GatewayConfig
from botcore_factory.gateway.commands import ROUTES
from botcore_factory.gateway.github import FakeGitHub
from botcore_factory.gateway.harness import apply_fixture
from botcore_factory.gateway.service import Gateway, Refusal
from botcore_factory.gateway.state import GatewayState

FIXTURES = REPO_ROOT / "docs/features/active/factory-gateway/scenarios/fixtures"
REPO = "example-org/example-repo"
START = datetime(2030, 2, 3, 10, 0, tzinfo=UTC)


class Clock:
    def __init__(self) -> None:
        self.at = START

    def __call__(self) -> datetime:
        return self.at


@pytest.fixture
def world(tmp_path: Path):
    data = json.loads((FIXTURES / "gateway.json").read_text(encoding="utf-8"))
    assert apply_fixture(tmp_path / "run", {"fixture": data}).success
    config = GatewayConfig.model_validate_json((tmp_path / "run/config.json").read_text("utf-8"))
    github = FakeGitHub(tmp_path / "run/github.json", bot=config.bot)
    clock = Clock()
    gateway = Gateway(github, config, GatewayState(tmp_path / "run/state"), "lane", clock)
    return gateway, clock


def lanes(gateway: Gateway) -> list[dict]:
    result = gateway.status("gateway-lane", [])
    assert result.success
    return result.data["lanes"]


def test_a_lane_that_never_reported_is_shown_as_not_running(world):
    gateway, _ = world
    assert lanes(gateway) == [{"repo": REPO, "running": False, "stale": True, "reportedAt": None}]


def test_a_lane_runs_until_its_report_is_five_minutes_old(world):
    gateway, clock = world
    assert gateway.lane_heartbeat(REPO, "build-mac", True, 0, None).success
    clock.at += timedelta(minutes=4, seconds=59)
    assert lanes(gateway)[0]["running"] is True
    clock.at += timedelta(seconds=1)  # laneStaleMinutes (5) since the report.
    lane = lanes(gateway)[0]
    assert lane["running"] is False and lane["stale"] is True
    assert lane["host"] == "build-mac" and lane["reportedAt"] == "2030-02-03T10:00:00Z"


def test_a_fresh_report_of_a_stopped_loop_is_not_running(world):
    gateway, _ = world
    result = gateway.lane_heartbeat(REPO, "build-mac", False, 3, "2030-02-03T09:00:00Z")
    assert result.success
    assert result.data["lane"] == {
        "repo": REPO,
        "host": "build-mac",
        "running": False,
        "stale": False,
        "queued": 3,
        "lastMergeAt": "2030-02-03T09:00:00Z",
        "reportedAt": "2030-02-03T10:00:00Z",
    }


def test_the_stale_threshold_is_configurable(world, tmp_path):
    gateway, clock = world
    config = gateway.config.model_copy(update={"lane_stale_minutes": 1})
    short = Gateway(gateway.github, config, gateway.state, "lane", clock)
    assert short.lane_heartbeat(REPO, "build-mac", True, 0, None).success
    clock.at += timedelta(minutes=1)
    assert lanes(short)[0]["running"] is False


@pytest.mark.parametrize(
    ("repo", "last_merge_at", "code"),
    [
        ("other-org/other-repo", None, "REPO_NOT_ALLOWED"),
        (REPO, "yesterday", "VALIDATION_ERROR"),
        (REPO, "2030-02-03T09:00:00", "VALIDATION_ERROR"),  # No zone.
    ],
)
def test_a_report_the_gateway_cannot_keep_is_refused(world, repo, last_merge_at, code):
    gateway, _ = world
    with pytest.raises(Refusal) as refused:
        gateway.lane_heartbeat(repo, "build-mac", True, 0, last_merge_at)
    error = refused.value.result.error
    assert error and error.code == code and error.suggestion
    assert lanes(gateway)[0]["reportedAt"] is None


def test_only_the_lane_the_owner_and_the_heartbeat_route_report_a_lane():
    serving = {route for route, commands in ROUTES.items() if "lane-heartbeat" in commands}
    assert serving == {"lane", "owner", "heartbeat"}
    assert ROUTES["heartbeat"] == ("gateway-status", "lane-heartbeat")


def test_a_second_running_host_is_shown_beside_the_first(world):
    gateway, clock = world
    assert gateway.lane_heartbeat(REPO, "build-mac", True, 0, None).success
    clock.at += timedelta(minutes=1)
    lane = gateway.lane_heartbeat(REPO, "spare-mac", True, 0, None).data["lane"]
    assert lane["host"] == "spare-mac" and lane["running"] is True
    assert lane["otherHosts"] == [{"host": "build-mac", "reportedAt": "2030-02-03T10:00:00Z"}]
    clock.at += timedelta(minutes=5)  # build-mac fell silent five minutes ago.
    assert "otherHosts" not in lanes(gateway)[0]


def test_a_clean_move_to_another_host_is_not_two_lanes(world):
    gateway, clock = world
    assert gateway.lane_heartbeat(REPO, "build-mac", False, 0, None).success  # Stopped.
    clock.at += timedelta(minutes=1)
    lane = gateway.lane_heartbeat(REPO, "spare-mac", True, 0, None).data["lane"]
    assert lane["host"] == "spare-mac" and lane["running"] is True
    assert "otherHosts" not in lane


def test_a_stopped_host_cannot_hide_a_running_one(world):
    gateway, clock = world
    assert gateway.lane_heartbeat(REPO, "build-mac", True, 3, None).success
    clock.at += timedelta(minutes=1)
    lane = gateway.lane_heartbeat(REPO, "stray-mac", False, 0, None).data["lane"]
    assert lane["host"] == "build-mac" and lane["running"] is True and lane["queued"] == 3
    clock.at += timedelta(minutes=5)  # build-mac stopped reporting: the newest report shows.
    lane = lanes(gateway)[0]
    assert lane["host"] == "stray-mac" and lane["running"] is False


def test_a_report_from_the_future_does_not_vouch_for_now(world):
    gateway, clock = world
    assert gateway.lane_heartbeat(REPO, "build-mac", True, 0, None).success
    clock.at -= timedelta(minutes=1)  # The gateway's clock moved back.
    lane = lanes(gateway)[0]
    assert lane["running"] is False and lane["stale"] is True


def test_last_merge_at_is_kept_in_utc(world):
    gateway, _ = world
    lane = gateway.lane_heartbeat(REPO, "build-mac", True, 0, "2030-02-03T11:30:00+02:00")
    assert lane.data["lane"]["lastMergeAt"] == "2030-02-03T09:30:00Z"


def test_a_heartbeat_spends_no_budget_and_stays_out_of_the_journal(tmp_path):
    from botcore_factory.gateway.harness import call
    from botcore_factory.gateway.state import read_journal

    data = json.loads((FIXTURES / "gateway.json").read_text(encoding="utf-8"))
    run = tmp_path / "run"
    assert apply_fixture(run, {"fixture": data}).success
    beat = {"repo": REPO, "host": "build-mac", "running": True, "queued": 0}
    for _ in range(3):
        assert call("lane-heartbeat", beat, run, "lane").success
    state = json.loads((run / "state/state.json").read_text("utf-8"))
    assert state["writes"] == []
    assert not (run / "state/state.json.partial").exists()
    assert all(entry.command != "lane-heartbeat" for entry in read_journal(run / "state/journal"))
    audit = call("gateway-audit", {"repo": REPO}, run, "owner")
    assert audit.success
    assert all(row.get("command") != "lane-heartbeat" for row in audit.data["entries"])
    refused = call("lane-heartbeat", {**beat, "queued": -1}, run, "lane")
    assert refused.error and refused.error.code == "VALIDATION_ERROR"
    assert call("lane-heartbeat", beat, run, "cell").error.code in {
        "COMMAND_NOT_FOUND",
        "FORBIDDEN",
    }
    for host in ("", "   ", "build\nmac"):
        blank = call("lane-heartbeat", {**beat, "host": host}, run, "lane")
        assert blank.error and blank.error.code == "VALIDATION_ERROR", host
    secret = call("lane-heartbeat", {**beat, "host": "ghp_" + "a" * 36}, run, "lane")
    assert secret.error and secret.error.code == "SECRET_IN_BODY"


def test_each_served_repository_has_its_own_lane(world):
    gateway, clock = world
    other = "example-org/second-repo"
    config = gateway.config.model_copy(update={"repositories": [REPO, other]})
    two = Gateway(gateway.github, config, gateway.state, "lane", clock)
    assert two.lane_heartbeat(other, "build-mac", True, 4, None).success
    shown = lanes(two)
    assert [lane["repo"] for lane in shown] == [REPO, other]
    assert shown[0]["reportedAt"] is None and shown[1]["queued"] == 4


def test_the_stale_threshold_must_be_finite():
    from pydantic import ValidationError

    data = json.loads((FIXTURES / "gateway.json").read_text(encoding="utf-8"))
    fields = {key: data[key] for key in ("bot", "owner", "repositories", "ownerEmails")}
    with pytest.raises(ValidationError):
        GatewayConfig.model_validate({**fields, "laneStaleMinutes": float("inf")})


def test_a_report_a_week_old_is_dropped_when_read_and_when_written(world):
    gateway, clock = world
    assert gateway.lane_heartbeat(REPO, "old-mac", True, 0, None).success
    clock.at += timedelta(days=6, hours=23)
    assert lanes(gateway)[0]["host"] == "old-mac"  # Shown, stopped, for a week.
    clock.at += timedelta(hours=1)
    assert lanes(gateway)[0]["reportedAt"] is None  # A week on, as if it never reported.
    assert gateway.lane_heartbeat(REPO, "new-mac", True, 0, None).success
    assert list(gateway.state.get("lanes")[REPO]) == ["new-mac"]
