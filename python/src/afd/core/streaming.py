"""Streaming types for AFD commands.

Streaming enables incremental delivery of large results with real-time
progress feedback. Commands can emit progress updates, data chunks,
and completion/error signals.

Example:
    >>> from afd.core.streaming import create_progress_chunk, create_data_chunk
    >>>
    >>> # Progress update
    >>> chunk = create_progress_chunk(0.45, message="Processing item 45 of 100...")
    >>> assert chunk.type == "progress"
    >>> assert chunk.progress == 0.45
    >>>
    >>> # Data chunk
    >>> chunk = create_data_chunk({"id": "1", "title": "Item"}, index=0, is_last=False)
    >>> assert chunk.type == "data"
"""

from dataclasses import dataclass, field
from typing import (
    Any,
    AsyncIterator,
    Callable,
    Generic,
    List,
    Literal,
    Optional,
    TypeVar,
    Union,
)

from pydantic import BaseModel, Field

from afd.core.errors import CommandError
from afd.core.result import ResultMetadata

T = TypeVar("T")


# ═══════════════════════════════════════════════════════════════════════════════
# STREAM CHUNK TYPES
# ═══════════════════════════════════════════════════════════════════════════════


class ProgressChunk(BaseModel):
    """Progress update chunk.

    Emitted during long-running operations to show progress.

    Attributes:
        type: Discriminator for chunk type.
        progress: Progress percentage (0-1).
        message: Human-readable progress message.
        items_processed: Number of items processed so far.
        items_total: Total number of items to process.
        estimated_time_remaining_ms: Estimated time remaining in milliseconds.
        phase: Current phase or stage of the operation.

    Example:
        >>> chunk = ProgressChunk(
        ...     type="progress", progress=0.45,
        ...     message="Processing item 45 of 100...",
        ... )
    """

    type: Literal["progress"] = "progress"
    progress: float = Field(ge=0, le=1)
    message: Optional[str] = None
    items_processed: Optional[int] = Field(default=None, ge=0)
    items_total: Optional[int] = Field(default=None, ge=0)
    estimated_time_remaining_ms: Optional[int] = Field(default=None, ge=0)
    phase: Optional[str] = None


class DataChunk(BaseModel, Generic[T]):
    """Data chunk containing partial results.

    Emitted as data becomes available, allowing incremental UI updates.

    Attributes:
        type: Discriminator for chunk type.
        data: The data payload for this chunk.
        index: Index of this chunk in the sequence (0-based).
        is_last: Whether this is the last data chunk.
        chunk_id: Optional chunk ID for deduplication.

    Example:
        >>> chunk = DataChunk(
        ...     type="data",
        ...     data={"id": "todo-1", "title": "Buy groceries"},
        ...     index=0, is_last=False,
        ... )
    """

    type: Literal["data"] = "data"
    data: T
    index: int = Field(ge=0)
    is_last: bool
    chunk_id: Optional[str] = None


class CompleteChunk(BaseModel, Generic[T]):
    """Completion chunk signaling successful stream end.

    Contains final summary and aggregated metadata.

    Attributes:
        type: Discriminator for chunk type.
        data: Final result data (summary or complete result).
        total_chunks: Total number of data chunks emitted.
        total_duration_ms: Total duration of the stream in milliseconds.
        confidence: Confidence in the overall result (0-1).
        reasoning: Human-readable summary of what was accomplished.
        metadata: Execution metadata.

    Example:
        >>> chunk = CompleteChunk(
        ...     type="complete", total_chunks=100,
        ...     total_duration_ms=5000, confidence=0.95,
        ... )
    """

    type: Literal["complete"] = "complete"
    data: Optional[T] = None
    total_chunks: int = Field(ge=0)
    total_duration_ms: float = Field(ge=0)
    confidence: Optional[float] = Field(default=None, ge=0, le=1)
    reasoning: Optional[str] = None
    metadata: Optional[ResultMetadata] = None


