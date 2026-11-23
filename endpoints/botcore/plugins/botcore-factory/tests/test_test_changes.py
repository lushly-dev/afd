"""Test-change reports on cell records and Phase 5's 'never improves by checking less' hold."""

from __future__ import annotations

import json

import pytest

from botcore_factory import change_report as test_changes
from botcore_factory import records
from botcore_factory.lane import step
from botcore_factory.queue import enqueue
from botcore_factory.runtime import Refusal
from botcore_factory.world import WorldError

TEST_CHANGES_CMD = [
    "node",
    ".claude/skills/maintain-gates/scripts/report-test-changes.mjs",
    "--root",
    "{worktree}",
    "--base",
    "{base}",
    "--head",
    "{head}",
    "--json",
]


def with_test_changes(run):
    factory = run.factory()
    factory.config = factory.config.model_copy(update={"test_changes": TEST_CHANGES_CMD})
    return factory


def make_report(**overrides) -> dict:
    base = {
        "base": "main-0",
        "mergeBase": "main-0",
        "head": "abc1234",
        "testFiles": 1,
        "totals": {
            "JavaScript": {
                "files": 1,
                "before": {"tests": 3, "assertions": 6, "skips": 0},
                "after": {"tests": 2, "assertions": 4, "skips": 1},
            }
        },
        "findings": [
            {
                "file": "packages/core/src/parser.test.ts",
                "kind": "fewer-tests",
                "detail": "tests 3 → 2",
                "lines": [{"line": 14, "text": "it('handles empty input', () => {"}],
            }
        ],
    }
    return {**base, **overrides}


# ---------- parse_report ----------


def test_parse_report_validates_and_normalizes_valid_json():
    parsed = test_changes.parse_report(json.dumps(make_report()))
    assert parsed["testFiles"] == 1
    assert parsed["findingCount"] == 1
    assert "truncated" not in parsed
    assert parsed["findings"][0]["kind"] == "fewer-tests"
    assert parsed["findings"][0]["lines"] == [
        {"line": 14, "text": "it('handles empty input', () => {"}
    ]
    assert parsed["totals"]["JavaScript"]["after"]["tests"] == 2


def test_parse_report_caps_findings_and_lines_while_keeping_true_count():
    many = [
        {
            "file": f"pkg/t{i}.test.ts",
            "kind": "fewer-tests",
            "detail": "tests 2 → 1",
            "lines": [{"line": j, "text": "x" * 200} for j in range(1, 10)],
        }
        for i in range(test_changes.MAX_FINDINGS + 5)
    ]
    parsed = test_changes.parse_report(json.dumps(make_report(findings=many)))
    assert parsed["findingCount"] == test_changes.MAX_FINDINGS + 5
    assert len(parsed["findings"]) == test_changes.MAX_FINDINGS
    assert parsed["truncated"] is True
    assert len(parsed["findings"][0]["lines"]) == test_changes.MAX_LINES
    assert len(parsed["findings"][0]["lines"][0]["text"]) == test_changes.MAX_LINE_CHARS


@pytest.mark.parametrize(
    "raw,match",
    [
        ("not json", "valid JSON"),
        ("[]", "JSON object"),
        (json.dumps(make_report(base="")), "base"),
        (json.dumps(make_report(mergeBase=None)), "mergeBase"),
        (json.dumps(make_report(head=123)), "head"),
        (json.dumps(make_report(testFiles=True)), "testFiles"),
        (json.dumps(make_report(testFiles=-1)), "testFiles"),
        (json.dumps(make_report(totals=[])), "totals"),
        (json.dumps(make_report(findings="none")), "findings"),
        (json.dumps(make_report(findings=[{"file": "a.ts", "kind": "fewer-tests"}])), "detail"),
        (
            json.dumps(
                make_report(
                    findings=[
                        *[
                            {"file": f"ok{i}.test.ts", "kind": "fewer-tests", "detail": "2 → 1"}
                            for i in range(test_changes.MAX_FINDINGS)
                        ],
                        {"file": "corrupt.test.ts", "kind": "", "detail": "bad"},
                    ]
                )
            ),
            "kind",
        ),
    ],
)
def test_parse_report_fails_closed_on_malformed_input(raw, match):
    with pytest.raises(WorldError, match=match):
        test_changes.parse_report(raw)


