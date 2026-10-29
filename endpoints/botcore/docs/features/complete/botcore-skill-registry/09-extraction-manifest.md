# Extraction Manifest & Duplication Evidence

> Part of [Bot Core + Skill Registry Plan](./00-overview.md)

---

## Existing Code to Extract (Extraction Manifest)

| Module | Source of truth | Current consumers | Target in botcore |
|--------|----------------|-------------------|-------------------|
| `runner.py` (run_command, smart_truncate) | lushbot | lushbot, fabux | `botcore.utils.runner` |
| `workspace.py` (find_workspace, get_packages) | lushbot | lushbot, fabux | `botcore.utils.workspace` |
| `dev/core.py` (lint, test wrappers) | lushbot | lushbot, fabux | `botcore.commands.dev` |
| `dev/quality.py` (check-size, check-coverage) | lushbot | lushbot, fabux | `botcore.commands.dev` |
| `dev/analysis.py` (dead-code, circular-imports) | lushbot | lushbot, fabux | `botcore.commands.dev` |
| `dev/portability.py` (check-paths) | lushbot | lushbot, fabux | `botcore.commands.dev` |
| `docs.py` (lint, check-changelog, check-agents) | lushbot | lushbot, fabux | `botcore.commands.docs` |
| `spec.py` (create, status, validate) | lushbot | lushbot | `botcore.commands.spec` |
| `research.py` (Gemini + Google) | lushbot | lushbot | `botcore.commands.research` |
| `undo.py` (history tracking) | lushbot | lushbot | `botcore.commands.undo` |
| `info.py` (workspace, scripts, env) | lushbot | lushbot, fabux | `botcore.commands.info` |
| `cdp/` (28 browser commands) | lushbot | lushbot | `botcore.commands.cdp` |
| Config loader | fabux (cleaner — dedicated `utils/config.py` with `load_config()`, no cross-module private imports, no config buried in quality.py) | lushbot, fabux | `botcore.config` |
| MCP 3-tool pattern | lushbot | lushbot, proto | `botcore.mcp` |

---

## Bot Duplication Evidence (Command-Level)

| Command | lushbot | proto | fabux | Duplication |
|---------|---------|-------|-------|-------------|
| `dev lint` | ruff | Biome | ruff | Same pattern, different tool |
| `dev test` | pytest | Vitest | pytest | Same pattern, different tool |
| `dev check-size` | Yes | Yes | Yes | All 3 identical pattern |
| `dev check-coverage` | Yes | Yes | Yes | All 3 identical pattern |
| `dev dead-code` | vulture | knip | vulture | lushbot ↔ fabux identical |
| `dev circular-imports` | AST | madge | AST | lushbot ↔ fabux identical |
| `dev unused-deps` | Yes | — | Yes | lushbot ↔ fabux identical |
| `dev check-paths` | Yes | hooks | Yes | lushbot ↔ fabux identical |
| `docs check-changelog` | Yes | Yes | Yes | All 3 identical pattern |
| `docs check-agents` | Yes | Yes | Yes | All 3 identical pattern |
| `info workspace` | Yes | Yes | Yes | All 3 identical pattern |
| `info env` | Yes | Yes | Yes | All 3 identical pattern |

---

## Skill Duplication Evidence (Cross-Directory)

| Skill | Root v | Proto v | Fabux | Agent v | Status |
|-------|--------|---------|-------|---------|--------|
| reviewer | 4.6.0 | 1.0.0 | empty folder | 4.2.0 | 4-way mess |
| spec-writer | 2.2.0 | 1.0.0 (rewrite) | — | 1.1.0 | 3-way divergence |
| skill-manager | 2.2.0 | 2.2.0 | — | 2.2.0 | OK |
| accessibility | 2.1.0 (generic) | no ver (Fabric) | accessibility-ally | 2.1.0 | 3 different skills |
| design-tokens | — | 2.0.0 | no ver | — | Same name, different content |
| fabric-components | — | proto ver | fabux ver | — | Same name, different content |
| mcp-server | 1.2.0 | — | — | 1.1.0 | Agent stale |
