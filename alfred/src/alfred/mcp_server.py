"""Alfred MCP server entry point.

Uses botcore's server factory to create a fully-wired MCP server
with alfred-start, alfred-docs, and alfred-run tools.

Run with:
    python -m alfred.mcp_server
"""

import sys

from botcore import create_mcp_server

from alfred import __version__
from alfred.commands.lint import alfred_lint
from alfred.commands.parity import alfred_parity
from alfred.commands.quality import alfred_quality


DOCS = {
    "commands": (
        "# Alfred Commands\n\n"
        "| Function | Description |\n"
        "|----------|-------------|\n"
        "| `alfred_lint(path)` | AFD architecture compliance validation |\n"
        "| `alfred_parity(path)` | Cross-language API surface parity |\n"
        "| `alfred_quality(path)` | Command description quality validation |\n"
    ),
}


def main() -> None:
    """Start Alfred as an MCP server."""
    server = create_mcp_server(
        "alfred",
        version=__version__,
        description="AFD repo quality bot — deterministic tooling as MCP commands",
        extra_commands=[alfred_lint, alfred_parity, alfred_quality],
        extra_docs=DOCS,
    )
    transport = "sse" if "--sse" in sys.argv else "stdio"
    server.run(transport=transport)


if __name__ == "__main__":
    main()
