"""Shared fixtures: scenario fixtures as fixture worlds, and factory hosts over them.

Nothing here reaches GitHub, git remotes or T3 Code: every host is built over a FixtureWorld.
The target repository is the example repository the job fixtures describe: the adapter in
``scenarios/repository/botcore.toml`` with AFD's own ``.github/labels.json``, as run.mjs builds it.
"""

from __future__ import annotations

import dataclasses
import json
import shutil
from pathlib import Path

import pytest
from botcore.context import ExecutionContext

from botcore_factory.fixture_world import FixtureWorld, load_fixture, open_run
from botcore_factory.hosts import build_factory_host

REPO_ROOT = Path(__file__).resolve().parents[5]
SCENARIOS = REPO_ROOT / "docs/features/proposed/software-factory/scenarios"
FIXTURES = SCENARIOS / "fixtures"
EXAMPLE = Path(__file__).resolve().parents[1] / "scenarios" / "repository"


def example_repository(directory: Path) -> Path:
    """The example repository: its adapter, and AFD's label definitions."""
    (directory / ".github").mkdir(parents=True, exist_ok=True)
    shutil.copyfile(EXAMPLE / "botcore.toml", directory / "botcore.toml")
    shutil.copyfile(REPO_ROOT / ".github/labels.json", directory / ".github/labels.json")
    return directory


def fixture(name: str = "fresh", base: str | None = "fresh.json", **overrides) -> dict:
    """A scenario fixture merged over its base, as AFD's fixture loader merges them."""
    base = None if name == "fresh" else base
    return load_fixture(FIXTURES / f"{name}.json", base, overrides or None)


class Run:
    """One scenario run's world file and lane state, and hosts built over them."""

    def __init__(self, directory: Path, data: dict, target: Path) -> None:
        self.directory = directory
        self.target = target
        self.world_path = directory / "world.json"
        self.state_base = directory / "state"
        self.world, self.store = open_run(self.world_path, self.state_base, data)

    def host(
        self,
        name: str = "factory",
        *,
        target: Path | None = None,
        profile="trusted-local",
        **replace,
    ):
        world = FixtureWorld(self.world_path).world()
        if replace:
            world = dataclasses.replace(world, **replace)
        return build_factory_host(
            name,
            ExecutionContext(target or self.target, profile=profile),
            world=world,
            state_base=self.state_base,
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


@pytest.fixture(scope="session")
def example_repo(tmp_path_factory) -> Path:
    return example_repository(tmp_path_factory.mktemp("example-repo"))


@pytest.fixture
def make_run(tmp_path, example_repo):
    counter = iter(range(1000))

    def make(name: str = "fresh", base: str | None = "fresh.json", **overrides) -> Run:
        directory = tmp_path / f"run-{next(counter)}"
        directory.mkdir()
        return Run(directory, fixture(name, base, **overrides), example_repo)

    return make
