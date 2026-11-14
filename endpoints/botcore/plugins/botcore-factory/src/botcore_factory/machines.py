"""Choosing the lane host: each machine probes itself and publishes a readiness record to
``refs/factory/hosts/<id>`` on origin; ``lane-host-list`` reads the records, a record's age
deciding ``reachable``; ``lane-host-set`` writes the host to the repository variable
``FACTORY_LANE_HOST``, so every machine reads the same answer.

A move is refused while anything is queued or held, a cell is active or the lane runs
(``LANE_BUSY``), here or (for a machine that is not the host) as origin's queue refs show it. A
planned move drains: no new cells, and the move happens at ``queue-empty``. A host that went
offline is replaced with ``recover``, which rebuilds the queue from ``refs/factory/queue/*`` and
the cells from the claims on GitHub; a person confirms it (botcore's host does not carry
confirmations yet).
"""

from __future__ import annotations

from datetime import timedelta

from botcore_factory import records
from botcore_factory.cells import seated
from botcore_factory.claims import format_time, parse_time
from botcore_factory.intake import read_backlog
from botcore_factory.lane_process import host_lock, toolchain_mismatches
from botcore_factory.runtime import Factory, Refusal
from botcore_factory.world import LANE_HOST_VARIABLE, HostRecord

#: A record older than this is from a machine that has stopped probing: not reachable.
STALE_AFTER = timedelta(hours=24)


def readiness(factory: Factory) -> list[str]:
    """What this machine lacks to host the lane."""
    world, config = factory.world, factory.config
    missing = []
    if not world.github.signed_in():
        missing.append("gh sign-in")
    if not world.git.origin_reachable():
        missing.append("origin fetch")
    commands = [
        config.validate_command,
        config.install,
        config.coverage,
        *[stage.run for stage in config.prequeue],
    ]
    for program in sorted({command[0] for command in commands if command}):
        if not world.machine.has_program(program):
            missing.append(program)
    if not world.machine.symlinks():
        missing.append("symlinks")
    missing += toolchain_mismatches(factory)
    return missing


def probe(factory: Factory) -> dict:
    world = factory.world
    me = world.machine.id()
    previous = next((r for r in world.git.host_records() if r.id == me), None)
    record = HostRecord(
        id=me,
        name=previous.name if previous and previous.name else me,
        cores=world.machine.cores(),
        memory_gb=round(world.machine.memory_gb(), 1),
        free_disk_gb=round(world.machine.free_disk_gb(str(factory.target)), 1),
        missing=tuple(readiness(factory)),
        # Measurement carries over: a probe reads capacity, the lane measures validations.
        measured=previous.measured if previous else False,
        suggested_slots=previous.suggested_slots if previous else 1,
        probed_at=format_time(world.clock.now()),
    )
    world.git.publish_host_record(record)
    return {"record": record.describe()}


def view(factory: Factory, record: HostRecord) -> dict:
    now = factory.world.clock.now()
    reachable = record.probed_at is None or now - parse_time(record.probed_at) <= STALE_AFTER
    shown = record.describe()
    shown.update(reachable=reachable, ready=reachable and not record.missing)
    return shown


def host_list(factory: Factory) -> dict:
    return {"machines": [view(factory, r) for r in factory.world.git.host_records()]}


def _busy(factory: Factory, state: dict) -> list[str]:
    reasons = []
    if state["queue"] or state["held"]:
        reasons.append(f"{len(state['queue'])} queued and {len(state['held'])} held here")
    if seated(state):
        reasons.append(f"{len(seated(state))} cells active")
    if host_lock(factory).live_holder() is not None:
        reasons.append("the lane is running")
    refs = factory.world.git.queue_refs()
    if refs and not state["queue"]:
        reasons.append(f"{len(refs)} branches queued on origin")
    return reasons


def host_set(factory: Factory, host_id: str, drain: bool, recover: bool) -> dict:
    if drain and recover:
        raise Refusal(
            "VALIDATION_ERROR",
            "drain and recover are two ways to move; pass one",
            "drain for a planned move, recover for a host that went offline",
        )
    world = factory.world
    records_by_id = {record.id: record for record in world.git.host_records()}
    if host_id not in records_by_id:
        raise Refusal(
            "NOT_FOUND",
            f"No readiness record for {host_id}",
            "lane-host-list shows the machines that have published one; run lane-host-probe "
            "on a new machine first",
        )
    shown = view(factory, records_by_id[host_id])
    if not shown["ready"]:
        lacks = ", ".join(shown["missing"]) or "a recent readiness record (unreachable)"
        raise Refusal(
            "HOST_NOT_READY",
            f"{host_id} is not ready: it lacks {lacks}",
            f"Fix what it lacks, run lane-host-probe on {host_id}, then retry",
        )
    current = world.github.get_variable(LANE_HOST_VARIABLE)
    if current == host_id:
        return {"host": {"id": host_id}, "previous": current}
    with factory.store.update(f"lane-host-set {host_id}") as state:
        if recover:
            rebuilt = _recover(factory, state)
            world.github.set_variable(LANE_HOST_VARIABLE, host_id)
            return {"host": {"id": host_id}, "previous": current, "rebuilt": rebuilt}
        busy = _busy(factory, state) if current else []
        if busy and drain:
            state["lane"].update(draining=True, drainTo=host_id)
            return {"host": {"id": current}, "draining": True, "moveTo": host_id}
        if busy:
            gone = (
                current in records_by_id and not view(factory, records_by_id[current])["reachable"]
            )
            raise Refusal(
                "LANE_BUSY",
                f"The lane on {current} is busy: {'; '.join(busy)}",
                f"{current} is unreachable: recover the queue and claims here with "
                f"lane-host-set {host_id} recover (a person confirms)"
                if gone
                else f"Drain it first: lane-host-set {host_id} with drain moves at queue-empty",
            )
        world.github.set_variable(LANE_HOST_VARIABLE, host_id)
    return {"host": {"id": host_id}, "previous": current}


def _recover(factory: Factory, state: dict) -> dict:
    """Rebuild the queue from origin's queue refs and the cells from GitHub's claims."""
    refs = factory.world.git.queue_refs()
    backlog = read_backlog(factory)
    history = factory.store.read_records()
    by_branch: dict[str, dict] = {}
    for number, claim in sorted(backlog.claims.items()):
        if claim is None:
            continue
        cell = by_branch.setdefault(
            claim.branch,
            {
                "branch": claim.branch,
                "issues": [],
                "state": "working",
                "ejections": 0,
                "machine": claim.machine,
                "leaseUntil": claim.lease_until,
                "recovered": True,
            },
        )
        cell["issues"].append(number)
    queued = []
    for ref in refs:
        branch = ref["branch"]
        queued.append(
            {
                "branch": branch,
                "head": ref["head"],
                "state": "queued",
                "attempt": records.next_attempt(history, branch),
                "issues": by_branch.get(branch, {}).get("issues", []),
            }
        )
        if branch in by_branch:
            by_branch[branch]["state"] = "queued"
    known = {cell["branch"] for cell in state["cells"]}
    state["cells"] += [cell for branch, cell in by_branch.items() if branch not in known]
    state["queue"] = queued
    state["held"] = []
    state["lane"].update(running=False, draining=False, drainTo=None)
    claims = sum(1 for claim in backlog.claims.values() if claim is not None)
    return {"queue": len(queued), "claims": claims}
