# Embedding Strategies

Model selection, dimensionality, indexing, and similarity search for vector-based retrieval.

## Embedding Model Selection

### Commercial Models (2025)

| Model | Provider | Dimensions | Best For |
|---|---|---|---|
| `text-embedding-3-large` | OpenAI | 3072 (reducible) | General purpose, English |
| `text-embedding-3-small` | OpenAI | 1536 | Cost-sensitive, good quality |
| `voyage-3-large` | Voyage AI | 2048 (reducible) | SOTA retrieval, multilingual |
| `voyage-3.5-lite` | Voyage AI | 256-1024 | Low-cost, mobile/edge |
| `embed-v4.0` | Cohere | 1024 | Multilingual, built-in compression |

### Open-Source Models

| Model | Dimensions | Best For |
|---|---|---|
| `nomic-embed-text-v2-moe` | 768 | Mixture-of-experts, high quality |
| `bge-m3` | 1024 | Multilingual, dense + sparse |
| `gte-large-en-v1.5` | 1024 | English-focused, strong benchmarks |
| `e5-mistral-7b-instruct` | 4096 | Instruction-tuned, code + text |

### Selection Criteria

1. **Domain match** -- Code search models differ from document search models
2. **Language coverage** -- Multilingual needs favor Voyage or BGE-M3
3. **Dimensionality budget** -- Higher dims = better quality but more storage/compute
4. **Cost per token** -- 10x difference between models at scale
5. **Latency** -- Self-hosted vs API call round-trip

## Generating Embeddings

### Python (OpenAI)

```python
from openai import OpenAI

client = OpenAI()

def embed_texts(texts: list[str], model: str = "text-embedding-3-large") -> list[list[float]]:
    """Embed a batch of texts. Max 2048 items per batch."""
    response = client.embeddings.create(
        model=model,
        input=texts,
        dimensions=1536  # Optional: reduce from 3072 for cost savings
    )
    return [item.embedding for item in response.data]
```

### Python (Voyage AI)

```python
import voyageai

client = voyageai.Client()

def embed_texts(texts: list[str], input_type: str = "document") -> list[list[float]]:
    """Embed texts with Voyage AI. Use input_type='query' for search queries."""
    result = client.embed(
        texts,
        model="voyage-3-large",
        input_type=input_type,  # "document" for indexing, "query" for searching
        output_dimension=1024   # Reduce from 2048 for cost savings
    )
    return result.embeddings
```

### TypeScript (OpenAI)

```typescript
import OpenAI from "openai";

const openai = new OpenAI();

async function embedTexts(
  texts: string[],
  model = "text-embedding-3-large"
): Promise<number[][]> {
  const response = await openai.embeddings.create({
    model,
    input: texts,
    dimensions: 1536,
  });
  return response.data.map((item) => item.embedding);
}
```

## Dimensionality Reduction

Modern embedding models support Matryoshka Representation Learning (MRL), allowing you to truncate dimensions without retraining.

### Trade-offs

| Dimensions | Storage per Vector | Quality (Relative) | Use Case |
|---|---|---|---|
| 3072 (full) | 12 KB | 100% | Maximum accuracy |
| 1536 | 6 KB | ~98% | Good balance for most apps |
| 1024 | 4 KB | ~96% | Cost-optimized production |
| 512 | 2 KB | ~93% | High-volume, latency-sensitive |
| 256 | 1 KB | ~88% | Mobile/edge, pre-filtering |

**Recommendation:** Start at 1024 or 1536 dimensions. Only go higher if eval results justify the cost.

### Implementation

```python
# OpenAI - specify at embed time
response = client.embeddings.create(
    model="text-embedding-3-large",
    input=texts,
    dimensions=1024  # Truncates from 3072
)

# Voyage AI - specify output dimension
result = client.embed(
    texts,
    model="voyage-3-large",
    output_dimension=1024  # Truncates from 2048
)

# Manual truncation (for models without built-in support)
import numpy as np

def truncate_embedding(embedding: list[float], target_dim: int) -> list[float]:
    vec = np.array(embedding[:target_dim])
    return (vec / np.linalg.norm(vec)).tolist()  # Re-normalize after truncation
```

## Similarity Search

### Distance Metrics

| Metric | Formula | Best For |
|---|---|---|
| Cosine similarity | `dot(a,b) / (||a|| * ||b||)` | Normalized embeddings (most common) |
| Dot product | `dot(a,b)` | Pre-normalized vectors (faster) |
| Euclidean (L2) | `||a - b||` | When magnitude matters |

**Default choice:** Cosine similarity. Most embedding models output normalized vectors.

### Approximate Nearest Neighbor (ANN) Algorithms

