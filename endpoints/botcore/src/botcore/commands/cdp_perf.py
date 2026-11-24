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

import asyncio
from typing import Any

from afd import CommandResult, error

from botcore.commands.cdp.core import _with_session_page


async def perf_metrics() -> CommandResult[dict[str, Any]]:
    """Get runtime performance metrics."""

    async def _action(page: Any) -> dict[str, Any]:
        cdp = await page.context.new_cdp_session(page)
        await cdp.send("Performance.enable")
        result = await cdp.send("Performance.getMetrics")
        metrics = {m["name"]: m["value"] for m in result.get("metrics", [])}
        return {
            "metrics": metrics,
            "timestamp": metrics.get("Timestamp", 0),
        }

    return await _with_session_page(_action)


async def perf_trace_start(
    categories: list[str] | None = None,
    buffer_size_mb: int = 200,
    screenshots: bool = False,
) -> CommandResult[dict[str, Any]]:
    """Unsupported across stateless per-command CDP connections; use ``cdp_trace_capture``."""
    del categories, buffer_size_mb, screenshots
    return error(
        "CDP_TRACE_UNSUPPORTED",
        "perf_trace_start cannot hold a CDP tracing session open across separate commands.",
        suggestion=(
            "Use `cdp_trace_capture` (or `botcore cdp trace-capture`) to record a DevTools "
            "trace in one call, then `cdp_trace_summary` or `cdp_trace_query` to analyze it."
        ),
    )


async def perf_trace_stop(output_path: str | None = None) -> CommandResult[dict[str, Any]]:
    """Unsupported across stateless per-command CDP connections; use ``cdp_trace_capture``."""
    del output_path
    return error(
        "CDP_TRACE_UNSUPPORTED",
        "perf_trace_stop cannot stop a trace from an earlier CDP connection.",
        suggestion=(
            "Use `cdp_trace_capture` (or `botcore cdp trace-capture`) to record a DevTools "
            "trace in one call, then `cdp_trace_summary` or `cdp_trace_query` to analyze it."
        ),
    )


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
            summary["long_tasks"].append(
                {
                    "duration_ms": dur,
                    "start_time": event.get("ts", 0) / 1000,
                }
            )

    return summary


async def perf_profile_cpu(duration_ms: int = 5000) -> CommandResult[dict[str, Any]]:
    """Capture CPU profile for specified duration."""

    async def _action(page: Any) -> dict[str, Any]:
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
                hot_functions.append(
                    {
                        "function": call_frame.get("functionName", "(anonymous)"),
                        "url": call_frame.get("url", ""),
                        "line": call_frame.get("lineNumber", 0),
                        "sample_count": count,
                        "percentage": (count / len(samples)) * 100 if samples else 0,
                    }
                )

        hot_functions.sort(key=lambda x: x["sample_count"], reverse=True)

        return {
            "duration_ms": duration_ms,
            "total_samples": len(samples),
            "total_nodes": len(nodes),
            "hot_functions": hot_functions[:20],
        }

    return await _with_session_page(_action)


async def perf_profile_memory() -> CommandResult[dict[str, Any]]:
    """Capture heap snapshot summary."""

    async def _action(page: Any) -> dict[str, Any]:
        cdp = await page.context.new_cdp_session(page)
        await cdp.send("HeapProfiler.enable")
        await cdp.send("HeapProfiler.startSampling")
        await asyncio.sleep(1)
        result = await cdp.send("HeapProfiler.stopSampling")
        profile = result.get("profile", {})

        head = profile.get("head", {})
        samples = profile.get("samples", [])
        total_size = sum(s.get("size", 0) for s in samples)

        return {
            "total_allocated_bytes": total_size,
            "sample_count": len(samples),
            "head_self_size": head.get("selfSize", 0),
        }

    return await _with_session_page(_action)


async def perf_coverage() -> CommandResult[dict[str, Any]]:
    """Get JavaScript code coverage report."""

    async def _action(page: Any) -> dict[str, Any]:
        cdp = await page.context.new_cdp_session(page)
        await cdp.send("Profiler.enable")
        await cdp.send(
            "Profiler.startPreciseCoverage",
            {
                "callCount": True,
                "detailed": True,
            },
        )

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
                scripts.append(
                    {
                        "url": url,
                        "total_bytes": total_bytes,
                        "covered_bytes": covered_bytes,
                        "coverage_percent": (covered_bytes / total_bytes) * 100,
                    }
                )

        scripts.sort(key=lambda x: x["coverage_percent"])

        await cdp.send("Profiler.stopPreciseCoverage")

        return {
            "scripts": scripts[:20],
            "total_scripts": len(scripts),
        }

    return await _with_session_page(_action)
