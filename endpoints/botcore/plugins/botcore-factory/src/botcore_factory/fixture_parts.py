"""The parts of a fixture world: GitHub, git, the clock, the machine, plans and processes,
each answering from the fixture's data and writing back to it (``FixtureWorld.save``)."""

from __future__ import annotations

import json
import os
from collections.abc import Callable, Sequence
from datetime import datetime
from typing import TYPE_CHECKING

from botcore_factory.claims import parse_time
from botcore_factory.failures import disk_full, failing_tests
from botcore_factory.world import (
    LANE_HOST_VARIABLE,
    TAIL_LINES,
    Comment,
    Completed,
    FoldOutcome,
    HostRecord,
    Issue,
    MergeOutcome,
    MergeProgress,
    Plan,
    PullRequest,
    WorldError,
)

if TYPE_CHECKING:
    from botcore_factory.fixture_world import FixtureWorld

DEFAULT_NOW = "2030-01-01T00:00:00Z"


def _issue(data: dict) -> Issue:
    return Issue(
        number=data["number"],
        title=data.get("title", f"Issue {data['number']}"),
        labels=tuple(data.get("labels", [])),
        assignees=tuple(data.get("assignees", [])),
        created_at=data.get("createdAt", ""),
        state=data.get("state", "OPEN"),
    )


