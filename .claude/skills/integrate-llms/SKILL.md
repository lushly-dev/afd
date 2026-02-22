---
name: integrate-llms
source: botcore
description: >
  Guides integration of LLMs into applications with production-grade patterns. Covers prompt engineering, structured outputs, tool use, RAG pipelines, embeddings, agentic patterns, evaluation, cost optimization, and guardrails for both TypeScript and Python. Use when building AI-powered features, integrating Claude or OpenAI APIs, designing RAG systems, implementing agents, optimizing LLM costs, or adding safety guardrails. Triggers: LLM, AI integration, prompt engineering, RAG, embeddings, tool use, structured output, agent, eval, guardrails, Claude API, OpenAI.

version: 1.0.0
triggers:
  - LLM
  - LLM integration
  - AI integration
  - prompt engineering
  - system prompt
  - few-shot
  - chain of thought
  - RAG
  - retrieval augmented generation
  - embeddings
  - vector search
  - vector database
  - tool use
  - function calling
  - structured output
  - agentic
  - AI agent
  - multi-agent
  - LLM eval
  - LLM evaluation
  - prompt testing
  - LLM cost
  - token optimization
  - guardrails
  - PII detection
  - prompt injection
  - Claude API
  - OpenAI API
  - prompt caching
  - model routing
  - re-ranking
  - hybrid search
portable: true
---

# Integrating LLMs

Production patterns for building AI-powered applications with Claude, OpenAI, and other LLM providers.

## Capabilities

1. **Prompt Engineering** -- System prompts, few-shot examples, chain-of-thought, extended thinking, prompt versioning and caching
2. **Structured Outputs** -- Schema-guaranteed JSON responses using Claude and OpenAI structured output APIs
3. **Tool Use / Function Calling** -- Define, invoke, and orchestrate LLM-driven tool calls across providers
4. **RAG Pipelines** -- Chunking strategies, hybrid search, re-ranking, context assembly, and citation support
5. **Embedding Strategies** -- Model selection, dimensionality reduction, indexing, and similarity search
6. **Agentic Patterns** -- ReAct loops, planning, reflection, and multi-agent orchestration
7. **Evaluation and Testing** -- Eval sets, LLM-as-judge, RAG metrics, prompt regression testing in CI
8. **Cost Optimization** -- Prompt caching, model routing, response caching, batch processing, token budgets
9. **Guardrails and Safety** -- Prompt injection detection, PII redaction, output validation, content filtering

## Routing Logic

| Request Type | Reference |
|---|---|
| System prompts, few-shot, CoT, prompt templates, caching | [prompt-engineering.md](references/prompt-engineering.md) |
| Structured outputs, tool use, function calling, citations | [structured-outputs.md](references/structured-outputs.md) |
| RAG architecture, chunking, hybrid search, re-ranking | [rag-pipelines.md](references/rag-pipelines.md) |
| Embedding models, dimensionality, indexing, similarity | [embeddings.md](references/embeddings.md) |
| ReAct, planning, reflection, multi-agent orchestration | [agentic-patterns.md](references/agentic-patterns.md) |
| Evals, LLM-as-judge, regression testing, monitoring | [evaluation-testing.md](references/evaluation-testing.md) |
| Prompt caching, model routing, batch processing, budgets | [cost-optimization.md](references/cost-optimization.md) |
| Prompt injection, PII detection, output filtering, safety | [guardrails-safety.md](references/guardrails-safety.md) |

## Core Principles

### 1. Start Simple, Add Complexity When Measured

<rules>
Begin with a single LLM call and basic prompting.
Add RAG, agents, or multi-model routing only when evals show the simpler approach is insufficient.
</rules>

| Complexity Level | When to Use |
|---|---|
| Single LLM call | Classification, extraction, formatting, simple Q&A |
| LLM + structured output | Need guaranteed JSON schema compliance |
| LLM + tool use | Need external data or actions (APIs, databases) |
| RAG pipeline | Need domain-specific knowledge beyond training data |
| Agentic loop | Multi-step tasks requiring planning and tool orchestration |
| Multi-agent | Diverse capabilities, team-like workflows at scale |

### 2. Every Prompt Is Code

<rules>
Treat prompts as versioned, tested, reviewable code artifacts.
Store prompts in source control. Run evals on every change. Never edit production prompts without regression tests.
</rules>