# ---------- check_less_reasons ----------


def test_check_less_reasons_is_empty_when_only_adding_tests():
    clean = test_changes.parse_report(
        json.dumps(
            make_report(
                testFiles=2,
                totals={
                    "JavaScript": {
                        "files": 2,
                        "before": {"tests": 3, "assertions": 6, "skips": 0},
                        "after": {"tests": 5, "assertions": 10, "skips": 0},
                    }
                },
                findings=[],
            )
        )
    )
    assert test_changes.check_less_reasons(clean) == []
    assert test_changes.check_less_reasons(clean, checks_run_delta=4) == []
    assert test_changes.check_less_reasons(None) == []


def test_check_less_reasons_explains_findings_gate_paths_and_check_drops():
    findings = [
        {"file": "a.test.ts", "kind": kind, "detail": f"detail-{kind}"}
        for kind in test_changes.FINDING_LABELS
    ]
    report = test_changes.parse_report(json.dumps(make_report(findings=findings)))
    reasons = test_changes.check_less_reasons(
        report, gate_paths=["botcore.toml", "lefthook.yml"], checks_run_delta=-4
    )
    assert reasons[0] == "edits gate path botcore.toml"
    assert reasons[1] == "edits gate path lefthook.yml"
    assert reasons[2] == "runs 4 fewer checks than main"
    for label in test_changes.FINDING_LABELS.values():
        assert any(label in reason for reason in reasons)
    # Non-zero findingCount with empty findings list still holds (fail-closed).
    assert test_changes.check_less_reasons({"findingCount": 3, "findings": []}) == [
        "3 test-change findings"
    ]


# ---------- lane_enqueue ----------


def test_enqueue_attaches_test_changes_for_normal_branch_without_holding(make_run):
    run = make_run("running")
    run.change_world(
        worktrees={
            "wt/parser": {
                "testChanges": {
                    "testFiles": 1,
                    "findings": [
                        {
                            "file": "packages/core/src/parser.test.ts",
                            "kind": "fewer-tests",
                            "detail": "tests 3 → 2",
                        }
                    ],
                }
            }
        }
    )
    data = enqueue(with_test_changes(run), "wt/parser", "Fix parser", None)
    assert data["state"] == "queued"
    assert data["testChanges"]["findingCount"] == 1
    assert data["testChanges"]["findings"][0]["kind"] == "fewer-tests"
    state = run.state()
    cell = next(c for c in state["cells"] if c["branch"] == "fix/parser-empty-input")
    assert cell["testChanges"]["findingCount"] == 1
    [record] = run.store.read_records()
    assert record["kind"] == "enqueued"
    assert record["testChanges"]["findingCount"] == 1
    assert (
        records.test_changes_for(run.store.read_records(), "fix/parser-empty-input")
        == (data["testChanges"])
    )


async def test_lane_status_exposes_attached_test_changes_on_cell(make_run):
    run = make_run("running")
    run.change_world(
        worktrees={
            "wt/parser": {
                "testChanges": {
                    "testFiles": 1,
                    "findings": [
                        {
                            "file": "packages/core/src/parser.test.ts",
                            "kind": "skip-added",
                            "detail": "skips 0 → 1",
                        }
                    ],
                }
            }
        }
    )
    enqueue(with_test_changes(run), "wt/parser", "Fix parser", None)
    status = (await run.call("lane_status")).data
    cell = next(c for c in status["cells"] if c["branch"] == "fix/parser-empty-input")
    assert cell["testChanges"]["findingCount"] == 1


