# LLM Evaluation and Testing

Frameworks, metrics, and workflows for evaluating LLM-powered applications.

## Evaluation Strategy

### Three Levels of Evaluation

```
Level 1: Unit Evals       -- Single prompt/response pairs
Level 2: Integration Evals -- End-to-end pipeline (RAG, agent loops)
Level 3: Production Evals  -- Real user traffic, A/B tests
```

### Eval Types

| Type | What It Tests | When to Run |
|---|---|---|
| **Prompt regression** | Same prompt produces consistent quality after changes | Every prompt edit, CI pipeline |
| **Model comparison** | Quality across models (Claude vs GPT vs open-source) | Model upgrades, cost optimization |
| **RAG quality** | Retrieval relevance + generation accuracy | Index changes, chunking changes |
| **Safety** | Harmful outputs, PII leakage, jailbreak resistance | Pre-deployment, periodic audits |
| **Hallucination** | Factual accuracy against ground truth | Continuously, especially for RAG |

## Building Eval Sets

### Structure

```jsonl
{"input": "What is the return policy?", "expected": "30-day money-back guarantee", "tags": ["faq", "policy"]}
{"input": "How do I reset my password?", "expected": "Go to Settings > Security > Reset Password", "tags": ["faq", "account"]}
{"input": "Can I get a refund on digital items?", "expected": "Digital items are non-refundable", "tags": ["faq", "policy", "edge_case"]}
```

### Guidelines

1. **Minimum 50 examples** per eval set for statistical significance
2. **Include edge cases** -- 10-20% of examples should be adversarial or tricky
3. **Tag examples** -- Enable filtering by category, difficulty, feature
4. **Version eval sets** -- Store in git alongside prompts
5. **Refresh quarterly** -- Add real user queries that exposed issues

## Evaluation Metrics

### Automated Metrics

```python
from dataclasses import dataclass

@dataclass
class EvalResult:
    input: str
    expected: str
    actual: str
    metrics: dict[str, float]

def evaluate_response(expected: str, actual: str) -> dict[str, float]:
    """Compute standard eval metrics."""
    return {
        "exact_match": float(expected.strip().lower() == actual.strip().lower()),
        "contains_expected": float(expected.lower() in actual.lower()),
        "length_ratio": len(actual) / max(len(expected), 1),
        "format_valid": float(is_valid_format(actual)),
    }
```

### LLM-as-Judge

Use a strong model to grade outputs from a target model.

```python
JUDGE_PROMPT = """You are evaluating an AI assistant's response.

Task: {task}
Expected answer: {expected}
Actual response: {actual}

Rate the response on these criteria (1-5 each):
1. **Correctness**: Does it accurately answer the question?
2. **Completeness**: Does it cover all relevant points?
3. **Relevance**: Does it stay on topic without unnecessary info?
4. **Clarity**: Is it well-written and easy to understand?

Respond with JSON:
{{"correctness": N, "completeness": N, "relevance": N, "clarity": N, "reasoning": "..."}}"""

async def llm_judge(
    task: str,
    expected: str,
    actual: str,
    judge_model: str = "claude-sonnet-4-5-20250514"
) -> dict:
    """Use an LLM to evaluate another LLM's response."""
    response = await client.messages.create(
        model=judge_model,
        max_tokens=512,
        messages=[{
            "role": "user",
            "content": JUDGE_PROMPT.format(
                task=task, expected=expected, actual=actual
            )
        }],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "eval_result",
                "strict": True,
                "schema": {
                    "type": "object",
                    "properties": {
                        "correctness": {"type": "integer"},
                        "completeness": {"type": "integer"},
                        "relevance": {"type": "integer"},
                        "clarity": {"type": "integer"},
                        "reasoning": {"type": "string"}
                    },
                    "required": ["correctness", "completeness", "relevance", "clarity", "reasoning"],
                    "additionalProperties": False
                }
            }
        }
    )
    return json.loads(response.content[0].text)
```

### RAG-Specific Metrics

```python
def evaluate_rag(
    query: str,
    retrieved_docs: list[str],
    generated_answer: str,
    ground_truth: str,
    relevant_doc_ids: set[str],
    retrieved_doc_ids: list[str]
) -> dict:
    """Evaluate RAG pipeline quality."""
    # Retrieval metrics
    retrieved_set = set(retrieved_doc_ids)
    precision_at_k = len(relevant_doc_ids & retrieved_set) / len(retrieved_set)
    recall_at_k = len(relevant_doc_ids & retrieved_set) / len(relevant_doc_ids)

    # Generation metrics (via LLM-as-judge or string matching)
    faithfulness = check_faithfulness(generated_answer, retrieved_docs)
    answer_relevance = check_relevance(generated_answer, query)

    return {
        "retrieval_precision": precision_at_k,
        "retrieval_recall": recall_at_k,
        "faithfulness": faithfulness,      # Does answer stick to retrieved context?
        "answer_relevance": answer_relevance,  # Does answer address the query?
        "has_citation": bool(re.search(r'\[Source \d+\]', generated_answer)),
    }
```

