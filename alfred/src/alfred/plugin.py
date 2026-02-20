"""Alfred plugin — BotCorePlugin implementation.

Registers Alfred's commands, docs, and identity with botcore's plugin system.
Discovered automatically via the ``botcore.plugins`` entry point.
"""

from pathlib import Path

from botcore import PluginRegistry

from alfred.commands.lint import alfred_lint
from alfred.commands.parity import alfred_parity
from alfred.commands.quality import alfred_quality


DOCS = """\
# Alfred — AFD Repo Quality Bot

Alfred provides deterministic quality tooling as MCP commands.
Anything that can be checked mechanically, Alfred checks — so agents
can skip the expensive reasoning.

## Commands

| Command | Description |
|---------|-------------|
| `alfred_lint(path)` | Run AFD architecture compliance validation |
| `alfred_parity(path)` | Check cross-language API surface parity (TS, Python, Rust) |
| `alfred_quality(path)` | Validate semantic quality of command descriptions |

## Usage (via alfred-run)

```python
result = await alfred_lint()
result = await alfred_lint("packages/core")
result = await alfred_parity()
result = await alfred_quality("packages")
```

## CLI

```
alfred lint [--path DIR]
alfred parity [--path DIR]
alfred quality [--path DIR]
```
"""


class AlfredPlugin:
    """BotCorePlugin for the AFD repo quality bot."""

    def register(self, registry: PluginRegistry) -> None:
        registry.set_mcp_name("alfred")
        registry.set_cli_name("alfred")
        registry.add_commands([alfred_lint, alfred_parity, alfred_quality])
        registry.add_docs("alfred", DOCS)

    def config_schema(self):
        return None
