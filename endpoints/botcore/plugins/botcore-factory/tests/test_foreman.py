"""One foreman per lane (lushly-dev/afd#1432): the lease a foreman's session takes, renews and
hands over, and the refusal another session gets while it is live."""

from __future__ import annotations

import asyncio

import pytest

from botcore_factory import cells, events, foreman, status
from botcore_factory.runtime import Refusal

START = "2030-01-01T00:00:00Z"


def lease(run) -> dict | None:
    return run.state()["lane"].get("foreman")


async def test_the_first_foreman_holds_the_lane_and_a_second_is_refused(make_run):
    run = make_run()
    first = await run.call("lane_wait", consumer="foreman", timeout_ms=1, session="thread-a")
    assert first.success
    assert lease(run) == {"session": "thread-a", "since": START, "until": "2030-01-01T00:30:00Z"}

    for command, arguments in [
        ("lane_wait", {"consumer": "foreman", "timeout_ms": 1}),
        ("dial_set", {"key": "lane.queueMax", "value": 4}),
        ("cell_register", {"issues": [101], "branch": "fix/a", "route": "sol/high"}),
    ]:
        refused = await run.call(command, **arguments, session="thread-b")
        assert refused.error.code == "FOREMAN_BUSY", command
        assert refused.error.details == {"holder": "thread-a", "until": "2030-01-01T00:30:00Z"}
        assert "foreman-handoff" in refused.error.suggestion
    assert lease(run)["session"] == "thread-a"
    assert run.state()["dials"]["lane.queueMax"] == 10  # The refused dial-set wrote nothing.


async def test_a_foreman_command_without_a_session_is_refused_while_another_holds(make_run):
    run = make_run()
    await run.call("lane_wait", consumer="foreman", timeout_ms=1, session="thread-a")
    unnamed = await run.call("lane_wait", consumer="foreman", timeout_ms=1)
    assert unnamed.error.code == "FOREMAN_BUSY"
    # The owner sets a dial by hand, naming no session; other consumers are not the foreman's.
    assert (await run.call("dial_set", key="lane.queueMax", value=4)).success
    assert (await run.call("lane_wait", consumer="observer", timeout_ms=1)).success
    assert (await run.call("lane_status")).data["foreman"]["session"] == "thread-a"


async def test_without_a_lease_calls_that_name_no_session_work_as_before(make_run):
    run = make_run()
    assert (await run.call("dial_set", key="lane.queueMax", value=4)).success
    assert (await run.call("lane_wait", consumer="foreman", timeout_ms=1)).success
    assert lease(run) is None


async def test_the_holder_renews_its_lease_and_keeps_its_start(make_run):
    run = make_run()
    await run.call("lane_wait", consumer="foreman", timeout_ms=1, session="thread-a")
    run.change_world(now="2030-01-01T00:20:00Z")
    assert (await run.call("dial_set", key="lane.queueMax", value=4, session="thread-a")).success
    assert lease(run) == {"session": "thread-a", "since": START, "until": "2030-01-01T00:50:00Z"}


async def test_an_expired_lease_lets_the_next_session_in(make_run):
    run = make_run()
    await run.call("lane_wait", consumer="foreman", timeout_ms=1, session="thread-a")
    run.change_world(now="2030-01-01T00:31:00Z")
    taken = await run.call("lane_wait", consumer="foreman", timeout_ms=1, session="thread-b")
    assert taken.success
    assert lease(run)["session"] == "thread-b" and lease(run)["since"] == "2030-01-01T00:31:00Z"


async def test_a_handoff_frees_the_lane_only_from_its_holder_or_once_it_ran_out(make_run):
    run = make_run()
    await run.call("lane_wait", consumer="foreman", timeout_ms=1, session="thread-a")
    other = await run.call("foreman_handoff", session="thread-b")
    assert other.error.code == "NOT_FOREMAN" and lease(run)["session"] == "thread-a"
    released = await run.call("foreman_handoff", session="thread-a")
    assert released.data["released"]["session"] == "thread-a" and lease(run) is None
    assert (await run.call("foreman_handoff", session="thread-a")).data == {"released": None}
    assert (
        await run.call("lane_wait", consumer="foreman", timeout_ms=1, session="thread-b")
    ).success

    run.change_world(now="2030-01-01T01:00:00Z")  # thread-b's lease has run out.
    assert (await run.call("foreman_handoff", session="thread-c")).data["released"]["session"] == (
        "thread-b"
    )


async def test_a_waiting_foreman_renews_its_lease_once_half_of_it_is_left(make_run):
    run = make_run()
    await run.call("lane_wait", consumer="foreman", timeout_ms=1, session="thread-a")
    factory = run.factory()
    run.change_world(now="2030-01-01T00:10:00Z")
    foreman.renew(factory, "thread-a")
    assert lease(run)["until"] == "2030-01-01T00:30:00Z"  # 20 minutes left: kept as is.
    run.change_world(now="2030-01-01T00:16:00Z")
    foreman.renew(run.factory(), "thread-a")
    assert lease(run)["until"] == "2030-01-01T00:46:00Z"
    foreman.renew(run.factory(), "thread-b")  # Not the holder: nothing.
    assert lease(run)["session"] == "thread-a"


