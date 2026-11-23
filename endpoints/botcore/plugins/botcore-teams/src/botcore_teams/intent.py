"""Intent parsing — regex-based message-to-command routing."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

_TASK_ID_PATTERN = r"task[-_][\w-]*\d[\w-]*|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}"

# Each pattern: (compiled regex, command name, capture group names)
# Order matters — first match wins.
INTENT_PATTERNS: list[tuple[re.Pattern[str], str, list[str]]] = [
    # botcore-agents' task_status takes a task_id: a message that opens with the request
    # and ends in a task id ("status of task-001?", "what's the progress on <uuid>"). It is
    # anchored at the start, so "stop progress on task-1" stays a cancel, and it takes only
    # an id shaped as one (botcore-agents' UUIDs, or task-<n>), so "status of agent-007"
    # stays team_status. It comes first so "status for task <id>" is not an assignment.
    (
        re.compile(
            r"^(?:(?:what(?:'s|\s+is)|show(?:\s+me)?|check|get)\s+)?(?:the\s+)?"
            r"(?:status|progress):?\s+(?:(?:of|for|on)\s+)?(?:task\s+)?"
            rf"({_TASK_ID_PATTERN})[?.!]*\s*$",
            re.IGNORECASE,
        ),
        "task_status",
        ["task_id"],
    ),
    # botcore-agents' task_cancel also takes a task_id. Anchored before task_assign so
    # "cancel task <uuid>" is not swallowed by task_assign's "task <description>".
    (
        re.compile(
            r"^(?:please\s+)?(?:cancel|stop|abort):?\s+"
            r"(?:(?:the\s+)?(?:status|progress)\s+(?:(?:of|for|on)\s+)?)?"
            r"(?:task\s+)?"
            rf"({_TASK_ID_PATTERN})[?.!]*\s*$",
            re.IGNORECASE,
        ),
        "task_cancel",
        ["task_id"],
    ),
    # A cancel message without a valid task id (such as "cancel task assigned to @researcher"
    # or "abort the current run now") must still route to task_cancel (returning MISSING_TASK_ID)
    # rather than falling through to task_assign.
    (
        re.compile(r"^(?:please\s+)?(?:cancel|stop|abort)\b", re.IGNORECASE),
        "task_cancel",
        [],
    ),
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
        re.compile(r"\b(?:cancel|stop|abort)\b", re.IGNORECASE),
        "task_cancel",
        [],
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
        re.compile(r"(?:status|progress|how.+going)", re.IGNORECASE),
        "task_status",
        [],
    ),
]

_UUID_RE = re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", re.IGNORECASE)

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
            if _UUID_RE.fullmatch(args.get("task_id", "")):
                args["task_id"] = args["task_id"].lower()  # botcore-agents' ids are lowercase
            return ParsedIntent(
                command=command,
                args=args,
                confidence=1.0,
                raw_text=text,
            )

    return ParsedIntent(command="unknown", confidence=0.0, raw_text=text)
