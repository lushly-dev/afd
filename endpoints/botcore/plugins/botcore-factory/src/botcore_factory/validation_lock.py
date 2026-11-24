"""The shared host validation lock across AFD's factory lane and Lushly's script lane.

Both lane daemons keep their own daemon ``lane.lock`` so they can stay running concurrently on
one machine (polling PRs, merge queues and events), and serialize heavy host work (AFD branch
validations and base coverage; Lushly ``pnpm validate:final`` and ``pnpm validate:coverage``)
through one cross-language JSON state file guarded by a short-lived exclusive mutex:

- Default directory: ``~/.cache/lushly-factory/`` (identical from Python ``Path.home()`` and
  Node ``os.homedir()`` on macOS, Linux and Windows; overridden by
  ``LUSHLY_FACTORY_HOST_LOCK_DIR``).
- State file: ``validation-lock.json`` (schema ``version: 1``).
- Mutex file: ``validation-lock.mutex`` (``O_CREAT | O_EXCL``, held only for read-modify-write +
  atomic rename, released only on matching ``nonce``, broken by renaming aside before unlink).

Liveness uses integer UTC Unix epoch seconds (``startedAtEpoch``) through the world's
``Processes``. A hold is live while either the owner lane process or the hold's validation child
(``jobPid``, ``jobStartedAtEpoch``) is alive; once both are dead and no live holds remain,
``owner`` is cleared automatically. Waiters are FIFO with explicit withdrawal and a heartbeat TTL
(``WAITER_TTL_SECONDS``), so a waiting lane prevents starvation without deadlocking if it pauses
or crashes. Corrupt state or a timed-out live mutex fails closed by raising ``WorldError``.
"""

from __future__ import annotations

import contextlib
import copy
import json
import os
import time
import uuid
from collections.abc import Callable, Iterator, Mapping, Sequence
from datetime import datetime
from pathlib import Path
from typing import Any, TypeVar

from botcore_factory.claims import format_time, parse_time
from botcore_factory.state import _replace
from botcore_factory.world import Clock, Processes, WorldError

_T = TypeVar("_T")

LOCK_VERSION = 1
LOCK_DIR_ENV = "LUSHLY_FACTORY_HOST_LOCK_DIR"
LOCK_FILENAME = "validation-lock.json"
MUTEX_FILENAME = "validation-lock.mutex"
DEFAULT_LANE = "botcore-factory"
#: How long an empty or unreadable mutex counts as being written rather than abandoned.
WRITING_GRACE_SECONDS = 5.0
#: A waiter stops blocking the current owner once it stops polling for this long.
WAITER_TTL_SECONDS = 30.0
#: How long to wait on a live mutex before failing closed.
MUTEX_TIMEOUT_SECONDS = 30.0
#: Tolerance (seconds) when comparing integer UTC process start epochs across Python and Node.
EPOCH_TOLERANCE_SECONDS = 2


def default_lock_dir(env: Mapping[str, str] | None = None) -> Path:
    source: Mapping[str, str] = os.environ if env is None else env
    override = source.get(LOCK_DIR_ENV)
    if override:
        return Path(override)
    return Path.home() / ".cache" / "lushly-factory"


def empty_lock_state() -> dict[str, Any]:
    return {"version": LOCK_VERSION, "owner": None, "waiters": []}


def parse_job_handle(handle: str) -> tuple[int | None, float | None]:
    """Extract ``(pid, started_at)`` from an ``OsProcesses.start_job`` handle (``pid@started``)."""
    pid_text, sep, started_text = handle.partition("@")
    if not sep or not pid_text.isdigit():
        return None, None
    try:
        started = float(started_text) if started_text else None
    except ValueError:
        started = None
    return int(pid_text), started


def _epoch(value: float | None) -> int | None:
    return int(round(value)) if value is not None else None


def _is_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_alive(processes: Processes, pid: object, started_at_epoch: object) -> bool:
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
        return False
    started: float | None = None
    if isinstance(started_at_epoch, (int, float)) and not isinstance(started_at_epoch, bool):
        started = float(started_at_epoch)
    return processes.alive(pid, started)


