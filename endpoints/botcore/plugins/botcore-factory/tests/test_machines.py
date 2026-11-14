"""Choosing the lane host: probing, listing by record age, and moving safely."""

from __future__ import annotations

import pytest

ISSUE = {"assignees": [], "openPrs": [], "createdAt": "2030-01-01T12:00:00Z"}
OFFLINE = {
    "now": "2030-01-02T12:00:00Z",
    "issues": [
        {"number": 104, "labels": ["status:in-progress", "execution:bounded"], **ISSUE},
        {"number": 105, "labels": ["status:in-progress", "execution:bounded"], **ISSUE},
    ],
}


async def test_a_probe_publishes_this_machine_s_readiness_and_keeps_its_measurements(make_run):
    run = make_run()
    record = (await run.call("lane_host_probe")).data["record"]
    assert (record["id"], record["cores"], record["memoryGb"], record["missing"]) == (
        "workstation",
        16,
        64,
        [],
    )
    assert (record["measured"], record["suggestedSlots"]) == (True, 4)
    assert record["probedAt"] == "2030-01-01T00:00:00Z"
    published = run.world_data()["machines"][0]
    assert published["id"] == "workstation" and published["probedAt"] == record["probedAt"]


async def test_a_probe_names_what_a_machine_lacks(make_run):
    run = make_run(thisMachine="laptop")
    missing = (await run.call("lane_host_probe")).data["record"]["missing"]
    assert missing == ["gh sign-in"]


async def test_the_list_decides_reachable_by_a_record_s_age(make_run):
    run = make_run("host-offline", **OFFLINE)
    machines = (await run.call("lane_host_list")).data["machines"]
    assert [(m["id"], m["reachable"], m["ready"]) for m in machines] == [
        ("workstation", False, False),
        ("mini", True, True),
    ]


@pytest.mark.parametrize(
    "arguments,code,hint",
    [
        ({"id": "no-such-machine"}, "NOT_FOUND", "lane-host-list"),
        ({"id": "laptop"}, "HOST_NOT_READY", "lane-host-probe"),
        ({"id": "mini", "drain": True, "recover": True}, "VALIDATION_ERROR", "drain"),
    ],
)
async def test_a_move_is_refused_with_the_way_forward(make_run, arguments, code, hint):
    run = make_run()
    before = run.snapshot()
    result = await run.call("lane_host_set", **arguments)
    assert result.error.code == code and hint in result.error.suggestion
    assert run.snapshot() == before


async def test_a_first_host_is_set_for_every_machine(make_run):
    run = make_run()
    data = (await run.call("lane_host_set", id="workstation")).data
    assert data == {"host": {"id": "workstation"}, "previous": None}
    assert run.world_data()["laneHost"] == "workstation"
    same = (await run.call("lane_host_set", id="workstation")).data
    assert same["previous"] == "workstation"


async def test_a_busy_lane_moves_only_by_draining(make_run):
    run = make_run("running")
    busy = await run.call("lane_host_set", id="mini")
    assert busy.error.code == "LANE_BUSY" and "drain" in busy.error.suggestion
    data = (await run.call("lane_host_set", id="mini", drain=True)).data
    assert data == {"host": {"id": "workstation"}, "draining": True, "moveTo": "mini"}
    assert run.world_data()["laneHost"] == "workstation"
    assert run.state()["lane"]["drainTo"] == "mini"


async def test_an_offline_host_is_replaced_by_recovering_from_origin_and_github(make_run):
    run = make_run("host-offline", **OFFLINE)
    busy = await run.call("lane_host_set", id="mini")
    assert busy.error.code == "LANE_BUSY" and "recover" in busy.error.suggestion
    data = (await run.call("lane_host_set", id="mini", recover=True)).data
    assert data["rebuilt"] == {"queue": 2, "claims": 2}
    state = run.state()
    assert [(e["branch"], e["head"]) for e in state["queue"]] == [
        ("feat/export-csv", "b2c3d4e"),
        ("fix/retry-backoff", "c3d4e5f"),
    ]
    assert {(c["branch"], tuple(c["issues"]), c["state"]) for c in state["cells"]} == {
        ("feat/export-csv", (104,), "queued"),
        ("fix/retry-backoff", (105,), "queued"),
    }
    status = (await run.call("lane_status")).data
    assert status["host"] == {"id": "mini", "isLaneHost": True, "laneHost": "mini"}
