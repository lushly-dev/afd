"""Tests for TeamsBot and create_app."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from botcore_teams.bot import TeamsBot, create_app
from botcore_teams.config import TeamsConfig


@pytest.fixture()
def bot_config() -> TeamsConfig:
    return TeamsConfig(
        app_id="test-app",
        app_password="test-pass",
        tenant_id="tenant-123",
    )


def _make_turn_context(
    text: str = "team status",
    tenant_id: str = "tenant-123",
    user_aad_id: str = "user-1",
    user_name: str = "Test User",
    conversation_id: str = "conv-1",
) -> MagicMock:
    """Create a mock TurnContext with activity data."""
    ctx = MagicMock()
    ctx.activity.text = text
    ctx.activity.channel_data = {"tenant": {"id": tenant_id}}
    ctx.activity.from_property.aad_object_id = user_aad_id
    ctx.activity.from_property.id = user_aad_id
    ctx.activity.from_property.name = user_name
    ctx.activity.conversation.id = conversation_id
    ctx.send_activity = AsyncMock()
    return ctx


class TestTeamsBot:
    async def test_valid_message(self, bot_config: TeamsConfig) -> None:
        bot = TeamsBot(bot_config)
        ctx = _make_turn_context(text="team status", tenant_id="tenant-123")

        await bot.on_message_activity(ctx)

        ctx.send_activity.assert_called_once()
        reply = ctx.send_activity.call_args[0][0]
        assert reply.type == "message"
        assert len(reply.attachments) == 1
        card_content = reply.attachments[0].content
        assert card_content["type"] == "AdaptiveCard"

    async def test_wrong_tenant_returns_error(self, bot_config: TeamsConfig) -> None:
        bot = TeamsBot(bot_config)
        ctx = _make_turn_context(text="team status", tenant_id="wrong-tenant")

        await bot.on_message_activity(ctx)

        ctx.send_activity.assert_called_once()
        reply = ctx.send_activity.call_args[0][0]
        card_content = reply.attachments[0].content
        # Error card has Attention color
        assert card_content["body"][0]["color"] == "Attention"
        assert "not authorized" in card_content["body"][0]["text"].lower()

    async def test_invoke_activity(self, bot_config: TeamsConfig) -> None:
        bot = TeamsBot(bot_config)
        ctx = _make_turn_context(tenant_id="tenant-123")
        ctx.activity.value = {"action": "followup", "text": "list tasks"}

        # Mock the invoke response creation
        with (
            patch.object(bot, "_create_invoke_response", return_value=None, create=True),
            patch(
                "botcore_teams.bot.teams_handle_card_action",
                new_callable=AsyncMock,
                wraps=None,
            ) as mock_action,
        ):
            from afd import success

            mock_action.return_value = success({"ok": True})
            await bot.on_invoke_activity(ctx)

        mock_action.assert_awaited_once_with(
            "followup", {"action": "followup", "text": "list tasks"}, "user-1"
        )
        ctx.send_activity.assert_called_once()

    async def test_invoke_wrong_tenant_rejected(self, bot_config: TeamsConfig) -> None:
        bot = TeamsBot(bot_config)
        ctx = _make_turn_context(tenant_id="wrong-tenant")
        ctx.activity.value = {"action": "followup", "text": "list tasks"}

        with (
            patch.object(bot, "_create_invoke_response", return_value=None, create=True),
            patch(
                "botcore_teams.bot.teams_handle_card_action", new_callable=AsyncMock
            ) as mock_action,
        ):
            await bot.on_invoke_activity(ctx)

        mock_action.assert_not_awaited()
        ctx.send_activity.assert_called_once()
        card_content = ctx.send_activity.call_args[0][0].attachments[0].content
        assert card_content["body"][0]["color"] == "Attention"
        assert "not authorized" in card_content["body"][0]["text"].lower()

    async def test_invoke_disallowed_group_rejected(self) -> None:
        cfg = TeamsConfig(
            app_id="test-app",
            app_password="test-pass",
            tenant_id="tenant-123",
            allowed_groups=["grp-allowed"],
        )
        bot = TeamsBot(cfg)
        ctx = _make_turn_context(tenant_id="tenant-123")
        ctx.activity.channel_data = {"tenant": {"id": "tenant-123"}, "groups": ["grp-other"]}
        ctx.activity.value = {"action": "followup", "text": "list tasks"}

        with (
            patch.object(bot, "_create_invoke_response", return_value=None, create=True),
            patch(
                "botcore_teams.bot.teams_handle_card_action", new_callable=AsyncMock
            ) as mock_action,
        ):
            await bot.on_invoke_activity(ctx)

        mock_action.assert_not_awaited()
        ctx.send_activity.assert_called_once()
        card_content = ctx.send_activity.call_args[0][0].attachments[0].content
        assert card_content["body"][0]["color"] == "Attention"
        assert "allowed group" in card_content["body"][0]["text"].lower()

    async def test_invoke_falls_back_to_channel_id_without_aad_id(
        self, bot_config: TeamsConfig
    ) -> None:
        bot = TeamsBot(bot_config)
        ctx = _make_turn_context(tenant_id="tenant-123")
        ctx.activity.from_property.aad_object_id = None
        ctx.activity.from_property.id = "channel-user-42"
        ctx.activity.value = {"action": "followup", "text": "status"}

        with (
            patch.object(bot, "_create_invoke_response", return_value=None, create=True),
            patch(
                "botcore_teams.bot.teams_handle_card_action", new_callable=AsyncMock
            ) as mock_action,
        ):
            from afd import success

            mock_action.return_value = success({"ok": True})
            await bot.on_invoke_activity(ctx)

        mock_action.assert_awaited_once_with(
            "followup", {"action": "followup", "text": "status"}, "channel-user-42"
        )

    async def test_invoke_null_tenant_allowed_when_unrestricted(self) -> None:
        cfg = TeamsConfig(app_id="test-app", app_password="test-pass", tenant_id="")
        bot = TeamsBot(cfg)
        ctx = _make_turn_context()
        ctx.activity.channel_data = {"tenant": None}
        ctx.activity.value = {"action": "followup", "text": "status"}

        with (
            patch.object(bot, "_create_invoke_response", return_value=None, create=True),
            patch(
                "botcore_teams.bot.teams_handle_card_action", new_callable=AsyncMock
            ) as mock_action,
        ):
            from afd import success

            mock_action.return_value = success({"ok": True})
            await bot.on_invoke_activity(ctx)

        mock_action.assert_awaited_once()


class TestCreateApp:
    def test_creates_app_with_webhook_route(self, bot_config: TeamsConfig) -> None:
        app = create_app(bot_config)

        # Check that the webhook path is registered
        routes = [r.resource.canonical for r in app.router.routes() if hasattr(r, "resource")]
        assert bot_config.webhook_path in routes

    async def test_wrong_content_type(self, bot_config: TeamsConfig, aiohttp_client: Any) -> None:
        app = create_app(bot_config)
        client = await aiohttp_client(app)

        resp = await client.post(
            bot_config.webhook_path,
            data="not json",
            headers={"Content-Type": "text/plain"},
        )
        assert resp.status == 415
