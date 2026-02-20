# Alfred — AFD's Repo Quality Agent

> Alfred handles the deterministic work so agents can focus on reasoning.

## Summary

Alfred is a botcore-based bot for the AFD repo that provides deterministic quality tooling as MCP commands. Named for the acronym hiding in plain sight (**A**FD → **Alf**re**d**), and for the butler who keeps the Batcave running while Batman handles the hard stuff.

## Core Principle: Deterministic First

> Anything we can do deterministically with traditional code, we should. It's faster, cheaper, and predictable. Give agents these tools so they skip the expensive reasoning. Save agent work for things that are fuzzy and require judgment.

An `alfred-run afd-lint` executes in milliseconds and returns a definitive result. An agent doing the same work by reading every file and reasoning about patterns takes minutes, thousands of tokens, and might miss something. Alfred is the agent's fast path.

## Motivation

### The Cross-Repo Problem

Previous attempts at a shared "one bot for everything" caused:

- **Context confusion** — Agents landed features in the wrong repo (e.g., everything ended up in lushbot)
- **Skill sprawl** — Skills maintained across dozens of repos, drifting independently
- **Context window bloat** — Multiple repos open meant multiple AGENTS.md files and skill directories competing for context

### The Fix: Per-Repo Bots

Each repo gets its own bot, consuming botcore as a library:

- Bot scoped to the repo's domain — can't accidentally touch other repos
- Skills co-located with the code they describe — no drift
- Workspace reduced to active repos only — smaller context window
- Botcore improvements flow to all bots via version bumps

## Command Set

### Tier 1 — AFD-Specific

Domain commands unique to this repo.

| Command | Purpose | Output |
|---|---|---|
| `afd-lint` | AFD architecture compliance validation | Pass/fail with per-rule results |
| `afd-parity` | Cross-language API surface sync (TS ↔ Python ↔ Rust) | Gap report with source-of-truth recommendation |
| `afd-validate-schemas` | TypeSpec → TS/Python/Rust schema drift detection | Diff per language with remediation steps |
| `afd-release-check` | Pre-release validation (changelog, versions, tests) | Checklist with pass/fail per item |
| `afd-quality` | Semantic quality validation of command descriptions | Similarity matrix, ambiguity flags |

### Tier 2 — Universal Repo Health

Reusable commands from a botcore plugin (e.g., `botcore-repo-health`). Every repo bot can install these.

| Command | Purpose | Output |
|---|---|---|
| `dead-code` | Unreachable exports, unused imports, orphaned files | File list with removal suggestions |
| `broken-links` | Scan markdown for dead references and URLs | Broken link list with line numbers |
| `doc-rot` | Stale examples, outdated versions, missing sections | Issue list with severity |
| `coverage` | Per-package test coverage with threshold enforcement | Coverage table with pass/fail |
| `dep-audit` | Outdated dependencies, security advisories | Dependency table with upgrade priority |

### The Split

Tier 1 commands live in the AFD repo — they're domain-specific. Tier 2 commands ship as a botcore plugin that any repo bot can install. Write them once, every bot gets them.

## Architecture

```
AFD Repo
├── alfred/
│   ├── pyproject.toml          # depends on botcore, botcore-repo-health
│   ├── commands/
│   │   ├── lint.py             # afd-lint
│   │   ├── parity.py           # afd-parity
│   │   ├── schemas.py          # afd-validate-schemas
│   │   ├── release.py          # afd-release-check
│   │   └── quality.py          # afd-quality
│   ├── skills/                 # Bot-specific skills (or symlink to .claude/skills)
│   └── server.py               # Entry point, registers all commands
```

Alfred exposes 3 MCP tools: `alfred-start`, `alfred-docs`, `alfred-run`. Agents discover commands via `alfred-start`, read docs via `alfred-docs`, execute via `alfred-run`.

## Key Design: `afd-parity`

The most unique command. Diffs public API surface across three languages:

1. **Parse exports** — TS `export` statements, Python `__init__.py` imports, Rust `pub` declarations
2. **Normalize names** — `createCommandRegistry` → `create_command_registry` (camelCase → snake_case)
3. **Diff** — Report missing, extra, and mismatched signatures per language
4. **Confidence** — 1.0 when all three match, degrades as gaps grow

Returns `CommandResult` with reasoning explaining each gap and alternatives suggesting which language to use as source of truth.

## Dogfooding

Alfred is AFD validating itself:

- Every command returns a proper `CommandResult` with confidence, reasoning, and suggestions
- Alfred uses botcore (which should adopt AFD patterns per the botcore architecture eval)
- AFD compliance, parity, and schema validation run on the repo that defines those standards
- The architecture eval items (semantic quality validation, middleware defaults) get validated here first

## Workspace Impact

Adding Alfred enables removing several repos from the active workspace:

- `lushbot` — No longer needed for agent-facing dev commands
- Other repos with overlapping quality tooling

Fewer repos = smaller context window = focused agents = better results.

## Migration Path: `botcore-afd` Extension

Alfred is the proving ground. Once validated, the portable AFD commands extract into a `botcore-afd` extension in the shared libraries repo. Any AFD-based project installs it and gets instant quality tooling.

**Extracts to `botcore-afd`:**
- `afd-lint` — Works on any repo using AFD patterns
- `afd-parity` — Any multi-language AFD project needs this
- `afd-validate-schemas` — TypeSpec sync applies wherever TypeSpec is used
- `afd-quality` — Command description validation works on any command set

**Stays in Alfred:**
- `afd-release-check` — Tied to this repo's versioning and changelog
- Any commands specific to the AFD framework's own structure

A noisett bot, lushly bot, or any future project bot does `pip install botcore-afd` and gets AFD compliance out of the box. Alfred validates the patterns. The extension distributes them.

## Next Steps

1. Add `alfred/` directory with `pyproject.toml` depending on botcore
2. Implement `afd-lint` as the first command (already exists as a CLI tool, wrap it)
3. Implement `afd-parity` as the unique high-value command
4. Add `broken-links` and `doc-rot` from the repo-health plugin
5. Configure MCP server entry point for Claude Code integration
