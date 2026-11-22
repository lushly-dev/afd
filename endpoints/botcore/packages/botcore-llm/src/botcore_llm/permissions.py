"""Permission gate for LLM sessions.

Produces a handler compatible with ``SessionConfig.on_permission_request``
that enforces the :class:`LlmPermissionsConfig` policy.

Botcore never runs a shell command itself: the Copilot runtime runs the approved command
text in its own shell (a POSIX shell, or PowerShell on Windows). With a shell allowlist,
the handler approves a request only when

- the raw text is one simple command under POSIX quoting, with no shell operator,
  redirection, substitution, expansion, escape or glob outside quotes and no expansion
  inside double quotes;
- on Windows, the text also holds none of cmd.exe's metacharacters (``& | < > ^ %``
  and ``!``) anywhere, even inside quotes, because ``.cmd`` shims such as ``npm`` or
  ``pnpm`` re-read their arguments through ``cmd /c``;
- the runtime's own parse agrees: exactly one command, the same program and arguments,
  and no redirection;
- the parsed program equals an allowlist pattern's first word and the pattern matches.

On any other platform, or when the runtime sends no parse, the request is refused. These
checks bound what a model can ask the runtime to run; they are not a sandbox, and a
pattern such as ``git *`` still admits every option the program has.
"""

from __future__ import annotations

import fnmatch
import logging
import os
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


