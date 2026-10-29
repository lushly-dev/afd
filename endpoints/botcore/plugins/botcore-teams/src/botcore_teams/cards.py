"""Adaptive Card rendering for CommandResult."""

from __future__ import annotations

from typing import Any

from afd.core.metadata import PlanStep, PlanStepStatus, Source
from afd.core.result import CommandResult

_STATUS_ICONS: dict[PlanStepStatus, str] = {
    PlanStepStatus.PENDING: "⏳",
    PlanStepStatus.IN_PROGRESS: "🔄",
    PlanStepStatus.COMPLETE: "✅",
    PlanStepStatus.FAILED: "❌",
    PlanStepStatus.SKIPPED: "⏭️",
}


def _data_to_facts(data: dict[str, Any]) -> list[dict[str, str]]:
    """Flatten a dict into Adaptive Card FactSet facts."""
    facts: list[dict[str, str]] = []
    for key, value in data.items():
        if isinstance(value, dict):
            for sub_key, sub_value in value.items():
                facts.append({"title": f"{key}.{sub_key}", "value": str(sub_value)})
        elif isinstance(value, list):
            facts.append({"title": str(key), "value": f"{len(value)} items"})
        else:
            facts.append({"title": str(key), "value": str(value)})
    return facts


def _render_plan_steps(steps: list[PlanStep]) -> dict[str, Any]:
    """Render plan steps as an Adaptive Card Container with a FactSet."""
    facts = []
    for step in steps:
        icon = _STATUS_ICONS.get(step.status, "⏳")
        label = step.description or step.action
        facts.append({"title": f"{icon} {step.action}", "value": label})
    return {
        "type": "Container",
        "items": [
            {"type": "TextBlock", "text": "Plan", "weight": "Bolder", "size": "Medium"},
            {"type": "FactSet", "facts": facts},
        ],
    }


def _render_sources(sources: list[Source]) -> dict[str, Any]:
    """Render sources as a TextBlock with markdown links."""
    parts: list[str] = []
    for src in sources:
        title = src.title or src.type
        if src.url:
            parts.append(f"[{title}]({src.url})")
        else:
            parts.append(title)
    return {
        "type": "TextBlock",
        "text": f"Sources: {', '.join(parts)}",
        "wrap": True,
        "size": "Small",
        "isSubtle": True,
    }


def render_command_result(
    result: CommandResult,  # type: ignore[type-arg]
    *,
    original_text: str | None = None,
) -> dict[str, Any]:
    """Convert a CommandResult into an Adaptive Card JSON dict (schema v1.4).

    Args:
        result: The command result to render.
        original_text: If provided, embedded in Retry button data so the
            retry handler can re-dispatch the original message.
    """
    if result.success:
        return _render_success(result)
    return _render_error(result, original_text=original_text)


def _render_success(result: CommandResult) -> dict[str, Any]:  # type: ignore[type-arg]
    body: list[dict[str, Any]] = []

    # Header with reasoning
    header_text = result.reasoning or "Done"
    body.append({
        "type": "TextBlock",
        "text": header_text,
        "weight": "Bolder",
        "size": "Medium",
        "wrap": True,
    })

    # Data as FactSet
    if result.data and isinstance(result.data, dict):
        body.append({"type": "FactSet", "facts": _data_to_facts(result.data)})

    # Plan steps
    if result.plan:
        body.append(_render_plan_steps(result.plan))

    # Sources
    if result.sources:
        body.append(_render_sources(result.sources))

    # Confidence
    if result.confidence is not None:
        body.append({
            "type": "TextBlock",
            "text": f"Confidence: {result.confidence:.0%}",
            "isSubtle": True,
            "size": "Small",
        })

    # Suggestion actions
    actions: list[dict[str, Any]] = []
    if result.suggestions:
        for suggestion in result.suggestions:
            actions.append({
                "type": "Action.Submit",
                "title": suggestion,
                "data": {"action": "followup", "text": suggestion},
            })

    card: dict[str, Any] = {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.4",
        "body": body,
    }
    if actions:
        card["actions"] = actions
    return card


def _render_error(
    result: CommandResult,  # type: ignore[type-arg]
    *,
    original_text: str | None = None,
) -> dict[str, Any]:
    err = result.error
    body: list[dict[str, Any]] = [
        {
            "type": "TextBlock",
            "text": err.message if err else "Unknown error",
            "color": "Attention",
            "weight": "Bolder",
            "wrap": True,
        },
    ]

    if err and err.suggestion:
        body.append({
            "type": "TextBlock",
            "text": err.suggestion,
            "wrap": True,
            "isSubtle": True,
        })

    actions: list[dict[str, Any]] = []
    if err and err.retryable:
        retry_data: dict[str, Any] = {"action": "retry"}
        if original_text:
            retry_data["original_text"] = original_text
        actions.append({
            "type": "Action.Submit",
            "title": "Retry",
            "data": retry_data,
        })

    card: dict[str, Any] = {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.4",
        "body": body,
    }
    if actions:
        card["actions"] = actions
    return card


def card_to_attachment(card: dict[str, Any]) -> dict[str, Any]:
    """Wrap an Adaptive Card dict as a Bot Framework attachment."""
    return {
        "content_type": "application/vnd.microsoft.card.adaptive",
        "content": card,
    }