class ErrorChunk(BaseModel):
    """Error chunk signaling stream failure.

    May be emitted mid-stream if an error occurs after some data has been sent.

    Attributes:
        type: Discriminator for chunk type.
        error: Error details.
        chunks_before_error: Number of chunks successfully emitted before the error.
        recoverable: Whether the stream can be resumed or retried.
        resume_from: If recoverable, the position to resume from.

    Example:
        >>> from afd.core.errors import CommandError
        >>> chunk = ErrorChunk(
        ...     type="error",
        ...     error=CommandError(
        ...         code="EXPORT_FAILED",
        ...         message="Failed to export item 45",
        ...         suggestion="Check the item data and try again",
        ...     ),
        ...     chunks_before_error=44,
        ...     recoverable=False,
        ... )
    """

    type: Literal["error"] = "error"
    error: CommandError
    chunks_before_error: int = Field(ge=0)
    recoverable: bool = False
    resume_from: Optional[int] = None


# Union type for all possible stream chunks
StreamChunk = Union[ProgressChunk, DataChunk, CompleteChunk, ErrorChunk]


# ═══════════════════════════════════════════════════════════════════════════════
# STREAM OPTIONS
# ═══════════════════════════════════════════════════════════════════════════════


class StreamOptions(BaseModel):
    """Options for stream execution.

    Note: Python uses ``asyncio.timeout()`` natively instead of AbortSignal.

    Attributes:
        timeout: Timeout in milliseconds for the entire stream.
        progress_throttle_ms: Minimum interval between progress updates in ms.
        buffer_size: Maximum number of data chunks to buffer before backpressure.

    Example:
        >>> opts = StreamOptions(timeout=30000, progress_throttle_ms=200)
    """

    timeout: Optional[int] = Field(default=None, ge=0)
    progress_throttle_ms: int = Field(default=100, ge=0)
    buffer_size: int = Field(default=100, ge=1)


@dataclass
class StreamCallbacks(Generic[T]):
    """Callbacks for stream consumption.

    Uses dataclass since Callable fields don't serialize.
    Follows the CommandContext pattern.

    Attributes:
        on_progress: Called for each progress update.
        on_data: Called for each data chunk.
        on_complete: Called when the stream completes successfully.
        on_error: Called if the stream encounters an error.
    """

    on_progress: Optional[Callable[[ProgressChunk], None]] = field(default=None)
    on_data: Optional[Callable[[DataChunk[T]], None]] = field(default=None)
    on_complete: Optional[Callable[[CompleteChunk[T]], None]] = field(default=None)
    on_error: Optional[Callable[[ErrorChunk], None]] = field(default=None)


# ═══════════════════════════════════════════════════════════════════════════════
# STREAMABLE COMMAND
# ═══════════════════════════════════════════════════════════════════════════════


class StreamableCommand(BaseModel):
    """Marker interface for commands that support streaming.

    Attributes:
        streamable: Indicates this command supports streaming responses.
        stream_data_type: Type of data emitted in stream chunks.
        emits_progress: Whether progress updates are emitted.
        estimated_throughput: Estimated items per second throughput.

    Example:
        >>> cmd = StreamableCommand(
        ...     streamable=True, emits_progress=True,
        ...     stream_data_type="Todo", estimated_throughput=100,
        ... )
    """

    streamable: Literal[True] = True
    stream_data_type: Optional[str] = None
    emits_progress: Optional[bool] = None
    estimated_throughput: Optional[float] = Field(default=None, ge=0)


# ═══════════════════════════════════════════════════════════════════════════════
# FACTORY FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════


def create_progress_chunk(
    progress: float,
    *,
    message: Optional[str] = None,
    items_processed: Optional[int] = None,
    items_total: Optional[int] = None,
    estimated_time_remaining_ms: Optional[int] = None,
    phase: Optional[str] = None,
) -> ProgressChunk:
    """Create a progress chunk with clamped progress value.

    Args:
        progress: Progress percentage (clamped to 0-1).
        message: Human-readable progress message.
        items_processed: Number of items processed so far.
        items_total: Total number of items to process.
        estimated_time_remaining_ms: Estimated time remaining in ms.
        phase: Current phase or stage of the operation.

    Returns:
        A ProgressChunk with clamped progress value.

    Example:
        >>> chunk = create_progress_chunk(0.5, message="Halfway there")
        >>> chunk.progress
        0.5
        >>> # Values are clamped
        >>> create_progress_chunk(1.5).progress
        1.0
        >>> create_progress_chunk(-0.5).progress
        0.0
    """
    clamped = max(0.0, min(1.0, progress))
    return ProgressChunk(
        progress=clamped,
        message=message,
        items_processed=items_processed,
        items_total=items_total,
        estimated_time_remaining_ms=estimated_time_remaining_ms,
        phase=phase,
    )


