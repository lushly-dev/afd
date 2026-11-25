"""`gate-outcome-report` by check: each check's runs in each event, how they ended, what they
cost, the quiet ones marked, and the checks known that the record has no run of.

A check's rows come only from runs whose jobs and steps are in the record (`coverage.
steps_share` says what share that is). A step GitHub marks skipped, or one that never started,
is `not-run`, apart, and is not a run of that check. The commands of a hook group step are
checks of their own and the step is not: a command ends as its step did, except where the
step's summary was read, which says how each command ended and its seconds. A failed group
step whose summary could not be read leaves its commands' ends unknown, and they are counted as
`result_unknown`, never guessed. Local runs are not collected yet, so every row says `local:
absent`.
"""

from __future__ import annotations

import difflib
from collections import Counter
from dataclasses import dataclass, field

from botcore.commands.gate_outcome.checks import Known, check_id, housekeeping, label_of
from botcore.commands.gate_outcome.collect import share
from botcore.commands.gate_outcome.record import RULES

STEP_ENDS = {
    "success": "passed",
    "failure": "failed",
    "timed_out": "failed",
    "cancelled": "cancelled",
    "skipped": "not-run",
    None: "not-run",
}
CHECK_COUNTS = ("passed", "failed", "cancelled", "not-run")
RAN = ("passed", "failed", "cancelled")
AFTER = ("failed", "cancelled", "unknown")
MIN_RATE = 20
RUN_ENDS = {"success": "passed", "failure": "failed", "timed_out": "failed",
            "startup_failure": "failed", "cancelled": "cancelled"}  # fmt: skip


def _file(path: str) -> str:
    return path.rsplit("/", 1)[-1]


@dataclass
class CheckRow:
    check: str
    file: str
    job: str
    step: str
    command: str | None
    where: str
    known: bool
    verdict: bool = False
    counts: Counter = field(default_factory=Counter)
    unknown: int = 0  # a command whose failed group step's summary could not be read
    seconds: float = 0.0
    timed: int = 0  # runs whose seconds are known
    later: Counter = field(default_factory=Counter)

    @property
    def runs(self) -> int:
        return sum(self.counts[end] for end in RAN)

    def to_json(self) -> dict:
        data: dict = {"check": self.check, "workflow": self.file, "job": self.job,
                      "step": self.step}  # fmt: skip
        if self.command is not None:
            data["command"] = self.command
        data["where"] = self.where
        if self.verdict:
            data["verdict"] = True
        data["runs"] = self.runs
        for end in CHECK_COUNTS:
            data[end] = self.counts[end]
        if self.counts["other"]:
            data["other"] = self.counts["other"]
        if self.command is not None:
            data["result_unknown"] = self.unknown
        data["passed_on_later_attempt"] = sum(self.later.values())
        data["passed_after"] = {kind: self.later[kind] for kind in AFTER}
        data["minutes"] = round(self.seconds / 60, 1)
        data["timed"] = self.timed
        data["quiet"] = self.counts["passed"] > 0 and not self.counts["failed"] and not self.unknown
        data["local"] = "absent"
        data["known"] = self.known
        over = self.counts["passed"] + self.counts["failed"]
        if over < MIN_RATE:
            data["rates"] = "too-few"
        else:
            data["rates"] = "given"
            data["failed_per_100_completed"] = round(100 * self.counts["failed"] / over, 1)
        return data


def observed_jobs(record) -> dict[str, set[str]]:  # noqa: ANN001 - a Record
    """Each workflow file's job names the record has seen, from every shape."""
    seen: dict[str, set[str]] = {}
    for shape in record.shapes.values():
        file = _file(shape["workflow"])
        seen.setdefault(file, set()).update(job for job, _ in shape["jobs"])
    return seen


def observed_ids(record, known: Known) -> set[str]:  # noqa: ANN001 - a Record
    """The id of every step the record's shapes hold, as a check of a run would be named."""
    found: set[str] = set()
    for shape in record.shapes.values():
        file = _file(shape["workflow"])
        for job_name, names in shape["jobs"]:
            job = known.job(file, job_name)
            for name in names:
                if housekeeping(name, names):
                    continue
                step = job.step(name) if job else None
                label = label_of(step, name)
                if step and step.group and step.commands:
                    found.update(check_id(file, job_name, label, c) for c in step.commands)
                else:
                    found.add(check_id(file, job_name, label))
    return found


def close_checks(check: str, ids: set[str]) -> list[str]:
    return difflib.get_close_matches(check, sorted(ids), n=5, cutoff=0.6)


def _command_end(step_end: str, entry: list | None, command: str) -> tuple[str, float | None]:
    """How a command of a group step ended, and its seconds where its summary was read."""
    if step_end not in ("passed", "failed"):
        return step_end, None  # not run, cancelled: as its step
    if entry is not None and entry[2] == "read":
        for name, end, seconds in entry[4]:
            if name == command:
                return end, seconds
        return "not-run", None  # the runner did not run it
    if step_end == "passed":
        return "passed", None
    return "unknown", None


