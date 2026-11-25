"""The small-worlds explorer over the real factory, and a planted wrong recovery it catches.

``small_worlds`` explores four scenario fixtures to depth 2 and judges every refusal it meets
whose recovery a program can follow: the recovery must be enabled and must lead back to where
the refused call can still succeed (verified recovery, step 4).
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass

import pytest
from afd import Recovery
from conftest import fixture
from small_worlds import (
    EXCLUDED_COMMANDS,
    SESSIONS,
    Finding,
    Report,
    explore_worlds,
    fingerprint,
)

from botcore_factory import runtime

#: The fixtures explored. Between them they reach every code a followable recovery is given for
#: but two that need a second writer racing the call: STATE_LOCKED (retry) and FOREMAN_LOST
#: (a lease lost between its two checks). running and at-ceiling add only external refusals
#: (DIRTY_WORKTREE, REVIEW_MISSING, PLAN_ABOVE_CEILING) and half again as many calls.
WORLDS = ("fresh", "backlog", "ejected", "host-offline")
DEPTH = 2

#: Violations found and not fixed, as (refused command, code, the recovery's command). The test
#: fails when one is no longer found, so a fixed one leaves this list. The first run found one:
#: lane-report on a lane that never ran sent the caller to lane-start, which refuses on a machine
#: that does not host the lane; it now sends it to lane-status.
KNOWN: set[tuple[str, str, str]] = set()

#: Every (command, code) the run judges ok, and those it judges but never ok: a narrowed domain,
#: a broken world or a wrong recovery that only ends out of reach changes one of them.
OK = {
    ("cell-attach", "NOT_FOUND"),
    ("cell-attach", "VALIDATION_ERROR"),
    ("cell-register", "ALREADY_CLAIMED"),
    ("cell-register", "ALREADY_EXISTS"),
    ("cell-register", "CELLS_FULL"),
    ("cell-register", "NOT_DISPATCHABLE"),
    ("cell-register", "TOO_MANY_ISSUES"),
    ("cell-register", "VALIDATION_ERROR"),
    ("dial-get", "NOT_FOUND"),
    ("dial-set", "DIAL_OUT_OF_RANGE"),
    ("dial-set", "NOT_FOUND"),
    ("ejection-excuse", "NOT_FOUND"),
    ("ejection-excuse", "VALIDATION_ERROR"),
    ("event-resolve", "NOT_FOUND"),
    ("event-resolve", "VALIDATION_ERROR"),
    ("foreman-handoff", "VALIDATION_ERROR"),
    ("gate-allow", "NOT_FOUND"),
    ("gate-allow", "VALIDATION_ERROR"),
    ("issue-check", "VALIDATION_ERROR"),
    ("lane-drop", "NOT_FOUND"),
    ("lane-drop", "VALIDATION_ERROR"),
    ("lane-enqueue", "BODY_FILE_OUTSIDE"),
    ("lane-enqueue", "NOT_FOUND"),
    ("lane-host-set", "LANE_BUSY"),
    ("lane-host-set", "NOT_FOUND"),
    ("lane-host-set", "VALIDATION_ERROR"),
    ("lane-report", "NOT_FOUND"),
    ("lane-start", "HOST_NOT_SET"),
    ("lane-start", "LANE_LOCKED"),
    ("lane-status", "VALIDATION_ERROR"),
    ("lane-wait", "VALIDATION_ERROR"),
}
#: Nothing in these worlds is held for gate-change or measure-change, so measure-approve never
#: succeeds and its refusals are always out of reach.
JUDGED_ONLY = {("measure-approve", "NOT_FOUND"), ("measure-approve", "VALIDATION_ERROR")}
#: The run makes about 15,700 calls; a domain that grows by much fails here, not only slows CI.
CALL_BUDGET = 19_000


def ok_pairs(report: Report) -> set[tuple[str, str]]:
    return {(f.action.command, f.code) for f in report.verdicts("ok")}


def signature(finding: Finding) -> tuple[str, str, str]:
    recovery = json.loads(finding.recovery) if finding.recovery else {}
    return finding.action.command, finding.code, recovery.get("command", recovery.get("kind", ""))


async def explore(tmp_path, example_repo, names=WORLDS, depth=DEPTH) -> Report:
    worlds = {name: fixture(name) for name in names}
    return await explore_worlds(worlds, tmp_path, example_repo, depth=depth)


@pytest.fixture(scope="module")
def report(tmp_path_factory, example_repo) -> Report:
    """One exploration of the worlds, which the tests below read."""
    return asyncio.run(explore(tmp_path_factory.mktemp("small-worlds"), example_repo))


def test_every_followable_recovery_is_enabled_and_leads_back(report):
    print(report.summary())  # noqa: T201 - the numbers, with -s
    found = {signature(v) for v in report.violations}
    assert found - KNOWN == set(), "\n".join(
        str(v) for v in report.violations if signature(v) not in KNOWN
    )
    assert KNOWN - found == set(), f"No longer found, so take them out of KNOWN: {KNOWN - found}"


def test_the_worlds_judge_the_same_refusals_ok_within_the_budget(report):
    judged = {(f.action.command, f.code) for f in report.findings}
    assert ok_pairs(report) == OK, (sorted(OK - ok_pairs(report)), sorted(ok_pairs(report) - OK))
    assert judged - OK == JUDGED_ONLY, sorted(judged - OK)
    assert report.calls < CALL_BUDGET, report.calls


def test_the_start_over_and_blocking_calls_are_never_made(report):
    commands = {action.command for action in report.called}
    assert not commands & set(EXCLUDED_COMMANDS)
    for action in report.called:
        arguments = action.arguments
        if action.command == "lane-host-set" and arguments.get("recover"):
            assert arguments.get("drain") is True, action  # Refused before it rebuilds.
        if action.command == "lane-wait":
            assert arguments.get("timeout_ms") in (0, -1), action


def test_the_fingerprint_leaves_out_what_only_grows():
    def files(log: bytes = b"", **state) -> dict[str, bytes]:
        lane = {"running": True, "pid": state.pop("pid", 1), "runId": state.pop("run", "run-1")}
        body = {"lane": lane, "cells": [], "events": [], "runs": [{"id": "run-1"}], **state}
        return {
            "world.json": json.dumps({"issues": [], "now": "2030-01-01T00:00:00Z"}).encode(),
            "state/repo/state.json": json.dumps(body).encode(),
            "state/repo/log.jsonl": log,
        }

    same = fingerprint(files())
    closed = fingerprint(files(events=[{"id": "ev-1", "open": False, "detail": "a"}]))
    assert fingerprint(files(log=b'{"kind": "dial-set"}\n')) == same
    assert fingerprint(files(pid=2, eventSeq=9, runSeq=4)) == same
    assert fingerprint(files(cells=[{"branch": "b", "at": "x"}])) == fingerprint(
        files(cells=[{"branch": "b", "at": "y"}])
    )
    # A closed event keeps only its id; runs keep theirs: lane-report and event-resolve read them.
    assert fingerprint(files(events=[{"id": "ev-1", "open": False, "detail": "b"}])) == closed
    assert closed != same
    assert fingerprint(files(runs=[{"id": "run-1"}, {"id": "run-2"}])) != same
    assert fingerprint(files(run="run-2")) != same
    assert fingerprint(files(events=[{"id": "ev-1", "open": True}])) not in (same, closed)
    assert fingerprint(files(cells=[{"branch": "b", "state": "working"}])) != fingerprint(
        files(cells=[{"branch": "b", "state": "queued"}])
    )


def one_ejection() -> dict:
    """The ejected fixture with one cell that has an ejection to excuse, fix/loosened-check, and
    the foreman's session (``s-a``) holding the lane, as ejection-excuse needs."""
    data = fixture("ejected")
    data["lane"]["foreman"] = {
        "session": SESSIONS[0],
        "since": "2030-01-01T00:00:00Z",
        "until": "2031-01-01T00:00:00Z",
    }
    for cell in data["cells"]:
        if cell["branch"] == "fix/parser-empty-input":
            cell.pop("lastEjection")
            cell["ejections"] = 0
    return data


