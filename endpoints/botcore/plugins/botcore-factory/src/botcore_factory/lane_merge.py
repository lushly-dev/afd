"""The front of the queue on its way to a merge: serial, in queue order, bound to the head.

A validated branch at the front is pushed (its validated head, by commit, not whatever its slot
holds now; with a lease on the head the lane last pushed there, since the lane owns the branch),
its PR opened, and the adapter's ``required_check`` awaited on that head. Before the push and
again before the merge the base is read again: if it moved since the validation started, the
branch advances to it when main's move cannot touch what it validated, and is validated again
otherwise (``lane_advance``), unless its reruns reached ``lane.maxBaseReruns``: then the PR's
required check, run on the pull request's merge ref, stands in for the local validation. The merge
is bound to the validated head (``--match-head-commit``).
Nothing advances while coverage a gate-path merge owes has not passed.

Asking GitHub to merge is not the merge. After asking, the lane reads what happened
(``merge_progress``): merged, and the branch lands as before; or, where the base takes merges only
through a merge queue, queued. There the lane asks with ``enqueue_pr`` (GraphQL
``enqueuePullRequest``, bound to the validated head), never the CLI's merge, which would set
auto-merge on a pull request whose checks had not finished. A queued branch waits at the front in
state ``merge-queued``, read again each step, until it is ``MERGED`` (it lands) or it left the
queue unmerged (it is ejected: ``ci-failed`` when the required check failed on the commit the
queue built for it, which counts toward ``cells.maxEjections`` as any failed check does;
``merge-failed`` otherwise, which does not). The queue is found in GitHub's answer, never in
configuration, so the same lane is right before and after a queue is turned on.

While a branch is in GitHub's queue:

- nothing behind it is pushed or merged: merges stay serial and in queue order (validations go on
  in their slots);
- the base is not followed and nothing is pushed. GitHub locks the head branch of a queued
  pull request (a push is refused), and its queue rebuilds its commit on the base's new head and
  on whatever is queued ahead and runs the required check on exactly what lands, so a move of
  main needs no new validation here. ``lane-enqueue`` and ``lane-drop`` refuse the branch
  (``MERGE_QUEUED``) until it merged or left the queue;
- the wait is bounded by ``lane.checkTimeoutMinutes`` from when it was queued; past it the lane
  pauses (its own trouble) and the pull request stays in the queue;
- the lane host is not read again: the request was made while this machine was the host, and
  only reads follow;
- a stop or a crash loses nothing: the entry keeps its state, and the next step (or ``resume``)
  reads GitHub again.
"""

from __future__ import annotations

import re
from typing import Any

from botcore_factory.adapter import matches
from botcore_factory.cells import holding_seats
from botcore_factory.lane_advance import Advancing
from botcore_factory.lane_base import (
    HEAD_MISMATCH,
    MERGE_QUEUED,
    NON_FAST_FORWARD,
    NOT_MERGEABLE,
    PR_REFUSED,
    LaneTrouble,
)
from botcore_factory.world import LANE_HOST_VARIABLE, MergeProgress, WorldError

#: How long a pull request the lane asked GitHub to merge may show neither a merge, a queue
#: entry nor auto-merge before it is taken to have left the queue (GitHub's reads can trail
#: its writes).
QUEUE_GRACE_MINUTES = 2.0
#: How long a pull request that left the queue must stay open before it is ejected. GitHub logs
#: a merge as a removal too, a second before the pull request reads as merged, so the first
#: read that finds the queue empty decides nothing. One whose removal says ``merged`` is never
#: ejected: still open after ``MERGED_SETTLE_MINUTES``, it is the lane's trouble.
QUEUE_SETTLE_MINUTES = 1.0
MERGED_SETTLE_MINUTES = 5.0
#: GitHub's word for a removal because the required check failed on the queue's commit.
FAILED_CHECKS = "failed_checks"
_CO_AUTHOR = re.compile(r"^[ \t]*co-authored-by[ \t]*:.*$", re.IGNORECASE | re.MULTILINE)


