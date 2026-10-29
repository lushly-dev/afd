"""Permission gate for LLM sessions.

Produces a handler compatible with ``SessionConfig.on_permission_request``
that enforces the :class:`LlmPermissionsConfig` policy.
"""

from __future__ import annotations

import fnmatch
import logging
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any

from copilot import PermissionRequest, PermissionRequestResult
from copilot.generated.rpc import PermissionDecisionApproveOnce, PermissionDecisionReject

from .config import LlmPermissionsConfig

logger = logging.getLogger(__name__)

# Type alias matching Copilot SDK's _PermissionHandlerFn
PermissionHandlerFn = Callable[
    [PermissionRequest, Any],
    PermissionRequestResult,
]

_APPROVED = PermissionDecisionApproveOnce()


def _denied(kind: str) -> PermissionDecisionReject:
    return PermissionDecisionReject(feedback=f"{kind} is not allowed by botcore permission policy")


def create_permission_handler(
    config: LlmPermissionsConfig,
    *,
    agent_name: str = "",
) -> PermissionHandlerFn:
    """Build a permission handler from the given config.

    The returned function receives a ``PermissionRequest`` dataclass and the
    invocation context, and returns ``PermissionDecisionApproveOnce`` or
    ``PermissionDecisionReject`` based on the request kind.

    Args:
        config: Permission configuration governing what actions are allowed.
        agent_name: Agent name for audit logging.

    Returns:
        A permission handler function for ``SessionConfig.on_permission_request``.
    """
    # Extract allowlist fields (only present on AgentPermissionsConfig subclass)
    shell_allowlist: list[str] | None = getattr(config, "shell_allowlist", None)
    filesystem_paths: list[str] | None = getattr(config, "filesystem_paths", None)

    def handler(
        request: PermissionRequest,
        _invocation: Any,
    ) -> PermissionRequestResult:
        kind = getattr(request, "kind", "")

        # Org-managed policy must approve this request; never override it.
        if getattr(request, "managed_approval_required", None) is True:
            logger.debug(
                "Permission denied: %s needs managed approval (agent=%s)", kind, agent_name
            )
            return _denied(kind)

        if kind == "shell":
            if not config.allow_shell:
                logger.debug("Permission denied: shell (agent=%s)", agent_name)
                return _denied(kind)
            if shell_allowlist is not None:
                cmd = getattr(request, "full_command_text", "")
                if not _matches_shell_allowlist(cmd, shell_allowlist):
                    logger.debug(
                        "Permission denied: shell command %r not in allowlist (agent=%s)",
                        cmd,
                        agent_name,
                    )
                    return _denied(kind)
            return _APPROVED

        if kind in ("write", "read"):
            if not config.allow_filesystem:
                logger.debug("Permission denied: %s (agent=%s)", kind, agent_name)
                return _denied(kind)
            if filesystem_paths is not None:
                # Read requests carry ``path``; write requests carry ``file_name``.
                path = getattr(request, "path", None) or getattr(request, "file_name", "")
                # An empty path would resolve to the working directory, so deny it.
                if not path or not _path_allowed(path, filesystem_paths):
                    logger.debug(
                        "Permission denied: %s path %r not in allowed paths (agent=%s)",
                        kind,
                        path,
                        agent_name,
                    )
                    return _denied(kind)
            return _APPROVED

        if kind == "mcp":
            if config.allow_mcp:
                return _APPROVED
            logger.debug("Permission denied: mcp (agent=%s)", agent_name)
            return _denied(kind)

        if kind == "custom-tool":
            if config.allow_custom_tools:
                return _APPROVED
            logger.debug("Permission denied: custom-tool (agent=%s)", agent_name)
            return _denied(kind)

        if kind == "url":
            # URL fetch requests — deny by default (no config toggle yet)
            logger.debug("Permission denied: url (agent=%s)", agent_name)
            return _denied(kind)

        # Unknown kind — deny by default
        logger.warning("Permission denied for unknown kind: %s (agent=%s)", kind, agent_name)
        return _denied(kind)

    return handler


def _matches_shell_allowlist(command: str, allowlist: list[str]) -> bool:
    """Check if *command* matches the shell allowlist.

    Splits on shell operators (``&&``, ``||``, ``;``, ``|``) and requires
    every non-empty segment to match at least one allowlist pattern via
    ``fnmatch.fnmatch``.

    Denies empty/whitespace-only commands and commands containing subshell
    injection vectors (backticks, ``$()``).
    """
    if not command or not command.strip():
        return False
    # Reject subshell injection vectors that bypass operator splitting
    if re.search(r"`|\$\(", command):
        return False
    segments = re.split(r"\s*(?:&&|\|\||[;|])\s*", command)
    return all(
        any(fnmatch.fnmatch(seg.strip(), pat) for pat in allowlist)
        for seg in segments
        if seg.strip()
    )


def _path_allowed(requested: str, allowed_paths: list[str]) -> bool:
    """Check if *requested* path falls under any allowed path prefix.

    Both sides are resolved to absolute form via ``Path.resolve()``.
    Uses ``is_relative_to`` to avoid prefix collisions
    (e.g. ``/src-secret`` must not match allowed path ``/src``).
    """
    resolved = Path(requested).resolve()
    return any(resolved.is_relative_to(Path(p).resolve()) for p in allowed_paths)
