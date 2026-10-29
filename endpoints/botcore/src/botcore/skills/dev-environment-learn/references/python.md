# Python Environment

Rules, patterns, and tooling for Python environment management in agentic development.

## Golden Rules

1. **Every project gets a venv** — No exceptions
2. **Never `pip install` outside a venv** — Not even "just this one tool"
3. **Use explicit Python paths in configs** — Never bare `python` or `python3`
4. **Document the venv setup** — In AGENTS.md, README, or SETUP.md
5. **One install command, not many** — Use `pip install -e ".[dev]"`, not individual packages

## Virtual Environment Basics

### Creating a Venv

```bash
# With uv (preferred — fast, handles Python version)
uv venv .venv --python 3.13

# With standard library
python -m venv .venv
```

### Activating

```bash
source .venv/bin/activate      # macOS/Linux
.venv\Scripts\activate         # Windows cmd
.venv\Scripts\Activate.ps1     # Windows PowerShell
```

### Verifying You're in a Venv

Before any `pip install`, confirm:

```bash
# macOS/Linux
which python
# Should show: /path/to/project/.venv/bin/python

# Windows (PowerShell)
Get-Command python | Select-Object Source
# Should show: D:\project\.venv\Scripts\python.exe
```

**Red flags** — you're NOT in a venv if the path shows:
- `/usr/bin/python` or `/usr/local/bin/python` (system Python)
- `C:\Python3XX\python.exe` (global installer)
- `WindowsApps\python.exe` (Windows Store stub)

## Package Installation

### Safe Patterns

```bash
# Activate venv first, then install
uv pip install -e ".[dev]"    # With uv
pip install -e ".[dev]"       # With pip
```

### Dangerous Patterns

```bash
pip install requests          # Global install — WRONG
pip install -e .              # Global editable — VERY WRONG
pip install --user somepackage  # User site-packages — WRONG
```

### Dependency Ordering

When a project has internal dependencies (e.g., `botcore` depends on `afd`),
install in dependency order:

```bash
uv pip install -e /path/to/root-dep     # 1. Root dependency
uv pip install -e /path/to/mid-dep      # 2. Middle layer
uv pip install -e ".[dev]"              # 3. Current project
```

## MCP Server Configuration

### VS Code Format (`.vscode/mcp.json`)

```json
{
  "servers": {
    "my-server": {
      "type": "stdio",
      "command": "D:/Github/project/.venv/Scripts/python.exe",
      "args": ["-m", "my_package.mcp_server"]
    }
  }
}
```

### Claude Code Format (`.claude/mcp.json`)

```json
{
  "mcpServers": {
    "my-server": {
      "command": "D:/Github/project/.venv/Scripts/python.exe",
      "args": ["-m", "my_package.mcp_server"]
    }
  }
}
```

### Common Mistakes

| Pattern | Problem | Fix |
|---------|---------|-----|
| `"command": "python"` | Depends on PATH ordering | Use full venv path |
| `"command": "python3"` | Same PATH problem | Use full venv path |
| Using `cwd` to find Python | Fragile, confusing | Use full venv path |
| Relative paths | Breaks when workspace root changes | Use absolute paths |

## Shared vs. Separate Venvs

### Separate Venvs (Default)

Each project gets its own `.venv/`. Use when projects are independent.

### Shared Venv (Plugin Ecosystems)

Multiple packages share one venv when they form a plugin ecosystem:

```
orchestrator/.venv/     # Contains orchestrator + all plugins
├── orchestrator        # pip install -e orchestrator
├── plugin-a            # pip install -e plugin-a
└── plugin-b            # pip install -e plugin-b
```

**Document it:** The host project's AGENTS.md must list all packages that share
the venv and the install order.

## Editable Installs

`pip install -e .` creates a link from the venv to your source directory. Safe
in a venv. **Extremely dangerous in global scope** — creates invisible links that
affect every project using global Python.

## uv Quick Reference

| Command | Purpose |
|---------|---------|
| `uv python install 3.13` | Install a Python version |
| `uv python list` | List available/installed versions |
| `uv venv .venv --python 3.13` | Create venv with specific Python |
| `uv pip install -e ".[dev]"` | Install package (editable + dev deps) |
| `uv pip list` | List installed packages |
| `uv pip uninstall package` | Remove a package |
| `uv self update` | Update uv itself |

**Install uv:**
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh       # macOS/Linux
irm https://astral.sh/uv/install.ps1 | iex              # Windows
```

## pyproject.toml Hygiene

### Minimal Required Fields

```toml
[project]
name = "my-package"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = ["required-dep>=1.0"]

[project.optional-dependencies]
dev = ["pytest", "ruff"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

### Avoid

- Exact version pins in library dependencies (`==1.2.3`) — use ranges
- Mixing build systems (`setup.py` + `pyproject.toml`)
- Forgetting `requires-python` — agents won't know which version to use

## Venv Naming

Always use `.venv` as the directory name (not `venv`, `env`, `.env`):
- Most tools auto-detect `.venv`
- `.gitignore` templates include it
- VS Code auto-discovers it for interpreter selection
