"""The lane state store: its location, lock, atomic writes and append-only log."""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path

import platformdirs
import pytest

from botcore_factory.state import (
    APP_NAME,
    DATA_DIR_ENV,
    StateError,
    StateLocked,
    StateStore,
    default_base,
    empty_state,
    repository_key,
)


class Clock:
    def now(self):
        return datetime(2030, 1, 3, tzinfo=UTC)


class Processes:
    def __init__(self, alive=()):
        self.alive_pids = set(alive)

    def alive(self, pid, started_at=None):
        return pid == os.getpid() or pid in self.alive_pids

    def start_time(self, pid):
        return None

    def run(self, args, cwd, timeout=None):  # pragma: no cover - not used by the store
        raise AssertionError


def store(tmp_path: Path, alive=(), timeout=0.2) -> StateStore:
    return StateStore(tmp_path / "repo", Processes(alive), Clock(), lock_timeout=timeout)


def test_state_lives_in_user_data_keyed_by_repository_unless_overridden(tmp_path):
    assert default_base({}) == Path(platformdirs.user_data_dir(APP_NAME, appauthor=False))
    assert default_base({DATA_DIR_ENV: str(tmp_path)}) == tmp_path
    found = StateStore.for_repository("Owner/Repo.x", Processes(), Clock(), base=tmp_path)
    assert found.root == tmp_path / "owner--repo.x"


@pytest.mark.parametrize("name", ["owner", "a/b/c", "../x", "a/..", "a b/c"])
def test_a_repository_key_needs_owner_and_name(name):
    with pytest.raises(StateError):
        repository_key(name)


def test_an_absent_state_reads_empty_and_writes_nothing(tmp_path):
    lane = store(tmp_path)
    assert lane.read() == empty_state()
    with lane.update("nothing") as state:
        assert state["cells"] == []
    assert not lane.state_path.exists() and lane.read_log() == []


def test_a_change_is_written_whole_and_logged(tmp_path):
    lane = store(tmp_path)
    with lane.update("add a cell") as state:
        state["cells"].append({"branch": "fix/x"})
    assert json.loads(lane.state_path.read_text())["cells"] == [{"branch": "fix/x"}]
    assert lane.read()["lane"]["running"] is False  # Defaults fill what the file leaves out.
    assert [entry["reason"] for entry in lane.read_log()] == ["add a cell"]
    assert lane.read_log()[0]["at"] == "2030-01-03T00:00:00Z"
    assert not list(lane.root.glob("*.tmp")) and not lane.lock_path.exists()


def test_the_log_only_grows(tmp_path):
    lane = store(tmp_path)
    lane.log({"kind": "one"})
    lane.log({"kind": "two"})
    assert [entry["kind"] for entry in lane.read_log()] == ["one", "two"]


def test_an_exception_inside_an_update_writes_nothing_and_releases_the_lock(tmp_path):
    lane = store(tmp_path)
    with pytest.raises(RuntimeError), lane.update("fails") as state:
        state["cells"].append({"branch": "fix/x"})
        raise RuntimeError("refused")
    assert not lane.state_path.exists() and not lane.lock_path.exists()


def test_a_live_holder_keeps_the_lock(tmp_path):
    lane = store(tmp_path, alive={4242})
    lane.root.mkdir(parents=True)
    lane.lock_path.write_text(json.dumps({"pid": 4242, "startedAt": None}))
    with pytest.raises(StateLocked, match="4242"), lane.update("blocked"):
        pass
    assert lane.lock_path.exists()


def test_a_dead_holder_s_lock_is_broken_and_logged(tmp_path):
    lane = store(tmp_path)
    lane.root.mkdir(parents=True)
    lane.lock_path.write_text(json.dumps({"pid": 4242, "startedAt": 1.0}))
    with lane.update("after a crash") as state:
        state["dials"]["cells.max"] = 2
    assert lane.read()["dials"] == {"cells.max": 2}
    kinds = [entry["kind"] for entry in lane.read_log()]
    assert kinds == ["lock-broken", "state"]


def test_an_old_empty_lock_is_stale(tmp_path):
    lane = store(tmp_path)
    lane.root.mkdir(parents=True)
    lane.lock_path.write_text("")
    os.utime(lane.lock_path, (1, 1))
    with lane.update("go") as state:
        state["runs"].append({"id": "run-1"})
    assert lane.read()["runs"] == [{"id": "run-1"}]


def test_a_fresh_empty_lock_is_waited_for(tmp_path):
    lane = store(tmp_path)
    lane.root.mkdir(parents=True)
    lane.lock_path.write_text("")
    with pytest.raises(StateLocked), lane.update("blocked"):
        pass


@pytest.mark.parametrize("text", ["{", "[]", '{"version": 99}'])
def test_an_unreadable_state_is_an_error_never_an_empty_state(tmp_path, text):
    lane = store(tmp_path)
    lane.root.mkdir(parents=True)
    lane.state_path.write_text(text)
    with pytest.raises(StateError):
        lane.read()