def create_data_chunk(
    data: T,
    index: int,
    is_last: bool,
    *,
    chunk_id: Optional[str] = None,
) -> DataChunk[T]:
    """Create a data chunk.

    Args:
        data: The data payload.
        index: Index of this chunk in the sequence (0-based).
        is_last: Whether this is the last data chunk.
        chunk_id: Optional chunk ID for deduplication.

    Returns:
        A DataChunk with the given data.

    Example:
        >>> chunk = create_data_chunk({"id": "1"}, 0, False)
        >>> chunk.data
        {'id': '1'}
    """
    return DataChunk(
        data=data,
        index=index,
        is_last=is_last,
        chunk_id=chunk_id,
    )


def create_complete_chunk(
    total_chunks: int,
    total_duration_ms: float,
    *,
    data: Optional[T] = None,
    confidence: Optional[float] = None,
    reasoning: Optional[str] = None,
    metadata: Optional[ResultMetadata] = None,
) -> CompleteChunk[T]:
    """Create a completion chunk.

    Args:
        total_chunks: Total number of data chunks emitted.
        total_duration_ms: Total duration of the stream in ms.
        data: Final result data.
        confidence: Confidence in the overall result (0-1).
        reasoning: Human-readable summary.
        metadata: Execution metadata.

    Returns:
        A CompleteChunk signaling stream completion.

    Example:
        >>> chunk = create_complete_chunk(10, 5000, confidence=0.95)
        >>> chunk.total_chunks
        10
    """
    return CompleteChunk(
        total_chunks=total_chunks,
        total_duration_ms=total_duration_ms,
        data=data,
        confidence=confidence,
        reasoning=reasoning,
        metadata=metadata,
    )


