# Portability Considerations

> Part of [Bot Core + Skill Registry Plan](./00-overview.md)

---

## Issues That Break When Generalizing

These are the concrete problems discovered when analyzing what it takes to make
bot commands work outside their original repo:

| Issue | Current state | Bot core solution |
|-------|--------------|-------------------|
| **Tool availability** | Commands assume tools exist (ruff, biome, vulture). Missing tool = cryptic subprocess error | Modules check `optional_deps` at registration. Missing → clear error: "Install ruff: pip install ruff" |
| **Sync vs async** | Proto is fully synchronous (subprocess.run). Lushbot + fabux are async. | **Standardize on async.** MCP handlers are async, DirectClient is async, parallel execution needs asyncio.gather(). Proto's sync code migrates during extraction. |
| **CLI branding** | Each bot has a hardcoded CLI name (lushx, proto, fabux) | Plugin provides the CLI name. `registry.set_cli_name("lushx")`. Kernel's Click group uses it. |
| **MCP server identity** | Each bot identifies as a different server in MCP | Plugin provides MCP server name. `registry.set_mcp_name("lushx")`. |
| **Optional dependencies** | Research needs google-generativeai, CDP needs websockets — currently bundled | Each module is a separate package with its own deps. Core is lightweight. |
| **Return format** | Proto returns raw Python dicts. Lushbot/fabux use success()/error() sometimes but not consistently. | **AFD CommandResult everywhere.** All modules return `success()` or `error()`. Plugins must too. |
| **Workspace detection** | Lushbot looks for pnpm-workspace.yaml. Proto looks for specific paths. Fabux looks for kb/ directory. | Core provides generic `find_workspace()` (walks up for pyproject.toml, package.json, Cargo.toml). Plugins can override with `detect_workspace()` for repo-specific markers. |
| **Git hooks integration** | Proto uses Lefthook with TypeScript scripts. Lushbot uses Lefthook with Python commands. | Out of scope for bot core — hooks call the CLI, CLI routes to modules. As long as the CLI works, hooks work. |
| **Smart truncation** | Lushbot truncates output to ~8000 chars for MCP context budget. Proto has no truncation. | Core provides `smart_truncate()` utility. MCP framework applies it automatically. CLI doesn't truncate. |

---

## Async Standardization Details

Proto has ~40 commands, all synchronous. Migration path:

```python
# Before (proto pattern):
def lint_command(package=None, fix=False):
    result = subprocess.run(["npx", "biome", "check", ...])
    return {"success": result.returncode == 0, "output": result.stdout}

# After (bot core pattern):
async def lint_command(package=None, fix=False):
    result = await run_command(["npx", "biome", "check", ...])
    return success({"output": result.stdout}) if result.returncode == 0 else error(...)
```

The `run_command()` utility (already async in lushbot) wraps `asyncio.create_subprocess_exec()`.
Most migrations are mechanical: add `async`, swap `subprocess.run` → `await run_command()`,
wrap return in `success()` / `error()`.
