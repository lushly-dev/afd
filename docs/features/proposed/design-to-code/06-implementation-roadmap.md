# 06 - Implementation Roadmap

> **Goal**: Phased approach to implementing the AFD + Figma Make integration, with clear milestones and decision points.

## Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         IMPLEMENTATION PHASES                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PHASE 1           PHASE 2           PHASE 3           PHASE 4             │
│  Foundation        Plugin MVP        Generation        Full Loop           │
│  (2 weeks)         (3 weeks)         (3 weeks)         (2 weeks)           │
│                                                                             │
│  • Schema          • Command         • Figma Make      • CI/CD             │
│    export tools      browser           integration       integration       │
│  • CLI updates     • Component       • Code gen        • Webhooks          │
│  • Types             binding           templates       • Dashboard         │
│                    • Validation      • UX patterns                         │
│                                                                             │
│  [Weeks 1-2]       [Weeks 3-5]       [Weeks 6-8]       [Weeks 9-10]        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Phase 1: Foundation (Weeks 1-2)

**Goal**: Extend AFD with schema discovery capabilities.

### Week 1: Schema Export Tools

| Task | Description | Deliverable |
|------|-------------|-------------|
| `schema.list` tool | List all commands with metadata | MCP tool |
| `schema.describe` tool | Get detailed schema for command | MCP tool |
| `schema.export` tool | Bulk export in multiple formats | MCP tool |
| `schema.uxPatterns` tool | UX field definitions | MCP tool |

**Files to create/modify**:
- `packages/server/src/schema-tools.ts` (new)
- `packages/server/src/schema-utils.ts` (new)
- `packages/server/src/server.ts` (register tools)

### Week 2: CLI & Types

| Task | Description | Deliverable |
|------|-------------|-------------|
| `afd schema` CLI | CLI commands for schema ops | CLI subcommand |
| Type generation | Generate TypeScript types | `afd docs generate --only types` |
| OpenAPI export | Generate OpenAPI 3.0 spec | `afd schema export --format openapi` |
| Figma format | Figma-optimized export | `afd schema export --format figma` |

**Files to create/modify**:
- `packages/cli/src/commands/schema.ts` (new)
- `packages/cli/src/generators/types.ts` (new)
- `packages/cli/src/generators/openapi.ts` (new)

### Phase 1 Exit Criteria

- [ ] `afd schema list` returns all commands
- [ ] `afd schema describe todo.create` returns full schema
- [ ] `afd schema export --format figma` produces valid JSON
- [ ] Generated TypeScript types compile without errors
- [ ] OpenAPI spec validates with swagger-cli
- [ ] 100% test coverage on new tools

---

## Phase 2: Figma Plugin MVP (Weeks 3-5)

**Goal**: Build Figma plugin for command discovery and binding.

### Week 3: Plugin Foundation

| Task | Description | Deliverable |
|------|-------------|-------------|
| Plugin scaffold | Create Figma plugin project | figma-afd-bridge/ |
| MCP client | Connect to AFD server | mcp-client.ts |
| Command browser UI | List/search commands | React component |
| Connection management | Connect/disconnect/status | UI panel |

**Files to create**:
- `figma-afd-bridge/manifest.json`
- `figma-afd-bridge/src/main.ts`
- `figma-afd-bridge/src/ui.tsx`
- `figma-afd-bridge/src/services/mcp-client.ts`
- `figma-afd-bridge/src/components/CommandBrowser.tsx`

### Week 4: Binding System

| Task | Description | Deliverable |
|------|-------------|-------------|
| Component binding | Link components to commands | Binding service |
| Auto-detection | Match layers to schema fields | Detection logic |
| Plugin data storage | Store bindings in Figma | Plugin data API |
| Binding panel UI | Show/edit bindings | React component |

**Files to create**:
- `figma-afd-bridge/src/services/binding-service.ts`
- `figma-afd-bridge/src/components/BindingPanel.tsx`
- `figma-afd-bridge/src/components/MappingEditor.tsx`

### Week 5: Validation & Polish

