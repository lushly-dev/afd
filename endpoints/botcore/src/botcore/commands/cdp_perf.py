"""CDP Performance profiling commands.

Provides performance tracing and profiling via Chrome DevTools Protocol.

Commands:
    perf_metrics - Get runtime performance metrics
    perf_trace_start - Start trace recording
    perf_trace_stop - Stop trace and get results
    perf_profile_cpu - CPU profiling
    perf_profile_memory - Memory profiling (heap snapshot)
    perf_coverage - Code coverage report
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from afd import error, success

from botcore.commands.cdp.core import _with_session_page

# Module-level state for tracing
_trace_cdp_session = None
_trace_events: list[dict] = []


async def perf_metrics() -> dict[str, Any]:
    """Get runtime performance metrics."""

    async def _action(page: Any) -> Any:
        cdp = await page.context.new_cdp_session(page)
        await cdp.send("Performance.enable")
        result = await cdp.send("Performance.getMetrics")
        metrics = {m["name"]: m["value"] for m in result.get("metrics", [])}
        return success({
            "metrics": metrics,
            "timestamp": metrics.get("Timestamp", 0),
        })

    return await _with_session_page(_action)


async def perf_trace_start(
    categories: list[str] | None = None,
    buffer_size_mb: int = 200,
    screenshots: bool = False,
) -> dict[str, Any]:
    """Start performance trace recording."""
    global _trace_cdp_session, _trace_events

    if _trace_cdp_session is not None:
        return error(
            "TRACE_ACTIVE",
            "Trace already in progress. Call perf_trace_stop first.",
            suggestion="Run 'botcore cdp perf-trace-stop' to end the current trace",
        )

    default_categories = [
        "devtools.timeline",
        "v8.execute",
        "blink.user_timing",
        "blink.console",
        "disabled-by-default-devtools.timeline",
        "disabled-by-default-devtools.timeline.frame",
    ]
    if screenshots:
        default_categories.append("disabled-by-default-devtools.screenshot")

    async def _action(page: Any) -> Any:
        global _trace_cdp_session, _trace_events

        cdp = await page.context.new_cdp_session(page)
        _trace_cdp_session = cdp
        _trace_events = []

        def on_data_collected(params: dict) -> None:
            _trace_events.extend(params.get("value", []))

        cdp.on("Tracing.dataCollected", on_data_collected)

        await cdp.send(
            "Tracing.start",
            {
                "traceConfig": {
                    "includedCategories": categories or default_categories,
                    "memoryDumpConfig": {},
                },
                "bufferUsageReportingInterval": 500,
                "transferMode": "ReturnAsStream",
            },
        )

        return success({
            "status": "tracing_started",
            "categories": categories or default_categories,
        })

    return await _with_session_page(_action)


async def perf_trace_stop(output_path: str | None = None) -> dict[str, Any]:
    """Stop trace recording and return results."""
    global _trace_cdp_session, _trace_events

    if _trace_cdp_session is None:
        return error(
            "NO_TRACE",
            "No trace in progress. Call perf_trace_start first.",
            suggestion="Run 'botcore cdp perf-trace-start' to begin a trace",
        )

    try:
        import asyncio

        await _trace_cdp_session.send("Tracing.end")
        await asyncio.sleep(0.5)

        summary = _analyze_trace_events(_trace_events)

        file_saved = None
        if output_path:
            path = Path(output_path)
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, "w") as f:
                json.dump({"traceEvents": _trace_events}, f)
            file_saved = str(path)

        return success({
            "status": "trace_complete",
            "event_count": len(_trace_events),
            "summary": summary,
            "file_saved": file_saved,
        })
    finally:
        _trace_cdp_session = None
        _trace_events = []


def _analyze_trace_events(events: list[dict]) -> dict[str, Any]:
    """Analyze trace events and extract key metrics."""
    summary: dict[str, Any] = {
        "total_events": len(events),
        "script_duration_ms": 0,
        "layout_count": 0,
        "paint_count": 0,
        "gc_count": 0,
        "long_tasks": [],
    }

    for event in events:
        name = event.get("name", "")
        dur = event.get("dur", 0) / 1000

        if name == "EvaluateScript":
            summary["script_duration_ms"] += dur
        elif name == "Layout":
            summary["layout_count"] += 1
        elif name == "Paint":
            summary["paint_count"] += 1
        elif name in ("MinorGC", "MajorGC", "V8.GCScavenger"):
            summary["gc_count"] += 1
        elif name == "RunTask" and dur > 50:
            summary["long_tasks"].append({
                "duration_ms": dur,
                "start_time": event.get("ts", 0) / 1000,
            })

    return summary


async def perf_profile_cpu(duration_ms: int = 5000) -> dict[str, Any]:
    """Capture CPU profile for specified duration."""
    import asyncio

    async def _action(page: Any) -> Any:
        cdp = await page.context.new_cdp_session(page)
        await cdp.send("Profiler.enable")
        await cdp.send("Profiler.start")
        await asyncio.sleep(duration_ms / 1000)
        result = await cdp.send("Profiler.stop")
        profile = result.get("profile", {})

        nodes = profile.get("nodes", [])
        samples = profile.get("samples", [])

        sample_counts: dict[int, int] = {}
        for sample_id in samples:
            sample_counts[sample_id] = sample_counts.get(sample_id, 0) + 1

        hot_functions = []
        for node in nodes:
            node_id = node.get("id")
            count = sample_counts.get(node_id, 0)
            if count > 0:
                call_frame = node.get("callFrame", {})
                hot_functions.append({
                    "function": call_frame.get("functionName", "(anonymous)"),
                    "url": call_frame.get("url", ""),
                    "line": call_frame.get("lineNumber", 0),
                    "sample_count": count,
                    "percentage": (count / len(samples)) * 100 if samples else 0,
                })

        hot_functions.sort(key=lambda x: x["sample_count"], reverse=True)

        return success({
            "duration_ms": duration_ms,
            "total_samples": len(samples),
            "total_nodes": len(nodes),
            "hot_functions": hot_functions[:20],
        })

    return await _with_session_page(_action)


async def perf_profile_memory() -> dict[str, Any]:
    """Capture heap snapshot summary."""

    async def _action(page: Any) -> Any:
        import asyncio

        cdp = await page.context.new_cdp_session(page)
        await cdp.send("HeapProfiler.enable")
        await cdp.send("HeapProfiler.startSampling")
        await asyncio.sleep(1)
        result = await cdp.send("HeapProfiler.stopSampling")
        profile = result.get("profile", {})

        head = profile.get("head", {})
        samples = profile.get("samples", [])
        total_size = sum(s.get("size", 0) for s in samples)

        return success({
            "total_allocated_bytes": total_size,
            "sample_count": len(samples),
            "head_self_size": head.get("selfSize", 0),
        })

    return await _with_session_page(_action)


async def perf_coverage() -> dict[str, Any]:
    """Get JavaScript code coverage report."""

    async def _action(page: Any) -> Any:
        cdp = await page.context.new_cdp_session(page)
        await cdp.send("Profiler.enable")
        await cdp.send("Profiler.startPreciseCoverage", {
            "callCount": True,
            "detailed": True,
        })

        result = await cdp.send("Profiler.takePreciseCoverage")

        scripts = []
        for script in result.get("result", []):
            url = script.get("url", "")
            if not url or url.startswith("extensions://"):
                continue

            functions = script.get("functions", [])
            total_bytes = 0
            covered_bytes = 0

            for func in functions:
                for range_data in func.get("ranges", []):
                    size = range_data.get("endOffset", 0) - range_data.get("startOffset", 0)
                    total_bytes += size
                    if range_data.get("count", 0) > 0:
                        covered_bytes += size

            if total_bytes > 0:
                scripts.append({
                    "url": url,
                    "total_bytes": total_bytes,
                    "covered_bytes": covered_bytes,
                    "coverage_percent": (covered_bytes / total_bytes) * 100,
                })

        scripts.sort(key=lambda x: x["coverage_percent"])

        await cdp.send("Profiler.stopPreciseCoverage")

        return success({
            "scripts": scripts[:20],
            "total_scripts": len(scripts),
        })

    return await _with_session_page(_action)
