"""Principal ids: how a host caller becomes an agent-scope id, and the local user."""

from __future__ import annotations

import json

import pytest
from afd import Actor
from afd.core.commands import CommandContext
from afd.testing import assert_error, assert_success

from botcore_memory.access import DEFAULT_PRINCIPAL, principal_id
from botcore_memory.commands import memory_get, memory_list, memory_set
from botcore_memory.models import validate_key, validate_scope_id

pytestmark = pytest.mark.usefixtures("no_direct_caller")


class TestPrincipalId:
    def test_lowercase_id_stays_readable_with_its_kind(self):
        assert principal_id(Actor(kind="agent", id="researcher")) == "agent_researcher"
        assert principal_id(Actor(kind="agent", id="cell-3")) == "agent_cell-3"

    def test_kinds_keep_the_same_id_apart(self):
        assert principal_id(Actor(kind="human", id="alex")) != principal_id(
            Actor(kind="agent", id="alex")
        )

    @pytest.mark.parametrize("ident", ["Alex", "lane@random", "a/../b", "x" * 200, "sp ace", "ü"])
    def test_other_ids_map_to_a_valid_distinct_lowercase_scope_id(self, ident):
        principal = principal_id(Actor(kind="service", id=ident))
        assert principal.startswith("service-")
        assert principal == principal.lower()
        assert validate_scope_id(principal) is None
        assert principal != principal_id(Actor(kind="service", id=ident + "!"))

    def test_ids_differing_only_by_case_are_distinct_even_folded(self):
        upper = principal_id(Actor(kind="agent", id="Alex"))
        lower = principal_id(Actor(kind="agent", id="alex"))
        assert upper.casefold() != lower.casefold()

    @pytest.mark.parametrize("actor", [None, Actor(kind="agent"), Actor(kind="agent", id="")])
    def test_an_actor_without_an_id_names_no_one(self, actor):
        assert principal_id(actor) is None


async def test_ids_differing_only_by_case_keep_separate_stores(memory_host, tmp_path):
    host = memory_host()
    upper = CommandContext(actor=Actor(kind="agent", id="Alex"))
    lower = CommandContext(actor=Actor(kind="agent", id="alex"))

    assert_success(await host.execute("memory_set", {"key": "k", "value": "upper"}, upper))
    assert_error(await host.execute("memory_get", {"key": "k"}, lower), "MEMORY_NOT_FOUND")
    assert_success(await host.execute("memory_set", {"key": "k", "value": "lower"}, lower))

    assert (await host.execute("memory_get", {"key": "k"}, upper)).data["value"] == "upper"
    assert (await host.execute("memory_get", {"key": "k"}, lower)).data["value"] == "lower"
    names = sorted(path.name.casefold() for path in (tmp_path / "agent").iterdir())
    assert len(names) == len(set(names)) == 2


async def test_a_managed_call_on_a_botcore_without_call_contexts_is_refused(monkeypatch, tmp_path):
    import botcore.context
    from botcore.context import ExecutionContext, use_context

    monkeypatch.delattr(botcore.context, "current_call")
    with use_context(ExecutionContext(tmp_path)):
        refused = await memory_set(key="k", value="v")
    assert_error(refused, "MEMORY_PRINCIPAL_UNKNOWN")
    assert "0.8.0" in refused.error.suggestion
    # Outside a managed call it is still the local user.
    assert_success(await memory_set(key="k", value="v"))


@pytest.mark.parametrize("value", ["default\n", "a\n"])
def test_a_trailing_newline_is_refused(value):
    assert validate_scope_id(value) is not None
    assert validate_key(value) is not None


class TestLocalPath:
    async def test_a_direct_call_is_the_single_local_user(self):
        stored = await memory_set(key="note", value="mine")
        assert stored.data["scope_id"] == DEFAULT_PRINCIPAL
        assert (await memory_get(key="note")).data["value"] == "mine"
        listed = await memory_list()
        assert [entry["key"] for entry in listed.data["entries"]] == ["note"]

    async def test_existing_default_memory_stays_readable_locally(self, tmp_path):
        agent_dir = tmp_path / "agent"
        agent_dir.mkdir()
        entry = {"id": "mem_old", "scope": "agent", "scope_id": "default", "key": "old"}
        (agent_dir / "default.json").write_text(json.dumps({"old": {**entry, "value": "kept"}}))

        assert (await memory_get(key="old")).data["value"] == "kept"
