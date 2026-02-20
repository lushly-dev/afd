"""Alfred plugin — registers all commands with an AFD server.

This module provides the central registration point for Alfred's commands.
It can be used standalone or as part of a larger server setup.
"""

from afd.server.factory import MCPServer, create_server

from alfred import __version__
from alfred.commands.lint import alfred_lint
from alfred.commands.parity import alfred_parity
from alfred.commands.quality import alfred_quality


DOCS = """# Alfred — AFD Repo Quality Bot

Alfred provides deterministic quality tooling as MCP commands.

## Commands

| Command | Description |
|---------|-------------|
| `alfred-lint` | Run AFD architecture compliance validation |
| `alfred-parity` | Check cross-language API surface parity |
| `alfred-quality` | Validate command description quality |

## Usage

```
alfred lint [--path DIR]
alfred parity [--path DIR]
alfred quality [--path DIR]
```
"""


def create_alfred_server() -> MCPServer:
    """Create and configure an Alfred MCP server with all commands registered.

    Returns:
        Configured MCPServer ready to run.
    """
    from pydantic import BaseModel, Field

    server = create_server(
        name="alfred",
        version=__version__,
        description="AFD repo quality bot — deterministic tooling as MCP commands",
    )

    class PathInput(BaseModel):
        path: str | None = Field(
            default=None,
            description="Directory to scan. Defaults to current working directory.",
        )

    # Adapters: server.command decorator passes a PathInput model,
    # but the underlying commands accept str | None for direct use.

    @server.command(
        name="alfred-lint",
        description="Run AFD architecture compliance validation",
        input_schema=PathInput,
        tags=["quality", "lint"],
    )
    async def _lint(input: PathInput):
        return await alfred_lint(input.path)

    @server.command(
        name="alfred-parity",
        description="Check cross-language API surface parity (TS, Python, Rust)",
        input_schema=PathInput,
        tags=["quality", "parity"],
    )
    async def _parity(input: PathInput):
        return await alfred_parity(input.path)

    @server.command(
        name="alfred-quality",
        description="Validate semantic quality of command descriptions",
        input_schema=PathInput,
        tags=["quality", "descriptions"],
    )
    async def _quality(input: PathInput):
        return await alfred_quality(input.path)

    return server
