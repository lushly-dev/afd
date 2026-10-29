"""Tests for scope-based access control."""

from __future__ import annotations

from afd.testing import assert_error, assert_success

from botcore_memory.access import check_scope_access, current_agent, resolve_scope_id
from botcore_memory.commands import memory_get, memory_search, memory_set


class TestCheckScopeAccess:
    def test_agent_scope_own_memory_allowed(self):
        err = check_scope_access("bot-1", "agent", "bot-1", "read")
        assert err is None
        err = check_scope_access("bot-1", "agent", "bot-1", "write")
        assert err is None

    def test_agent_scope_other_agent_denied(self):
        err = check_scope_access("bot-1", "agent", "bot-2", "read")
        assert err is not None
        assert err.code == "MEMORY_ACCESS_DENIED"

        err = check_scope_access("bot-1", "agent", "bot-2", "write")
        assert err is not None
        assert err.code == "MEMORY_ACCESS_DENIED"

    def test_team_scope_allowed_for_all(self):
        err = check_scope_access("bot-1", "team", "team-alpha", "read")
        assert err is None
        err = check_scope_access("bot-1", "team", "team-alpha", "write")
        assert err is None

    def test_task_scope_allowed_for_all(self):
        err = check_scope_access("bot-1", "task", "task-42", "read")
        assert err is None
        err = check_scope_access("bot-1", "task", "task-42", "write")
        assert err is None


class TestResolveScopeId:
    def test_explicit_scope_id_returned(self):
        assert resolve_scope_id("agent", "custom") == "custom"
        assert resolve_scope_id("team", "custom") == "custom"

    def test_agent_scope_defaults_to_current_agent(self):
        token = current_agent.set("my-agent")
        try:
            assert resolve_scope_id("agent", None) == "my-agent"
        finally:
            current_agent.reset(token)

    def test_agent_scope_defaults_to_default_when_no_agent(self):
        # With the default "" value, should return "default"
        token = current_agent.set("")
        try:
            assert resolve_scope_id("agent", None) == "default"
        finally:
            current_agent.reset(token)

    def test_non_agent_scope_defaults_to_default(self):
        assert resolve_scope_id("team", None) == "default"
        assert resolve_scope_id("task", None) == "default"


class TestAccessControlIntegration:
    """Integration tests: access control enforced through commands."""

    async def test_agent_cannot_read_other_agent_memory(self, set_agent):
        set_agent("agent-a")
        await memory_set(key="secret", value="mine", scope="agent", scope_id="agent-a")

        set_agent("agent-b")
        result = await memory_get(key="secret", scope="agent", scope_id="agent-a")
        assert_error(result, "MEMORY_ACCESS_DENIED")

    async def test_agent_cannot_write_other_agent_memory(self, set_agent):
        set_agent("agent-b")
        result = await memory_set(key="hack", value="bad", scope="agent", scope_id="agent-a")
        assert_error(result, "MEMORY_ACCESS_DENIED")

    async def test_agent_search_cannot_leak_other_agent_memory(self, set_agent):
        """Search with scope=agent must not return other agents' entries."""
        set_agent("agent-a")
        await memory_set(key="secret", value="classified", scope="agent", scope_id="agent-a")

        set_agent("agent-b")
        # Search without scope_id — should auto-resolve to agent-b, not search all
        result = await memory_search(query="classified", scope="agent")
        assert_success(result) == []

    async def test_agent_search_with_explicit_other_scope_id_denied(self, set_agent):
        set_agent("agent-a")
        await memory_set(key="private", value="data", scope="agent", scope_id="agent-a")

        set_agent("agent-b")
        result = await memory_search(
            query="data", scope="agent", scope_id="agent-a",
        )
        assert_error(result, "MEMORY_ACCESS_DENIED")

    async def test_team_scope_shared_access(self, set_agent):
        set_agent("agent-a")
        await memory_set(key="shared-info", value="hello", scope="team", scope_id="team-1")

        set_agent("agent-b")
        result = await memory_get(key="shared-info", scope="team", scope_id="team-1")
        data = assert_success(result)
        assert data["value"] == "hello"