- Version prompts in files alongside application code
- Include eval sets (`.jsonl`) with expected outputs
- Run prompt regression tests in CI on every prompt change
- Track which model version each prompt was tested against

### 3. Retrieval Before Generation

<rules>
When the model needs domain knowledge, retrieve it rather than stuffing it into prompts or fine-tuning.
RAG is cheaper, more maintainable, and more auditable than alternatives.
</rules>

Decision flow for domain knowledge:

1. **Can you prompt it?** -- If the knowledge fits in a few examples, use few-shot
2. **Is it large but static?** -- Cache it in the system prompt with prompt caching
3. **Is it large and dynamic?** -- Build a RAG pipeline
4. **Does it need deep behavioral changes?** -- Consider fine-tuning (last resort)

### 4. Validate Everything

<rules>
Never trust LLM output without validation.
Use structured outputs for format guarantees. Use guardrails for content safety. Use evals for quality.
</rules>

Three validation layers:

- **Format** -- Structured outputs or JSON schema validation
- **Content** -- Guardrails for PII, toxicity, prompt injection
- **Quality** -- Evals, LLM-as-judge, human review for critical outputs

### 5. Optimize Costs From Day One

<rules>
Track token usage and cost per request from the first prototype.
Implement prompt caching immediately. Add model routing when traffic justifies it.
</rules>

Quick wins (implement immediately):

- Set `max_tokens` appropriate to the task (do not leave at default)
- Use prompt caching for stable system prompts and reference docs
- Use the cheapest model that passes your evals
- Cache identical responses

### 6. Design for Agent Maintainability

<rules>
AI-powered features should be modular, observable, and testable in isolation.
An agent (or human) should be able to understand, modify, and extend any LLM integration without hidden context.
</rules>

- Separate prompt templates from business logic
- Log every LLM call with input, output, latency, and token count
- Make each pipeline stage independently testable (retrieval, generation, validation)
- Document model dependencies and version requirements

## Workflow

### Building a New LLM Integration

#### Step 1: Define the Task and Success Criteria

- What is the input? What is the expected output?
- Define 20+ example input/output pairs as an eval set
- Set a quality bar (e.g., >=85% accuracy on the eval set)
- Identify failure modes and edge cases

#### Step 2: Start with the Simplest Approach

- Write a system prompt and test with a few examples
- Use structured outputs if you need guaranteed JSON
- Evaluate against your eval set
- If quality is sufficient, ship it

#### Step 3: Add Retrieval If Needed

- If the model lacks domain knowledge, build a RAG pipeline
- Choose chunking strategy based on content type (see [rag-pipelines.md](references/rag-pipelines.md))
- Start with vector search, add hybrid search if exact matches matter
- Add re-ranking if precision matters more than latency

#### Step 4: Add Tool Use If Needed

- If the model needs to take actions or fetch live data, add tools
- Keep tool count under 10, descriptions under 50 tokens each
- Handle parallel tool calls and error recovery
- See [structured-outputs.md](references/structured-outputs.md) for implementation

#### Step 5: Add Agentic Patterns If Needed

- If the task requires multi-step reasoning with tools, use a ReAct loop
- If the task requires planning, add plan-then-execute
- If quality is critical, add a reflection step
- Always set iteration limits and token budgets

#### Step 6: Add Guardrails

- Input: prompt injection detection, PII redaction, input validation
- Output: content policy check, PII scanning, format validation
- See [guardrails-safety.md](references/guardrails-safety.md)

#### Step 7: Optimize for Production

- Implement prompt caching for stable content
- Add model routing if traffic is high
- Set up cost monitoring and budget alerts
- Run evals in CI, monitor quality in production

## Quick Reference: API Patterns

### Claude API (Python)

```python
from anthropic import Anthropic

client = Anthropic()

# Basic call
response = client.messages.create(
    model="claude-sonnet-4-5-20250514",
    max_tokens=1024,
    system="You are a helpful assistant.",
    messages=[{"role": "user", "content": "Hello"}]
)
print(response.content[0].text)

# With prompt caching
response = client.messages.create(
    model="claude-sonnet-4-5-20250514",
    max_tokens=1024,
    system=[{
        "type": "text",
        "text": "Long system prompt...",
        "cache_control": {"type": "ephemeral"}
    }],
    messages=[{"role": "user", "content": user_query}]
)
```

