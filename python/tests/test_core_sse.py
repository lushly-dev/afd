"""Bounded UTF-8 SSE frame decoding and frame-boundary regressions."""

import pytest

from afd.core.sse import SseDecoder


def test_multiline_data_metadata_and_persistent_id():
    decoder = SseDecoder()
    events = list(decoder.decode_all([
        ": comment", "id: 7", "event: chunk", "retry: 100", "data: one", "data: two", "",
        "data: next", "",
    ]))
    assert [(e.data, e.event, e.id, e.retry) for e in events] == [
        ("one\ntwo", "chunk", "7", 100), ("next", "message", "7", None),
    ]


@pytest.mark.parametrize("lines", [
    ["data: " + "x" * 40], ["data: " + "😀" * 8],
    ["data: 123456", "data: 123456", "data: 123456"],
    ["event: " + "x" * 40], ["id: " + "x" * 40], [":" + "x" * 40],
])
def test_frame_limit_clears_buffer_and_bounds_all_fields(lines):
    decoder = SseDecoder(max_event_bytes=32)
    with pytest.raises(ValueError, match="SSE event exceeds 32 bytes"):
        list(decoder.decode_all(lines))
    assert decoder._data == []
    assert decoder.decode("data: ok") is None
    assert decoder.decode("").data == "ok"


def test_limit_resets_at_frame_boundary():
    decoder = SseDecoder(max_event_bytes=9)
    assert len(list(decoder.decode_all(["data: ok", ""] * 100))) == 100


@pytest.mark.parametrize("limit", [0, -1, True, 0.5])
def test_invalid_limit_rejected(limit):
    with pytest.raises(ValueError):
        SseDecoder(max_event_bytes=limit)
