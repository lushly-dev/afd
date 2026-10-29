# Agentic Patterns

Design patterns for building autonomous AI agents with tool use, planning, reflection, and multi-agent orchestration.

## Core Agentic Patterns

### 1. ReAct (Reasoning + Acting)

The agent alternates between reasoning about the task and acting (calling tools) in a loop.

`stop_reason == "end_turn"` does not mean the task is finished. Current models (Claude Opus 5.5 especially) can end a turn with a progress report while work remains. Track what the task requires -- a checklist the agent updates through a tool, or a check your code runs -- and when items remain with no stated blocker, send a short "continue" message. Cap these nudges at 2-3 so a genuinely stuck agent still stops. Handle the other stop reasons explicitly:

| `stop_reason` | Meaning | Action |
|---|---|---|
| `tool_use` | Model wants tool results | Run every call; return all results in one user message |
| `end_turn` | Model yielded | Finished only if nothing remains; otherwise nudge (capped) |
| `pause_turn` | A long server-tool turn paused | Resend the conversation unchanged to resume |
| `refusal` | Safety classifier declined | Stop; log `stop_details.category`; don't retry the same request |
| `max_tokens` | Output was cut off | Raise `max_tokens` (thinking counts toward it) |

```python
from anthropic import Anthropic

client = Anthropic()
MODEL = "<model-id>"  # see Model Selection in SKILL.md
MAX_CONTINUES = 2     # nudges after an early end_turn

def extract_text(response) -> str:
    """Join text blocks; skip thinking blocks (thinking is always on)."""
    return "".join(b.text for b in response.content if b.type == "text")

def react_loop(
    query: str,
    tools: list[dict],
    remaining_items,  # (messages) -> list[str]: items neither done nor reported blocked
    max_iterations: int = 10,
) -> str:
    """ReAct loop: reason, act, observe, repeat."""
    messages = [{"role": "user", "content": query}]
    continues = 0

    for _ in range(max_iterations):
        response = client.messages.create(
            model=MODEL,
            max_tokens=16000,
            output_config={"effort": "high"},
            system="You are a helpful assistant. Use tools when needed.",
            tools=tools,
            messages=messages,
        )
        messages.append({"role": "assistant", "content": response.content})

        if response.stop_reason == "refusal":
            return "Request declined."  # log response.stop_details.category
        if response.stop_reason == "max_tokens":
            raise RuntimeError("Response truncated; raise max_tokens")
        if response.stop_reason == "pause_turn":
            continue  # resend as-is to resume the paused turn
        if response.stop_reason == "end_turn":
            remaining = remaining_items(messages)
            if not remaining or continues >= MAX_CONTINUES:
                return extract_text(response)
            continues += 1
            messages.append({
                "role": "user",
                "content": "Continue with: " + "; ".join(remaining)
                + ". If something blocks you, say what it is.",
            })
            continue

        # stop_reason == "tool_use": return every result in a single user message
        tool_results = []
        for block in response.content:
            if block.type == "tool_use":
                result = execute_tool(block.name, block.input)
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": str(result)
                })
        messages.append({"role": "user", "content": tool_results})

    return "Max iterations reached."
```

### TypeScript ReAct Loop

```typescript
const MODEL = "<model-id>"; // see Model Selection in SKILL.md
const MAX_CONTINUES = 2;

async function reactLoop(
  query: string,
  tools: Anthropic.Tool[],
  remainingItems: (messages: Anthropic.MessageParam[]) => string[],
  maxIterations = 10
): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: query },
  ];
  let continues = 0;

  for (let i = 0; i < maxIterations; i++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "high" },
      tools,
      messages,
    });
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "refusal") return "Request declined.";
    if (response.stop_reason === "max_tokens") {
      throw new Error("Response truncated; raise max_tokens");
    }
    if (response.stop_reason === "pause_turn") continue; // resend to resume
    if (response.stop_reason === "end_turn") {
      const remaining = remainingItems(messages);
      if (remaining.length === 0 || continues >= MAX_CONTINUES) {
        return extractText(response);
      }
      continues++;
      messages.push({
        role: "user",
        content: `Continue with: ${remaining.join("; ")}. If something blocks you, say what it is.`,
      });
      continue;
    }

    const toolResults = await Promise.all(
      response.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
        .map(async (block) => ({
          type: "tool_result" as const,
          tool_use_id: block.id,
          content: String(await executeTool(block.name, block.input)),
        }))
    );

    messages.push({ role: "user", content: toolResults });
  }

  return "Max iterations reached.";
}
```