def test_enqueue_refuses_when_test_changes_command_fails_and_writes_nothing(make_run):
    run = make_run("running")
    run.change_world(worktrees={"wt/parser": {"testChanges": "fail: merge-base missing"}})
    before = run.snapshot()
    with pytest.raises(Refusal) as exc:
        enqueue(with_test_changes(run), "wt/parser", "Fix parser", None)
    assert exc.value.code == "TEST_CHANGES_FAILED"
    assert "merge-base missing" in exc.value.message
    assert run.snapshot() == before


async def test_area_factory_branch_that_weakens_tests_is_held_for_gate_change(make_run):
    """Phase 5 guardrail (job 21): guardrails.json's wt/loosen is held with gate-change."""
    run = make_run("guardrails")
    data = enqueue(with_test_changes(run), "wt/loosen", "Quarantine flaky", None)
    assert data["state"] == "held"
    assert data["holdReason"] == "gate-change"
    assert any("adds test skip" in reason for reason in data["holdReasons"])
    assert "adds test skip" in data["holdDetail"]
    assert data["testChanges"]["findingCount"] == 1
    state = run.state()
    assert [e["branch"] for e in state["held"]] == ["fix/quarantine-flaky"]
    assert state["held"][0]["holdReason"] == "gate-change"
    held_events = [e for e in state["events"] if e["type"] == "gate-change-held"]
    assert len(held_events) == 1
    assert held_events[0]["needsOwner"] == "gate-change"
    assert held_events[0]["open"] is True
    # waitingOnOwner counts the open gate-change-held event.
    status = (await run.call("lane_status")).data
    assert status["waitingOnOwner"] >= 1
    [record] = run.store.read_records()
    assert record["state"] == "held" and record["holdReason"] == "gate-change"
    assert record["testChanges"]["findingCount"] == 1


def test_area_factory_branch_adding_tests_is_not_held(make_run):
    run = make_run("guardrails")
    run.change_world(
        worktrees={
            "wt/loosen": {
                "testsSkipped": [],
                "checksRunDelta": 0,
                "testChanges": {
                    "testFiles": 1,
                    "totals": {
                        "Python": {
                            "files": 1,
                            "before": {"tests": 2, "assertions": 4, "skips": 0},
                            "after": {"tests": 4, "assertions": 8, "skips": 0},
                        }
                    },
                    "findings": [],
                },
            }
        }
    )
    data = enqueue(with_test_changes(run), "wt/loosen", "Add more tests", None)
    assert data["state"] == "queued"
    assert "holdReason" not in data


def test_area_factory_branch_editing_gate_paths_is_held_even_without_test_changes_cmd(make_run):
    run = make_run("guardrails")
    run.change_world(worktrees={"wt/loosen": {"gatePathsChanged": ["scripts/check-file-size.mjs"]}})
    # Without test_changes configured, enqueue still fetches base_branch (not origin/HEAD) and
    # holds gate_paths edits with gate-change.
    seen_since: list[str | None] = []
    factory = run.factory()
    original = factory.world.git.changed_files

    def spy_changed_files(worktree: str, since: str | None = None) -> list[str]:
        seen_since.append(since)
        return original(worktree, since)

    factory.world.git.changed_files = spy_changed_files
    data = enqueue(factory, "wt/loosen", "Relax size gate", None)
    assert data["state"] == "held"
    assert data["holdReason"] == "gate-change"
    assert data["holdReasons"] == ["edits gate path scripts/check-file-size.mjs"]
    assert seen_since == ["main-0"]  # Fetched base SHA, never None/origin/HEAD.


def test_area_factory_branch_refuses_gate_check_failed_if_base_fetch_fails_without_test_changes(
    make_run,
):
    run = make_run("guardrails")
    run.change_world(outcomes={"fetch": "fail: origin unreachable"})
    before = run.snapshot()
    with pytest.raises(Refusal) as exc:
        enqueue(run.factory(), "wt/loosen", "Relax size gate", None)
    assert exc.value.code == "GATE_CHECK_FAILED"
    assert run.snapshot() == before


