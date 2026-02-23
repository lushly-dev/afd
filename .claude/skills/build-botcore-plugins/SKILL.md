---
name: build-botcore-plugins
source: botcore
description: >
  Guides development of botcore plugins from protocol implementation to distribution. Covers BotCorePlugin protocol, PluginRegistry API, async command authoring with AFD/CommandResult, MCP server factory (create_mcp_server, meta-tool pattern), CLI generation (build_namespace), entry-point registration, docs registration, and skills directory bundling. Use when building a new botcore plugin, adding commands to a plugin, registering entry points, or integrating with the MCP server factory. Triggers: plugin, botcore plugin, BotCorePlugin, PluginRegistry, entry point, command authoring, CommandResult, MCP server, create_mcp_server, build_namespace, plugin protocol, register commands.

version: 1.0.0
triggers:
  - plugin
  - botcore plugin
  - BotCorePlugin
  - PluginRegistry
  - entry point
  - command authoring
  - CommandResult
  - MCP server
  - create_mcp_server
  - build_namespace
  - plugin protocol
  - register commands
  - plugin development
  - plugin registration
portable: true
---

# Building Botcore Plugins

Expert guidance for creating plugins that extend botcore with new commands, documentation, skills, and MCP server integration.

## Capabilities

1. **Implement Plugin Protocol** -- Create classes that satisfy `BotCorePlugin` with `register()` and `config_schema()` methods
2. **Author Async Commands** -- Write async functions returning `CommandResult` using the AFD success/error pattern
3. **Register with PluginRegistry** -- Add commands, docs, skills dirs, CLI/MCP names to the plugin registry
4. **Configure MCP Server** -- Use `create_mcp_server()` factory to expose plugin commands as MCP tools
5. **Set Up Entry Points** -- Configure `pyproject.toml` so plugins are auto-discovered via `importlib.metadata`
6. **Bundle Skills** -- Package skill directories alongside plugin code for distribution

## Routing Logic

| Request Type | Load Reference |
|---|---|
| BotCorePlugin interface, register() contract, config_schema() | [references/plugin-protocol.md](references/plugin-protocol.md) |
| Writing async commands, CommandResult, success/error returns | [references/command-authoring.md](references/command-authoring.md) |
| create_mcp_server(), build_namespace(), meta-tool pattern | [references/server-factory.md](references/server-factory.md) |
| pyproject.toml entry points, importlib.metadata discovery | [references/entry-points.md](references/entry-points.md) |

## Core Principles

### 1. Protocol Over Inheritance

<rules>
Plugins implement the `BotCorePlugin` protocol — there is no base class to inherit.
The protocol requires exactly two methods: `register(registry)` and `config_schema()`.
</rules>

This keeps plugins decoupled from botcore internals. Any class with the right method signatures satisfies the protocol. Type checkers verify compliance at development time.

### 2. Commands Are Async, Returns Are Typed

<rules>
Every command must be an `async` function returning `CommandResult[T]`.
Use `success(data, reasoning=...)` for successful outcomes and `error(message)` for failures.
Never raise exceptions for expected failure modes — return `error()` instead.
</rules>

The AFD framework handles serialization, error formatting, and transport. Commands that raise exceptions break the MCP tool contract.

### 3. Register Everything Explicitly

<rules>
All commands, docs, and skills dirs must be registered in `register()`.
Do not rely on auto-discovery within the plugin itself — only entry-point discovery is automatic.
</rules>

Explicit registration makes the plugin's surface area visible in one place. Reviewers and agents can read `register()` to understand what a plugin provides.

### 4. One Plugin Per Package

<rules>
Each Python package should expose at most one `BotCorePlugin` via entry points.
Split orthogonal concerns into separate packages rather than overloading one plugin.
</rules>

## Workflow

### Step 1: Scaffold the Plugin

Create the package structure:

```
my-plugin/
├── src/my_plugin/
│   ├── __init__.py
│   ├── plugin.py          # BotCorePlugin implementation
│   ├── commands/           # Command modules
│   │   ├── __init__.py
│   │   └── core.py
│   └── skills/             # Optional bundled skills
│       └── my-skill/
│           └── SKILL.md
└── pyproject.toml          # Entry point registration
```

### Step 2: Implement the Plugin Class

```python
from botcore import BotCorePlugin, PluginRegistry
from pathlib import Path
from my_plugin.commands import my_command, my_other_command

class MyPlugin(BotCorePlugin):
    def register(self, registry: PluginRegistry) -> None:
        registry.add_commands([my_command, my_other_command])
        registry.add_docs("my-plugin", MY_DOCS)
        registry.set_cli_name("myplugin")
        registry.set_mcp_name("my")

        skills_dir = Path(__file__).parent / "skills"
        if skills_dir.exists():
            registry.add_skills_dir(skills_dir)

    def config_schema(self):
        return None  # Or return a Pydantic model
```

### Step 3: Write Commands

```python
from afd import CommandResult, success, error

async def my_command(name: str, verbose: bool = False) -> CommandResult[dict]:
    """One-line description of what this command does."""
    if not name:
        return error("name is required")
    result = {"name": name, "processed": True}
    return success(result, reasoning=f"Processed {name}")
```

### Step 4: Register Entry Point

In `pyproject.toml`:

```toml
[project.entry-points."botcore.plugins"]
my-plugin = "my_plugin.plugin:MyPlugin"
```

### Step 5: Verify Discovery

Install the package and confirm the plugin loads:

```bash
pip install -e .
python -c "from botcore.plugin import discover_plugins; print(discover_plugins())"
```

## Checklist

- [ ] Plugin class implements `register()` and `config_schema()`
- [ ] All commands are async and return `CommandResult`
- [ ] Commands use `success()` / `error()` — no raw exceptions for expected failures
- [ ] Docs registered via `registry.add_docs(topic, content)`
- [ ] Entry point configured in `pyproject.toml` under `botcore.plugins`
- [ ] Skills directory registered if present
- [ ] Plugin installs and is discovered by `discover_plugins()`
