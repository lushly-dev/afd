# Umbel trajectory watch

**Research date:** October 30, 2026. **Owner:** repository owner; a phase's
owning agent refreshes the rows it depends on before writing its
specification. Dates are the sources' own; "reserved" means Umbel keeps a
seam for it without implementing a draft.

## Five movements

1. **The protocol is done with sessions and is turning to push and identity.**
   MCP 2026-07-28 removed sessions and the initialize handshake. The next two
   revisions, scheduled for 2027-03-30 and 2027-09, are about server-initiated
   events with cursors and webhooks, agent identity and delegation, a single
   result contract and progressive discovery. ChatGPT already consumes webhooks
   built on an earlier design sketch for events. Nothing newer has a final
   specification.
2. **Harnesses are where differentiation moved.** Hooks are the universal
   injection point: Claude Code exposes 33 events and caps each injected
   string at 10,000 characters, putting overflow in a file behind a short
   preview; Codex, Cursor, Gemini and Copilot
   all ship hooks. AGENTS.md and SKILL.md are read natively across harnesses,
   and Agent Skills moved to the Linux Foundation's Agentic AI Foundation on
   2026-10-22.
3. **Memory went first-party, consolidation went offline, and nothing is
   shared across harnesses.** Claude Code auto-memory is per repository and
   machine-local; Codex Memories v2 became the default for fresh profiles on
   2026-10-27, with memories still opt-in, and can import other agents'
   memories; Anthropic, OpenAI and Google all
   consolidate in the background on their own stores. A deployer-owned layer
   shared across harnesses is the unserved need.
4. **Every enterprise platform exposes its context over remote MCP with a
   small facade, and curated knowledge is converging on markdown with
   frontmatter.** Slack, ServiceNow, Atlassian, Microsoft, Salesforce,
   Palantir and Google shipped remote MCP in 2026. Google's Open Knowledge
   Format, now v0.2, and Agent Skills use one concept per file with
   frontmatter; the format reserves optional index and change-log files.
   Microsoft's SharePoint knowledge base is interlinked markdown with
   frontmatter that Copilot creates and maintains; its pages do not inherit
   source permissions, and its updates can reverse people's edits.
   Agent-written curation is shipping and is metered apart from reading.
5. **Governance stays guidance-only through 2027, with a clear bar.** NIST's
   agent-standards work frames auditing and non-repudiation; the EU high-risk
   obligations moved to December 2027. The practical bar is reconstructable
   audit, agent identity plus the human authority behind every write,
   permission inheritance from sources, and provenance on knowledge changes.

## What Umbel reserves because of them

| ID | Reservation | Movement | Where it lands |
| --- | --- | --- | --- |
| R1 | An event log projected from the journal: per-principal cursors, one store behind subscriptions, webhooks, channels and audit | 1 | Architecture sections 4 and 5; phase 0 |
| R2 | A principal on AFD's actor and credentials, with delegation chain, token binding, human presence and policy decision; enterprise-managed authorization on connections | 1, 5 | Architecture section 5; version 0 in phase 0, complete in phase 5 |
| R3 | Audience tags carried inside the result; content-addressed resources with digest, size and cache hints | 1 | Architecture section 5 |
| R4 | Skills delivered three ways: Skills over MCP where supported, as resources, and exported into harness skill directories | 2 | Architecture section 5; phase 1 |
| R5 | Harness adapters with a stable JSON contract and import and export for harness memory directories | 2, 3 | Architecture section 5; phase 3 |
| R6 | Memory class labels, a verification lifecycle in the Open Knowledge Format's terms, inconsistency proposals | 3, 4 | Architecture section 7; phases 3 and 4 |
| R7 | An Open Knowledge Format v0.2 compatible container on disk | 4 | Architecture section 7; phase 2 |
| R8 | Proposals recorded as decision traces | 4, 5 | Architecture section 5; phase 4 |
| R9 | Mounted MCP servers as the federation path with indexed and live modes | 4 | After phase 2, its own specification |
| R10 | Telemetry in the GenAI semantic conventions with trace context carried into stored records; usage events in the event log | 5 | Architecture sections 5 and 6 |
| R11 | A server card, the well-known catalog file and a registry entry | 1 | Phase 7 |

## Watchlist

