"""The front of the queue on its way to a merge: serial, in queue order, bound to the head.

A validated branch at the front is pushed (its validated head, by commit, not whatever its slot
holds now; with a lease on the head the lane last pushed there, since the lane owns the branch),
its PR opened, and the adapter's ``required_check`` awaited on that head. Before the push and
again before the merge the base is read again: if it moved since the validation started, the
branch advances to it when main's move cannot touch what it validated, and is validated again
otherwise (``lane_advance``). The merge is bound to the validated head (``--match-head-commit``).
Nothing advances while coverage a gate-path merge owes has not passed.
"""

from __future__ import annotations

from botcore_factory.adapter import matches
from botcore_factory.cells import seated
from botcore_factory.lane_advance import Advancing
from botcore_factory.lane_base import (
    HEAD_MISMATCH,
    NON_FAST_FORWARD,
    NOT_MERGEABLE,
    PR_REFUSED,
    LaneTrouble,
)
from botcore_factory.world import LANE_HOST_VARIABLE, WorldError


class Merging(Advancing):
    def advance_front(self) -> None:
        if not self.state["queue"] or self.lane.get("gateOwed"):
            return  # A gate-path merge's coverage comes first.
        entry = self.state["queue"][0]
        if entry.get("state") == "validated":
            if self.follow_base(entry):
                self.push_and_open(entry)
        elif entry.get("state") == "merging":
            self.await_check(entry)

    def push_and_open(self, entry: dict) -> None:
        branch, head = entry["branch"], entry["validatedHead"]
        cell = self.cell(branch) or {}
        try:
            self.world.git.push_head(entry["path"], branch, head, cell.get("pushedHead"))
        except WorldError as exc:
            if NON_FAST_FORWARD.search(str(exc)):
                self.eject(entry, "push-failed", str(exc))
                return
            raise LaneTrouble(f"Pushing {branch} failed: {exc}") from exc
        entry["pushedHead"] = head
        if cell:
            cell["pushedHead"] = head
        try:
            entry["pr"] = self.world.github.open_pr(
                branch, entry.get("title") or branch, self.pr_body(entry), self.config.base_branch
            )
        except WorldError as exc:
            if PR_REFUSED.search(str(exc)):
                self.eject(entry, "pr-failed", str(exc))
                return
            raise LaneTrouble(f"Opening the PR for {branch} failed: {exc}") from exc
        entry["state"] = "merging"
        entry["checkSince"] = self.at
        self.actions.append(f"opened PR {entry['pr']} for {branch} at {head}")

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
        github, pr, head = self.world.github, entry["pr"], entry["pushedHead"]
        check = self.config.required_check
        if not check:
            raise LaneTrouble(
                "The repository adapter names no required_check: the lane merges only behind one"
            )
        try:
            state = github.pr_state(pr)
            status = github.check_status(pr, check, head)
        except WorldError as exc:
            raise LaneTrouble(f"Reading PR {pr} failed: {exc}") from exc
        if state == "MERGED":
            self.land(entry, without_check=status != "success")
            return
        if state == "CLOSED":
            self.eject(entry, "pr-closed", f"PR {pr} was closed without merging")
            return
        if status == "failure":
            self.eject(entry, "ci-failed", f"{check} failed on PR {pr} at {head}")
            return
        if status == "cancelled":
            entry["checkSince"] = self.at
            raise LaneTrouble(f"{check} was cancelled on PR {pr}; re-run it, then lane-resume")
        if status != "success":
            limit = self.dial("lane.checkTimeoutMinutes")
            if self.minutes(entry.get("checkSince")) > limit:
                entry["checkSince"] = self.at  # A fresh wait after lane-resume.
                raise LaneTrouble(
                    f"{check} on PR {pr} has not finished in {limit} minutes; the PR is left open"
                )
            return
        self.merge(entry)

    def merge(self, entry: dict) -> None:
        pr, head = entry["pr"], entry["pushedHead"]
        if not self.follow_base(entry):
            return  # Never merge what main's move may have touched without validating it.
        host, me = self.world.github.get_variable(LANE_HOST_VARIABLE), self.world.machine.id()
        if host != me:
            self.lane["stopRequested"] = "not-host"
            raise LaneTrouble(f"The lane host is {host}, not {me}: this lane merges nothing more")
        try:
            self.world.github.merge_pr(pr, head)
        except WorldError as exc:
            try:
                merged = self.world.github.pr_state(pr) == "MERGED"
            except WorldError as again:
                raise LaneTrouble(f"Merging PR {pr} failed: {exc}; {again}") from again
            if merged:  # It landed; only the answer was lost.
                self.land(entry)
            elif HEAD_MISMATCH.search(str(exc)):
                self.eject(entry, "merge-failed", str(exc))
            elif NOT_MERGEABLE.search(str(exc)):
                if self.base_head(fresh=True) == entry["base"]:
                    self.eject(entry, "merge-failed", str(exc))
                else:  # Advanced, it merges again next step; otherwise it was requeued.
                    self.follow_base(entry)
            else:
                raise LaneTrouble(f"Merging PR {pr} failed: {exc}") from exc
            return
        self.land(entry)

    def land(self, entry: dict, without_check: bool = False) -> None:
        branch, pr = entry["branch"], entry["pr"]
        self.world.git.delete_queue_ref(branch, entry["head"])
        full = len(seated(self.state)) >= self.dial("cells.max")
        self.state["queue"].remove(entry)
        self.record(
            "merged",
            branch=branch,
            attempt=entry["attempt"],
            pr=pr,
            withoutCheck=without_check,
            advanced=bool(entry.get("advanced")),
        )
        self.watch_unchecked(entry, pr)
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
        run = self.current_run()
        if run is not None:
            run.setdefault("prs", []).append(
                {
                    "number": pr,
                    "branch": branch,
                    "route": (cell or {}).get("route"),
                    "plan": (cell or {}).get("plan"),
                }
            )
        self.lane.setdefault("mergedSinceCoverage", []).append(pr)
        if any(matches(path, self.config.gate_paths) for path in entry.get("changed", [])):
            self.lane.setdefault("gateOwed", []).append(pr)
        self._base = None  # The base moved with the merge.
        self.actions.append(f"merged {branch} (PR {pr})")
