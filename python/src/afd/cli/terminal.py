"""Make server-controlled text safe to print to a terminal.

A server decides the text of error messages, suggestions, reasoning, warnings and
stream data. Printed raw, an escape sequence in any of them can set the window
title (OSC 0/2), plant a hyperlink (OSC 8), write the clipboard (OSC 52), move the
cursor to overwrite earlier output (CSI) or reset the terminal. Text output passes
every such string through :func:`terminal_text`; JSON output needs nothing, since
``json.dumps`` escapes control characters. Mirrors ``packages/cli/src/terminal.ts``.
"""

from __future__ import annotations

import contextlib
import sys
from typing import Any

_ESC = 0x1B
_BEL = 0x07
_TAB = 0x09
_LF = 0x0A
_DEL = 0x7F
_C1_CSI = 0x9B
_C1_ST = 0x9C
# 8-bit string introducers: DCS, SOS, OSC, PM, APC.
_C1_STRING_INTRODUCERS = {0x90, 0x98, 0x9D, 0x9E, 0x9F}
# Second character of a 7-bit string sequence: OSC, DCS, SOS, PM, APC.
_STRING_INTRODUCERS = {"]", "P", "X", "^", "_"}


def _is_c1(code: int) -> bool:
    return 0x80 <= code <= 0x9F


def _skip_csi(text: str, start: int) -> int:
    """End of a CSI sequence: parameter and intermediate bytes, then one final byte.
    A malformed sequence ends before the first unexpected character."""
    i = start
    while i < len(text):
        code = ord(text[i])
        if 0x20 <= code <= 0x3F:
            i += 1
            continue
        return i + 1 if 0x40 <= code <= 0x7E else i
    return i


def _skip_string(text: str, start: int) -> int:
    """End of a string sequence (OSC, DCS, SOS, PM, APC), with its BEL or ST
    terminator. An unterminated one returns ``start``, so only the introducer is
    dropped and the payload prints as plain text."""
    for i in range(start, len(text)):
        code = ord(text[i])
        if code in (_BEL, _C1_ST):
            return i + 1
        if code == _ESC:
            return i + 2 if text[i + 1 : i + 2] == "\\" else start
    return start


def _skip_control_sequence(text: str, start: int) -> int:
    code = ord(text[start])
    if code != _ESC:
        if code == _C1_CSI:
            return _skip_csi(text, start + 1)
        if code in _C1_STRING_INTRODUCERS:
            return _skip_string(text, start + 1)
        return start + 1

    following = text[start + 1 : start + 2]
    if following == "[":
        return _skip_csi(text, start + 2)
    if following in _STRING_INTRODUCERS:
        return _skip_string(text, start + 2)

    # nF sequences (such as ESC ( 0): intermediates, then a final byte.
    i = start + 1
    while i < len(text) and 0x20 <= ord(text[i]) <= 0x2F:
        i += 1
    # Fp, Fe or Fs (such as ESC c, a reset), or the end of an nF sequence.
    if i < len(text) and 0x30 <= ord(text[i]) <= 0x7E:
        return i + 1
    return i


def sanitize_for_terminal(text: str) -> str:
    """Remove terminal control characters and escape sequences from ``text``.

    Strips every C0 control character except newline and tab (CR and backspace
    can overwrite a line), DEL, every C1 control character, and complete ESC and
    C1 sequences. Visible text, non-ASCII included, is kept.
    """
    out: list[str] = []
    i = 0
    while i < len(text):
        code = ord(text[i])
        if code == _ESC or _is_c1(code):
            i = _skip_control_sequence(text, i)
            continue
        if (code < 0x20 and code not in (_LF, _TAB)) or code == _DEL:
            i += 1
            continue
        out.append(text[i])
        i += 1
    return "".join(out)


def terminal_text(value: Any) -> str:
    """``value`` as a string that is safe to print to a terminal."""
    return sanitize_for_terminal(value if isinstance(value, str) else str(value))


def configure_stdio() -> None:
    """Reconfigure ``sys.stdout`` and ``sys.stderr`` to UTF-8 with replacement.

    Windows consoles and redirected pipes can default to a legacy code page such
    as ``cp1252`` with strict error handling, where Unicode status symbols,
    progress bars, and ``ensure_ascii=False`` JSON raise ``UnicodeEncodeError``.
    """
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            with contextlib.suppress(OSError, ValueError):
                reconfigure(encoding="utf-8", errors="replace")
