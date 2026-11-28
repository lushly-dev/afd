"""Every command a refusal's suggestion names is one the factory serves.

An agent follows a refusal's suggestion. A suggestion that names a command no host serves sends
it to an unknown command: `lane-enqueue` once told cells to use `lane-handoff`, which is planned
and was never built. This reads each `Refusal(code, message, suggestion)` in the plugin (not the
gateway, a separate surface), resolves what its suggestion can say, and checks every hyphenated
name in it against the commands the factory serves and a short list of names that are not
commands (skills, events, checks, files).
"""

from __future__ import annotations

import ast
import re
from collections.abc import Iterator
from pathlib import Path

import pytest
from botcore.context import ExecutionContext

from botcore_factory.hosts import build_factory_host

SOURCE = Path(__file__).resolve().parents[1] / "src" / "botcore_factory"
NAME = re.compile(r"(?<![\w/-])(?<!\w\.)([A-Za-z]+(?:-[A-Za-z]+)+)(?![\w/-]|\.\w)")
UNRESOLVED = re.compile("\x00([^\x00]*)\x00")
"""Marks an interpolated value the scan could not resolve, around its source expression."""

#: Hyphenated names a suggestion may use that are not commands, each with what it is.
NOT_COMMANDS = {
    "auto-merge": "GitHub's setting",
    "botcore-factory": "the plugin's package",
    "ci-ok": "the required check",
    "prepare-pr": "a skill",
    "queue-empty": "an event",
    "queue-room": "an event",
    "triage-issues": "a skill",
}

#: Interpolated values the scan cannot resolve, by file, the function raising the refusal and the
#: expression, each with why it names no command. A new one fails the test until it is listed.
UNRESOLVED_ALLOWED = {
    ("cells.py", "_check_capacity", "_percent(choice.ceiling)"): "a plan's ceiling, a percentage",
    (
        "cells.py",
        "_check_capacity",
        "choice.next_reset or 'an unknown time'",
    ): "a plan's reset time",
    ("cells.py", "_check_capacity", "plan.id"): "a plan's id, such as claudeAgent:seven_day",
    ("cells.py", "_check_capacity", "plan.stale"): "why a plan's usage cache is out of date",
    ("cells.py", "_check_capacity", "stale"): "a count of stale plans",
    ("cells.py", "_check_capacity", "self.floor"): "a disk floor in GB",
    ("cells.py", "_check_capacity", "self.free"): "free disk in GB",
    ("cells.py", "_check_capacity", "self.machine"): "a machine id",
    ("cells.py", "_check_capacity", "self.where"): "a disk path",
    ("lane_process.py", "require_check", "base"): "the base branch",
    ("lane_process.py", "require_host", "host"): "a machine id",
    ("lane_process.py", "require_check", "name"): "the required check's name",
    ("lane_process.py", "require_toolchains", "spec"): "a toolchain's version, such as 26",
    ("machines.py", "host_set", "current"): "a machine id",
    ("machines.py", "host_set", "host_id"): "a machine id",
    (
        "queue.py",
        "_prequeue",
        "fix",
    ): "the same suggestion's own first sentence, scanned on its own",
    ("queue.py", "_check_host", "lane_host"): "a machine id",
    (
        "queue.py",
        "_prequeue",
        "shlex.join(install)",
    ): "the adapter's install command, a shell command line",
    ("queue.py", "_prequeue", "stage.name"): "a pre-queue stage's configured name",
    ("runtime.py", "page", "DEFAULT_LIMIT"): "a page size",
    ("runtime.py", "page", "MAX_LIMIT"): "a page size",
    ("status.py", "find_dial", "', '.join(close)"): "dial names, such as lane.slots",
}

#: Suggestions built where the call site cannot show them: the function that writes the text.
BUILT_ELSEWHERE = {
    ("cells.py", "suggestion"): "no_plan_reason",
    ("cells.py", "short.suggestion"): "DiskShort",
}


