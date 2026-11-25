---
"lushly-botcore": minor
---

### Added

- **`[skills].extra_dirs` and `[skills.aliases]`** in `botcore.toml` / `pyproject.toml`, plus personal/configured external skill folders (`skill_usage_dirs` in `disk.toml`, `BOTCORE_SKILL_USAGE_USER_DIRS`) and local tracking of loaded `SKILL.md` file locations, so `skill-usage-report` returns sizes, listing cost and `quiet` entries for skills kept outside `.claude/skills`, `.agents/skills` and `.codex/skills`, and `skill-usage-triggers` resolves configured `[skills.aliases]` when judging required loads (#1830).
