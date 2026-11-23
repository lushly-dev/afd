"""move_default_memory: copies the local user's default memory to a principal, safely."""

from __future__ import annotations

import json

import pytest
from afd import Actor
from afd.core.commands import CommandContext
from afd.testing import assert_error, assert_success
from botcore.context import use_call

from botcore_memory import commands
from botcore_memory.commands import memory_set
from botcore_memory.migrate import move_default_memory

pytestmark = pytest.mark.usefixtures("no_direct_caller")

TARGET = "agent_researcher"


def store_file(tmp_path, scope_id: str):
    return tmp_path / "agent" / f"{scope_id}.json"


def read(path) -> dict:
    return json.loads(path.read_text())


async def seed(tmp_path) -> dict:
    await memory_set(key="a", value="1", tags=["x"])
    await memory_set(key="b", value="2")
    data = read(store_file(tmp_path, "default"))
    data["a"]["ttl"] = 3600
    store_file(tmp_path, "default").write_text(json.dumps(data))
    return data


async def test_copies_every_field_backs_up_and_leaves_default_in_place(tmp_path):
    original = await seed(tmp_path)

    moved = await move_default_memory(TARGET, backup_dir=tmp_path / "bk")

    assert_success(moved)
    assert moved.data["moved"] == 2 and moved.data["verified"] is True
    copied = read(store_file(tmp_path, TARGET))
    for key, entry in original.items():
        assert copied[key] == {**entry, "scope_id": TARGET}  # id, created_at, ttl kept
    assert read(store_file(tmp_path, "default")) == original
    assert read(tmp_path / "bk" / "agent" / "default.json") == original
    assert moved.data["backup"] == [str(tmp_path / "bk" / "agent" / "default.json")]


async def test_a_key_already_under_the_target_is_refused_before_writing(tmp_path, set_agent):
    original = await seed(tmp_path)
    set_agent(TARGET)
    await memory_set(key="b", value="theirs")
    set_agent("")
    before = read(store_file(tmp_path, TARGET))

    refused = await move_default_memory(TARGET, backup_dir=tmp_path / "bk")

    assert_error(refused, "MEMORY_MOVE_CONFLICT")
    assert refused.error.details["conflicts"] == ["b"]
    assert read(store_file(tmp_path, TARGET)) == before
    assert read(store_file(tmp_path, "default")) == original
    assert len(refused.error.details["backup"]) == 2


async def test_a_rerun_after_an_interrupted_move_completes_it(tmp_path):
    original = await seed(tmp_path)
    # An earlier run wrote "a" to the target, then stopped before "b".
    partial = {"a": {**original["a"], "scope_id": TARGET}}
    store_file(tmp_path, TARGET).write_text(json.dumps(partial))

    rerun = await move_default_memory(TARGET, backup_dir=tmp_path / "bk")

    assert_success(rerun)
    assert (rerun.data["moved"], rerun.data["already_moved"]) == (1, 1)
    copied = read(store_file(tmp_path, TARGET))
    assert copied == {key: {**entry, "scope_id": TARGET} for key, entry in original.items()}
    assert read(tmp_path / "bk" / "agent" / f"{TARGET}.json") == partial


async def test_the_target_is_written_once_and_a_failed_write_leaves_it(tmp_path, monkeypatch):
    await seed(tmp_path)
    store = commands.get_store()
    writes = []

    def fail(path, data):
        writes.append(dict(data))
        raise OSError("disk full")

    monkeypatch.setattr(store, "_write_file", fail)
    failed = await move_default_memory(TARGET, backup_dir=tmp_path / "bk")

    assert_error(failed, "MEMORY_MOVE_WRITE_FAILED")
    assert [sorted(data) for data in writes] == [["a", "b"]]  # one write, both entries
    assert not store_file(tmp_path, TARGET).exists()
    assert failed.error.details["backup"] == [str(tmp_path / "bk" / "agent" / "default.json")]


async def test_an_entry_that_reads_back_differently_is_unverified(tmp_path, monkeypatch):
    await seed(tmp_path)
    store = commands.get_store()
    real_write = store._write_file

    def alter(path, data):
        real_write(path, {key: {**entry, "value": "changed"} for key, entry in data.items()})

    monkeypatch.setattr(store, "_write_file", alter)
    unverified = await move_default_memory(TARGET, backup_dir=tmp_path / "bk")

    assert_error(unverified, "MEMORY_MOVE_UNVERIFIED")
    assert unverified.error.details["mismatched"] == ["a", "b"]
    assert unverified.error.details["backup"]


async def test_an_unreadable_store_is_reported(tmp_path):
    store_file(tmp_path, "default").parent.mkdir(parents=True)
    store_file(tmp_path, "default").write_text("{not json")

    assert_error(await move_default_memory(TARGET), "MEMORY_MOVE_READ_FAILED")


async def test_a_host_call_is_refused(tmp_path):
    await seed(tmp_path)
    with use_call(CommandContext(actor=Actor(kind="agent", id="researcher"))):
        refused = await move_default_memory(TARGET)
    assert_error(refused, "MEMORY_MOVE_LOCAL_ONLY")
    assert not store_file(tmp_path, TARGET).exists()


@pytest.mark.parametrize("target", ["default", "bad/id", "x\n"])
async def test_an_invalid_target_is_refused(target):
    assert_error(await move_default_memory(target), "MEMORY_INVALID_SCOPE_ID")
