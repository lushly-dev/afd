"""Documentation strings for the agents plugin."""

AGENTS_DOCS = """\
# Agent Orchestration Commands (Phase 1)

Single-agent lifecycle management with LLM-backed task execution.

| Command | Description |
|---------|-------------|
| `agent_create` | Create an agent from config (does not start it) |
| `agent_delete` | Delete a stopped agent from the pool |
| `agent_start` | Start an agent — creates an LLM session |
| `agent_stop` | Stop an agent — destroys session, cancels tasks |
| `agent_status` | Get agent health snapshot |
| `agent_heartbeat` | Update heartbeat timestamp, return health |
| `task_assign` | Assign a task to a running agent (sync execution) |
| `task_resume` | Resume a pending restored task with a running agent |
| `task_status` | Get task details by ID, with partial output while running |
| `state_save` | Persist orchestrator state to configured backend |
| `state_load` | Restore orchestrator state from configured backend |

## Quick Start

```python
# 1. Create and start an agent defined in botcore.toml
await agent_create(name="researcher")
await agent_start(name="researcher")

# 2. Assign a task
result = await task_assign(description="Find performance issues", agent="researcher")
print(result)  # {"task_id": "...", "status": "completed", "result": "..."}

# 3. Check status
await agent_status(name="researcher")
await agent_heartbeat(name="researcher")

# 4. Clean up
await agent_stop(name="researcher")
await agent_delete(name="researcher")
```

## Streaming Task Progress

`task_assign_stream(description, agent="", role="", priority=5)` and
`task_resume_stream(task_id, agent="", role="")` (in `botcore_agents.commands`)
run the same task as afd stream chunks: a progress chunk naming the task id and
agent, the agent's chat progress (tools started), `{"text", "message_id",
"task_id"}` data chunks as the reply arrives, then a complete chunk with what
`task_assign` returns, or an error chunk. `task_assign` and `task_resume`
collect these streams. Closing a stream early aborts the agent's chat turn and
marks the task `cancelled`. They are not registered commands, because
registered commands can be bridged into Copilot tools.

```python
async for chunk in task_assign_stream("Summarize the open PRs", agent="researcher"):
    if chunk.type == "data":
        print(chunk.data["text"], end="")
```

While a task runs, `task_status` also returns `partial_result` (the reply text
streamed so far; the messages of a tool-using turn are separated by a blank
line, and the newest piece shows once the next one arrives) and
`progress_message` (the latest progress, such as `Message sent` or
`Running grep`). They are kept in memory only and dropped when the task
finishes or its agent is stopped; a task restored from saved state restarts
from `pending`.

## Configuration

```toml
[tool.botcore.plugins.agents]
default_model = "<model-id>"  # required; pick an id from llm_model_list
max_agents = 10

[tool.botcore.plugins.agents.state]
enabled = true
path = ".botcore/orchestrator-state.json"
retention_hours = 168
autosave = true

[tool.botcore.plugins.agents.agents.researcher]
name = "researcher"
model = "<model-id>"  # optional; overrides default_model
skills = ["dev_test", "dev_lint"]
max_concurrent_tasks = 2
system_prompt = "You are a research agent."
```

`default_model` has no built-in value. Model IDs are account-specific in the
Copilot runtime; run `llm_model_list` to see the IDs you can use. If neither
`default_model` nor the agent's `model` is set, `agent_start` returns
`CONFIG_ERROR`.
"""
