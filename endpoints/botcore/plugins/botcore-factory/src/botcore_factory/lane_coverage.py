"""Coverage on the base branch, and the lane going quiet.

Coverage runs every ``lane.coverageEvery`` merges and at once after a merge that touched
``gate_paths``; the front of the queue waits while a gate merge's coverage is owed. A passing run
clears only the merges it ran after, so a merge that landed meanwhile still owes one. A failure is
``main-broken`` naming those merges, and pauses the lane.
"""

from __future__ import annotations

from botcore_factory.cells import seated
from botcore_factory.events import is_open
from botcore_factory.lane_base import LaneTrouble, StepBase, first_lines
from botcore_factory.world import LANE_HOST_VARIABLE, nvmrc_version

INSTALL_TIMEOUT_SECONDS = 1800


class Coverage(StepBase):
    def job_steps(self, label: str, command: list[str], cwd: str) -> list[dict]:
        """Install (bounded by a timeout), then the command: one background job, on the Node
        the checkout at ``cwd`` names in ``.nvmrc``."""
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
        node = self.node_bin(cwd)
        return [{**s, "path": [node]} for s in steps] if node else steps

    def node_bin(self, cwd: str) -> str | None:
        """The bin directory of the Node the checkout's ``.nvmrc`` names; None without one.
        That Node missing is the lane's trouble: never validate on another one."""
        spec = (self.world.git.read_file(cwd, ".nvmrc") or "").strip()
        if not spec:
            return None
        if nvmrc_version(spec) is None:
            raise LaneTrouble(
                f".nvmrc in {cwd} names {spec!r}, an alias the lane does not resolve: pin a "
                "version number there (such as 26), then lane-resume"
            )
        found = self.world.machine.node_bin(spec)
        if found is None:
            raise LaneTrouble(
                f"Node {spec}, which .nvmrc in {cwd} names, is not installed on this machine: "
                f"install it (`fnm install {spec}` or `nvm install {spec}`), then lane-resume"
            )
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
        if any(e.get("state") == "merging" for e in self.state["queue"]):
            return
        base = self.base_head(fresh=True)
        path = self.world.git.prepare_slot("coverage", "", base)
        log = f"coverage/{base[:12]}.log"
        handle = self.world.processes.start_job(
            self.job_steps("coverage", self.config.coverage, path),
            cwd=path,
            log=self.absolute(log),
            label="coverage",
        )
        self.lane["coverage"] = {
            "run": handle,
            "main": base,
            "startedAt": self.at,
            "logPath": log,
            "after": list(self.lane.get("mergedSinceCoverage", [])),
        }
        self.actions.append(f"coverage on {base}")

    def poll_coverage(self) -> None:
        from botcore_factory.world import WorldError

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
