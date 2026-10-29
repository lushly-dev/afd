# Plan: Teams Chat Interface

> **Status:** Complete
> **Date:** 2026-02-25
> **Updated:** 2026-02-25 — AFD Python parity integration
> **Scope:** Microsoft Teams bot as primary remote interface. Separate botcore plugin package (`botcore-teams`).
> **Depends on:** [Agent Orchestration](../agent-orchestration/00-overview.plan.md) (`botcore-agents`), [Connectors](../connectors/00-overview.plan.md) (`botcore-connectors`, Graph API auth), `afd` Python package (handoff, streaming, middleware)

---

## Summary

A Teams bot that serves as the primary human interface for the agent platform. Users send messages in Teams → the bot parses intent → routes to `task_assign` / `agent_status` / `team_status` commands → renders `CommandResult` as Adaptive Cards.

Unlike openclaw's 10+ channel approach (190 GHSAs), this starts with **one channel** backed by enterprise-grade auth (Azure AD / Entra ID). The Teams bot is a thin adapter layer — all logic lives in botcore commands.

---

## Architecture

```
Teams (Azure Bot Service)
    ↓ Bot Framework webhook
Teams Bot Adapter (this feature)
    ↓ parse intent
botcore commands (task_assign, agent_status, team_status, etc.)
    ↓ CommandResult
Adaptive Card renderer
    ↓ formatted response
Teams (reply to user)
```

### Key Principle: Thin Adapter

The Teams bot does three things:
1. **Parse** — Extract intent + parameters from user message
2. **Route** — Call the appropriate botcore command
3. **Render** — Convert `CommandResult` into an Adaptive Card

All business logic, agent management, and external access lives in botcore. The Teams adapter is stateless and replaceable.

---

## Intent Parsing

```python
# Natural language → botcore command mapping
INTENT_MAP = {
    # Task management
    r"assign|task|do|run|execute|work on": "task_assign",
    r"status|progress|how.+going": "task_status",
    r"cancel|stop|abort": "task_cancel",
    r"list tasks|queue|backlog": "task_list",
    
    # Agent management
    r"agents?|team|who": "team_status",
    r"start agent|wake": "agent_start",
    r"stop agent|sleep": "agent_stop",
    
    # Memory
    r"remember|note|store": "memory_set",
    r"recall|what.+know|search memory": "memory_search",
    
    # Direct chat with specific agent
    r"@(\w+)": "llm_chat",  # @researcher <message> → route to agent
}
```

For ambiguous messages, the bot uses a lightweight LLM call (via the LLM Runtime) to classify intent. This is the only LLM usage in the adapter — everything else is command routing.

---

## Adaptive Card Rendering

`CommandResult` maps cleanly to Adaptive Cards:

```python
def render_command_result(result: CommandResult) -> AdaptiveCard:
    """Convert CommandResult to Teams Adaptive Card."""
    if result.success:
        return AdaptiveCard(
            body=[
                TextBlock(text="✅ " + result.reasoning, weight="bolder"),
                FactSet(facts=_data_to_facts(result.data)),
                # Plan steps (from AFD CommandResult.plan field) — show decomposition
                *([FactSet(facts=[{"title": s["step"], "value": s["status"]} for s in result.plan])]
                  if hasattr(result, 'plan') and result.plan else []),
                # Sources (from AFD CommandResult.sources field) — show citations
                *([TextBlock(text="Sources: " + ", ".join(result.sources))]
                  if hasattr(result, 'sources') and result.sources else []),
                # Confidence indicator if present
                *([TextBlock(text=f"Confidence: {result.confidence:.0%}")]
                  if hasattr(result, 'confidence') and result.confidence else []),
            ],
            actions=_suggest_followups(result),
        )
    else:
        return AdaptiveCard(
            body=[
                TextBlock(text="❌ " + result.error.message, color="attention"),
                TextBlock(text=f"💡 {result.error.suggestion}", wrap=True),
            ],
            actions=[
                ActionSubmit(title="Retry", data={"action": "retry"}),
            ],
        )
```

### Card Templates

| Command | Card Layout |
|---------|-------------|
| `task_assign` | Task ID, assigned agent, status badge, cancel button |
| `task_status` | Progress bar, assigned agent, subtask list, elapsed time |
| `team_status` | Agent table (name, model, status, current task), queue depth |
| `agent_status` | Health indicators, task history, token usage chart |
| `memory_search` | Results list with relevance scores, source attribution |
| `llm_chat` | Agent response text, tool calls made, reasoning (collapsible) |

---

## Authentication

```
Teams user → Azure AD token → Bot Framework → Teams Bot Adapter
                                                    ↓
                                             Validate: user in allowed tenant
                                             Extract: UPN, display name, roles
                                                    ↓
                                             Pass identity to botcore commands
```

### No Custom Auth

- **Azure AD handles identity** — no allowlists, no pairing codes, no custom auth
- **Tenant restriction** — bot only responds to users in configured Azure AD tenant(s)
- **Role mapping** — Azure AD groups → botcore roles (admin, user, viewer)

```toml
# botcore.toml
[teams]
app_id = ""                                # From Azure Bot registration
tenant_id = ""                             # Restrict to this tenant
allowed_groups = ["Agent-Admins", "Agent-Users"]  # Azure AD group names

[teams.roles]
admin_groups = ["Agent-Admins"]            # Can start/stop agents, manage config
user_groups = ["Agent-Users"]              # Can assign tasks, chat with agents
```

---

## Commands (Teams-specific)

