"""Names of the tools an AFD MCP server provides itself.

These are not the application's commands. Servers reserve them, and tooling
that inspects a remote server (such as ``afd validate --surface``) skips them.
The TypeScript (``@lushly-dev/afd-core``), Rust and C++ packages export the
same names.
"""

AFD_META_TOOL_NAMES: frozenset[str] = frozenset(
    {"afd-call", "afd-batch", "afd-pipe", "afd-discover", "afd-detail"}
)
"""Tools the server's tool router handles itself."""

AFD_BOOTSTRAP_COMMAND_NAMES: frozenset[str] = frozenset({"afd-help", "afd-docs", "afd-schema"})
"""Discovery commands registered by the bootstrap option."""

AFD_CONTEXT_COMMAND_NAMES: frozenset[str] = frozenset(
    {"afd-context-list", "afd-context-enter", "afd-context-exit"}
)
"""Context commands registered when a server configures contexts."""

AFD_BUILTIN_TOOL_NAMES: frozenset[str] = (
    AFD_META_TOOL_NAMES | AFD_BOOTSTRAP_COMMAND_NAMES | AFD_CONTEXT_COMMAND_NAMES
)
"""Every tool or command name an AFD server provides itself."""


def is_afd_builtin_name(name: str) -> bool:
    """Whether ``name`` is a tool or command that AFD servers provide themselves."""
    return name in AFD_BUILTIN_TOOL_NAMES
