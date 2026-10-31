# Umbel decision log

Dated decisions that shape the design. A phase specification cites the
entries it depends on. Amend by pull request; superseded entries stay and
point at their replacement.

| ID | Date | Decision | Consequence |
| --- | --- | --- | --- |
| D1 | 2026-10-30 | Host first. Umbel is an empty host for plugins; knowledge, memory and context are first-party plugins, not the host's identity | A deployment may run the host with any set of plugins, including none of the first-party ones |
| D2 | 2026-10-30 | Vocabulary follows existing AFD extension points: plugin, command, connector, backend, adapter, pack, skill, context. "Module" and "extension" are not used | Documentation and manifests use these words only |
| D3 | 2026-10-30 | Plugins do not depend on other plugins. Shared services come from the host through declared capabilities; composition happens at the call site through batch and pipe, or through pipelines a plugin ships as data | Every plugin is independently testable; the host grants or refuses each capability |
| D4 | 2026-10-30 | Plugins carry plain semantic names for what they do, such as `knowledge` and `content-design`. Only the host carries a botanical name | No product names on plugins |
| D5 | 2026-10-30 | The host is named Umbel, "AFD Umbel" in full. Structure names such as Trellis were rejected after collision checks found an agent harness of that name; Cyme and Rosa were rejected for collisions in the Rust and agent ecosystems | Crate, binary and area are all `umbel` |
| D6 | 2026-10-30 | The `umbel/` area at the repository root is the family home for documents now and the Cargo workspace later; the feature index points here | `architecture.json` and the release inventory gain the root when manifests land |
| D7 | 2026-10-30 | No model in the request path. A curator may use a configured model for background work and may run as a subcommand of the same binary in a separate process | The host has no language-model client; the curator's model is deployer configuration |
| D8 | 2026-10-30 | Content, schema, packs, plugin list and backend choice live in a deployer-owned workspace; the binary ships defaults for all of them | Nothing organization-specific in code |
| D9 | 2026-10-30 | The knowledge base changes only by proposal with evidence and provenance, approved per area by a policy or a person; memory is agent-writable, scoped, bitemporal and expiring | Two stores, two write paths |
| D10 | 2026-10-30 | Store interfaces are traits with an embedded reference backend and a conformance suite; alternative backends prove themselves against the suite | A deployment may host the knowledge base on a different stack |
| D11 | 2026-10-30 | The core is Rust; plugins may be WebAssembly components built from any language, or mounted external MCP servers. No dynamic-library plugins | Connectors are not forced into Rust |
| D12 | 2026-10-30 | Each phase has one owning agent that writes a detailed specification under its folder before implementation, citing the architecture's principles and these decisions; the architecture document is the through line and is amended only by pull request | Specifications are not written ahead of their phase |
| D13 | 2026-10-30 | Every knowledge and memory mutation is an event in one host-owned log with monotonic ids and per-principal cursors; subscriptions, webhooks, harness channels and audit read that log | The event log is a phase 0 primitive; the coming MCP events extension becomes a projection of it |
| D14 | 2026-10-30 | The principal carries the originating user with authentication strength, the client, the agent identity, the delegation chain, token binding, a human-presence flag and the policy decision; enterprise-managed authorization is accepted on connections; tools may require a present human | Audit records both the agent and the person it acted for |
| D15 | 2026-10-30 | Memory has three classes, episodic, semantic and procedural; knowledge entries carry a verification lifecycle with an owner and a verify-by date; the curator promotes, re-verifies and raises inconsistency proposals instead of choosing silently | The curator's job is defined by class transitions |
| D16 | 2026-10-30 | The on-disk knowledge container is compatible with the Open Knowledge Format: one concept per file, path as identity, a required type, reserved index and log files | Import and export with the converging markdown-with-frontmatter tools costs a naming convention |
| D17 | 2026-10-30 | A proposal is recorded as a decision trace: policy applied and its version, evidence with content hashes, exception, approver, proposing agent and run, resulting state | Umbel traces its own knowledge decisions and does not try to capture other systems' |
| D18 | 2026-10-30 | Mounting external MCP servers is a first-class capability, not an example: the federation path across vendor systems, with indexed-copy and live modes. It is sequenced after the core and the knowledge plugin; only the loader kind lands in phase 1 | The core comes first; knowledge is the first plugin because it is a present need; federation gets its own specification later |
| D19 | 2026-10-30 | Reserve seams, do not implement drafts: the result-contract wire shape, progressive-discovery mechanics, HTTP over stdio, DPoP and workload-identity enforcement, agent-to-agent endpoints and interceptors wait for final specifications, tracked in the [trajectory watch](trajectory.md) | Phase specifications cite the watchlist row for anything they depend on |
| D20 | 2026-10-30 | Progress lives in [STATUS.md](STATUS.md), not in the codebase. Every proposal, specification and phase document carries a status block: state, last verified with date and evidence, exactly what is done, exactly what is not, and follow-ups that are not yet issues. A session that changes Umbel updates it before ending | An agent reads the status first and never has to scan the code to learn what is current |

Open: the first external integration, the execution model beyond the lazy
strategy, the manifest format and WIT world shape, the default embedding
model per profile, tenancy. See the [proposal](proposal.md).
