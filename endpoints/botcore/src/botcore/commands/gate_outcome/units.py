"""Where a commit's files belong and which of them are test paths, for the `main` source.

**Areas.** A file's area is the unit whose manifest's folder holds it, the deepest where
several do. The units are the repository's list, read through git at the default branch's
tip: in a repository with an `architecture.json`, every unit it lists, and every manifest
(`package.json`, `pyproject.toml`, `Cargo.toml`, and a `CMakeLists.txt` that declares a
project `VERSION`) under its `discoveryRoots`, outside `exclude` and `quarantine` and outside
build folders, as the repository's own boundary check finds them. A repository without that
file gets the nearest folder below its top that holds a manifest. A commit whose files no unit
holds is `repository`; one whose files belong to more than one unit is `several`, with each
unit named. A file outside every unit does not make a commit `several`.

**Test paths.** A path is a test path when a folder on it is `tests`, `test` or `__tests__`;
when its name holds `.test.`, `.spec.` or `.scenario.`; when it is a Python or C-style test
file (`test_<name>` or `<name>_test` with a `.py`, `.c`, `.cc`, `.cpp` or `.cxx` extension,
or `<name>_test.h` or `.hpp`); or when it is a Rust file whose changed lines, on either side,
sit inside a test module: a `mod <name> { ... }` that a `#[cfg(test)]` attribute (or a
`cfg(all(test, ...))` or `cfg(any(test, ...))`) marks. The module's end is found by matching
its braces, with comments, strings and character literals skipped.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import PurePosixPath

MANIFESTS = ("package.json", "pyproject.toml", "Cargo.toml", "CMakeLists.txt")
# Folders the repository's boundary check does not look in
SKIP = {
    "node_modules", "dist", "build", "target", ".git", ".venv", "__pycache__", ".specimen",
    "coverage", "temp", "test-results", "playwright-report",
}  # fmt: skip
REPOSITORY = "repository"
SEVERAL = "several"
TEST_FOLDERS = {"tests", "test", "__tests__"}
_TEST_NAME = re.compile(
    r"\.(?:test|spec|scenario)\.|^test_[^/]*\.(?:py|c|cc|cpp|cxx)$|_test\.(?:py|c|cc|cpp|cxx|h|hpp)$"
)
_CMAKE_VERSION = re.compile(r"\bproject\s*\([^)]*\bVERSION\b", re.IGNORECASE | re.DOTALL)
_CFG_TEST = re.compile(r"#\[cfg\(\s*(?:(?:all|any)\(\s*(?:[^()]*,\s*)?)?test\b")
_MOD = re.compile(r"\s*(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?mod\s+[A-Za-z_]\w*\s*\{")


@dataclass
class Units:
    """The units at a ref: each one's folder, or why they could not be read."""

    folders: list[str] = field(default_factory=list)  # deepest first
    source: str = "architecture.json"  # or `manifests`, or `none`
    problem: str | None = None

    def of(self, path: str) -> str | None:
        """The unit that holds `path`, the deepest one, or None."""
        for folder in self.folders:
            if path.startswith(folder + "/"):
                return folder
        return None

    def area(self, paths: list[str]) -> tuple[str, list[str]]:
        """A commit's area and its units, those that hold most of its files first, then by
        name: one unit, `repository` where none holds any file, `several` where more do."""
        held: dict[str, int] = {}
        for path in paths:
            unit = self.of(path)
            if unit is not None:
                held[unit] = held.get(unit, 0) + 1
        units = sorted(held, key=lambda unit: (-held[unit], unit))
        if not units:
            return REPOSITORY, []
        return (units[0] if len(units) == 1 else SEVERAL), units


def _within(path: str, root: str) -> bool:
    root = root.rstrip("/")
    return path == root or path.startswith(root + "/")


def _skipped(path: str) -> bool:
    return any(part in SKIP for part in path.split("/")[:-1])


def read_units(paths: list[str], show) -> Units:  # noqa: ANN001, C901 - show(path) -> text | None
    """The units of a tree whose files are `paths`, reading a file's text with `show`."""
    text = show("architecture.json") if "architecture.json" in paths else None
    if text is None:
        folders = {
            str(PurePosixPath(path).parent)
            for path in paths
            if PurePosixPath(path).name in MANIFESTS[:3] and "/" in path and not _skipped(path)
        }
        return Units(sorted(folders, key=lambda f: (-f.count("/"), f)), source="manifests")
    try:
        config = json.loads(text)
    except ValueError:
        return Units(source="none", problem="architecture.json at the tip does not parse")
    if not isinstance(config, dict):
        return Units(source="none", problem="architecture.json at the tip is not an object")
    roots = [r for r in config.get("discoveryRoots") or [] if isinstance(r, str)]
    excluded = [e for e in config.get("exclude") or [] if isinstance(e, str)]
    quarantined: list[str] = []
    for item in config.get("quarantine") or []:
        path = item.get("path") if isinstance(item, dict) else item
        if isinstance(path, str):
            quarantined.append(path)
    listed = {
        unit["manifest"]
        for unit in config.get("units") or []
        if isinstance(unit, dict) and isinstance(unit.get("manifest"), str)
    }
    manifests = set(listed)
    for path in paths:
        name = PurePosixPath(path).name
        if name not in MANIFESTS or _skipped(path) or not any(_within(path, r) for r in roots):
            continue
        if any(_within(path, item) for item in (*excluded, *quarantined)):
            continue
        if name == "CMakeLists.txt" and path not in listed:
            cmake = show(path)  # a nested CMake file describes targets, not a unit
            if cmake is None or not _CMAKE_VERSION.search(cmake):
                continue
        manifests.add(path)
    folders = {str(PurePosixPath(path).parent) for path in manifests if "/" in path}
    return Units(sorted(folders, key=lambda f: (-f.count("/"), f)))


