"""Tests for botcore.server — namespace builder, docs builder, and MCP server factory."""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest
from pydantic import BaseModel

from botcore.docs import CORE_DOCS
from botcore.plugin import PluginRegistry
from botcore.server import _validate_code, build_docs, build_namespace

# ── Helpers ─────────────────────────────────────────────────────────────────


async def _fake_plugin_cmd() -> dict[str, Any]:
    return {"from": "plugin"}


class _FakePlugin:
    configured_with: object | None = None

    def configure(self, config: object) -> None:
        self.configured_with = config

    def register(self, registry: PluginRegistry) -> None:
        registry.add_commands([_fake_plugin_cmd])
        registry.add_docs("fake", "# Fake Plugin\nDocs here.")
        registry.set_mcp_name("fake")

    def config_schema(self):
        return None


def _mock_discover_with_fake() -> dict:
    return {"fake": _FakePlugin()}


def _mock_discover_empty() -> dict:
    return {}


class _FakePluginConfig(BaseModel):
    token: str = ""


class _FakeBotCoreConfig(BaseModel):
    plugins: dict[str, object] = {}


# ── build_namespace ─────────────────────────────────────────────────────────


class TestBuildNamespace:
    @patch("botcore.server.discover_plugins", _mock_discover_empty)
    def test_includes_core_commands(self):
        from botcore.commands import __all__ as core_all

        ns, _reg = build_namespace()
        for name in core_all:
            assert name in ns, f"core command {name!r} missing from namespace"

    @patch("botcore.server.discover_plugins", _mock_discover_with_fake)
    def test_includes_plugin_commands(self):
        ns, _reg = build_namespace()
        assert "_fake_plugin_cmd" in ns
        assert ns["_fake_plugin_cmd"] is _fake_plugin_cmd

    @patch("botcore.server.discover_plugins", _mock_discover_empty)
    def test_extra_commands_added(self):
        async def extra() -> None:
            pass

        ns, _reg = build_namespace(extra_commands=[extra])
        assert "extra" in ns

    @patch("botcore.server.discover_plugins", _mock_discover_empty)
    def test_no_duplicates_with_empty_plugins(self):
        ns, _reg = build_namespace()
        # Namespace should have unique keys (dict guarantees this, but verify count)
        assert len(ns) == len(set(ns.keys()))

    @patch("botcore.server.discover_plugins", _mock_discover_with_fake)
    def test_returns_populated_registry(self):
        _ns, reg = build_namespace()
        assert reg.mcp_name == "fake"
        assert len(reg.commands) == 1

    @patch("botcore.server.discover_plugins", _mock_discover_with_fake)
    @patch("botcore.server.load_config")
    def test_configures_plugin_before_register(self, mock_load_config):
        plugin = _FakePlugin()

        def _discover():
            return {"fake": plugin}

        mock_load_config.return_value = _FakeBotCoreConfig(
            plugins={"fake": _FakePluginConfig(token="abc")}
        )

        with patch("botcore.server.discover_plugins", _discover):
            build_namespace()

        assert isinstance(plugin.configured_with, _FakePluginConfig)
        assert plugin.configured_with.token == "abc"


# ── build_docs ──────────────────────────────────────────────────────────────


class TestBuildDocs:
    def test_includes_core_topics(self):
        registry = PluginRegistry()
        docs = build_docs(registry)
        for topic in CORE_DOCS:
            assert topic in docs, f"core topic {topic!r} missing"

    def test_includes_plugin_docs(self):
        registry = PluginRegistry()
        registry.add_docs("lib", "# Lib docs")
        docs = build_docs(registry)
        assert "lib" in docs
        assert docs["lib"] == "# Lib docs"

    def test_extra_docs_merged(self):
        registry = PluginRegistry()
        docs = build_docs(registry, extra_docs={"custom": "# Custom"})
        assert "custom" in docs

    def test_plugin_docs_collision_rejected(self):
        """Host documentation must not be replaced through plugin order."""
        registry = PluginRegistry()
        registry.add_docs("dev", "# Custom dev docs")
        with pytest.raises(ValueError, match="Duplicate documentation"):
            build_docs(registry)


