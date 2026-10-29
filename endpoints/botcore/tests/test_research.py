"""Tests for botcore.commands.research — GPT web research commands and streaming."""

from __future__ import annotations

import json
import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

import pytest
from afd.testing import (
    assert_error,
    assert_has_confidence,
    assert_has_reasoning,
    assert_has_sources,
    assert_success,
)

from botcore.commands.research import (
    _TRUNCATION_MARKER,
    MAX_RESEARCH_LENGTH,
    research_query,
    research_stream,
)


def _completed_response() -> SimpleNamespace:
    """A completed response with two citations and one extra consulted source."""
    citation = SimpleNamespace(type="url_citation", url="https://example.com/a")
    return SimpleNamespace(
        output=[
            SimpleNamespace(
                type="web_search_call",
                action=SimpleNamespace(
                    sources=[
                        SimpleNamespace(url="https://example.com/a"),
                        SimpleNamespace(url="https://example.com/c"),
                    ],
                ),
            ),
            SimpleNamespace(
                type="message",
                content=[
                    SimpleNamespace(
                        annotations=[
                            citation,
                            SimpleNamespace(type="url_citation", url="https://example.com/b"),
                            citation,
                        ],
                    ),
                ],
            ),
        ],
    )


def _delta(text: str) -> SimpleNamespace:
    return SimpleNamespace(type="response.output_text.delta", delta=text)


_SEARCHING = SimpleNamespace(type="response.web_search_call.searching")
_COMPLETED = SimpleNamespace(type="response.completed", response=_completed_response())


class _FakeStream:
    """Async-iterable, async-context-managed stand-in for openai's AsyncStream."""

    def __init__(self, events: list, raise_after: Exception | None = None) -> None:
        self._events = events
        self._raise_after = raise_after
        self.consumed = 0
        self.closed = False

    async def __aenter__(self) -> _FakeStream:
        return self

    async def __aexit__(self, *exc: object) -> None:
        self.closed = True

    async def __aiter__(self):
        for event in self._events:
            self.consumed += 1
            yield event
        if self._raise_after is not None:
            raise self._raise_after


def _fake_openai(stream: _FakeStream, calls: list[dict]) -> ModuleType:
    async def create(**kwargs):
        calls.append(kwargs)
        return stream

    module = ModuleType("openai")
    module.AsyncOpenAI = lambda api_key: SimpleNamespace(responses=SimpleNamespace(create=create))
    return module


def _patched(stream: _FakeStream, calls: list[dict]):
    return (
        patch("botcore.commands.research._check_openai_available", return_value=True),
        patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}, clear=True),
        patch.dict(sys.modules, {"openai": _fake_openai(stream, calls)}),
    )


async def _collect(query: str, stream: _FakeStream, calls: list[dict], mode: str = "fast"):
    p1, p2, p3 = _patched(stream, calls)
    with p1, p2, p3:
        return [chunk async for chunk in research_stream(query, mode)]


async def test_research_invalid_mode() -> None:
    """research_query rejects invalid mode."""
    result = await research_query("test", mode="invalid")
    assert_error(result, "INVALID_MODE")


async def test_research_missing_package() -> None:
    """research_query errors when openai is not installed."""
    with patch("botcore.commands.research._check_openai_available", return_value=False):
        result = await research_query("test")

    assert_error(result, "MISSING_PACKAGE")


async def test_research_missing_api_key() -> None:
    """research_query errors when OPENAI_API_KEY is not set."""
    with (
        patch("botcore.commands.research._check_openai_available", return_value=True),
        patch.dict("os.environ", {}, clear=True),
    ):
        result = await research_query("test")

    assert_error(result, "MISSING_API_KEY")


async def test_research_success_includes_afd_metadata() -> None:
    """research_query returns the answer, cited-first sources, confidence, and reasoning."""
    calls: list[dict] = []
    stream = _FakeStream([_SEARCHING, _delta("Grounded "), _delta("answer"), _COMPLETED])
    p1, p2, p3 = _patched(stream, calls)
    with p1, p2, p3:
        result = await research_query("test query")

    data = assert_success(result)
    assert data["answer"] == "Grounded answer"
    assert data["model"] == "gpt-6-luna"
    expected = ["https://example.com/a", "https://example.com/b", "https://example.com/c"]
    assert data["sources"] == expected
    assert_has_confidence(result, min_confidence=0.8, max_confidence=0.9)
    assert_has_reasoning(result, contains="Research completed via gpt-6-luna")
    sources = assert_has_sources(result, min_count=3)
    assert [source.url for source in sources] == expected


