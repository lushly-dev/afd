---
name: research-topics
source: botcore
description: >
  Researches APIs, best practices, and unfamiliar technologies using a systematic multi-source strategy. Covers codebase analysis, documentation lookup, web search, CLI research tools, and source verification workflows. Use when implementing unfamiliar APIs, troubleshooting unknown errors, evaluating libraries, or verifying best practices. Triggers: research, how to, learn, API, documentation, best practice, investigate, evaluate.

version: 1.0.0
triggers:
  - research
  - how to
  - learn
  - API
  - documentation
  - best practice
  - investigate
  - evaluate
  - unfamiliar
portable: true
---

# Researching Topics

Systematic approach to investigating unfamiliar topics, APIs, and best practices using all available tools.

## Capabilities

1. Research unfamiliar APIs, libraries, and frameworks using structured multi-source investigation
2. Troubleshoot unknown errors by gathering context from docs, codebase, and web sources
3. Evaluate technologies and compare alternatives with evidence-based analysis
4. Verify best practices against official documentation and reputable sources
5. Synthesize findings into actionable guidance that matches project conventions
6. Use CLI research tools (e.g., `lushbot research`) when available for fast, sourced answers

## Routing Logic

```
Research request received
│
├─ Topic has domain-specific reference? → See references/
│   └─ Use reference as starting point, verify currency
│
├─ Question about project patterns? → Search codebase first
│   └─ Check README, AGENTS.md, existing implementations
│
├─ Need current/external information? → Web search + CLI tools
│   └─ Cross-reference multiple sources
│
└─ Comparative evaluation? → Structured comparison workflow
    └─ Gather data on all candidates before recommending
```

## Core Principles

1. **Local-first research** -- Always check project docs and codebase before reaching for external sources. Existing patterns in the repo are the strongest signal for how to proceed.
2. **Specificity in queries** -- Include version numbers, framework names, and concrete scenarios. "FAST Element v2 reactive properties" beats "web component state."
3. **Source verification** -- Never trust a single source. Cross-reference official docs, reputable blogs, and working examples. Check publication dates for currency.
4. **Project-convention alignment** -- Research findings must be adapted to match the project's existing patterns, tooling, and style. A technically correct answer that conflicts with project conventions is wrong.
5. **Evidence over assumptions** -- Provide sources, code examples, and rationale. Flag uncertainty explicitly rather than presenting guesses as facts.
6. **Incremental application** -- Test researched solutions in isolation before integrating. Apply in small steps and verify at each stage.

## Workflow

### Phase 1: Scope the Question

- Restate the research question in precise terms
- Identify what is already known vs. what needs to be discovered
- Determine version constraints (language, framework, library versions)
- Check if the project has existing patterns or documentation that address the topic

### Phase 2: Search Locally

```
Project sources (check in order):
1. README.md, AGENTS.md, CLAUDE.md — project-level guidance
2. Codebase search — grep for similar patterns, imports, usages
3. Package manifests — check installed versions in package.json, Cargo.toml, etc.
4. Config files — existing tool/framework configuration
5. Test files — working examples of the pattern in use
```

### Phase 3: Search Externally

| Method | Best For | Notes |
|--------|----------|-------|
| Web search | Current events, release notes, comparisons | Verify date and source authority |
| Official docs | API reference, configuration options | Canonical source of truth |
| CLI research tools | Quick sourced answers | Use `--agent` mode for structured output when available |
| GitHub issues/PRs | Bug workarounds, edge cases | Check if issue is still open/relevant |

### Phase 4: Synthesize and Verify

- Combine findings from multiple sources into a coherent answer
- Resolve any conflicts between sources (prefer official docs, then recency)
- Adapt the solution to match project conventions
- Prepare a minimal test or proof of concept

### Phase 5: Document and Apply

- Summarize findings with sources for future reference
- Apply the solution incrementally
- Test after each change
- Note any caveats, limitations, or follow-up research needed

## Query Construction Guide

| Do | Don't |
|----|-------|
| Include specific version numbers | Assume "latest" without checking |
| Name the exact framework or library | Use generic terms like "JavaScript framework" |
| Describe the concrete scenario | Ask vague open-ended questions |
| Specify the runtime environment | Ignore platform differences |
| Ask one focused question at a time | Combine multiple unrelated questions |

### Example Queries

```
"TypeScript 5.4 satisfies operator use cases"
"Vite 6 module federation plugin setup"
"Azure Static Web Apps custom authentication flow"
"FAST Element v2 observable vs attr difference"
"pnpm workspace protocol syntax for local packages"
```

## Checklist

- [ ] Research question is stated precisely with version/context constraints
- [ ] Project codebase checked for existing patterns and conventions
- [ ] Project documentation (README, AGENTS.md) reviewed
- [ ] At least two independent sources consulted for external information
- [ ] Source authority and publication dates verified
- [ ] Findings adapted to match project conventions
- [ ] Solution tested in isolation before integration
- [ ] Sources and rationale documented alongside the solution
- [ ] Uncertainty flagged explicitly where applicable

## When to Escalate

- **Conflicting official sources** -- When two authoritative sources (e.g., official docs vs. official blog post) contradict each other, flag both positions and let the developer decide.
- **No authoritative source found** -- When a question cannot be answered from official docs or reputable sources, state the gap clearly rather than speculating.
- **Breaking changes or deprecations** -- When research reveals that the project is using deprecated APIs or patterns that will break in upcoming versions, escalate immediately.
- **Security implications** -- When a researched approach has security trade-offs, present the risks explicitly and defer the decision.
- **Architecture-level decisions** -- When research leads to a recommendation that would require significant refactoring or architectural changes, present options rather than prescribing a path.
