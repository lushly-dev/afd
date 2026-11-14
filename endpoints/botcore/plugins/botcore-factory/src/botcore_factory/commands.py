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

from botcore_factory import cells, intake, status
from botcore_factory.runtime import Factory, guarded, paginate

GITHUB = ("gh",)

#: Effects per command: ``subprocess`` for anything that runs gh or git, ``service`` for
#: GitHub writes, ``history-write`` for the lane's state, ``inspect`` for local reads.
POLICIES: dict[str, CommandPolicy] = {
    "issue_check": CommandPolicy(("subprocess",), capabilities=GITHUB),
    "lane_status": CommandPolicy(("subprocess",), capabilities=GITHUB),
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
}


def make_commands(get: Callable[[], Factory]) -> list[Callable]:
    """The commands of one host; ``get`` returns that host's Factory."""

    async def run(body: Callable[[], CommandResult]) -> CommandResult:
        # gh and git block; a thread keeps an MCP host's event loop free meanwhile.
        return await asyncio.to_thread(guarded, body)

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
        return await run(lambda: success(status.lane_status(get(), limit, cursor)))

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

    return [issue_check, cell_register, lane_status, dial_get, dial_set]
