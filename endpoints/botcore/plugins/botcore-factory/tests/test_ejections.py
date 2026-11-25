"""Only a branch's own failures count toward cells.maxEjections: a conflict with a moved main and
the push, PR and merge plumbing are excused by cause, and the foreman excuses a known flake with
ejection-excuse."""

from __future__ import annotations

import pytest
from conftest import FOREMAN
from test_lane import events, run_steps

from botcore_factory.cells import holding_seats
from botcore_factory.failures import failing_tests
from botcore_factory.lane_base import FAILURES_SHOWN, failure_lines
from botcore_factory.report import lane_report
from botcore_factory.world import TAIL_LINES

BRANCH = "feat/export-csv"
CI_FAILED = {"checks": {BRANCH: "failure"}}
DISPATCHABLE = {
    "number": 190,
    "labels": ["status:planned", "execution:bounded", "area:core"],
    "assignees": [],
    "openPrs": [],
    "createdAt": "2030-01-01T09:00:00Z",
}


def cell_of(run) -> dict:
    return next(c for c in run.state()["cells"] if c["branch"] == BRANCH)


def at_two(run) -> None:
    with run.store.update("two ejections") as state:
        next(c for c in state["cells"] if c["branch"] == BRANCH)["ejections"] = 2


@pytest.mark.parametrize(
    "outcomes,cause",
    [
        (
            {"merge": {BRANCH: "conflict: foundations/fast-af/provenance/provenance.json"}},
            "conflict",
        ),
        ({"push": {BRANCH: "fail: ! [rejected] (non-fast-forward)"}}, "push-failed"),
        ({"pr": {BRANCH: "fail: Validation Failed: No commits between"}}, "pr-failed"),
        ({"mergePr": {BRANCH: "fail: Head branch was modified."}}, "merge-failed"),
    ],
)
def test_an_ejection_that_is_not_the_branch_s_own_does_not_count(make_run, outcomes, cause):
    run = make_run("running")
    at_two(run)
    run.change_world(outcomes=outcomes)
    run_steps(run, 3)
    [ejected] = events(run, "ejected")
    assert ejected["reason"] == cause and ejected["excused"]
    assert events(run, "ejection-limit") == []
    cell = cell_of(run)
    assert (cell["ejections"], cell["excused"], cell["lastEjection"]["cause"]) == (3, 1, cause)
    [record] = [r for r in run.store.read_records() if r["kind"] == "ejected"]
    assert record["counted"] is False and record["excuse"]


def test_the_branch_s_own_failure_counts_and_reaches_the_limit(make_run):
    run = make_run("running")
    at_two(run)
    run.change_world(outcomes=CI_FAILED)
    run_steps(run, 3)
    [ejected] = events(run, "ejected")
    assert ejected["reason"] == "ci-failed" and "excused" not in ejected
    [limit] = events(run, "ejection-limit")
    assert limit["detail"] == "3 ejections count (0 of 3 excused); cells.maxEjections is 3"
    [record] = [r for r in run.store.read_records() if r["kind"] == "ejected"]
    assert record["counted"] is True


async def test_the_foreman_excuses_a_flake_and_the_limit_is_answered(make_run):
    run = make_run("running")
    at_two(run)
    run.change_world(outcomes=CI_FAILED)
    run_steps(run, 3)
    result = await run.call(
        "ejection_excuse",
        branch=BRANCH,
        reason="#1408: the hosted harness flakes under load",
        session=await run.take_lane(),
    )
    assert result.success, result.error
    assert result.data == {
        "branch": BRANCH,
        "attempt": 1,
        "cause": "ci-failed",
        "ejections": 3,
        "excused": 1,
        "counted": 2,
        "limit": 3,
        "answered": [events(run, "ejection-limit")[0]["id"]],
    }
    [limit] = events(run, "ejection-limit")
    assert limit["open"] is False and limit["resolution"]["by"] == "ejection-excuse"
    [ejected] = events(run, "ejected")
    assert ejected["open"] is True  # Still answered by the re-enqueue or a drop.
    cell = cell_of(run)
    assert cell["lastEjection"]["excused"].startswith("#1408")
    [record] = [r for r in run.store.read_records() if r["kind"] == "ejection-excused"]
    assert (record["attempt"], record["cause"]) == (1, "ci-failed")
    report = lane_report(run.factory(), None, None)
    assert (report["ejections"], report["excusedEjections"]) == (1, 1)
    again = await run.call("ejection_excuse", branch=BRANCH, reason="twice", session=FOREMAN)
    assert again.error.code == "ALREADY_EXCUSED"


