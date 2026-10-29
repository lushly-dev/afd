# Structured Outputs and Tool Use

Patterns for getting reliable, schema-conformant output from LLMs.

## Structured Outputs

Structured outputs guarantee that model responses conform to a JSON schema by constraining token generation at inference time.

### Claude Structured Outputs

Pass the schema through `output_config.format` -- not OpenAI's `response_format`, which the Anthropic API does not accept. The simplest path is `messages.parse()` with a Pydantic model:

```python
from typing import Literal

import anthropic
from pydantic import BaseModel

client = anthropic.Anthropic()
MODEL = "<model-id>"  # see Model Selection in SKILL.md

class SentimentResult(BaseModel):
    sentiment: Literal["positive", "negative", "neutral"]
    confidence: float
    reasoning: str

response = client.messages.parse(
    model=MODEL,
    max_tokens=16000,
    messages=[{"role": "user", "content": "Analyze the sentiment of: 'Great product!'"}],
    output_format=SentimentResult,
)
result = response.parsed_output  # Validated SentimentResult
```

With a raw JSON schema, use `messages.create()` and `output_config`:

```python
import json

response = client.messages.create(
    model=MODEL,
    max_tokens=16000,
    messages=[{"role": "user", "content": "Analyze the sentiment of: 'Great product!'"}],
    output_config={
        "format": {
            "type": "json_schema",
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
    },
)
# Skip thinking blocks; the text block holds the JSON
data = json.loads(next(b.text for b in response.content if b.type == "text"))
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
    model="<model-id>",  # e.g. a GPT-6 model; see Model Selection in SKILL.md
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
  model: "<model-id>", // e.g. a GPT-6 model; see Model Selection in SKILL.md
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
    model=MODEL,
    max_tokens=16000,
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
            model=MODEL,
            max_tokens=16000,
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
    model="<model-id>",  # e.g. a GPT-6 model
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
  model: "<model-id>", // see Model Selection in SKILL.md
  max_tokens: 16000,
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

### 1. Write Detailed Tool Descriptions

A description is the tool's contract. Under-description is the most common tool-use failure: say what the tool does, when to use it and when not to, what each parameter means, and what it returns or leaves out.

```python
# BAD: the model has to guess limits, matching, and when to use it
description="Search customers by name, email, date, or status."

# GOOD: states behavior, limits, and boundaries
description="""Search customer records by name, email, signup date range,
or account status. Name and email match case-insensitive substrings.
Returns at most 50 customers, newest first, with id, name, email, and
status -- not billing data (use get_invoices for that). Use this to find
a customer's id before calling any account tool."""
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
    model=MODEL,
    max_tokens=16000,
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
