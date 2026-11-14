"""The lane's measurement records: the facts every number of the proposal's "Measurement" is
computed from.

The plugin writes them, never an agent, to ``records.jsonl`` beside the lane state: append-only,
one fact per line, never rewritten. ``lane-report`` and the improvement loop read them through
``attempts`` and ``merges``; nothing reads the state or the change log for a number.

Every record has ``schema``, ``kind``, ``at`` (UTC), ``runId`` (the lane run, or null) and the
fields its kind requires below. Facts about one attempt share ``branch`` and ``attempt`` (1 for a
branch's first enqueue, counting up with each re-enqueue), so a reader folds them into one row.

======================  ==================================================  =====================
kind                    required fields                                     written by
======================  ==================================================  =====================
``cell-registered``     branch, issues, plan, route, profile                cell-register
``enqueued``            branch, attempt, head, issues, plan, route,         lane-enqueue
                        profile, state (queued | held), firstEnqueuedAt
``queued``              branch, attempt (a held attempt joins the queue)    the lane loop
``validation-started``  branch, attempt, head, base, slot                   the lane loop
``validated``           branch, attempt, outcome (passed | failed),         the lane loop
                        checksRun, testsRun, minutes; optional flaky,
                        mainMovedRerun, logPath
``ejected``             branch, attempt, cause (conflict | entry-invalid |  the lane loop
                        final-failed | push-failed | pr-failed | ci-failed
                        | merge-failed | coverage-failed); optional head,
                        logPath
``merged``              branch, attempt, pr, checksRun                      the lane loop
``dropped``             branch, reason                                      lane-drop
======================  ==================================================  =====================

Optional on any record: ``holdReason`` (``queue-full``; time held for the owner is told apart
by ``owner``), ``position``, ``detail``. A writer may add fields; a reader ignores what it does
not know. A new kind or a new required field raises ``SCHEMA`` by one.
"""

from __future__ import annotations

from typing import Any

SCHEMA = 1
REQUIRED: dict[str, tuple[str, ...]] = {
    "cell-registered": ("branch", "issues", "plan", "route", "profile"),
    "enqueued": (
        "branch",
        "attempt",
        "head",
        "issues",
        "plan",
        "route",
        "profile",
        "state",
        "firstEnqueuedAt",
    ),
    "queued": ("branch", "attempt"),
    "validation-started": ("branch", "attempt", "head", "base", "slot"),
    "validated": ("branch", "attempt", "outcome", "checksRun", "testsRun", "minutes"),
    "ejected": ("branch", "attempt", "cause"),
    "merged": ("branch", "attempt", "pr", "checksRun"),
    "dropped": ("branch", "reason"),
}
#: Ejection causes that mean a check failed; a repair after one may not edit a gate.
FAILING_CHECK_CAUSES = frozenset({"entry-invalid", "final-failed", "ci-failed", "coverage-failed"})
#: When each kind happened, as the field an attempt row carries it in.
_TIMES = {
    "enqueued": "enqueuedAt",
    "queued": "queuedAt",
    "validation-started": "validationStartedAt",
    "validated": "validatedAt",
    "ejected": "ejectedAt",
    "merged": "mergedAt",
}


class RecordError(ValueError):
    """A record that does not follow the schema; nothing is written."""


def make(kind: str, at: str, run_id: str | None, **fields: Any) -> dict:
    """A record of ``kind``, checked against the schema."""
    if kind not in REQUIRED:
        raise RecordError(f"Unknown record kind {kind!r}")
    missing = [name for name in REQUIRED[kind] if fields.get(name) is None]
    if missing:
        raise RecordError(f"A {kind} record needs {', '.join(missing)}")
    return {"schema": SCHEMA, "kind": kind, "at": at, "runId": run_id, **fields}


def for_branch(records: list[dict], branch: str) -> list[dict]:
    return [record for record in records if record.get("branch") == branch]


def next_attempt(records: list[dict], branch: str) -> int:
    attempts = [r["attempt"] for r in for_branch(records, branch) if r.get("kind") == "enqueued"]
    return max(attempts, default=0) + 1


def first_enqueued(records: list[dict], branch: str) -> str | None:
    """When the branch was first enqueued: queue wait counts from here, across repairs."""
    times = [r["at"] for r in for_branch(records, branch) if r.get("kind") == "enqueued"]
    return min(times) if times else None


def last_ejection(records: list[dict], branch: str) -> dict | None:
    ejections = [r for r in for_branch(records, branch) if r.get("kind") == "ejected"]
    return ejections[-1] if ejections else None


def attempts(records: list[dict]) -> list[dict]:
    """One row per attempt: its times, outcome and cause, plan, route, profile and checks.

    ``state`` is the furthest the attempt got (``held``, ``queued``, ``validating``,
    ``validated``); ``outcome`` is ``merged``, ``ejected`` or ``dropped`` once it ended.
    """
    rows: dict[tuple[str, int], dict] = {}
    last: dict[str, tuple[str, int]] = {}
    for record in records:
        kind, branch = record.get("kind"), record.get("branch")
        if kind == "dropped" and branch in last:
            row = rows[last[branch]]
            row.setdefault("outcome", "dropped")
            row["droppedAt"] = record["at"]
            continue
        if kind not in _TIMES or "attempt" not in record:
            continue
        key = (branch, record["attempt"])
        last[branch] = key
        row = rows.setdefault(key, {"branch": branch, "attempt": record["attempt"]})
        row[_TIMES[kind]] = record["at"]
        _fold(row, kind, record)
    return list(rows.values())


def _fold(row: dict, kind: str, record: dict) -> None:
    if kind == "enqueued":
        for name in ("head", "issues", "plan", "route", "profile", "firstEnqueuedAt", "runId"):
            row[name] = record.get(name)
        row["state"] = record["state"]
        if record["state"] == "held":
            row["heldAt"] = record["at"]
            row["holdReason"] = record.get("holdReason")
    elif kind == "queued":
        row["state"] = "queued"
    elif kind == "validation-started":
        row["state"] = "validating"
    elif kind == "validated":
        row["state"] = "validated"
        for name in ("checksRun", "testsRun", "minutes", "flaky", "mainMovedRerun", "logPath"):
            if name in record:
                row[name] = record[name]
        row["validation"] = record["outcome"]
    elif kind in ("ejected", "merged"):
        row["outcome"] = kind
        if kind == "ejected":
            row["cause"] = record["cause"]
            row["logPath"] = record.get("logPath", row.get("logPath"))
        else:
            row["pr"], row["checksRun"] = record["pr"], record["checksRun"]
    row.setdefault("state", None)


def merges(records: list[dict]) -> list[dict]:
    """The attempts that merged, each with what Measurement computes per merge."""
    return [row for row in attempts(records) if row.get("outcome") == "merged"]
