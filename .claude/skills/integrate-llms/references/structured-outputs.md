# Structured Outputs and Tool Use

Patterns for getting reliable, schema-conformant output from LLMs.

## Structured Outputs

Structured outputs guarantee that model responses conform to a JSON schema by constraining token generation at inference time.

### Claude Structured Outputs

```python
import anthropic

client = anthropic.Anthropic()

response = client.messages.create(
    model="claude-sonnet-4-5-20250514",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Analyze the sentiment of: 'Great product!'"}],
    response_format={
        "type": "json_schema",
        "json_schema": {
            "name": "sentiment_analysis",
            "strict": True,
            "schema": {
                "type": "object",
                "properties": {
                    "sentiment": {
                        "type": "string",
                        "enum": ["positive", "negative", "neutral"]
                    },
                    "confidence": {"type": "number"},
                    "reasoning": {"type": "string"}
                },
                "required": ["sentiment", "confidence", "reasoning"],
                "additionalProperties": False
            }
        }
    }
)
```

**Performance note:** First request with a new schema incurs 100-300ms grammar compilation overhead. The grammar is cached for 24 hours. For production, warm the cache during deployment with a dummy request.

### OpenAI Structured Outputs

```python
from openai import OpenAI
from pydantic import BaseModel

client = OpenAI()

class SentimentResult(BaseModel):
    sentiment: str  # "positive", "negative", "neutral"
    confidence: float
    reasoning: str

response = client.responses.parse(
    model="gpt-4o",
    input="Analyze the sentiment of: 'Great product!'",
    text_format=SentimentResult
)

result = response.output_parsed  # Typed SentimentResult
```

### TypeScript (OpenAI)

```typescript
import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";

const SentimentResult = z.object({
  sentiment: z.enum(["positive", "negative", "neutral"]),
  confidence: z.number(),
  reasoning: z.string(),
});

const response = await openai.responses.parse({
  model: "gpt-4o",
  input: "Analyze the sentiment of: 'Great product!'",
  text_format: zodResponseFormat(SentimentResult, "sentiment_analysis"),
});

const result = response.output_parsed; // Typed object
```

### When to Use Structured Outputs vs Prompting

| Approach | Use When |
|---|---|
| Structured outputs (schema) | Need guaranteed schema compliance, parsing reliability |
| Prompt-based JSON | Schema not supported, need flexibility, prototyping |
| Tool use / function calling | Model decides when to call, integrating with external systems |

## Tool Use / Function Calling

Tools let the model invoke external functions when it determines they are needed.

### Claude Tool Use

```python
import anthropic

client = anthropic.Anthropic()

tools = [
    {
        "name": "get_weather",
        "description": "Get current weather for a city.",
        "input_schema": {
            "type": "object",
            "properties": {
                "city": {"type": "string", "description": "City name"},
                "units": {
                    "type": "string",
                    "enum": ["celsius", "fahrenheit"],
                    "description": "Temperature units"
                }
            },
            "required": ["city"]
        }
    }
]

response = client.messages.create(
    model="claude-sonnet-4-5-20250514",
    max_tokens=1024,
    tools=tools,
    messages=[{"role": "user", "content": "What's the weather in Tokyo?"}]
)

# Process tool use blocks
for block in response.content:
    if block.type == "tool_use":
        tool_name = block.name       # "get_weather"
        tool_input = block.input     # {"city": "Tokyo"}
        tool_use_id = block.id       # For returning results

        # Execute the tool
        result = execute_tool(tool_name, tool_input)

        # Return result to Claude
        followup = client.messages.create(
            model="claude-sonnet-4-5-20250514",
            max_tokens=1024,
            tools=tools,
            messages=[
                {"role": "user", "content": "What's the weather in Tokyo?"},
                {"role": "assistant", "content": response.content},
                {
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": tool_use_id,
                        "content": str(result)
                    }]
                }
            ]
        )
```

### OpenAI Function Calling

