"""botcore-llm — LLM runtime plugin for botcore."""

from __future__ import annotations

from typing import TYPE_CHECKING

from pydantic import BaseModel

from .config import LlmConfig

if TYPE_CHECKING:
    from botcore.plugin import PluginRegistry

LLM_DOCS = """\
# LLM Runtime Commands

| Command | Description |
|---------|-------------|
| `llm_session_create` | Create a new LLM session with bridged botcore tools |
| `llm_session_destroy` | Destroy an LLM session and release resources |
| `llm_session_list` | List active LLM sessions |
| `llm_model_list` | List available models from Copilot CLI |
| `llm_chat` | Send a message to an active LLM session |

## Streaming

`llm_chat_stream(session_id, message, attachments=None, timeout=None)` in
`botcore_llm.chat_stream` yields the same turn as afd stream chunks: progress
(message sent, each tool started), then `{"text", "message_id"}` data chunks as
the reply arrives, then a complete chunk with `session_id`, `message_id` and
`content`, or an error chunk. A turn that uses tools can stream several
assistant messages; `content` is the final one. `llm_chat` collects the stream
into a single result. Closing the stream early, or cancelling `llm_chat`, aborts
the turn. It is not a registered command, because registered
commands are bridged into Copilot tools, which return one result.

## Tools

`llm_session_create(tools=[...])` serves the named commands to the model through a
managed Botcore host, so every tool call enters `host.execute` under the host's command
policies and profile, as a CLI or MCP `afd-call` does. A call the policy refuses (for example
`EFFECT_DENIED`) reaches the model as that error and its suggestion. By default the host
covers the current workspace with the `inspection` profile and serves the admitted core
commands plus those of the connectors plugin when it is installed; `tool_profile` and
`tool_plugins` change it, and a Python embedder can pass its own host to
`botcore_llm.commands.set_tool_host`. A name the host does not serve is
`UNKNOWN_COMMAND`. A setup whose agents call connectors sets `tool_profile =
"remote-caller"` (connectors read `GH_TOKEN` from the environment); one that should let the
model lint, test or write sets `"trusted-local"`. The setting applies to every agent.
The session's `available_tools` lists only the bridged tools and the built-ins its
permissions allow; MCP tools appear only for servers named in `permissions.mcp_servers`.

## Shell permissions

With `allow_shell` and a `shell_allowlist`, each command is approved on its own: a shell
request is approved only when its command line is one simple command. A line break, `;`,
`&`, `&&`, `|`, `||`, a redirection, a subshell, `$` or backtick substitution, a backslash
or a glob outside quotes refuses it, as does `$`, a backtick or a backslash inside double
quotes; on Windows `& | < > ^ % !` are refused even inside quotes. The runtime's own parse
must agree (one command, same arguments, no redirection). The program must equal the
pattern's first word literally, and the rest of the pattern is a glob over the arguments,
so `git *` admits every git option: pin patterns to subcommands (`git status *`).

## Configuration

```toml
[tool.botcore.plugins.llm]
default_model = "<model-id>"  # required unless every call passes model=
tool_profile = "inspection"   # or "remote-caller", "trusted-local"
tool_plugins = ["connectors"] # default: installed host-context-safe plugins among these
```

`default_model` has no built-in value. Model IDs are account-specific in the
Copilot runtime; run `llm_model_list` to see the IDs you can use. Without a
model, `llm_session_create` returns `CONFIG_ERROR`.
"""


class LlmPlugin:
    """BotCorePlugin implementation for LLM runtime."""

    def configure(self, config: LlmConfig) -> None:
        from .commands import set_config

        set_config(config)

    def register(self, registry: PluginRegistry) -> None:
        from .commands import LLM_COMMANDS

        registry.add_commands(LLM_COMMANDS)
        registry.set_mcp_name("llm")
        registry.add_docs("llm", LLM_DOCS)

    def config_schema(self) -> type[BaseModel] | None:
        return LlmConfig


__all__ = ["LlmPlugin", "LlmConfig"]
