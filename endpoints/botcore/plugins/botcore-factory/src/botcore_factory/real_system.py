"""This machine as it is: the system clock, its capacity, T3 Code's plan caches, and its
processes (liveness, background runs and the detached lane)."""

from __future__ import annotations

import contextlib
import json
import os
import re
import shutil
import socket
import subprocess
import sys
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from botcore_factory.claims import format_time, parse_time
from botcore_factory.real_run import Run, make_runner, path_env, resolve_program, run_process
from botcore_factory.world import TAIL_LINES, Clock, Completed, Plan, WorldError, nvmrc_version

GIB = 1024**3
_VERSION = re.compile(r"\d+\.\d+\.\d+")


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
        """Free space on the volume that holds ``path``, or would: its nearest existing parent
        (the lane's slots directory exists only once a slot was prepared)."""
        where = Path(path).absolute()
        while not where.exists() and where.parent != where:
            where = where.parent
        return shutil.disk_usage(where).free / GIB

    def is_dir(self, path: str) -> bool:
        return Path(path).is_dir()

    def has_program(self, name: str) -> bool:
        return shutil.which(name) is not None

    def disk_warnings(self) -> list[str]:
        """botcore's disk-status warnings: read from its state files, so nothing is scanned."""
        try:
            from botcore.commands.disk.setup import disk_warnings
        except ImportError:  # a botcore from before the disk commands
            return []
        try:
            return disk_warnings()
        except (OSError, ValueError):
            return []

    def symlinks(self) -> bool:
        """Try one: Windows refuses without Developer Mode (or elevation)."""
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            target, link = Path(directory, "target"), Path(directory, "link")
            target.write_text("x")
            try:
                link.symlink_to(target)
            except OSError:
                return False
        return True

    def tool_version(self, tool: str, path: Sequence[str] = ()) -> str | None:
        env = path_env(path)
        if shutil.which(tool, path=env["PATH"] if env else None) is None:
            return None
        try:
            if env is None:
                out = self.run([tool, "--version"]).strip()
            else:  # Found and run on the PATH a job step gets, ``path`` first.
                done = run_process([tool, "--version"], env=env)
                if done.returncode != 0:
                    return None
                out = done.stdout.strip()
        except WorldError:
            return None
        match = _VERSION.search(out)
        return match[0] if match else out or None

    def node_bin(self, spec: str) -> str | None:
        return find_node_bin(spec, node_roots(os.environ, Path.home()))

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

        def kib(key: str) -> int:
            return int(info[key].split()[0]) * 1024

        return kib("MemTotal"), kib("MemAvailable")


def node_roots(environ: Mapping[str, str], home: Path) -> list[Path]:
    """Where fnm, nvm and nvm-windows keep the Node versions they installed, most specific
    first."""
    roots = []
    if environ.get("FNM_DIR"):
        roots.append(Path(environ["FNM_DIR"]) / "node-versions")
    if environ.get("XDG_DATA_HOME"):
        roots.append(Path(environ["XDG_DATA_HOME"]) / "fnm" / "node-versions")
    roots += [
        home / ".local" / "share" / "fnm" / "node-versions",
        home / "Library" / "Application Support" / "fnm" / "node-versions",
        home / ".fnm" / "node-versions",
    ]
    if environ.get("APPDATA"):
        roots.append(Path(environ["APPDATA"]) / "fnm" / "node-versions")
    if environ.get("NVM_DIR"):
        roots.append(Path(environ["NVM_DIR"]) / "versions" / "node")
    roots.append(home / ".nvm" / "versions" / "node")
    return roots + _nvm_windows_roots(environ)