class FixtureGitHub:
    def __init__(self, store: FixtureWorld) -> None:
        self.store = store

    def repository(self) -> str:
        return self.store.data.get("repository") or "example-org/example-repo"

    def list_issues(self) -> list[Issue]:
        return [
            _issue(issue)
            for issue in self.store.data.get("issues", [])
            if issue.get("state", "OPEN") == "OPEN"
        ]

    def get_issue(self, number: int) -> Issue:
        return _issue(self.store.issue_data(number))

    def comments(self, number: int) -> list[Comment]:
        return [
            Comment(c["id"], c["body"], c.get("author", ""), c.get("createdAt", ""))
            for c in self.store.issue_data(number).get("comments", [])
        ]

    def edit_labels(self, number: int, add: Sequence[str] = (), remove: Sequence[str] = ()) -> None:
        issue = self.store.issue_data(number)
        labels = [label for label in issue.get("labels", []) if label not in set(remove)]
        labels += [label for label in add if label not in labels]
        issue["labels"] = labels
        self.store.save()

    def add_comment(self, number: int, body: str) -> Comment:
        issue = self.store.issue_data(number)
        comments = issue.setdefault("comments", [])
        comment = {
            "id": f"{number}-{len(comments) + 1}",
            "body": body,
            "author": "factory",
            "createdAt": FixtureClock(self.store).stamp(),
        }
        comments.append(comment)
        self.store.save()
        return Comment(comment["id"], body, "factory", comment["createdAt"])

    def open_pull_requests(self) -> list[PullRequest]:
        closes: dict[int, set[int]] = {}
        for issue in self.store.data.get("issues", []):
            for pr in issue.get("openPrs", []):
                number = pr if isinstance(pr, int) else pr["number"]
                closes.setdefault(number, set()).add(issue["number"])
        listed = {pr["number"]: pr for pr in self.store.data.get("pullRequests", [])}
        for number, pr in listed.items():
            closes.setdefault(number, set()).update(pr.get("closes", []))
        return [
            PullRequest(number, listed.get(number, {}).get("branch", ""), tuple(sorted(issues)))
            for number, issues in sorted(closes.items())
        ]

    def get_variable(self, name: str) -> str | None:
        if name == LANE_HOST_VARIABLE:
            return self.store.data.get("laneHost")
        return self.store.data.get("variables", {}).get(name)

    def signed_in(self) -> bool:
        return "gh sign-in" not in self.store.this_machine().get("missing", [])

    def required_checks(self, branch: str) -> list[str]:
        """``requiredChecks``, or the example repository's ``ci-ok`` when
        ``requiredCheckOnMain`` is true."""
        data = self.store.data
        if "requiredChecks" in data:
            return list(data["requiredChecks"])
        return ["ci-ok"] if data.get("requiredCheckOnMain") else []

    def _prs(self) -> dict:
        return self.store.data.setdefault("prs", {})

    def open_pr(self, branch: str, title: str, body: str, base: str = "main") -> int:
        _fail(self.store, "pr", branch)
        for number, pr in self._prs().items():
            if pr["branch"] == branch and pr["state"] == "OPEN" and pr.get("base", "main") == base:
                return int(number)
        number = int(self.store.data.get("nextPr", 600))
        self.store.data["nextPr"] = number + 1
        head = self.store.data.get("pushed", {}).get(branch, "")
        self._prs()[str(number)] = {
            "branch": branch,
            "base": base,
            "title": title,
            "body": body,
            "head": head,
            "state": "OPEN",
        }
        self.store.save()
        return number

    def check_status(self, pr: int, name: str, head: str) -> str:
        """Bound to ``head``: a check reported for another head of the PR is not this one's.
        ``outcomes.checksByHead[head]`` wins over ``outcomes.checks[branch]``."""
        found = self._prs()[str(pr)]
        by_head = self.store.data.get("outcomes", {}).get("checksByHead", {})
        if head in by_head:  # Also a merge queue's commit, which is no head of the PR.
            return str(by_head[head])
        if found.get("head") and found["head"] != head:
            return "missing"
        return _outcome(self.store, "checks", found["branch"], "success")

    def merge_pr(self, pr: int, head: str) -> None:
        """``outcomes.mergePr[branch]``: ``fail: ...`` refuses; ``lands-then-fail: ...`` merges
        and still reports a failure, as a timed-out API call can.

        With ``mergeQueue.required`` the request queues the pull request instead, as GitHub
        does behind a required merge queue: it stays ``OPEN`` in the queue, with the commit the
        queue built for it (``group@<pr>``), until ``mergeQueue.outcomes[branch]`` settles it
        (``merge_progress``)."""
        found = self._prs()[str(pr)]
        result = _outcome(self.store, "mergePr", found["branch"], "ok")
        if result.startswith("fail"):
            raise WorldError(result.removeprefix("fail").lstrip(": ") or "merge failed")
        if found.get("head") and found["head"] != head:
            raise WorldError(f"Head branch was modified: PR {pr}'s head is {found['head']}")
        if (self.store.data.get("mergeQueue") or {}).get("required"):
            # What ``gh pr merge`` does there: into the queue, the pull request being ready.
            self._queue(pr, found, head)
        else:
            self._merge(pr, found, head, f"main@{pr}")
        self.store.save()
        if result.startswith("lands-then-fail"):
            raise WorldError(result.split(":", 1)[1].strip() if ":" in result else "timed out")

    def enqueue_pr(self, pr: int, head: str) -> None:
        """Into the merge queue, bound to ``head``; ``outcomes.mergePr[branch]`` scripts a
        refusal or a lost answer as for ``merge_pr``. A base without a queue refuses."""
        found = self._prs()[str(pr)]
        result = _outcome(self.store, "mergePr", found["branch"], "ok")
        if result.startswith("fail"):
            raise WorldError(result.removeprefix("fail").lstrip(": ") or "enqueue failed")
        if not (self.store.data.get("mergeQueue") or {}).get("required"):
            raise WorldError("Merge queue is not enabled for the base branch")
        if found.get("head") and found["head"] != head:
            raise WorldError(
                f"Failed to add PR #{pr}: expected head oid does not match the current head oid"
            )
        self._queue(pr, found, head)
        self.store.save()
        if result.startswith("lands-then-fail"):
            raise WorldError(result.split(":", 1)[1].strip() if ":" in result else "timed out")

    def _queue(self, pr: int, found: dict, head: str) -> None:
        found["queuedHead"] = head
        found.setdefault("queue", {"state": "QUEUED", "position": 1, "groupHead": f"group@{pr}"})

    def _merge(self, pr: int, found: dict, head: str, commit: str) -> None:
        found["state"] = "MERGED"
        found["mergedHead"] = head
        found["mergeCommit"] = commit
        self.store.data.setdefault("main", {})["head"] = commit

    def pr_state(self, pr: int) -> str:
        return self._prs()[str(pr)]["state"]

    def merge_progress(self, pr: int) -> MergeProgress:
        """A queued pull request is settled here, on a read, once the fixture says how:
        ``mergeQueue.outcomes[branch]`` is ``merge`` (the queue's commit becomes the base's
        head) or ``remove`` / ``remove: <reason>`` (it leaves the queue, still open). Without
        one it stays queued. ``outcomes.mergeProgress`` scripts a failed read."""
        _fail(self.store, "mergeProgress")
        found = self._prs()[str(pr)]
        queue = self.store.data.get("mergeQueue") or {}
        entry = found.get("queue")
        outcome = str((queue.get("outcomes") or {}).get(found["branch"], "wait"))
        if entry and found["state"] == "OPEN" and outcome != "wait":
            found.pop("queue")
            found["removedAt"] = FixtureClock(self.store).stamp()
            found["removedCommit"] = entry["groupHead"]
            if outcome.startswith("remove"):
                found["removalReason"] = outcome.removeprefix("remove").lstrip(": ")
            else:
                found["removalReason"] = "merged"
                self._merge(pr, found, found.get("queuedHead", ""), entry["groupHead"])
            self.store.save()
            entry = None
        entry = entry or {}
        return MergeProgress(
            state=found["state"],
            head=found.get("head", ""),
            queue_required=bool(queue.get("required")),
            queued=bool(entry),
            waiting=bool(found.get("autoMerge")) and found["state"] == "OPEN",
            queue_state=entry.get("state", ""),
            position=entry.get("position"),
            group_head=entry.get("groupHead", ""),
            removed_at=found.get("removedAt", ""),
            removal_reason=found.get("removalReason", ""),
            removed_commit=found.get("removedCommit", ""),
        )

    def commit_message(self, commit: str) -> str:
        """``commitMessages[commit]``: a commit's message (a merge queue's squash)."""
        return str(self.store.data.get("commitMessages", {}).get(commit, ""))

    def merge_commit(self, pr: int) -> str | None:
        return self._prs()[str(pr)].get("mergeCommit")

    def commit_checks(self, commit: str) -> dict[str, str]:
        """``mainChecks[commit]``: each check run's state on a commit of main."""
        _fail(self.store, "mainChecks")
        return dict(self.store.data.get("mainChecks", {}).get(commit, {}))

    def set_variable(self, name: str, value: str) -> None:
        if name == LANE_HOST_VARIABLE:
            self.store.data["laneHost"] = value
        else:
            self.store.data.setdefault("variables", {})[name] = value
        self.store.save()