def _shell_kind() -> str | None:
    """The shell family the runtime runs commands in here, or ``None`` when unknown."""
    if os.name == "posix":
        return "posix"
    if os.name == "nt":
        return "windows"
    return None


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
    mcp_servers = frozenset(getattr(config, "mcp_servers", None) or ())

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
                refusal = check_shell_request(request, shell_allowlist)
                if refusal is not None:
                    logger.debug(
                        "Permission denied: shell command %r refused, %s (agent=%s)",
                        getattr(request, "full_command_text", ""),
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
            server = getattr(request, "server_name", None)
            if config.allow_mcp and isinstance(server, str) and server in mcp_servers:
                return _APPROVED
            logger.debug("Permission denied: mcp server %r (agent=%s)", server, agent_name)
            return PermissionDecisionReject(
                feedback=(
                    f"MCP server {server!r} is not allowed by botcore permission policy. "
                    "Name it in the agent's permissions.mcp_servers to allow its tools"
                )
            )

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
# cmd.exe, which runs Windows .cmd shims, reads these even inside quotes.
_CMD_FORBIDDEN = {
    "&": "a cmd.exe command separator (&)",
    "|": "a cmd.exe pipe (|)",
    "<": "a cmd.exe redirection (<)",
    ">": "a cmd.exe redirection (>)",
    "^": "a cmd.exe escape (^)",
    "%": "a cmd.exe variable expansion (%)",
    "!": "a cmd.exe delayed expansion (!)",
}
# PowerShell reads typographic quotes as quotes and POSIX shells do not, so the two would
# disagree about what is quoted.
_TYPOGRAPHIC_QUOTES = frozenset("‘’‚‛“”„‟")
_LINE_BREAKS = frozenset("\n\r\x0b\x0c\x85  ")
_EMPTY = "the command is empty"


def _shell_refusal(command: str, *, windows: bool = False) -> str | None:
    """Why *command* is not one simple command with literal arguments, or ``None``.

    Scans the raw text the runtime's shell receives with POSIX quoting rules: a character
    with a shell meaning outside quotes, or an expansion inside double quotes, refuses it.
    With *windows*, cmd.exe metacharacters refuse it anywhere, quoted or not.
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
        if windows and char in _CMD_FORBIDDEN:
            return f"{_CMD_FORBIDDEN[char]}, which Windows .cmd shims read even inside quotes"
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


def _parse_shell_command(
    command: str, *, windows: bool = False
) -> tuple[list[str] | None, str | None]:
    """Parse *command* into one argv list, or return why it cannot be one."""
    reason = _shell_refusal(command, windows=windows)
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

    The pattern's first word must equal the program, ``argv[0]``, literally. The whole
    pattern is then an ``fnmatch`` glob over the argv rejoined with ``shlex.join``, so a
    quoted argument stays one argument.
    """
    words = pattern.split()
    if not words or argv[0] != words[0]:
        return False
    return fnmatch.fnmatchcase(shlex.join(argv), " ".join(words))


def check_shell_command(
    command: str, allowlist: list[str], *, shell: str | None = "detect"
) -> str | None:
    """Why *allowlist* refuses *command*, or ``None`` when it allows it.

    The command line must be one simple command: no line break, separator (``;``, ``&``,
    ``&&``, ``||``), pipe, redirection, subshell, substitution, expansion, escape or glob
    outside quotes, and no expansion inside double quotes; on Windows (*shell* is
    ``"windows"``), no cmd.exe metacharacter anywhere. Pipelines and command lists are
    refused, since an allowlist entry names one program. The argv ``shlex`` parses must then
    match an allowlist pattern whose first word is that program. *shell* defaults to this
    platform's; an unknown shell refuses every command.
    """
    argv, reason = _parse_command_for(command, shell)
    if argv is None:
        return reason
    return _allowlist_refusal(argv, allowlist)


def _parse_command_for(command: str, shell: str | None) -> tuple[list[str] | None, str | None]:
    kind = _shell_kind() if shell == "detect" else shell
    if kind not in ("posix", "windows"):
        return None, "the runtime's shell on this platform is not one botcore can check"
    argv, reason = _parse_shell_command(command, windows=kind == "windows")
    if argv is None:
        return None, reason if reason == _EMPTY else f"the command line contains {reason}"
    return argv, None


def _allowlist_refusal(argv: list[str], allowlist: list[str]) -> str | None:
    if not any(_argv_matches(argv, pattern) for pattern in allowlist):
        return f"{argv[0]!r} with these arguments matches no shell_allowlist entry"
    return None


def _identifier_agrees(identifier: Any, argv: list[str]) -> bool:
    """Whether the runtime's command identifier (a program, or program and subcommand)
    names the start of *argv*."""
    if not isinstance(identifier, str):
        return False
    words = identifier.split()
    return bool(words) and words == argv[: len(words)]


def _runtime_parse_refusal(request: Any, argv: list[str]) -> str | None:
    """Why the runtime's own parse of a shell request disagrees with *argv*, or ``None``."""
    commands = getattr(request, "commands", None)
    if not isinstance(commands, list):
        return "the runtime sent no parsed command list"
    if len(commands) != 1:
        return f"the runtime parsed {len(commands)} commands, not one"
    if getattr(request, "has_write_file_redirection", None) is not False:
        return "the runtime reports a redirection, or did not say"
    if not _identifier_agrees(getattr(commands[0], "identifier", None), argv):
        return "the runtime parsed a different program"
    segments = getattr(request, "command_segments", None)
    if segments is None:
        return None
    if not isinstance(segments, list) or len(segments) != 1:
        return "the runtime parsed more than one command segment"
    segment = segments[0]
    try:
        segment_argv = shlex.split(getattr(segment, "full_command_text", None) or "")
    except ValueError:
        return "the runtime's command segment does not parse"
    if segment_argv != argv or not _identifier_agrees(getattr(segment, "identifier", None), argv):
        return "the runtime parsed different arguments"
    return None


def check_shell_request(
    request: Any, allowlist: list[str], *, shell: str | None = "detect"
) -> str | None:
    """Why *allowlist* refuses a shell permission *request*, or ``None`` when it allows it.

    Applies :func:`check_shell_command` to the request's ``full_command_text`` and then
    requires the runtime's own parse (``commands``, ``command_segments`` and
    ``has_write_file_redirection``) to agree with it.
    """
    command = getattr(request, "full_command_text", None)
    if not isinstance(command, str):
        return "the request carries no command text"
    argv, reason = _parse_command_for(command, shell)
    if argv is None:
        return reason
    reason = _runtime_parse_refusal(request, argv)
    if reason is not None:
        return reason
    return _allowlist_refusal(argv, allowlist)


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