@pytest.mark.parametrize(
    ("mode", "model", "effort"),
    [
        ("fast", "gpt-6-luna", "low"),
        ("deep", "gpt-6.1-sol", "medium"),
        ("thinking", "gpt-6.1-sol", "high"),
    ],
)
async def test_research_request_per_mode(mode: str, model: str, effort: str) -> None:
    """Each mode sends its model and effort, web search, and no sampling parameters."""
    calls: list[dict] = []
    await _collect("q", _FakeStream([_COMPLETED]), calls, mode=mode)

    (request,) = calls
    assert request["model"] == model
    assert request["reasoning"] == {"effort": effort}
    assert request["tools"] == [{"type": "web_search"}]
    assert request["include"] == ["web_search_call.action.sources"]
    assert request["stream"] is True
    assert "temperature" not in request


async def test_research_stream_chunk_sequence() -> None:
    """The stream emits progress, ordered data chunks with one is_last, then complete."""
    calls: list[dict] = []
    stream = _FakeStream([_SEARCHING, _delta("One "), _delta("two "), _delta("three"), _COMPLETED])
    chunks = await _collect("q", stream, calls)

    assert [c.type for c in chunks] == [
        "progress",
        "progress",
        "data",
        "data",
        "data",
        "complete",
    ]
    assert [c.phase for c in chunks[:2]] == ["start", "search"]
    data = [c for c in chunks if c.type == "data"]
    assert [c.index for c in data] == [0, 1, 2]
    assert [c.is_last for c in data] == [False, False, True]
    complete = chunks[-1]
    assert complete.total_chunks == 3
    assert "".join(c.data["text"] for c in data) == complete.data["answer"] == "One two three"
    assert stream.closed


async def test_research_stream_truncates_and_stops_reading() -> None:
    """An answer over the budget is cut, marked, and the remaining events are not read."""
    calls: list[dict] = []
    events = [
        _delta("x" * (MAX_RESEARCH_LENGTH - 5)),
        _delta("y" * 10),
        _delta("never"),
        _COMPLETED,
    ]
    stream = _FakeStream(events)
    chunks = await _collect("q", stream, calls)

    complete = chunks[-1]
    answer = complete.data["answer"]
    assert answer == "x" * (MAX_RESEARCH_LENGTH - 5) + "y" * 5 + _TRUNCATION_MARKER
    assert "".join(c.data["text"] for c in chunks if c.type == "data") == answer
    assert stream.consumed == 2
    assert stream.closed


async def test_research_stream_failed_event() -> None:
    """A response.failed event becomes an error chunk after the data already sent."""
    failed = SimpleNamespace(
        type="response.failed",
        response=SimpleNamespace(error=SimpleNamespace(message="server overloaded")),
    )
    calls: list[dict] = []
    chunks = await _collect("q", _FakeStream([_delta("a"), _delta("b"), failed]), calls)

    error_chunk = chunks[-1]
    assert error_chunk.type == "error"
    assert error_chunk.error.code == "RESEARCH_FAILED"
    assert "server overloaded" in error_chunk.error.message
    assert error_chunk.chunks_before_error == 1


async def test_research_query_reports_mid_stream_exception() -> None:
    """An exception while streaming returns RESEARCH_FAILED with a suggestion."""
    calls: list[dict] = []
    stream = _FakeStream([_delta("partial")], raise_after=RuntimeError("connection reset"))
    p1, p2, p3 = _patched(stream, calls)
    with p1, p2, p3:
        result = await research_query("q")

    assert_error(result, "RESEARCH_FAILED")
    assert "connection reset" in result.error.message
    assert result.error.suggestion