@dataclass
class Attempt:
    """One attempt's checks: id -> (end, seconds, job, step, command), and how each group step
    that ran (passed or failed) has its summary: `read`, why not, or None when not asked."""

    checks: dict[str, tuple[str, float | None, str, str, str | None]]
    summaries: list[str | None]


def outcomes(  # noqa: C901 - one attempt's steps
    file: str, steps: dict, shape: dict, group: dict | None, known: Known
) -> Attempt:
    """Every check of one attempt."""
    found: dict[str, tuple[str, float | None, str, str, str | None]] = {}
    summaries: list[str | None] = []
    ends = steps.get("conclusions")
    entries = {(entry[0], entry[1]): entry for entry in group["steps"]} if group else {}
    for place, (job_name, names) in enumerate(shape["jobs"]):
        seconds = steps["seconds"][place][1] if place < len(steps["seconds"]) else []
        job = known.job(file, job_name)
        for index, name in enumerate(names):
            if housekeeping(name, names):
                continue
            if ends is None:
                end = "passed"
            else:
                try:
                    end = STEP_ENDS.get(ends[place][1][index], "other")
                except IndexError:
                    end = "not-run"
            took = seconds[index] if index < len(seconds) else None
            step = job.step(name) if job else None
            label = label_of(step, name)
            if step and step.group and step.commands:
                entry = entries.get((job_name, name))
                if end in ("passed", "failed"):
                    summaries.append(entry[2] if entry else None)
                for command in step.commands:
                    command_end, command_took = _command_end(end, entry, command)
                    found[check_id(file, job_name, label, command)] = (
                        command_end, command_took, job_name, label, command,
                    )  # fmt: skip
            else:
                found[check_id(file, job_name, label)] = (
                    end, took if end in RAN else None, job_name, label, None,
                )  # fmt: skip
    return Attempt(found, summaries)


class _Attempts:
    """Each attempt's checks, read once."""

    def __init__(self, record, known: Known) -> None:  # noqa: ANN001 - a Record
        self.record, self.known = record, known
        self.cache: dict[tuple[int, int], Attempt | None] = {}

    def of(self, run: dict) -> Attempt | None:
        key = (run["run"], run["attempt"])
        if key not in self.cache:
            steps = self.record.steps.get(f"steps:{key[0]}:{key[1]}")
            shape = self.record.shapes.get((steps or {}).get("shape") or "")
            older = steps is not None and steps["v"] < RULES and "conclusions" not in steps
            if (
                steps is None or shape is None or older
                or (steps.get("unreadable") and not steps["seconds"])
            ):  # fmt: skip
                # an older passed line does not tell a skipped step from one that passed
                self.cache[key] = None
            else:
                group = self.record.groups.get(f"group:{key[0]}:{key[1]}")
                self.cache[key] = outcomes(_file(run["workflow"]), steps, shape, group, self.known)
        return self.cache[key]


