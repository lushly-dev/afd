"""Tests for intent parsing."""

from __future__ import annotations

from botcore_teams.intent import parse_intent


class TestParseIntent:
    def test_assign_with_agent(self) -> None:
        result = parse_intent("assign research the latest Azure SDK changes to @researcher")
        assert result.command == "task_assign"
        assert result.args["description"] == "research the latest Azure SDK changes"
        assert result.args["agent"] == "researcher"
        assert result.confidence == 1.0

    def test_assign_without_agent(self) -> None:
        result = parse_intent("run the nightly tests")
        assert result.command == "task_assign"
        assert result.args["description"] == "the nightly tests"

    def test_team_status(self) -> None:
        result = parse_intent("team status")
        assert result.command == "team_status"
        assert result.confidence == 1.0

    def test_agents_keyword(self) -> None:
        result = parse_intent("agents")
        assert result.command == "team_status"

    def test_who_keyword(self) -> None:
        result = parse_intent("who")
        assert result.command == "team_status"

    def test_task_status(self) -> None:
        result = parse_intent("status of task-001")
        assert result.command == "task_status"
        assert "query" in result.args

    def test_how_going(self) -> None:
        result = parse_intent("how is the research going")
        assert result.command == "task_status"

    def test_cancel(self) -> None:
        result = parse_intent("cancel task-001")
        assert result.command == "task_cancel"
        assert result.args.get("query") == "task-001"

    def test_list_tasks(self) -> None:
        result = parse_intent("list tasks")
        assert result.command == "task_list"

    def test_queue(self) -> None:
        result = parse_intent("queue")
        assert result.command == "task_list"

    def test_backlog(self) -> None:
        result = parse_intent("backlog")
        assert result.command == "task_list"

    def test_unknown_text(self) -> None:
        result = parse_intent("hello there, nice weather today")
        assert result.command == "unknown"
        assert result.confidence == 0.0

    def test_bot_mention_stripping(self) -> None:
        result = parse_intent("<at>BotName</at> team status")
        assert result.command == "team_status"

    def test_case_insensitivity(self) -> None:
        result = parse_intent("TEAM STATUS")
        assert result.command == "team_status"

    def test_assign_case_insensitive(self) -> None:
        result = parse_intent("Assign write docs to @writer")
        assert result.command == "task_assign"
        assert result.args["agent"] == "writer"

    def test_empty_text(self) -> None:
        result = parse_intent("")
        assert result.command == "unknown"
        assert result.confidence == 0.0

    def test_raw_text_preserved(self) -> None:
        original = "<at>Bot</at> team status"
        result = parse_intent(original)
        assert result.raw_text == original
