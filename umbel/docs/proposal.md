# Umbel

| Field | Value |
| --- | --- |
| Status | Proposed; direction approved by the owner on 2026-10-30, implementation not started |
| Date | 2026-10-30 |
| Package boundary | New Rust units in this repository: a foundation crate for the plugin contract and host runtime, first-party plugins as integrations, the host binary as an endpoint |
| Implementation | Not started by this proposal |
| Name | Umbel, decided 2026-10-30; "AFD Umbel" in full |

## Purpose

Umbel is a shared system, reachable over MCP and as a CLI, that augments a team's
environments and agent harnesses and can be customized to mesh with that
team's systems, sources and knowledge. It starts with no capability of its
own: it is a host into which plugins land. Knowledge, memory and context are
the first plugins, built in this repository as working examples, but a
deployment may run the host with any set of plugins, including none of them.

The host contains no language model. The frontier model calling it does the
reasoning. A separate curator process may use a configured model for
background extraction and consolidation, never in the request path.

Everything organization-specific lives in a deployer-owned workspace:
configuration, content roots, the content schema, content packs, the list of
installed plugins and their settings. The binary ships defaults for all of
these and bakes none of a particular organization into code.

## Vocabulary

AFD already names most of these extension points, so the host reuses them.

| Word | Meaning here | Precedent |
| --- | --- | --- |
| Plugin | The unit that lands in the host | [Plugin Discovery](../../docs/features/proposed/plugin-discovery/plugin-discovery.proposal.md); Botcore's `BotCorePlugin` and entry points |
| Command | The unit of capability inside a plugin, exposed to MCP, CLI and in-process callers | AFD core |
| Connector | A plugin's binding to an external system or source | `connectors` in `packages/rust` |
| Backend | A swappable implementation behind a store interface | `@lushly-dev/local-db` |
| Adapter | An infrastructure binding such as auth or a frontend | `@lushly-dev/afd-auth`, `@lushly-dev/afd-adapters` |
| Pack | Content a plugin ships by default and an instance overrides | New |
| Skill, context | Guidance documents and command contexts a plugin contributes | [Skill Knowledge Layer](../../docs/features/proposed/skill-knowledge-layer/skill-knowledge-layer.proposal.md); `afd-context-*` commands |

"Module" and "extension" are avoided: the first collides with Rust modules,
the second is MCP's word for protocol extensions.

Plugins carry plain semantic names for what they do, such as `knowledge`,
`memory`, `context` and `content-design`. Only the host carries a botanical
name, in the register of Violet and Specimen: an umbel is an inflorescence in
which every stalk rises from one point and none depends on another.

## The empty host

With zero plugins installed the host provides:

- MCP over stdio and Streamable HTTP on the 2026-07-28 revision through the
  `afd` crate's `server` feature, the CLI projection of the same registry,
  and in-process use as a library.
- Discovery: the bootstrap `afd-help`, `afd-docs` and `afd-schema` commands
  and the lazy strategy's discover, detail and call meta-tools, with docs
  generated from the live registry so nothing is advertised that cannot be
  called.
- Authentication as middleware with three pluggable pieces: an authenticator
  that turns a request into a principal or a challenge, a protected-resource
  metadata provider, and a per-command required-scope resolver. Modes: none,
  static bearer, JWT with JWKS, token introspection, gateway-trusted identity,
  custom. This is the Rust side of [MCP Authorization](../../docs/features/proposed/mcp-authorization/mcp-authorization.proposal.md).
- Approvals, confirmations, the command journal, telemetry and per-tool output
  budgets, all from the `afd` crate.
- A plugin loader for three kinds: compiled-in Rust crates, WebAssembly
  components against a host-owned WIT world, and mounted external MCP servers
  with prefixed command names and no token forwarding.
- The workspace: configuration, a plugins manifest, pack roots, a scale
  profile, and a doctor command reporting what loaded, what failed and why.

## Plugin contract

- A plugin declares a manifest: identity, version, contract version, the
  commands, connectors, backends, packs, skills and contexts it contributes,
  and the host capabilities it needs (search, store, outbound HTTP, secrets).
  The host grants or refuses each capability; a plugin never reaches a service
  it did not declare.