## Prompt Regression Testing

### CI Pipeline Integration

```yaml
# .github/workflows/prompt-eval.yml
name: Prompt Regression Tests
on:
  pull_request:
    paths:
      - 'prompts/**'
      - 'src/llm/**'

jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run evals
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          python -m pytest tests/evals/ \
            --eval-model claude-sonnet-4-5-20250514 \
            --min-score 0.85 \
            --report-file eval-results.json
      - name: Comment PR with results
        uses: actions/github-script@v7
        with:
          script: |
            const results = require('./eval-results.json');
            // Post summary as PR comment
```

### Eval Runner

```python
import json
import asyncio
from pathlib import Path

async def run_eval_suite(
    eval_file: str,
    prompt_fn,
    model: str = "claude-sonnet-4-5-20250514",
    concurrency: int = 5
) -> dict:
    """Run an eval suite and return aggregate metrics."""
    examples = [json.loads(line) for line in Path(eval_file).read_text().splitlines()]
    semaphore = asyncio.Semaphore(concurrency)

    async def evaluate_one(example):
        async with semaphore:
            prompt = prompt_fn(example["input"])
            response = await generate(prompt, model=model)
            return evaluate_response(example["expected"], response)

    results = await asyncio.gather(*[evaluate_one(ex) for ex in examples])

    # Aggregate
    metrics = {}
    for key in results[0]:
        values = [r[key] for r in results]
        metrics[key] = {
            "mean": sum(values) / len(values),
            "min": min(values),
            "max": max(values),
            "pass_rate": sum(1 for v in values if v >= 0.8) / len(values)
        }
    return metrics
```

## Evaluation Tools

| Tool | Type | Best For |
|---|---|---|
| **Braintrust** | Platform | Online/offline evals, prompt playground |
| **LangSmith** | Platform | LangChain apps, tracing + evals |
| **DeepEval** | Library | pytest-style LLM evals, many metrics |
| **Inspect AI** | Library | Agent evals, safety testing |
| **OpenAI Evals** | Framework | Model comparison, regression testing |
| **Phoenix (Arize)** | Platform | Observability + eval, hallucination detection |
| **Promptfoo** | CLI | Fast prompt testing, side-by-side comparison |

### Promptfoo Example

```yaml
# promptfoo.yaml
prompts:
  - prompts/classify-ticket-v1.txt
  - prompts/classify-ticket-v2.txt

providers:
  - id: anthropic:messages:claude-sonnet-4-5-20250514
  - id: openai:gpt-4o

tests:
  - vars:
      input: "App crashes when I click save"
    assert:
      - type: contains
        value: "high"
      - type: llm-rubric
        value: "Response correctly identifies this as a high-priority bug"
  - vars:
      input: "Can you add dark mode?"
    assert:
      - type: contains
        value: "low"
```

## Production Monitoring

### Key Metrics to Track

| Metric | Target | Alert Threshold |
|---|---|---|
| Response latency (p50/p95) | <2s / <5s | >10s |
| Error rate | <1% | >5% |
| Token usage per request | Varies | >2x baseline |
| User satisfaction (thumbs up/down) | >80% positive | <60% |
| Hallucination rate (sampled) | <5% | >15% |
| Guardrail trigger rate | <2% | >10% |

### Drift Detection

```python
async def check_for_drift(
    recent_results: list[dict],
    baseline_results: list[dict],
    threshold: float = 0.1
) -> bool:
    """Detect if model quality has drifted from baseline."""
    recent_avg = sum(r["score"] for r in recent_results) / len(recent_results)
    baseline_avg = sum(r["score"] for r in baseline_results) / len(baseline_results)
    drift = abs(recent_avg - baseline_avg)
    return drift > threshold
```

## Best Practices

1. **Start with evals before building** -- Define what "good" looks like first
2. **Automate in CI** -- Run evals on every prompt or model change
3. **Use LLM-as-judge for subjective quality** -- But validate the judge with human ratings
4. **Separate retrieval and generation evals** for RAG -- Debug each stage independently
5. **Track costs alongside quality** -- A 2% quality gain is not worth 10x the cost
6. **Sample production traffic** -- Periodically evaluate real queries, not just test sets
7. **Red-team regularly** -- Actively try to break your system before users do
