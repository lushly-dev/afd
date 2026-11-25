"""lane-report: a run's numbers from its summary or its records, and the change from another."""

from __future__ import annotations

from botcore_factory.fixture_world import FIXTURE_LANE_PID
from botcore_factory.lane_process import run_loop


async def test_a_finished_run_s_numbers_and_their_change(make_run):
    data = (await make_run("finished").call("lane_report", run="run-2", compare="run-1")).data
    assert (
        data["mergedPerHour"],
        data["validationsPerMerge"],
        data["staleRuns"],
        data["reruns"],
    ) == (
        2.25,
        1.44,
        0,
        3,
    )
    assert data["foreman"] == {"wakes": 27, "wakesPerMerge": 3.0}
    assert data["delta"]["mergedPerHour"] == 0.75 and data["delta"]["merged"] == 3
    assert [pr["number"] for pr in data["prs"]] == [518, 520]
    assert data["byRoute"] == [
        {"route": "opus/medium", "merged": 1},
        {"route": "sol/high", "merged": 1},
    ]
    assert data["digest"] == "runs/run-2/experiences.html" and len(data["experiences"]) == 2


async def test_the_open_run_is_computed_live_from_the_records(make_run):
    run = make_run("running", lane={"running": False, "runId": None})
    from botcore_factory.lane_process import host_lock

    host_lock(run.factory()).release(FIXTURE_LANE_PID)
    run_loop(run.factory(), steps=3, sleep=lambda _: None, poll=0)
    data = (await run.call("lane_report")).data
    assert data["merged"] == 1 and data["prs"][0]["number"] == 600
    # No time passed on the fixture clock, so there is no share of validation time to give.
    assert data["validationsPerMerge"] == 2.0 and data["productiveShare"] is None


async def test_the_live_run_reports_wakes(make_run):
    run = make_run("ejected", lane={"runId": "run-2"}, runs=[{"id": "run-2"}])
    await run.call("lane_wait", consumer="foreman", timeout_ms=1)
    data = (await run.call("lane_report", run="run-2")).data
    assert data["foreman"]["wakes"] == 1


async def test_lane_report_counts_provenance_rerecorded_and_deltas(make_run):
    from botcore_factory.records import make

    run = make_run(
        "finished",
        lane={"runId": "run-3"},
        runs=[
            {"id": "run-1", "merged": 1, "provenanceRerecorded": 1},
            {"id": "run-3", "startedAt": "2030-01-01T00:00:00Z"},
        ],
    )
    for branch in ("feat/a", "feat/b"):
        run.store.append_record(
            make(
                "provenance-rerecorded",
                "2030-01-01T00:01:00Z",
                "run-3",
                branch=branch,
                attempt=1,
                base="main-0",
                names=["provenance"],
                paths=["endpoints/health/provenance/provenance.json"],
            )
        )
    data = (await run.call("lane_report", run="run-3", compare="run-1")).data
    assert data["provenanceRerecorded"] == 2
    assert data["delta"]["provenanceRerecorded"] == 1


async def test_an_unknown_run_is_refused(make_run):
    result = await make_run("finished").call("lane_report", run="run-9")
    assert result.error.code == "NOT_FOUND" and "runId" in result.error.suggestion
    fresh = await make_run().call("lane_report")
    assert fresh.error.code == "NOT_FOUND" and "lane-status" in fresh.error.suggestion
    assert fresh.error.recovery is not None and fresh.error.recovery.command == "lane-status"
