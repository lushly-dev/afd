# Entry Point Registration Reference

## How Plugin Discovery Works

Botcore uses Python's `importlib.metadata` entry-point system to discover plugins at runtime. No central registry — install a package and its plugin is automatically available.

## pyproject.toml Setup

### Minimal Entry Point

```toml
[project.entry-points."botcore.plugins"]
my-plugin = "my_plugin.plugin:MyPlugin"
```

- **Group**: `botcore.plugins` — all botcore plugins use this group name
- **Key**: `my-plugin` — unique identifier for your plugin (by convention, matches package name)
- **Value**: `"module.path:ClassName"` — dotted path to the `BotCorePlugin` class

### Full pyproject.toml Example

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "my-botcore-plugin"
version = "0.1.0"
description = "A plugin for botcore"
requires-python = ">=3.11"
dependencies = [
    "botcore>=0.2.0",
]

[project.entry-points."botcore.plugins"]
my-plugin = "my_plugin.plugin:MyPlugin"
```

### Package Layout

```
my-botcore-plugin/
├── src/
│   └── my_plugin/
│       ├── __init__.py
│       ├── plugin.py       ← Contains MyPlugin class
│       ├── commands/
│       │   ├── __init__.py
│       │   └── core.py
│       └── skills/
│           └── my-skill/
│               └── SKILL.md
├── tests/
│   └── test_plugin.py
└── pyproject.toml
```

## Discovery Flow

```
1. build_namespace() or create_mcp_server() is called
2. discover_plugins() runs
3. importlib.metadata loads "botcore.plugins" entry points
4. Each entry point is instantiated → BotCorePlugin instance
5. register(registry) called on each plugin
6. Commands, docs, skills dirs collected in PluginRegistry
```

## Multiple Plugins in One Package

Possible but discouraged. If needed:

```toml
[project.entry-points."botcore.plugins"]
plugin-a = "my_package.plugins:PluginA"
plugin-b = "my_package.plugins:PluginB"
```

Each entry-point key must be unique across all installed packages.

## Development Installation

During development, install in editable mode so entry points are registered:

```bash
pip install -e .
```

Or with hatch:

```bash
hatch shell
```

## Verifying Discovery

```python
# Quick check
from botcore.plugin import discover_plugins
plugins = discover_plugins()
for p in plugins:
    print(type(p).__name__)

# Full namespace check
from botcore.server import build_namespace
ns, registry = build_namespace()
print("Commands:", list(ns.keys()))
print("CLI name:", registry.cli_name)
print("MCP name:", registry.mcp_name)
print("Skills dirs:", registry.skills_dirs)
print("Docs topics:", list(registry.docs.keys()))
```

## Common Issues

| Symptom | Cause | Fix |
|---|---|---|
| Plugin not discovered | Package not installed or not in editable mode | Run `pip install -e .` |
| `ModuleNotFoundError` on import | Entry point path is wrong | Check `module.path:ClassName` matches actual location |
| Plugin loads but no commands | `register()` doesn't call `add_commands()` | Verify `register()` implementation |
| Duplicate entry point key | Two packages use the same key | Rename one of the entry-point keys |

## Reference: libbot Entry Point

```toml
# From py/packages/libbot/pyproject.toml
[project.entry-points."botcore.plugins"]
libbot = "libbot.plugin:LibbotPlugin"
```