```python
from openai import OpenAI

client = OpenAI()

tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get current weather for a city.",
        "strict": True,  # Enable structured outputs for tools
        "parameters": {
            "type": "object",
            "properties": {
                "city": {"type": "string"},
                "units": {"type": "string", "enum": ["celsius", "fahrenheit"]}
            },
            "required": ["city", "units"],
            "additionalProperties": False
        }
    }
}]

response = client.responses.create(
    model="gpt-4o",
    input="What's the weather in Tokyo?",
    tools=tools
)

# Process function calls in output
for item in response.output:
    if item.type == "function_call":
        args = json.loads(item.arguments)
        result = execute_tool(item.name, args)
        # Continue conversation with result...
```

### TypeScript Tool Use (Claude)

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const tools: Anthropic.Tool[] = [
  {
    name: "get_weather",
    description: "Get current weather for a city.",
    input_schema: {
      type: "object" as const,
      properties: {
        city: { type: "string", description: "City name" },
        units: { type: "string", enum: ["celsius", "fahrenheit"] },
      },
      required: ["city"],
    },
  },
];

const response = await client.messages.create({
  model: "claude-sonnet-4-5-20250514",
  max_tokens: 1024,
  tools,
  messages: [{ role: "user", content: "What's the weather in Tokyo?" }],
});

for (const block of response.content) {
  if (block.type === "tool_use") {
    const result = await executeTool(block.name, block.input);
    // Return result to continue conversation...
  }
}
```

## Tool Design Best Practices

### 1. Keep Tool Descriptions Concise

```python
# BAD: 100+ tokens
description="""This tool searches the database for customer records
matching the given criteria. It supports filtering by name, email,
date range, and account status. Returns up to 50 results..."""

# GOOD: ~20 tokens
description="Search customers by name, email, date, or status."
```

### 2. Use Enum Constraints

```python
"status": {
    "type": "string",
    "enum": ["active", "inactive", "suspended"],
    "description": "Account status filter"
}
```

### 3. Provide Tool Use Examples (Claude)

```python
# Claude supports tool_use examples in the messages array
messages = [
    # Example interaction showing correct tool usage
    {"role": "user", "content": "Find active customers named Smith"},
    {"role": "assistant", "content": [
        {"type": "tool_use", "id": "ex1", "name": "search_customers",
         "input": {"name": "Smith", "status": "active"}}
    ]},
    {"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": "ex1",
         "content": '[{"id": 1, "name": "John Smith"}]'}
    ]},
    {"role": "assistant", "content": "I found John Smith (ID: 1)..."},
    # Actual user query
    {"role": "user", "content": user_query}
]
```

### 4. Handle Parallel Tool Calls

Claude may return multiple tool_use blocks in a single response. Process them concurrently:

```python
import asyncio

tool_calls = [b for b in response.content if b.type == "tool_use"]

async def execute_and_format(block):
    result = await execute_tool(block.name, block.input)
    return {
        "type": "tool_result",
        "tool_use_id": block.id,
        "content": str(result)
    }

results = await asyncio.gather(*[execute_and_format(tc) for tc in tool_calls])
```

## Schema Design Guidelines

| Rule | Reason |
|---|---|
| Set `additionalProperties: false` | Required for strict mode |
| Mark all fields `required` | Use `"type": ["string", "null"]` for optional |
| Use `enum` for known values | Reduces hallucinated values |
| Add `description` to each property | Improves model understanding |
| Keep schemas shallow (2-3 levels) | Deep nesting increases errors |
| Prefer primitive types | Avoid complex union types |

## Citations (Claude)

Claude supports source citations for RAG applications:

```python
response = client.messages.create(
    model="claude-sonnet-4-5-20250514",
    max_tokens=1024,
    messages=[{
        "role": "user",
        "content": [
            {
                "type": "document",
                "source": {"type": "text", "media_type": "text/plain", "data": doc_text},
                "title": "Product FAQ",
                "context": "Reference document for answering questions",
                "citations": {"enabled": True}
            },
            {"type": "text", "text": "What is the return policy?"}
        ]
    }]
)

# Response includes citation blocks pointing to source spans
for block in response.content:
    if block.type == "text" and hasattr(block, "citations"):
        for citation in block.citations:
            print(f"Cited: {citation.cited_text} from {citation.document_title}")
```
