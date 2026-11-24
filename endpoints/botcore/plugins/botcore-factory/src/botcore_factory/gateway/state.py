"""The gateway's own state, beside GitHub: small, and mostly rebuildable.

``state.json`` holds bundle uploads, review records (G2), each repository's lane's last
``lane-heartbeat`` (``lanes``), the validations the gateway recorded in the last week
(``verifications``, which decide a merge before GitHub lists their check run), each consumer's
delivered events (G3), the write log behind the write budget, and seeded audit rows a fixture
supplies. Claims are not here: GitHub holds them and every read rebuilds them. The journal is
AFD's JSON Lines journal, one file per UTC day under ``journal/``, kept for
``journal.keepDays`` (default 365).
"""

from __future__ import annotations

import json
import os
import threading
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

from afd.core.journal import (
    FileJournalSink,
    JournalEntry,
    JournalRange,
    JournalRecord,
    parse_journal,
)

STATE_KEYS = {"uploads", "reviews", "journal", "verifications", "lanes"}


class GatewayState:
    """One gateway process's state. Every route's host shares one instance, whose ``lock``
    serialises the gateway's writes (claims, budgets, uploads, reviews, cursors), so two
    callers can never race; one process is the single writer the proposal relies on."""

    def __init__(self, directory: Path) -> None:
        self.lock = threading.RLock()
        self.directory = directory
        self.path = directory / "state.json"
        self.journal_dir = directory / "journal"
        self._data = json.loads(self.path.read_text(encoding="utf-8")) if self.path.exists() else {}

    @classmethod
    def seed(cls, directory: Path, fixture: dict[str, Any]) -> GatewayState:
        directory.mkdir(parents=True, exist_ok=True)
        data = {
            "uploads": fixture.get("uploads", {}),
            "reviews": {review["head"]: review for review in fixture.get("reviews", [])},
            "verifications": fixture.get("verifications", {}),
            "lanes": fixture.get("lanes", {}),
            "auditSeed": fixture["journal"] if isinstance(fixture.get("journal"), list) else [],
            "delivered": {},
            "writes": [],
        }
        (directory / "state.json").write_text(json.dumps(data, indent=2), encoding="utf-8")
        return cls(directory)

    def get(self, key: str, default: Any = None) -> Any:
        return self._data.get(key, default)

    def put(self, key: str, value: Any) -> None:
        self._data[key] = value
        self.directory.mkdir(parents=True, exist_ok=True)
        # Written beside it and moved over it, so a crash mid-write leaves the old file whole
        # rather than JSON the next start cannot read.
        partial = self.path.with_name(f"{self.path.name}.partial")
        with partial.open("w", encoding="utf-8") as file:
            file.write(json.dumps(self._data, indent=2))
            file.flush()
            os.fsync(file.fileno())  # On disk before the rename, so a power cut keeps one.
        os.replace(partial, self.path)


def _journal_day(path: Path) -> date | None:
    try:
        return datetime.strptime(path.stem, "%Y-%m-%d").date()
    except ValueError:
        return None


def prune_journal(directory: Path, keep_days: int, *, now: datetime | None = None) -> list[str]:
    """Remove UTC day journal files older than ``keep_days`` (0 disables pruning).

    Best-effort per file: an ``OSError`` (such as a locked file on Windows) skips that file
    so retention never blocks gateway startup or drops a journal append on day rollover.
    """
    if keep_days <= 0 or not directory.exists():
        return []
    today = (now or datetime.now(UTC)).astimezone(UTC).date()
    cutoff = today - timedelta(days=keep_days - 1)
    removed: list[str] = []
    for path in sorted(directory.glob("*.jsonl")):
        file_day = _journal_day(path)
        if file_day is not None and file_day < cutoff:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                continue
            removed.append(path.stem)
    return removed


class DailyJournalSink:
    """AFD's file journal rotated by UTC day: ``journal/YYYY-MM-DD.jsonl``."""

    def __init__(
        self,
        directory: Path,
        *,
        keep_days: int = 365,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self.directory = directory
        self.keep_days = keep_days
        self._clock = clock or (lambda: datetime.now(UTC))
        self._sinks: dict[str, FileJournalSink] = {}
        prune_journal(self.directory, self.keep_days, now=self._clock())

    def _sink_for(self, moment: datetime) -> FileJournalSink:
        day = moment.astimezone(UTC).strftime("%Y-%m-%d")
        if day not in self._sinks:
            prune_journal(self.directory, self.keep_days, now=moment)
            self._sinks = {day: FileJournalSink(self.directory / f"{day}.jsonl")}
        return self._sinks[day]

    async def append(self, record: JournalRecord) -> JournalEntry:
        try:
            moment = datetime.fromisoformat(record.timestamp.replace("Z", "+00:00"))
            if moment.tzinfo is None:
                moment = moment.replace(tzinfo=UTC)
        except ValueError:
            moment = self._clock()
        return await self._sink_for(moment).append(record)

    async def read(self, range: JournalRange | None = None) -> list[JournalEntry]:
        return read_journal(self.directory)


def read_journal(directory: Path, *, since: datetime | None = None) -> list[JournalEntry]:
    since_day = since.astimezone(UTC).date() if since is not None else None
    entries: list[JournalEntry] = []
    for path in sorted(directory.glob("*.jsonl")) if directory.exists() else []:
        if since_day is not None:
            file_day = _journal_day(path)
            if file_day is not None and file_day < since_day:
                continue
        text = path.read_text(encoding="utf-8")
        cut = text.rfind("\n") + 1
        entries += parse_journal(text[:cut])
    return entries


def journal_size(directory: Path) -> tuple[int, str | None]:
    files = sorted(directory.glob("*.jsonl")) if directory.exists() else []
    return sum(path.stat().st_size for path in files), (files[0].stem if files else None)