def by_check(  # noqa: C901, PLR0912, PLR0913, PLR0915 - the rows, what was not observed, coverage
    data: dict, record, known: Known, finished: list, verdicts: set[str],  # noqa: ANN001
    where: str | None, wanted: set[str] | None, check: str | None, sort: str, limit: int,
    status: str,
) -> None:  # fmt: skip
    """Replace a report's rows with check rows, and add `not_observed` and what they rest on."""
    attempts = _Attempts(record, known)
    rows: dict[tuple[str, str], CheckRow] = {}
    examples: list[dict] = []
    known_ids = known.ids(observed_jobs(record)) if not known.error else {}
    ran: Counter = Counter()  # by file: runs that ran
    read: Counter = Counter()  # by file: those whose steps are on record
    jobs_seen: set[tuple[str, str]] = set()  # (file, job) in a run whose steps were read
    jobs_skipped: set[tuple[str, str]] = set()  # listed with no step: skipped by its condition
    summaries: Counter = Counter()  # group steps that ran, by how their summary was read
    for latest, held in finished:
        file = _file(latest["workflow"])
        if check is not None:  # every attempt it failed in, an earlier one included
            for number in sorted(held, reverse=True):
                found = attempts.of(held[number])
                if found is not None and found.checks.get(check, ("",))[0] == "failed":
                    examples.append({"run": latest["run"], "attempt": number,
                                     "latest": number == latest["attempt"],
                                     "where": latest["event"], "created": latest["created"],
                                     "ended": "failed"})  # fmt: skip
        if latest["conclusion"] not in RUN_ENDS:
            continue  # action_required, skipped: no step ran
        ran[file] += 1
        got = attempts.of(latest)
        if got is None:
            continue
        read[file] += 1
        steps = record.steps[f"steps:{latest['run']}:{latest['attempt']}"]
        shape = record.shapes[steps["shape"]]
        jobs_seen.update((file, job) for job, names in shape["jobs"] if names)
        jobs_skipped.update((file, job) for job, names in shape["jobs"] if not names)
        summaries.update(status or "not-asked" for status in got.summaries)
        for identifier, (end, seconds, job, step, command) in got.checks.items():
            if check is not None and identifier != check:
                continue
            key = (identifier, latest["event"])
            row = rows.get(key)
            if row is None:
                row = rows[key] = CheckRow(
                    identifier, file, job, step, command, latest["event"],
                    known=identifier in known_ids, verdict=latest["workflow"] in verdicts,
                )  # fmt: skip
            if end == "unknown":
                row.unknown += 1
                continue
            row.counts[end] += 1
            if seconds is not None:
                row.seconds += seconds
                row.timed += 1
            if end == "passed" and latest["attempt"] > 1:
                before, missing = [], False
                for number in range(1, latest["attempt"]):
                    earlier = held.get(number)
                    found = attempts.of(earlier) if earlier else None
                    if (
                        found is None
                        and earlier is not None
                        and earlier["status"] == "completed"
                        and (
                            earlier["conclusion"] not in RUN_ENDS
                            or earlier["conclusion"] == "success"
                        )
                    ):
                        continue  # it ran no step, or passed: no failure of this check to follow
                    if found is None or identifier not in found.checks:
                        missing = missing or found is None
                        continue
                    before.append(found.checks[identifier][0])
                kind = (
                    "failed" if "failed" in before else "cancelled" if "cancelled" in before
                    else "unknown" if missing or "unknown" in before else None
                )  # fmt: skip
                if kind is not None:
                    row.later[kind] += 1

    key_of = {
        "minutes": lambda row: row.seconds,
        "failed": lambda row: row.counts["failed"],
        "runs": lambda row: row.runs,
    }[sort]
    ordered = sorted(rows.values(), key=lambda row: (row.check, row.where))
    ordered.sort(key=key_of, reverse=True)

    seen_ids = {row.check for row in rows.values()}
    not_observed = []
    for identifier, (file, job, step, _command) in sorted(known_ids.items()):
        if identifier in seen_ids or (check is not None and identifier != check):
            continue
        if wanted is not None and f".github/workflows/{file}" not in wanted:
            continue
        why = _why(status, file, job, where, ran, read, (jobs_seen, jobs_skipped))
        if "${{" in step and status != "absent":
            why = (
                "its name holds an expression the workflow file cannot evaluate, so a run "
                "names it otherwise and its rows go by that name"
            )
        not_observed.append({"check": identifier, "workflow": file, "why": why})

    data["rows"] = [row.to_json() for row in ordered[:limit]]
    data["not_observed"] = not_observed[:limit]
    data["more"] = {"rows": max(0, len(ordered) - limit),
                    "not_observed": max(0, len(not_observed) - limit)}  # fmt: skip
    if check is not None:
        examples.sort(key=lambda example: (example["created"], example["run"]), reverse=True)
        data["examples"] = examples[:limit]
        data["more"]["examples"] = max(0, len(examples) - limit)
    coverage = data["coverage"]
    group_runs = sum(summaries.values())
    # the share of group steps that ran whose summary was read: their commands' seconds
    coverage["commands_share"] = share(summaries["read"], group_runs) if group_runs else None
    coverage["summaries_unreadable"] = {
        status: count for status, count in sorted(summaries.items())
        if status not in ("read", "not-asked")
    }  # fmt: skip
    coverage["known"] = {
        "ref": known.ref,
        "commit": known.commit,
        "checks": len(known_ids),
        "problems": known.problems,
    }
    if known.error:
        coverage["known"]["error"] = known.error
        data["warnings"].append(
            f"The checks known could not be read ({known.error}), so not_observed is empty"
        )
    for problem in known.problems:
        data["warnings"].append(f"{problem}: its checks are not known")


def _why(  # noqa: PLR0913 - what was seen of a check's workflow
    status: str, file: str, job: str, where: str | None, ran: Counter, read: Counter,
    jobs: tuple[set[tuple[str, str]], set[tuple[str, str]]],
) -> str:  # fmt: skip
    if status == "absent":
        return "ci is absent: nothing of the window was collected (run gate-outcome-collect)"
    event = f" on {where}" if where else ""
    if not ran[file]:
        return f"no run of {file}{event} in the window ran a step"
    unread = ran[file] - read[file]
    if not read[file]:
        return f"the steps of {file}'s {_runs(ran[file])}{event} are not read yet"
    left = f"; the steps of {unread} more are not read yet" if unread else ""
    seen, skipped = jobs
    if (file, job) in seen:
        what = "its step was"
    elif (file, job) in skipped:
        what = "its job was skipped"
    else:
        what = "its job ran"
    runs = f"the {_runs(read[file])} of {file}{event} whose steps were read{left}"
    return f"{what} in {runs}" if what == "its job was skipped" else f"{what} in none of {runs}"


def _runs(count: int) -> str:
    return f"{count} run" if count == 1 else f"{count} runs"