def _same_lane(
    entry: dict[str, Any], lane: str, repository: str, pid: int, started_epoch: int | None
) -> bool:
    if (
        entry.get("lane") != lane
        or entry.get("repository") != repository
        or entry.get("pid") != pid
    ):
        return False
    recorded = entry.get("startedAtEpoch")
    if isinstance(recorded, int) and not isinstance(recorded, bool) and started_epoch is not None:
        return abs(recorded - started_epoch) <= EPOCH_TOLERANCE_SECONDS
    return True


def validate_lock_state(raw: object, source: str) -> dict[str, Any]:
    """Validate and normalize a decoded ``validation-lock.json`` object; fail closed on bad data."""
    if not isinstance(raw, dict):
        raise WorldError(f"Host validation lock at {source} is not a JSON object")
    if not _is_int(raw.get("version")) or raw.get("version") != LOCK_VERSION:
        raise WorldError(
            f"Host validation lock at {source} has unsupported version {raw.get('version')!r}"
        )
    owner = raw.get("owner")
    if owner is not None:
        if not isinstance(owner, dict):
            raise WorldError(f"Host validation lock at {source} has an invalid owner entry")
        holds = owner.get("holds")
        if not isinstance(holds, list) or any(not isinstance(h, dict) for h in holds):
            raise WorldError(f"Host validation lock at {source} has an invalid owner.holds list")
    waiters = raw.get("waiters", [])
    if not isinstance(waiters, list) or any(not isinstance(w, dict) for w in waiters):
        raise WorldError(f"Host validation lock at {source} has an invalid waiters list")
    return {
        "version": LOCK_VERSION,
        "owner": copy.deepcopy(owner),
        "waiters": copy.deepcopy(waiters),
    }


def prune_lock_state(
    data: dict[str, Any],
    processes: Processes,
    now: datetime,
    *,
    waiter_ttl: float = WAITER_TTL_SECONDS,
) -> dict[str, Any]:
    """Drop dead holds, dead owners (once all job PIDs are gone), and dead or expired waiters."""
    state = copy.deepcopy(data)
    owner = state.get("owner")
    if isinstance(owner, dict):
        lane_alive = _is_alive(processes, owner.get("pid"), owner.get("startedAtEpoch"))
        holds = owner.get("holds") or []
        if lane_alive:
            live_holds = list(holds)
        else:
            live_holds = [
                hold
                for hold in holds
                if hold.get("jobPid") is not None
                and _is_alive(processes, hold.get("jobPid"), hold.get("jobStartedAtEpoch"))
            ]
        if live_holds:
            owner["holds"] = live_holds
        else:
            state["owner"] = None

    live_waiters: list[dict[str, Any]] = []
    for waiter in state.get("waiters") or []:
        if not _is_alive(processes, waiter.get("pid"), waiter.get("startedAtEpoch")):
            continue
        stamp = waiter.get("refreshedAt") or waiter.get("enqueuedAt")
        if not isinstance(stamp, str) or not stamp:
            continue
        try:
            refreshed = parse_time(stamp)
        except ValueError:
            continue
        if (now - refreshed).total_seconds() <= waiter_ttl:
            live_waiters.append(waiter)
    state["waiters"] = live_waiters
    return state


def _blocker_for(
    state: dict[str, Any], lane: str, repository: str, pid: int, started_epoch: int | None
) -> dict[str, Any] | None:
    """Deterministic blocker summary when ``(lane, repository, pid)`` may not take a new hold."""
    owner = state.get("owner")
    if isinstance(owner, dict) and not _same_lane(owner, lane, repository, pid, started_epoch):
        return {
            "lane": owner.get("lane"),
            "repository": owner.get("repository"),
            "pid": owner.get("pid"),
            "acquiredAt": owner.get("acquiredAt"),
        }
    waiters = state.get("waiters") or []
    if waiters and not _same_lane(waiters[0], lane, repository, pid, started_epoch):
        head = waiters[0]
        return {
            "lane": head.get("lane"),
            "repository": head.get("repository"),
            "pid": head.get("pid"),
            "enqueuedAt": head.get("enqueuedAt"),
        }
    return None


