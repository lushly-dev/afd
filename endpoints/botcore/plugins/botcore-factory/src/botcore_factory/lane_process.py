"""The lane process: starting it, stopping it, running it, and noticing when it died.

``lane-start`` runs on the lane host only, with a free host-wide lock, ``required_check`` a
required check on main and the toolchains the repository pins. It takes the lock, starts
``python -m botcore_factory.lane_main`` detached (Windows: DETACHED_PROCESS |
CREATE_NEW_PROCESS_GROUP; POSIX: a new session) and hands the lock to it. That process runs the
loop (``run_loop``): it resumes where the last one stopped (a branch that was validating goes
back to the front; a PR that merged meanwhile is landed), steps until asked to stop, then writes
the run's summary and releases the lock.

A dead lane cannot report itself, so ``lane-status`` and ``lane-wait`` check the lock's process
(``check_lane``) and raise ``lane-stopped`` when the lane state says running and no live
process holds the lock.
"""

from __future__ import annotations

import contextlib
import json
import os
import re
import sys
import time
from collections.abc import Callable
from pathlib import Path

from botcore_factory.claims import format_time
from botcore_factory.lane import Step, step
from botcore_factory.lock import HostLock, LaneLocked
from botcore_factory.records import make
from botcore_factory.report import summarize
from botcore_factory.runtime import Factory, Refusal
from botcore_factory.world import LANE_HOST_VARIABLE, WorldError

POLL_SECONDS = 5.0
LANE_MODULE = "botcore_factory.lane_main"
_VERSION = re.compile(r"(\d+)\.(\d+)\.(\d+)")


def host_lock(factory: Factory) -> HostLock:
    """The host-wide lock, above every repository's state directory."""
    return HostLock(factory.store.root.parent / "lane.lock", factory.world.processes)


def require_host(factory: Factory) -> str:
    world = factory.world
    host, me = world.github.get_variable(LANE_HOST_VARIABLE), world.machine.id()
    if not host:
        raise Refusal(
            "HOST_NOT_SET",
            "No lane host is chosen for this repository",
            "lane-host-list shows the connected machines and which are ready; choose one with "
            "lane-host-set",
        )
    if host != me:
        raise Refusal(
            "NOT_LANE_HOST",
            f"The lane host is {host}, not this machine ({me})",
            f"Start the lane on {host}, or move it here with lane-host-set",
        )
    return me


def require_check(factory: Factory) -> None:
    name = factory.config.required_check
    if not name:
        raise Refusal(
            "REQUIRED_CHECK_MISSING",
            "The repository adapter names no required_check",
            "Set required_check under [plugins.factory] and make it a required check on main: "
            "the lane merges on its own only while it is",
        )
    required = factory.world.github.required_checks("main")
    if name not in required:
        raise Refusal(
            "REQUIRED_CHECK_MISSING",
            f"{name} is not a required check on main (required: {', '.join(required) or 'none'})",
            f"Make {name} a required status check on main (branch protection or a ruleset): the "
            "lane merges on its own only while it is",
        )


