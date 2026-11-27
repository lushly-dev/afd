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
   checks the cell's review of the queued head (``review_evidence``, run from the ``review``
   slot at the base, never the branch's copy: lushly-dev/afd#1308; a refusal ejects as
   ``review-unverified``), then each slot checks the queued head out, merges the base's head in
   (a conflict ejects; it is never resolved, except that conflicts only in files the adapter's
   ``regenerate`` names are written again by its command and the merge committed:
   lushly-dev/afd#1410), folds the merged head into one commit of the branch's own on the base,
   with the same tree (``fold``: a rebase merge lands each of a branch's own commits and drops
   its merges, lushly-dev/afd#1809; a branch the fold refuses ejects as ``entry-invalid``), then
   runs one background job: the adapter's ``install`` (with a timeout) and ``validate``, on the
   Node the slot's ``.nvmrc`` names (missing, it ejects the branch as ``node-missing`` when the
   branch changed ``.nvmrc``, deleted it or left it blank, and is the lane's trouble when the
   ``.nvmrc`` is the base's own); free disk at the slots below ``host.minFreeDiskGb`` is the
   lane's trouble before any of it starts, so a full disk pauses the lane rather than ejecting a
   good branch, and so is a job that fails on a full disk anyway (``ENOSPC``): it is validated
   again once the lane resumes, and no ejection is counted (lushly-dev/afd#1641). Each slot's
   jobs build Rust under its own ``CARGO_TARGET_DIR`` (``host.buildDir``), removed when the slot
   takes another branch;
5. runs coverage on the base (``lane_coverage``);
6. says ``queue-empty`` when nothing is queued, held, active or owed, and makes a drained move.

A validated head is pushed by commit from its validation checkout, so a slot is free for the
next branch once the push finished. A validated branch behind the front gives its slot to a
front branch that needs one: its checkout moves aside with its validation (``slot-released``),
and the base checks at the front decide whether it runs again (lushly-dev/afd#1452). What
ejects a branch is in ``lane_base``. The lane never edits code.
"""

from __future__ import annotations

import contextlib
import hashlib
import re
from typing import Any

from botcore_factory import change_report, job, queue
from botcore_factory.adapter import matches
from botcore_factory.cells import disk_short, threads
from botcore_factory.events import is_open
from botcore_factory.lane_base import (
    BAD_REVISION,
    INFRASTRUCTURE,
    VALIDATION_FIELDS,
    LaneTrouble,
    first_lines,
    log_path,
)
from botcore_factory.lane_coverage import NVMRC_BLANK, NVMRC_DELETED, Coverage, NodeUnavailable
from botcore_factory.lane_merge import Merging
from botcore_factory.runtime import Factory, Refusal
from botcore_factory.validation_lock import parse_job_handle
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
        failed = False
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
            failed = True
            self.trouble(str(trouble))
        except WorldError as exc:  # Anything else outside that failed is the lane's trouble too.
            failed = True
            self.trouble(f"{type(exc).__name__}: {exc}")
        self._finish_host_lock(failed)
        return self.actions

    def _finish_host_lock(self, failed: bool) -> None:
        """Reconcile active holds, withdraw unneeded waiter registrations and keep
        ``waitingOnHostLock`` deterministic (no ticking fields that would spam state.log)."""
        waiting = (
            not failed
            and not self.lane.get("paused")
            and not self.lane.get("stopRequested")
            and self._blocked_on_host_lock is not None
        )
        if waiting:
            self.lane["waitingOnHostLock"] = self._blocked_on_host_lock
        else:
            self.lane.pop("waitingOnHostLock", None)
        lock = self.world.validation_lock
        if lock is None:
            return
        active = [
            f"slot:{entry['slot']}"
            for entry in self.state["queue"]
            if entry.get("state") == "validating" and entry.get("slot")
        ]
        if self.lane.get("coverage"):
            active.append("coverage")

        def sync() -> None:
            repo, pid = self.world.github.repository(), self.host_lock_pid()
            lock.reconcile(repo, pid, active)
            if not waiting:
                lock.withdraw_waiter(repo, pid)

        if failed or self.lane.get("paused"):
            # Never mask an existing lane-error or spam new ones on every tick while paused.
            with contextlib.suppress(WorldError):
                sync()
            return
        try:
            sync()
        except WorldError as exc:
            self.lane.pop("waitingOnHostLock", None)
            self.trouble(f"{type(exc).__name__}: {exc}")

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
            full = done.disk_full if done.returncode != 0 else None
            if full is not None and not entry.get("diskFull"):
                # The host's trouble, not the branch's: pause, and count no ejection. Once per
                # attempt: a branch whose own failure says so (a test that fills a disk) is
                # ejected the next time, as any failure is, rather than pause the lane for ever.
                entry["diskFull"] = full
                self.requeue(entry, "disk-full", detail=full)
                raise LaneTrouble(
                    f"Validating {entry['branch']} ran out of disk: {full}. Free disk where the "
                    "lane's slots build (or point host.buildDir at a data volume), then "
                    "lane-resume; the branch validates again"
                )
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
                **(
                    {"testChanges": entry["testChanges"]}
                    if entry.get("testChanges") is not None
                    else {}
                ),
            )
            if passed:
                entry.pop("run", None)
                entry["state"] = "validated"
                if entry.get("slot"):
                    self.release_host_hold(f"slot:{entry['slot']}")
                self.actions.append(f"validated {entry['branch']}")
            else:
                self.eject(entry, "final-failed", output, entry.get("logPath"), done.failures)

    def queue_held(self) -> None:
        """Promote queue-full held branches as room opens; owner holds stay held."""
        room = self.dial("lane.queueMax") - len(self.state["queue"])
        if room <= 0 or not self.state["held"]:
            return
        remaining: list[dict[str, Any]] = []
        for held in self.state["held"]:
            reason = held.get("holdReason")
            if room > 0 and (reason is None or reason == "queue-full"):
                held.pop("holdReason", None)
                held["state"] = "queued"
                self.state["queue"].append(held)
                cell = self.cell(held["branch"])
                if cell is not None:
                    cell["state"] = "queued"
                self.record("queued", branch=held["branch"], attempt=held["attempt"])
                self.actions.append(f"queued {held['branch']}")
                room -= 1
            else:
                remaining.append(held)
        self.state["held"] = remaining

    def start_validations(self) -> None:
        busy = {
            e.get("slot")
            for e in self.state["queue"]
            if e.get("state") in ("validating", "validated")
        }
        free = [str(n) for n in range(1, self.dial("lane.slots") + 1) if str(n) not in busy]
        if any(e.get("state") == "queued" for e in self.state["queue"]):
            self.sweep_builds(free)
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
            # Check the shared host validation lock before running review_verified or releasing
            # a kept slot, so waiting on another lane neither re-runs review checks every tick
            # nor evicts a validated branch's slot (lushly-dev/afd#1309).
            lock = self.world.validation_lock
            if lock is not None:
                blocker = lock.check_available(
                    self.world.github.repository(), self.host_lock_pid(), register_waiter=True
                )
                if blocker is not None:
                    self._blocked_on_host_lock = blocker
                    self.actions.append(
                        f"waiting on host validation lock ({blocker.get('lane')}: "
                        f"{blocker.get('repository')})"
                    )
                    return
            # Checked once a slot is to be had, and before a validated branch gives one up.
            if not self.review_verified(entry, self.base_head()):
                continue
            if reserved is not None:
                free.append(reserved["slot"])
                self.release_slot(reserved)
            slot = free.pop(0)
            if not self.start_validation(entry, slot):
                free.insert(0, slot)  # Ejected before it ran (or lock raced): keep slot free.
                if self._blocked_on_host_lock is not None:
                    return

    def release_slot(self, entry: dict[str, Any]) -> None:
        """Give a validated entry's slot to the front of the queue, keeping its validation
        (lushly-dev/afd#1452).

        Its checkout moves aside to the lane checkout ``kept-<branch>-<hash>`` with the git
        directory that holds the validation's record, so the validated head is still pushed from
        where it passed; the entry keeps state ``validated`` and its base, and the base checks at
        the front decide whether it runs again. When the checkout cannot move, the validation is
        given up as before (``rerun``, ``slot-needed``).
        """
        slot, branch = entry["slot"], entry["branch"]
        try:
            self.clean_slot_paths(slot)
        except WorldError as exc:
            self.actions.append(f"slot {slot} cleanup deferred before parking: {exc}")
        self._cleaned_slots.discard(slot)
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

    def start_validation(self, entry: dict[str, Any], slot: str) -> bool:
        """Start validating ``entry`` in ``slot``; False when ejected or blocked on host lock."""
        base, branch = self.base_head(), entry["branch"]
        log = log_path(branch, entry["attempt"])
        lock = self.world.validation_lock
        hold_id = f"slot:{slot}"
        acquired = False
        if lock is not None:
            blocker = lock.try_acquire(
                hold_id, self.world.github.repository(), self.host_lock_pid()
            )
            if blocker is not None:
                self._blocked_on_host_lock = blocker
                self.actions.append(
                    f"waiting on host validation lock ({blocker.get('lane')}: "
                    f"{blocker.get('repository')})"
                )
                return False
            acquired = True
        started = False
        try:
            try:
                path = self.world.git.prepare_slot(slot, branch, entry["head"])
            except WorldError as exc:
                if BAD_REVISION.search(str(exc)):
                    self.eject(
                        entry, "entry-invalid", f"{entry['head']} cannot be checked out: {exc}"
                    )
                    return False
                raise LaneTrouble(f"Preparing slot {slot} for {branch} failed: {exc}") from exc
            # Read at the queued head itself, before main is merged in, and held at once: an
            # ejection on the way (a conflict, a refused fold) must not carry the edits past it.
            repair = self.repair_gate_edits(entry, path, base)
            if repair and self.hold_for_gate_change(entry, [], None, repair):
                return False
            try:
                merged = self.world.git.merge_main(path, base, keep_open=self.regenerable)
            except WorldError as exc:
                raise LaneTrouble(f"Merging {base} into {branch} did not happen: {exc}") from exc
            regenerated: list[str] = []
            regenerated_paths: list[str] = []
            if merged.open:
                regenerated_paths = list(merged.conflicts)
                outcome = self.regenerate(entry, path, base, merged.conflicts)
                if outcome is None:
                    return False
                merged, regenerated = outcome
            if not merged.clean:
                self.eject(
                    entry, "conflict", f"Conflicts with {base}: {', '.join(merged.conflicts)}"
                )
                return False
            if regenerated:
                self.record(
                    "provenance-rerecorded",
                    branch=branch,
                    attempt=entry["attempt"],
                    base=base,
                    names=regenerated,
                    paths=regenerated_paths,
                )
            # One commit of its own on the base, with the merged tree: what is validated, pushed
            # and merged (lushly-dev/afd#1809).
            try:
                folded = self.world.git.fold(path, base, threads(self.cell(branch)))
            except WorldError as exc:
                raise LaneTrouble(
                    f"Folding {branch} into one commit on {base} failed: {exc}"
                ) from exc
            if folded.refused:
                self.eject(entry, "entry-invalid", folded.refused)
                return False
            # What the branch changes against the base, read while the slot holds it,
            # before start_job so nothing can raise between process spawn and entry.update.
            changed = self.world.git.changed_files(path, base)
            report = self.read_test_changes(entry, path, base, folded.head)
            cell = self.cell(branch)
            if report is not None:
                entry["testChanges"] = report
                if cell is not None:
                    cell["testChanges"] = report
            if self.hold_for_gate_change(entry, changed, report):
                return False
            steps = self.validation_steps(entry, path, base, slot)
            if steps is None:
                return False
            tree = self.world.git.tree(path)
            handle = self.world.processes.start_job(
                steps, cwd=path, log=self.absolute(log), label="validate"
            )
            started = True
            entry.update(
                state="validating",
                slot=slot,
                path=path,
                base=base,
                validatedHead=folded.head,
                tree=tree,
                changed=changed,
                startedAt=self.at,
                run=handle,
                logPath=log,
                **({"testChanges": report} if report is not None else {}),
            )
            if acquired and lock is not None:
                job_pid, job_started = parse_job_handle(handle)
                lock.set_job(
                    hold_id,
                    self.world.github.repository(),
                    self.host_lock_pid(),
                    job_pid,
                    job_started,
                )
            self.record(
                "validation-started",
                branch=branch,
                attempt=entry["attempt"],
                head=folded.head,
                base=base,
                slot=slot,
                **({"regenerated": regenerated} if regenerated else {}),
            )
            if regenerated:
                self.actions.append(f"regenerated {', '.join(regenerated)} for {branch}")
            self.actions.append(f"validating {branch} in slot {slot}")
            return True
        finally:
            if acquired and not started and lock is not None:
                with contextlib.suppress(WorldError):
                    self.release_host_hold(hold_id)

    def validation_steps(
        self, entry: dict[str, Any], path: str, base: str, slot: str
    ) -> list[dict[str, Any]] | None:
        """The validation job's steps, on the Node the merged slot's ``.nvmrc`` names. That Node
        missing ejects the branch as ``node-missing`` when the branch changed ``.nvmrc``; when
        the ``.nvmrc`` is the base's own, no branch is to blame, and the lane pauses
        (lushly-dev/afd#1352). A branch that deletes ``.nvmrc`` is ejected the same way, never
        validated on the host's default Node, and so is one that leaves it blank
        (lushly-dev/afd#1505). None when the branch was
        ejected."""
        try:
            steps = self.job_steps(
                "validate", self.config.validate_command or [], path, slot, entry["branch"]
            )
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
        self, entry: dict[str, Any], path: str, base: str, conflicts: tuple[str, ...]
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

    def read_test_changes(
        self, entry: dict[str, Any], path: str, base: str, head: str
    ) -> dict[str, Any] | None:
        """Run the adapter's ``test_changes`` command from the base's clean ``review`` slot.

        Running both the script and its commit-to-commit git reads from ``checkout`` (the clean
        ``review`` slot at ``base``, never the candidate checkout ``path``) guarantees a branch
        cannot silence findings via a tampered script or working-tree ``.gitattributes`` (same
        trust boundary as ``review_verified``). Missing ``{base}``/``{head}`` placeholders or
        any command failure is the lane's trouble rather than a clean report.
        """
        command = self.config.test_changes
        if not command:
            return None
        missing = [
            token for token in ("{base}", "{head}") if not any(token in part for part in command)
        ]
        if missing:
            raise LaneTrouble(
                f"The repository adapter's test_changes must name {', '.join(missing)}, so the "
                "lane compares the requested base and head commits"
            )
        try:
            checkout = self.world.git.prepare_slot(REVIEW_SLOT, "", base)
        except WorldError as exc:
            raise LaneTrouble(
                f"Preparing the review slot at {base} for test changes failed: {exc}"
            ) from exc
        try:
            return change_report.run_report(
                self.factory, cwd=checkout, worktree=checkout, base=base, head=head
            )
        except WorldError as exc:
            raise LaneTrouble(f"Reading test changes for {entry['branch']} failed: {exc}") from exc

    def repair_gate_edits(self, entry: dict[str, Any], path: str, base: str) -> list[str]:
        """What a repair's queued head newly edits in ``gate_paths``, as reasons to hold it.

        ``lane-enqueue`` refused these already, but it ran the cell's own copy of that check
        and of ``gate_paths``, which the branch can change. This one binds: the lane's code and
        config, the lane's fetch of the base, and the slot checked out at the queued head. Empty
        for a branch never ejected for a failing check, or whose queued head ``gate-allow``
        covers. Edits that cannot be read are a reason too, so the repair waits for a person
        rather than passing unread."""
        branch = entry["branch"]
        repair = queue.repair_since(
            self.factory, branch, self.cell(branch), self.state, entry.get("head", "")
        )
        if repair is None:
            return []
        cause, since = repair
        try:
            edits = self.world.git.repair_edits(
                path, base, since, lambda name: matches(name, self.config.gate_paths)
            )
        except WorldError as exc:
            return [f"its repair after {cause} has gate edits the lane could not read: {exc}"]
        return [f"its repair after {cause} edits gate path {name}" for name in sorted(edits)]

    def hold_for_gate_change(
        self,
        entry: dict[str, Any],
        changed: list[str],
        report: dict[str, Any] | None,
        repair: list[str] | None = None,
    ) -> bool:
        """Authoritative Phase 5 "never improves by checking less" hold for ``area:factory``,
        and for any repair whose gate edits ``repair_gate_edits`` found.

        Even if a branch slipped past ``lane-enqueue``'s advisory check (e.g. by altering its
        own copy of ``report-test-changes.mjs`` or ``.gitattributes``), the lane holds it here
        before validation and persists the authoritative report on a ``held`` attempt record.
        """
        changed_gate = [path for path in changed if matches(path, self.config.gate_paths)]
        reasons = list(repair or [])
        checks_less = change_report.check_less_reasons(report, gate_paths=changed_gate)
        if not reasons and not checks_less:
            return False
        branch = entry["branch"]
        cell = self.cell(branch)
        if change_report.is_gate_change_approved(cell, entry.get("head", "")):
            return False
        if checks_less and self.changes_the_factory(entry, cell):
            reasons += checks_less
        if not reasons:
            return False
        self.state["queue"].remove(entry)
        for key in VALIDATION_FIELDS:
            entry.pop(key, None)
        if report is not None:
            entry["testChanges"] = report
        detail, lines = change_report.summarize_hold(reasons)
        entry.update(
            state="held",
            holdReason=change_report.GATE_CHANGE_HOLD,
            holdReasons=lines,
            holdDetail=detail,
        )
        self.state["held"].append(entry)
        if cell is not None:
            cell["state"] = "held"
        self.record(
            "held",
            branch=branch,
            attempt=entry["attempt"],
            holdReason=change_report.GATE_CHANGE_HOLD,
            detail=detail,
            **({"testChanges": report} if report is not None else {}),
        )
        for event in self.state["events"]:
            if (
                is_open(event)
                and event.get("type") == "gate-change-held"
                and event.get("branch") == branch
            ):
                event["open"] = False
                event["resolution"] = {"by": "lane", "at": self.at}
        self.event(
            "gate-change-held",
            branch=branch,
            reason=change_report.GATE_CHANGE_HOLD,
            detail=detail,
            lines=lines,
            needsOwner=change_report.GATE_CHANGE_HOLD,
        )
        self.actions.append(f"held {branch} ({change_report.GATE_CHANGE_HOLD})")
        return True

    def changes_the_factory(self, entry: dict[str, Any], cell: dict[str, Any] | None) -> bool:
        """Whether the branch is an improvement cell or one of its issues is ``area:factory``."""
        if (cell or {}).get("improvement"):
            return True
        try:
            issues = [self.world.github.get_issue(number) for number in entry.get("issues", [])]
        except WorldError as exc:
            raise LaneTrouble(
                f"Reading issues for {entry['branch']} gate-change check failed: {exc}"
            ) from exc
        return change_report.is_factory_branch(issues, cell)

    def review_verified(self, entry: dict[str, Any], base: str) -> bool:
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
