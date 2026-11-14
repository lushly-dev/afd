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
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path

from botcore_factory.claims import parse_time
from botcore_factory.real_run import Run, make_runner, resolve_program, run_process
from botcore_factory.world import Completed, Plan, WorldError

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
        return shutil.disk_usage(path).free / GIB

    def has_program(self, name: str) -> bool:
        return shutil.which(name) is not None

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

    def tool_version(self, tool: str) -> str | None:
        if not self.has_program(tool):
            return None
        try:
            out = self.run([tool, "--version"]).strip()
        except WorldError:
            return None
        match = _VERSION.search(out)
        return match[0] if match else out or None

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

    def run(
        self,
        args: Sequence[str],
        cwd: str,
        timeout: float | None = None,
        *,
        label: str | None = None,
    ) -> Completed:
        return run_process(args, cwd=cwd, timeout=timeout)

    def __init__(self) -> None:
        self._running: dict[str, tuple[subprocess.Popen, str, tuple[str, ...]]] = {}

    def start(self, args: Sequence[str], cwd: str, log: str, *, label: str) -> str:
        """A background child (the lane's validations), its output appended to ``log``."""
        Path(log).parent.mkdir(parents=True, exist_ok=True)
        with open(log, "ab") as output:
            try:
                child = subprocess.Popen(  # noqa: S603 - an argument list, no shell
                    [resolve_program(args[0]), *args[1:]],
                    cwd=cwd,
                    stdout=output,
                    stderr=subprocess.STDOUT,
                    stdin=subprocess.DEVNULL,
                )
            except OSError as exc:
                raise WorldError(f"{args[0]} could not start: {exc}") from exc
        handle = str(child.pid)
        self._running[handle] = (child, log, tuple(args))
        return handle

    def poll(self, handle: str) -> Completed | None:
        if handle not in self._running:  # Started by a lane process that has since gone.
            raise WorldError(f"No run {handle} in this process")
        child, log, args = self._running[handle]
        code = child.poll()
        if code is None:
            return None
        del self._running[handle]
        return Completed(args, code, _tail(log), "")

    def kill(self, handle: str) -> None:
        entry = self._running.pop(handle, None)
        if entry is not None:
            entry[0].kill()
            entry[0].wait()
        elif handle.isdigit():  # Another process's run: the handle is its pid.
            self.terminate(int(handle))

    def start_detached(self, args: Sequence[str], cwd: str, log: str) -> int:
        Path(log).parent.mkdir(parents=True, exist_ok=True)
        options: dict = {}
        if sys.platform == "win32":
            options["creationflags"] = (
                subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
            )
        else:
            options["start_new_session"] = True
        with open(log, "ab") as output:
            try:
                child = subprocess.Popen(  # noqa: S603 - an argument list, no shell
                    [resolve_program(args[0]), *args[1:]],
                    cwd=cwd,
                    stdout=output,
                    stderr=subprocess.STDOUT,
                    stdin=subprocess.DEVNULL,
                    **options,
                )
            except OSError as exc:
                raise WorldError(f"{args[0]} could not start: {exc}") from exc
        return child.pid

    def terminate(self, pid: int) -> None:
        if sys.platform == "win32":
            kernel32 = _kernel32()
            handle = kernel32.OpenProcess(0x0001, False, pid)  # PROCESS_TERMINATE
            if handle:
                try:
                    kernel32.TerminateProcess(handle, 1)
                finally:
                    kernel32.CloseHandle(handle)
            return
        with contextlib.suppress(ProcessLookupError):
            os.kill(pid, 15)  # SIGTERM


def _tail(log: str, lines: int = 200) -> str:
    try:
        return "\n".join(
            Path(log).read_text(encoding="utf-8", errors="replace").splitlines()[-lines:]
        )
    except OSError:
        return ""


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
