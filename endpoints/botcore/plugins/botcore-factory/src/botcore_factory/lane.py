"""The lane's loop, one step at a time.

``step`` does everything that can be done now and returns: it never waits, so tests drive it with
a fixture world and a fake clock. Each step, in order:

1. polls running validations and the coverage run, recording what finished;
2. queues held branches while the queue has room (``lane.queueMax``);
3. moves the front of the queue towards a merge: merges are serial and in queue order. A
   validated branch whose base is no longer origin's head is validated again (``rerun``);
   otherwise it is pushed, its PR opened, the adapter's ``required_check`` awaited, and it is
   squash-merged bound to the validated head;
4. starts validations in free slots (``lane.slots``): each slot checks the queued head out,
   installs, merges origin's head in (a conflict ejects, it is never resolved) and runs the
   adapter's ``validate``;
5. runs ``coverage`` on main every ``lane.coverageEvery`` merges and at once after a merge that
   touched ``gate_paths``; a failure is ``main-broken`` and pauses the lane;
6. says ``queue-empty`` when nothing is queued, held, active or owed, and makes a drained move.

A branch's own failure ejects it with a cause, the first lines of the failure and a ``logPath``.
The lane's own trouble (fetching origin, reading GitHub) is a ``lane-error`` that pauses the lane
and ejects nothing. The lane never edits code.
"""

from __future__ import annotations

import contextlib
import re
from datetime import datetime

from botcore_factory import dials, records
from botcore_factory.adapter import matches
from botcore_factory.cells import seated
from botcore_factory.claims import format_time, parse_time
from botcore_factory.events import emit, is_open
from botcore_factory.runtime import Factory
from botcore_factory.world import LANE_HOST_VARIABLE, WorldError

FIRST_LINES = 10
_FAILURE = re.compile(r"(FAIL|Error|ERR!|error|✗|×|failed|Failed)")


class LaneTrouble(Exception):
    """The lane's own trouble: pause, eject nothing."""


def first_lines(text: str) -> list[str]:
    """The lines a reader needs first: those that look like failures, else the last ones."""
    lines = [line.rstrip() for line in text.splitlines() if line.strip()]
    failing = [line for line in lines if _FAILURE.search(line)]
    return (failing or lines[-FIRST_LINES:])[:FIRST_LINES]


def log_path(branch: str, attempt: int, kind: str = "") -> str:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", branch).strip("-")
    return f"attempts/{safe}-{attempt}{'-' + kind if kind else ''}.log"


