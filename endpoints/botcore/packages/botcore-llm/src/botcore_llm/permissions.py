"""Permission gate for LLM sessions.

Produces a handler compatible with ``SessionConfig.on_permission_request``
that enforces the :class:`LlmPermissionsConfig` policy.

Botcore never runs a shell command itself: the Copilot runtime runs the approved command
text in its own shell. The shell allowlist therefore judges that raw text and admits only
a line every shell reads as one simple command with literal arguments.
"""

from __future__ import annotations

import fnmatch
import logging
import shlex
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
                cmd = getattr(request, "full_command_text", "") or ""
                refusal = check_shell_command(cmd, shell_allowlist)
                if refusal is not None:
                    logger.debug(
                        "Permission denied: shell command %r refused, %s (agent=%s)",
                        cmd,
                        refusal,
                        agent_name,
                    )
                    return PermissionDecisionReject(
                        feedback=(
                            "Shell command refused by botcore permission policy: "
                            f"{refusal}. {_SHELL_SUGGESTION}"
                        )
                    )
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


_SHELL_SUGGESTION = (
    "Run one allowlisted program with plain arguments, one command per request, and quote "
    "any argument that holds shell characters"
)

# Characters with a shell meaning outside quotes: command separators, pipes, redirections,
# subshells and grouping, expansion, escapes, globs and history.
_UNQUOTED_FORBIDDEN = {
    ";": "a command separator (;)",
    "&": "a command separator or background operator (&)",
    "|": "a pipe or command separator (|)",
    ">": "a redirection (>)",
    "<": "a redirection (<)",
    "(": "a subshell or substitution (()",
    ")": "a subshell or substitution ())",
    "{": "a brace group or expansion ({)",
    "}": "a brace group or expansion (})",
    "$": "a variable or command substitution ($)",
    "`": "a command substitution (`)",
    "\\": "a backslash escape (\\)",
    "*": "a glob (*)",
    "?": "a glob (?)",
    "[": "a glob ([)",
    "]": "a glob (])",
    "!": "history expansion or negation (!)",
}
# Inside double quotes a shell still expands these; PowerShell also escapes with a backtick.
_DOUBLE_QUOTED_FORBIDDEN = {
    "$": "a variable or command substitution ($) inside double quotes",
    "`": "a command substitution or escape (`) inside double quotes",
    "\\": "a backslash escape (\\) inside double quotes",
}
# PowerShell reads typographic quotes as quotes and POSIX shells do not, so the two would
# disagree about what is quoted.
_TYPOGRAPHIC_QUOTES = frozenset("‘’‚‛“”„‟")
_LINE_BREAKS = frozenset("\n\r\x0b\x0c\x85  ")
_EMPTY = "the command is empty"


def _shell_refusal(command: str) -> str | None:
    """Why *command* is not one simple command with literal arguments, or ``None``.

    Scans the raw text the runtime's shell receives with POSIX quoting rules: a character
    with a shell meaning outside quotes, or an expansion inside double quotes, refuses it.
    """
    if not command or not command.strip():
        return _EMPTY
    quote: str | None = None
    word_start = True
    for index, char in enumerate(command):
        if char in _LINE_BREAKS:
            return "a line break"
        if (ord(char) < 0x20 and char != "\t") or ord(char) == 0x7F:
            return "a control character"
        if char in _TYPOGRAPHIC_QUOTES:
            return "a typographic quote"
        if quote == "'":
            if char == "'":
                quote = None
            continue
        if quote == '"':
            if char == '"':
                quote = None
            elif char in _DOUBLE_QUOTED_FORBIDDEN:
                return _DOUBLE_QUOTED_FORBIDDEN[char]
            continue
        if char in ("'", '"'):
            quote = char
            word_start = False
            continue
        if char in _UNQUOTED_FORBIDDEN:
            return _UNQUOTED_FORBIDDEN[char]
        if char in (" ", "\t"):
            word_start = True
            continue
        if word_start and char == "#":
            return "a comment (#)"
        if char == "~" and (word_start or command[index - 1] in "=:"):
            return "a home-directory expansion (~)"
        word_start = False
    if quote is not None:
        return "an unterminated quote"
    return None


def _parse_shell_command(command: str) -> tuple[list[str] | None, str | None]:
    """Parse *command* into one argv list, or return why it cannot be one."""
    reason = _shell_refusal(command)
    if reason is not None:
        return None, reason
    try:
        argv = shlex.split(command, comments=False, posix=True)
    except ValueError as exc:
        return None, f"text that does not parse ({exc})"
    if not argv:
        return None, _EMPTY
    return argv, None


def _argv_matches(argv: list[str], pattern: str) -> bool:
    """Match *argv* against one allowlist pattern.

    The pattern's first word must equal the program, ``argv[0]`` (or match it as a glob when
    the pattern writes one). The whole pattern is then an ``fnmatch`` glob over the argv
    rejoined with ``shlex.join``, so a quoted argument stays one argument.
    """
    words = pattern.split()
    if not words or not fnmatch.fnmatchcase(argv[0], words[0]):
        return False
    return fnmatch.fnmatchcase(shlex.join(argv), " ".join(words))


def check_shell_command(command: str, allowlist: list[str]) -> str | None:
    """Why *allowlist* refuses *command*, or ``None`` when it allows it.

    The command line must be one simple command: no line break, separator (``;``, ``&``,
    ``&&``, ``||``), pipe, redirection, subshell, substitution, expansion, escape or glob
    outside quotes, and no expansion inside double quotes. Pipelines and command lists are
    refused, since an allowlist entry names one program. The argv ``shlex`` parses must then
    match an allowlist pattern.
    """
    argv, reason = _parse_shell_command(command)
    if argv is None:
        return reason if reason == _EMPTY else f"the command line contains {reason}"
    if not any(_argv_matches(argv, pattern) for pattern in allowlist):
        return f"{argv[0]!r} with these arguments matches no shell_allowlist entry"
    return None


def _matches_shell_allowlist(command: str, allowlist: list[str]) -> bool:
    """True when *command* is one simple command that *allowlist* allows."""
    return check_shell_command(command, allowlist) is None


def _path_allowed(requested: str, allowed_paths: list[str]) -> bool:
    """Check if *requested* path falls under any allowed path prefix.

    Both sides are resolved to absolute form via ``Path.resolve()``.
    Uses ``is_relative_to`` to avoid prefix collisions
    (e.g. ``/src-secret`` must not match allowed path ``/src``).
    """
    resolved = Path(requested).resolve()
    return any(resolved.is_relative_to(Path(p).resolve()) for p in allowed_paths)
