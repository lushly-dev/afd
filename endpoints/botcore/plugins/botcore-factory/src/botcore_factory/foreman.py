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
"""

from __future__ import annotations

from datetime import timedelta

from botcore_factory import dials
from botcore_factory.claims import format_time, parse_time
from botcore_factory.runtime import Factory, Refusal

LEASE_DIAL = "foreman.leaseMinutes"


def _live(lease: dict | None, now) -> bool:
    return lease is not None and parse_time(lease["until"]) > now


def _busy(lease: dict, command: str) -> Refusal:
    return Refusal(
        "FOREMAN_BUSY",
        f"Session {lease['session']} is this lane's foreman until {lease['until']}; "
        f"{command} is its call",
        "One foreman per lane: stop here and tell the owner. If that session has ended, its "
        "lease runs out by itself, or the owner frees the lane with foreman-handoff",
        holder=lease["session"],
        until=lease["until"],
    )


def hold(
    factory: Factory, session: str | None, command: str, owner_may: bool = False
) -> dict | None:
    """Take or renew the lease for ``session`` before ``command`` acts; the lease, or None when
    no session is named. Refuses ``FOREMAN_BUSY`` for another session, and for a call that names
    none unless ``owner_may`` (the owner's own ``dial-set``)."""
    if session is not None and not session.strip():
        raise Refusal("VALIDATION_ERROR", "session is empty", "Pass your T3 Code thread id")
    now = factory.world.clock.now()
    current = factory.store.read()["lane"].get("foreman")
    if session is None and owner_may:
        return None
    if _live(current, now) and current["session"] != session:
        raise _busy(current, command)
    if session is None:
        return None
    with factory.store.update(f"{command} (foreman {session})") as state:
        lease = state["lane"].get("foreman")
        if _live(lease, now) and lease["session"] != session:
            raise _busy(lease, command)
        minutes = dials.value(state["dials"], LEASE_DIAL)
        kept = _live(lease, now) and lease["session"] == session
        state["lane"]["foreman"] = {
            "session": session,
            "since": lease["since"] if kept else format_time(now),
            "until": format_time(now + timedelta(minutes=minutes)),
        }
        return dict(state["lane"]["foreman"])


def waiting(factory: Factory, consumer: str, session: str | None, timeout_ms: int | None):
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


def handoff(factory: Factory, session: str) -> dict:
    """Release the lease: the holder's own session, or anyone once it has run out."""
    if not session.strip():
        raise Refusal("VALIDATION_ERROR", "session is empty", "Pass the holder's session")
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
                holder=lease["session"],
                until=lease["until"],
            )
        state["lane"].pop("foreman")
        factory.store.log({"kind": "foreman-handoff", "session": lease["session"]})
        return {"released": lease}
