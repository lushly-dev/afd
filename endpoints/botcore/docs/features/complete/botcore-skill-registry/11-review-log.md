# Review Response Log

> Part of [Bot Core + Skill Registry Plan](./00-overview.md)

---

Review received 2026-02-18. Triage decisions documented below.

## Round 1

### Accepted

| # | Concern | Action taken |
|---|---------|-------------|
| 1 | Scope creep — decouple module system from Phase 1 | Phases restructured. Phase 1 is now monolithic botcore. Module split moved to Phase 5 ("If Needed"). |
| 2 | BotCoreConfig duplicates DevConfig | DevConfig model removed entirely. All dev settings live flat on BotCoreConfig. Comment added explaining the decision. |
| 4 | Per-package shallow merge underspecified | `get_config_for_path()` docstring now documents REPLACE semantics explicitly. Uses `model_dump(exclude_none=True)` so only set fields override. |
| 5 | No migration/rollback strategy | New "Migration Strategy" section added: lushbot first → fabux → proto, version pinning, rollback plan, breaking change policy. |
| 6 | `packages: dict[str, dict[str, Any]]` bypasses validation | Changed to `dict[str, PackageOverrideConfig]`. New `PackageOverrideConfig` model with `extra="forbid"` validates per-package overrides. Only override-appropriate fields are included. |
| 7 | No testing strategy | New "Testing Strategy" section added: unit tests (config, commands, plugins, skills), integration tests (module discovery, MCP, CLI), canary CI matrix across consumer repos. |

### Accepted Nits

| # | Nit | Action taken |
|---|-----|-------------|
| 2 | `agent_skills = true` behavior undocumented | Added one-liner in seed algorithm step 4: "copies each seeded skill to `.agent/skills/<name>/`" |
| 3 | Migration table should note MCP config file locations | Added list of config files to update (`.cursor/mcp.json`, `claude_desktop_config.json`, `.vscode/mcp.json`, project `mcp.json`) + coordination note. |
| 4 | Config loader "cleaner" unexplained | Extraction manifest now explains: "dedicated `utils/config.py` with `load_config()`, no cross-module private imports, no config buried in quality.py." |

### Rejected

| # | Concern | Rationale |
|---|---------|-----------|
| 3 | Module vs Plugin distinction premature — merge into single extension mechanism | The distinction maps to real architectural differences: **modules** are tool wrappers (ruff, biome, cdp) that provide capabilities to the kernel's dispatch system. **Plugins** are project identity packages (lushbot-plugin, proto-plugin) that compose modules + add project-specific commands + own state + define workflows. Merging them would force every project plugin to also be a tool wrapper, or every tool wrapper to carry project state. That said, the reviewer's *underlying concern* is valid — two registration APIs is more surface area. The mitigation is that Phase 1 ships monolithic (no module split), so only the Plugin entry point exists initially. The Module entry point is introduced in Phase 5 only if needed. |

### Skipped Nits

| # | Nit | Rationale |
|---|-----|-----------|
| 1 | ASCII diagram box alignment | Cosmetic. Not worth the diff noise in a planning document. |

---

## Round 2

Review received 2026-02-18 (second pass). All concerns accepted.

### Accepted

| # | Concern | Action taken |
|---|---------|-------------|
| 1 | Phase 5 module architecture takes ~220 lines of main plan | Moved entire Module Architecture section to Appendix A at bottom of plan. Replaced with a 7-line stub + forward reference link. |
| 2 | Phase 1 still too large to implement in one pass | Split into 4 sub-phases: 1a (skeleton + config + plugin + 2-3 commands), 1b (dev + docs + info commands), 1c (CDP + research + spec + undo), 1d (first consumer — lushbot thin plugin, fabux validated). |
| 3 | Non-Python repos (proto, fabric-ux-prototype) have no install model | Added "Installation Model for Non-Python Repos" section: recommends `pipx install botcore` for TS repos, workspace venv for mixed repos, MCP config example. |
| 4 | Stale skills with no `source:` field have no adoption path | Added `botcore skill adopt <name> [--source botcore]` command to Skill Registry Commands. Adds `source:` frontmatter to existing unmanaged skills. |
| 5 | `set_state_backend()` on plugin contract is underspecified | Removed from plugin contract. Plugins manage their own state internally — Convex client, SQLite, filesystem, etc. are plugin implementation details, not kernel concerns. |
| 6 | No success criteria per phase | Added acceptance criteria to every phase (1a through 5), each with concrete testable conditions. |

### Accepted Minor Items

| # | Item | Action taken |
|---|------|-------------|
| 1 | `.agent/skills/` mirroring: cut if no consumer | Kept — lushbot's `dev/core.py` and workspace `copilot-instructions.md` both reference it. Changed default to `false` and added note that it's only needed for Claude Code CLI users. |
| 2 | EnvConfig disconnected from config system | Added injection path documentation: EnvConfig is attached to Click context during loading, commands access via `ctx.obj.env`, enables mock injection in tests. |
| 3 | Nexus rename rows speculative | Added callout note that Nexus is a separate project and may not adopt botcore naming. Marked rows as "for completeness only." |
| 4 | Cross-language override example confusing | Reworded comment to clarify it's uncommon (mixed-language repos), added note that most repos should rely on auto-detection. |
