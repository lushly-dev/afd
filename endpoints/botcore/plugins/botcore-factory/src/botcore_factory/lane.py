"""The lane's loop, one step at a time.

``step`` does everything that can be done now and returns: it never waits, so tests drive it with
a fixture world and a fake clock. Each step, in order:

1. polls running validations, the coverage run and main's checks after a merge that advanced
   past a moved base without a new validation (``lane_advance``), recording what finished;
2. queues held branches while the queue has room (``lane.queueMax``);
3. moves the front of the queue towards a merge (``lane_merge``): serial, in queue order, bound
   to the validated head, after reading the base again (a move main's changes cannot touch
   advances the branch; any other validates it again); a front branch GitHub queued instead of
   merging (a merge queue) is read again until it merged or left the queue;
4. starts validations in free slots (``lane.slots``): the base's own review verifier first
   checks the cell's review of the queued head (``review_evidence``, run from the ``review`` slot
   at the base, never the branch's copy: lushly-dev/afd#1308; a refusal ejects as
   ``review-unverified``), then each slot checks the queued head out,
   merges the base's head in (a conflict ejects; it is never resolved, except that conflicts
   only in files the adapter's ``regenerate`` names are written again by its command and the
   merge committed: lushly-dev/afd#1410), then runs one background
   job: the adapter's ``install`` (with a timeout) and ``validate``, on the Node the slot's
   ``.nvmrc`` names (missing, it ejects the branch as ``node-missing`` when the branch changed
   ``.nvmrc``, deleted it or left it blank, and is the lane's trouble when the ``.nvmrc`` is
   the base's own); free disk at the slots below ``host.minFreeDiskGb`` is the lane's trouble
   before any of it starts, so a full disk pauses the lane rather than ejecting a good branch;
5. runs coverage on the base (``lane_coverage``);
6. says ``queue-empty`` when nothing is queued, held, active or owed, and makes a drained move.

A validated head is pushed by commit from its validation checkout, so a slot is free for the
next branch once the push finished. A validated branch behind the front gives its slot to a
front branch that needs one: its checkout moves aside with its validation (``slot-released``),
and the base checks at the front decide whether it runs again (lushly-dev/afd#1452). What
ejects a branch is in ``lane_base``. The lane never edits code.
"""

from __future__ import annotations

import hashlib
import re

from botcore_factory import job
from botcore_factory.adapter import matches
from botcore_factory.cells import disk_short
from botcore_factory.lane_base import (
    BAD_REVISION,
    INFRASTRUCTURE,
    LaneTrouble,
    first_lines,
    log_path,
)
from botcore_factory.lane_coverage import NVMRC_BLANK, NVMRC_DELETED, Coverage, NodeUnavailable
from botcore_factory.lane_merge import Merging
from botcore_factory.runtime import Factory, Refusal
from botcore_factory.world import MergeOutcome, WorldError

__all__ = ["LaneTrouble", "Step", "first_lines", "log_path", "step"]

#: The lane slot the review verifier runs from, checked out at the base being merged onto.
REVIEW_SLOT = "review"
#: Seconds; the verifier only reads a record.
REVIEW_TIMEOUT = 120
#: Seconds a ``regenerate`` command may take.
REGENERATE_TIMEOUT = 300
#: The verifier's exit code for a refused review (``scripts/review-record.mjs``'s ``REFUSED``).
REVIEW_REFUSED = 3


