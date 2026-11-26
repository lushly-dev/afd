"""Shared fixtures: scenario fixtures as fixture worlds, and factory hosts over them.

Nothing here reaches GitHub, git remotes or T3 Code: every host is built over a FixtureWorld.
The target repository is the example repository the job fixtures describe: the adapter in
``scenarios/repository/botcore.toml`` with AFD's own ``.github/labels.json``, as run.mjs builds it.
"""

from __future__ import annotations

import dataclasses
import json
import os
import shutil
import tempfile
import tomllib
from pathlib import Path

import pytest
from botcore.context import ExecutionContext
from private_temp import private_temp

from botcore_factory.adapter import FactoryConfig
from botcore_factory.fixture_world import FixtureWorld, deep_merge, load_fixture, open_run
from botcore_factory.hosts import build_factory_host
from botcore_factory.runtime import Factory

REPO_ROOT = Path(__file__).resolve().parents[5]
SCENARIOS = REPO_ROOT / "docs/features/active/software-factory/scenarios"
FIXTURES = SCENARIOS / "fixtures"
EXAMPLE = Path(__file__).resolve().parents[1] / "scenarios" / "repository"
#: The foreman session tests hold the lane with (``Run.take_lane``).
FOREMAN = "thread-foreman"


def pytest_configure(config: pytest.Config) -> None:
    """On Windows, move ``tmp_path`` off a ``%TEMP%`` the token store refuses (#2696)."""
    if os.name != "nt" or config.option.basetemp or os.environ.get("PYTEST_DEBUG_TEMPROOT"):
        return  # pytest does not read tempfile then.
    from botcore._windows_security import ensure_directory

    # Resolved as pytest resolves its temporary root, so a junction is checked where it leads.
    system_temp, home = Path(tempfile.gettempdir()).resolve(), Path.home().resolve()
    private = private_temp(system_temp, home, ensure_directory)
    if private is not None:
        tempfile.tempdir = str(private)  # pytest reads it lazily, at the first tmp_path.


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

    def factory(self, target: Path | None = None) -> Factory:
        """A Factory over the current world file, as a host's commands get one."""
        root = target or self.target
        config = tomllib.loads((root / "botcore.toml").read_text(encoding="utf-8"))
        return Factory(
            FixtureWorld(self.world_path).world(),
            FactoryConfig(**config["plugins"]["factory"]),
            root,
            self.state_base,
        )

    def change_world(self, **changes) -> None:
        """Merge changes into the world file (outcomes, now, prs...), as the outside changes."""
        data = deep_merge(self.world_data(), changes)
        self.world_path.write_text(json.dumps(data), encoding="utf-8")

    async def call(self, command: str, host=None, **arguments):
        return await (host or self.host()).execute(command, arguments)

    async def take_lane(self, session: str = FOREMAN) -> str:
        """Hold the lane as its foreman, as gate-allow and ejection-excuse need; the session."""
        taken = await self.call("lane_wait", consumer="foreman", timeout_ms=1, session=session)
        assert taken.success, taken.error
        return session

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


def isolate_cargo_configs(monkeypatch: pytest.MonkeyPatch, root: Path) -> None:
    """Confine Cargo config discovery to `root` so host configs above TMPDIR never leak."""
    from botcore.commands.disk import cargo

    resolved = root.resolve()
    real_in_folder = cargo._Configs.in_folder

    def in_root(self: cargo._Configs, cargo_dir: Path) -> Path | None:
        try:
            if not cargo_dir.resolve().is_relative_to(resolved):
                return None
        except OSError:
            return None
        return real_in_folder(self, cargo_dir)

    monkeypatch.setattr(cargo._Configs, "in_folder", in_root)


@pytest.fixture(autouse=True)
def _no_host_cargo_config(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep host Cargo configs out of tests when TMPDIR sits inside $HOME
    (lushly-dev/afd#1954): Cargo's ancestor walk from tmp_path would otherwise reach
    ~/.cargo/config.toml."""
    isolate_cargo_configs(monkeypatch, tmp_path)


@pytest.fixture
def make_run(tmp_path, example_repo):
    counter = iter(range(1000))

    def make(name: str = "fresh", base: str | None = "fresh.json", **overrides) -> Run:
        directory = tmp_path / f"run-{next(counter)}"
        directory.mkdir()
        return Run(directory, fixture(name, base, **overrides), example_repo)

    return make
