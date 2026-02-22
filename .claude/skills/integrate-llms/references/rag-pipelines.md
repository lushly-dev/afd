# RAG Pipelines

Architecture and implementation patterns for Retrieval-Augmented Generation.

## RAG Architecture Overview

```
User Query
    |
    v
[Query Processing] --> Rewrite / Expand / Decompose
    |
    v
[Retrieval] --> Vector Search + Keyword Search (Hybrid)
    |
    v
[Re-ranking] --> Cross-encoder or LLM-based scoring
    |
    v
[Context Assembly] --> Select top-k, respect token budget
    |
    v
[Generation] --> LLM with retrieved context + citations
    |
    v
[Post-processing] --> Validate, cite sources, filter
```

## Chunking Strategies

### Fixed-Size Chunking

The simplest approach. Split by token count with overlap.

```python
def fixed_size_chunk(text: str, chunk_size: int = 512, overlap: int = 64) -> list[str]:
    """Split text into fixed-size chunks with overlap."""
    import tiktoken
    enc = tiktoken.encoding_for_model("gpt-4o")
    tokens = enc.encode(text)
    chunks = []
    for i in range(0, len(tokens), chunk_size - overlap):
        chunk_tokens = tokens[i:i + chunk_size]
        chunks.append(enc.decode(chunk_tokens))
    return chunks
```

**Use when:** Unstructured text, quick prototyping, uniform documents.

### Sentence-Aware Chunking

Split on sentence boundaries to preserve semantic coherence.

```python
import re

def sentence_chunk(text: str, max_tokens: int = 512) -> list[str]:
    """Chunk by sentences, respecting token budget."""
    sentences = re.split(r'(?<=[.!?])\s+', text)
    chunks, current = [], []
    current_len = 0

    for sentence in sentences:
        sent_len = len(sentence.split()) * 1.3  # Rough token estimate
        if current_len + sent_len > max_tokens and current:
            chunks.append(" ".join(current))
            current = [current[-1]]  # Overlap last sentence
            current_len = len(current[0].split()) * 1.3
        current.append(sentence)
        current_len += sent_len

    if current:
        chunks.append(" ".join(current))
    return chunks
```

**Use when:** Articles, documentation, any prose with clear sentence structure.

### Semantic Chunking

Group by semantic similarity -- adjacent text stays together if semantically related.

```python
import numpy as np

def semantic_chunk(
    text: str,
    embedding_fn,
    similarity_threshold: float = 0.75,
    max_tokens: int = 512
) -> list[str]:
    """Split text where semantic similarity drops below threshold."""
    sentences = text.split(". ")
    embeddings = embedding_fn(sentences)

    chunks, current_chunk = [], [sentences[0]]

    for i in range(1, len(sentences)):
        similarity = np.dot(embeddings[i], embeddings[i-1])
        if similarity < similarity_threshold:
            chunks.append(". ".join(current_chunk) + ".")
            current_chunk = []
        current_chunk.append(sentences[i])

    if current_chunk:
        chunks.append(". ".join(current_chunk) + ".")
    return chunks
```

**Use when:** Mixed-topic documents, transcripts, documents with implicit section boundaries.

### Document-Aware Chunking

Respect document structure -- headings, code blocks, tables.

```python
import re

def markdown_chunk(text: str, max_tokens: int = 512) -> list[str]:
    """Chunk markdown by headers, keeping structure intact."""
    sections = re.split(r'\n(#{1,3}\s)', text)
    chunks = []
    current = ""

    for section in sections:
        if len(current.split()) + len(section.split()) > max_tokens * 0.75:
            if current:
                chunks.append(current.strip())
            current = section
        else:
            current += section

    if current:
        chunks.append(current.strip())
    return chunks
```

**Use when:** Markdown docs, code files, structured content with headers and sections.

### Chunk Size Guidelines

| Use Case | Chunk Size (tokens) | Overlap |
|---|---|---|
| Q&A over docs | 256-512 | 10-20% |
| Summarization | 512-1024 | 5-10% |
| Code search | 128-256 | 20-30% |
| Legal / compliance | 512-768 | 15-20% |
| Conversational RAG | 256-384 | 10-15% |

**Rule of thumb:** Smaller chunks improve precision; larger chunks improve recall. Start at 512 tokens and tune based on eval results.

## Hybrid Search

Combine vector similarity with keyword matching for best recall.

### Architecture

```python
from typing import TypedDict

class SearchResult(TypedDict):
    id: str
    text: str
    score: float
    source: str  # "vector" | "keyword" | "both"

def hybrid_search(
    query: str,
    vector_store,
    keyword_index,
    vector_weight: float = 0.7,
    keyword_weight: float = 0.3,
    top_k: int = 10
) -> list[SearchResult]:
    """Combine vector and keyword search with reciprocal rank fusion."""
    vector_results = vector_store.search(query, k=top_k * 2)
    keyword_results = keyword_index.search(query, k=top_k * 2)

    # Reciprocal Rank Fusion (RRF)
    scores: dict[str, float] = {}
    k = 60  # RRF constant

    for rank, result in enumerate(vector_results):
        scores[result.id] = scores.get(result.id, 0) + vector_weight / (k + rank + 1)

    for rank, result in enumerate(keyword_results):
        scores[result.id] = scores.get(result.id, 0) + keyword_weight / (k + rank + 1)

    # Sort by combined score, return top_k
    sorted_ids = sorted(scores, key=scores.get, reverse=True)[:top_k]
    return [get_document(doc_id) for doc_id in sorted_ids]
```

