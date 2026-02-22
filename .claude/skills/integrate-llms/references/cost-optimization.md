# Cost Optimization

Strategies for reducing LLM API costs without sacrificing quality.

## Cost Levers Overview

```
                         Impact
Strategy               (typical savings)   Implementation Effort
-------------------------------------------------------
Prompt caching           10-90%            Low
Model routing            60-87%            Medium
Response caching         15-30%            Low
Token optimization       20-40%            Low
Batch processing         50%               Low
Dimensionality reduction 30-50% (storage)  Low
```

## Prompt Caching

Cache static prompt content (system prompts, reference docs, few-shot examples) to avoid re-processing.

### Claude Prompt Caching

```python
from anthropic import Anthropic

client = Anthropic()

# Mark static content for caching with cache_control
response = client.messages.create(
    model="claude-sonnet-4-5-20250514",
    max_tokens=1024,
    system=[
        {
            "type": "text",
            "text": "You are a helpful assistant...",  # Stable system prompt
            "cache_control": {"type": "ephemeral"}     # Cache for up to 1 hour
        }
    ],
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "document",
                    "source": {"type": "text", "media_type": "text/plain", "data": large_reference_doc},
                    "cache_control": {"type": "ephemeral"}  # Cache the document
                },
                {"type": "text", "text": "Answer based on the document above: " + user_query}
            ]
        }
    ]
)

# Check cache performance
print(f"Cache read tokens: {response.usage.cache_read_input_tokens}")
print(f"Cache write tokens: {response.usage.cache_creation_input_tokens}")
```

### Pricing Impact

| Component | Cost Relative to Base |
|---|---|
| Cache write | 1.25x base input rate |
| Cache read (hit) | 0.1x base input rate |
| No caching | 1.0x base input rate |

**Example:** A 10,000-token system prompt used 100 times:
- Without caching: 10,000 x 100 = 1,000,000 input tokens charged
- With caching: 10,000 x 1.25 (write) + 10,000 x 99 x 0.1 (reads) = 111,500 effective tokens (~89% savings)

### OpenAI Automatic Caching

OpenAI automatically caches matching prompt prefixes. No explicit cache control needed.

```python
# OpenAI caches automatically when:
# - Same prompt prefix (system + early messages)
# - Same model
# - Prefix is >1024 tokens
# Cached content costs 50% of base input rate
```

### Best Practices for Caching

1. **Put stable content first** -- System prompts, reference docs, few-shot examples
2. **Put variable content last** -- User query, dynamic context
3. **Minimize changes to cached portions** -- Any change invalidates the cache
4. **Monitor cache hit rates** -- Track `cache_read_input_tokens` vs `cache_creation_input_tokens`
5. **Use 1-hour TTL** -- Claude's ephemeral cache lasts up to 1 hour (GA, no beta header)

## Model Routing

Route simple queries to cheap models, complex queries to expensive ones.

### Cascade Pattern

```python
from enum import Enum

class ModelTier(Enum):
    FAST = "claude-haiku-4-5-20250514"      # $0.80 / $4 per M tokens
    BALANCED = "claude-sonnet-4-5-20250514"  # $3 / $15 per M tokens
    POWERFUL = "claude-opus-4-5-20250514"    # $15 / $75 per M tokens

async def classify_complexity(query: str) -> ModelTier:
    """Use a cheap model to classify query complexity."""
    response = await client.messages.create(
        model=ModelTier.FAST.value,
        max_tokens=64,
        messages=[{
            "role": "user",
            "content": f"""Classify this query's complexity as SIMPLE, MODERATE, or COMPLEX.
SIMPLE: factual lookup, classification, formatting
MODERATE: analysis, comparison, multi-step reasoning
COMPLEX: creative writing, deep research, complex code generation

Query: {query}
Complexity:"""
        }]
    )
    text = response.content[0].text.strip().upper()
    if "SIMPLE" in text:
        return ModelTier.FAST
    elif "COMPLEX" in text:
        return ModelTier.POWERFUL
    return ModelTier.BALANCED

async def routed_query(query: str) -> str:
    """Route query to appropriate model tier."""
    tier = await classify_complexity(query)
    response = await client.messages.create(
        model=tier.value,
        max_tokens=4096,
        messages=[{"role": "user", "content": query}]
    )
    return response.content[0].text
```

### TypeScript Model Router

```typescript
type ModelTier = "fast" | "balanced" | "powerful";

const MODELS: Record<ModelTier, string> = {
  fast: "claude-haiku-4-5-20250514",
  balanced: "claude-sonnet-4-5-20250514",
  powerful: "claude-opus-4-5-20250514",
};

async function routeQuery(query: string): Promise<ModelTier> {
  const response = await client.messages.create({
    model: MODELS.fast,
    max_tokens: 64,
    messages: [
      {
        role: "user",
        content: `Classify complexity: SIMPLE, MODERATE, or COMPLEX.\nQuery: ${query}\nComplexity:`,
      },
    ],
  });

  const text = extractText(response).toUpperCase();
  if (text.includes("SIMPLE")) return "fast";
  if (text.includes("COMPLEX")) return "powerful";
  return "balanced";
}
```

### Routing Decision Matrix

| Signal | Route To | Reason |
|---|---|---|
| FAQ / known patterns | Cache or fast model | No reasoning needed |
| Classification / extraction | Fast model | Pattern matching task |
| Summarization / analysis | Balanced model | Needs comprehension |
| Code generation / complex reasoning | Powerful model | Needs deep reasoning |
| Safety-critical outputs | Powerful model + guardrails | Accuracy paramount |

## Response Caching

Cache LLM responses for identical or semantically similar queries.

### Exact Match Cache

