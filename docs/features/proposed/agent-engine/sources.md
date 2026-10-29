# Agent engine research: annotated public-source ledger

**Retrieved:** October 28, 2026

**Companion:** [Research synthesis](research.md)

This ledger distinguishes documented features, attributed operating results and
empirical findings. Reading coverage is stated explicitly; linked references,
complete product environments and all sections of every paper were not inspected.
Search summaries were used only to discover sources.

## Empirical research

| ID / source | Evidence and reading coverage | Inference limit |
| --- | --- | --- |
| **S01 - [Measuring Agents in Production, v4](https://arxiv.org/html/2512.04123v4)**; [metadata](https://arxiv.org/abs/2512.04123) | Abstract, introduction and methodology/limitations excerpt; metadata states ICML 2026 oral acceptance. April-November 2025 collection: 20 interviews, 306 survey responses, 86 production/pilot systems in the main analysis. | Descriptive support for controllable systems and human evaluation. The 68%/70%/74% figures are study results, not current global estimates or causal demonstrations; item denominators differ. |
| **S02 - [Towards a Science of AI Agent Reliability, v1](https://arxiv.org/html/2602.16666v1)** | Abstract, introduction, scope and framework through part of section 3. Retrieved page identifies itself as a 2026 preprint. | Reports 14 models/two benchmarks and limited reliability improvement relative to capability. Not all deployed agents; no independent replication here. |
| **S03 - [UXAgent, v3](https://arxiv.org/html/2502.12561v3)**; [metadata](https://arxiv.org/abs/2502.12561) | Abstract, introduction, study summary and system-design excerpts. CHI Extended Abstracts 2025, DOI 10.1145/3706599.3719729. | Five researchers examined traces from 60 simulated agents. Supports pilot-study preparation, not equivalence to real participants or validated persona-specific prediction. |
| **S04 - [Lost in Simulation, v2](https://arxiv.org/html/2601.17087v2)**; [metadata](https://arxiv.org/abs/2601.17087) | Abstract, introduction and methods, including task selection/recruitment. January 2026 arXiv preprint; no venue acceptance inferred. | Human comparison on 18 selected retail tasks with GPT-4o as task agent. Cautions against unvalidated substitution, not every persona-informed review. |
| **S05 - [Agentic Context Engineering, v3](https://arxiv.org/html/2510.04618v3)**; [metadata](https://arxiv.org/abs/2510.04618) | Abstract, introduction, context-collapse example and framework sections. Metadata lists ICLR 2026; v3 dated March 29, 2026. | Benchmark evidence for incremental context adaptation. Not production UX evidence, arbitrary policy self-modification or a reason to enlarge every prompt indefinitely. |
| **S06 - [From Untrusted Input to Trusted Memory, v2](https://arxiv.org/abs/2606.04329v2)** | Abstract and version metadata of the current landing page. June 18, 2026 preprint; full experimental tables not read. | Supports the stated persistent-memory poisoning risk. No numerical attack/defense claims carried into the synthesis. |

## Continuous and operational agent products

| ID / source | Evidence and reading coverage | Inference limit |
| --- | --- | --- |
| **S07 - [Copilot Studio event triggers](https://learn.microsoft.com/en-us/microsoft-copilot-studio/authoring-triggers-about)** | Main concept, trigger workflow, billing, action selection and authentication. Page metadata updated September 10, 2026. | Documents external/recurrence initiation and maker-auth boundaries. Action-count guidance is product-specific; no tenant or customer benefit verified. |
| **S08 - [Azure SRE Agent overview](https://learn.microsoft.com/azure/sre-agent/overview)** | Full text retrieved through Microsoft documentation tooling. | Describes incident, scheduled and interactive work, shared skills/tools, managed identity and retained context. No GA date or independent effectiveness metric inferred. |
| **S09 - [Azure SRE Agent run modes](https://learn.microsoft.com/azure/sre-agent/run-modes)** | Full text. | Approval and resource permission differ. Approval buttons apply to Azure infrastructure operations; other tool classes need their relevant policies/hooks. Global and automation defaults differ. |
| **S10 - [Repo Assist documentation](https://raw.githubusercontent.com/githubnext/agentics/main/docs/repo-assist.md)** | Full document, including memory, fallback/no-op, anti-spam and scheduled PR caps. Mutable main retrieved on the research date. | A documented recurring-work model, not independent validation of every run or an instruction to install it. |
| **S11 - [Don Syme: Repo Assist](https://dsyme.net/2026/02/25/repo-assist-a-repository-assistant/)** | Article across two fetches, including benefits, oversight, memory caveat and scope. Published February 25, 2026. | First-person report of roughly 200 runs/four repositories and claimed backlog/release benefits. Not a controlled study or transfer claim for larger teams. |
| **S12 - [GitHub safe outputs](https://github.github.io/gh-aw/reference/safe-outputs/)** | Introduction and output-type sections. | Structured requests and permission-controlled jobs separate reasoning from effects. Configuration can permit consequential writes; the mechanism alone does not guarantee a human decision or safety. |
| **S13 - [Datadog Bits investigations](https://docs.datadoghq.com/bits_ai/bits_investigation/investigate_issues/)** | Full retrieved Markdown: triggers, sources, investigation loop and reports. | Documents evidence/inconclusive conclusions and alert-driven investigation. Some integrations are Preview; availability varies by site. |
| **S14 - [Datadog investigation accuracy](https://docs.datadoghq.com/bits_ai/bits_investigation/improve_accuracy/)** | Full text. | Shared knowledge, reviewable/deletable feedback memories and selective automatic investigation. Successful chat retrieval is not equivalent to successful investigation. |
| **S15 - [Rovo Use agent configuration](https://support.atlassian.com/cloud-automation/docs/tips-to-configure-the-action-use-rovo-agent/)** | Full text. | Direct write actions, user/agent-account identity, write toggle off by default and audit/debug controls. Corrects older text-only descriptions. |
| **S28 - [Automate Rovo agents](https://support.atlassian.com/rovo/docs/agents-in-automations/)** | Full text and examples. | Scheduled theme analysis and existing-surface output are documented patterns, not measured planning-quality gains. |
| **S16 - [Introducing ChatGPT Pulse](https://openai.com/index/introducing-chatgpt-pulse/)** | Full announcement, feedback and limitations. | A preview interaction pattern, not a current entitlement audit or autonomous-fix result. |
| **S25 - [Linear AI agents](https://linear.app/docs/agents-in-linear)** | Full page. | Existing work surfaces, team access, guidance history and visible activity. Assignment/mention initiation was established; general schedule claims were not retained. |
| **S27 - [GitHub continuous-improvement workflows](https://github.github.io/gh-aw/blog/2026-01-13-meet-the-workflows-continuous-improvement/)** | Main examples and reported results. Page dated January 13, 2026; mutable text retrieved in October. | Specific first-party analysis-to-issue-to-PR chains. Counts were not re-audited; accepted work is not automatically beneficial work. |

## Monitoring and experience evaluation

| ID / source | Evidence and reading coverage | Inference limit |
| --- | --- | --- |
| **S17 - [Chromatic accessibility](https://www.chromatic.com/docs/accessibility/)** | Workflow, baseline and FAQ sections through approximately the first 12,000 retrieved characters; [dashboard](https://www.chromatic.com/docs/accessibility/dashboard/) also read. | Documents axe checks, debt/regression tracking and incomplete-check exclusions. A green result or accepted baseline is not conformance or usability. |
| **S18 - [W3C WAI evaluation tools](https://www.w3.org/WAI/test-evaluate/tools/)** | Retrieved explanatory text/transcript. | Some checks need manual intervention; tools can be inaccurate. No unsupported percentage of automatable checks used. |
| **S29 - [Deque axe Monitor](https://www.deque.com/axe/monitor/)** | Product capability page. | Scanning, reporting and remediation capabilities. Marketing claims such as zero false positives and aggregate issue counts were not used as independent evidence. |

## Runtime engineering

| ID / source | Evidence and reading coverage | Inference limit |
| --- | --- | --- |
| **S19 - [Managed Agents engineering](https://www.anthropic.com/research/managed-agents)** | Full article, redirected from its engineering URL. | Reported failures of coupled container/session/harness design and rationale for separation. Vendor account, not independent benchmark or provider recommendation. |
| **S20 - [Managed Agents overview](https://platform.claude.com/docs/en/managed-agents/overview)** | Full overview and availability metadata. | Explicit beta, managed sessions and scheduled execution with stateful-retention constraints. Comparative evidence, not a provider selection. |
| **S21 - [Temporal Durable AI](https://docs.temporal.io/ai)** | Full overview and integration/pattern catalog. | Existing orchestration primitives and long waits. Examples do not establish intelligence or exactly-once effects in arbitrary external systems. |
| **S22 - [LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)** | Core interrupt/resume contract through typed-response examples; official node-reexecution/checkpoint-mode documentation additionally retrieved through Context7. | Requires durable checkpointing and appropriate idempotency. Durability configuration has performance/crash-recovery trade-offs. |
| **S23 - [Multi-agent research system](https://www.anthropic.com/research/multi-agent-research-system)** | Full article across two fetches. | Vendor performance/cost observations and coordination/recovery lessons. The 90.2% gain and approximately 15x chat tokens are context-specific, not equal-budget predictions for this engine. |
| **S24 - [Agent Script engineering](https://engineering.salesforce.com/agentforces-agentscript-building-deterministic-control-for-enterprise-ai-workflows/)** | Full Q&A. | Deterministic control, shared executable representation and synchronization/recovery complexity. An unsupported loan-processing metric from a search summary was excluded. |
| **S26 - [OpenAI background mode](https://developers.openai.com/api/docs/guides/background)** | Introduction, request/polling behavior, retention notes and cancellation excerpts. | Asynchronous response execution, not a mission scheduler, service identity or cross-run learning platform. No broad assertion about unsupported webhooks. |

## AFD implementation evidence

Source is pinned to `bc43019a4acd237e5ef3a2bf65f21564900143aa`.
This was source/document inspection, not a conformance rerun or benchmark.

| ID / source | Read and supported conclusion | Limit |
| --- | --- | --- |
| **S30 - [AFD overview](https://github.com/lushly-dev/afd/blob/bc43019a4acd237e5ef3a2bf65f21564900143aa/README.md)** | Philosophy, architecture, status and package inventory sections. | Contains a stale Rust server summary; package docs/features establish the optional server. Portability is not proof arbitrary apps move unchanged. |
| **S31 - [Rust package](https://github.com/lushly-dev/afd/blob/bc43019a4acd237e5ef3a2bf65f21564900143aa/packages/rust/README.md)** | Full README and separate Cargo manifest: registry, validation, execution, approvals, journal, WASM and optional MCP server. | Preview scope; native/WASM capabilities differ. No benchmark or production evaluation. Missing GitHub Release metadata was not treated as proof the crate is unpublished. |
| **S32 - [C++ package](https://github.com/lushly-dev/afd/blob/bc43019a4acd237e5ef3a2bf65f21564900143aa/packages/cpp/README.md)** | Full README; GitHub also returned the `cpp-v0.2.0` release published October 27. | Source capabilities were not all compared against the release tag. Maintainer microbenchmarks are not fresh cross-language service measurements. |
| **S33 - [Language parity](https://github.com/lushly-dev/afd/blob/bc43019a4acd237e5ef3a2bf65f21564900143aa/docs/language-parity.md)** | Parity definition, scope, limits and rows covering dispatch, actors, cancellation, middleware, approvals, journals and transport. | Some surrounding version text is dated inconsistently. Specific capability rows were cross-read with package docs; universal equivalence is not claimed. |
| **S34 - [Command metadata](https://github.com/lushly-dev/afd/blob/bc43019a4acd237e5ef3a2bf65f21564900143aa/spec/command-metadata.md)** | Metadata, confirmations, approvals, binding, trusted-surface responsibility and relay limits. | Declarations alone do not enforce policy; acknowledgement is not proof of human consent; application authorization remains necessary. |
| **S35 - [Command journal](https://github.com/lushly-dev/afd/blob/bc43019a4acd237e5ef3a2bf65f21564900143aa/spec/journal.md)** | Full specification. | Inputs/results need redaction; replay re-executes I/O and does not guarantee determinism, durable orchestration or exactly-once effects. Event sourcing is explicitly out of scope. |
| **S36 - [Protocol conformance](https://github.com/lushly-dev/afd/blob/bc43019a4acd237e5ef3a2bf65f21564900143aa/spec/protocol-conformance.md)** | Full acceptance index and limits for four implementations and both documented MCP eras. | Shared todo and independent protocol suites prove specific properties, not full certification or deployed-service assurance. Not rerun here. |

## Handling and exclusions

- Public product documentation and papers are the evidence base for this edition.
  Consumer-specific source observations and links are excluded.
- Search summaries sometimes supplied unsupported metrics, outdated restrictions
  or incorrect links. Those were corrected against originals or omitted.
- The Amazon Science UXAgent page returned unrelated recruitment text in
  extraction; the arXiv paper and DOI metadata were used instead.
- No products were installed, configured or benchmarked, and no underlying
  customer dataset or live incident was accessed.
- Package location is a proposal direction, not evidence of an engine
  implementation. Merging this documentation does not approve unspecified APIs,
  release dates, permissions or deployment commitments.
