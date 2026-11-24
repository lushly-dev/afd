"""The gateway's own state, beside GitHub: small, and mostly rebuildable.

``state.json`` holds bundle uploads, review records (G2), each consumer's delivered events
(G3), the write log behind the write budget, and seeded audit rows a fixture supplies. Claims
are not here: GitHub holds them and every read rebuilds them. The journal is AFD's JSON Lines
journal, one file per UTC day under ``journal/``, kept for ``journal.keepDays``.
"""

from __future__ import annotations

import json
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from afd.core.journal import (
    FileJournalSink,
    JournalEntry,
    JournalRange,
    JournalRecord,
    parse_journal,
)

STATE_KEYS = {"uploads", "reviews", "journal", "verifications"}


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
            "auditSeed": fixture.get("journal", []),
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
        self.path.write_text(json.dumps(self._data, indent=2), encoding="utf-8")


class DailyJournalSink:
    """AFD's file journal rotated by UTC day: ``journal/YYYY-MM-DD.jsonl``."""

    def __init__(self, directory: Path) -> None:
        self.directory = directory
        self._sinks: dict[str, FileJournalSink] = {}

    def _today(self) -> FileJournalSink:
        day = datetime.now(UTC).strftime("%Y-%m-%d")
        if day not in self._sinks:
            self._sinks[day] = FileJournalSink(self.directory / f"{day}.jsonl")
        return self._sinks[day]

    async def append(self, record: JournalRecord) -> JournalEntry:
        return await self._today().append(record)

    async def read(self, range: JournalRange | None = None) -> list[JournalEntry]:
        return read_journal(self.directory)


def read_journal(directory: Path) -> list[JournalEntry]:
    entries: list[JournalEntry] = []
    for path in sorted(directory.glob("*.jsonl")) if directory.exists() else []:
        text = path.read_text(encoding="utf-8")
        cut = text.rfind("\n") + 1
        entries += parse_journal(text[:cut])
    return entries


def journal_size(directory: Path) -> tuple[int, str | None]:
    files = sorted(directory.glob("*.jsonl")) if directory.exists() else []
    return sum(path.stat().st_size for path in files), (files[0].stem if files else None)
