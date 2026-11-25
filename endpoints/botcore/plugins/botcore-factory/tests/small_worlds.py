"""A small-worlds explorer over the factory host: does each refusal's recovery lead back?

Verified recovery, step 4 (``docs/features/active/verified-recovery/``). The jobs in
``test_scenarios.py`` follow the recoveries their written steps happen to meet. This explorer
starts from a few scenario fixtures, calls the factory's commands with small inputs breadth-first
to a small depth, records every state it reaches, and judges each refusal whose recovery a
program can follow (``call``, ``fix-input``, ``retry``), following it as AFD's scenario runners
do (``followRecovery`` in ``packages/testing/src/runner/scenario-runner.ts``, ``_follow`` in
``python/src/afd/testing/scenarios/executor.py``):

- **Well formed.** No field is both in ``input`` and in ``needs`` (``spec/recovery.md`` rule
  3, which both runners check before following), and the command followed, the one the
  recovery names or the refused one, is served and takes every field ``input`` and ``needs``
  name. A misspelled field is a violation, not a field with no values to try.
- **Enabled.** As the runners expect by default, a ``call`` recovery's command succeeds and,
  with ``thenRetry``, so does the refused call repeated after it. For ``fix-input`` (with the
  input it changes) and ``retry`` (unchanged) the explorer is deliberately more lenient than the
  runners, whose default expects the call made again to succeed: here it must only not come back
  with the same refusal (same command, same code), and "Leads back" below judges where it lands.
  So a fixed call refused for another reason, such as ``CELLS_FULL`` after ``TOO_MANY_ISSUES``,
  passes when the refused call can still succeed. A ``needs`` field takes each value of its
  domain in turn; one way that works is enough.
- **Leads back.** The followed call then succeeds, or the state it leaves can still reach the
  goal's success: the set of such states is computed backward from the goal's successful
  calls over the explored graph and the leaves it reaches (``Explorer.live``), so the bound is
  what remains of the depth.

The goal is what a recovery promises. ``retry``, and ``call`` with ``thenRetry``: the refused
call, unchanged. ``fix-input``: the refused call with the input it changes. ``call`` without
``thenRetry`` "is the way forward itself" (``spec/recovery.md``), such as listing the work that
can be taken instead, so its goal is the refused command with any input of its domain. For such
a call (every one the factory gives is a read) the check is only that it is enabled and does
not destroy reachability: a read of the wrong command passes. That it returns what the caller
needs is what a scenario's ``follow.expect`` checks.

A refusal whose goal cannot succeed from its own state within the bound (``measure-approve``
where nothing is held) cannot be judged in a world this small: it is reported as out of reach,
not as a violation, and so is a ``fix-input`` or ``retry`` whose call made again leaves the
explored states. A wrong recovery that only ends out of reach is caught by the test pinning
which refusals are judged ok. ``external`` and ``stop`` recoveries are counted, not followed,
and a ``stop`` whose refused call succeeds after one other call is listed for review.

It runs in-process over ``build_factory_host`` and a fixture world, as the scenario harness does
(``botcore_factory.harness``). It lives with the tests, not in ``src``: it judges the plugin,
and nothing the plugin serves calls it.
"""

from __future__ import annotations

import copy
import inspect
import itertools
import json
import os
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from unittest import mock

from afd import CommandResult
from botcore.context import ExecutionContext

from botcore_factory import commands, lane_commands
from botcore_factory.fixture_world import FixtureWorld, open_run
from botcore_factory.hosts import build_factory_host
from botcore_factory.runtime import guarded

# ---------------------------------------------------------------------------------------------
# What the explorer leaves out, and why.

#: Commands never called.
EXCLUDED_COMMANDS = {
    "lane-run": "runs the lane's loop in the foreground: without steps it runs until asked to "
    "stop, it sleeps between steps, and it is the lane's own process, not a step a caller takes",
}

#: Inputs never given, though their command is called with others.
EXCLUDED_INPUTS = {
    "lane-host-set recover: true": "the universal start over the research warns about: it "
    "rebuilds the queue and claims wholesale, so it would make any refusal look recoverable. "
    "Only {drain: true, recover: true} is given, which is refused before anything is rebuilt; "
    "a recovery's needs never take recover: true",
    "lane-wait without timeout_ms, or with a positive one": "blocks until an event arrives or "
    "the time passes; only 0 (answer at once) and -1 (refused) are given",
}