class Step(Merging, Coverage):
    def run(self) -> list[str]:
        try:
            self.poll_validations()
            self.poll_coverage()
            self.poll_unchecked()
            if not self.lane.get("paused"):
                self.queue_held()
                self.advance_front()
                self.sweep_kept()
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
                self.eject(entry, "final-failed", output, entry.get("logPath"), done.failures)

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
            reserved = None
            if not free:
                # A front entry requeued after a base change (or a repaired entry) must
                # not deadlock behind later entries reserving every completed slot.
                later = self.state["queue"][self.state["queue"].index(entry) + 1 :]
                reserved = next(
                    (e for e in reversed(later) if e["state"] == "validated" and e.get("slot")),
                    None,
                )
                if reserved is None:
                    return
            if not self.config.validate_command:
                raise LaneTrouble("The repository adapter names no validate command")
            # A full disk mid-build ejects a good branch (lushly-dev/afd#1565): pause instead.
            try:
                short = disk_short(self.factory, self.state["dials"])
            except Refusal as refusal:
                raise LaneTrouble(f"{refusal.message}. {refusal.suggestion}") from refusal
            if short is not None:
                raise LaneTrouble(
                    f"Validating {entry['branch']} waits: {short.message}. {short.suggestion}; "
                    "then lane-resume"
                )
            # Checked once a slot is to be had, and before a validated branch gives one up.
            if not self.review_verified(entry, self.base_head()):
                continue
            if reserved is not None:
                free.append(reserved["slot"])
                self.release_slot(reserved)
            slot = free.pop(0)
            if not self.start_validation(entry, slot):
                free.insert(0, slot)  # Ejected before it ran: the next branch takes the slot.

    def release_slot(self, entry: dict) -> None:
        """Give a validated entry's slot to the front of the queue, keeping its validation
        (lushly-dev/afd#1452).

        Its checkout moves aside to the lane checkout ``kept-<branch>-<hash>`` with the git
        directory that holds the validation's record, so the validated head is still pushed from
        where it passed; the entry keeps state ``validated`` and its base, and the base checks at
        the front decide whether it runs again. When the checkout cannot move, the validation is
        given up as before (``rerun``, ``slot-needed``).
        """
        slot, branch = entry["slot"], entry["branch"]
        # A short hash of the branch keeps a/b and a-b apart.
        digest = hashlib.sha256(branch.encode("utf-8")).hexdigest()[:8]
        name = f"kept-{re.sub(r'[^A-Za-z0-9._-]+', '-', branch).strip('-')}-{digest}"
        try:
            path = self.world.git.park_slot(slot, name)
        except WorldError as exc:
            self.requeue(entry, "slot-needed", front=False, detail=f"its checkout stayed: {exc}")
            return
        entry.pop("slot")
        entry["path"] = path
        kept = self.lane.setdefault("keptCheckouts", [])
        if path not in kept:
            kept.append(path)
        self.record("slot-released", branch=branch, attempt=entry["attempt"], slot=slot, path=path)
        self.actions.append(f"released slot {slot} from {branch}; its validation is kept")

    def sweep_kept(self) -> None:
        """Remove the kept checkouts no validated entry still needs (pushed, merged, ejected,
        dropped or validated again); one that cannot be removed is tried again next step."""
        kept = self.lane.get("keptCheckouts")
        if not kept:
            return
        needed = {
            entry.get("path") for entry in self.state["queue"] if entry.get("state") == "validated"
        }
        for path in list(kept):
            if path in needed:
                continue
            try:
                self.world.git.remove_checkout(path)
            except WorldError as exc:
                self.actions.append(f"kept checkout {path} not removed yet: {exc}")
                continue
            kept.remove(path)

    def start_validation(self, entry: dict, slot: str) -> bool:
        """Start validating ``entry`` in ``slot``; False when it was ejected instead."""
        base, branch = self.base_head(), entry["branch"]
        log = log_path(branch, entry["attempt"])
        try:
            path = self.world.git.prepare_slot(slot, branch, entry["head"])
        except WorldError as exc:
            if BAD_REVISION.search(str(exc)):
                self.eject(entry, "entry-invalid", f"{entry['head']} cannot be checked out: {exc}")
                return False
            raise LaneTrouble(f"Preparing slot {slot} for {branch} failed: {exc}") from exc
        try:
            merged = self.world.git.merge_main(path, base, keep_open=self.regenerable)
        except WorldError as exc:
            raise LaneTrouble(f"Merging {base} into {branch} did not happen: {exc}") from exc
        regenerated: list[str] = []
        if merged.open:
            outcome = self.regenerate(entry, path, base, merged.conflicts)
            if outcome is None:
                return False
            merged, regenerated = outcome
        if not merged.clean:
            self.eject(entry, "conflict", f"Conflicts with {base}: {', '.join(merged.conflicts)}")
            return False
        steps = self.validation_steps(entry, path, base)
        if steps is None:
            return False
        handle = self.world.processes.start_job(
            steps, cwd=path, log=self.absolute(log), label="validate"
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
            **({"regenerated": regenerated} if regenerated else {}),
        )
        if regenerated:
            self.actions.append(f"regenerated {', '.join(regenerated)} for {branch}")
        self.actions.append(f"validating {branch} in slot {slot}")
        return True

    def validation_steps(self, entry: dict, path: str, base: str) -> list[dict] | None:
        """The validation job's steps, on the Node the merged slot's ``.nvmrc`` names. That Node
        missing ejects the branch as ``node-missing`` when the branch changed ``.nvmrc``; when
        the ``.nvmrc`` is the base's own, no branch is to blame, and the lane pauses
        (lushly-dev/afd#1352). A branch that deletes ``.nvmrc`` is ejected the same way, never
        validated on the host's default Node, and so is one that leaves it blank
        (lushly-dev/afd#1505). None when the branch was
        ejected."""
        try:
            steps = self.job_steps("validate", self.config.validate_command, path)
        except NodeUnavailable as unavailable:
            if ".nvmrc" not in self.world.git.changed_files(path, base):
                raise
            self.eject(entry, "node-missing", unavailable.for_branch())
            return None
        kept = self.world.git.read_file(path, ".nvmrc")
        if not (kept or "").strip() and ".nvmrc" in self.world.git.changed_files(path, base):
            self.eject(entry, "node-missing", NVMRC_DELETED if kept is None else NVMRC_BLANK)
            return None
        return steps

    def regenerable(self, conflicts: tuple[str, ...]) -> bool:
        """Whether every conflicting path is a file the adapter's ``regenerate`` writes."""
        specs = self.config.regenerate
        return bool(specs) and all(any(matches(c, s.paths) for s in specs) for c in conflicts)

    def regenerate(
        self, entry: dict, path: str, base: str, conflicts: tuple[str, ...]
    ) -> tuple[MergeOutcome, list[str]] | None:
        """Write the conflicting generated files again and commit the merge (lushly-dev/afd#1410).

        Each ``regenerate`` entry whose paths conflict runs in the slot while the merge is open;
        it writes and stages its files. One that refuses (a real conflict in what it merges)
        ejects as ``conflict``, as before; one that cannot run is the lane's trouble. The merge is
        committed only when nothing is left unmerged. None when the branch was ejected.
        """
        names: list[str] = []
        for spec in self.config.regenerate:
            if not any(matches(conflict, spec.paths) for conflict in conflicts):
                continue
            try:
                done = self.world.processes.run(
                    spec.run, cwd=path, timeout=REGENERATE_TIMEOUT, label=f"regenerate:{spec.name}"
                )
            except WorldError as exc:
                self.world.git.abort_merge(path)
                raise LaneTrouble(
                    f"Regenerating {spec.name} for {entry['branch']} could not run: {exc}"
                ) from exc
            if done.returncode != 0:
                self.world.git.abort_merge(path)
                why = (first_lines(done.stderr + "\n" + done.stdout) or ["no output"])[0]
                self.eject(
                    entry,
                    "conflict",
                    f"Conflicts with {base}: {', '.join(conflicts)}; {spec.name} could not "
                    f"merge them: {why}",
                )
                return None
            names.append(spec.name)
        try:
            return self.world.git.finish_merge(path), names
        except WorldError as exc:
            self.world.git.abort_merge(path)
            raise LaneTrouble(f"Committing the merge for {entry['branch']} failed: {exc}") from exc

    def review_verified(self, entry: dict, base: str) -> bool:
        """Whether the base's review verifier accepts the cell's review of the queued head.

        ``lane-enqueue`` ran the cell's own copy of the verifier, which the branch can change;
        this check binds (lushly-dev/afd#1308). It runs the lane's ``review_evidence`` in the
        ``review`` slot, a clean checkout of ``base``, so the verifier is the copy the merge
        lands on, and ``{worktree}`` names the cell's worktree, where its record is kept. A
        refusal (exit ``REVIEW_REFUSED``), or a worktree that is gone, ejects; any other failure
        of the verifier (it cannot start, times out, crashes or is called wrongly) is the lane's
        trouble, so a verifier broken on the base pauses the lane rather than ejecting every
        branch.
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
        output = done.stderr + "\n" + done.stdout
        if done.returncode == REVIEW_REFUSED:
            self.eject(entry, "review-unverified", output)
            return False
        if done.returncode != 0:
            raise LaneTrouble(
                f"The review verifier failed for {entry['branch']} (exit {done.returncode}): "
                f"{(first_lines(output) or ['no output'])[0]}"
            )
        return True


def step(factory: Factory) -> list[str]:
    """One step of the loop; what it did."""
    with factory.store.update("lane step") as state:
        return Step(factory, state).run()
