"""The lane process: starting it, stopping it, running it, and noticing when it died.

``lane-start`` runs on the lane host only, with a free host-wide lock, ``required_check`` a
required check on main, the Node ``.nvmrc`` names installed and the toolchains the repository
pins. It takes the lock, starts
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
from botcore_factory.state import StateLocked
from botcore_factory.world import LANE_HOST_VARIABLE, WorldError, nvmrc_version

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
            "Set required_check under [plugins.factory] and make it a required check on the base "
            "branch: the lane merges on its own only while it is",
        )
    base = factory.config.base_branch
    required = factory.world.github.required_checks(base)
    if name not in required:
        raise Refusal(
            "REQUIRED_CHECK_MISSING",
            f"{name} is not a required check on {base} (required: {', '.join(required) or 'none'})",
            f"Make {name} a required status check on {base} (branch protection or a ruleset): "
            "the lane merges on its own only while it is",
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


def require_node(factory: Factory, then: str) -> None:
    """Refuse when the Node the checkout's ``.nvmrc`` names is not installed: the lane validates
    on it, never on whatever ``node`` comes first on PATH."""
    try:
        spec = (factory.target / ".nvmrc").read_text(encoding="utf-8").strip()
    except OSError:
        return
    if spec and nvmrc_version(spec) is None:
        raise Refusal(
            "NODE_UNPINNED",
            f"The repository's .nvmrc names {spec!r}, an alias the lane does not resolve",
            f"Pin a version number in .nvmrc (such as 26), then {then}",
            nvmrc=spec,
        )
    if spec and factory.world.machine.node_bin(spec) is None:
        raise Refusal(
            "NODE_MISSING",
            f"Node {spec}, which the repository's .nvmrc names, is not installed on this machine",
            f"Install it with `fnm install {spec}` (or `nvm install {spec}`), then {then}",
            nvmrc=spec,
        )


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
    require_node(factory, "lane-start again")
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


def ours(factory: Factory, holder: dict | None) -> bool:
    """Whether the host's lane holder serves this repository (the lock is one per machine)."""
    if holder is None:
        return False
    repository = holder.get("repository")
    return repository is None or repository == factory.world.github.repository()


def _end_run(factory: Factory, state: dict, reason: str, *, kill: bool, pid: int | None) -> None:
    """Close the run: with ``kill``, requeue what was validating and kill those jobs; without
    (a status read), leave them to the next lane's ``resume``. Write the summary, release the
    lock ``pid`` held."""
    lane, at = state["lane"], _now(factory)
    if kill:
        cleanup = Step(factory, state)
        for entry in reversed([e for e in state["queue"] if e.get("state") == "validating"]):
            cleanup.requeue(entry, "restart")
    run_id = lane.get("runId")
    if run_id:
        factory.store.append_record(make("run-stopped", at, run_id, reason=reason))
        run = next((r for r in state["runs"] if r.get("id") == run_id), None)
        if run is not None:
            history = factory.store.read_records()
            run.update(summarize(history, run_id, run.get("startedAt"), at), stoppedAt=at)
    lane.update(running=False, pid=None, stopRequested=None)
    if pid is not None:
        host_lock(factory).release(pid)


def lane_stop(factory: Factory, force: bool) -> dict:
    lock = host_lock(factory)
    holder = lock.live_holder()
    foreign = holder is not None and not ours(factory, holder)
    if foreign:
        holder = None  # Another repository's lane: never this command's to stop or unlock.
    with factory.store.update("lane-stop") as state:
        validating = [e["branch"] for e in state["queue"] if e.get("state") == "validating"]
        if holder is not None and validating and not force:
            state["lane"]["stopRequested"] = "after-validation"
            return {"running": True, "stopping": True, "finishing": validating}
        pid = holder.get("pid") if holder else None
        if pid is not None and not factory.world.processes.terminate(pid, holder.get("startedAt")):
            raise Refusal(
                "LANE_LOCKED",
                f"The lane process (pid {holder['pid']}) could not be confirmed as the one "
                "that took the lock, so it was not stopped",
                "Stop it from its own machine, or check the pid by hand",
            )
        if state["lane"].get("running") or holder is not None:
            pid = holder.get("pid") if holder else None if foreign else state["lane"].get("pid")
            _end_run(
                factory, state, "forced" if force and validating else "stopped", kill=True, pid=pid
            )
    return {"running": False}


def check_lane(factory: Factory) -> None:
    """Raise ``lane-stopped`` when the state says running but this repository's lane process is
    gone. A status read only marks the lane stopped: it kills nothing."""
    if not factory.store.read()["lane"].get("running"):
        return
    holder = host_lock(factory).live_holder()
    if holder is not None and (holder.get("pid") is None or ours(factory, holder)):
        return
    with factory.store.update("lane-stopped") as state:
        lane = state["lane"]
        if not lane.get("running"):
            return
        pid = lane.get("pid")
        _end_run(factory, state, "died", kill=False, pid=pid if holder is None else None)
        Step(factory, state).event(
            "lane-stopped",
            detail=f"The lane process{f' (pid {pid})' if pid else ''} is gone; read its log",
            logPath="lane.log",
        )


def resume(factory: Factory) -> list[str]:
    """Take up where the last lane stopped: validations go back to the front (behind a branch
    already merging), their orphaned jobs killed when pid and start time still match, and a PR
    that merged meanwhile is landed."""
    with factory.store.update("lane resume") as state:
        resumed = Step(factory, state)
        for entry in reversed([e for e in state["queue"] if e.get("state") == "validating"]):
            resumed.requeue(entry, "restart")  # Kills its job: never two in one slot.
        for entry in [e for e in state["queue"] if e.get("state") == "merging"]:
            with contextlib.suppress(WorldError):  # Read again by the first step.
                if factory.world.github.pr_state(entry["pr"]) == "MERGED":
                    resumed.land(entry)
        return resumed.actions


def run_loop(
    factory: Factory,
    *,
    steps: int | None = None,
    sleep: Callable[[float], None] = time.sleep,
    poll: float = POLL_SECONDS,
) -> dict:
    """The lane in this process: until asked to stop (or for ``steps`` steps). It refuses on the
    same grounds as lane-start."""
    me = require_host(factory)
    require_check(factory)
    require_node(factory, "start the lane again")
    mismatches = toolchain_mismatches(factory)
    if mismatches:
        raise Refusal(
            "TOOLCHAIN_MISMATCH",
            f"This machine's toolchains differ from the repository's pins: {'; '.join(mismatches)}",
            "Install the pinned versions, then start the lane again",
            mismatches=mismatches,
        )
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
    count = 0
    while True:
        try:
            step(factory)  # Turns the lane's trouble into a lane-error itself.
        except StateLocked:
            sleep(poll)  # A command is writing the state: the next step reads it.
            continue
        count += 1
        state = factory.store.read()
        lane = state["lane"]
        busy = any(e.get("state") == "validating" for e in state["queue"])
        if lane.get("stopRequested") and not busy:
            break
        if not lane.get("running"):
            break
        if steps is not None and count >= steps:
            break
        sleep(poll)
    with factory.store.update("lane end") as state:
        if state["lane"].get("running"):
            _end_run(factory, state, "stopped", kill=True, pid=os.getpid())
    return {"running": False, "steps": count, "runId": factory.store.read()["lane"].get("runId")}