async def test_only_a_wait_with_a_timeout_keeps_the_lease(make_run):
    """A wait left behind by a session that has ended must not hold the lane for ever."""
    run = make_run()
    factory = run.factory()
    assert foreman.waiting(factory, "foreman", "thread-a", None) is None
    assert lease(run)["session"] == "thread-a"  # Held, though not kept while waiting.
    assert foreman.waiting(factory, "foreman", "thread-a", 1000) is not None
    assert foreman.waiting(factory, "observer", "thread-a", 1000) is None


async def test_the_refusal_sends_the_session_to_the_owner(make_run):
    run = make_run()
    await run.call("lane_wait", consumer="foreman", timeout_ms=1, session="thread-a")
    refused = await run.call("lane_wait", consumer="foreman", timeout_ms=1, session="thread-b")
    assert "tell the owner" in refused.error.suggestion


async def test_an_empty_session_is_refused(make_run):
    run = make_run()
    result = await run.call("lane_wait", consumer="foreman", timeout_ms=1, session=" ")
    assert result.error.code == "VALIDATION_ERROR"


async def test_a_superseded_session_is_refused_even_with_no_lease_held(make_run):
    """lushly-dev/afd#1595: a scheduled foreman that woke after a usage-limit reset took an
    expired lease and acted on an outdated brief after a newer foreman had done the work."""
    run = make_run()
    await run.call("lane_wait", consumer="foreman", timeout_ms=1, session="thread-a")
    run.change_world(now="2030-01-01T00:31:00Z")  # thread-a's lease has run out.
    await run.call("lane_wait", consumer="foreman", timeout_ms=1, session="thread-b")
    assert (await run.call("foreman_handoff", session="thread-b")).success

    run.change_world(now="2030-01-02T03:30:00Z")  # thread-a wakes hours later.
    for command, arguments in [
        ("lane_wait", {"consumer": "foreman", "timeout_ms": 1}),
        ("dial_set", {"key": "lane.queueMax", "value": 4}),
        ("cell_register", {"issues": [101], "branch": "fix/a", "route": "sol/high"}),
        ("ejection_excuse", {"branch": "fix/a", "reason": "a flake"}),
    ]:
        refused = await run.call(command, **arguments, session="thread-a")
        assert refused.error.code == "FOREMAN_STALE", command
        assert refused.error.details == {"supersededBy": "thread-b", "at": "2030-01-01T00:31:00Z"}
        assert "Stop here and report" in refused.error.suggestion
    assert lease(run) is None  # It took nothing.
    assert run.state()["dials"]["lane.queueMax"] == 10


async def test_a_handoff_supersedes_the_session_that_handed_over(make_run):
    run = make_run()
    await run.call("lane_wait", consumer="foreman", timeout_ms=1, session="thread-a")
    await run.call("foreman_handoff", session="thread-a")
    assert (
        await run.call("lane_wait", consumer="foreman", timeout_ms=1, session="thread-b")
    ).success
    run.change_world(now="2030-01-01T02:00:00Z")
    refused = await run.call("lane_wait", consumer="foreman", timeout_ms=1, session="thread-a")
    assert refused.error.code == "FOREMAN_STALE"
    # The newer session itself is not superseded, and comes back after its lease ran out.
    assert (
        await run.call("lane_wait", consumer="foreman", timeout_ms=1, session="thread-b")
    ).success


def test_the_longest_superseded_sessions_are_forgotten_first(monkeypatch):
    monkeypatch.setattr(foreman, "SUPERSEDED_KEPT", 2)
    lane: dict = {}
    # Keys sort in the opposite order to time, as the state file writes them.
    for previous, session, at in [("z", "y", "1"), ("y", "b", "2"), ("b", "a", "3")]:
        foreman._supersede(lane, previous, session, at)
    assert set(lane["supersededForemen"]) == {"y", "b"}


async def test_a_wait_left_open_by_a_superseded_session_leaves_the_event_to_its_successor(
    make_run,
):
    """lushly-dev/afd#1633: A waits, hands over to B, and an event arrives while A's wait is still
    open: the session is checked again where events are marked delivered, so B gets it."""
    run = make_run()
    waiting_a = asyncio.create_task(
        run.call("lane_wait", consumer="foreman", timeout_ms=5000, session="thread-a")
    )
    await asyncio.sleep(0.3)  # A's wait is polling.
    assert (await run.call("foreman_handoff", session="thread-a")).success
    took = await run.call("lane_wait", consumer="foreman", timeout_ms=1, session="thread-b")
    assert took.data == {"events": [], "timedOut": True}
    with run.store.update("an event arrives") as state:
        events.emit(state, START, "queue-room", detail="A seat is free")

    refused = await waiting_a
    assert refused.error.code == "FOREMAN_STALE"
    [event] = run.state()["events"]
    assert event["deliveredTo"] == []
    got = await run.call("lane_wait", consumer="foreman", timeout_ms=1, session="thread-b")
    assert [e["id"] for e in got.data["events"]] == [event["id"]]


