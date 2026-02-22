# Agent-Friendly API Design

Patterns and principles for designing APIs that AI agents can discover, understand, and consume reliably.

## Why Agent-Friendly Matters

AI agents (LLM-based systems using function calling, MCP tools, or direct HTTP) are a growing class of API consumers. Unlike human developers who read documentation and debug interactively, agents must:

- Discover API capabilities at runtime
- Construct valid requests from schema definitions
- Parse structured responses programmatically
- Handle errors and retry autonomously
- Chain multiple API calls to complete workflows

APIs designed only for human developers often fail when consumed by agents due to ambiguous documentation, inconsistent error formats, or undiscoverable capabilities.

## Core Principles

### 1. Machine-Readable Everything

Every aspect of the API must be parseable by machines, not just by humans reading docs.

| Aspect | Human-Friendly Only | Agent-Friendly |
|--------|---------------------|----------------|
| Documentation | Prose on a website | OpenAPI 3.1 spec with examples |
| Errors | "Something went wrong" | RFC 9457 with error codes |
| Navigation | Hyperlinks in docs | HATEOAS links in responses |
| Capabilities | Feature list on landing page | Schema introspection / OpenAPI |
| Deprecation | Blog post announcement | `Deprecation` + `Sunset` headers |
| Rate limits | Pricing page table | `X-RateLimit-*` headers in every response |

### 2. Semantic Clarity

Agents rely on names and descriptions to understand what an endpoint does. Ambiguity causes wrong tool selection or malformed requests.

**Endpoint naming:**
```
GOOD: POST /api/v1/orders/{orderId}/cancel
BAD:  POST /api/v1/orders/{orderId}/update  (with body: { "action": "cancel" })

GOOD: GET /api/v1/users?status=active
BAD:  GET /api/v1/users?filter=status:active  (custom syntax agents must learn)
```

**Field naming:**
```
GOOD: "created_at": "2025-06-15T10:30:00Z"    (ISO 8601, self-describing)
BAD:  "created": 1718450000                     (unix timestamp, ambiguous units)

GOOD: "price_cents": 1999                       (unit in name)
BAD:  "price": 19.99                            (floating point money)
```

### 3. Predictable Response Shapes

Agents parse responses structurally. Every deviation requires special handling.

**Consistent envelope:**
```json
// Success
{
  "data": { ... },
  "meta": { "request_id": "abc-123" }
}

// Error
{
  "type": "https://api.example.com/errors/not-found",
  "title": "Not Found",
  "status": 404,
  "detail": "User usr_999 does not exist."
}

// Collection
{
  "data": [ ... ],
  "pagination": { "has_next": true, "next_cursor": "..." },
  "meta": { "request_id": "abc-124" }
}
```

Never mix formats: if success returns `{ "data": ... }`, errors must not return `{ "error": "..." }`.

### 4. Self-Describing Responses

Include enough context in each response that an agent can determine what to do next without external documentation.

```json
{
  "data": {
    "id": "ord_456",
    "status": "pending_payment",
    "allowed_actions": ["pay", "cancel"],
    "links": {
      "pay": { "href": "/api/v1/orders/ord_456/pay", "method": "POST" },
      "cancel": { "href": "/api/v1/orders/ord_456/cancel", "method": "POST" },
      "self": { "href": "/api/v1/orders/ord_456", "method": "GET" }
    }
  }
}
```

The `allowed_actions` and `links` fields tell the agent exactly what it can do next -- no guessing.

## OpenAPI for Agents

### Spec Requirements

An agent-friendly OpenAPI spec must include:

```yaml
openapi: "3.1.0"
info:
  title: My API
  description: >
    One-paragraph summary of what this API does and its primary use cases.
  version: "1.0.0"

paths:
  /users:
    get:
      operationId: listUsers          # Unique, descriptive ID
      summary: List all users         # Short (used as tool name)
      description: >                  # Detailed (used as tool description)
        Returns a paginated list of users. Supports filtering by status
        and sorting by created_at. Use cursor-based pagination with the
        'after' parameter for large result sets.
      parameters:
        - name: status
          in: query
          description: Filter by user status
          schema:
            type: string
            enum: [active, inactive, suspended]
          example: active             # Always include examples
```

