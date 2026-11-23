"""Command → Tool bridge.

Serves the commands of a Botcore :class:`~botcore.host.CommandHost` to the LLM as Copilot
SDK :class:`Tool` objects. Every tool call enters ``host.execute``, the dispatch path the
host's CLI ``call`` and MCP ``call`` use, so the host's argument checks, command policies,
execution profile, path confinement and middleware apply to a model's tool calls exactly as
they apply to any other caller's. A call the host refuses reaches the model as that
refusal's error code, message and suggestion.
"""

from __future__ import annotations

import dataclasses
import json
import logging
from typing import TYPE_CHECKING, Any

from afd import Actor
from afd.core.commands import CommandContext
from botcore.host_inputs import describe_inputs
from copilot import Tool, ToolInvocation, ToolResult

if TYPE_CHECKING:
    from botcore.host import CommandHost

logger = logging.getLogger(__name__)


def botcore_command_to_copilot_tool(name: str, host: CommandHost, agent_name: str = "") -> Tool:
    """Serve one command of *host* as a Copilot SDK ``Tool``.

    The tool's name is the command's served name, its description the handler's first
    docstring line and its parameters the host catalog's input schema. Its handler calls
    ``host.execute`` as an agent (see :func:`model_actor`) and converts the
    ``CommandResult`` into a ``ToolResult``.

    Args:
        name: A command name *host* serves, in either spelling.
        host: The host whose dispatch and policy every call goes through.
        agent_name: The configured name of the agent the session serves; it is the
            caller's id when the host's actor names none (see :func:`model_actor`).

    Returns:
        A :class:`Tool` ready for use in a ``SessionConfig``.

    Raises:
        KeyError: If *host* serves no command called *name*.
        HostActorRefused: If *host* names an actor a model's call cannot run as.
    """
    actor = model_actor(host.actor, agent_name)
    served = host.resolve(name)
    if served is None:
        raise KeyError(f"Command {name!r} is not served by host {host.name!r}")
    description, input_schema = describe_inputs(host.handler(served))
    parameters = input_schema if input_schema.get("properties") else None

    async def handler(invocation: ToolInvocation) -> ToolResult:
        context = CommandContext(actor=actor)
        # Only a missing object defaults; anything else is the host's to validate.
        arguments = {} if invocation.arguments is None else invocation.arguments
        result = await host.execute(served, arguments, context)
        return _command_result_to_tool_result(result)

    return Tool(
        name=served,
        description=description,
        handler=handler,
        parameters=parameters,
    )


class HostActorRefused(ValueError):
    """A host names an actor a model's tool calls cannot run as or on behalf of."""

    suggestion = (
        "Give the tool host no actor, an agent actor, or a human actor with an id "
        "(the model then calls on that human's behalf)"
    )


def model_actor(host_actor: Actor | None, agent_name: str = "") -> Actor:
    """The actor a model's tool call runs as: always an agent.

    A host with no actor gives an agent, and one whose actor is an agent lends it. A host
    whose actor is a human with an id keeps the agent as the caller and records that human's
    id as ``on_behalf_of``, so policy and journals never see a model's call as the human's
    own. Any other actor (a service, a script, a test, a human without an id) names no one
    the model could act for, so the host is refused.

    ``agent_name`` (a configured agent's name) is the agent's id wherever the host's actor
    gives none, so commands that key data on the caller, such as agent memory, tell one
    agent from another. A host whose agent actor has an id keeps it: the host named that
    caller. ``agent_name`` is trusted as an identity, so pass it only for a local, trusted
    caller; ``llm_session_create`` drops it inside any host call.

    Raises:
        HostActorRefused: For an actor the model cannot run as or for.
    """
    named = agent_name or None
    if host_actor is None:
        return Actor(kind="agent", id=named)
    if host_actor.kind == "agent":
        return host_actor if host_actor.id else dataclasses.replace(host_actor, id=named)
    if host_actor.kind == "human" and host_actor.id:
        return Actor(kind="agent", id=named, on_behalf_of=host_actor.id)
    raise HostActorRefused(
        f"The tool host's actor ({host_actor.kind}"
        + (f" {host_actor.id!r}" if host_actor.id else ", no id")
        + ") is not one a model's tool calls can run as or on behalf of"
    )


def bridge_commands(
    command_names: list[str], host: CommandHost, agent_name: str = ""
) -> list[Tool]:
    """Serve each named command of *host* as a Copilot ``Tool``.

    Args:
        command_names: Command names *host* serves.
        host: The host whose dispatch and policy every call goes through.
        agent_name: The configured name of the agent the session serves (see
            :func:`model_actor`).

    Returns:
        List of bridged :class:`Tool` objects.

    Raises:
        KeyError: If *host* serves no command by one of the names.
    """
    return [botcore_command_to_copilot_tool(name, host, agent_name) for name in command_names]


def _command_result_to_tool_result(result: Any) -> ToolResult:
    """Convert a ``CommandResult`` to a Copilot ``ToolResult``."""
    if result.success:
        return ToolResult(
            text_result_for_llm=json.dumps(result.data, default=str),
            result_type="success",
        )

    err = result.error
    error_payload: dict[str, Any] = {
        "error": err.code,
        "message": err.message,
    }
    if err.suggestion:
        error_payload["suggestion"] = err.suggestion
    if getattr(err, "details", None):
        error_payload["details"] = err.details

    return ToolResult(
        text_result_for_llm=json.dumps(error_payload, default=str),
        result_type="failure",
    )
