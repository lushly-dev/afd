# Umbel: research synthesis

**Research date:** October 30, 2026

**Status:** Synthesis of public sources to inform the [proposal](proposal.md).
Not an implementation or a delivery commitment. Source IDs refer to the
[ledger](sources.md).

## Executive conclusion

Three findings shape the proposal. Memory and consolidation are done by a
model outside a deterministic store, in the background, with durable writes
gated by people. Lexical search is again the non-optional first stage, with
vectors and rerankers as optional lanes proven by evaluation, and graphs that
help on multi-hop questions are built from structure rather than generative
extraction once corpora grow. The MCP 2026-07-28 revision is current until
March 2027, the Rust SDK covers the protocol but not server-side
authorization, and small tool surfaces with deferred discovery are measured to
help model accuracy.

## 1. Memory and knowledge-base write-back

### Converged practice

- The store is deterministic and the model is outside it. Editable file
  directories (Anthropic memory tool, Claude Code, LangChain Agent Builder,
  Letta Code, SharePoint team knowledge base) and fact or graph stores fed by
  an extraction step (Mem0, Zep/Graphiti, Vertex Memory Bank, LangMem,
  Cognee) both keep extraction and consolidation out of the storage layer
  [S01, S03, S05, S07, S09, S12].
- Background consolidation is standard: Letta sleep-time agents, OpenAI's
  background memory curation, LangMem background formation, Vertex async
  extraction, Guru's daily verification runs [S03, S08, S09, S13].
- Durable writes are human-gated in enterprise products: Notion suggested
  edits, Glean pause-before-write, LangChain approval on every edit,
  SharePoint confirmation for restructures [S10, S11, S06, S12].
- Provenance and validity intervals beat deletion. Graphiti invalidates
  rather than deletes; Vertex exposes revisions [S05, S09].
- Memory is an attack surface: query-only poisoning (MINJA), payloads that
  arrive through retrieval and bypass input filters, and a patched incident in
  which page summarisation wrote instructions into persistent memory
  [S14, S15, S19].

### Measured findings

| Finding | Result | Source |
| --- | --- | --- |
| Consolidation drops the source's constraints | 48 of 49 consolidator and model configurations; unauthorised actions 50.3% without authority metadata, 0.0% with authority labels stored at write time | S16 |
| Embedding retrieval for updated facts | unreliable, 0.30 to 0.95; agents act on a correctly retrieved value 55% of the time; update-on-write structured stores do best | S17 |
| Environment-probing curation | pass rate 39% to 73%, cost per task halved | S18 |
| Vendor memory benchmarks | not reproducible across vendors; one benchmark described as saturating | S04, S20 |

### Design implications

Two stores with two write paths; a proposal primitive for the knowledge base;
mandatory provenance and authority on every record, preserved through
consolidation; invalidate rather than overwrite; deterministic hygiene the
host can enforce without a model (schema, caps, namespaces, duplicates,
expiry, rate limits); scoped namespaces with per-client revoke; a freshness
workflow with a verifier and status on every hit; stored content treated as
untrusted on read and scanned on write; host-computed consolidation candidates
for an external curator; evaluation on tasks and cost rather than question
answering alone.

## 2. Retrieval over a company knowledge base

### Converged practice

- Lexical search is the default first stage. Over 511,959 enterprise
  documents, BM25 was the only method that stayed Pareto-optimal; dense-only
  retrieval degraded and model-built graphs could not be constructed at scale
  [S21].
- Hybrid BM25 plus dense retrieval fused by reciprocal rank, with an optional
  reranker, beats either constituent in every 2026 domain benchmark found
  [S27, S28].
- Reasoning moved out of the index into the agent loop. Cheap deterministic
  search plus follow-up reads, iterated by the model, is the shape used by
  Microsoft, Anthropic, Sourcegraph and Glean [S31, S32, S33, S34].
- Graphs help multi-hop and aggregation, not fact lookup, and the direction of
  travel is structure derived without generative extraction [S22, S23, S25].

### Measured findings

| Finding | Result | Source |
| --- | --- | --- |
| Graphs versus plain retrieval | fact retrieval: basic RAG with rerank 60.9 vs 49.3; multi-hop: HippoRAG 2 53.4 vs 42.9; per-query prompt tokens 879 vs 1,008 to 331,375 | S22 |
| Graph advantage by question type | +0.5 exact match on general questions, +27 on multi-hop | S23 |
| Cost at scale | HippoRAG 2 built to 131,876 documents at about 2.9B generative tokens; LightRAG to 2,254; Microsoft GraphRAG to 8,750 | S21 |
| Hybrid fusion | BM25 recall@10 0.500, hybrid 0.715, hybrid plus rerank 0.720 | S28 |
| Agentic retrieval with four tools | recall@1 8.41% single-shot to 49.6% at 2.6x tokens | S31 |
| Boolean query syntax over BM25 | matched an agentic hybrid system at 41x lower build cost with fewer hallucinations | S32 |
| Rerankers | neutral or negative on 2 of 5 technical-documentation topics; listwise LLM reranking can degrade strong retrievers | S29, S30 |

