"""The lane process: starting it, stopping it, running it, and noticing when it died.

``lane-start`` runs on the lane host only, with a free host-wide lock, ``required_check`` a
required check on main, the Node ``.nvmrc`` names installed and the toolchains the repository
pins, read on that Node as validation runs (its bin directory first on ``PATH``). It takes the
lock, starts
``python -m botcore_factory.lane_main`` detached (Windows: DETACHED_PROCESS |
CREATE_NEW_PROCESS_GROUP; POSIX: a new session) and hands the lock to it. On Windows a venv's
``python.exe`` is a launcher that runs the real interpreter as its child, so that child takes the
lock and the lane's pid over from its parent. The interpreter runs the loop (``run_loop``): it
resumes where the last one stopped (a branch that was validating goes back to the front; a PR
that merged meanwhile is landed), steps until asked to stop, then writes the run's summary and
releases the lock.

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
from typing import Any

from botcore_factory.claims import format_time
from botcore_factory.lane import Step, step
from botcore_factory.lane_base import AT_THE_FRONT
from botcore_factory.lock import HostLock, LaneLocked
from botcore_factory.records import make
from botcore_factory.runtime import EXTERNAL, Factory, Refusal, call
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
            recovery=call("lane-host-list"),
        )
    if host != me:
        raise Refusal(
            "NOT_LANE_HOST",
            f"The lane host is {host}, not this machine ({me})",
            f"Start the lane on {host}, or move it here with lane-host-set",
            recovery=EXTERNAL,
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
            recovery=EXTERNAL,
        )
    base = factory.config.base_branch
    required = factory.world.github.required_checks(base)
    if name not in required:
        raise Refusal(
            "REQUIRED_CHECK_MISSING",
            f"{name} is not a required check on {base} (required: {', '.join(required) or 'none'})",
            f"Make {name} a required status check on {base} (branch protection or a ruleset): "
            "the lane merges on its own only while it is",
            recovery=EXTERNAL,
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


def nvmrc_node(factory: Factory) -> tuple[str, str | None]:
    """The checkout's ``.nvmrc`` (empty without one) and the bin directory of the Node it names,
    found as validation finds it; None when that Node is not installed or ``.nvmrc`` is an
    alias."""
    try:
        spec = (factory.target / ".nvmrc").read_text(encoding="utf-8").strip()
    except OSError:
        return "", None
    if not spec or nvmrc_version(spec) is None:
        return spec, None
    return spec, factory.world.machine.node_bin(spec)


def toolchain_mismatches(factory: Factory) -> list[str]:
    """The pins this machine misses, read as validation runs: on the ``.nvmrc`` Node, with its
    bin directory first on ``PATH``, so ``node`` and the ``pnpm`` found there are the ones a
    validation job runs (lushly-dev/afd#1352). Without ``.nvmrc``, the host's ``PATH``."""
    spec, node = nvmrc_node(factory)
    rules = pins(factory.target)
    problems = []
    if spec and node is None:
        why = "an alias" if nvmrc_version(spec) is None else "not installed"
        problems.append(f"node {spec} from .nvmrc ({why})")
        rules.pop("node", None)  # Not the Node validation would run on.
    path = [node] if node else []
    for tool, rule in rules.items():
        have = factory.world.machine.tool_version(tool, path)
        want = _version(rule)
        got = _version(have)
        if got is None:
            problems.append(f"{tool} {rule} (not installed)")
        elif want is not None and (
            (rule.startswith("==") and got != want) or (rule.startswith(">=") and got < want)
        ):
            problems.append(f"{tool} {rule} (have {have})")
    return problems


def require_toolchains(factory: Factory, then: str) -> None:
    """Refuse unless the ``.nvmrc`` Node is installed and the toolchains meet the pins."""
    spec, node = nvmrc_node(factory)
    if spec and nvmrc_version(spec) is None:
        raise Refusal(
            "NODE_UNPINNED",
            f"The repository's .nvmrc names {spec!r}, an alias the lane does not resolve",
            f"Pin a version number in .nvmrc (such as 26), then {then}",
            recovery=EXTERNAL,
            nvmrc=spec,
        )
    if spec and node is None:
        raise Refusal(
            "NODE_MISSING",
            f"Node {spec}, which the repository's .nvmrc names, is not installed on this machine",
            f"Install it with `fnm install {spec}` (or `nvm install {spec}`), then {then}",
            recovery=EXTERNAL,
            nvmrc=spec,
        )
    mismatches = toolchain_mismatches(factory)
    if mismatches:
        raise Refusal(
            "TOOLCHAIN_MISMATCH",
            f"This machine's toolchains differ from the repository's pins: {'; '.join(mismatches)}",
            f"Install the pinned versions{f' for Node {spec}' if spec else ''}, then {then}",
            recovery=EXTERNAL,
            mismatches=mismatches,
        )


def new_run(state: dict[str, Any], at: str) -> str:
    numbers = [
        int(m[1]) for r in state["runs"] if (m := re.fullmatch(r"run-(\d+)", str(r.get("id"))))
    ]
    number = max([state.get("runSeq", 0), *numbers]) + 1
    state["runSeq"] = number
    run_id = f"run-{number}"
    state["runs"].append({"id": run_id, "startedAt": at})
    return run_id


def _now(factory: Factory) -> str:
    return format_time(factory.world.clock.now())


def lane_start(factory: Factory) -> dict[str, Any]:
    me = require_host(factory)
    lock = host_lock(factory)
    live = lock.live_holder()
    if live is not None:
        raise Refusal(
            "LANE_LOCKED",
            f"A lane already runs on this machine: pid {live.get('pid')} for "
            f"{live.get('repository', 'a repository')}",
            "Stop it with lane-stop first; lane-status says what it is doing",
            recovery=call("lane-stop", then_retry=True),
        )
    require_check(factory)
    require_toolchains(factory, "lane-start again")
    repository = factory.world.github.repository()
    target = str(factory.target)
    with factory.store.update("lane-start") as state:
        try:
            lock.acquire(os.getpid(), repository=repository)
        except LaneLocked as locked:
            raise Refusal(
                "LANE_LOCKED",
                f"A lane already runs here: {locked}",
                "Stop it with lane-stop first",
                recovery=call("lane-stop", then_retry=True),
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
                recovery=EXTERNAL,
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


def ours(factory: Factory, holder: dict[str, Any] | None) -> bool:
    """Whether the host's lane holder serves this repository (the lock is one per machine)."""
    if holder is None:
        return False
    repository = holder.get("repository")
    return repository is None or repository == factory.world.github.repository()


def _end_run(
    factory: Factory, state: dict[str, Any], reason: str, *, kill: bool, pid: int | None
) -> None:
    """Close the run: with ``kill``, requeue what was validating and kill those jobs (plus any
    running coverage job); without (a status read), leave them to the next lane's ``resume``.
    Write the summary, release the lock ``pid`` held."""
    lane, at = state["lane"], _now(factory)
    release_pid = pid if pid is not None else lane.get("pid")
    if kill:
        cleanup = Step(factory, state)
        for entry in reversed([e for e in state["queue"] if e.get("state") == "validating"]):
            cleanup.requeue(entry, "restart")
        cov = lane.pop("coverage", None)
        if isinstance(cov, dict) and cov.get("run"):
            with contextlib.suppress(WorldError):
                factory.world.processes.kill(cov["run"])
        if release_pid is not None and factory.world.validation_lock is not None:
            with contextlib.suppress(WorldError):
                repo = factory.world.github.repository()
                factory.world.validation_lock.reconcile(repo, int(release_pid), [])
                factory.world.validation_lock.withdraw_waiter(repo, int(release_pid))
    run_id = lane.get("runId")
    if run_id:
        factory.store.append_record(make("run-stopped", at, run_id, reason=reason))
        run = next((r for r in state["runs"] if r.get("id") == run_id), None)
        if run is not None:
            run.update(
                factory.store.summarize_run(run_id, run.get("startedAt"), at),
                stoppedAt=at,
            )
    lane.pop("waitingOnHostLock", None)
    lane.update(running=False, pid=None, stopRequested=None)
    if pid is not None:
        host_lock(factory).release(pid)


def lane_stop(factory: Factory, force: bool) -> dict[str, Any]:
    lock = host_lock(factory)
    holder = lock.live_holder()
    foreign = holder is not None and not ours(factory, holder)
    if foreign:
        holder = None  # Another repository's lane: never this command's to stop or unlock.
    with factory.store.update("lane-stop") as state:
        validating = [e["branch"] for e in state["queue"] if e.get("state") == "validating"]
        finishing = [*validating, *(["coverage"] if state["lane"].get("coverage") else [])]
        if holder is not None and finishing and not force:
            state["lane"]["stopRequested"] = "after-validation"
            return {"running": True, "stopping": True, "finishing": finishing}
        pid = holder.get("pid") if holder is not None else None
        if (
            holder is not None
            and pid is not None
            and not factory.world.processes.terminate(pid, holder.get("startedAt"))
        ):
            raise Refusal(
                "LANE_LOCKED",
                f"The lane process (pid {holder['pid']}) could not be confirmed as the one "
                "that took the lock, so it was not stopped",
                "Stop it from its own machine, or check the pid by hand",
                recovery=EXTERNAL,
            )
        if state["lane"].get("running") or holder is not None:
            pid = holder.get("pid") if holder else None if foreign else state["lane"].get("pid")
            _end_run(
                factory, state, "forced" if force and finishing else "stopped", kill=True, pid=pid
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
    already merging), their orphaned jobs (and any orphaned coverage job) killed when pid and
    start time still match, and a PR that merged meanwhile is landed, one that waited in GitHub's
    merge queue included (the first step reads a queued one that has not merged)."""
    with factory.store.update("lane resume") as state:
        resumed = Step(factory, state)
        for entry in reversed([e for e in state["queue"] if e.get("state") == "validating"]):
            resumed.requeue(entry, "restart")  # Kills its job: never two in one slot.
        cov = state["lane"].pop("coverage", None)
        if isinstance(cov, dict) and cov.get("run"):
            with contextlib.suppress(WorldError):
                factory.world.processes.kill(cov["run"])
        state["lane"].pop("waitingOnHostLock", None)
        if factory.world.validation_lock is not None:
            with contextlib.suppress(WorldError):
                repo = factory.world.github.repository()
                pid = resumed.host_lock_pid()
                factory.world.validation_lock.reconcile(repo, pid, [])
                factory.world.validation_lock.withdraw_waiter(repo, pid)
        for entry in [e for e in state["queue"] if e.get("state") in AT_THE_FRONT]:
            with contextlib.suppress(WorldError):  # Read again by the first step.
                progress = factory.world.github.merge_progress(entry["pr"])
                if progress.state == "MERGED":
                    resumed.land(entry, merged_head=progress.head)
        return resumed.actions


def started_by_parent(factory: Factory, state: dict[str, Any], holder: dict[str, Any]) -> bool:
    """Whether lane-start handed this repository's lock to this process's parent (a launcher)."""
    parent = os.getppid()
    return (
        holder.get("pid") == parent
        and holder.get("pid") != os.getpid()
        and ours(factory, holder)
        and state["lane"].get("running") is True
        and state["lane"].get("pid") == parent
    )


def run_loop(
    factory: Factory,
    *,
    steps: int | None = None,
    sleep: Callable[[float], None] = time.sleep,
    poll: float = POLL_SECONDS,
) -> dict[str, Any]:
    """The lane in this process: until asked to stop (or for ``steps`` steps). It refuses on the
    same grounds as lane-start."""
    me = require_host(factory)
    require_check(factory)
    require_toolchains(factory, "start the lane again")
    lock = host_lock(factory)
    with factory.store.update("lane-run") as state:
        # Under the state lock, so a lane-start still handing the lock over has finished.
        holder, pid = lock.live_holder(), os.getpid()
        try:
            if holder is None:
                lock.acquire(pid, repository=factory.world.github.repository())
                at = _now(factory)
                run_id = new_run(state, at)
                state["lane"].update(running=True, pid=pid, runId=run_id, startedAt=at)
                factory.store.append_record(make("run-started", at, run_id, host=me))
            elif started_by_parent(factory, state, holder):
                # A Windows venv's python.exe is a launcher that runs the interpreter as its
                # child: lane-start handed the lock to the launcher, so the interpreter takes it.
                lock.hand_over(pid, from_pid=holder["pid"])
                state["lane"]["pid"] = pid
            elif holder.get("pid") != pid:
                raise LaneLocked(holder)
        except LaneLocked as locked:
            raise Refusal(
                "LANE_LOCKED",
                f"A lane already runs here: {locked}",
                "Stop it with lane-stop first",
                recovery=call("lane-stop", then_retry=True),
            ) from locked
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
        busy = any(e.get("state") == "validating" for e in state["queue"]) or bool(
            lane.get("coverage")
        )
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
