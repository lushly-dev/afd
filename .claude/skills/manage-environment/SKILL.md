---
name: manage-environment
source: botcore
description: >
  Dev environment hygiene for agentic development. Prevents global package pollution, version drift, PATH entropy, and lockfile conflicts across Python, Node.js, and system tooling. Covers installation best practices, audit workflows, cleanup playbooks, and cross-platform patterns (Windows + macOS). Use when installing packages, configuring MCP servers, setting up toolchains, debugging import/resolution errors, or cleaning up polluted environments.

version: 1.0.0
triggers:
  - environment
  - python
  - pip install
  - venv
  - virtual environment
  - uv
  - node
  - npm
  - pnpm
  - fnm
  - nvm
  - PATH
  - global packages
  - lockfile
  - package manager
  - MCP config
  - environment setup
  - editable install
  - pyproject.toml
  - node_modules
  - corepack
portable: true
---

# Manage Environment

Prevent and fix the dev environment entropy that accumulates during agentic coding.

## Why This Exists

AI agents install packages eagerly, skip version checks, and rarely clean up.
Without guardrails, a dev machine drifts toward global pollution, version
mismatches, broken PATH ordering, stale lockfiles, and MCP configs that resolve
the wrong runtime. This skill encodes the hard-won lessons from cleaning up
those messes — and the rules that prevent them.

## Capabilities

1. **Python** — venv isolation, uv, pip hygiene, MCP server configs, editable installs
2. **Node.js** — version management (fnm), npm globals, pnpm version pinning, lockfile hygiene
3. **PATH & System** — PATH ordering, deduplication, platform stubs, shell config
4. **Audit** — Commands to detect drift across all ecosystems before it causes failures
5. **Cleanup** — Step-by-step playbooks for fixing polluted environments
6. **Cross-platform** — Windows and macOS guidance throughout

## Routing Logic

| Request type | Load reference |
|--------------|----------------|
| Python packages, venvs, uv, pip, MCP configs | [references/python.md](references/python.md) |
| Node.js, npm, pnpm, lockfiles, version managers | [references/node.md](references/node.md) |
| PATH ordering, dedup, stubs, shell config | [references/path-management.md](references/path-management.md) |
| Diagnosing issues, checking for pollution | [references/audit-checklist.md](references/audit-checklist.md) |
| Fixing broken environments, rebuilding | [references/cleanup-playbook.md](references/cleanup-playbook.md) |
| Windows vs macOS platform differences | [references/platform-notes.md](references/platform-notes.md) |

## Core Principles

### 1. Never Install to Global

Every `pip install` targets a venv. Every `npm install <pkg>` targets a project.
Global scope is shared state — one project's dependency can break another.

### 2. Explicit Over Implicit

MCP configs, CI scripts, and tool definitions use **full paths** to runtimes —
never bare `python`, `python3`, or `node`. Bare commands depend on PATH ordering,
which varies between terminals, users, and platforms.

### 3. Pin Versions at Every Layer

- **Python version**: `uv venv .venv --python 3.13`
- **Node version**: `.node-version` file + fnm
- **Package manager**: `packageManager` field in `package.json`
- **Dependencies**: Lockfiles committed to git

### 4. One Isolation Boundary Per Project

Each project gets its own `.venv` (Python) or `node_modules` (Node). Shared
boundaries (e.g., plugin ecosystems sharing a venv) must be documented.

### 5. Platform Parity

Any config, script, or setup step must work on both Windows and macOS. Use
forward slashes in JSON configs. Test PATH changes on both platforms. Document
platform-specific steps when unavoidable.

## Quick Reference

### Python

```bash
# Create a venv
uv venv .venv --python 3.13

# Install project with dev deps
uv pip install -e ".[dev]"

# MCP config — always explicit path
{ "command": "D:/project/.venv/Scripts/python.exe" }   # Windows
{ "command": "/Users/me/project/.venv/bin/python" }    # macOS
```

### Node.js

```bash
# Install fnm (version manager)
# Windows: winget install Schniz.fnm
# macOS: brew install fnm

# Pin and use a Node version
echo "22" > .node-version
fnm use

# Align pnpm version
corepack enable
corepack prepare pnpm@10.26.2 --activate
```

### PATH Health

```bash
# Check for duplicates (PowerShell)
($env:PATH -split ";") | Group-Object | Where-Object { $_.Count -gt 1 }

# Check for duplicates (bash)
echo $PATH | tr ':' '\n' | sort | uniq -d
```

## Workflow

### Before Installing Anything

1. **Check ecosystem** — Is this a Python package or a Node package?
2. **Check isolation** — Am I in the right venv / project directory?
3. **Check version** — Is the runtime version what this project expects?
4. **Install** — Use the project-specific package manager
5. **Verify** — Confirm the package landed in the right place

### When Something Breaks

1. **Identify ecosystem** — Python import error? Node resolution error? Command not found?
2. **Run audit** — Load the [audit checklist](references/audit-checklist.md) for the relevant ecosystem
3. **Diagnose** — Is it PATH? Global pollution? Version mismatch? Stale lockfile?
4. **Fix** — Follow the [cleanup playbook](references/cleanup-playbook.md)
5. **Prevent** — Update project docs and configs to prevent recurrence

## Checklist

Before any environment work, verify:

- [ ] **Python**: Working inside a virtual environment (not global)
- [ ] **Python**: MCP configs use explicit venv Python paths
- [ ] **Node**: Project has a `.node-version` or `packageManager` field
- [ ] **Node**: Only one lockfile type per project (not both npm + pnpm)
- [ ] **PATH**: No stale entries for uninstalled tool versions
- [ ] **PATH**: No duplicate entries
- [ ] **General**: No bare `python` or `node` in config files

## When to Escalate

- Conda environments mixed with pip/venv
- Docker-based isolation needed for incompatible dependency trees
- Monorepo tooling conflicts (different Node versions per package)
- CI/CD environment differs fundamentally from local
- System-level Python required by OS tools (Linux)
