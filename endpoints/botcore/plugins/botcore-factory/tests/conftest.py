"""Shared fixtures: scenario fixtures as fixture worlds, and factory hosts over them.

Nothing here reaches GitHub, git remotes or T3 Code: every host is built over a FixtureWorld.
The target repository is AFD's own checkout, so hosts read AFD's adapter block and labels.
"""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path

import pytest
from botcore.context import ExecutionContext

from botcore_factory.fixture_world import FixtureWorld, load_fixture, split_fixture
from botcore_factory.hosts import build_factory_host
from botcore_factory.state import LANE_DEFAULTS, StateStore

REPO_ROOT = Path(__file__).resolve().parents[5]
SCENARIOS = REPO_ROOT / "docs/features/proposed/software-factory/scenarios"
FIXTURES = SCENARIOS / "fixtures"


def fixture(name: str = "fresh", base: str | None = "fresh.json", **overrides) -> dict:
    """A scenario fixture merged over its base, as AFD's fixture loader merges them."""
    base = None if name == "fresh" else base
    return load_fixture(FIXTURES / f"{name}.json", base, overrides or None)


class Run:
    """One scenario run's world file and lane state, and hosts built over them."""

    def __init__(self, directory: Path, data: dict) -> None:
        self.directory = directory
        self.world_path = directory / "world.json"
        self.state_base = directory / "state"
        world_part, state_part = split_fixture(data)
        self.fixture_world = FixtureWorld.create(self.world_path, world_part)
        self.world = self.fixture_world.world()
        self.store = StateStore.for_repository(
            self.world.github.repository(),
            self.world.processes,
            self.world.clock,
            base=self.state_base,
        )
        with self.store.update("seed") as state:
            state.update(state_part)
            state["lane"] = {**LANE_DEFAULTS, **state_part.get("lane", {})}

    def host(
        self, name: str = "factory", *, target: Path = REPO_ROOT, profile="trusted-local", **replace
    ):
        world = FixtureWorld(self.world_path).world()
        if replace:
            world = dataclasses.replace(world, **replace)
        return build_factory_host(
            name, ExecutionContext(target, profile=profile), world=world, state_base=self.state_base
        )

    async def call(self, command: str, host=None, **arguments):
        return await (host or self.host()).execute(command, arguments)

    def world_data(self) -> dict:
        return json.loads(self.world_path.read_text(encoding="utf-8"))

    def state(self) -> dict:
        return self.store.read()

    def snapshot(self) -> tuple[str, str, list]:
        """Everything a command could write: the world, the state and the log."""
        state_file = self.store.state_path
        return (
            self.world_path.read_text(encoding="utf-8"),
            state_file.read_text(encoding="utf-8") if state_file.exists() else "",
            self.store.read_log(),
        )


@pytest.fixture
def make_run(tmp_path):
    counter = iter(range(1000))

    def make(name: str = "fresh", base: str | None = "fresh.json", **overrides) -> Run:
        directory = tmp_path / f"run-{next(counter)}"
        directory.mkdir()
        return Run(directory, fixture(name, base, **overrides))

    return make