def _parents(tree: ast.AST) -> dict[ast.AST, ast.AST]:
    return {child: node for node in ast.walk(tree) for child in ast.iter_child_nodes(node)}


def _enclosing(node: ast.AST, parents: dict[ast.AST, ast.AST]) -> ast.AST | None:
    while node in parents:
        node = parents[node]
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            return node
    return None


class _Module:
    """One source file: its tree, and the text an expression in it can produce."""

    def __init__(self, path: Path, everything: dict[str, ast.Module]) -> None:
        self.name = path.name
        self.tree = everything[path.name]
        self.parents = _parents(self.tree)
        self.everything = everything

    def texts(self, node: ast.AST, scope: ast.AST | None, depth: int = 0) -> Iterator[str]:
        if depth > 4:
            return
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            yield node.value
        elif isinstance(node, ast.JoinedStr):
            parts: list[list[str]] = [[""]]
            for value in node.values:
                if isinstance(value, ast.Constant):
                    parts.append([str(value.value)])
                else:
                    filled = list(self.texts(value.value, scope, depth + 1))
                    parts.append(filled or [f"\x00{ast.unparse(value.value)}\x00"])
            yield from _combinations(parts)
        elif isinstance(node, ast.BinOp):
            yield from self.texts(node.left, scope, depth + 1)
            yield from self.texts(node.right, scope, depth + 1)
        elif isinstance(node, ast.IfExp):
            yield from self.texts(node.body, scope, depth + 1)
            yield from self.texts(node.orelse, scope, depth + 1)
        elif isinstance(node, ast.Name):
            yield from self._name(node.id, scope, depth)
        elif isinstance(node, (ast.Call, ast.Subscript, ast.Attribute)):
            # `fix[0].upper() + fix[1:]` and the like: the text is the names it is built from.
            for inner in ast.walk(node):
                if isinstance(inner, ast.Name) and inner is not node:
                    yield from self._name(inner.id, scope, depth)

    def _name(self, name: str, scope: ast.AST | None, depth: int) -> Iterator[str]:
        if scope is None:
            return
        for node in ast.walk(scope):
            if isinstance(node, (ast.Assign, ast.AnnAssign)):
                targets = node.targets if isinstance(node, ast.Assign) else [node.target]
                if any(isinstance(t, ast.Name) and t.id == name for t in targets) and node.value:
                    yield from self.texts(node.value, scope, depth + 1)
        if isinstance(scope, (ast.FunctionDef, ast.AsyncFunctionDef)):
            params = [a.arg for a in scope.args.args + scope.args.kwonlyargs]
            if name in params:
                yield from self._arguments(scope.name, params.index(name), name, depth)

    def _arguments(self, function: str, index: int, name: str, depth: int) -> Iterator[str]:
        """What callers anywhere in the plugin pass for a parameter of ``function``."""
        for module in self.everything.values():
            parents = _parents(module)
            for node in ast.walk(module):
                if not (isinstance(node, ast.Call) and _called(node) == function):
                    continue
                scope = _enclosing(node, parents)
                given = [k.value for k in node.keywords if k.arg == name]
                if index < len(node.args):
                    given.append(node.args[index])
                for value in given:
                    yield from self.texts(value, scope, depth + 1)

    def builder(self, function: str) -> Iterator[str]:
        for node in ast.walk(self.tree):
            if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name == function:
                for inner in ast.walk(node):
                    if isinstance(inner, (ast.Constant, ast.JoinedStr)):
                        yield from self.texts(inner, node)


def _combinations(parts: list[list[str]]) -> Iterator[str]:
    if not parts:
        yield ""
        return
    for head in parts[0]:
        for tail in _combinations(parts[1:]):
            yield head + tail


def _called(node: ast.Call) -> str | None:
    if isinstance(node.func, ast.Name):
        return node.func.id
    if isinstance(node.func, ast.Attribute):
        return node.func.attr
    return None


