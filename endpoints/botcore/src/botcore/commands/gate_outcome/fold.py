"""The fold: the runs of days older than 180 days, put in a few lines a day.

A whole UTC day folds once it is more than `FOLD_AFTER_DAYS` days before today. Its runs, with
their attempts' steps and group summaries, become one `folded-workflow` line for each workflow
and event, and one `folded-check` line for each check and event, holding what the report
counts of them: how runs and checks ended, their seconds, the passes on a later attempt, the
queue's groups, the share whose steps are on record and the attempts a check failed in. A
report over a window that reaches a folded day reads those lines, and its `coverage.folded`
names the days. Checks are named as the checks known at the fold (the default branch's tip
then), so a folded day keeps the names it had.

The fold is the only thing that rewrites the record. It runs at the end of a collection, under
the collection's lock, from every machine's record as the collection read it: it writes the
new file beside the old one and replaces it in one move, so a fold cut short leaves the old
record whole. It keeps every line it cannot read, every line of a kind it does not fold, every
shape and every line of a day it does not fold, byte for byte. A machine's shared copy is
written from its record, so it is folded the same way at the next publish. Nothing folded is
asked of GitHub again: a folded day counts as listed, a rebuild included, so what GitHub no
longer has stays as the fold left it.
"""

from __future__ import annotations

import glob
import hashlib
import json
import math
import os
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

from botcore.commands.disk.steps import doing
from botcore.commands.gate_outcome.record import (
    RECORD_FILE,
    RULES,
    SUMMARY,
    Record,
    checked,
    day_of,
    parse_time,
    stamp,
)

FOLD_AFTER_DAYS = 180
_DAY = re.compile(r"\d{4}-\d{2}-\d{2}")
_SHA = re.compile(r"[0-9a-f]{40}")
_NAME_MAX = 300
# What a check's parts can hold: a step's label is its name or its command's first line, and
# a group's command is named by lefthook.yml, neither bounded but by these
_LABEL_MAX = 4000
_CHECK_MAX = 3 * _NAME_MAX + 2 * _LABEL_MAX
RAW = ("run", "steps", "group")  # the kinds a fold takes in


def cutoff(now: datetime) -> str:
    """The first day that is not folded: a day before it is over 180 days old."""
    return (now.date() - timedelta(days=FOLD_AFTER_DAYS)).isoformat()


def _digest(*parts: str) -> str:
    text = json.dumps(parts, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:24]


def workflow_id(day: str, workflow: str, event: str) -> str:
    return f"folded-workflow:{day}:{_digest(workflow, event)}"


def check_id(day: str, workflow: str, event: str, check: str) -> str:
    return f"folded-check:{day}:{_digest(workflow, event, check)}"


# ── Reading a folded line ───────────────────────────────────────────────────


def _count(value: object) -> bool:
    return type(value) is int and value >= 0


def _number(value: object) -> bool:
    return (
        isinstance(value, int | float)
        and type(value) is not bool
        and (math.isfinite(value) and value >= 0)
    )


def _text(value: object, longest: int = _NAME_MAX) -> bool:
    return isinstance(value, str) and 0 < len(value) <= longest


def _counts(value: object, keys: tuple[str, ...]) -> bool:
    return isinstance(value, dict) and set(value) == set(keys) and all(map(_count, value.values()))


def _day(value: object) -> bool:
    if not isinstance(value, str) or not _DAY.fullmatch(value):
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def _names(value: object) -> bool:
    return isinstance(value, list) and all(_text(name) for name in value)