async def test_measure_approve_releases_held_head_through_command_surface_and_blocks_cells(
    make_run,
):
    run = make_run("guardrails")
    held = enqueue(with_test_changes(run), "wt/loosen", "Quarantine flaky", None)
    assert held["state"] == "held" and held["holdReason"] == "gate-change"

    # Cells cannot self-approve through factory-cell.
    denied = await run.call(
        "measure_approve",
        run.host("factory-cell"),
        branch="fix/quarantine-flaky",
        reason="self-approve attempt",
    )
    assert not denied.success and denied.error.code == "COMMAND_NOT_FOUND"

    # Owner approves via factory host: branch joins queue and event closes.
    approved = await run.call(
        "measure_approve",
        branch="fix/quarantine-flaky",
        reason="Owner reviewed the flaky skip",
    )
    assert approved.success, approved.error
    assert (approved.data["approved"], approved.data["state"], approved.data["head"]) == (
        True,
        "queued",
        "c0ffee2",
    )
    assert len(approved.data["answered"]) == 1
    state = run.state()
    assert [e["branch"] for e in state["queue"]] == ["fix/quarantine-flaky"]
    assert state["held"] == []
    assert all(
        not e["open"]
        for e in state["events"]
        if e["type"] == "gate-change-held" and e["branch"] == "fix/quarantine-flaky"
    )
    # Re-enqueueing the same approved head stays queued.
    again = enqueue(with_test_changes(run), "wt/loosen", "Same head", None)
    assert again["state"] == "queued"

    # A newer commit invalidates the old head's approval.
    run.change_world(worktrees={"wt/loosen": {"head": "c0ffee3", "review": {"head": "c0ffee3"}}})
    reheld = enqueue(with_test_changes(run), "wt/loosen", "Moved head", None)
    assert reheld["state"] == "held" and reheld["holdReason"] == "gate-change"


async def test_measure_approve_converts_to_queue_full_when_queue_is_full_and_refuses_non_held(
    make_run,
):
    run = make_run("guardrails", dials={"lane.queueMax": 1})
    enqueue(with_test_changes(run), "wt/loosen", "Quarantine flaky", None)
    with run.store.update("fill queue") as state:
        state["queue"].append({"branch": "feat/other", "head": "111", "attempt": 1})
    approved = await run.call(
        "measure_approve", branch="fix/quarantine-flaky", reason="Approved while full"
    )
    assert approved.success and approved.data["state"] == "held"
    assert approved.data["holdReason"] == "queue-full"
    assert run.state()["held"][0]["holdReason"] == "queue-full"

    missing = await run.call("measure_approve", branch="feat/other", reason="Not held")
    assert not missing.success and missing.error.code == "NOT_FOUND"


def test_enqueue_respects_approval_written_concurrently_during_prequeue(make_run):
    run = make_run("guardrails")
    factory = with_test_changes(run)
    orig_run = factory.world.processes.run

    def approve_during_prequeue(args, cwd, timeout=None, *, label=None):
        result = orig_run(args, cwd, timeout=timeout, label=label)
        if label == "prequeue:lint":
            with run.store.update("concurrent approve") as state:
                cell = next(c for c in state["cells"] if c["branch"] == "fix/quarantine-flaky")
                cell["gateChangeApproved"] = {"head": "c0ffee2", "reason": "Approved mid-prequeue"}
        return result

    factory.world.processes.run = approve_during_prequeue
    data = enqueue(factory, "wt/loosen", "Approved mid-prequeue", None)
    assert data["state"] == "queued" and "holdReason" not in data


