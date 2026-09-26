"""Names of the tools an AFD MCP server provides itself.

These are not the application's commands. Servers reserve them, and tooling
that inspects a remote server (such as ``afd validate --surface``) skips them.
The same names are defined in ``@lushly-dev/afd-core`` (``AFD_BUILTIN_TOOL_NAMES``).
"""

META_TOOL_NAMES: frozenset[str] = frozenset(
    {"afd-call", "afd-batch", "afd-pipe", "afd-discover", "afd-detail"}
)
"""Tools the server's tool router handles itself."""

BOOTSTRAP_COMMAND_NAMES: frozenset[str] = frozenset({"afd-help", "afd-docs", "afd-schema"})
"""Discovery commands registered by the bootstrap option."""

CONTEXT_COMMAND_NAMES: frozenset[str] = frozenset(
    {"afd-context-list", "afd-context-enter", "afd-context-exit"}
)
"""Context commands registered when a server configures contexts."""

BUILTIN_TOOL_NAMES: frozenset[str] = META_TOOL_NAMES | BOOTSTRAP_COMMAND_NAMES | CONTEXT_COMMAND_NAMES
"""Every tool or command name an AFD server provides itself."""


def is_builtin_name(name: str) -> bool:
    """Whether ``name`` is a tool or command that AFD servers provide themselves."""
    return name in BUILTIN_TOOL_NAMES
