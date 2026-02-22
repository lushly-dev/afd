# LLM and Agentic Workflow Caching

Prompt caching, semantic caching, embedding-based lookup, agentic plan caching, and LLM cost optimization strategies.

## Provider-Level Prompt Caching

### Anthropic Prompt Caching

Anthropic's prompt caching allows reuse of previously computed context across API calls, reducing cost by up to 90% and latency by up to 85% for long prompts.

**How it works:**
1. The API caches the KV (key-value) attention computations for prompt prefixes
2. Subsequent requests that share the same prefix reuse cached computations
3. Cache entries expire after 5 minutes of inactivity (default TTL)

**Pricing:**
- Cache write: 25% premium over base input token price
- Cache read (hit): 90% discount (10% of base input token price)
- Break-even: 2+ cache hits per cached prefix

**Best practices:**

```python
import anthropic

client = anthropic.Anthropic()

# Place static content (system prompt, few-shot examples, documents)
# at the BEGINNING of the prompt for maximum cache reuse
response = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    system=[
        {
            "type": "text",
            "text": LARGE_SYSTEM_PROMPT,  # Place long, static content first
            "cache_control": {"type": "ephemeral"}  # Mark for caching
        }
    ],
    messages=[
        {"role": "user", "content": user_query}  # Variable content last
    ],
)

# Check cache performance
print(f"Cache read tokens: {response.usage.cache_read_input_tokens}")
print(f"Cache write tokens: {response.usage.cache_creation_input_tokens}")
```

**Structure prompts for cache hits:**

```
[System prompt - CACHED]          <- Rarely changes; cache this
[Few-shot examples - CACHED]      <- Static examples; cache this
[Document context - CACHED]       <- RAG context; cache per session
[User message - NOT CACHED]       <- Changes every request
```

**Key rules:**
- Minimum cacheable prefix: 1,024 tokens (Claude Sonnet), 2,048 tokens (Claude Opus)
- Order messages from most static to most dynamic
- Cache the system prompt, tool definitions, and large context documents
- The user message at the end varies per request and is not cached
- TTL refreshes on each cache hit (sliding window)

### OpenAI Prompt Caching

OpenAI provides automatic prompt caching (no opt-in required):

- Automatically caches shared prefixes across requests
- 50% discount on cached input tokens
- Cache is global per organization (shared across requests)
- No cache write premium

### Google Gemini Context Caching

```python
import google.generativeai as genai

# Create cached content
cache = genai.caching.CachedContent.create(
    model='gemini-1.5-flash-001',
    display_name='my-cache',
    system_instruction='You are an expert analyst.',
    contents=[large_document],
    ttl=datetime.timedelta(minutes=30),
)

# Use cached content in requests
model = genai.GenerativeModel.from_cached_content(cached_content=cache)
response = model.generate_content('Analyze the key findings.')
```

---

## Semantic Caching

Semantic caching matches queries by meaning rather than exact string match, enabling cache hits for paraphrased or similar questions.

### Architecture

```
User Query -> Embed Query -> Vector Search (similarity) -> Cache Hit/Miss
                                                              |
                                                      Hit: Return cached response
                                                      Miss: Call LLM -> Store response + embedding
```

### Implementation with Redis + Embeddings

```python
import numpy as np
from openai import OpenAI
from redis import Redis
from redis.commands.search.query import Query

client = OpenAI()
redis = Redis(host='localhost', port=6379)

SIMILARITY_THRESHOLD = 0.92  # Tune based on accuracy requirements

async def semantic_cache_lookup(query: str) -> str | None:
    """Look up a semantically similar cached response."""
    # 1. Embed the query
    embedding = client.embeddings.create(
        model="text-embedding-3-small",
        input=query,
    ).data[0].embedding

    # 2. Search for similar queries in vector index
    query_vector = np.array(embedding, dtype=np.float32).tobytes()
    results = redis.ft("cache_idx").search(
        Query(f"*=>[KNN 3 @embedding $vec AS score]")
        .sort_by("score")
        .return_fields("response", "score")
        .dialect(2),
        query_params={"vec": query_vector},
    )

    # 3. Return cached response if similarity exceeds threshold
    if results.docs and float(results.docs[0].score) < (1 - SIMILARITY_THRESHOLD):
        return results.docs[0].response

    return None

async def get_llm_response(query: str) -> str:
    """Get LLM response with semantic caching."""
    # Check semantic cache first
    cached = await semantic_cache_lookup(query)
    if cached:
        return cached

    # Cache miss: call LLM
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": query}],
    ).choices[0].message.content

    # Store response with embedding for future lookups
    embedding = client.embeddings.create(
        model="text-embedding-3-small",
        input=query,
    ).data[0].embedding

    cache_key = f"semantic:{hash(query)}"
    redis.hset(cache_key, mapping={
        "query": query,
        "response": response,
        "embedding": np.array(embedding, dtype=np.float32).tobytes(),
    })
    redis.expire(cache_key, 3600)  # 1 hour TTL

    return response
```

### Semantic Caching Considerations

| Factor | Prompt Caching | Semantic Caching |
|--------|---------------|------------------|
| Match type | Exact prefix match | Similarity-based |
| Infrastructure | Provider-managed | Self-managed (vector DB + embeddings) |
| Cost | Very low (provider discount) | Embedding API + vector DB costs |
| Accuracy | 100% (exact match) | Depends on threshold tuning |
| Use case | Repeated context (RAG, system prompts) | FAQ, support queries, repeated questions |
| Latency | Fastest (provider-side) | Embedding + vector search overhead |
| Risk | None | False cache hits returning wrong answers |

