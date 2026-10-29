"""LLM runtime commands.

Each command follows the botcore convention: ``async def`` returning
``CommandResult[T]`` and using ``success()`` / ``error()`` from AFD.
"""

from __future__ import annotations

import contextlib
import logging
from typing import Any

from afd import CommandResult, error, success

from .bridge import bridge_commands
from .chat_stream import chat_result, llm_chat_stream
from .client import CopilotClientManager
from .config import LlmConfig, LlmPermissionsConfig, get_llm_config
from .permissions import create_permission_handler
from .session import get_session_registry

logger = logging.getLogger(__name__)

# Module-level config — set by the plugin at startup, or lazy-default.
_config: LlmConfig | None = None

# Cached command namespace — avoids re-discovering plugins on every session create.
_namespace: dict[str, Any] | None = None


def _get_config() -> LlmConfig:
    global _config
    if _config is None:
        _config = get_llm_config()
    return _config


def set_config(config: LlmConfig) -> None:
    """Allow the plugin to inject config at registration time."""
    global _config
    _config = config


def _get_namespace() -> dict[str, Any]:
    """Return the cached botcore command namespace."""
    global _namespace
    if _namespace is None:
        from botcore.server import build_namespace

        _namespace, _ = build_namespace()
    return _namespace


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------


async def llm_session_create(
    model: str | None = None,
    tools: list[str] | None = None,
    system_prompt: str | None = None,
    streaming: bool = True,
    permissions: LlmPermissionsConfig | None = None,
    agent_name: str = "",
) -> CommandResult[dict]:
    """Create a new LLM session with bridged botcore tools."""
    config = _get_config()
    model = (model or "").strip() or config.default_model.strip()
    if not model:
        return error(
            "CONFIG_ERROR",
            "No model specified and [tool.botcore.plugins.llm] default_model is not set",
            suggestion=(
                "Set default_model under [tool.botcore.plugins.llm] in botcore.toml, "
                "or pass model=. Use llm_model_list to see model IDs your account can use"
            ),
            retryable=False,
        )

    try:
        client = await CopilotClientManager.get_client(config)
    except Exception as exc:
        return error(
            "CLIENT_ERROR",
            f"Failed to get Copilot client: {exc}",
            suggestion="Check that Copilot CLI is installed and accessible",
        )

    # Bridge requested tools from the botcore command namespace
    bridged_tools = []
    tool_names: list[str] = tools or []
    if tool_names:
        try:
            namespace = _get_namespace()
            bridged_tools = bridge_commands(tool_names, namespace)
        except KeyError as exc:
            return error(
                "UNKNOWN_COMMAND",
                str(exc),
                suggestion="Use llm_session_list or check available commands",
            )
        except Exception as exc:
            return error(
                "BRIDGE_ERROR",
                f"Failed to bridge commands: {exc}",
                suggestion="Ensure botcore is properly installed",
            )

    # Build session config
    perms = permissions or config.permissions
    permission_handler = create_permission_handler(perms, agent_name=agent_name)

    session_config: dict[str, Any] = {
        "on_permission_request": permission_handler,
        "model": model,
        "streaming": streaming,
    }

    if bridged_tools:
        session_config["tools"] = bridged_tools

    if system_prompt:
        session_config["system_message"] = {
            "mode": "append",
            "content": system_prompt,
        }

    if config.infinite_sessions:
        session_config["infinite_sessions"] = {"enabled": True}

    try:
        session = await client.create_session(**session_config)
    except Exception as exc:
        return error(
            "SESSION_CREATE_ERROR",
            f"Failed to create session: {exc}",
            suggestion="Check model availability with llm_model_list",
        )

    # Register in the session registry
    registry = get_session_registry()
    registry.register(
        session.session_id,
        session,
        model=model,
        tools=tool_names,
        config=session_config,
        agent_name=agent_name,
    )

    return success(
        data={
            "session_id": session.session_id,
            "model": model,
            "tools": tool_names,
        },
        reasoning=f"Created LLM session with model={model}",
    )


async def llm_session_destroy(session_id: str) -> CommandResult[dict]:
    """Destroy an LLM session and release resources."""
    registry = get_session_registry()
    entry = registry.get(session_id)

    if entry is None:
        return error(
            "SESSION_NOT_FOUND",
            f"No session with id {session_id!r}",
            suggestion="Use llm_session_list to see active sessions",
        )

    try:
        await entry.session.disconnect()
    except Exception as exc:
        logger.warning("Error destroying session %s: %s", session_id, exc)

    registry.remove(session_id)

    return success(
        data={"session_id": session_id, "status": "destroyed"},
        reasoning=f"Session {session_id} destroyed",
    )


async def llm_session_list() -> CommandResult[list[dict]]:
    """List active LLM sessions with status and model info."""
    registry = get_session_registry()
    sessions = registry.list_all()

    return success(
        data=sessions,
        reasoning=f"{len(sessions)} active session(s)",
    )


async def llm_model_list() -> CommandResult[list[dict]]:
    """List available models from Copilot CLI."""
    config = _get_config()

    try:
        client = await CopilotClientManager.get_client(config)
    except Exception as exc:
        return error(
            "CLIENT_ERROR",
            f"Failed to get Copilot client: {exc}",
            suggestion="Check that Copilot CLI is installed and accessible",
        )

    try:
        models = await client.list_models()
    except Exception as exc:
        return error(
            "MODEL_LIST_ERROR",
            f"Failed to list models: {exc}",
            suggestion="Ensure you are authenticated with Copilot",
        )

    model_dicts = []
    for m in models:
        entry: dict[str, Any] = {"id": m.id, "name": m.name}
        if m.capabilities:
            entry["supports_vision"] = m.capabilities.supports.vision
        model_dicts.append(entry)

    return success(
        data=model_dicts,
        reasoning=f"{len(model_dicts)} model(s) available",
    )


async def llm_chat(
    session_id: str,
    message: str,
    attachments: list[dict] | None = None,
    timeout: float | None = None,
) -> CommandResult[dict]:
    """Send a message to an active LLM session.

    Collects ``llm_chat_stream`` into a single result; cancelling the call aborts
    the turn. Without ``timeout``, the Copilot SDK's default of 60 seconds applies.
    """
    async with contextlib.aclosing(
        llm_chat_stream(session_id, message, attachments, timeout)
    ) as stream:
        async for chunk in stream:
            result = chat_result(chunk)
            if result is not None:
                return result
    return error(
        "CHAT_ERROR",
        "Chat stream ended without a result",
        suggestion="Retry the message",
    )


LLM_COMMANDS: list = [
    llm_session_create,
    llm_session_destroy,
    llm_session_list,
    llm_model_list,
    llm_chat,
]