| ID | Item | Status on 2026-10-30 | Next date | What changes for Umbel |
| --- | --- | --- | --- | --- |
| W1 | MCP release cycle, SEP-3398 | Accepted; releases on the last Tuesday of March and September | 2027-03-30, subject to the transition calendar; soft freeze 2.5 months before | Phase specifications pin the revision they target |
| W2 | MCP Events, SEP-3415 | Open pull request, ready for review since 2026-10-28, no sponsor; ChatGPT's webhooks follow an earlier design sketch | Unknown | The event log's poll, stream and webhook projections |
| W3 | Single `tools/call` result contract, SEP-3279 direction | Roadmap commitment; the only proposal has no sponsor | 2027-03 or 2027-09 | The audience projection becomes a renderer |
| W4 | Progressive discovery | Roadmap effort; working group forming; no mechanism text | Unknown | The lazy strategy maps onto whatever ships |
| W5 | Agent identity: DPoP SEP-1932, workload identity SEP-1933, Agent Identity working group | Drafts; SDKs ship DPoP; enterprise-managed authorization stable since 2026-06-18, with Okta the named provider and rmcp's support client-side only | 2027 | Principal fields fill from standard claims |
| W6 | HTTP over stdio | Transports working group chartered 2026-08-23; no SEP | 2027 | Transport is the SDK's concern |
| W7 | Tasks to core | Beta, destination core, no date | 2027-09 at the earliest | Long jobs stay behind the extension |
| W8 | Interceptors, SEP-1763 | Draft | Unknown | Internal hooks only until it lands |
| W9 | Agent Skills versioning and security guidance | On the foundation's roadmap after the 2026-10-22 donation | Unknown | Signed, versioned packs align when the format does |
| W10 | Apache Ossie ontology working group | Incubating since 2026-07-08; metrics vocabulary converging | Unknown | A plugin may mount an Ossie bundle; Umbel defines no metrics |
| W11 | Open Knowledge Format | v0.2, adding `sources`, `generated`, `verified`, `status` and `stale_after` to v0.1 of 2026-06-12 | Unknown | The on-disk convention follows the format |
| W12 | OpenTelemetry GenAI conventions | Own repository since June 2026, status development, no tagged release | Unknown | Pin the development schema; expect attribute churn |
| W13 | NIST agent standards | Concept paper 2026-02-05; initiative 2026-02-17 | 2027 | Audit fields map to its auditing and non-repudiation pair |
| W14 | EU AI Act high-risk obligations | Moved to 2027-12-02 by the 2026 omnibus | 2027-12 | Reconstructable logs suffice until then |
| W15 | Claude Code channels and 2026-07-28 | Channel servers must negotiate 2025-11-25 or earlier; channels are a research preview | Unknown | Keep the SDK's 2025-11-25 compatibility for push paths |
| W16 | Skills over MCP client support | Extension beta; partial support in ChatGPT only, none in Claude, Claude Code, Cursor or VS Code | Unknown | Resources and harness exports stay required delivery paths |

## Deliberately not chased

The result contract's wire shape or any progressive-discovery API before
they are final; HTTP over stdio; DPoP or workload-identity enforcement on
the server; an agent-to-agent endpoint or an agents extension; interceptors
as a product; building a gateway or a registry; MCP Apps rendering;
computer-use affordances; a graph database or a graph-retrieval engine; a
proprietary ontology for people, roles or policies; text provenance
standards; a skill-signing scheme ahead of the foundation's; EU high-risk
conformance tooling; capturing decision traces from other systems of record,
where Umbel is not in the write path.

## Sources

