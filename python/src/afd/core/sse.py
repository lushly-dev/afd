"""Server-Sent Events (``text/event-stream``) decoding.

A small, dependency-free decoder shared by the MCP client's ``stream()`` and
the SSE handoff connection. It follows the WHATWG event-stream rules: fields
are ``data``, ``event``, ``id`` and ``retry``; one space after the colon is
optional; several ``data`` lines join with ``\\n``; a line starting with ``:``
is a comment; and a blank line dispatches the event.

Example:
    >>> decoder = SseDecoder()
    >>> [decoder.decode(line) for line in ["event: chunk", "data: {}", ""]][-1]
    SseEvent(data='{}', event='chunk', id=None, retry=None)
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from dataclasses import dataclass


@dataclass
class SseEvent:
    """One dispatched server-sent event."""

    data: str
    event: str = "message"
    id: str | None = None
    retry: int | None = None


class SseDecoder:
    """Turn event-stream lines into events, bounding each frame's UTF-8 bytes.

    ``max_event_bytes`` includes fields, comments and line separators between
    blank lines. Oversized frames raise ``ValueError`` and clear buffered data.
    The default limit is 1 MiB; pass a larger limit for known large payloads.
    """

    def __init__(self, *, max_event_bytes: int = 1024 * 1024) -> None:
        if isinstance(max_event_bytes, bool) or not isinstance(max_event_bytes, int) or max_event_bytes <= 0:
            raise ValueError("max_event_bytes must be a positive integer")
        self._max_event_bytes = max_event_bytes
        self._event_bytes = 0
        self._data: list[str] = []
        self._event = ""
        self._last_id: str | None = None
        self._retry: int | None = None

    def decode(self, line: str) -> SseEvent | None:
        """Feed one line; return the event a blank line completes, else None."""
        line = line.rstrip("\r\n")
        if not line:
            self._event_bytes = 0
            if not self._data:
                # No data: nothing to dispatch (the event name is discarded).
                self._event = ""
                return None
            event = SseEvent(
                data="\n".join(self._data),
                event=self._event or "message",
                id=self._last_id,
                retry=self._retry,
            )
            self._data = []
            self._event = ""
            self._retry = None
            return event
        self._event_bytes += len(line.encode("utf-8")) + 1
        if self._event_bytes > self._max_event_bytes:
            self._data = []
            self._event = ""
            self._retry = None
            self._event_bytes = 0
            raise ValueError(f"SSE event exceeds {self._max_event_bytes} bytes")
        if line.startswith(":"):
            return None
        name, colon, value = line.partition(":")
        if colon and value.startswith(" "):
            value = value[1:]
        if name == "data":
            self._data.append(value)
        elif name == "event":
            self._event = value
        elif name == "id" and "\0" not in value:
            self._last_id = value
        elif name == "retry" and value.isdigit():
            self._retry = int(value)
        return None

    def decode_all(self, lines: Iterable[str]) -> Iterator[SseEvent]:
        """Decode several lines, yielding each completed event."""
        for line in lines:
            event = self.decode(line)
            if event is not None:
                yield event
