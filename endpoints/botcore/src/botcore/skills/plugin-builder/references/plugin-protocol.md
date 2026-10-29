# Plugin Protocol Reference

## BotCorePlugin Protocol

Defined in `botcore/plugin.py`. Any class with these two methods satisfies the protocol:

```python
class BotCorePlugin(Protocol):
    def register(self, registry: PluginRegistry) -> None: ...
    def config_schema(self) -> type[BaseModel] | None: ...
```

### register(registry)

Called once during plugin discovery. Use the `PluginRegistry` to declare what the plugin provides:

| Method | Purpose | Example |
|---|---|---|
| `registry.add_commands(cmds)` | Register async command functions | `registry.add_commands([my_cmd])` |
| `registry.add_skills_dir(path)` | Register a skills directory | `registry.add_skills_dir(Path(__file__).parent / "skills")` |
| `registry.set_cli_name(name)` | Override CLI tool name | `registry.set_cli_name("myplugin")` |
| `registry.set_mcp_name(name)` | Override MCP server name | `registry.set_mcp_name("my")` |
| `registry.add_docs(topic, content)` | Register documentation section | `registry.add_docs("my-plugin", DOCS)` |

### config_schema()

Returns a Pydantic `BaseModel` subclass for plugin-specific configuration, or `None` if the plugin has no config.

```python
from pydantic import BaseModel

class MyPluginConfig(BaseModel):
    api_key: str = ""
    max_retries: int = 3

class MyPlugin(BotCorePlugin):
    def config_schema(self):
        return MyPluginConfig
```

When a schema is provided, botcore validates the `[plugins.my-plugin]` section of `botcore.toml` against it.

## PluginRegistry API

The `PluginRegistry` class collects all registrations from plugins:

```python
class PluginRegistry:
    def add_commands(self, commands: list[Callable]) -> None
    def add_skills_dir(self, path: Path) -> None
    def set_cli_name(self, name: str) -> None
    def set_mcp_name(self, name: str) -> None
    def add_docs(self, topic: str, content: str) -> None

    # Read-only properties
    @property
    def commands(self) -> list[Callable]
    @property
    def skills_dirs(self) -> list[Path]
    @property
    def cli_name(self) -> str | None
    @property
    def mcp_name(self) -> str | None
    @property
    def docs(self) -> dict[str, str]
```

### Docs Format

Documentation registered via `add_docs()` appears in the MCP server's `{name}-docs` tool. Write it as markdown with command signatures:

```python
MY_DOCS = """\
# My Plugin Commands

## my_command(name, verbose=False)
Processes a thing by name.
- `name`: The thing to process (required)
- `verbose`: Show detailed output (default: False)
"""
```

## Plugin Discovery

`discover_plugins()` loads all plugins registered under the `botcore.plugins` entry-point group:

```python
def discover_plugins() -> list[BotCorePlugin]:
    """Load plugins via importlib.metadata entry points."""
```

Discovery happens automatically when `build_namespace()` or `create_mcp_server()` is called.

## Reference Implementation: LibbotPlugin

The `libbot` package is the canonical plugin example:

```python
class LibbotPlugin(BotCorePlugin):
    def register(self, registry: PluginRegistry) -> None:
        registry.add_commands([
            lib_status,
            lib_package_list,
            lib_package_info,
            lib_publish_readiness,
        ])
        registry.add_docs("lib", LIB_DOCS)
        registry.set_cli_name("libbot")
        registry.set_mcp_name("lib")

        skills_dir = Path(__file__).parent / "skills"
        if skills_dir.exists():
            registry.add_skills_dir(skills_dir)

    def config_schema(self):
        return None
```

Key patterns from this reference:
- Commands imported at top of module, not inside `register()`
- Docs defined as a module-level constant
- Skills dir registered conditionally (directory may not exist yet)
- CLI and MCP names set to short, distinct identifiers