| Task | Description | Deliverable |
|------|-------------|-------------|
| Validation engine | Check bindings against schema | Validation service |
| Validation UI | Show errors/warnings | React component |
| Settings | Server URL, preferences | Settings panel |
| Documentation | Plugin usage guide | README.md |

**Files to create**:
- `figma-afd-bridge/src/services/validation-service.ts`
- `figma-afd-bridge/src/components/ValidationResults.tsx`
- `figma-afd-bridge/src/components/Settings.tsx`
- `figma-afd-bridge/README.md`

### Phase 2 Exit Criteria

- [ ] Plugin connects to AFD MCP server
- [ ] Commands browsable with search
- [ ] Components can be bound to commands
- [ ] Auto-detection suggests mappings
- [ ] Validation shows errors/warnings
- [ ] Bindings persist in Figma file
- [ ] Plugin published to Figma Community (private beta)

---

## Phase 3: Code Generation (Weeks 6-8)

**Goal**: Generate production code from Figma designs with AFD bindings.

### Week 6: Generation Templates

| Task | Description | Deliverable |
|------|-------------|-------------|
| Component template | React component structure | Template file |
| Form template | Form with validation | Template file |
| List template | Data list with pagination | Template file |
| UX pattern components | Confidence, warnings, etc. | Component library |

**Files to create**:
- `packages/codegen/src/templates/component.hbs`
- `packages/codegen/src/templates/form.hbs`
- `packages/codegen/src/templates/list.hbs`
- `packages/codegen/src/components/afd/*.tsx`

### Week 7: Figma Make Integration

| Task | Description | Deliverable |
|------|-------------|-------------|
| Context assembly | Build prompt context | Context builder |
| Prompt templates | Figma Make prompts | Template files |
| Export bindings | Export for Figma Make | JSON format |
| Post-processing | Format/lint generated code | Processor |

**Files to create**:
- `packages/codegen/src/figma-make/context.ts`
- `packages/codegen/src/figma-make/prompts/*.md`
- `packages/codegen/src/figma-make/post-process.ts`

### Week 8: Testing & Refinement

| Task | Description | Deliverable |
|------|-------------|-------------|
| Todo app generation | Generate full Todo UI | Working example |
| Code validation | Validate generated code | Validator |
| Type checking | Ensure TypeScript compiles | CI check |
| Documentation | Generation guide | Docs |

### Phase 3 Exit Criteria

- [ ] Generated code compiles without errors
- [ ] Commands invoked correctly in generated code
- [ ] UX patterns rendered appropriately
- [ ] Form validation works end-to-end
- [ ] Error states handled correctly
- [ ] Todo app works completely with generated UI
- [ ] Documentation covers generation workflow

---

## Phase 4: Full Loop (Weeks 9-10)

**Goal**: Complete the automation loop with docs, validation, and CI.

### Week 9: Documentation Pipeline

| Task | Description | Deliverable |
|------|-------------|-------------|
| `afd docs generate` | Generate all doc types | CLI command |
| `afd docs sync` | Sync with Figma | CLI command |
| `afd docs validate` | Check sync status | CLI command |
| Storybook integration | Generate stories | Story files |

**Files to create/modify**:
- `packages/cli/src/commands/docs.ts`
- `packages/cli/src/generators/markdown.ts`
- `packages/cli/src/generators/storybook.ts`
- `packages/cli/src/sync/figma.ts`

### Week 10: CI/CD & Polish

| Task | Description | Deliverable |
|------|-------------|-------------|
| CI workflow | GitHub Actions validation | Workflow file |
| Figma webhooks | Receive design updates | Webhook handler |
| Dashboard | Validation status view | Web page |
| Final documentation | Complete guide | Docs site |

**Files to create**:
- `.github/workflows/validate.yml`
- `.github/workflows/docs.yml`
- `packages/dashboard/` (simple status page)
- `docs/getting-started.md`

### Phase 4 Exit Criteria

- [ ] `afd docs generate` produces all outputs
- [ ] `afd docs validate` catches drift
- [ ] CI blocks on validation failures
- [ ] Figma webhooks trigger re-validation
- [ ] Dashboard shows current status
- [ ] Documentation is complete and accurate

---

## Technical Decisions