def test_hold_detail_and_event_lines_are_bounded_on_large_finding_sets(make_run):
    run = make_run("guardrails")
    many = [
        {"file": f"pkg/t{i}.test.ts", "kind": "fewer-tests", "detail": "tests 5 → 1"}
        for i in range(80)
    ]
    run.change_world(worktrees={"wt/loosen": {"testChanges": {"testFiles": 80, "findings": many}}})
    data = enqueue(with_test_changes(run), "wt/loosen", "Many findings", None)
    assert data["state"] == "held" and data["holdReason"] == "gate-change"
    assert len(data["holdDetail"]) <= test_changes.MAX_HOLD_DETAIL_CHARS
    assert len(data["holdReasons"]) == test_changes.MAX_HOLD_LINES + 1
    assert data["holdReasons"][-1] == "… and 30 more"


# ---------- lane loop (queue_held, start_validation, validated/merged/ejected) ----------


def test_queue_held_never_auto_queues_owner_holds_but_promotes_queue_full(make_run):
    run = make_run("running")
    with run.store.update("seed held") as state:
        state["queue"] = []
        state["held"] = [
            {
                "branch": "fix/quarantine-flaky",
                "head": "c0ffee2",
                "attempt": 1,
                "state": "held",
                "holdReason": "gate-change",
            },
            {
                "branch": "fix/health-window",
                "head": "c0ffee1",
                "attempt": 1,
                "state": "held",
                "holdReason": "measure-change",
            },
            {
                "branch": "feat/export-csv",
                "head": "b2c3d4e",
                "attempt": 1,
                "state": "held",
                "holdReason": "queue-full",
            },
        ]
    step(run.factory())
    state = run.state()
    assert [e["branch"] for e in state["held"]] == ["fix/quarantine-flaky", "fix/health-window"]
    assert [e["branch"] for e in state["queue"]] == ["feat/export-csv"]


def test_lane_attaches_authoritative_test_changes_to_validated_and_merged_records(make_run):
    run = make_run("running")
    finding = {
        "file": "packages/core/src/export.test.ts",
        "kind": "assertions-rewritten",
        "detail": "1 assertion line changed",
    }
    run.change_world(
        outcomes={
            "testChanges": {
                "feat/export-csv": {"testFiles": 1, "findings": [finding]},
                "fix/retry-backoff": {"testFiles": 0, "findings": []},
            }
        }
    )
    for _ in range(3):
        step(with_test_changes(run))
    history = run.store.read_records()
    validated = next(
        r for r in history if r["kind"] == "validated" and r["branch"] == "feat/export-csv"
    )
    merged = next(r for r in history if r["kind"] == "merged" and r["branch"] == "feat/export-csv")
    assert validated["testChanges"]["findingCount"] == 1
    assert validated["testChanges"]["findings"] == [finding]
    assert merged["testChanges"] == validated["testChanges"]
    assert records.merges(history)[0]["testChanges"] == validated["testChanges"]


def test_lane_attaches_test_changes_to_ejected_record_on_validation_failure(make_run):
    run = make_run("running")
    run.change_world(
        outcomes={
            "validate": {"feat/export-csv": "fail: assertion failed"},
            "testChanges": {
                "feat/export-csv": {
                    "testFiles": 1,
                    "findings": [
                        {"file": "a.test.ts", "kind": "fewer-assertions", "detail": "2 → 1"}
                    ],
                }
            },
        }
    )
    for _ in range(2):
        step(with_test_changes(run))
    ejected = next(
        r
        for r in run.store.read_records()
        if r["kind"] == "ejected" and r["branch"] == "feat/export-csv"
    )
    assert ejected["cause"] == "final-failed"
    assert ejected["testChanges"]["findingCount"] == 1


