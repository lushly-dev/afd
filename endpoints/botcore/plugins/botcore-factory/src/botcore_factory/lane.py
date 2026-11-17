"""The lane's loop, one step at a time.

``step`` does everything that can be done now and returns: it never waits, so tests drive it with
a fixture world and a fake clock. Each step, in order:

1. polls running validations, the coverage run and main's checks after a merge that advanced
   past a moved base without a new validation (``lane_advance``), recording what finished;
2. queues held branches while the queue has room (``lane.queueMax``);
3. moves the front of the queue towards a merge (``lane_merge``): serial, in queue order, bound
   to the validated head, after reading the base again (a move main's changes cannot touch
   advances the branch; any other validates it again);
4. starts validations in free slots (``lane.slots``): the base's own review verifier first
   checks the cell's review of the queued head (``review_evidence``, run from the ``review`` slot
   at the base, never the branch's copy: lushly-dev/afd#1308; a refusal ejects as
   ``review-unverified``), then each slot checks the queued head out,
   merges the base's head in (a conflict ejects; it is never resolved), then runs one background
   job: the adapter's ``install`` (with a timeout) and ``validate``, on the Node the slot's
   ``.nvmrc`` names (missing, it is the lane's trouble);
5. runs coverage on the base (``lane_coverage``);
6. says ``queue-empty`` when nothing is queued, held, active or owed, and makes a drained move.

A validated head is pushed by commit from its validation checkout, so a slot is free for the
next branch once the push finished. What ejects a branch is in ``lane_base``. The lane
never edits code.
"""

from __future__ import annotations

from botcore_factory import job
from botcore_factory.lane_base import (
    BAD_REVISION,
    INFRASTRUCTURE,
    LaneTrouble,
    first_lines,
    log_path,
)
from botcore_factory.lane_coverage import Coverage
from botcore_factory.lane_merge import Merging
from botcore_factory.runtime import Factory
from botcore_factory.world import WorldError

__all__ = ["LaneTrouble", "Step", "first_lines", "log_path", "step"]

#: The lane slot the review verifier runs from, checked out at the base being merged onto.
REVIEW_SLOT = "review"
#: Seconds; the verifier only reads a record.
REVIEW_TIMEOUT = 120


