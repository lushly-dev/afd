"""A run's numbers, computed from the measurement records (``records``).

A finished run's summary is written into the lane state when the run stops, from the records;
``lane-report`` reads it, or computes the open run's live. Agents keep no bookkeeping.
"""

from __future__ import annotations

from botcore_factory.claims import parse_time
from botcore_factory.records import attempts
from botcore_factory.runtime import Factory, Refusal

NUMBERS = ("mergedPerHour", "validationsPerMerge", "productiveShare", "staleRuns", "reruns")


def summarize(history: list[dict], run_id: str, started_at: str | None, stopped_at: str) -> dict:
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


def _ratio(numerator, denominator, digits: int = 2):
    return round(numerator / denominator, digits) if denominator else None


def numbers(summary: dict) -> dict:
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
        "foreman": {"wakes": wakes, "wakesPerMerge": _ratio(wakes, merged)},
        "byPlan": _count(prs, "plan"),
        "byRoute": _count(prs, "route"),
        "prs": [{key: pr.get(key) for key in ("number", "branch", "route")} for pr in prs],
        "experiences": summary.get("experiences", []),
        "digest": summary.get("digest"),
    }


def _count(prs: list[dict], key: str) -> list[dict]:
    counts: dict = {}
    for pr in prs:
        if pr.get(key):
            counts[pr[key]] = counts.get(pr[key], 0) + 1
    return [{key: name, "merged": count} for name, count in sorted(counts.items())]


def run_summary(factory: Factory, state: dict, run_id: str) -> dict:
    run = next((r for r in state["runs"] if r.get("id") == run_id), None)
    if run is None:
        raise Refusal(
            "NOT_FOUND",
            f"No run {run_id}",
            "lane-status shows the current runId; a report without run gives the latest",
        )
    if "merged" in run:  # Summarized when it stopped.
        return run
    now = factory.world.clock.now().isoformat().replace("+00:00", "Z")
    live = summarize(factory.store.read_records(), run_id, run.get("startedAt"), now)
    return {**run, **live, "prs": run.get("prs") or live["prs"]}


def lane_report(factory: Factory, run: str | None, compare: str | None) -> dict:
    state = factory.store.read()
    run_id = (
        run or state["lane"].get("runId") or (state["runs"][-1]["id"] if state["runs"] else None)
    )
    if run_id is None:
        raise Refusal("NOT_FOUND", "The lane has not run yet", "Start it with lane-start")
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
