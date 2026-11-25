"""Tests for ``botcore docs``: the docs topics on the command line, as the server serves them."""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest
from click.testing import CliRunner

from botcore.cli import cli
from botcore.docs import CORE_DOCS
from botcore.plugin import PluginRegistry


class _DocsPlugin:
    def register(self, registry: PluginRegistry) -> None:
        registry.add_docs("fake", "# Fake Plugin\nDocs here.")


def _discover() -> dict:
    return {"fake": _DocsPlugin()}


@pytest.fixture(autouse=True)
def _one_plugin():
    with (
        patch("botcore.server.discover_plugins", _discover),
        patch("botcore.plugin.discover_plugins", _discover),
    ):
        yield


def _run(*args: str):
    return CliRunner().invoke(cli, list(args))


def test_topic_prints_the_topic():
    result = _run("docs", "skill")
    assert result.exit_code == 0, result.output
    assert result.output == CORE_DOCS["skill"] + "\n"


def test_plugin_topic_is_served():
    result = _run("docs", "fake")
    assert result.exit_code == 0, result.output
    assert result.output == "# Fake Plugin\nDocs here.\n"


def test_no_topic_lists_every_topic_with_one_line():
    result = _run("docs")
    assert result.exit_code == 0, result.output
    lines = result.output.splitlines()
    assert lines[0] == "# botcore — Topics"
    listed = [line for line in lines if line.startswith("- **")]
    assert len(listed) == len(CORE_DOCS) + 1
    for topic in [*CORE_DOCS, "fake"]:
        assert any(line.startswith(f"- **{topic}**: ") for line in listed), topic
    assert "- **fake**: # Fake Plugin" in listed


def test_unknown_topic_is_refused_with_the_topics_that_exist():
    result = _run("docs", "nonexistent")
    assert result.exit_code == 1
    assert "Unknown topic: 'nonexistent'" in result.output
    for topic in [*CORE_DOCS, "fake"]:
        assert topic in result.output


def test_unknown_topic_in_json_is_a_failed_result_with_a_suggestion():
    result = _run("--json", "docs", "nonexistent")
    assert result.exit_code == 1
    payload = json.loads(result.output)
    assert payload["success"] is False
    assert payload["error"]["code"] == "UNKNOWN_TOPIC"
    assert "skill" in payload["error"]["message"]
    assert payload["error"]["suggestion"]


def test_topic_in_json_carries_the_text():
    result = _run("docs", "skill", "--json")
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["success"] is True
    assert payload["data"] == {"topic": "skill", "text": CORE_DOCS["skill"]}


def test_empty_topic_is_refused_as_the_server_refuses_it():
    result = _run("docs", "")
    assert result.exit_code == 1
    assert "Unknown topic: ''" in result.output


def test_help_says_how_to_list_the_topics():
    result = _run("docs", "--help")
    assert result.exit_code == 0
    assert "run `botcore docs` to see them" in result.output


class TestMatchesTheServer:
    @pytest.fixture(autouse=True)
    def _skip_if_no_mcp(self):
        pytest.importorskip("mcp")

    @staticmethod
    async def _server_text(topic: str) -> str:
        from botcore.server import create_mcp_server

        server = create_mcp_server("botcore")
        result = await server.call_tool("botcore-docs", {"topic": topic})
        content = (
            result.content
            if hasattr(result, "content")
            else (result[0] if isinstance(result, tuple) else result)
        )
        return content[0].text

    @pytest.mark.asyncio
    @pytest.mark.parametrize("topic", ["skill", "fake", "overview", "nonexistent"])
    async def test_command_line_and_server_return_the_same_text(self, topic: str):
        served = await self._server_text(topic)
        result = _run("docs", topic)
        if topic == "nonexistent":
            assert result.exit_code == 1
            assert result.output.startswith(f"Error: UNKNOWN_TOPIC: {served}\n")
        else:
            assert result.exit_code == 0, result.output
            assert result.output == served + "\n"