@dataclass(frozen=True)
class Plant:
    """A wrong recovery planted on one refusal (its code and the start of its suggestion), and
    what the explorer must then report: ``violation`` (its signature) whose reason starts with
    ``why``, or, with ``why`` None, that the refused (command, code) is no longer judged ok,
    which the pinned ``OK`` set then catches in the real run."""

    world: str
    code: str
    suggestion: str
    recovery: Recovery
    violation: tuple[str, str, str]
    why: str | None


PLANTS = {
    # Not enabled: lane-status succeeds, and the repeated lane-start comes back LANE_LOCKED.
    "same-refusal": Plant(
        "backlog",
        "LANE_LOCKED",
        "Stop it with lane-stop first; lane-status",
        runtime.call("lane-status", then_retry=True),
        ("lane-start", "LANE_LOCKED", "lane-status"),
        "lane-start {} came back with the same LANE_LOCKED",
    ),
    # Not enabled: the call it names refuses (the class of lane-report's first recovery).
    "disabled-call": Plant(
        "fresh",
        "NOT_FOUND",
        "There is a report once the lane has run",
        runtime.call("lane-start"),
        ("lane-report", "NOT_FOUND", "lane-start"),
        "its call lane-start {} refused HOST_NOT_SET",
    ),
    # Not enabled: the call succeeds but the repeated lane-start refuses, with another code.
    "retry-refused": Plant(
        "fresh",
        "HOST_NOT_SET",
        "lane-host-list shows",
        runtime.call("lane-host-set", input={"id": "mini"}, then_retry=True),
        ("lane-start", "HOST_NOT_SET", "lane-host-set"),
        "the repeated lane-start {} refused NOT_LANE_HOST",
    ),
    # Leads away: the call succeeds, and lane-start, which one more call would have let
    # succeed, now cannot.
    "leads-away-one-step": Plant(
        "fresh",
        "HOST_NOT_SET",
        "lane-host-list shows",
        runtime.call("lane-host-set", input={"id": "mini"}),
        ("lane-start", "HOST_NOT_SET", "lane-host-set"),
        "after lane-host-set",
    ),
    # Leads away: dropping the only cell with an ejection to excuse succeeds, and afterwards
    # no ejection-excuse can, though one could before.
    "leads-away": Plant(
        "one-ejection",
        "VALIDATION_ERROR",
        "Say why the ejection was not",
        runtime.call("lane-drop", input={"branch": "fix/loosened-check", "reason": "planted"}),
        ("ejection-excuse", "VALIDATION_ERROR", "lane-drop"),
        "after lane-drop",
    ),
    # Malformed: a needs field lane-wait does not take.
    "misspelled-needs": Plant(
        "fresh",
        "VALIDATION_ERROR",
        "Pass a timeout in milliseconds",
        runtime.fix_input("timeoutMs"),
        ("lane-wait", "VALIDATION_ERROR", "fix-input"),
        "lane-wait takes no timeoutMs",
    ),
    # Malformed: rule 3, a field both known (input) and left to the caller (needs).
    "input-and-needs": Plant(
        "fresh",
        "DIAL_OUT_OF_RANGE",
        "Pass a value in range",
        Recovery(kind="fix-input", input={"value": 2}, needs=["value"]),
        ("dial-set", "DIAL_OUT_OF_RANGE", "fix-input"),
        "names value in both input and needs",
    ),
    # A fix-input whose fixed call fails another way: out of reach on its own, so only the
    # pinned OK set notices that cell-attach's VALIDATION_ERROR is no longer judged ok.
    "fix-input-elsewhere": Plant(
        "backlog",
        "VALIDATION_ERROR",
        "Pass the thread delegate_task returned",
        Recovery(kind="fix-input", input={"thread": "thread-9", "branch": "fix/nowhere"}),
        ("cell-attach", "VALIDATION_ERROR", "fix-input"),
        None,
    ),
}