### 2. Planning

Decompose a complex task into a structured plan before execution.

```python
PLANNING_PROMPT = """Break down this task into a numbered plan.
For each step, indicate:
- What to do
- What tool to use (if any)
- What information is needed from previous steps

Task: {task}

Respond with a JSON plan:
{{
  "steps": [
    {{"id": 1, "action": "...", "tool": "...", "depends_on": []}},
    {{"id": 2, "action": "...", "tool": "...", "depends_on": [1]}}
  ]
}}"""

async def plan_and_execute(task: str, tools: list[dict]) -> str:
    """Plan-then-execute pattern."""
    # Step 1: Generate plan
    plan_response = await client.messages.create(
        model=MODEL,
        max_tokens=16000,
        messages=[{"role": "user", "content": PLANNING_PROMPT.format(task=task)}],
        output_config={"format": {"type": "json_schema", "schema": plan_schema}},
    )
    plan = json.loads(extract_text(plan_response))

    # Step 2: Execute steps in dependency order
    results = {}
    for step in topological_sort(plan["steps"]):
        context = {dep: results[dep] for dep in step["depends_on"]}
        results[step["id"]] = await execute_step(step, context, tools)

    # Step 3: Synthesize final answer
    return await synthesize(task, results)
```

### 3. Reflection

A second model pass reviews the output and requests improvements. Current models already check their own work, so default to **no** reflection round. Add one round only when evals show it improves quality for this task, and add a second only with evidence that the first leaves fixable issues.

```python
async def reflect_and_improve(
    task: str,
    max_reflections: int = 0  # raise only when evals show a gain
) -> str:
    """Generate, then optionally review and improve."""
    draft = await generate(task)

    for _ in range(max_reflections):
        reflection = await client.messages.create(
            model=MODEL,
            max_tokens=16000,
            messages=[{
                "role": "user",
                "content": f"""Review this draft for the task: "{task}"

Draft:
{draft}

Check for factual errors or unsupported claims, missing information, and logical inconsistencies.
If the draft is good enough, respond with "APPROVED".
Otherwise, list the specific improvements needed."""
            }]
        )

        reflection_text = extract_text(reflection)
        if "APPROVED" in reflection_text:
            break

        improved = await client.messages.create(
            model=MODEL,
            max_tokens=16000,
            messages=[{
                "role": "user",
                "content": f"""Improve this draft based on the feedback.

Task: {task}
Current draft: {draft}
Feedback: {reflection_text}

Write an improved version."""
            }]
        )
        draft = extract_text(improved)

    return draft
```

### 4. Multi-Agent Orchestration

Coordinate multiple specialized agents under an orchestrator.

```python
from dataclasses import dataclass
from typing import Callable

@dataclass
class Agent:
    name: str
    system_prompt: str
    tools: list[dict]
    model: str = MODEL

class Orchestrator:
    """Route tasks to specialized agents."""

    def __init__(self, agents: dict[str, Agent]):
        self.agents = agents

    async def route(self, task: str) -> str:
        """Determine which agent should handle the task."""
        routing_response = await client.messages.create(
            model=MODEL,
            max_tokens=4096,  # thinking counts toward max_tokens
            output_config={"effort": "low"},  # routing needs little reasoning
            messages=[{
                "role": "user",
                "content": f"""Given these available agents:
{json.dumps({name: a.system_prompt for name, a in self.agents.items()})}

Which agent should handle this task? Respond with just the agent name.
Task: {task}"""
            }]
        )
        return extract_text(routing_response).strip()

    async def execute(self, task: str) -> str:
        """Route and execute a task."""
        agent_name = await self.route(task)
        agent = self.agents[agent_name]

        response = await client.messages.create(
            model=agent.model,
            max_tokens=16000,
            system=agent.system_prompt,
            tools=agent.tools,
            messages=[{"role": "user", "content": task}]
        )
        return extract_text(response)

# Usage
orchestrator = Orchestrator({
    "researcher": Agent(
        name="researcher",
        system_prompt="You are a research agent. Search for information and summarize findings.",
        tools=[search_tool, scrape_tool]
    ),
    "coder": Agent(
        name="coder",
        system_prompt="You are a coding agent. Write, review, and debug code.",
        tools=[file_read_tool, file_write_tool, run_test_tool]
    ),
    "analyst": Agent(
        name="analyst",
        system_prompt="You are a data analyst. Analyze data and produce insights.",
        tools=[query_db_tool, chart_tool]
    ),
})
```