def checked_folded(line: dict) -> dict | None:  # noqa: C901, PLR0911, PLR0912 - one check per field
    """A folded line with every field of the type it should have, and nothing else; None for
    anything else. As `record.checked` does for the other kinds."""
    from botcore.commands.gate_outcome.report import AFTER, COUNTS
    from botcore.commands.gate_outcome.report_checks import CHECK_COUNTS

    kind, identifier, day = line.get("kind"), line.get("id"), line.get("day")
    workflow, event = line.get("workflow"), line.get("event")
    if not (isinstance(identifier, str) and _count(line.get("v")) and _day(day)):
        return None
    if parse_time(line.get("at")) is None or not (_text(workflow) and _text(event)):
        return None
    assert isinstance(day, str) and isinstance(workflow, str) and isinstance(event, str)
    base = {"id": identifier, "kind": kind, "v": line["v"], "at": line["at"], "day": day,
            "workflow": workflow, "event": event}  # fmt: skip
    later = line.get("later")
    if not _counts(later, AFTER):
        return None
    if kind == "folded-workflow":
        if identifier != workflow_id(day, workflow, event):
            return None
        fields = {key: line.get(key) for key in (
            "name", "named_at", "counts", "wall", "heads", "failed_heads", "going", "left_out",
            "ran", "with_steps", "unreadable_steps", "checks",
        )}  # fmt: skip
        if not (_text(fields["name"]) and parse_time(fields["named_at"]) is not None):
            return None
        if not (_counts(fields["counts"], COUNTS) and _number(fields["wall"])):
            return None
        for key in ("heads", "failed_heads"):
            heads = fields[key]
            if not (isinstance(heads, list) and all(isinstance(h, str) and _SHA.fullmatch(h)
                                                    for h in heads)):  # fmt: skip
                return None
        if not (isinstance(fields["going"], list) and all(map(_count, fields["going"]))):
            return None
        if not all(_count(fields[key]) for key in ("left_out", "ran", "with_steps",
                                                    "unreadable_steps")):  # fmt: skip
            return None
        held = fields["checks"]
        if not (isinstance(held, dict) and set(held) == {"ran", "read", "jobs_seen",
                                                         "jobs_skipped", "summaries"}):  # fmt: skip
            return None
        summaries = held["summaries"]
        if not (_count(held["ran"]) and _count(held["read"]) and _names(held["jobs_seen"])
                and _names(held["jobs_skipped"]) and isinstance(summaries, dict)
                and all(status in (*SUMMARY, "not-asked") and _count(n)
                        for status, n in summaries.items())):  # fmt: skip
            return None
        return {**base, **fields, "later": later}
    if kind != "folded-check":
        return None
    check, job, step, command = (line.get(k) for k in ("check", "job", "step", "command"))
    if not (_text(check, _CHECK_MAX) and _text(job, 2 * _NAME_MAX + 3)
            and _text(step, _LABEL_MAX)):  # fmt: skip
        return None
    assert isinstance(check, str)
    if command is not None and not _text(command, _LABEL_MAX):
        return None
    if identifier != check_id(day, workflow, event, check):
        return None
    counts, examples = line.get("counts"), line.get("examples")
    if not _counts(counts, (*CHECK_COUNTS, "other")):
        return None
    if not (_count(line.get("unknown")) and _count(line.get("timed"))
            and _number(line.get("seconds"))):  # fmt: skip
        return None
    if not isinstance(examples, list):
        return None
    for example in examples:
        if not (isinstance(example, list) and len(example) == 4):  # noqa: PLR2004
            return None
        run, attempt, latest, created = example
        if not (_count(run) and _count(attempt) and isinstance(latest, bool)
                and parse_time(created) is not None):  # fmt: skip
            return None
    return {**base, "check": check, "job": job, "step": step, "command": command,
            "counts": counts, "unknown": line["unknown"], "seconds": line["seconds"],
            "timed": line["timed"], "later": later, "examples": examples}  # fmt: skip


# ── Making the folded lines ─────────────────────────────────────────────────


