"""A base that moved under a validated branch, and main after a merge that was not checked again.

Before a validated branch is pushed and again before it is merged, the base is read again. When
it moved, the lane reads what main changed since the branch's validated base and advances the
branch to the new base without validating it again only when all of these hold:

- none of main's new changes is a shared input (the adapter's ``shared_paths`` or ``gate_paths``);
- the validated head still merges onto the new base without a conflict (``git merge-tree``);
- the units main's changes affect and the units the branch's changes affect are disjoint (the
  adapter's ``units`` command names them; without it, a moved base is always validated again).

Otherwise the branch is validated again (``rerun``, ``main-moved``, with why in ``detail``). An
advance is a ``base-advanced`` record. A merge after one is watched on main (``uncheckedMerges``):
when a check the adapter's ``main_checks`` selects fails on its merge commit, the lane pauses and
raises ``main-broken`` naming the PRs merged without a re-check.
"""

from __future__ import annotations

import json

from botcore_factory.adapter import check_selected, matches
from botcore_factory.lane_base import LaneTrouble, StepBase
from botcore_factory.world import WorldError

#: More of main's changes than this is validated again rather than mapped to units.
MAIN_CHANGES_LIMIT = 400
UNITS_TIMEOUT_SECONDS = 120
#: Main's checks are read as settled only this long after the merge, so a workflow GitHub
#: registers late is not missed.
SETTLE_MINUTES = 2.0


class Advancing(StepBase):
    def follow_base(self, entry: dict) -> bool:
        """Whether the entry may go on at the base's head: it is where the entry was validated,
        or the entry advanced to it. Otherwise the entry is requeued and this is False."""
        new = self.base_head(fresh=True)
        old = entry["base"]
        if new == old:
            return True
        reason = self.why_validate_again(entry, old, new)
        if reason is not None:
            self.requeue(entry, "main-moved", detail=reason)
            return False
        entry["base"] = new
        entry["advanced"] = int(entry.get("advanced", 0)) + 1
        self.record(
            "base-advanced",
            branch=entry["branch"],
            attempt=entry["attempt"],
            head=entry.get("validatedHead"),
            previous=old,
            base=new,
        )
        self.actions.append(f"advanced {entry['branch']} to {new}")
        return True

    def why_validate_again(self, entry: dict, old: str, new: str) -> str | None:
        """Why the move from ``old`` to ``new`` needs a new validation, or None when it does not."""
        if not self.config.units:
            return "the adapter names no units command"
        try:
            changed = self.world.git.diff_names(old, new)
        except WorldError as exc:
            return f"main's changes could not be read: {exc}"
        if len(changed) > MAIN_CHANGES_LIMIT:
            return f"main changed {len(changed)} files"
        shared = [
            path
            for path in changed
            if matches(path, [*self.config.shared_paths, *self.config.gate_paths])
        ]
        if shared:
            return f"main changed a shared input: {', '.join(shared[:5])}"
        try:
            merged = self.world.git.merges_cleanly(entry["validatedHead"], new)
        except WorldError as exc:
            return f"the merge onto {new} could not be computed: {exc}"
        if not merged.clean:
            return f"conflicts with {new}: {', '.join(merged.conflicts[:5])}"
        if not changed:
            return None
        try:
            if "units" not in entry:
                entry["units"] = self.units(entry.get("changed", []))
            theirs = self.units(changed)
        except WorldError as exc:
            return f"the units could not be read: {exc}"
        mine = set(entry["units"])
        if mine and theirs and ("*" in mine or "*" in theirs):
            return "a change affects every unit"
        both = sorted(mine & set(theirs))
        if both:
            return f"main's changes affect its units: {', '.join(both[:5])}"
        return None

    def units(self, paths: list[str]) -> list[str]:
        """The units ``paths`` affect, from the adapter's ``units`` command."""
        if not paths:
            return []
        done = self.world.processes.run(
            [*(self.config.units or []), *paths],
            cwd=str(self.factory.target),
            timeout=UNITS_TIMEOUT_SECONDS,
            label="units",
        )
        if done.returncode != 0:
            raise WorldError(f"units exited {done.returncode}: {done.stderr.strip()[:200]}")
        try:
            found = json.loads(done.stdout)
        except ValueError as exc:
            raise WorldError("units printed something that is not JSON") from exc
        if not isinstance(found, list) or not all(isinstance(unit, str) for unit in found):
            raise WorldError("units must print a JSON list of unit names")
        return sorted(set(found))

    def watch_unchecked(self, entry: dict, pr: int) -> None:
        """Watch main after a merge that advanced without a new validation."""
        if entry.get("advanced"):
            self.lane.setdefault("uncheckedMerges", []).append(
                {"pr": pr, "branch": entry["branch"], "mergedAt": self.at, "since": self.at}
            )

    def poll_unchecked(self) -> None:
        """Read main's checks on each unchecked merge's commit: a failure pauses the lane."""
        github = self.world.github
        for item in list(self.lane.get("uncheckedMerges", [])):
            pr = item["pr"]
            try:
                if not item.get("commit"):
                    item["commit"] = github.merge_commit(pr)
                checks = github.commit_checks(item["commit"]) if item.get("commit") else {}
            except WorldError as exc:
                raise LaneTrouble(f"Reading main's checks after PR {pr} failed: {exc}") from exc
            selected = {
                name: state
                for name, state in checks.items()
                if check_selected(name, self.config.main_checks)
            }
            failed = sorted(name for name, state in selected.items() if state == "failure")
            if failed:
                self.main_red(item, failed)
                return
            settled = selected and "pending" not in selected.values()
            if settled and self.minutes(item["mergedAt"]) >= SETTLE_MINUTES:
                self.lane["uncheckedMerges"].remove(item)
                self.actions.append(f"main green after PR {pr}")
                continue
            limit = self.dial("lane.checkTimeoutMinutes")
            if self.minutes(item.get("since")) > limit:
                item["since"] = self.at  # A fresh wait after lane-resume.
                raise LaneTrouble(
                    f"main's checks on {item.get('commit') or 'the merge'} of PR {pr} (merged "
                    f"without a re-check) have not finished in {limit} minutes"
                )

    def main_red(self, item: dict, failed: list[str]) -> None:
        suspects = [other["pr"] for other in self.lane["uncheckedMerges"]]
        self.lane["uncheckedMerges"] = []  # Each is named here; none is watched twice.
        commit = str(item.get("commit"))[:12]
        detail = (
            f"{', '.join(failed)} failed on main at {commit} after PR {item['pr']}; merged "
            f"without a re-check: PRs {', '.join(map(str, suspects))}"
        )
        self.event(
            "main-broken",
            reason="unchecked-merge",
            detail=detail,
            lines=[detail],
            suspects=suspects,
        )
        self.lane["paused"] = True
        self.lane["pauseReason"] = f"main is broken: {detail}"