async def test_mcp_research_tool_forwards_progress() -> None:
    """The {name}-research tool reports stream progress and returns the result as JSON."""
    from botcore._mcp import sdk_types

    _, Context = sdk_types()

    from botcore.server import create_mcp_server

    reported: list[tuple[float, str | None]] = []

    async def record(self, progress, total=None, message=None):
        reported.append((progress, message))

    calls: list[dict] = []
    stream = _FakeStream([_SEARCHING, _delta("Hi "), _delta("there"), _COMPLETED])
    p1, p2, p3 = _patched(stream, calls)
    with (
        patch("botcore.server.discover_plugins", lambda *a, **k: {}),
        patch.object(Context, "report_progress", record),
        p1,
        p2,
        p3,
    ):
        server = create_mcp_server("test", include_research=True)
        result = await server.call_tool("test-research", {"query": "q"})
        content = result.content if hasattr(result, "content") else result[0]

    payload = json.loads(content[0].text)
    assert payload["success"] is True
    assert payload["data"]["answer"] == "Hi there"
    assert reported == [
        (1, "Researching with gpt-6-luna"),
        (2, "Searching the web"),
        (3, "Hi "),
        (4, "there"),
    ]


async def test_research_stream_truncation_keeps_sources_seen_so_far() -> None:
    """Sources from citations and finished searches survive a truncated answer."""
    events = [
        SimpleNamespace(
            type="response.output_item.done",
            item=SimpleNamespace(
                type="web_search_call",
                action=SimpleNamespace(sources=[SimpleNamespace(url="https://example.com/c")]),
            ),
        ),
        SimpleNamespace(
            type="response.output_text.annotation.added",
            annotation=SimpleNamespace(type="url_citation", url="https://example.com/a"),
        ),
        _delta("x" * MAX_RESEARCH_LENGTH),
        _delta("over"),
        _COMPLETED,
    ]
    calls: list[dict] = []
    chunks = await _collect("q", _FakeStream(events), calls)

    complete = chunks[-1]
    assert complete.data["answer"] == "x" * MAX_RESEARCH_LENGTH + _TRUNCATION_MARKER
    assert complete.data["sources"] == ["https://example.com/a", "https://example.com/c"]


async def test_research_stream_skips_empty_deltas() -> None:
    """Empty text deltas produce no data chunks."""
    calls: list[dict] = []
    stream = _FakeStream([_delta(""), _delta("only"), _delta(""), _COMPLETED])
    chunks = await _collect("q", stream, calls)

    data = [c for c in chunks if c.type == "data"]
    assert [(c.data["text"], c.index, c.is_last) for c in data] == [("only", 0, True)]


async def test_research_stream_without_completed_is_an_error() -> None:
    """A stream that ends before response.completed is not reported as a success."""
    calls: list[dict] = []
    chunks = await _collect("q", _FakeStream([_delta("partial")]), calls)

    error_chunk = chunks[-1]
    assert error_chunk.type == "error"
    assert error_chunk.error.code == "RESEARCH_INCOMPLETE"
    assert error_chunk.error.suggestion


@pytest.mark.parametrize(
    ("event", "message"),
    [
        (
            SimpleNamespace(
                type="response.incomplete",
                response=SimpleNamespace(
                    error=None,
                    incomplete_details=SimpleNamespace(reason="max_output_tokens"),
                ),
            ),
            "response incomplete (max_output_tokens)",
        ),
        (SimpleNamespace(type="error", message="rate limited"), "rate limited"),
    ],
)
async def test_research_stream_incomplete_and_error_events(event, message: str) -> None:
    """response.incomplete and error events end the stream with RESEARCH_FAILED."""
    calls: list[dict] = []
    chunks = await _collect("q", _FakeStream([event]), calls)

    error_chunk = chunks[-1]
    assert error_chunk.error.code == "RESEARCH_FAILED"
    assert message in error_chunk.error.message
    assert error_chunk.chunks_before_error == 0


async def test_research_stream_request_failure() -> None:
    """A failure creating the request is an error chunk with no data before it."""

    async def create(**kwargs):
        raise RuntimeError("401 unauthorized")

    module = ModuleType("openai")
    module.AsyncOpenAI = lambda api_key: SimpleNamespace(responses=SimpleNamespace(create=create))
    with (
        patch("botcore.commands.research._check_openai_available", return_value=True),
        patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}, clear=True),
        patch.dict(sys.modules, {"openai": module}),
    ):
        chunks = [chunk async for chunk in research_stream("q")]

    assert [c.type for c in chunks] == ["progress", "error"]
    assert "401 unauthorized" in chunks[-1].error.message
    assert chunks[-1].chunks_before_error == 0
