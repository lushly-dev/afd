"""The world as it is: GitHub through ``gh``, git, the system clock, this machine, T3 Code's
plan caches and the operating system's processes.

This is the only module that starts processes. Every command is an argument list, never a
shell string, and on Windows the program is started by its resolved path (``shutil.which``),
so ``gh`` is found without a shell. Each class takes a ``run`` callable so tests can answer
for ``gh`` and ``git`` without calling them.
"""

from __future__ import annotations

import contextlib
import json
import os
import shutil
import socket
import subprocess
import sys
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from pathlib import Path

from botcore_factory.claims import parse_time
from botcore_factory.world import (
    Comment,
    Completed,
    HostRecord,
    Issue,
    Plan,
    PullRequest,
    World,
    WorldError,
)

READ_LIMIT = 2000  # Issues or PRs per read; a read that reaches it may be cut short.
ISSUE_FIELDS = "number,title,state,labels,assignees,createdAt"
GIB = 1024**3
Run = Callable[..., str]


def resolve_program(program: str) -> str:
    """The program's full path, so Windows starts ``gh.exe`` without a shell."""
    found = shutil.which(program)
    if not found:
        raise WorldError(f"{program} is not on PATH")
    return found


def run_process(
    args: Sequence[str],
    *,
    cwd: str | None = None,
    stdin: str | None = None,
    timeout: float | None = 60,
) -> Completed:
    """Run an argument list and capture its output. Never a shell."""
    argv = [resolve_program(args[0]), *args[1:]]
    try:
        done = subprocess.run(  # noqa: S603 - an argument list, resolved program, no shell
            argv,
            cwd=cwd,
            input=stdin,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise WorldError(f"{args[0]} could not run: {exc}") from exc
    return Completed(tuple(args), done.returncode, done.stdout, done.stderr)


def make_runner(cwd: str) -> Run:
    """A ``run(args, stdin=None)`` returning stdout, raising WorldError on a nonzero exit."""

    def run(args: Sequence[str], stdin: str | None = None) -> str:
        done = run_process(args, cwd=cwd, stdin=stdin)
        if done.returncode != 0:
            detail = (done.stderr or done.stdout).strip().splitlines()
            raise WorldError(
                f"{' '.join(args[:3])} failed: {detail[0] if detail else done.returncode}"
            )
        return done.stdout

    return run


def _json(text: str, what: str):
    try:
        return json.loads(text)
    except ValueError as exc:
        raise WorldError(f"{what} returned something that is not JSON") from exc


def _issue(raw: dict) -> Issue:
    return Issue(
        number=raw["number"],
        title=raw.get("title", ""),
        labels=tuple(label["name"] for label in raw.get("labels") or []),
        assignees=tuple(person["login"] for person in raw.get("assignees") or []),
        created_at=raw.get("createdAt", ""),
        state=raw.get("state", "OPEN"),
    )


class GhGitHub:
    """GitHub through the ``gh`` CLI, run in the target checkout."""

    def __init__(self, run: Run) -> None:
        self.run = run
        self._repository: str | None = None

    def repository(self) -> str:
        if self._repository is None:
            data = _json(self.run(["gh", "repo", "view", "--json", "nameWithOwner"]), "gh repo")
            self._repository = data["nameWithOwner"]
        return self._repository

    def list_issues(self) -> list[Issue]:
        rows = _json(
            self.run(
                [
                    "gh",
                    "issue",
                    "list",
                    "--state",
                    "open",
                    "--limit",
                    str(READ_LIMIT),
                    "--json",
                    ISSUE_FIELDS,
                ]
            ),
            "gh issue list",
        )
        if len(rows) >= READ_LIMIT:
            raise WorldError(f"gh returned {len(rows)} issues, the read limit; the list may be cut")
        return [_issue(row) for row in rows]

    def get_issue(self, number: int) -> Issue:
        raw = self.run(["gh", "issue", "view", str(number), "--json", ISSUE_FIELDS])
        return _issue(_json(raw, "gh issue view"))

    def comments(self, number: int) -> list[Comment]:
        data = _json(self.run(["gh", "issue", "view", str(number), "--json", "comments"]), "gh")
        return [
            Comment(
                str(item.get("id", "")),
                item.get("body", ""),
                (item.get("author") or {}).get("login", ""),
                item.get("createdAt", ""),
            )
            for item in data.get("comments", [])
        ]

    def edit_labels(self, number: int, add: Sequence[str] = (), remove: Sequence[str] = ()) -> None:
        args = ["gh", "issue", "edit", str(number)]
        for label in add:
            args += ["--add-label", label]
        for label in remove:
            args += ["--remove-label", label]
        self.run(args)

    def add_comment(self, number: int, body: str) -> Comment:
        url = self.run(["gh", "issue", "comment", str(number), "--body-file", "-"], body).strip()
        return Comment(url.rsplit("#issuecomment-", 1)[-1], body, "", "")

    def open_pull_requests(self) -> list[PullRequest]:
        rows = _json(
            self.run(
                [
                    "gh",
                    "pr",
                    "list",
                    "--state",
                    "open",
                    "--limit",
                    str(READ_LIMIT),
                    "--json",
                    "number,headRefName,closingIssuesReferences",
                ]
            ),
            "gh pr list",
        )
        if len(rows) >= READ_LIMIT:
            raise WorldError(f"gh returned {len(rows)} PRs, the read limit; the list may be cut")
        return [
            PullRequest(
                row["number"],
                row.get("headRefName", ""),
                tuple(ref["number"] for ref in row.get("closingIssuesReferences") or []),
            )
            for row in rows
        ]

    def get_variable(self, name: str) -> str | None:
        try:
            return self.run(["gh", "variable", "get", name]).strip()
        except WorldError as exc:
            if "not found" in str(exc).lower():
                return None
            raise

    def set_variable(self, name: str, value: str) -> None:
        self.run(["gh", "variable", "set", name, "--body", value])


class CliGit:
    """git in the target checkout. Host records are fetched from origin's refs/factory/hosts."""

    def __init__(self, run: Run) -> None:
        self.run = run

    def host_records(self) -> list[HostRecord]:
        self.run(
            [
                "git",
                "fetch",
                "--quiet",
                "--no-tags",
                "origin",
                "+refs/factory/hosts/*:refs/factory/hosts/*",
            ]
        )
        refs = self.run(["git", "for-each-ref", "--format=%(refname)", "refs/factory/hosts"])
        records = []
        for ref in refs.split():
            raw = _json(self.run(["git", "show", f"{ref}:host.json"]), f"git show {ref}")
            records.append(
                HostRecord(
                    id=raw.get("id") or ref.rsplit("/", 1)[-1],
                    name=raw.get("name", ""),
                    cores=raw.get("cores"),
                    memory_gb=raw.get("memoryGb"),
                    free_disk_gb=raw.get("freeDiskGb"),
                    missing=tuple(raw.get("missing", [])),
                    measured=bool(raw.get("measured", False)),
                    suggested_slots=int(raw.get("suggestedSlots", 1)),
                    probed_at=raw.get("probedAt"),
                )
            )
        return records

    def head(self, worktree: str) -> str:
        return self.run(["git", "-C", worktree, "rev-parse", "HEAD"]).strip()

    def branch(self, worktree: str) -> str | None:
        try:
            return self.run(
                ["git", "-C", worktree, "symbolic-ref", "--quiet", "--short", "HEAD"]
            ).strip()
        except WorldError:
            return None  # Detached HEAD.

    def is_clean(self, worktree: str) -> bool:
        return self.run(["git", "-C", worktree, "status", "--porcelain"]).strip() == ""


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(UTC)


class LocalMachine:
    """This machine. Its id is its own name, which a recreated T3 Code environment keeps."""

    def __init__(self, run: Run | None = None) -> None:
        self.run = run or make_runner(os.getcwd())

    def id(self) -> str:
        if sys.platform == "win32" and os.environ.get("COMPUTERNAME"):
            return os.environ["COMPUTERNAME"]
        if sys.platform == "darwin":
            return self.run(["scutil", "--get", "LocalHostName"]).strip()
        return socket.gethostname().split(".")[0]

    def cores(self) -> int:
        return os.cpu_count() or 1

    def memory_gb(self) -> float:
        return self._memory()[0] / GIB

    def free_memory_gb(self) -> float:
        return self._memory()[1] / GIB

    def free_disk_gb(self, path: str) -> float:
        return shutil.disk_usage(path).free / GIB

    def _memory(self) -> tuple[int, int]:
        """Total and available bytes."""
        if sys.platform == "win32":
            return _windows_memory()
        if sys.platform == "darwin":
            total = int(self.run(["sysctl", "-n", "hw.memsize"]).strip())
            return total, _darwin_available(self.run(["vm_stat"]))
        info = dict(
            line.split(":", 1)
            for line in Path("/proc/meminfo").read_text().splitlines()
            if ":" in line
        )
        kib = lambda key: int(info[key].split()[0]) * 1024  # noqa: E731
        return kib("MemTotal"), kib("MemAvailable")


def _windows_memory() -> tuple[int, int]:
    import ctypes

    class MemoryStatus(ctypes.Structure):
        _fields_ = [
            ("dwLength", ctypes.c_ulong),
            ("dwMemoryLoad", ctypes.c_ulong),
            ("ullTotalPhys", ctypes.c_ulonglong),
            ("ullAvailPhys", ctypes.c_ulonglong),
            ("ullTotalPageFile", ctypes.c_ulonglong),
            ("ullAvailPageFile", ctypes.c_ulonglong),
            ("ullTotalVirtual", ctypes.c_ulonglong),
            ("ullAvailVirtual", ctypes.c_ulonglong),
            ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
        ]

    status = MemoryStatus()
    status.dwLength = ctypes.sizeof(MemoryStatus)
    if not _kernel32().GlobalMemoryStatusEx(ctypes.byref(status)):
        raise WorldError("GlobalMemoryStatusEx failed")
    return status.ullTotalPhys, status.ullAvailPhys


def _darwin_available(vm_stat: str) -> int:
    lines = vm_stat.splitlines()
    page = int(lines[0].split("page size of")[1].split()[0]) if lines else 4096
    pages = {}
    for line in lines[1:]:
        if ":" in line:
            key, value = line.split(":", 1)
            pages[key.strip()] = int(value.strip().rstrip(".") or 0)
    free = sum(pages.get(key, 0) for key in ("Pages free", "Pages inactive", "Pages speculative"))
    return free * page


class T3Plans:
    """Plans from T3 Code's provider caches: each weekly usage window is one plan.

    A cache (``~/.t3/caches/<provider>.json``) lists ``usageLimits.windows`` with the share used
    and when the window resets; the share elapsed follows from the window's length and the clock.
    """

    def __init__(self, clock, caches: Path | None = None) -> None:
        self.clock = clock
        self.caches = caches or Path.home() / ".t3" / "caches"

    def read(self) -> list[Plan]:
        try:
            files = sorted(self.caches.glob("*.json"))
        except OSError as exc:
            raise WorldError(f"Cannot list T3 Code's caches: {exc}") from exc
        plans = []
        now = self.clock.now()
        for path in files:
            try:
                usage = json.loads(path.read_text(encoding="utf-8")).get("usageLimits") or {}
            except (OSError, ValueError, AttributeError):
                continue  # One unreadable provider cache does not hide the others.
            for window in usage.get("windows") or []:
                if window.get("kind") != "weekly" or not window.get("resetsAt"):
                    continue
                length = float(window.get("windowDurationMins") or 10080) * 60
                left = (parse_time(window["resetsAt"]) - now).total_seconds()
                elapsed = min(100.0, max(0.0, 100 * (length - left) / length))
                plans.append(
                    Plan(
                        f"{path.stem}:{window['id']}",
                        path.stem,
                        float(window.get("usedPercent", 0)),
                        round(elapsed, 1),
                        window["resetsAt"],
                    )
                )
        if not plans:
            raise WorldError(f"No weekly plan windows in T3 Code's caches ({self.caches})")
        return plans


class OsProcesses:
    def alive(self, pid: int, started_at: float | None = None) -> bool:
        if not _exists(pid):
            return False
        if started_at is None:
            return True
        actual = self.start_time(pid)
        return actual is None or abs(actual - started_at) < 2

    def start_time(self, pid: int) -> float | None:
        with contextlib.suppress(OSError, ValueError, IndexError, AttributeError):
            if sys.platform == "win32":
                return _windows_start_time(pid)
            if Path(f"/proc/{pid}/stat").exists():
                fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
                boot = next(
                    float(line.split()[1])
                    for line in Path("/proc/stat").read_text().splitlines()
                    if line.startswith("btime")
                )
                return boot + int(fields[19]) / os.sysconf("SC_CLK_TCK")
        return None

    def run(self, args: Sequence[str], cwd: str, timeout: float | None = None) -> Completed:
        return run_process(args, cwd=cwd, timeout=timeout)


def _kernel32():
    import ctypes

    return ctypes.WinDLL("kernel32", use_last_error=True)


def _exists(pid: int) -> bool:
    if sys.platform == "win32":
        import ctypes

        kernel32 = _kernel32()
        handle = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return ctypes.get_last_error() == 5  # Access denied: it exists.
        try:
            code = ctypes.c_ulong()
            kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
            return code.value == 259  # STILL_ACTIVE
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _windows_start_time(pid: int) -> float | None:
    import ctypes

    kernel32 = _kernel32()
    handle = kernel32.OpenProcess(0x1000, False, pid)
    if not handle:
        return None
    try:
        times = [ctypes.c_ulonglong() for _ in range(4)]
        if not kernel32.GetProcessTimes(handle, *map(ctypes.byref, times)):
            return None
        return times[0].value / 1e7 - 11644473600  # FILETIME (100 ns since 1601) to epoch.
    finally:
        kernel32.CloseHandle(handle)


def real_world(target: Path, *, caches: Path | None = None) -> World:
    """The world for a repository checked out at ``target``."""
    run = make_runner(str(target))
    clock = SystemClock()
    return World(
        github=GhGitHub(run),
        git=CliGit(run),
        clock=clock,
        machine=LocalMachine(run),
        plans=T3Plans(clock, caches),
        processes=OsProcesses(),
    )