class FixtureGit:
    def __init__(self, store: FixtureWorld) -> None:
        self.store = store

    def host_records(self) -> list[HostRecord]:
        return [HostRecord.read(raw) for raw in self.store.data.get("machines", [])]

    def _worktree(self, worktree: str) -> dict:
        found = self.store.data.get("worktrees", {}).get(worktree)
        if found is None:
            raise WorldError(f"No worktree {worktree}")
        return found

    def head(self, worktree: str) -> str:
        return self._worktree(worktree).get("head", "")

    def branch(self, worktree: str) -> str | None:
        return self._worktree(worktree).get("branch")

    def uncommitted(self, worktree: str) -> list[str]:
        found = self._worktree(worktree)
        if found.get("uncommitted"):
            return list(found["uncommitted"])
        clean = found.get("clean", not found.get("dirty", False))
        return [] if clean else ["(uncommitted changes)"]

    def changed_files(self, worktree: str, since: str | None = None) -> list[str]:
        """The fixture names the gate paths a branch changed (``gatePathsChanged``) and, when it
        matters, the rest (``changed``); ``since`` is not modelled."""
        if worktree.startswith("slots/"):  # A lane slot: what its branch's merge changed.
            branch = self._slot(worktree)["branch"]
            return list(self.store.data.get("outcomes", {}).get("changed", {}).get(branch, []))
        found = self._worktree(worktree)
        return [*found.get("gatePathsChanged", []), *found.get("changed", [])]

    def repair_edits(
        self, worktree: str, base: str, since: str | None, keep: Callable[[str], bool]
    ) -> list[str]:
        """The branch's own changes the fixture names that ``keep`` selects; ``base`` and
        ``since`` are not modelled (``test_lane_git`` runs the real comparison)."""
        return [path for path in self.changed_files(worktree) if keep(path)]

    def push_queue_ref(self, worktree: str, branch: str, head: str) -> None:
        self._worktree(worktree)
        refs = [
            ref for ref in self.store.data.get("originQueueRefs", []) if ref["branch"] != branch
        ]
        self.store.data["originQueueRefs"] = [*refs, {"branch": branch, "head": head}]
        self.store.save()

    def queue_refs(self) -> list[dict]:
        return [dict(ref) for ref in self.store.data.get("originQueueRefs", [])]

    def delete_queue_ref(self, branch: str, head: str) -> None:
        _fail(self.store, "deleteQueue", branch)
        refs = self.store.data.get("originQueueRefs", [])
        matching = next((ref for ref in refs if ref["branch"] == branch), None)
        if matching is not None and matching["head"] != head:
            raise WorldError(f"Queue ref for {branch} changed; expected {head}")
        self.store.data["originQueueRefs"] = [ref for ref in refs if ref["branch"] != branch]
        self.store.save()

    def publish_host_record(self, record: HostRecord) -> None:
        machines = self.store.data.setdefault("machines", [])
        index = next((i for i, m in enumerate(machines) if m.get("id") == record.id), None)
        if index is None:
            machines.append(record.describe())
        else:  # A ref updated in place keeps its place.
            machines[index] = record.describe()
        self.store.save()

    def origin_reachable(self) -> bool:
        return "origin" not in self.store.this_machine().get("missing", [])

    def read_file(self, worktree: str, path: str) -> str | None:
        if worktree.startswith("slots/"):  # Every lane checkout holds ``slotFiles``; a
            # branch's own (``branchSlotFiles.<branch>``) take their place in its slot.
            branch = self._slots().get(worktree.removeprefix("slots/"), {}).get("branch")
            own = self.store.data.get("branchSlotFiles", {}).get(branch, {})
            return own.get(path, self.store.data.get("slotFiles", {}).get(path))
        return self._worktree(worktree).get("files", {}).get(path)

    def fetch_base(self, base: str) -> str:
        _fail(self.store, "fetch")
        return self.store.data.setdefault("main", {}).get("head", "main-0")

    def _slots(self) -> dict:
        return self.store.data.setdefault("checkouts", {})

    def slots_dir(self) -> str:
        return "slots"

    def prepare_slot(self, slot: str, branch: str, head: str) -> str:
        _fail(self.store, "prepare", branch)
        self._slots()[slot] = {"branch": branch, "head": head}
        self.store.save()
        return f"slots/{slot}"

    def _slot(self, path: str) -> dict:
        return self._slots()[path.removeprefix("slots/")]

    def park_slot(self, slot: str, name: str) -> str:
        """``outcomes.park``: ``fail: ...`` refuses the move."""
        _fail(self.store, "park", self._slots().get(slot, {}).get("branch"))
        self._slots()[name] = self._slots().pop(slot)
        self.store.save()
        return f"slots/{name}"

    def remove_checkout(self, path: str) -> None:
        """Removed checkouts are listed in ``removedCheckouts``; ``outcomes.remove`` fails it."""
        _fail(self.store, "remove")
        self._slots().pop(path.removeprefix("slots/"), None)
        self.store.data.setdefault("removedCheckouts", []).append(path)
        self.store.save()

    def remove_build(self, path: str) -> None:
        """Removed build directories are listed in ``removedBuilds``; ``outcomes.removeBuild``
        fails it."""
        _fail(self.store, "removeBuild")
        self.store.data.setdefault("removedBuilds", []).append(path)
        self.store.save()

    def merge_main(self, path: str, main: str, keep_open=None) -> MergeOutcome:
        slot = self._slot(path)
        result = _outcome(self.store, "merge", slot["branch"], "clean")
        if result.startswith("conflict"):
            files = result.split(":", 1)[1] if ":" in result else ""
            names = tuple(name.strip() for name in files.split(",") if name.strip())
            if keep_open is not None and keep_open(names):
                slot["merging"] = main
                self.store.save()
                return MergeOutcome(False, conflicts=names, open=True)
            return MergeOutcome(False, conflicts=names)
        if result.startswith("fail"):
            raise WorldError(result.removeprefix("fail").lstrip(": ") or "merge did not happen")
        slot["head"] = f"{slot['head']}+{main}"
        self.store.save()
        return MergeOutcome(True, head=slot["head"])

    def finish_merge(self, path: str) -> MergeOutcome:
        """``outcomes.finish[branch]``: ``clean`` (the default) commits the open merge, or
        ``conflict: a, b`` names paths still unmerged."""
        slot = self._slot(path)
        main = slot.pop("merging")
        result = _outcome(self.store, "finish", slot["branch"], "clean")
        if result.startswith("conflict"):
            files = result.split(":", 1)[1] if ":" in result else ""
            self.store.save()
            return MergeOutcome(False, conflicts=tuple(f.strip() for f in files.split(",") if f))
        slot["head"] = f"{slot['head']}+{main}"
        self.store.save()
        return MergeOutcome(True, head=slot["head"])

    def abort_merge(self, path: str) -> None:
        self._slot(path).pop("merging", None)
        self.store.save()

    def fold(self, path: str, base: str) -> FoldOutcome:
        """``outcomes.fold[branch]``: ``keep`` (the default: the merged head is taken as one
        commit of its own already), ``folded`` (a new head, ``<head>=1``, with the same tree),
        ``refuse: why`` or ``fail: ...``."""
        slot = self._slot(path)
        result = _outcome(self.store, "fold", slot["branch"], "keep")
        if result.startswith("fail"):
            raise WorldError(result.removeprefix("fail").lstrip(": ") or "fold failed")
        if result.startswith("refuse"):
            return FoldOutcome(refused=result.removeprefix("refuse").lstrip(": ") or "refused")
        if result == "folded":
            slot["tree"] = f"tree-{slot['head']}"
            slot["head"] = f"{slot['head']}=1"
            self.store.save()
        return FoldOutcome(head=slot["head"])

    def tree(self, path: str) -> str:
        slot = self._slot(path)
        return slot.get("tree") or f"tree-{slot['head']}"

    def diff_names(self, old: str, new: str) -> list[str]:
        """``main.changes[new]``: what changed up to ``new`` (since any ``old``): main's move, or,
        keyed by a validated head, the branch's changes."""
        _fail(self.store, "diff")
        return list(self.store.data.get("main", {}).get("changes", {}).get(new, []))

    def merges_cleanly(self, head: str, base: str) -> MergeOutcome:
        """``outcomes.mergeTree[head]``: ``clean`` (the default), ``conflict: a, b`` or
        ``fail: ...``."""
        result = _outcome(self.store, "mergeTree", head, "clean")
        if result.startswith("conflict"):
            files = result.split(":", 1)[1] if ":" in result else ""
            return MergeOutcome(False, conflicts=tuple(f.strip() for f in files.split(",") if f))
        if result.startswith("fail"):
            raise WorldError(result.removeprefix("fail").lstrip(": ") or "merge-tree failed")
        return MergeOutcome(True, head=f"tree-{head}+{base}")

    def push_head(self, path: str, branch: str, head: str, lease: str | None) -> None:
        """origin's branches (``pushed``): a lease must match origin's head; without one, a
        push over a different head is not a fast forward (the lane's merge commits never
        are). ``outcomes.push[branch]`` scripts a failure."""
        if self._slot(path)["head"] != head:
            raise WorldError(f"Validation checkout {path} no longer holds {head}; validate again")
        _fail(self.store, "push", branch)
        pushed = self.store.data.setdefault("pushed", {})
        remote = pushed.get(branch)
        if any(
            pr["branch"] == branch and pr["state"] == "OPEN" and pr.get("queue")
            for pr in self.store.data.get("prs", {}).values()
        ):  # GitHub locks the head branch of a pull request in a merge queue.
            raise WorldError(f"! [remote rejected] {branch} (protected branch hook declined)")
        if lease and remote not in (None, lease):
            raise WorldError(f"! [rejected] {branch} (stale info): origin has {remote}")
        if not lease and remote not in (None, head):
            raise WorldError(f"! [rejected] {branch} (non-fast-forward)")
        pushed[branch] = head
        for pr in self.store.data.get("prs", {}).values():
            if pr["branch"] == branch and pr["state"] == "OPEN":
                pr["head"] = head
        self.store.save()


