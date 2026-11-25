"""One foreman per lane (lushly-dev/afd#1432).

Two foreman sessions on one lane race for seats, may each answer an event and change a dial under
each other. A foreman names its session (its T3 Code thread id) on ``cell-register``,
``lane-wait`` as ``foreman`` and ``dial-set``; the first such call takes the lane's lease
(``lane.foreman``: ``session``, ``since``, ``until``), and each later one from that session
renews it for ``foreman.leaseMinutes``; a ``lane-wait`` with a timeout keeps it while it
waits. While the lease is live, another session's foreman commands are refused with
``FOREMAN_BUSY``, naming the holder and when the lease runs out, and telling it to stop and tell
the owner. A session that has ended frees the lane once its last wait has timed out and its lease
has run out, or at once when the owner calls ``foreman-handoff``. A call that names no session
takes no lease: the owner's ``dial-set`` works as before, and any other foreman command without
one is refused while a session holds it.

A session another one took the lane from is superseded (``lane.supersededForemen``): a scheduled
foreman that woke after a usage-limit reset took an expired lease and acted on an outdated
brief after a newer foreman had done the work (lushly-dev/afd#1595). A superseded session's
foreman commands are refused ``FOREMAN_STALE``, whether or not anyone holds the lease now; a
foreman that should come back starts in a new session, which reads ``lane-status`` first.

The lease is checked twice (lushly-dev/afd#1633): ``hold`` before a command acts, so a refusal
comes before anything else is read, and ``check`` again inside the store transaction that acts
(``guard`` makes one for a mutation), so a session that lost the lane between the two acts on
nothing. A pending ``lane-wait`` checks there too before it marks events delivered, so a wait
left open by a superseded session cannot take its successor's events.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any

from botcore_factory import dials
from botcore_factory.claims import format_time, parse_time
from botcore_factory.runtime import STOP, Factory, Refusal, call, fix_input

LEASE_DIAL = "foreman.leaseMinutes"
#: Superseded sessions kept; the longest superseded are forgotten first.
SUPERSEDED_KEPT = 500


def _live(lease: dict[str, Any] | None, now: datetime) -> bool:
    return lease is not None and parse_time(lease["until"]) > now


def _busy(lease: dict[str, Any], command: str) -> Refusal:
    return Refusal(
        "FOREMAN_BUSY",
        f"Session {lease['session']} is this lane's foreman until {lease['until']}; "
        f"{command} is its call",
        "One foreman per lane: stop here and tell the owner. If that session has ended, its "
        "lease runs out by itself, or the owner frees the lane with foreman-handoff",
        recovery=STOP,
        holder=lease["session"],
        until=lease["until"],
    )


def _stale(lane: dict[str, Any], session: str, command: str) -> Refusal | None:
    superseded = (lane.get("supersededForemen") or {}).get(session)
    if superseded is None:
        return None
    return Refusal(
        "FOREMAN_STALE",
        f"Session {session} stopped being this lane's foreman when {superseded['by']} took the "
        f"lane at {superseded['at']}; its brief may be out of date, so {command} is refused",
        "Stop here and report to the owner without acting: read lane-status and lane-report "
        "for what the newer foreman did. A foreman that should run again starts in a new "
        "session",
        recovery=STOP,
        supersededBy=superseded["by"],
        at=superseded["at"],
    )


def _supersede(lane: dict[str, Any], previous: str | None, session: str, at: str) -> None:
    """Record that ``session`` took the lane from ``previous``."""
    superseded = lane.setdefault("supersededForemen", {})
    if previous and previous != session:
        superseded[previous] = {"by": session, "at": at}
        # By time, not by key order: the state file is written with its keys sorted.
        while len(superseded) > SUPERSEDED_KEPT:
            superseded.pop(min(superseded, key=lambda key: superseded[key]["at"]))


def hold(
    factory: Factory, session: str | None, command: str, owner_may: bool = False
) -> dict[str, Any] | None:
    """Take or renew the lease for ``session`` before ``command`` acts; the lease, or None when
    no session is named. Refuses ``FOREMAN_STALE`` for a session another took the lane from,
    ``FOREMAN_BUSY`` for another session, and for a call that names none unless ``owner_may``
    (the owner's own ``dial-set``)."""
    if session is not None and not session.strip():
        raise Refusal(
            "VALIDATION_ERROR",
            "session is empty",
            "Pass your T3 Code thread id",
            recovery=fix_input("session"),
        )
    now = factory.world.clock.now()
    lane = factory.store.read()["lane"]
    current = lane.get("foreman")
    if session is None and owner_may:
        return None
    if session is not None and (stale := _stale(lane, session, command)):
        raise stale
    if _live(current, now) and current["session"] != session:
        raise _busy(current, command)
    if session is None:
        return None
    with factory.store.update(f"{command} (foreman {session})") as state:
        return take(state, session, command, now)


def take(state: dict[str, Any], session: str, command: str, now: datetime) -> dict[str, Any]:
    """Inside a store transaction: refuse a superseded session or another's live lease, else
    take or renew the lease for ``session``; the lease."""
    lease = state["lane"].get("foreman")
    if stale := _stale(state["lane"], session, command):
        raise stale
    if _live(lease, now) and lease["session"] != session:
        raise _busy(lease, command)
    minutes = dials.value(state["dials"], LEASE_DIAL)
    kept = _live(lease, now) and lease["session"] == session
    previous = (lease or {}).get("session") or state["lane"].get("lastForeman")
    if not kept:
        _supersede(state["lane"], previous, session, format_time(now))
        state["lane"].pop("lastForeman", None)
    state["lane"]["foreman"] = {
        "session": session,
        "since": lease["since"] if kept else format_time(now),
        "until": format_time(now + timedelta(minutes=minutes)),
    }
    return dict(state["lane"]["foreman"])


def check(
    state: dict[str, Any],
    session: str | None,
    command: str,
    now: datetime,
    owner_may: bool = False,
) -> None:
    """``hold``'s refusals again, inside the transaction that acts: a named session must not be
    superseded and must still hold a live lease, which is renewed; it never takes the lane
    here, so one whose lease was handed over or ran out since ``hold`` is refused
    ``FOREMAN_LOST``. A call that names none is refused while a session holds the lane,
    unless ``owner_may``."""
    lease = state["lane"].get("foreman")
    if session is None:
        if not owner_may and _live(lease, now):
            raise _busy(lease, command)
        return
    if stale := _stale(state["lane"], session, command):
        raise stale
    if _live(lease, now) and lease["session"] != session:
        raise _busy(lease, command)
    if not _live(lease, now):
        raise Refusal(
            "FOREMAN_LOST",
            f"Session {session} no longer holds the lane (its lease was handed over or ran out "
            f"before {command} acted); nothing was changed",
            "Read lane-status first: if the owner handed the lane over, stop and report; "
            "otherwise call again, which takes the lane while no other session holds it",
            recovery=call("lane-status"),
            session=session,
        )
    take(state, session, command, now)


def guard(
    factory: Factory, session: str | None, command: str, owner_may: bool = False
) -> Callable[[dict[str, Any]], None]:
    """``check`` for ``command``, to run first inside its own store transaction."""
    return lambda state: check(state, session, command, factory.world.clock.now(), owner_may)


def acting(
    factory: Factory, session: str | None, command: str, owner_may: bool = False
) -> Callable[[dict[str, Any]], None]:
    """``hold`` before ``command`` acts; the ``guard`` to run inside its transaction."""
    hold(factory, session, command, owner_may)
    return guard(factory, session, command, owner_may)


def wait_guard(
    factory: Factory, consumer: str, session: str | None
) -> Callable[[dict[str, Any]], None] | None:
    """What ``lane-wait`` checks inside the transaction that marks events delivered: the
    foreman's session again; nothing for any other consumer."""
    return guard(factory, session, "lane-wait") if consumer == "foreman" else None


def waiting(
    factory: Factory, consumer: str, session: str | None, timeout_ms: int | None
) -> Callable[[], None] | None:
    """Before ``lane-wait``: a foreman takes or renews the lease, and gets back what keeps it
    while waiting. Only a wait with a timeout keeps it, so a wait left behind by a session that
    has ended holds the lane at most until it times out and the lease runs out after it; None for
    any other consumer, a foreman that names no session, or a wait without a limit."""
    if consumer != "foreman":
        return None
    hold(factory, session, "lane-wait")
    if session is None or timeout_ms is None:
        return None
    return lambda: renew(factory, session)


def renew(factory: Factory, session: str) -> None:
    """Keep a waiting foreman's lease: renewed once less than half of it is left."""
    now = factory.world.clock.now()
    lease = factory.store.read()["lane"].get("foreman")
    if not _live(lease, now) or lease["session"] != session:
        return
    minutes = dials.value(factory.store.read()["dials"], LEASE_DIAL)
    if parse_time(lease["until"]) - now < timedelta(minutes=minutes / 2):
        hold(factory, session, "lane-wait")


def handoff(factory: Factory, session: str) -> dict[str, Any]:
    """Release the lease: the holder's own session, or anyone once it has run out."""
    if not session.strip():
        raise Refusal(
            "VALIDATION_ERROR",
            "session is empty",
            "Pass the holder's session",
            recovery=fix_input("session"),
        )
    now = factory.world.clock.now()
    with factory.store.update(f"foreman-handoff {session}") as state:
        lease = state["lane"].get("foreman")
        if lease is None:
            return {"released": None}
        if _live(lease, now) and lease["session"] != session:
            raise Refusal(
                "NOT_FOREMAN",
                f"Session {lease['session']} holds the lane until {lease['until']}, not {session}",
                "Only the holder hands over; otherwise wait for its lease to run out",
                recovery=STOP,
                holder=lease["session"],
                until=lease["until"],
            )
        state["lane"].pop("foreman")
        # The next session to take the lane supersedes this one.
        state["lane"]["lastForeman"] = lease["session"]
        factory.store.log({"kind": "foreman-handoff", "session": lease["session"]})
        return {"released": lease}