- Plugins do not depend on other plugins. Shared services come from the host
  through declared capabilities. Composition across plugins happens at the
  call site through batch and pipeline execution, or through pipelines a
  plugin ships as data. This keeps every plugin independently testable.
- The host refuses a plugin whose contract version it cannot serve and names
  the upgrade.
- The core is Rust; plugins are not required to be. WebAssembly components can
  be built from Rust, Python and JavaScript, and mounted MCP servers cover the
  rest.
- Rules, vocabularies and reference material belong in packs, not code, so an
  instance can replace a plugin's default content with its own.

## First-party plugins

Each is small enough to read as a tutorial and real enough to deploy.

| Plugin | Purpose |
| --- | --- |
| hello | One command, one pack, one skill; the reference for the contract and test kit |
| sources-filesystem | Markdown with frontmatter from a directory, change detection by content hash |
| knowledge | Fielded BM25 search, structural graph, open and find commands, the eval harness |
| memory, context | Short-term store, capture and recall, budgeted context bundles |
| curator | Settling window, candidates, proposals and approvals, run on a schedule |
| content-design | The pack exemplar: seeded with a public style manual, overridden per instance, rules declared in the pack |
| mount-mcp | One external MCP server mounted as a plugin, setting the connector contract |

## Knowledge, memory and context

- **Retrieval.** A fielded BM25 index with boolean, phrase, field and boost
  syntax is the non-optional core. Embeddings are an optional lane fused by
  reciprocal rank, through a local ONNX model or an HTTP endpoint the deployer
  names. A cross-encoder rerank is a third optional lane, enabled only when
  the instance's eval shows a gain. Chunks are structure-aware; hits are
  presented per document with the best chunk and opened in windows.
- **Graph.** Built deterministically from structure: hierarchy, headings,
  links and backlinks, tags, owners, timestamps, code symbols through
  tree-sitter, co-citation. Model-extracted entities are a per-collection
  opt-in with a budget. The graph is exposed as neighbors, related, path and
  outline commands and as a rank-expansion signal.
- **Two stores, two write paths.** Memory is agent-writable, scoped by tuple
  (org, project, actor, session), bitemporal and expiring. The knowledge base
  changes only through a proposal: a diff with evidence and provenance that a
  policy or a person approves per area. Facts are invalidated, never
  overwritten.
- **Consolidation.** The host computes candidates deterministically: facts
  stable for a settling window, seen across sessions, above a confidence
  floor; and conflicts between stable memory and the knowledge base. The
  curator reviews candidates, grounds them where it can, and submits
  proposals. Rejections carry a reason the curator sees next run.
- **Provenance on every record**: origin kind, principal and agent, session,
  valid-from and valid-until, observed-at, confidence, authority. The host
  rejects consolidated writes that drop any of them. Every hit carries a
  verification status; an instance may run agents verified-only.
- **Permission-aware retrieval** from the first version: an access field on
  every document and chunk, the caller's principal carried into the store
  trait, filtering done there.
- **Push, not only pull.** A `context` command returns a budgeted bundle for a
  task; a `capture` command accepts transcripts and decisions from a harness
  hook. Thin adapters over the CLI connect harness hooks and CI.
- **Sources.** A connector contract with change detection, permission
  mirroring, and two modes: indexed copy for speed, live pass-through for
  freshness. Low-relevance and unanswered queries become content candidates
  through the same proposal queue.
- **Pluggable backends.** Document store, search index, graph and memory store
  are traits with an embedded reference backend and a conformance suite, in
  the pattern of the shared todo conformance suite. A git-backed knowledge
  store is the second backend, where a proposal becomes a pull request.
- **Stored content is untrusted input.** Results carry provenance labels,
  writes are scanned against a policy, plugins are sandboxed, and agent output
  is never auto-promoted.

## Scale profiles

The interface, tool surface and eval harness are the same at every size; a
profile switches lanes and backends. Figures are order-of-magnitude estimates
assuming about eight 300-token chunks per document.

| Profile | Documents | Lanes | Embeddings | Hosting |
| --- | --- | --- | --- | --- |
| team | up to 1k | BM25 | optional, minutes locally | single binary, embedded store, full reindex |
| org | about 10k | BM25 plus vectors when eval shows misses | under an hour locally or a few dollars hosted | single binary, incremental indexing |
| enterprise | about 100k | BM25, vectors, gated rerank | GPU or hosted; index 0.6 to 2.4 GB | shared backend, permission filters in the index, jobs as MCP tasks |
| beyond | 1M plus | same | hosted | dedicated search engines as backends, sharded by collection |

