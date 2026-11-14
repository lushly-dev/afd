"""Events: delivery once per consumer, never resolved by reading, answered by actions."""

from __future__ import annotations

import time

import pytest
from test_commands import failing

from botcore_factory.events import answer, emit


async def test_wait_delivers_each_event_once_per_consumer_with_a_compact_status(make_run):
    run = make_run("ejected")
    first = (await run.call("lane_wait", consumer="foreman", timeout_ms=1000)).data
    [event] = first["events"]
    assert (event["id"], event["type"], event["branch"], event["reason"]) == (
        "ev-7",
        "ejected",
        "fix/parser-empty-input",
        "final-failed",
    )
    assert event["logPath"].startswith("attempts/") and event["open"] is True
    assert event["status"]["queueLength"] == 1 and "canStartCell" in event["status"]
    again = (await run.call("lane_wait", consumer="foreman", timeout_ms=1)).data
    assert again == {"events": [], "timedOut": True}
    other = (await run.call("lane_wait", consumer="observer", timeout_ms=1)).data
    assert [e["id"] for e in other["events"]] == ["ev-7"]
    # Reading resolves nothing.
    assert [e["id"] for e in (await run.call("lane_status")).data["openEvents"]] == ["ev-7"]


async def test_wait_times_out_after_its_timeout(make_run):
    run = make_run()
    started = time.monotonic()
    data = (await run.call("lane_wait", consumer="foreman", timeout_ms=300)).data
    assert data == {"events": [], "timedOut": True}
    assert time.monotonic() - started >= 0.29


async def test_wait_still_delivers_when_github_cannot_be_read(make_run):
    run = make_run("ejected")
    host = run.host(**failing(run, "list_issues"))
    data = (await run.call("lane_wait", host, consumer="foreman", timeout_ms=10)).data
    [event] = data["events"]
    assert "HTTP 502" in event["status"]["unavailable"] and event["status"]["queueLength"] == 1


@pytest.mark.parametrize(
    "arguments", [{"consumer": " ", "timeout_ms": 1}, {"consumer": "foreman", "timeout_ms": -1}]
)
async def test_wait_refuses_a_blank_consumer_or_negative_timeout(make_run, arguments):
    assert (await make_run().call("lane_wait", **arguments)).error.code == "VALIDATION_ERROR"


async def test_event_resolve_records_a_decision(make_run):
    run = make_run("running")
    data = (await run.call("event_resolve", id="ev-12", note="ci-ok passed")).data
    assert data == {"resolved": True, "id": "ev-12", "wasOpen": True}
    event = run.state()["events"][0]
    assert event["open"] is False and event["resolution"]["note"] == "ci-ok passed"
    again = (await run.call("event_resolve", id="ev-12", note="again")).data
    assert again["wasOpen"] is False
    missing = await run.call("event_resolve", id="ev-99", note="x")
    assert missing.error.code == "NOT_FOUND" and "lane-status" in missing.error.suggestion
    blank = await run.call("event_resolve", id="ev-12", note=" ")
    assert blank.error.code == "VALIDATION_ERROR"


async def test_resume_answers_the_lane_error_and_pause_records_why(make_run):
    run = make_run("backlog")
    resumed = (await run.call("lane_resume", reason="Signed in again")).data
    assert resumed == {"paused": False, "resolved": ["ev-41"]}
    state = run.state()
    assert state["lane"]["paused"] is False and state["events"][0]["open"] is False
    paused = (await run.call("lane_pause", reason="Looking at main")).data
    assert paused == {"paused": True, "pauseReason": "Looking at main"}
    assert (await run.call("lane_status")).data["pauseReason"] == "Looking at main"


async def test_registering_a_cell_answers_queue_room(make_run):
    run = make_run(events=[{"id": "ev-1", "type": "queue-room", "open": True}])
    assert (await run.call("cell_register", branch="fix/a", issues=[101], route="r")).success
    assert run.state()["events"][0]["resolution"]["by"] == "cell-register"


def test_event_ids_count_up_past_every_id_seen():
    state = {"events": [{"id": "ev-7"}, {"id": "other"}]}
    assert emit(state, "t", "queue-room")["id"] == "ev-8"
    state["events"].clear()
    assert emit(state, "t", "merged", branch="b")["id"] == "ev-9"  # Never reused.


def test_an_action_answers_only_its_own_events():
    state = {"events": []}
    ejected = emit(state, "t", "ejected", branch="a")
    other = emit(state, "t", "ejected", branch="b")
    error = emit(state, "t", "lane-error")
    assert answer(state, "lane-enqueue", "t2", branch="a") == [ejected["id"]]
    assert other["open"] and error["open"]
    assert answer(state, "lane-resume", "t2") == [error["id"]]
