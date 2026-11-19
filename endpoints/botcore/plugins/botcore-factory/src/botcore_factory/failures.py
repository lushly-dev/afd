"""Every test a validation's runners reported failed, read from its whole log (lushly-dev/afd#1607).

A change that cuts across many tests used to cost one ejection per failing test binary: the lane
saw only the first. The adapter's validation now runs every suite to the end (AFD's is
``pnpm verify --keep-going``, with ``cargo test --no-fail-fast``), and the lane names each test
that failed in the ejection, read from the runners' own marks:

- cargo: ``test <name> ... FAILED``, named with the binary from the ``Running`` line before it
  (its crate and source, so two crates' ``src/lib.rs`` stay apart) or ``Doc-tests <crate>``.
- vitest: ``FAIL [|project|] <file> > <name>``; a file that failed to run is named as such.
- pytest: the ``FAILED`` and ``ERROR`` rows of its short summary, with the full node id.
- node:test: the leaves its spec reporter lists under ``✖ failing tests:``, with their location;
  without that list, ``✖`` lines that are not suites, and TAP's ``not ok`` without a directive.
- CTest: the rows under ``The following tests FAILED:``.
- Playwright: the numbered rows of its list reporter's summary (``1) [chromium] › ...``).

``pnpm -r``'s package prefix is kept in a vitest or pytest name, so one file name in two packages
stays two failures. A suite that failed without naming a test (a lint, a build) is not here:
``first_lines`` gives the verify summary row that names it.
"""

from __future__ import annotations

import re

_ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
#: ``pnpm -r``'s prefix on a package's output: its directory, then the script.
_PNPM = re.compile(r"^(\S*/\S*) [\w:.-]+: ")
_CARGO_RUNNING = re.compile(
    r"^\s*Running (?:unittests )?(\S+) \((?:.*[/\\])?([^/\\()]+?)(?:-[0-9a-f]{6,})?(?:\.exe)?\)"
)
_CARGO_DOCTESTS = re.compile(r"^\s*Doc-tests (\S+)")
_CARGO_FAILED = re.compile(r"^test (.+?) \.\.\. FAILED$")
#: ``pnpm verify``'s summary row (``  FAIL  612s  name``), which names a suite, not a test.
_SUMMARY_FAIL = re.compile(r"^\s*FAIL\s+\d+s\s+\S")
_VITEST_FAILED = re.compile(r"^\s*FAIL\s+(?:\|([^|]+)\|\s+)?(\S+\.[cm]?[jt]sx?)\b\s*(.*)$")
_PYTEST_FAILED = re.compile(r"^(?:FAILED|ERROR) (\S+?\.py(?:::.+?)?)(?: - .*)?$")
_PLAYWRIGHT_FAILED = re.compile(r"^\s*\d+\) (\[[^\]]+\] › .+?)\s*─*$")
_CTEST_HEADER = re.compile(r"^The following tests FAILED:")
_CTEST_ROW = re.compile(r"^\s*\d+ - (.+?) \([^)]*\)\s*$")
_NODE_SUMMARY = re.compile(r"^✖ failing tests:$")
_NODE_LOCATION = re.compile(r"^test at (\S+)$")
_NODE_SUITE = re.compile(r"^\s*▶ (.+?)$")
_NODE_FAILED = re.compile(r"^\s*✖ (.+?)(?: \([\d.]+m?s\))?$")
_TAP_FAILED = re.compile(r"^\s*not ok \d+ - (.+?)$")
_TAP_DIRECTIVE = re.compile(r"\s#\s*(?:TODO|SKIP)\b", re.I)
#: A linter's tally that also starts with ``✖`` (``✖ 3 problems (3 errors, 0 warnings)``).
_NOT_A_TEST = re.compile(r"^\d+ problems?\b")


def failing_tests(text: str) -> list[str]:
    """Each failing test the runners in ``text`` reported, in order and once each."""
    reader = _Reader()
    for raw in text.splitlines():
        line = _ANSI.sub("", raw).rstrip()
        package = None
        if prefix := _PNPM.match(line):
            package, line = prefix[1], line[prefix.end() :]
        reader.read(line, package)
    return reader.tests()


class _Reader:
    """What a log's lines have said so far: the cargo binary running and whether a CTest or
    node:test list of failures is open."""

    def __init__(self) -> None:
        self.found: dict[str, None] = {}
        self.binary: str | None = None
        self.ctest = False
        self.summary = False  # Inside node:test's "failing tests:" list.
        self.location: str | None = None
        self.leaves: dict[str, None] = {}  # node:test's listed leaves.
        self.marked: dict[str, None] = {}  # ✖ and not ok lines, for a log without that list.
        self.suites: set[str] = set()

    def tests(self) -> list[str]:
        node = self.leaves or {name: None for name in self.marked if name not in self.suites}
        return [*self.found, *(name for name in node if name not in self.found)]

    def read(self, line: str, package: str | None) -> None:
        if self.summary and self._summary(line):
            return
        if self.ctest:
            if row := _CTEST_ROW.match(line):
                self.found[f"ctest: {row[1]}"] = None
                return
            self.ctest = False
        if not self._cargo(line):
            self._other(line, package)

    def _summary(self, line: str) -> bool:
        """Whether ``line`` belongs to node:test's list: ``test at <where>``, the leaf, then its
        indented diagnostics."""
        if where := _NODE_LOCATION.match(line):
            self.location = where[1]
            return True
        if self.location and (leaf := _NODE_FAILED.match(line)) and not line.startswith(" "):
            self.leaves[f"{self.location}: {leaf[1]}"] = None
            self.location = None
            return True
        if not line or line.startswith(" "):
            return True
        self.summary = False
        return False

    def _cargo(self, line: str) -> bool:
        if running := _CARGO_RUNNING.match(line):
            self.binary = f"{running[2]} {running[1]}"
        elif doctests := _CARGO_DOCTESTS.match(line):
            self.binary = f"{doctests[1]} doc-tests"
        elif cargo := _CARGO_FAILED.match(line):
            self.found[f"{self.binary}: {cargo[1]}" if self.binary else cargo[1]] = None
        else:
            return False
        return True

    def _other(self, line: str, package: str | None) -> None:
        within = f"{package}/" if package else ""
        if _CTEST_HEADER.match(line):
            self.ctest = True
        elif _NODE_SUMMARY.match(line):
            self.summary, self.location = True, None
        elif _SUMMARY_FAIL.match(line):
            return
        elif vitest := _VITEST_FAILED.match(line):
            project, file, rest = vitest[1], vitest[2], vitest[3].strip()
            ran = rest and not rest.startswith("[")
            name = f"{within}{file} {rest}" if ran else f"{within}{file} (the file failed to run)"
            self.found[f"{name} [{project.strip()}]" if project else name] = None
        elif pytest := _PYTEST_FAILED.match(line):
            self.found[f"{within}{pytest[1]}"] = None
        elif playwright := _PLAYWRIGHT_FAILED.match(line):
            self.found[playwright[1]] = None
        elif suite := _NODE_SUITE.match(line):
            self.suites.add(suite[1])
        elif node := _NODE_FAILED.match(line):
            if not _NOT_A_TEST.match(node[1]):
                self.marked[node[1]] = None
        elif (tap := _TAP_FAILED.match(line)) and not _TAP_DIRECTIVE.search(tap[1]):
            self.marked[tap[1]] = None