### TypeScript Multi-Agent

```typescript
interface Agent {
  name: string;
  systemPrompt: string;
  tools: Anthropic.Tool[];
  model?: string;
}

class Orchestrator {
  private agents: Map<string, Agent>;

  constructor(agents: Agent[]) {
    this.agents = new Map(agents.map((a) => [a.name, a]));
  }

  async route(task: string): Promise<string> {
    const agentDescriptions = Object.fromEntries(
      [...this.agents.entries()].map(([name, agent]) => [
        name,
        agent.systemPrompt,
      ])
    );

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096, // thinking counts toward max_tokens
      output_config: { effort: "low" }, // routing needs little reasoning
      messages: [
        {
          role: "user",
          content: `Which agent handles this? Agents: ${JSON.stringify(agentDescriptions)}\nTask: ${task}`,
        },
      ],
    });

    return extractText(response).trim();
  }

  async execute(task: string): Promise<string> {
    const agentName = await this.route(task);
    const agent = this.agents.get(agentName)!;
    return reactLoop(task, agent.tools);
  }
}
```

## Agent Loop Safety

### Iteration Limits

Always cap the number of iterations to prevent runaway loops.

```python
MAX_ITERATIONS = 10        # ReAct loops
MAX_REFLECTIONS = 1        # Reflection rounds (0 unless evals show a gain)
MAX_CONTINUES = 2          # "Continue" nudges after an early end_turn
MAX_PLANNING_DEPTH = 5     # Nested sub-task decomposition
TOOL_CALL_TIMEOUT = 30     # Seconds per tool call
TOTAL_TIMEOUT = 300        # Seconds for entire agent run
```

### Token Budget Tracking

```python
class TokenBudget:
    def __init__(self, max_tokens: int = 100_000):
        self.max_tokens = max_tokens
        self.used_input = 0
        self.used_output = 0

    def track(self, response):
        self.used_input += response.usage.input_tokens
        self.used_output += response.usage.output_tokens

    @property
    def remaining(self) -> int:
        return self.max_tokens - self.used_input - self.used_output

    @property
    def exhausted(self) -> bool:
        return self.remaining <= 0
```

### Error Recovery

```python
async def safe_tool_call(tool_name: str, tool_input: dict, retries: int = 2) -> str:
    """Execute a tool call with retry and fallback."""
    for attempt in range(retries + 1):
        try:
            result = await asyncio.wait_for(
                execute_tool(tool_name, tool_input),
                timeout=30
            )
            return str(result)
        except asyncio.TimeoutError:
            if attempt == retries:
                return f"ERROR: Tool '{tool_name}' timed out after {retries + 1} attempts"
        except Exception as e:
            if attempt == retries:
                return f"ERROR: Tool '{tool_name}' failed: {str(e)}"
            await asyncio.sleep(2 ** attempt)  # Exponential backoff
```

## Choosing the Right Pattern

| Pattern | Use When | Complexity | Token Cost |
|---|---|---|---|
| **Single LLM call** | Simple tasks, classification, extraction | Low | Low |
| **ReAct loop** | Tasks needing external data or actions | Medium | Medium |
| **Planning** | Complex multi-step tasks with dependencies | High | High |
| **Reflection** | Quality-critical outputs where evals show a second pass helps | Medium | Medium-High |
| **Multi-agent** | Diverse capabilities, team-like workflows | High | High |
| **Orchestrator + workers** | Production systems with clear task routing | High | Variable |

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| Unlimited loops | Runaway cost and latency | Set MAX_ITERATIONS |
| Treating `end_turn` as done | Agent stops after a progress report with work left | Check remaining items; nudge up to MAX_CONTINUES |
| Reflection by default | Extra cost; current models already self-check | Add a round only when evals show a gain |
| No error handling | Single tool failure kills the agent | Wrap tool calls in try/catch |
| Monolithic agent | One agent does everything poorly | Specialize and orchestrate |
| No observability | Cannot debug agent decisions | Log every reasoning step and tool call |
| Hardcoded routing | Cannot adapt to new task types | Use LLM-based routing or classifiers |
| No human escalation | Agent loops on tasks it cannot solve | Detect repeated failures, escalate |
