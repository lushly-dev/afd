"""Answer server elicitations at the terminal, such as an AFD server's confirmation of a
command with ``confirm_prompt`` (``spec/command-metadata.md``, "Confirmations").

Only yes/no forms are asked: every property of the requested schema must be a boolean.
Any other form is cancelled, because the CLI cannot collect it safely. The prompt goes
to stderr so that stdout keeps only the command's output. Mirrors
``packages/cli/src/elicitation.ts``.
"""

from __future__ import annotations

import re
import sys
from typing import Any, Awaitable, Callable, Dict, List, Optional

import click

from afd.transports.streamable_http import (
    ElicitationHandler,
    ElicitationRequest,
    ElicitationResponse,
)

Confirm = Callable[[str], Awaitable[bool]]
"""Asks a ``[y/N]`` question and returns whether the answer was yes."""


def _boolean_properties(schema: Dict[str, Any]) -> Optional[List[str]]:
    """The boolean property names of a form schema, or ``None`` for any other form."""
    properties = schema.get("properties")
    if not isinstance(properties, dict) or not properties:
        return None
    if all(isinstance(p, dict) and p.get("type") == "boolean" for p in properties.values()):
        return list(properties)
    return None


_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f]")


def _plain(text: str) -> str:
    """Escape control characters (C0, DEL and C1, so ESC and BEL among them) so a
    server cannot drive the terminal; printable text, any script, is kept."""
    return _CONTROL.sub(lambda match: f"\\u{ord(match.group()):04x}", text)


def terminal_elicitation(confirm: Confirm) -> ElicitationHandler:
    """An elicitation handler that asks through ``confirm``. A yes accepts with every
    boolean set to ``True``; anything else declines."""

    async def handler(request: ElicitationRequest) -> ElicitationResponse:
        names = _boolean_properties(request.requested_schema)
        message = _plain(request.message)
        if names is None:
            click.echo(f"The server asked for input the CLI cannot collect: {message}", err=True)
            return ElicitationResponse(action="cancel")
        if not await confirm(f"{message} [y/N] "):
            return ElicitationResponse(action="decline")
        return ElicitationResponse(action="accept", content=dict.fromkeys(names, True))

    return handler


def interactive_elicitation(confirm: Confirm) -> Optional[ElicitationHandler]:
    """The terminal handler when stdin and stderr are both terminals; ``None`` otherwise."""
    if sys.stdin.isatty() and sys.stderr.isatty():
        return terminal_elicitation(confirm)
    return None
