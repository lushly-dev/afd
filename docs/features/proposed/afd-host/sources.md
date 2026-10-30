# AFD host research: annotated source ledger

**Retrieved:** October 30, 2026

**Companion:** [Research synthesis](research.md)

Each row distinguishes what the source documents from what it claims. Vendor
benchmark numbers are self-reported unless a row says otherwise. Reading
coverage was the cited page or paper section, not complete products.

## Memory and knowledge-base write-back

| ID / source | Evidence | Inference limit |
| --- | --- | --- |
| **S01** [Anthropic memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool) (GA docs) | Client-side file commands under a memory directory; prescribed path checks, size caps and expiry | Documents one client-side design; storage is the integrator's |
| **S02** [Claude release notes](https://support.claude.com/en/articles/12138966-release-notes) (Mar 2, Jul 10, Aug 25 2026) | Memory rollout, categorised and editable entries, sensitive topics opt-in | Product behavior, not architecture detail |
| **S03** [Letta sleep-time compute](https://www.letta.com/blog/sleep-time-compute) (Apr 21 2025); [Letta docs](https://docs.letta.com/guides/agents/architectures/sleeptime) (2026) | A separate agent owns memory edits; background consolidation at compaction into a git-backed memory filesystem | Vendor design; second-agent review is not human approval |
| **S04** [Mem0, State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026) (Apr 2026, updated Oct 2026); [memory operations docs](https://docs.mem0.ai/core-concepts/memory-operations) | Add-only extraction pipeline, scoping keys, async writes; staleness listed as open | Self-reported benchmark scores; disputed by S20 |
| **S05** [Graphiti overview](https://help.getzep.com/graphiti/getting-started/overview); [README and MCP server](https://github.com/getzep/graphiti) (2026) | Bitemporal edges, invalidation instead of deletion, hybrid retrieval without LLM reranking; reference MCP server states no auth or injection protection | Requires an LLM for ingestion |
| **S06** [LangChain, Agent Builder memory](https://www.langchain.com/blog/how-we-built-agent-builders-memory-system) (Feb 21 2026); [LangMem guide](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/) | Files in Postgres as a virtual filesystem, schema-validated, every edit approved; compaction stays user-triggered | One vendor's production lesson |
| **S07** [Cognee releases](https://github.com/topoteretes/cognee/releases) (2026) | Graph plus vector, pruning and reweighting steps, an MCP server | Mostly vendor pages |
| **S08** [OpenAI, memory "Dreaming"](https://openai.com/index/chatgpt-memory-dreaming/) (Jun 4 2026) | Background curation and rewriting of memory; editable summary; legacy opt-out | Consumer product; user complaints about lost control reported separately |
| **S09** [Vertex AI Memory Bank](https://cloud.google.com/blog/products/ai-machine-learning/vertex-ai-memory-bank-in-public-preview) (Jul 8 2025); [docs](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/overview) (Oct 30 2026) | Async extraction, contradiction resolution, scope keys, memory revisions, IAM conditions | Preview-stage documentation |
| **S10** [Notion release](https://www.notion.com/releases/2026-08-28) (Aug 28 2026) | Agent suggested edits approved one by one; page permissions respected; activity logs | Feature notes only |
| **S11** [Glean release notes](https://docs.glean.com/release-notes/releases/2026-08-18-august-release) (Jan to Aug 2026) | Pause before write, remote MCP write tools, alignment check before writes, read and write tool split | Feature notes only |
| **S12** [Microsoft, team knowledge base curated by Copilot and agents](https://techcommunity.microsoft.com/blog/spblog/introducing-a-team-knowledge-base-curated-by-copilot-and-agents/4564203) (Oct 14 2026) | Interlinked markdown pages; agents contribute as the user; structural changes confirmed | Preview; review step and version history unverified |
| **S13** [Guru, how content is verified](https://help.getguru.com/docs/verifying-and-unverifying-cards) (updated Sep 16 2026) | Verifier per card, intervals, auto-unverify on non-verifier edit, daily agent runs with logged reasons | Closest shipped verification loop; product documentation |
| **S14** [MINJA](https://arxiv.org/abs/2503.03704) (NeurIPS 2025) | Memory poisoning through ordinary queries without write access | Research setting |
| **S15** [Injection-Execution Dissociation](https://arxiv.org/abs/2605.08442) (May 2026, v6 Oct 2026) | Payloads arriving through retrieval bypass input filters; removing recall was the only reliable defence | Preprint |
| **S16** [When Memory Becomes Authority, AuthMem-Bench](https://arxiv.org/abs/2608.01679) (Aug 3 2026) | Consolidation drops source constraints in 48 of 49 configurations; authority labels at write time cut unauthorised actions from 50.3% to 0.0% | Preprint; benchmark-specific |
| **S17** [MERIT, When Does Memory Help?](https://arxiv.org/abs/2609.05441) (Jul 26 2026) | Embedding retrieval unreliable for updated facts; update-on-write stores best; task-based with cost accounting | Preprint |
| **S18** [Environment-Probing Curation](https://arxiv.org/abs/2609.11060) (Sep 10 2026) | Read-only grounding before saving raised pass rate from 39% to 73% and halved cost | One benchmark |
| **S19** [OWASP, memory as attack surface](https://genai.owasp.org/2026/05/13/memory-is-a-feature-it-is-also-an-attack-surface/) (May 13 2026); [Q3 2026 roundup](https://genai.owasp.org/2026/10/08/genai-and-agentic-ai-exploit-roundup-q3-2026/); [Agent Memory Guard](https://owasp.org/www-project-agent-memory-guard/) | Memory named a risk category; a patched incident wrote instructions into persistent memory via summarisation | Guidance, not measurements |
| **S20** [LongMemEval](https://github.com/xiaowu0162/longmemeval) (ICLR 2025); [Zep on Mem0 scores](https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/) and [rebuttal](https://github.com/getzep/zep-papers/issues/5); [Hindsight](https://aclanthology.org/2026.acl-demo.27/) (ACL 2026) | Benchmarks exist; vendor numbers were revised and not reproduced across vendors | Treat vendor scores as unverified |

## Retrieval

| ID / source | Evidence | Inference limit |
| --- | --- | --- |
| **S21** [BM25 Wins at Scale](https://arxiv.org/html/2607.26497v2) (Jul 30 2026) | 511,959 documents: BM25 Pareto-optimal; dense degraded; graph builders stopped at 131,876, 8,750 and 2,254 documents with estimated token costs | One enterprise corpus; cost figures are estimates |
| **S22** [GraphRAG-Bench](https://arxiv.org/html/2506.05690) (ICLR 2026) | Seven systems: plain RAG wins fact retrieval, graphs win multi-hop and summarisation; per-query token counts | GPT-4o-mini as the model |
| **S23** [Do We Still Need GraphRAG?](https://arxiv.org/html/2604.09666v1) (Apr 1 2026) | +0.5 exact match on general questions, +27 on multi-hop; agentic search narrows the gap | Preprint |
| **S24** [RAG vs GraphRAG](https://arxiv.org/pdf/2502.11371) (v3 Mar 2026); [WildGraphBench](https://arxiv.org/abs/2602.02053) (Feb 2026); [EffiRAG](https://arxiv.org/abs/2609.18099) (Sep 2026) | Combinations beat either alone; graphs hurt summarisation precision; graph used only to locate passages won at 57% lower cost | Different corpora and metrics |
| **S25** [LinearRAG](https://arxiv.org/abs/2510.10114) (ICLR 2026); [LazyGraphRAG](https://www.microsoft.com/en-us/research/blog/lazygraphrag-setting-a-new-standard-for-quality-and-cost/) (Nov 2024); [ContextRAG](https://arxiv.org/abs/2605.19735) (May 2026) | Structure derived without generative extraction: NER linking, noun-phrase co-occurrence, chunk lattices | LazyGraphRAG results are on one corpus with LLM-judged queries |
| **S26** [HippoRAG 2](https://arxiv.org/abs/2502.14802) (ICML 2025); [Graphiti paper](https://arxiv.org/abs/2501.13956); [KAG](https://arxiv.org/html/2409.13731v3) (WWW 2025) | Mechanisms: triples plus passage nodes with personalized PageRank; bitemporal graph; schema-constrained graph | KAG's gains are third-party reported |
| **S27** [Financial text-and-table benchmark](https://arxiv.org/html/2604.01733v1) (Apr 2026) | 23,088 queries: BM25 beat a large embedding model on most metrics; reciprocal rank fusion beat both; rerank reached recall@5 0.816 | One domain |
| **S28** [Scientific repository search](https://arxiv.org/pdf/2607.05443) (Jul 2026) | BM25 recall@10 0.500, hybrid 0.715, hybrid plus rerank 0.720 | One domain |
| **S29** [FreshStack](https://arxiv.org/abs/2504.13128) (2025) | Rerankers failed to improve two of five technical-documentation topics | Nugget-based evaluation |
| **S30** [BRIGHT baselines](https://arxiv.org/pdf/2509.02558) (Feb 2026); [LLM rerankers study](https://arxiv.org/abs/2508.16757) (EMNLP 2025) | Listwise LLM reranking can degrade strong retrievers; query novelty dominates reranker effectiveness | Reasoning-intensive benchmark |
| **S31** [AgenticRAG](https://arxiv.org/html/2605.05538v1) (Microsoft, May 7 2026) | Four tools; recall@1 8.41% to 49.6% at 2.6x tokens; title and type in results cut redundant searches | Tool shape evidence from one lab |
| **S32** [LogicalRAG](https://arxiv.org/html/2605.27123v1) (May 26 2026) | Boolean query syntax over BM25 matched an agentic hybrid system at 41x lower build cost with fewer hallucinations | One benchmark suite |
| **S33** Anthropic: [writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) (Sep 2025); [context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (Sep 2025); [contextual retrieval](https://www.anthropic.com/engineering/contextual-retrieval) (Sep 2024) | Consolidated tools, concise and detailed formats, pagination; contextual chunk prefixes cut retrieval failure by up to 67% | Vendor guidance and one evaluation |
| **S34** [Azure AI Search agentic retrieval](https://learn.microsoft.com/en-us/azure/search/agentic-retrieval-overview) (Sep 2026); [Sourcegraph Deep Search](https://sourcegraph.com/blog/deep-search); [Glean enterprise graph](https://www.glean.com/blog/knowledge-graph-agentic-engine); [OpenAI file search](https://developers.openai.com/api/docs/guides/tools-file-search) | Planner-issued subqueries with activity logs; deterministic search kept separate from agentic search; metadata-derived graphs | Vendor relevance claims unverified |

## MCP, server design, authorization and plugins

| ID / source | Evidence | Inference limit |
| --- | --- | --- |
| **S35** [MCP 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog); [release post](https://blog.modelcontextprotocol.io/posts/2026-07-28/); [authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) | Stateless revision, required discover, result and cache fields, deprecations, resource-server obligations | Specification text |
| **S36** [SEP-3398 release cycle](https://modelcontextprotocol.io/seps/3398-release-cycle-updates) (accepted Oct 14 2026) | Next release 2027-03-30 on a six-month cadence | Process decision |
| **S37** [MCP roadmap](https://blog.modelcontextprotocol.io/posts/mcp-roadmap/) (Aug 22 2026) | Progressive discovery, server-initiated events, Tasks toward core, DPoP | Intent, not shipped |
| **S38** [rmcp README and changelog](https://github.com/modelcontextprotocol/rust-sdk) (3.8.0, Oct 2026); [crates.io](https://crates.io/crates/rmcp) | Server-side tools, resources, prompts, tasks, subscriptions, per-request tool lookup; client-side OAuth | Tasks maturity unverified |
| **S39** rmcp `examples/servers/src/complex_auth_streamhttp.rs` | Protected resource metadata and middleware hand-built with an in-memory token map | No resource-server abstraction exists |
| **S40** [Claude Code changelog](https://code.claude.com/docs/en/changelog) (Oct 6 to 16 2026); [Claude on 2026-07-28](https://claude.com/blog/bringing-mcp-2026-07-28-to-claude) | Default negotiation of 2026-07-28 for stdio and connectors; fixes for servers omitting new fields | Other hosts unverified |
| **S41** [Anthropic, code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) (Nov 4 2025) | 150,000 to 2,000 tokens in the published example; requires a secure sandbox | One example |
| **S42** [Anthropic, advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use) (Nov 24 2025) | Deferred loading cut context about 85%; accuracy 49% to 74% and 79.5% to 88.1% on an MCP evaluation | Vendor evaluation |
| **S43** [Cloudflare Code Mode](https://blog.cloudflare.com/code-mode/) (Feb 20 2026); [scaling MCP adoption](https://blog.cloudflare.com/scaling-mcp-adoption/) (Apr 2026) | Two tools over an API spec in an isolate; portals with per-portal tool exposure | No accuracy claims |
| **S44** [Adaptive tool shortlists](https://arxiv.org/abs/2605.24660) (May 23 2026) | Correct tool 93.1% vs 87.1% with a fixed five; 76.8% vs 60.9% on hard queries | Preprint |
| **S45** GitHub MCP server README and discussion (Oct 2025); [StackOne token measurement](https://www.stackone.com/blog/mcp-token-optimization) (Mar 31 2026) | Default toolsets cut 101 tools to 52 and 64.6k tokens to 30.3k; about 17,600 tokens per request for 94 tools | Vendor measurements |
| **S46** Atlassian Rovo MCP supported tools; Notion MCP tools; [Glean MCP](https://docs.glean.com); [Linear MCP](https://linear.app/docs/mcp) (checked Oct 30 2026) | Discover plus read, write and destructive execute tiers; admin-selected subsets; read-only endpoints | Documentation only |
| **S47** [Okta cross-app access](https://developer.okta.com/docs/concepts/xaa/); [Entra agent identities](https://learn.microsoft.com/en-us/entra/) (updated Jun 2026) | Enterprise-managed authorization issuers and acceptors | GA dates partly secondary |
| **S48** [Microsoft mcp-gateway](https://github.com/microsoft/mcp-gateway); Kong AI Gateway changelog; Cloudflare portals | Token validation, per-context tool catalogs, per-tool policy on protocol headers | Kong details secondary |
| **S49** [WASI 0.3](https://bytecodealliance.org/articles/WASI-0.3) (Jun 11 2026); [Wasmtime 50](https://github.com/bytecodealliance/wasmtime/releases) (Oct 20 2026); [wit-bindgen](https://crates.io/crates/wit-bindgen) 0.63 | Component model and async stable in the runtime; fuel and epoch limits | Determinism caveats around host calls |
| **S50** [Extism](https://github.com/extism/extism/releases) 1.41; Spin 4; wasmCloud; Zed context-server extensions | Alternatives and their trade-offs; Zed spawns native servers rather than running MCP in WASM | Vendor documentation |
| **S51** [draft-abbott-mcp-ax-00](https://datatracker.ietf.org/doc/draft-abbott-mcp-ax/) (May 2026); AgentGateway and MetaMCP docs | No official composition convention; prefixed names, no credential forwarding | Individual draft |
| **S52** [MCP registry `server.json`](https://github.com/modelcontextprotocol/registry); [MCPB manifest](https://github.com/anthropics/mcpb) | Package types including cargo, mcpb and oci; binary bundles with platform overrides | Registry still preview |
| **S53** [MCP extensions overview](https://modelcontextprotocol.io/docs/extensions/overview) and client matrix; Docker MCP catalog | Apps stable, Tasks beta, Skills beta, Server Cards beta; catalog submission process | Client matrix is community-maintained |

## Additional sources consulted

| ID / source | Evidence | Inference limit |
| --- | --- | --- |
| **S54** [Atlassian, agents in Confluence](https://www.atlassian.com/blog/confluence/new-agents-in-confluence) (Aug 2026) | Agents create and edit pages and set status as the invoking user | No verified-page workflow found |
| **S55** [Shared organizational memory for coding agents](https://arxiv.org/abs/2608.00122) (Jul 31 2026); [Designing agentic memory in 2026](https://thenuancedperspective.substack.com/p/designing-agentic-memory-in-2026) (May 2026) | Contributor-approved capture then curation; practitioner view that forgetting is neglected and episodic logs should not share a semantic index | Affiliation and sample sizes unverified |
| **S56** [fastembed-rs](https://docs.rs/fastembed/latest/fastembed/) 7.5; [EmbeddingGemma 2](https://blog.google/innovation-and-ai/technology/developers-tools/embeddinggemma-2/) (Oct 6 2026); [Harrier](https://huggingface.co/microsoft/harrier-oss-v1-0.6b) (Apr 2026); [Qwen3 Embedding](https://arxiv.org/abs/2506.05176); [Nemotron 3.5 retriever](https://huggingface.co/blog/nvidia/nemotron-retriever-world-class-agentic-retrieval) (Oct 21 2026) | Sub-1B open models with ONNX paths; multilingual scores | Vendor leaderboard numbers |
| **S57** [Chroma chunking evaluation](https://www.trychroma.com/research/evaluating-chunking); [late chunking](https://arxiv.org/pdf/2409.04701) (v3 2025); [Rethinking chunk size](https://arxiv.org/html/2505.21700v2) (May 2025) | About 250-token chunks with overlap best in one study; larger chunks cut recall 10 to 15% on some sets | Dataset-dependent |
| **S58** [Sentence Transformers v6 multi-vector](https://huggingface.co/blog/multi-vector-encoder) (Aug 2026); [Qwen3-Reranker](https://huggingface.co/Qwen/Qwen3-Reranker-8B) | Late-interaction quality versus 42x storage; reranker scores | Vendor model cards |
| **S59** [UMBRELA reproduction](https://arxiv.org/html/2507.09483) (Jul 2025); [MLflow RAG evaluation datasets](https://mlflow.org/articles/rag-evaluation-datasets/) (Aug 2026) | LLM judges rank systems reliably but label items weakly; a small eval harness recipe | Tooling guidance |

**Unverified:** VS Code, Cursor and ChatGPT support for 2026-07-28; Azure API
Management MCP routing; registry general availability; rmcp Tasks maturity;
fastembed support for some models; every vendor benchmark number above.