class Step(Merging, Coverage):
    def run(self) -> list[str]:
        try:
            self.poll_validations()
            self.poll_coverage()
            self.poll_unchecked()
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
            output = done.stdout + "\n" + done.stderr
            if done.returncode != 0 and done.step == "install":
                failed = job.failure(output) or {}
                # Job metadata names timedOut even when false. Search only the tool's
                # diagnostics, and read the structured boolean for a real job timeout.
                diagnostic = "\n".join(
                    line for line in output.splitlines() if not line.startswith(job.MARKER)
                )
                if failed.get("timedOut") is True or INFRASTRUCTURE.search(diagnostic):
                    self.requeue(entry, "restart")
                    raise LaneTrouble(
                        f"Installing for {entry['branch']} failed on the lane's side: "
                        f"{(first_lines(output) or ['no output'])[0]}"
                    )
                self.eject(entry, "entry-invalid", output, entry.get("logPath"))
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
            if passed:
                entry.pop("run", None)
                entry["state"] = "validated"
                self.actions.append(f"validated {entry['branch']}")
            else:
                self.eject(entry, "final-failed", output, entry.get("logPath"))

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

    def start_validations(self) -> None:
        busy = {
            e.get("slot")
            for e in self.state["queue"]
            if e.get("state") in ("validating", "validated")
        }
        free = [str(n) for n in range(1, self.dial("lane.slots") + 1) if str(n) not in busy]
        for entry in [e for e in self.state["queue"] if e.get("state") == "queued"]:
            if not free:
                # A front entry requeued after a base change (or a repaired entry) must
                # not deadlock behind later entries reserving every completed slot.
                later = self.state["queue"][self.state["queue"].index(entry) + 1 :]
                reserved = next((e for e in reversed(later) if e["state"] == "validated"), None)
                if reserved is None:
                    return
                free.append(reserved["slot"])
                self.requeue(reserved, "slot-needed", front=False)
            slot = free.pop(0)
            if not self.start_validation(entry, slot):
                free.insert(0, slot)  # Ejected before it ran: the next branch takes the slot.

    def start_validation(self, entry: dict, slot: str) -> bool:
        """Start validating ``entry`` in ``slot``; False when it was ejected instead."""
        if not self.config.validate_command:
            raise LaneTrouble("The repository adapter names no validate command")
        base, branch = self.base_head(), entry["branch"]
        if not self.review_verified(entry, base):
            return False
        log = log_path(branch, entry["attempt"])
        try:
            path = self.world.git.prepare_slot(slot, branch, entry["head"])
        except WorldError as exc:
            if BAD_REVISION.search(str(exc)):
                self.eject(entry, "entry-invalid", f"{entry['head']} cannot be checked out: {exc}")
                return False
            raise LaneTrouble(f"Preparing slot {slot} for {branch} failed: {exc}") from exc
        try:
            merged = self.world.git.merge_main(path, base)
        except WorldError as exc:
            raise LaneTrouble(f"Merging {base} into {branch} did not happen: {exc}") from exc
        if not merged.clean:
            self.eject(entry, "conflict", f"Conflicts with {base}: {', '.join(merged.conflicts)}")
            return False
        handle = self.world.processes.start_job(
            self.job_steps("validate", self.config.validate_command, path),
            cwd=path,
            log=self.absolute(log),
            label="validate",
        )
        entry.update(
            state="validating",
            slot=slot,
            path=path,
            base=base,
            validatedHead=merged.head,
            tree=self.world.git.tree(path),
            # What the branch changes against the base, read while the slot holds it.
            changed=self.world.git.changed_files(path, base),
            startedAt=self.at,
            run=handle,
            logPath=log,
        )
        self.record(
            "validation-started",
            branch=branch,
            attempt=entry["attempt"],
            head=merged.head,
            base=base,
            slot=slot,
        )
        self.actions.append(f"validating {branch} in slot {slot}")
        return True

    def review_verified(self, entry: dict, base: str) -> bool:
        """Whether the base's review verifier accepts the cell's review of the queued head.

        ``lane-enqueue`` ran the cell's own copy of the verifier, which the branch can change;
        this check binds (lushly-dev/afd#1308). It runs the lane's ``review_evidence`` in the
        ``review`` slot, a clean checkout of ``base``, so the verifier is the copy the merge
        lands on, and ``{worktree}`` names the cell's worktree, where its record is kept. A
        refusal, or a worktree that is gone, ejects; a verifier that cannot run is the lane's
        trouble.
        """
        command = self.config.review_evidence
        if not command or not any("{worktree}" in part for part in command):
            raise LaneTrouble(
                "The repository adapter's review_evidence must name {worktree}, so the lane can "
                "check each cell's review with the base's verifier"
            )
        worktree = (self.cell(entry["branch"]) or {}).get("worktree")
        if not worktree:
            self.eject(entry, "review-unverified", "No worktree is recorded for its cell")
            return False
        try:
            self.world.git.head(worktree)
        except WorldError as exc:
            self.eject(entry, "review-unverified", f"Its worktree {worktree} is gone: {exc}")
            return False
        try:
            checkout = self.world.git.prepare_slot(REVIEW_SLOT, "", base)
        except WorldError as exc:
            raise LaneTrouble(f"Preparing the review slot at {base} failed: {exc}") from exc
        argv = [
            part.replace("{head}", entry["head"]).replace("{worktree}", worktree)
            for part in command
        ]
        try:
            done = self.world.processes.run(
                argv, cwd=checkout, timeout=REVIEW_TIMEOUT, label="review-evidence"
            )
        except WorldError as exc:
            raise LaneTrouble(f"Checking the review of {entry['branch']} failed: {exc}") from exc
        if done.returncode != 0:
            self.eject(entry, "review-unverified", done.stderr + "\n" + done.stdout)
            return False
        return True


def step(factory: Factory) -> list[str]:
    """One step of the loop; what it did."""
    with factory.store.update("lane step") as state:
        return Step(factory, state).run()