### OpenAI API (Python)

```python
from openai import OpenAI

client = OpenAI()

# Basic call
response = client.responses.create(
    model="gpt-4o",
    instructions="You are a helpful assistant.",
    input="Hello"
)
print(response.output_text)
```

### Claude API (TypeScript)

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const response = await client.messages.create({
  model: "claude-sonnet-4-5-20250514",
  max_tokens: 1024,
  system: "You are a helpful assistant.",
  messages: [{ role: "user", content: "Hello" }],
});
```

### OpenAI API (TypeScript)

```typescript
import OpenAI from "openai";

const client = new OpenAI();

const response = await client.responses.create({
  model: "gpt-4o",
  instructions: "You are a helpful assistant.",
  input: "Hello",
});
```

## Quick Reference: Model Selection

| Model | Input $/M | Output $/M | Best For |
|---|---|---|---|
| Claude Haiku 4.5 | $0.80 | $4.00 | Classification, routing, guardrail checks |
| Claude Sonnet 4.5 | $3.00 | $15.00 | General tasks, code, analysis |
| Claude Opus 4.5 | $15.00 | $75.00 | Complex reasoning, deep analysis |
| GPT-4o | $2.50 | $10.00 | General tasks, vision, multilingual |
| GPT-4o mini | $0.15 | $0.60 | Simple tasks, high volume, cost-sensitive |

## Quick Reference: Embedding Models

| Model | Provider | Dims | Cost/M tokens | Best For |
|---|---|---|---|---|
| text-embedding-3-large | OpenAI | 3072 | $0.13 | General purpose |
| text-embedding-3-small | OpenAI | 1536 | $0.02 | Cost-sensitive |
| voyage-3-large | Voyage AI | 2048 | $0.18 | SOTA retrieval |
| bge-m3 | Open source | 1024 | Self-hosted | Multilingual, on-prem |

## Checklist

### Before First LLM API Call
- [ ] Eval set defined with 20+ examples and quality bar
- [ ] Model selected based on task complexity and cost
- [ ] System prompt written and versioned in source control
- [ ] `max_tokens` set appropriate to the task
- [ ] Error handling for API failures (retry with backoff)
- [ ] API key stored securely (environment variable, not code)

### Before Adding RAG
- [ ] Confirmed simple prompting is insufficient (eval data)
- [ ] Chunking strategy selected for content type
- [ ] Embedding model and dimensions chosen
- [ ] Vector store selected and provisioned
- [ ] Hybrid search considered (exact match needs?)
- [ ] Re-ranking considered (precision-critical?)

### Before Adding Agents
- [ ] Confirmed single LLM call or RAG is insufficient
- [ ] Iteration limits set (max loops, max tool calls)
- [ ] Token budget tracking implemented
- [ ] Tool error recovery with retry and fallback
- [ ] Timeout on individual tool calls and total agent run
- [ ] Observability: logging every reasoning step and tool call

### Before Production
- [ ] Prompt regression tests running in CI
- [ ] Input guardrails: injection detection, PII redaction, validation
- [ ] Output guardrails: content policy, PII scan, format check
- [ ] Cost monitoring with budget alerts
- [ ] Prompt caching enabled for stable content
- [ ] Rate limiting per user/API key
- [ ] Human escalation path for blocked or low-confidence outputs
- [ ] Production quality monitoring (sampled evals, drift detection)

## When to Escalate

| Condition | Escalate To |
|---|---|
| Eval scores below quality bar despite prompt iteration | Consider fine-tuning or model upgrade; consult ML team |
| RAG retrieval quality plateaus despite tuning | Evaluate chunking strategy, embedding model, or knowledge graph approach |
| Agent loops exceeding iteration limits on common tasks | Redesign task decomposition or add specialized tools |
| Prompt injection bypasses guardrails | Add defense layers; consult security team for red-teaming |
| LLM costs exceeding budget with routing in place | Evaluate self-hosted models, batching, or feature scope reduction |
| Regulatory requirements for PII, HIPAA, or GDPR compliance | Involve legal and compliance for data handling review |
| Multi-model orchestration with conflicting outputs | Add consensus mechanisms or human-in-the-loop arbitration |
| Production hallucination rate exceeds threshold | Add faithfulness checks, improve retrieval, consider citations |
