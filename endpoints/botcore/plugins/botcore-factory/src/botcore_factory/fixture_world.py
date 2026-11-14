"""A world read from a software-factory scenario fixture, persisting its writes.

The fixture format is the one in ``docs/features/proposed/software-factory/scenarios/fixtures``
(``fresh.json`` is every fixture's base). ``split_fixture`` separates what is outside the lane
(GitHub, git, the clock, the machine, plans) from the lane's own state, which the harness seeds
into a ``StateStore``. ``FixtureWorld`` keeps the outside part in one JSON file and rewrites it
after every write, so a sequence of separate CLI processes sees one consistent world.

Claims are converted into claim comments when the world is created, so the plugin reads them
the way it reads GitHub. Nothing here calls GitHub, git, T3 Code or the operating system.
"""

from __future__ import annotations

import copy
import json
import os
from pathlib import Path

from botcore_factory import records
from botcore_factory.claims import Claim, claim_body
from botcore_factory.fixture_parts import (
    FixtureClock,
    FixtureGit,
    FixtureGitHub,
    FixtureMachine,
    FixturePlans,
    FixtureProcesses,
)
from botcore_factory.world import World, WorldError

#: Fixture keys the world answers for; the rest of a fixture is the lane's own state.
WORLD_KEYS = frozenset(
    {
        "repository",
        "issues",
        "claims",
        "laneHost",
        "requiredCheckOnMain",
        "now",
        "thisMachine",
        "host",
        "machines",
        "plans",
        "worktrees",
        "originQueueRefs",
        "processes",
        "pullRequests",
        "variables",
        "plansUnreadable",
        "toolchains",
        "requiredChecks",
        "outcomes",
        "main",
        "prs",
        "nextPr",
        "pushed",
        "checkouts",
    }
)
STATE_KEYS = frozenset(
    {
        "lane",
        "cells",
        "queue",
        "held",
        "events",
        "runs",
        "dials",
        "baseline",
        "review",
        "window",
        "experiments",
        "watching",
        "slots",
    }
)
IGNORED_KEYS = frozenset({"$schema", "app", "description", "version"})


def deep_merge(base: dict, override: dict) -> dict:
    """Merge as AFD's fixture loader does: objects recursively, arrays and values replaced."""
    result = copy.deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = copy.deepcopy(value)
    return result


def load_fixture(path: Path, base: str | None = None, overrides: dict | None = None) -> dict:
    """A fixture file merged over its base (relative to the fixture's directory), then overrides."""
    data = json.loads(path.read_text(encoding="utf-8"))
    if base:
        data = deep_merge(json.loads((path.parent / base).read_text(encoding="utf-8")), data)
    return deep_merge(data, overrides or {})


def split_fixture(fixture: dict) -> tuple[dict, dict]:
    """The world part and the lane-state part of a fixture. Unknown keys are refused."""
    unknown = set(fixture) - WORLD_KEYS - STATE_KEYS - IGNORED_KEYS
    if unknown:
        raise ValueError(f"Fixture keys neither world nor lane state: {', '.join(sorted(unknown))}")
    world = {key: copy.deepcopy(value) for key, value in fixture.items() if key in WORLD_KEYS}
    state = {key: copy.deepcopy(value) for key, value in fixture.items() if key in STATE_KEYS}
    return world, state


def normalize_world(data: dict) -> dict:
    """Turn fixture ``claims`` into claim comments on their issues; idempotent."""
    data = copy.deepcopy(data)
    issues = {issue["number"]: issue for issue in data.get("issues", [])}
    for claim in data.pop("claims", []):
        issue = issues.get(claim["number"])
        if issue is None:
            raise ValueError(f"Claim on #{claim['number']}, which the fixture does not list")
        body = claim_body(Claim(claim["branch"], claim["machine"], claim["leaseUntil"]))
        issue.setdefault("comments", []).append({"body": body, "author": "factory"})
    for issue in data.get("issues", []):
        comments = issue.setdefault("comments", [])
        for field, author in (("question", "factory"), ("ownerReply", "owner")):
            if field in issue:
                comments.append({"body": issue.pop(field), "author": author})
        for index, comment in enumerate(comments, 1):
            comment.setdefault("id", f"{issue['number']}-{index}")
    return data


