"""Coverage on the base branch, and the lane going quiet.

Coverage runs every ``lane.coverageEvery`` merges and at once after a merge that touched
``gate_paths``; the front of the queue waits while a gate merge's coverage is owed. A passing run
clears only the merges it ran after, so a merge that landed meanwhile still owes one. A failure is
``main-broken`` naming those merges, and pauses the lane.
"""

from __future__ import annotations

import contextlib
from typing import Any

from botcore_factory.cells import build_dir, disk_short, seated
from botcore_factory.events import is_open
from botcore_factory.lane_base import (
    AT_THE_FRONT,
    LaneTrouble,
    StepBase,
    first_lines,
)
from botcore_factory.runtime import Refusal
from botcore_factory.validation_lock import parse_job_handle
from botcore_factory.world import LANE_HOST_VARIABLE, WorldError, nvmrc_version

INSTALL_TIMEOUT_SECONDS = 1800


NVMRC_DELETED = (
    "NODE_MISSING: the branch deletes .nvmrc, where the repository pins its Node: keep the "
    "base's .nvmrc, so the lane validates on the pinned Node, not the lane host's default"
)
NVMRC_BLANK = (
    "NODE_MISSING: the branch leaves .nvmrc blank, where the repository pins its Node: pin a "
    "version number there (such as 26), so the lane validates on it, not the lane host's default"
)


class NodeUnavailable(LaneTrouble):
    """The Node a checkout's ``.nvmrc`` names is not installed, or ``.nvmrc`` is an alias. As
    the lane's trouble it pauses the lane (main's own ``.nvmrc``); ``for_branch`` says it to a
    branch whose own change to ``.nvmrc`` it is, which is ejected as ``node-missing``."""

    def __init__(self, spec: str, cwd: str) -> None:
        self.spec = spec
        self.alias = nvmrc_version(spec) is None
        if self.alias:
            message = (
                f".nvmrc in {cwd} names {spec!r}, an alias the lane does not resolve: pin a "
                "version number there (such as 26), then lane-resume"
            )
        else:
            message = (
                f"Node {spec}, which .nvmrc in {cwd} names, is not installed on this machine: "
                f"install it (`fnm install {spec}` or `nvm install {spec}`), then lane-resume"
            )
        super().__init__(message)

    def for_branch(self) -> str:
        """NODE_MISSING for the cell: what to change, or who installs the Node."""
        if self.alias:
            return (
                f"NODE_MISSING: the branch's .nvmrc names {self.spec!r}, an alias the lane does "
                "not resolve: pin a version number, or keep the base's .nvmrc"
            )
        return (
            f"NODE_MISSING: the branch's .nvmrc names Node {self.spec}, which the lane host has "
            f"not installed: keep the base's .nvmrc, or have the owner install it on the lane "
            f"host (`fnm install {self.spec}` or `nvm install {self.spec}`) before enqueueing "
            "again"
        )