async def test_lane_status_shows_what_counts(make_run):
    run = make_run("running")
    run.change_world(outcomes={"merge": {BRANCH: "conflict: a"}})
    run_steps(run)
    data = (await run.call("lane_status")).data
    view = next(c for c in data["cells"] if c["branch"] == BRANCH)
    assert (view["ejections"], view["excused"], view["countedEjections"]) == (1, 1, 0)
    assert view["lastEjection"]["excused"] == "main moved under it"
    report = lane_report(run.factory(), None, None)
    assert (report["ejections"], report["excusedEjections"]) == (1, 1)


async def test_an_excuse_needs_an_ejection_a_reason_and_a_cell(make_run):
    run = make_run("running")
    session = await run.take_lane()
    none = await run.call("ejection_excuse", branch=BRANCH, reason="flake", session=session)
    assert none.error.code == "NOT_FOUND" and "no ejection" in none.error.message
    empty = await run.call("ejection_excuse", branch=BRANCH, reason=" ", session=session)
    assert empty.error.code == "VALIDATION_ERROR"
    missing = await run.call(
        "ejection_excuse", branch="fix/nobody", reason="flake", session=session
    )
    assert missing.error.code == "NOT_FOUND"


async def test_an_ejection_from_before_the_cell_kept_it_is_read_from_the_records(make_run):
    run = make_run("running")
    run.change_world(outcomes=CI_FAILED)
    run_steps(run, 3)
    with run.store.update("an older lane") as state:
        cell = next(c for c in state["cells"] if c["branch"] == BRANCH)
        del cell["lastEjection"], cell["excused"]
    result = await run.call(
        "ejection_excuse", branch=BRANCH, reason="#1408", session=await run.take_lane()
    )
    assert result.success, result.error
    assert (result.data["cause"], result.data["counted"]) == ("ci-failed", 0)


async def test_another_foreman_cannot_excuse(make_run):
    run = make_run("running")
    run.change_world(outcomes=CI_FAILED)
    run_steps(run, 3)
    await run.call("lane_wait", consumer="foreman", session="thread-a", timeout_ms=0)
    busy = await run.call("ejection_excuse", branch=BRANCH, reason="flake", session="thread-b")
    assert busy.error.code == "FOREMAN_REQUIRED"


async def test_an_ejected_cell_at_the_limit_waits_on_the_owner_and_frees_its_seat(make_run):
    """lushly-dev/afd#1593: a cell the owner must decide on holds no seat; one its foreman is
    repairing does, and an excuse that brings it under the limit seats it again."""
    run = make_run("running", dials={"cells.max": 5})
    assert len(holding_seats(run.state())) == 5
    run.change_world(outcomes=CI_FAILED)
    run_steps(run, 3)
    assert cell_of(run)["state"] == "ejected" and len(holding_seats(run.state())) == 5  # Repairing.
    assert events(run, "queue-room") == []

    run = make_run("running", dials={"cells.max": 5})
    at_two(run)
    run.change_world(outcomes=CI_FAILED)
    run_steps(run, 3)
    assert events(run, "ejection-limit")
    assert BRANCH not in [c["branch"] for c in holding_seats(run.state())]
    [room] = events(run, "queue-room")
    assert room["detail"] == f"A seat is free: {BRANCH} waits on the owner"
    run.change_world(issues=[*run.world_data()["issues"], DISPATCHABLE])
    status = (await run.call("lane_status")).data
    assert status["canStartCell"] is True, status.get("reason")
    assert status["waitingOnOwner"] >= 1

    excused = await run.call(
        "ejection_excuse",
        branch=BRANCH,
        reason="#1565: the disk filled up",
        session=await run.take_lane(),
    )
    assert excused.success, excused.error
    assert BRANCH in [c["branch"] for c in holding_seats(run.state())]