def _upsert_waiter(
    state: dict[str, Any],
    lane: str,
    repository: str,
    pid: int,
    started_epoch: int | None,
    now_str: str,
) -> None:
    """Register or refresh this lane in ``waiters`` unless it is already the current ``owner``."""
    owner = state.get("owner")
    if isinstance(owner, dict) and _same_lane(owner, lane, repository, pid, started_epoch):
        return
    waiters = state.setdefault("waiters", [])
    for waiter in waiters:
        if _same_lane(waiter, lane, repository, pid, started_epoch):
            waiter["refreshedAt"] = now_str
            return
    waiters.append(
        {
            "lane": lane,
            "repository": repository,
            "pid": pid,
            "startedAtEpoch": started_epoch,
            "enqueuedAt": now_str,
            "refreshedAt": now_str,
        }
    )


def _remove_waiter(
    state: dict[str, Any], lane: str, repository: str, pid: int, started_epoch: int | None
) -> None:
    state["waiters"] = [
        waiter
        for waiter in state.get("waiters") or []
        if not _same_lane(waiter, lane, repository, pid, started_epoch)
    ]


def apply_check_available(
    data: dict[str, Any],
    processes: Processes,
    now: datetime,
    *,
    repository: str,
    pid: int,
    register_waiter: bool = True,
    lane: str = DEFAULT_LANE,
    waiter_ttl: float = WAITER_TTL_SECONDS,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    state = prune_lock_state(data, processes, now, waiter_ttl=waiter_ttl)
    started_epoch = _epoch(processes.start_time(pid))
    blocker = _blocker_for(state, lane, repository, pid, started_epoch)
    if blocker is not None and register_waiter:
        _upsert_waiter(state, lane, repository, pid, started_epoch, format_time(now))
    return state, blocker


def apply_try_acquire(
    data: dict[str, Any],
    processes: Processes,
    now: datetime,
    *,
    hold_id: str,
    repository: str,
    pid: int,
    lane: str = DEFAULT_LANE,
    waiter_ttl: float = WAITER_TTL_SECONDS,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    state = prune_lock_state(data, processes, now, waiter_ttl=waiter_ttl)
    started_epoch = _epoch(processes.start_time(pid))
    now_str = format_time(now)
    owner = state.get("owner")
    if (
        isinstance(owner, dict)
        and _same_lane(owner, lane, repository, pid, started_epoch)
        and any(h.get("id") == hold_id for h in owner.get("holds") or [])
    ):
        return state, None
    blocker = _blocker_for(state, lane, repository, pid, started_epoch)
    if blocker is not None:
        _upsert_waiter(state, lane, repository, pid, started_epoch, now_str)
        return state, blocker
    _remove_waiter(state, lane, repository, pid, started_epoch)
    new_hold = {"id": hold_id, "jobPid": None, "jobStartedAtEpoch": None}
    if owner is None:
        state["owner"] = {
            "lane": lane,
            "repository": repository,
            "pid": pid,
            "startedAtEpoch": started_epoch,
            "acquiredAt": now_str,
            "holds": [new_hold],
        }
    else:
        owner["holds"].append(new_hold)
    return state, None


def apply_set_job(
    data: dict[str, Any],
    processes: Processes,
    now: datetime,
    *,
    hold_id: str,
    caller: tuple[str, str, int],
    job: tuple[int | None, float | None],
    waiter_ttl: float = WAITER_TTL_SECONDS,
) -> dict[str, Any]:
    lane, repository, pid = caller
    job_pid, job_started_at = job
    state = prune_lock_state(data, processes, now, waiter_ttl=waiter_ttl)
    started_epoch = _epoch(processes.start_time(pid))
    owner = state.get("owner")
    if isinstance(owner, dict) and _same_lane(owner, lane, repository, pid, started_epoch):
        for hold in owner.get("holds") or []:
            if hold.get("id") == hold_id:
                hold["jobPid"] = job_pid
                hold["jobStartedAtEpoch"] = _epoch(job_started_at)
                break
    return state


def apply_release(
    data: dict[str, Any],
    processes: Processes,
    now: datetime,
    *,
    hold_id: str,
    repository: str,
    pid: int,
    lane: str = DEFAULT_LANE,
    waiter_ttl: float = WAITER_TTL_SECONDS,
) -> dict[str, Any]:
    state = prune_lock_state(data, processes, now, waiter_ttl=waiter_ttl)
    started_epoch = _epoch(processes.start_time(pid))
    owner = state.get("owner")
    if isinstance(owner, dict) and _same_lane(owner, lane, repository, pid, started_epoch):
        remaining = [h for h in owner.get("holds") or [] if h.get("id") != hold_id]
        if remaining:
            owner["holds"] = remaining
        else:
            state["owner"] = None
    return state


def apply_reconcile(
    data: dict[str, Any],
    processes: Processes,
    now: datetime,
    *,
    repository: str,
    pid: int,
    active_hold_ids: Sequence[str],
    lane: str = DEFAULT_LANE,
    waiter_ttl: float = WAITER_TTL_SECONDS,
) -> dict[str, Any]:
    state = prune_lock_state(data, processes, now, waiter_ttl=waiter_ttl)
    started_epoch = _epoch(processes.start_time(pid))
    owner = state.get("owner")
    if isinstance(owner, dict) and _same_lane(owner, lane, repository, pid, started_epoch):
        keep = set(active_hold_ids)
        remaining = [h for h in owner.get("holds") or [] if h.get("id") in keep]
        if remaining:
            owner["holds"] = remaining
        else:
            state["owner"] = None
    return state


def apply_withdraw_waiter(
    data: dict[str, Any],
    processes: Processes,
    now: datetime,
    *,
    repository: str,
    pid: int,
    lane: str = DEFAULT_LANE,
    waiter_ttl: float = WAITER_TTL_SECONDS,
) -> dict[str, Any]:
    state = prune_lock_state(data, processes, now, waiter_ttl=waiter_ttl)
    started_epoch = _epoch(processes.start_time(pid))
    _remove_waiter(state, lane, repository, pid, started_epoch)
    return state


class ValidationLock:
    """Filesystem-backed shared host validation lock."""

    def __init__(
        self,
        processes: Processes,
        clock: Clock,
        directory: Path | None = None,
        *,
        mutex_timeout: float = MUTEX_TIMEOUT_SECONDS,
        writing_grace: float = WRITING_GRACE_SECONDS,
        waiter_ttl: float = WAITER_TTL_SECONDS,
    ) -> None:
        self.processes = processes
        self.clock = clock
        self._directory = directory
        self.mutex_timeout = mutex_timeout
        self.writing_grace = writing_grace
        self.waiter_ttl = waiter_ttl

    @property
    def directory(self) -> Path:
        return self._directory if self._directory is not None else default_lock_dir()

    @property
    def lock_path(self) -> Path:
        return self.directory / LOCK_FILENAME

    @property
    def mutex_path(self) -> Path:
        return self.directory / MUTEX_FILENAME

    def _mutate(
        self,
        transform: Callable[[dict[str, Any], datetime], tuple[dict[str, Any], _T]],
        *,
        write_if_absent: bool = False,
    ) -> _T:
        with self._mutex():
            before = self._read()
            after, result = transform(before, self.clock.now())
            if after != before or (write_if_absent and not self.lock_path.exists()):
                self._write(after)
            return result

    def check_available(
        self,
        repository: str,
        pid: int,
        *,
        register_waiter: bool = True,
        lane: str = DEFAULT_LANE,
    ) -> dict[str, Any] | None:
        return self._mutate(
            lambda data, now: apply_check_available(
                data,
                self.processes,
                now,
                repository=repository,
                pid=pid,
                register_waiter=register_waiter,
                lane=lane,
                waiter_ttl=self.waiter_ttl,
            )
        )

    def try_acquire(
        self, hold_id: str, repository: str, pid: int, *, lane: str = DEFAULT_LANE
    ) -> dict[str, Any] | None:
        return self._mutate(
            lambda data, now: apply_try_acquire(
                data,
                self.processes,
                now,
                hold_id=hold_id,
                repository=repository,
                pid=pid,
                lane=lane,
                waiter_ttl=self.waiter_ttl,
            ),
            write_if_absent=True,
        )

    def set_job(
        self,
        hold_id: str,
        repository: str,
        pid: int,
        job_pid: int | None,
        job_started_at: float | None,
        *,
        lane: str = DEFAULT_LANE,
    ) -> None:
        self._mutate(
            lambda data, now: (
                apply_set_job(
                    data,
                    self.processes,
                    now,
                    hold_id=hold_id,
                    caller=(lane, repository, pid),
                    job=(job_pid, job_started_at),
                    waiter_ttl=self.waiter_ttl,
                ),
                None,
            )
        )

    def release(self, hold_id: str, repository: str, pid: int, *, lane: str = DEFAULT_LANE) -> None:
        self._mutate(
            lambda data, now: (
                apply_release(
                    data,
                    self.processes,
                    now,
                    hold_id=hold_id,
                    repository=repository,
                    pid=pid,
                    lane=lane,
                    waiter_ttl=self.waiter_ttl,
                ),
                None,
            )
        )

    def reconcile(
        self,
        repository: str,
        pid: int,
        active_hold_ids: Sequence[str],
        *,
        lane: str = DEFAULT_LANE,
    ) -> None:
        self._mutate(
            lambda data, now: (
                apply_reconcile(
                    data,
                    self.processes,
                    now,
                    repository=repository,
                    pid=pid,
                    active_hold_ids=active_hold_ids,
                    lane=lane,
                    waiter_ttl=self.waiter_ttl,
                ),
                None,
            )
        )

    def withdraw_waiter(self, repository: str, pid: int, *, lane: str = DEFAULT_LANE) -> None:
        self._mutate(
            lambda data, now: (
                apply_withdraw_waiter(
                    data,
                    self.processes,
                    now,
                    repository=repository,
                    pid=pid,
                    lane=lane,
                    waiter_ttl=self.waiter_ttl,
                ),
                None,
            )
        )

    def status(self) -> dict[str, Any]:
        return prune_lock_state(
            self._read(), self.processes, self.clock.now(), waiter_ttl=self.waiter_ttl
        )

    def _ensure_dir(self) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        if os.name != "nt":
            with contextlib.suppress(OSError):
                os.chmod(self.directory, 0o700)

    def _read(self) -> dict[str, Any]:
        raw_text = ""
        for attempt in range(20):
            try:
                raw_text = self.lock_path.read_text(encoding="utf-8")
                break
            except FileNotFoundError:
                return empty_lock_state()
            except PermissionError as exc:
                if attempt == 19:
                    raise WorldError(
                        f"Cannot read host validation lock {self.lock_path}: {exc}"
                    ) from exc
                time.sleep(0.05)
            except OSError as exc:
                raise WorldError(
                    f"Cannot read host validation lock {self.lock_path}: {exc}"
                ) from exc
        try:
            raw = json.loads(raw_text)
        except ValueError as exc:
            raise WorldError(
                f"Corrupt host validation lock JSON at {self.lock_path}: {exc}"
            ) from exc
        return validate_lock_state(raw, str(self.lock_path))

    def _write(self, state: dict[str, Any]) -> None:
        self._ensure_dir()
        temporary = self.directory / f"{LOCK_FILENAME}.{os.getpid()}.{uuid.uuid4().hex}.tmp"
        try:
            temporary.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
            _replace(temporary, self.lock_path)
        except OSError as exc:
            with contextlib.suppress(OSError):
                temporary.unlink()
            raise WorldError(f"Cannot write host validation lock {self.lock_path}: {exc}") from exc

    def _read_mutex(self, path: Path | None = None) -> dict[str, Any] | None:
        target = self.mutex_path if path is None else path
        try:
            data = json.loads(target.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        return data if isinstance(data, dict) else None

    def _holder_alive(self, holder: dict[str, Any]) -> bool:
        started = holder.get("startedAtEpoch")
        if started is None:
            started = holder.get("startedAt")
        return _is_alive(self.processes, holder.get("pid"), started)

    def _break_stale_mutex(self) -> bool:
        holder = self._read_mutex()
        if holder is None:
            try:
                age = time.time() - self.mutex_path.stat().st_mtime
            except FileNotFoundError:
                return True
            except OSError:
                return False
            if age < self.writing_grace:
                return False
        elif self._holder_alive(holder):
            return False
        aside = self.mutex_path.with_name(
            f"{MUTEX_FILENAME}.stale.{os.getpid()}.{uuid.uuid4().hex}"
        )
        try:
            os.rename(self.mutex_path, aside)
        except FileNotFoundError:
            return True
        except PermissionError:
            return False  # Windows: another process currently holds the handle open.
        except OSError:
            return False
        moved = self._read_mutex(aside)
        # Re-verify after rename: if another contender broke the stale mutex and created a fresh
        # live one before our rename, restore it rather than unlinking a live mutex.
        if isinstance(moved, dict) and (
            self._holder_alive(moved)
            or (holder is not None and moved.get("nonce") != holder.get("nonce"))
        ):
            if not self.mutex_path.exists():
                with contextlib.suppress(OSError):
                    os.rename(aside, self.mutex_path)
            return False
        with contextlib.suppress(OSError):
            aside.unlink()
        return True

    def _unlink_mutex_if_owned(self, nonce: str) -> None:
        """Unlink the mutex only if its nonce still matches, retrying Windows PermissionError."""
        for attempt in range(20):
            current = self._read_mutex()
            if current is None:
                if not self.mutex_path.exists():
                    return
                if attempt < 19:
                    time.sleep(0.05)
                    continue
                return
            if current.get("nonce") != nonce:
                return
            try:
                self.mutex_path.unlink()
                return
            except FileNotFoundError:
                return
            except PermissionError:
                if attempt == 19:
                    return
                time.sleep(0.05)
            except OSError:
                return

    @contextlib.contextmanager
    def _mutex(self) -> Iterator[None]:
        self._ensure_dir()
        deadline = time.monotonic() + self.mutex_timeout
        nonce = uuid.uuid4().hex
        my_pid = os.getpid()
        payload = {
            "pid": my_pid,
            "startedAtEpoch": _epoch(self.processes.start_time(my_pid)),
            "nonce": nonce,
            "acquiredAt": format_time(self.clock.now()),
        }
        while True:
            try:
                descriptor = os.open(self.mutex_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            except FileExistsError:
                if self._break_stale_mutex():
                    continue
                if time.monotonic() >= deadline:
                    holder = self._read_mutex()
                    raise WorldError(
                        f"Host validation lock mutex {self.mutex_path} timed out after "
                        f"{self.mutex_timeout:g}s (held by {holder})"
                    ) from None
                time.sleep(0.05)
                continue
            except PermissionError as exc:
                # Windows: delete-pending mutex held open by another reader (e.g. Node/libuv).
                if time.monotonic() >= deadline:
                    raise WorldError(
                        f"Host validation lock mutex {self.mutex_path} timed out after "
                        f"{self.mutex_timeout:g}s: {exc}"
                    ) from exc
                time.sleep(0.05)
                continue
            except OSError as exc:
                raise WorldError(
                    f"Cannot acquire host validation lock mutex {self.mutex_path}: {exc}"
                ) from exc
            try:
                with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                    json.dump(payload, handle)
            except OSError as exc:
                with contextlib.suppress(OSError):
                    self.mutex_path.unlink()
                raise WorldError(
                    f"Cannot write host validation lock mutex {self.mutex_path}: {exc}"
                ) from exc
            break
        try:
            yield
        finally:
            self._unlink_mutex_if_owned(nonce)