class Merging(Advancing):
    def advance_front(self) -> None:
        if not self.state["queue"]:
            return
        entry = self.state["queue"][0]
        if entry.get("state") == MERGE_QUEUED:
            self.await_queue(entry)  # Only reads: GitHub merges it, whatever the lane owes.
            return
        if self.lane.get("gateOwed"):
            return  # A gate-path merge's coverage comes first.
        if entry.get("state") == "validated":
            if self.follow_base(entry):
                self.push_and_open(entry)
        elif entry.get("state") == "merging":
            self.await_check(entry)

    def push_and_open(self, entry: dict[str, Any]) -> None:
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
        entry["checkBase"] = entry["base"]  # What the required check's merge ref holds at least.
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

    def pr_body(self, entry: dict[str, Any]) -> str:
        cell = self.cell(entry["branch"]) or {}
        text = ""
        if cell.get("worktree") and entry.get("bodyFile"):
            text = self.world.git.read_file(cell["worktree"], entry["bodyFile"]) or ""
        closes = "\n".join(f"Closes #{n}" for n in entry.get("issues", []))
        verified = (
            f"`{' '.join(self.config.validate_command or [])}` passed on {entry['validatedHead']} "
            f"(base {entry.get('validatedBase', entry['base'])}, tree {entry.get('tree')})."
        )
        if entry.get("checkStandsIn"):
            verified += (
                f" Main moved under it {entry.get('baseReruns', 0)} times while it was validated "
                f"again, so it advanced to base {entry['base']} without a new local validation: "
                f"`{self.config.required_check}` on this pull request's merge ref stands in "
                "(`lane.maxBaseReruns`), and main's checks are watched after the merge."
            )
        elif entry.get("validatedBase"):
            verified += (
                f" Advanced to base {entry['base']} without a new validation: main's changes "
                "touched none of its units or shared inputs."
            )
        return f"{text.strip()}\n\n{closes}\n\n## Verification\n\n{verified}\n".lstrip()

    def await_check(self, entry: dict[str, Any]) -> None:
        github, pr, head = self.world.github, entry["pr"], entry["pushedHead"]
        check = self.config.required_check
        if not check:
            raise LaneTrouble(
                "The repository adapter names no required_check: the lane merges only behind one"
            )
        try:
            progress = github.merge_progress(pr)
            status = github.check_status(pr, check, head)
        except WorldError as exc:
            raise LaneTrouble(f"Reading PR {pr} failed: {exc}") from exc
        if progress.state == "MERGED":
            self.land(entry, without_check=status != "success", merged_head=progress.head)
            return
        if progress.state == "CLOSED":
            self.eject(entry, "pr-closed", f"PR {pr} was closed without merging")
            return
        if progress.removal_reason.strip().lower() == "merged":
            # Open, and its last removal from a merge queue says ``merged``: GitHub logs that a
            # second before the pull request reads as merged, and a merged pull request never
            # reopens. Asking again would find main moved by this pull request's own merge
            # and validate it again; it waits for ``MERGED`` instead.
            self.enter_queue(entry, progress, "")
            entry["mergeQueue"]["queue"] = True
            return
        if progress.queued:
            # In GitHub's queue already: a lane that stopped between the request and its
            # record. Asking again would change nothing, and ejecting it would forget a pull
            # request GitHub is about to merge. Only the head the lane validated is adopted.
            self.same_head(entry, progress)
            self.enter_queue(entry, progress, progress.removed_at)
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
        self.merge(entry, progress)

    def merge(self, entry: dict[str, Any], before: MergeProgress) -> None:
        pr, head = entry["pr"], entry["pushedHead"]
        if not self.follow_base(entry):
            return  # Never merge what main's move may have touched without validating it.
        host, me = self.world.github.get_variable(LANE_HOST_VARIABLE), self.world.machine.id()
        if host != me:
            self.lane["stopRequested"] = "not-host"
            raise LaneTrouble(f"The lane host is {host}, not {me}: this lane merges nothing more")
        github = self.world.github
        try:
            if before.queue_required:
                github.enqueue_pr(pr, head)  # Never auto-merge: the check passed on this head.
            else:
                github.merge_pr(pr, head)
        except WorldError as exc:
            try:
                after = github.merge_progress(pr)
            except WorldError as again:
                raise LaneTrouble(f"Merging PR {pr} failed: {exc}; {again}") from again
            if after.state == "MERGED":  # It landed; only the answer was lost.
                self.land(entry, merged_head=after.head)
            elif after.queued:  # It was queued; only the answer was lost.
                # Auto-merge alone is never the lane's lost answer: neither request sets it,
                # so a refusal with someone's auto-merge on the pull request is a refusal.
                self.same_head(entry, after)
                self.enter_queue(entry, after, before.removed_at)
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
        # GitHub took the request. Whether that merged it is GitHub's to say: behind a merge
        # queue the pull request is queued and still open.
        try:
            after = github.merge_progress(pr)
        except WorldError as exc:
            # The request was taken and its outcome is unknown. The entry must not stay
            # ``merging``, or a later step would ask again for a head GitHub may by then have
            # let go: it waits as ``merge-queued`` and the next step reads what happened.
            self.actions.append(f"PR {pr} was asked for; reading it failed, read again: {exc}")
            after = MergeProgress(queue_required=before.queue_required)
        if after.state == "MERGED":
            self.land(entry, merged_head=after.head)
            return
        if after.state == "CLOSED":
            self.eject(entry, "pr-closed", f"PR {pr} was closed without merging")
            return
        self.enter_queue(entry, after, before.removed_at)

    def same_head(self, entry: dict[str, Any], progress: MergeProgress) -> None:
        """The lane's trouble when GitHub's queue holds the pull request at a head the lane did
        not validate: nothing of it is adopted, landed or ejected until a person has looked."""
        pr, head = entry["pr"], entry["pushedHead"]
        if progress.head and progress.head != head:
            raise LaneTrouble(
                f"PR {pr} is in the merge queue at {progress.head}, not at {head}, the head "
                "the lane validated: take it out of the queue on GitHub, then lane-resume"
            )

    def enter_queue(
        self, entry: dict[str, Any], progress: MergeProgress, removed_before: str
    ) -> None:
        """GitHub holds the merge request: wait for it at the front, in ``merge-queued``."""
        entry["state"] = MERGE_QUEUED
        entry["mergeQueue"] = {
            "since": self.at,  # The wait's limit counts from here; a lane-error resets it.
            "queuedAt": self.at,
            "removedBefore": removed_before,
        }
        if progress.queue_required:
            entry["mergeQueue"]["queue"] = True
        self.note_queue(entry, progress)
        where = "the merge queue" if progress.queued else "auto-merge, until the queue takes it"
        if not progress.pending:
            where = "GitHub, which shows no merge yet"
        self.actions.append(f"merge of {entry['branch']} (PR {entry['pr']}) waits in {where}")

    def note_queue(self, entry: dict[str, Any], progress: MergeProgress) -> None:
        """Keep what GitHub says of the queued request on the entry, for ``lane-status`` and
        for reading the queue's commit once it is gone."""
        waiting = entry["mergeQueue"]
        if progress.queued:
            waiting["seen"] = waiting["queue"] = True
            waiting["state"], waiting["position"] = progress.queue_state, progress.position
            if progress.group_head:
                waiting["groupHead"] = progress.group_head
        elif progress.waiting:
            waiting["state"] = "AUTO_MERGE"

    def await_queue(self, entry: dict[str, Any]) -> None:
        """Read a queued merge again: land it, eject it, or go on waiting within the limit."""
        pr, waiting = entry["pr"], entry["mergeQueue"]
        try:
            progress = self.world.github.merge_progress(pr)
        except WorldError as exc:
            raise LaneTrouble(f"Reading PR {pr} in the merge queue failed: {exc}") from exc
        if progress.state == "MERGED":
            self.land(entry, merged_head=progress.head)
            return
        if progress.state == "CLOSED":
            self.eject(entry, "pr-closed", f"PR {pr} was closed without merging")
            return
        if progress.pending:
            waiting.pop("leftAt", None)
            if progress.queued:
                self.same_head(entry, progress)
            elif progress.head and progress.head != entry["pushedHead"]:
                # Only auto-merge holds it, and the branch moved: what would merge is not what
                # the lane validated.
                self.eject(
                    entry,
                    "merge-failed",
                    f"PR {pr}'s head moved to {progress.head} after the lane asked to merge "
                    f"{entry['pushedHead']}",
                )
                return
            self.note_queue(entry, progress)
            if not progress.queued and self.check_failed(entry):
                return  # Auto-merge waits on a check that failed: GitHub will never queue it.
            limit = self.dial("lane.checkTimeoutMinutes")
            if self.minutes(waiting.get("since")) > limit:
                waiting["since"] = self.at  # A fresh wait after lane-resume.
                place = (
                    f"{waiting.get('state') or 'queued'}, position {waiting.get('position')}"
                    if progress.queued
                    else "auto-merge is set but the queue has not taken it"
                )
                raise LaneTrouble(
                    f"PR {pr} has waited in the merge queue for {limit} minutes ({place}); it "
                    "is left there: read the queue on GitHub, then lane-resume"
                )
            return
        removed = progress.removed_at != waiting.get("removedBefore")
        reason = progress.removal_reason.strip() if removed else ""
        fresh = self.minutes(waiting.get("since")) < QUEUE_GRACE_MINUTES
        if not removed and not waiting.get("seen") and fresh:
            return  # Asked a moment ago: GitHub may not show the request yet.
        if not waiting.get("leftAt"):
            waiting["leftAt"] = self.at  # Read again before deciding: a merge looks like this.
            return
        if reason.lower() == "merged":
            # GitHub says the queue merged it. It is never ejected on that word: past the
            # settle time the lane pauses and keeps the entry for whoever reads GitHub.
            if self.minutes(waiting["leftAt"]) > MERGED_SETTLE_MINUTES:
                waiting["leftAt"] = self.at
                raise LaneTrouble(
                    f"GitHub says the merge queue merged PR {pr}, but it has read as open for "
                    f"{MERGED_SETTLE_MINUTES:g} minutes since; nothing was landed or ejected: "
                    "read the pull request on GitHub, then lane-resume"
                )
            return
        if self.minutes(waiting["leftAt"]) < QUEUE_SETTLE_MINUTES:
            return
        commit = progress.removed_commit if removed else ""
        self.left_queue(entry, reason, commit or waiting.get("groupHead") or "")

    def check_failed(self, entry: dict[str, Any]) -> bool:
        """Eject an entry that waits on auto-merge once the required check failed on its head:
        GitHub keeps auto-merge set, and nothing else would ever end the wait."""
        pr, head, check = entry["pr"], entry["pushedHead"], self.config.required_check
        try:
            status = self.world.github.check_status(pr, check, head) if check else "missing"
        except WorldError as exc:
            raise LaneTrouble(f"Reading PR {pr} failed: {exc}") from exc
        if status != "failure":
            return False
        self.eject(entry, "ci-failed", f"{check} failed on PR {pr} at {head}")
        return True

    def left_queue(self, entry: dict[str, Any], reason: str, group: str) -> None:
        """The pull request is open and GitHub no longer holds a merge request for it.

        ``group`` is the commit the queue had built for it (the removal's own, else the queue
        entry's head as last read). When GitHub says the queue's checks failed
        (``failed_checks``), or the required check failed on that commit, the branch failed a
        check and is ejected as ``ci-failed``.
        A ``Co-authored-by:`` line in the commit the queue built is named: a rebasing queue keeps
        the branch's own message, a squashing one adds a line for every commit author who is not
        the pull request's, and a base that refuses co-authors fails the check for that alone,
        whatever the branch's code does. Anything else (a
        conflict in the queue, a person removing it, a reason GitHub does not give) is
        ``merge-failed``: GitHub refused the merge, and the branch may not need to change.
        """
        pr, check = entry["pr"], self.config.required_check
        github = self.world.github
        failed = reason.lower() == FAILED_CHECKS
        status, message = "missing", ""
        if group and check:
            try:
                status = github.check_status(pr, check, group)
                if failed or status == "failure":
                    message = github.commit_message(group)
            except WorldError as exc:
                raise LaneTrouble(
                    f"Reading the merge queue's commit {group} for PR {pr} failed: {exc}"
                ) from exc
        if failed or status == "failure":
            what = check if status == "failure" else "A check"
            where = f"on {group}, the commit the merge queue built for PR {pr}"
            detail = (
                f"{what} failed {where}"
                if group
                else (
                    f"The merge queue's checks failed for PR {pr}; the lane did not see its commit"
                )
            )
            reason = "" if failed else reason
            credited = [line.strip() for line in _CO_AUTHOR.findall(message)]
            if credited:
                detail += (
                    f": the commit the queue built carries `{credited[0]}`, which a check that "
                    "refuses co-authors fails. A rebasing queue lands the branch's own message; a "
                    "squashing one adds a line for each commit author who is not the pull "
                    "request's: take any such line out of the branch's commit messages, and "
                    "author every commit of the branch as the pull request's author"
                )
            elif reason:
                detail += f" ({reason})"
            self.eject(entry, "ci-failed", detail)
            return
        why = f": {reason}" if reason else "; GitHub gave no reason"
        self.eject(entry, "merge-failed", f"PR {pr} left the merge queue unmerged{why}")

    def land(
        self, entry: dict[str, Any], without_check: bool = False, merged_head: str = ""
    ) -> None:
        """Record the merge. ``merged_head`` is the pull request's head as GitHub gives it: when
        it is not the head the lane pushed (a person pushed and merged or queued it between two
        steps), what merged was never validated here, whatever the validated head's check
        says. The landing is then recorded with ``headMoved`` and ``mergedHead``, counted as
        merged without the check, and raised as ``merged-without-check``."""
        branch, pr = entry["branch"], entry["pr"]
        validated = entry.get("pushedHead")
        moved = bool(merged_head and validated and merged_head != validated)
        without_check = without_check or moved
        # Through a queue only if GitHub showed one: a read that trailed a direct merge also
        # waits a step in ``merge-queued``.
        waited = entry.get("mergeQueue") if (entry.get("mergeQueue") or {}).get("queue") else None
        self.world.git.delete_queue_ref(branch, entry["head"])
        full = len(holding_seats(self.state)) >= self.dial("cells.max")
        self.state["queue"].remove(entry)
        self.record(
            "merged",
            branch=branch,
            attempt=entry["attempt"],
            pr=pr,
            withoutCheck=without_check,
            **({"headMoved": True, "mergedHead": merged_head} if moved else {}),
            advanced=bool(entry.get("advanced")),
            checkStoodIn=bool(entry.get("checkStandsIn")),
            **(
                {"checkBase": entry.get("checkBase"), "base": entry.get("base")}
                if entry.get("checkStandsIn")
                else {}
            ),
            **(
                {"mergeQueue": True, "queueMinutes": self.minutes(waited.get("queuedAt"))}
                if waited
                else {}
            ),
            **(
                {"testChanges": entry["testChanges"]}
                if entry.get("testChanges") is not None
                else {}
            ),
        )
        self.watch_unchecked(entry, pr)
        cell = self.cell(branch)
        if cell is not None:
            self.state["cells"].remove(cell)
        through = ", through the merge queue" if waited else ""
        self.event("merged", branch=branch, detail=f"PR {pr}{through}")
        if without_check:
            self.event(
                "merged-without-check",
                branch=branch,
                detail=(
                    f"PR {pr} merged at {merged_head}, not at {validated}, the head the lane "
                    "validated"
                    if moved
                    else f"PR {pr} merged without {self.config.required_check} green"
                ),
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
        self.actions.append(f"merged {branch} (PR {pr}){through}")