def _nvm_windows_roots(environ: Mapping[str, str]) -> list[Path]:
    """nvm-windows keeps each version as ``<root>/v<version>``: ``NVM_HOME``, the directory
    holding the version its ``NVM_SYMLINK`` points at, and its default under ``APPDATA``."""
    roots = []
    if environ.get("NVM_HOME"):
        roots.append(Path(environ["NVM_HOME"]))
    if environ.get("NVM_SYMLINK"):
        with contextlib.suppress(OSError, RuntimeError):
            link = Path(environ["NVM_SYMLINK"])
            os.readlink(link)  # A symlink or a junction; anything else raises OSError.
            roots.append(link.resolve().parent)
    if environ.get("APPDATA"):
        roots.append(Path(environ["APPDATA"]) / "nvm")
    return list(dict.fromkeys(roots))  # The symlink usually points into NVM_HOME: once each.


def find_node_bin(spec: str, roots: Sequence[Path]) -> str | None:
    """The bin directory of the newest installed Node whose version starts with ``spec``'s
    numbers (``26`` matches ``v26.13.0``, not ``v260.0.0``). An alias (``lts/*``) matches none."""
    wanted = nvmrc_version(spec)
    if wanted is None:
        return None
    prefix = tuple(int(part) for part in wanted.split("."))
    executable = "node.exe" if sys.platform == "win32" else "node"
    found: list[tuple[tuple[int, ...], int, str]] = []
    for rank, root in enumerate(roots):
        with contextlib.suppress(OSError):
            for entry in root.iterdir():
                match = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)", entry.name)
                if not match:
                    continue
                version = tuple(int(part) for part in match.groups())
                if version[: len(prefix)] != prefix:
                    continue
                # fnm: <version>/installation/bin (Windows: installation/); nvm: <version>/bin;
                # nvm-windows: <version>/ itself.
                for candidate in (
                    entry / "installation" / "bin",
                    entry / "installation",
                    entry / "bin",
                    entry,
                ):
                    if (candidate / executable).is_file():
                        found.append((version, -rank, str(candidate)))
                        break
    return max(found)[2] if found else None  # Newest; a tie goes to the earlier root.


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

    A cache (``~/.t3/caches/<instance>.json``) lists ``usageLimits.windows`` with the share used
    and when the window resets; the share elapsed follows from the window's length and the clock.
    The provider is the cache's ``driver`` (an instance's file is named after the instance, as
    ``claudeAgent_2``), else the file's name. A window that has reset since the cache was checked,
    or whose cache was checked longer ago than the window lasts, is stale: T3 Code no longer
    refreshes it (a removed instance leaves its file behind), so its figures say nothing about
    the plan now (lushly-dev/afd#2691).
    """

    def __init__(self, clock: Clock, caches: Path | None = None) -> None:
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
                cache = json.loads(path.read_text(encoding="utf-8"))
                usage = cache.get("usageLimits") or {}
                provider = str(cache.get("driver") or path.stem)
                checked = _checked_at(usage.get("checkedAt")) or _checked_at(cache.get("checkedAt"))
            except (OSError, ValueError, AttributeError):
                continue  # One unreadable provider cache does not hide the others.
            for window in usage.get("windows") or []:
                if window.get("kind") != "weekly" or not window.get("resetsAt"):
                    continue
                # Claude's Fable window is a limit only Fable draws on, inside the plan's main
                # weekly window; it is not a plan a cell starts on.
                if str(window.get("id", "")).endswith("_fable"):
                    continue
                length = float(window.get("windowDurationMins") or 10080) * 60
                left = (parse_time(window["resetsAt"]) - now).total_seconds()
                elapsed = min(100.0, max(0.0, 100 * (length - left) / length))
                plans.append(
                    Plan(
                        f"{path.stem}:{window['id']}",
                        provider,
                        float(window.get("usedPercent", 0)),
                        round(elapsed, 1),
                        window["resetsAt"],
                        _stale(window["resetsAt"], left, checked, length, now),
                    )
                )
        if not plans:
            raise WorldError(f"No weekly plan windows in T3 Code's caches ({self.caches})")
        return plans


def _checked_at(value: object) -> datetime | None:
    """When T3 Code last checked a cache's usage, or None when the cache does not say."""
    if not isinstance(value, str):
        return None
    try:
        return parse_time(value)
    except ValueError:
        return None


def _stale(
    resets_at: str, left: float, checked: datetime | None, length: float, now: datetime
) -> str | None:
    """Why a window's figures are out of date, or None while they still describe it."""
    if left <= 0:
        return f"the window reset at {resets_at} and its cache still holds the old figures"
    if checked is not None and (now - checked).total_seconds() > length:
        return f"its cache was last checked at {format_time(checked)}, longer ago than the window"
    return None


class OsProcesses:
    """This machine's processes. Background jobs and the detached lane start in their own
    process group (POSIX: a new session), so killing one kills everything it started; nothing
    is killed unless it is still the process that started then (pid and start time)."""

    def __init__(self) -> None:
        self._running: dict[str, tuple[subprocess.Popen[bytes], str, tuple[str, ...], int]] = {}

    def alive(self, pid: int, started_at: float | None = None) -> bool:
        if not _exists(pid):
            return False
        if started_at is None:
            return True
        actual = self.start_time(pid)
        return actual is None or abs(actual - started_at) < 2

    def start_time(self, pid: int) -> float | None:
        with contextlib.suppress(OSError, ValueError, IndexError, AttributeError, WorldError):
            if sys.platform == "win32":
                return _windows_start_time(pid)
            if sys.platform == "darwin":
                return _darwin_start_time(pid)
            if Path(f"/proc/{pid}/stat").exists():
                fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
                boot = next(
                    float(line.split()[1])
                    for line in Path("/proc/stat").read_text().splitlines()
                    if line.startswith("btime")
                )
                return boot + int(fields[19]) / os.sysconf("SC_CLK_TCK")
        return None

    def run(
        self,
        args: Sequence[str],
        cwd: str,
        timeout: float | None = None,
        *,
        label: str | None = None,
    ) -> Completed:
        return run_process(args, cwd=cwd, timeout=timeout)

    def start_job(self, steps: Sequence[dict[str, Any]], cwd: str, log: str, *, label: str) -> str:
        """``python -m botcore_factory.job`` in its own group, its output appended to ``log``."""
        args = (sys.executable, "-m", "botcore_factory.job", json.dumps({"steps": list(steps)}))
        start = _size(log)  # This job's output starts here; an earlier one may precede it.
        child = _spawn(args, cwd, log, new_group())
        handle = f"{child.pid}@{self.start_time(child.pid) or ''}"
        self._running[handle] = (child, log, args, start)
        return handle

    def poll(self, handle: str) -> Completed | None:
        if handle not in self._running:  # Started by a lane process that has since gone.
            raise WorldError(f"No job {handle} in this process")
        child, log, args, start = self._running[handle]
        code = child.poll()
        if code is None:
            return None
        del self._running[handle]
        output = _read_from(log, start)  # This job's own, not an earlier job's in the log.
        tail = "\n".join(output.splitlines()[-TAIL_LINES:])
        from botcore_factory.failures import disk_full, failing_tests
        from botcore_factory.job import failure

        failed = failure(tail) if code else None
        # Every failing test, from all this job wrote: the tail misses those a long run
        # pushed out of it (lushly-dev/afd#1607).
        tests = tuple(failing_tests(output)) if code else None
        full = disk_full(output) if code else None
        return Completed(args, code, tail, "", (failed or {}).get("failed"), tests, full)

    def kill(self, handle: str) -> None:
        entry = self._running.pop(handle, None)
        pid, _, started = handle.partition("@")
        if entry is not None:
            kill_tree(entry[0].pid)
            entry[0].wait()
        elif pid.isdigit() and started:  # Another process's job: only if it is still that job.
            self.terminate(int(pid), float(started))

    def start_detached(self, args: Sequence[str], cwd: str, log: str) -> int:
        options: dict[str, Any] = {}
        if sys.platform == "win32":
            options["creationflags"] = (
                subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
            )
        else:
            options["start_new_session"] = True
        return _spawn(args, cwd, log, options).pid

    def terminate(self, pid: int, started_at: float | None) -> bool:
        if started_at is None:
            return False  # Unverifiable: never kill what might be another process.
        actual = self.start_time(pid)
        if actual is None or abs(actual - started_at) >= 2:
            return False
        kill_tree(pid)
        return True


def new_group() -> dict[str, Any]:
    """Popen options that start a process in its own group, to kill as a tree."""
    if sys.platform == "win32":
        return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    return {"start_new_session": True}


def kill_tree(pid: int) -> None:
    """Kill ``pid`` and everything it started, including steps in separate sessions."""
    if sys.platform == "win32":
        with contextlib.suppress(WorldError):
            run_process([resolve_program("taskkill"), "/T", "/F", "/PID", str(pid)], timeout=60)
        return
    # Job steps get their own session so each timeout can kill its step's group. Capture
    # their parentage before killing the wrapper; a group-only kill would orphan them.
    table = run_process(["ps", "-A", "-o", "pid=,ppid="])
    if table.returncode:
        raise WorldError(f"Cannot read the process tree for {pid}: {table.stderr}")
    parents = {
        int(parts[0]): int(parts[1])
        for line in table.stdout.splitlines()
        if len(parts := line.split()) == 2
    }
    descendants = [pid]
    for parent in descendants:
        descendants.extend(
            child for child, ppid in parents.items() if ppid == parent and child not in descendants
        )
    for child in descendants:
        with contextlib.suppress(ProcessLookupError, PermissionError):
            if os.getpgid(child) == child:
                os.killpg(child, 9)
            else:
                os.kill(child, 9)


def _spawn(
    args: Sequence[str], cwd: str, log: str, options: dict[str, Any]
) -> subprocess.Popen[bytes]:
    Path(log).parent.mkdir(parents=True, exist_ok=True)
    with open(log, "ab") as output:
        try:
            return subprocess.Popen(  # noqa: S603 - an argument list, no shell
                [resolve_program(args[0]), *args[1:]],
                cwd=cwd,
                stdout=output,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                **options,
            )
        except OSError as exc:
            raise WorldError(f"{args[0]} could not start: {exc}") from exc


def _darwin_start_time(pid: int) -> float | None:
    """``ps -o lstart=`` in UTC/C locale: the start to the second, matching Node's ``ps`` probe."""
    import calendar
    import time

    env = {**os.environ, "TZ": "UTC", "LC_ALL": "C"}
    out = run_process(["ps", "-o", "lstart=", "-p", str(pid)], env=env).stdout.strip()
    if not out:
        return None
    return float(calendar.timegm(time.strptime(" ".join(out.split()), "%a %b %d %H:%M:%S %Y")))


def _size(log: str) -> int:
    try:
        return Path(log).stat().st_size
    except OSError:
        return 0


def _read_from(log: str, start: int) -> str:
    try:
        with Path(log).open("rb") as handle:
            handle.seek(start)
            return handle.read().decode("utf-8", errors="replace")
    except OSError:
        return ""


def _kernel32() -> Any:
    if sys.platform != "win32":
        raise WorldError("kernel32 is only available on Windows")
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
    if sys.platform == "darwin":
        # kill(pid, 0) also succeeds for a zombie. A detached child's Popen may have
        # gone out of scope, so it can await reaping even after its group was killed.
        state = run_process(["ps", "-o", "stat=", "-p", str(pid)]).stdout.strip()
        return bool(state) and not state.startswith("Z")
    if sys.platform.startswith("linux"):
        try:
            state = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[0]
            return state != "Z"
        except FileNotFoundError:
            return False
        except (OSError, IndexError):
            pass  # Unreadable state does not prove death.
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
