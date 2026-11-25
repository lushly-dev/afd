"""The lane's process, host and report commands, and their policies.

Made per host like ``commands``; ``build_factory_host`` serves both sets.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from afd import CommandResult, success
from botcore.host import CommandPolicy

from botcore_factory import cells, foreman, lane_process, machines, report
from botcore_factory.commands import GIT, executor
from botcore_factory.runtime import Factory

LANE_POLICIES: dict[str, CommandPolicy] = {
    # The lane process: started detached, it runs git, gh and the adapter's commands.
    "lane_start": CommandPolicy(("subprocess", "service", "history-write"), GIT),
    "lane_stop": CommandPolicy(("subprocess", "service", "history-write"), GIT),
    "lane_run": CommandPolicy(("subprocess", "service", "history-write"), GIT),
    # Publishes this machine's record to origin.
    "lane_host_probe": CommandPolicy(("subprocess", "service"), GIT),
    "lane_host_list": CommandPolicy(("subprocess",), GIT),
    # Writes the FACTORY_LANE_HOST variable; recover rebuilds the lane state.
    "lane_host_set": CommandPolicy(("subprocess", "service", "history-write"), GIT),
    "lane_report": CommandPolicy(("inspect",)),
    # Frees the lane's foreman lease (lushly-dev/afd#1432).
    "foreman_handoff": CommandPolicy(("history-write",)),
    # Stops counting an ejection that was not the branch's fault.
    "ejection_excuse": CommandPolicy(("history-write",)),
    # Owner approval releasing a gate-change or measure-change held head to the queue.
    "measure_approve": CommandPolicy(("history-write",)),
}


def make_lane_commands(get: Callable[[], Factory]) -> list[Callable[..., Any]]:
    execute = executor()

    async def lane_start() -> CommandResult[Any]:
        """Start the lane on this machine, detached: it validates, merges and raises events."""
        return await execute(lambda: success(lane_process.lane_start(get())))

    async def lane_stop(force: bool = False) -> CommandResult[Any]:
        """Stop the lane; a running validation finishes first unless force.

        Args:
            force: Stop at once; validations in progress go back to the front of the queue.
        """
        return await execute(lambda: success(lane_process.lane_stop(get(), force)))

    async def lane_run(steps: int | None = None) -> CommandResult[Any]:
        """Run the lane's loop in the foreground, for debugging the lane itself.

        Args:
            steps: Stop after this many steps; until asked to stop when left out.
        """
        return await execute(lambda: success(lane_process.run_loop(get(), steps=steps)))

    async def lane_host_probe() -> CommandResult[Any]:
        """Publish this machine's readiness to refs/factory/hosts on origin."""
        return await execute(lambda: success(machines.probe(get())))

    async def lane_host_list() -> CommandResult[Any]:
        """The machines that published readiness: capacity, what each lacks, slot suggestion."""
        return await execute(lambda: success(machines.host_list(get())))

    async def lane_host_set(
        id: str, drain: bool = False, recover: bool = False
    ) -> CommandResult[Any]:
        """Choose the lane host for every machine (the FACTORY_LANE_HOST variable).

        Args:
            id: The machine, as lane-host-list names it.
            drain: Move at queue-empty; no new cells meanwhile.
            recover: Replace a host that went offline: rebuild the queue and claims here.
        """
        return await execute(lambda: success(machines.host_set(get(), id, drain, recover)))

    async def lane_report(run: str | None = None, compare: str | None = None) -> CommandResult[Any]:
        """A run's numbers from the lane's records, and their change from another run.

        Args:
            run: The run, e.g. run-2; the current or latest when left out.
            compare: Another run to give each number's change from.
        """
        return await execute(lambda: success(report.lane_report(get(), run, compare)))

    async def foreman_handoff(session: str) -> CommandResult[Any]:
        """Free the lane for another foreman session: the holder's own, or once its lease ran out.

        Args:
            session: The session that holds the lane, as FOREMAN_BUSY names it.
        """
        return await execute(lambda: success(foreman.handoff(get(), session)))

    async def ejection_excuse(
        branch: str, reason: str, session: str | None = None
    ) -> CommandResult[Any]:
        """Record that a cell's latest ejection was not its branch's fault (a known flake), so it
        no longer counts toward cells.maxEjections.

        Args:
            branch: The ejected cell's branch.
            reason: Why it was not the branch's fault, e.g. the flake's issue.
            session: The foreman's session (its T3 Code thread id), which must hold the
                lane's lease now.
        """

        def body() -> CommandResult[Any]:
            factory = get()
            guard = foreman.leased(factory, session, "ejection-excuse")
            return success(cells.ejection_excuse(factory, branch, reason, guard))

        return await execute(body)

    async def measure_approve(branch: str, reason: str) -> CommandResult[Any]:
        """Release a branch held for gate-change or measure-change to the queue.

        Args:
            branch: The held cell's branch.
            reason: Why the owner approves this exact head's gate or measurement change.
        """
        return await execute(lambda: success(cells.measure_approve(get(), branch, reason)))

    return [
        lane_start,
        lane_stop,
        lane_run,
        lane_host_probe,
        lane_host_list,
        lane_host_set,
        lane_report,
        foreman_handoff,
        ejection_excuse,
        measure_approve,
    ]
