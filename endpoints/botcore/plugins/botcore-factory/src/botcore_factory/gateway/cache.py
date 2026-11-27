"""The gateway's shared cache of GitHub's repository scans.

``claim-list``, ``gateway-audit`` and ``gateway-wait`` read every open issue or pull request in a
repository (and the most recently closed ones): many GraphQL pages and seconds per call. Through
``CachedGitHub`` callers within ``cache.graphqlSeconds`` of one another share one scan, and
callers that arrive while it runs wait for it instead of starting their own.

Only the scans read through ``cached_issues`` and ``cached_pulls`` are cached; every other read,
and the plain ``issues`` and ``pulls`` that writes rely on (de-duplication, an open pull request
for a branch), goes to GitHub as before, and a plain scan refreshes the cache with what it read.
Any write made through the port drops its repository's scans, whether it succeeded or not, so
the gateway never serves its own write's past. A write made outside the gateway shows up when
the entry expires.
"""

from __future__ import annotations

import copy
import threading
import time
from collections.abc import Callable
from typing import Any

from botcore_factory.gateway.github import GitHub

#: The port's methods that change GitHub; each drops its repository's cached scans.
WRITES = frozenset(
    {
        "set_labels",
        "add_comment",
        "create_issue",
        "set_issue_type",
        "add_sub_issue",
        "remove_sub_issue",
        "update_ref",
        "create_pull",
        "update_pull",
        "merge_pull",
        "enable_auto_merge",
        "disable_auto_merge",
        "enqueue_pull",
        "dequeue_pull",
        "create_revert",
        "create_check_run",
        "set_variable",
    }
)


class _Entry:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.value: list[dict[str, Any]] | None = None
        #: When the scan that read ``value`` started: its data is at least that old.
        self.at = 0.0
        #: Bumped by every write to the repository; a scan it overtook is not kept.
        self.generation = 0
        #: Bumped by every scan ``_cached`` finishes, and that scan's failure, if it failed,
        #: so the callers that queued behind it share its outcome instead of each retrying.
        self.round = 0
        self.failure: Exception | None = None


class CachedGitHub:
    """A ``GitHub`` port whose repository scans are shared for ``seconds``; 0 turns it off."""

    def __init__(
        self, inner: GitHub, seconds: float, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self.inner = inner
        self.seconds = seconds
        self._clock = clock
        self._entries: dict[tuple[str, str], _Entry] = {}
        self._lock = threading.Lock()

    def __getattr__(self, name: str) -> Any:
        found = getattr(self.inner, name)
        if name not in WRITES or not callable(found):
            return found

        def write(repo: str, *args: Any, **kwargs: Any) -> Any:
            try:
                return found(repo, *args, **kwargs)
            finally:
                self.forget(repo)

        return write

    # ── scans ─────────────────────────────────────────────────────────────

    def issues(self, repo: str) -> list[dict[str, Any]]:
        return self._fresh("issues", repo)

    def pulls(self, repo: str) -> list[dict[str, Any]]:
        return self._fresh("pulls", repo)

    def cached_issues(self, repo: str) -> list[dict[str, Any]]:
        """Every issue ``issues`` returns, as read at most ``seconds`` ago."""
        return self._cached("issues", repo)

    def cached_pulls(self, repo: str) -> list[dict[str, Any]]:
        """Every pull request ``pulls`` returns, as read at most ``seconds`` ago."""
        return self._cached("pulls", repo)

    def forget(self, repo: str | None = None) -> None:
        """Drop the cached scans of ``repo``, or of every repository."""
        with self._lock:
            for (_kind, cached_repo), entry in self._entries.items():
                if repo is None or cached_repo == repo:
                    entry.generation += 1
                    entry.value = None

    def refresh(self, repo: str | None = None) -> None:
        """Read ``repo`` (every repository, without one) from GitHub on its next scan, as a
        poll that waited must (``gateway-wait``). Waiters that refresh before one scan starts
        share it; a scan already running when a waiter refreshes may predate what it waits
        for, so it is not kept."""
        self.forget(repo)
        inner = getattr(self.inner, "refresh", None)
        if callable(inner):
            inner()

    def _entry(self, kind: str, repo: str) -> _Entry:
        with self._lock:
            return self._entries.setdefault((kind, repo), _Entry())

    def _read(self, kind: str, repo: str) -> list[dict[str, Any]]:
        scan: Callable[[str], list[dict[str, Any]]] = getattr(self.inner, kind)
        return scan(repo)

    def _fresh(self, kind: str, repo: str) -> list[dict[str, Any]]:
        entry = self._entry(kind, repo)
        with self._lock:
            generation, started = entry.generation, self._clock()
        value = self._read(kind, repo)
        self._store(entry, generation, started, value)
        return _copy(value)

    def _cached(self, kind: str, repo: str) -> list[dict[str, Any]]:
        if self.seconds <= 0:
            return self._read(kind, repo)
        entry = self._entry(kind, repo)
        with self._lock:
            arrived = entry.round
        with entry.lock:  # One scan at a time per repository and kind; the rest wait for it.
            with self._lock:
                value, at, generation = entry.value, entry.at, entry.generation
                failure = entry.failure if entry.round != arrived else None
                started = self._clock()
            if value is not None and started - at < self.seconds:
                return _copy(value)
            if failure is not None:
                raise failure  # The scan this caller waited for failed; it would again.
            try:
                value = self._read(kind, repo)
            except Exception as exc:
                with self._lock:
                    entry.round, entry.failure = entry.round + 1, exc
                raise
            with self._lock:
                entry.round, entry.failure = entry.round + 1, None
            self._store(entry, generation, started, value)
            return _copy(value)

    def _store(
        self, entry: _Entry, generation: int, started: float, value: list[dict[str, Any]]
    ) -> None:
        with self._lock:
            # A write that landed while the scan ran makes the scan older than the write, and a
            # scan that started before the one stored is older than it.
            if entry.generation == generation and started >= entry.at:
                entry.value, entry.at = value, started


def _copy(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """A copy each caller may change: the commands add keys to what they read."""
    return copy.deepcopy(items)
