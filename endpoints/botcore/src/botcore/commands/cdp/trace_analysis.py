"""CDP trace analysis — PerfettoSQL queries and summaries of captured Chrome traces."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from afd import CommandResult, error, success

DEFAULT_TRACE_QUERY_LIMIT = 100
DEFAULT_TRACE_TOP_LIMIT = 10
DEFAULT_LONG_TASK_THRESHOLD_MS = 50.0


def _load_trace_processor():
    try:
        from perfetto.trace_processor import TraceProcessor
    except ImportError as exc:  # pragma: no cover - exercised via command behavior
        raise RuntimeError(
            "Perfetto trace analysis is unavailable. Install lushly-botcore with the [cdp] extra."
        ) from exc
    return TraceProcessor


def _query_rows(tp: Any, sql: str, limit: int | None = None) -> dict[str, Any]:
    result = tp.query(sql)
    columns = list(result.column_names)
    rows: list[dict[str, Any]] = []
    truncated = False

    for index, row in enumerate(result):
        if limit is not None and index >= limit:
            truncated = True
            break
        rows.append({column: getattr(row, column) for column in columns})

    return {
        "columns": columns,
        "rows": rows,
        "rowCount": len(rows),
        "truncated": truncated,
    }


def _ns_to_ms(value: int | float | None) -> float | None:
    if value is None:
        return None
    return round(float(value) / 1_000_000.0, 3)


def _pick_primary_thread(threads: list[dict[str, Any]]) -> dict[str, Any] | None:
    preferred_names = ("CrRendererMain", "CrBrowserMain", "RendererMain", "MainThread")
    for preferred_name in preferred_names:
        for thread in threads:
            if thread.get("threadName") == preferred_name:
                return thread
    return threads[0] if threads else None


def _is_metric_span(row: dict[str, Any]) -> bool:
    name = str(row.get("name") or "")
    category = str(row.get("category") or "")
    return name.startswith("PageLoadMetrics.") or "loading,interactions" in category


def _is_browser_pipeline_slice(row: dict[str, Any]) -> bool:
    name = str(row.get("name") or "")
    category = str(row.get("category") or "")
    thread_name = row.get("threadName")
    process_name = row.get("processName")
    if "cc" in category or "disabled-by-default-devtools.timeline.frame" in category:
        return True
    if name in {"PipelineReporter", "NeedsBeginFrames"}:
        return True
    return thread_name in {None, "[unknown thread]"} and process_name in {
        None,
        "[unknown process]",
    }


async def cdp_trace_query(
    path: str,
    sql: str,
    limit: int = DEFAULT_TRACE_QUERY_LIMIT,
) -> CommandResult[dict]:
    """Run a PerfettoSQL query against a captured Chrome trace and return a compact row set."""
    if limit < 1 or limit > 5000:
        return error(
            "CDP_TRACE_QUERY_INVALID_LIMIT",
            "Trace query limit must be between 1 and 5000 rows.",
            suggestion="Use a small limit such as 100 for interactive analysis.",
            retryable=False,
        )

    trace_path = Path(path).expanduser().resolve()
    if not trace_path.exists():
        return error(
            "CDP_TRACE_QUERY_MISSING_TRACE",
            f"Trace file not found: {trace_path}",
            suggestion="Capture a trace first or point to an existing trace artifact.",
            retryable=False,
        )

    try:
        trace_processor = _load_trace_processor()
        with trace_processor(trace=str(trace_path)) as tp:
            payload = _query_rows(tp, sql, limit=limit)
    except RuntimeError as exc:
        return error(
            "CDP_TRACE_QUERY_DEPENDENCY_MISSING",
            str(exc),
            suggestion="Install lushly-botcore with the [cdp] extra so Perfetto is available.",
            retryable=False,
        )
    except Exception as exc:
        return error(
            "CDP_TRACE_QUERY_FAILED",
            f"{type(exc).__name__}: {exc}",
            suggestion=(
                "Check the SQL syntax and ensure the trace is a valid Chrome or Perfetto trace."
            ),
            retryable=False,
            details={"path": str(trace_path), "limit": limit},
        )

    payload.update({"path": str(trace_path), "sql": sql, "limit": limit})
    return success(
        payload,
        reasoning="Ran a PerfettoSQL query against the trace and returned a compact result set.",
    )


async def cdp_trace_summary(
    path: str,
    top_slices_limit: int = DEFAULT_TRACE_TOP_LIMIT,
    long_task_threshold_ms: float = DEFAULT_LONG_TASK_THRESHOLD_MS,
) -> CommandResult[dict]:
    """Summarize a captured Chrome trace into a stable, automation-friendly structure."""
    if top_slices_limit < 1 or top_slices_limit > 50:
        return error(
            "CDP_TRACE_SUMMARY_INVALID_LIMIT",
            "Top-slice limit must be between 1 and 50.",
            suggestion="Use a small number such as 10 so summaries stay readable.",
            retryable=False,
        )

    if long_task_threshold_ms <= 0:
        return error(
            "CDP_TRACE_SUMMARY_INVALID_THRESHOLD",
            "Long-task threshold must be greater than 0ms.",
            suggestion="Use a threshold such as 50ms for UI jank investigation.",
            retryable=False,
        )

    trace_path = Path(path).expanduser().resolve()
    if not trace_path.exists():
        return error(
            "CDP_TRACE_SUMMARY_MISSING_TRACE",
            f"Trace file not found: {trace_path}",
            suggestion="Capture a trace first or point to an existing trace artifact.",
            retryable=False,
        )

    long_task_threshold_ns = int(long_task_threshold_ms * 1_000_000)

    bounds_sql = """
        SELECT start_ts, end_ts
        FROM trace_bounds
        LIMIT 1
    """
    processes_sql = f"""
        SELECT
            COALESCE(p.name, '[unknown process]') AS processName,
            p.pid AS pid,
            COUNT(*) AS sliceCount,
            SUM(CASE WHEN s.dur > 0 THEN s.dur ELSE 0 END) AS totalSliceDurNs,
            MAX(CASE WHEN s.dur > 0 THEN s.dur ELSE 0 END) AS maxSliceDurNs
        FROM slice s
        JOIN thread_track tt ON s.track_id = tt.id
        JOIN thread t USING (utid)
        LEFT JOIN process p USING (upid)
        GROUP BY p.upid
        ORDER BY totalSliceDurNs DESC
        LIMIT {top_slices_limit}
    """
    threads_sql = f"""
        SELECT
            t.utid AS utid,
            COALESCE(t.name, '[unknown thread]') AS threadName,
            COALESCE(p.name, '[unknown process]') AS processName,
            p.pid AS pid,
            COUNT(*) AS sliceCount,
            SUM(CASE WHEN s.dur > 0 THEN s.dur ELSE 0 END) AS totalSliceDurNs,
            MAX(CASE WHEN s.dur > 0 THEN s.dur ELSE 0 END) AS maxSliceDurNs
        FROM slice s
        JOIN thread_track tt ON s.track_id = tt.id
        JOIN thread t USING (utid)
        LEFT JOIN process p USING (upid)
        GROUP BY t.utid
        ORDER BY totalSliceDurNs DESC
        LIMIT {top_slices_limit}
    """
    categories_sql = f"""
        SELECT
            COALESCE(NULLIF(category, ''), '[uncategorized]') AS category,
            COUNT(*) AS sliceCount,
            SUM(CASE WHEN dur > 0 THEN dur ELSE 0 END) AS totalDurNs,
            MAX(CASE WHEN dur > 0 THEN dur ELSE 0 END) AS maxDurNs
        FROM slice
        GROUP BY category
        ORDER BY totalDurNs DESC
        LIMIT {top_slices_limit}
    """
    top_slices_sql = f"""
        SELECT
            s.name AS name,
            COALESCE(NULLIF(s.category, ''), '[uncategorized]') AS category,
            s.ts AS ts,
            s.dur AS dur,
            t.utid AS utid,
            COALESCE(t.name, '[unknown thread]') AS threadName,
            COALESCE(p.name, '[unknown process]') AS processName,
            p.pid AS pid
        FROM slice s
        LEFT JOIN thread_track tt ON s.track_id = tt.id
        LEFT JOIN thread t USING (utid)
        LEFT JOIN process p USING (upid)
        WHERE s.dur > 0
        ORDER BY s.dur DESC
        LIMIT {top_slices_limit}
    """
    long_tasks_sql = f"""
        SELECT
            s.name AS name,
            COALESCE(NULLIF(s.category, ''), '[uncategorized]') AS category,
            s.ts AS ts,
            s.dur AS dur,
            t.utid AS utid,
            COALESCE(t.name, '[unknown thread]') AS threadName,
            COALESCE(p.name, '[unknown process]') AS processName,
            p.pid AS pid
        FROM slice s
        LEFT JOIN thread_track tt ON s.track_id = tt.id
        LEFT JOIN thread t USING (utid)
        LEFT JOIN process p USING (upid)
        WHERE s.dur >= {long_task_threshold_ns}
        ORDER BY s.dur DESC
        LIMIT {top_slices_limit}
    """
    long_tasks_count_sql = f"""
        SELECT COUNT(*) AS count
        FROM slice
        WHERE dur >= {long_task_threshold_ns}
    """

    try:
        trace_processor = _load_trace_processor()
        with trace_processor(trace=str(trace_path)) as tp:
            bounds_rows = _query_rows(tp, bounds_sql)["rows"]
            process_rows = _query_rows(tp, processes_sql)["rows"]
            thread_rows = _query_rows(tp, threads_sql)["rows"]
            category_rows = _query_rows(tp, categories_sql)["rows"]
            top_slice_rows = _query_rows(tp, top_slices_sql)["rows"]
            long_task_rows = _query_rows(tp, long_tasks_sql)["rows"]
            long_task_count_rows = _query_rows(tp, long_tasks_count_sql)["rows"]
            primary_thread = _pick_primary_thread(thread_rows)
            primary_thread_top_rows: list[dict[str, Any]] = []
            if primary_thread and primary_thread.get("utid") is not None:
                primary_thread_utid = int(primary_thread["utid"])
                primary_thread_top_sql = f"""
                    SELECT
                        s.name AS name,
                        COALESCE(NULLIF(s.category, ''), '[uncategorized]') AS category,
                        s.ts AS ts,
                        s.dur AS dur,
                        t.utid AS utid,
                        COALESCE(t.name, '[unknown thread]') AS threadName,
                        COALESCE(p.name, '[unknown process]') AS processName,
                        p.pid AS pid
                    FROM slice s
                    JOIN thread_track tt ON s.track_id = tt.id
                    JOIN thread t USING (utid)
                    LEFT JOIN process p USING (upid)
                    WHERE t.utid = {primary_thread_utid} AND s.dur > 0
                    ORDER BY s.dur DESC
                    LIMIT {top_slices_limit}
                """
                primary_thread_top_rows = _query_rows(tp, primary_thread_top_sql)["rows"]
    except RuntimeError as exc:
        return error(
            "CDP_TRACE_SUMMARY_DEPENDENCY_MISSING",
            str(exc),
            suggestion="Install lushly-botcore with the [cdp] extra so Perfetto is available.",
            retryable=False,
        )
    except Exception as exc:
        return error(
            "CDP_TRACE_SUMMARY_FAILED",
            f"{type(exc).__name__}: {exc}",
            suggestion=(
                "Ensure the trace is a valid Chrome or Perfetto trace and rerun the summary."
            ),
            retryable=False,
            details={"path": str(trace_path)},
        )

    bounds = bounds_rows[0] if bounds_rows else {}
    trace_start_ns = bounds.get("start_ts")
    trace_end_ns = bounds.get("end_ts")
    trace_duration_ns = (
        int(trace_end_ns) - int(trace_start_ns)
        if trace_start_ns is not None and trace_end_ns is not None
        else None
    )

    primary_thread_long_tasks = [
        row for row in long_task_rows if row.get("utid") == (primary_thread or {}).get("utid")
    ]
    metric_spans = [row for row in top_slice_rows if _is_metric_span(row)]
    browser_pipeline_long_tasks = [
        row
        for row in long_task_rows
        if _is_browser_pipeline_slice(row) and not _is_metric_span(row)
    ]
    other_long_tasks = [
        row
        for row in long_task_rows
        if row not in primary_thread_long_tasks
        and row not in browser_pipeline_long_tasks
        and row not in metric_spans
    ]

    def _decorate_slice(row: dict[str, Any]) -> dict[str, Any]:
        ts = row.get("ts")
        dur = row.get("dur")
        start_offset_ns = (
            int(ts) - int(trace_start_ns) if ts is not None and trace_start_ns is not None else None
        )
        return {
            "name": row.get("name"),
            "category": row.get("category"),
            "processName": row.get("processName"),
            "threadName": row.get("threadName"),
            "utid": row.get("utid"),
            "pid": row.get("pid"),
            "tsNs": ts,
            "durNs": dur,
            "startOffsetMs": _ns_to_ms(start_offset_ns),
            "durMs": _ns_to_ms(dur),
        }

    def _decorate_actor(row: dict[str, Any], *, include_utid: bool = False) -> dict[str, Any]:
        payload = {
            "processName": row.get("processName"),
            "threadName": row.get("threadName"),
            "pid": row.get("pid"),
            "sliceCount": row.get("sliceCount"),
            "totalSliceDurNs": row.get("totalSliceDurNs"),
            "totalSliceDurMs": _ns_to_ms(row.get("totalSliceDurNs")),
            "maxSliceDurNs": row.get("maxSliceDurNs"),
            "maxSliceDurMs": _ns_to_ms(row.get("maxSliceDurNs")),
        }
        if include_utid:
            payload["utid"] = row.get("utid")
        return payload

    summary = {
        "path": str(trace_path),
        "kind": "chrome-devtools-trace",
        "bounds": {
            "startTsNs": trace_start_ns,
            "endTsNs": trace_end_ns,
            "durationNs": trace_duration_ns,
            "durationMs": _ns_to_ms(trace_duration_ns),
        },
        "thresholds": {
            "longTaskMs": round(long_task_threshold_ms, 3),
            "topSlicesLimit": top_slices_limit,
        },
        "actors": {
            "topProcesses": [_decorate_actor(row) for row in process_rows],
            "topThreads": [_decorate_actor(row, include_utid=True) for row in thread_rows],
            "primaryThread": _decorate_actor(primary_thread, include_utid=True)
            if primary_thread
            else None,
        },
        "categories": [
            {
                "category": row.get("category"),
                "sliceCount": row.get("sliceCount"),
                "totalDurNs": row.get("totalDurNs"),
                "totalDurMs": _ns_to_ms(row.get("totalDurNs")),
                "maxDurNs": row.get("maxDurNs"),
                "maxDurMs": _ns_to_ms(row.get("maxDurNs")),
            }
            for row in category_rows
        ],
        "slices": {
            "topByDuration": [_decorate_slice(row) for row in top_slice_rows],
            "longTasks": [_decorate_slice(row) for row in long_task_rows],
            "longTaskCount": (long_task_count_rows[0].get("count") if long_task_count_rows else 0),
            "mainThreadTopByDuration": [_decorate_slice(row) for row in primary_thread_top_rows],
            "primaryThreadLongTasks": [_decorate_slice(row) for row in primary_thread_long_tasks],
            "browserPipelineLongTasks": [
                _decorate_slice(row) for row in browser_pipeline_long_tasks
            ],
            "metricSpans": [_decorate_slice(row) for row in metric_spans],
            "otherLongTasks": [_decorate_slice(row) for row in other_long_tasks],
        },
        "signals": {
            "mainThreadLongTaskCount": len(primary_thread_long_tasks),
            "browserPipelineLongTaskCount": len(browser_pipeline_long_tasks),
            "metricSpanCount": len(metric_spans),
            "otherLongTaskCount": len(other_long_tasks),
            "hasMainThreadJank": len(primary_thread_long_tasks) > 0,
            "hasBrowserPipelinePressure": len(browser_pipeline_long_tasks) > 0,
        },
        "notes": [
            (
                "Treat main-thread long tasks as the strongest UI red flag; browser-pipeline "
                "slices and metric spans provide context but are not always app regressions."
            ),
            (
                "Use cdp_trace_query for deeper PerfettoSQL inspection when the canned summary "
                "is not enough."
            ),
            (
                "Chrome trace timestamps and durations are reported in nanoseconds and "
                "summarized here in milliseconds for readability."
            ),
        ],
    }

    return success(
        summary,
        reasoning=(
            "Summarized the trace into stable actor, slice, and timing signals "
            "for automated analysis."
        ),
    )