Protocol: [MCP roadmap](https://modelcontextprotocol.io/development/roadmap) (2026-08-22);
[2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28/);
[SEP-3398](https://modelcontextprotocol.io/seps/3398-release-cycle-updates) (accepted 2026-10-14);
[SEP-3392 extension lifecycle](https://modelcontextprotocol.io/seps/3392-extension-lifecycle);
[Tasks and Events working group](https://modelcontextprotocol.io/community/working-groups/tasks-events) (renamed 2026-10-16);
[subscriptions](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions);
[SEP-3415 pull request](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3415);
[SEP-3415 summary](https://hookdeck.com/webhooks/guides/what-are-mcp-events) (2026-10-26, secondary);
[ChatGPT MCP Events](https://developers.openai.com/plugins/build/mcp-events);
[SEP-3279](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3279) (2026-08-19);
[SEP-1932 DPoP](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/1932);
[SEP-1933 workload identity](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/1933);
[Enterprise-managed authorization stable](https://blog.modelcontextprotocol.io/posts/enterprise-managed-auth/) (2026-06-18);
[Skills over MCP](https://modelcontextprotocol.io/extensions/skills/overview);
[extension client matrix](https://modelcontextprotocol.io/extensions/client-matrix);
[Server Cards, SEP-2127](https://modelcontextprotocol.io/seps/2127-mcp-server-cards);
[client best practices](https://modelcontextprotocol.io/docs/2026-07-28/develop/clients/client-best-practices);
[A2A 1.0](https://a2a-protocol.org/latest/specification/);
[Agent Skills donation](https://www.anthropic.com/news/donating-agent-skills-to-the-agentic-ai-foundation) (2026-10-22);
[Cedar delegation chains](https://aws.amazon.com/blogs/security/enforce-least-privilege-authorization-in-multi-agent-ai-chains-using-cedar/) (2026-07-06);
[Entra Agent ID](https://learn.microsoft.com/en-us/entra/agent-id/whats-new-agent-id).

Harnesses: [Claude Code hooks](https://code.claude.com/docs/en/hooks),
[memory](https://code.claude.com/docs/en/memory),
[scheduled tasks](https://code.claude.com/docs/en/routines),
[channels](https://code.claude.com/docs/en/channels),
[cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging);
[Codex changelog](https://learn.chatgpt.com/docs/changelog) and
[memories](https://learn.chatgpt.com/docs/customization/memories.md) (2026-10-27);
[Cursor hooks](https://cursor.com/docs/agent/hooks);
[Gemini CLI hooks](https://geminicli.com/docs/hooks/);
[Copilot CLI hooks](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-hooks-reference);
[Anthropic tool search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool);
[harness source study](https://arxiv.org/abs/2609.00006) (2026-07-15);
[adaptive tool shortlists](https://arxiv.org/html/2605.24660v1) (May 2026);
[OpenTelemetry GenAI MCP conventions](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/mcp.md).

Enterprise context: [Work IQ APIs](https://www.microsoft.com/en-us/copilot/blog/2026/06/02/announcing-the-new-work-iq-apis/) (2026-06-02);
[SharePoint knowledge base announcement](https://techcommunity.microsoft.com/blog/spblog/introducing-a-team-knowledge-base-curated-by-copilot-and-agents/4564203) (2026-10-14) and
[documentation](https://learn.microsoft.com/en-us/sharepoint/sharepoint-knowledge-base);
[Open Knowledge Format specification](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) (v0.2) and
[announcement](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing) (v0.1, 2026-06-12);
[Glean MCP gateway](https://www.glean.com/blog/introducing-glean-mcp-gateway);
[Atlassian Teamwork Graph](https://siliconangle.com/2026/05/06/atlassian-opens-teamwork-graph-pushes-rovo-agentic-execution-team-26/) (2026-05-06);
[Slack MCP](https://docs.slack.dev/changelog/2026/02/17/slack-mcp/) (2026-02-17);
[Salesforce Agent Context Engine](https://www.salesforce.com/blog/agent-context-engine-trusted-shared-context/) (2026-10-20);
[ServiceNow MCP](https://newsroom.servicenow.com/press-releases/details/2026/ServiceNow-opens-its-full-system-of-action-to-every-AI-Agent-in-the-enterprise/default.aspx) (2026-05-05);
[Palantir Ontology MCP](https://palantir.com/docs/foundry/ontology-mcp/);
[context graphs thesis](https://foundationcapital.com/ideas/context-graphs-ais-trillion-dollar-opportunity) (2025-12-22);
[data context layers](https://a16z.com/your-data-agents-need-context/) (2026-03-10);
[Apache Ossie](https://snowflake.com/en/blog/apache-ossie-open-semantic-interchange-incubator) (2026-07-08);
[NIST agent standards note](https://labs.cloudsecurityalliance.org/research/csa-research-note-nist-ai-agent-standards-20260416-csa-style/) (2026-04-16);
[EU omnibus delay](https://labs.cloudsecurityalliance.org/research/csa-research-note-eu-ai-act-omnibus-vii-deadline-delay-20260/);
[Copilot pricing split](https://futurumgroup.com/insights/microsoft-splits-the-copilot-pricing-model-into-everyday-and-advanced-ai/) (2026-09-30).
