# Agent Capability Declarations

## Problem

Agents need explicit tool scoping. Without capability declarations, every agent session would see every connector command exposed through the shared botcore namespace, making least-privilege impossible.

## Solution

Ship capability declarations directly on `AgentConfig` and resolve the bridged tool list at session creation time.

The implemented design uses three fields together:

- `skills` for explicit non-connector tools the agent should always receive
- `connectors` for prefix-based connector access such as `github_*`
- `connector_commands` for an exact connector command override

## Status

| Field | Value |
|---|---|
| Status | Complete |
| Author | AI-assisted |
| Date | 2026-02-26 |
| Completed | 2026-03-13 |
| Priority | Foundation |

## Implemented Design

### AgentConfig

Capability declarations are implemented in `packages/botcore-agents/src/botcore_agents/config.py`:

```python
class AgentConfig(BaseModel):
    name: str = ""
    role: str = ""
    model: str = ""
    skills: list[str] = Field(default_factory=list)
    connectors: list[str] = Field(default_factory=list)
    connector_commands: list[str] = Field(default_factory=list)
    ...
```

### Tool Resolution

`AgentOrchestrator._resolve_tools()` builds the final tool list passed to `llm_session_create()`:

1. Start with `config.skills`
2. If `connector_commands` is non-empty, use those exact connector commands
3. Else if `connectors` is empty, expose no connector commands
4. Else if `connectors` contains `"*"`, expose all commands matching known connector prefixes
5. Else prefix-filter namespace command names by each declared connector

This is intentionally deny-by-default for connectors. Agents only receive:

- explicitly listed skills
- explicitly resolved connector commands

There is no implicit fallback to "all commands."

### Connector Resolution Contract

`resolve_connector_commands()` implements the shipped behavior:

```python
def resolve_connector_commands(
    connectors: list[str],
    connector_commands: list[str],
    namespace: dict[str, Any],
) -> list[str]:
    if connector_commands:
        return list(connector_commands)
    if not connectors:
        return []
    if "*" in connectors:
        ...
    prefixes = tuple(f"{c}_" for c in connectors)
    return [k for k in namespace if any(k.startswith(p) for p in prefixes)]
```

Notes:

- Missing names in `connector_commands` log a warning but do not crash startup
- Unknown connector prefixes simply resolve to zero commands
- Wildcard resolution depends on `botcore_connectors.config.KNOWN_CONNECTORS`

### Session Creation

On `start_agent()`, the orchestrator resolves tools once and passes the scoped list into `llm_session_create()`:

```python
result = await llm_session_create(
    model=model,
    tools=self._resolve_tools(state.config),
    system_prompt=system_prompt,
    permissions=state.config.permissions,
    agent_name=name,
)
```

## Config Example

```toml
[agents.researcher]
skills = ["dev_test", "dev_lint"]
connectors = ["github"]

[agents.locked]
skills = ["dev_test"]
# connectors omitted or []
# -> no connector commands exposed

[agents.scoped]
skills = ["dev_test"]
connector_commands = ["github_issue_list"]

[agents.admin]
skills = ["dev_build"]
connectors = ["*"]
```

## Verification

The shipped behavior is covered by focused tests:

- `packages/botcore-agents/tests/test_resolve_connector_commands.py`
- `packages/botcore-agents/tests/test_orchestrator.py`

Covered cases include:

- deny-by-default when `connectors == []`
- prefix filtering for `connectors = ["github"]`
- explicit override via `connector_commands`
- wildcard connector access via `["*"]`
- inherited capability declarations for spawned role instances

## Follow-Ups

Capability declarations are complete for Phase 1. Future work should build on this behavior rather than revisiting the core contract:

- cost-aware routing can inspect declared capabilities before assignment
- async task execution can rely on session-scoped tool visibility
- future connector packages can participate by registering commands with stable prefixes