### Critical Fields for Agents

| Field | Why Agents Need It |
|-------|-------------------|
| `operationId` | Used as tool/function name in function calling |
| `summary` | Short label for tool selection |
| `description` | Detailed guidance for parameter construction |
| `examples` | Agents use examples to understand expected formats |
| `enum` | Constrains values, preventing invalid requests |
| `required` | Agents must know which fields to always include |
| `default` | Agents can omit fields with sensible defaults |

### Generating Tools from OpenAPI

Many agent frameworks auto-generate tool definitions from OpenAPI specs:

```
OpenAPI spec -> Function definitions -> LLM function calling
OpenAPI spec -> MCP tool definitions -> MCP server
OpenAPI spec -> Agent tool catalog -> Autonomous agent
```

Quality of the OpenAPI spec directly determines quality of the generated tools. Missing descriptions or examples produce tools that agents misuse.

## MCP (Model Context Protocol) Integration

MCP is the emerging standard for connecting AI agents to external tools and data. When exposing an API as MCP tools:

### Tool Design from API Endpoints

```python
# Map API endpoints to MCP tools
@mcp.tool(
    name="list_users",
    description="List users. Params: status (active|inactive), limit (1-100), after (cursor)."
)
async def list_users(status: str = None, limit: int = 20, after: str = None) -> str:
    response = await api_client.get("/api/v1/users", params={...})
    return format_response(response)
```

### MCP Tool Design Rules

1. **One tool per distinct action** -- `list_users`, `create_user`, `delete_user` (not a single `user_crud` tool)
2. **Simple parameter types** -- Prefer `str`, `int`, `bool` over complex nested objects
3. **Descriptions under 50 tokens** -- Agents load all tool descriptions into context
4. **Include parameter constraints** -- Mention valid ranges, enum values, and defaults in the description
5. **Return structured text** -- Format output as Markdown or structured text, not raw JSON (agents parse text more reliably than deeply nested JSON)

## Workflow Composition

Agents frequently chain multiple API calls. Design for composability:

### Chaining Pattern

```
1. GET  /api/v1/users?email=jane@example.com     -> Get user ID
2. GET  /api/v1/users/{userId}/orders?status=pending  -> Get pending orders
3. POST /api/v1/orders/{orderId}/cancel           -> Cancel the order
```

### Design Rules for Composability

1. **Return IDs in creation responses** -- Agents need the created resource ID immediately
2. **Accept IDs as path parameters** -- Not embedded in request bodies
3. **Cross-reference fields** -- If an order has a `user_id`, include it so agents can navigate between resources
4. **Consistent ID format** -- Use prefixed IDs (`usr_123`, `ord_456`) so agents can identify resource types from the ID alone
5. **Document common workflows** -- Show multi-step sequences in API docs; agents (and the humans building them) benefit from seeing the intended call chains

## Idempotency for Agents

Agents may retry failed requests. Make this safe:

```http
POST /api/v1/orders
Idempotency-Key: idem_abc123

{
  "user_id": "usr_123",
  "items": [...]
}
```

- Accept an `Idempotency-Key` header on all POST/PATCH requests
- Store the key and return the original response on replay
- Keys expire after 24 hours
- Return 409 Conflict if the same key is used with different request bodies

## Testing Agent Consumption

Before releasing an API, validate it works for agent consumers:

1. **Generate tools from OpenAPI** -- Use an auto-generator and verify the tool definitions make sense
2. **Run an agent against the API** -- Give an LLM the tools and ask it to complete a multi-step workflow
3. **Test error recovery** -- Inject 400/429/500 errors and verify the agent retries or reports correctly
4. **Test pagination** -- Verify the agent can iterate through all pages without getting stuck
5. **Test with no documentation** -- Can an agent figure out the API from the OpenAPI spec alone?
