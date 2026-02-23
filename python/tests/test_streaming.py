"""Tests for afd.core.streaming module."""

import asyncio
from typing import AsyncIterator

import pytest

from afd.core.errors import CommandError
from afd.core.result import ResultMetadata
from afd.core.streaming import (
    CompleteChunk,
    DataChunk,
    ErrorChunk,
    ProgressChunk,
    StreamCallbacks,
    StreamableCommand,
    StreamChunk,
    StreamOptions,
    collect_stream_data,
    consume_stream,
    create_complete_chunk,
    create_data_chunk,
    create_error_chunk,
    create_progress_chunk,
    is_complete_chunk,
    is_data_chunk,
    is_error_chunk,
    is_progress_chunk,
    is_stream_chunk,
    is_streamable_command,
)


class TestCreateProgressChunk:
    """Tests for create_progress_chunk factory."""

    def test_basic_progress(self):
        chunk = create_progress_chunk(0.5)
        assert chunk.type == "progress"
        assert chunk.progress == 0.5
        assert chunk.message is None

    def test_with_message(self):
        chunk = create_progress_chunk(0.75, message="Processing...")
        assert chunk.message == "Processing..."

    def test_with_items(self):
        chunk = create_progress_chunk(
            0.5, items_processed=50, items_total=100,
        )
        assert chunk.items_processed == 50
        assert chunk.items_total == 100

    def test_with_all_fields(self):
        chunk = create_progress_chunk(
            0.3,
            message="Phase 2",
            items_processed=30,
            items_total=100,
            estimated_time_remaining_ms=7000,
            phase="indexing",
        )
        assert chunk.progress == 0.3
        assert chunk.phase == "indexing"
        assert chunk.estimated_time_remaining_ms == 7000

    def test_clamps_above_one(self):
        chunk = create_progress_chunk(1.5)
        assert chunk.progress == 1.0

    def test_clamps_below_zero(self):
        chunk = create_progress_chunk(-0.5)
        assert chunk.progress == 0.0

    def test_boundary_values(self):
        assert create_progress_chunk(0.0).progress == 0.0
        assert create_progress_chunk(1.0).progress == 1.0


class TestCreateDataChunk:
    """Tests for create_data_chunk factory."""

    def test_basic_data_chunk(self):
        chunk = create_data_chunk({"id": "1"}, 0, False)
        assert chunk.type == "data"
        assert chunk.data == {"id": "1"}
        assert chunk.index == 0
        assert chunk.is_last is False
        assert chunk.chunk_id is None

    def test_last_chunk(self):
        chunk = create_data_chunk("final", 5, True)
        assert chunk.is_last is True

    def test_with_chunk_id(self):
        chunk = create_data_chunk("data", 0, False, chunk_id="chunk-abc")
        assert chunk.chunk_id == "chunk-abc"

    def test_various_data_types(self):
        assert create_data_chunk(42, 0, True).data == 42
        assert create_data_chunk([1, 2, 3], 0, True).data == [1, 2, 3]
        assert create_data_chunk("text", 0, True).data == "text"


class TestCreateCompleteChunk:
    """Tests for create_complete_chunk factory."""

    def test_minimal_complete(self):
        chunk = create_complete_chunk(10, 5000)
        assert chunk.type == "complete"
        assert chunk.total_chunks == 10
        assert chunk.total_duration_ms == 5000
        assert chunk.data is None
        assert chunk.confidence is None

    def test_with_all_fields(self):
        meta = ResultMetadata(trace_id="trace-123")
        chunk = create_complete_chunk(
            10, 5000,
            data={"exported": 100},
            confidence=0.95,
            reasoning="All items exported",
            metadata=meta,
        )
        assert chunk.data == {"exported": 100}
        assert chunk.confidence == 0.95
        assert chunk.reasoning == "All items exported"
        assert chunk.metadata.trace_id == "trace-123"


class TestCreateErrorChunk:
    """Tests for create_error_chunk factory."""

    def test_non_recoverable_error(self):
        err = CommandError(code="FATAL", message="Fatal error")
        chunk = create_error_chunk(err, 5)
        assert chunk.type == "error"
        assert chunk.error.code == "FATAL"
        assert chunk.chunks_before_error == 5
        assert chunk.recoverable is False
        assert chunk.resume_from is None

    def test_recoverable_error(self):
        err = CommandError(code="TIMEOUT", message="Timed out")
        chunk = create_error_chunk(err, 10, True, resume_from=10)
        assert chunk.recoverable is True
        assert chunk.resume_from == 10

    def test_zero_chunks_before_error(self):
        err = CommandError(code="INIT_FAIL", message="Init failed")
        chunk = create_error_chunk(err, 0)
        assert chunk.chunks_before_error == 0