def pins(target: Path) -> dict[str, str]:
    """The toolchains the repository pins: ``packageManager`` exactly, ``engines.node`` as a
    lower bound. Other pins are not read yet."""
    try:
        package = json.loads((target / "package.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    found = {}
    manager = str(package.get("packageManager", ""))
    if "@" in manager:
        tool, version = manager.split("@", 1)
        found[tool] = "==" + version.split("+", 1)[0]
    node = str((package.get("engines") or {}).get("node", ""))
    if node.startswith(">="):
        found["node"] = node.replace(" ", "")
    return found


def _version(text: str | None) -> tuple[int, ...] | None:
    match = _VERSION.search(text or "")
    return tuple(int(part) for part in match.groups()) if match else None


def toolchain_mismatches(factory: Factory) -> list[str]:
    problems = []
    for tool, rule in pins(factory.target).items():
        have = factory.world.machine.tool_version(tool)
        want = _version(rule)
        got = _version(have)
        if got is None:
            problems.append(f"{tool} {rule} (not installed)")
        elif rule.startswith("==") and got != want or rule.startswith(">=") and got < want:
            problems.append(f"{tool} {rule} (have {have})")
    return problems


def new_run(state: dict, at: str) -> str:
    numbers = [int(m[1]) for r in state["runs"] if (m := re.fullmatch(r"run-(\d+)", r["id"]))]
    run_id = f"run-{max(numbers, default=0) + 1}"
    state["runs"].append({"id": run_id, "startedAt": at})
    return run_id


def _now(factory: Factory) -> str:
    return format_time(factory.world.clock.now())


def lane_start(factory: Factory) -> dict:
    me = require_host(factory)
    lock = host_lock(factory)
    live = lock.live_holder()
    if live is not None:
        raise Refusal(
            "LANE_LOCKED",
            f"A lane already runs on this machine: pid {live.get('pid')} for "
            f"{live.get('repository', 'a repository')}",
            "lane-status says what it is doing; stop it with lane-stop first",
        )
    require_check(factory)
    mismatches = toolchain_mismatches(factory)
    if mismatches:
        raise Refusal(
            "TOOLCHAIN_MISMATCH",
            f"This machine's toolchains differ from the repository's pins: {'; '.join(mismatches)}",
            "Install the pinned versions, then lane-start again",
            mismatches=mismatches,
        )
    repository = factory.world.github.repository()
    target = str(factory.target)
    with factory.store.update("lane-start") as state:
        try:
            lock.acquire(os.getpid(), repository=repository)
        except LaneLocked as locked:
            raise Refusal(
                "LANE_LOCKED", f"A lane already runs here: {locked}", "Stop it with lane-stop first"
            ) from locked
        try:
            pid = factory.world.processes.start_detached(
                [sys.executable, "-m", LANE_MODULE, "--target", target],
                cwd=target,
                log=str(factory.store.root / "lane.log"),
            )
        except WorldError as exc:
            lock.release(os.getpid())
            raise Refusal(
                "START_FAILED",
                f"The lane process did not start: {exc}",
                "Check the Python environment botcore-factory is installed in",
            ) from exc
        lock.hand_over(pid)
        at = _now(factory)
        run_id = new_run(state, at)
        state["lane"].update(
            running=True,
            pid=pid,
            runId=run_id,
            startedAt=at,
            stopRequested=None,
            paused=False,
            pauseReason=None,
        )
        factory.store.append_record(make("run-started", at, run_id, host=me))
    return {"running": True, "runId": run_id, "pid": pid}


def _end_run(factory: Factory, state: dict, reason: str) -> None:
    """Close the run: requeue what was validating, write the summary, release the lock."""
    lane, at = state["lane"], _now(factory)
    cleanup = Step(factory, state)
    for entry in reversed([e for e in state["queue"] if e.get("state") == "validating"]):
        if entry.get("run"):
            with contextlib.suppress(WorldError):
                factory.world.processes.kill(entry["run"])
        cleanup.requeue(entry, "restart")
    run_id = lane.get("runId")
    if run_id:
        factory.store.append_record(make("run-stopped", at, run_id, reason=reason))
        run = next((r for r in state["runs"] if r.get("id") == run_id), None)
        if run is not None:
            history = factory.store.read_records()
            run.update(summarize(history, run_id, run.get("startedAt"), at), stoppedAt=at)
    lane.update(running=False, pid=None, stopRequested=None)
    host_lock(factory).release()


def lane_stop(factory: Factory, force: bool) -> dict:
    holder = host_lock(factory).live_holder()
    with factory.store.update("lane-stop") as state:
        validating = [e["branch"] for e in state["queue"] if e.get("state") == "validating"]
        if holder is not None and validating and not force:
            state["lane"]["stopRequested"] = "after-validation"
            return {"running": True, "stopping": True, "finishing": validating}
        if holder is not None:
            factory.world.processes.terminate(holder["pid"])
        if state["lane"].get("running") or holder is not None:
            _end_run(factory, state, "forced" if force and validating else "stopped")
    return {"running": False}


def check_lane(factory: Factory) -> None:
    """Raise ``lane-stopped`` when the state says running but the lock's process is gone."""
    if not factory.store.read()["lane"].get("running"):
        return
    if host_lock(factory).live_holder() is not None:
        return
    with factory.store.update("lane-stopped") as state:
        lane = state["lane"]
        if not lane.get("running"):
            return
        pid = lane.get("pid")
        _end_run(factory, state, "died")
        Step(factory, state).event(
            "lane-stopped",
            detail=f"The lane process{f' (pid {pid})' if pid else ''} is gone; read its log",
            logPath="lane.log",
        )


def resume(factory: Factory) -> list[str]:
    """Take up where the last lane stopped: validations go back to the front, and a PR that
    merged meanwhile is landed."""
    with factory.store.update("lane resume") as state:
        resumed = Step(factory, state)
        for entry in reversed([e for e in state["queue"] if e.get("state") == "validating"]):
            resumed.requeue(entry, "restart")
        for entry in [e for e in state["queue"] if e.get("state") == "merging"]:
            try:
                if factory.world.github.pr_state(entry["pr"]) == "MERGED":
                    resumed.land(entry)
            except WorldError:
                pass  # Read again by the first step.
        return resumed.actions


def run_loop(
    factory: Factory,
    *,
    steps: int | None = None,
    sleep: Callable[[float], None] = time.sleep,
    poll: float = POLL_SECONDS,
) -> dict:
    """The lane in this process: until asked to stop (or for ``steps`` steps)."""
    me = require_host(factory)
    lock = host_lock(factory)
    holder = lock.live_holder()
    if holder is not None and holder.get("pid") != os.getpid():
        raise Refusal(
            "LANE_LOCKED",
            f"A lane already runs here: pid {holder.get('pid')}",
            "Stop it with lane-stop first",
        )
    if holder is None:
        lock.acquire(os.getpid(), repository=factory.world.github.repository())
        with factory.store.update("lane-run") as state:
            at = _now(factory)
            run_id = new_run(state, at)
            state["lane"].update(running=True, pid=os.getpid(), runId=run_id, startedAt=at)
            factory.store.append_record(make("run-started", at, run_id, host=me))
    resume(factory)
    count, reason = 0, "stopped"
    while True:
        step(factory)  # Turns the lane's trouble into a lane-error itself.
        count += 1
        state = factory.store.read()
        lane = state["lane"]
        busy = any(e.get("state") == "validating" for e in state["queue"])
        if lane.get("stopRequested") and not busy:
            break
        if not lane.get("running"):
            reason = "stopped"
            break
        if steps is not None and count >= steps:
            break
        sleep(poll)
    with factory.store.update("lane end") as state:
        if state["lane"].get("running"):
            _end_run(factory, state, reason)
    return {"running": False, "steps": count, "runId": factory.store.read()["lane"].get("runId")}
