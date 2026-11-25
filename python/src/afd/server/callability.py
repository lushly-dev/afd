"""Whether a caller can call a command on the server's surface (``spec/recovery.md``, "Engine
errors").

One test decides both the command an engine error's suggestion names and the command its
recovery calls, so the prose and the structure never disagree (rules 1 and 2).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from afd.core.direct_allow import _is_allowed
from afd.server.auth_view import scope_view_of
from afd.server.lazy_tools import NotFoundGuide
from afd.server.relay_wire import in_context

if TYPE_CHECKING:
    from afd.core.commands import CommandContext
    from afd.server.factory import MCPServer


def can_call(
    server: MCPServer,
    name: str,
    context: CommandContext | None,
    active_context: str | None,
    *,
    interface: Any = None,
) -> bool:
    """Whether the caller of ``context`` can call the command ``name`` on this surface:
    registered or served, exposed to its interface, allowed in the active context, admitted by
    any ``allow`` list, and shown under its scope view."""
    command = server._find_command(name)
    if command is None:
        return False
    if interface is None and context is not None and context.extra:
        interface = context.extra.get("interface")
    view = scope_view_of(context) if context is not None else None
    return (
        in_context(command, active_context)
        and (context is None or _is_allowed(context, name))
        and (interface is None or interface == "" or server._is_exposed_to(command, interface))
        and (view is None or view.shown(name))
    )


def not_found_guide(
    server: MCPServer,
    context: CommandContext | None,
    active_context: str | None,
    *,
    remote: bool,
    meta_tools: bool = False,
) -> NotFoundGuide:
    """What an unknown command's suggestion and recovery point to: ``afd-discover`` where the
    caller can call it, which is over MCP (the tool router serves it in every strategy) and
    through an entry point that also routes the meta-tools (``meta_tools``: ``server.execute``
    outside the ``apps`` interface) when any ``allow`` list admits it; else ``afd-help`` when the
    caller can call it (``bootstrap=True``, or a command by that name); else nothing."""
    if remote or (meta_tools and _is_allowed(context, "afd-discover")):
        return "afd-discover"
    if can_call(server, "afd-help", context, active_context):
        return "afd-help"
    return None