Multi-pass model-built graphs are not viable past the org profile; the
structural graph is linear at every size.

## Execution model

Recommended, pending the owner's decision: structured execution through the
lazy strategy, with `afd-call`, `afd-batch` and `afd-pipe`, is the default. It
keeps the tool list fixed as plugins grow, lets commands change without the
client reloading tools, and runs combinations in one call. A later optional
plugin may accept model-written code against the same registry inside a
WebAssembly sandbox, journaled as one command with the script as input, for
callers that want the expressiveness of code execution without giving up
auditability.

## Repository placement

- The `umbel/` area at the repository root is the family home: these
  documents now, and a Cargo workspace for the crates below when they land.
  `architecture.json` and the release inventory gain the root and classify
  each crate's layer at that point.
- Foundation crate: plugin contract, host runtime, store traits; no domain
  code. A separate foundation crate for the knowledge engine if it has no
  AFD dependency.
- Integrations: the first-party plugins.
- Endpoint: the host binary, shipped as per-platform binaries, an MCPB
  bundle, an OCI image, a registry entry and a Server Card.
- All new units start quarantined under the
  [platform migration](../../docs/features/active/platform-monorepo/) rules.
- Generic server features the host needs, such as the lazy strategy, contexts,
  resources and prompts, land in `packages/rust` so every Rust server
  inherits them.

## Guides and tools for building your own

- A plugin SDK crate and the WIT world as the versioned public contract, with
  a section under `spec/` so other hosts can honor the same manifest.
- `plugin new` scaffolding by kind: Rust crate, WebAssembly component, mounted
  MCP server, pack only.
- `plugin check`: manifest, command names and schemas, declared capabilities
  against what the host grants, docs coverage, pack schema, the plugin's tests.
- A test kit that boots an in-process host with only the plugin under test,
  exercises it through MCP and CLI, and replays a journal.
- Authoring skills for plugins, connectors and packs, modeled on the Botcore
  plugin skill; the host emits skills for installed plugins.

## Relationship to other proposals

This host is a candidate first host for the [Agent Engine](../../docs/features/proposed/agent-engine/proposal.md).
It consumes [MCP Authorization](../../docs/features/proposed/mcp-authorization/mcp-authorization.proposal.md)
and [MCP Tasks](../../docs/features/proposed/mcp-tasks/mcp-tasks.proposal.md), and it is the Rust
counterpart of [Plugin Discovery](../../docs/features/proposed/plugin-discovery/plugin-discovery.proposal.md)
and the consumer of the [Skill Knowledge Layer](../../docs/features/proposed/skill-knowledge-layer/skill-knowledge-layer.proposal.md).
It completes the MCP transport goals of [Rust Support](../../docs/features/proposed/rust-support/00-overview.md).

## Decisions still open

Closed decisions are recorded in the [decision log](decisions.md).

1. The first external integration: a mounted MCP server or a native connector.
   This sets the connector contract more than any document will.
2. The execution model above.
3. Manifest format and the shape of the WIT world.
4. The default embedding model, if any, per profile.
5. Tenancy: single-tenant per deployment with collection scoping and a
   reserved tenant field is the recommendation.

## First proof

1. The empty host serves MCP and CLI with zero plugins and passes the
   protocol conformance checks.
2. The hello plugin loads three ways: compiled in, as a component, mounted.
3. The knowledge plugin indexes a thousand markdown documents and the eval
   harness reports recall and nDCG on a seeded query set.
4. A harness hook captures a session into memory; the curator run produces one
   proposal; it is approved from the CLI and lands in the knowledge base.
5. A second plugin is added without changing the host.

## Research and evidence

- [Architecture](architecture.md), the through line each phase implements against
- [Decision log](decisions.md)
- [Research synthesis](research.md)
- [Annotated source ledger](sources.md)

The research distinguishes documented features from vendor claims and marks
what could not be verified. Neither this proposal nor its merge establishes
implemented capability or a delivery commitment.