def refusals() -> list[tuple[str, int, list[str]]]:
    """Each refusal in the plugin: its file, line and every text its suggestion can be."""
    paths = [
        p for p in sorted(SOURCE.rglob("*.py")) if "gateway" not in p.relative_to(SOURCE).parts
    ]
    everything = {p.name: ast.parse(p.read_text(encoding="utf-8")) for p in paths}
    found = []
    for path in paths:
        module = _Module(path, everything)
        for node in ast.walk(module.tree):
            if not (isinstance(node, ast.Call) and _called(node) == "Refusal"):
                continue
            argument = node.args[2] if len(node.args) >= 3 else None
            argument = argument or next(
                (k.value for k in node.keywords if k.arg == "suggestion"), None
            )
            if argument is None:
                continue
            scope = _enclosing(node, module.parents)
            texts = list(module.texts(argument, scope))
            builder = BUILT_ELSEWHERE.get((path.name, ast.unparse(argument)))
            if builder:
                texts += list(module.builder(builder))
            # An unresolved value is allowed at its own refusal site only: tag it with the
            # function that raises the refusal.
            site = getattr(scope, "name", "<module>")
            texts = [UNRESOLVED.sub(lambda m, f=site: f"\x00{f}|{m[1]}\x00", t) for t in texts]
            found.append((path.name, node.lineno, texts))
    return found


@pytest.fixture(scope="module")
def served(tmp_path_factory) -> set[str]:
    host = build_factory_host(
        "factory", ExecutionContext(tmp_path_factory.mktemp("target"), profile="trusted-local")
    )
    return {name.replace("_", "-") for name in host.list_command_names()}


def test_every_refusal_s_suggestion_is_read():
    # A suggestion the scan cannot read would pass every check below unseen.
    unread = [
        f"{file}:{line}"
        for file, line, texts in refusals()
        if not UNRESOLVED.sub("", "".join(texts)).strip()
    ]
    assert not unread, f"Resolve these suggestions or list where they are built: {unread}"
    names = {
        name
        for _, _, texts in refusals()
        for text in texts
        for name in NAME.findall(UNRESOLVED.sub(" ", text))
    }
    assert {"issue-check", "lane-enqueue", "lane-host-set", "lane-start"} <= names


def test_every_value_a_suggestion_interpolates_is_resolved_or_allowed():
    # An f-string value the scan cannot resolve could name a command unchecked.
    unresolved = sorted(
        {
            f"{file}:{line} interpolates {expression}"
            for file, line, texts in refusals()
            for text in texts
            for expression in UNRESOLVED.findall(text)
            if (file, *expression.split("|", 1)) not in UNRESOLVED_ALLOWED
        }
    )
    assert not unresolved, f"Resolve these values or allow them with a reason: {unresolved}"


def test_a_name_ending_a_sentence_is_still_a_name():
    assert NAME.findall("Then run lane-handoff.") == ["lane-handoff"]
    assert NAME.findall("Edit pr-body.md or botcore-factory.toml") == []


def test_every_allowed_interpolation_is_still_there():
    found = {
        (f, *e.split("|", 1))
        for f, _, texts in refusals()
        for t in texts
        for e in UNRESOLVED.findall(t)
    }
    assert set(UNRESOLVED_ALLOWED) <= found, set(UNRESOLVED_ALLOWED) - found


def test_every_name_a_suggestion_uses_is_a_served_command_or_listed(served):
    unknown = sorted(
        {
            f"{file}:{line} names {name}"
            for file, line, texts in refusals()
            for text in texts
            for name in NAME.findall(UNRESOLVED.sub(" ", text))
            if name.lower() not in served and name.lower() not in NOT_COMMANDS
        }
    )
    assert not unknown, unknown


def test_the_names_that_are_not_commands_are_still_used():
    used = {
        name.lower()
        for _, _, texts in refusals()
        for t in texts
        for name in NAME.findall(UNRESOLVED.sub(" ", t))
    }
    assert set(NOT_COMMANDS) <= used, set(NOT_COMMANDS) - used
