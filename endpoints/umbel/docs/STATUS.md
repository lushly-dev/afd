# Umbel status

Read this before anything else in the area, and update it before you end a
session that changed Umbel. It is the source of truth for progress: an agent
should never have to scan the codebase to learn what is current.

## How to keep this file

- **Say exactly what is done and exactly what is not.** "Done" means merged
  to `main` with evidence linked: a pull request, a commit, a passing check.
  Anything else is "in progress" or "open" with what remains spelled out.
- **Record how you verified it**: the command or check, and the date.
- **Write down follow-ups that are not yet issues.** If a future agent must
  know it but nobody owns it yet, it goes in the follow-ups table with a date
  and who raised it. Promote it to an issue when it gets an owner, and link
  the issue here.
- **Never delete history.** Mark an entry superseded and point to what
  replaced it.
- **Every phase specification carries the same block**: state, last verified
  with date and evidence, done, not done, follow-ups. This file aggregates
  those blocks; the phase folder holds the detail (decisions D20 and D24).
- **Dates are absolute.** Never "last week".

## Documents

| Document | State | Evidence | Verified |
| --- | --- | --- | --- |
| [Architecture](architecture.md) | Revised after the 2026-10-30 end-to-end review and corrected in the 2026-10-31 handoff check; the through line | Merged in [#491](https://github.com/lushly-dev/afd/pull/491), [#493](https://github.com/lushly-dev/afd/pull/493) and [#516](https://github.com/lushly-dev/afd/pull/516); handoff corrections in [#519](https://github.com/lushly-dev/afd/pull/519) | 2026-10-30: three independent reviews (AFD alignment, coherence, external facts); relative links, fences and diagrams rendered. 2026-10-31: links, anchors and every D, O, R, W and S reference re-checked on `main` |
| [Proposal](proposal.md) | Approved rationale; the architecture wins where they differ | #491, #493 and #516 | Same as above |
| [Decision log](decisions.md) | D1 to D130 (D106 to D130 decided 2026-11-04 with the phase 5 specification's approval, under the owner's 2026-10-31 delegation, with the owner's answers of 2026-11-04: D110 to D124, D129 and D130 record those answers, D116 amends D99, D120 amends D101 and D123 closes O5; D90 to D105 with the phase 4 specification, approved 2026-11-03 under the owner's 2026-10-31 delegation, with the owner's answers of 2026-11-03, after an independent review and a revision; D91, D93, D94 and D98 to D104 record those answers; D68 to D89 with the phase 3 specification, approved 2026-11-02 under the owner's 2026-10-31 delegation, with the owner's answers of 2026-11-02, [#685](https://github.com/lushly-dev/afd/pull/685); D51 to D67 proposed with the phase 2 specification, in review, amended 2026-11-01 by its revision; D40 and D42 annotated); open decisions O1 and O4; O5 closed as D123 on 2026-11-04; O2 closed as D27 on 2026-10-31; O3 closed as D37 and D38 on 2026-11-01 with the phase 1 specification, approved and merged in [#583](https://github.com/lushly-dev/afd/pull/583) | D1 to D12 in #491; D13 to D20 in #493; D21 to D26 and the O list in #516; D27 in [#522](https://github.com/lushly-dev/afd/pull/522); D28 to D36 accepted with the phase 0 specification, which the owner approved under the delegation of 2026-10-31 and which merged in [#564](https://github.com/lushly-dev/afd/pull/564) as `fb35d525`; D21, D28, D29, D31, D32, D33, D34, D35 and D36 were amended 2026-10-31 after its review | Same as above; 2026-10-31: D27's links and the O2 references re-checked; D28 to D36 merged with #564 |
| [Trajectory watch](trajectory.md) | Current as of 2026-10-30; rows carry R and W numbers; W1, W2, W5, W6, W12 and W15 refreshed 2026-10-31 for phase 0; W1, W2, W15, W16 and the library rows refreshed and W17 added 2026-11-01 for phase 1; W1 to W4, W11, W16 and the store, search, parsing and tree-sitter library rows refreshed 2026-11-01 for phase 2; W1, W2, W5, movement 3 and the SQLite and rusqlite rows refreshed and W18 added 2026-11-01 for phase 3; W18 and the `chacha20poly1305` row refreshed 2026-11-02; W1, W2, W5, W7 and the elicitation specification re-checked 2026-11-03 for phase 4 (no row changed); W1, W2, W5, W7, the MCP Authorization, authorization server discovery, security considerations and elicitation pages, the enterprise-managed authorization and Tasks extensions, and the IETF drafts checked 2026-11-03 for phase 5 (a Refreshes row; URL-mode elicitation changes the design) | #493; corrections in #516; the refresh with the phase 0 specification, merged in #564 | External claims fact-checked against primary sources on 2026-10-30; the refreshed rows on 2026-10-31 |
| [Phase 0 specification](phases/0-host-skeleton/spec.md) | Approved 2026-10-31 under the owner's delegation (D24) after an independent review ("approve after must-fixes") and revision; merged in [#564](https://github.com/lushly-dev/afd/pull/564) as `fb35d525`; implementation in progress | [#564](https://github.com/lushly-dev/afd/pull/564), merged | 2026-10-31 against `main` at `472b5f68`: every finding checked against `packages/rust`, `packages/cli`, `packages/server`, `python/`, `spec/` and `scripts/`; links and anchors resolve |
| [Phase 1 specification](phases/1-plugin-contract/spec.md) | Written 2026-11-01; revised 2026-11-01 after the independent review and the owner's trust-model decisions; approved by the owner (D24) and merged in [#583](https://github.com/lushly-dev/afd/pull/583) as `880779ff`; steps 0a, 0b, 1, 2a, 2b, 3, 4, 5, 6 and 7 done 2026-11-01 (see Phase 1 below); 0a amended section 8.3's digest key. Closes O3 (D37, D38) and adds D39 to D50 with the architecture amendments they need; D38, D40, D42, D43, D47, D48 and D50 amended 2026-11-01 | [#583](https://github.com/lushly-dev/afd/pull/583), merged | 2026-11-01 against `main` at `393d30aa`: `packages/rust`, `endpoints/umbel`, the todo example and its runner, Plugin Discovery, the Skill Knowledge Layer and Botcore's command policy read; trajectory rows checked against primary sources; links and anchors resolve |
| [Phase 2 specification](phases/2-knowledge/spec.md) | Written 2026-11-01; revised 2026-11-01 after the independent review and the owner's decisions; approved and merged in [#625](https://github.com/lushly-dev/afd/pull/625) as `e996aad1`. Adds D51 to D67 with the architecture amendments they need, and step 0 in AFD (output budgets, a public frontmatter reader); step 0a done 2026-11-01 (see Phase 2 below) and amended section 14; step 2 done 2026-11-01 ([636](https://github.com/lushly-dev/afd/pull/636)); step 3 done 2026-11-01 ([643](https://github.com/lushly-dev/afd/pull/643)); steps 4 to 8 and 7a done the same day (see Phase 2 below); step 9 (the eval harness) done 2026-11-01 in the step 9 pull request; step 10 (the exit) done 2026-11-01 in the step 10 pull request, and with it **phase 2 is done** (exit criterion met; see Phase 2 below) | [#625](https://github.com/lushly-dev/afd/pull/625), merged | Revision 2026-11-01 against `main` at `886c3b4d`: the review's findings checked against `src/middleware.rs`, `src/principal.rs`, `src/cli/prompt.rs`, `sdk/src/cx.rs`, the WIT world and the tantivy, tantivy-query-grammar, tree-sitter and tree-sitter-typescript crate sources. First written 2026-11-01 against `main` at `1cca6309`: `endpoints/umbel` schemas, grants, SDK, principal and scan read; `packages/rust` sources, frontmatter, context fields; `spec/` read; trajectory rows checked against crates.io, GitHub and the OKF specification; links and anchors resolve |
| [Phase 3 specification](phases/3-memory-context/spec.md) | Written 2026-11-01; revised 2026-11-02 after an independent review; **approved 2026-11-02, under the owner's 2026-10-31 delegation, with the owner's answers of 2026-11-02** (D24). Adds D68 to D89 and W18 with the architecture amendments they need; section 15 records the owner's five decisions and the four after the key design's review; steps 1 to 9 done 2026-11-02 and 2026-11-03 (#729 to #747), and step 10 (the exit) done 2026-11-03 in the step 10 pull request, and with it **phase 3 is done** (exit criterion met; see Phase 3 below) | [#685](https://github.com/lushly-dev/afd/pull/685) | 2026-11-02 against `main` at `4a26cc0b`: each review finding checked against `endpoints/umbel` and `packages/rust`; SQLite experiments for FTS5 erasure, `+a b`, backups and the key file (Python's SQLite 3.53.4); Claude Code transcript structure from 25 local sessions, with no content read; `chacha20poly1305` by `cargo info`; S14, S15 and S16 re-read; links and anchors resolve; no Rust built |
| [Phase 4 specification](phases/4-curator/spec.md) | Written 2026-11-03; revised the same day after an independent review (33 findings: 31 fixed as raised, 2 holding in part; its Review response table); **approved 2026-11-03, under the owner's 2026-10-31 delegation, with the owner's answers of 2026-11-03** (D24), the recommended option on nine trust-model questions and "attest and verify" on question 10 (section 16). Adds D90 to D105 with the architecture amendments they need (proposal record version 2 in the phase table, the curator component row, the proposal and manifest interfaces, the MCP approval relay prerequisite moved to phase 5, the versioning list, glossary); steps 1 to 6 merged and step 7 (the exit) done 2026-11-03 in its pull request, each with its amendments in the specification, and with step 7 **phase 4 is done** (exit criterion met; see Phase 4 below) | Merged in [#749](https://github.com/lushly-dev/afd/pull/749); the steps' pull requests are in the Phase 4 detail below | 2026-11-03 against `main` at `f0c618aa`: the knowledge proposal code, `proposal.v1.json`, the envelope, the memory store's changes feed and derivation refusal, record namespacing, pipelines, the plugin gate, the principal and CLI marks, the SDK's call context, `spec/command-metadata.md` and language parity read; W1, W2, W5, W7 and the elicitation specification checked against primary sources; links and anchors resolve; no Rust built |
| [Phase 5 specification](phases/5-auth-hosted/spec.md) | Written 2026-11-03; revised the same day after an independent review (36 findings and 7 nits, all holding, 3 in part; its Review response table); **approved 2026-11-04, under the owner's 2026-10-31 delegation, with the owner's answers of 2026-11-04** (D24): the recommended option on all seventeen questions, with two strengthenings from the owner's instruction (user verification mandatory on every person login; a configurable two-person rule for `memory-erase`). The MCP Authorization layer (modes `none`, `oauth`, `gateway`; RFC 9068 tokens with one audience; RFC 9728 metadata), principal version 1 with identity namespaces, per-space scopes resolved per call, the person page and AFD's host-verified confirmation mode for the MCP approval relay, exact filtering, shared state, Tasks, usage events and rate limits, with an AFD step 0 (0a to 0e). Adds D106 to D130 with the architecture amendments they need. Step 0a (the AFD spec) done 2026-11-07, with its [amendments](phases/5-auth-hosted/spec.md#amendments-from-step-0a); step 0b (AFD's Rust `server-auth`) done 2026-11-07, with its [amendments](phases/5-auth-hosted/spec.md#amendments-from-step-0b); step 0c (#532) done 2026-11-07, with its [amendments](phases/5-auth-hosted/spec.md#amendments-from-step-0c); step 0d (AFD's Rust relay) done 2026-11-07, with its [amendments](phases/5-auth-hosted/spec.md#amendments-from-step-0d); step 0e (AFD's Rust tasks) done 2026-11-07, with its [amendments](phases/5-auth-hosted/spec.md#amendments-from-step-0e), completing the AFD prerequisites 0a to 0e; step 1 (Umbel's shapes: section 2's schemas, configuration and manifest version 5, constants) done 2026-11-07, with its [amendments](phases/5-auth-hosted/spec.md#amendments-from-step-1); step 1b (the test identity provider) done 2026-11-07, with its [amendments](phases/5-auth-hosted/spec.md#amendments-from-step-1b); step 2a (the host's listener and layers) done 2026-11-08, with its [amendments](phases/5-auth-hosted/spec.md#amendments-from-step-2a); step 2b (the host's verification and principal) done 2026-11-08, with its [amendments](phases/5-auth-hosted/spec.md#amendments-from-step-2b); step 2c (the host's doctor, `auth-show`, `workspace-show`'s hosted answer and each issuer's `ca_file`) done 2026-11-08, with its [amendments](phases/5-auth-hosted/spec.md#amendments-from-step-2c); step 3 (the host's scopes, access, shared state and limits) done 2026-11-08, with its [amendments](phases/5-auth-hosted/spec.md#amendments-from-step-3); step 3's follow-up to AFD (hidden commands) done 2026-11-08, with its [amendments](phases/5-auth-hosted/spec.md#amendments-from-afds-hidden-commands); step 3 is next | This branch, `lush/umbel-phase-5-spec`; not yet a pull request | 2026-11-03 against `main` at `e5b4e43c`: `src/principal.rs`, `src/authority.rs`, `src/middleware.rs`, `src/surfaces/`, `src/host/mod.rs`, `src/workspace/config.rs` and `keys.rs`, `src/access.rs`, `src/provenance.rs`, `src/plugins/memory_services.rs`, the mounted loader, the knowledge redaction sweep, cursors, `workspace-show`, `event-list`; `packages/rust`'s `CommandContext`, confirmations (the server gate, `confirmations.rs:185-348`), context hook and approval middleware; for the revision also `src/plugins/manifest.rs:1607-1612`, `src/host/space.rs:21-36`, `src/commands/event_ack.rs`, `store/src/access.rs` and `jsonwebtoken` 11.1.0's validation defaults; `rmcp` 3.8.0's task manager and client-side auth; tantivy 0.27.0's `Bm25StatisticsProvider`; the MCP Authorization and Tasks proposals, `spec/command-metadata.md` and language parity; external sources dated in its trajectory refresh; links and anchors resolve; no Rust built |
| [Research](research.md), [Sources](sources.md) | Current as of 2026-10-30, with corrected figures | #491; corrections in #516 | Same as above |

## Phases

| Phase | State | Owner | Evidence | Next gate |
| --- | --- | --- | --- | --- |
| AFD prerequisites | Done for phase 0, including step 0 of the phase 0 plan (2026-10-31); the rows for phases 1 to 5 remain | Owner's sessions; step 0 by the phase 0 owning agent | [#523](https://github.com/lushly-dev/afd/pull/523), [#526](https://github.com/lushly-dev/afd/pull/526), [#539](https://github.com/lushly-dev/afd/pull/539), [#538](https://github.com/lushly-dev/afd/pull/538), [#555](https://github.com/lushly-dev/afd/pull/555), [#556](https://github.com/lushly-dev/afd/pull/556) and [#560](https://github.com/lushly-dev/afd/pull/560) and step 0, [#567](https://github.com/lushly-dev/afd/pull/567), merged | Later phases' rows of the prerequisites table, each before the phase that needs it |
| 0. Host skeleton | Done 2026-11-01: exit criterion met | Phase 0 owning agent | [Specification](phases/0-host-skeleton/spec.md) ([#564](https://github.com/lushly-dev/afd/pull/564)); steps [#567](https://github.com/lushly-dev/afd/pull/567), [#570](https://github.com/lushly-dev/afd/pull/570), [#572](https://github.com/lushly-dev/afd/pull/572), [#573](https://github.com/lushly-dev/afd/pull/573), [#574](https://github.com/lushly-dev/afd/pull/574), [#575](https://github.com/lushly-dev/afd/pull/575); exit run [run 41263228249](https://github.com/lushly-dev/afd/actions/runs/41263228249) | None |
| 1. Plugin contract | Done 2026-11-01: exit criterion met; `umbel.yml` [run 41298630706](https://github.com/lushly-dev/afd/actions/runs/41298630706) green on `main` at `886c3b4d` | Phase 1 owning agent | [Specification](phases/1-plugin-contract/spec.md) ([#583](https://github.com/lushly-dev/afd/pull/583), `880779ff`); step 0a: the [AFD proposal](../../../docs/features/active/mcp-resources-skills/mcp-resources-skills.proposal.md) and [`spec/mcp-resources.md`](../../../spec/mcp-resources.md); step 0b: [#608](https://github.com/lushly-dev/afd/pull/608); step 1: [#606](https://github.com/lushly-dev/afd/pull/606); step 2a: [#610](https://github.com/lushly-dev/afd/pull/610); step 2b: [#612](https://github.com/lushly-dev/afd/pull/612); step 3: [#611](https://github.com/lushly-dev/afd/pull/611); step 5: [#613](https://github.com/lushly-dev/afd/pull/613); step 4: [#620](https://github.com/lushly-dev/afd/pull/620); step 6: [#622](https://github.com/lushly-dev/afd/pull/622); step 7: [#623](https://github.com/lushly-dev/afd/pull/623); step 8: [#624](https://github.com/lushly-dev/afd/pull/624) | None |
| 2. Knowledge | Specification approved and merged ([#625](https://github.com/lushly-dev/afd/pull/625), `e996aad1`); steps 0a and 0b done 2026-11-01; step 1 (shapes and configuration) done 2026-11-01 in [632](https://github.com/lushly-dev/afd/pull/632); step 2 (store traits and the SQLite stores) done 2026-11-01 in [636](https://github.com/lushly-dev/afd/pull/636); step 3 (the tantivy index) done 2026-11-01 in [643](https://github.com/lushly-dev/afd/pull/643); step 4 (host services) done 2026-11-01 in [651](https://github.com/lushly-dev/afd/pull/651); step 5 (`umbel-scan`, `umbel-okf` and the `sources` plugin) done 2026-11-01 in [668](https://github.com/lushly-dev/afd/pull/668); step 6 (the knowledge core) done 2026-11-01 in [671](https://github.com/lushly-dev/afd/pull/671); step 7a part 1 (the three host services: the true head under derivation reads, the graph's applied revision, the checkpoint) done 2026-11-01 in [672](https://github.com/lushly-dev/afd/pull/672); step 7a part 2 (the structural graph: graph building in `knowledge-index`, rank expansion, `knowledge-neighbors`, `-related`, `-path`, `-outline`, `-stale`) done 2026-11-01 in the step 7a graph pull request; step 8 (proposals and verification) done 2026-11-01 in [673](https://github.com/lushly-dev/afd/pull/673); step 7b (code symbols) done 2026-11-01 in the step 7b pull request; step 9 (the eval harness: the seeded fixture, `knowledge-eval`, the gate and its baseline) done 2026-11-01 in the step 9 pull request; step 10 (the exit: `plugins/knowledge/tests/exit_thousand.rs` and the exit criterion re-run) done 2026-11-01 in the step 10 pull request. **Done 2026-11-01: exit criterion met**; `knowledge-approve` still needs a dynamic confirmation prompt before real use (follow-ups) | Phase 2 owning agent | [Specification](phases/2-knowledge/spec.md) ([#625](https://github.com/lushly-dev/afd/pull/625)); step 0a: the [AFD proposal](../../../docs/features/active/output-budgets/output-budgets.proposal.md) and [`spec/output-budgets.md`](../../../spec/output-budgets.md); step 0b: [#633](https://github.com/lushly-dev/afd/pull/633), the Rust output budgets and the public frontmatter reader; step 1: [632](https://github.com/lushly-dev/afd/pull/632); step 2: [636](https://github.com/lushly-dev/afd/pull/636); step 3: [643](https://github.com/lushly-dev/afd/pull/643); step 4: [651](https://github.com/lushly-dev/afd/pull/651); step 5: [668](https://github.com/lushly-dev/afd/pull/668); step 6: [671](https://github.com/lushly-dev/afd/pull/671); step 7a: [672](https://github.com/lushly-dev/afd/pull/672), the step 7a graph pull request; step 8: [673](https://github.com/lushly-dev/afd/pull/673); step 7b: the step 7b pull request; step 9: the step 9 pull request; step 10: the step 10 pull request | None for phase 2. Phases 3, 5 and 6 are unblocked |
| 3. Memory and context | Specification approved and merged ([#685](https://github.com/lushly-dev/afd/pull/685), `e4c91f30`, with D86 to D89 written in after it); step 1 (shapes and configuration) done 2026-11-02 in [#729](https://github.com/lushly-dev/afd/pull/729), `ed9a8539`; step 2 (the memory trait and suite) done 2026-11-03 in [#733](https://github.com/lushly-dev/afd/pull/733), `b84e0bd5`; step 3a (the embedded memory store) done 2026-11-03 in [#736](https://github.com/lushly-dev/afd/pull/736), `b970994e`; step 3b (sealing and the key file) done 2026-11-03 in [#737](https://github.com/lushly-dev/afd/pull/737), `8d51ee13`; step 4 (host services and the journal digest) done 2026-11-03 in [#740](https://github.com/lushly-dev/afd/pull/740), `d945bbbf`; step 5 (the memory plugin's writing side) done 2026-11-03 in [#742](https://github.com/lushly-dev/afd/pull/742), `0e3a501a`; step 6 (the memory plugin's reading and lifecycle commands) done 2026-11-03 in [#743](https://github.com/lushly-dev/afd/pull/743), `800856ad`; step 7a (the shared helpers: the locator string and `is_stale` in `umbel-okf`) done 2026-11-03 in [#744](https://github.com/lushly-dev/afd/pull/744), `8f124810`; step 7b (the `context` plugin) done 2026-11-03 in [#745](https://github.com/lushly-dev/afd/pull/745), `c8689ebc`; step 8 (the `umbel-first-party` binary and the `umbel-hook` harness adapter) done 2026-11-03 in [#746](https://github.com/lushly-dev/afd/pull/746), `ab5b321d`; step 9 (import and export) done 2026-11-03 in [#747](https://github.com/lushly-dev/afd/pull/747), `4e46de1b`; step 10 (the exit: `leak_probes.rs`, `poisoning.rs`, `forget_bytes.rs` and `exit_memory.rs` in `first-party/tests`) done 2026-11-03 in the step 10 pull request. **Done 2026-11-03: exit criterion met** (see Phase 3 below) | Phase 3 owning agent | [Specification](phases/3-memory-context/spec.md), [#685](https://github.com/lushly-dev/afd/pull/685); step 1: [#729](https://github.com/lushly-dev/afd/pull/729); step 2: [#733](https://github.com/lushly-dev/afd/pull/733); step 3a: [#736](https://github.com/lushly-dev/afd/pull/736); step 3b: [#737](https://github.com/lushly-dev/afd/pull/737); step 4: [#740](https://github.com/lushly-dev/afd/pull/740); step 5: [#742](https://github.com/lushly-dev/afd/pull/742); step 6: [#743](https://github.com/lushly-dev/afd/pull/743); step 7a: [#744](https://github.com/lushly-dev/afd/pull/744); step 7b: [#745](https://github.com/lushly-dev/afd/pull/745); step 8: [#746](https://github.com/lushly-dev/afd/pull/746); step 9: [#747](https://github.com/lushly-dev/afd/pull/747); step 10: the step 10 pull request | None for phase 3. Phase 4 is unblocked |
| 4. Curator | Specification approved 2026-11-03 ([spec](phases/4-curator/spec.md)), under the owner's 2026-10-31 delegation, with the owner's answers of 2026-11-03, merged in [#749](https://github.com/lushly-dev/afd/pull/749), `4a9462c0`; step 1 (shapes) done 2026-11-03 in [#751](https://github.com/lushly-dev/afd/pull/751), `e7aeff70`; step 2 (host) done 2026-11-03 in [#753](https://github.com/lushly-dev/afd/pull/753), `83639abb`; step 3a (knowledge: record and journal) done 2026-11-03 in [#754](https://github.com/lushly-dev/afd/pull/754), `37af26c9`; step 3b (knowledge: the drafted path) done 2026-11-03 in [#763](https://github.com/lushly-dev/afd/pull/763), `4a6b2de4`; step 3c (knowledge: verifying drafts) done 2026-11-03 in [#765](https://github.com/lushly-dev/afd/pull/765), `7e52e337`; step 4 (curator: candidates) done 2026-11-03 in [#767](https://github.com/lushly-dev/afd/pull/767), `0d46a9a0`; step 5 (curator: runs) done 2026-11-03 in [#768](https://github.com/lushly-dev/afd/pull/768), `9ea18e73`; step 6 (auto-approval) done 2026-11-03 in [#770](https://github.com/lushly-dev/afd/pull/770), `6e1c0a0a`; step 7 (the binary and the exit: `umbel-first-party` links the curator, `curator_leaks.rs` and `exit_curator.rs` in `first-party/tests`) done 2026-11-03 in the step 7 pull request. **Done 2026-11-03: exit criterion met** (see Phase 4 below) | Phase 4 owning agent | [Specification](phases/4-curator/spec.md), [#749](https://github.com/lushly-dev/afd/pull/749); step 1: [#751](https://github.com/lushly-dev/afd/pull/751); step 2: [#753](https://github.com/lushly-dev/afd/pull/753); step 3a: [#754](https://github.com/lushly-dev/afd/pull/754); step 3b: [#763](https://github.com/lushly-dev/afd/pull/763); step 3c: [#765](https://github.com/lushly-dev/afd/pull/765); step 4: [#767](https://github.com/lushly-dev/afd/pull/767); step 5: [#768](https://github.com/lushly-dev/afd/pull/768); step 6: [#770](https://github.com/lushly-dev/afd/pull/770); step 7: the step 7 pull request | None for phase 4. Phase 7 now needs phases 5 and 6 |
| 5. Auth and hosted | Specification approved 2026-11-04 ([spec](phases/5-auth-hosted/spec.md)), under the owner's 2026-10-31 delegation, with the owner's answers of 2026-11-04, after an independent review and a revision; step 0a (the AFD spec, documents and cases only) done 2026-11-07 in the step 0a pull request; step 0b (AFD's Rust `server-auth` feature) done 2026-11-07 in the step 0b pull request; step 0c (#532: confirmation state bound to the principal in TypeScript, Python and Rust) done 2026-11-07 in the step 0c pull request; step 0d (AFD's Rust host-verified mode, `HumanRelay`, relay evidence and the form-mode approval relay) done 2026-11-07 in the step 0d pull request; step 0e (AFD's Rust MCP Tasks: `task`, `TaskStore` and the `tasks/*` handlers) done 2026-11-07, completing the AFD prerequisites 0a to 0e; step 1 (Umbel's shapes: section 2's schemas, configuration and manifest version 5 parsing, constants) done 2026-11-07 on `lush/umbel-p5-1-shapes`; step 1b (`umbel-testkit-idp` and `tests/no_auth_server.rs`) done 2026-11-07 in the step 1b pull request; step 2a (the host's listener and layers: TLS with `client_auth`, section 6.3's order, the metadata, the per-IP limit, the context hook version 1 skeleton) done 2026-11-08 in the step 2a pull request; step 2b (the host's verification and principal: the `KeySource`, the verifier and introspection, section 4.1's mapping to principal version 1, claim groups, equivalents, an interim scope rule) done 2026-11-08 on `lush/umbel-p5-2b-verification`; step 2c (the doctor's hosted profile, `auth-show`, `workspace-show`'s hosted answer, each issuer's `ca_file`) done 2026-11-08 on `lush/umbel-p5-2c-doctor`; step 3 (the host's scopes, access, shared state and limits) done 2026-11-08, with its [amendments](phases/5-auth-hosted/spec.md#amendments-from-step-3); step 3's follow-up to AFD (hidden commands unknown before validation) done 2026-11-08, with its [amendments](phases/5-auth-hosted/spec.md#amendments-from-afds-hidden-commands); step 7 (the stores' exact filtering: BM25 statistics per reader filter for knowledge and memory, sealed positions, readable-only totals; a shipped build now serves `oauth`) done 2026-11-08 on `lush/umbel-p5-7-exact-filtering`, with its [amendments](phases/5-auth-hosted/spec.md#amendments-from-step-7); step 4 next | Phase 5 owning agent | [Specification](phases/5-auth-hosted/spec.md), on `lush/umbel-phase-5-spec` | Step 4, then the plan in order |
| 6. Backends | Not started; unblocked 2026-11-01 (phase 2 exit criterion met); next | None | None | Its specification, with an independent review, a revision and the owner's answers (D24) |
| 7. Distribution and guides | Not started | None | None | Phases 5 and 6 exit criteria met (phase 4's was met 2026-11-03) |
| Further first-class plugins | Not started; unblocked 2026-11-01 (phase 2 exit criterion met) | None | None | Each gets its own specification (D18) |

## Phase detail

### AFD prerequisites

- **State:** done for phase 0, including the two additions the phase 0
  specification puts in its step 0 (added 2026-10-31); the rows for phases 1
  to 5 remain. Last verified 2026-10-31 against `main` at `57c731d2`; the
  step 0 rows on 2026-10-31 at `045b6feb`.
- **Done:** Rust `structuredContent` and top-level `outputSchema` (the Rust
  part of #465, which stays open for Python and C++) and the per-request
  context hook (`McpServer::with_context_hook`), both merged in
  [#523](https://github.com/lushly-dev/afd/pull/523) as `77f176d3` with all
  nine checks green.
- **Done:** the Rust grouped, individual and lazy strategies, the five
  meta-tools and AFD contexts (language parity D1), merged in
  [#526](https://github.com/lushly-dev/afd/pull/526) as `03815e26` with all
  eleven checks green and the todo conformance suite at 34/34 in both MCP eras
  and with confirmations. Every route carries `structuredContent` and runs the
  context hook once per call; `grouped` is now the Rust default, which the
  owner accepted on 2026-10-31.
- **Done:** [#531](https://github.com/lushly-dev/afd/issues/531), a panic in
  the server's own request handling hanging the MCP request, fixed in
  [#539](https://github.com/lushly-dev/afd/pull/539) as `2552748c`; a
  handler's panic was already a `COMMAND_EXECUTION_ERROR` result. The hybrid
  strategy's spec step, [`spec/tool-strategies.md`](../../../spec/tool-strategies.md),
  merged in [#538](https://github.com/lushly-dev/afd/pull/538) as `977a0a35`.
- **Done:** the hybrid tool strategy (D27) in Rust,
  `ToolStrategy::Hybrid` with `McpServer::with_first_class_tools`, merged in
  [#560](https://github.com/lushly-dev/afd/pull/560) as `57c731d2` with all 25
  checks green; `tests/server_hybrid.rs` runs every case of
  `spec/tool-strategies.json` over stdio and Streamable HTTP in both MCP eras.
  Python ([#555](https://github.com/lushly-dev/afd/pull/555), `51f8d9d8`) and
  TypeScript ([#556](https://github.com/lushly-dev/afd/pull/556), `0d9720a1`)
  landed first. C++ (step 4) waits on its MCP target (parity D2, #341) and
  does not block Umbel. The [hybrid status](../../../docs/features/active/hybrid-tool-strategy/STATUS.md)
  tracks it.
- **Done:** step 0 of the
  [phase 0 plan](phases/0-host-skeleton/spec.md#step-0-the-afd-pull-request),
  a process-shared mode for the Rust `FileJournalSink` behind the new
  `journal-file-shared` feature (D29) and `DirectClient::with_interface`
  (D34), merged in [#567](https://github.com/lushly-dev/afd/pull/567) as
  `045b6feb` on 2026-10-31 with all nine checks green (Rust fmt, clippy and
  test; Rust docs.rs build; todo conformance for TypeScript and Python, Rust
  and C++; TypeScript on Node 22 and 24; Python 3.11 and 3.12). Run locally
  first: everything `rust.yml` runs, the Rust todo backend's checks with
  `--locked`, and `pnpm check`. The spec needed no amendment.
- **Not done:** the later rows of the
  [prerequisites table](architecture.md#afd-prerequisites): resources,
  prompts and Skills over MCP (phases 1 and 2, shared with Loam), output
  budgets (phase 2; specified in step 0a, implemented in Rust in step 0b),
  the MCP approval relay in Rust (phase 4; done in phase 5 step 0d,
  2026-11-07, with the host-verified mode and `HumanRelay`), token
  verification, `scopes` and `credentials` (phase 5; done in Rust in its step
  0b, 2026-11-07) and the Rust MCP Tasks runtime (phase 5; done in its step
  0e, 2026-11-07).
  [#532](https://github.com/lushly-dev/afd/issues/532) is done (phase 5 step 0c,
  2026-11-07, in TypeScript, Python and Rust).
- **Note:** the hybrid strategy, resources, prompts, the Skills over MCP
  extension and output budgets are AFD-wide features; each needs a
  `docs/features` proposal, spec first, before Rust implements it (D25).

### Phase 0. Host skeleton

- **State:** done 2026-11-01; the exit criterion is met. Specification
  approved 2026-10-31 under the owner's delegation (D24). Last verified
  2026-11-01 against `main` at `8001fc74`.
- **Done:** the [specification](phases/0-host-skeleton/spec.md), merged in
  [#564](https://github.com/lushly-dev/afd/pull/564) as `fb35d525`, with
  decisions D28 to D36 and the architecture amendments they need (embedded
  storage moved to phase 2, versioned shapes under
  `endpoints/umbel/schemas/`, four glossary terms). It was revised the same
  day after an independent review returned "approve after must-fixes", with
  the coordinator's decisions recorded as amendments: several host processes
  per workspace under one append lock (D29), a bearer token on loopback HTTP
  (D32), no interim telemetry (D33 dropped), `DirectClient` interface
  selection in AFD instead of a host check (D34), and multi-process support
  as a phase 2 store criterion (D28).
- **Done:** step 0, the AFD pull request
  ([#567](https://github.com/lushly-dev/afd/pull/567), `045b6feb`): see the
  AFD prerequisites detail above.
- **Done:** step 1, the scaffold ([#570](https://github.com/lushly-dev/afd/pull/570),
  `273e0160`): the `umbel` package with a binary that prints `--version`, its
  committed `Cargo.lock`, toolchain and clippy configuration, `umbel.yml`, the
  quarantined release unit with no route, the explicit `architecture.json`
  unit, the repository-contract test, the `.gitignore` negation and the
  `AGENTS.md` rows. `umbel.yml` ran green on Linux, macOS and the MSRV leg.
- **Done:** step 2, the workspace ([#572](https://github.com/lushly-dev/afd/pull/572)):
  `workspace::discover`, `umbel.toml` version 1 with defaults and validation,
  the layout and `Workspace::init`, race-safe keys (temporary file, hard link,
  mode 0600), the workspace lock over AFD's `JournalFileLock` with the
  `WORKSPACE_LOCK_TIMEOUT` error, `doctor::run` with the registry-dependent
  checks as `skip`, and the six schema files under `schemas/` with their
  examples. Tests: `workspace.rs` (23), `doctor.rs` (19), `schemas.rs` (9) and
  unit tests. Verified 2026-10-31 in `endpoints/umbel`: `cargo fmt --check`,
  `cargo clippy --all-targets --locked -- -D warnings`, the library-only
  clippy leg, `cargo test --locked`, `cargo +1.97.0 check --locked
  --all-targets`; `pnpm check` and `umbel.yml` on the pull request.
  `jsonschema` takes `default-features = false` and `toml` gains
  `preserve_order`; four small spec amendments are listed in the
  specification's "Amendments from step 2".
- **Done:** step 3, the registry and the CLI ([#573](https://github.com/lushly-dev/afd/pull/573)):
  `HostBuilder`, `seal` with its error mapping and the reserved CLI verbs,
  `Host::context`, `Host::cli_client`, `Workspace::resolve_space`, the
  `workspace-show`, `space-list` and `workspace-doctor` commands (the doctor
  fills in `mcp.surface` and `cli.verbs` on a sealed host), AFD's bootstrap
  commands with `cli: true`, the event stamp and space middleware (host-owned
  result keys always overwritten), the approval middleware without tokens,
  principal version 0 and the CLI context, logging to stderr, and the CLI:
  `umbel::cli::run` and the `umbel` binary with `init`, `help`, `docs`,
  `schema`, `call`, `batch` and `<domain> <action>`, the JSON envelope and text
  layout, the terminal-escape sanitizer, approvals and confirmations at a
  terminal or with `--approve` and `--yes`, and exit codes 0, 1, 2 and 130.
  Tests: `cli.rs` (16), `seal.rs` (8), `doctor_sealed.rs` (2),
  `trusted_keys.rs` (7) and 47 unit tests. Verified 2026-11-01 in
  `endpoints/umbel`: `cargo fmt --check`, `cargo clippy --all-targets --locked
  -- -D warnings`, the library-only clippy leg, `cargo test --locked`, `cargo
  +1.97.0 check --locked --all-targets`; `pnpm check` and `umbel.yml` on the
  pull request. Not in step 3: `umbel serve` (parsed, answers
  `NOT_IMPLEMENTED` until step 5) and the event commands (step 4). Amendments:
  the specification's "Amendments from step 3".
- **Done:** step 4, journal and events ([#574](https://github.com/lushly-dev/afd/pull/574)):
  the projecting sink over `FileJournalSink::shared`, which holds one
  `state/lock` across the journal append and the event append; `seq` read from
  the file tails under the lock; lock-free readers that skip a torn last line;
  the `projection.pending` marker, so the next append from any process, the next
  `seal`, `event-list` or `space-list` replays a failed projection first;
  `Host::repair_events`; event and provenance envelope version 0 (valid against
  `event.v0.json`); cursors `v0:<space>:<seq>` with `v0:<space>:0` before the
  first event; stored cursors per principal and consumer, written by atomic
  rename; `event-list`, `event-ack` and the CLI-only `event-rebuild`; and
  `space-list` on the catch-up instead of counting lines. Tests:
  `journal_events.rs` (12), `cursors.rs` (10), `multi_process.rs` (4: 200
  interleaved mutations across two hosts with a reader beside them, a held lock
  past the timeout, eight hosts opening a fresh workspace at once, and 24
  concurrent `umbel` processes) and five more cases in `trusted_keys.rs`.
  Verified 2026-11-01 in `endpoints/umbel`: `cargo fmt --check`, `cargo clippy
  --all-targets --locked -- -D warnings`, the library-only clippy leg, `cargo
  test --locked`, `cargo +1.97.0 check --locked --all-targets`; `pnpm check`
  and `umbel.yml` on the pull request. Amendments: the specification's
  "Amendments from step 4".
- **Done:** step 5, the MCP surfaces ([#575](https://github.com/lushly-dev/afd/pull/575)): `Host::mcp_server` (hybrid,
  `workspace-show` and `event-list` first-class, confirmations signed with the
  shared key, approval tokens off), `Host::http_router` (the exact `http.path`
  and `/health` behind the bearer layer: a random token in
  `state/keys/http.token`, mode 0600, on every request; the bound IP in the
  allowed hosts), the context hook version 0 (stdio, HTTP), `umbel serve
  --stdio` and `--http [--bind] [--print-token]` (stdout carries only JSON-RPC;
  startup failures are one JSON line on stderr with exit 1; SIGINT and SIGTERM
  exit 0), and Umbel's own drivers in `tests/support/` (in-process HTTP, in-memory
  stdio in both eras, a child-process driver that kills on drop). Tests:
  `protocol_http.rs` (26), `protocol_stdio.rs` (7), `hybrid_surface.rs` (13),
  `context_hook.rs` (7), `approvals.rs` (4), `confirmations.rs` (9),
  `process.rs` (16) and the MCP cases of `journal_events.rs` and `trusted_keys.rs`. Verified
  2026-11-01 in `endpoints/umbel`: `cargo fmt --check`, `cargo clippy
  --all-targets --locked -- -D warnings`, the library-only clippy leg, `cargo
  test --locked`, `cargo +1.97.0 check --locked --all-targets`; `pnpm check` and
  `umbel.yml` on the pull request. Amendments: the specification's "Amendments
  from step 5". With zero plugins, the host's built-in commands pass the
  protocol tests in both MCP eras over stdio and HTTP, and the first-class set is
  `workspace-show` then `event-list`; `umbel serve` repairs the event streams at
  start.
- **Done:** step 6, the exit: the README's build and run sections, and the
  exit criterion re-run. Evidence: 2026-11-01 on `main` at `8001fc74`: `cargo test --locked` in `endpoints/umbel` passed all 261 tests (18 integration files and the unit tests); `umbel init` then `umbel workspace doctor` on the fresh workspace exited 0 with `healthy: true` and all 13 checks `pass`; `umbel.yml` on `main` at that commit, [run 41263228249](https://github.com/lushly-dev/afd/actions/runs/41263228249).
- **Not done:** nothing in phase 0.
- **Follow-ups:** the open rows of the specification's follow-ups table,
  mirrored below.

### Phase 1. Plugin contract

- **State:** done 2026-11-01; the exit criterion is met. Specification
  approved by the owner (D24) and merged in
  [#583](https://github.com/lushly-dev/afd/pull/583) as `880779ff`; steps 0a,
  0b, 1, 2a, 2b, 3, 4, 5, 6, 7 and 8 done the same day. Last verified
  2026-11-01 against `main` at `1cca6309` plus step 8's test. (Superseded:
  "step 8 is next", verified at `f820783a`; before that "in review, revised,
  not approved", verified at `cdfbbfb7`.)
- **Done:** the [specification](phases/1-plugin-contract/spec.md), in
  review: the manifest `umbel-plugin.toml` version 1 (D37) and the WIT world
  `umbel:plugin/plugin@1.0.0` on WASI 0.2 (D38), which close O3; wasmtime's 48
  long-term line (D39); plugin protocol version 1 (D40); workspace
  configuration version 2 with plugin instances (D41); the phase 1 grants and
  effects (D42); the mounted loader on `rmcp`'s client (D43); per-space
  enablement (D44); first-class suggestions (D45); packs (D46); skills on
  three paths with an AFD step 0 (D47); the SDK and plugin crates (D48); the
  test kit and AFD's own tools in CI (D49); failure isolation (D50). The
  architecture, decision log and trajectory amendments are in the same pull
  request.
- **Revised 2026-11-01:** the owner decided the four trust-model points
  (compiled-in plugins are trusted, not sandboxed; stdio mounts run as the
  host's user with no OS sandbox and are as trusted as compiled plugins;
  enabling consents to declared grants except `deny`, with any future write,
  `http` or `secrets` grant requiring a per-instance `allow` list; HTTP
  mounts may send the deployer's own bearer, with `url` and `bearer_env` in
  `umbel.toml`), recorded in section 11, D42 and D43. Review must-fixes M1
  to M7, the should-fixes and nits applied; should-fix 17 partly (the
  provenance envelope version 0 has no source field). The plan now splits
  step 2 into 2a (loader core, compiled plugins) and 2b (packs, suggestions,
  contexts, pipelines).
- **Done:** step 0a, documents only: the AFD feature proposal
  [MCP resources and skills](../../../docs/features/active/mcp-resources-skills/mcp-resources-skills.proposal.md)
  with its [status](../../../docs/features/active/mcp-resources-skills/STATUS.md),
  approved under the owner's delegation of 2026-10-31 and placed in
  `docs/features/active/`; [`spec/mcp-resources.md`](../../../spec/mcp-resources.md)
  (resources R1 to R6, the Skills extension S1 to S8, tool `_meta` T1 to T3
  with MCP Apps' `ui` key allowed, advertised and validation schemas V1 and
  V2) and its cases `spec/mcp-resources.json`; the `command-metadata.md`,
  `protocol-conformance.md` and `CHANGELOG.md` amendments, `spec/VERSION`
  unchanged at `1.0-rc`; four language parity rows, Planned in every
  language; the Skill Knowledge Layer reconciled (its command skills stay
  separate). Verified 2026-11-01 against `main` at `880779ff`: current
  behavior read in `packages/server/src`, `python/src/afd/server`,
  `packages/rust/src` and the C++ todo backend, and external rules checked
  against the MCP 2026-07-28 and 2025-11-25 pages, SEP-2640, the Agent Skills
  specification and the MCP Apps specification; links and anchors resolve;
  `pnpm check` and the alfred parity tests pass. Its choices are listed in
  the specification's "Amendments from step 0a"; the one that changes Umbel:
  a resource's digest is AFD's `_meta["dev.afd/digest"]` (`sha256:<hex>`),
  not `dev.umbel/sha256`.
- **Found by step 0a:** Python's MCP SDK already declares empty `resources`
  and `prompts` capabilities (on the modern era with `subscribe` and
  `listChanged` true); recorded in the AFD status. It does not affect Umbel,
  which is Rust.
- **Done:** step 1, manifest and configuration ([#606](https://github.com/lushly-dev/afd/pull/606)): `umbel-plugin.toml`
  version 1 read and validated in `plugins/manifest.rs` (closed; Plugin
  Discovery's field meanings; `ui` and the other reserved keys refused naming
  their version; a mount's manifest says only `bearer`, never `url` or
  `bearer_env`); `plugins/source.rs` (`compiled:<id>` against a
  `CompiledCatalog`, workspace directories confined against `..`, absolute
  paths and symlinks, the both and neither cases); file checks for packs
  (`plugins/packs.rs`) and skills (`plugins/skills.rs`); the schemas
  `workspace-config.v2.json`, `plugin-manifest.v1.json` and
  `pack-manifest.v1.json` with examples (`$defs` holds every top-level
  property for Loam); `umbel.toml` version 2 (D41, D44: instance `url`,
  `bearer_env`, `spaces`, `deny`, `limits`, `env`; `grants.<grant>.allow` and
  the instance id `enabled` reserved; version 1 still opens as version 2 with
  no plugins) and `umbel init` writing 2; the doctor's `plugins.none` replaced
  by `plugins.config`, `plugins.sources`, `plugins.grants`, `plugins.packs`
  and `plugins.skills`, which need no sealed host (`plugins.loaded`,
  `plugins.first_class` and `plugins.pipelines` are `skip` until step 2a; a
  `compiled:` source is `skip` without a catalog, resolved by
  `doctor::run_with_catalog` with one); the WIT file
  `wit/umbel-plugin-1.0.0/world.wit` (a test pins it to the specification's
  text); the version constants, reported by `workspace-show`;
  `[workspace.lints]` with `lints.workspace = true`; `--workspace` in every
  cargo step of `umbel.yml`; `architecture.json` and the repository-contract
  test gain the five new surfaces. Tests: `manifest.rs` (27),
  `doctor_plugins.rs` (24), extended `schemas.rs` (17), `workspace.rs` (34),
  `doctor.rs` (19) and unit tests. Verified 2026-11-01 in `endpoints/umbel`:
  `cargo fmt --all --check`, `cargo clippy --locked --workspace --all-targets
  -- -D warnings`, the library-only clippy leg, `cargo test --locked
  --workspace`, `cargo +1.97.0 check --locked --workspace --all-targets`;
  `pnpm check` and `umbel.yml` on the pull request. One amendment is listed in
  the specification's "Amendments from step 1": until step 2a, `seal` refuses
  a workspace whose `plugins.enabled` is not empty, as phase 0 did, so a
  configured plugin is never silently ignored.
- **Done:** step 0b, the AFD Rust implementation ([#608](https://github.com/lushly-dev/afd/pull/608)):
  `McpServer::with_resources` and `with_skills` (resources, the Skills extension, `skills/list`,
  `skills/get`, optional `resources/directory/read`), `CommandDefinition::with_tool_meta`,
  `CommandRegistry::register_with_schemas` and `afd::check_meta_entry` in `packages/rust`; the Rust
  todo backend split into a library (`commands`, `TodoStore`, `register_commands`; the binary needs
  the default `server` feature). `rmcp` 3.8.0 routes the extension's methods, so the spec stood.
  Verified in `packages/rust`: fmt, clippy `-D warnings` and tests for default, no-default, `server`
  and `journal-file-shared`, both wasm checks, `tests/server_resources.rs` running
  `spec/mcp-resources.json` over HTTP and stdio on both eras; the todo backend with and without
  default features; todo conformance 34/34 legacy, 34/34 modern, 5/5 confirmations; `cargo test
  --locked --workspace` in `endpoints/umbel`. Seven amendments are in the specification's
  "Amendments from step 0b".
- **Done:** step 2a, the loader core and compiled plugins ([#610](https://github.com/lushly-dev/afd/pull/610), `07527f50`): the load
  sequence of section 6 for compiled plugins (`plugins/loader.rs`),
  `CompiledPlugin` and `HostBuilder::with_compiled` (through `cli::run`'s
  `configure` hook), `Services` and the grant gates, failure isolation per
  `required`, per-space enablement and the plugin gate with the provenance
  rule, the host's own set of space commands, `plugin-list` and `plugin-show`
  (printing "trusted, not sandboxed"), `workspace-show` reporting loaded
  plugins, the doctor's `plugins.loaded` on a sealed host (the `seal` guard of
  step 1 is gone, and the CLI passes the compiled catalog even when `seal`
  fails), `umbel-sdk` with `assets()` and `build::embed_assets`,
  `umbel-plugin-hello` as a compiled plugin, and the `testkit` feature
  (`TestHost`, with phase 0's drivers moved into it). Release inventory and
  `architecture.json` rows for `umbel-sdk` and `umbel-plugin-hello`
  (quarantined, no route). Tests: `plugin_compiled.rs`, `grants.rs`,
  `plugin_spaces.rs`, `plugin_conflicts.rs`, `plugin_commands.rs`,
  `testkit.rs`, the sealed cases of `doctor_plugins.rs` and hello's own tests.
  Verified 2026-11-01 in `endpoints/umbel`: `cargo fmt --all --check`, `cargo clippy --locked --workspace --all-targets -- -D warnings`, the library-only clippy leg, `cargo test --locked --workspace` (396 passed), `cargo +1.97.0 check --locked --workspace --all-targets`; `pnpm check` and `umbel.yml` on the pull request. The earlier session's clippy fix had never compiled, and clippy found three more unused-import and `unwrap_or_default` findings, fixed here. Not in 2a: origin
  `_meta` on plugin tools (step 3). Amendments: the specification's
  "Amendments from step 2a".
- **Done:** step 2b, packs, suggestions, contexts and pipelines ([#612](https://github.com/lushly-dev/afd/pull/612)):
  packs and per-space overrides (D46: a space's directory under
  `spaces/<space>/packs/<plugin>/<pack>/` replaces the default whole, never
  merged; the defaults and the overrides are validated at `seal`, an invalid
  one is `PACK_INVALID`; the `packs` grant reads the call's space's copy;
  `plugin-show` reports `default` or `override` per space with version and
  file count; `TestHostBuilder::pack_override`), first-class suggestions
  (D45: manifest `first_class` after `workspace-show` and `event-list`, in
  instance and manifest order, the cap of 8 with the doctor's
  `plugins.first_class` naming what was dropped, the deployer's list always
  wins), plugin AFD contexts (`build_server` now runs before
  `install_middleware`, so `McpServer::with_contexts` registers
  `afd-context-*` once and inside the middleware snapshot), and pipelines as
  data (steps run over the host registry with `$input`; one that names a
  missing command is not registered and the instance loads, reported by
  `plugin-show` and the doctor's `plugins.pipelines`; effects must cover the
  steps'; a pipeline with a confirm-gated step gets the union of its steps'
  prompts, so an unconfirmed call fails with `CONFIRMATION_REQUIRED` before
  any step runs). Tests: `packs.rs` (9), `first_class_plugins.rs` (6),
  `contexts_pipelines.rs` (10), the override case of hello's own tests, the
  new `commands[i].contexts` rule in `manifest.rs` and the sealed
  `plugins.first_class` and `plugins.pipelines` cases of `doctor_plugins.rs`.
  Verified 2026-11-01 in `endpoints/umbel`: `cargo fmt --all --check`, `cargo
  clippy --locked --workspace --all-targets -- -D warnings`, the library-only
  clippy leg, `cargo test --locked --workspace`, `cargo +1.97.0 check
  --locked --workspace --all-targets`; `pnpm check` and `umbel.yml` on the
  pull request. Eleven amendments are in the specification's "Amendments from
  step 2b".
- **Done:** step 3, skills on three paths ([#611](https://github.com/lushly-dev/afd/pull/611)): skills validated at load
  by AFD's own `SkillCatalog` (frontmatter, name equal to the directory,
  description, `SKILL_INVALID`; the doctor's `plugins.skills` checks the same);
  every loaded plugin's skills served by the host's MCP server on the Skills
  extension (`skills/list`, `skills/get`) and as resources (`resources/list`,
  `resources/read`, with `size` and `_meta["dev.afd/digest"]`), through
  `McpServer::with_skills`; a skill name served once per plugin and a
  `PLUGIN_CONFLICT` for the same plugin id with other content; `skill-list`
  (read-only, everywhere) and `skill-export` (CLI only, all or nothing,
  `force=true`, the origin file, no write through a symbolic link, unprojected);
  `_meta["dev.umbel/origin"]` (`plugin`, `kind`, `version`, `effects`) on every
  plugin tool; `SkillCatalog::entries()` made public in `packages/rust`.
  Tests: `skills.rs` (18) and the two doctor fixtures that now need real
  frontmatter. Verified 2026-11-01 in `endpoints/umbel`: `cargo fmt --all
  --check`, `cargo clippy --locked --workspace --all-targets -- -D warnings`,
  the library-only clippy leg, `cargo test --locked --workspace`, `cargo
  +1.97.0 check --locked --workspace --all-targets`; `pnpm check` and
  `umbel.yml` on the pull request. Amendments: the specification's
  "Amendments from step 3".
- **Done:** step 5, the mounted loader ([#613](https://github.com/lushly-dev/afd/pull/613)): rmcp's
  client over a child process's stdio (own `tokio::process::Command` with `kill_on_drop` and a
  cleared environment: `PATH`, the manifest's `env`, the instance's `env`) and Streamable HTTP with
  rustls; `url` and `bearer_env` from the instance only; `Discover` at 2026-07-28 with an explicit
  `Initialize` fallback at 2025-11-25 and no declared client capabilities; renaming with instance
  prefixes, `[[mount.tools]]` overrides (`effects`, `bind_space`, `confirm_prompt`, `approval`),
  advertised and stripped validation schemas through `register_with_schemas`, the load-time
  `description-injection` scan (warnings in `plugin-show` and the doctor), result mapping, the
  `max_result_bytes` limit enforced in a counting stdio reader and a bounded HTTP client, the
  plugin gate's `recorded`/`external` stamps, respawn (3 in 60 s), `timeout_ms`/`connect_timeout_ms`,
  HTTP mounts defaulting to `required = false`; `umbel-sdk`'s `mounted` feature (`serve_mounted`,
  `mounted_server`), the `hello-mcp` binary and hello's `mounted.toml`; the test kit's
  `instance_keys`. Tests: `plugin_mounted.rs` (31, including HTTPS against a local TLS server, the AFD meta-tools never mounted, and pipelines, first-class suggestions and contexts over mounted commands),
  `mount_naming.rs`, unit tests of the reader and the result mapping; the injection rule's shared
  vectors in `packages/testing`. Amendments: the specification's "Amendments from step 5".
  Verified 2026-11-01 against `main` at `b0782de7` (step 2b merged): `cargo fmt --all --check`,
  clippy `-D warnings` on the workspace and on the library-only, mounted library-only and mounted
  SDK/`hello-mcp` legs, `cargo test --locked --workspace` (488 passed, 0 failed), `cargo +1.97.0
  check --locked --workspace --all-targets`, `pnpm check` and the `packages/testing` suite (566).
- **Done:** step 4, the component loader ([#620](https://github.com/lushly-dev/afd/pull/620)): a WebAssembly component built against
  `umbel:plugin/plugin@1.0.0` on wasmtime 48.0.8 (a process-wide `Engine` and linker, an epoch ticker, compiled
  components cached by digest), its world read from the `umbel:plugin/command` export and `umbel:plugin/*`
  import versions, every import checked against the grants at load (`PLUGIN_IMPORT_DENIED` naming the
  import and the grant; `wasi:sockets` and `wasi:http` neither allowed nor linked), virtualized WASI 0.2
  (clocks and random bytes from the command context so the journal's tape records and replays them,
  stdout and stderr always linked, line-buffered into the host log under the `log` grant's 64 KiB cap, no
  environment, arguments, stdin or file), per-call stores with fuel, an epoch deadline plus a host
  deadline for a component waiting in the host, per-memory and table limits that name the limit that
  stopped the call, 4 MiB of input and result, trap, exit and result-validity errors; the SDK's `component`
  feature and `export_component!` with the scoped `unsafe_code = "deny"` exception; hello as a
  component (`manifests/component.toml`); four fixture components; the hello import list recorded in
  specification section 4. CI: `wasm32-wasip2` in the toolchain file, the components linted and built
  before the tests, the component-only clippy leg, longer timeouts, the test profile optimizing Cranelift
  and wasmtime, and `CARGO_PROFILE_DEV_DEBUG=line-tables-only`. Tests: `plugin_component.rs` (22),
  `component_limits.rs` (7), `component_replay.rs` (5) and unit tests of the analysis, the limiter and
  the limits. Verified 2026-11-01 in `endpoints/umbel`: `cargo fmt --all --check`, clippy `-D warnings` on
  the workspace and on every `umbel.yml` leg including the new ones, `cargo test --locked --workspace`
  (all pass), `cargo +1.97.0 check --locked --workspace --all-targets`; `pnpm check` and `umbel.yml` on
  the pull request. Facts checked: wasmtime 48.0.8 (MSRV 1.95), `wasmtime-wasi` 48 `p2`, and the tier
  table. Amendments: the specification's "Amendments from step 4", the first being that the normative
  WIT file did not parse (`list` is a WIT keyword; now `%list`).
- **Done:** step 6, the todo plugin and the conformance job ([#622](https://github.com/lushly-dev/afd/pull/622)): `umbel-plugin-todo`
  (`plugins/todo`, a workspace member: the eleven todo commands as a compiled plugin over the
  example's library, schemas generated from the backend and embedded, `plugin-state` on the eight
  mutations, `inspect` on three, `todo-clear`'s prompt) and the `umbel-todo` binary (hello in its
  catalog too); `--backend umbel` and `--backend umbel-mounted` in `dx/run-conformance.ts` with
  `test:conformance:umbel` and `test:conformance:umbel-mounted`; the `todo-http` fixture; the Rust
  backend's `TOOL_STRATEGY` (a spec amendment: its default grouped strategy does not list the
  `todo-*` tools a mount renames); `tests/scripts/external-clients.sh` (`afd connect`, `afd validate
  --surface --strict` with three rules suppressed, `afd scenario run`); the `conformance` and
  `plugin-isolation` jobs of `umbel.yml`; inventory and `architecture.json` rows. Nothing under
  `src/`, `wit/` or `schemas/` changed. Tests: `plugins/todo/tests/todo.rs` (5). Verified 2026-11-01
  in `endpoints/umbel`: `cargo fmt --all --check`, clippy `-D warnings` on the workspace and every
  `umbel.yml` leg, `cargo test --locked --workspace` (532 passed), `cargo +1.97.0 check --locked
  --workspace --all-targets`; conformance locally: Rust backend 34/34 (legacy), 34/34 (modern),
  5/5 (confirmations); `umbel` the same; `umbel-mounted` 34/34 in both modes; scenarios 4/4;
  `pnpm install --frozen-lockfile --force`, `pnpm build`. Amendments: the specification's
  "Amendments from step 6".
- **Done:** step 7, `plugin new` and `plugin check` ([#623](https://github.com/lushly-dev/afd/pull/623)):
  `plugin-new` (CLI only, unprojected) writes a skeleton for each kind from templates embedded in the
  binary (`src/templates/`): a compiled crate and a component crate, each with `Cargo.toml`, the
  manifest, `build.rs`, `src/lib.rs`, an `<id>-hello` command with schemas, a `starter` pack, a skill,
  `tests/plugin.rs` over the test kit and the host's own toolchain pin; a mounted plugin with a stdio
  `[mount]`; a pack plugin. It refuses a non-empty directory and an id the host owns, and takes
  `umbel_path` to depend on a checkout. `plugin-check` (CLI only) reports `manifest`, `grants`,
  `schemas` (`missing-output-schema` and the `description-injection` rule as warnings), `packs`,
  `skills`, `config` (defaults must validate), `component` (compile and imports against the declared
  grants), `boot` (an internal host over a temporary workspace with only the plugin, built with
  `HostBuilder` and not the `testkit` feature; a stdio mount starts only with `spawn=true`; a
  compiled plugin boots only in a binary that links it) and `surface` (`skip` with the `afd validate
  --surface` suggestion). A failed check is `PLUGIN_CHECK_FAILED` with the report as `details`, so
  the CLI exits 1. The README's "Write a plugin" section. Tests: `plugin_scaffold.rs` (14: every
  kind scaffolds, the compiled and component scaffolds build and pass their own tests and the
  check, the component fails with `PLUGIN_IMPORT_DENIED` when a grant is dropped, `spawn=true` is
  what starts a mount's program, a bad manifest, skill, pack and grant fail, and a binary that links
  the plugin boots it) and 3 unit tests of the templates. Verified 2026-11-01 in `endpoints/umbel`:
  `cargo fmt --all --check`, clippy `-D warnings` on the workspace and the three library-only legs,
  `cargo test --locked --workspace`, `cargo +1.97.0 check --locked --workspace --all-targets`;
  `pnpm check` and `umbel.yml` on the pull request. Amendments: the specification's "Amendments
  from step 7".
- **Done:** step 8, the exit ([#624](https://github.com/lushly-dev/afd/pull/624)):
  `endpoints/umbel/tests/hello_three_ways.rs`, and the exit criterion re-run
  on `main` at `1cca6309` plus that test. `umbel.yml` needed no change: it
  already builds the hello component and `hello-mcp` before `cargo test
  --workspace`, and runs the `conformance` and `plugin-isolation` jobs. Evidence,
  all 2026-11-01 on macOS with `CARGO_TARGET_DIR` shared:
  - **Run 1, hello three ways:** `hello_three_ways.rs` loads hello as
    `compiled:hello`, as the component built from the same crate and mounted
    through `hello-mcp` with `manifests/mounted.toml`, each in its own
    workspace with the test kit's fixed clock, and calls `hello-greet` with
    `{ "name": "Ada", "space": "main" }` over MCP (stdio and HTTP, both eras)
    and through the CLI: five surfaces per build. The compiled and component
    `data` are equal, `at` included (`2026-01-01T00:00:00.000Z`); the mounted
    `data` equals them without `at`, which is the mounted server's own clock,
    and carries `dev.umbel/replay = "recorded"`, `dev.umbel/trust =
    "external"` and `dev.umbel/plugin = { id: "hello", kind: "mounted" }`;
    `event-list` then shows no event and head `v0:main:0` in all three
    workspaces. It passed on the first run.
  - **`cargo test --locked --workspace`** in `endpoints/umbel`: 550 passed, 0
    failed, 1 ignored (a doc-test) across 55 test runs, after `cargo fmt
    --all --check` and `cargo clippy --locked --workspace --all-targets -- -D
    warnings` were clean, with the components (`cargo build --locked --release
    --target wasm32-wasip2 ...`) and `hello-mcp` built first as `umbel.yml`
    does.
  - **Run 3, todo conformance against `umbel-todo`:** `pnpm --filter
    @afd/example-todo test:conformance:umbel` 34/34 (legacy), `... --mode
    modern` 34/34, `... --suite confirmations --mode modern` 5/5.
  - **Run 4, the stock `umbel` mounting the Rust backend:** `pnpm --filter
    @afd/example-todo test:conformance:umbel-mounted` 34/34 and `... --mode
    modern` 34/34.
  - **The Rust backend itself:** `pnpm --dir packages/examples/todo
    test:conformance:rs` 34/34, `... --mode modern` 34/34, `... --suite
    confirmations --mode modern` 5/5.
  - **AFD's own clients:** `bash endpoints/umbel/tests/scripts/external-clients.sh
    <umbel-todo> packages/cli/dist/bin.js packages/examples/todo/scenarios`
    exited 0: `afd validate --surface --strict` against `umbel-todo` with
    hello and todo enabled, 0 errors and 0 warnings (18 info, with the three
    suppressed rules of the follow-up below), and `afd scenario run` 4
    scenarios passed, 0 failed.
  - **`plugin check` on each `plugin new` template**, with the stock `umbel`
    binary in a fresh workspace (the component scaffold built for
    `wasm32-wasip2` and copied where its manifest says): `compiled`, `component`,
    `mounted` and `pack` each exit 0 and `healthy: true`, no check failed
    (`compiled`: `component` and `boot` skip; `component`: `component` and
    `boot` pass; `mounted`: `schemas` and `boot` skip; `pack`: `boot` pass;
    `surface` skip in all four).
  - **CLI and doctor smoke:** `umbel-todo init`, `plugins.enabled = ["hello"]`,
    then `workspace doctor` exited 0 with `healthy: true` and all 20 checks
    `pass`; `hello greet name=Ada` answered `Hello, Ada!` for the space `main`
    stamped `compiled`; `plugin list` showed hello loaded, "trusted, not
    sandboxed".
  - **Exit run 2 and the workflow:** `plugin-isolation` and every other job of
    `umbel.yml` ran on the pull request, and again on `main` at the merge
    commit `886c3b4d`: [run 41298630706](https://github.com/lushly-dev/afd/actions/runs/41298630706),
    success (checked 2026-11-01).
- **Not done:** nothing in phase 1. The follow-ups below that name a later
  phase stay open.
- **Needs the owner:** nothing. O1 is unchanged. Phase 2 needs its
  specification written and approved (D24) before it starts.
- **Follow-ups:** the specification's follow-ups table, mirrored below.

### Phase 2. Knowledge

- **State:** done 2026-11-01; the exit criterion is met. Specification
  approved and merged in [#625](https://github.com/lushly-dev/afd/pull/625) as
  `e996aad1`; steps 0a to 9 merged the same day and step 10 (the exit) in the
  step 10 pull request. Last verified 2026-11-01 against `main` at `aa0ecda2`
  plus step 10's test. (Superseded: "specification in review, revised, not
  approved; implementation not started", verified at `886c3b4d`.) One thing
  must be done before real use: the `knowledge-approve` confirmation prompt
  cannot show the diff (see the follow-ups; done 2026-11-03 in phase 4 step 3a).
- **Done:** the [specification](phases/2-knowledge/spec.md): store traits
  version 1 with a conformance suite and the embedded backend on SQLite (WAL)
  and tantivy, shared by several processes (D51, closing D28's choice);
  configuration version 3 with collections, space readers and access groups
  (D52); access tokens and reader filters inside every store query (D53);
  the content, document, record, index and graph grants with allow lists,
  derivation reads and manifest version 2 (D54); provenance envelope version
  1 and event version 1 (D55); the `sources-filesystem` plugin and the OKF
  container (D56); compiled first-party plugins and the `umbel-knowledge`
  binary (D57); query syntax and ranking (D58); chunking (D59); the
  structural graph with tree-sitter symbols (D60); locators (D61); proposals
  with approval per area, CLI-only apply (D62); the verification lifecycle
  (D63); output budgets AFD-first (D64); the eval harness and the lane gate
  (D65); the fail-open journal with store cross-checks (D66); content trust
  (D67). Architecture, decision log and trajectory amendments in the same
  pull request. The [revision](phases/2-knowledge/spec.md#revision-2026-11-01)
  fixed all nine must-fix findings (tantivy query parsing and features,
  concurrent indexers, co-citation leaks, access holes in sync, index and
  events, the gate's allow-list, `require-human`, self-approval, the SDK
  seams), the should-fix items and the nits; no finding was rejected.
- **Done:** step 0a, output budgets in AFD (documents only), 2026-11-01:
  the [AFD proposal](../../../docs/features/active/output-budgets/output-budgets.proposal.md)
  with its [status](../../../docs/features/active/output-budgets/STATUS.md),
  [`spec/output-budgets.md`](../../../spec/output-budgets.md) (B1 to B8)
  with its cases [`spec/output-budgets.json`](../../../spec/output-budgets.json),
  amendments to `command-metadata.md`, `context-fields.md`, `journal.md`,
  `error-codes.md` (`OUTPUT_BUDGET_EXCEEDED`, specified, joining the
  catalog in 0b), `protocol-conformance.md` and `CHANGELOG.md`; parity rows
  Planned in every language. Verified 2026-11-01 against `main` at
  `e996aad1`: current behavior read in the four languages, MCP 2026-07-28
  rules checked; `pnpm check` and the alfred parity tests. The
  specification's [Amendments from step 0a](phases/2-knowledge/spec.md#amendments-from-step-0a)
  record what changed for 0b.
- **Done:** step 0b, the Rust output budgets and the public frontmatter
  reader in AFD, 2026-11-01 ([#633](https://github.com/lushly-dev/afd/pull/633)):
  `CommandDefinition::with_output_budget`, `CommandContext::with_output_budget_ask`
  and `output_budget()`, the check after the handler (an over-budget read is
  `OUTPUT_BUDGET_EXCEEDED`, a mutation keeps its result with a warning), the
  ask in `_meta["dev.afd/outputBudget"]` and the meta-tools' `meta` on every
  route and both MCP eras, per item in batches and per step in pipelines,
  the journal's `outputBudget` with replay, the declaration on tools,
  grouped actions, `afd-detail` and `afd-help`; `OUTPUT_BUDGET_EXCEEDED` in
  the shared catalog, `vectors/error-codes.json` and the TypeScript, Python,
  Rust and C++ constants; `afd::frontmatter::parse` public (feature
  `frontmatter`, on with `server`): `Ok(None)` for no frontmatter, a typed
  `FrontmatterError`, the body's byte offset and line, generic messages, no
  size cap. Verified 2026-11-01: everything `rust.yml` runs plus the
  `frontmatter`-alone leg, `tests/output_budget.rs` over every case of
  `spec/output-budgets.json` (in process, HTTP and stdio, both eras), the Rust
  todo backend with `--locked` and its conformance runs, `cargo test --locked
  --workspace` in `endpoints/umbel`, the Python and C++ error-code tests and
  `pnpm check`. Nine details are in the specification's
  [Amendments from step 0b](phases/2-knowledge/spec.md#amendments-from-step-0b).
- **Step 1 done (2026-11-01, [632](https://github.com/lushly-dev/afd/pull/632)):**
  shapes and configuration, no store, index or plugin code. Nine schemas
  with examples (`workspace-config.v3`, `plugin-manifest.v2`,
  `provenance-envelope.v1`, `event.v1`, `document.v1`, `locator.v1`,
  `proposal.v1`, `eval-queries.v1`, `eval-report.v1`); configuration version
  3 (`collections`, per-space `readers`, `[access.groups]`, `[store]`;
  versions 1 and 2 still open, `content_roots` refused in 3), `umbel init`
  writing 3, the doctor's `collections.roots`; manifest version 2 parsing
  (`store-write` and `workspace-write` with their grants, `output_budget`
  stored, `confirm = "require-human"` with its prompt and CLI-only checks);
  `store` a host domain; envelope and event version 1 (effective principal
  string, `plugin` from the gate's stamp, `access`, `sensitivity`, `changes`),
  with version 0 lines read and rebuilt as written; `workspace-show`'s
  `versions`. Amendments in the specification's [Amendments from step
  1](phases/2-knowledge/spec.md#amendments-from-step-1). Verified 2026-11-01
  in `endpoints/umbel` with `CARGO_TARGET_DIR` shared: `cargo fmt --all
  --check`, clippy `-D warnings` on the workspace and each `umbel.yml` leg,
  `cargo test --locked --workspace` (600 passed), the MSRV check
  (`cargo +1.97.0 check --locked --workspace --all-targets`), `pnpm check`.
- **Step 2 done (2026-11-01, [636](https://github.com/lushly-dev/afd/pull/636)):** the store traits and the SQLite
  stores, no index and no host wiring. `umbel-store`: the types, the three
  traits (`DocumentStore` with records and the change log, `SearchIndex`
  and `GraphStore`), `STORE_TRAITS_VERSION` (the host re-exports it), the
  conformance suite (`conformance::run_all(factory, spawn_writer)`: 48 cases
  in the groups `documents`, `records`, `changes`, `envelope`, `access` over
  the 40-document fixture in `store/fixtures/access/` with an independent
  oracle for three readers, `graph`, `concurrency` and `durability`; the
  index cases report skipped), and the in-memory fake behind
  `tests/suite_detects.rs`, which fails 19 deliberate faults in the cases
  that should catch them and passes when unbroken. `umbel-store-embedded`:
  bundled SQLite (rusqlite 0.41.1, SQLite 3.54.1) in WAL mode with
  `synchronous=FULL`, `foreign_keys`, a bounded busy timeout, `fullfsync`
  on macOS, `BEGIN IMMEDIATE` for every write, short reads that never pin the
  WAL, SQLite's default autocheckpoint and a best-effort `wal_checkpoint(TRUNCATE)`
  hook; documents, records, the change log (one revision sequence, an
  access set per change), the graph (per origin document, readable through
  that document's access, aggregated over readable origins) and the access
  filter as a semi-join inside every statement. Tests: the suite against
  SQLite (`conformance.rs`, including two child processes through
  `spawn_writer`), `multiprocess.rs` (four processes creating one store at
  once, this process beside two others, a writer past the lock timeout in
  this and in another process is `Busy`), `sqlite.rs` (pragmas, newer
  schema refused, wrong space, a damaged file, checkpoint beside a reader)
  and `suite_detects.rs`. The `knowledge` CI job (Linux and macOS) runs
  them; the `check` and `msrv` jobs exclude the SQLite crate so they do not
  build it. Seven amendments in the specification's [Amendments from step
  2](phases/2-knowledge/spec.md#amendments-from-step-2). Cost of bundled
  SQLite, measured 2026-11-01 on this machine (Apple silicon, dev profile,
  fresh target directory): `cargo build -p rusqlite` took 39 s wall and 106
  MB of target (`libsqlite3-sys` rlib 8.8 MB, `rusqlite` rlib 4.4 MB).
  Verified 2026-11-01 in `endpoints/umbel` with `CARGO_TARGET_DIR` shared:
  `cargo fmt --all --check`, clippy `-D warnings` on the workspace and each
  `umbel.yml` leg, `cargo test --locked --workspace`, the MSRV check
  (`cargo +1.97.0 check --locked --workspace --all-targets`), `pnpm check`.
- **Step 3 done (2026-11-01, [643](https://github.com/lushly-dev/afd/pull/643)):** the tantivy index. `umbel-store-embedded`
  gains `TantivyIndex` (`SearchIndex` under `index/v1/`, an `MmapDirectory` with
  LZ4 named in the index settings, `en_stem`, tantivy 0.27 with
  `mmap`, `stopwords`, `stemmer` and `lz4-compression` and nothing else): one
  document per chunk in schema 1, the query builder over the
  `tantivy-query-grammar` AST (fields checked, `access` refused in every
  position, at most 64 clauses, 8 fields, 16 levels, slop 8, boosts in
  (0, 100], 1024 characters; a single trailing `*` is a prefix bounded at 256
  expansions, constant-scored under the field's boost), the reader filter and
  the structured filters as score-less mandatory clauses, four-decimal scores
  with ties resolved by document id and ordinal, highlighted snippets, writer
  sessions on tantivy's own lock (bounded wait, `Busy`; `applied` read under it
  and never lowered, `Conflict`; the commit payload `{applied, schema}`; merges
  finished before the lock is released), reload before each search, checksum
  validation, and `SqliteStore::readable_graph`, the petgraph form cached by
  `(graph applied, head, reader)` in eight entries. The conformance suite gains
  the `index` group (twelve cases) and the two index cases that waited since
  step 2, `run_groups`, and `samples::chunk`: 59 cases, none skipped against the
  embedded backend. Tests: `conformance.rs` (all), `index.rs` (LZ4 and the
  payload, durability, damaged segment found by the checksum, newer schema
  refused, snippets, scores independent of the reader, the writer wait,
  a second handle seeing commits, caps, the petgraph cache),
  `query_syntax.rs` (the grammar's real behaviour: only a trailing star is a
  prefix, escaped stars, meta values as strings, numbers and booleans, dates,
  paths, depth, the error text), `index_suite_detects.rs` (four planted faults
  in the real index fail the cases that should catch them) and
  `multiprocess.rs` (two indexer processes taking turns and never lowering
  either revision, a second process waiting and then `Busy`, a killed indexer
  leaving no stale lock, a run after a crash between the two commits redoing
  only the lagging store). Fourteen amendments in the specification's
  [Amendments from step 3](phases/2-knowledge/spec.md#amendments-from-step-3);
  C1 corrects the revision's claim about the grammar (it marks `prefix` only
  on a quoted phrase). Measured cold on this machine (Apple silicon, `-j4`,
  load average 10 to 18): `cargo build -p umbel-store-embedded` 83 s and 640
  MB; tantivy and the 96 crates it adds took 135 of 188 CPU-seconds
  (`tantivy` 57 s, `tantivy-columnar` 18 s; the `tantivy` rlib is 88 MB), SQLite's
  C build 28 s; the job's steps 205 s and 1.1 GB. The `knowledge` job's timeout
  is 15 minutes (was 45): three times the local 205 s, widened for the
  slower hosted runners (C14). Verified 2026-11-01 in `endpoints/umbel` with
  `CARGO_TARGET_DIR` shared: `cargo fmt --all --check`, clippy `-D warnings`
  on the workspace and each `umbel.yml` leg including the knowledge and wasm
  legs, `cargo test --locked --workspace`, the MSRV checks, `pnpm verify` (the
  repository's `check` and every `umbel.yml` leg a pull request runs).
- **Step 4 done (2026-11-01, [651](https://github.com/lushly-dev/afd/pull/651)):** host services, the first
  step that lets a plugin reach the stores. The ten grants (`content`,
  `content_write`, `documents`, `documents_write`, `records`, `records_write`,
  `index`, `index_write`, `graph`, `graph_write`), held by compiled plugins
  only, scoped to the call's spaces; the five write grants need
  `[plugins.<id>.grants.<grant>] allow = [...]` (configuration version 3 and
  `workspace-config.v3.json`), else `PLUGIN_GRANT_DENIED` at load for a required
  grant, withheld for an optional one, and `STORE_WRITE_NOT_ALLOWED` for a
  write outside the entries; reader filters built from the effective
  principal, `onBehalfOf`, groups and a space's `readers`
  (`SPACE_NOT_READABLE`, before the handler, for every plugin command and for
  `event-list` and the `store-*` commands); `spaces` checked like `space`;
  derivation reads (`derive_changes`, `derive_document`) for a `store-write`
  command with `index_write` or `graph_write`, and `as_reader` for a
  CLI-only command called by a human; provenance enforcement
  (`STORE_PROVENANCE_REQUIRED`; the host overwrites `space`, `plugin`,
  `agent`, `principal`, `traceId` and `observedAt`); the plugin gate's named
  allow-list (`dev.umbel/index`, `dev.umbel/trust` only `"content"`), the
  gate-set `dev.umbel/changes` and `replay: "recorded"` on store-backed
  results, and `event-list` skipping version 1 events by `access`; the SDK's
  store methods, `Cx::in_space`, `Reader`, `HostError`'s `Conflict`, `Busy`,
  `Corrupt` and `Io`, `CallContext.spaces` and `output_budget`,
  `Outcome::with_sources` and `with_warning_details`; the manifest's
  `output_budget` wired to `with_output_budget`; `store-show`, `store-check`
  and `store-backup` and the doctor's `stores.version`, `stores.access` and
  `stores.lag`; `confirm = "require-human"` on the CLI (a terminal answer
  only; `--yes` and `--approve` refused; refused on every other surface);
  `workspace-show`'s `access` and the README's paragraph on access before
  phase 5. The two step 1 follow-ups for step 4 are done. Fifteen amendments
  in the specification's [Amendments from step
  4](phases/2-knowledge/spec.md#amendments-from-step-4). New tests:
  `store_grants.rs`, `access_filter.rs`, `require_human.rs`,
  `store_commands.rs`, `doctor_stores.rs`, the rest of `manifest_v2.rs`, and
  allow-list cases in `config_v3.rs`, `schemas.rs` and the loader's unit tests.
  The host now links SQLite and tantivy through its default feature
  `store-embedded`, so the `check` and `msrv` jobs build them too (amendment
  D15); plugin crates that use `default-features = false` do not. Verified
  2026-11-01 in `endpoints/umbel` with `CARGO_TARGET_DIR` shared: `cargo fmt
  --all --check`, clippy `-D warnings` on the workspace and on each
  `umbel.yml` leg (no default features, mounted, component, the SDK and hello
  with `mounted`, the components for `wasm32-wasip2`, the knowledge crates),
  the wasm check of `umbel-store`, `cargo test --locked --workspace` (717
  passed), the MSRV checks (`cargo +1.97.0 check --locked --workspace
  --all-targets` and the knowledge crates), `pnpm verify`. The sync, status and
  index outputs of the specification's section 5.5 and 8.7 do not exist yet
  (steps 5 and 6): the "no restricted id or count" tests cover the store
  reads, `store-show`, the graph, the change log and `event-list` now, and
  those commands inherit the reader filter and the gate's `readers` check.
- **Step 5 done (2026-11-01, [668](https://github.com/lushly-dev/afd/pull/668)):** the first plugin that fills the
  stores. `umbel-scan` (the `description-injection` patterns moved out of
  `src/plugins/mounted/scan.rs`, which re-exports them, so the host's `mounted` feature does not
  link pulldown-cmark; plus the hidden-text check: zero-width and bidirectional controls, tag
  characters, HTML comments over 200 characters). `umbel-okf`: frontmatter through AFD's public
  reader under Umbel's 64 KiB cap, with no frontmatter (`Ok(None)`) kept apart from malformed,
  the empty block refused, the byte order mark stripped and offsets true to the file; the OKF keys
  and Umbel's extensions normalized under the field caps (title 512 characters, description 4 KiB,
  32 aliases, 64 tags, owners 32) with `fields-limited`; markdown structure from pulldown-cmark
  (heading tree with slugs and section ranges, top-level blocks, links, code spans, line numbers)
  with bounded work for adversarial input; link resolution; `analyze`, one call per file. The
  compiled plugin `sources` (crate `umbel-plugin-sources-filesystem`; the id has no hyphen, amendment
  E2) with `sources-sync` and `sources-status`, its `frontmatter` schema pack and its skill:
  collections from configuration version 3 through the new host service `content_collections`
  (E1), change detection by size and modification time then SHA-256, compare-and-set writes with
  one retry, tombstones, a sharded sync state, `dry_run`, `limit` and `remaining` (E3, E4), access
  mirroring from the document, the nearest `.umbel-access.toml` or the collection (E5), the write
  scan's flags (flagged, never blocked), and results of **totals plus the ids the caller can read**
  (a person at the command line also gets paths). The `knowledge` CI job runs the new crates;
  (The `$CARGO_TARGET_DIR` fix for the external-clients verify step had already landed in
  [#652](https://github.com/lushly-dev/afd/pull/652).)
  Thirteen amendments in the specification's [Amendments from step
  5](phases/2-knowledge/spec.md#amendments-from-step-5). New tests: `scan/tests/scan.rs`,
  `okf/tests/frontmatter.rs`, `structure.rs` and `flag_rate.rs`,
  `plugins/sources-filesystem/tests/sync.rs`, `access_mirror.rs`, `readable_results.rs` and
  `confinement.rs` (path traversal, symbolic and hard links, names that cannot be ids, size caps,
  100 001 files, pathological markdown, restricted ids absent from results, warnings and events for
  a reader outside the access set). **Flag rate** of the write scan on this repository's 523
  Markdown documents: 17 `instruction-like` (3.3 %), 1 `hidden-text` (0.2 %). Verified 2026-11-01 in
  `endpoints/umbel` with `CARGO_TARGET_DIR` shared: `cargo fmt --all --check`, clippy `-D warnings`
  on the workspace and on each `umbel.yml` leg, the wasm checks and component builds,
  `cargo test --locked --workspace`, the MSRV checks, and `pnpm verify`. The hidden counts of
  section 6 are as the owner accepted: the totals of a sync or status result include files the
  caller cannot read.
- **Step 6 done (2026-11-01, [671](https://github.com/lushly-dev/afd/pull/671)):** the knowledge core. The crate
  `umbel-plugin-knowledge` (plugin `knowledge`, no `code` feature yet) and its binary
  `umbel-knowledge` (the `umbel` command line with `sources` and `knowledge` compiled in; the stock
  `umbel` stays empty, D57). **Chunking** (`chunk.rs`, D59): sections by heading, blocks
  accumulated to 240 words and never past 400, oversize blocks split at lines, short tails merged,
  no overlap, at most 2000 chunks, a 64 KiB cap per chunk, code as 60-line plain text.
  **`knowledge-index`**: the section 8.7 procedure, index only (the writer first, derivation reads,
  chunks built in memory, one commit that never lowers `applied`; bounded by `limit`, a rebuild is
  one run), with totals plus the ids the caller can read. **`knowledge-search`**: fielded BM25
  through the query builder of step 3 (boolean, phrase, field, boost and bounded prefix syntax),
  the reader filter as a mandatory clause of the index query, documents with their best chunk,
  locator and verification, snippets, AFD `sources`, `INDEX_STALE`, `STALE_CONTENT`,
  `UNVERIFIED_CONTENT`, `CONTENT_FLAGGED` and `RESULTS_LIMITED`, `verified_only`, draft and
  deprecated handling; multi-space queries through `Cx::in_space`, fused by reciprocal rank,
  labeled and never written back. **`knowledge-open`** (by line, chunk, heading or locator, with
  `DOCUMENT_CHANGED`), **`-find`**, **`-describe`** (outline, links, readable-only backlinks),
  **`-list`** and **`-changes`**, with `trust: "content"` and `dev.umbel/trust: "content"` on every
  read, output budgets (24 000/96 000 for search, 32 000/128 000 for open, 16 000/64 000 for the
  rest) that the handlers fit structurally and AFD's check backs up, the first-class suggestions
  (`knowledge-search`, `knowledge-open`), the `knowledge-refresh` pipeline, the `ranking` pack and
  the `knowledge-guide` skill. Seventeen amendments in the specification's [Amendments from step
  6](phases/2-knowledge/spec.md#amendments-from-step-6) (F1 to F17); no host change was needed. New
  tests in `plugins/knowledge/tests/`: `chunking.rs` (every rule, a committed fixture),
  `query_syntax.rs`, `search.rs`, `open_find.rs`, `spaces.rs`, `budgets.rs` (including exact fits and
  the refusal by AFD's check), `security.rs` (an outsider never sees a restricted document, its
  chunks, snippets, ids or backlink contributions through search, open, find, describe, list,
  changes or the index; filtering inside the query with sixty better restricted matches; the
  `access` field unqueryable and the reader unchoosable; an unreadable space refused with
  `SPACE_NOT_READABLE`), `index.rs`, `process.rs` (a stdio server and one-shot commands on one
  workspace at once through the `umbel-knowledge` binary) and `smoke.rs`. The `knowledge` CI job
  runs the new crate. The crate is in the release inventory (quarantined) and `architecture.json`.
  Verified 2026-11-01 in `endpoints/umbel` with `CARGO_TARGET_DIR` shared: `cargo fmt --all
  --check`, clippy `-D warnings` on the workspace and each `umbel.yml` leg, `cargo test --locked
  --workspace`, the MSRV checks, and `pnpm verify`.
- **Step 8 done (2026-11-01, [673](https://github.com/lushly-dev/afd/pull/673)):** proposals and the verification lifecycle, all in
  the `knowledge` plugin and one host service. **The proposal** (`proposal/`): the record
  `proposal.v1` kept as a decision trace in the plugin's namespace with the target's access set (so
  the host's reader filter hides proposals whose target the caller cannot read); **areas** with
  approver lists and `allow_self_approval` in the instance's configuration, the most specific
  collection and prefix governing; **`knowledge-propose`** (create, update, deprecate, verify;
  validated against the area, the base hash, the collection and the evidence; scanned; a unified
  diff by `similar`; an idempotency key whose id is `p-` and 20 hex of the space, the proposer's
  actor string and the key, so a retry returns the proposal and another change is
  `PROPOSAL_KEY_REUSED`), **`knowledge-proposal-list`**, **`-proposal-show`** (the record without the
  repeated content, `trust: "content"`, under an output budget) and **`knowledge-withdraw`**.
  **`knowledge-approve`**, **`-reject`** (a required reason) and **`-verify`** are CLI-only with
  `confirm = "require-human"` (a terminal on stdin and stderr; `--yes` and `--approve` refused),
  approve and verify also with AFD's approval. The approver must be a person, among the area's
  approvers (matched through the new host service `reader_tokens`), able to read the target; the
  same actor approving its own proposal is `PROPOSAL_SELF_APPROVAL` unless the area allows it
  (`exception: "self-approval"`), and a person approving their own agent's proposal is allowed with
  `proposer.actor.kind = "agent"` and `decision.proposerKind` recorded. **The apply sequence**:
  check the file against `baseHash`, record the decision, write the file through `content_write` by
  temporary file and rename with the expected hash, put the document (origin `user-stated` for a
  human proposer, else `agent-inferred`; the proposal's `confidence`; the evidence documents as
  `sources`; `derivedFrom` the proposal), record `applied`; a run that stopped resumes without
  repeating a done step. Approve does not index (`indexed: false`, `INDEX_STALE` until
  `knowledge-refresh`). **Verification**: `knowledge-verify` stores a `verify` proposal as the
  calling person and applies it in the same call when they are an approver (no self-approval
  exception); verify and deprecate are frontmatter-only rewrites by the new
  `umbel_okf::rewrite_keys`. Every state change is journaled and evented with the target's access
  set, so `event-list` filters it. Sixteen amendments in the specification's [Amendments from step
  8](phases/2-knowledge/spec.md#amendments-from-step-8) (G1 to G16), among them the one host change
  (the pull request body carries `Plugin-isolation-exempt:`) and the static confirmation prompt. New
  tests: `plugins/knowledge/tests/proposals.rs` (18), `verification.rs` (9) and the write side of
  `security.rs` (6), the unit tests of `rewrite_keys`, and the host's
  `reader_tokens_are_the_callers_own_tokens_and_nobody_elses`. Deployers upgrading add
  `[plugins.knowledge.grants.records_write] allow = [...]`, and `documents_write` and
  `content_write` to apply proposals (amendment G14). Verified 2026-11-01 in `endpoints/umbel` with `CARGO_TARGET_DIR` shared: `cargo fmt --all --check`, clippy `-D warnings` on the workspace and each `umbel.yml` leg, the wasm checks, `cargo test --locked --workspace`, the MSRV checks, and `pnpm verify`.
- **Done:** step 10, the exit (the step 10 pull request): `plugins/knowledge/tests/exit_thousand.rs`
  and the exit criterion re-run. The test generates the fixture with seed `20261101`, opens a host
  with `compiled:sources` and `compiled:knowledge` enabled for both spaces, runs `knowledge-refresh`
  then `knowledge-index rebuild=true` in `alpha` and `beta`, and asserts the specification's four
  points: **(1)** `store-show` as the CLI human reports 650 documents in `alpha` (600 Markdown, 50
  code) and 400 in `beta`, 1000 Markdown in all, and each space's index and graph applied revisions
  equal to its head; **(2)** all 220 seeded queries, each run in `alpha` and in `beta` on its own
  (440 searches), return only that space's hits (the queries whose words occur in both spaces
  included), the 15 `cross-space` queries return `beta` hits only with `spaces` and every hit is
  labeled, and `knowledge-open`, `-neighbors`, `-related` and `-path` with a document of the other
  space answer `DOCUMENT_NOT_FOUND` or `PATH_NOT_FOUND`; **(3)** none of the 45 restricted documents
  (the 20 probes' answers and 25 entries) comes back to `human:eval-reader` in any search run as
  them (every seeded query names them), as a member of `restricted` every probe's first hit is its answer, `knowledge-open` of
  a restricted answer is `DOCUMENT_NOT_FOUND` for the outsider and succeeds for the member, the
  public documents that link to the 20 restricted answers (86 citer and answer pairs) never name the
  answer in `knowledge-neighbors` for the outsider and have `PATH_NOT_FOUND` to it (the member reaches it in one hop), and with `beta`'s
  `readers = ["group:restricted"]` the outsider gets `SPACE_NOT_READABLE` from search, a
  multi-space search that names it, and list, while the group's members and `alpha` are
  unaffected; **(4)** `knowledge-eval`'s report validates against `eval-report.v1.json`, passes
  `eval::gate::check` against `eval/baseline.json`, has 0 leaks in 220 queries, and is written to
  the file `UMBEL_EXIT_REPORT` names (the `knowledge` job sets it, beside the step 9 report, and
  uploads both in the one artifact). **Eval numbers** (seed `20261101`, `k = 10`, 185 answerable
  queries): with expansion on recall 1.0, nDCG 0.9273, MRR 0.9207; off recall 0.8919, nDCG 0.9123,
  MRR 0.8784; multi-hop recall 1.0 against 0.0; the 15 unanswerable queries all empty; 0 leaks;
  latency p50 5.4 ms, p95 40.6 ms in a debug build. **The fixture is synthetic with planted terms**
  (pseudo-words, planted key terms, aliases, bridges and mentions), so its recall measures the
  pipeline and regressions, not quality on real content; a deployer's own corpus needs its own
  query set. The test takes about 21 seconds in a debug build.
- **Exit criterion re-run** (2026-11-01, `main` at `aa0ecda2` plus step 10, in `endpoints/umbel`
  with its own `CARGO_TARGET_DIR`): `cargo test --locked --workspace` in `endpoints/umbel` passed 1032 tests in 107 suites (0 failed, 1 ignored doctest); the `knowledge` job's crates 364 (46 suites) and `-p umbel-plugin-knowledge --no-default-features` 169 (21 suites); the `check` job's test 680 (64 suites); every `umbel.yml` leg exited 0 (`cargo fmt --all
  --check`; clippy `-D warnings` on the workspace, the library-only, mounted and component legs, the
  mounted SDK and hello-mcp leg and the `wasm32-wasip2` leg; the components and hello-mcp builds;
  the `check` job's test; the MSRV 1.97 check; the `knowledge` job's clippy, test, no-default-features
  clippy and test, `wasm32-wasip2` check of `umbel-store` and MSRV check); `pnpm verify` passed all
  14 of its legs (the `umbel.yml` ones including the todo conformance for `umbel-todo` and the
  mounted backend in both MCP eras with confirmations, and the external-clients check). The hosted
  `umbel.yml` runs are the pull request's checks (the `knowledge` job's first hosted timing is a
  follow-up).
- **Smoke on a fresh workspace** with the `umbel-knowledge` debug binary: `umbel-knowledge init`,
  then the `umbel.toml` of the README's "Run the knowledge plugin" (one handbook collection of two
  Markdown files, one code collection with a Rust file, an area approved by `principal:human:ada`);
  `workspace doctor` healthy with 24 checks all `pass`; `knowledge-refresh`; `knowledge-search`
  found both documents (and the Rust symbol `apply_step` by name) and `knowledge-open` read one;
  `knowledge-propose` (create), `knowledge-approve` refused with `CONFIRMATION_REQUIRED` without a
  terminal and **applied at a real pseudo-terminal** (`script` supplying one: two prompts, the
  plugin's confirmation and AFD's approval, both answered `y`; the file was written, the document
  stored, the proposal `applied` with the `self-approval` exception the area allows); after another
  `knowledge-refresh` the approved document was found by search; `store-show` showed the index and
  graph at the head (14); `workspace-show` reported `access: { principals: "unverified", exact:
  ["library"] }`. The approval path is also covered by `proposals.rs` and `require_human.rs`
  (the scripted terminal). The smoke showed the terminal prompt as a fixed sentence with no
  proposal id, diff or flags (amendment G2), which is why the follow-up below is "before real use".
- **Spec items confirmed from the code** (not from memory): output budgets are declared on every
  read command of the knowledge manifest (search 24 000/96 000, open 32 000/128 000, find,
  describe, list, changes, neighbors, related, path, outline, stale, proposal-list and
  proposal-show 16 000/64 000; `knowledge-eval` declares none by design, J11) and tested in
  `budgets.rs` (11 cases, including exact fit and one byte over, a result that cannot fit refused
  rather than truncated) and in AFD's `output_budget.rs`; `event-list` skips version 1 events the
  caller cannot read (`src/commands/event_list.rs`; `access_filter.rs`
  `event_list_skips_version_1_events_the_caller_cannot_read`); `require-human` is enforced in the
  CLI (`tests/require_human.rs`, 7 cases: `--yes` and `--approve` refused, no terminal refused, a
  terminal answer decides, a batch cannot carry it, MCP and in-process refused) and declared on
  `knowledge-approve`, `-reject` and `-verify`; the README states under "Access is not a security
  boundary yet" that filtering is exact only for embedders and tests until phase 5; the README now
  lists every required `allow` list (`records_write` and `graph_write` among them, and
  `documents_write` and `content_write` for applying proposals) with a working `umbel.toml`,
  verified by the smoke run above. No gap was found against those items.
- **Not done:** nothing in phase 2's plan. Open and recorded as follow-ups: the dynamic
  confirmation prompt (**must do before real use**; done 2026-11-03 in phase 4 step 3a), partitioned BM25 statistics (a phase 5
  prerequisite), the hosted `knowledge` job timing, and the ranking tweak for expansion. TypeScript,
  Python and C++ output budgets are AFD's follow-up and do not block Umbel. Store grants for
  components wait for WIT world 1.1.0.
- **Owner decisions (2026-11-01):** recorded in the specification's
  [section 15](phases/2-knowledge/spec.md#15-for-the-owner): access v0
  accepted and tightened (derivation reads compiled-only; filtering exact
  only for embedders and tests until phase 5; flagged, not blocked;
  index-building outputs and events filtered to totals plus readable ids);
  approve and reject require a human at a terminal (`confirm =
  "require-human"`); self-approval refused only for the same actor; BM25
  statistics over unreadable chunks accepted for phase 2, with partitioned
  statistics or coarsened scores a phase 5 prerequisite. The coordinator
  kept D66's fail-open journal (race fixed), D62's proposals in phase 2
  (phase 4's exit amended to a curator proposal) and D57's binary.
- **Needs the owner:** nothing to approve. (Superseded: "approval of the revised specification", given and merged in #625.) The dynamic confirmation prompt below needs a decision on where it lives (a host feature) before a real deployment.
- **Follow-ups:** the specification's follow-ups table, mirrored below.

- **Step 7a done (2026-11-01, [672](https://github.com/lushly-dev/afd/pull/672) and the step 7a graph
  pull request):** the structural graph. **Part 1 (host and SDK):** `HostServices::graph_applied`
  (a `graph` read), `derive_head` (the true head, which counts changes the caller may not read, so a
  derivation read only) and `checkpoint` (any store write grant allowed for the space), and the
  host's whole-graph read served from the readable-graph cache. **Part 2 (the `knowledge` plugin):**
  `knowledge-index` builds the graph in the same run as the index (the writer first, both applied
  revisions, the run starting after the smaller, one `GraphBatch` committed in one transaction before
  the index, neither revision ever lowered, `checkpoint`, and the exact head in the result and in
  `dev.umbel/index`); the nodes and edges of section 7.3 except code symbols: directories, headings,
  `links_to` (and a heading edge for a fragment), `tagged`, `owned_by`, `supersedes` and `co_cited`
  stored per citing document under the 50-target cap, with a contribution never producing a node
  for a link's target. `knowledge-search` expands along readable edges (`links_to` both ways,
  `supersedes`, `co_cited` at weight 2, at most 20 per document, the `ranking` pack's `[expansion]`
  table) and marks a neighbour `matched: false`; `INDEX_STALE` counts a lagging graph.
  `knowledge-neighbors`, `-related`, `-path`, `-outline` and `-stale` are new, with output budgets;
  `knowledge-describe` adds `graphApplied` and `coCitation`; `sources-sync` checkpoints. Nothing hidden
  is named, scored or counted: neighbours, backlink counts, co-citation weights and paths use only
  the origins and endpoints the caller can read (tests: a restricted citer does not raise a public
  pair's weight; a path never passes through a restricted document). Fourteen amendments in the
  specification's [Amendments from step 7a](phases/2-knowledge/spec.md#amendments-from-step-7a)
  (H1 to H14). Verified 2026-11-01 in `endpoints/umbel` (shared `CARGO_TARGET_DIR`): `cargo fmt
  --all --check`, clippy `-D warnings` on the workspace and each `umbel.yml` leg, the wasm checks,
  `cargo test --locked --workspace`, the MSRV checks and `pnpm verify`.

- **Step 7b done (2026-11-01, the step 7b pull request):** code symbols, in the `knowledge` plugin
  only (no host or SDK change). The default `code` feature adds tree-sitter 0.27.1 and the Rust,
  Python and TypeScript grammars (JavaScript and JSX parse through the TSX grammar; the fixtures show
  no gap, so `tree-sitter-javascript` stays out) and one committed query file per language. A code
  file is chunked by top-level definition with its comments, `export` and decorators, the text
  between them in 60-line pieces, and its symbols are the `code` field of each chunk and
  `symbol:<language>:<qualified name>` nodes with a `defines` edge from the file; a markdown
  document's inline code that could name a symbol is a `mentions` edge to that node's id, served
  only where both documents are readable and counting from the day the symbol exists. Parsing and
  querying run under a wall-time bound each (tree-sitter's progress callbacks), a match limit, a
  1 MiB size bound, a 5000-definition bound and a 25 % error rate (bytes under `ERROR` or
  `MISSING` nodes); a file over any is plain text with `CODE_PARSE_DEGRADED` naming only readable
  ids, and `knowledge-describe` says how a file was indexed. Nothing recurses over a tree: 200 000
  levels of nesting pass on a 1 MiB stack. A restricted file's symbols reach an outsider through no
  search, neighbor, path, related, outline, list, find or open (tests). Eight amendments in the
  specification's [Amendments from step 7b](phases/2-knowledge/spec.md#amendments-from-step-7b)
  (I1 to I8); the one that changes meaning: a mention names a **qualified** name, not a bare method
  name (I1). Build cost: about 16 CPU seconds (7 to 8 s wall at `-j4`) for the tree-sitter crates and
  +4.7 MB (+15 % unstripped, +19 % stripped) on the release `umbel-knowledge`. Tests:
  `code_symbols.rs` (27), `code_off.rs` (2, with `--no-default-features`) and unit tests. Verified
  2026-11-01 in `endpoints/umbel` (own `CARGO_TARGET_DIR`): `cargo fmt --all --check`, clippy
  `-D warnings` on the workspace and each `umbel.yml` leg including the knowledge crate without
  `code`, `cargo test --locked --workspace --no-fail-fast` (1006 passed), the MSRV checks and
  `pnpm verify`.

- **Step 9 done (2026-11-01, the step 9 pull request):** the eval harness, all in the `knowledge`
  plugin and no host change. **The fixture** (`eval/fixture.rs`, `rng.rs`, `words.rs`): a PCG32
  stream and a pseudo-word generator implemented in the crate, so the output is a pure function of
  the seed; seed `20261101` writes `umbel.toml` (version 3, both spaces, the `restricted` group),
  600 handbook and runbook documents and 50 code files in `alpha`, 400 notes in `beta`, and
  `spaces/alpha/eval/queries.jsonl`; 150 alpha topics (a key term in one answer and in passing in up
  to two others, two aliases, a phrase, a bridge document that links to the answer) and 15 beta
  topics; 45 restricted handbook documents, 22 deprecated, exactly 8 `instruction-like` and 4
  `hidden-text` planted for the write scan; the tree is pinned by a SHA-256 constant. **The query set**
  (`eval/queries.rs`): 220 queries (80 exact, 30 alias, 20 phrase, 20 field, 20 multi-hop, 15
  cross-space, 15 unanswerable, 20 permission), validated against `eval-queries.v1.json`.
  **`knowledge-eval`** (`eval/run.rs`; CLI only, `inspect`): `{ spaces?, queries?, k?, expand? }`,
  each query run through the ranking code `knowledge-search` runs (now generic over the read methods
  of `Cx` and of `Cx::as_reader`'s `Reader`) as the principal it names; recall@k, nDCG@k and MRR@k
  overall and per kind with expansion on and off, the unanswerable empty rate, `leaks` (checked
  against each hit's stored access set and the principal's reader tokens), latency and every
  query's ranked ids and scores; the report is the result. **The gate** (`eval/gate.rs`): `check`
  (zero leaks, every unanswerable query empty, recall@10 >= 0.85, nDCG@10 >= 0.70, multi-hop
  recall not hurt by expansion, no metric more than 0.02 below `plugins/knowledge/eval/baseline.json`)
  and `lane_gate` (the seam for O4's lanes: at least 50 answerable queries). **CI:** the `knowledge`
  job runs `eval_gate` and uploads the report as an artifact. Eleven amendments in the specification's
  [Amendments from step 9](phases/2-knowledge/spec.md#amendments-from-step-9) (J1 to J11), the main
  one that `queries` is `<collection>/<path>` (a plugin has no workspace path). **The numbers**
  (seed `20261101`, `k = 10`, 185 answerable queries): with expansion on recall 1.0, nDCG 0.9273, MRR
  0.9207; off recall 0.8919, nDCG 0.9123, MRR 0.8784; multi-hop recall 1.0 against 0.0; the 15
  unanswerable queries all empty; 0 leaks in 220 queries. The thresholds are met without any
  change to them or to the fixture after the first run. One ranking finding, recorded as a follow-up:
  expansion lowers the nDCG of exact queries (0.9368 against 1.0) because the link neighbours of a
  strong match outrank its weaker grade-1 mentions. The fixture's code files work with and without
  step 7b's `code` feature (plain text, or by symbol), and no query targets a code file. New tests: `plugins/knowledge/tests/eval_fixture.rs` (8) and `eval_gate.rs` (7), and
  unit tests for the generator's stream, words, metrics, gate and leak check. Verified 2026-11-01
  in `endpoints/umbel` with `CARGO_TARGET_DIR` shared: `cargo fmt --all --check`, clippy `-D warnings` on the workspace and each `umbel.yml` leg, the wasm checks, `cargo test --locked --workspace` and the `knowledge` job's crates, `cargo +1.97.0 check --locked --workspace --all-targets`, and `pnpm verify` (all passed).

Phases 3 to 7 have no detail yet; add a heading in this shape when one
starts.

### Phase 3. Memory and context

- **State:** specification approved 2026-11-02, under the owner's 2026-10-31
  delegation, with the owner's answers of 2026-11-02 (D24), and merged in
  [#685](https://github.com/lushly-dev/afd/pull/685) as `e4c91f30`. The owner's last
  four answers (D86 to D89) follow in their own pull request. Step 1 done
  2026-11-02 in [#729](https://github.com/lushly-dev/afd/pull/729) (`ed9a8539`); step 2 done
  2026-11-03 in [#733](https://github.com/lushly-dev/afd/pull/733) (`b84e0bd5`); step 3a done
  2026-11-03 in [#736](https://github.com/lushly-dev/afd/pull/736) (`b970994e`); step 3b done
  2026-11-03 in [#737](https://github.com/lushly-dev/afd/pull/737) (`8d51ee13`); step 4 done
  2026-11-03 in [#740](https://github.com/lushly-dev/afd/pull/740) (`d945bbbf`); step 5 done
  2026-11-03 in [#742](https://github.com/lushly-dev/afd/pull/742) (`0e3a501a`); step 6 done
  2026-11-03 in [#743](https://github.com/lushly-dev/afd/pull/743) (`800856ad`); step 7a done
  2026-11-03 in [#744](https://github.com/lushly-dev/afd/pull/744) (`8f124810`); step 7b done
  2026-11-03 in [#745](https://github.com/lushly-dev/afd/pull/745) (`c8689ebc`); step 8 done
  2026-11-03 in [#746](https://github.com/lushly-dev/afd/pull/746) (`ab5b321d`); step 9 done
  2026-11-03 in [#747](https://github.com/lushly-dev/afd/pull/747) (`4e46de1b`); step 10, the exit, done
  2026-11-03 in the step 10 pull request (below). **Phase 3 is done: the exit criterion is met.**
  Written 2026-11-01 by the phase 3 owning agent, revised 2026-11-02 after an
  independent review. Last verified 2026-11-02 against `main` at `4a26cc0b`, by
  reading the code, scratch SQLite experiments and `pnpm verify`; no Rust built.
- **Key design review:** D82 to D85 had their own independent review on 2026-11-02,
  and the specification's key design was revised from it, in the same pull request.
- **Done:** [the specification](phases/3-memory-context/spec.md), in
  [#685](https://github.com/lushly-dev/afd/pull/685), with D68 to D89, W18, and
  amendments to the architecture's components, host services, interfaces, data,
  cross-cutting rules, library table, phase 5 prerequisites and glossary. The
  prerequisite security fix is done: `umbel batch` drops `request.context`
  ([#688](https://github.com/lushly-dev/afd/pull/688)).
- **Owner's decisions, 2026-11-02, final:** forget uses per-record keys in a
  separate key file (D82, D83); session start pushes `person` authority only, and
  `memory-confirm` promotes a memory (D78, D84); flagged memory is never pushed
  and is labeled on recall (D75); `memory-erase` is deferred to phase 5 (D85);
  hook capture stays, opt-in, user and assistant text only, always private (D79).
- **Owner's decisions after the key design's review, 2026-11-02, final and written in:**
  `memory-remember` prompts at the terminal before a record gets `person`, and declining
  writes nothing (D86); memory is excluded from Time Machine on macOS by default, with the
  file-copy limit stated (D87); `memory-confirm` takes the caller's own records only (D88);
  `memory-reindex` removes orphan keys only with `removeOrphans` (D89).
- **Step 1 done (2026-11-02, [#729](https://github.com/lushly-dev/afd/pull/729), `ed9a8539`), shapes and configuration:**
  - The seven schemas of section 2 with examples: `provenance-envelope.v2`, `event.v2`,
    `plugin-manifest.v3`, `workspace-config.v4`, `memory-record.v1`, `capture.v1` and
    `context-bundle.v1`.
  - Envelope version 2 in `umbel-store` (`Authority`, `Redaction`, `Confirmation`; a row is
    written back in its own version; `check` closes `authority` and bounds `redactions` and
    `constraints` in version 2) and in `src/provenance.rs` (the gate admits `redactions`,
    `constraints` and `authority` only from the closed set; a journal entry is read by its own
    version's rules; `confirmation` stays `null` until step 6 fills it).
  - Event version 2: `EVENT_VERSION = 2`, the envelope version 2 inside it, `changes.store`
    (`memory` only, read from version 2 entries), and `event-list` and the stream reading
    versions 0 to 2.
  - Manifest version 3, parsing only: `journal = { mode, keep }` on commands and pipelines,
    `authority_prompt` (at most 500 characters, needs `memory_write`), a `journal` required on
    every command and pipeline of a plugin declaring `memory` or `memory_write`, neither key on a
    component command or a mounted tool, `memory_write` refused beside a document write grant,
    `store-write` satisfied by `memory_write`. Stored on `CommandDecl` and `PipelineDecl`, not
    acted on.
  - Configuration version 4: `memory_write` in `deny` and `grants` (version 4 only), its table's
    `default_access`, `writers` and `agents_may_share` (`MemoryWritePolicy`), `principal.agent_env`
    and `store.exclude_memory_from_machine_backup` (default `true`); versions 1 to 3 read as 4;
    `umbel init` writes version 4 and `on_behalf_of = "local"`.
  - `memory` and `memory_write` in `GRANTS`, `memory_write` in `ALLOW_REQUIRED_GRANTS`, `memory`
    out of `RESERVED_GRANTS`; both in the new `PENDING_GRANTS`, so the load, `plugin-check` and
    the doctor refuse them with `PLUGIN_GRANT_UNAVAILABLE` ("arrives with phase 3 step 4") until
    step 4 wires them.
  - Versions: `PROVENANCE_VERSION = 2`, `EVENT_VERSION = 2`, `STORE_TRAITS_VERSION = 2`,
    `MANIFEST_VERSIONS = [1, 2, 3]`, `CONFIG_VERSION = 4`, and `MEMORY_VERSION`,
    `MEMORY_KEYS_VERSION`, `CAPTURE_VERSION` and `BUNDLE_VERSION`, all reported by
    `workspace-show`.
  - Tests: `tests/schemas.rs` extended, `tests/config_v4.rs` and `tests/manifest_v3.rs` (parsing)
    new; the version assertions of older tests moved to the new versions.
  - **Envelope version of documents and records, settled in the specification (section 2.1).**
    `document.v1.json` and `proposal.v1.json` nest envelope version 1 and D36 versions a nested
    shape with its parent, so document and record writes keep version 1 in phase 3; their
    `authority` is `null` either way. Memory writes and events use version 2, an event lifting a
    document's version 1 envelope with the three new fields null. `umbel-store`'s `check`
    accepts versions 1 and 2. A spec gap found by the step, closed by amendment as section 14
    allows; not a trust-model change.
- **Step 2 done (2026-11-03, [#733](https://github.com/lushly-dev/afd/pull/733), `b84e0bd5`), the memory trait and suite:**
  - `store/src/memory.rs` with `memory/instant.rs` and `memory/query.rs`: the `MemoryStore` trait and its
    types (5.2), and the memory query parser, with `+a b` compiled for FTS5; six new `StoreError` variants.
  - The nine memory conformance groups (5.5) over the 40-record fixture `store/fixtures/memory/records.json`,
    with `MemoryFactory` and the `MemoryRestore` hook; `samples.rs` builders.
  - `tests/memory_support/` (an in-memory store, correct or with one of eight faults),
    `tests/memory_suite_detects.rs` (the correct store passes every case but the multi-process one, which
    it skips; each fault fails the case that should catch it) and `tests/memory_query.rs`.
  - Four details of 5.2 and 5.5 settled in the specification's
    [Amendments from step 2](phases/3-memory-context/spec.md#amendments-from-step-2): separate
    `run_memory` entry points until 3a; `now`, the expiring-soon window and `Retention` passed in, since
    the store reads no clock or configuration; `confirm`'s two errors; `get` filtering by both instants.
  - Verified 2026-11-03 against `main` at `ed9a8539`: `cargo fmt --all --check`, clippy `-D warnings` on
    `umbel-store` (all targets and features) and `cargo test -p umbel-store --all-features` (31 tests in
    four suites) in `endpoints/umbel`.
- **Step 3a done (2026-11-03, [#736](https://github.com/lushly-dev/afd/pull/736), `b970994e`), the embedded memory store:**
  - `store-embedded/src/memory/`: `SqliteMemoryStore` over `state/spaces/<space>/store/memory.sqlite3`, a
    database of its own. Created with mode `0600` by the first write only (a read of a store not yet
    provisioned answers `NotProvisioned` and creates nothing); WAL, `synchronous=FULL`, `secure_delete=ON`,
    the lock timeout and macOS `fullfsync` set on every connection; the schema of 5.3 with an ordinary FTS5
    table, its `secure-delete` set by the `INSERT` form; `user_version = 1` and a newer one refused; a
    `store_id` written last in provisioning.
  - Every read filters by reader, intervals, expiry, flags, scope, class, tags, authority and the push rule
    inside its own statement; recall is one FTS5 statement ranked by `bm25(3, 2, 1)` at four places, then
    `recordedAt` and id, with the query compiled by `MemoryQuery::fts5`.
  - Writes: replay, erased prefixes, observe or create, supersede, and the quota inside one
    `BEGIN IMMEDIATE`; the purge before a write (at most 16) in a transaction of its own; `invalidate`
    and `confirm` closing versions; forget, sweep and `reindex`. Every erasure is followed by an FTS5
    index `rebuild` in a transaction of its own, then a `TRUNCATE` checkpoint outside any transaction.
  - The sealed columns go through one seam, `memory/seal.rs`, which stores them unsealed until 3b; until
    then `key_status` answers a matching key file, `backup` refuses, and a busy forget checkpoint answers
    `wal: Pending` with no marker to retry it.
  - The suite: `Stores` gains `memory` and `memory_restore`, `run_all` runs the memory groups, and the
    writer child writes memory records on `ENV_KIND`. New tests: `memory_conformance.rs` (the memory
    groups on the store alone: 43 pass, the backup copy case skipped), `memory_multiprocess.rs` (8),
    `memory_erasure_bytes.rs` (8) and `memory_sqlite.rs` (11), which repeats the specification's SQLite
    experiments on the bundled 3.54.1.
  - Seven details settled in the specification's
    [Amendments from step 3a](phases/3-memory-context/spec.md#amendments-from-step-3a). The experiments
    found that FTS5's `secure-delete` can leave a forgotten token **whole** in `records_fts_idx` as a page
    separator, and that `optimize` does nothing on a one-segment index. So forget, the purge before a write
    and sweep rebuild the index after the erasure commits, and no forgotten token or prefix stays on disk;
    the stated limits of 5.4 and 7.2 are unchanged. Cost: 20 to 23 ms per forget on 3000 records, 34 to
    38 ms on 10 000 (debug build, macOS, `fullfsync`). A busy rebuild answers `wal: Pending`.
  - The `knowledge` job's commands already run the new test binaries, so `umbel.yml` changed only in a
    comment, and `scripts/affected/suites.mjs` not at all.
- **Step 3b, sealing and the key file, done 2026-11-03 in [#737](https://github.com/lushly-dev/afd/pull/737) (`8d51ee13`):**
  - `chacha20poly1305` 0.11.0 (`default-features = false`, `alloc`, `getrandom`, `zeroize`; adds `aead`,
    `cipher`, `inout`, `poly1305` and `universal-hash` to the lock) and `libc` 0.2.191 as a macOS-only
    dependency. The lock also re-resolved `getrandom` 0.3.4 to 0.4.3 for `afd`, the host and `tempfile`,
    and `windows-sys` 0.59 to 0.61.2 in seven places; `afd` and the host accept both `getrandom` versions.
  - `memory/seal.rs`: XChaCha20-Poly1305 under each record's own 32-byte key, a 24-byte nonce per seal,
    blob `0x01 ‖ nonce ‖ ciphertext and tag`, the associated data of 5.4; keys, nonces and the store id
    from the operating system; 3a's unsealed form is gone, and every `sealed` column still goes through it.
  - `memory/keys.rs`: `memory.keys` (rollback journal, `secure_delete=ON`, `synchronous=EXTRA`, `UMBK`,
    mode `0600`), created through a temporary file and a rename at provisioning or adopted from a process
    that died before its `store_id` committed; destroyed markers with their kinds; lookups in one
    `SELECT`; settle; orphan removal.
  - Forget in 5.4's order with the erasure point in the key file, a `wal: Pending` answer after it,
    purges with kind `purge`, roll-forward at the start of every writer (never a read), which repeats the
    index rebuild and the checkpoint before settling; every crash point of 7.4 and `UMBEL_TEST_FAIL_AT`
    under a new `testkit` feature; every missing-key error; `reindex` dropping marked rows and counting
    orphans, removing them only with `removeOrphans`; `backup` through `ATTACH`; the rebuild on open of a
    restored copy; `key_status`; `memory_restore` in the tests, so the erasure group's copy case runs and
    nothing in the suite is skipped.
  - `memory/exclusion.rs`: the Time Machine attribute through `libc`, the crate's only `unsafe` code
    (its `unsafe_code` lint is `deny`, as `sdk`'s is), set at provisioning and on a writer's open, removed
    with the setting off; `SqliteMemoryStore::with_machine_backup_exclusion` and
    `is_excluded_from_machine_backup` for the host and doctor of step 4.
  - **Cost, `release` profile, development Mac, `fullfsync` on:** about 20 ms per write of one record (two
    durable commits: the key file's, then the memory database's), 1.3 ms per recall of 10 or 50 hits on
    1000 records and 3.2 to 3.4 ms on 3000, 37 µs per `get`, and 43 to 53 ms per forget on 3000 records
    (the index rebuild about 9 ms of it).
  - New tests: `memory_seal.rs` (5), `memory_keyfile.rs` (20, with two child-process helpers),
    `memory_backup.rs` (8), `memory_machine_backup.rs` (5 on macOS, 1 elsewhere); `memory_erasure_bytes.rs`
    grew to 11 with markers, retries, destroyed keys and `memory-reindex`; `memory_conformance.rs` now passes
    all 44 memory cases and `conformance.rs` skips nothing.
  - Ten details settled in the specification's
    [Amendments from step 3b](phases/3-memory-context/spec.md#amendments-from-step-3b), none changing
    access, authority, forget's guarantees or the trust model.
  - `umbel.yml`'s `knowledge` job already runs these binaries, and its daily macOS leg runs
    `memory_machine_backup.rs`; only its comment changed. Verified locally on macOS only: `cargo fmt --all
    --check`, clippy `-D warnings` on the store crates (all targets and features) and on the workspace
    without `umbel-store-embedded`, and `cargo test -p umbel-store -p umbel-store-embedded --all-features`.
- **Step 4, host services and the journal digest, done 2026-11-03 in [#740](https://github.com/lushly-dev/afd/pull/740) (`d945bbbf`):**
  - **The grants.** `memory` and `memory_write` are available to compiled plugins (`PENDING_GRANTS` is
    empty; components and mounts still get `PLUGIN_GRANT_UNAVAILABLE`, naming world 1.1.0).
    `src/plugins/memory_services.rs` serves section 6: reads under the caller's reader filter, with
    `memory_head` the highest readable revision and `memory_key_file` the file's state alone; writes under
    the `allow` list, with the host filling identity and authority (3.3), setting the access set from
    `share` and the grant's policy (3.2, a capture always private), unioning `umbel-scan`'s findings into
    `flags`, capping the quota and the TTL, and checking 6.3's authority and ownership for invalidate,
    supersede, confirm and forget. The host's `store-embedded` feature now enables `umbel-scan`. A memory
    read opens only the memory store, so it creates no file.
  - **SDK.** `HostServices`, `Cx` and `SpaceCx` gain the sixteen memory methods (defaulting to
    `NotGranted`), with `MemoryPath`, `MemoryWriteRequest` and `LeftOutQuery`; `HostError` gains
    `QuotaExceeded`, `NotProvisioned`, `KeysMissing`, `KeysMismatch`, `KeyAbsent` and `SealInvalid`.
  - **Ledger and gate.** Memory revisions are recorded apart and stamped `changes` with `store: "memory"`;
    a successful call of a plugin holding `memory_write` that wrote none is marked `dev.umbel/no-change`,
    and the event stamp then makes no event; such a plugin's event has `sources`, `contentHash`,
    `derivedFrom`, `constraints` and `generated` nulled.
  - **Digest journaling** (`src/host/digest.rs`): the recorder's `with_redact` reduces the entry of every
    command declared `digest` and every pipeline with a digest step, on every route, stamping
    `dev.umbel/replay: "recorded"` itself; a pipeline passing a digest step's output to a plain step is
    `PLUGIN_MANIFEST_INVALID` at seal, and a pipeline inherits its steps' `authority_prompt`s in step order.
  - **Authority at the CLI** (`src/authority.rs`, `src/cli/`): `dev.umbel/human-present` only for a person
    at a terminal (stdin and stderr terminals, no `@-`, no `--yes` or `--approve`, no agent variable from
    the built-in three or `principal.agent_env`); the `authority_prompt` asked only then, after any
    `confirm_prompt` and whatever `mcp.confirmations` says, a yes setting both marks, a no
    `CONFIRMATION_DECLINED` with nothing written or journaled. `@-` reads one JSON object from stdin, up to
    16 MiB (`INPUT_TOO_LARGE`), and a `require-human` command refuses it. `UMBEL_TEST_CLOCK` and
    `UMBEL_TEST_HUMAN_PRESENT` exist only under `testkit`.
  - **Stores and doctor.** `store-show` gains `memory`; `store-check` checks the memory store and its key
    file (integrity of both, the lexical lane, access tables, rows that do not open, markers, orphans,
    the journal cross-check) after its checkpoint; `store-backup` writes the stripped memory copy with
    `memoryKeys` and `memoryFts` `"excluded"` in the manifest and the warning `MEMORY_KEYS_NOT_BACKED_UP`;
    `store.open`'s suggestion now tells the deployer to keep `memory.sqlite3` and `memory.keys`. The doctor
    adds `stores.memory`, `stores.memory_keys`, `stores.memory_modes`, `stores.memory_backup`,
    `stores.principals`, `stores.sweep` and `stores.capture`. `umbel-store-embedded` gains the read-only
    `SqliteMemoryStore::check`, `maintenance`, `change_traces` and `keys_integrity_check` for them.
  - **README:** the access section gains memory's paragraph (authority, private by default, digest
    journaling, the key file's limits, Time Machine).
  - New tests: `memory_grants.rs` (17), `journal_digest.rs` (2), `cli_authority_prompt.rs` (7),
    `cli_stdin_input.rs` (4); `manifest_v3.rs` grew to 12 (the catalog, the seal refusal, the inheritance),
    `store_commands.rs` by 4, `doctor_stores.rs` by 4, `doctor.rs` and `config_v4.rs` updated; unit tests for
    the authority table, the digest, the ledger, the quota ceilings, the capture check and the prompt.
  - Twelve details settled in the specification's
    [Amendments from step 4](phases/3-memory-context/spec.md#amendments-from-step-4), none weakening access
    or authority; the twelfth makes `authority` and `confirmation` host-owned in every event envelope of
    version 2, so a plugin can no longer claim `person` in an event. The step was not split: about 3 500 lines of non-test code, unit tests included.
  - The plugin-isolation job's `Plugin-isolation-exempt:` line is not needed: this step changes no plugin
    crate.
- **Step 5, the memory plugin's writing side, done 2026-11-03 in [#742](https://github.com/lushly-dev/afd/pull/742) (`0e3a501a`):**
  - **The crate** `plugins/memory` (`umbel-plugin-memory`, compiled, `publish = false`, quarantined in
    `scripts/release/inventory.json` and listed in `architecture.json`): manifest version 3 with the grants
    `packs`, `clock`, `random`, `memory` and `memory_write`, every command journaled (`memory-remember`,
    `memory-capture` and `memory-show` as digests with 8.1's kept keys, `memory-status` plain); the packs
    `policy` (8.11's lifetimes, expiring-soon window and quota) and `hygiene` (nine ordered patterns for
    8.2's eight secret kinds); the skill `memory-guide`, with the extraction schema and prompt for the calling model;
    and the `umbel-memory` binary, the command line with the plugin compiled in. No new dependency: `regex`,
    `sha2`, `toml` and `chrono` were in the lock.
  - **The write pipeline** (8.2), one for remember and capture: shape (caps, one-line fields, labels refused
    when the hygiene pack would mask them), secrets masked before anything is stored or hashed with counts by
    kind in `redactions`, the `umbel-scan` flags, the content hash, expiry by the class's default and maximum.
  - **Commands.** `memory-remember` (first-class, with D86's `authority_prompt`): observe, renew, supersede,
    idempotency, `SECRETS_MASKED` and `CONTENT_FLAGGED`, a result with no text. `memory-capture`: the capture
    contract version 1 mapped as 10.1 says, always private, `CAPTURE_TOO_LARGE` refusing the whole call, a
    `captureId` a replay repeats. `memory-show`: the record, its 4.2 state and its history, one
    `MEMORY_NOT_FOUND` for every absence. `memory-status`: counts by class and state, usage against the
    quota, the key file's state and `pushable`. Each write's event names the record (or the capture) with its
    access and session and no text.
  - **Host changes, minimal** (the pull request needs a `Plugin-isolation-exempt:` line):
    `src/plugins/memory_services.rs` keeps a renewal only for `person`, fills a default `origin` by the
    authority, and checks a supersede's project and access set (`MEMORY_SCOPE_MISMATCH`); `src/host/digest.rs`
    keeps no input value for a failed digest call, so a refused secret-like label never reaches the journal.
    The SDK's `Outcome` gains `with_retryable` and `with_error_details`, for the quota's `retryAfterMs`.
  - **CI.** `umbel.yml` gains the `memory` job (clippy, tests and an MSRV check of the crate, with the
    `knowledge` job's gating, matrix and timeout), and the `check` job's tests exclude the crate.
    `scripts/affected/suites.mjs` is unchanged: its local `cargo test --workspace` already runs the crate.
  - New tests: in the plugin, `remember.rs` (15), `capture.rs` (8), `hygiene.rs` (6), `quota.rs` (6),
    `events.rs` (4), `process.rs` (1) and 11 unit tests; in the host, `memory_grants.rs` grew to 20 (renewal and
    origin by authority, the supersede scope check, a failed digest call) and the SDK gained one unit test.
  - Thirteen details settled in the specification's
    [Amendments from step 5](phases/3-memory-context/spec.md#amendments-from-step-5), none weakening access
    or authority; items 1, 2 and 4 are narrower than the text.
- **Step 6, the memory plugin's reading and lifecycle commands, done 2026-11-03 in [#743](https://github.com/lushly-dev/afd/pull/743) (`800856ad`):**
  - **Commands**, in `plugins/memory`: `memory-recall` (8.4: the query parser's forms, every filter and
    project rule, flagged hits with their label, concise and detailed hits, AFD `sources` with no `url`,
    hits dropped to fit the budget) and `memory-list` (8.5: the same filters, newest first, a cursor that
    resumes after what the budget dropped); `memory-invalidate` (8.6, the note masked and scanned);
    `memory-confirm` (8.7, D88: `require-human` with the fixed prompt and its project-less warning, the
    command line only, own records only, the contentHash memory-show printed, each refusal named);
    `memory-forget` (7.2 to 7.4: by ids, or by session, project or time for a person, with 5.4's limits as
    a fixed suggestion and `MEMORY_ERASURE_PENDING`); `memory-sweep` and `memory-reindex` (8.8, D89: the
    command line only, journaled plain, orphans removed only with `removeOrphans`). Every read carries
    `UNVERIFIED_CONTENT`, `CONTENT_FLAGGED`, `MEMORY_UNREADABLE` and `MEMORY_HISTORY_PURGED` as 4.1 and 8.4
    say, `memory-show` included. Each lifecycle event follows 8.10's table, with no text and no ids. The
    `memory-guide` skill covers them.
  - **Host: no change.** The SDK's `Outcome` gains `with_suggestion` (a success's AFD `suggestions`), the
    one change outside the plugin; the plugin-isolation job counts only `src/`, `wit/` and `schemas/`, so it
    needs no `Plugin-isolation-exempt:` line, and the pull request names the SDK change anyway.
  - New tests: in the plugin, `recall_scope.rs` (6), `bitemporal.rs` (6), `invalidate.rs` (6), `confirm.rs`
    (5), `forget.rs` (6), `retention.rs` (7), `security.rs` (2), `events.rs` grew to 7 and `capture.rs` to 9
    (step 5's deferred capture refused under a prefix a forget erased), and 4 unit tests (15 in all); the SDK
    gained one unit test. Markers, absent key entries and orphan keys are made by putting back a file-level
    copy of `memory.sqlite3` or `memory.keys` with no connection open, so the plugin needs no new
    dependency.
  - Seven details settled in the specification's
    [Amendments from step 6](phases/3-memory-context/spec.md#amendments-from-step-6), none weakening access,
    authority or forget's guarantees.
- **Step 7a, the shared helpers, done 2026-11-03 in [#744](https://github.com/lushly-dev/afd/pull/744) (`8f124810`):**
  - **Moved to `umbel-okf`**, for the `context` plugin of step 7b (9.3, 9.5): the module
    `umbel_okf::locator` with the locator string (`string`, `short`, `parse` and `Parsed`), and
    `umbel_okf::is_stale` (in `frontmatter.rs`, beside the tier it derives, re-exported at the crate
    root). The locator object of `knowledge-search`'s detailed format stays in the knowledge plugin,
    whose `locator` module now re-exports the string's functions. `knowledge-stale`'s own copy of the
    staleness rule (`past_stale`) is replaced by `is_stale`, the same expression.
  - **Behaviour unchanged.** The functions moved as they were; `plugins/knowledge/eval/baseline.json` is
    untouched and `eval_gate.rs` holds the report to it. `umbel-okf` gains `chrono` (`std` only), the
    version and features the knowledge plugin already uses, so the lock gains one edge and no package.
  - Tests: the two locator unit tests moved with the code, with one for the short hash (10 unit tests
    in `umbel-okf`); `okf/tests/frontmatter.rs` gained two for `is_stale` (25). The knowledge plugin has
    194 tests with the `code` feature (two fewer, moved) and 167 without; the `knowledge` job's crates
    pass, `eval_gate` included.
  - The plugin-isolation job's `Plugin-isolation-exempt:` line is not needed: `okf/` and the knowledge
    plugin are not `src/`, `wit/` or `schemas/`. No amendment: the step settled nothing the text left
    open.
- **Step 7b, the `context` plugin, done 2026-11-03 in [#745](https://github.com/lushly-dev/afd/pull/745) (`c8689ebc`):**
  - **The crate** `umbel-plugin-context` (`plugins/context`, plugin `context`, compiled, domain
    `context`): one command, `context-bundle` (effect `inspect`, first-class, journaled as a digest
    keeping `space`, `project` and `session`), the `bundle` pack (shares, `max_items`,
    `per_authority_cap`, `max_item_bytes`, `secondary_weight`, `draft_factor`, stop words), the
    instance configuration (`verified_only`, `push_authorities` and `push_foreign_authorities`, both
    `["person"]` by default) and the `context-guide` skill. Grants `config`, `packs` and `clock`;
    `documents`, `index` and `memory` optional; no write grant. No binary of its own: step 8's
    `umbel-first-party` links it beside memory (D80). It depends on no plugin crate.
  - **Selection** (9.3): the task's terms with no query syntax; the knowledge lane (OR-ed one-word
    phrases, best chunk plus the next two, each document read again, deprecated and reserved files
    dropped, flagged ones counted, drafts lowered, `INDEX_STALE`); the memory lanes tier by tier
    (`person`, `tool`, `agent`, `import`, `transcript`) with `PushFilter` in every read, eight per
    tier, flagged never, `transcript` admitted for the caller's own `episodic` only, a project-less
    record reaching a named project only at `person`, and `left_out`'s `authority` and `flagged`
    counts. **The default push is the caller's and others' `person` records only.**
  - **Budget, rendering, determinism** (9.4 to 9.6): the reserve, shares redistributed from absent
    sections, the carry and the second pass, `max_items`, omissions to 64 entries and the reserve
    with `omittedMore`, the quoted block cut to `maxChars` in UTF-16 units, item text stripped, the
    whole result measured as AFD measures it; `digest` over task, `asOf`, sections and omissions.
    The keys-failed lane: every memory section `lane-unavailable` with `MEMORY_KEYS_MISSING` or
    `MEMORY_KEYS_MISMATCH`, knowledge kept, the block ending `Memory unavailable: <code>.`
  - **First-class suggestion and the `tools/list` size** (9.7): with the four first-party plugins
    the default list is the five meta-tools, `workspace-show`, `event-list`, `knowledge-search`,
    `knowledge-open`, `context-bundle` and `memory-remember`, 16 292 bytes.
  - **CI.** The `memory` job's clippy, tests and MSRV check gain `-p umbel-plugin-context`, and the
    `check` job's tests exclude it; the release inventory (quarantined, no route) and
    `architecture.json` list the crate. `scripts/affected/suites.mjs` is unchanged: its local
    `cargo test --workspace` already runs the crate.
  - **Host: no change.** `tests/default_tools.rs` is a host test that loads each plugin from its
    directory (manifest, schemas, packs, skills) with stub handlers, since the host depends on no
    plugin crate. No `Plugin-isolation-exempt:` line is needed.
  - New tests: in the plugin, `selection.rs` (12), `budget.rs` (6), `labels.rs` (4), `render.rs`
    (6), `deterministic.rs` (3), `lanes_absent.rs` (6), `no_plugin_dependency.rs` (2) and 10 unit
    tests (49 in all); in the host, `default_tools.rs` (2). The tests write documents, chunks and
    memory records through the `umbel-store` API with fixed ids and a fixed clock.
  - Fourteen details settled in the specification's
    [Amendments from step 7b](phases/3-memory-context/spec.md#amendments-from-step-7b), none
    weakening access or authority or widening the push.
- **Step 8, the first-party binary and the harness adapters, done 2026-11-03 in [#746](https://github.com/lushly-dev/afd/pull/746) (`ab5b321d`):**
  - **`umbel-first-party`** (`first-party/`): the `umbel` command line with `sources`, `knowledge`,
    `memory` and `context` compiled in, the only crate that depends on memory and context together
    (D80), with the command line and the embedded stores and no loader, so no wasmtime.
  - **`umbel-hook`** (`adapters/hook/`), a library (`umbel_hook::run`) and a binary on `serde` and
    `serde_json` alone, linking no host: `umbel-hook claude-code|generic <event> [--sweep]`, run as a
    child `$UMBEL_BIN [--workspace] --format json call <command> @-`. The `claude-code` profile maps
    `SessionStart` (startup, clear, compact) to `context-bundle` printed as `additionalContext`, and
    `Stop`, `PreCompact` and `SessionEnd` to `memory-capture` of closed windows and, for the last two,
    the open tail. The transcript reader of 10.3 takes **user and assistant text only**, in file order,
    with every excluded kind left out; windows of 20 turns, parts of at most 64 KiB with the key-block
    rule, calls of at most 800 KiB, keys by position. The state file holds offsets, counts and message
    ids, never text, so a `Stop` with no closed window reads only the new bytes and starts no process.
    The project is the repository's name, read from `.git` with no `git` process, shared by every
    worktree. **Fail-open**: every failure is exit 0, one stderr line, no output, and `last-error.json`
    (`{ at, profile, event, code, count }`, read by the doctor's `stores.capture` since step 4), which a
    success removes. `print-settings claude-code` prints the hooks fragment (timeouts 10 and 30, `Stop`
    async) and writes nothing; `status` prints the last failure. The `generic` profile forwards the
    capture contract unchanged and prints a session-start bundle plainly.
  - **The fixture** (`adapters/hook/tests/fixtures/claude-code/session.jsonl`): 165 lines, 65 text
    turns, synthetic text, a canary in each of 41 excluded lines, a `password=` secret and a planted
    injection in user turns.
  - **The structure re-check** found no local interactive CLI session with conversation (one CLI
    file, with no conversation lines), so 10.3's follow-up stays open. The 25 largest other sessions,
    read for keys, types and enum values only, confirm the rules, with three additions: a queued
    command's `isMeta` on the attachment, a list `prompt`, and wrappers dropped per text block. New
    line types that copy API requests are never read.
  - **One-shot time** (release, Apple silicon): the first `memory-capture` of a window 110 ms
    (provisioning the key file), later ones about 50 ms, a replay 25 ms, `context-bundle` 25 ms; the
    hook's whole `Stop` with three windows 169 ms, a `SessionEnd` tail 65 ms, a `Stop` with nothing
    new 20 ms. The `memory` job's clippy and tests took 120 s cold here; its timeout stays 15 minutes.
  - **CI.** The `memory` job's clippy, tests and MSRV check gain `-p umbel-first-party -p umbel-hook`;
    the `check` job's tests exclude both. The release inventory (quarantined, no route) and
    `architecture.json` list both crates, `publish = false`. `scripts/affected/suites.mjs` is
    unchanged: its local `cargo test --workspace` already runs them.
  - **Host: no change.** No `Plugin-isolation-exempt:` line is needed.
  - New tests: in the hook, `claude_code.rs` (11), `generic.rs` (3), `fail_open.rs` (6) and 5 unit
    tests; in the binary, `hook_smoke.rs` (1), the hook against the real binary. The `memory` job's
    four crates pass 172 tests.
  - Seventeen details settled in the specification's
    [Amendments from step 8](phases/3-memory-context/spec.md#amendments-from-step-8), none making
    capture non-private or on by default or capturing more than user and assistant text.
- **Step 9, import and export, done 2026-11-03 in [#747](https://github.com/lushly-dev/afd/pull/747) (`4e46de1b`):**
  - **`memory-import`** (`plugins/memory/src/import.rs`, CLI only, digest-journaled with `space`,
    `project` and `harness`): a harness's memory files as entries `{ class, subject, text, tags?, path,
    generated? }`, at most 1 MiB and 256 entries, through the write pipeline with `MemoryPath::Import`.
    The host gives every entry authority `import`, whoever calls, a person at a terminal included, and a
    private access set unless a sharing writer passes `share`. `origin` is `document-derived`, the source
    `harness:<harness>/<path>`; there is no idempotency key, so a repeat observes. The result holds ids
    and counts, never text, with the fixed suggestion that the source files stay where they were.
  - **`memory-export`** (`plugins/memory/src/export.rs`, CLI only, `inspect`, budget 64 000 and
    512 000): the caller's own live records with their text, newest first with `memory-list`'s cursor,
    never flagged, `transcript`, invalidated, expired, forgotten or another principal's, even one shared
    with the caller. Each is opened and checked again; one that does not open counts in `unreadable`,
    and one too large for the budget alone is named in `tooLarge` and passed over.
  - **`umbel-hook import <harness> <dir> [--project p] [--class c]`** reads the `*.md` files directly in
    the named directory, skipping `MEMORY.md`, `umbel-*.md`, links and subdirectories, with a small
    frontmatter reader for `name`, `description` and `type`; parts of at most 64 KiB at line boundaries,
    calls of at most 800 KiB and 256 entries, in sorted name order. **`umbel-hook export <harness> <dir>
    [--project p]`** reads every page first, then writes `umbel-<id>.md` (`0600`, by rename, with the
    unverified header of 10.5) and `umbel-index.md`, removes the `umbel-mem-*.md` files of records no
    longer exported, never touches `MEMORY.md` or any other file, and prints the line to add to it. Both
    are a person's commands: a failure exits 1 and records nothing in the state directory.
  - **Host: no change.** `MemoryPath::Import` already gave `import` and the access rule of 3.2. No
    `Plugin-isolation-exempt:` line is needed.
  - New tests: in the plugin, `import_export.rs` (9) and 1 unit test; in the hook, `import_export.rs`
    (6) and 6 unit tests; in the binary, `import_export.rs` (1), the round trip with a forgotten record
    through the real binary.
  - Seven details settled in the specification's
    [Amendments from step 9](phases/3-memory-context/spec.md#amendments-from-step-9), none raising an
    import's authority or exporting more than the caller's own live, unflagged, non-transcript records.
- **Step 10, the exit, done 2026-11-03 in the step 10 pull request:**
  - **`first-party/tests/exit_memory.rs`** (1 test, about 6.5 seconds in a debug build) runs the
    exit criterion of [section 12](phases/3-memory-context/spec.md#12-exit-criterion-and-tests) on
    the committed Claude Code fixture, the real `umbel-first-party` binary as a child process
    (`umbel-hook` through `umbel_hook::run`), spaces `alpha` and `beta`, the `testkit` build's frozen
    clock and person at a terminal, and 40 documents indexed with `knowledge-refresh`. It writes a
    report of each point's numbers to `UMBEL_EXIT_REPORT`, which the `memory` job sets and uploads
    (`memory-exit-report-<os>`), as the `knowledge` job does phase 2's.
  - **`first-party/tests/leak_probes.rs`** (1 test, 14 probe groups), **`poisoning.rs`** (6) and
    **`forget_bytes.rs`** (3), with a shared `tests/support/` (library actors with all four
    plugins, the in-process command line with a scripted terminal, the binary and its stdio MCP
    server, the probes, and stores written through the `umbel-store` API).
  - **Host: no change**, and no plugin or adapter change: the exit tests found no defect in the
    implementation. No `Plugin-isolation-exempt:` line is needed. `umbel-first-party` gains
    dev-dependencies already in the lock (`afd`, `jsonschema`, `rusqlite`, `umbel` with `testkit`,
    `umbel-store` with `conformance`, `umbel-store-embedded`); `Cargo.lock` gains only those edges.
  - The `memory` job's four crates pass 206 tests in 41 suites (172 at step 8; step 9 added 23;
    these 11). `umbel.yml`'s `memory` job sets `UMBEL_EXIT_REPORT` and uploads the report.
  - Eleven details settled in the specification's
    [Amendments from step 10](phases/3-memory-context/spec.md#amendments-from-step-10); the first,
    that a person reading another's shared record may invalidate it as 6.3 already says, is raised for
    the owner as a follow-up.
- **Exit criterion** (2026-11-03, the step 10 branch from `main` at `4e46de1b`, in `endpoints/umbel`
  with its own `CARGO_TARGET_DIR`, debug build, on the development Mac). Each point, from the report:
  1. **A harness hook captures a session.** `Stop` then `SessionEnd` exit 0 with no `last-error.json`;
     `memory-list` shows 4 episodic records, authority `transcript`, access `principal:human:ada`,
     session and project (`example`, from the repository's `.git`) set; none holds any of the
     fixture's 41 excluded canaries; the secret is masked in one window with 1 redaction counted; one
     window is flagged. 4 capture calls made 4 events, holding no text; the same hooks again created
     nothing and added no event.
  2. **Recall by scope.** `zebrollback` finds the three `zebrollbacks` facts in `alpha` and none in
     `beta`; `project` narrows to 2 and `projectOnly` to 1; the flagged window comes back with its
     flags and `CONTENT_FLAGGED`.
  3. **Bitemporal queries.** A fact remembered, superseded and invalidated, on clocks an hour apart,
     answers the four questions of 4.1 in six queries: nothing now; the first as believed between the
     writes; the first and then the second by valid time; both instants together, either one.
  4. **A budgeted bundle with omissions.** `SessionStart` through the hook printed valid hook JSON,
     2128 characters, with a `Left out` line, the person's five facts and not the agent's note (written
     over the binary's stdio MCP server, authority `agent`). `context-bundle` with a task and
     `maxBytes = 4000` measured 3941 bytes by AFD (`dev.afd/outputBudget`), sections `knowledge` then
     `semantic`, every item with provenance and a verification label, 26 `budget` omissions,
     `authority` 2 (the captured decision and the note) and `flagged` 1, valid against
     `context-bundle.v1.json`. After `memory-confirm` at the terminal the note is pushed with its
     `confirmation` (`priorAuthority: agent`) and `authority` is 1.
  5. **Leak probes pass**: all 14 groups of `leak_probes.rs` on the exit's own stores, through
     library actors.
  6. **Deterministic bundles.** Two processes on the frozen clock returned byte-identical `data`
     (13 782 bytes); two stores written through the store API in two orders gave equal digests and
     sections for three queries, on a rebuilt index.
  7. **Forget holds.** After `store-backup` and `memory-forget` (a fact by id, the session by
     selector, 5 records) no canary is in any file of the workspace, the journal, the events or the
     backup, and the bundle omits the fact; the backup restored beside the current key file answers
     `MEMORY_NOT_FOUND` for all 5 and its rebuilt index holds no canary; the hook run again from the
     transcript's first line, and a capture under the window's key, create nothing (refused 1);
     without `memory.keys`, recall and list answer `MEMORY_KEYS_MISSING`, the doctor's
     `stores.memory_keys` fails naming it, and `context-bundle` keeps its knowledge with the warning
     and the `Memory unavailable: MEMORY_KEYS_MISSING.` line.
  - **Local checks:** `cargo fmt --all --check`; `cargo clippy --locked -j4 --workspace --exclude
    umbel-store-embedded --all-targets -- -D warnings`; the `memory` job's clippy and tests as
    `umbel.yml` runs them (206 passed, 0 failed); `node scripts/run-tooling-tests.mjs`. Not run here:
    the `memory` job's MSRV 1.97 check (1.97 is not installed on this machine) and the full
    workspace test. **Full `pnpm verify` re-run, 2026-11-03 on the owner's Mac, `main` at `4e46de1b` plus
    step 10:** Loam's build and `test:mounted` (13 tests); `cargo fmt`; workspace clippy; the
    wasm32-wasip2 components and `hello-mcp`; `cargo test --locked --workspace --exclude
    umbel-store-embedded` (153 suites, 0 failed, the four exit tests among them); then, after the disk
    guard stopped the run under 5 GB free and the build directory was cleared, the store crates' clippy
    and tests (21 suites, 0 failed) and the todo conformance runs against `umbel-todo` (34/34 in each
    mode, confirmations 5/5, mounted 34/34 in each mode) and the external clients, all passing. The
    hosted `umbel.yml` legs ran on the step 10 pull request; macOS and MSRV run in the daily schedule.
- **Not done:** nothing in phase 3's plan. Open and recorded as follow-ups: the specification's
  [list](phases/3-memory-context/spec.md#follow-ups), including measuring whether labels, quoting or
  the scan protect a pushed record, the interactive CLI transcript re-check, and the step 10 question
  on a sharing writer changing another's shared record (answered 2026-11-04 by phase 5 decision 10, D119). There is no AFD step 0: the journal's
  `with_redact` already exists.
- **Next:** the phase 4 (curator) specification, which phase 3's exit unblocks, then the phase 5
  and phase 6 specifications. Each gets an independent review, a revision and the owner's approval
  (D24). Heavy steps follow the plan's build note.
- **Waiting on the owner:** nothing. These four are decided; do not ask again.
- **Follow-ups:** the [specification's list](phases/3-memory-context/spec.md#follow-ups).

#### Handoff, 2026-11-02: resume here

The session driving this epic ended here because its account ran out of capacity. The
epic is every phase in the table above, then further first-class plugins.

**Immediate work (done: the follow-up merged in [#723](https://github.com/lushly-dev/afd/pull/723) as `a92c5bd7`, and step 1 in [#729](https://github.com/lushly-dev/afd/pull/729)): merge the follow-up to [#685](https://github.com/lushly-dev/afd/pull/685)** on green.
#685 merged on 2026-11-02 as `e4c91f30`, from `3c30f48f`, before the four items decided after the key
design's review were written in. The follow-up writes them into the specification's body, tests, plan
and the decision log as D86 to D89. Item 1's design, the remember prompt, reuses the CLI's existing
prompt and the host-owned `dev.umbel/human-confirmed` mark, adds no new trust assumption, and stays
"not an attestation", so no third review was run.

**Then, in order:**

| Work | Notes |
| --- | --- |
| Phase 3 implementation | Done 2026-11-03: plan steps 1 to 10, the last in the step 10 pull request; exit criterion met |
| Phase 4, curator | **Done 2026-11-03: exit criterion met**, steps 1 to 7, the last in the step 7 pull request (see Phase 4 below). Before that: **specification approved 2026-11-03** ([spec](phases/4-curator/spec.md)) and merged in [#749](https://github.com/lushly-dev/afd/pull/749), with the owner's answers to its ten questions (attest and verify on 10); steps 1 (shapes), 2 (host), 3a (knowledge: record and journal), 3b (knowledge: the drafted path), 3c (knowledge: verifying drafts) and 4 (curator: candidates) merged 2026-11-03 in [#751](https://github.com/lushly-dev/afd/pull/751), [#753](https://github.com/lushly-dev/afd/pull/753), [#754](https://github.com/lushly-dev/afd/pull/754), [#763](https://github.com/lushly-dev/afd/pull/763), [#765](https://github.com/lushly-dev/afd/pull/765) and [#767](https://github.com/lushly-dev/afd/pull/767); step 5 (curator: runs) and step 6 (auto-approval) merged 2026-11-03 in [#768](https://github.com/lushly-dev/afd/pull/768) and [#770](https://github.com/lushly-dev/afd/pull/770) |
| Phase 5, auth and hosted | **Specification approved 2026-11-04** ([spec](phases/5-auth-hosted/spec.md)) with the owner's answers to its seventeen questions, after an independent review and a revision; **step 0a done 2026-11-07** (the AFD spec); **step 0b done 2026-11-07** (AFD's Rust `server-auth`); **step 0c done 2026-11-07** ([#532](https://github.com/lushly-dev/afd/issues/532) in three languages); **step 0d done 2026-11-07** (AFD's Rust relay); **step 0e done 2026-11-07** (AFD's Rust tasks; the AFD prerequisites 0a to 0e are complete); **steps 1 and 1b next**. Before that: **Next:** its specification, with an independent review, a revision and the owner's answers (D24); the D86 to D89 follow-up it waited on merged in [#723](https://github.com/lushly-dev/afd/pull/723). Includes `memory-erase`, [#532](https://github.com/lushly-dev/afd/issues/532), partitioned BM25 statistics, token verification, `credentials`, Tasks, the dynamic confirmation prompt, real proof of a person, and the Rust MCP approval relay with Umbel's use of it (phase 4's owner decision 2, D99) |
| Phase 6, backends | **Next**, beside phase 5: its specification, with an independent review, a revision and the owner's answers (D24) |
| Phase 7, distribution and guides | Needs phases 5 and 6 (phase 4 done 2026-11-03) |
| Further first-class plugins | content-design; federation needs O1 from the owner |

**Rules the owner set for this epic:** commit, open pull requests, auto-fix and merge on
green between phases without asking. Each phase specification gets an independent review,
then a revision, then merge, recorded here as approved under the owner's 2026-10-31
delegation. **Still ask the owner about:** publishing, tagging, unquarantining or merging a
release pull request; O1; anything that changes the trust model. Do not name the private
reference system in code or documents; all knowledge content is deployer-provided. Run
`pnpm verify` before the first push; never `--no-verify` or `--admin`.

**Shared Mac:** heavy gates only under one-minute load 20, `cargo -j4`, Vitest 1 worker; stop
under 5 GB free. Give each concurrent Rust agent its own `CARGO_TARGET_DIR`
(`~/.cache/umbel-target-<step>`, deleted after merge) with `CARGO_INCREMENTAL=0`, and export
it for `pnpm verify` too. Never stop other owners' jobs, or clear their build output.

**Known traps:** commitlint has no `umbel` scope and rejects `wip`. The local branch
`lush/umbel-phase-3-memory-spec` is held at an old commit by worktree `t3-08b48631`, so work
on another local branch and push to that remote name.

### Phase 4. Curator

- **State:** specification approved 2026-11-03, under the owner's 2026-10-31 delegation, with the owner's
  answers of 2026-11-03 (D24), after an independent review and a revision, and merged in
  [#749](https://github.com/lushly-dev/afd/pull/749) as `4a9462c0`; step 1 done 2026-11-03 in
  [#751](https://github.com/lushly-dev/afd/pull/751), merge commit `e7aeff70`; step 2 done 2026-11-03 in
  [#753](https://github.com/lushly-dev/afd/pull/753), merge commit `83639abb`; step 3a done 2026-11-03 in
  [#754](https://github.com/lushly-dev/afd/pull/754), merge commit `37af26c9`; step 3b done 2026-11-03 in
  [#763](https://github.com/lushly-dev/afd/pull/763), merge commit `4a6b2de4`; step 3c done 2026-11-03 in
  [#765](https://github.com/lushly-dev/afd/pull/765), merge commit `7e52e337`; step 4 done 2026-11-03 in
  [#767](https://github.com/lushly-dev/afd/pull/767), merge commit `0d46a9a0`; step 5 done 2026-11-03 in
  [#768](https://github.com/lushly-dev/afd/pull/768), merge commit `9ea18e73`; step 6 done 2026-11-03 in
  [#770](https://github.com/lushly-dev/afd/pull/770), merge commit `6e1c0a0a`; step 7 done 2026-11-03 in its pull
  request, and with it **phase 4 is done: the exit criterion is met** (below). Last verified 2026-11-03 against
  `main` at `6e1c0a0a` with step 7's scoped tests, clippy and the tooling tests on the owner's Mac (below).
- **Done:** [the specification](phases/4-curator/spec.md), with D90 to D105 and amendments to the
  architecture's curator component row, proposal and manifest interfaces, phase table (proposal record
  version 2), phase specification list, phase 5 row and prerequisites table (the MCP relay moved to phase 5),
  versioning list and glossary; and every step of its plan, 1 to 7 (below), the last meeting the exit criterion.
- **Findings that shaped it:** `proposal.v1.json` is closed with `policy.rule` constant `person`, so the
  curator's fields need proposal record version 2; records are namespaced per plugin instance, so the
  curator reaches proposals through a pipeline it ships as data, attested by a host table keyed by random
  step trace ids; every pipeline was registered on every surface and returned every step's data, hence
  D105; the CLI is always `human:<local_id>`, so authorship of a draft comes from its sources; memory is
  private by default, so drafting it for a shared collection would disclose it before approval.
- **Review, 2026-11-03:** an independent review raised 33 findings (blockers: `curator-run` listed over MCP;
  forgotten memory surviving in content-derived ids, paths, keys and hashes). Each was checked against the
  code: 31 hold and were fixed, 2 hold in part; the spec's Review response table records each.
- **Owner's decisions, 2026-11-03, final; do not ask again** (spec section 16: the recommended option on 1 to 9,
  and "attest and verify" on 10, corrected by the owner before commit from "attest and trust"):
  1. Auto-approval: one narrow rule, `deprecate-declared`, off by default per area, only on bytes an applied
     proposal wrote, never for content (D98).
  2. No MCP approval relay in phase 4; the Rust relay and Umbel's use of it move to phase 5 (D99).
  3. No model (D100).
  4. Memory is read only under the caller's reader filter; no derivation reads (D101).
  5. Private records are widened only by their owner at a terminal, with `curator-promote` (D94).
  6. Self-approval of a draft compares the approver with `promotedBy` and every source's principal (D102).
  7. A forgotten source withdraws and redacts an open draft; knowledge holds `memory`, read only, so approve
     refuses a proposal whose source is gone (D103).
  8. The curator never writes memory (D104).
  9. Only `person` authority settles by default; a pack may widen it to `agent`, `tool` or `import`, never
     `transcript` (D93).
  10. Attest and verify: the host attests a step's drafter, and the knowledge plugin verifies every claim of a
      listed drafter against the memory store and the shared rendering, refusing a mismatch with
      `PROPOSAL_DRAFT_MISMATCH`; what cannot be verified is stated in the spec's 3.2 (D91).
- **Step 1 done (2026-11-03, merged in [#751](https://github.com/lushly-dev/afd/pull/751) as `e7aeff70`), shapes:**
  - The four schemas of section 2 with examples: `proposal.v2` (6 examples: drafted, applied, promoted, redacted,
    policy, withdrawn), `plugin-manifest.v4` (2: every key, none), `curator-record.v1` (7: the four kinds, with an
    erased and a rejected candidate and a held lock) and `curator-report.v1` (2). Each is closed; the proposal's
    conditionals hold what a drafter attests (memory evidence, a memory `derivedFrom`, a `conflictSet`, a drafter's
    withdrawal need a `drafter`), the state and withdrawal rules, decision channels, and what a redaction leaves.
  - Manifest version 4, parsing and validation only, in `src/plugins/manifest/v4.rs`: `confirm_preview` (needs
    `confirm_prompt`; names an `inspect` command of the same plugin with CLI exposure, a `journal`, no prompt or
    approval of its own, `returns` exactly `{ preview: string }` closed, and only input properties the gated command
    declares; schemas in files are checked at load), refused on component commands, mounted tools and pipelines;
    a pipeline's `expose` (`mcp`, `agent`, `cli`, a command's defaults, no `palette`) and `result` (`steps` or
    `last`). Stored on `CommandDecl.confirm_preview`, `PipelineDecl.expose` and `PipelineDecl.result`
    (`PipelineResult`); versions 1 to 3 refuse the keys and keep every pipeline exposed everywhere with every
    step's data. Nothing acts on them: the seal check of a pipeline's exposure and `result` in the handler are step 2's.
  - Versions: `MANIFEST_VERSION = 4`, `MANIFEST_VERSIONS = [1, 2, 3, 4]`, `PROPOSAL_VERSION = 2` (the newest; the
    knowledge plugin still writes version 1 until step 3a) with `PROPOSAL_VERSIONS = [1, 2]`, and `CURATOR_VERSION =
    1`; `workspace-show` reports `manifest` `[1, 2, 3, 4]`, `proposal` `[1, 2]` and `curator` 1. The
    unsupported-version message names "manifest versions 1 to 4".
  - `spec/plugin-manifest.md`'s P3 lists `confirm_preview`, and a pipeline's `expose` and `result`, as Umbel's from
    manifest version 4, and `scripts/plugin-manifest.test.mjs` expects them from version 4 on. Because `spec/`
    changed, the affected scope is wider than Umbel.
  - Tests: `tests/manifest_v4.rs` (14 tests) and `tests/schemas.rs` extended through `tests/schemas/phase4.rs` (10
    tests; 47 in the suite). Older tests updated for the version bump: `manifest.rs`, `manifest_v2.rs` and
    `manifest_v3.rs` (version 5 is now the unsupported one, "versions 1 to 4", `set manifest_version = 4`),
    `access_filter.rs` and `plugin_commands.rs` (`workspace-show`'s versions).
  - Fourteen [amendments](phases/4-curator/spec.md#amendments-from-step-1), none touching the trust model; among
    them a candidate's `subjectKey` kept as a digest and the consent record removed after a forget, so no curator
    record keeps memory text or an erased source's hash, and the envelope's `contentHash` redacted with `changeHash`.
  - No plugin changed, so no `Plugin-isolation-exempt:` line is needed. `manifest.rs` was already over 1,000 lines
    (2,021) before this step; version 4's code went into the new `manifest/v4.rs` (224 lines), and `manifest.rs`
    grew by 34 lines to 2,055 for the struct fields and the shared versioned-keys helper.
- **Step 2 done (2026-11-03, merged in [#753](https://github.com/lushly-dev/afd/pull/753) as `83639abb`), host:**
  - Pipeline attestation (section 10.1, D91), in the new `src/plugins/attestation.rs`. A pipeline's handler gives
    each step a fresh random 128-bit trace id from the operating system's random source, never the clock, in
    place of AFD's predictable `<pipeline id>-step-<i>`. It records `{ plugin, instance, pipeline, run, command }`
    in the host's `PipelineAttestations` table, keyed by that trace id, and a guard removes the entry when the step
    returns, fails, panics or is cancelled. `CallServices::pipeline()` reads it only for the call's own trace id,
    only for the command the entry names and only for one of the instance's own commands; nothing is read from
    `extra`. The SDK's `CallContext.pipeline: Option<PipelineAttestation>` is filled from it for compiled
    plugins. Components (WIT world 1.0.0 unchanged) and mounted servers never see it.
  - A manifest version 4 pipeline is registered with its own `expose`. At seal, one exposed to an interface that a
    step is not exposed to is `PLUGIN_MANIFEST_INVALID` at `pipelines[i].expose`, naming the interface and the step.
    Versions 1 to 3 keep every surface, unchecked, so `knowledge-refresh` is unchanged. `result = "last"` returns,
    and journals in the pipeline's own entry, only the last step's data.
  - The CLI's confirmation preview (section 8.1, D97), in the new `src/cli/preview.rs`. Before the gated prompt the
    CLI runs the `confirm_preview` command with only its declared properties, under a fresh trace id, without the
    marks. At a terminal it shows the text on stderr through a new `Console::show`: each line prefixed `> `,
    sanitised (controls, U+2028, U+2029, bidirectional controls), capped at 6000 characters with
    `(N lines not shown)`. A failed or misshapen preview refuses with `CONFIRMATION_PREVIEW_FAILED` and nothing
    runs. Nothing changes on MCP.
  - `secure_delete=ON` on every `store.sqlite3` connection, with `StoreInfo.secure_delete`. A new
    `SqliteStore::truncate_wal()` runs `wal_checkpoint(TRUNCATE)` with no lock wait and reports
    `WalCheckpoint::Clean` or `Pending`; the trait's best-effort checkpoint is unchanged.
  - Tests: `tests/pipeline_attestation.rs` (6), `tests/pipeline_expose.rs` (7), `tests/cli_confirm_preview.rs` (9)
    and `store-embedded/tests/secure_delete.rs` (4, with a control without `secure_delete`). `tests/manifest_v4.rs`
    (14) has its seal test changed: a wide version 4 pipeline is now refused. There are 5 new unit tests (the
    table, the rendering). The related suites `contexts_pipelines` (10), `confirmations` (9),
    `cli_authority_prompt` (7), `require_human` (8) and the embedded `sqlite` (7) pass unchanged.
  - Ten [amendments](phases/4-curator/spec.md#amendments-from-step-2), none touching the trust model. Two make
    things fail closed where the text was silent: a step never runs under a clock-drawn trace id, and a failing
    preview refuses even where no prompt is asked.
  - No plugin crate changed (the SDK and the embedded store are not plugins), so no `Plugin-isolation-exempt:` line
    is needed. `src/plugins/manifest.rs` is untouched; `src/plugins/loader.rs`, already over 1,000 lines, grew by 15
    lines to 1,510.
  - Verified 2026-11-03 on the owner's Mac: `cargo fmt --all --check`; `cargo clippy --locked --workspace
    --all-targets -- -D warnings`, and `-p umbel --lib --no-default-features` alone and with `mounted` and with
    `component`; the scoped tests above. No script or workflow changed, so the tooling tests were not rerun.
- **Step 3a done (2026-11-03, merged in [#754](https://github.com/lushly-dev/afd/pull/754) as `37af26c9`), knowledge:
  record and journal:**
  - Proposal record version 2 (section 2.1, D92), in `plugins/knowledge/src/proposal/model.rs`. Every new proposal
    is version 2: `drafter`, `conflictSet`, `withdrawal` and `redacted` null, `decision.channel = "terminal"` on a
    person's decision, a proposer's withdrawal recorded as `{ by: "proposer", reason: "retracted", at }`, and
    envelope version 2 both in the body's `provenance` and on the stored record. A version 1 record is read, retried
    by key, decided, withdrawn and applied, and stays version 1 with none of version 2's keys. A record of another
    version reads as absent. `knowledge-propose` refuses memory evidence (`PROPOSAL_EVIDENCE_INVALID` in the
    handler, behind the schema's `VALIDATION_ERROR`).
  - The knowledge manifest at version 4. Section 11.2's digest set: `knowledge-proposal-list` (keeping its
    filters), `-proposal-show`, `-proposal-preview`, `-approve`, `-reject` and `-withdraw` (keeping `space` and
    `proposal`). `knowledge-propose`, `-verify` and the read and index commands stay plain. No result's
    `dev.umbel/provenance` carries `derivedFrom`. `knowledge-refresh`, now a version 4 pipeline, seals with every
    surface, since both its steps have them.
  - `knowledge-proposal-preview { space, proposal }` (section 8.1, D97), in the new `src/proposal/preview.rs`:
    inspect, CLI only, digest-journaled, returning exactly `{ preview }`. It renders the id, version, state, op,
    document, area, change hash, proposer, flags and conflict set; the drafter's host-attested fields apart from the
    ones verified against memory; each evidence entry, a memory entry's copied fields labelled "verified against
    memory at submission" and its counts and the settling instant labelled "drafter's policy"; the line "widens
    readers: sources private to `<principal>`" for a promoted draft; and the diff's first 80 lines with a count of
    the rest. Untrusted single-line values are JSON-quoted and diff lines prefixed `| `. It applies approve's reader
    rules, now one function shared with approve's gate. `knowledge-approve` and `knowledge-reject` declare it as
    `confirm_preview`; `knowledge-verify` declares none (8.1). Approve's prompt is now "Apply this proposal to the
    knowledge base?".
  - Tests: `plugins/knowledge/tests/proposals_v2.rs` (4), `preview.rs` (8) and `journal_modes.rs` (2), with
    `tests/support/records.rs`, which writes version 1 and drafted version 2 records straight through the document
    store and validates every stored body against its schema. `proposals.rs` changed in one test: approving a
    proposal the person cannot read now stops at the preview with `CONFIRMATION_PREVIEW_FAILED`, cause
    `PROPOSAL_NOT_FOUND`, before any prompt. The scripted terminal records what `Console::show` shows.
  - A fault in step 1's `schemas/proposal.v2.json`, fixed: its "a drafter's withdrawal needs a drafter" rule matched
    a `null` withdrawal, so every undrafted pending version 2 record was refused. `tests/schemas/phase4.rs` now holds
    the case.
  - Twelve [amendments](phases/4-curator/spec.md#amendments-from-step-3a), none touching the trust model.
  - Closes phase 2's "must do before real use" follow-up: the person approving or rejecting at a terminal sees the
    proposal and its diff before the prompt (follow-ups below).
  - No host `src/` or `wit/` file changed. `schemas/proposal.v2.json` did, for the schema fault, with
    `tests/schemas/phase4.rs`; the plugin-isolation check counts `schemas/` as host code, so the pull request
    carries a `Plugin-isolation-exempt:` line naming that fix. The README's knowledge section describes the preview.
  - Verified 2026-11-03 on the owner's Mac: `cargo fmt --all --check`; `cargo clippy --locked -p umbel-store -p
    umbel-store-embedded -p umbel-okf -p umbel-scan -p umbel-plugin-sources-filesystem -p umbel-plugin-knowledge
    --all-targets -- -D warnings` and the same for `-p umbel-plugin-knowledge --no-default-features`; the knowledge
    job's `cargo test` (477 tests in 60 suites, `eval_gate` with the baseline untouched) and `-p
    umbel-plugin-knowledge --no-default-features` (181 in 24); the host's `schemas` test (47). No script or workflow
    changed, so the tooling tests were not rerun.
- **Step 3b done (2026-11-03, merged in [#763](https://github.com/lushly-dev/afd/pull/763) as `4a6b2de4`),
  knowledge: the drafted path:**
  - `[plugins.knowledge.config] drafters` (default `[]`; a table with each drafter's targets since step 3c's
    amendment 14), read in `plugins/knowledge/src/proposal/attest.rs`: a
    call's `CallContext.pipeline` is accepted only from a listed instance; an attested step of any other is
    `PROPOSAL_DRAFTER_NOT_ALLOWED` for the whole call.
  - `knowledge-propose-batch` (every surface, `store-write`, digest keeping `space`), in `src/proposal/batch.rs`: up
    to 50 proposals and 50 withdrawals and 400 distinct memory sources (`PROPOSAL_BATCH_TOO_LARGE`), a result per
    item, withdrawals first. Each proposal is `knowledge-propose`'s validation, now `propose::submit`. Without an
    attestation it is an ordinary batch: drafter claims, memory evidence, a `derivedFrom`, a conflict set and
    withdrawals are `PROPOSAL_EVIDENCE_INVALID` per item. A listed drafter's proposals carry the attestation as
    `drafter` (`mode = "scheduled"`) and are `agent-inferred`; a retry must repeat the drafter's claims (else
    `PROPOSAL_KEY_REUSED`); `PROPOSAL_ALREADY_OPEN` for a document, or a memory source, with an open proposal.
  - **The memory-evidence refusal (owner decision 10's sequencing):** until step 3c verifies a drafter's claims
    against the memory store, a listed, attested drafter's memory evidence, memory `derivedFrom`, candidate,
    promotion, conflict set and create or update content are refused with the new code
    **`PROPOSAL_DRAFT_UNVERIFIABLE`**, `details.claim` naming the claim; only `verify` and `deprecate` drafts
    citing other evidence are stored, and the preview labels them "checked at submission: it cites no memory
    record", never "verified against memory". Nothing labelled as verified against memory can be stored before
    the verification exists. Step 3c lifts it.
  - A drafter's withdrawal and redaction, in `src/proposal/redact.rs`: only of a proposal whose `drafter` is the
    attested instance and whose proposer is the caller; `source-erased` always redacts (9.1's fields, and also
    the rationale, every excerpt, a verify's note, a rejection's reason and the stored envelope's
    `derivedFrom`), idempotently. **Every draft that was not applied is redacted** when its source is erased
    (decided by the owner for the stronger guarantee): a pending one is withdrawn and redacted; a withdrawn one
    (by the drafter or its proposer), a rejected one and an approved one whose apply never landed are redacted
    in place, keeping their decision or withdrawal; an applied one never is. A drafter reaches them by id
    (`redact: true`) or by the new **`erased`** notice of memory record ids, which redacts each of its own
    non-applied drafts citing one. `proposal.v2.json` now allows `redacted` in those states. Approve refuses a
    redacted draft with `PROPOSAL_SOURCE_GONE`.
  - **No earlier body hash of a redacted draft is left in the change log** (decided by the owner for the stronger
    guarantee): a new store method, `DocumentStore::forget_record_history`, and host service,
    `HostServices::record_forget_history`, null the `changes` rows' hashes of the record's earlier versions,
    under `secure_delete`, before the checkpoint. A drafted proposal's reject and withdraw results no longer put
    the record hash in `dev.umbel/provenance`, so neither the journal nor the events keep it.
  - The checkpoint's `Pending` state carried through (step 2's amendment 9): a new compiled-only host service,
    `HostServices::truncate_wal` (SDK `Cx::truncate_wal` and `WalCheckpoint`; `CallServices::svc_truncate_wal`),
    runs `SqliteStore::truncate_wal` under `checkpoint`'s rules. The batch reports `checkpoint: "clean"` or
    `"pending"` after a redaction or a forgotten hash, and `pending` warns `PROPOSAL_REDACTION_PENDING`
    (store-check finishes it).
  - `knowledge-proposal-feed` (CLI only, `inspect`, digest keeping `space` and `after`), in `src/proposal/feed.rs`:
    refuses without an accepted attestation; the rejected and applied decisions on the attested drafter's
    proposals of the caller after a revision, from the change log, with `next` and `more`.
  - Approve: a drafted proposal's document is `agent-inferred`; its authorship stays phase 2's rule until step 3c
    reads the sources (the runner approving a draft is self-approval, stricter than 8.2).
  - Tests: `plugins/knowledge/tests/drafted.rs` (10) and `redaction.rs` (11: each state redacted by the notice and
    by id, applied untouched, the change log's and the journal's earlier hashes gone), with stand-in drafters in
    `tests/support/drafter.rs`; `journal_modes.rs` gains the batch and the feed in the digest set; `preview.rs`'s
    redaction line names the rationale. Store: `store-embedded/tests/secure_delete.rs` gains the change log's
    earlier hashes gone from the raw bytes. Host: `tests/store_truncate_wal.rs` (3: both services), with
    `truncate-wal` and `record-forget-history` ops in `tests/support/store.rs`; `tests/schemas/phase4.rs` holds the
    widened redaction rule. `umbel-store-embedded`'s `testkit` feature gains `SqliteStore::hold_reader`.
  - Thirteen [amendments](phases/4-curator/spec.md#amendments-from-step-3b), none weakening the trust model; 12 and 13
    close the step's two questions for the stronger guarantee. 11.3 gains `PROPOSAL_DRAFT_UNVERIFIABLE` and the
    warning `PROPOSAL_REDACTION_PENDING`.
  - **Host, store and schema code changed:** `src/plugins/store_services.rs` and `src/plugins/grants.rs` (the two
    services), `sdk/src/` (the trait methods and `WalCheckpoint`), `store/src/traits.rs`
    (`DocumentStore::forget_record_history`, implemented by the embedded store and the store tests' fake),
    `store-embedded/src/` (that method, and the testkit hold), `schemas/proposal.v2.json` (the redaction rule),
    with `tests/`. No `wit/` file changed. The pull request needs a `Plugin-isolation-exempt:` line naming the two
    services, the store method and the schema rule.
  - Verified 2026-11-03 on the owner's Mac: `cargo fmt --all --check`; the knowledge job's clippy (`-p umbel-store -p
    umbel-store-embedded -p umbel-okf -p umbel-scan -p umbel-plugin-sources-filesystem -p umbel-plugin-knowledge
    --all-targets -- -D warnings`) and `cargo test` (499 tests in 62 suites, `eval_gate` with the baseline
    untouched); `-p umbel-plugin-knowledge --no-default-features` clippy and tests (202 in 26); `cargo clippy -p umbel
    -p umbel-sdk -p umbel-store --all-targets -- -D warnings`, `-p umbel --lib --no-default-features` and `-p
    umbel-sdk --all-features --lib`; the host's `schemas` (47), `store_truncate_wal` (3) and `store_grants` (23). No script or workflow changed,
    so the tooling tests were not rerun; the full gate is the owner's.
- **Step 3c done (2026-11-03, merged in [#765](https://github.com/lushly-dev/afd/pull/765) as `7e52e337`, from `4a6b2de4`), knowledge: verifying drafts:**
  - `umbel_okf::draft` (the new `okf/src/draft.rs`): section 4.5's fixed rendering, byte for byte, with every value
    escaped onto its one line; the fixed rationale and its exact inverse; `subject_key` and its digest; the candidate,
    conflict-set and document ids; the idempotency key `<instance>/<candidate>/<drafts>`; the excerpt; the settling
    instant read back from a rendering. Shared, so the curator (step 4) renders and the knowledge plugin re-renders,
    neither depending on the other.
  - The knowledge plugin declares `memory`, **read only and optional** (owner decision 7), and therefore a `journal` on
    every command and pipeline (phase 3 section 2.3): the read and index commands, `knowledge-propose`, `-verify` and
    `knowledge-refresh` say `plain`, as they behaved; the digest set is unchanged. A read grant needs no `allow` list,
    so the README's example `umbel.toml` is unchanged; the README says so, and how to deny it.
  - **Every check of section 3.2**, in the new `src/proposal/checks.rs` and `src/proposal/sources.rs`, against the
    memory store read once per batch under the batch caller's reader filter (owner decision 4; never a derivation
    read) and against `umbel_okf::draft`: source exists (`source-missing`, `source-not-live`, `source-flagged`,
    `source-class`), version (`source-version`, `source-hash`), copied fields (`copied-principal`, `-class`,
    `-authority`, `-origin`, `-constraints`, `-access`, `-sensitivity`, `-confirmation`) and `confidence`, `counts`,
    `group`, `excerpt`, `content`, `candidate`, `document`, `conflict-set`, widening and mode (`mode`, `promoted-by`,
    `sensitivity`) and `generated-at`. Each refuses its item with `PROPOSAL_DRAFT_MISMATCH`, `details.check` naming it,
    and nothing stored. Six checks the table did not name close the paths a drafter's free text could outlive a
    redaction or claim what is not so: `source-authority`, `evidence`, `derived-from`, `rationale`, `key`, `run`.
  - Step 3b's `PROPOSAL_DRAFT_UNVERIFIABLE` is lifted claim by claim. It stays only for what this instance cannot
    verify: memory claims with the `memory` grant withheld (at submission and at approve), memory evidence on an op
    other than `create`, and a create or update citing no memory record. A candidate, promotion, conflict set or
    `derivedFrom` on a draft citing no memory is a mismatch.
  - A replayed batch with a tampered copied field is verified before it is called `PROPOSAL_KEY_REUSED`, so it is
    `PROPOSAL_DRAFT_MISMATCH` naming the field (section 13, point 1); an identical retry still returns the stored draft.
    `PROPOSAL_ALREADY_OPEN`'s memory-source half is exercised, and a verified conflict set's alternatives do not block
    each other.
  - A verified draft stores its `derivedFrom` (kind `memory`) in the body and the record's envelope; later saves keep
    it, and only a redaction removes it. No result's `dev.umbel/provenance` carries it.
  - **Approve (section 8.2):** re-checks the target against the copied access and sensitivity
    (`PROPOSAL_ACCESS_WIDENED`; a promotion against the target's readers at submission), then each source under the
    approver's filter (`PROPOSAL_SOURCE_GONE`; a changed copied field is `PROPOSAL_DRAFT_MISMATCH`). **Authorship and
    self-approval come from the store:** the approver against every source record's principal and `promotedBy`. The
    runner is no longer compared, so step 3b's interim rule ends: a draft of another person's shared memory, and a
    drafted `verify` or `deprecate`, are approved by the runner with no exception.
  - The drafter's "erased" claim is checked: a draft is redacted only once the store no longer holds a named source
    (`source-erased` otherwise), which can never keep forgotten text.
  - The preview's "verified against memory at submission" label now covers only fields a 3.2 check verified; the
    sessions and settling instant stay "drafter's policy".
  - Tests: `okf/tests/draft.rs` (10) and `plugins/knowledge/tests/verify_drafts.rs` (20: each row of 3.2 and the added
    checks, the exact target path and an unsafe prefix refused at load, a faithful draft and its preview, widening by the owner accepted and by others refused, the tampered
    replay, the source half of `PROPOSAL_ALREADY_OPEN`, the withheld grant, the "erased" claim, approve's repeat after a
    source or the target changes), with `tests/support/memory.rs`, which writes memory records through the store.
    `drafted.rs` (11): the 3b refusal test now holds what stays refused, and approve's authorship from the store.
    `journal_modes.rs` approves a verified draft and holds the `plain` journals and the optional grant. `redaction.rs`
    redacts a verified draft after its source is forgotten, and refuses to redact a memory-free draft as erased. The
    knowledge crate's tests enable `umbel-store`'s `conformance` feature for its memory samples; no crate is added.
  - **The drafter's target (amendment 14, settled under owner decision 10).** `drafters` is now a table keyed by
    instance, with `targets` per space: `[plugins.knowledge.config.drafters.curator.targets.main]` with `collection`
    and an optional `prefix`. The configuration schema holds the shape and a safe prefix at load
    (`PLUGIN_CONFIG_INVALID`; `umbel_okf::draft::is_safe_prefix`), and every drafted create checks the collection is
    a markdown collection of the space (`PROPOSAL_DRAFTER_TARGET_INVALID`). A drafted create must be exactly
    `<collection>/<prefix>/<derived id>` (`umbel_okf::draft::document_id`); anything else, and a create from a drafter
    with no target, is `PROPOSAL_DRAFT_MISMATCH`, check `document`. No drafter-chosen text survives in the path. The
    curator's configuration (step 4) must name the same target; knowledge's entry is the one enforced. Whether the
    knowledge instance may write the collection is not visible to a plugin, so it is not checked at load; an approval
    there stops with `PROPOSAL_APPLY_UNAVAILABLE`.
  - Fourteen [amendments](phases/4-curator/spec.md#amendments-from-step-3c), none weakening the trust model.
  - **No host `src/`, `wit/`, `schemas/` or SDK file changed**, and no script or workflow: only `umbel-okf` and the
    knowledge plugin, so no `Plugin-isolation-exempt:` line is needed. The knowledge manifest's grant change is the
    optional read-only `memory` grant.
  - Verified 2026-11-03 on the owner's Mac: `cargo fmt --all --check`; the knowledge job's clippy
    (`-p umbel-store -p umbel-store-embedded -p umbel-okf -p umbel-scan -p umbel-plugin-sources-filesystem -p
    umbel-plugin-knowledge --all-targets -- -D warnings`) and `cargo test` (530 tests in 64 suites, `eval_gate` with the
    baseline untouched); `-p umbel-plugin-knowledge --no-default-features` clippy and tests (223 in 27); and `cargo
    test -p umbel-first-party` (13 in 7), whose binary links the knowledge plugin. Not run here: the job's MSRV 1.97
    check (the toolchain is not installed on this machine) and the full gate, which is the owner's. No script or
    workflow changed, so the tooling tests were not rerun.
- **Step 4 done (2026-11-03, merged in [#767](https://github.com/lushly-dev/afd/pull/767) as `0d46a9a0`, from `7e52e337`), curator: candidates:**
  - The `umbel-plugin-curator` crate (`plugins/curator`, kind `compiled`, id and domain `curator`, manifest version 4,
    `publish = false`, quarantined in `scripts/release/inventory.json` with no route, with an `architecture.json` row):
    its manifest, the `settle` pack (sections 4, 6 and 7's defaults and the per-call bounds), the `curator-guide` skill
    and the configuration schema (`spaces.<space>` targets with a safe prefix; `model` reserved and refused). Grants:
    `config`, `packs`, `clock`, `memory` (read), `documents`, `records` and `records_write`; no `content`. **No write grant to memory or knowledge** (owner decision 8), and no dependency on
    another plugin crate (`tests/no_plugin_dependency.rs`).
  - A deterministic, public core: `settle` (eligible records under the pack, groups by content hash and class, the
    window by class, sessions, authority `person` by default and widened only by the pack, never `transcript`,
    flags, liveness, the confidence gate), `access` (section 5.1, token by token, sensitivity first), `conflicts`
    (section 4.4's sets and alternatives), `evaluate` (every status, merged with the caller's records) and `draft`
    (a candidate as a `knowledge-propose-batch` item through `umbel_okf::draft`). Memory is read only under the
    caller's reader filter (owner decision 4), with `memory_list` then `memory_get`, bounded by `max_records` and
    `max_gets` and counted.
  - `curator-candidates` (inspect) and `curator-promote` (`require-human`, own records only, the content hash as proof
    of looking, only `needs-promotion`, sensitivity never overridden), both CLI only and digest-journaled with
    `keep = ["space"]`. Promotion writes a `consent` record readable by its owner alone; candidate records' bodies
    are built and read here for step 5 to write. No result, record or journal entry holds memory text.
  - **Proof that drafts pass the knowledge plugin's verification:** `plugins/curator/tests/draft.rs` re-derives every
    row of section 3.2 from the store's records beside the curator's drafting, byte for byte, and
    `first-party/tests/curator_drafts.rs` submits the curator's own drafts to the real `knowledge-propose-batch` under
    the host's pipeline attestation: a scheduled draft, both alternatives of a conflict set and a promotion are stored,
    a rerun returns them, and a tampered copied field or a misclaimed mode is `PROPOSAL_DRAFT_MISMATCH`.
  - Twelve [amendments](phases/4-curator/spec.md#amendments-from-step-4), none changing the trust model. The first
    adds a host service, `readable_collections` under the `documents` grant, returning only the id, kind, access set
    and sensitivity of the collections the caller reads, for section 5.1's target; a target the caller cannot read is
    `CURATOR_TARGET_UNCONFIGURED` (`collection-missing`). It replaced an optional `content` grant, which also carried
    file reads and writes, at the coordinator's request for least privilege. The ninth adds `CallContext.person`
    (accepted).
  - **Host and SDK changed** (`src/plugins/{compiled,grants,memory_services,store_services}.rs`,
    `sdk/src/{cx,component,mounted,store,lib}.rs`, new `tests/call_person.rs` and `tests/readable_collections.rs`): the
    SDK's `CallContext` gains `person`, the host's own person check (D86), so `curator-promote` refuses an agent's
    environment as `memory-confirm` does, and the memory services now share the same `CallServices::person`; and
    `HostServices::readable_collections` (SDK `CollectionMeta`) serves collection metadata under `documents`, filtered
    by the caller's readers. Compiled plugins only; WIT world 1.0.0 and the schemas are unchanged. The pull request
    needs a `Plugin-isolation-exempt:` line. `umbel-first-party` takes the curator as a dev-dependency only.
  - CI: the `memory` job of `umbel.yml` gains `-p umbel-plugin-curator` in its clippy, tests and MSRV check; the
    `check` job's tests exclude it.
  - Tests: `settle.rs` (8), `conflicts.rs` (5), `draft.rs` (6), `access_rule.rs` (7), `promote.rs` (6), `config.rs`
    (9), `no_plugin_dependency.rs` (3) and 8 unit tests in the curator crate; `first-party/tests/curator_drafts.rs` (1);
    the host's `tests/call_person.rs` (2) and `tests/readable_collections.rs` (4).
  - Verified 2026-11-03 on the owner's Mac: `cargo fmt --all --check`; `cargo clippy -p umbel -p umbel-sdk -p
    umbel-plugin-curator -p umbel-plugin-memory -p umbel-plugin-context -p umbel-plugin-knowledge -p umbel-first-party -p
    umbel-hook --all-targets -- -D warnings`, `-p umbel --lib --no-default-features` (alone, with `mounted`, with
    `component`), `-p umbel-sdk --all-features --lib`, the mounted SDK and `hello-mcp`, and the components for
    `wasm32-wasip2`; the `memory` job's tests with the curator (259 tests in 51 suites); the SDK's and the host's unit tests with the host's `readable_collections`, `call_person`, `require_human`, `cli_authority_prompt`, `memory_grants`, `pipeline_attestation`, `pipeline_expose`, `plugin_compiled`, `grants`, `store_grants`, `store_truncate_wal`, `schemas`, `manifest_v4` and `cli_confirm_preview` (295 tests in 18 suites); and
    `node scripts/run-tooling-tests.mjs` (305). Not run here: the job's MSRV 1.97 check (the toolchain is not
    installed on this machine), the knowledge job (no knowledge file changed) and the full gate, which is the owner's.
- **Step 5 done (2026-11-03, merged in [#768](https://github.com/lushly-dev/afd/pull/768) as `9ea18e73`, from `0d46a9a0`), curator: runs:**
  - `curator-run`, the pipeline the curator ships as data (section 3.1): `curator-plan`, the knowledge plugin's
    `knowledge-propose-batch` and `knowledge-proposal-feed`, then `curator-finish`. Command line only (`expose = { mcp
    = false, agent = false, cli = true }`), `result = "last"`, digest-journaled, effects `store-write`; it answers
    with `finish`'s report, ids and counts only, so stdout, cron mail and the journal hold no memory text.
    `curator-plan` and `curator-finish` refuse any call the host does not attest as a step of it
    (`CURATOR_RUN_REQUIRED`). `curator-status` reports the last run, `overdue`, the lock, the promotable candidates and
    the records an owner may invalidate.
  - **The lock** (7.3): per (space, principal), taken by compare-and-set for 10 minutes (`CURATOR_BUSY`, retryable),
    taken over once expired, released by `finish` only when it is the run's own (`CURATOR_LOCK_TAKEN_OVER` otherwise).
    The cursors (`feedAfter`, `memoryAfter`, `scanAfter` and the new `reviewAfter`) move only at `finish`.
  - **Recovery** by derived proposal ids: the proposal id derivation is shared as `umbel_okf::draft::proposal_id` (the
    knowledge plugin's own now calls it); `plan` records each draft's id and draft number before the batch, so a run
    that stopped after its batch is completed by the next (`created: false`), and a draft whose candidate changed is
    withdrawn before a new key is used. Never `PROPOSAL_KEY_REUSED`.
  - **The re-check** (9.1, owner decision 7): every draft of the caller's that may be open is re-read at `now`; an
    erased source is redacted and withdrawn through the batch's `erased` notice, and the curator's own candidate and
    consent records keep nothing of it (hashes forgotten in the change log, a reporting checkpoint, `checkpoint` in the
    report); invalidated, expired, confirmed, flagged or unreadable sources withdraw with `source-changed`; applied
    alternatives withdraw the others with `superseded-alternative`.
  - **Feedback** (7.1): a rejection quiets the same content for 90 days, keeping the approver's reason only in the
    caller's own record; an apply marks the candidate `applied`, never drafted again.
  - **Re-verification and inconsistencies** (section 6): `verify` drafts for documents due within `lead_days`, with
    the three checks as evidence; `deprecate` drafts for a resolving successor; `check-failed`, `successor-missing`,
    `target-exists` and `conflict-after-draft` reported. A new `review` record per document keeps the caller's drafts,
    so an open one is not drafted again and a rejected one stays quiet. The successor's resolution is shared as
    `umbel_okf::links::successor`.
  - **Rotating scans and caps**: memory from `scanAfter`, documents from `reviewAfter`, wrapping, so every record and
    document is reached across runs; at most `max_proposals` drafts (candidates in id order, then reviews in document
    id order), 50 withdrawals and 400 cited records per batch; `remaining` says how far behind a run is.
  - **Schemas:** `curator-record.v1.json` gains the `review` kind, a candidate's `proposal`, the state's `reviewAfter`
    and a consent that keeps no sources after a forget (the host has no record deletion); `curator-report.v1.json`
    gains `checkpoint`, `refused` and the counts `deprecate` and `refused`; examples updated and two added, with
    `tests/schemas/phase4.rs`.
  - Thirteen [amendments](phases/4-curator/spec.md#amendments-from-step-5), none changing the trust model. The first
    refuses the run's steps outside the run; the ninth declares one grant less than D90 lists (`graph`, unused).
  - **No host `src/` change.** `schemas/` changed (amendments 2, 5, 6, 7), and `umbel-okf` and the knowledge plugin by
    two shared derivations, byte for byte (`model::proposal_id` and `graph::successor` now call `umbel-okf`), so the
    pull request needs a `Plugin-isolation-exempt:` line naming the schema changes. The curator's `draft::item` no
    longer writes `confidence: null` (the batch's schema refuses it). No script or workflow changed.
  - Tests: curator `run.rs` (7), `feedback.rs` (6), `forgotten.rs` (7), `reverify.rs` (5), `deterministic.rs` (3),
    `poisoning.rs` (5), `not_request_path.rs` (7), with a stand-in for the knowledge plugin's batch and feed
    (`tests/support/knowledge.rs`; the curator crate links no plugin); `config.rs` and two step 4 tests updated; unit
    tests for the state, the bookkeeping, the re-check and the review assessment. Against the real knowledge plugin,
    `first-party/tests/curator_run.rs` (5). `okf/tests/draft.rs` gains the proposal id; the host's
    `tests/schemas/phase4.rs` the new shapes.
  - Verified 2026-11-03 on the owner's Mac: `cargo fmt --all --check`; `cargo clippy --locked -p umbel-okf -p
    umbel-plugin-knowledge -p umbel-plugin-curator -p umbel-first-party --all-targets -- -D warnings` and `-p
    umbel-plugin-knowledge --no-default-features`; the knowledge job's tests (532 in 64 suites, `eval_gate` with the
    baseline untouched), the `memory` job's (311 in 59, the curator and `umbel-first-party` included) and the host's
    `schemas` (47). Not run here: the MSRV 1.97 check (the toolchain is not installed), the tooling tests (no script or
    workflow changed) and the full gate, which is the owner's.
- **Step 6 done (2026-11-03, merged in [#770](https://github.com/lushly-dev/afd/pull/770) as `6e1c0a0a`, from `9ea18e73`), auto-approval:**
  - `knowledge-auto-approve { space?, limit? }` (section 8.3, owner decision 1, D98), in the new
    `plugins/knowledge/src/proposal/auto.rs`: command line only, `store-write` and `workspace-write`, digest-journaled
    keeping `space` and `limit`, no AFD approval, and a plain `confirm_prompt` that a person answers at a terminal and
    `--yes` answers from cron (the stricter option the text allows; `require-human` would contradict a rule that
    applies "without a person"). Refused with `PROPOSAL_AUTO_NOT_ALLOWED` for any pipeline step the host attests, the
    curator's included, and for a caller that is not a person; the caller must be one of the area's approvers.
  - **`deprecate-declared`, off by default:** an area opts in with `auto = ["deprecate-declared"]` (default `[]`); the
    configuration schema and the area reader refuse any other value, and what is never applied is code. It applies a
    version 2 `deprecate` drafted by a still-listed drafter, scheduled, citing no memory, unflagged and not an
    alternative, when its area still governs the document, the document and its file are at the draft's `baseHash`,
    the frontmatter's `superseded_by` is the draft's `supersededBy`, **the document's one `derivedFrom` names an applied
    `create` or `update` of this instance, decided by a person, whose content and result are exactly those bytes and
    whose diff adds the declaring line**, and the successor resolves, is not deprecated and is readable by every reader
    of the target. So a declaration typed into a file, carried through a later edit or verification, or claimed by a
    forged envelope never triggers it.
  - **Recorded as the policy's decision:** `decision.by = { kind: "service", id: "policy:<area>" }`, `principal` the
    caller's, `channel = "policy"`, `policy.rule = "auto:deprecate-declared"` with a version covering the area's `auto`
    list, through approve's own compare-and-set steps (`apply::apply_by_policy`; `apply` takes a `Decider`). A stopped
    policy apply resumes only when the rule holds again in full; a person's stopped approval is left to the person.
  - Eleven [amendments](phases/4-curator/spec.md#amendments-from-step-6), none changing the trust model; the seventh
    closes two cases the text's predicate let through (a typed declaration followed by a person's verification, or
    carried as context through a person's edit). 11.3's `PROPOSAL_AUTO_NOT_ALLOWED` also covers a caller that is not a
    person.
  - **No host `src/`, `wit/`, `schemas/` or SDK file changed**, and no script or workflow: only the knowledge plugin
    (its manifest, configuration and input schemas, the proposal code), its tests, its skill and the README, and one
    `umbel-first-party` test. So no `Plugin-isolation-exempt:` line is needed.
  - Tests: `plugins/knowledge/tests/auto_approve.rs` (20) and 2 unit tests in `auto.rs`; `journal_modes.rs` adds the
    command to the digest set; the stand-in drafters gain a `<id>-auto` pipeline, and `tests/support/records.rs` an
    `overwrite`. `first-party/tests/curator_run.rs` (6, one new): the real curator's deprecate draft applied by the
    rule after a person declared the successor, and read back by the next run.
  - Verified 2026-11-03 on the owner's Mac: `cargo fmt --all --check`; the knowledge job's clippy (`-p umbel-store -p
    umbel-store-embedded -p umbel-okf -p umbel-scan -p umbel-plugin-sources-filesystem -p umbel-plugin-knowledge
    --all-targets -- -D warnings`) and `cargo test` (554 tests in 65 suites, `eval_gate` with the baseline untouched);
    `-p umbel-plugin-knowledge --no-default-features` clippy and tests (245 in 28); the `memory` job's clippy (`-p
    umbel-plugin-memory -p umbel-plugin-context -p umbel-plugin-curator -p umbel-first-party -p umbel-hook`) and `cargo
    test -p umbel-first-party` (20 in 9). Not run here: the curator's own tests (the crate is unchanged), the MSRV 1.97
    check (the toolchain is not installed), the tooling tests (no script or workflow changed) and the full gate, which
    is the owner's.
- **Step 7 done (2026-11-03, in the step 7 pull request, from `6e1c0a0a`), the binary and the exit:**
  - **`umbel-first-party` links the curator** (`first-party/Cargo.toml`, `src/main.rs`), so the binary has all five
    first-party plugins: `sources`, `knowledge`, `memory`, `context` and `curator`. The curator moved from a
    dev-dependency to a dependency; `Cargo.lock` is unchanged. The tests' `support::with_plugins` gains it too, so
    library actors see what the binary links.
  - **`first-party/tests/exit_curator.rs`** (1 test, about 4 seconds in a debug build) runs the exit criterion of
    [section 13](phases/4-curator/spec.md#13-exit-criterion-and-tests) through the real binary as a child process,
    on the `testkit` build's frozen clock and person at a terminal, with `sources`, `knowledge`, `memory` and
    `curator` in a space `alpha` (a `notes` collection, an area, the curator in `drafters` with the target
    `notes/learned`). The command line is `human:local`; `human:ada`'s memory is written and forgotten through the
    binary too, with `principal.local_id` switched for her calls. It writes a report of each point's numbers to
    `UMBEL_CURATOR_EXIT_REPORT`, which the `memory` job sets and uploads beside phase 3's in
    `memory-exit-report-<os>`.
  - **`first-party/tests/curator_leaks.rs`** (1 test, about 2 seconds): a differential probe of every curator surface
    and the knowledge plugin's proposal surfaces, on two workspaces that differ only in what bo cannot read; bo's 32
    answers are equal in both, none holds any of ada's 16 hidden ids, hashes, run ids or her lock's trace, and every
    curator record carries section 2.3's access set. Checked once by hand: planting one of ada's records in bo's
    readers made it fail at its first answer.
  - The test support gains `Bin::output`, `Bin::at_terminal` (stderr, where the preview and the prompts go),
    `Bin::configure`, the MCP client's `tool_names` and `call_raw`, and `Ws::with_config`.
  - **Host: no change**, and no plugin, schema, SDK or adapter change: the exit and the probes found no defect. No
    `Plugin-isolation-exempt:` line is needed.
  - CI: the `memory` job's test step sets `UMBEL_CURATOR_EXIT_REPORT` and its upload step takes both reports. The
    README gains "Run the curator": a working `umbel.toml` (checked with the built binary's `workspace doctor`,
    `curator-run` and `knowledge-auto-approve --yes`), the commands, and a cron example that runs `curator-run` and,
    only for an area listing `deprecate-declared`, `knowledge-auto-approve --yes`.
  - Eleven details settled in the specification's
    [Amendments from step 7](phases/4-curator/spec.md#amendments-from-step-7), none changing the trust model; the
    eleventh is the question for the owner below.
- **Exit criterion** (2026-11-03, the step 7 branch from `main` at `6e1c0a0a`, in `endpoints/umbel` with its own
  `CARGO_TARGET_DIR`, debug build, on the owner's Mac). Each point, from the report:
  1. **A scheduled draft.** Ada's fact (authority `person`, shared with the space, one constraint, canaries in its
     subject, text, tag and constraint, observed in 2 sessions) is `settling` on day 3 and `ready` on day 8, when
     `curator-run` drafts 1 version 2 proposal at `notes/learned/c-<20 hex>`. Its `drafter` names the plugin and
     instance `curator`, the pipeline `curator-run` and the run's own trace id; its 1 memory evidence entry's
     principal, authority, origin, constraints, access and content hash equal `memory-show`'s; `derivedFrom` names
     the record. The curator's own rendering, replayed beside the binary, returns the stored draft (`created:
     false`); with `authority` changed it is `PROPOSAL_DRAFT_MISMATCH`, check `copied-authority`, and nothing is
     stored. No canary is in the run's stdout (867 bytes), the journal, the log or the events.
  2. **Approved from the command line.** `knowledge-approve` at the terminal showed 38 preview lines (the id, the
     drafter, "verified against memory", the diff) before its prompt; the approver `human:local` is neither the
     source's principal (`human:ada`) nor a promoter, so `exception: null`, `decision.channel = "terminal"`.
  3. **Lands with full provenance.** The file is the curator's rendering byte for byte, with `Holds only`; the
     document is `agent-inferred`, `generated.by = "umbel:curator/curator"`, `generated.at` the candidate's
     `settledAt` (`2026-11-10T12:00:00.000Z`), `derivedFrom` the proposal, before and after `knowledge-refresh`;
     `knowledge-search` finds it (1 hit); the next run reads the apply back (`applied` 1) and the candidate is
     `applied` with `promotedTo` the document; events exist for `knowledge-propose-batch` and `knowledge-approve`;
     a further run drafts 0.
  4. **Promotion and self-approval.** The caller's private fact is `needs-promotion` while ada's two shared facts are
     drafted (a run of 2); after `curator-promote` at the terminal the next run drafts it, `mode = "promoted"`,
     `promotedBy = "human:local"`. Approving it is `PROPOSAL_SELF_APPROVAL` until the area sets
     `allow_self_approval`, then `exception: "self-approval"`.
  5. **Feedback.** A draft rejected at the terminal is read back (`rejected` 1), `quietUntil` 90 days on
     (`2027-02-18T12:00:00.000Z`), and a run on day 77 drafts 0.
  6. **Forgotten evidence.** After ada's `memory-forget` the next run withdraws 1 draft and redacts it
     (`source-erased`), checkpoint `clean`; its id and its path `notes/learned/c-<20 hex>` are unchanged. Its 4
     canaries and its source's hash are in none of `store.sqlite3`, its log and shared memory, the journal, log and
     events, the curator records, the run's stdout, or any other file of the workspace (0 files).
  7. **Not in the request path.** Over the binary's stdio MCP server, none of the 6 curator commands and pipeline and
     the 5 command-line-only proposal commands of the knowledge plugin is in `tools/list` (10 tools) or `afd-discover`
     (40 commands), and `afd-call`, `tools/call`, `afd-batch` and `afd-pipe` run none; no proposal changed state and
     the run records stayed at 8.
  - **Leak probes** (section 12's "hidden counts" and "private memory disclosed" rows): `curator_leaks.rs` passes, as
    above.
  - **Local checks:** `cargo fmt --all --check`; `cargo clippy --locked -j4 -p umbel-plugin-memory -p
    umbel-plugin-context -p umbel-plugin-curator -p umbel-first-party -p umbel-hook --all-targets -- -D warnings`; the
    `memory` job's tests as `umbel.yml` runs them, both report variables set (314 passed, 0 failed, in 61 suites:
    312 at step 6, and these 2); `node scripts/run-tooling-tests.mjs` (305 passed, on Node 24.18; the repository pins
    26). Not run here: the knowledge job (no knowledge file changed), the MSRV 1.97 check (the toolchain is not
    installed on this machine) and the full gate. **Full `pnpm verify` re-run, 2026-11-03, `main` at `6e1c0a0a`
    plus step 7, in one pass:** all 21 suites passed (the TypeScript check, Loam's build, Chromium-free units and
    `test:mounted`, Alfred, fmt, the workspace clippy, the components and `hello-mcp`, `cargo test --locked
    --workspace --exclude umbel-store-embedded` and the store crates, 206 test result lines with none failed, and
    every todo conformance run against Umbel with the external clients).**
- **Not done:** nothing in phase 4's [plan](phases/4-curator/spec.md#15-implementation-plan). There is no AFD step 0.
  Open: the specification's [follow-ups](phases/4-curator/spec.md#follow-ups), among them the host hook for
  configuration checks that need the workspace (a drafter target's collection), which was listed for step 7 and was
  not built there: neither the plan row nor the exit needs it, it is a new host interface, and every case still
  fails closed per draft; it now waits for real use, with the doctor API.
- **Next:** the phase 5 (auth and hosted) and phase 6 (backends) specifications, which phase 4's exit leaves as the
  open phases before phase 7. Each gets an independent review, a revision and the owner's answers (D24). Heavy steps
  follow each plan's build note.
- **Answered by the owner 2026-11-04** (phase 5 decision 11, D120), formerly waiting: one question, raised again at the exit
  ([step 7, amendment 11](phases/4-curator/spec.md#amendments-from-step-7)). Step 3b's amendment 12 stated a limit
  that no decision has accepted or closed: proposals are read under the caller's reader filter, so a draft whose
  proposer has since lost read access to it (removed from the target's readers after it was drafted) is reached by
  neither the run's re-check nor the `erased` notice, and is not redacted when its memory source is forgotten. Its
  text stays readable by the readers the record still admits, never wider than they were. Accept it as a stated
  limit, or close it with a redaction path outside the caller's filter (for example one the knowledge instance runs
  on a forget), which changes who may act on a record. Every other phase 4 decision is final. Answered 2026-11-04 by [phase 5 decision 11](phases/5-auth-hosted/spec.md#17-for-the-owner): a host-run, redaction-only sweep, amending D101 (D120); phase 5 step 11 builds it. Nothing of phase 4 waits on the owner.
- **Follow-ups:** the [specification's list](phases/4-curator/spec.md#follow-ups), which step 7 extended with the
  principal filter any future plugin-record surface needs and with the question above, now answered.

### Phase 5. Auth and hosted

- **State:** specification **approved 2026-11-04, under the owner's 2026-10-31 delegation, with the owner's answers of
  2026-11-04** (D24), after an independent review (36 findings and 7 nits, all holding, 3 in part) and a revision on
  2026-11-03; **step 0a done 2026-11-07** (documents and cases only); **step 0b done 2026-11-07** (AFD's Rust
  `server-auth`); **step 0c done 2026-11-07** (#532); **step 0d done 2026-11-07** (AFD's Rust host-verified mode,
  `HumanRelay`, relay evidence and the form-mode approval relay); **step 0e done 2026-11-07** (AFD's Rust MCP Tasks),
  which completes the AFD prerequisites 0a to 0e; **step 1 done 2026-11-07** (Umbel's shapes); **step 1b done 2026-11-07** (`umbel-testkit-idp`, the test identity
  provider, and the host's `tests/no_auth_server.rs`); **step 2a done 2026-11-08** (the host's listener and layers);
  **step 2b done 2026-11-08** (the host's verification and principal); **step 2c done 2026-11-08** (the host's
  doctor and introspection); **step 3 done 2026-11-08** (the host's scopes, access, shared state and limits),
  with its follow-up to AFD (hidden commands) **done 2026-11-08**; **step 7 done 2026-11-08** (the stores' exact
  filtering; **a shipped build serves `oauth`**); **step 4 next**. Last
  verified 2026-11-03 against `main` at `e5b4e43c` (the specification's Status lists every file and line read; no Rust
  built), and for step 0a on 2026-11-07 against `main` at `ceefba8c` (below).
- **Done:** [the specification](phases/5-auth-hosted/spec.md), with D106 to D130 decided and the architecture amendments they
  need (the auth middleware row, the principal and usage-event interfaces and the present-human rule, the Built on AFD rows,
  section 7's access paragraph, rate limits, the versioning list, the phase table and specification list, the prerequisites
  rows, O5 closed, the glossary).
- **Owner's decisions, 2026-11-04, final; do not ask again** ([section 17](phases/5-auth-hosted/spec.md#17-for-the-owner)): the
  recommended option on questions 1 to 4; for 5 onward, in the owner's words, *"I am not an expert on these so I am fine going
  with your recommendations but lets make sure we are making good choices, not cutting corners, investing in the best
  outcomes, and being secure"*, so every question takes its recommendation, with two strengthenings:
  1. Principals `human:<namespace>/<subject>` from non-pairwise subjects; clients and services by namespace (D110).
  2. An agent reads its person's filter narrowed to its token's spaces (D111).
  3. Verbs `read`, `write`, `approve`, `erase`, per space, resolved per call; scopes only narrow; readability before scope (D112).
  4. Groups may take members from one issuer's claim (D113).
  5. Gateways are trusted for identity only, through a pinned channel and a signed per-request assertion (D114).
  6. A person is proven at the CLI's terminal or on the person page; **strengthened: user verification is mandatory**, so
     `auth.person` fails on an empty `acr_values` and every login must show a user-verification `amr` (D115).
  7. The MCP approval relay: approve and reject, per area, host-verified, through the person page (D116, amends D99).
  8. `memory-confirm` over MCP at `verified`, own records only; `curator-promote` stays CLI (D117).
  9. `memory-erase` blind, verified, with a dry-run plan and a notice; **strengthened: a configurable two-person rule**,
     `erase_approvals` 1 or 2, default 1 only because a single-administrator deployment could not erase otherwise (D118).
  10. Only a record's principal or a verified person in `editors` changes another's shared memory (D119), answering phase
      3's follow-up.
  11. A host-run, redaction-only sweep for drafts their proposer cannot read (D120, amends D101), answering phase 4's step 3b
      limit.
  12. Outbound credentials stay D43; per-caller exchange waits for O1 (D121).
  13. Content-free usage events (D122).
  14. Single-tenant; O5 closed (D123).
  15. No OpenTelemetry export in phase 5 (D124).
  16. The operator's `local_id` is namespaced in hosted modes, with one-way legacy equivalents (D129).
  17. Only the CLI is an operator (D130).
- **Done:** step 0a, the AFD spec (documents and cases only), 2026-11-07, in the step 0a pull request:
  [`spec/authorization.md`](../../../spec/authorization.md) (M1 to M8: where it applies, the one bearer token, the
  verification rules with a closed list of rule codes, the audience, `credentials`, the 401 and 403 forms and bodies,
  static scopes and the `ScopeResolver` with the 403 before dispatch, `INSUFFICIENT_SCOPE` after routing, list
  filtering with `cacheScope: "private"`, RFC 9728 metadata, the principal binding) and its cases in
  [`spec/authorization.json`](../../../spec/authorization.json) (13 sections, 184 cases, beside `spec/vectors/`
  because no language loads them yet); [`spec/command-metadata.md`](../../../spec/command-metadata.md) gains
  `scopes`, `confirmationMode: "host-verified"` and `task`, #532's binding of confirmation and approval-relay
  state, the host-verified mode with `HumanRelay`, relay evidence and Tasks; `INSUFFICIENT_SCOPE` and
  `TASK_TOKEN_EXPIRED` specified in [`spec/error-codes.md`](../../../spec/error-codes.md) (joining the catalog in
  0b and 0e, so `vectors/error-codes.json` is unchanged); `tool-strategies.md`, `protocol-conformance.md`,
  `CHANGELOG.md` (`VERSION` unchanged) and the language parity rows (Planned); the
  [MCP Authorization](../../../docs/features/active/mcp-authorization/mcp-authorization.proposal.md) and
  [MCP Tasks](../../../docs/features/active/mcp-tasks/mcp-tasks.proposal.md) proposals moved to
  `docs/features/active/` with A4, A5, T1 and T5 annotated. Fifteen choices the specification left open are in its
  [Amendments from step 0a](phases/5-auth-hosted/spec.md#amendments-from-step-0a), none on the trust model.
  Verified 2026-11-07: Rust's confirmation gate (`confirmations.rs:239-348`) and approval middleware
  (`approval/middleware.rs`), TypeScript's `mcp-modern.ts` state codec and Python's SDK confirmation channel read
  for the #532 rows; rmcp 3.8.0's URL elicitation and task models; every expected value in `authorization.json`
  computed with Node from the rules as written. Gates on 2026-11-07: `pnpm check` passed (lint, build, typecheck,
  test, tooling tests); the `python.yml` and `alfred.yml` steps passed; the `rust.yml` legs passed except
  `cargo test --features server`, whose `tests/server_resources.rs` fails 7 Skills cases (`-32601`) when the
  unlocked crate resolves `rmcp` 3.9.0, and passes with `rmcp` 3.8.0 pinned: a regression outside this step,
  recorded in the follow-ups. `cpp.yml` was not run locally (no `cmake` on the machine).
- **Done:** step 0b, AFD's Rust `server-auth` feature, 2026-11-07, in the step 0b pull request: `afd::server::auth`
  (`Authorization` on `McpServer::with_authorization`; `McpServer::bearer_layer()`, the `BearerLayer` that serves
  RFC 9728 metadata at both paths, takes the one bearer token, verifies it, answers M5's exact 401 and 403, decides
  every command a `tools/call` names before dispatch and strips the token; `JwtVerifier` with `TokenRules`,
  `JwtIssuer`, `SigningAlgorithm`, `KeySource`, `StaticKeys` and `ClientCertificate`, every M3 rule in AFD's own code
  and `jsonwebtoken` 11.1 on `aws-lc-rs` for the signature only; `TokenVerifier` and `check_introspection` for the
  host's introspection; `ScopeResolver`, `ScopeDecision`, `static_decision`, `forbidden_scopes`; `ProtectedResource`;
  `RuleCode` logged at `warn` with the issuer alias). The server fails closed without the layer, puts
  `CommandContext::credentials` and the default actor on every call, decides again after the context hook and
  before the confirmation gate (`INSUFFICIENT_SCOPE`, which joins the shared catalog with its constants in all four
  languages, 47 codes), and filters listings with `cacheScope: "private"`. In the core crate: `afd::Credentials`,
  `CommandDefinition::with_scopes` (in `_meta`, grouped actions and `afd-detail`), `is_scope_token`,
  `principal_binding` and `credentials_binding` (M8, for 0c). `rust.yml` and `suites.mjs` gain the `server-auth`
  clippy and test legs, and `rust.yml` triggers on `spec/authorization.json` (and, in the
  coordinator's follow-up commit, on every spec case file the Rust tests load). Twenty choices are in the
  specification's [Amendments from step 0b](phases/5-auth-hosted/spec.md#amendments-from-step-0b), the
  cross-language ones written back into `spec/authorization.md`; none changes the trust model. An
  independent security review's nine findings are fixed on the same branch, each with a regression
  test in `tests/server_auth_hardening.rs` that fails without it, and recorded there as "(review)" rows:
  suggestions and hidden groups, any `Missing` refusing, fail closed on untrusted transports and on
  credentials not admitted for the server (`Authorization::admit`, `McpServer::authorized_http_service`,
  `with_trusted_transport`), the resolver again at execution on the validated input, per-caller
  resources (additive `ResourceProvider::list_for` and `read_for`), JSON-RPC batches refused, `exp`
  before `iat`, and the actor redacted in debug output. Verified
  2026-11-07 with every `rust.yml` leg, the wasm32 checks, the docs.rs build and `pnpm verify` (exit codes in the
  step 0b pull request).
- **Done:** step 0c, [#532](https://github.com/lushly-dev/afd/issues/532), 2026-11-07, in the step 0c pull request
  (stacked on step 0b's): confirmation `requestState` bound to the call's principal binding (M8) in TypeScript,
  Python and Rust, as integrity-protected input that never appears in the state, and a mismatch refused exactly as
  a tampered state is. Rust: the gate's HMAC associated data (`confirmations.rs`, a versioned layout) holds
  `afd::principal_binding` of the actor the hook left and `CommandContext::credentials`; `confirmation_binding`
  takes the principal (breaking, `server` feature). TypeScript: one HMAC bind tag over the method,
  `authInfo.clientId` and `principalBinding` (the actor the commands run with and `createContext`'s
  `credentials`) covers the round's state, so confirmation and approval-relay answers alike;
  `principalBinding`, `credentialsBinding` and `PrincipalCredentials` exported. Python: the SDK's sealed state,
  through `RequestStateSecurity(bind_principal=...)` with the server's `actor` and the SDK-verified token, so a
  mismatch is the SDK's `-32602`, as tampering is; `afd.server.principal_binding`, `credentials_binding` and
  `PrincipalCredentials`. TypeScript and Python load the `principalBindings` cases of `spec/authorization.json`.
  Each language's suite proves a state issued to one actor (and, where credentials exist, one issuer, subject and
  client) is refused for another with the tampered answer, that the same caller still succeeds, and that a state
  minted before the change fails closed; each fails with the binding removed. Credentials with a missing or empty
  issuer, subject or client id are never bound in any language: no state is minted and a retry is refused, both
  as an internal error naming no one (the coordinator's decision on this step's first question). Rust and Python
  have no approval relay yet (step 0d builds Rust's). Python has no per-request context hook, so its
  confirmations bind the server's fixed actor: a parity follow-up,
  [#800](https://github.com/lushly-dev/afd/issues/800). Choices are in the specification's
  [Amendments from step 0c](phases/5-auth-hosted/spec.md#amendments-from-step-0c).
- **Done:** step 0d, AFD's Rust relay, 2026-11-07, in the step 0d pull request (on top of steps 0a to 0c, merged):
  `CommandDefinition::with_confirmation_mode(CommandConfirmationMode::HostVerified)` (`confirmationMode` in `_meta`,
  grouped actions and `afd-detail`; named apart from the server's `ConfirmationMode`); the `HumanRelay` trait with
  `RelayCall`, `RelayPrompt` and `RelayOutcome` on `McpServer::with_human_relay`; the gate that never sends a form or
  takes an acknowledgement or form answer for such a command, whatever `confirmations` says, relays only one command
  per call on MCP 2026-07-28, validates before `begin`, answers with one URL-mode elicitation whose `elicitationId` is
  the URL's digest and never to a client without URL mode, and maps `decline`, `cancel` and the four outcomes as the
  spec gives; relay evidence in a crate-private context field, checked by the approval middleware in rule 3's order and
  spent once as `relay:<decisionId>` for 24 hours, removed before the handler runs; `afd::input_digest`, which
  `tests/authorization_cases.rs` now checks the `inputDigests` cases against; and the form-mode approval relay
  (`ApprovalRelay::McpElicitation`), sharing one principal-bound `requestState` per call with the confirmation
  (`afd.confirm.v3`; older states are asked again). Tests: `tests/server_human_relay.rs` end to end with a fake
  relay, additions to `tests/server_confirmations.rs`, and unit tests of the evidence checks; a mutation pass removed
  each security check in turn and a test failed for every one but two second-layer guards behind tested checks. An
  independent security review found no blocker and two improvements (no token on the form relay's MCP fallbacks
  whatever `with_include_token` says; a test for the scope check before `begin`), fixed with a regression test each.
  Choices are in the specification's [Amendments from step 0d](phases/5-auth-hosted/spec.md#amendments-from-step-0d).
  Verified 2026-11-07 with every `rust.yml` leg, the wasm32 checks, the docs.rs build and the rest of the
  `pnpm verify` plan (exit codes in the step 0d pull request); Umbel's `cargo test` ran in batches with test
  executables pruned between them, plus `umbel-plugin-curator`, which the batch scripts leave out.
- **Done:** step 0e, AFD's Rust tasks, 2026-11-07, on `lush/afd-rust-tasks` (on top of steps 0a to 0d, merged),
  completing the AFD prerequisites 0a to 0e: `CommandDefinition::with_task(TaskSupport)` (`task` in `_meta`, grouped
  actions and `afd-detail`), refused at registration beside `confirm_prompt`, an approval policy or
  `confirmation_mode` (the `validate_person_gates` hook step 0d left); `afd::server::tasks` with the `TaskStore` trait
  (3.3's shape: `create` durable before returning, `get` and `update` by owner, `expire`), the bounded
  `InMemoryTaskStore` (32 tasks per owner, 256 in all), `TaskOptions` (`ttlMs` 1 hour, `pollIntervalMs` 1 s, a 1 s
  check interval, results kept to 1 MiB), `McpServer::with_task_store` and `with_task_options`; the `tasks/get`,
  `tasks/update` and `tasks/cancel` handlers on `rmcp` 3.9's task types and hooks (not its `TaskManager`); tasks only
  for single-command calls on MCP 2026-07-28 requests that declare the extension, `-32021` for `required` otherwise,
  and `INVALID_BATCH_REQUEST` or `INVALID_PIPELINE_REQUEST` for a batch or pipeline naming a `required` command; 128-bit
  ids; the owner as the principal binding, checked by the store and again by the server, with one byte-identical
  `-32602` for another principal's, an expired or an unknown task; the runner's `CancellationSignal` on `tasks/cancel`,
  the TTL and the credentials' `expiresAt` (`TASK_TOKEN_EXPIRED`, which joins the shared catalog, 48 codes, in all four
  languages); `CommandContext::report_progress` and `cancellation`. Tests: `tests/server_tasks.rs` over Streamable HTTP
  (with and without the bearer layer) and stdio, on a manual clock; a mutation pass removed each security check in turn
  and a test failed for every one. An independent security review found no blocker and seven improvements, fixed with
  a regression test each: a handler that returned before a cancel keeps its result, and `TASK_TOKEN_EXPIRED` is not
  retryable for a mutation that may have run; finished tasks make room in a full store; at most 64 tasks run per
  process; `TaskOptions` clamps behind getters; `with_ttl_capped_at_token_expiry(grace_ms)` lets a host end a task's
  TTL at its token's `exp` (12.2); the in-server fail-closed check on `tasks/*` is tested; and a server that cannot tell
  its HTTP callers apart creates no task (settled by the strictest reading: no extension declared, `optional` inline,
  `required` refused with `UNAUTHORIZED`; tasks over HTTP need verified credentials or
  `TaskOptions::with_callers_identified_by_hook()` with a hook). Choices are in the
  specification's [Amendments from step 0e](phases/5-auth-hosted/spec.md#amendments-from-step-0e).
- **Done:** step 1, Umbel's shapes, 2026-11-07, in [#823](https://github.com/lushly-dev/afd/pull/823) (on top of steps 0a to 0e, merged):
  - **Schemas**, each closed JSON Schema 2020-12 with examples: `workspace-config.v5`, `plugin-manifest.v5`,
    `principal.v1`, `provenance-envelope.v3` and the shapes nesting it (`event.v3`, `memory-record.v2`,
    `proposal.v3`), `cursor.v1`, `locator.v2`, `task-record.v1`, `usage-event.v1`, `person-decision.v1` and
    `protected-resource.v1`.
  - **Configuration version 5** (`src/workspace/hosted.rs`), parsed into typed configuration and validated with
    every rule of section 2.2 at open (`WORKSPACE_CONFIG_INVALID` with `details.key`): `[auth]` (modes, the scope
    prefix, namespaces with their person logins, issuers, the gateway), `[http.tls]` and `http.public_url`,
    `[limits]`, `[usage]`, `[principal.equivalents]`, group claims, and the `memory_write` table's `editors`,
    `erasers`, `erase_approvals` and `erase_approval_window_s`. Versions 1 to 4 read as version 5 with `auth.mode
    = "none"` and refuse the new keys ("needs config_version = 5"); `umbel init` writes version 5.
  - **Manifest version 5** (`src/plugins/manifest/v5.rs`): `person` per surface on a `require-human` command, MCP
    exposure of such a command only with `person.mcp`, the preview and `journal.keep` rule, `task` and its
    refusals, both on pipelines with the "every step admits" rule at seal (`pipelines::plan`). Versions 1 to 4
    still load; `spec/plugin-manifest.md`'s P3 lists `task` and `person` as Umbel's from version 5.
  - **Constants** in `src/auth/mod.rs` (the scope grammar and order, the namespaced id form, the defaults and
    bounds), and the version lists `workspace-show` reports (`config` and `manifest` 1 to 5, `principal` 0 and 1,
    `envelope` and `event` 0 to 3, `proposal` 1 to 3, `cursor` 0 and 1, `locator` 1 and 2, `memory` 1 and 2,
    `task`, `usage` and `person` 1).
  - **Fail-closed seams until later steps:** a hosted configuration opens, but the HTTP surface refuses to start in
    a hosted mode, with `[http.tls]` or on a non-loopback bind until step 2a builds the listener; a `require-human`
    command with `person.mcp` stays off MCP, and every call to one with `person.cli = "verified"` is refused with
    `PERSON_VERIFICATION_UNAVAILABLE`, until step 5.
  - An independent review found one blocker (a `person.cli = "verified"` command ran on the terminal check) and nine
    improvements, all fixed with tests and recorded as "(review)" rows in the amendments.
  - Tests: `tests/config_v5.rs`, `tests/manifest_v5.rs`, `tests/schemas/phase5.rs`,
    `tests/schemas/phase5_records.rs`; older tests follow the version bump. Choices are in the specification's
    [Amendments from step 1](phases/5-auth-hosted/spec.md#amendments-from-step-1).
- **Done:** step 1b, the test identity provider, 2026-11-07, in the step 1b pull request: the test-only crate
  `umbel-testkit-idp` (`endpoints/umbel/testkit-idp`, `publish = false`, quarantined in the release inventory with no
  route, no binary). `TestIdp::start()` binds `127.0.0.1` with a test CA made in memory and plays three roles on one
  HTTPS listener: an OpenID Connect identity provider (discovery at the path-inserted and appended well-known URLs,
  a JWKS, a scripted login or a password form for `ada`, `bo` and `cy`, a PKCE `S256` token endpoint issuing ID tokens
  with `nonce`, `auth_time`, `acr`, `amr` and `groups`, and the RFC 8693 exchange to an ID-JAG); a resource
  authorization server (RFC 8414 metadata, a JWKS, authorization code with PKCE, client credentials, the RFC 7523
  grant redeeming an ID-JAG, RFC 9068 tokens for one audience, certificate-bound over mTLS, and RFC 7662
  introspection with client authentication); and the gateway signer of section 4.4. `TokenBuilder` with `Break`
  breaks one rule of section 3.2 at a time and names AFD's rule code; `IntrospectionAnswer`, `Fault`, metadata
  patches, key rotation, recorded authorization requests and a counting plain-HTTP listener script the rest; the
  kit runs on its own thread and runtime. Keys: RSA, P-256, P-384, Ed25519. Its suite (36 tests: 34 in six integration files, 2 unit tests)
  verifies the kit's access tokens with AFD's `JwtVerifier` and `check_introspection`, every break refused with its
  rule while the unbroken token passes. The host's `tests/no_auth_server.rs` (section 1) checks the manifest,
  `cargo metadata` reachability, the routing calls of every workspace crate and a probe of every router, and failed
  as it should under a mutation run. A repository-contract test holds the unit private and route-less. An independent review found one blocker
  (the token exchange's error for a bad subject token) and eight improvements, all fixed and re-reviewed. Choices are in
  the specification's [Amendments from step 1b](phases/5-auth-hosted/spec.md#amendments-from-step-1b). Verified
  2026-11-07 with `cargo fmt --all --check`, the workspace clippy, the kit's suite, `no_auth_server.rs`, Umbel's
  tests in batches and `pnpm check` (exit codes in the step 1b pull request).
- **Done:** step 2a, the host's listener and layers, 2026-11-08, in the step 2a pull request:
  - **The listener** (`Host::http_server`, `HttpServer::serve`; `src/surfaces/http/listener.rs`): HTTP/1.1 on hyper,
    as `axum::serve` is built, putting the socket's peer address and, from the TLS handshake, AFD's
    `ClientCertificate` in every request's extensions; never a header for either. `umbel serve --http` uses it; the
    bare `Host::http_router()` serves mode `none` without TLS only.
  - **TLS** (`http/tls.rs`): rustls 1.3 and 1.2 on the explicit `aws-lc-rs` provider, ALPN `http/1.1`, no session
    resumption, and `client_auth`: `none`; `ca` (required, chained to `client_ca`); `any` (optional, possession only,
    for RFC 8705 binding).
  - **Section 6.3's layers in order** (`http.rs`, `http/layers.rs`): the body size limit (413 on a declared length
    before anything reads it, and on a streamed body past the cap), the per-IP limit (a sliding minute on
    `state/shared/limits.sqlite3`, shared by every process, IPv6 by /64; 429 with `Retry-After`), `/health` and the
    protected-resource metadata at both well-known paths in public, then AFD's bearer layer and MCP service built
    from one authorized server (`authorized_http_service`), with hosted host checks on `http.allowed_hosts` alone.
  - **The context hook, version 1 skeleton** (`src/principal.rs`): over HTTP it dispatches on `auth.mode` and
    fails closed in `oauth` and `gateway`.
  - **What still failed closed** (step 2b lifted the first two): mode `oauth` refused to start in a shipped build until step 2b filled the token
    verifier slot from `[auth.issuers]` (only the `testkit` seam `HostBuilder::with_token_verifier` fills it now), and
    even then the hook refused every call until step 2b mapped credentials to a principal; mode `gateway` refuses to
    start until step 4; the per-token limit is step 3's; the doctor's `auth.*` checks are step 2c's.
  - The default `auth` feature (`afd/server-auth`, `tokio-rustls`, `rustls-pki-types`, `rusqlite`); `umbel-first-party`
    enables it.
  - Tests: `tests/auth_layers.rs` (each layer by what a request meets there, TLS and mTLS, the thumbprint from the
    handshake and never from a header, the metadata, the IP limit across two processes, the body caps, the 401 shape,
    a missing layer failing closed, stdio and the CLI unaffected, what refuses to start), `no_auth_server.rs` with the
    `oauth` router probed over TLS, and unit tests in `src/shared/limits.rs` and `src/surfaces/http/layers.rs`; a
    mutation run of thirteen checks (resumption, the hook's mode checks in `oauth` and `gateway`, the certificate,
    both body caps, the body deadline, a refused body staying refused, `client_auth = "ca"`, the hosted host list, the
    metadata's issuers, the host server's own authorization) failed each as it should.
  - An independent security review found two blockers (the host's own `mcp_server()` listed its tools over HTTP
    without the listener in a hosted mode, now fail-closed by an authorization that admits no one; and the documents,
    written after its snapshot), seven improvements and five nits (a connection cap, a body deadline, bounded
    and remembered limit checks, the system clock for limits, narrowed permissions, tests for forged identity and
    forwarding headers and the hook's gateway branch), all fixed with regression tests. Choices are in the
    specification's [Amendments from step 2a](phases/5-auth-hosted/spec.md#amendments-from-step-2a).
  - **Settled 2026-11-08** (the review's two rate-limit follow-ups; neither changes the trust model): no forwarded
    header is ever read, and step 3 adds an opt-in `http.trusted_proxies`, which accepts a PROXY protocol version 2
    header only from listed peers, for a same-host proxy; IPv6 peers stay keyed on their /64.
- **Done:** step 2b, the host's verification and principal, 2026-11-08, on `lush/umbel-p5-2b-verification`:
  - **Keys** (`src/auth/keys.rs`, `fetch.rs`): Umbel's `KeySource` over `reqwest`, with RFC 8414 discovery (path
    inserted, then OIDC inserted, then appended; only a 404 moves on), the `issuer` check, an `https` `jwks_uri`, no
    redirect, 1 MiB and 10 seconds per fetch, a cache of 5 minutes to 24 hours, at most one fetch a minute per issuer,
    and the last good keys kept until their cache ends, then fail closed.
  - **Verification** (`verifier.rs`, `introspection.rs`): AFD's `JwtVerifier` built from `[auth]` (the public URL,
    the skew, the lifetime, the scope prefix and limit, bound tokens, each issuer's algorithms), and the one
    introspection issuer with Umbel's client credentials and a 60-second cache of accepted answers by the token's
    SHA-256, bounded to 32 requests in flight and tokens of 4096 bytes. A fetch runs on a task of its own, so a client
    that hangs up cannot spend the minute's one fetch. A shipped build still refuses to serve `oauth` until the
    disclosure controls of steps 2c, 3 and 7 exist; the `testkit` seam `with_unfinished_oauth` serves it for tests. Settled 2026-11-08 as the
    strictest reading: a shipped build serves `oauth` only once 2c, 3 and 7 have all landed.
  - **The caller** (`mapping.rs`, `caller.rs`, `src/principal.rs`): section 4.1's mapping (namespaces, subject
    claims, services three ways, the `~` form), `act` from an `act` issuer, claim groups, into principal version 1,
    which every surface now writes (`humanPresent` stays `null` until step 5). The hook trusts the mapped caller only
    beside the credentials AFD admitted for the same request.
  - **Equivalents** (`src/access.rs`): consulted by readers, group members and reader-filter tokens, the memory
    services' ownership check, and the knowledge plugin's self-approval through the SDK's new
    `CallContext::equivalents`.
  - **Until step 3** (`interim.rs`): only unqualified scopes authorise a verified call, and every request needs
    `<prefix>:read` itself (plus write, approve or erase as the command needs); space-qualified scopes alone get a
    403 naming the unqualified ones.
  - **What still fails closed or waits:** serving `oauth` in a shipped build (until 2c, 3 and 7); space-qualified
    scopes, 5.4's one answer, 9.4's listings and `Caller` in `reader_filter` (step 3); hidden counts (step 7); the
    doctor's `auth.*` checks, `auth-show` and `workspace-show`'s hosted answer (2c); `gateway` (step 4); `humanPresent` and the person
    page (step 5); the memory plugin's own equivalents (step 10) and cursor files (step 7).
  - Tests: `tests/auth_tokens.rs` (every rule of 3.2 broken alone by the kit through the host, with its logged code;
    routing; the `[auth]` settings; bound tokens; introspection and its cache), `tests/auth_keys.rs`,
    `tests/token_canary.rs`, `tests/principal_v1.rs`, and unit tests in `src/auth/` and `src/access.rs`. Choices
    are in the specification's [Amendments from step 2b](phases/5-auth-hosted/spec.md#amendments-from-step-2b).
  - An independent security review found two blockers (a client hanging up mid-fetch spent the minute's one key
    fetch; lifting `oauth`'s refusal would have served disclosures later steps close) and six improvements, all
    fixed with regression tests.
- **Done:** step 2c, the host's doctor and introspection, 2026-11-08, on `lush/umbel-p5-2c-doctor`:
  - **The doctor's hosted profile** (`src/auth/doctor.rs`, `src/auth/files.rs`): every `auth.*` check of section
    6.1 with its severities, after `http.config`: `auth.mode` (warns while this build does not serve the mode),
    `auth.public_url`, `auth.tls` (every certificate's validity, the key readable by its owner only, trust files
    writable by no one else, the listener's own loading, the gateway's pinned key set), `auth.ca_files`,
    `auth.issuers` (3.3's discovery, the key set and its fit to the algorithms, the introspection endpoint called
    with Umbel's credentials and a made-up token), `auth.subjects`, `auth.services`, `auth.principals` (every
    principal the configuration grants to), `auth.person`, `auth.secrets` (by variable name, never a value),
    `auth.shared` (writable, and a local file system by `statfs`) and `auth.confirmations`. No check prints a
    secret, a token, a key or a remote value.
  - **The doctor is the operator's** in a hosted mode: CLI only, and its handler refuses any other caller.
  - **`auth-show`**: the caller's own projection, exactly section 10.3's eight members, never a token or claim.
  - **`workspace-show`'s hosted answer**: no name or path, only the spaces the caller reads, for every caller but
    the operator; `access` says `verified`, with statistics `shared` until step 7.
  - **`ca_file`** (the follow-up settled 2026-11-08): `[auth.issuers.<alias>] ca_file` in configuration version 5
    and its schema; the verifier gives that issuer a client trusting only those roots, and refuses to start on a
    file that is unreadable, empty, expired or not yet valid.
  - **Serving `oauth`** in a shipped build is still refused (settled 2026-11-08: only once 2c, 3 and 7 have
    landed); 2c's control is in, and 3 (5.4's one answer, 9.4's listings, and the plugin listings that name
    spaces, found here) and 7 (hidden counts) remain.
  - Tests: `tests/doctor_auth.rs`, `tests/auth_show.rs`, the `ca_file` cases of `tests/auth_keys.rs`,
    `tests/config_v5.rs` and `tests/schemas/phase5.rs`, and unit tests in `src/auth/doctor.rs` and `files.rs`.
    No plugin crate changed. Choices are in the specification's
    [Amendments from step 2c](phases/5-auth-hosted/spec.md#amendments-from-step-2c).
  - An independent security review found one blocker (`auth.subjects` and `auth.person` read the RFC 8414
    document where the provider's OpenID Connect discovery document could say otherwise) and eight improvements
    (a `ca_file` root expiring after start stayed trusted; two time limits where the verifier has one; file owners
    and directories unchecked; unbounded file reads; the operator test without the CLI interface; the doctor's
    gate following only the sealed configuration; missing tests; a login-only issuer's `ca_file`, a step 5
    follow-up), with four nits; all fixed, each with a regression test where one can be written.
  - Verified 2026-11-08 on the branch: `cargo fmt --all --check`; the workspace clippy `-D warnings`, the three
    `--no-default-features` legs, the SDK and hello leg, the `wasm32-wasip2` leg and the two plugin jobs' clippy;
    the component builds and `hello-mcp`; Umbel's host tests in batches (88 suites, 1022 tests) and the other
    crates, conformance and external clients (139 suites, 937 tests; 34 of 34 cases on each conformance lane);
    `pnpm check`; Loam's web build and `test:mounted` (24 tests). All exited 0.
- **Done:** step 3, the host's scopes, access, shared state and limits, 2026-11-08, on `lush/umbel-p5-3-scopes`:
  - **Scopes** (`src/auth/scopes.rs`, `scope_gate.rs`): section 5.2's rules as one policy fixed at seal, for
    Umbel's `ScopeResolver` (the 403 before dispatch, `Defer`, `visible`, and AFD's check at execution) and the
    scope gate inside the registry. A call needs `read` in each of its spaces (its `space` or `spaces` input, else
    the default space), `write` there for a mutation, `approve` for an approval policy, a host-verified mode or
    `require-human`, `erase` for an erase; a space-less command needs any Umbel scope plus its other verbs
    unqualified, and a mount without `bind_space` unqualified `write`. A token with no Umbel scope is 403 on every
    request. Step 2b's interim rule is gone.
  - **One answer** (`src/access.rs`, `src/middleware.rs`): `Caller` in every `reader_filter`; an undeclared space
    and one the caller may not read, or its token grants nothing in, answer byte for byte alike to every hosted
    caller but the operator (stdio and the library included), on every route, with nothing of the space in the
    answer; readability before scope and before `PLUGIN_NOT_ENABLED`. Mode `none` and the operator are unchanged.
    The resolver finds each request's mapped caller in an in-flight book, and defers when it cannot.
  - **Listings**: `space-list`, `plugin-list`, `plugin-show` and `skill-list` name only the spaces, instances and
    skills of spaces the caller reads (2c's follow-up); counts stay step 7's.
  - **Shared state** (`src/shared/nonces.rs`): `state/shared/nonces.sqlite3`, an atomic spend across processes, in
    the approval middleware (approval nonces and `relay:` evidence) in hosted modes; a failed spend is answered as
    the store's failure. Mode `none` keeps AFD's store in memory.
  - **Limits**: the per-token limit at layer 6 (`calls_per_minute`, per issuer, subject and client) and the read
    limit in the registry (`read_bytes_per_minute` per effective principal, checked before the handler on bytes
    already used, opened on the first limited call), on `limits.sqlite3`'s counters (schema version 2), each named
    by an HMAC under the new `state/keys/limits.key`.
  - **`http.trusted_proxies`** (2a's settled follow-up): a PROXY protocol version 2 header read only from listed
    peers and required of them, its client keying the per-IP limit; a configuration version 5 key with its schema
    and the doctor's `auth.trusted_proxies`.
  - **Serving `oauth`** in a shipped build is still refused: 2c's and 3's controls are in, and step 7 (hidden counts
    and positions) remains.
  - Tests: `tests/scope_gate.rs`, `space_visibility.rs`, `shared_nonces.rs`, `limits.rs`, `confirm_binding.rs`,
    `trusted_proxies.rs`, and unit tests in `src/auth/`, `src/access.rs`, `src/shared/` and
    `src/surfaces/http/listener.rs`. No plugin crate changed. Choices are in the specification's
    [Amendments from step 3](phases/5-auth-hosted/spec.md#amendments-from-step-3).
  - **Hidden instances**: a plugin command whose instance serves no space a token-narrowed hosted caller reads
    answers as an unknown command; a space member a command does not declare is refused before anything reads it.
  - A mutation run removed each security check in turn; a test failed for each (one equivalent mutant, recorded).
    An independent security review found one blocker (an undeclared `spaces` member reached spaces the scope rules
    never checked) and six improvements (a hidden instance revealed by calling it; a withheld grant's note; mode
    `none` and the operator depending on `state/shared/`; a failed spend answered as a spent token; the caller
    lookup's linear scan; reversible counter names), with six nits; all fixed with regression tests. One follow-up
    went to AFD (a hidden command must look unknown before input validation too), done the same day (below).
  - Verified 2026-11-08 on the branch: `cargo fmt --all --check`; the workspace clippy `-D warnings`, the three
    `--no-default-features` legs, the SDK and hello leg, the `wasm32-wasip2` leg and the two plugin jobs' clippy;
    the component builds and `hello-mcp`; Umbel's host tests in batches (91 suites, 1070 tests) and the other
    crates, conformance and external clients (139 suites, 937 tests); `pnpm check`; Loam's web build and
    `test:mounted` (24 tests). All exited 0.
- **Done:** step 3's follow-up to AFD, hidden commands, 2026-11-08, on `lush/afd-rust-hidden-before-validation`:
  `spec/authorization.md` M6 specifies them, and AFD's Rust server answers a command its resolver's new `known`
  rejects (with filtered listings) byte for byte as an unknown name on every route, before validation, middleware,
  confirmation, relay or task. Umbel's resolver implements `known` as 9.4's hidden instance (`ScopePolicy::known`),
  wider than `visible`, so a command the caller may learn of but not call keeps 5.4's 403 naming its missing scope.
  The hidden-instance check stays as defence in depth. Tests: `tests/space_visibility.rs` (invalid, valid and no
  input, through the command's own tool, `afd-call`, `afd-batch`, `afd-pipe` and `afd-detail`) and a unit test in
  `src/auth/scopes.rs`. Choices are in the specification's
  [Amendments from AFD's hidden commands](phases/5-auth-hosted/spec.md#amendments-from-afds-hidden-commands).
- **Done:** step 7, the stores' exact filtering, 2026-11-08, on `lush/umbel-p5-7-exact-filtering`:
  - **Knowledge statistics per reader filter** (9.1; `store-embedded/src/index/stats.rs`): a search scores through
    tantivy's `Bm25StatisticsProvider` over the chunks its reader may read, deleted ones excluded, with exact
    per-chunk token counts in index schema 2's `len_<field>` fast fields (equal to tantivy's own totals on an index
    without deletes); cached per segment set and filter. A prefix expands only into terms a readable chunk holds,
    and a snippet weighs its terms by readable chunks. `index/v1/` is removed when schema 2 opens; the next
    `knowledge-index` rebuilds.
  - **Memory BM25 per reader filter** (9.2; `store-embedded/src/memory/rank.rs`): recall ranks every readable match
    with FTS5's own `bm25()` formula over the reader's statistics (its readable records, their lengths, and how many
    hold each phrase), tokenised by `umbel-store`'s memory tokenizer (a port of FTS5's `porter unicode61
    remove_diacritics 2`, held to FTS5's own tokens over every non-ASCII code point); ties by authority tier, then
    recency, then id; over 50 000 readable matches is `MEMORY_QUERY_TOO_BROAD`.
  - **Positions** (9.3; `src/positions.rs`): to a hosted caller that is neither the operator nor stdio, cursors are
    version 1, revisions `r1.` tokens, a locator version 2, each the sealed last position it can read
    (XChaCha20-Poly1305 with a synthetic nonce under `state/keys/cursor.key`); `event-list` pages, heads and event
    views (`event-view.v1`: no `seq`, `journalSeq`, `changes` or record version), `event-ack`, `space-list`'s counts,
    every revision the knowledge and context plugins show (through the SDK's `Cx::doc_position`), the plugin gate's
    `dev.umbel/index`, `dev.umbel/changes` and record versions (the changes and versions kept whole for the
    journal under a random reference), `knowledge-index`'s totals and limit, and `sources-sync`'s and
    `sources-status`'s counts. Revisions are the last readable document change, so space-readable bookkeeping
    records move no position. `store-show`, `event-rebuild`, `store-check` and `store-backup` are the operator's in
    hosted modes, from the library too. Mode `none`, the operator and stdio are unchanged.
  - **Follow-ups closed:** event ids and sequence numbers (step 1), `space-list`'s counts (step 3),
    `workspace-show`'s `statistics: "per-filter"` (step 2c), stored cursor files consulting the equivalents (step
    2b).
  - **Serving `oauth`**: lifted. A shipped build serves mode `oauth`; the `testkit` seam `with_unfinished_oauth` is
    removed. `gateway` still waits for step 4, and person-gated commands for step 5.
  - **The eval** re-ran (`eval_gate.rs`): leaks 0, every unanswerable query empty, and every metric equal to
    `eval/baseline.json` to four places (overall with expansion: recall 1.0, nDCG 0.9273, MRR 0.9207; without:
    recall 0.8919, nDCG 0.9123, MRR 0.8784), before and after the review's fixes, so the baseline is unchanged.
  - **Independent security review** (read-only, of the diff against the specification): two blockers and seven
    improvements, all fixed with a regression test each (`knowledge-index`'s limit and lists, cursor files per
    person on a shared client, ties past the collector's window, the CLI-only built-ins from the library, the
    journal's stash reference, positions moved by sources' sync state, `sources-sync` and `sources-status` counts).
    AFD's numbered batch trace ids, a prefix's expansion time and three source-tree signals of `sources-sync` are
    follow-ups.
  - Tests: `store-embedded/tests/partitioned_stats.rs`, `store/tests/memory_tokenizer.rs`, `tests/cursor_v1.rs`,
    `eval_gate.rs`, `first-party/tests/exact_filtering.rs`, and unit tests in `stats.rs`, `rank.rs`, the tokenizer
    and `positions.rs`. Plugin crates changed (`knowledge`, `context`, `memory`, `sources-filesystem`). Choices are in the specification's
    [Amendments from step 7](phases/5-auth-hosted/spec.md#amendments-from-step-7).
- **Not done:** steps 4 to 6 and 8 to 12 of the [plan](phases/5-auth-hosted/spec.md#16-implementation-plan).
- **Next:** step 4 (it needs 3); 5 needs 3 as well as 0c and 0d; 8 needs 0e and 3. Heavy steps follow the plan's
  build note. Steps 4 to 12 take
  `umbel-testkit-idp` from `[dev-dependencies]`; step 4 adds its `gateway` router to `no_auth_server.rs`'s
  `routers()`, with a fresh assertion per request, and spends each assertion's `jti` in the nonce store
  (`NonceStore`, key `gateway:<jti>`).
- **Waiting on the owner:** nothing. Every phase 5 decision is final.
- **Follow-ups:** the [specification's list](phases/5-auth-hosted/spec.md#follow-ups).

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-10-30 | Design session | Land the phase 0 prerequisites in `packages/rust`; the lazy strategy, meta-tools and contexts are already parity item D1 and #465 is open | Done 2026-10-31: see the AFD prerequisites detail above |
| 2026-10-30 | Design session | Decide the execution model, open decision O2 | Done 2026-10-31: the owner chose the hybrid strategy, recorded as [D27](decisions.md) in [#522](https://github.com/lushly-dev/afd/pull/522), open until merged |
| 2026-10-30 | Design session | Decide the first external integration, open decision O1; it sets the connector contract | Open, owner's decision |
| 2026-10-30 | Design session | When crates land, add the units under `endpoints/umbel/` to the release inventory (`scripts/release/inventory.json`, D21); units start quarantined. Corrected 2026-10-31: `architecture.json` needs no change, since the boundary check classifies endpoint manifests by path | Open; specified 2026-10-31 as step 1 of the [phase 0 plan](phases/0-host-skeleton/spec.md#11-implementation-plan) (one unit, `umbel`, private, no route). Corrected again 2026-10-31 in the phase 0 review: `architecture.json` gains an explicit unit with `publicSurfaces`, as Botcore and Health have (D21, D35) |
| 2026-10-30 | Design session | Harness channels must negotiate MCP 2025-11-25 or earlier; keep the SDK's compatibility on push paths and re-check watchlist row W15 | Open |
| 2026-10-30 | Design session | Refresh the trajectory watchlist rows before each phase specification, in particular W2 and W3 ahead of 2027-03-30 | Open, recurring; refreshed 2026-10-31 for phase 0 |
| 2026-10-30 | End-to-end review | Write `docs/features` proposals, spec first, for the hybrid tool strategy, for resources, prompts and Skills over MCP in AFD servers reconciled with the Skill Knowledge Layer (shared with Loam, which also needs `ui://` resources), and for per-tool output budgets | Open. Hybrid tool strategy: [proposal](../../../docs/features/active/hybrid-tool-strategy/hybrid-tool-strategy.proposal.md) written and approved 2026-10-31. Resources and Skills over MCP: [proposal](../../../docs/features/active/mcp-resources-skills/mcp-resources-skills.proposal.md) and spec written and approved 2026-11-01 (phase 1 step 0a), prompts deferred to its next step. Output budgets: [proposal](../../../docs/features/active/output-budgets/output-budgets.proposal.md) and spec written and approved 2026-11-01 (phase 2 step 0a) |
| 2026-10-30 | End-to-end review | Reconcile vocabulary and the proposal record with the Agent Engine proposal, whose modules are Umbel's plugins and whose loop overlaps the curator | Open |
| 2026-10-30 | End-to-end review | Over MCP, the Rust approval middleware includes approval tokens by default; Umbel must turn that off on the MCP path. Re-checked 2026-10-31: [#518](https://github.com/lushly-dev/afd/pull/518) closed #460 with the private in-process exchange, and the default on the MCP path is unchanged | Open |
| 2026-10-31 | Owner review | Confirmation `requestState` is bound to the command and input, not the actor; with the context hook admitting several actors, one could replay another's confirmation | Done 2026-11-07: phase 5 step 0c binds the principal in TypeScript, Python and Rust; the step 0c pull request closes issue [#532](https://github.com/lushly-dev/afd/issues/532) |
| 2026-11-07 | Phase 5 step 0c | AFD Python: no per-request context hook, so MCP calls run with, and confirmations bind, the server's fixed `actor`; a host that tells callers apart without SDK tokens cannot separate their confirmations | Open: [#800](https://github.com/lushly-dev/afd/issues/800), a parity gap; not needed by Umbel |
| 2026-10-31 | Owner review | A panicking command handler hangs the Rust MCP request | Done: fixed in [#539](https://github.com/lushly-dev/afd/pull/539) |
| 2026-10-31 | Phase 0 specification | AFD: let `DirectClient` take the CLI interface, so the Umbel CLI stops checking `expose.cli` itself (D34) | Superseded 2026-10-31: now step 0 of the [phase 0 plan](phases/0-host-skeleton/spec.md#step-0-the-afd-pull-request) |
| 2026-10-31 | Phase 0 specification | AFD: the Rust telemetry middleware, which replaces Umbel's interim one (D33); in the prerequisites table for phase 2 | Superseded 2026-10-31: D33 dropped, no interim middleware; the prerequisite row stays for phase 2 |
| 2026-10-31 | Phase 0 specification | A journal sink failure never changes a command's result, so a lock timeout or a full disk loses a journal entry and its event while the command succeeds; decide whether audited mutations need a fail-closed mode before phase 2 writes records | Specified 2026-11-01 in the [phase 2 specification](phases/2-knowledge/spec.md) as D66 (fail-open, store changes carry trace ids, `store-check` reports gaps), in review; an owner point |
| 2026-10-31 | Phase 0 specification | Several stdio harnesses on one workspace contend for the writer lock (D29); consider `umbel serve --stdio --proxy <url>` | Superseded 2026-10-31: D29 amended, any number of processes share a workspace |
| 2026-10-31 | Phase 0 review | The phase 2 embedded store must support several processes on one workspace (for example SQLite in WAL mode, or LMDB), so D29's model survives; no single-writer daemon (D28) | Specified 2026-11-01 in the [phase 2 specification](phases/2-knowledge/spec.md) as D51 (SQLite in WAL mode and tantivy's writer lock, bounded waits), in review |
| 2026-10-31 | Phase 0 review | AFD: an accessor for `McpServer`'s default instructions, so a host can add a line without replacing them | Open, AFD, if wanted |
| 2026-10-31 | Phase 0 specification | Windows in the `umbel.yml` matrix (key permissions, file locks, signals) | Open, phase 7 |
| 2026-10-31 | Phase 0 specification | An external client check, `afd validate` against `umbel serve --http`, in CI; the client must send the bearer token | Open; specified 2026-11-01 as the `conformance` job of the [phase 1 plan](phases/1-plugin-contract/spec.md#14-implementation-plan), step 6 (D49) |
| 2026-11-01 | Step 4 | For the step 5 agent: the MCP cases of `journal_events.rs`, `trusted_keys.rs` and `process.rs`, and `Host::repair_events` at the start of `umbel serve` | Done 2026-11-01 in [#575](https://github.com/lushly-dev/afd/pull/575) |
| 2026-11-01 | Phase 0 step 4 | AFD's Rust schema validation has no `pattern` keyword, so a schema using it is refused at registration and the handler checks the `consumer` pattern itself (spec "Amendments from step 4"); decide whether AFD adds `pattern` across languages (see `spec/validation.md`) | Open |
| 2026-11-01 | Phase 1 specification | The owner's decision on the four trust-model points of the specification's section 11 | Done 2026-11-01: decided by the owner; recorded in the specification's section 11, D42 and D43 |
| 2026-11-01 | Phase 1 review | Operating-system sandboxing for stdio mounts: a stdio child runs as the host's user and can read `state/keys/` and every space (owner decision 2) | Open, a later phase; owner to place |
| 2026-11-01 | Phase 1 review | Carry the plugin inside the provenance envelope (version 0 is closed with no source field) | Specified 2026-11-01 in the [phase 2 specification](phases/2-knowledge/spec.md) as envelope version 1's `plugin` field (D55), in review |
| 2026-11-01 | Phase 1 specification | A precompiled component cache; wasmtime's `Component::deserialize` is `unsafe`, which the crate forbids | Open, phase 7 or when startup cost is measured |
| 2026-11-01 | Phase 1 specification | A mount's tool snapshot under `state/`, so one-shot CLI calls do not spawn every mounted server | Open, a later phase |
| 2026-11-01 | Phase 1 specification | WIT world 2.0.0 on WASI 0.3 when a wasmtime long-term line supports the async component model (about 60), or the owner decides to leave the long-term line (W17, restated after review) | Open |
| 2026-11-01 | Phase 1 specification | MCP prompts in AFD servers, after the resources and Skills proposal of step 0a | Open, AFD; recorded as the next step of the [proposal](../../../docs/features/active/mcp-resources-skills/mcp-resources-skills.proposal.md#implementation-plan) on 2026-11-01 |
| 2026-11-01 | Phase 1 specification | The `http` and `secrets` grants, each with a required per-instance `allow` list, and moving an HTTP mount's `bearer_env` under `secrets` | Open, the first plugin that needs outbound calls; `secrets` by phase 5 |
| 2026-11-01 | Phase 1 step 6 | Remove the three `--suppress` rules from `tests/scripts/external-clients.sh`: Umbel's built-in command descriptions need an action verb and 20 characters, `event-list`'s schema is complex, and the todo example's overlap and complexity warnings need a decision | Open, a later phase: step 8 changes nothing under `src/`, where the descriptions and `event-list` live |
| 2026-11-01 | Phase 2 specification | Store grants for components: WIT world `umbel:plugin/plugin@1.1.0` with store imports | Open, the first phase that needs a component reading stores |
| 2026-11-01 | Phase 2 specification | Output budgets in TypeScript, Python and C++ after the phase 2 step 0b | Open, AFD |
| 2026-11-01 | Phase 2 specification | Documents as MCP resources (`kb://`) once a permission-filtered listing exists | Open, after phase 5 |
| 2026-11-01 | Phase 2 specification | Restore from `store-backup` | Open, phase 6 |
| 2026-11-01 | Phase 2 specification | Partitioned BM25 statistics per access set, or coarsened scores, and an end to hidden-count leaks (scores, revision and `seq` gaps, `store-show`'s head, index-building totals) | Open, **phase 5 prerequisite** (owner decision 2026-11-01); in the architecture's prerequisites table |
| 2026-11-01 | Phase 2 specification revision | Measure chunk sizes against S57 (about 250-token chunks with overlap) with the eval harness once its baseline exists | Open, after phase 2 step 9 |
| 2026-11-01 | Phase 2 specification | A per-collection option to block, not only flag, content the write scan matches | Open, when a deployer asks |
| 2026-11-01 | Phase 2 specification | Watching collection roots instead of an explicit `knowledge-refresh` | Open, later |
| 2026-11-01 | Phase 2 step 1 | `umbel.toml` version 3 keeps `plugins.<id>.deny` and `plugins.<id>.grants.<g>.allow` as version 2 had them (the phase 1 grant names; `grants` reserved), and `workspace-config.v3.json` says the same; step 4 adds the ten grants and the allow lists to both the host and the schema | Done in step 4 ([651](https://github.com/lushly-dev/afd/pull/651)) |
| 2026-11-01 | Phase 2 step 1 | An event whose command supplied no valid `access` carries `["space"]` and `internal`; the store write that refuses an invalid envelope (`STORE_PROVENANCE_REQUIRED`) is step 4's, so until then a plugin that supplies a mistyped restrictive access set widens its event to the space (the store is not written yet) | Done in step 4 ([651](https://github.com/lushly-dev/afd/pull/651)): the store write is refused; an event whose command supplied no valid `access` still carries `["space"]`, by design |
| 2026-11-01 | Phase 2 step 3 | The `knowledge` job's timeout is 15 minutes, three times the local 205 s widened for the hosted runners, which had not run it; lower it to three times the slower hosted run when that is under 15 minutes ([specification C14](phases/2-knowledge/spec.md#amendments-from-step-3)) | Open, phase 2 owning agent, after the first hosted runs |
| 2026-11-01 | Phase 2 step 3 | A snippet is 240 characters; section 8.2's 480 for the detailed form needs a length on `IndexQuery` (C11) | Open, when a deployer asks: step 6 kept 240 characters for both formats ([F5](phases/2-knowledge/spec.md#amendments-from-step-6)) |
| 2026-11-01 | Phase 2 step 4 | `store-check` cannot exclude a trace that is "open" (started, not finished) because the journal appends only finished entries; its 60-second rule is the only exclusion, so a handler that runs longer than a minute and whose store changes are older than that can be reported once as a missing journal entry (a warning, never a failure) | Open, accepted ([amendment D10](phases/2-knowledge/spec.md#amendments-from-step-4)) |
| 2026-11-01 | Phase 2 step 4 | `space-list` and `workspace-show` still list every declared space id and title to any caller; only a space's contents are behind `readers` | Open, phase 5 (when filtering becomes a boundary) |
| 2026-11-01 | Phase 2 step 5 | `broken-links` is judged at sync time against the collection's selected files and can go stale when a link's target appears later (amendment E6); `knowledge-describe` now computes the current list at read time (step 6, [F1](phases/2-knowledge/spec.md#amendments-from-step-6)); step 7a may re-flag on the index | Done for `knowledge-describe` in step 6; the stored flag can still go stale until 7a |
| 2026-11-01 | Phase 2 step 5 | The hosted `knowledge` job now also tests the `umbel-okf`, `umbel-scan` and `sources` crates (the plugin's suite writes about 80 MiB for the 64 MiB test and 100 001 empty files for the file cap); measure it on the first hosted run against its 15-minute timeout | Open, phase 2 owning agent, after the first hosted run |
| 2026-11-01 | Phase 2 step 5 | `scripts/affected/suites.mjs` mirrors `umbel.yml` for `pnpm verify` and was not updated for the `knowledge` job's three new crates or the `check` job's matching `--exclude`s, because changing that file scopes every package for `ci.yml` (a full TypeScript run); verify still tests the crates (through `--workspace`) and lints them. Mirror the workflow the next time a pull request touches `suites.mjs` anyway | Open, phase 2 owning agent |
| 2026-11-01 | Phase 2 step 5 | A plugin id cannot hold a hyphen (`^[a-z][a-z0-9]{0,31}$`), so `sources-filesystem` is the plugin `sources` and owns the `sources-` domain; a connector plugin for another system (O1) will need its own domain, or phase 1's grammar will need to separate a plugin's id from its domain | Open, O1 |
| 2026-11-01 | Phase 2 step 4 | The `umbel.yml` `check` and `msrv` jobs now build SQLite and tantivy through the host's default feature; measure their time on the first hosted run and raise or split their timeouts if needed | Open, phase 2 owning agent, after the first hosted run |
| 2026-11-01 | Phase 2 step 6 | The SDK has no services for the store's head revision, the graph's applied revision or the WAL checkpoint, so `INDEX_STALE` and `dev.umbel/index`'s `head` use the highest change the caller can read, `knowledge-describe` has no `graphApplied`, and `knowledge-index` does not checkpoint ([F1, F2, F4](phases/2-knowledge/spec.md#amendments-from-step-6)); add the three host services if a deployer needs the exact figures | Settled in step 7a: the host services ([672](https://github.com/lushly-dev/afd/pull/672), [H1](phases/2-knowledge/spec.md#amendments-from-step-7a)) and the plugin's use of them (the second 7a pull request: the exact head in `knowledge-index`, `graphApplied`, the checkpoint after an index and a sync run). Search keeps the readable head by design ([H8](phases/2-knowledge/spec.md#amendments-from-step-7a)) |
| 2026-11-01 | Phase 2 step 6 | `scripts/affected/suites.mjs` mirrors `umbel.yml` for `pnpm verify` and was not updated for the `knowledge` job's new crate or the `check` job's matching `--exclude` (the same reason as step 5); verify still tests and lints the crate through `--workspace`. Mirror the workflow the next time a pull request may rescope `ci.yml` | Open, phase 2 owning agent |
| 2026-11-01 | Phase 2 step 6 | The hosted `knowledge` job now also tests `umbel-plugin-knowledge` (90 tests, about 15 seconds locally after the build); measure it on the first hosted run against its 15-minute timeout | Open, phase 2 owning agent, after the first hosted run |
| 2026-11-01 | Phase 2 step 8 | `confirm_prompt` is static manifest text, so the terminal does not name the proposal being approved ([G2](phases/2-knowledge/spec.md#amendments-from-step-8)); a dynamic prompt (id, area, flags) needs a host feature | Superseded 2026-11-01 by the "must do before real use" row below |
| 2026-11-01 | Phase 2 step 8 | The `knowledge` job gained about 33 tests (`proposals`, `verification`, `security`); measure the job on its first hosted run against the 15-minute timeout | Open, phase 2 owning agent, after the first hosted run |
| 2026-11-01 | Owner's coordinator, at the phase 2 exit | **Must do before real use.** The `knowledge-approve` terminal prompt cannot show the diff ([G2](phases/2-knowledge/spec.md#amendments-from-step-8)): the manifest's `confirm_prompt` is static text, so a person can approve a change without reading it, and the smoke run at a real terminal confirmed that both prompts name neither the proposal, its diff nor its flags (they only say to have read `knowledge-proposal-show`). A dynamic `confirm_prompt` is required: a host feature by which the command builds the prompt per call (proposal id, area, op and document, the diff's head and the scan's flags, filtered by the approver's reader filter and sanitized for terminal escapes), for `knowledge-approve`, `-reject` and `-verify`, with a test that the prompt a person sees contains the diff | Done 2026-11-03 in phase 4 step 3a, on step 2's host preview: the command line shows `knowledge-proposal-preview` (proposal id, area, op and document, change hash, flags, evidence and the diff's first 80 lines, under approve's reader rules, sanitised and capped) before `knowledge-approve`'s and `knowledge-reject`'s prompts, and `plugins/knowledge/tests/preview.rs` holds that the person sees the diff. `knowledge-verify` takes a document, not a proposal, and declares none ([phase 4, 8.1](phases/4-curator/spec.md#81-the-confirmation-preview-d97)) |
| 2026-11-01 | Phase 2 step 9 | The `knowledge` job gained `eval_gate` (about 50 seconds locally in a debug build, mostly the seeded fixture's sync and rebuild) and uploads the eval report; measure the job on its first hosted run against the 15-minute timeout | Open, phase 2 owning agent, after the first hosted run |
| 2026-11-01 | Phase 2 step 9 | Graph expansion scores a neighbour at 0.3 x its parent's whole score, so link neighbours of a strong match outrank weaker direct matches: nDCG@10 of the exact queries is 0.9368 with expansion and 1.0 without (cross-space 0.8181 against 0.8842), while multi-hop recall goes from 0 to 1 ([Amendments](phases/2-knowledge/spec.md#follow-ups)). A normalised or capped share is a ranking change to try against the baseline in its own pull request | Open, when a deployer asks |
| 2026-11-01 | Phase 2 step 9 | A byte-identical eval report across Linux and macOS is not asserted (tantivy's IDF uses the platform's `ln`); the baseline's 0.02 tolerance absorbs it. Compare the two hosted legs' uploaded reports on the first scheduled macOS run | Open, phase 2 owning agent, after the first scheduled run |
| 2026-11-01 | Shared plugin manifest proposal | The [shared plugin manifest proposal](../../../docs/features/active/plugin-manifest/plugin-manifest.proposal.md), written for Loam's phase 1, keeps every Umbel manifest key and meaning and needs no Umbel change. Umbel's manifest versions 1 and 2 conform to its core version 1 as they are. It replaces the "Room for Loam" plan (phase 1 specification section 2; D37's consequence) of Loam referencing this schema's `$defs`: `plugin.kind`, `domain`, `command` and `expose` are closed and Umbel-specific. Optional for Umbel: its step 3 (the core vectors in `tests/schemas.rs`; a later manifest version that `$ref`s the core). If Umbel agrees, it annotates D37 and "Room for Loam" to point there. The proposal also covers Umbel instances joining Loam as headless mounted apps, over loopback HTTP with the bearer token or stdio, and needs nothing from Umbel for that. It asks Umbel's owner U1 to U4: CORS for a browser-hosted Loam (recommended no for now; it would amend D32 for preflights), reach beyond loopback before phase 5 (recommended no), a host description or server card, and unifying space with Loam's scope. Owner questions 2 and 5 ask whether Umbel should carry and project `ui`, and accept a multi-member Loam over one principal per transport (D32) | Open, Umbel's choice; this pull request changes no Umbel decision |
| 2026-11-01 | Phase 2 step 7b | A bare nested name in inline code (`apply_step` for `Type::apply_step`) is not a `mentions` edge, only a qualified name or a top-level symbol's name is ([I1](phases/2-knowledge/spec.md#amendments-from-step-7b)); a symbol table that follows the code documents would be needed for the rest | Open, when a deployer asks |
| 2026-11-01 | Phase 2 step 7b | The `knowledge` job gained the `code` feature's tree-sitter build (about 16 CPU seconds) and two legs for the crate without it (clippy and the tests); measure the job on its first hosted run against the 15-minute timeout. `scripts/affected/suites.mjs` does not mirror the two new legs either (see the step 6 row) | Open, phase 2 exit |
| 2026-11-01 | Phase 2 step 7b | Symbols are Rust, Python, TypeScript and JavaScript definitions only (no fields, enum variants, Python module constants, or other languages); each language is a grammar crate and a query file | Open, when a deployer asks |
| 2026-11-02 | Phase 3 specification | `memory-erase` is deferred to phase 5 on the conditions in D85; a `cursor` profile, and how a component's memory writes are masked under world 1.1.0, wait as the specification's follow-ups say | Open |
| 2026-11-03 | Phase 4 specification | The owner's answers to the ten trust-model questions of the [phase 4 specification](phases/4-curator/spec.md#16-for-the-owner) (D91, D93, D94, D98 to D104); phase 3's follow-ups on an open proposal's forgotten evidence and on a manifest holding `memory_write` with a document write grant are answered there (D103; D104 keeps the refusal) | Done 2026-11-03: the owner chose the recommended option on questions 1 to 9 and "attest and verify" on 10; recorded in the specification's section 16 and D90 to D105 |
| 2026-11-03 | Phase 5 specification | The owner's answers to the seventeen trust-model and scope questions of the [phase 5 specification](phases/5-auth-hosted/spec.md#17-for-the-owner) (D110 to D124, D129, D130); they include phase 3's sharing-writer follow-up (question 10) and phase 4's unredacted-draft limit (question 11) | Done 2026-11-04: the owner chose the recommended option on all seventeen, with two strengthenings (user verification mandatory; a configurable two-person erase rule); recorded in the specification's section 17 and D106 to D130 |
| 2026-11-07 | Phase 5 step 0a | `packages/rust` commits no `Cargo.lock`, and a fresh resolution now picks `rmcp` 3.9.0, under which `cargo test --features server` fails 7 cases of `tests/server_resources.rs` (the Skills methods answer `-32601` on modern Streamable HTTP); with `rmcp` 3.8.0 every case passes. `rust.yml` resolves fresh, so it will fail the same way. Bound `rmcp` below 3.9 or adapt the Skills routing before step 0b | Closed by [#791](https://github.com/lushly-dev/afd/pull/791) (the Skills methods through `rmcp` 3.9's own routing); step 0b's `cargo test --features server` passes with `rmcp` 3.9.0, 2026-11-07 |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-10-30 | Design session with the owner | Proposal, research and sources written and merged ([#491](https://github.com/lushly-dev/afd/pull/491)); name decided; diagrams, trajectory watch, trajectory reservations, decisions D13 to D20 and this status file in [#493](https://github.com/lushly-dev/afd/pull/493), merged |
| 2026-10-30 | End-to-end review | Three independent reviews and a verification pass. Moved the area from `umbel/` to `endpoints/umbel/` (D21 supersedes D6). Command names brought into AFD's rule (D22); glossary (D23); phase specification path and approval (D24); AFD-first map and prerequisites table (D25); open decisions numbered O1 to O5. Principal moved onto AFD's actor and credentials; event log defined as a journal projection; candidates moved from the host to the curator; permission filtering moved into the store query; memory classes clarified; Skills given three delivery paths; Open Knowledge Format updated to v0.2; library versions and Rust 1.97 recorded; retrieval figures, SharePoint, Codex, events and authorization claims corrected. #493 had merged at its earlier head, so these went in [#516](https://github.com/lushly-dev/afd/pull/516), merged |
| 2026-10-30 | Design session with the owner | Spaces added at the owner's request: isolated knowledge bases inside one deployment (principle 16, D26), with the three levels of coupling in the architecture's data and content section, per-space phases and glossary entries; O5 narrowed to tenancy beyond spaces. [#516](https://github.com/lushly-dev/afd/pull/516), merged |
| 2026-10-31 | Handoff check | Re-checked every document against `main` before handoff. Pull request states corrected: #493 and #516 merged, and D21 to D26 came in #516. [#518](https://github.com/lushly-dev/afd/pull/518) closed #460 and gave Rust the private in-process approval exchange, so the approval rows now name only the MCP approval relay, which language parity tracks without an issue yet. The rmcp prerequisite was removed: the crate commits no lock, and its 3.7 requirement already resolves 3.8.0. Links, anchors and every D, O, R, W and S reference resolve. [#519](https://github.com/lushly-dev/afd/pull/519) |
| 2026-10-31 | Execution-model decision | The owner decided O2: the hybrid strategy, with code mode later and optional, recorded as D27. O2 references in the proposal, architecture and this file now point at D27; the hybrid prerequisite is required for phase 0. Wrote the AFD [hybrid tool strategy proposal](../../../docs/features/active/hybrid-tool-strategy/hybrid-tool-strategy.proposal.md) with its status file; no `spec/` or code changes. Links and anchors checked. [#522](https://github.com/lushly-dev/afd/pull/522), open |
| 2026-10-31 | Loam cross-review | From the Loam proposal's end-to-end review: corrected the placement rule (D21 consequence, the architecture's repository placement and the follow-up) so Umbel's units join only the release inventory, since `architecture.json` lists foundation families only and endpoint manifests are classified by path; noted on O3 that Loam's app manifest will extend Umbel's; marked the resources prerequisite as shared with Loam; added "surface" to the glossary with Loam's different meaning. Checked and unchanged: D22's registry enforcement holds in Rust (`CommandRegistry::register` rejects invalid names); the architecture's one use of "handoff" is AFD's pattern. Loam keeps Umbel's event field names where the shapes overlap. [#522](https://github.com/lushly-dev/afd/pull/522), open |
| 2026-10-31 | Owner review of the blockers | The owner accepted every recommendation: #523 merged first and #526 rebased onto it; grouped becomes the Rust default; the hybrid proposal approved and moved to `docs/features/active/` with the six answers recorded; issues [#531](https://github.com/lushly-dev/afd/issues/531), [#532](https://github.com/lushly-dev/afd/issues/532) and [#533](https://github.com/lushly-dev/afd/issues/533) filed. [#522](https://github.com/lushly-dev/afd/pull/522) |
| 2026-10-31 | Owner review of the blockers | [#526](https://github.com/lushly-dev/afd/pull/526) rebased onto #523, integrated (structured results and the context hook on every route) and merged as `03815e26`. Of the phase 0 prerequisites, only the hybrid strategy and [#531](https://github.com/lushly-dev/afd/issues/531) remain. [#534](https://github.com/lushly-dev/afd/pull/534) |
| 2026-10-31 | Phase 0 blockers | [#531](https://github.com/lushly-dev/afd/issues/531) fixed in [#539](https://github.com/lushly-dev/afd/pull/539); the hybrid spec merged in [#538](https://github.com/lushly-dev/afd/pull/538). Only the hybrid implementation remains among the AFD prerequisites. [#540](https://github.com/lushly-dev/afd/pull/540) |
| 2026-10-31 | Phase 0 blockers | The hybrid strategy merged in TypeScript, Python and Rust ([#556](https://github.com/lushly-dev/afd/pull/556), [#555](https://github.com/lushly-dev/afd/pull/555), [#560](https://github.com/lushly-dev/afd/pull/560)). Every AFD prerequisite for phase 0 is done; phase 0 now waits only on its specification and the owner's approval (D24). [#562](https://github.com/lushly-dev/afd/pull/562) |
| 2026-10-31 | Phase 0 specification | Wrote the [phase 0 specification](phases/0-host-skeleton/spec.md) at the D24 path: one `umbel` package (library and binary) on the `afd` crate's `server` feature, MSRV 1.97, `umbel.yml`, a quarantined inventory unit with no route; the workspace layout, `umbel.toml` version 1 with spaces and the default space, the writer lock (since superseded, see the next row) and the doctor; six built-in commands with `workspace-show` and `event-list` first-class under the hybrid strategy; the CLI envelope and exit codes; the context hook and principal version 0; the journal projection, event and cursor version 0, provenance envelope version 0; the tests for the exit criterion and a six-step plan. Decisions D28 to D36, architecture amendments and the trajectory refresh in the same pull request; O3 left open. Spec in review, not approved |
| 2026-10-31 | Phase 0 specification review | Revised the specification in [#564](https://github.com/lushly-dev/afd/pull/564) after the independent review ("approve after must-fixes"), every finding checked against the code: any number of host processes per workspace under one append lock held across the journal and event appends, with tail-read sequence numbers, a pending-projection marker and catch-up before the next append, race-safe shared keys (D29 amended); a bearer token on loopback HTTP, path and host validation (D32 amended); no interim telemetry (D33 dropped); `DirectClient::with_interface` in AFD (D34 amended); the store criterion (D28 amended). New step 0, an AFD pull request for the shared `FileJournalSink` mode and the `DirectClient` interface; Umbel's own test drivers; trusted host-owned keys, `Host::context`, `Workspace::resolve_space`; cursor consumers and `v0:<space>:0`; doctor `skip`; CLI confirmations, reserved verbs and sanitized text; an explicit `architecture.json` unit and a repository-contract test; cursor schemas and example files. Spec in review, not approved |
| 2026-10-31 | Phase 0 approval and step 0 | The owner delegated approval of the phase 0 specification; it merged in [#564](https://github.com/lushly-dev/afd/pull/564) as `fb35d525`, with D28 to D36. Implemented step 0 in `packages/rust` ([#567](https://github.com/lushly-dev/afd/pull/567)): `FileJournalSink::shared`, `with_lock_timeout`, `lock`, `append_locked`, `JournalFileLock` and `JournalLockError` behind the `journal-file-shared` feature (Rust 1.89; the crate's minimum stays 1.82 for every other feature set), and `DirectClient::with_interface`; tests in `src/journal/tests.rs`, `tests/journal_shared.rs` and `tests/direct_approval.rs`; the two `rust.yml` legs for the new feature; the CHANGELOG, README and language parity rows. Spec status block updated. Merged as `045b6feb` |
| 2026-10-31 | Phase 0 step 1 | Scaffolded `endpoints/umbel/` ([#570](https://github.com/lushly-dev/afd/pull/570)): `Cargo.toml` (the single `umbel` package, library and binary, `afd` by path with `server` and `journal-file-shared`), `Cargo.lock` committed (and the `.gitignore` negation), `rust-toolchain.toml` (1.98.0), `clippy.toml`, a `src/lib.rs` that forbids unsafe code, a `src/main.rs` that prints `--version` and one smoke test; `.github/workflows/umbel.yml` (Linux and macOS, plus an MSRV 1.97 check); the quarantined `umbel` unit in `scripts/release/inventory.json` (private, no route), its explicit `architecture.json` unit and a repository-contract test; the `AGENTS.md` CI row, key rule and tree line. In review |
| 2026-10-31 | Phase 0 step 2 | Implemented the workspace in `endpoints/umbel/` ([#572](https://github.com/lushly-dev/afd/pull/572)): `src/workspace/` (discovery, configuration version 1, layout, keys, lock, `init`), `src/doctor.rs`, the six schemas and examples under `schemas/`, and the `workspace.rs`, `doctor.rs` and `schemas.rs` tests. Marked step 1 done ([#570](https://github.com/lushly-dev/afd/pull/570), `273e0160`, `umbel.yml` green on Linux, macOS and MSRV). Kept `reqwest` and `rustls` out of the lock. Spec amended in four small places |
| 2026-11-01 | Phase 0 step 3 | Implemented the registry and the CLI in `endpoints/umbel/` ([#573](https://github.com/lushly-dev/afd/pull/573)): `src/host/` (`HostBuilder`, `seal`, `Host`, `HostError`, `Workspace::resolve_space`), `src/commands/` (`workspace-show`, `space-list`, `workspace-doctor`), `src/middleware.rs` (event stamp, space check), `src/principal.rs`, `src/surfaces/` (the default first-class set, the MCP server `seal` validates), `src/logging.rs`, `src/cli/` (`run`, argument parsing, JSON and text output, the sanitizer, approvals and confirmations) and the `umbel` binary; tests `cli.rs`, `seal.rs`, `doctor_sealed.rs`, `trusted_keys.rs`. Spec amendments: `async-trait`, the event stamp outermost, public `cli::run` and `RESERVED_VERBS`, the `cli.rs` row. Marked step 3 done |
| 2026-11-01 | Phase 0 step 4 | Journal and events: the projecting sink, the pending marker and catch-up, `repair_events`, event and provenance version 0, cursors and consumers, `event-list`, `event-ack`, `event-rebuild`, and the multi-process tests, in [#574](https://github.com/lushly-dev/afd/pull/574). Amendments recorded in the specification's "Amendments from step 4" |
| 2026-11-01 | Phase 0 step 5 | Implemented the MCP surfaces in `endpoints/umbel/` ([#575](https://github.com/lushly-dev/afd/pull/575)): `src/surfaces/http.rs` (the exact-path service and the bearer layer), the context hook in `src/principal.rs`, `Host::mcp_server` and `Host::http_router`, `src/cli/serve.rs` (`umbel serve --stdio` and `--http`) and the binary's exit handling; tests `protocol_http.rs`, `protocol_stdio.rs`, `hybrid_surface.rs`, `context_hook.rs`, `approvals.rs`, `confirmations.rs`, `process.rs`, the MCP cases of `trusted_keys.rs` and the drivers in `tests/support/`. Rebased onto step 4: the MCP cases of `journal_events.rs`, `trusted_keys.rs` and `process.rs` are in, and `umbel serve` calls `Host::repair_events`. Found and fixed: a held `stdout` lock blocked the stdio transport's writer, and the runtime waited for an uncancellable stdin read at exit. Spec amended ("Amendments from step 5"); marked step 5 done. |
| 2026-11-01 | Phase 0 exit | Phase 0 done. Steps 0 to 5 merged in #567, #570, #572, #573, #574 and #575; step 6 added the README's build and run sections and re-ran the exit criterion on `main` at `8001fc74`: 261 tests passed, `umbel workspace doctor` on a fresh workspace healthy with 13 checks passing, `umbel.yml` green. Phase 1 is unblocked. [#580](https://github.com/lushly-dev/afd/pull/580) |
| 2026-11-01 | Phase 1 specification | Wrote the [phase 1 specification](phases/1-plugin-contract/spec.md) at the D24 path, in review: manifest, WIT world, protocol version, configuration version 2, grants and effects, the compiled, component and mounted loaders, packs, skills on three paths, AFD contexts and pipelines, the SDK, test kit, `plugin new` and `plugin check`, security with four trust-model points for the owner, the exit criterion with every test file, and a plan with an AFD step 0 (resources, the Skills extension, tool `_meta`, the todo library split). Closed O3 as D37 and D38; D39 to D50; architecture amendments (host services, manifest, WIT world, packs, the sandbox and MCP client rows, versioning, prerequisites, glossary) and the trajectory refresh with the new W17. Spec in review, not approved |
| 2026-11-01 | Phase 1 specification revision | Revised the phase 1 specification after the independent review of [#583](https://github.com/lushly-dev/afd/pull/583), each finding checked against the code first: recorded the owner's four trust-model decisions and the coordinator's allow-list rule (section 11, D42, D43); moved a mount's `url` and `bearer_env` to `umbel.toml`; gave pipelines the union of their steps' confirmation prompts; made mounted commands space-less unless `bind_space`; instance prefixes, transport-level result limits, load-time description scans, advertised and validation schemas; `--workspace` CI, `hello-mcp` location, rustls for HTTPS mounts, CI cost measures; restated W17 and D38 (wasmtime 48 is the constraint); split step 2 into 2a and 2b; added exit run 4 (the stock binary mounts the Rust todo backend) and the `plugin-isolation` job. Amended D38, D40, D42, D43, D47, D48, D50 and architecture section 8. Spec in review, not approved |
| 2026-11-01 | Phase 1 step 0a | Owner approval of the phase 1 specification recorded (merged in [#583](https://github.com/lushly-dev/afd/pull/583) as `880779ff`). Wrote the AFD feature proposal [MCP resources and skills](../../../docs/features/active/mcp-resources-skills/mcp-resources-skills.proposal.md) and its status, approved under the owner's delegation, and [`spec/mcp-resources.md`](../../../spec/mcp-resources.md) with `spec/mcp-resources.json`; amended `command-metadata.md`, `protocol-conformance.md`, `CHANGELOG.md` and the language parity matrix (Planned); reconciled the Skill Knowledge Layer; amended the phase 1 specification (digest key, step 0a path, status block) and the prerequisites rows of the Umbel and Loam architectures. Documents only |
| 2026-11-01 | Phase 1 step 1 | Manifest and configuration ([#606](https://github.com/lushly-dev/afd/pull/606)): the manifest, source resolution, pack and skill file checks, the three schemas with examples, configuration version 2 and `init`, the doctor's file-only plugin checks (replacing `plugins.none`), the WIT file, the version constants, `[workspace.lints]` and `--workspace` in `umbel.yml`. Resumed from a partial branch left by an agent whose disk filled; reviewed, merged with `main`, and verified (fmt, clippy `-D warnings`, 338 tests, the MSRV check). Amendment: `seal` still refuses an enabled plugin until step 2a |
| 2026-11-01 | Phase 1 step 0b | Rust MCP resources, the Skills extension, tool `_meta` and `register_with_schemas` in `packages/rust`, and the todo backend library split ([#608](https://github.com/lushly-dev/afd/pull/608)); `rmcp` 3.8.0 routed the extension's methods, so no spec stop. Seven spec clarifications (see the specification's "Amendments from step 0b"). New optional dependency `saphyr-parser` |
| 2026-11-01 | Phase 1 step 2a | Loader core and compiled plugins ([#610](https://github.com/lushly-dev/afd/pull/610)): the load sequence, grant gates, plugin gate, `plugin-list` and `plugin-show`, `umbel-sdk`, `umbel-plugin-hello`, the `testkit` feature and its tests. Resumed from a partial branch left by an agent whose disk filled; reviewed against the specification, merged with `main` (step 0b), fixed the clippy findings the earlier session never compiled. Origin `_meta` stays with step 3 (the plan assigns it there). Six amendments in the specification |
| 2026-11-01 | Phase 1 step 3 | Skills on three paths ([#611](https://github.com/lushly-dev/afd/pull/611)): validation through AFD's `SkillCatalog`, the host's MCP server serving every loaded skill on the Skills extension and as resources, `skill-list`, `skill-export` and the origin `_meta` on plugin tools; `SkillCatalog::entries()` made public in `packages/rust`. Eight amendments in the specification |
| 2026-11-01 | Phase 1 step 2b | Packs and per-space overrides, first-class suggestions, plugin contexts (`build_server` before `install_middleware`) and pipelines as data with the confirmation union ([#612](https://github.com/lushly-dev/afd/pull/612)): `plugins/pipelines.rs`, `PackSet` in `plugins/packs.rs`, the loader preparing every instance before it registers any, `surfaces::first_class_plan`, the doctor's sealed `plugins.first_class` and `plugins.pipelines`, `TestHostBuilder::pack_override`. Step 3 (skills) ran in parallel in the same crate. Eleven spec amendments, mostly shapes the specification left open |
| 2026-11-01 | Phase 1 step 5 | Mounted loader ([#613](https://github.com/lushly-dev/afd/pull/613)): rmcp client over stdio and Streamable HTTP with rustls, instance-only `url` and `bearer_env`, renaming, overrides, `bind_space`, advertised and validation schemas, the description scan, transport-level result limits, stamps, respawn, `hello-mcp`, the SDK's `mounted` feature and the tests. Started on a branch whose session ran out of disk; resumed, merged with step 2b, and verified in full. Ten amendments in the specification |
| 2026-11-01 | Phase 1 step 4 | Component loader ([#620](https://github.com/lushly-dev/afd/pull/620)): wasmtime 48.0.8 and `wasmtime-wasi` `p2` (facts checked against crates.io and the 48 tier table), the process-wide engine and linker, world identification from versions, the import check against grants, virtualized WASI 0.2 with the tape-backed clock and random, limits and their errors, the SDK's `component` feature, hello as a component, four fixture components, CI changes. The WIT file committed in step 1 did not parse (`list` is a keyword) and was corrected to `%list`. Seventeen spec amendments. Resumed in a worktree with about 13 GB free: a Rust build of wasmtime plus some 45 test binaries that each link it took the shared target directory to 14 GB, so no further Rust build ran after the full test and MSRV runs |
| 2026-11-01 | Phase 1 step 6 | Todo plugin and conformance job ([#622](https://github.com/lushly-dev/afd/pull/622)): `umbel-plugin-todo`, `umbel-todo`, the runner's `umbel` and `umbel-mounted` backends, the `todo-http` fixture, the Rust backend's `TOOL_STRATEGY`, `external-clients.sh`, and the `conformance` and `plugin-isolation` jobs. Amendments recorded in the specification's "Amendments from step 6" |
| 2026-11-01 | Phase 1 step 7 | `plugin new` and `plugin check` ([#623](https://github.com/lushly-dev/afd/pull/623)): the templates for every plugin kind, `plugin-new`, `plugin-check` with its internal temporary host (no `testkit`) and the explicit `spawn=true`, the README's "Write a plugin" section, and `plugin_scaffold.rs`, which builds the compiled and component scaffolds. Ten amendments in the specification's "Amendments from step 7"; the component template declares `packs`, `clock` and `log`, because the Rust component it builds imports no `wasi:random`. |
| 2026-11-01 | Phase 1 exit | Phase 1 done. Steps 0a to 7 merged in #583 (specification), #606, #608, #610, #611, #612, #613, #620, #622 and #623; step 8 added `tests/hello_three_ways.rs` (hello compiled, as a component and mounted, over MCP stdio and HTTP in both eras and through the CLI, with the fixed clock) and re-ran the exit criterion on `main` at `1cca6309` plus that test: `cargo test --locked --workspace` 550 passed, the todo conformance suite 34/34 against `umbel-todo` (legacy and modern) and against the stock `umbel` mounting the Rust backend (legacy and modern), the confirmations suite 5/5, the Rust backend 34/34 twice and 5/5, `afd validate --surface --strict` 0 errors and 0 warnings, 4 scenarios passed, `plugin check` healthy on each of the four `plugin new` templates, and `workspace doctor` on a fresh workspace with hello enabled 20 of 20 checks passing. Phase 2 is unblocked; its next gate is a specification written and approved (D24). [#624](https://github.com/lushly-dev/afd/pull/624) |
| 2026-11-01 | Phase 2 specification | Wrote the [phase 2 specification](phases/2-knowledge/spec.md) at the D24 path, in review: store traits and the embedded SQLite and tantivy backend shared by several processes, configuration version 3, access and reader filters, store grants with allow lists and derivation reads, manifest version 2, envelope and event version 1, `sources-filesystem` and the OKF container, the `knowledge` plugin (query syntax, ranking, chunking, locators, the structural graph with tree-sitter symbols, open and find, multi-space fusion), proposals and the verification lifecycle, output budgets AFD-first, the eval harness with a synthetic thousand-document fixture and a gate for optional lanes, security, the exit criterion with every test file, and a plan with step 0 in AFD. D51 to D67; architecture amendments (host services, store traits, envelope, libraries, data, phases 3 and 4 rows, prerequisites with the telemetry middleware moved to phase 5, glossary); trajectory refresh. Nine points for the owner in section 15. Spec in review, not approved |
| 2026-11-01 | Phase 2 specification revision | Revised the [phase 2 specification](phases/2-knowledge/spec.md#revision-2026-11-01) in [#625](https://github.com/lushly-dev/afd/pull/625), rebased onto `886c3b4d`, after the independent review and the owner's decisions of 2026-11-01. Checked every finding against the code and the tantivy 0.27.0, tantivy-query-grammar 0.27.0, tree-sitter 0.27.1 and tree-sitter-typescript 0.23.2 sources; none rejected. Query parsing through the grammar AST with bounded prefixes; tantivy features and explicit LZ4; indexers serialised by the writer with one-transaction graph batches and no lowering of `applied`; co-citation per citer; totals plus readable ids for sync, status and index, and `event-list` filtered by `access`; the gate's named allow-list; `confirm = "require-human"`; self-approval by actor; SDK method and error tables; plan dependencies, fixture counts, CI job, eval scope. Owner decisions recorded in section 15 and D53, D54, D62 and D67; D40 and D42 annotated; D51, D55, D57 to D60 and D64 to D66 amended; architecture phase 4 exit and prerequisites amended. Cited the phase 1 exit run, `umbel.yml` run 41298630706 on `main` at `886c3b4d`. Spec in review, not approved |
| 2026-11-01 | Phase 2 step 0a | Output budgets specified in AFD (documents only): the [proposal](../../../docs/features/active/output-budgets/output-budgets.proposal.md) and status in `docs/features/active/output-budgets/`, `spec/output-budgets.md` and `spec/output-budgets.json`, the `spec/` amendments and parity rows; the architecture's prerequisites row and the phase 2 specification's status block and "Amendments from step 0a" updated. No code |
| 2026-11-01 | Phase 2 step 0b | AFD Rust output budgets and the public frontmatter reader ([#633](https://github.com/lushly-dev/afd/pull/633)): `packages/rust` `output_budget.rs` and its wiring in the registry, journal, router, tool lists, `afd-detail` and `afd-help`; `OUTPUT_BUDGET_EXCEEDED` in the shared catalog and four constants; `afd::frontmatter` and the `frontmatter` feature; `tests/output_budget.rs` over `spec/output-budgets.json`. Nine amendments in the specification's "Amendments from step 0b" |
| 2026-11-01 | Phase 2 step 1 | Shapes and configuration ([632](https://github.com/lushly-dev/afd/pull/632)): the nine schemas of the specification's section 2 with examples (`tests/schemas.rs` extended: closed, every example validates and, for the configuration, manifest, envelope and event, opens in the host; each refusal the host makes is also the schema's); configuration version 3 (`tests/config_v3.rs`: collections, roots inside and outside, symbolic links, overlap, readers, groups, the store, versions 1 and 2 read as 3, `init` writes 3) and the doctor's `collections.roots`; manifest version 2 parsing (`tests/manifest_v2.rs`: the effects with and without their grants, `output_budget` compiled-only, `confirm = "require-human"`, version 1 unchanged); `store` a host domain; envelope and event version 1 projected from the gate's stamp, with version 0 lines read and rebuilt as written (`tests/journal_events.rs`). Eight amendments recorded in the specification ([Amendments from step 1](phases/2-knowledge/spec.md#amendments-from-step-1)). No store, index or plugin code. Two follow-ups for step 4 added |
| 2026-11-01 | Phase 2 step 2 | Store traits and the SQLite stores ([636](https://github.com/lushly-dev/afd/pull/636)): `umbel-store` (types, `DocumentStore`, `SearchIndex`, `GraphStore`, the conformance suite with its 40-document access fixture, the breakable in-memory fake and `suite_detects.rs`), `umbel-store-embedded` (bundled SQLite in WAL mode, multi-process safe, the checkpoint policy, `fullfsync` on macOS), the `knowledge` CI job, the quarantined inventory rows and `architecture.json` entries. Seven amendments in the specification's "Amendments from step 2". Measured bundled SQLite: 39 s and 106 MB for a fresh `cargo build -p rusqlite` |
| 2026-11-01 | Phase 2 step 3 | The tantivy index ([643](https://github.com/lushly-dev/afd/pull/643)): `TantivyIndex` in `umbel-store-embedded` (schema 1 with LZ4 named, `en_stem`, the query builder over the `tantivy-query-grammar` AST with its limits and bounded prefixes, the reader clause, writer sessions that never lower `applied`, four-decimal scores, snippets, checksum validation), the cached petgraph form of the readable graph, the suite's `index` group and the two index cases that waited, `run_groups`, and the tests above. Fourteen amendments in the specification, C1 correcting the revision (the grammar marks `prefix` only on a quoted phrase). Measured tantivy cold: 135 of 188 CPU-seconds of an 83 s build, 640 MB target; the `knowledge` job 205 s locally, timeout 45 to 15 minutes |
| 2026-11-01 | Phase 2 step 4 | Host services ([651](https://github.com/lushly-dev/afd/pull/651)): the ten grants with allow lists and `ALLOW_REQUIRED`, reader filters and `SPACE_NOT_READABLE`, `spaces`, derivation reads and `as_reader`, provenance enforcement, the gate's allow-list, `dev.umbel/changes`, `replay: \"recorded\"`, `event-list` by `access`, the SDK's store methods, `HostError`'s new variants, output budgets wired, the `store-embedded` feature, `store-show`, `store-check`, `store-backup`, the doctor's store checks, `confirm = \"require-human\"` on the CLI, `workspace-show`'s `access` and the README paragraph. Fifteen amendments in the specification. Tests: `store_grants.rs`, `access_filter.rs`, `require_human.rs`, `store_commands.rs`, `doctor_stores.rs` and the rest of `manifest_v2.rs` |
| 2026-11-01 | Phase 2 step 5 | `umbel-scan`, `umbel-okf` and the `sources` plugin ([668](https://github.com/lushly-dev/afd/pull/668)): the write scan moved out of the host, frontmatter and structure and link resolution under the caps, `sources-sync` (bounded runs, change detection by hash, access mirroring, results of totals plus readable ids) and `sources-status`, the host service `content_collections`, the knowledge CI job's crates, and the inventory and `architecture.json` rows. Thirteen amendments in the specification (the plugin id has no hyphen; the sync state is sharded; `limit` counts files read). Write-scan flag rate on 523 repository documents: 3.3 % `instruction-like`, 0.2 % `hidden-text` |
| 2026-11-01 | Phase 2 step 6 | The knowledge core ([671](https://github.com/lushly-dev/afd/pull/671)): `umbel-plugin-knowledge` (plugin `knowledge`, compiled) with structure-aware chunking, `knowledge-index` by the section 8.7 procedure (index only), `knowledge-search` (fielded BM25, the reader clause inside the query, document hits with locators, explicit multi-space queries fused by rank), `knowledge-open`, `-find`, `-describe`, `-list`, `-changes` with output budgets and content labels, the first-class suggestions, the `knowledge-refresh` pipeline, the `ranking` pack, the skill and the `umbel-knowledge` binary. Seventeen amendments (F1 to F17); no host change. Tests: chunking, query syntax, search, open and find, spaces, budgets, security (read side), index and process. The `knowledge` job, the release inventory (quarantined) and `architecture.json` gained the crate |
| 2026-11-01 | Phase 2 step 8 | Proposals and verification ([673](https://github.com/lushly-dev/afd/pull/673)): the proposal record as a decision trace, areas and approvers, `knowledge-propose` with idempotency, list, show, withdraw, the CLI-only `knowledge-approve`, `-reject` and `-verify` (`require-human`, AFD approval), the resumable apply sequence with `derivedFrom` and `confidence`, frontmatter-only rewrites (`umbel_okf::rewrite_keys`), the write scan on proposals, and the host service `reader_tokens`. Sixteen amendments (G1 to G16). Tests: proposals, verification, security (write side) |
| 2026-11-01 | Phase 2 step 7a, part 1 | The three host services step 6 recorded as missing (F1, F2, F4), host and SDK only: `HostServices::graph_applied` (a `graph` read), `derive_head` (the true head, a derivation read only, because it counts changes the caller may not read) and `checkpoint` (any store write grant allowed for the space), with `Cx` and `SpaceCx` wrappers; the host's whole-graph read now comes from the readable-graph cache (`ReadableGraph::to_subgraph`, tested equal to the SQL read, tightened access hides at once). Two amendments (H1, H2). Tests: three new cases in `store_grants.rs`, one in `store-embedded/tests/index.rs` |
| 2026-11-01 | Phase 2 step 7a, part 2 | The structural graph ([step 7a graph pull request](phases/2-knowledge/spec.md#amendments-from-step-7a)): `knowledge-index` builds the graph in the same run as the index (the writer first, both applied revisions, one `GraphBatch` committed in one transaction before the index, neither revision ever lowered, the checkpoint, the true head), with hierarchy, headings, links and backlinks, tags, owners, supersession and co-citation stored per citer under the 50-target cap; `knowledge-search` expands along readable edges (`matched: false` for a neighbour); `knowledge-neighbors`, `-related`, `-path`, `-outline` and `-stale`; `graphApplied` and `coCitation` in `knowledge-describe`; the ranking pack's `[expansion]` table; `sources-sync` checkpoints. Twelve amendments (H3 to H14); the host is unchanged beyond part 1. Tests: `graph.rs` (12), the expansion cases of `search.rs` (5), `budgets.rs`, and the security fixture now indexes its graph for real |
| 2026-11-01 | Phase 2 step 7b | Code symbols (the step 7b pull request): the knowledge crate's default `code` feature with tree-sitter 0.27.1 and the Rust, Python and TypeScript grammars (JavaScript and JSX through the TSX grammar), a query file per language, symbol chunking, `defines` and `mentions` edges under the graph's access rules, parse and query budgets with a clean per-file outcome and `CODE_PARSE_DEGRADED`, `codeIndexing` in `knowledge-describe`. Eight amendments (I1 to I8); no host change. Tests: `code_symbols.rs` (27), `code_off.rs` (2) and unit tests; hostile fixtures (deep nesting on a 1 MiB stack, long lines, huge and grammar-breaking files, NUL, invalid UTF-8) and restricted-file fixtures. Build cost about 16 CPU seconds; release binary +4.7 MB |
| 2026-11-01 | Phase 2 step 9 | The eval harness (the step 9 pull request): the seeded thousand-document fixture generator with its pinned digest (PCG32 and a pseudo-word generator in the crate), the 220-query set, `knowledge-eval` (CLI only, the report as the result, each query run as its own principal through the shared ranking code), recall@k, nDCG@k and MRR@k with expansion on and off, the zero-leak check, `eval::gate::check` and `lane_gate`, `plugins/knowledge/eval/baseline.json`, and the report uploaded by the `knowledge` job. Eleven amendments (J1 to J11). Measured, thresholds unchanged and met: recall@10 1.0, nDCG@10 0.9273 with expansion; 0 leaks; 15 of 15 unanswerable queries empty. Finding: expansion lowers the exact queries' nDCG (0.9368 against 1.0), recorded as a follow-up |
| 2026-11-01 | Security fix | The independent review of the phase 3 specification found a live phase 2 bypass: `umbel batch` merged the request's `context` into `extra`, so a request could set `dev.umbel/human-confirmed` and pass `require-human` with no terminal. `knowledge-reject` had no other gate; `knowledge-approve` and `knowledge-verify` also need AFD's approval. `umbel batch` now drops the request's `context`, as the MCP route ignores it; `require_human.rs` holds the forgery as a regression test, which failed before the fix. [#688](https://github.com/lushly-dev/afd/pull/688) |
| 2026-11-01 | Phase 2 exit | Phase 2 done. Steps 0a to 9 merged (#625 specification; #633, #632, #636, #643, #651, #668, #671, #672, #673 and the step 7a graph, 7b and 9 pull requests); step 10 added `plugins/knowledge/tests/exit_thousand.rs` (the exit criterion's four points on the seeded fixture: 650 and 400 documents with both indexes and graphs at their heads, no cross-space result, results filtered by principal with `SPACE_NOT_READABLE`, the eval report validated, gated and written to `UMBEL_EXIT_REPORT`), uploaded in the `knowledge` job, and re-ran the exit criterion on `main` at `aa0ecda2`: `cargo test --locked --workspace` in `endpoints/umbel` passed 1032 tests in 107 suites (0 failed, 1 ignored doctest); the `knowledge` job's crates 364 (46 suites) and `-p umbel-plugin-knowledge --no-default-features` 169 (21 suites); the `check` job's test 680 (64 suites); every `umbel.yml` leg and `pnpm verify` passed; a smoke on a fresh workspace with `umbel-knowledge` (init, refresh, search, open, propose, approve at a real pseudo-terminal, doctor healthy). Eval numbers: recall@10 1.0 and nDCG@10 0.9273 with expansion, 0 leaks in 220 queries, on a synthetic fixture whose recall measures the pipeline and regressions, not quality on real content. Added the README's "Run the knowledge plugin" (a working `umbel.toml` and every required `allow` list) and the follow-up "must do before real use": the `knowledge-approve` prompt cannot show the diff. Phases 3, 5, 6 and the further first-class plugins are unblocked |
| 2026-11-02 | Phase 3 specification | The [phase 3 specification](phases/3-memory-context/spec.md), approved under the owner's 2026-10-31 delegation, with the owner's answers of 2026-11-02, in [#685](https://github.com/lushly-dev/afd/pull/685): `MemoryStore` (store traits version 2) on its own SQLite FTS5 database per space; the bitemporal record; the scope tuple, private by default, captures always private; envelope version 2 with a closed, host-filled authority; digest journaling; per-record keys in `memory.keys`, destroyed by a forget; the `memory` and `context` plugins, composed through grants, with a `person`-only default push and `memory-confirm`; capture contract version 1 and `umbel-hook`, with turns defined from real transcript structure. D68 to D85, W18 and the architecture amendments in the same pull request. Findings: `SessionEnd` hooks share 1.5 seconds by default; an FTS5 `contentless_delete` table keeps deleted terms in the file; the research does not measure labels or quoting as a defence, so the push defences are unmeasured |
| 2026-11-02 | Phase 3 step 1 | Shapes and configuration (the step 1 pull request): the seven schemas of section 2 with examples; envelope version 2 in `umbel-store` and the host; event version 2 with `changes.store`; manifest version 3's `journal` and `authority_prompt`, parsed, validated and stored; configuration version 4 with the `memory_write` policy, `principal.agent_env` and `store.exclude_memory_from_machine_backup`; `umbel init` writing version 4 and `on_behalf_of`; the version constants; `memory` and `memory_write` in the catalog and still unavailable. Tests: `schemas.rs` extended, `config_v4.rs` and `manifest_v3.rs` new. Section 2.1 amended: document and record writes keep envelope version 1 in phase 3, since their shapes nest it (D36) |
| 2026-11-02 | Phase 3 specification, last answers | The four owner answers given after the key design's review written into the [phase 3 specification](phases/3-memory-context/spec.md) as D86 to D89, in the follow-up to [#685](https://github.com/lushly-dev/afd/pull/685): `memory-remember`'s `authority_prompt` (manifest version 3) asked only on the path that would give `person`, declining writes nothing (3.3); Time Machine exclusion through the sticky `com_apple_backup_excludeItem` attribute, checked with `tmutil` on the owner's Mac, with the setting `store.exclude_memory_from_machine_backup` and the doctor check `stores.memory_backup` (5.4); `memory-confirm` on own records only (8.7); `memory-reindex`'s default-off `removeOrphans` (8.8). Tests, plan and exit criteria updated. No Rust built |
| 2026-11-03 | Phase 3 step 2 | The memory trait and suite (the step 2 pull request): `MemoryStore` and its types, the memory query parser, the nine memory conformance groups with their fixture and `MemoryRestore`, the in-memory store with eight faults, `memory_suite_detects.rs` and `memory_query.rs`. Four amendments in the specification's "Amendments from step 2". Written 2026-11-02 while free disk was under the 5 GB floor and built on 2026-11-03 after the owner freed space; the build found only clippy findings |
| 2026-11-03 | Phase 3 step 3a | The embedded memory store (the step 3a pull request): `SqliteMemoryStore` in `store-embedded/src/memory/` (schema, `0600` file created only by a write, per-connection pragmas, FTS5 with `secure-delete`, reads filtered in one statement, erased prefixes, sweep, quota, the purge before a write and checkpoints outside transactions, sealed columns behind one seam that stores them unsealed until 3b); `Stores.memory` and `memory_restore` with the memory groups in `run_all`; `memory_conformance.rs`, `memory_multiprocess.rs`, `memory_erasure_bytes.rs` and `memory_sqlite.rs`. Marked step 2 done ([#733](https://github.com/lushly-dev/afd/pull/733), `b84e0bd5`). Seven amendments in the specification's "Amendments from step 3a". Finding: on the bundled SQLite 3.54.1 every Status experiment held, but FTS5's `secure-delete` can leave a whole forgotten token in `records_fts_idx` as a page separator, and `optimize` does nothing on a one-segment index; every erasure now rebuilds the index in a transaction of its own (20 to 23 ms per forget on 3000 records), so forget keeps the stated guarantee |
| 2026-11-03 | Phase 3 step 3b | Sealing and the key file (the step 3b pull request): XChaCha20-Poly1305 per record with keys in `memory.keys`, forget in 5.4's order with markers, roll-forward by every writer that repeats the index rebuild and the checkpoint, the crash points of 7.4 under `testkit`, every missing-key error, `reindex` with opt-in orphan removal, `backup` through `ATTACH`, the rebuild on open, `key_status`, the Time Machine exclusion through `libc` on macOS; `memory_seal.rs`, `memory_keyfile.rs`, `memory_backup.rs`, `memory_machine_backup.rs`, `memory_erasure_bytes.rs` extended, the conformance suite with nothing skipped. Marked step 3a done ([#736](https://github.com/lushly-dev/afd/pull/736), `b970994e`). Ten amendments in the specification's "Amendments from step 3b". Cost in the `release` profile: about 20 ms per write, 1.3 ms per recall on 1000 records, 43 to 53 ms per forget on 3000. Finding: `tmutil isexcluded` reports every file under the system's temporary folders as excluded, so it says nothing about the mark there |
| 2026-11-03 | Phase 3 step 4 | Host services and the journal digest (the step 4 pull request): the `memory` and `memory_write` grants with section 6's rules (identity, authority, access, the host's scan, quota and TTL ceilings, 6.3's authority and ownership), `Ledger`'s memory revisions, `changes.store`, `dev.umbel/no-change`, the SDK's memory methods and `HostError` variants; digest journaling through `with_redact` with the replay stamp, pipeline inheritance and the seal refusal; `dev.umbel/human-present`, the agent variables and the CLI's `authority_prompt` (D86); `@-`; `UMBEL_TEST_CLOCK` and `UMBEL_TEST_HUMAN_PRESENT` under `testkit`; the memory store in `store-show`, `store-check` and `store-backup`, `store.open`'s new suggestion and the seven doctor checks; the README's memory paragraph. Marked step 3b done ([#737](https://github.com/lushly-dev/afd/pull/737), `8d51ee13`). Twelve amendments in the specification's "Amendments from step 4", the twelfth making an event's `authority` and `confirmation` host-owned; `memory_key_file` added under `memory`, giving the file's state and none of the store-wide counts |
| 2026-11-03 | Phase 3 step 5 | The memory plugin's writing side (the step 5 pull request): `umbel-plugin-memory` with the `policy` and `hygiene` packs, the `memory-guide` skill and the `umbel-memory` binary; the write pipeline of 8.2; `memory-remember` (first-class), `memory-capture`, `memory-show` and `memory-status`; the `memory` job in `umbel.yml`; the crate quarantined in the release inventory. Marked step 4 done ([#740](https://github.com/lushly-dev/afd/pull/740), `d945bbbf`). Thirteen amendments in the specification's "Amendments from step 5". Findings: a plugin cannot know its write's authority or an absent `share`'s access set, so the host now keeps a renewal only for `person`, defaults `origin` by authority and checks a supersede's scope; and a digest entry kept a refused secret-like label in its `keep`, so a failed digest call now keeps no input value |
| 2026-11-03 | Phase 3 step 6 | The memory plugin's reading and lifecycle commands (the step 6 pull request): `memory-recall`, `memory-list`, `memory-invalidate`, `memory-confirm` (CLI only, own records, `require-human`), `memory-forget`, `memory-sweep` and `memory-reindex` with `removeOrphans`, in `plugins/memory`; `recall_scope.rs`, `bitemporal.rs`, `invalidate.rs`, `confirm.rs`, `forget.rs`, `retention.rs` and `security.rs`, the rest of `events.rs`, and step 5's deferred capture refused under an erased prefix; `memory-guide` extended. Marked step 5 done ([#742](https://github.com/lushly-dev/afd/pull/742), `0e3a501a`). No host change; the SDK's `Outcome` gains `with_suggestion`. Seven amendments in the specification's "Amendments from step 6". Finding: an invalidation in the millisecond a record became valid is refused, as 4.1 says, so tests advance the clock first |
| 2026-11-03 | Phase 3 step 7a | The shared helpers (the step 7a pull request): the locator string (`string`, `short`, `parse`, `Parsed`) moved from `plugins/knowledge/src/locator.rs` to the new `umbel_okf::locator`, and `is_stale` from `plugins/knowledge/src/search.rs` to `umbel_okf::frontmatter` (re-exported at the root), for step 7b's `context` plugin; `knowledge-stale` uses `is_stale` in place of its own copy. Knowledge unchanged in behaviour, its eval baseline untouched; `umbel-okf` gains `chrono`, already in the lock. Marked step 6 done ([#743](https://github.com/lushly-dev/afd/pull/743), `800856ad`). No amendment, no host change |
| 2026-11-03 | Phase 3 step 7b | The `context` plugin (the step 7b pull request): `umbel-plugin-context` with `context-bundle` (first-class, `inspect`, digest-journaled), the `bundle` pack, the `context-guide` skill and the push settings; selection with `PushFilter`, authority tiers, `per_authority_cap` and `left_out` counts; the budget of 9.4, the quoted block of 9.5 and the digest of 9.6; the keys-failed lane; the `memory` job extended to the crate. Tests: `selection.rs`, `budget.rs`, `labels.rs`, `render.rs`, `deterministic.rs`, `lanes_absent.rs`, `no_plugin_dependency.rs` (49 with the unit tests) and the host's `default_tools.rs` (the default `tools/list` with the four first-party plugins, 16 292 bytes). Marked step 7a done ([#744](https://github.com/lushly-dev/afd/pull/744), `8f124810`). Fourteen amendments; no host change |
| 2026-11-03 | Phase 3 step 8 | The first-party binary and the harness adapters (the step 8 pull request): `umbel-first-party` with the four first-party plugins (D80), and `umbel-hook` on serde alone with the `claude-code` and `generic` profiles, the transcript reader of 10.3 (user and assistant text only), windows, parts, keys, the state file, `print-settings`, `status` and fail-open with `last-error.json`; the synthetic fixture of 65 turns. The structure re-check found no local CLI session with conversation and confirmed the rules on the others, adding three exclusion details. One-shot release time: capture about 50 ms (110 ms first), bundle 25 ms, a three-window `Stop` 169 ms. The `memory` job gains both crates; timeout 15 minutes kept. Tests: `claude_code.rs` (11), `generic.rs` (3), `fail_open.rs` (6), 5 unit tests and `hook_smoke.rs` (1). Marked step 7b done ([#745](https://github.com/lushly-dev/afd/pull/745), `c8689ebc`). Seventeen amendments; no host change |
| 2026-11-03 | Phase 3 step 9 | Import and export (the step 9 pull request): `memory-import` (authority `import` whoever calls, private unless a sharing writer shares, `document-derived`, no idempotency key so a repeat observes) and `memory-export` (the caller's own live records only, never flagged, `transcript` or another principal's, paged by cursor, a record too large for the budget passed over by id), both CLI only and digest-journaled, in `plugins/memory`; `umbel-hook import` and `export` with the frontmatter subset reader, splitting, `0600` files by rename, stale exports removed and `MEMORY.md` never written. Tests: `import_export.rs` in the plugin (9), the hook (6) and the binary (1), and 7 unit tests. Marked step 8 done ([#746](https://github.com/lushly-dev/afd/pull/746), `ab5b321d`). Seven amendments; no host change |
| 2026-11-03 | Phase 3 exit | Phase 3 done. Steps 1 to 9 merged (#685 specification; #729, #733, #736, #737, #740, #742, #743, #744, #745, #746 and #747); step 10 added `first-party/tests/exit_memory.rs` (the exit criterion's seven points on the committed Claude Code fixture through the real `umbel-first-party` binary and `umbel_hook::run`, with the frozen clock and person at a terminal of `testkit` and 40 indexed documents, writing its report to `UMBEL_EXIT_REPORT`, uploaded by the `memory` job), `leak_probes.rs` (14 probe groups through library actors, also run on the exit's stores), `poisoning.rs` (6 tests: section 11's poisoning, single-user, displacement and injection rows) and `forget_bytes.rs` (3 tests: every route's canaries and keys gone from every file, the reader held across a forget, the backup restored beside the current key file), with no host, plugin or adapter change. The `memory` job's crates pass 206 tests in 41 suites; `cargo fmt --all --check`, the workspace clippy and `node scripts/run-tooling-tests.mjs` (296) passed. Evidence per point: 4 transcript records, 41 excluded canaries absent, 1 redaction, 1 flagged, 4 calls and 4 events; recall 3, 0 in `beta`, 2 and 1; six bitemporal queries; a 3941-byte bundle under 4000 with `authority` 2 then 1 and `flagged` 1; byte-equal bundles and equal digests; 5 forgotten records unreadable from the restored backup, the recapture refused, `MEMORY_KEYS_MISSING` with the doctor failing. Eleven amendments; one follow-up for the owner (a sharing writer may invalidate another's shared record, as 6.3 says). Full `pnpm verify` re-run on the owner's Mac passed in two parts around the disk guard (the workspace test 153 suites, the store crates 21, every conformance run). Phase 4's specification is next |
| 2026-11-03 | Phase 4 specification | The [phase 4 specification](phases/4-curator/spec.md), in review: the `curator` plugin, CLI only, with no write grant to knowledge or memory and no model; `curator-run`, a pipeline of curator and knowledge commands, with a host-set pipeline mark naming the drafter; proposal record version 2 (drafter, memory evidence with authority, origin, constraints and access, conflict sets, decision channel); settling defaults (7 and 14 days, two sessions, `person` authority, never flagged); conflict sets as alternatives; re-verification as `verify` proposals a person approves; rejection feedback with a 90-day quiet period; the confirmation preview that closes phase 2's "must do before real use". D90 to D104 and the architecture amendments in the same change. Eight trust-model questions for the owner in its section 16. Committed locally, not pushed |
| 2026-11-03 | Phase 4 specification review | Revised the [phase 4 specification](phases/4-curator/spec.md) after its independent review: 33 findings checked against the code, 31 fixed as raised and 2 holding in part (its Review response table). Pipeline `expose` and `result` (D105, manifest version 4); a host attestation table keyed by random step trace ids in place of a context key; per-principal curator records, cursors and reports; content-free candidate ids, paths and keys; redaction of change hashes and titles; digest journaling of every knowledge command that can return a drafted proposal; `secure_delete` on the document store; approve's re-checks; drafted self-approval compared with every source's principal; `deprecate-declared` only on bytes an applied proposal wrote; overdue in `curator-status` only. Questions 9 (what may settle) and 10 (trusting a drafter) added; D90 to D104 revised. Committed locally, not pushed |
| 2026-11-03 | Phase 4 specification approval | The owner answered all ten section 16 questions of the [phase 4 specification](phases/4-curator/spec.md#16-for-the-owner): the recommended option on 1 to 9 and, on 10, "attest and verify" (the knowledge plugin checks every drafter claim against the memory store and the shared rendering, `PROPOSAL_DRAFT_MISMATCH`, step 3c added). Written in as the owner's decisions of 2026-11-03: the specification approved under the owner's 2026-10-31 delegation (D24); D90 to D105 decided; the architecture's curator row (writing memory a non-goal), the relay prerequisite and the phase 5 row (the relay moved there) and the glossary made decided text; hedges removed from the specification's body; the follow-up for the owner's answers closed. Committed locally, not pushed; step 1 next |
| 2026-11-03 | Phase 4 step 1 | Shapes (the step 1 pull request): `proposal.v2.json`, `plugin-manifest.v4.json`, `curator-record.v1.json` and `curator-report.v1.json` with 17 examples; manifest version 4 parsed, validated and stored, not acted on (`confirm_preview` and its named command's rules, a pipeline's `expose` and `result`), in `src/plugins/manifest/v4.rs`; `MANIFEST_VERSIONS = [1, 2, 3, 4]`, `PROPOSAL_VERSIONS = [1, 2]`, `CURATOR_VERSION = 1` in `workspace-show`; P3 of `spec/plugin-manifest.md` and its profile test. Fourteen amendments in the specification, none on the trust model. `cargo fmt --all --check`, the workspace clippy (without the embedded store) and `node scripts/run-tooling-tests.mjs` (300) passed; `manifest_v4` 14 and `schemas` 47 tests, and the five older suites updated for the version bump, passed. Step 2 is next |
| 2026-11-03 | Phase 4 step 2 | Host (the step 2 pull request, from `e7aeff70`; step 1 merged in [#751](https://github.com/lushly-dev/afd/pull/751)). Pipeline attestation: fresh random step trace ids keyed in the host's `PipelineAttestations` table, read by `CallServices::pipeline()` and the SDK's `CallContext.pipeline`, never from `extra`. A version 4 pipeline's `expose` checked at seal against every step, and `result = "last"`. The CLI's confirmation preview before the gated prompt (declared properties only, fresh trace, no marks, sanitised and capped, `CONFIRMATION_PREVIEW_FAILED`). `secure_delete=ON` and a reporting `truncate_wal` on `store.sqlite3`. Ten amendments in the specification, none on the trust model. `cargo fmt --all --check`, the workspace clippy and the three `--no-default-features` library clippies passed. The four new suites (26 tests), `manifest_v4` (14), five new unit tests and five related suites passed. No plugin changed. Step 3a is next |
| 2026-11-03 | Phase 4 step 3a | Knowledge: record and journal (the step 3a pull request, from `83639abb`; step 2 merged in [#753](https://github.com/lushly-dev/afd/pull/753)). Proposal record version 2 written, with envelope version 2 on the body and the stored record, `decision.channel = "terminal"` and a proposer's `withdrawal`; version 1 records read, retried, decided, withdrawn and applied in their own version. The knowledge manifest at version 4; section 11.2's digest set (`-proposal-list`, `-proposal-show`, `-proposal-preview`, `-approve`, `-reject`, `-withdraw`); `knowledge-proposal-preview`, declared as `confirm_preview` by approve and reject, which closes phase 2's "must do before real use". A fault in step 1's `proposal.v2.json` fixed (a `null` withdrawal matched the drafter-withdrawal rule), so the pull request needs a `Plugin-isolation-exempt:` line. Twelve amendments, none on the trust model. No host `src/` change. `cargo fmt --all --check`, the knowledge job's clippy and tests (477 in 60 suites, `eval_gate` with the baseline untouched), the no-default-features knowledge clippy and tests (181 in 24) and the host's `schemas` test passed; `proposals_v2` 4, `preview` 8 and `journal_modes` 2 new. Step 3b is next |
| 2026-11-03 | Phase 4 step 3b | Knowledge: the drafted path (the step 3b pull request, from `37af26c9`; step 3a merged in [#754](https://github.com/lushly-dev/afd/pull/754)). `drafters`; `knowledge-propose-batch` (per-item results, withdrawals first, caps, `PROPOSAL_ALREADY_OPEN`, a retry repeating the drafter's claims) and `knowledge-proposal-feed`, both on the host's attestation; a drafter's withdrawal and redaction, with the checkpoint's `pending` state carried through a new compiled-only host service, `truncate_wal`. Owner decision 10's sequencing held: a listed drafter's memory evidence, memory `derivedFrom`, candidate, promotion, conflict set and draft content are refused with `PROPOSAL_DRAFT_UNVERIFIABLE` until step 3c verifies them. Thirteen amendments, none weakening the trust model. The step's two questions were decided by the owner for the stronger guarantee and done in it: every draft that was not applied is redacted when its source is erased (by id, or by a new `erased` notice; `proposal.v2.json` widened), and the change log forgets a redacted record's earlier hashes (`DocumentStore::forget_record_history` and a `record_forget_history` service), with drafted reject and withdraw results no longer carrying the record hash. Host `src/`, `sdk/src/`, `store/src/`, `store-embedded/src/` and `schemas/` changed, so the pull request needs a `Plugin-isolation-exempt:` line. `cargo fmt --all --check`, the knowledge job's clippy and tests (499 in 62 suites, `eval_gate` with the baseline untouched), the no-default-features knowledge clippy and tests (202 in 26), the host, SDK and store clippies and the host's `schemas` (47), `store_truncate_wal` (3) and `store_grants` (23) passed; `drafted` 10 and `redaction` 11 new. Step 3c is next |
| 2026-11-03 | Phase 4 step 3c | Knowledge: verifying drafts (the step 3c pull request, from `4a6b2de4`; step 3b merged in [#763](https://github.com/lushly-dev/afd/pull/763)). `umbel_okf::draft`: the fixed rendering, the rationale, `subject_key` and the id and key derivations, pinned byte for byte. The knowledge plugin declares `memory`, read only and optional, and a `plain` journal on every command and pipeline outside the digest set. Every check of section 3.2 against the memory store (read once per batch, under the caller's filter) and the shared rendering, refusing with `PROPOSAL_DRAFT_MISMATCH` naming the check, plus six it did not name (`source-authority`, `evidence`, `derived-from`, `rationale`, `key`, `run`); step 3b's `PROPOSAL_DRAFT_UNVERIFIABLE` kept only for what cannot be verified (memory without the grant or off a create, content citing no memory). A tampered replay is a mismatch, not a reused key. Approve re-checks the target and each source (`PROPOSAL_ACCESS_WIDENED`, `PROPOSAL_SOURCE_GONE`) and takes authorship from the store, so the runner is no longer the author. The "erased" claim is checked. Fourteen amendments, none weakening the trust model; the fourteenth settles the step's question under owner decision 10: the knowledge instance's `drafters` table names each drafter's target per space, and a drafted create's path is checked exactly. No host, schema, SDK or workflow change. Tests: `okf/tests/draft.rs` (10), `verify_drafts.rs` (20); the knowledge job 530 in 64 suites, without `code` 223 in 27, `umbel-first-party` 13 |
| 2026-11-03 | Phase 4 step 4 | Curator: candidates (the step 4 pull request, from `7e52e337`; step 3c merged in [#765](https://github.com/lushly-dev/afd/pull/765)). The `umbel-plugin-curator` crate with its manifest, `settle` pack, `curator-guide` skill and configuration; a public, deterministic core for settling, groups, conflict sets, section 5.1's access rule, statuses merged with the caller's records and drafting through `umbel_okf::draft`; `curator-candidates` and `curator-promote` (`require-human`, own records, the content hash, only `needs-promotion`); per-principal candidate and consent records. Memory read only under the caller's filter; no memory or knowledge write grant. The curator's drafts pass the real knowledge plugin's verification byte for byte (`first-party/tests/curator_drafts.rs`), and a tampered field or misclaimed mode is refused. Twelve amendments, none on the trust model: a host service, `readable_collections` under `documents`, for the metadata of collections the caller reads (in place of an optional `content` grant, for least privilege), and `CallContext.person` (host and SDK), so promotion refuses an agent's environment as `memory-confirm` does; the pull request needs a `Plugin-isolation-exempt:` line. The `memory` job gains the crate. Tests: curator 44 integration and 8 unit, `curator_drafts` 1, host `call_person` 2 and `readable_collections` 4; the `memory` job 259 in 51 suites; host subset 295 in 18; tooling 305. Step 5 is next |
| 2026-11-03 | Phase 4 step 5 | Curator: runs (the step 5 pull request, from `0d46a9a0`; step 4 merged in [#767](https://github.com/lushly-dev/afd/pull/767)). `curator-plan`, `curator-finish`, `curator-status` and the `curator-run` pipeline: command line only, `result = "last"`, digest, answering with ids and counts; the plan and finish steps refuse any call that is not a step of the run (`CURATOR_RUN_REQUIRED`). The per-principal lock (compare-and-set, takeover after 10 minutes, owner-only release), recovery by proposal ids derived through the now-shared `umbel_okf::draft::proposal_id`, rotating memory and document scans, the batch's caps; the re-check of every open draft (erased: the `erased` notice redacts and the curator's records keep nothing, hashes forgotten and checkpointed; invalidated, expired, confirmed or unreadable: withdrawn), superseded alternatives, rejection and apply feedback; re-verification and deprecation drafts with a `review` record per document, and reported inconsistencies. Thirteen amendments, none on the trust model; no host `src/` change; `schemas/` gains the `review` kind, a candidate's `proposal`, the state's `reviewAfter`, an erased consent and the report's `checkpoint` and `refused`, so the pull request needs a `Plugin-isolation-exempt:` line. Tests: curator 41 new integration (`run` 7, `feedback` 6, `forgotten` 7, `reverify` 5, `deterministic` 3, `poisoning` 5, `not_request_path` 7) and 7 new unit, with a stand-in for the knowledge plugin's batch and feed; `first-party/tests/curator_run.rs` 5 against the real knowledge plugin; `okf/tests/draft.rs` 1; the knowledge job 532 in 64 suites, the `memory` job 311 in 59, host `schemas` 47. Step 6 is next |
| 2026-11-03 | Phase 4 step 6 | Auto-approval (the step 6 pull request, from `9ea18e73`; step 5 merged in [#768](https://github.com/lushly-dev/afd/pull/768)). `knowledge-auto-approve`: command line only, a plain prompt that `--yes` answers from cron, digest-journaled, refused for any attested pipeline step and any caller that is not a person, and per proposal for a caller outside the area's approvers. One rule kind, `deprecate-declared`, off unless an area lists it in `auto` (schema and reader refuse anything else). It applies a scheduled, memory-free, unflagged, non-alternative drafted deprecate of a still-listed drafter only when the document and its file are at the draft's base, its `superseded_by` is the draft's, its one lineage is a person's applied `create` or `update` of this instance whose content and result are those bytes and whose diff added the declaring line, and the successor is readable by every reader of the target and not deprecated; recorded as `policy:<area>` with `channel = "policy"` and `auto:deprecate-declared`, through approve's compare-and-set steps, a stopped policy apply resumed only when the rule holds again. Eleven amendments; the seventh closes a typed declaration carried through a person's verification or edit. No host, schema or SDK change. `auto_approve.rs` (20), 2 unit tests, a first-party test with the real curator. Scoped clippy and tests green; the full gate is the owner's |
| 2026-11-03 | Phase 4 exit | Phase 4 done. Steps 1 to 6 merged (#749 specification; #751, #753, #754, #763, #765, #767, #768 and #770, the last as `6e1c0a0a`); step 7 (the step 7 pull request, from `6e1c0a0a`) linked the curator into `umbel-first-party`, so the binary has all five first-party plugins, and added `first-party/tests/exit_curator.rs` (section 13's seven points through the real binary, with the frozen clock and person at a terminal of `testkit`, ada's memory written and forgotten through the binary by switching `principal.local_id`, writing its report to `UMBEL_CURATOR_EXIT_REPORT`, uploaded by the `memory` job beside phase 3's) and `curator_leaks.rs` (bo's 32 answers on every curator and proposal surface equal with and without ada's hidden facts, space, records and lock; none of her 16 hidden ids, hashes or run ids in them; each curator record with section 2.3's access set). No host, plugin, schema, SDK or adapter change: the exit found no defect. Evidence per point: settling on day 3, ready and 1 draft on day 8 with the attested run, 1 memory evidence entry equal to the record, and a tampered replay refused `copied-authority`; a 38-line preview before the prompt, `exception: null`, channel `terminal`; the file the curator's rendering with `Holds only`, `agent-inferred`, `umbel:curator/curator`, `generated.at` the `settledAt`, `derivedFrom` the proposal, found by search, the candidate `applied`, a further run drafting 0; `needs-promotion`, then `promotedBy` and `PROPOSAL_SELF_APPROVAL` until allowed, then `self-approval`; a rejection quiet to day 107 and nothing drafted on day 77; the forgotten source's draft withdrawn and redacted, checkpoint `clean`, its 4 canaries and hash in no file of the workspace; no curator or command-line-only proposal command listed, discovered or callable over the binary's stdio MCP server. The `memory` job's crates pass 314 tests in 61 suites; `cargo fmt --all --check`, the job's clippy and `node scripts/run-tooling-tests.mjs` (305) passed. Eleven amendments; the eleventh puts step 3b's stated limit (a draft its proposer can no longer read is not redacted) to the owner. The full `pnpm verify` re-run passed all 21 suites in one pass (206 test result lines, none failed). The phase 5 and phase 6 specifications are next |
| 2026-11-03 | Phase 5 specification | Wrote the [phase 5 specification](phases/5-auth-hosted/spec.md), in review, not approved: auth modes and configuration version 5, token and audience rules, protected-resource metadata, principal version 1, derived per-space scopes, gateway-trusted mode verified by channel and assertion, the person page for proof of a person and the MCP approval relay, `memory-erase`, exact filtering, shared state, Tasks, usage events and rate limits, with an AFD step 0; D106 to D128 (proposed or pending) and architecture amendments marked proposed; a trajectory Refreshes row; fifteen questions for the owner. No Rust built |
| 2026-11-03 | Phase 5 specification review | Revised the [phase 5 specification](phases/5-auth-hosted/spec.md) after its independent review: 36 findings and 7 nits checked against the code and the standards, all holding (3 in part), each in its Review response table. AFD's host-verified confirmation mode and relay evidence, `person` per surface, a `ScopeResolver`, identity namespaces, the operator and hosted identity join with legacy equivalents, one answer for absent and unreadable spaces, readable positions with deterministic sealing, page-time previews, the HTTP layer order, introspection to one issuer, tasks bounded by their token, an error-code table and the plan split; D106 to D130 (D129 and D130 new, pending questions 16 and 17); architecture amendments extended (the trust model's present-human rule); trajectory W5 corrected. No Rust built |
| 2026-11-04 | Phase 5 specification approval | The owner answered all seventeen section 17 questions of the [phase 5 specification](phases/5-auth-hosted/spec.md#17-for-the-owner): the recommended option on 1 to 4, and on 5 onward "I am not an expert on these so I am fine going with your recommendations but lets make sure we are making good choices, not cutting corners, investing in the best outcomes, and being secure". Written in as the owner's decisions of 2026-11-04, with two strengthenings: user verification mandatory on every person login (`auth.person` fails on an empty `acr_values` or `uv_amr`; every ID token must show a configured `acr` and a user-verification `amr`, else `PERSON_VERIFICATION_INSUFFICIENT`), and a configurable two-person rule for `memory-erase` (`erase_approvals`, default 1 only for single-administrator deployments). The specification approved under the owner's 2026-10-31 delegation (D24); D106 to D130 decided, D116 amending D99, D120 amending D101, D123 closing O5; the architecture's proposed text made decided; phase 3's sharing-writer question and phase 4's step 3b limit marked answered. Step 0a is next. No Rust built |
| 2026-11-07 | Phase 5 step 0a | The AFD spec, documents and cases only: `spec/authorization.md` and `spec/authorization.json`; `scopes`, `confirmationMode: "host-verified"`, `task`, #532's principal binding, `HumanRelay`, relay evidence and Tasks in `spec/command-metadata.md`; `INSUFFICIENT_SCOPE` and `TASK_TOKEN_EXPIRED` specified in `spec/error-codes.md`; `tool-strategies.md`, `protocol-conformance.md`, `CHANGELOG.md`, language parity; the MCP Authorization and Tasks proposals moved to `docs/features/active/`; the specification's [Amendments from step 0a](phases/5-auth-hosted/spec.md#amendments-from-step-0a) and a step 8 follow-up on a task's TTL against its token's `exp`. No code changed. Step 0b is next |
| 2026-11-07 | Phase 5 step 0b | AFD's Rust `server-auth` feature: `afd::server::auth` (`BearerLayer`, `JwtVerifier` on `jsonwebtoken` 11.1 with `aws-lc-rs` for the signature only, `KeySource`, `TokenVerifier` and `check_introspection`, `ScopeResolver`, `ProtectedResource`, `Authorization`), `afd::Credentials` on `CommandContext::credentials`, `CommandDefinition::with_scopes`, and `INSUFFICIENT_SCOPE` in the shared catalog in all four languages (47 codes). All 184 cases of `spec/authorization.json` load in `tests/authorization_cases.rs`; one test per M3 rule in `tests/auth_verifier.rs`; the layer end to end in `tests/server_auth.rs`; the token canary in `tests/auth_canary.rs`. Twenty choices recorded in the specification's [Amendments from step 0b](phases/5-auth-hosted/spec.md#amendments-from-step-0b); the OAuth 2.1 draft 17 follow-up closed |
| 2026-11-07 | Phase 5 step 0b review | Fixed the independent security review of step 0b on the same branch: hidden commands no longer named in suggestions or by hidden groups; any resolver `Missing` refuses (no empty `scope=`); fail closed on transports other than HTTP and stdio and on credentials not admitted for the server's own authorization; the resolver asked again at execution on validated input; per-caller resource providers; JSON-RPC batches 400; `exp` before `iat` refused; actor ids redacted in `CommandContext`'s debug output. Recorded as "(review)" rows in the phase 5 specification's amendments |
| 2026-11-07 | Phase 5 step 0c | [#532](https://github.com/lushly-dev/afd/issues/532) in AFD: confirmation `requestState` bound to the call's principal binding (M8) in TypeScript (one HMAC bind tag over the round's state, confirmation and approval-relay answers alike; `principalBinding`), Python (the SDK's sealed state through `bind_principal`, a mismatch the SDK's `-32602`) and Rust (the gate's HMAC associated data, `afd::principal_binding`); a mismatch refused as tampering is, the same caller still confirmed, a pre-change state failing closed. TypeScript and Python load the `principalBindings` cases. Recorded in the phase 5 specification's amendments from step 0c |
| 2026-11-07 | Phase 5 step 0d | AFD Rust relay: the host-verified confirmation mode (`CommandConfirmationMode::HostVerified`), `HumanRelay` on `McpServer::with_human_relay`, relay evidence in the approval middleware (spent once as `relay:<decisionId>`), `afd::input_digest`, and the form-mode approval relay (`ApprovalRelay::McpElicitation`) sharing one principal-bound state per call with the confirmation; `tests/server_human_relay.rs`; an independent security review (no blocker; two improvements fixed with regression tests); the specification's Amendments from step 0d. Umbel code unchanged |
| 2026-11-07 | Phase 5 step 0e | AFD Rust tasks: `CommandDefinition::with_task(TaskSupport)` refused beside a person gate, `afd::server::tasks` (`TaskStore`, the bounded `InMemoryTaskStore`, `TaskOptions`), the `tasks/*` handlers with the owner check in the store and the server, `CancellationSignal` and `report_progress` on the context, `TASK_TOKEN_EXPIRED` in the shared catalog in all four languages (48 codes); `tests/server_tasks.rs`; the specification's Amendments from step 0e. The AFD prerequisites 0a to 0e are complete. Umbel code unchanged |
| 2026-11-07 | Phase 5 step 1b | `umbel-testkit-idp`, a test-only identity provider, resource authorization server, gateway signer and test CA on `127.0.0.1`, with one-rule-at-a-time token breaks checked against AFD's `JwtVerifier`, the ID-JAG exchange, introspection answers and endpoint faults; `tests/no_auth_server.rs` in the host; the inventory unit, `architecture.json` entry and a repository-contract test; the specification's Amendments from step 1b. No host code changed |
| 2026-11-08 | Phase 5 step 2a | The host's listener and layers: in-process TLS with `client_auth` and the client certificate passed to the verifier from the handshake, section 6.3's layers in order (the body size limit, the per-IP limit on `state/shared/limits.sqlite3`, `/health` and the protected-resource metadata in public, AFD's bearer layer and MCP service from one authorized server), the context hook version 1 skeleton, `Host::http_server`, the default `auth` feature; `oauth` refuses to start until step 2b fills the verifier slot, `gateway` until step 4; `tests/auth_layers.rs`, `no_auth_server.rs`'s `oauth` router; the specification's Amendments from step 2a |
| 2026-11-08 | Phase 5 step 2b | The host's verification and principal: Umbel's `KeySource` (RFC 8414 discovery, issuer check, HTTPS only, no redirects, 1 MiB and 10 seconds, a 5-minute to 24-hour cache, one fetch a minute per issuer, fail closed after the cache), AFD's `JwtVerifier` built from `[auth]`, the introspection issuer with a 60-second cache, section 4.1's mapping to principal version 1 on every surface (services, `act`, claim groups, the `~` form), equivalents in reader filters, memory ownership and knowledge self-approval (`CallContext::equivalents`), an interim scope rule until step 3; mode `oauth` verifies and maps, and a shipped build serves it only after steps 2c, 3 and 7 (a `testkit` seam for tests); `tests/auth_tokens.rs`, `auth_keys.rs`, `token_canary.rs`, `principal_v1.rs`; the specification's Amendments from step 2b |
| 2026-11-08 | Phase 5 step 2c | The host's doctor and introspection: every `auth.*` check of section 6.1 (with `auth.ca_files`), run as the verifier would ask each issuer and never printing a secret, token, key or remote value; `workspace-doctor` the operator's alone in a hosted mode; `auth-show` with exactly section 10.3's members; `workspace-show`'s hosted answer (no name or path, only readable spaces); `[auth.issuers.<alias>] ca_file`, trusted for its issuer alone and only while its roots are valid; the test kit's `TestCa::valid_between` and `TestIdp::start_with_ca`. An independent security review found one blocker and eight improvements, all fixed with regression tests. Serving `oauth` stays refused until steps 3 and 7. Committed locally on `lush/umbel-p5-2c-doctor`, not pushed |
| 2026-11-08 | Phase 5 step 3 | The host's scopes, access, shared state and limits: section 5.2's policy for Umbel's `ScopeResolver` and the scope gate (space-qualified verbs, every verb implying `read` in its space, unqualified needs for space-less commands, a token with no Umbel scope refused everywhere), section 5.4's one answer with `Caller` in `reader_filter` on every surface, the listings of 9.4 with the plugin listings, the shared nonce store in approvals, the per-token and read limits, and `http.trusted_proxies` (PROXY protocol version 2 from listed peers only); `oauth` still not served until step 7 |