def folded_lines(  # noqa: C901 - every line of a day
    record: Record,
    known,
    days: set[str],
    at: str,  # noqa: ANN001 - a Known
) -> tuple[list[dict], set[str]]:
    """The folded lines of `days`, from the runs the record holds of them, and the days a
    line could not be made for: a day is folded whole or not at all."""
    from botcore.commands.gate_outcome.report import AFTER, COUNTS, Scan, by_run
    from botcore.commands.gate_outcome.report_checks import CHECK_COUNTS, Tally, _Attempts

    groups: dict[tuple[str, str, str], list[tuple[int, dict]]] = {}
    for run_id, held in by_run(record).items():
        latest = held[max(held)]
        day = day_of(latest["created"])
        if day in days:
            groups.setdefault((day, latest["workflow"], latest["event"]), []).append((run_id, held))
    attempts = _Attempts(record, known)
    lines: list[dict] = []
    for (day, workflow, event), runs in sorted(groups.items()):
        scan = Scan()
        for run_id, held in runs:
            scan.add(record, run_id, held, None, None, set())
        tally = Tally(attempts, {}, set(), every=True)
        for latest, held in scan.finished:
            tally.add(latest, held)
        row = scan.rows.get((workflow, event))
        newest = max((held[max(held)] for _, held in runs), key=lambda line: line["created"])
        file = workflow.rsplit("/", 1)[-1]
        lines.append({
            "id": workflow_id(day, workflow, event), "kind": "folded-workflow", "v": RULES,
            "at": at, "day": day, "workflow": workflow, "event": event,
            "name": row.name if row else newest["name"],
            "named_at": row.named_at if row else newest["created"],
            "counts": {end: row.counts[end] if row else 0 for end in COUNTS},
            "later": {kind: row.later[kind] if row else 0 for kind in AFTER},
            "wall": row.wall if row else 0,
            "heads": sorted(row.heads) if row else [],
            "failed_heads": sorted(row.failed_heads) if row else [],
            "going": sorted(scan.going), "left_out": scan.left_out[event],
            "ran": scan.ran, "with_steps": scan.with_steps,
            "unreadable_steps": scan.unreadable_steps,
            "checks": {
                "ran": tally.ran[file], "read": tally.read[file],
                "jobs_seen": sorted(job for f, job in tally.jobs_seen if f == file),
                "jobs_skipped": sorted(job for f, job in tally.jobs_skipped if f == file),
                "summaries": dict(sorted(tally.summaries.items())),
            },
        })  # fmt: skip
        identifiers = {identifier for identifier, _ in tally.rows} | set(tally.examples)
        for identifier in sorted(identifiers):
            check = tally.rows.get((identifier, event))
            job, step, command = (
                (check.job, check.step, check.command) if check else tally.parts[identifier]
            )
            lines.append({
                "id": check_id(day, workflow, event, identifier), "kind": "folded-check",
                "v": RULES, "at": at, "day": day, "workflow": workflow, "event": event,
                "check": identifier, "job": job, "step": step, "command": command,
                "counts": {end: check.counts[end] if check else 0
                           for end in (*CHECK_COUNTS, "other")},
                "unknown": check.unknown if check else 0,
                "seconds": check.seconds if check else 0,
                "timed": check.timed if check else 0,
                "later": {kind: check.later[kind] if check else 0 for kind in AFTER},
                "examples": [
                    [example["run"], example["attempt"], example["latest"], example["created"]]
                    for example in tally.examples.get(identifier, [])
                ],
            })  # fmt: skip
    made, broken = [], set()
    for line in lines:
        kept = checked(line)
        if kept is None:
            broken.add(line["day"])
        else:
            made.append(kept)
    return [line for line in made if line["day"] not in broken], broken


def whole_days(record: Record, days: set[str]) -> dict[str, str]:
    """Of `days`, those not wholly collected, with why: a day folds only when every moment of
    it was listed and every attempt that ran has its steps on record (or is on record as one
    GitHub no longer gives), since nothing folded is asked for again."""
    from botcore.commands.gate_outcome.collect import NOT_RUN, gaps, spans
    from botcore.commands.gate_outcome.report import by_run

    listed = [
        (begun, ended) for state in record.states.values() for begun, ended, _ in spans(state)
    ]  # fmt: skip
    not_whole: dict[str, str] = {}
    for day in sorted(days):
        begun = parse_time(f"{day}T00:00:00Z")
        assert begun is not None
        if gaps(begun, begun + timedelta(days=1), listed):
            not_whole[day] = "not every moment of it was listed"
    for _run, held in by_run(record).items():
        latest = held[max(held)]
        of = day_of(latest["created"])
        if of is None or of not in days or of in not_whole:
            continue
        day = of
        if len(held) < latest["attempt"] or any(
            line["status"] not in ("completed", "unreadable")
            for number, line in held.items() if number != latest["attempt"]
        ):  # fmt: skip
            not_whole[day] = "an earlier attempt of a run is not on record"
            continue
        for line in held.values():
            if (
                line["status"] == "completed"
                and line["conclusion"] not in NOT_RUN
                and (f"steps:{line['run']}:{line['attempt']}" not in record.steps)
            ):
                not_whole[day] = "an attempt's steps are not read yet"
                break
    return not_whole


