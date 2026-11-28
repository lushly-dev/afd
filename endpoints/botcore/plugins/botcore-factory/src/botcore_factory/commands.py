"""The factory's AFD commands, as a host serves them, and their policies.

Each host binds its own ``Factory`` (world, state, adapter, target), so the commands are made
per host by ``make_commands``; their names, signatures and docstrings are what the host
catalog publishes. Command names are AFD's kebab-case (``issue-check``) as snake_case Python
functions (``issue_check``), and so are their inputs.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from afd import CommandResult, success
from botcore.host import CommandPolicy

from botcore_factory import cells, events, foreman, intake, lane_process, queue, status
from botcore_factory.runtime import Factory, guarded, paginate

GITHUB = ("gh",)
GIT = ("gh", "git")

#: Effects per command: ``subprocess`` for anything that runs gh or git, ``service`` for
#: GitHub writes, ``history-write`` for the lane's state, ``inspect`` for local reads.
POLICIES: dict[str, CommandPolicy] = {
    "issue_check": CommandPolicy(("subprocess",), capabilities=GITHUB),
    # Reads GitHub; notices a dead lane (lane-stopped), which writes the lane state.
    "lane_status": CommandPolicy(("subprocess", "history-write"), capabilities=GITHUB),
    "cell_register": CommandPolicy(("subprocess", "service", "history-write"), GITHUB),
    "dial_get": CommandPolicy(("inspect",)),
    "dial_set": CommandPolicy(
        lambda args: (
            ("subprocess", "history-write")
            if args.get("key") == "lane.slots"
            else ("history-write",)
        ),
        capabilities=GITHUB,
        possible_effects=("subprocess", "history-write"),
    ),
    # Runs git and the adapter's checks in the worktree, pushes the head to origin.
    "lane_enqueue": CommandPolicy(("subprocess", "service", "history-write"), GIT),
    # Marks events delivered; their compact status reads GitHub.
    "lane_wait": CommandPolicy(("subprocess", "history-write"), GITHUB),
    "event_resolve": CommandPolicy(("history-write",)),
    "lane_pause": CommandPolicy(("history-write",)),
    "lane_resume": CommandPolicy(("history-write",)),
    "cell_attach": CommandPolicy(("history-write",)),
    "gate_allow": CommandPolicy(("history-write",)),
    "lane_drop": CommandPolicy(("subprocess", "service", "history-write"), GIT),
    # Reads T3 Code's usage caches on this machine.
    "plan_list": CommandPolicy(("inspect",)),
}


def executor() -> Callable[[Callable[[], CommandResult[Any]]], Awaitable[CommandResult[Any]]]:
    """Run a command body in a thread, turning refusals and outside failures into errors."""

    async def execute(body: Callable[[], CommandResult[Any]]) -> CommandResult[Any]:
        # gh and git block; a thread keeps an MCP host's event loop free meanwhile.
        return await asyncio.to_thread(guarded, body)

    return execute


def make_commands(get: Callable[[], Factory]) -> list[Callable[..., Any]]:
    """The commands of one host; ``get`` returns that host's Factory."""
    run = executor()

    async def issue_check(
        numbers: list[int] | None = None, limit: int | None = None, cursor: str | None = None
    ) -> CommandResult[Any]:
        """List untriaged issues, rule violations, the dispatch order and expired claims.

        Args:
            numbers: Check only these issues; every open issue when left out.
            limit: The most entries in each list (1 to 500, default 100).
            cursor: The nextCursor of the previous page.
        """

        def body() -> CommandResult[Any]:
            report = intake.check(intake.read_backlog(get(), numbers))
            data = paginate(report, limit, cursor)
            return success(
                data,
                reasoning=(
                    f"{len(report['dispatchable'])} dispatchable, {len(report['untriaged'])} "
                    f"untriaged, {len(report['violations'])} rule violations, "
                    f"{len(report['staleClaims'])} stale claims"
                ),
            )

        return await run(body)

    async def cell_register(
        issues: list[int],
        branch: str,
        route: str,
        thread: str | None = None,
        session: str | None = None,
        related_because: str | None = None,
    ) -> CommandResult[Any]:
        """Claim issues for a new cell on GitHub and assign it a plan: the highest pace among
        Claude's plans while cells.claudeOnly is on (refused NO_CLAUDE_PLAN with none), else
        among every plan. A plan whose usage cache is out of date is never assigned (refused
        PLANS_STALE when every plan a cell may take is).

        Args:
            issues: The issue numbers the cell takes; more than one is a package, which needs
                related_because and a cells.issuesMax that allows the count.
            branch: The cell's branch.
            route: The model route the cell runs on, e.g. opus/medium.
            thread: The T3 Code thread, when it is already known (cell-attach records it later).
            session: The foreman's own session (its T3 Code thread id), which holds the lane.
            related_because: Required with more than one issue: what the package shares, such
                as the files it edits, so one PR beats separate cells that would conflict.
        """

        def body() -> CommandResult[Any]:
            factory = get()
            guard = foreman.acting(factory, session, "cell-register")
            cell = cells.register(factory, issues, branch, route, thread, related_because, guard)
            return success(
                {"cell": cell},
                reasoning=f"Claimed {', '.join(f'#{n}' for n in issues)} for {branch} on "
                f"{cell['plan']} until {cell['leaseUntil']}",
            )

        return await run(body)

    async def lane_status(
        limit: int | None = None, cursor: str | None = None
    ) -> CommandResult[Any]:
        """The lane's state: host, queue, held branches, cells, open events, dials, and whether
        a cell may start now, on which plan and issue.

        Args:
            limit: The most entries in each list (1 to 500, default 100).
            cursor: The nextCursor of the previous page.
        """

        def body() -> CommandResult[Any]:
            factory = get()
            lane_process.check_lane(factory)
            return success(status.lane_status(factory, limit, cursor))

        return await run(body)

    async def dial_get(key: str | None = None) -> CommandResult[Any]:
        """Read one dial's value and default, or every dial.

        Args:
            key: The dial, e.g. lane.slots; every dial when left out.
        """
        return await run(lambda: success(status.dial_get(get(), key)))

    async def dial_set(
        key: str, value: int | float | bool | str, session: str | None = None
    ) -> CommandResult[Any]:
        """Set a dial; the previous value is returned so the change can be undone.

        Args:
            key: The dial, e.g. lane.slots.
            value: The new value, within the dial's range; host.buildDir takes a directory.
            session: The foreman's own session; the owner, setting a dial by hand, names none.
        """
        return await run(lambda: success(status.dial_set(get(), key, value, session)))

    async def lane_enqueue(
        worktree: str, title: str | None = None, body_file: str | None = None
    ) -> CommandResult[Any]:
        """Hand a reviewed, committed branch to the lane: cheap checks, then queued or held.

        Args:
            worktree: The cell's worktree; its branch must have a registered cell.
            title: The PR title; the previous attempt's when left out.
            body_file: The PR body file in the worktree; the previous attempt's when left out.
        """

        def body() -> CommandResult[Any]:
            data = queue.enqueue(get(), worktree, title, body_file)
            return success(
                data,
                reasoning=f"{data['branch']} {data['state']} at position {data['position']} "
                f"(attempt {data['attempt']})",
            )

        return await run(body)

    async def lane_wait(
        consumer: str, timeout_ms: int | None = None, session: str | None = None
    ) -> CommandResult[Any]:
        """Wait for open events this consumer has not been given. Reading never resolves them.

        Args:
            consumer: Who reads, e.g. foreman; each consumer is given an open event at most once.
            timeout_ms: How long to wait; no limit when left out (over MCP pass at most 300000).
            session: The foreman's own session (its T3 Code thread id); it holds the lane, and
                waiting keeps it.
        """

        def body() -> CommandResult[Any]:
            factory = get()
            lane_process.check_lane(factory)
            keep = foreman.waiting(factory, consumer, session, timeout_ms)
            return success(
                events.lane_wait(
                    factory,
                    consumer,
                    timeout_ms,
                    lambda: status.compact_status(factory),
                    keep,
                    foreman.wait_guard(factory, consumer, session),
                )
            )

        return await run(body)

    async def event_resolve(id: str, note: str) -> CommandResult[Any]:
        """Record a decision that answers an open event.

        Args:
            id: The event's id, e.g. ev-12, as lane-status lists it.
            note: What was decided.
        """
        return await run(lambda: success(events.event_resolve(get(), id, note)))

    async def lane_pause(reason: str | None = None) -> CommandResult[Any]:
        """Pause the lane: it starts no new validation until lane-resume.

        Args:
            reason: Why, shown in lane-status as pauseReason.
        """
        return await run(lambda: success(events.lane_pause(get(), reason)))

    async def lane_resume(reason: str | None = None) -> CommandResult[Any]:
        """Resume the lane; this answers its open lane-error events.

        Args:
            reason: What was fixed, recorded in the lane's log.
        """
        return await run(lambda: success(events.lane_resume(get(), reason)))

    async def cell_attach(branch: str, thread: str) -> CommandResult[Any]:
        """Record the T3 Code thread delegate_task returned for a registered cell.

        Args:
            branch: The cell's branch.
            thread: The thread delegate_task returned.
        """
        return await run(lambda: success({"cell": cells.attach(get(), branch, thread)}))

    async def lane_drop(branch: str, reason: str, session: str | None = None) -> CommandResult[Any]:
        """Dequeue a branch, release its issues and forget its cell. A released issue goes back
        to status:planned unless another branch's live claim still holds it.

        Args:
            branch: The cell's branch; its worktree is left alone.
            reason: Why, posted on each released issue.
            session: The foreman's own session (its T3 Code thread id); the owner names none.
        """

        return await run(
            lambda: success(
                cells.drop(get(), branch, reason, foreman.acting(get(), session, "lane-drop", True))
            )
        )

    async def gate_allow(
        branch: str, reason: str, head: str, session: str | None = None
    ) -> CommandResult[Any]:
        """Record that a diagnosis found a repair's gate edit to be the right repair, for one head.

        Args:
            branch: The ejected cell's branch.
            reason: What the diagnosis found.
            session: The foreman's own session (its T3 Code thread id), which must hold the
                lane's lease now.
            head: The commit diagnosed, as the cell's GATE_EDIT_IN_REPAIR names it. A later
                commit needs a new gate-allow.
        """

        return await run(
            lambda: success(
                cells.gate_allow(
                    get(), branch, reason, foreman.leased(get(), session, "gate-allow"), head
                )
            )
        )

    async def plan_list() -> CommandResult[Any]:
        """Each plan's weekly window: share used and elapsed, room, pace (room below
        plans.ceiling per day to its reset) and whether it is above plans.ceiling. next is the
        plan cell-register would assign: the highest pace among Claude's plans while
        cells.claudeOnly is on, null when none can take a cell. A plan whose usage cache is out
        of date carries stale, saying why, and is never next."""
        return await run(lambda: success(status.plan_list(get())))

    return [
        issue_check,
        cell_register,
        lane_status,
        dial_get,
        dial_set,
        lane_enqueue,
        lane_wait,
        event_resolve,
        lane_pause,
        lane_resume,
        cell_attach,
        lane_drop,
        gate_allow,
        plan_list,
    ]