def queued_cell(run, branch: str = "fix/a") -> None:
    with run.store.update("a cell") as state:
        state["cells"].append({"branch": branch, "issues": [101], "state": "working"})


def guarded_args(command: str) -> dict:
    """gate-allow names the head it covers; lane-drop takes none."""
    arguments = {"branch": "fix/a", "reason": "why"}
    return {**arguments, "head": "abc"} if command == "gate_allow" else arguments


async def test_gate_allow_and_lane_drop_are_guarded_as_ejection_excuse_is(make_run):
    run = make_run()
    queued_cell(run)
    await run.call("lane_wait", consumer="foreman", timeout_ms=1, session="thread-a")
    for command, code in (("gate_allow", "FOREMAN_REQUIRED"), ("lane_drop", "FOREMAN_BUSY")):
        busy = await run.call(command, **guarded_args(command), session="thread-b")
        assert busy.error.code == code, command
    assert (await run.call("foreman_handoff", session="thread-a")).success
    await run.call("lane_wait", consumer="foreman", timeout_ms=1, session="thread-b")
    for command in ("gate_allow", "lane_drop"):
        stale = await run.call(command, **guarded_args(command), session="thread-a")
        assert stale.error.code == "FOREMAN_STALE", command
    assert "gateAllowed" not in run.state()["cells"][0]
    # The holder may; lane-drop also takes the owner's call, which names no session.
    allowed = await run.call(
        "gate_allow", branch="fix/a", reason="why", session="thread-b", head="abc"
    )
    assert allowed.success
    assert (await run.call("lane_drop", branch="fix/a", reason="owner's call")).success


async def test_a_mutation_whose_session_lost_the_lane_meanwhile_does_nothing(make_run):
    """The session is checked inside the mutation's own transaction, not only before it."""
    run = make_run()
    queued_cell(run)
    factory = run.factory()
    guard = foreman.acting(factory, "thread-a", "gate-allow")  # A holds the lane here.
    await run.call("foreman_handoff", session="thread-a")
    await run.call("lane_wait", consumer="foreman", timeout_ms=1, session="thread-b")
    with pytest.raises(Refusal) as refused:
        cells.gate_allow(factory, "fix/a", "why", guard, "abc")
    assert refused.value.code == "FOREMAN_STALE"
    assert "gateAllowed" not in run.state()["cells"][0]
    with pytest.raises(Refusal) as busy:
        status.dial_set(factory, "lane.queueMax", 4, "thread-c")
    assert busy.value.code == "FOREMAN_BUSY"
    with run.store.update("test") as state, pytest.raises(Refusal) as unnamed:
        foreman.check(state, None, "dial-set", factory.world.clock.now())
    assert unnamed.value.code == "FOREMAN_BUSY"


async def test_a_wait_whose_lease_was_handed_over_takes_nothing_before_a_successor_comes(
    make_run,
):
    """The check inside the delivery never takes the lane: a handed-over wait is refused."""
    run = make_run()
    waiting_a = asyncio.create_task(
        run.call("lane_wait", consumer="foreman", timeout_ms=5000, session="thread-a")
    )
    await asyncio.sleep(0.3)
    assert (await run.call("foreman_handoff", session="thread-a")).success
    with run.store.update("an event arrives") as state:
        events.emit(state, START, "queue-room", detail="A seat is free")
    refused = await waiting_a
    assert refused.error.code == "FOREMAN_LOST" and refused.error.suggestion
    assert run.state()["events"][0]["deliveredTo"] == [] and lease(run) is None


@pytest.mark.parametrize(
    ("command", "arguments"),
    [
        ("cell_register", {"issues": [101], "branch": "fix/b", "route": "sol/high"}),
        ("dial_set", {"key": "lane.queueMax", "value": 4}),
        ("ejection_excuse", {"branch": "fix/a", "reason": "a flake"}),
        ("gate_allow", {"branch": "fix/a", "reason": "why", "head": "abc"}),
        ("lane_drop", {"branch": "fix/a", "reason": "why"}),
        ("lane_wait", {"consumer": "foreman", "timeout_ms": 1}),
    ],
)
async def test_each_foreman_command_checks_the_session_inside_its_own_change(
    make_run, monkeypatch, command, arguments
):
    """With the check before it skipped (as if the lane changed hands in between), the one
    inside the change still refuses and writes nothing."""
    run = make_run()
    queued_cell(run)
    await run.call("lane_wait", consumer="foreman", timeout_ms=1, session="thread-a")
    await run.call("foreman_handoff", session="thread-a")
    await run.call("lane_wait", consumer="foreman", timeout_ms=1, session="thread-b")
    with run.store.update("an event") as state:
        events.emit(state, START, "queue-room", detail="A seat is free")
    monkeypatch.setattr(foreman, "hold", lambda *args, **kwargs: None)
    monkeypatch.setattr(foreman, "require", lambda *args, **kwargs: None)
    before = run.state()
    refused = await run.call(command, **arguments, session="thread-a")
    assert refused.error.code == "FOREMAN_STALE", command
    assert run.state() == before