def create_error_chunk(
    error: CommandError,
    chunks_before_error: int,
    recoverable: bool = False,
    *,
    resume_from: Optional[int] = None,
) -> ErrorChunk:
    """Create an error chunk.

    Args:
        error: Error details.
        chunks_before_error: Number of chunks successfully emitted before the error.
        recoverable: Whether the stream can be resumed or retried.
        resume_from: If recoverable, the position to resume from.

    Returns:
        An ErrorChunk signaling stream failure.

    Example:
        >>> from afd.core.errors import CommandError
        >>> err = CommandError(code="TIMEOUT", message="Timed out")
        >>> chunk = create_error_chunk(err, 5, recoverable=True, resume_from=5)
        >>> chunk.recoverable
        True
    """
    return ErrorChunk(
        error=error,
        chunks_before_error=chunks_before_error,
        recoverable=recoverable,
        resume_from=resume_from,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# TYPE GUARDS
# ═══════════════════════════════════════════════════════════════════════════════


def is_progress_chunk(chunk: Any) -> bool:
    """Type guard for ProgressChunk.

    Example:
        >>> is_progress_chunk(ProgressChunk(progress=0.5))
        True
    """
    if isinstance(chunk, ProgressChunk):
        return True
    if isinstance(chunk, dict):
        return chunk.get("type") == "progress"
    return False


def is_data_chunk(chunk: Any) -> bool:
    """Type guard for DataChunk.

    Example:
        >>> is_data_chunk(DataChunk(data="x", index=0, is_last=True))
        True
    """
    if isinstance(chunk, DataChunk):
        return True
    if isinstance(chunk, dict):
        return chunk.get("type") == "data"
    return False


def is_complete_chunk(chunk: Any) -> bool:
    """Type guard for CompleteChunk.

    Example:
        >>> is_complete_chunk(CompleteChunk(total_chunks=0, total_duration_ms=0))
        True
    """
    if isinstance(chunk, CompleteChunk):
        return True
    if isinstance(chunk, dict):
        return chunk.get("type") == "complete"
    return False


def is_error_chunk(chunk: Any) -> bool:
    """Type guard for ErrorChunk.

    Example:
        >>> from afd.core.errors import CommandError
        >>> err = CommandError(code="E", message="e")
        >>> is_error_chunk(ErrorChunk(error=err, chunks_before_error=0))
        True
    """
    if isinstance(chunk, ErrorChunk):
        return True
    if isinstance(chunk, dict):
        return chunk.get("type") == "error"
    return False


def is_stream_chunk(value: Any) -> bool:
    """Type guard to check if any value is a StreamChunk.

    Example:
        >>> is_stream_chunk({"type": "progress", "progress": 0.5})
        True
        >>> is_stream_chunk({"type": "unknown"})
        False
    """
    if isinstance(value, (ProgressChunk, DataChunk, CompleteChunk, ErrorChunk)):
        return True
    if isinstance(value, dict):
        return value.get("type") in ("progress", "data", "complete", "error")
    return False


def is_streamable_command(command: Any) -> bool:
    """Type guard to check if a command definition is streamable.

    Example:
        >>> is_streamable_command({"streamable": True})
        True
        >>> is_streamable_command({"streamable": False})
        False
    """
    if isinstance(command, StreamableCommand):
        return True
    if isinstance(command, dict):
        return command.get("streamable") is True
    if hasattr(command, "streamable"):
        return command.streamable is True
    return False


# ═══════════════════════════════════════════════════════════════════════════════
# ASYNC UTILITY FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════


async def consume_stream(
    stream: AsyncIterator[StreamChunk],
    callbacks: StreamCallbacks,
) -> Union[CompleteChunk, ErrorChunk]:
    """Consume a stream with callbacks.

    Iterates over the stream, dispatching to the appropriate callback
    for each chunk type. Returns the final complete or error chunk.

    Args:
        stream: AsyncIterator yielding StreamChunks.
        callbacks: Handlers for each chunk type.

    Returns:
        The final CompleteChunk or ErrorChunk.

    Example:
        >>> import asyncio
        >>> # See test_streaming.py for async usage examples
    """
    last_chunk: Optional[Union[CompleteChunk, ErrorChunk]] = None

    async for chunk in stream:
        if isinstance(chunk, ProgressChunk):
            if callbacks.on_progress:
                callbacks.on_progress(chunk)
        elif isinstance(chunk, DataChunk):
            if callbacks.on_data:
                callbacks.on_data(chunk)
        elif isinstance(chunk, CompleteChunk):
            if callbacks.on_complete:
                callbacks.on_complete(chunk)
            last_chunk = chunk
        elif isinstance(chunk, ErrorChunk):
            if callbacks.on_error:
                callbacks.on_error(chunk)
            last_chunk = chunk

    if last_chunk is None:
        # Stream ended without complete or error — create synthetic error
        last_chunk = create_error_chunk(
            CommandError(
                code="STREAM_ENDED_UNEXPECTEDLY",
                message="Stream ended without completion or error signal",
                suggestion="This may indicate a connection issue. Try again.",
                retryable=True,
            ),
            0,
            True,
        )

    return last_chunk


async def collect_stream_data(stream: AsyncIterator[StreamChunk]) -> List[Any]:
    """Collect all data from a stream into a list.

    Args:
        stream: AsyncIterator yielding StreamChunks.

    Returns:
        List of all data items from DataChunks.

    Raises:
        RuntimeError: If an ErrorChunk is encountered.

    Example:
        >>> import asyncio
        >>> # See test_streaming.py for async usage examples
    """
    items: List[Any] = []

    async for chunk in stream:
        if isinstance(chunk, DataChunk):
            items.append(chunk.data)
        elif isinstance(chunk, ErrorChunk):
            raise RuntimeError(chunk.error.message)

    return items