class FixtureClock:
    def __init__(self, store: FixtureWorld) -> None:
        self.store = store

    def now(self) -> datetime:
        return parse_time(self.store.data.get("now") or DEFAULT_NOW)

    def stamp(self) -> str:
        return self.now().isoformat().replace("+00:00", "Z")


class FixtureMachine:
    def __init__(self, store: FixtureWorld) -> None:
        self.store = store

    def id(self) -> str:
        return self.store.data.get("thisMachine") or "workstation"

    def cores(self) -> int:
        return int(self.store.this_machine().get("cores", 1))

    def memory_gb(self) -> float:
        return float(self.store.this_machine().get("memoryGb", 0))

    def free_memory_gb(self) -> float:
        host = self.store.data.get("host", {})
        if "freeMemoryGb" not in host:
            raise WorldError("The fixture does not say how much memory is free (host.freeMemoryGb)")
        return float(host["freeMemoryGb"])

    def is_dir(self, path: str) -> bool:
        """True unless ``host.missingDirs`` lists ``path``."""
        return path not in self.store.data.get("host", {}).get("missingDirs", [])

    def free_disk_gb(self, path: str) -> float:
        """``host.freeDiskGbAt[path]``, else ``host.freeDiskGb``, else this machine's record's
        ``freeDiskGb``."""
        host = self.store.data.get("host", {})
        if path in host.get("freeDiskGbAt", {}):
            return float(host["freeDiskGbAt"][path])
        if "freeDiskGb" in host:
            return float(host["freeDiskGb"])
        record = self.store.this_machine()
        if "freeDiskGb" not in record:
            raise WorldError(
                "The fixture does not say how much disk is free (host.freeDiskGb, or this "
                "machine's freeDiskGb)"
            )
        return float(record["freeDiskGb"])

    def has_program(self, name: str) -> bool:
        return name not in self.store.this_machine().get("missing", [])

    def disk_warnings(self) -> list[str]:
        """``host.diskWarnings``, else none."""
        return list(self.store.data.get("host", {}).get("diskWarnings", []))

    def symlinks(self) -> bool:
        return "symlinks" not in self.store.this_machine().get("missing", [])

    def tool_version(self, tool: str, path: Sequence[str] = ()) -> str | None:
        """``nodeToolchains.<bin>.<tool>`` for the first directory of ``path`` that has the
        tool, else ``toolchains.<tool>`` (the host's PATH)."""
        on_path = self.store.data.get("nodeToolchains", {})
        for directory in path:
            if tool in on_path.get(directory, {}):
                return on_path[directory][tool]
        return self.store.data.get("toolchains", {}).get(tool)

    def node_bin(self, spec: str) -> str | None:
        """``nodes.<spec>``: the installed Node's bin directory, or absent when it is not."""
        return self.store.data.get("nodes", {}).get(spec.strip().removeprefix("v"))


