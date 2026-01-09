# Agent Behavior

> Part 4 of [Handoff Pattern Spec](./00-overview.md)

## How AI Agents Handle Handoffs

AI agents (Claude, GPT, Gemini, etc.) receive the same `HandoffResult` as human UIs. However, their capabilities differ.

## Agent Capability Levels

| Level | Description | Can Handle Handoff? |
|-------|-------------|---------------------|
| **L1: Text-Only** | Chat interface, no code execution | ❌ No - Report to user |
| **L2: Tool Calling** | Can execute commands, no I/O | ⚠️ Partial - Can initiate, can't consume |
| **L3: Runtime Agent** | Runs in process, can open connections | ✅ Yes - Full handoff support |

Most current AI agents are **L2**: they can call `chat-connect` but can't open a WebSocket.

## Recommended Agent Behavior

### L1/L2: Report Handoff to User

When an agent receives a handoff it can't consume:

```typescript
// Agent calls handoff command
const result = await call('chat-connect', { roomId: 'room-123' });

if (result.success && isHandoff(result.data)) {
  // Agent can't consume the handoff directly
  // Report it to the user
  return {
    message: `I've initiated a chat session. To connect:
    
**Protocol**: ${result.data.protocol}
**URL**: ${result.data.endpoint}
**Session ID**: ${result.data.credentials?.sessionId}

The session expires at ${result.data.metadata?.expiresAt}. 
You can connect using a WebSocket client.`,
    
    // Structured data for UI to render
    handoff: result.data,
  };
}
```

### L3: Full Handoff Consumption

Runtime agents can connect:

```typescript
// Agent running in Node.js with WebSocket capability
const result = await call('chat-connect', { roomId: 'room-123' });

if (result.success && isHandoff(result.data)) {
  const connection = await connectHandoff(result.data, {
    onMessage: (msg) => {
      // Process incoming messages
      if (msg.type === 'question') {
        // Generate response
        const response = await generateResponse(msg.text);
        connection.send({ type: 'message', text: response });
      }
    },
  });
  
  // Agent is now participating in real-time chat
}
```

## Capability Declaration

Agents should declare their handoff capabilities:

```typescript
// Agent configuration
const agentCapabilities = {
  handoff: {
    consume: ['websocket'],  // Can handle WebSocket handoffs
    initiate: true,          // Can call handoff commands
    delegate: true,          // Can report handoffs to user
  },
};

// When discovering commands
const commands = await call('afd-help', {
  // Only show handoffs I can handle
  handoffCapabilities: agentCapabilities.handoff.consume,
});
```

## Handoff in Agent Hints

Commands should include `_agentHints` for handoff guidance:

```typescript
return success<HandoffResult>({
  protocol: 'websocket',
  endpoint: 'wss://...',
  // ...
}, {
  reasoning: 'Session created. Connect to receive real-time messages.',
  _agentHints: {
    handoffType: 'websocket',
    consumable: false,  // Most agents can't consume
    delegateToUser: true,
    userActionRequired: 'Connect to WebSocket URL',
    fallbackAction: 'Use chat-poll command for polling-based access',
  },
});
```

## Fallback Commands

Provide non-handoff alternatives for L1/L2 agents:

| Handoff Command | Fallback Command | Description |
|-----------------|------------------|-------------|
| `chat-connect` | `chat-poll` | Poll for messages periodically |
| `events-subscribe` | `events-list` | List recent events |
| `canvas-start` | `canvas-snapshot` | Get current canvas state |

```typescript
// chat-poll: Alternative to WebSocket for agents
defineCommand({
  name: 'chat-poll',
  description: 'Poll for new messages (fallback for agents that cannot use chat-connect)',
  tags: ['chat', 'read', 'agent-friendly'],
  inputSchema: z.object({
    roomId: z.string(),
    since: z.string().optional().describe('Last message ID seen'),
    limit: z.number().default(50),
  }),
  async handler(input, ctx) {
    const messages = await ctx.chatService.getMessages({
      roomId: input.roomId,
      after: input.since,
      limit: input.limit,
    });
    
    return success({
      messages,
      hasMore: messages.length === input.limit,
      pollAgainIn: 5000, // Suggest 5 second interval
    }, {
      _agentHints: {
        nextAction: messages.length > 0 
          ? 'Process messages, then poll again with since=last_message_id'
          : 'Wait pollAgainIn ms, then poll again',
      },
    });
  },
});
```

## Agent Session Patterns

### Pattern 1: Delegate to UI

Agent initiates, UI consumes:

```
Agent → chat-connect → HandoffResult → UI renders "Connect" button
                                              ↓
                               User clicks → WebSocket opens
```

### Pattern 2: Polling Fallback

Agent uses polling instead of real-time:

```
Agent → chat-poll (every 5s) → messages → process → respond
              ↓
         Continue polling...
```

### Pattern 3: Hybrid (Event-Driven Agent)

Agent subscribes via webhook or long-poll:

```typescript
// Server-side: Register agent webhook for real-time events
defineCommand({
  name: 'chat-webhook-register',
  tags: ['chat', 'agent-friendly', 'write'],
  inputSchema: z.object({
    roomId: z.string(),
    webhookUrl: z.string().url(),
    events: z.array(z.string()).default(['message']),
  }),
  async handler(input, ctx) {
    const subscription = await ctx.chatService.registerWebhook({
      roomId: input.roomId,
      url: input.webhookUrl,
      events: input.events,
    });
    
    return success({
      subscriptionId: subscription.id,
      expiresAt: subscription.expiresAt,
    }, {
      reasoning: 'Webhook registered. Events will be POSTed to your URL.',
      _agentHints: {
        deliveryMethod: 'webhook',
        expectedEvents: input.events,
      },
    });
  },
});
```

## MCP Integration

When serving via MCP (stdio), handoffs have specific constraints:

1. **MCP is request-response** - Handoff URL is returned, but MCP transport can't consume it
2. **Agent decides** - The LLM (Claude, GPT) decides whether to report to user or attempt connection
3. **Tool metadata** - MCP tool schema should include handoff hints:

```json
{
  "name": "chat-connect",
  "description": "Connect to a chat room for real-time messaging. Returns a WebSocket URL that requires a separate connection.",
  "inputSchema": { ... },
  "annotations": {
    "handoff": true,
    "handoffProtocol": "websocket",
    "agentConsumable": false,
    "fallbackCommand": "chat-poll"
  }
}
```
