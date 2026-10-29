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

## Configuration

```toml
[tool.botcore.plugins.llm]
default_model = "<model-id>"  # required unless every call passes model=
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
