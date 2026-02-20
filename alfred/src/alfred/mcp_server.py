"""Alfred MCP server entry point.

Run with:
    python -m alfred.mcp_server
"""

import sys

from alfred.plugin import create_alfred_server


def main() -> None:
    """Start Alfred as an MCP server (stdio transport)."""
    server = create_alfred_server()
    transport = "stdio"
    if "--sse" in sys.argv:
        transport = "sse"
    server.run(transport=transport)


if __name__ == "__main__":
    main()