### When Hybrid Outperforms Pure Vector

- **Exact match queries** -- Product names, error codes, IDs
- **Rare terms** -- Technical jargon not well represented in embedding space
- **Acronyms and abbreviations** -- "CQRS", "ADR", "DDD"
- **Multilingual queries** -- Keyword match handles code-switching

## Re-Ranking

Score retrieved documents with a cross-encoder for precision.

```python
# Using Cohere Rerank
import cohere

co = cohere.Client(api_key="...")

def rerank(query: str, documents: list[str], top_k: int = 5) -> list[dict]:
    """Re-rank documents using Cohere cross-encoder."""
    response = co.rerank(
        model="rerank-v3.5",
        query=query,
        documents=documents,
        top_n=top_k
    )
    return [
        {"index": r.index, "score": r.relevance_score, "text": documents[r.index]}
        for r in response.results
    ]
```

### Two-Stage Pipeline

```
Stage 1: Retrieve top-50 via hybrid search (fast, high recall)
Stage 2: Re-rank to top-5 via cross-encoder (slower, high precision)
```

This pattern gives you the recall of broad retrieval with the precision of deep scoring.

## Context Assembly

### Token Budget Management

```python
def assemble_context(
    documents: list[str],
    max_context_tokens: int = 4000,
    system_prompt_tokens: int = 500,
    max_response_tokens: int = 2000,
    model_context_window: int = 128000
) -> str:
    """Assemble retrieved documents into a context string within token budget."""
    available = min(max_context_tokens, model_context_window - system_prompt_tokens - max_response_tokens)

    context_parts = []
    used_tokens = 0

    for i, doc in enumerate(documents):
        doc_tokens = len(doc.split()) * 1.3  # Rough estimate
        if used_tokens + doc_tokens > available:
            break
        context_parts.append(f"[Source {i+1}]\n{doc}")
        used_tokens += doc_tokens

    return "\n\n---\n\n".join(context_parts)
```

### Context Ordering

- **Most relevant first** -- Models attend more strongly to early context
- **Recency-weighted** -- For time-sensitive queries, prefer recent sources
- **Deduplicated** -- Remove near-duplicate chunks before assembly

## TypeScript RAG Pipeline

```typescript
interface RAGConfig {
  chunkSize: number;
  chunkOverlap: number;
  topK: number;
  rerankTopK: number;
  maxContextTokens: number;
}

interface RetrievedDocument {
  id: string;
  text: string;
  score: number;
  metadata: Record<string, unknown>;
}

async function ragQuery(
  query: string,
  config: RAGConfig,
  vectorStore: VectorStore,
  llmClient: LLMClient
): Promise<{ answer: string; sources: RetrievedDocument[] }> {
  // 1. Retrieve
  const candidates = await vectorStore.search(query, config.topK * 3);

  // 2. Re-rank
  const reranked = await rerank(query, candidates, config.rerankTopK);

  // 3. Assemble context
  const context = assembleContext(reranked, config.maxContextTokens);

  // 4. Generate
  const answer = await llmClient.generate({
    system: "Answer based on the provided context. Cite sources by number.",
    messages: [
      { role: "user", content: `Context:\n${context}\n\nQuestion: ${query}` },
    ],
  });

  return { answer, sources: reranked };
}
```

## Vector Database Selection

| Database | Best For | Key Feature |
|---|---|---|
| **Pinecone** | Managed, zero-ops | Serverless, auto-scaling |
| **Weaviate** | Hybrid search + knowledge graph | Built-in BM25 + vector |
| **Qdrant** | Complex metadata filtering | Rich filter expressions |
| **Milvus** | Billion-scale deployments | GPU-accelerated search |
| **pgvector** | PostgreSQL shops | No new infrastructure |
| **ChromaDB** | Prototyping, local dev | Simple API, embeds included |

### Selection Criteria

1. **Scale** -- Millions vs billions of vectors
2. **Hosting** -- Managed vs self-hosted
3. **Filtering** -- Metadata filter complexity needed
4. **Hybrid** -- Built-in keyword search needed?
5. **Existing stack** -- Already have Postgres? Use pgvector
6. **Budget** -- Managed services cost more but reduce ops burden

## Common RAG Failure Modes

| Failure | Symptom | Fix |
|---|---|---|
| Chunks too large | Irrelevant context dilutes answer | Reduce chunk size, add re-ranking |
| Chunks too small | Missing context, partial answers | Increase chunk size or add overlap |
| No hybrid search | Misses exact matches (codes, names) | Add BM25/keyword search layer |
| No re-ranking | Noise in top-k results | Add cross-encoder re-ranker |
| Stale index | Outdated answers | Implement incremental indexing |
| No citations | Unverifiable answers | Use Claude citations or source numbering |
| Context overflow | Truncated context, degraded answers | Enforce token budget in assembly |