def open_run(world_path: Path, state_base: Path, fixture: dict) -> tuple[World, object]:
    """Start a scenario run: write its world and seed its lane state from a merged fixture.

    The lane-state part replaces the empty state. A fixture worktree's ``ejectedFor`` (the cause
    the lane ejected that branch for) becomes the ``ejected`` record the lane would have
    written. Returns the world and the run's StateStore.
    """
    from botcore_factory.state import LANE_DEFAULTS, StateStore

    world_part, state_part = split_fixture(fixture)
    world = FixtureWorld.create(world_path, world_part).world()
    store = StateStore.for_repository(
        world.github.repository(), world.processes, world.clock, base=state_base
    )
    with store.update("fixture") as state:
        state.update(state_part)
        state["lane"] = {**LANE_DEFAULTS, **state_part.get("lane", {})}
    cells = {cell["branch"]: cell for cell in state_part.get("cells", [])}
    at = world.clock.now().isoformat().replace("+00:00", "Z")
    for worktree in world_part.get("worktrees", {}).values():
        if worktree.get("ejectedFor"):
            branch = worktree["branch"]
            attempt = max(1, cells.get(branch, {}).get("ejections", 1))
            run_id = state_part.get("lane", {}).get("runId")
            store.append_record(
                records.make(
                    "ejected",
                    at,
                    run_id,
                    branch=branch,
                    attempt=attempt,
                    cause=worktree["ejectedFor"],
                )
            )
    if state_part.get("lane", {}).get("running"):
        _seed_running_lane(world_path, store)
    return world, store


#: The pid a fixture's running lane has: alive in the fixture world, holding the host lock.
FIXTURE_LANE_PID = 4_000_000


def _seed_running_lane(world_path: Path, store) -> None:
    """A fixture that says the lane runs gets a live lane process holding the host lock."""
    fixture = FixtureWorld(world_path)
    processes = fixture.data.setdefault("processes", {})
    processes.setdefault("alive", []).append(FIXTURE_LANE_PID)
    fixture.save()
    lock = store.root.parent / "lane.lock"
    lock.parent.mkdir(parents=True, exist_ok=True)
    repository = fixture.data.get("repository") or "example-org/example-repo"
    lock.write_text(
        json.dumps({"pid": FIXTURE_LANE_PID, "startedAt": None, "repository": repository}),
        encoding="utf-8",
    )
    with store.update("fixture lane") as state:
        state["lane"]["pid"] = FIXTURE_LANE_PID


class FixtureWorld:
    """The world of one scenario run, stored in ``path``."""

    def __init__(self, path: Path) -> None:
        self.path = path
        try:
            self.data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise WorldError(f"Cannot read the fixture world {path}: {exc}") from exc

    @classmethod
    def create(cls, path: Path, world: dict) -> FixtureWorld:
        """Write a world from a fixture's world part and open it."""
        path.parent.mkdir(parents=True, exist_ok=True)
        _write(path, normalize_world(world))
        return cls(path)

    def save(self) -> None:
        _write(self.path, self.data)

    def world(self) -> World:
        return World(
            github=FixtureGitHub(self),
            git=FixtureGit(self),
            clock=FixtureClock(self),
            machine=FixtureMachine(self),
            plans=FixturePlans(self),
            processes=FixtureProcesses(self),
        )

    def issue_data(self, number: int) -> dict:
        for issue in self.data.get("issues", []):
            if issue["number"] == number:
                return issue
        raise WorldError(f"Issue #{number} not found")

    def this_machine(self) -> dict:
        machine_id = self.data.get("thisMachine") or "workstation"
        for record in self.data.get("machines", []):
            if record.get("id") == machine_id:
                return record
        return {"id": machine_id}


def _write(path: Path, data: dict) -> None:
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, path)
