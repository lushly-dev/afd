"""Cells: registering one claims its issues on GitHub and assigns it a plan.

Registration is reserve, then start: the foreman calls ``cell-register`` before
``delegate_task``, so a refusal costs nothing. Every limit is checked before anything is
written, under the state lock, so two registrations cannot both take the last seat or issue.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from botcore_factory import dials
from botcore_factory.claims import Claim, claim_body, format_time
from botcore_factory.intake import not_dispatchable_reasons, read_backlog
from botcore_factory.labels import IN_PROGRESS, PLANNED
from botcore_factory.runtime import Factory, Refusal
from botcore_factory.world import Plan, WorldError

#: Cell states that hold a seat; a parked cell (waiting on the owner) frees its seat.
SEATED_STATES = frozenset({"registered", "working", "queued", "held", "validating", "ejected"})


@dataclass(frozen=True)
class PlanChoice:
    plan: Plan | None
    next_reset: str | None
    ceiling: float


def choose_plan(plans: list[Plan], ceiling: float) -> PlanChoice:
    """The plan with most room (share of the window elapsed minus share used) below the ceiling.

    A plan at or above ``plans.ceiling`` is skipped. With none left, ``next_reset`` says when
    the first window resets.
    """
    open_plans = [plan for plan in plans if plan.used < ceiling]
    if open_plans:
        best = max(open_plans, key=lambda plan: (plan.room, -plan.used, plan.id))
        return PlanChoice(best, None, ceiling)
    resets = sorted(plan.resets_at for plan in plans if plan.resets_at)
    return PlanChoice(None, resets[0] if resets else None, ceiling)


def describe_plan(plan: Plan, ceiling: float) -> dict:
    return {
        "id": plan.id,
        "provider": plan.provider,
        "used": plan.used,
        "elapsed": plan.elapsed,
        "room": plan.room,
        "aboveCeiling": plan.used >= ceiling,
        "resetsAt": plan.resets_at,
    }


def read_plans(factory: Factory) -> list[Plan]:
    try:
        return factory.world.plans.read()
    except WorldError as exc:
        raise Refusal(
            "PLANS_UNREADABLE",
            f"Cannot read the plans' weekly windows: {exc}",
            "Open T3 Code so it refreshes its usage caches, then retry",
        ) from exc


def seated(state: dict) -> list[dict]:
    return [cell for cell in state["cells"] if cell.get("state", "working") in SEATED_STATES]


def _validate(issues: list[int], branch: str, route: str) -> None:
    problems = []
    if not issues:
        problems.append("issues is empty")
    if any(not isinstance(n, int) or isinstance(n, bool) or n < 1 for n in issues):
        problems.append("issues must be issue numbers")
    if len(set(issues)) != len(issues):
        problems.append("issues lists an issue twice")
    if not branch.strip() or any(c.isspace() for c in branch) or branch.startswith("-"):
        problems.append("branch must be a branch name")
    if not route.strip():
        problems.append("route must name a model route, e.g. sol/high")
    if problems:
        raise Refusal(
            "VALIDATION_ERROR",
            "; ".join(problems),
            "Pass issues (one issue number by default), the cell's branch and its route",
        )


def _check_issue_count(issues: list[int], overrides: dict) -> None:
    most = dials.value(overrides, "cells.issuesMax")
    if len(issues) > most:
        raise Refusal(
            "TOO_MANY_ISSUES",
            f"{len(issues)} issues for one cell; cells.issuesMax is {most}",
            "Register one cell per issue; raise cells.issuesMax with dial-set only for issues "
            "issue-check lists as related",
        )
    if len(issues) > 1:
        raise Refusal(
            "TOO_MANY_ISSUES",
            f"Issues {', '.join(f'#{n}' for n in issues)} are not related",
            "Only issues issue-check lists together in related may share a cell (cells.issuesMax "
            "allows the count); register one cell per issue",
        )


def _check_issues(factory: Factory, issues: list[int]):
    backlog = read_backlog(factory, issues)
    by_number = {issue.number: issue for issue in backlog.issues}
    for number in issues:
        issue = by_number[number]
        if number in backlog.claims:
            claim = backlog.claims[number]
            holder = (
                f"{claim.branch} ({claim.machine}, lease until {claim.lease_until}"
                f"{', expired' if claim.expired(backlog.now) else ''})"
                if claim
                else "an unknown holder (status:in-progress without a claim comment)"
            )
            raise Refusal(
                "ALREADY_CLAIMED",
                f"Issue #{number} is claimed by {holder}",
                "Take another issue from issue-check's dispatchable list; an expired or "
                "unrecorded claim shows in issue-check's staleClaims for the foreman to release",
                holder=claim.describe() if claim else None,
            )
        reasons = not_dispatchable_reasons(backlog, issue)
        if reasons:
            raise Refusal(
                "NOT_DISPATCHABLE",
                f"Issue #{number} cannot be taken: {'; '.join(reasons)}",
                "Run triage-issues to plan it (one execution profile, no open owner question), "
                "or take an issue from issue-check's dispatchable list",
                reasons=reasons,
            )
    return backlog


def _check_capacity(factory: Factory, state: dict) -> PlanChoice:
    overrides = state["dials"]
    most = dials.value(overrides, "cells.max")
    if len(seated(state)) >= most:
        raise Refusal(
            "CELLS_FULL",
            f"{len(seated(state))} cells hold seats; cells.max is {most}",
            "Start the cell when a seat frees: lane-wait reports merged and queue-room events, "
            "and lane-status says canStartCell",
        )
    choice = choose_plan(read_plans(factory), dials.value(overrides, "plans.ceiling"))
    if choice.plan is None:
        raise Refusal(
            "PLAN_ABOVE_CEILING",
            f"Every plan is at or above plans.ceiling ({_percent(choice.ceiling)})",
            f"Start nothing until the next window resets at "
            f"{choice.next_reset or 'an unknown time'}; lane-status says when canStartCell returns",
            nextReset=choice.next_reset,
        )
    floor = dials.value(overrides, "host.minFreeGb")
    free = factory.world.machine.free_memory_gb()
    if free < floor:
        raise Refusal(
            "HOST_LOADED",
            f"{free:g} GB of memory is free on {factory.world.machine.id()}; host.minFreeGb is "
            f"{floor:g}",
            "Wait for running work to finish (lane-wait), or lower host.minFreeGb with dial-set "
            "if the host can spare it",
        )
    return choice


def register(factory: Factory, issues: list[int], branch: str, route: str, thread: str | None):
    """Claim ``issues`` for a new cell on ``branch`` and record it; the cell is returned."""
    _validate(issues, branch, route)
    with factory.store.update(f"cell-register {branch}") as state:
        _check_issue_count(issues, state["dials"])
        if any(cell["branch"] == branch for cell in state["cells"]):
            raise Refusal(
                "ALREADY_EXISTS",
                f"A cell is already registered for {branch}",
                f"Register under another branch name, or lane-drop {branch} first",
            )
        _check_issues(factory, issues)
        choice = _check_capacity(factory, state)
        world = factory.world
        now = world.clock.now()
        hours = dials.value(state["dials"], "claims.leaseHours")
        claim = Claim(branch, world.machine.id(), format_time(now + timedelta(hours=hours)))
        _claim(factory, issues, claim)
        cell = {
            "branch": branch,
            "issues": list(issues),
            "route": route,
            "thread": thread,
            "plan": choice.plan.id,
            "state": "registered",
            "ejections": 0,
            "registeredAt": format_time(now),
            "leaseUntil": claim.lease_until,
            "machine": claim.machine,
        }
        state["cells"].append(cell)
        for event in state["events"]:
            if event.get("type") == "queue-room" and event.get("open", True):
                event["open"] = False
                event["resolvedBy"] = f"cell-register {branch}"
        factory.store.log(
            {
                "kind": "cell-registered",
                "branch": branch,
                "issues": list(issues),
                "plan": choice.plan.id,
                "route": route,
            }
        )
    return cell


def _claim(factory: Factory, issues: list[int], claim: Claim) -> None:
    """Label each issue and post its claim comment; a failed write names what was done."""
    done: list[str] = []
    for number in issues:
        try:
            # A dispatchable issue carries status:planned and no other status label.
            factory.world.github.edit_labels(number, add=[IN_PROGRESS], remove=[PLANNED])
            done.append(f"#{number} labelled {IN_PROGRESS}")
            factory.world.github.add_comment(number, claim_body(claim))
            done.append(f"#{number} claim comment")
        except WorldError as exc:
            raise Refusal(
                "WRITE_FAILED",
                f"Claiming #{number} for {claim.branch} failed: {exc}. Written before it: "
                f"{', '.join(done) or 'nothing'}",
                "No cell was recorded. issue-check lists a claimed issue without a live claim "
                "in staleClaims; release it, then register again",
                written=done,
            ) from exc


def _percent(value: float) -> str:
    return f"{value:g}%"
