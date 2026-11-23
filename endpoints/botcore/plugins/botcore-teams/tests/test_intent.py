"""Tests for intent parsing."""

from __future__ import annotations

import pytest

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
        assert result.args == {"task_id": "task-001"}

    @pytest.mark.parametrize(
        "text",
        [
            "status 3f2a9c1e-0b4d-4e8a-9f1c-2d3e4f5a6b7c",
            "progress on 3f2a9c1e-0b4d-4e8a-9f1c-2d3e4f5a6b7c",
            "status for task 3f2a9c1e-0b4d-4e8a-9f1c-2d3e4f5a6b7c",
            "Status: 3f2a9c1e-0b4d-4e8a-9f1c-2d3e4f5a6b7c",
            "what's the progress on 3f2a9c1e-0b4d-4e8a-9f1c-2d3e4f5a6b7c?",
            "status of 3f2a9c1e-0b4d-4e8a-9f1c-2d3e4f5a6b7c.",
        ],
    )
    def test_task_status_reads_the_task_id(self, text: str) -> None:
        result = parse_intent(text)
        assert result.command == "task_status"
        assert result.args == {"task_id": "3f2a9c1e-0b4d-4e8a-9f1c-2d3e4f5a6b7c"}

    @pytest.mark.parametrize(
        ("text", "command"),
        [
            ("run status checks", "task_assign"),
            ("run status 5", "task_assign"),
            ("assign fix status 3", "task_assign"),
            ("execute build status v1.2", "task_assign"),
            ("stop progress on task-001", "task_cancel"),
            ("cancel status task-001", "task_cancel"),
            ("abort progress on task-7", "task_cancel"),
            ("queue status 3", "task_list"),
            ("list tasks status 3", "task_list"),
            ("agents status 2", "team_status"),
            ("status of agent-007", "team_status"),
            ("status of queue-2", "task_list"),
        ],
    )
    def test_other_verbs_with_a_status_keep_their_command(self, text: str, command: str) -> None:
        assert parse_intent(text).command == command

    def test_an_uppercase_uuid_is_read_as_the_lowercase_id(self) -> None:
        result = parse_intent("status of 3F2A9C1E-0B4D-4E8A-9F1C-2D3E4F5A6B7C")
        assert result.args == {"task_id": "3f2a9c1e-0b4d-4e8a-9f1c-2d3e4f5a6b7c"}

    @pytest.mark.parametrize("text", ["how is the research going", "status", "status of the docs"])
    def test_task_status_without_an_id_has_no_args(self, text: str) -> None:
        result = parse_intent(text)
        assert result.command == "task_status"
        assert result.args == {}

    def test_cancel(self) -> None:
        result = parse_intent("cancel task-001")
        assert result.command == "task_cancel"
        assert result.args == {"task_id": "task-001"}

    @pytest.mark.parametrize(
        "text",
        [
            "cancel 3f2a9c1e-0b4d-4e8a-9f1c-2d3e4f5a6b7c",
            "cancel task 3f2a9c1e-0b4d-4e8a-9f1c-2d3e4f5a6b7c",
            "stop progress on 3f2a9c1e-0b4d-4e8a-9f1c-2d3e4f5a6b7c",
            "abort: 3f2a9c1e-0b4d-4e8a-9f1c-2d3e4f5a6b7c!",
            "please cancel task 3F2A9C1E-0B4D-4E8A-9F1C-2D3E4F5A6B7C.",
        ],
    )
    def test_cancel_reads_the_task_id(self, text: str) -> None:
        result = parse_intent(text)
        assert result.command == "task_cancel"
        assert result.args == {"task_id": "3f2a9c1e-0b4d-4e8a-9f1c-2d3e4f5a6b7c"}

    @pytest.mark.parametrize(
        "text",
        [
            "cancel",
            "stop",
            "abort the current run",
            "abort the current run now",
            "cancel task assigned to @researcher",
            "cancel the task assigned to @researcher",
            "stop task 42",
        ],
    )
    def test_cancel_without_an_id_has_no_args(self, text: str) -> None:
        result = parse_intent(text)
        assert result.command == "task_cancel"
        assert result.args == {}

    def test_assign_with_cancel_verb_in_description_stays_task_assign(self) -> None:
        result = parse_intent("assign stop the server to @ops")
        assert result.command == "task_assign"
        assert result.args == {"description": "stop the server", "agent": "ops"}

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