class Step:
    """One step over the lane's state, under the state lock."""

    def __init__(self, factory: Factory, state: dict) -> None:
        self.factory = factory
        self.world = factory.world
        self.config = factory.config
        self.state = state
        self.lane = state["lane"]
        self.now = factory.world.clock.now()
        self.at = format_time(self.now)
        self.actions: list[str] = []
        self._main: str | None = None
        for entry in [*state["queue"], *state["held"]]:  # Entries a fixture or recovery wrote.
            entry.setdefault("attempt", 1)
            entry.setdefault("state", "queued" if entry in state["queue"] else "held")
            cell = self.cell(entry["branch"]) or {}
            entry.setdefault("issues", cell.get("issues", []))

    # -- helpers ---------------------------------------------------------------------------

    def record(self, kind: str, **fields) -> None:
        self.factory.store.append_record(
            records.make(kind, self.at, self.lane.get("runId"), **fields)
        )

    def event(self, kind: str, **fields) -> dict:
        self.actions.append(f"event {kind} {fields.get('branch', '')}".rstrip())
        return emit(self.state, self.at, kind, **fields)

    def dial(self, key: str):
        return dials.value(self.state["dials"], key)

    def main(self) -> str:
        """origin's default head, fetched once per step; failing to fetch is lane trouble."""
        if self._main is None:
            try:
                self._main = self.world.git.fetch_main()
            except WorldError as exc:
                raise LaneTrouble(f"Fetching origin failed: {exc}") from exc
        return self._main

    def cell(self, branch: str) -> dict | None:
        return next((c for c in self.state["cells"] if c.get("branch") == branch), None)

    def minutes(self, since: str | None) -> float:
        if not since:
            return 0.0
        return round((self.now - parse_time(since)).total_seconds() / 60, 1)

    def absolute(self, relative: str) -> str:
        return str(self.factory.store.root / relative)

    # -- ejection and trouble --------------------------------------------------------------

    def eject(self, entry: dict, cause: str, text: str, log: str | None = None) -> None:
        if entry.get("run"):
            with contextlib.suppress(WorldError):  # Already gone.
                self.world.processes.kill(entry["run"])
        self.state["queue"].remove(entry)
        lines = first_lines(text) or [cause]
        branch = entry["branch"]
        self.record(
            "ejected",
            branch=branch,
            attempt=entry["attempt"],
            cause=cause,
            head=entry.get("head"),
            logPath=log,
            detail=lines[0],
        )
        self.event(
            "ejected", branch=branch, reason=cause, detail=lines[0], lines=lines, logPath=log
        )
        cell = self.cell(branch)
        if cell is not None:
            cell["state"] = "ejected"
            cell["ejections"] = int(cell.get("ejections", 0)) + 1
            limit = self.dial("cells.maxEjections")
            if cell["ejections"] >= limit:
                self.event(
                    "ejection-limit",
                    branch=branch,
                    detail=f"{cell['ejections']} ejections; cells.maxEjections is {limit}",
                )
        self.actions.append(f"ejected {branch} ({cause})")

    def trouble(self, detail: str) -> None:
        self.lane["paused"] = True
        self.lane["pauseReason"] = detail
        needs = "sign-in" if re.search(r"auth|sign.?in|401|credential", detail, re.I) else None
        self.event("lane-error", detail=detail, needsOwner=needs)

    # -- the step ---------------------------------------------------------------------------

    def run(self) -> list[str]:
        try:
            self.poll_validations()
            self.poll_coverage()
            if not self.lane.get("paused"):
                self.queue_held()
                self.advance_front()
                if not self.lane.get("stopRequested"):
                    self.start_validations()
                self.start_coverage()
                self.queue_empty()
        except LaneTrouble as trouble:
            self.trouble(str(trouble))
        except WorldError as exc:  # Anything else outside that failed is the lane's trouble too.
            self.trouble(f"{type(exc).__name__}: {exc}")
        return self.actions

    def poll_validations(self) -> None:
        # In reverse, so entries a restart sends to the front keep their order there.
        for entry in reversed([e for e in self.state["queue"] if e.get("state") == "validating"]):
            try:
                done = self.world.processes.poll(entry["run"])
            except WorldError:
                self.requeue(entry, "restart")
                continue
            if done is None:
                continue
            passed = done.returncode == 0
            self.record(
                "validated",
                branch=entry["branch"],
                attempt=entry["attempt"],
                outcome="passed" if passed else "failed",
                head=entry["validatedHead"],
                base=entry["base"],
                tree=entry.get("tree"),
                command=list(self.config.validate_command or []),
                minutes=self.minutes(entry.get("startedAt")),
                logPath=entry.get("logPath"),
            )
            entry.pop("run", None)
            if passed:
                entry["state"] = "validated"
                self.actions.append(f"validated {entry['branch']}")
            else:
                self.eject(
                    entry, "final-failed", done.stdout + "\n" + done.stderr, entry.get("logPath")
                )

    def requeue(self, entry: dict, reason: str) -> None:
        """Back to the front of the queue: its validation is lost or out of date."""
        self.record("rerun", branch=entry["branch"], attempt=entry["attempt"], reason=reason)
        for key in ("run", "slot", "base", "startedAt", "validatedHead", "tree", "path", "changed"):
            entry.pop(key, None)
        entry["state"] = "queued"
        self.state["queue"].remove(entry)
        self.state["queue"].insert(0, entry)
        self.actions.append(f"rerun {entry['branch']} ({reason})")

    def queue_held(self) -> None:
        room = self.dial("lane.queueMax") - len(self.state["queue"])
        while room > 0 and self.state["held"]:
            held = self.state["held"].pop(0)
            held.pop("holdReason", None)
            held["state"] = "queued"
            self.state["queue"].append(held)
            cell = self.cell(held["branch"])
            if cell is not None:
                cell["state"] = "queued"
            self.record("queued", branch=held["branch"], attempt=held["attempt"])
            self.actions.append(f"queued {held['branch']}")
            room -= 1

    def advance_front(self) -> None:
        if not self.state["queue"]:
            return
        entry = self.state["queue"][0]
        if entry.get("state") == "validated":
            if self.main() != entry["base"]:
                self.requeue(entry, "main-moved")
                return
            self.open_pr(entry)
        elif entry.get("state") == "merging":
            self.await_check(entry)

    def open_pr(self, entry: dict) -> None:
        branch = entry["branch"]
        try:
            entry["pushedHead"] = self.world.git.push_branch(entry["path"], branch)
        except WorldError as exc:
            self.eject(entry, "push-failed", str(exc))
            return
        try:
            entry["pr"] = self.world.github.open_pr(
                branch, entry.get("title") or branch, self.pr_body(entry)
            )
        except WorldError as exc:
            self.eject(entry, "pr-failed", str(exc))
            return
        entry["state"] = "merging"
        self.actions.append(f"opened PR {entry['pr']} for {branch}")

    def pr_body(self, entry: dict) -> str:
        cell = self.cell(entry["branch"]) or {}
        text = ""
        if cell.get("worktree") and entry.get("bodyFile"):
            text = self.world.git.read_file(cell["worktree"], entry["bodyFile"]) or ""
        closes = "\n".join(f"Closes #{n}" for n in entry.get("issues", []))
        verified = (
            f"`{' '.join(self.config.validate_command or [])}` passed on {entry['validatedHead']} "
            f"(base {entry['base']}, tree {entry.get('tree')})."
        )
        return f"{text.strip()}\n\n{closes}\n\n## Verification\n\n{verified}\n".lstrip()

    def await_check(self, entry: dict) -> None:
        github, pr = self.world.github, entry["pr"]
        check = self.config.required_check or ""
        try:
            state = github.pr_state(pr)
            status = github.check_status(pr, check) if check else "success"
        except WorldError as exc:
            raise LaneTrouble(f"Reading PR {pr} failed: {exc}") from exc
        if state == "MERGED":
            self.land(entry, without_check=status != "success")
            return
        if status in ("pending", "missing"):
            return
        if status == "failure":
            self.eject(entry, "ci-failed", f"{check} failed on PR {pr}")
            return
        try:
            github.merge_pr(pr, entry["pushedHead"])
        except WorldError as exc:
            self.eject(entry, "merge-failed", str(exc))
            return
        self.land(entry)

    def land(self, entry: dict, without_check: bool = False) -> None:
        branch, pr = entry["branch"], entry["pr"]
        full = len(seated(self.state)) >= self.dial("cells.max")
        self.state["queue"].remove(entry)
        self.record(
            "merged", branch=branch, attempt=entry["attempt"], pr=pr, withoutCheck=without_check
        )
        cell = self.cell(branch)
        if cell is not None:
            self.state["cells"].remove(cell)
        self.event("merged", branch=branch, detail=f"PR {pr}")
        if without_check:
            self.event(
                "merged-without-check",
                branch=branch,
                detail=f"PR {pr} merged without {self.config.required_check} green",
            )
        if full:
            self.event("queue-room", detail=f"A seat is free: {branch} merged")
        run = self._run()
        if run is not None:
            run.setdefault("prs", []).append(
                {"number": pr, "branch": branch, "route": (cell or {}).get("route")}
            )
        self.lane["mergesSinceCoverage"] = int(self.lane.get("mergesSinceCoverage", 0)) + 1
        self.lane.setdefault("mergedSinceCoverage", []).append(pr)
        if any(matches(path, self.config.gate_paths) for path in entry.get("changed", [])):
            self.lane["coverageOwed"] = f"PR {pr} touched gate paths"
        self._main = None  # main moved with the merge.
        self.actions.append(f"merged {branch} (PR {pr})")

    def _run(self) -> dict | None:
        run_id = self.lane.get("runId")
        return next((run for run in self.state["runs"] if run.get("id") == run_id), None)

    def start_validations(self) -> None:
        busy = {e.get("slot") for e in self.state["queue"] if e.get("state") == "validating"}
        free = [str(n) for n in range(1, self.dial("lane.slots") + 1) if str(n) not in busy]
        for entry in [e for e in self.state["queue"] if e.get("state") == "queued"]:
            if not free:
                return
            self.start_validation(entry, free.pop(0))

    def start_validation(self, entry: dict, slot: str) -> None:
        if not self.config.validate_command:
            raise LaneTrouble("The repository adapter names no validate command")
        main, branch = self.main(), entry["branch"]
        log = log_path(branch, entry["attempt"])
        try:
            path = self.world.git.prepare_slot(slot, branch, entry["head"])
        except WorldError as exc:
            self.eject(entry, "entry-invalid", f"{entry['head']} cannot be checked out: {exc}")
            return
        if self.config.install:
            done = self.world.processes.run(self.config.install, cwd=path, label="install")
            if done.returncode != 0:
                self.eject(entry, "entry-invalid", done.stdout + "\n" + done.stderr)
                return
        merged = self.world.git.merge_main(path, main)
        if not merged.clean:
            self.eject(entry, "conflict", f"Conflicts with {main}: {', '.join(merged.conflicts)}")
            return
        handle = self.world.processes.start(
            self.config.validate_command, cwd=path, log=self.absolute(log), label="validate"
        )
        entry.update(
            state="validating",
            slot=slot,
            path=path,
            base=main,
            validatedHead=merged.head,
            tree=self.world.git.tree(path),
            # What the branch changes against main, read while the slot holds it.
            changed=self.world.git.changed_files(path, main),
            startedAt=self.at,
            run=handle,
            logPath=log,
        )
        self.record(
            "validation-started",
            branch=branch,
            attempt=entry["attempt"],
            head=merged.head,
            base=main,
            slot=slot,
        )
        self.actions.append(f"validating {branch} in slot {slot}")

    def coverage_owed(self) -> bool:
        if not self.config.coverage:
            return False
        every = self.dial("lane.coverageEvery")
        return bool(self.lane.get("coverageOwed")) or (
            int(self.lane.get("mergesSinceCoverage", 0)) >= every
        )

    def start_coverage(self) -> None:
        if self.lane.get("coverage") or not self.coverage_owed():
            return
        if any(e.get("state") == "merging" for e in self.state["queue"]):
            return
        main = self.main()
        path = self.world.git.prepare_slot("coverage", "main", main)
        log = f"coverage/{main[:12]}.log"
        handle = self.world.processes.start(
            self.config.coverage, cwd=path, log=self.absolute(log), label="coverage"
        )
        self.lane["coverage"] = {
            "run": handle,
            "main": main,
            "startedAt": self.at,
            "logPath": log,
            "after": list(self.lane.get("mergedSinceCoverage", [])),
        }
        self.actions.append(f"coverage on {main}")

    def poll_coverage(self) -> None:
        running = self.lane.get("coverage")
        if not running:
            return
        try:
            done = self.world.processes.poll(running["run"])
        except WorldError:
            self.lane.pop("coverage")  # Lost with a restart: it runs again.
            return
        if done is None:
            return
        self.lane.pop("coverage")
        passed = done.returncode == 0
        self.record(
            "coverage",
            main=running["main"],
            outcome="passed" if passed else "failed",
            minutes=self.minutes(running["startedAt"]),
            logPath=running["logPath"],
            after=running["after"],
        )
        if passed:
            self.lane.update(coverageOwed=None, mergesSinceCoverage=0, mergedSinceCoverage=[])
            self.actions.append("coverage passed")
            return
        lines = first_lines(done.stdout + "\n" + done.stderr) or ["coverage failed"]
        cause = self.lane.get("coverageOwed")
        detail = f"{lines[0]} (after PRs {', '.join(map(str, running['after'])) or 'none'})"
        self.event(
            "main-broken",
            detail=detail,
            lines=lines,
            logPath=running["logPath"],
            suspects=running["after"],
            gateMerge=cause,
        )
        self.lane["paused"] = True
        self.lane["pauseReason"] = f"main is broken: {lines[0]}"

    def queue_empty(self) -> None:
        idle = not self.state["queue"] and not self.state["held"] and not seated(self.state)
        if not idle or self.coverage_owed() or self.lane.get("coverage"):
            return
        if any(e.get("type") == "queue-empty" and is_open(e) for e in self.state["events"]):
            return
        detail = None
        target = self.lane.get("drainTo")
        if self.lane.get("draining") and target:
            self.world.github.set_variable(LANE_HOST_VARIABLE, target)
            self.lane.update(draining=False, drainTo=None, stopRequested="moved")
            detail = f"The lane host moved to {target}"
        self.event("queue-empty", detail=detail)


def step(factory: Factory) -> list[str]:
    """One step of the loop; what it did."""
    with factory.store.update("lane step") as state:
        return Step(factory, state).run()


def now_of(factory: Factory) -> datetime:
    return factory.world.clock.now()