class Coverage(StepBase):
    def job_steps(
        self, label: str, command: list[str], cwd: str, slot: str, branch: str
    ) -> list[dict[str, Any]]:
        """Install (bounded by a timeout), then the command: one background job, on the Node
        the checkout at ``cwd`` names in ``.nvmrc``, with ``CARGO_TARGET_DIR`` at the slot's
        build directory (``slot_build``)."""
        node = self.node_bin(cwd)
        env = {"CARGO_TARGET_DIR": self.slot_build(slot, branch)}
        steps = []
        if self.config.install:
            steps.append(
                {
                    "label": "install",
                    "args": self.config.install,
                    "timeout": INSTALL_TIMEOUT_SECONDS,
                }
            )
        steps.append({"label": label, "args": command})
        return [{**s, "env": env, **({"path": [node]} if node else {})} for s in steps]

    def clean_slot_paths(self, slot: str) -> list[str]:
        """Remove configured ignored build output inside ``slot``'s checkout (lushly-dev/afd#1659).
        No-op when ``slot_clean_paths`` is empty or ``slot`` was already cleaned earlier in this
        step."""
        paths = self.config.slot_clean_paths
        if not paths or slot in self._cleaned_slots:
            return []
        removed = self.world.git.clean_slot_paths(slot, paths)
        self._cleaned_slots.add(slot)
        return removed

    def sweep_builds(self, free: list[str]) -> None:
        """Remove the build output of free slots whose branch left the queue (merged, ejected or
        dropped) before free disk is read, so what they kept does not pause the lane. Also cleans
        configured in-slot build paths on free slots with no queued owner (lushly-dev/afd#1659)."""
        builds = self.lane.get("slotBuilds") or {}
        queued = {entry["branch"] for entry in self.state["queue"]}
        for slot in free:
            last = builds.get(slot)
            if last is not None and last.get("branch") not in queued:
                self.world.git.remove_build(last["path"])
                self.clean_slot_paths(slot)
                builds.pop(slot)
                self.actions.append(f"removed slot {slot}'s build output for {last['branch']}")
            elif last is None:
                cleaned = self.clean_slot_paths(slot)
                if cleaned:
                    self.actions.append(
                        f"cleaned slot {slot}'s build output ({', '.join(cleaned)})"
                    )
        if not self.lane.get("coverage"):
            cleaned = self.clean_slot_paths("coverage")
            if cleaned:
                self.actions.append(f"cleaned coverage slot's build output ({', '.join(cleaned)})")

    def slot_build(self, slot: str, branch: str) -> str:
        """The slot's build directory (lushly-dev/afd#1641), under ``host.buildDir``. A slot that
        takes another branch is recycled: the build output it kept for the last one is removed
        first, so each slot holds one branch's build at most (the same branch validated again
        keeps it). Where it was before ``host.buildDir`` changed is removed too."""
        path = build_dir(self.factory, self.state["dials"], slot)
        builds = self.lane.setdefault("slotBuilds", {})
        last = builds.get(slot)
        if last is not None and last.get("path") != path:
            self.world.git.remove_build(last["path"])
        if last is None or last.get("branch") != branch or last.get("path") != path:
            self.world.git.remove_build(path)
            self.clean_slot_paths(slot)
            if last is not None:
                self.actions.append(f"recycled slot {slot}'s build output for {branch or 'main'}")
        elif slot == "coverage":
            self.clean_slot_paths(slot)
        # This slot is now being handed to a build; a later recycle on the same Step cleans again.
        self._cleaned_slots.discard(slot)
        builds[slot] = {"branch": branch, "path": path}
        return path

    def node_bin(self, cwd: str) -> str | None:
        """The bin directory of the Node the checkout's ``.nvmrc`` names; None without one.
        That Node missing raises ``NodeUnavailable``: never validate on another one."""
        spec = (self.world.git.read_file(cwd, ".nvmrc") or "").strip()
        if not spec:
            return None
        found = self.world.machine.node_bin(spec) if nvmrc_version(spec) else None
        if found is None:
            raise NodeUnavailable(spec, cwd)
        return found

    def coverage_owed(self) -> bool:
        if not self.config.coverage:
            return False
        every = self.dial("lane.coverageEvery")
        return (
            bool(self.lane.get("gateOwed"))
            or len(self.lane.get("mergedSinceCoverage", [])) >= every
        )

    def start_coverage(self) -> None:
        if self.lane.get("coverage") or not self.coverage_owed():
            return
        if any(e.get("state") in AT_THE_FRONT for e in self.state["queue"]):
            return
        if self._blocked_on_host_lock is not None:
            return
        busy = {
            e.get("slot")
            for e in self.state["queue"]
            if e.get("state") in ("validating", "validated")
        }
        free = [str(n) for n in range(1, self.dial("lane.slots") + 1) if str(n) not in busy]
        self.sweep_builds(free)
        # Check free disk before starting coverage (lushly-dev/afd#1660), as validations do:
        # a second ENOSPC on the same main after lane-resume would otherwise report main-broken.
        try:
            short = disk_short(self.factory, self.state["dials"])
        except Refusal as refusal:
            raise LaneTrouble(f"{refusal.message}. {refusal.suggestion}") from refusal
        if short is not None:
            raise LaneTrouble(
                f"Coverage waits: {short.message}. {short.suggestion}; then lane-resume"
            )
        lock = self.world.validation_lock
        acquired = False
        if lock is not None:
            blocker = lock.try_acquire(
                "coverage", self.world.github.repository(), self.host_lock_pid()
            )
            if blocker is not None:
                self._blocked_on_host_lock = blocker
                self.actions.append(
                    f"waiting on host validation lock ({blocker.get('lane')}: "
                    f"{blocker.get('repository')})"
                )
                return
            acquired = True
        started = False
        try:
            base = self.base_head(fresh=True)
            path = self.world.git.prepare_slot("coverage", "", base)
            log = f"coverage/{base[:12]}.log"
            handle = self.world.processes.start_job(
                self.job_steps("coverage", self.config.coverage or [], path, "coverage", ""),
                cwd=path,
                log=self.absolute(log),
                label="coverage",
            )
            started = True
            self.lane["coverage"] = {
                "run": handle,
                "main": base,
                "startedAt": self.at,
                "logPath": log,
                "after": list(self.lane.get("mergedSinceCoverage", [])),
            }
            if acquired and lock is not None:
                job_pid, job_started = parse_job_handle(handle)
                lock.set_job(
                    "coverage",
                    self.world.github.repository(),
                    self.host_lock_pid(),
                    job_pid,
                    job_started,
                )
            self.actions.append(f"coverage on {base}")
        finally:
            if acquired and not started and lock is not None:
                with contextlib.suppress(WorldError):
                    self.release_host_hold("coverage")

    def poll_coverage(self) -> None:
        running = self.lane.get("coverage")
        if not running:
            return
        try:
            done = self.world.processes.poll(running["run"])
        except WorldError:
            self.lane.pop("coverage")  # Lost with a restart: it runs again.
            with contextlib.suppress(WorldError):
                self.release_host_hold("coverage")
            return
        if done is None:
            return
        self.lane.pop("coverage")
        with contextlib.suppress(WorldError):
            self.release_host_hold("coverage")
        try:
            self.clean_slot_paths("coverage")
        except WorldError as exc:
            self.actions.append(f"coverage slot cleanup deferred: {exc}")
        passed = done.returncode == 0
        full = None if passed else done.disk_full
        if full is not None and running.get("main") != self.lane.get("diskFullCoverage"):
            self.lane["diskFullCoverage"] = running["main"]
            # The host's trouble, not main's: its merges still owe coverage, run on resuming.
            raise LaneTrouble(
                f"Coverage on {running['main']} ran out of disk: {full}. Free disk where the "
                "lane's slots build (or point host.buildDir at a data volume), then lane-resume"
            )
        after = running["after"]
        self.record(
            "coverage",
            main=running["main"],
            outcome="passed" if passed else "failed",
            minutes=self.minutes(running["startedAt"]),
            logPath=running["logPath"],
            after=after,
        )
        if passed:
            for key in ("mergedSinceCoverage", "gateOwed"):
                self.lane[key] = [pr for pr in self.lane.get(key, []) if pr not in after]
            self.actions.append("coverage passed")
            return
        lines = first_lines(done.stdout + "\n" + done.stderr) or ["coverage failed"]
        detail = f"{lines[0]} (after PRs {', '.join(map(str, after)) or 'none'})"
        gate = [pr for pr in self.lane.get("gateOwed", []) if pr in after]
        self.event(
            "main-broken",
            detail=detail,
            lines=lines,
            logPath=running["logPath"],
            suspects=after,
            gateMerges=gate,
        )
        self.lane["paused"] = True
        self.lane["pauseReason"] = f"main is broken: {lines[0]}"

    def queue_empty(self) -> None:
        idle = not self.state["queue"] and not self.state["held"] and not seated(self.state)
        owed = self.coverage_owed() or self.lane.get("uncheckedMerges")
        if not idle or owed or self.lane.get("coverage"):
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
