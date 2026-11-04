"""Read GitHub Actions workflows closely enough to tell CI and its Node versions apart.

Line-based on purpose: the toolkit has no dependencies, so there is no YAML parser here.
"""

from __future__ import annotations

import re
from pathlib import Path

_BLOCK_SCALARS = {">", ">-", ">+", "|", "|-", "|+"}
_VERSION = re.compile(r"v?(\d+)(?:\.(?:\d+|x)){0,2}")
_REFERENCE = re.compile(r"\${{\s*(?:matrix|env)\.([A-Za-z_][A-Za-z0-9_-]*)\s*}}")
_CALLER_VALUE = re.compile(r"\b(?:inputs|vars|needs|steps|env|matrix)\.")
_TRIGGER_KEY = re.compile(r"""^(?:on|"on"|'on'|true)\s*:\s*(.*)$""")
_CHANGE_EVENTS = {"pull_request", "pull_request_target", "merge_group"}


def _strip_comment(value: str) -> str:
    return re.sub(r"(^|\s)#.*$", "", value).strip()


def _declared_values(content: str, key: str) -> list[str]:
    """Each value a workflow gives ``key``, joining block scalars and dash lists.

    A key with only a nested mapping, such as a ``workflow_dispatch`` input of the same
    name, declares no value.
    """
    lines = content.splitlines()
    values = []
    pattern = re.compile(rf"^(\s*(?:-\s+)?){re.escape(key)}:\s*(.*)$")
    for index, line in enumerate(lines):
        match = pattern.match(line)
        if not match:
            continue
        column = len(match.group(1))
        value = _strip_comment(match.group(2))
        if value and value not in _BLOCK_SCALARS:
            values.append(value)
            continue
        nested = []
        for following in lines[index + 1 :]:
            if not following.strip():
                continue
            indent = len(following) - len(following.lstrip())
            # A dash list may sit at its key's own column.
            is_item = following.lstrip().startswith("- ")
            if indent < column or (indent == column and (value or not is_item)):
                break
            nested.append(_strip_comment(following))
        if value:
            values.append(" ".join(item for item in nested if item))
        else:
            values.extend(item[2:].strip() for item in nested if item.startswith("- "))
    return values


def _literal_majors(value: str) -> set[int] | None:
    """Majors of a literal version or flow list; None when anything else is present."""
    items = value[1:-1].split(",") if value.startswith("[") and value.endswith("]") else [value]
    majors = set()
    for item in items:
        match = _VERSION.fullmatch(item.strip().strip("\"'"))
        if not match:
            return None
        majors.add(int(match.group(1)))
    return majors


def _value_majors(content: str, value: str, seen: frozenset[str] = frozenset()) -> set[int] | None:
    """Majors one ``node-version`` value can take; None when it cannot be read."""
    if "${{" not in value:
        return _literal_majors(value)
    reference = _REFERENCE.fullmatch(value.strip().strip("\"'"))
    if reference:
        name = reference.group(1)
        if name in seen:
            return set()
        majors: set[int] = set()
        for declared in _declared_values(content, name):
            found = _value_majors(content, declared, seen | {name})
            if found is None:
                return None
            majors |= found
        return majors or None
    # fromJSON over literal lists: every version it can select is written out, so any
    # caller-supplied value or item that isn't a version leaves it unread.
    if "fromjson" in value.lower() and not _CALLER_VALUE.search(value):
        matches = [_VERSION.fullmatch(item) for item in re.findall(r"\"([^\"]*)\"", value)]
        if matches and all(matches):
            return {int(match.group(1)) for match in matches}
    return None


def ci_node_majors(workflows: Path) -> tuple[set[int], str | None]:
    """Node majors across workflows, and the file holding a value that cannot be read."""
    majors: set[int] = set()
    if not workflows.is_dir():
        return majors, None
    for workflow in sorted((*workflows.glob("*.yml"), *workflows.glob("*.yaml"))):
        content = workflow.read_text()
        for value in _declared_values(content, "node-version"):
            found = _value_majors(content, value)
            if found is None:
                return majors, workflow.name
            majors |= found
    return majors, None


def _trigger_events(content: str) -> dict[str, str] | None:
    """Events in a workflow's ``on`` key with their settings; None when it has none."""
    lines = content.splitlines()
    start = next((i for i, line in enumerate(lines) if _TRIGGER_KEY.match(line)), None)
    if start is None:
        return None
    inline = _strip_comment(_TRIGGER_KEY.match(lines[start]).group(1))
    if inline:
        return dict.fromkeys(re.findall(r"[a-z_]+", inline), inline)
    block = []
    for line in lines[start + 1 :]:
        text = _strip_comment(line)
        if not text:
            continue
        # Only an indented line or a dash list at the first column stays in the block.
        if not line[0].isspace() and not text.startswith("- "):
            break
        block.append(line)
    if not block:
        return {}
    column = min(len(line) - len(line.lstrip()) for line in block)
    events: dict[str, str] = {}
    current = None
    for line in block:
        if len(line) - len(line.lstrip()) == column:
            current = re.match(r"(?:-\s+)?([\w-]+)", line.strip()).group(1)
            events[current] = ""
        else:
            events[current] += f"{_strip_comment(line)}\n"
    return events


def _rank(content: str) -> int | None:
    """Order a workflow as CI evidence; None when its triggers rule it out.

    Pull request runs are the strongest evidence and branch pushes the next. A reusable
    workflow is called by another one, so it runs on whatever that one runs on. A workflow
    only run by tags, releases, schedules or by hand publishes or maintains; it does not
    check changes. A file with no readable triggers keeps the source's mention heuristic.
    """
    events = _trigger_events(content)
    if events is None or "workflow_call" in events:
        return 2
    if _CHANGE_EVENTS & set(events):
        return 0
    if "push" in events:
        settings = events["push"]
        branches = re.search(r"\bbranches(?:-ignore)?\s*:", settings)
        if branches or not re.search(r"\btags\s*:", settings):
            return 1
    return None


def find_ci_workflow(workflows: Path) -> str | None:
    """The best workflow mentioning test and build that runs on changes; deterministic."""
    candidates = []
    for workflow in (*workflows.glob("*.yml"), *workflows.glob("*.yaml")):
        content = workflow.read_text().lower()
        if "test" in content and "build" in content:
            rank = _rank(content)
            if rank is not None:
                candidates.append((rank, workflow.name))
    return min(candidates)[1] if candidates else None