class TestStreamingTypeGuards:
    """Tests for streaming type guard functions."""

    def test_is_progress_chunk_with_instance(self):
        chunk = ProgressChunk(progress=0.5)
        assert is_progress_chunk(chunk) is True

    def test_is_progress_chunk_with_dict(self):
        assert is_progress_chunk({"type": "progress"}) is True

    def test_is_progress_chunk_false(self):
        assert is_progress_chunk({"type": "data"}) is False
        assert is_progress_chunk("string") is False

    def test_is_data_chunk_with_instance(self):
        chunk = DataChunk(data="x", index=0, is_last=True)
        assert is_data_chunk(chunk) is True

    def test_is_data_chunk_with_dict(self):
        assert is_data_chunk({"type": "data"}) is True

    def test_is_data_chunk_false(self):
        assert is_data_chunk({"type": "progress"}) is False

    def test_is_complete_chunk_with_instance(self):
        chunk = CompleteChunk(total_chunks=0, total_duration_ms=0)
        assert is_complete_chunk(chunk) is True

    def test_is_complete_chunk_with_dict(self):
        assert is_complete_chunk({"type": "complete"}) is True

    def test_is_complete_chunk_false(self):
        assert is_complete_chunk({"type": "error"}) is False

    def test_is_error_chunk_with_instance(self):
        err = CommandError(code="E", message="e")
        chunk = ErrorChunk(error=err, chunks_before_error=0)
        assert is_error_chunk(chunk) is True

    def test_is_error_chunk_with_dict(self):
        assert is_error_chunk({"type": "error"}) is True

    def test_is_error_chunk_false(self):
        assert is_error_chunk({"type": "complete"}) is False

    def test_is_stream_chunk_all_types(self):
        assert is_stream_chunk(ProgressChunk(progress=0.5)) is True
        assert is_stream_chunk(DataChunk(data="x", index=0, is_last=True)) is True
        assert is_stream_chunk(CompleteChunk(total_chunks=0, total_duration_ms=0)) is True
        err = CommandError(code="E", message="e")
        assert is_stream_chunk(ErrorChunk(error=err, chunks_before_error=0)) is True

    def test_is_stream_chunk_dicts(self):
        assert is_stream_chunk({"type": "progress", "progress": 0.5}) is True
        assert is_stream_chunk({"type": "data"}) is True
        assert is_stream_chunk({"type": "complete"}) is True
        assert is_stream_chunk({"type": "error"}) is True

    def test_is_stream_chunk_invalid(self):
        assert is_stream_chunk({"type": "unknown"}) is False
        assert is_stream_chunk("string") is False
        assert is_stream_chunk(None) is False
        assert is_stream_chunk(42) is False

    def test_is_streamable_command_with_instance(self):
        cmd = StreamableCommand()
        assert is_streamable_command(cmd) is True

    def test_is_streamable_command_with_dict(self):
        assert is_streamable_command({"streamable": True}) is True
        assert is_streamable_command({"streamable": False}) is False

    def test_is_streamable_command_with_object(self):
        class Cmd:
            streamable = True
        assert is_streamable_command(Cmd()) is True

    def test_is_streamable_command_false(self):
        assert is_streamable_command({}) is False
        assert is_streamable_command("string") is False


class TestStreamOptions:
    """Tests for StreamOptions model."""

    def test_defaults(self):
        opts = StreamOptions()
        assert opts.timeout is None
        assert opts.progress_throttle_ms == 100
        assert opts.buffer_size == 100

    def test_custom_options(self):
        opts = StreamOptions(timeout=30000, progress_throttle_ms=200, buffer_size=50)
        assert opts.timeout == 30000
        assert opts.progress_throttle_ms == 200
        assert opts.buffer_size == 50


class TestStreamableCommand:
    """Tests for StreamableCommand model."""

    def test_minimal(self):
        cmd = StreamableCommand()
        assert cmd.streamable is True
        assert cmd.stream_data_type is None
        assert cmd.emits_progress is None
        assert cmd.estimated_throughput is None

    def test_full(self):
        cmd = StreamableCommand(
            stream_data_type="Todo",
            emits_progress=True,
            estimated_throughput=100.0,
        )
        assert cmd.stream_data_type == "Todo"
        assert cmd.emits_progress is True
        assert cmd.estimated_throughput == 100.0


