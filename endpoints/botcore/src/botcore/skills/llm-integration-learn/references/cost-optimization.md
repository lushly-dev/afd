# Cost Optimization

Strategies for reducing LLM API costs without sacrificing quality.

## Cost Levers Overview

```
                         Impact
Strategy               (typical savings)   Implementation Effort
-------------------------------------------------------
Prompt caching           10-90%            Low
Effort tuning            varies            Low
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
MODEL = "<model-id>"  # see Model Selection in SKILL.md

# Mark static content for caching with cache_control
response = client.messages.create(
    model=MODEL,
    max_tokens=16000,
    system=[
        {
            "type": "text",
            "text": "You are a helpful assistant...",  # Stable system prompt
            "cache_control": {"type": "ephemeral"}     # 5-minute TTL; add "ttl": "1h" for longer
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

Illustrative 5-minute cache multipliers for models with a 10% read rate;
[current Claude pricing](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
is model-specific, and some models have lower read rates:

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
# Cached-input prices depend on the model; check its current pricing page
```

For example, [GPT-6.1 Sol's published prices](https://openai.com/index/introducing-gpt-6-1-sol/)
are $0.10 per million cached-input tokens versus $2 for standard input (5% of
the standard rate). Do not assume a single discount across OpenAI models.

### Best Practices for Caching

1. **Put stable content first** -- System prompts, reference docs, few-shot examples
2. **Put variable content last** -- User query, dynamic context
3. **Minimize changes to cached portions** -- Any change invalidates the cache
4. **Monitor cache hit rates** -- Track `cache_read_input_tokens` vs `cache_creation_input_tokens`
5. **Choose the TTL by reuse window** -- Claude's ephemeral cache defaults to 5 minutes; [opt into 1 hour](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) when later reuse justifies its higher write cost

## Model Routing

Tune `effort` and compare models on representative evals. A single model can preserve its prompt cache (caches are per-model), but a different model or effort may still win on cost per completed task. Count retries, tool calls, and failed tasks; token price alone does not establish savings.

### Cascade Pattern

Define tiers as `(model, effort)` pairs loaded from config. Start with one model at different effort levels; add a second model (for example, a high-volume GPT-6 model behind its own client) only when measurement justifies it.

```python
MODEL = "<model-id>"  # load from config; see Model Selection in SKILL.md

TIERS = {
    "fast": {"model": MODEL, "effort": "low"},
    "balanced": {"model": MODEL, "effort": "medium"},
    "powerful": {"model": MODEL, "effort": "high"},
}

def extract_text(response) -> str:
    """Join text blocks; skip thinking blocks (thinking is always on)."""
    return "".join(b.text for b in response.content if b.type == "text")

async def classify_complexity(query: str) -> str:
    """Use the fast tier to classify query complexity."""
    tier = TIERS["fast"]
    response = await client.messages.create(
        model=tier["model"],
        max_tokens=4096,  # thinking counts toward max_tokens
        output_config={"effort": tier["effort"]},
        messages=[{
            "role": "user",
            "content": f"""Classify this query's complexity as SIMPLE, MODERATE, or COMPLEX.
SIMPLE: factual lookup, classification, formatting
MODERATE: analysis, comparison, multi-step reasoning
COMPLEX: creative writing, deep research, complex code generation

Query: {query}"""
        }]
    )
    text = extract_text(response).upper()
    if "SIMPLE" in text:
        return "fast"
    elif "COMPLEX" in text:
        return "powerful"
    return "balanced"

async def routed_query(query: str) -> str:
    """Route query to the matching tier."""
    tier = TIERS[await classify_complexity(query)]
    response = await client.messages.create(
        model=tier["model"],
        max_tokens=16000,
        output_config={"effort": tier["effort"]},
        messages=[{"role": "user", "content": query}]
    )
    return extract_text(response)
```

### TypeScript Model Router

```typescript
type Tier = "fast" | "balanced" | "powerful";
type Effort = "low" | "medium" | "high";

const MODEL = "<model-id>"; // load from config; see Model Selection in SKILL.md

const TIERS: Record<Tier, { model: string; effort: Effort }> = {
  fast: { model: MODEL, effort: "low" },
  balanced: { model: MODEL, effort: "medium" },
  powerful: { model: MODEL, effort: "high" },
};

async function routeQuery(query: string): Promise<Tier> {
  const response = await client.messages.create({
    model: TIERS.fast.model,
    max_tokens: 4096, // thinking counts toward max_tokens
    output_config: { effort: TIERS.fast.effort },
    messages: [
      {
        role: "user",
        content: `Classify complexity: SIMPLE, MODERATE, or COMPLEX.\nQuery: ${query}`,
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
| FAQ / known patterns | Response cache or fast tier | No reasoning needed |
| Classification / extraction | Fast tier (low effort) | Pattern matching task |
| Summarization / analysis | Balanced tier | Needs comprehension |
| Code generation / complex reasoning | Powerful tier (high or xhigh effort) | Needs deep reasoning |
| Safety-critical outputs | Powerful tier + guardrails | Accuracy paramount |

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
    result = "".join(b.text for b in response.content if b.type == "text")
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
# Lower effort and ask for a short answer to cut output and thinking tokens.
# max_tokens is a hard cutoff that also caps thinking -- set it too low and replies truncate.
response = client.messages.create(
    model=MODEL,
    max_tokens=4096,
    output_config={"effort": "low"},
    messages=[{"role": "user", "content": "Classify as positive, negative, or neutral. Reply with the label only: ..."}]
)
```

### Token Counting

```python
# Anthropic - use the token counting API
count = client.messages.count_tokens(
    model=MODEL,
    messages=[{"role": "user", "content": prompt}]
)
print(f"Input tokens: {count.input_tokens}")

# OpenAI - use tiktoken (approximate; confirm the encoding for your model)
import tiktoken
enc = tiktoken.get_encoding("o200k_base")
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
                "model": MODEL,
                "max_tokens": 16000,
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
# Load per-model prices (USD per million tokens) from config -- they change often.
# Current prices: https://platform.claude.com/docs/en/about-claude/pricing
#                 https://developers.openai.com/api/docs/pricing
PRICING: dict[str, dict[str, float]] = load_pricing_config()

def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """Estimate cost in USD for a single request."""
    pricing = PRICING[model]  # fail loudly on a model with no configured price
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
