"""The measurement records: their schema, and the attempt rows a report folds them into."""

from __future__ import annotations

import pytest

from botcore_factory import records


def rec(kind, at, **fields):
    return records.make(kind, at, "run-1", **fields)


ENQUEUE = {
    "issues": [101],
    "plan": "plan-a",
    "route": "sol/high",
    "profile": "bounded",
}


def test_a_record_carries_schema_kind_time_and_run():
    record = rec("dropped", "t", branch="b", reason="gone")
    assert record == {
        "schema": 5,
        "kind": "dropped",
        "at": "t",
        "runId": "run-1",
        "branch": "b",
        "reason": "gone",
    }


@pytest.mark.parametrize(
    "kind,fields,message",
    [
        ("nonsense", {}, "Unknown"),
        ("ejected", {"branch": "b", "attempt": 1}, "cause"),
        ("provenance-rerecorded", {"branch": "b", "attempt": 1, "base": "m1"}, "names, paths"),
    ],
)
def test_a_record_off_the_schema_is_refused(kind, fields, message):
    with pytest.raises(records.RecordError, match=message):
        rec(kind, "t", **fields)


def history():
    return [
        rec(
            "enqueued",
            "t1",
            branch="b",
            attempt=1,
            head="h1",
            state="held",
            firstEnqueuedAt="t1",
            holdReason="queue-full",
            **ENQUEUE,
        ),
        rec("queued", "t2", branch="b", attempt=1),
        rec("validation-started", "t3", branch="b", attempt=1, head="h1", base="m1", slot=1),
        rec(
            "validated",
            "t4",
            branch="b",
            attempt=1,
            outcome="failed",
            head="h1+m1",
            base="m1",
            tree="t1",
            command=["pnpm", "verify"],
            checksRun=40,
            testsRun=900,
            minutes=12.5,
            logPath="attempts/b-1.log",
        ),
        rec("ejected", "t4", branch="b", attempt=1, cause="final-failed", head="h1"),
        rec(
            "enqueued",
            "t5",
            branch="b",
            attempt=2,
            head="h2",
            state="queued",
            firstEnqueuedAt="t1",
            **ENQUEUE,
        ),
        rec(
            "validated",
            "t6",
            branch="b",
            attempt=2,
            outcome="passed",
            head="h2+m2",
            base="m2",
            tree="t2",
            command=["pnpm", "verify"],
            checksRun=41,
            testsRun=905,
            minutes=11.0,
        ),
        rec(
            "provenance-rerecorded",
            "t5a",
            branch="b",
            attempt=2,
            base="m2",
            names=["provenance"],
            paths=["endpoints/botcore/provenance/adaptations.json"],
        ),
        rec("rerun", "t5b", branch="b", attempt=2, reason="main-moved"),
        rec("merged", "t7", branch="b", attempt=2, pr=600),
        rec(
            "enqueued",
            "t8",
            branch="c",
            attempt=1,
            head="h3",
            state="queued",
            firstEnqueuedAt="t8",
            **ENQUEUE,
        ),
        rec("dropped", "t9", branch="c", reason="abandoned"),
    ]


def test_attempts_fold_every_fact_about_one_attempt_into_a_row():
    first, second, third = records.attempts(history())
    assert first["heldAt"] == "t1" and first["queuedAt"] == "t2"
    assert (first["outcome"], first["cause"], first["validation"]) == (
        "ejected",
        "final-failed",
        "failed",
    )
    assert first["logPath"] == "attempts/b-1.log" and first["checksRun"] == 40
    assert (second["outcome"], second["pr"], second["mergedAt"]) == ("merged", 600, "t7")
    assert (
        second["reruns"] == 1
        and second["provenanceRerecorded"] == 1
        and second["withoutCheck"] is False
    )
    assert (first["base"], first["tree"]) == ("m1", "t1")
    assert second["firstEnqueuedAt"] == "t1"  # Queue wait counts from the first enqueue.
    assert (third["outcome"], third["droppedAt"]) == ("dropped", "t9")
    assert [row["attempt"] for row in records.merges(history())] == [2]


def test_attempt_numbers_first_enqueue_and_last_ejection():
    assert records.next_attempt(history(), "b") == 3
    assert records.next_attempt(history(), "new") == 1
    assert records.first_enqueued(history(), "b") == "t1"
    assert records.first_enqueued(history(), "new") is None
    assert records.last_ejection(history(), "b")["cause"] == "final-failed"
    assert records.last_ejection(history(), "c") is None


def test_test_changes_fold_onto_attempts_and_authoritative_validation_replaces_advisory():
    advisory = {
        "base": "m1",
        "mergeBase": "m1",
        "head": "h1",
        "testFiles": 1,
        "totals": {},
        "findingCount": 0,
        "findings": [],
    }
    authoritative = {
        "base": "m1",
        "mergeBase": "m1",
        "head": "h1+m1",
        "testFiles": 1,
        "totals": {},
        "findingCount": 1,
        "findings": [{"file": "a.test.ts", "kind": "fewer-tests", "detail": "tests 2 → 1"}],
    }
    log = [
        rec(
            "enqueued",
            "t1",
            branch="feat/x",
            attempt=1,
            head="h1",
            state="queued",
            firstEnqueuedAt="t1",
            testChanges=advisory,
            **ENQUEUE,
        ),
        rec(
            "validated",
            "t2",
            branch="feat/x",
            attempt=1,
            outcome="passed",
            head="h1+m1",
            base="m1",
            tree="tr1",
            command=["pnpm", "verify"],
            minutes=5.0,
            testChanges=authoritative,
        ),
        rec("merged", "t3", branch="feat/x", attempt=1, pr=701, testChanges=authoritative),
    ]
    [row] = records.attempts(log)
    assert row["testChanges"] == authoritative
    assert records.merges(log)[0]["testChanges"] == authoritative
    assert records.test_changes_for(log, "feat/x") == authoritative
    assert records.test_changes_for(log, "feat/x", attempt=1) == authoritative
    assert records.test_changes_for(log, "feat/x", attempt=2) is None
    assert records.test_changes_for(log, "other") is None

    # A held record replaces an advisory enqueue report and updates state/holdReason, and a
    # subsequent explicit testChanges=None never erases an existing report.
    held_log = [
        rec(
            "enqueued",
            "t1",
            branch="feat/held",
            attempt=1,
            head="h1",
            state="queued",
            firstEnqueuedAt="t1",
            testChanges=advisory,
            **ENQUEUE,
        ),
        rec(
            "held",
            "t2",
            branch="feat/held",
            attempt=1,
            holdReason="gate-change",
            testChanges=authoritative,
        ),
        rec(
            "ejected",
            "t3",
            branch="feat/held",
            attempt=1,
            cause="final-failed",
            testChanges=None,
        ),
    ]
    [held_row] = records.attempts(held_log)
    assert (held_row["state"], held_row["holdReason"], held_row["heldAt"]) == (
        "held",
        "gate-change",
        "t2",
    )
    assert held_row["testChanges"] == authoritative
    assert records.test_changes_for(held_log, "feat/held") == authoritative