class TestStreamCallbacks:
    """Tests for StreamCallbacks dataclass."""

    def test_defaults_to_none(self):
        cb = StreamCallbacks()
        assert cb.on_progress is None
        assert cb.on_data is None
        assert cb.on_complete is None
        assert cb.on_error is None

    def test_with_callbacks(self):
        called = []
        cb = StreamCallbacks(
            on_progress=lambda c: called.append("progress"),
            on_data=lambda c: called.append("data"),
        )
        cb.on_progress(ProgressChunk(progress=0.5))
        cb.on_data(DataChunk(data="x", index=0, is_last=True))
        assert called == ["progress", "data"]


# ═══════════════════════════════════════════════════════════════════════════════
# ASYNC TESTS
# ═══════════════════════════════════════════════════════════════════════════════


async def _make_stream(chunks) -> AsyncIterator[StreamChunk]:
    """Helper to create an async iterator from a list of chunks."""
    for chunk in chunks:
        yield chunk


class TestConsumeStream:
    """Tests for consume_stream async utility."""

    @pytest.mark.asyncio
    async def test_dispatches_all_callbacks(self):
        progress_chunks = []
        data_chunks = []
        complete_chunks = []

        chunks = [
            create_progress_chunk(0.5, message="Half done"),
            create_data_chunk("item1", 0, False),
            create_data_chunk("item2", 1, True),
            create_complete_chunk(2, 1000),
        ]

        callbacks = StreamCallbacks(
            on_progress=lambda c: progress_chunks.append(c),
            on_data=lambda c: data_chunks.append(c),
            on_complete=lambda c: complete_chunks.append(c),
        )

        result = await consume_stream(_make_stream(chunks), callbacks)

        assert len(progress_chunks) == 1
        assert len(data_chunks) == 2
        assert len(complete_chunks) == 1
        assert isinstance(result, CompleteChunk)

    @pytest.mark.asyncio
    async def test_returns_error_chunk(self):
        err = CommandError(code="FAIL", message="Stream failed")
        chunks = [
            create_data_chunk("item1", 0, False),
            create_error_chunk(err, 1),
        ]

        error_chunks = []
        callbacks = StreamCallbacks(on_error=lambda c: error_chunks.append(c))

        result = await consume_stream(_make_stream(chunks), callbacks)

        assert isinstance(result, ErrorChunk)
        assert result.error.code == "FAIL"
        assert len(error_chunks) == 1

    @pytest.mark.asyncio
    async def test_synthetic_error_on_unexpected_end(self):
        # Stream with no complete or error chunk
        chunks = [
            create_data_chunk("item1", 0, False),
            create_data_chunk("item2", 1, False),
        ]

        result = await consume_stream(_make_stream(chunks), StreamCallbacks())

        assert isinstance(result, ErrorChunk)
        assert result.error.code == "STREAM_ENDED_UNEXPECTEDLY"
        assert result.recoverable is True

    @pytest.mark.asyncio
    async def test_empty_stream(self):
        result = await consume_stream(_make_stream([]), StreamCallbacks())
        assert isinstance(result, ErrorChunk)
        assert result.error.code == "STREAM_ENDED_UNEXPECTEDLY"

    @pytest.mark.asyncio
    async def test_no_callbacks_still_works(self):
        chunks = [create_complete_chunk(0, 100)]
        result = await consume_stream(_make_stream(chunks), StreamCallbacks())
        assert isinstance(result, CompleteChunk)


class TestCollectStreamData:
    """Tests for collect_stream_data async utility."""

    @pytest.mark.asyncio
    async def test_collects_all_data(self):
        chunks = [
            create_data_chunk("a", 0, False),
            create_data_chunk("b", 1, False),
            create_data_chunk("c", 2, True),
            create_complete_chunk(3, 1000),
        ]

        items = await collect_stream_data(_make_stream(chunks))
        assert items == ["a", "b", "c"]

    @pytest.mark.asyncio
    async def test_raises_on_error_chunk(self):
        err = CommandError(code="FAIL", message="Something went wrong")
        chunks = [
            create_data_chunk("a", 0, False),
            create_error_chunk(err, 1),
        ]

        with pytest.raises(RuntimeError, match="Something went wrong"):
            await collect_stream_data(_make_stream(chunks))

    @pytest.mark.asyncio
    async def test_ignores_progress_chunks(self):
        chunks = [
            create_progress_chunk(0.5),
            create_data_chunk("item", 0, True),
            create_complete_chunk(1, 500),
        ]

        items = await collect_stream_data(_make_stream(chunks))
        assert items == ["item"]

    @pytest.mark.asyncio
    async def test_empty_stream_returns_empty_list(self):
        items = await collect_stream_data(_make_stream([]))
        assert items == []
