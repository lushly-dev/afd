"""One foreman per lane (lushly-dev/afd#1432): the lease a foreman's session takes, renews and
hands over, and the refusal another session gets while it is live."""

from __future__ import annotations

from botcore_factory import foreman

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
