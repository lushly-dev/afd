"""botcore-teams — Microsoft Teams bot interface for botcore."""

from __future__ import annotations

from typing import TYPE_CHECKING

from pydantic import BaseModel

from .config import TeamsConfig

if TYPE_CHECKING:
    from botcore.plugin import PluginRegistry

TEAMS_DOCS = """\
# Teams Bot Interface

The Teams plugin connects Microsoft Teams to botcore commands via Azure Bot Service.

## Commands

- **teams_handle_message** — Parse a Teams message and dispatch to the matching command.
  Accepts: `text`, `user_id`, `user_name`, `conversation_id`

- **teams_handle_card_action** — Handle an Adaptive Card button callback.
  Accepts: `action`, `data`, `user_id`

## Intent Patterns

Messages are matched against regex patterns (first match wins):
- `assign/task/run/execute <desc> to @agent` → task_assign
- `status/progress/how going` → task_status
- `team status/agents/who` → team_status
- `cancel/stop/abort` → task_cancel
- `list tasks/queue/backlog` → task_list

## Configuration

botcore.toml:

```toml
[plugins.teams]
app_id = ""
app_password = ""
tenant_id = ""
allowed_groups = []
webhook_path = "/api/messages"
host = "0.0.0.0"
port = 3978

[plugins.teams.roles]
admin_groups = []
user_groups = []
```

pyproject.toml:

```toml
[tool.botcore.plugins.teams]
app_id = ""
app_password = ""
tenant_id = ""
allowed_groups = []
```
"""


class TeamsPlugin:
    """BotCorePlugin for the Microsoft Teams interface."""

    def register(self, registry: PluginRegistry) -> None:
        from .commands import teams_handle_card_action, teams_handle_message

        registry.add_commands([teams_handle_message, teams_handle_card_action])
        registry.set_mcp_name("teams")
        registry.add_docs("teams", TEAMS_DOCS)

    def config_schema(self) -> type[BaseModel] | None:
        return TeamsConfig
