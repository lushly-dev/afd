"""LLM runtime commands.

Each command follows the botcore convention: ``async def`` returning
``CommandResult[T]`` and using ``success()`` / ``error()`` from AFD.
"""

from __future__ import annotations

import contextlib
import logging
from pathlib import Path
from typing import TYPE_CHECKING, Any

from afd import CommandResult, error, success
from copilot import BUILTIN_TOOLS_ISOLATED, ToolSet

from .bridge import bridge_commands
from .chat_stream import chat_result, llm_chat_stream
from .client import CopilotClientManager
from .config import DEFAULT_TOOL_PLUGINS, LlmConfig, LlmPermissionsConfig, get_llm_config
from .permissions import create_permission_handler
from .session import get_session_registry

if TYPE_CHECKING:
    from botcore.host import CommandHost

logger = logging.getLogger(__name__)

# Module-level config — set by the plugin at startup, or lazy-default.
_config: LlmConfig | None = None

# The host a Python embedder chose for bridged tools; None builds one from config per session.
_tool_host: CommandHost | None = None


def _get_config() -> LlmConfig:
    global _config
    if _config is None:
        _config = get_llm_config()
    return _config


def set_config(config: LlmConfig) -> None:
    """Allow the plugin to inject config at registration time."""
    global _config
    _config = config


def set_tool_host(host: CommandHost | None) -> None:
    """Serve bridged tools from *host*, or (``None``) from a host built from config.

    Every bridged tool call enters ``host.execute``, so the host's policies and profile
    decide what a model may run.
    """
    global _tool_host
    _tool_host = host


def _get_tool_host(config: LlmConfig) -> tuple[CommandHost, bool]:
    """The host bridged tools dispatch through, and whether this session owns it.

    Without one from :func:`set_tool_host` (which its caller owns and closes), builds a
    managed host over the current workspace with the ``tool_profile`` and ``tool_plugins``
    the LLM config names; the session owns that host and closes it when destroyed.
    """
    if _tool_host is not None:
        return _tool_host, False
    from botcore.context import ExecutionContext
    from botcore.host import build_host
    from botcore.utils.workspace import find_workspace

    workspace = find_workspace() or Path.cwd()
    context = ExecutionContext(workspace, profile=config.tool_profile)
    return build_host("llm", context, plugins=_tool_plugins(config)), True


async def _close_owned(host: CommandHost | None, owned: bool) -> None:
    """Close the plugins of a tool host this session built (their HTTP clients and such)."""
    if host is None or not owned:
        return
    try:
        await host.aclose()
    except Exception as exc:
        logger.warning("Error closing the tool host's plugins: %s", exc)


#: Copilot built-in tools that run shell commands; offered only with ``allow_shell``.
SHELL_BUILTIN_TOOLS = (
    "bash",
    "read_bash",
    "write_bash",
    "stop_bash",
    "list_bash",
    "powershell",
    "read_powershell",
    "write_powershell",
    "stop_powershell",
    "list_powershell",
)
#: Copilot built-in tools that read or write files; offered only with ``allow_filesystem``.
FILESYSTEM_BUILTIN_TOOLS = ("view", "create", "edit", "str_replace_editor", "glob", "grep")


def session_tool_allowlist(bridged: list[str], permissions: LlmPermissionsConfig) -> list[str]:
    """The ``available_tools`` filter of a session: every tool the model may see.

    The bridged tools, the runtime's session-local built-ins, the shell and file built-ins
    the permissions allow, and MCP tools only when ``allow_mcp`` names servers in
    ``mcp_servers`` (the permission handler then admits only those servers). Any other
    tool the runtime provides is hidden from the model.
    """
    tool_set = ToolSet().add_builtin(BUILTIN_TOOLS_ISOLATED)
    if permissions.allow_shell:
        tool_set.add_builtin(SHELL_BUILTIN_TOOLS)
    if permissions.allow_filesystem:
        tool_set.add_builtin(FILESYSTEM_BUILTIN_TOOLS)
    if permissions.allow_mcp and getattr(permissions, "mcp_servers", None):
        tool_set.add_mcp("*")
    for name in bridged:
        tool_set.add_custom(name)
    return tool_set.to_list()


def _tool_plugins(config: LlmConfig) -> tuple[str, ...]:
    """The plugins a tool host selects: ``tool_plugins``, or the installed defaults."""
    if config.tool_plugins is not None:
        return tuple(config.tool_plugins)
    installed = _installed_plugin_names()
    return tuple(name for name in DEFAULT_TOOL_PLUGINS if name in installed)


def _installed_plugin_names() -> set[str]:
    from importlib.metadata import entry_points

    return {entry_point.name for entry_point in entry_points(group="botcore.plugins")}


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

    # Bridge requested tools from a managed host, whose policy applies to every tool call
    bridged_tools = []
    tool_names: list[str] = tools or []
    tool_host: CommandHost | None = None
    owned_host = False
    if tool_names:
        try:
            tool_host, owned_host = _get_tool_host(config)
        except Exception as exc:
            return error(
                "BRIDGE_ERROR",
                f"Failed to build the host for bridged tools: {exc}",
                suggestion=(
                    "Check tool_profile and tool_plugins under [tool.botcore.plugins.llm]: "
                    "each plugin must be installed and declare host_context_safe"
                ),
            )
        try:
            bridged_tools = bridge_commands(tool_names, tool_host)
        except KeyError as exc:
            await _close_owned(tool_host, owned_host)
            return error(
                "UNKNOWN_COMMAND",
                str(exc.args[0]) if exc.args else str(exc),
                suggestion=(
                    "Bridge only commands the tool host serves (see its catalog): admitted "
                    "core commands and those of plugins named in tool_plugins, or pass a "
                    "host of your own to botcore_llm.commands.set_tool_host"
                ),
            )
        except Exception as exc:
            await _close_owned(tool_host, owned_host)
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
        # Only these tools reach the model: anything else the runtime provides is hidden.
        "available_tools": session_tool_allowlist([t.name for t in bridged_tools], perms),
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
        await _close_owned(tool_host, owned_host)
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
        tool_host=tool_host if owned_host else None,
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

    await _close_owned(entry.tool_host, entry.tool_host is not None)
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