### Decision 1: Schema Format

**Options**:
1. **JSON Schema** — Standard, broad tooling support
2. **OpenAPI** — API-focused, good for REST
3. **Custom Figma format** — Optimized for UI generation

**Recommendation**: Support all three via `--format` flag. JSON Schema as internal representation, OpenAPI for API docs, custom format for Figma.

### Decision 2: MCP Transport

**Options**:
1. **Direct** — Figma plugin connects directly to AFD server
2. **IDE-mediated** — Cursor/VS Code acts as bridge
3. **Cloud proxy** — Central server for team access

**Recommendation**: Start with direct (Phase 2), add cloud proxy later for team use.

### Decision 3: Code Output

**Options**:
1. **Full components** — Complete React components
2. **Hooks only** — Just the command invocation logic
3. **Both** — Configurable output

**Recommendation**: Start with full components (easier to validate), add hooks option later.

### Decision 4: State Management

**Options**:
1. **Local state** — useState for simple cases
2. **React Query/SWR** — For data fetching
3. **Zustand/Jotai** — For complex state

**Recommendation**: Generate with local state by default, document patterns for integrating with state libraries.

---

## Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Figma API limitations | Medium | High | Early prototype to validate capabilities |
| Figma Make prompt instability | Medium | Medium | Version prompts, test extensively |
| Schema complexity | Low | Medium | Start with simple cases, iterate |
| Performance (large schemas) | Low | Low | Lazy loading, pagination |
| Team adoption | Medium | High | Good docs, clear value demo |

---

## Success Metrics

### Phase 1
- Schema tools response time < 100ms
- 100% schema coverage in exports

### Phase 2
- Plugin install to first binding < 5 minutes
- Auto-detection accuracy > 80%

### Phase 3
- Generated code compiles first time > 90%
- Time to generate component < 30 seconds

### Phase 4
- Documentation always in sync (CI enforced)
- Drift detection < 5 minutes after change

---

## Resource Requirements

### People
- 1 Full-stack developer (TypeScript, React)
- 1 Designer (Figma, design systems)
- Part-time: DevOps for CI/CD

### Tools
- Figma (design + plugin development)
- GitHub (repo, actions, webhooks)
- Vercel/Netlify (docs hosting)

### Budget
- Figma Organization plan (~$45/editor/month)
- GitHub Team (~$4/user/month)
- Hosting (~$20/month)

---

## Getting Started

### Prerequisites

```bash
# Clone AFD repo
git clone https://github.com/lushly-dev/afd.git
cd afd

# Install dependencies
pnpm install

# Verify setup
pnpm afd doctor
```

### Phase 1 First Steps

```bash
# Create schema tools branch
git checkout -b feature/schema-tools

# Start with schema.list implementation
# See: 01-afd-schema-layer.md for details
```

### Key Files to Review

1. `packages/server/src/server.ts` — Current MCP server implementation
2. `packages/core/src/result.ts` — CommandResult type definitions
3. `packages/cli/src/cli.ts` — CLI structure
4. `docs/command-schema-guide.md` — Schema design patterns

---

## Timeline Summary

| Week | Phase | Key Deliverables |
|------|-------|------------------|
| 1 | Foundation | Schema export MCP tools |
| 2 | Foundation | CLI commands, type generation |
| 3 | Plugin MVP | Figma plugin scaffold, MCP client |
| 4 | Plugin MVP | Binding system, auto-detection |
| 5 | Plugin MVP | Validation, polish, beta release |
| 6 | Generation | Code templates, UX components |
| 7 | Generation | Figma Make integration |
| 8 | Generation | Testing, Todo app example |
| 9 | Full Loop | Documentation pipeline |
| 10 | Full Loop | CI/CD, webhooks, dashboard |

**Total: 10 weeks to full implementation**

---

## Next Steps

1. **Review this plan** — Gather feedback, adjust scope
2. **Set up tracking** — GitHub project board or similar
3. **Phase 1 kickoff** — Start with `schema.list` implementation
4. **Weekly check-ins** — Track progress, adjust as needed

---

*This roadmap is a living document. Update as implementation progresses and learnings emerge.*
