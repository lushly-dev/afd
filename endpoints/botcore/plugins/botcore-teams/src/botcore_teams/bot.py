"""Bot Framework webhook — TeamsBot and aiohttp app factory."""

from __future__ import annotations

import logging
from typing import Any

from aiohttp import web
from botbuilder.core import (
    BotFrameworkAdapter,
    BotFrameworkAdapterSettings,
    TurnContext,
)
from botbuilder.core.teams import TeamsActivityHandler
from botbuilder.schema import Activity, Attachment

from .auth import (
    create_unauthorized_error,
    extract_group_ids,
    extract_identity,
    validate_allowed_groups,
    validate_tenant,
)
from .cards import card_to_attachment, render_command_result
from .commands import teams_handle_card_action, teams_handle_message
from .config import TeamsConfig

logger = logging.getLogger(__name__)


class TeamsBot(TeamsActivityHandler):
    """Handles incoming Teams activities."""

    def __init__(self, config: TeamsConfig) -> None:
        super().__init__()
        self._config = config

    async def on_message_activity(self, turn_context: TurnContext) -> None:
        activity = turn_context.activity

        # Tenant gate
        activity_tenant = None
        if activity.channel_data and isinstance(activity.channel_data, dict):
            tenant_info = activity.channel_data.get("tenant", {})
            activity_tenant = tenant_info.get("id") if isinstance(tenant_info, dict) else None

        if not validate_tenant(activity_tenant, self._config.tenant_id):
            result = create_unauthorized_error()
            card = render_command_result(result)
            att = card_to_attachment(card)
            reply = Activity(
                type="message",
                attachments=[Attachment(**att)],
            )
            await turn_context.send_activity(reply)
            return

        # Extract identity
        identity = extract_identity(
            _activity_to_dict(activity),
            admin_groups=self._config.roles.admin_groups,
            user_groups=self._config.roles.user_groups,
        )

        # Optional group gate (Phase 1: reads group ids from channelData.groups)
        user_group_ids = extract_group_ids(_activity_to_dict(activity))
        if not validate_allowed_groups(user_group_ids, self._config.allowed_groups):
            result = create_unauthorized_error(
                message="You are not in an allowed group for this bot.",
                suggestion="Ask your administrator to add your group to allowed_groups.",
            )
            card = render_command_result(result)
            att = card_to_attachment(card)
            reply = Activity(
                type="message",
                attachments=[Attachment(**att)],
            )
            await turn_context.send_activity(reply)
            return

        # Dispatch
        text = activity.text or ""
        conversation_id = activity.conversation.id if activity.conversation else ""
        result = await teams_handle_message(
            text, identity.user_id, identity.user_name, conversation_id
        )

        card = render_command_result(result, original_text=text)
        att = card_to_attachment(card)
        reply = Activity(
            type="message",
            attachments=[Attachment(**att)],
        )
        await turn_context.send_activity(reply)

    async def on_invoke_activity(self, turn_context: TurnContext) -> Any:
        activity = turn_context.activity
        value = activity.value or {}
        action = value.get("action", "") if isinstance(value, dict) else ""
        data = value if isinstance(value, dict) else {}

        from_field = activity.from_property
        user_id = (from_field.aad_object_id or from_field.id) if from_field else ""

        result = await teams_handle_card_action(action, data, user_id)
        card = render_command_result(result)
        att = card_to_attachment(card)
        reply = Activity(
            type="message",
            attachments=[Attachment(**att)],
        )
        await turn_context.send_activity(reply)
        return self._create_invoke_response()  # type: ignore[attr-defined]


def _activity_to_dict(activity: Activity) -> dict[str, Any]:
    """Convert a Bot Framework Activity to the dict shape expected by extract_identity."""
    from_prop = activity.from_property
    channel_data = activity.channel_data if isinstance(activity.channel_data, dict) else {}
    return {
        "from": {
            "aadObjectId": from_prop.aad_object_id if from_prop else "",
            "id": from_prop.id if from_prop else "",
            "name": from_prop.name if from_prop else "",
        },
        "channelData": channel_data,
    }


def create_app(config: TeamsConfig) -> web.Application:
    """Create an aiohttp web application with the Bot Framework webhook."""
    settings = BotFrameworkAdapterSettings(config.app_id, config.app_password)
    adapter = BotFrameworkAdapter(settings)
    bot = TeamsBot(config)

    async def messages(req: web.Request) -> web.Response:
        content_type = req.content_type
        if "application/json" not in content_type:
            return web.Response(status=415, text="Unsupported Media Type")

        body = await req.json()
        activity = Activity().deserialize(body)

        auth_header = req.headers.get("Authorization", "")
        response = await adapter.process_activity(activity, auth_header, bot.on_turn)
        if response:
            return web.json_response(data=response.body, status=response.status)
        return web.Response(status=200)

    app = web.Application()
    app.router.add_post(config.webhook_path, messages)
    return app
