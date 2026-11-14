"""Triage label rules, ported from AFD's ``scripts/issue-labels.mjs``.

The two implementations share their rules and their messages word for word;
``tests/test_labels.py`` carries the JavaScript tests' cases so they keep agreeing. The rules
read the label definitions the repository adapter names (AFD's ``.github/labels.json``).
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

TRIAGE = "status:triage"
PLANNED = "status:planned"
IN_PROGRESS = "status:in-progress"
DEFERRED = "status:deferred"
STATUSES = (TRIAGE, PLANNED, IN_PROGRESS, DEFERRED)
P0 = "priority:0"
P1 = "priority:1"
EXPERT = "execution:expert-escalation"
NEEDS_OWNER = ("needs:decision", "needs:operator")
NOT_PLANNABLE = ("needs:decision", "needs:operator", "blocked")

#: Every label a rule names; the tests keep each one defined and current in the file.
RULE_LABELS = (*STATUSES, P0, P1, "risk:high", "risk:medium", EXPERT, *NOT_PLANNABLE)

_COLOR = re.compile(r"[0-9a-fA-F]{6}")


class DefinitionsError(ValueError):
    """The label definitions file is missing or malformed."""


def parse_definitions(text: str) -> list[dict]:
    """Parse and validate the definitions file text."""
    try:
        entries = json.loads(text)
    except ValueError as exc:
        raise DefinitionsError(f"labels.json is not JSON: {exc}") from exc
    if not isinstance(entries, list):
        raise DefinitionsError("labels.json must be a list of labels.")
    seen: set[str] = set()
    for entry in entries:
        name = entry.get("name") if isinstance(entry, dict) else None
        if not isinstance(name, str) or name == "":
            raise DefinitionsError("A label has no name.")
        if name in seen:
            raise DefinitionsError(f"Label {name} is defined twice.")
        seen.add(name)
        if not _COLOR.fullmatch(str(entry.get("color"))):
            raise DefinitionsError(f"{name}: bad color.")
        if not isinstance(entry.get("description"), str):
            raise DefinitionsError(f"{name}: no description.")
    return entries


def load_definitions(path: Path) -> list[dict]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise DefinitionsError(f"Cannot read {path.name}: {exc.strerror or exc}") from exc
    return parse_definitions(text)


@dataclass(frozen=True)
class _Facts:
    names: frozenset[str]
    assigned: bool
    statuses: tuple[str, ...]
    executions: tuple[str, ...]
    unknown: tuple[str, ...]
    legacy: tuple[str, ...]

    def has(self, name: str) -> bool:
        return name in self.names


def _facts(labels: Iterable[str], assigned: bool, definitions: list[dict]) -> _Facts:
    ordered = list(dict.fromkeys(labels))  # Insertion order, as a JavaScript Set keeps it.
    defined = {entry["name"]: entry for entry in definitions}
    return _Facts(
        names=frozenset(ordered),
        assigned=assigned,
        statuses=tuple(name for name in STATUSES if name in ordered),
        executions=tuple(name for name in ordered if name.startswith("execution:")),
        unknown=tuple(name for name in ordered if name not in defined),
        legacy=tuple(name for name in ordered if defined.get(name, {}).get("legacy")),
    )


def _status_rule(f: _Facts) -> list[str]:
    if len(f.statuses) < 2:
        return []
    if len(f.statuses) == 2 and f.has(IN_PROGRESS) and f.has(TRIAGE):
        return [f"{TRIAGE} left beside the {IN_PROGRESS} claim: remove {TRIAGE}"]
    return [f"{len(f.statuses)} status labels ({', '.join(f.statuses)}): keep exactly one"]


def _execution_rule(f: _Facts) -> list[str]:
    if len(f.executions) > 1:
        return [
            f"several execution profiles ({', '.join(f.executions)}): keep one execution profile"
        ]
    if f.has(PLANNED) and not f.executions:
        return [f"{PLANNED} without an execution profile"]
    if f.has(DEFERRED) and f.executions:
        return [f"{DEFERRED} keeps {f.executions[0]}"]
    return []


def _rules(f: _Facts) -> list[str]:
    problems = [f"{name} is not defined in .github/labels.json" for name in f.unknown]
    problems += [f"legacy label {name}: re-evaluate and replace it" for name in f.legacy]
    problems += _status_rule(f)
    if f.has(P0) and f.has(P1):
        problems.append(f"both {P0} and {P1}")
    if f.has(P0) and not f.assigned:
        problems.append(f"{P0} unassigned")
    if f.has("risk:high") and f.has("risk:medium"):
        problems.append("both risk:high and risk:medium")
    problems += _execution_rule(f)
    if f.has(EXPERT) and not f.assigned:
        problems.append(f"{EXPERT} unassigned")
    problems += [f"{name} unassigned" for name in NEEDS_OWNER if f.has(name) and not f.assigned]
    if f.has(PLANNED):
        problems += [f"{PLANNED} with {name}" for name in NOT_PLANNABLE if f.has(name)]
    return problems


def issue_violations(labels: Iterable[str], assigned: bool, definitions: list[dict]) -> list[str]:
    """The rules one issue breaks, in the order the JavaScript checker reports them."""
    return _rules(_facts(labels, assigned, definitions))


def is_untriaged(labels: Iterable[str]) -> bool:
    """True when triage still has to classify the issue."""
    names = set(labels)
    statuses = [name for name in STATUSES if name in names]
    return not statuses or statuses == [TRIAGE]


def priority_rank(labels: Iterable[str]) -> int:
    names = set(labels)
    return 0 if P0 in names else 1 if P1 in names else 2


@dataclass(frozen=True)
class Candidate:
    """What the dispatch rule reads of an issue."""

    number: int
    labels: tuple[str, ...]
    assigned: bool
    created_at: str


def held_reasons(
    issue: Candidate,
    definitions: list[dict],
    with_open_pr: frozenset[int] | set[int] = frozenset(),
    claimed: frozenset[int] | set[int] = frozenset(),
) -> list[str]:
    """Why a planned issue may not be dispatched; empty when a cell may take it.

    ``claimed`` adds issues a live claim comment holds, beside the ``status:in-progress`` label
    the JavaScript checker reads.
    """
    reasons = []
    if EXPERT in issue.labels:
        reasons.append(f"{EXPERT}: the owner's lane")
    elif issue.assigned:
        reasons.append("assigned: the owner's lane")
    if IN_PROGRESS in issue.labels or issue.number in claimed:
        reasons.append("claimed")
    if issue.number in with_open_pr:
        reasons.append("an open PR would close it")
    problems = issue_violations(issue.labels, issue.assigned, definitions)
    if problems:
        reasons.append(f"breaks a rule: {'; '.join(problems)}")
    return reasons


def dispatch_order(
    issues: Iterable[Candidate],
    definitions: list[dict],
    with_open_pr: frozenset[int] | set[int] = frozenset(),
    claimed: frozenset[int] | set[int] = frozenset(),
) -> tuple[list[Candidate], list[dict]]:
    """The issues a cell may take, in dispatch order, and why each other planned issue is held.

    Dispatch order is ``priority:0``, then ``priority:1``, then the rest, oldest first. Issues
    that are not planned are neither dispatchable nor held.
    """
    dispatchable: list[Candidate] = []
    held: list[dict] = []
    for issue in issues:
        if PLANNED not in issue.labels:
            continue
        reasons = held_reasons(issue, definitions, with_open_pr, claimed)
        if reasons:
            held.append({"number": issue.number, "reasons": reasons})
        else:
            dispatchable.append(issue)
    dispatchable.sort(key=lambda i: (priority_rank(i.labels), i.created_at, i.number))
    return dispatchable, held


def label_differences(definitions: list[dict], live: list[dict]) -> dict:
    """Differences between the definitions and the repository's labels."""
    live_by_name = {label["name"]: label for label in live}
    names = {entry["name"] for entry in definitions}
    missing = [entry for entry in definitions if entry["name"] not in live_by_name]
    extra = [label["name"] for label in live if label["name"] not in names]
    changed = []
    for entry in definitions:
        label = live_by_name.get(entry["name"])
        if label is None:
            continue
        if str(label.get("color", "")).lower() != str(entry["color"]).lower():
            changed.append(
                f"{entry['name']}: color {entry['color']} in the file, "
                f"{label.get('color')} in GitHub"
            )
        if (label.get("description") or "") != entry["description"]:
            changed.append(
                f'{entry["name"]}: description differs from GitHub ("{label.get("description")}")'
            )
    return {"missing": missing, "extra": extra, "changed": changed}
