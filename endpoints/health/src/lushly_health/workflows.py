"""Read GitHub Actions workflows closely enough to tell CI and its Node versions apart.

Line-based on purpose: the toolkit has no dependencies, so there is no YAML parser here.
"""

from __future__ import annotations

import re
from pathlib import Path

_BLOCK_SCALARS = {">", ">-", ">+", "|", "|-", "|+"}
_VERSION = re.compile(r"v?(\d+)(?:\.(?:\d+|x)){0,2}")
_REFERENCE = re.compile(r"\${{\s*(?:matrix|env)\.([A-Za-z_][A-Za-z0-9_-]*)\s*}}")
_TRIGGERS = re.compile(r"^(?:on|\"on\"|'on'|true)\s*:(.*(?:\n(?:[ \t].*)?)*)", re.MULTILINE)


def _strip_comment(value: str) -> str:
    return re.sub(r"(^|\s)#.*$", "", value).strip()


def _declared_values(content: str, key: str) -> list[str]:
    """Each value a workflow gives ``key``, joining block scalars and dash lists."""
    lines = content.splitlines()
    values = []
    pattern = re.compile(rf"^(\s*)(?:-\s+)?{re.escape(key)}:\s*(.*)$")
    for index, line in enumerate(lines):
        match = pattern.match(line)
        if not match:
            continue
        indent = len(match.group(1))
        value = _strip_comment(match.group(2))
        if value and value not in _BLOCK_SCALARS:
            values.append(value)
            continue
        nested = []
        for following in lines[index + 1 :]:
            outdented = following.strip() and len(following) - len(following.lstrip()) <= indent
            # A dash list may sit at its key's own indent.
            if outdented and (value or not following.lstrip().startswith("- ")):
                break
            nested.append(_strip_comment(following))
        if value:
            values.append(" ".join(item for item in nested if item))
        else:
            values.extend(item.removeprefix("- ").strip() for item in nested if item)
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
    reference = _REFERENCE.fullmatch(value.strip())
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
    # fromJSON over a literal list: every version it can select is written out.
    if "fromjson" in value.lower():
        return {
            int(match.group(1))
            for quoted in re.findall(r"\"([^\"]*)\"", value)
            if (match := _VERSION.fullmatch(quoted))
        } or None
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


def _rank(content: str) -> int | None:
    """Order a workflow as CI evidence; None when its triggers rule it out.

    Pull request runs are the strongest evidence and branch pushes the next. A workflow
    only run by tags, releases, schedules or by hand publishes or maintains; it does not
    check changes. Triggers that cannot be read keep the source's mention heuristic.
    """
    match = _TRIGGERS.search(content)
    if not match:
        return 2
    triggers = "\n".join(_strip_comment(line) for line in match.group(1).splitlines())
    if "pull_request" in triggers or "merge_group" in triggers:
        return 0
    if re.search(r"\bpush\b", triggers) and (
        re.search(r"\bbranches\b", triggers) or not re.search(r"\btags\b", triggers)
    ):
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