| Algorithm | Speed | Recall | Memory | Best For |
|---|---|---|---|---|
| HNSW | Fast | High | High | Most production workloads |
| IVF-PQ | Very fast | Medium | Low | Billion-scale, cost-sensitive |
| Flat (brute force) | Slow | Perfect | Low | Small datasets (<100K vectors) |

```python
# pgvector example with HNSW index
"""
CREATE TABLE documents (
    id SERIAL PRIMARY KEY,
    content TEXT,
    embedding vector(1024),
    metadata JSONB
);

-- HNSW index for cosine similarity
CREATE INDEX ON documents
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 200);

-- Query
SELECT id, content, 1 - (embedding <=> query_embedding) AS similarity
FROM documents
ORDER BY embedding <=> query_embedding
LIMIT 10;
"""
```

## Indexing Pipeline

```python
from dataclasses import dataclass
from typing import Any

@dataclass
class IndexedDocument:
    id: str
    text: str
    embedding: list[float]
    metadata: dict[str, Any]

async def index_documents(
    documents: list[dict],
    embedding_fn,
    vector_store,
    chunk_fn,
    batch_size: int = 100
) -> int:
    """Full indexing pipeline: chunk -> embed -> store."""
    indexed = 0

    for doc in documents:
        # 1. Chunk
        chunks = chunk_fn(doc["text"])

        # 2. Batch embed
        for i in range(0, len(chunks), batch_size):
            batch = chunks[i:i + batch_size]
            embeddings = await embedding_fn(batch)

            # 3. Store with metadata
            records = [
                IndexedDocument(
                    id=f"{doc['id']}_chunk_{i+j}",
                    text=chunk,
                    embedding=emb,
                    metadata={
                        "source_id": doc["id"],
                        "chunk_index": i + j,
                        "title": doc.get("title", ""),
                        "created_at": doc.get("created_at", ""),
                    }
                )
                for j, (chunk, emb) in enumerate(zip(batch, embeddings))
            ]
            await vector_store.upsert(records)
            indexed += len(records)

    return indexed
```

## Re-Ranking

Re-rankers use cross-encoders that process query-document pairs together, producing higher quality relevance scores than bi-encoder (embedding) similarity.

### When to Re-Rank

- After retrieving 20-50 candidates from vector search
- When precision matters more than latency
- For complex queries where semantic similarity alone is insufficient

### Implementation

```python
# Cohere Rerank
import cohere

co = cohere.ClientV2()

async def rerank_documents(
    query: str,
    documents: list[str],
    top_k: int = 5
) -> list[dict]:
    response = co.rerank(
        model="rerank-v3.5",
        query=query,
        documents=documents,
        top_n=top_k
    )
    return [
        {"index": r.index, "score": r.relevance_score}
        for r in response.results
    ]

# Voyage AI Rerank
import voyageai

client = voyageai.Client()

def rerank_voyage(query: str, documents: list[str], top_k: int = 5):
    result = client.rerank(
        query=query,
        documents=documents,
        model="rerank-2",
        top_k=top_k
    )
    return result.results
```

## Cost Estimation

### Embedding Costs at Scale

| Model | Cost per 1M Tokens | 1M Documents (500 tokens avg) | Monthly (10K queries/day) |
|---|---|---|---|
| `text-embedding-3-small` | $0.02 | $10 | $3 |
| `text-embedding-3-large` | $0.13 | $65 | $20 |
| `voyage-3-large` | $0.18 | $90 | $27 |
| Self-hosted (bge-m3) | ~$0.005* | ~$2.50 | <$1 |

*Compute cost only, excludes infrastructure.

### Storage Costs

| Dimensions | Vectors | Storage (float32) | Pinecone Cost/mo |
|---|---|---|---|
| 1024 | 1M | ~4 GB | ~$70 |
| 1024 | 10M | ~40 GB | ~$350 |
| 1536 | 1M | ~6 GB | ~$100 |
| 3072 | 1M | ~12 GB | ~$200 |

## Best Practices

1. **Use different input types for queries vs documents** -- Voyage AI and Cohere support `input_type` that optimizes embeddings for their role
2. **Batch embed** -- Send 50-100 texts per API call, not one at a time
3. **Cache embeddings** -- Store computed embeddings; re-embed only on content change
4. **Normalize vectors** -- Ensure unit length for cosine similarity
5. **Track embedding model version** -- Store the model name alongside vectors; re-embed when upgrading
6. **Test dimensionality reduction** -- Run evals at 1024 vs 1536 vs 3072 before choosing
7. **Pre-filter before vector search** -- Use metadata filters to narrow the search space