# ── Rewriting the record ────────────────────────────────────────────────────


def _serialize(line: dict) -> bytes:
    return (json.dumps(line, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def write_whole(path: Path, data: bytes) -> None:
    """Write `data` beside `path` and put it in place in one move: a reader, or a fold cut
    short, sees the old file or the new one, never part of either."""
    for stale in glob.glob(glob.escape(str(path)) + ".*.tmp"):  # what a fold cut short left
        try:
            os.remove(stale)
        except OSError:
            pass
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    try:
        with temporary.open("wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        replace(temporary, path)
    except OSError:
        temporary.unlink(missing_ok=True)  # a full disk: the old record stands as it was
        raise
    if sys.platform != "win32":  # the move itself, kept through a power cut
        try:
            folder = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(folder)
            finally:
                os.close(folder)
        except OSError:
            pass  # a file system that cannot: the record was replaced all the same


def replace(source: Path, target: Path) -> None:
    """os.replace, from one place, so a test can cut a fold short just before it."""
    os.replace(source, target)


def _hold_back(  # noqa: PLR0913 - what decides whether a day folds
    record: Record,
    known,  # noqa: ANN001 - a Known
    fresh: set[str],
    machine: str,
    now: datetime,
    hold,  # noqa: ANN001 - hold(days, why, remedy)
) -> set[str]:
    """The days of `fresh` that may fold, each other one held with why and what mends it."""
    others = sorted(name for name in record.unreadable if name != machine)
    views = [  # what kept every machine's record from being read, and what mends it
        (record.missing, "Make the shared folder reachable from this machine, or correct "
         "skill_usage_shared; the next collection folds these days"),
        (f"the shared copy of {', '.join(record.partial)} is not whole" if record.partial
         else None, "Let the shared folder finish syncing; the next collection folds these days"),
        (f"lines of {', '.join(others)}'s record could not be read" if others else None,
         "Another machine may run a newer botcore: update this one's; never remove that "
         "machine's copy, which holds its runs"),
    ]  # fmt: skip
    for view, remedy in views:
        if view and fresh:  # a day folded without another machine's runs loses them everywhere
            hold(fresh, f"every machine's record was not read: {view}", remedy)
            fresh = set()
    if fresh and (known is None or known.error):
        why = known.error if known is not None else "none was given"
        hold(fresh, f"the checks known could not be read: {why}",
             "Make the default branch readable in this checkout (git fetch origin); the next "
             "collection folds these days")  # fmt: skip
        fresh = set()
    from botcore.commands.gate_outcome.collect import MAX_DAYS

    reach = (now.date() - timedelta(days=MAX_DAYS - 1)).isoformat()  # a collection's first day
    for day, why in whole_days(record, fresh).items():
        if day >= reach:
            hold({day}, f"it is not wholly collected: {why}",
                 "Run gate-outcome-collect with since_days reaching these days, again or with "
                 "more requests until it has read all they need; the collection that does folds "
                 "them")  # fmt: skip
        else:
            hold({day}, f"it is not wholly collected and is too old to collect: {why}",
                 "Nothing can collect these days now: their runs stay as they are, and the "
                 "reports read them as before")  # fmt: skip
        fresh.discard(day)
    return fresh


def fold_record(  # noqa: C901, PLR0912 - one fold, start to end
    folder: Path,
    record: Record,
    known,
    now: datetime,
    machine: str,  # noqa: ANN001 - a Known
) -> dict | None:
    """Fold this machine's record, under the collection's lock: the days before `cutoff`
    that are not folded yet, and its own lines of days another machine has folded, which it
    replaces with that machine's folded lines. None when there is nothing to fold; what was
    folded, or why nothing was, otherwise."""
    first_kept = cutoff(now)
    latest: dict[int, dict] = {}
    for line in record.runs.values():
        held = latest.get(line["run"])
        if held is None or line["attempt"] > held["attempt"]:
            latest[line["run"]] = line
    fresh = {
        day for line in latest.values()
        if (day := day_of(line["created"])) is not None and day < first_kept
    }  # fmt: skip
    already = record.folded_days()
    if not fresh and not (record.own_days & already):
        return None
    from botcore.commands.gate_outcome.report import day_ranges

    held_back: dict[str, set[str]] = {}  # why -> the days not folded for it
    remedies: dict[str, str] = {}

    def hold(days: set[str], why: str, remedy: str) -> None:
        if days:
            held_back.setdefault(why, set()).update(days)
            remedies[why] = remedy

    fresh = _hold_back(record, known, fresh, machine, now, hold)
    made: list[dict] = []
    if fresh:
        made, broken = folded_lines(record, known, fresh, stamp(now))
        hold(broken, "a line of it could not be made as the record reads it",
             "A name in these days' checks is outside what a folded line holds: their runs stay "
             "as they are, and the reports read them as before")  # fmt: skip
        fresh -= broken
    not_folded = [
        {"why": why, "days": day_ranges(days), "suggestion": remedies[why]}
        for why, days in sorted(held_back.items())
    ]  # fmt: skip
    if not fresh and not (record.own_days & already):  # nothing to rewrite: say why, and go
        return {"folded": [], "not_folded": not_folded}

    doing("folding the gate outcome record in", folder)
    path = folder / RECORD_FILE
    try:
        data = path.read_bytes()
    except FileNotFoundError:
        data = b""
    raw = [piece + b"\n" for piece in data.split(b"\n")]  # (a lone \r stays in its line)
    if raw and raw[-1] == b"\n":
        raw.pop()  # what follows the last line end
    elif raw:
        raw[-1] = raw[-1][:-1]  # a last line with no end: ended below
    parsed: list[dict | None] = []
    run_day: dict[int, tuple[int, str | None]] = {}
    for text in raw:
        try:
            read = checked(json.loads(text)) if text.strip() else None
        except ValueError:
            read = None
        parsed.append(read)
        if read is not None and read["kind"] == "run":
            known_day = run_day.get(read["run"])
            if known_day is None or read["attempt"] > known_day[0]:
                run_day[read["run"]] = (read["attempt"], day_of(read["created"]))
    for run, newest in latest.items():  # what other machines hold of a run decides its day too
        known_day = run_day.get(run)
        if known_day is None or newest["attempt"] > known_day[0]:
            run_day[run] = (newest["attempt"], day_of(newest["created"]))
    days = fresh | already
    kept: list[bytes] = []
    own_folded: set[str] = set()
    dropped_days: set[str] = set()
    for text, own in zip(raw, parsed, strict=True):
        if own is not None and own["kind"] in RAW:
            day = run_day.get(own["run"], (0, None))[1]
            if day is not None and day in days:
                dropped_days.add(day)
                continue
        if own is not None and own["kind"] in ("folded-workflow", "folded-check"):
            own_folded.add(own["id"])
        kept.append(text if text.endswith(b"\n") else text + b"\n")
    if not made and not dropped_days:
        return {"folded": [], "not_folded": not_folded} if not_folded else None
    # A day another machine folded keeps its lines here too, so the day is not lost with that
    # machine's copy
    copied = [
        line for line in record.folds.values()
        if line["day"] in dropped_days and line["id"] not in own_folded
    ]  # fmt: skip
    new = b"".join(kept) + b"".join(_serialize(line) for line in [*copied, *made])
    doing("writing the gate outcome record in", folder)
    try:
        write_whole(path, new)
    except OSError as exc:
        return {"folded": [], "error": f"the folded record could not be written: {exc}",
                **({"not_folded": not_folded} if not_folded else {})}  # fmt: skip
    for line in made:
        record.add(line, machine)
    record.settle()
    return {
        "folded": day_ranges(fresh),
        "lines_before": sum(1 for text in raw if text.strip()),
        "lines_after": len(kept) + len(copied) + len(made),
        "bytes_before": len(data),
        "bytes_after": len(new),
        **({"not_folded": not_folded} if not_folded else {}),
    }
