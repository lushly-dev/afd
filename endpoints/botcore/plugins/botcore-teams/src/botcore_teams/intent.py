"""Intent parsing — regex-based message-to-command routing."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

# Each pattern: (compiled regex, command name, capture group names)
# Order matters — first match wins.
INTENT_PATTERNS: list[tuple[re.Pattern[str], str, list[str]]] = [
    (
        re.compile(
            r"(?:assign|task|run|execute|work\s+on)\s+(.+?)(?:\s+to\s+@?(\w+))$",
            re.IGNORECASE,
        ),
        "task_assign",
        ["description", "agent"],
    ),
    (
        re.compile(r"(?:assign|task|run|execute|work\s+on)\s+(.+)", re.IGNORECASE),
        "task_assign",
        ["description"],
    ),
    (
        re.compile(r"(?:cancel|stop|abort)\s*(.*)", re.IGNORECASE),
        "task_cancel",
        ["query"],
    ),
    (
        re.compile(r"(?:list\s+tasks|queue|backlog)", re.IGNORECASE),
        "task_list",
        [],
    ),
    (
        re.compile(r"(?:team\s+status|agents?|who)", re.IGNORECASE),
        "team_status",
        [],
    ),
    (
        re.compile(r"(?:status|progress|how.+going)\s*(.*)", re.IGNORECASE),
        "task_status",
        ["query"],
    ),
]

# Matches Teams bot mention tags: <at>BotName</at>
_AT_MENTION_RE = re.compile(r"<at>[^<]*</at>\s*", re.IGNORECASE)


@dataclass(frozen=True)
class ParsedIntent:
    """Result of intent parsing."""

    command: str
    args: dict[str, Any] = field(default_factory=dict)
    confidence: float = 1.0
    raw_text: str = ""


UNKNOWN_INTENT = ParsedIntent(command="unknown", confidence=0.0)


def parse_intent(text: str) -> ParsedIntent:
    """Parse a Teams message into a command intent.

    Strips bot mention tags, then matches against INTENT_PATTERNS.
    Returns UNKNOWN_INTENT (confidence=0.0) if no pattern matches.
    """
    cleaned = _AT_MENTION_RE.sub("", text).strip()
    if not cleaned:
        return ParsedIntent(command="unknown", confidence=0.0, raw_text=text)

    for pattern, command, param_names in INTENT_PATTERNS:
        m = pattern.search(cleaned)
        if m:
            args: dict[str, Any] = {}
            for i, name in enumerate(param_names):
                value = m.group(i + 1) if i + 1 <= len(m.groups()) else ""
                if value:
                    args[name] = value.strip()
            return ParsedIntent(
                command=command,
                args=args,
                confidence=1.0,
                raw_text=text,
            )

    return ParsedIntent(command="unknown", confidence=0.0, raw_text=text)