### Design implications

A fielded BM25 index with query syntax as the core; embeddings as an optional
lane fused by reciprocal rank through local ONNX or an HTTP endpoint, with the
model version persisted; a rerank lane gated by the instance's own eval; a
deterministic structural graph exposed as commands and as a rank-expansion
signal; the search, open, find and metadata tool shape with concise and
detailed result formats; stable citation locators; structure-aware chunks of
about 200 to 400 tokens presented per document; an eval harness in the
repository; routing and effort left to the calling model.

## 3. MCP, server design, authorization and plugins

### Protocol and SDK

- 2026-07-28 is the latest release. The next is scheduled for 2027-03-30 on a
  six-month cadence; the roadmap names progressive discovery, server-initiated
  events, Tasks toward core and DPoP [S35, S36, S37].
- The revision is stateless: no sessions or initialize, per-request `_meta`,
  `server/discover` required, `resultType`, `ttlMs` and `cacheScope` on list
  results, deterministic tool order, Tasks and Apps as extensions, and Roots,
  Sampling, Logging and dynamic client registration deprecated [S35].
- rmcp 3.8.0 implements the revision server-side, including resources,
  prompts, tasks, subscriptions and per-request tool lookup, but has no
  resource-server authorization layer; the example hand-builds protected
  resource metadata and middleware [S38, S39].
- Claude Code negotiates 2026-07-28 by default as of October 2026; support in
  other hosts is unverified [S40].

### Server design

| Finding | Result | Source |
| --- | --- | --- |
| Deferred tool loading | context tokens about 77K to 8.7K; accuracy 49% to 74% and 79.5% to 88.1% on an MCP evaluation | S42 |
| Code execution against tools | 150,000 to 2,000 tokens in the published example | S41 |
| Adaptive tool shortlists | correct tool 93.1% vs 87.1% with a fixed five; 76.8% vs 60.9% on hard queries | S44 |
| Default toolsets | one public server cut 101 tools to 52 and 64.6k tokens to 30.3k | S45 |
| Live progressive discovery | about 22 primary tools plus discover and read, write and destructive execute tiers | S46 |

### Authorization and plugins

- A server using authorization is an OAuth 2.1 resource server: protected
  resource metadata, audience validation, 401 and 403 challenges with scope,
  scope hierarchies; client registration by metadata document; enterprise-
  managed authorization is stable and supported by major identity providers
  [S35, S47, S48].
- WebAssembly components are production-grade: WASI 0.3 final in June 2026,
  Wasmtime 50 in October 2026, wit-bindgen 0.63. Fuel is deterministic, epochs
  bound wall-clock, and practitioners use both plus memory caps [S49, S50].
- There is no official convention for mounting one MCP server inside another;
  prefixed names and no credential forwarding are the practice [S51].
- Distribution runs through per-platform binaries, MCPB bundles, OCI images,
  the registry's `server.json` and Server Cards [S52, S53].

### Design implications

Target 2026-07-28 natively; keep three to six first-class tools and the lazy
strategy for the rest; documents as resources but keep a fetch tool; two
plugin tiers, in-process components and mounted MCP servers, no dynamic
libraries; build the resource-server layer as middleware with pluggable
authenticator, metadata provider and scope resolver; Tasks for ingestion and
curation jobs; stateless from the first version; ship five distribution
artifacts; trace context in `_meta`.

## 4. Scale

Estimates assume about eight 300-token chunks per document, a 300M-parameter
embedding model on a laptop CPU and mid-tier model prices.

| Documents | Chunks | Local embedding time | Vector index, int8 to fp32 | One-pass model extraction |
| --- | --- | --- | --- | --- |
| 1k | 8k | about 5 minutes | 6 to 24 MB | about $15 |
| 10k | 80k | about 45 minutes | 60 to 240 MB | about $100 to $150 |
| 100k | 800k | hours; GPU or hosted | 0.6 to 2.4 GB | about $1,500 |
| 1M | 8M | days; hosted | 6 to 24 GB | about $15,000 |

Hosted embedding endpoints are cheap at every size; local CPU time is the
constraint. Multi-pass graph construction spends about 20k tokens per document
and is the cost wall reported above.