WORLD_DATA = {"one-ejection": one_ejection}


@pytest.mark.parametrize("name", PLANTS)
async def test_a_planted_wrong_recovery_is_caught(tmp_path, example_repo, monkeypatch, name):
    """Each plant is reported as the one violation in its world, which has none without it; or
    its refusal, judged ok without it, is not judged ok with it."""
    plant = PLANTS[name]
    world = {plant.world: WORLD_DATA.get(plant.world, lambda: fixture(plant.world))()}
    pair = plant.violation[:2]
    clean = await explore_worlds(world, tmp_path / "clean", example_repo, depth=1)
    assert not clean.violations, [str(v) for v in clean.violations]
    original = runtime.Refusal.__init__

    def planted(self, code, message, suggestion, *, recovery=None, **details):
        if code == plant.code and suggestion.startswith(plant.suggestion):
            recovery = plant.recovery
        original(self, code, message, suggestion, recovery=recovery, **details)

    monkeypatch.setattr(runtime.Refusal, "__init__", planted)
    wrong = await explore_worlds(world, tmp_path / "planted", example_repo, depth=1)
    if plant.why is None:
        assert pair in ok_pairs(clean) and pair not in ok_pairs(wrong)
        return
    assert [signature(v) for v in wrong.violations] == [plant.violation], [
        str(v) for v in wrong.violations
    ]
    assert wrong.violations[0].why.startswith(plant.why), wrong.violations[0].why