```python
import hashlib
import json
from functools import lru_cache

def cache_key(model: str, messages: list, **kwargs) -> str:
    """Generate deterministic cache key."""
    payload = json.dumps({"model": model, "messages": messages, **kwargs}, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()

# Simple in-memory cache
response_cache: dict[str, str] = {}

async def cached_generate(model: str, messages: list, **kwargs) -> str:
    key = cache_key(model, messages, **kwargs)
    if key in response_cache:
        return response_cache[key]

    response = await client.messages.create(model=model, messages=messages, **kwargs)
    result = response.content[0].text
    response_cache[key] = result
    return result
```

### Semantic Cache

Use embeddings to find semantically similar past queries.

```python
async def semantic_cache_lookup(
    query: str,
    cache_store,  # Vector store of past queries
    similarity_threshold: float = 0.95
) -> str | None:
    """Check if a semantically similar query was already answered."""
    query_embedding = await embed(query)
    results = cache_store.search(query_embedding, top_k=1)

    if results and results[0].score >= similarity_threshold:
        return results[0].metadata["response"]
    return None
```

## Token Optimization

### Prompt Compression

```python
def compress_prompt(prompt: str) -> str:
    """Remove unnecessary tokens from prompts."""
    # Remove excessive whitespace
    prompt = re.sub(r'\n{3,}', '\n\n', prompt)
    prompt = re.sub(r' {2,}', ' ', prompt)

    # Remove filler phrases
    fillers = [
        "Please note that ",
        "It's important to remember that ",
        "As an AI language model, ",
        "I'd like to point out that ",
    ]
    for filler in fillers:
        prompt = prompt.replace(filler, "")

    return prompt.strip()
```

### Output Length Control

```python
# Control output tokens to avoid paying for unnecessary generation
response = client.messages.create(
    model="claude-sonnet-4-5-20250514",
    max_tokens=256,  # Limit output for classification tasks
    messages=[{"role": "user", "content": "Classify: positive, negative, or neutral"}]
)
```

### Token Counting

```python
# Anthropic - use the token counting API
count = client.messages.count_tokens(
    model="claude-sonnet-4-5-20250514",
    messages=[{"role": "user", "content": prompt}]
)
print(f"Input tokens: {count.input_tokens}")

# OpenAI - use tiktoken
import tiktoken
enc = tiktoken.encoding_for_model("gpt-4o")
token_count = len(enc.encode(prompt))
```

## Batch Processing

Process non-urgent workloads at discounted rates.

### Anthropic Message Batches

```python
# Create a batch of requests (up to 100,000)
batch = client.messages.batches.create(
    requests=[
        {
            "custom_id": f"request-{i}",
            "params": {
                "model": "claude-sonnet-4-5-20250514",
                "max_tokens": 1024,
                "messages": [{"role": "user", "content": prompt}]
            }
        }
        for i, prompt in enumerate(prompts)
    ]
)

# Poll for completion (typically completes within 24 hours)
# 50% discount on token costs
```

### When to Use Batch

| Workload | Batch? | Reason |
|---|---|---|
| Content moderation backlog | Yes | Latency-tolerant, high volume |
| Bulk data enrichment | Yes | Background job, cost-sensitive |
| Eval suite runs | Yes | Can wait hours for results |
| User-facing chat | No | Needs real-time response |
| Agent tool calls | No | Needs immediate results |

## Cost Monitoring

### Track Per-Request Costs

```python
# Model pricing (per million tokens, approximate 2025)
PRICING = {
    "claude-haiku-4-5-20250514": {"input": 0.80, "output": 4.00},
    "claude-sonnet-4-5-20250514": {"input": 3.00, "output": 15.00},
    "claude-opus-4-5-20250514": {"input": 15.00, "output": 75.00},
    "gpt-4o": {"input": 2.50, "output": 10.00},
    "gpt-4o-mini": {"input": 0.15, "output": 0.60},
}

def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """Estimate cost in USD for a single request."""
    pricing = PRICING.get(model, {"input": 5.0, "output": 15.0})
    return (
        input_tokens * pricing["input"] / 1_000_000 +
        output_tokens * pricing["output"] / 1_000_000
    )
```

### Budget Alerts

```python
class BudgetTracker:
    def __init__(self, daily_budget: float = 50.0):
        self.daily_budget = daily_budget
        self.daily_spend = 0.0

    def track(self, cost: float):
        self.daily_spend += cost
        if self.daily_spend > self.daily_budget * 0.8:
            alert(f"80% of daily LLM budget consumed: ${self.daily_spend:.2f}")
        if self.daily_spend > self.daily_budget:
            alert(f"Daily LLM budget exceeded: ${self.daily_spend:.2f}")
            # Optionally downgrade to cheaper models
```

## Optimization Pipeline

The optimal setup layers multiple strategies:

```
User Query
    |
    v
[Semantic Cache] -- Hit? Return cached response (free)
    |  Miss
    v
[Prompt Cache] -- Reuse cached system prompt + docs (90% savings on cached tokens)
    |
    v
[Model Router] -- Route to cheapest capable model (60-87% savings)
    |
    v
[Token Optimization] -- Compress prompt, limit output (20-40% savings)
    |
    v
[LLM Inference]
    |
    v
[Response Cache] -- Store for future identical queries
```

## Quick Reference: Cost Comparison

| Strategy | Setup Time | Savings | Risk |
|---|---|---|---|
| Prompt caching | 1 hour | 10-90% | None |
| max_tokens limits | 5 minutes | 10-30% | Truncated outputs |
| Model routing | 1-2 days | 60-87% | Quality variance |
| Response caching | 2-4 hours | 15-30% | Stale responses |
| Batch processing | 1-2 hours | 50% | Higher latency |
| Prompt compression | 1-2 hours | 20-40% | Quality degradation |