# ── _validate_code ──────────────────────────────────────────────────────────


class TestValidateCode:
    def test_accepts_valid(self):
        assert _validate_code("x = 1 + 2") is None

    def test_rejects_too_long(self):
        err = _validate_code("x = 1\n" * 5000)
        assert err is not None
        assert "too long" in err.lower()

    def test_rejects_syntax_error(self):
        err = _validate_code("def (bad")
        assert err is not None
        assert "syntax" in err.lower()


# ── create_mcp_server ──────────────────────────────────────────────────────


class TestCreateMcpServer:
    @pytest.fixture(autouse=True)
    def _skip_if_no_mcp(self):
        try:
            import mcp  # noqa: F401
        except ImportError:
            pytest.skip("mcp package not installed")

    @patch("botcore.server.discover_plugins", _mock_discover_empty)
    @pytest.mark.asyncio
    async def test_has_three_tools(self):
        from botcore.server import create_mcp_server

        server = create_mcp_server("test")
        tools = await server.list_tools()
        tool_names = [t.name for t in tools]
        assert "test-start" in tool_names
        assert "test-docs" in tool_names
        assert "test-run" in tool_names
        assert len(tool_names) == 3

    @patch("botcore.server.discover_plugins", _mock_discover_empty)
    @pytest.mark.asyncio
    async def test_with_research(self):
        from botcore.server import create_mcp_server

        server = create_mcp_server("test", include_research=True)
        tools = await server.list_tools()
        tool_names = [t.name for t in tools]
        assert "test-research" in tool_names
        assert len(tool_names) == 4

    @staticmethod
    def _get_text(result) -> str:
        """Extract text from call_tool result (handles tuple/list nesting)."""
        # call_tool may return (content_list, ...) tuple or just a list
        content = (
            result.content
            if hasattr(result, "content")
            else (result[0] if isinstance(result, tuple) else result)
        )
        return content[0].text

    @patch("botcore.server.discover_plugins", _mock_discover_empty)
    @pytest.mark.asyncio
    async def test_start_tool_returns_json(self):
        from botcore.server import create_mcp_server

        server = create_mcp_server("test", version="1.2.3")
        result = await server.call_tool("test-start", {})
        import json

        data = json.loads(self._get_text(result))
        assert data["name"] == "test"
        assert data["version"] == "1.2.3"
        assert "available_functions" in data

    @patch("botcore.server.discover_plugins", _mock_discover_empty)
    @pytest.mark.asyncio
    async def test_docs_tool_overview(self):
        from botcore.server import create_mcp_server

        server = create_mcp_server("test")
        result = await server.call_tool("test-docs", {"topic": "overview"})
        text = self._get_text(result)
        assert "Topics" in text

    @patch("botcore.server.discover_plugins", _mock_discover_empty)
    @pytest.mark.asyncio
    async def test_docs_tool_unknown_topic(self):
        from botcore.server import create_mcp_server

        server = create_mcp_server("test")
        result = await server.call_tool("test-docs", {"topic": "nonexistent"})
        text = self._get_text(result)
        assert "Unknown topic" in text

    @patch("botcore.server.discover_plugins", _mock_discover_empty)
    @pytest.mark.asyncio
    async def test_run_tool_executes_code(self):
        from botcore.server import create_mcp_server

        server = create_mcp_server("test")
        result = await server.call_tool("test-run", {"code": "return 42"})
        assert "42" in self._get_text(result)

    @patch("botcore.server.discover_plugins", _mock_discover_empty)
    @pytest.mark.asyncio
    async def test_run_tool_rejects_syntax_error(self):
        from botcore.server import create_mcp_server

        server = create_mcp_server("test")
        result = await server.call_tool("test-run", {"code": "def (bad"})
        assert "error" in self._get_text(result).lower()