class FixturePlans:
    def __init__(self, store: FixtureWorld) -> None:
        self.store = store

    def read(self) -> list[Plan]:
        if self.store.data.get("plansUnreadable"):
            raise WorldError("The fixture's plans are unreadable")
        return [
            Plan(
                raw["id"],
                raw.get("provider", ""),
                float(raw["used"]),
                float(raw["elapsed"]),
                raw.get("resetsAt"),
            )
            for raw in self.store.data.get("plans", [])
        ]


class FixtureProcesses:
    """Only this process, and pids the fixture lists as alive, are running."""

    def __init__(self, store: FixtureWorld) -> None:
        self.store = store

    def alive(self, pid: int, started_at: float | None = None) -> bool:
        if pid == os.getpid():
            return True
        if pid not in self._processes().get("alive", []):
            return False
        known = self.start_time(pid)
        return started_at is None or known is None or abs(known - started_at) < 2

    def start_time(self, pid: int) -> float | None:
        known = self._processes().get("startTimes", {}).get(str(pid))
        return None if known is None else float(known)

    def _processes(self) -> dict:
        return self.store.data.setdefault("processes", {})

    def start_job(self, steps: Sequence[dict], cwd: str, log: str, *, label: str) -> str:
        """A scripted job: each step's ``outcomes.<step label>[branch]`` (``pass`` by default,
        ``running``, or ``fail: ...``), in order; the coverage slot's branch is empty."""
        _fail(self.store, f"start-{label}")
        processes = self._processes()
        number = int(processes.get("started", 0)) + 1
        processes["started"] = number
        handle = f"run-{number}"
        slot = self.store.data.get("checkouts", {}).get(cwd.removeprefix("slots/"), {})
        processes.setdefault("running", {})[handle] = {
            "steps": [dict(step) for step in steps],
            "label": label,
            "branch": slot.get("branch"),
            "head": slot.get("head"),  # What the slot held when the job started.
            "log": log,
        }
        self.store.save()
        return handle

    def poll(self, handle: str) -> Completed | None:
        run = self._processes().get("running", {}).get(handle)
        if run is None:
            raise WorldError(f"No running process {handle}")
        for step in run["steps"]:
            result = _outcome(self.store, step["label"], run["branch"], "pass")
            if result == "running":
                return None
            if result.startswith("fail"):
                del self._processes()["running"][handle]
                self.store.save()
                output = result.removeprefix("fail").lstrip(": ")
                # As the real world does: the log's tail, and every failing test in all of it.
                tail = "\n".join(output.splitlines()[-TAIL_LINES:])
                tests = tuple(failing_tests(output))
                full = disk_full(output)
                return Completed(tuple(step["args"]), 1, tail, "", step["label"], tests, full)
        del self._processes()["running"][handle]
        self.store.save()
        return Completed(tuple(run["steps"][-1]["args"]), 0, "ok", "")

    def kill(self, handle: str) -> None:
        self._processes().get("running", {}).pop(handle, None)
        self.store.save()

    def start_detached(self, args: Sequence[str], cwd: str, log: str) -> int:
        processes = self._processes()
        pid = int(processes.get("nextPid", 4_100_000))
        processes["nextPid"] = pid + 1
        processes.setdefault("alive", []).append(pid)
        processes.setdefault("startTimes", {})[str(pid)] = float(pid)
        processes.setdefault("detached", {})[str(pid)] = list(args)
        self.store.save()
        return pid

    def terminate(self, pid: int, started_at: float | None) -> bool:
        known = self.start_time(pid)
        alive = self._processes().get("alive", [])
        if started_at is None or known is None or abs(known - started_at) >= 2 or pid not in alive:
            return False
        alive.remove(pid)
        self._processes().setdefault("killed", []).append(pid)
        self.store.save()
        return True

    def run(
        self,
        args: Sequence[str],
        cwd: str,
        timeout: float | None = None,
        *,
        label: str | None = None,
    ) -> Completed:
        if label == "units":
            return _units_run(self.store, tuple(args))
        if label and label.startswith("regenerate:"):
            # ``outcomes.regenerate[name]``: ``pass`` (the default), ``fail: why`` (exits 1) or
            # ``error: why`` (cannot run).
            name = label.split(":", 1)[1]
            result = _outcome(self.store, "regenerate", name, "pass")
            if result.startswith("error"):
                raise WorldError(result.removeprefix("error").lstrip(": ") or "cannot run")
            if result.startswith("fail"):
                return Completed(tuple(args), 1, "", result.removeprefix("fail").lstrip(": "))
            return Completed(tuple(args), 0, "regenerated", "")
        worktrees = self.store.data.get("worktrees", {})
        worktree = worktrees.get(cwd)
        if worktree is None and label == "review-evidence":
            # The lane's own run, from its review slot: the worktree is named in the arguments,
            # and ``outcomes.review`` scripts a verifier that cannot run (``fail: ...``) or one
            # that exits with another code (``exit N``).
            scripted = _outcome(self.store, "review", None, "ok")
            if scripted.startswith("exit "):
                return Completed(tuple(args), int(scripted.split()[1]), "", scripted)
            _fail(self.store, "review")
            named = [worktrees[arg] for arg in args if arg in worktrees]
            if not named:
                return Completed(tuple(args), 3, "", "review-record: no such worktree")
            worktree = named[0]
        if worktree is not None and label:
            return _worktree_run(tuple(args), worktree, label)
        commands = self.store.data.get("processes", {}).get("results", {})
        key = " ".join(args)
        if key not in commands:
            raise WorldError(f"The fixture has no result for: {key}")
        result = commands[key]
        return Completed(
            tuple(args),
            result.get("returncode", 0),
            result.get("stdout", ""),
            result.get("stderr", ""),
        )


