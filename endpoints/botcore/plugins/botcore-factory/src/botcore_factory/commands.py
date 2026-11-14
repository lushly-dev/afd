"""The factory's AFD commands, as a host serves them, and their policies.

Each host binds its own ``Factory`` (world, state, adapter, target), so the commands are made
per host by ``make_commands``; their names, signatures and docstrings are what the host
catalog publishes. Command names are AFD's kebab-case (``issue-check``) as snake_case Python
functions (``issue_check``), and so are their inputs.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable

from afd import CommandResult, success
from botcore.host import CommandPolicy

from botcore_factory import cells, events, intake, lane_process, queue, status
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
    "lane_drop": CommandPolicy(("subprocess", "service", "history-write"), GITHUB),
    # Reads T3 Code's usage caches on this machine.
    "plan_list": CommandPolicy(("inspect",)),
}


def executor() -> Callable:
    """Run a command body in a thread, turning refusals and outside failures into errors."""

    async def execute(body: Callable[[], CommandResult]) -> CommandResult:
        # gh and git block; a thread keeps an MCP host's event loop free meanwhile.
        return await asyncio.to_thread(guarded, body)

    return execute


def make_commands(get: Callable[[], Factory]) -> list[Callable]:
    """The commands of one host; ``get`` returns that host's Factory."""
    run = executor()

    async def issue_check(
        numbers: list[int] | None = None, limit: int | None = None, cursor: str | None = None
    ) -> CommandResult:
        """List untriaged issues, rule violations, the dispatch order and expired claims.

        Args:
            numbers: Check only these issues; every open issue when left out.
            limit: The most entries in each list (1 to 500, default 100).
            cursor: The nextCursor of the previous page.
        """

        def body() -> CommandResult:
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
        issues: list[int], branch: str, route: str, thread: str | None = None
    ) -> CommandResult:
        """Claim issues for a new cell on GitHub and assign the cell the plan with most room.

        Args:
            issues: The issue numbers the cell takes; one unless cells.issuesMax allows more.
            branch: The cell's branch.
            route: The model route the cell runs on, e.g. sol/high.
            thread: The T3 Code thread, when it is already known (cell-attach records it later).
        """

        def body() -> CommandResult:
            cell = cells.register(get(), issues, branch, route, thread)
            return success(
                {"cell": cell},
                reasoning=f"Claimed {', '.join(f'#{n}' for n in issues)} for {branch} on "
                f"{cell['plan']} until {cell['leaseUntil']}",
            )

        return await run(body)

    async def lane_status(limit: int | None = None, cursor: str | None = None) -> CommandResult:
        """The lane's state: host, queue, held branches, cells, open events, dials, and whether
        a cell may start now, on which plan and issue.

        Args:
            limit: The most entries in each list (1 to 500, default 100).
            cursor: The nextCursor of the previous page.
        """

        def body() -> CommandResult:
            factory = get()
            lane_process.check_lane(factory)
            return success(status.lane_status(factory, limit, cursor))

        return await run(body)

    async def dial_get(key: str | None = None) -> CommandResult:
        """Read one dial's value and default, or every dial.

        Args:
            key: The dial, e.g. lane.slots; every dial when left out.
        """
        return await run(lambda: success(status.dial_get(get(), key)))

    async def dial_set(key: str, value: int | float | bool) -> CommandResult:
        """Set a dial; the previous value is returned so the change can be undone.

        Args:
            key: The dial, e.g. lane.slots.
            value: The new value, within the dial's range.
        """
        return await run(lambda: success(status.dial_set(get(), key, value)))

    async def lane_enqueue(
        worktree: str, title: str | None = None, body_file: str | None = None
    ) -> CommandResult:
        """Hand a reviewed, committed branch to the lane: cheap checks, then queued or held.

        Args:
            worktree: The cell's worktree; its branch must have a registered cell.
            title: The PR title; the previous attempt's when left out.
            body_file: The PR body file in the worktree; the previous attempt's when left out.
        """

        def body() -> CommandResult:
            data = queue.enqueue(get(), worktree, title, body_file)
            return success(
                data,
                reasoning=f"{data['branch']} {data['state']} at position {data['position']} "
                f"(attempt {data['attempt']})",
            )

        return await run(body)

    async def lane_wait(consumer: str, timeout_ms: int | None = None) -> CommandResult:
        """Wait for events this consumer has not been given; reading never resolves them.

        Args:
            consumer: Who reads, e.g. foreman; each consumer is given each event once.
            timeout_ms: How long to wait; no limit when left out (over MCP pass at most 300000).
        """

        def body() -> CommandResult:
            factory = get()
            lane_process.check_lane(factory)
            return success(
                events.lane_wait(
                    factory, consumer, timeout_ms, lambda: status.compact_status(factory)
                )
            )

        return await run(body)

    async def event_resolve(id: str, note: str) -> CommandResult:
        """Record a decision that answers an open event.

        Args:
            id: The event's id, e.g. ev-12, as lane-status lists it.
            note: What was decided.
        """
        return await run(lambda: success(events.event_resolve(get(), id, note)))

    async def lane_pause(reason: str | None = None) -> CommandResult:
        """Pause the lane: it starts no new validation until lane-resume.

        Args:
            reason: Why, shown in lane-status as pauseReason.
        """
        return await run(lambda: success(events.lane_pause(get(), reason)))

    async def lane_resume(reason: str | None = None) -> CommandResult:
        """Resume the lane; this answers its open lane-error events.

        Args:
            reason: What was fixed, recorded in the lane's log.
        """
        return await run(lambda: success(events.lane_resume(get(), reason)))

    async def cell_attach(branch: str, thread: str) -> CommandResult:
        """Record the T3 Code thread delegate_task returned for a registered cell.

        Args:
            branch: The cell's branch.
            thread: The thread delegate_task returned.
        """
        return await run(lambda: success({"cell": cells.attach(get(), branch, thread)}))

    async def lane_drop(branch: str, reason: str) -> CommandResult:
        """Dequeue a branch, release its issues back to status:planned and forget its cell.

        Args:
            branch: The cell's branch; its worktree is left alone.
            reason: Why, posted on each released issue.
        """
        return await run(lambda: success(cells.drop(get(), branch, reason)))

    async def gate_allow(branch: str, reason: str) -> CommandResult:
        """Record that a diagnosis found a repair's gate edit to be the right repair.

        Args:
            branch: The ejected cell's branch.
            reason: What the diagnosis found.
        """
        return await run(lambda: success(cells.gate_allow(get(), branch, reason)))

    async def plan_list() -> CommandResult:
        """Each plan's weekly window: share used and elapsed, room, and whether it is above
        plans.ceiling."""
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
