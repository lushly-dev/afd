# Do-Commit Full Checklist

Expanded reference for all checks performed during a full `do-commit` pass.

---

## 1. Quality Gate (Automated)

All checks are language-aware — only relevant checks run based on detected project files.

### TypeScript (detected via `package.json`)
- [ ] Biome/ESLint lint passes
- [ ] `tsc --noEmit` typecheck passes
- [ ] Vitest/Jest tests pass
- [ ] Build succeeds (`pnpm build` / `turbo build`)

### Python (detected via `pyproject.toml`)
- [ ] Ruff lint passes
- [ ] Mypy/Pyright typecheck passes (if configured)
- [ ] Pytest tests pass
- [ ] Build succeeds (`hatch build` / `python -m build`)

### Rust (detected via `Cargo.toml`)
- [ ] Clippy lint passes
- [ ] `cargo check` typecheck passes
- [ ] `cargo test` passes
- [ ] `cargo build` succeeds

### Universal
- [ ] File sizes under threshold (default: warn 500, error 1000 lines)
- [ ] No hardcoded paths (cross-platform portability)
- [ ] No circular imports

---

## 2. Temp File Cleanup

| Pattern | Location | Action |
|---------|----------|--------|
| `*.plan.md` | Repo root | Delete (agent planning artifacts) |
| `*.review.md` | Repo root | Delete (agent review artifacts) |
| `nul` | Repo root | Delete (Windows null device artifact) |
| `*.tmp` | Anywhere | Delete |
| `*.log` | Repo root | Delete (unless intentional logging) |
| `*.pyc` | Source dirs | Delete (should be .gitignored) |
| `__pycache__/` | Source dirs | Delete (should be .gitignored) |
| `coverage/` | Repo root | Delete if not .gitignored |
| `.coverage` | Repo root | Delete if not .gitignored |
| `dist/` | Repo root | Verify .gitignored |
| `node_modules/` | Repo root | Verify .gitignored |

**Rule**: Always confirm with user before deleting unexpected files.

---

## 3. Documentation Gate

| Check | Tool | Judgment required |
|-------|------|-------------------|
| CHANGELOG.md staleness | `docs_check_changelog` | Update if source files changed |
| AGENTS.md staleness | `docs_check_agents` | Update if structure changed (new commands, packages) |
| README.md currency | Manual review | Update if new features, commands, or setup steps |
| Skill validation | `skill_lint` | Only if skill files were modified |

---

## 4. Self-Review

| Category | Patterns to find | Action |
|----------|-----------------|--------|
| Debug markers | `TODO`, `FIXME`, `HACK`, `XXX` | Remove or convert to tracked issues |
| Debug statements | `console.log`, `print(`, `dbg!`, `debugger`, `breakpoint()` | Remove |
| Commented code | Multi-line comment blocks containing code | Remove |
| Secrets | API keys, tokens, passwords, connection strings | Move to env vars |
| Unintended files | `.env`, `.DS_Store`, `Thumbs.db`, editor configs | Add to .gitignore |

---

## 5. Commit

Delegate to `write-commits` skill:
- [ ] Conventional Commits format (`type(scope): subject`)
- [ ] Scope matches changed package/area
- [ ] Subject is imperative ("add feature" not "added feature")
- [ ] Body explains why, not what (the diff shows what)
- [ ] Breaking changes noted with `BREAKING CHANGE:` footer
- [ ] Multi-package changes use appropriate scope or no scope