**When to use each:**
- **Prompt caching:** Always enable when available. Zero risk, significant cost savings for repeated context.
- **Semantic caching:** Use for customer-facing applications with repetitive queries (FAQ bots, support agents). Requires careful threshold tuning to avoid incorrect cached responses.

---

## Agentic Plan Caching

Agentic Plan Caching (APC) stores and reuses execution plans across semantically similar agent tasks, reducing cost by ~50% and latency by ~27%.

### Concept

```
New Task -> Check Plan Cache (semantic match) -> Hit: Adapt cached plan
                                                  Miss: Generate new plan -> Cache it
```

### Implementation Pattern

```python
class AgentPlanCache:
    """Cache and reuse agent execution plans for similar tasks."""

    def __init__(self, redis_client, embedding_client, similarity_threshold=0.90):
        self.redis = redis_client
        self.embedder = embedding_client
        self.threshold = similarity_threshold

    async def get_plan(self, task_description: str) -> dict | None:
        """Find a cached plan for a similar task."""
        embedding = await self.embedder.embed(task_description)

        # Search for similar task plans
        similar = await self.vector_search(embedding, top_k=3)

        for match in similar:
            if match.similarity >= self.threshold:
                return {
                    "plan": match.plan,
                    "original_task": match.task,
                    "similarity": match.similarity,
                    "adapted": True,
                }

        return None

    async def store_plan(self, task_description: str, plan: dict, result: dict):
        """Store a successful execution plan for future reuse."""
        if not result.get("success"):
            return  # Only cache successful plans

        embedding = await self.embedder.embed(task_description)

        await self.redis.hset(f"plan:{hash(task_description)}", mapping={
            "task": task_description,
            "plan": json.dumps(plan),
            "embedding": embedding.tobytes(),
            "created_at": time.time(),
            "success_count": 1,
        })
```

---

## Workflow-Level Caching for Agents

In multi-step agent workflows, cache intermediate results to avoid redundant tool calls.

### Patterns

```python
class CachedAgentWorkflow:
    """Cache intermediate results in multi-step agent workflows."""

    def __init__(self, cache: Redis, ttl: int = 300):
        self.cache = cache
        self.ttl = ttl

    async def cached_tool_call(self, tool_name: str, params: dict) -> dict:
        """Cache tool call results for identical inputs."""
        cache_key = f"tool:{tool_name}:{self._hash_params(params)}"

        cached = await self.cache.get(cache_key)
        if cached:
            return json.loads(cached)

        result = await self.execute_tool(tool_name, params)

        # Only cache deterministic, read-only tool calls
        if self._is_cacheable(tool_name):
            await self.cache.set(cache_key, json.dumps(result), ex=self.ttl)

        return result

    def _is_cacheable(self, tool_name: str) -> bool:
        """Determine if a tool call is safe to cache."""
        # Cache read-only, deterministic operations
        cacheable = {'search_docs', 'get_user', 'fetch_weather', 'lookup_definition'}
        # Never cache side-effecting operations
        non_cacheable = {'send_email', 'create_record', 'delete_item', 'update_status'}
        return tool_name in cacheable and tool_name not in non_cacheable

    def _hash_params(self, params: dict) -> str:
        """Deterministic hash of parameters."""
        return hashlib.sha256(
            json.dumps(params, sort_keys=True).encode()
        ).hexdigest()[:16]
```

### What to Cache in Agentic Workflows

| Component | Cacheable? | TTL guidance |
|-----------|-----------|--------------|
| System prompt / instructions | Yes (prompt caching) | Session lifetime |
| Tool definitions | Yes (prompt caching) | Until tools change |
| RAG document context | Yes (prompt caching) | Per query session |
| Read-only tool call results | Yes | 1-5 minutes |
| Search/retrieval results | Yes | 30-60 seconds |
| Write/mutation tool calls | No | N/A |
| User-specific LLM responses | Depends | Short TTL if cached |
| Execution plans | Yes (semantic) | Hours to days |

---

## Cost Optimization Strategies

### Estimating Cache Savings

```
Savings per request = (uncached_cost - cached_cost) * cache_hit_rate

Example (Anthropic Claude Sonnet, 10K token system prompt):
- Uncached: 10,000 * $3/M = $0.03 per request
- Cached read: 10,000 * $0.30/M = $0.003 per request
- Cache write (first): 10,000 * $3.75/M = $0.0375 per request
- With 95% hit rate over 100 requests:
  Total uncached: 100 * $0.03 = $3.00
  Total cached: 1 * $0.0375 + 99 * $0.003 = $0.3345
  Savings: ~89%
```

### Decision Matrix

| Question | If yes | If no |
|----------|--------|-------|
| Same system prompt across requests? | Enable prompt caching | No action needed |
| Users ask similar questions repeatedly? | Implement semantic caching | Skip semantic cache |
| Multi-step agent with repeated tool calls? | Cache tool call results | No action needed |
| RAG with large document context? | Cache document prefix | Embed per-request |
| Predictable task patterns? | Implement plan caching | Generate plans per task |