#: Called although on a real host they start processes or reach other systems: the fixture
#: world fakes them. lane-start's lane process is a pid the world records
#: (``FixtureProcesses.start_detached``); GitHub, git, the machine, the plans and the clock are
#: the fixture's; a foreman ``session`` is a name the lane's lease records, not a T3 Code thread.
FAKED_BY_THE_WORLD = ("lane-start", "lane-stop", "lane-host-probe", "cell-register", "plan-list")

# ---------------------------------------------------------------------------------------------
# State abstraction.
#
# A state is a fingerprint of the run's files: canonical JSON of world.json and the lane state,
# leaving out what only ever grows, so that the same situation reached by different paths
# compares equal. The first snapshot seen with a fingerprint is the one later calls start from;
# every transition recorded is a real call from a real snapshot, but a path through a merged
# state joins two runs, so what the abstraction leaves out must not change what a command does.

#: Append-only files: every change, every measurement record and their summary.
GROWING_FILES = ("log.jsonl", "records.jsonl", "records-summary.json")
#: Lane-state keys that only grow: the counters behind new event and run ids. Runs are kept as
#: their sorted ids and closed events as theirs: lane-report takes a run, event-resolve an
#: event id, and what a run recorded is in the records left out above.
GROWING_STATE = ("runSeq", "eventSeq")
#: Keys that record when, or which process, not what: the fixture's clock stands still, so a
#: time a command writes is always its ``now``, and pids count up with each start. Lease ends
#: (``until``, ``leaseUntil``) and probe times are kept: a live lease or a recent record
#: depends on them.
INCIDENTAL_KEYS = frozenset(
    {"at", "since", "startedAt", "stoppedAt", "registeredAt", "resolvedAt", "removedAt", "pid"}
)
#: World keys that count up for new ids or log what was cleaned, not situations.
GROWING_WORLD = ("nextPr", "removedCheckouts", "removedBuilds", "cleanedSlotPaths")


def _strip(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _strip(v) for k, v in value.items() if k not in INCIDENTAL_KEYS}
    if isinstance(value, list):
        return [_strip(v) for v in value]
    return value


def _situation(files: dict[str, bytes]) -> dict[str, Any]:
    world = json.loads(files["world.json"])
    for key in GROWING_WORLD:
        world.pop(key, None)
    processes = world.pop("processes", {})
    # Which pids, and in what order they started, is history; how many are alive and which
    # validation jobs run is the situation.
    world["processes"] = {
        "alive": len(processes.get("alive", [])),
        "running": sorted(job.get("label", "") for job in processes.get("running", {}).values()),
    }
    for issue in world.get("issues", []):
        for comment in issue.get("comments", []):
            comment.pop("id", None)  # Numbered in the order they were posted.
    situation: dict[str, Any] = {"world": _strip(world)}
    for path, data in files.items():
        name = path.rsplit("/", 1)[-1]
        if name == "state.json":
            state = json.loads(data)
            for key in GROWING_STATE:
                state.pop(key, None)
            state["runs"] = sorted(str(r.get("id")) for r in state.get("runs", []))
            events = state.get("events", [])
            # An open event is something the lane waits on; a closed one only its id.
            state["events"] = [e for e in events if e.get("open")]
            state["closedEvents"] = sorted(str(e.get("id")) for e in events if not e.get("open"))
            situation["state"] = _strip(state)
        elif name == "lane.lock":
            situation["laneLock"] = json.loads(data).get("repository")
    return situation


def fingerprint(files: dict[str, bytes]) -> str:
    """Canonical JSON of a run's situation: equal situations give equal fingerprints."""
    return json.dumps(_situation(files), sort_keys=True, separators=(",", ":"))


# ---------------------------------------------------------------------------------------------
# Actions and their domains.


@dataclass(frozen=True)
class Action:
    command: str
    input: str  # Canonical JSON, so actions compare and hash.

    @classmethod
    def of(cls, command: str, arguments: dict[str, Any] | None = None) -> Action:
        return cls(command, json.dumps(arguments or {}, sort_keys=True))

    @property
    def arguments(self) -> dict[str, Any]:
        loaded: dict[str, Any] = json.loads(self.input)
        return loaded

    def __str__(self) -> str:
        return f"{self.command} {self.input}"


#: Two branches no cell has: the first is registered, the second stands for an unknown one.
FRESH_BRANCHES = ("fix/small-a", "fix/small-b")
#: Two foreman sessions, so one can hold the lane's lease while the other is refused. The first
#: is the one the foreman-only commands (gate-allow, ejection-excuse) name: it holds the lease
#: once a call of its own (cell-register, dial-set, lane-wait) has taken it.
SESSIONS = ("s-a", "s-b")
#: A head no branch has.
NO_HEAD = "0000000"
ROUTE = "sol/high"