#: One run of ``pnpm verify --keep-going`` with every runner failing (lushly-dev/afd#1607), in
#: their real formats (several from archived lane logs).
MULTI_FAILURE_LOG = "\n".join(
    [
        "[verify] umbel.yml: cargo test --no-fail-fast --locked",
        "     Running tests/cli.rs (target/debug/deps/cli-1a2b3c4d5e6f7a8b)",
        "test runs_are_byte_for_byte ... FAILED",
        "test help_lists_commands ... ok",
        "     Running unittests src/lib.rs (target/debug/deps/umbel_store-aa11bb22cc33dd44)",
        "test tests::a ... FAILED",
        "     Running unittests src/lib.rs (target/debug/deps/umbel_host-ee55ff66aa77bb88)",
        "test tests::a ... FAILED",
        "   Doc-tests afd",
        "test src/clock.rs - clock::fixed_clock (line 233) ... FAILED",
        "error: 4 targets failed:",
        "packages/core test:  FAIL  src/result.test.ts > CommandResult > keeps metadata",
        "packages/auth test:  FAIL  src/react.test.ts [ src/react.test.ts ]",
        "packages/x test:  ✓ src/other.test.ts > a failed restart stays a failure",
        " FAIL  |chromium| src/data-grid/violet-data-grid.spec.ts > violet-data-grid > recycles",
        "FAILED tests/test_lane.py::test_ejects - AssertionError: assert 1 == 2",
        "FAILED tests/test_state.py::test_ids[a b/c] - KeyError",
        "ERROR tests/test_world.py::test_setup - RuntimeError: no world",
        "▶ a suite",
        "  ✖ same (1.1ms)",
        "✖ a suite (2.0ms)",
        "✖ failing tests:",
        "",
        "test at scripts/a.test.mjs:3:3",
        "✖ same (1.1ms)",
        "  AssertionError [ERR_ASSERTION]: no",
        "",
        "test at scripts/b.test.mjs:9:3",
        "✖ same (0.4ms)",
        "✖ 3 problems (3 errors, 0 warnings)",
        "The following tests FAILED:",
        "\t  2 - afd_cpp_registry (Failed)",
        "Errors while running CTest",
        "  1) [chromium] › tests/grid.spec.ts:12:3 › grid › scrolls ─────────────",
        "[verify] summary",
        "  FAIL  40s  check (ci.yml)",
        "  FAIL  612s  umbel.yml: cargo test --no-fail-fast --locked",
    ]
)
EVERY_FAILURE = [
    "cli tests/cli.rs: runs_are_byte_for_byte",
    "umbel_store src/lib.rs: tests::a",
    "umbel_host src/lib.rs: tests::a",
    "afd doc-tests: src/clock.rs - clock::fixed_clock (line 233)",
    "packages/core/src/result.test.ts > CommandResult > keeps metadata",
    "packages/auth/src/react.test.ts (the file failed to run)",
    "src/data-grid/violet-data-grid.spec.ts > violet-data-grid > recycles [chromium]",
    "tests/test_lane.py::test_ejects",
    "tests/test_state.py::test_ids[a b/c]",
    "tests/test_world.py::test_setup",
    "ctest: afd_cpp_registry",
    "[chromium] › tests/grid.spec.ts:12:3 › grid › scrolls",
    "scripts/a.test.mjs:3:3: same",
    "scripts/b.test.mjs:9:3: same",
]


def test_failing_tests_reads_every_runner_s_failures_once():
    assert failing_tests(MULTI_FAILURE_LOG) == EVERY_FAILURE
    # Without node:test's list: its ✖ lines, not suites; TAP's not ok, not a TODO.
    node = "▶ s\n  ✖ a (1.2ms)\n✖ s (2ms)\n✔ b\nnot ok 3 - c\nnot ok 4 - d # TODO later"
    assert failing_tests(node) == ["a", "c"]
    # A suite that failed without naming a test (a lint) names none here.
    assert failing_tests("  FAIL  3s  check (ci.yml)\nFAIL x\n✖ 2 problems") == []


def test_an_ejection_lists_every_failing_test_not_only_the_first(make_run):
    """lushly-dev/afd#1607: a cross-cutting change cost one ejection per failing test binary.
    The first failures sit far above the log's tail, as in a long ``--keep-going`` run."""
    passing = [f"test passes_{n} ... ok" for n in range(TAIL_LINES + 50)]
    lines = MULTI_FAILURE_LOG.splitlines()
    log = "\n".join([*lines[:3], *passing, *lines[3:]])
    run = make_run("running")
    run.change_world(outcomes={"validate": {BRANCH: f"fail: {log}"}})
    run_steps(run, 3)
    ejected = events(run, "ejected")[0]
    assert ejected["reason"] == "final-failed"
    count = ejected["lines"].index(f"{len(EVERY_FAILURE)} failing tests:")
    assert [line.strip() for line in ejected["lines"][count + 1 :]] == EVERY_FAILURE
    record = next(r for r in run.store.read_records() if r["kind"] == "ejected")
    assert record["failures"] == EVERY_FAILURE
    assert record["failureCount"] == len(EVERY_FAILURE)


def test_a_long_list_of_failures_is_shown_in_part_and_kept_whole_in_the_record(make_run):
    log = "\n".join(f"test t{n} ... FAILED" for n in range(FAILURES_SHOWN + 5))
    lines, tests = failure_lines(log)
    assert len(tests) == FAILURES_SHOWN + 5
    assert lines[-1] == "  … and 5 more: the ejected record's failures"
    run = make_run("running")
    run.change_world(outcomes={"validate": {BRANCH: f"fail: {log}"}})
    run_steps(run, 3)
    record = next(r for r in run.store.read_records() if r["kind"] == "ejected")
    assert record["failures"][-1] == f"t{FAILURES_SHOWN + 4}"
