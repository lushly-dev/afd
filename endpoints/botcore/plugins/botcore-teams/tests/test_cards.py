"""Tests for Adaptive Card rendering."""

from __future__ import annotations

from afd.core.metadata import PlanStep, PlanStepStatus, Source
from afd.core.result import error, success

from botcore_teams.cards import card_to_attachment, render_command_result


class TestRenderSuccess:
    def test_basic_success(self) -> None:
        result = success(
            {"task_id": "t-1", "status": "done"},
            reasoning="Task completed",
        )
        card = render_command_result(result)

        assert card["type"] == "AdaptiveCard"
        assert card["version"] == "1.4"
        # Header with reasoning
        assert card["body"][0]["text"] == "Task completed"
        assert card["body"][0]["weight"] == "Bolder"
        # FactSet from data
        facts = card["body"][1]["facts"]
        assert any(f["title"] == "task_id" and f["value"] == "t-1" for f in facts)

    def test_with_plan_steps(self) -> None:
        result = success(
            {"status": "ok"},
            reasoning="Done",
            plan=[
                PlanStep(
                    id="1", action="fetch", status=PlanStepStatus.COMPLETE,
                    description="Fetch data",
                ),
                PlanStep(
                    id="2", action="process", status=PlanStepStatus.PENDING,
                    description="Process",
                ),
            ],
        )
        card = render_command_result(result)

        # Find the plan container
        plan_container = None
        for item in card["body"]:
            if item.get("type") == "Container":
                plan_container = item
                break
        assert plan_container is not None
        plan_facts = plan_container["items"][1]["facts"]
        assert len(plan_facts) == 2
        assert "fetch" in plan_facts[0]["title"]

    def test_with_sources(self) -> None:
        result = success(
            {"data": "ok"},
            reasoning="Found it",
            sources=[
                Source(type="url", title="Docs", url="https://example.com/docs"),
                Source(type="api", title="API"),
            ],
        )
        card = render_command_result(result)

        source_block = None
        for item in card["body"]:
            if item.get("type") == "TextBlock" and "Sources" in item.get("text", ""):
                source_block = item
                break
        assert source_block is not None
        assert "[Docs](https://example.com/docs)" in source_block["text"]
        assert "API" in source_block["text"]

    def test_with_confidence(self) -> None:
        result = success({"x": 1}, reasoning="Done", confidence=0.85)
        card = render_command_result(result)

        confidence_block = None
        for item in card["body"]:
            if item.get("type") == "TextBlock" and "Confidence" in item.get("text", ""):
                confidence_block = item
                break
        assert confidence_block is not None
        assert "85%" in confidence_block["text"]

    def test_with_suggestions(self) -> None:
        result = success({"x": 1}, reasoning="Done", suggestions=["Check status", "Cancel"])
        card = render_command_result(result)

        assert "actions" in card
        assert len(card["actions"]) == 2
        assert card["actions"][0]["title"] == "Check status"
        assert card["actions"][0]["data"]["action"] == "followup"

    def test_empty_data(self) -> None:
        result = success({}, reasoning="Nothing to show")
        card = render_command_result(result)

        assert card["type"] == "AdaptiveCard"
        assert card["body"][0]["text"] == "Nothing to show"

    def test_nested_dict_in_data(self) -> None:
        result = success(
            {"agent": {"name": "coder", "status": "busy"}},
            reasoning="Details",
        )
        card = render_command_result(result)
        facts = card["body"][1]["facts"]
        assert any(f["title"] == "agent.name" for f in facts)

    def test_list_in_data(self) -> None:
        result = success(
            {"items": [1, 2, 3]},
            reasoning="List",
        )
        card = render_command_result(result)
        facts = card["body"][1]["facts"]
        assert any(f["value"] == "3 items" for f in facts)


class TestRenderError:
    def test_basic_error(self) -> None:
        result = error("NOT_FOUND", "Task not found", suggestion="Check the task ID")
        card = render_command_result(result)

        assert card["body"][0]["text"] == "Task not found"
        assert card["body"][0]["color"] == "Attention"
        assert card["body"][1]["text"] == "Check the task ID"

    def test_retryable_error(self) -> None:
        result = error("TIMEOUT", "Request timed out", retryable=True)
        card = render_command_result(result, original_text="team status")

        assert "actions" in card
        assert card["actions"][0]["title"] == "Retry"
        assert card["actions"][0]["data"]["action"] == "retry"
        assert card["actions"][0]["data"]["original_text"] == "team status"

    def test_retryable_error_without_original_text(self) -> None:
        result = error("TIMEOUT", "Request timed out", retryable=True)
        card = render_command_result(result)

        assert "actions" in card
        assert card["actions"][0]["data"]["action"] == "retry"
        assert "original_text" not in card["actions"][0]["data"]

    def test_non_retryable_error_no_retry_button(self) -> None:
        result = error("UNAUTHORIZED", "Not allowed", retryable=False)
        card = render_command_result(result)

        assert "actions" not in card


class TestCardToAttachment:
    def test_wraps_card(self) -> None:
        card = {"type": "AdaptiveCard", "body": []}
        att = card_to_attachment(card)

        assert att["content_type"] == "application/vnd.microsoft.card.adaptive"
        assert att["content"] is card