@dataclass
class Domain:
    """The actions tried from one state, and the values a recovery's ``needs`` may take, by
    command and field."""

    actions: list[Action]
    fields: dict[str, dict[str, list[Any]]]
    probes: set[Action] = field(default_factory=set)  # Never accepted: skipped as goal calls.


def _names(world: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    # One branch for each state a cell is in and each reason a branch is held for: the commands
    # that take a branch answer by its cell's state, so more branches add calls, not cases.
    kinds: dict[tuple[str, Any], str] = {}
    for cell in sorted(state.get("cells", []), key=lambda c: c["branch"]):
        kinds.setdefault(("cell", cell.get("state")), cell["branch"])
    for entry in sorted(state.get("held", []), key=lambda e: e["branch"]):
        kinds.setdefault(("held", entry.get("holdReason")), entry["branch"])
    return {
        "issues": sorted(i["number"] for i in world.get("issues", [])),
        "branches": sorted(set(kinds.values())),
        "worktrees": sorted(world.get("worktrees", {})),
        "machines": sorted(m["id"] for m in world.get("machines", [])),
        "events": sorted(e["id"] for e in state.get("events", []) if e.get("open")),
        "runs": sorted(r["id"] for r in state.get("runs", []) if r.get("id")),
        # Each branch's head: its queue entry's, else its worktree's.
        "heads": {
            **{
                w["branch"]: w["head"] for w in world.get("worktrees", {}).values() if w.get("head")
            },
            **{e["branch"]: e["head"] for e in state.get("queue", []) if e.get("head")},
        },
    }


def domain(files: dict[str, bytes]) -> Domain:
    """Small inputs for every command but the excluded, from the state's own names: its issue
    numbers, its cells' branches, worktrees, machines, open events and runs, one name of each
    kind that does not exist, and the empty and out-of-range values that reach validation."""
    world = json.loads(files["world.json"])
    state: dict[str, Any] = next(
        (json.loads(data) for path, data in files.items() if path.endswith("state.json")), {}
    )
    n = _names(world, state)
    first_issue = n["issues"][:1] or [1]
    known = [*n["branches"], FRESH_BRANCHES[1]]
    actions: list[Action] = []
    probes: set[Action] = set()

    def add(command: str, *inputs: dict[str, Any]) -> None:
        actions.extend(Action.of(command, i) for i in (inputs or ({},)))

    def probe(command: str, *inputs: dict[str, Any]) -> None:
        """Inputs no state accepts, given to reach a validation refusal."""
        probes.update(Action.of(command, i) for i in inputs)
        actions.extend(Action.of(command, i) for i in inputs)

    add("issue-check", {}, {"numbers": first_issue})
    probe("issue-check", {"numbers": [0]}, {"limit": 0}, {"cursor": "x"})
    add("lane-status")
    probe("lane-status", {"limit": 0}, {"cursor": "x"})
    register = {"branch": FRESH_BRANCHES[0], "route": ROUTE}
    add(
        "cell-register",
        *({**register, "issues": [i]} for i in n["issues"]),
        *({**register, "issues": first_issue, "session": s} for s in SESSIONS),
        {**register, "issues": n["issues"][:2]},
        *({**register, "branch": b, "issues": first_issue} for b in n["branches"][:1]),
    )
    probe("cell-register", {**register, "issues": []})
    add("dial-get", {}, {"key": "cells.max"})
    probe("dial-get", {"key": "cells.maxx"})
    add(
        "dial-set",
        {"key": "cells.max", "value": 1},
        {"key": "cells.issuesMax", "value": 2},
        {"key": "lane.slots", "value": 2},
        {"key": "cells.max", "value": 2, "session": SESSIONS[0]},
    )
    probe("dial-set", {"key": "cells.max", "value": 0}, {"key": "cells.maxx", "value": 1})
    add(
        "lane-enqueue",
        *({"worktree": w} for w in [*n["worktrees"], "wt/missing"]),
    )
    probe(
        "lane-enqueue", *({"worktree": w, "body_file": "../outside.md"} for w in n["worktrees"][:1])
    )
    add(
        "lane-wait",
        *({"consumer": c, "timeout_ms": 0} for c in ("foreman", "watcher")),
        *({"consumer": "foreman", "timeout_ms": 0, "session": s} for s in SESSIONS),
    )
    probe("lane-wait", {"consumer": "", "timeout_ms": 0}, {"consumer": "foreman", "timeout_ms": -1})
    add(
        "event-resolve",
        *({"id": e, "note": "decided"} for e in [*n["events"], "ev-999"]),
    )
    probe("event-resolve", {"id": (n["events"] or ["ev-999"])[0], "note": ""})
    add("lane-pause", {"reason": "small worlds"})
    add("lane-resume", {"reason": "small worlds"})
    add("cell-attach", *({"branch": b, "thread": "thread-9"} for b in known))
    probe("cell-attach", {"branch": known[0], "thread": ""})
    for command in ("lane-drop", "measure-approve"):
        add(command, *({"branch": b, "reason": "small worlds"} for b in known))
        probe(command, {"branch": known[0], "reason": ""})
    # The live foreman's commands: with the session that takes the lease, another and none.
    foreman = {"reason": "small worlds", "session": SESSIONS[0]}
    head = {b: n["heads"].get(b, NO_HEAD) for b in known}
    add(
        "gate-allow",
        *({**foreman, "branch": b, "head": head[b]} for b in known),
        {**foreman, "branch": known[0], "head": NO_HEAD},
        {**foreman, "branch": known[0], "head": head[known[0]], "session": SESSIONS[1]},
        {"branch": known[0], "reason": "small worlds", "head": head[known[0]]},
    )
    probe(
        "gate-allow",
        {**foreman, "branch": known[0], "head": head[known[0]], "reason": ""},
        {**foreman, "branch": known[0], "head": ""},
    )
    add(
        "ejection-excuse",
        *({**foreman, "branch": b} for b in known),
        {"branch": known[0], "reason": "small worlds"},
    )
    # On a cell with an ejection to excuse, where there is one, so the fixed call can succeed.
    ejected = next(
        (
            c["branch"]
            for c in sorted(state.get("cells", []), key=lambda c: c["branch"])
            if c.get("state") == "ejected"
        ),
        known[0],
    )
    probe("ejection-excuse", {**foreman, "branch": ejected, "reason": ""})
    add("lane-drop", {"branch": known[0], "reason": "small worlds", "session": SESSIONS[1]})
    add("foreman-handoff", *({"session": s} for s in SESSIONS))
    probe("foreman-handoff", {"session": ""})
    add("lane-host-list")
    add("lane-host-probe")
    add(
        "lane-host-set",
        *({"id": m} for m in [*n["machines"], "nowhere"]),
        *({"id": m, "drain": True} for m in n["machines"]),
    )
    probe(
        "lane-host-set",
        {"id": world.get("thisMachine") or "nowhere", "drain": True, "recover": True},
    )
    add("lane-report", {}, {"run": "run-99"}, *({"compare": r} for r in n["runs"][-1:]))
    add("lane-start")
    add("lane-stop", {}, {"force": True})
    add("plan-list")
    fields: dict[str, dict[str, list[Any]]] = {
        "issue-check": {"numbers": [[i] for i in n["issues"]], "limit": [1, 100], "cursor": ["0"]},
        "lane-status": {"limit": [1, 100], "cursor": ["0"]},
        "cell-register": {
            "issues": [[i] for i in n["issues"]],
            "branch": [*FRESH_BRANCHES, *n["branches"]],
            "route": [ROUTE],
            "related_because": ["they edit the same files"],
            "session": list(SESSIONS),
        },
        "dial-set": {"value": [1, 2, 3, True, "x"], "key": ["cells.max", "cells.issuesMax"]},
        "dial-get": {"key": ["cells.max"]},
        "lane-enqueue": {"worktree": n["worktrees"], "body_file": ["pr-body.md"]},
        "lane-wait": {
            "consumer": ["foreman", "watcher"],
            "timeout_ms": [0],
            "session": list(SESSIONS),
        },
        "event-resolve": {"id": n["events"], "note": ["decided"]},
        "cell-attach": {"branch": n["branches"], "thread": ["thread-9"]},
        "lane-host-set": {"id": n["machines"], "drain": [False, True], "recover": [False]},
        "lane-report": {"run": n["runs"], "compare": n["runs"]},
        "foreman-handoff": {"session": list(SESSIONS)},
    }
    for command in ("lane-drop", "gate-allow", "ejection-excuse", "measure-approve"):
        fields[command] = {"branch": n["branches"], "reason": ["small worlds"]}
    for command in ("lane-drop", "gate-allow", "ejection-excuse"):
        fields[command]["session"] = list(SESSIONS)
    fields["gate-allow"]["head"] = sorted({*n["heads"].values(), NO_HEAD})
    return Domain(actions, fields, probes)


# ---------------------------------------------------------------------------------------------
# Results.


@dataclass(frozen=True)
class Outcome:
    success: bool
    code: str | None = None
    recovery: str | None = None  # Canonical JSON of the error's recovery, when it has one.

    @property
    def kind(self) -> str | None:
        return json.loads(self.recovery)["kind"] if self.recovery else None

    def same_refusal(self, other: Outcome) -> bool:
        return not self.success and not other.success and self.code == other.code


@dataclass(frozen=True)
class Transition:
    state: str
    action: Action
    outcome: Outcome
    next: str


@dataclass(frozen=True)
class Goal:
    """``command`` succeeding with ``input``, or, when ``input`` is None, with any input."""

    command: str
    input: str | None

    def met(self, transition: Transition) -> bool:
        return (
            transition.outcome.success
            and transition.action.command == self.command
            and (self.input is None or transition.action.input == self.input)
        )


@dataclass
class Finding:
    """One refused call in one state, and the verdict on its recovery."""

    world: str
    action: Action
    code: str
    recovery: str
    verdict: str = "violation"  # Or "ok", or "out-of-reach".
    why: str = ""
    follows: int = 0

    def __str__(self) -> str:
        return f"[{self.world}] {self.action} -> {self.code} {self.recovery}: {self.why}"


@dataclass
class Report:
    worlds: list[str] = field(default_factory=list)
    states: int = 0
    transitions: int = 0
    explored: int = 0  # Transitions of the breadth-first exploration itself.
    calls: int = 0
    refusals: dict[tuple[str, str], int] = field(default_factory=dict)
    called: set[Action] = field(default_factory=set)  # Every call made, in any world.
    findings: list[Finding] = field(default_factory=list)
    stop_candidates: list[str] = field(default_factory=list)

    def verdicts(self, verdict: str) -> list[Finding]:
        return [f for f in self.findings if f.verdict == verdict]

    @property
    def violations(self) -> list[Finding]:
        return self.verdicts("violation")

    def summary(self) -> str:
        kinds: dict[str, int] = {}
        for (_, kind), count in self.refusals.items():
            kinds[kind] = kinds.get(kind, 0) + count
        counts = {v: len(self.verdicts(v)) for v in ("ok", "out-of-reach", "violation")}
        distinct = sorted({f"{f.action} -> {f.code}" for f in self.verdicts("out-of-reach")})
        return "\n".join(
            [
                f"worlds {', '.join(self.worlds)}: {self.states} states, {self.transitions} "
                f"transitions ({self.explored} explored), {self.calls} calls",
                f"refusals met, by recovery kind: {dict(sorted(kinds.items()))}",
                f"refusals met, by code and kind: {dict(sorted(self.refusals.items()))}",
                f"refused calls judged: {counts}, {sum(f.follows for f in self.findings)} follows",
                *(f"violation: {f}" for f in self.violations),
                *(f"out of reach: {d}" for d in distinct),
                *(f"stop to review: {s}" for s in self.stop_candidates),
            ]
        )


# ---------------------------------------------------------------------------------------------
# The explorer.

Files = dict[str, bytes]
Executor = Callable[[Callable[[], CommandResult[Any]]], Awaitable[CommandResult[Any]]]


def _inline() -> Executor:
    """``commands.executor`` without its thread: the same refusal handling, in the caller."""

    async def execute(body: Callable[[], CommandResult[Any]]) -> CommandResult[Any]:
        result: CommandResult[Any] = guarded(body)
        return result

    return execute


def _choices(values: dict[str, list[Any]], needs: list[str]) -> list[dict[str, Any]]:
    """Every way to fill ``needs`` from a command's field domains; none when one has none."""
    options = [values.get(name, []) for name in needs]
    return [dict(zip(needs, combo, strict=True)) for combo in itertools.product(*options)]


class Explorer:
    """One fixture world: its states by fingerprint and its transitions, each call made once.

    ``depth`` bounds the breadth-first exploration: the states within ``depth - 1`` calls of
    the fixture's are expanded, every action of their domain called from each.
    """

    def __init__(
        self, name: str, fixture: dict[str, Any], workdir: Path, target: Path, *, depth: int = 2
    ) -> None:
        self.name, self.depth = name, depth
        self.snapshots: dict[str, Files] = {}
        self.domains: dict[str, Domain] = {}
        self.edges: dict[tuple[str, Action], Transition] = {}
        self.expanded: dict[str, list[Transition]] = {}  # The explored graph.
        self.calls = 0
        # By goal: True for a live explored state, False for a dead one.
        self._live: dict[Goal, dict[str, bool]] = {}
        self._run = workdir / "run"
        self._run.mkdir(parents=True)
        open_run(self._run / "world.json", self._run / "state", fixture)
        self._current: str | None = None
        self._disk: dict[str, tuple[tuple[int, int, int], bytes]] = {}
        self._fingerprints: dict[tuple[tuple[str, bytes], ...], str] = {}
        self._met: dict[tuple[str, Goal], bool] = {}
        self.start = self._capture()
        # One host for the whole world: its world reads ``self._fixture.data``, which _restore
        # replaces, and it reads the lane state from disk on every call. Its commands run their
        # bodies in a thread to keep an MCP host's loop free; nothing else runs here, and a
        # thread per call makes each one several times slower.
        self._fixture = FixtureWorld(self._run / "world.json")
        with (
            mock.patch.object(commands, "executor", _inline),
            mock.patch.object(lane_commands, "executor", _inline),
        ):
            self._host = build_factory_host(
                "factory",
                ExecutionContext(target, profile="trusted-local"),
                world=self._fixture.world(),
                state_base=self._run / "state",
            )

    # One call.

    def _read(self) -> Files:
        """The run's files, read again only where size, time or inode changed."""
        files: Files = {}
        prefix, folders = len(str(self._run)) + 1, [str(self._run)]
        while folders:
            with os.scandir(folders.pop()) as entries:
                for entry in entries:
                    if entry.is_dir():
                        folders.append(entry.path)
                        continue
                    stat = entry.stat()
                    mark = (stat.st_size, stat.st_mtime_ns, stat.st_ino)
                    path = entry.path[prefix:].replace(os.sep, "/")
                    cached = self._disk.get(path)
                    if cached is None or cached[0] != mark:
                        cached = (mark, Path(entry.path).read_bytes())
                        self._disk[path] = cached
                    files[path] = cached[1]
        for gone in set(self._disk) - set(files):
            del self._disk[gone]
        return dict(sorted(files.items()))

    def _capture(self) -> str:
        """The run's state now. The files are that state's snapshot exactly (so the next call
        from it needs no restore) unless only what the fingerprint leaves out differs."""
        files = self._read()
        situation = tuple((p, data) for p, data in files.items() if not p.endswith(GROWING_FILES))
        key = self._fingerprints.get(situation)
        if key is None:
            key = self._fingerprints[situation] = fingerprint(files)
        if key not in self.snapshots:
            self.snapshots[key] = files
            self.domains[key] = domain(files)
        self._current = key if self.snapshots[key] == files else None
        return key

    def _restore(self, key: str) -> None:
        """Put back the files of ``key``'s snapshot that differ from the run's."""
        if self._current != key:
            snapshot = self.snapshots[key]
            for path in set(self._disk) - set(snapshot):
                (self._run / path).unlink()
                del self._disk[path]
            for path, data in snapshot.items():
                if path not in self._disk or self._disk[path][1] != data:
                    (self._run / path).parent.mkdir(parents=True, exist_ok=True)
                    (self._run / path).write_bytes(data)
                    self._disk.pop(path, None)
            self._current = key
        self._fixture.data = json.loads(self.snapshots[key]["world.json"])

    async def step(self, state: str, action: Action) -> Transition:
        """Call ``action`` from ``state``, once: its outcome and the state it leaves."""
        known = self.edges.get((state, action))
        if known is not None:
            return known
        self._restore(state)
        result = await self._host.execute(action.command.replace("-", "_"), action.arguments)
        self.calls += 1
        outcome = Outcome(True)
        if not result.success:
            assert result.error is not None
            recovery = result.error.recovery
            dumped = (
                recovery.model_dump(mode="json", by_alias=True, exclude_none=True)
                if recovery
                else None
            )
            outcome = Outcome(
                False, result.error.code, json.dumps(dumped, sort_keys=True) if dumped else None
            )
        transition = Transition(state, action, outcome, self._capture())
        self.edges[(state, action)] = transition
        return transition

    async def expand(self, state: str) -> list[Transition]:
        if state not in self.expanded:
            self.expanded[state] = [await self.step(state, a) for a in self.domains[state].actions]
        return self.expanded[state]

    async def explore(self) -> list[Transition]:
        """Breadth-first: every transition from the states within ``depth - 1`` calls."""
        seen, frontier, found = {self.start}, [self.start], []
        for _ in range(self.depth):
            following = []
            for state in frontier:
                for transition in await self.expand(state):
                    found.append(transition)
                    if transition.next not in seen:
                        seen.add(transition.next)
                        following.append(transition.next)
            frontier = following
        return found

    # Can the goal still succeed?

    async def _met_from(self, state: str, goal: Goal) -> bool:
        """Whether one of the goal's calls succeeds from ``state`` itself (asked once)."""
        key = (state, goal)
        if key not in self._met:
            if goal.input is not None:
                tries = [Action(goal.command, goal.input)]
            else:
                domain = self.domains[state]
                tries = [
                    a
                    for a in domain.actions
                    if a.command == goal.command and a not in domain.probes
                ]
            met = False
            for action in tries:
                if goal.met(await self.step(state, action)):
                    met = True
                    break
            self._met[key] = met
        return self._met[key]

    async def live(self, state: str, goal: Goal) -> bool:
        """Whether ``goal`` can still succeed from ``state`` within the depth explored.

        ``state`` is live when it is in the set, closed backward from success, of explored
        states from which one of the goal's calls succeeds, either from the state itself or
        from a leaf one of its transitions reaches (a state the depth left unexpanded, whose
        own calls are tried but not followed further), after transitions through explored
        states. It is searched forward from ``state``, which visits only what it reaches. A
        state outside the graph is live only when the goal succeeds from it at once."""
        if state not in self.expanded:
            return await self._met_from(state, goal)
        known = self._live.setdefault(goal, {})
        if state in known:
            return known[state]
        # The explored states it reaches first, whose own goal calls are mostly made already;
        # then the leaves they reach, which cost new calls.
        reached, queue, leaves = {state}, [state], []
        while queue:
            current = queue.pop(0)
            if known.get(current) is False:
                continue  # Nothing it reaches is live.
            if known.get(current) or await self._met_from(current, goal):
                known[current] = known[state] = True
                return True
            for transition in self.expanded[current]:
                after = transition.next
                if after in self.expanded:
                    if after not in reached:
                        reached.add(after)
                        queue.append(after)
                elif after not in leaves:
                    leaves.append(after)
        for leaf in leaves:
            if await self._met_from(leaf, goal):
                known[state] = True
                return True
        for visited in reached:  # All they reach was searched: none is live.
            known[visited] = False
        return False

    # Following a recovery.

    def _parameters(self, command: str) -> set[str] | None:
        """The inputs ``command`` takes, or None when the host does not serve it."""
        served = self._host.resolve(command)
        if served is None:
            return None
        return set(inspect.signature(self._host.handler(served)).parameters)

    def _malformed(self, refusal: Transition, recovery: dict[str, Any]) -> str:
        """Why the recovery cannot be followed as written, or "" when it can: rule 3 (no field
        both in ``input`` and in ``needs``, as both AFD runners check), and every field one its
        command takes."""
        given, needs = recovery.get("input", {}), recovery.get("needs", [])
        both = sorted(set(given) & set(needs))
        if both:
            return f"names {', '.join(both)} in both input and needs (spec/recovery.md rule 3)"
        call = recovery["kind"] == "call"
        command = recovery["command"] if call else refusal.action.command
        parameters = self._parameters(command)
        if parameters is None:
            return f"calls {command}, which the host does not serve"
        unknown = sorted((set(given) | set(needs)) - parameters)
        if unknown:
            return f"{command} takes no {', '.join(unknown)}"
        return ""

    def _ways(self, refusal: Transition, recovery: dict[str, Any]) -> list[tuple[Action, bool]]:
        """Each way to follow: the call to make and whether the refused call is repeated."""
        given, needs = recovery.get("input", {}), recovery.get("needs", [])
        fields = self.domains[refusal.state].fields
        if recovery["kind"] == "call":
            command = recovery["command"]
            then_retry = bool(recovery.get("thenRetry"))
            return [
                (Action.of(command, {**given, **choice}), then_retry)
                for choice in _choices(fields.get(command, {}), needs)
            ]
        command, before = refusal.action.command, refusal.action.arguments
        return [
            (Action.of(command, {**before, **given, **choice}), False)
            for choice in _choices(fields.get(command, {}), needs)
        ]

    async def _take(
        self, refusal: Transition, kind: str, follow: Action, then_retry: bool
    ) -> tuple[Transition, str]:
        """Follow one way: the last call made, and why the way is not enabled ("" if it is).

        A ``call`` recovery's call succeeds and, with ``thenRetry``, so does the repeated call,
        as the runners expect by default. A call made again (``fix-input``, ``retry``) must only
        not come back with the same refusal, more leniently than the runners (module docstring)."""
        made = await self.step(refusal.state, follow)
        if kind == "call":
            if not made.outcome.success:
                return made, f"its call {follow} refused {made.outcome.code}"
            if not then_retry:
                return made, ""
            made = await self.step(made.next, refusal.action)
            if made.outcome.same_refusal(refusal.outcome):
                return made, f"{made.action} came back with the same {refusal.outcome.code}"
            if not made.outcome.success:
                return made, f"the repeated {refusal.action} refused {made.outcome.code}"
            return made, ""
        if made.outcome.same_refusal(refusal.outcome):
            return made, f"{made.action} came back with the same {refusal.outcome.code}"
        return made, ""

    async def judge(self, refusal: Transition) -> Finding:
        """Follow a refusal's recovery each way its ``needs`` allow; one way that is enabled
        and leads back is enough."""
        assert refusal.outcome.recovery is not None and refusal.outcome.code is not None
        recovery = json.loads(refusal.outcome.recovery)
        kind = recovery["kind"]
        finding = Finding(self.name, refusal.action, refusal.outcome.code, refusal.outcome.recovery)
        malformed = self._malformed(refusal, recovery)
        if malformed:
            finding.why = malformed
            return finding
        ways = self._ways(refusal, recovery)
        if not ways:
            finding.verdict = "out-of-reach"
            finding.why = "no value here for " + ", ".join(recovery.get("needs", []))
            return finding
        taken, disabled = [], []
        for follow, then_retry in ways:
            finding.follows += 1
            made, why = await self._take(refusal, kind, follow, then_retry)
            if why:
                disabled.append(why)
                continue
            if kind == "call" and not then_retry:
                goal = Goal(refusal.action.command, None)
            else:
                goal = Goal(refusal.action.command, made.action.input)
            if goal.met(made) or await self.live(made.next, goal):
                finding.verdict = "ok"
                finding.why = f"{follow}: {goal.command} succeeds"
                return finding
            taken.append((follow, made, goal))
        if not taken:
            finding.why = "; ".join(disabled[:2]) + (" ..." if len(disabled) > 2 else "")
            return finding
        could = [(f, m, g) for f, m, g in taken if await self.live(refusal.state, g)]
        if not could:
            finding.verdict = "out-of-reach"
            finding.why = f"{taken[0][2].command} cannot succeed from this state within the bound"
            return finding
        follow, made, goal = could[0]
        if kind != "call" and made.next not in self.expanded:
            # The call made again left the explored graph: nothing is left to judge it by.
            finding.verdict = "out-of-reach"
            finding.why = f"{follow} left the explored states"
            return finding
        finding.why = f"after {follow}, {goal.command} can no longer succeed, as it could"
        return finding

    async def stop_succeeds_after(self, refusal: Transition) -> Action | None:
        """For a ``stop``: one other call after which the refused call succeeds, if any."""
        for transition in await self.expand(refusal.state):
            if transition.next != refusal.state:
                retried = await self.step(transition.next, refusal.action)
                if retried.outcome.success:
                    return transition.action
        return None


async def explore_worlds(
    worlds: dict[str, dict[str, Any]], scratch: Path, target: Path, *, depth: int = 2
) -> Report:
    """Explore each world (a fixture merged over its base) and judge every refusal met."""
    report = Report(worlds=list(worlds))
    for name, fixture in worlds.items():
        explorer = Explorer(name, copy.deepcopy(fixture), scratch / name, target, depth=depth)
        explored = await explorer.explore()
        stops: set[tuple[str, str]] = set()
        for transition in explored:
            outcome = transition.outcome
            if outcome.success:
                continue
            kind = outcome.kind or "none"
            key = (outcome.code or "?", kind)
            report.refusals[key] = report.refusals.get(key, 0) + 1
            if kind in ("call", "fix-input", "retry"):
                report.findings.append(await explorer.judge(transition))
            elif kind == "none":
                report.findings.append(
                    Finding(name, transition.action, key[0], "", why="no recovery")
                )
            elif kind == "stop" and (transition.action.command, key[0]) not in stops:
                # The first refusal of each command and code in a world: a list for review.
                stops.add((transition.action.command, key[0]))
                other = await explorer.stop_succeeds_after(transition)
                if other is not None:
                    report.stop_candidates.append(
                        f"[{name}] {transition.action} -> {key[0]} succeeds after {other}"
                    )
        report.called.update(action for _, action in explorer.edges)
        report.states += len(explorer.snapshots)
        report.transitions += len(explorer.edges)
        report.explored += len(explored)
        report.calls += explorer.calls
    return report
