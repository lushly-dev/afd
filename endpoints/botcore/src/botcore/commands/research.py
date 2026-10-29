"""Botcore research commands — web research via OpenAI GPT models with web search."""

from __future__ import annotations

import os
import time
from collections.abc import AsyncIterator
from typing import Any

from afd import CommandResult, Source, error, success
from afd.core.errors import CommandError
from afd.core.streaming import (
    StreamChunk,
    create_complete_chunk,
    create_data_chunk,
    create_error_chunk,
    create_progress_chunk,
    is_complete_chunk,
    is_error_chunk,
)

# Model and reasoning effort per research mode. The single place to change models.
SEARCH_MODELS = {
    "fast": "gpt-6-luna",
    "deep": "gpt-6.1-sol",
    "thinking": "gpt-6.1-sol",
}
REASONING_EFFORT = {
    "fast": "low",
    "deep": "medium",
    "thinking": "high",
}

# Answer budget in characters, a context-economy guard for LLM-facing callers.
MAX_RESEARCH_LENGTH = 12000
_TRUNCATION_MARKER = "\n\n... (truncated for token safety)"


def _check_openai_available() -> bool:
    """Check if the openai package is installed."""
    try:
        import openai  # noqa: F401

        return True
    except ImportError:
        return False


def _merge_sources(cited: list[str], consulted: list[str]) -> list[str]:
    """Cited URLs first, then other consulted URLs, deduplicated and capped at 10."""
    return list(dict.fromkeys(cited + consulted))[:10]


def _citation_url(annotation: Any) -> str | None:
    if getattr(annotation, "type", None) == "url_citation":
        return annotation.url
    return None


def _consulted_urls(item: Any) -> list[str]:
    """URLs a web_search_call output item consulted, when sources were included."""
    action = getattr(item, "action", None)
    sources = getattr(action, "sources", None) or []
    return [source.url for source in sources if getattr(source, "url", None)]


def _extract_sources(response: Any) -> list[str]:
    """Collect cited URLs from a completed response, then any other consulted URLs."""
    cited: list[str] = []
    consulted: list[str] = []
    for item in getattr(response, "output", None) or []:
        if getattr(item, "type", None) == "message":
            for part in getattr(item, "content", None) or []:
                for annotation in getattr(part, "annotations", None) or []:
                    url = _citation_url(annotation)
                    if url:
                        cited.append(url)
        elif getattr(item, "type", None) == "web_search_call":
            consulted.extend(_consulted_urls(item))
    return _merge_sources(cited, consulted)


def _event_error_message(event: Any) -> str:
    """Describe a failed, incomplete, or error stream event."""
    if getattr(event, "type", "") == "error":
        return event.message
    response = getattr(event, "response", None)
    err = getattr(response, "error", None)
    if err is not None:
        return err.message
    details = getattr(response, "incomplete_details", None)
    if details is not None:
        return f"response incomplete ({details.reason})"
    return getattr(event, "type", "unknown stream event")


def _error_chunk(code: str, message: str, suggestion: str, chunks_before_error: int = 0):
    return create_error_chunk(
        CommandError(code=code, message=message, suggestion=suggestion),
        chunks_before_error=chunks_before_error,
    )