```python
# These are thin wrappers — the real logic is in botcore commands

async def teams_handle_message(
    text: str,
    user_id: str,
    user_name: str,
    conversation_id: str,
) -> CommandResult[dict]:
    """Parse intent from Teams message, route to appropriate botcore command."""

async def teams_handle_card_action(
    action: str,
    data: dict,
    user_id: str,
) -> CommandResult[dict]:
    """Handle Adaptive Card button clicks (retry, cancel, approve)."""
```

---

## Package Structure

Shipped as a standalone pip-installable plugin — **not** inside `src/botcore/`.

```
botcore-teams/
├── pyproject.toml                # entry-point: [project.entry-points."botcore.plugins"]
├── src/
│   └── botcore_teams/
│       ├── __init__.py               # BotCorePlugin implementation
│       ├── bot.py                    # Bot Framework adapter (webhook handler)
│       ├── intent.py                 # Message → command routing
│       ├── cards.py                  # CommandResult → Adaptive Card rendering
│       ├── auth.py                   # Azure AD validation, role mapping
│       └── commands.py               # teams_handle_message, teams_handle_card_action
└── tests/
    └── ...
```

### Plugin Registration

```toml
# botcore-teams/pyproject.toml
[project]
name = "botcore-teams"
dependencies = ["botcore", "botcore-agents", "botbuilder-core", "botbuilder-integration-aiohttp", "afd"]

[project.entry-points."botcore.plugins"]
teams = "botcore_teams:TeamsPlugin"
```

```python
# botcore_teams/__init__.py
from botcore.plugin import BotCorePlugin

class TeamsPlugin(BotCorePlugin):
    def register(self, registry):
        from .commands import TEAMS_COMMANDS
        registry.add_commands(TEAMS_COMMANDS)
        registry.set_mcp_name("teams")
        registry.add_docs("teams", TEAMS_DOCS)
```

---

## Phases

### Phase 1: Basic Bot + Task Assignment

- [ ] Scaffold `botcore-teams` plugin package with `pyproject.toml` + entry-point
- [ ] `TeamsPlugin` implementing `BotCorePlugin.register()`
- [ ] Azure Bot Service registration + webhook handler
- [ ] Webhook connection using AFD `create_reconnecting_handoff()` with `ReconnectPolicy` for resilient Bot Framework connectivity
- [ ] Intent parsing (regex-based, no LLM)
- [ ] Route to `task_assign`, `task_status`, `team_status`
- [ ] Basic Adaptive Card rendering for `CommandResult` (including `plan` and `sources` fields)
- [ ] Azure AD tenant restriction
- [ ] Unit tests with mock Bot Framework activity
- [ ] JTBD scenario tests for Teams message workflows (using AFD Python `afd.testing` scenario runner)

**Acceptance criteria:**
- [ ] User sends "assign research the latest Azure SDK changes to @researcher" → `task_assign` called
- [ ] User sends "team status" → Adaptive Card with agent table
- [ ] User outside tenant → rejected
- [ ] All command results render as readable Adaptive Cards
- [ ] Plan steps render as structured fact sets in Adaptive Cards

### Phase 2: Agent Chat + Rich Cards

- [ ] `@agent_name <message>` → direct `llm_chat` routing
- [ ] Streaming responses using AFD `execute_stream()` + `StreamChunk` (typing indicator → progressive card updates)
- [ ] Rich card templates per command type
- [ ] Card action handlers (retry, cancel, approve)
- [ ] LLM-based intent classification for ambiguous messages

### Phase 3: Proactive Notifications

- [ ] Task completion notifications → Teams channel or DM
- [ ] Agent health alerts (unhealthy, recovered)
- [ ] Scheduled status reports (daily digest card)
- [ ] User-configurable notification preferences

### Phase 4: Approval Workflows

- [ ] Agent requests human approval → Adaptive Card with approve/deny buttons
- [ ] Approval timeout with escalation
- [ ] Audit trail of approvals in Teams conversation

---

## Security Model

| Threat | Mitigation |
|--------|-----------|
| Unauthorized access | Azure AD tenant restriction. No custom auth. |
| Privilege escalation | Role mapping from Azure AD groups. Admin vs user commands gated. |
| Message injection | Intent parser validates against known patterns. LLM fallback is read-only classification. |
| Bot token compromise | Azure Bot Service manages tokens. Rotated automatically. |
| Data leakage in cards | Cards render `CommandResult` — no raw data, no credentials, structured output only. |

---

## AFD Integration Summary

| AFD Module | Used For | Replaces |
|---|---|---|
| `afd.handoff` | `create_reconnecting_handoff()` + `ReconnectPolicy` for resilient Bot Framework webhook connectivity | Manual reconnection logic |
| `afd.streaming` | `execute_stream()` + `StreamChunk` for progressive streaming responses in agent chat | Custom typing indicator + update loop |
| `afd.middleware` | `compose_middleware()` for intent parsing and auth validation pipeline | Inline middleware in bot handler |
| `CommandResult.plan` | Render decomposition plans as structured fact sets in Adaptive Cards | Custom plan rendering |
| `CommandResult.sources` | Render research citations in Adaptive Cards | Not previously supported |
| `afd.testing` | JTBD scenario tests for Teams message workflows | Ad-hoc pytest fixtures |

---

## Why Teams First (Not Slack, Discord, etc.)

| Factor | Teams | Others |
|--------|-------|--------|
| Auth | Azure AD built-in, same tenant | Custom OAuth per platform |
| Enterprise | Standard at Microsoft | Varies |
| Adaptive Cards | Rich, interactive, updatable | Platform-specific formatting |
| Graph API | Unified backend for email, calendar, files | Separate APIs per integration |
| Security | Managed by Azure Bot Service | Self-managed webhooks |

Additional channels can be added later as botcore connectors following the same thin-adapter pattern. Each channel adapter is ~200 lines — parse, route, render.
