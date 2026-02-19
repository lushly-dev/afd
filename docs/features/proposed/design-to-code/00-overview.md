# Design-to-Code Integration Plan

> **Vision**: A unified workflow where AFD command schemas and Figma designs are the single source of truth, enabling automated UI generation, living documentation, and zero-drift development.

## Executive Summary

This plan outlines the integration of **Agent-First Development (AFD)** methodology with **Figma Make** and **Figma's MCP Server** to create a seamless design-to-code pipeline. The result is a system where:

1. **Commands are defined once** — Power CLI, API, MCP, and UI
2. **Schemas inform design** — Designers see what's possible before designing
3. **Designs generate code** — Figma Make outputs production-ready components
4. **Everything auto-documents** — Specs, API docs, Storybook stay in sync
5. **Validation prevents drift** — Design and code can never diverge

## The Problem We're Solving

### Traditional Workflow (Broken)

```
Designer creates UI → Developer builds API → "These don't match"
                   → Redesign cycle
                   → Documentation gets stale
                   → Shipped product differs from design
```

### AFD + Figma Workflow (Fixed)

```
Define Commands → Schemas inform Design → Design generates Code → Auto-document
      ↑                                                              |
      └──────────────── Validation keeps everything in sync ─────────┘
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SINGLE SOURCE OF TRUTH                            │
│                                                                             │
│  ┌─────────────────┐                          ┌─────────────────┐          │
│  │  AFD Commands   │◄────── Schema Sync ─────►│  Figma Designs  │          │
│  │  (Zod Schemas)  │                          │  (Components)   │          │
│  └────────┬────────┘                          └────────┬────────┘          │
│           │                                            │                    │
└───────────┼────────────────────────────────────────────┼────────────────────┘
            │                                            │
            ▼                                            ▼
┌─────────────────────┐                    ┌─────────────────────┐
│   AFD MCP Server    │                    │  Figma MCP Server   │
│  ┌───────────────┐  │                    │  ┌───────────────┐  │
│  │ schema.list   │  │                    │  │ get_file      │  │
│  │ schema.export │  │◄─── MCP Bridge ───►│  │ get_component │  │
│  │ cmd.execute   │  │                    │  │ get_variables │  │
│  └───────────────┘  │                    │  └───────────────┘  │
└──────────┬──────────┘                    └──────────┬──────────┘
           │                                          │
           ▼                                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            GENERATED OUTPUTS                                │
│                                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐         │
│  │ API Docs │ │ UI Specs │ │   Code   │ │  Tests   │ │Storybook │         │
│  │ (OpenAPI)│ │   (MD)   │ │ (React)  │ │ (Vitest) │ │ (CSF3)   │         │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Key Components

| Component | Purpose | Document |
|-----------|---------|----------|
| **AFD Schema Layer** | Export command schemas for external consumption | [01-afd-schema-layer.md](./01-afd-schema-layer.md) |
| **Figma Plugin** | Browse commands, bind to designs, validate | [02-figma-plugin.md](./02-figma-plugin.md) |
| **Figma Make Integration** | Generate production code from designs | [03-figma-make-generation.md](./03-figma-make-generation.md) |
| **Documentation Pipeline** | Auto-generate all specs and docs | [04-documentation-pipeline.md](./04-documentation-pipeline.md) |
| **Validation & Sync** | Ensure design-code alignment | [05-validation-sync.md](./05-validation-sync.md) |
| **Implementation Roadmap** | Phases, milestones, decisions | [06-implementation-roadmap.md](./06-implementation-roadmap.md) |

## The Five Surfaces Promise

AFD's core promise is that commands power multiple surfaces with zero backend changes. This integration extends that:

| Surface | Generator | Backend Changes |
|---------|-----------|-----------------|
| CLI | AFD CLI | — |
| MCP | AFD Server | — |
| REST API | AFD Server | — |
| Web UI | **Figma Make** | **Zero** |
| Mobile UI | **Figma Make** | **Zero** |
| Documentation | **Auto-generated** | **Zero** |

## Success Criteria

1. **Designer can see all available commands** in Figma before designing
2. **Designer can bind UI elements to commands** with validation
3. **Figma Make generates code** that invokes AFD commands directly
4. **Documentation auto-updates** when schemas or designs change
5. **Validation catches drift** before code ships

## Guiding Principles

### From AFD
- **Commands ARE the application** — UI is a projection
- **CLI validation first** — If it doesn't work via CLI, don't build UI
- **UX-enabling schemas** — Commands return confidence, reasoning, sources

### From Figma Integration
- **API is a design material** — Designers work WITH capabilities, not around them
- **Design intent is metadata** — Annotations become documentation
- **Generated code is production code** — Not scaffolds, actual shippable components

### Combined
- **Single source of truth** — Schema changes propagate everywhere
- **Validation over documentation** — Catch drift automatically
- **Progressive enhancement** — Start simple, add sophistication

## Integration with Mint

Design-to-Code creates **UI heads** (vanilla HTML/CSS/JS that call AFD commands). These heads plug directly into **Mint** for multi-platform distribution:

```bash
# Design-to-Code generates the Web Head
figma-make generate --project my-app --output heads/web/

# Mint wraps and ships it everywhere
mint build --heads web,desktop,mobile
mint deploy --target internal-test
```

**Rapid Prototype Flow**: Figma → Generated Code → Mint → Deployed app (minutes, not days)

See: [Mint Distribution Plan](../rust-distribution/00-overview.md)

## Related Resources

- [AFD Repository](https://github.com/lushly-dev/afd) — Agent-First Development methodology
- [AFD Philosophy](../philosophy.md) — Why commands first
- [Figma MCP Server](https://www.figma.com/developers/mcp) — Figma's Model Context Protocol
- [Figma Make](https://www.figma.com/make) — AI-powered design-to-code
- [Mint Distribution](../rust-distribution/00-overview.md) — Multi-platform deployment

---

**Next**: [01-afd-schema-layer.md](./01-afd-schema-layer.md) — The foundation layer