async def research_stream(query: str, mode: str = "fast") -> AsyncIterator[StreamChunk]:
    """Stream a research query with an OpenAI GPT model and web search.

    Yields a progress chunk when the search starts, a data chunk ``{"text": ...}``
    for each piece of the answer, and finally a complete chunk carrying the same
    data ``research_query`` returns, or an error chunk. Joining the data chunks'
    text gives the complete chunk's ``answer``.

    Args:
        query: The research query
        mode: 'fast' (default), 'deep', or 'thinking' (most reasoning)

    Requires openai: pip install botcore[research]
    """
    if mode not in SEARCH_MODELS:
        yield _error_chunk(
            "INVALID_MODE",
            f"Invalid mode: {mode}",
            "Use mode='fast' (default), 'deep', or 'thinking'",
        )
        return

    if not _check_openai_available():
        yield _error_chunk(
            "MISSING_PACKAGE",
            "openai package not installed",
            "Install with: pip install botcore[research]",
        )
        return

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        yield _error_chunk(
            "MISSING_API_KEY",
            "OPENAI_API_KEY environment variable not set",
            "Set OPENAI_API_KEY in environment or .env file",
        )
        return

    from openai import AsyncOpenAI

    model_name = SEARCH_MODELS[mode]
    started = time.monotonic()
    yield create_progress_chunk(0.0, message=f"Researching with {model_name}", phase="start")

    answer = ""
    sources: list[str] = []
    # Sources seen so far, for an answer cut off before response.completed.
    cited: list[str] = []
    consulted: list[str] = []
    finished = False
    # Hold back one piece so the last data chunk can be marked is_last.
    pending: str | None = None
    index = 0
    searching_reported = False
    try:
        client = AsyncOpenAI(api_key=api_key)
        stream = await client.responses.create(
            model=model_name,
            input=query,
            tools=[{"type": "web_search"}],
            include=["web_search_call.action.sources"],
            reasoning={"effort": REASONING_EFFORT[mode]},
            stream=True,
        )
        async with stream:
            async for event in stream:
                kind = getattr(event, "type", "")
                if kind == "response.web_search_call.searching" and not searching_reported:
                    searching_reported = True
                    yield create_progress_chunk(0.0, message="Searching the web", phase="search")
                elif kind == "response.output_text.delta":
                    text = event.delta
                    if not text:
                        continue
                    room = MAX_RESEARCH_LENGTH - len(answer)
                    truncated = len(text) > room
                    if truncated:
                        text = text[:room] + _TRUNCATION_MARKER
                    answer += text
                    if pending is not None:
                        yield create_data_chunk({"text": pending}, index=index, is_last=False)
                        index += 1
                    pending = text
                    if truncated:
                        sources = _merge_sources(cited, consulted)
                        finished = True
                        break
                elif kind == "response.output_text.annotation.added":
                    url = _citation_url(event.annotation)
                    if url:
                        cited.append(url)
                elif kind == "response.output_item.done":
                    if getattr(event.item, "type", None) == "web_search_call":
                        consulted.extend(_consulted_urls(event.item))
                elif kind == "response.completed":
                    sources = _extract_sources(event.response)
                    finished = True
                elif kind in ("response.failed", "response.incomplete", "error"):
                    yield _error_chunk(
                        "RESEARCH_FAILED",
                        f"Research query failed: {_event_error_message(event)}",
                        "Retry the query, or narrow it if the answer was cut short",
                        chunks_before_error=index,
                    )
                    return
    except Exception as e:
        yield _error_chunk(
            "RESEARCH_FAILED",
            f"Research query failed: {e}",
            "Check OPENAI_API_KEY and network connectivity",
            chunks_before_error=index,
        )
        return

    if not finished:
        yield _error_chunk(
            "RESEARCH_INCOMPLETE",
            "Research stream ended before the response completed",
            "Retry the query",
            chunks_before_error=index,
        )
        return

    if pending is not None:
        yield create_data_chunk({"text": pending}, index=index, is_last=True)
        index += 1

    yield create_complete_chunk(
        total_chunks=index,
        total_duration_ms=(time.monotonic() - started) * 1000,
        data={
            "answer": answer,
            "query": query,
            "mode": mode,
            "model": model_name,
            "sources": sources,
        },
        confidence=0.85 if sources else 0.5,
        reasoning=f"Research completed via {model_name}",
    )


def research_result(chunk: StreamChunk) -> CommandResult[dict] | None:
    """Convert a terminal ``research_stream`` chunk into a CommandResult.

    Returns None for progress and data chunks.
    """
    if is_error_chunk(chunk):
        err = chunk.error
        return error(err.code, err.message, suggestion=err.suggestion)
    if is_complete_chunk(chunk):
        data = chunk.data
        return success(
            data=data,
            reasoning=chunk.reasoning,
            confidence=chunk.confidence,
            sources=[Source(type="url", id=url, title=url, url=url) for url in data["sources"]],
        )
    return None


async def research_query(query: str, mode: str = "fast") -> CommandResult[dict]:
    """Run a research query with an OpenAI GPT model and web search.

    Collects ``research_stream`` into a single result.

    Args:
        query: The research query
        mode: 'fast' (default), 'deep', or 'thinking' (most reasoning)

    Requires openai: pip install botcore[research]
    """
    async for chunk in research_stream(query, mode):
        result = research_result(chunk)
        if result is not None:
            return result
    return error(
        "RESEARCH_FAILED",
        "Research stream ended without a result",
        suggestion="Retry the query",
    )