def test_lane_authoritatively_holds_area_factory_branch_before_validation(make_run):
    """Even if an area:factory branch entered the queue, the lane holds it from base's report."""
    run = make_run("running")
    run.change_world(
        issues=[
            {
                "number": 104,
                "labels": ["status:in-progress", "execution:bounded", "area:factory"],
                "assignees": [],
                "openPrs": [],
                "createdAt": "2030-01-01T12:00:00Z",
            }
        ],
        outcomes={
            "testChanges": {
                "feat/export-csv": {
                    "testFiles": 1,
                    "findings": [
                        {
                            "file": "packages/core/src/export.test.ts",
                            "kind": "deleted-file",
                            "detail": "deleted with 3 tests and 5 assertions",
                        }
                    ],
                },
                "fix/retry-backoff": {"testFiles": 0, "findings": []},
            }
        },
    )
    actions = step(with_test_changes(run))
    assert "held feat/export-csv (gate-change)" in actions
    # The slot was released and taken by the next queued branch.
    assert "validating fix/retry-backoff in slot 1" in actions
    state = run.state()
    held = next(e for e in state["held"] if e["branch"] == "feat/export-csv")
    assert held["holdReason"] == "gate-change"
    assert any("deletes test file" in r for r in held["holdReasons"])
    assert held["testChanges"]["findingCount"] == 1
    cell = next(c for c in state["cells"] if c["branch"] == "feat/export-csv")
    assert cell["state"] == "held" and cell["testChanges"]["findingCount"] == 1
    events = [
        e
        for e in state["events"]
        if e["type"] == "gate-change-held" and e["branch"] == "feat/export-csv"
    ]
    assert len(events) == 1 and events[0]["needsOwner"] == "gate-change"
    # Authoritative hold persists a 'held' record with the trusted testChanges report.
    history = run.store.read_records()
    held_rec = next(r for r in history if r["kind"] == "held" and r["branch"] == "feat/export-csv")
    assert held_rec["holdReason"] == "gate-change"
    assert held_rec["testChanges"]["findingCount"] == 1
    assert records.test_changes_for(history, "feat/export-csv") == held_rec["testChanges"]


def test_node_missing_ejection_records_authoritative_test_changes(make_run):
    run = make_run("running")
    run.change_world(
        branchSlotFiles={"feat/export-csv": {".nvmrc": "99\n"}},
        outcomes={
            "changed": {"feat/export-csv": [".nvmrc"]},
            "testChanges": {
                "feat/export-csv": {
                    "testFiles": 1,
                    "findings": [
                        {"file": "a.test.ts", "kind": "fewer-tests", "detail": "tests 2 → 1"}
                    ],
                }
            },
        },
    )
    step(with_test_changes(run))
    ejected = next(
        r
        for r in run.store.read_records()
        if r["kind"] == "ejected" and r["branch"] == "feat/export-csv"
    )
    assert ejected["cause"] == "node-missing"
    assert ejected["testChanges"]["findingCount"] == 1


def test_missing_base_or_head_placeholder_pauses_lane(make_run):
    run = make_run("running")
    factory = run.factory()
    factory.config = factory.config.model_copy(
        update={"test_changes": ["node", "report-test-changes.mjs", "--json"]}
    )
    step(factory)
    state = run.state()
    assert state["lane"]["paused"] is True
    assert "{base}, {head}" in state["lane"]["pauseReason"]


def test_mismatched_base_or_head_in_json_report_fails_closed(make_run):
    run = make_run("running")
    run.change_world(
        outcomes={
            "testChanges": {
                "feat/export-csv": {
                    "base": "wrong-base",
                    "mergeBase": "wrong-base",
                    "head": "wrong-head",
                    "testFiles": 0,
                    "totals": {},
                    "findings": [],
                }
            }
        }
    )
    step(with_test_changes(run))
    state = run.state()
    assert state["lane"]["paused"] is True
    assert "expected main-0..b2c3d4e+main-0" in state["lane"]["pauseReason"]


def test_broken_test_changes_script_pauses_the_lane_rather_than_reporting_clean(make_run):
    run = make_run("running")
    run.change_world(outcomes={"testChanges": {"feat/export-csv": "fail: node crashed"}})
    step(with_test_changes(run))
    state = run.state()
    assert state["lane"]["paused"] is True
    assert "node crashed" in state["lane"]["pauseReason"]
    assert all(r["kind"] != "validation-started" for r in run.store.read_records())
