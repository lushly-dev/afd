# Part 6: Future Phases (Not Committed)

> **Status**: NOT COMMITTED - Path preserved for future exploration
> 
> This document contains specifications for features that are deferred to later phases. The designs are captured here to ensure compatibility paths remain open, but implementation is not scheduled.

---

## Voice Head

The Voice Head enables conversational interaction via Alexa, Google Assistant, or custom voice interfaces.

### Architecture: LLM as Router

```
┌─────────────────────────────────────────────────────────┐
│                      Voice Flow                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  User: "Hey, show me my items"                          │
│           │                                             │
│           ▼                                             │
│  ┌─────────────────┐                                    │
│  │ Speech-to-Text  │  (Alexa/Assistant ASR)             │
│  └────────┬────────┘                                    │
│           │                                             │
│           ▼                                             │
│  ┌─────────────────┐                                    │
│  │ Claude (Router) │  "I should call items.list"        │
│  └────────┬────────┘                                    │
│           │                                             │
│           ▼ MCP tool call                               │
│  ┌─────────────────┐                                    │
│  │ items.list()    │  → CommandResult                   │
│  └────────┬────────┘                                    │
│           │                                             │
│           ▼                                             │
│  ┌─────────────────┐                                    │
│  │ Claude (Render) │  "You have 2 items..."             │
│  └────────┬────────┘                                    │
│           │                                             │
│           ▼                                             │
│  ┌─────────────────┐                                    │
│  │ Text-to-Speech  │                                    │
│  └─────────────────┘                                    │
│                                                         │
│  Assistant: "You have 2 items. First Item is active,    │
│             Second Item is pending."                    │
│                                                         │
└─────────────────────────────────────────────────────────┘

Interaction: Voice only
Commands: MCP via Claude (semantic routing)
Output: Spoken response
```

### Why Deferred

**Latency Concerns:**
- Speech-to-text: ~200-500ms
- Claude inference: ~500-2000ms
- Command execution: ~50-200ms
- Claude response formatting: ~200-500ms
- Text-to-speech: ~100-300ms
- **Total: 1-3.5 seconds** (may exceed acceptable voice UX thresholds)

**Complexity:**
- Requires Alexa/Google Assistant developer accounts
- Platform-specific skill/action configurations
- Ongoing API changes and certification requirements

### Implementation Sketch (When Ready)

```python
# heads/voice/alexa/handler.py
from afd import create_client
from anthropic import Anthropic

anthropic = Anthropic()
mcp_client = create_client("my-app")

async def handle_alexa_request(raw_text: str) -> str:
    """Route voice input through Claude to AFD commands."""
    
    # Get available commands from MCP
    tools = await mcp_client.list_tools()
    
    # Let Claude decide what to do
    response = anthropic.messages.create(
        model="claude-3-5-sonnet-latest",
        max_tokens=500,
        system="""You are a voice assistant for My App. 
        Use the available tools to help users manage their items.
        Be concise - responses will be spoken aloud.""",
        messages=[{"role": "user", "content": raw_text}],
        tools=[{
            "name": t.name,
            "description": t.description,
            "input_schema": t.input_schema
        } for t in tools],
    )
    
    # Execute tool if Claude decided to use one
    if response.stop_reason == "tool_use":
        tool_call = next(b for b in response.content if b.type == "tool_use")
        result = await mcp_client.call_tool(tool_call.name, tool_call.input)
        
        # Let Claude format the result for speech
        follow_up = anthropic.messages.create(
            model="claude-3-5-haiku-latest",
            max_tokens=200,
            messages=[
                {"role": "user", "content": raw_text},
                {"role": "assistant", "content": response.content},
                {"role": "user", "content": f"Tool result: {result}. Summarize briefly for voice."}
            ],
        )
        return follow_up.content[0].text
    
    return response.content[0].text
```

### Configuration (When Ready)

```toml
# mint.toml
[heads.voice]
platforms = ["alexa", "google-assistant"]
wake_word = "my app"
catch_all_routing = true  # Use Claude for intent routing
```

---

## Watch Head

Minimal UI for smartwatches - quick actions and status only.

### Design

```
    ┌─────────────┐
    │  ◷ 10:42   │
    ├─────────────┤
    │   My App    │
    │             │
    │  2 Items    │
    │  ● 1 Active │
    │  ○ 1 Pending│
    │             │
    │   [+ Add]   │
    └─────────────┘

Interaction: Crown, tap, swipe
Commands: Companion app bridge
Output: Complications, notifications
```

### Why Deferred

**ROI Concerns:**
- WatchOS/Wear OS development is complex
- Low usage compared to other platforms
- Requires separate app store submissions
- Ongoing maintenance for OS version updates

**Dependencies:**
- Requires Mobile Head to be complete (companion app)
- Platform-specific SDKs and tooling

### Implementation Sketch (When Ready)

```rust
// Watch head would use Tauri + WatchOS bridge
// Or Flutter watch support

// Minimal watch UI focuses on:
// 1. Complications (glanceable data)
// 2. Notifications (timely alerts)
// 3. Quick actions (1-2 tap operations)
```

---

## Advanced Collaboration Features

Some collaboration features from Part 5 may be deferred:

### CRDT Real-time Mode

While basic sync (`queue` mode) is in Phase C, full CRDT (`realtime` mode) with Automerge may be deferred due to:

- Schema evolution complexity
- Large document performance concerns
- Conflict resolution UX beyond basic "notify"

### Multi-Agent Collaboration

Advanced scenarios where multiple AI agents collaborate in the same workspace may require additional infrastructure:

- Agent identity and permissions
- Rate limiting per agent
- Cost tracking per agent session

---

## Command Versioning (Future Consideration)

**Simple Policy (Recommended when needed):**

Commands are append-only. Breaking changes result in new commands:

```
item.create     # v1 - original
item.create_v2  # v2 - with new required field
```

Deprecations are announced via command metadata:

```rust
#[command(
    name = "item.create",
    deprecated = true,
    deprecated_message = "Use item.create_v2 instead",
    sunset_date = "2026-01-01"
)]
```

**Not implementing now because:**
- Private framework with single consumer (you)
- Can break/fix without coordination
- Add versioning if/when Mint becomes public

---

## Degraded Mode Design (Future)

When services are unavailable, heads should degrade gracefully:

| Head | Degradation Strategy |
|------|---------------------|
| **Web** | Show cached data, queue writes for sync |
| **Desktop** | Full offline support via local SQLite |
| **Mobile** | Queue operations, show "offline" indicator |
| **Voice** | "I'm having trouble connecting. Try again later." |
| **Watch** | Show stale data with timestamp |

**Not implementing detailed degraded modes now because:**
- MVP focuses on "happy path"
- Add resilience after core works

---

## Implementation Notes

When these features are prioritized:

1. **Voice Head**: Start with Alexa (larger market), add Google Assistant after
2. **Watch Head**: Start with WatchOS (better dev tools), add Wear OS after
3. **CRDT**: Consider Automerge alternatives (Yjs, Loro) based on ecosystem maturity
4. **Versioning**: Implement only if Mint becomes shared/public

---

## Related Documents

- [Part 3: UI Heads](./03-ui-heads.md) - Core heads (CLI, Web, Desktop, Mobile, Agent)
- [Part 5: Collaboration & Sync](./05-collaboration-sync.md) - Sync modes including deferred CRDT
