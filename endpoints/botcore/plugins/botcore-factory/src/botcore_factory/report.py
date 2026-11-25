"""A run's numbers, computed from the measurement records (``records``).

A finished run's summary is written into the lane state when the run stops, from the records;
``lane-report`` reads it, or computes the open run's live. Agents keep no bookkeeping.
"""

from __future__ import annotations

from typing import Any

from botcore_factory.claims import parse_time
from botcore_factory.records import attempts
from botcore_factory.runtime import Factory, Refusal, call

NUMBERS = (
    "mergedPerHour",
    "validationsPerMerge",
    "productiveShare",
    "staleRuns",
    "reruns",
    "baseAdvances",
    "rerunLimitAdvances",
    "provenanceRerecorded",
    "ejections",
    "excusedEjections",
)


def summarize(
    history: list[dict[str, Any]], run_id: str, started_at: str | None, stopped_at: str
) -> dict[str, Any]:
    """What a run did, from its records: merges, validations, re-runs, wakes and lane-hours."""
    mine = [record for record in history if record.get("runId") == run_id]
    rows = attempts(mine)
    validated = [r for r in mine if r.get("kind") == "validated"]
    merged_rows = [row for row in rows if row.get("outcome") == "merged"]
    merged_attempts = {(row["branch"], row["attempt"]) for row in merged_rows}
    productive = sum(
        r.get("minutes", 0) for r in validated if (r["branch"], r["attempt"]) in merged_attempts
    )
    total = sum(r.get("minutes", 0) for r in validated)
    hours = 0.0
    if started_at:
        hours = (parse_time(stopped_at) - parse_time(started_at)).total_seconds() / 3600
    return {
        "hours": round(hours, 2),
        "merged": len(merged_rows),
        "validations": len(validated),
        "productiveShare": round(productive / total, 2) if total else None,
        "reruns": sum(1 for r in mine if r.get("kind") == "rerun" and r["reason"] == "main-moved"),
        "staleRuns": sum(1 for r in mine if r.get("kind") == "rerun" and r["reason"] == "restart"),
        # Moves of main a validated branch advanced past without validating again.
        "baseAdvances": sum(1 for r in mine if r.get("kind") == "base-advanced"),
        # Of those, the moves where the PR's required check stood in for a new validation
        # after lane.maxBaseReruns reruns (#1369).
        "rerunLimitAdvances": sum(
            1 for r in mine if r.get("kind") == "base-advanced" and r.get("reason") == "rerun-limit"
        ),
        "provenanceRerecorded": sum(1 for r in mine if r.get("kind") == "provenance-rerecorded"),
        "ejections": sum(1 for r in mine if r.get("kind") == "ejected"),
        # Ejections that were not the branch's own failure: by cause (a conflict, the push or PR
        # plumbing) or excused by the foreman (ejection-excuse); none counts toward
        # cells.maxEjections.
        "excusedEjections": sum(
            1 for r in mine if r.get("kind") == "ejected" and r.get("counted") is False
        )
        + sum(1 for r in mine if r.get("kind") == "ejection-excused"),
        "foremanWakes": sum(1 for r in mine if r.get("kind") == "wake"),
        "prs": [
            {
                "number": row["pr"],
                "branch": row["branch"],
                "route": row.get("route"),
                "plan": row.get("plan"),
            }
            for row in merged_rows
        ],
    }


def _ratio(numerator: float, denominator: float | None, digits: int = 2) -> float | None:
    return round(numerator / denominator, digits) if denominator else None


def numbers(summary: dict[str, Any]) -> dict[str, Any]:
    merged = summary.get("merged", 0)
    wakes = summary.get("foremanWakes", 0)
    prs = summary.get("prs", [])
    return {
        "hours": summary.get("hours"),
        "merged": merged,
        "mergedPerHour": _ratio(merged, summary.get("hours")),
        "validationsPerMerge": _ratio(summary.get("validations", 0), merged),
        "productiveShare": summary.get("productiveShare"),
        "staleRuns": summary.get("staleRuns", 0),
        "reruns": summary.get("reruns", 0),
        "baseAdvances": summary.get("baseAdvances", 0),
        "rerunLimitAdvances": summary.get("rerunLimitAdvances", 0),
        "provenanceRerecorded": summary.get("provenanceRerecorded", 0),
        "ejections": summary.get("ejections", 0),
        "excusedEjections": summary.get("excusedEjections", 0),
        "foreman": {"wakes": wakes, "wakesPerMerge": _ratio(wakes, merged)},
        "byPlan": _count(prs, "plan"),
        "byRoute": _count(prs, "route"),
        "prs": [{key: pr.get(key) for key in ("number", "branch", "route", "plan")} for pr in prs],
        "experiences": summary.get("experiences", []),
        "digest": summary.get("digest"),
    }


def _count(prs: list[dict[str, Any]], key: str) -> list[dict[str, Any]]:
    counts: dict[str, Any] = {}
    for pr in prs:
        if pr.get(key):
            counts[pr[key]] = counts.get(pr[key], 0) + 1
    return [{key: name, "merged": count} for name, count in sorted(counts.items())]


def run_summary(factory: Factory, state: dict[str, Any], run_id: str) -> dict[str, Any]:
    run = next((r for r in state["runs"] if r.get("id") == run_id), None)
    if run is None:
        raise Refusal(
            "NOT_FOUND",
            f"No run {run_id}",
            "lane-status shows the current runId; a report without run gives the latest",
            recovery=call("lane-status"),
        )
    if "merged" in run:  # Summarized when it stopped.
        run_dict: dict[str, Any] = run
        return run_dict
    now = factory.world.clock.now().isoformat().replace("+00:00", "Z")
    live = factory.store.summarize_run(run_id, run.get("startedAt"), now)
    return {**run, **live, "prs": run.get("prs") or live["prs"]}


def lane_report(factory: Factory, run: str | None, compare: str | None) -> dict[str, Any]:
    state = factory.store.read()
    run_id = (
        run or state["lane"].get("runId") or (state["runs"][-1]["id"] if state["runs"] else None)
    )
    if run_id is None:
        raise Refusal(
            "NOT_FOUND",
            "The lane has not run yet",
            "There is a report once the lane has run; lane-status says whether it runs and where",
            # Not lane-start: it refuses on a machine that does not host the lane, and starting
            # a lane is not the way to read a report (found by tests/test_small_worlds.py).
            recovery=call("lane-status"),
        )
    report = {"run": run_id, **numbers(run_summary(factory, state, run_id))}
    if compare:
        before = numbers(run_summary(factory, state, compare))
        report["compare"] = compare
        report["delta"] = {
            key: round(report[key] - before[key], 2)
            for key in (*NUMBERS, "merged")
            if isinstance(report.get(key), int | float) and isinstance(before.get(key), int | float)
        }
    return report