def _outcome(store: FixtureWorld, kind: str, key: str | None = None, default: str = "pass"):
    """The fixture's scripted outcome (``outcomes``): per key (a branch), or one for all."""
    found = store.data.get("outcomes", {}).get(kind)
    if isinstance(found, dict):
        return str(found.get(key, default))
    return default if found is None else str(found)


def _fail(store: FixtureWorld, kind: str, key: str | None = None) -> None:
    result = _outcome(store, kind, key, "ok")
    if result.startswith("fail"):
        raise WorldError(result.removeprefix("fail").lstrip(": ") or f"{kind} failed")


def _units_run(store: FixtureWorld, args: tuple[str, ...]) -> Completed:
    """The adapter's ``units`` command: ``units`` maps a path prefix to the units it affects;
    each argument takes those of its longest matching prefix (``fail`` makes the run fail)."""
    table = store.data.get("units")
    if table is None:
        raise WorldError("The fixture has no units table")
    if table == "fail":
        return Completed(args, 1, "", "units failed")
    found: list[str] = []
    for arg in args:
        prefixes = [prefix for prefix in table if arg.startswith(prefix)]
        if prefixes:
            found += table[max(prefixes, key=len)]
    return Completed(args, 0, json.dumps(sorted(set(found))), "")


def _worktree_run(args: tuple[str, ...], worktree: dict, label: str) -> Completed:
    """Answer a labelled run in a fixture worktree: its review record or a prequeue stage."""
    if label == "review-evidence":
        review = worktree.get("review")
        asked = args[args.index("--head") + 1] if "--head" in args[:-1] else worktree.get("head")
        reviewed = bool(review) and review.get("head") == worktree.get("head") == asked
        # 3 is the verifier's refusal (``scripts/review-record.mjs``'s ``REFUSED``).
        return Completed(args, 0 if reviewed else 3, "", "" if reviewed else "no review record")
    if label.startswith("prequeue:"):
        stage = label.split(":", 1)[1]
        results = worktree.get("prequeue", {})
        if stage not in results:
            raise WorldError(f"The fixture worktree has no result for the {stage} stage")
        outcome = str(results[stage])
        if outcome == "pass":
            return Completed(args, 0, "", "")
        return Completed(args, 1, outcome.removeprefix("fail").lstrip(": ").strip(), "")
    raise WorldError(f"The fixture cannot answer a {label} run")