# ── Test paths ──────────────────────────────────────────────────────────────


def named_test(path: str) -> bool:
    """Whether a path is a test path by its folders or its name alone."""
    parts = path.split("/")
    return bool(TEST_FOLDERS & set(parts[:-1])) or bool(_TEST_NAME.search(parts[-1]))


def rust_test_lines(text: str) -> list[tuple[int, int]]:
    """The line spans (first, last, from 1) of a Rust file's test modules."""
    spans = []
    for found in _CFG_TEST.finditer(text):
        close = text.find("]", found.end())
        if close < 0:
            continue
        module = _MOD.match(text, close + 1)
        if module is None:
            continue
        end = _matching_brace(text, module.end() - 1)
        first = text.count("\n", 0, found.start()) + 1
        last = text.count("\n", 0, end) + 1 if end is not None else text.count("\n") + 1
        spans.append((first, last))
    return spans


def _matching_brace(text: str, start: int) -> int | None:  # noqa: C901, PLR0912 - a small lexer
    """The index of the brace that closes the one at `start`, skipping comments, strings,
    raw strings and character literals; None when the file ends first."""
    depth, at, size = 0, start, len(text)
    while at < size:
        char = text[at]
        ahead = text[at : at + 2]
        if ahead == "//":
            at = text.find("\n", at)
            if at < 0:
                return None
            continue
        if ahead == "/*":
            nested, at = 1, at + 2
            while at < size and nested:
                if text.startswith("/*", at):
                    nested, at = nested + 1, at + 2
                elif text.startswith("*/", at):
                    nested, at = nested - 1, at + 2
                else:
                    at += 1
            continue
        raw = re.match(r'b?r(#*)"', text[at : at + 260])
        if raw and (at == 0 or not (text[at - 1].isalnum() or text[at - 1] == "_")):
            closing = '"' + raw.group(1)
            found = text.find(closing, at + raw.end())
            if found < 0:
                return None
            at = found + len(closing)
            continue
        if char == '"':
            at += 1
            while at < size and text[at] != '"':
                at += 2 if text[at] == "\\" else 1
            at += 1
            continue
        if char == "'":
            literal = re.match(
                r"'(?:\\(?:x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]{1,6}\}|.)|[^\\'])'", text[at : at + 12]
            )
            if literal:  # a character literal; otherwise a lifetime
                at += literal.end()
                continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return at
        at += 1
    return None


def in_spans(lines: list[int], spans: list[tuple[int, int]]) -> bool:
    return any(first <= line <= last for line in lines for first, last in spans)


@dataclass
class FileChange:
    """One file of a commit's diff: its paths and the lines it removes and adds."""

    old: str | None  # None for a file the commit adds
    new: str | None  # None for a file the commit deletes
    removed: list[int] = field(default_factory=list)  # lines of the old file
    added: list[int] = field(default_factory=list)  # lines of the new file

    @property
    def path(self) -> str:
        return self.new or self.old or ""


_HUNK = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


def _diff_path(value: str) -> str | None:
    """A path of a `---` or `+++` header: git ends one holding a space with a tab."""
    value = value.rstrip("\r\n").removesuffix("\t")
    if value == "/dev/null":
        return None
    if value.startswith('"') and value.endswith('"'):
        value = value[1:-1].encode("latin-1", "backslashreplace").decode("unicode_escape")
        value = value.encode("latin-1", "ignore").decode("utf-8", "replace")
    return value[2:] if value[:2] in ("a/", "b/") else value


def parse_diff(text: str) -> list[FileChange]:
    """A zero-context diff (`git show -U0 -M`) as the lines each file removes and adds."""
    changes: list[FileChange] = []
    current: FileChange | None = None
    old: str | None = None
    for line in text.split("\n"):
        if line.startswith("diff --git "):
            current, old = None, None
        elif line.startswith("--- ") and current is None:
            old = _diff_path(line[4:])
        elif line.startswith("+++ ") and current is None:
            current = FileChange(old, _diff_path(line[4:]))
            changes.append(current)
        elif line.startswith("@@") and current is not None:
            found = _HUNK.match(line)
            if found:
                start_old, count_old = int(found.group(1)), int(found.group(2) or 1)
                start_new, count_new = int(found.group(3)), int(found.group(4) or 1)
                current.removed.extend(range(start_old, start_old + count_old))
                current.added.extend(range(start_new, start_new + count_new))
    return changes
