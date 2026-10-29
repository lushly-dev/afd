# Plan: Bot Core + Skill Registry Architecture

> **Status:** Complete — Phases 1a–1d, 2, 3, 4 all shipped. Phase 5 (conditional module split) deferred until needed.
> **Date:** 2026-02-18 (plan) · 2026-02-19 (Phases 1–4 shipped)
> **Scope:** Cross-project bot core extraction + skill distribution system

---

## Summary

Three bots (lushbot, proto, fabux) share ~80% duplicated command code and ~70 skills
across 4 directories with significant drift. This plan extracts shared code into a
`botcore` pip package with an integrated skill registry, using a plugin model for
project-specific extensions.

**Recommended direction:** Bot Core with Integrated Skill Registry — combines bot core
extraction with a Hybrid Feed + Local Override skill distribution system (Option E).

---

## Plan Sections

| # | Section | Description |
|---|---------|-------------|
| [01](./01-context-and-problem.md) | Context & Problem | Full ecosystem audit, problem statement, brainstormed approaches |
| [02](./02-architecture.md) | Architecture | Recommended direction, three-tier skill model, components, plugin contract, installation |
| [03](./03-configuration.md) | Configuration System | Config schema, Pydantic models, per-package overrides, env vars, loading flow |
| [04](./04-mcp-tool-architecture.md) | MCP Tool Architecture | Run pattern (3-4 meta-tools), tool contracts, security boundary, sandbox reference |
| [05](./05-afd-leverage.md) | AFD Leverage | AFD patterns to use (SimpleRegistry, DirectClient, Pipeline, CommandResult) and avoid |
| [06](./06-portability.md) | Portability | Cross-project issues (async, tool availability, branding, return format, workspace detection) |
| [07](./07-phases.md) | Phases | Phase 1 (Extract) through Phase 5 (Module Split), with sub-phases and acceptance criteria |
| [08](./08-migration-and-testing.md) | Migration & Testing | Migration order, version pinning, rollback plan, unit/integration/canary CI strategy |
| [09](./09-extraction-manifest.md) | Extraction Manifest | Code extraction source-of-truth table + bot/skill duplication evidence |
| [10](./10-appendix-module-architecture.md) | Appendix A: Module Architecture | Phase 5 microkernel design — capability dispatch, module contract, config resolution |
| [11](./11-review-log.md) | Review Log | Review response log (rounds 1 & 2) — accepted, rejected, skipped items |

---

## Key Decisions

- **Phase 1 ships monolithic** — all commands bundled in a single `botcore` package. Module split deferred to Phase 5.
- **Skills use `source:` frontmatter** — three tiers: universal (botcore), domain (plugin), project (unmanaged).
- **Config uses Pydantic with `extra="forbid"`** — typos caught at load time. Layered precedence: CLI > project > plugin > core defaults.
- **MCP uses 3-4 meta-tools** (start, docs, run, research) — not individual tools per command.
- **AFD is the command framework** — botcore depends on `afd`, doesn't absorb it.
- **Migration order:** lushx (primary consumer, lushbot repo) and libbot (second consumer, libraries repo) first. Other consumers as needed.
