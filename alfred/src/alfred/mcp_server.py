"""Alfred managed MCP surface, using the same catalog and dispatcher as its CLI."""

import argparse
from pathlib import Path

from botcore import create_host_mcp_server

from alfred import __version__
from alfred.host import build_alfred_host


def create_server(workspace: str | Path, target=None, *, profile='inspection',
                  raw_python=False, npm_controller=None):
    """Create an explicit host; raw Python requires trusted-local opt-in."""
    host = build_alfred_host(workspace, target, profile=profile, npm_controller=npm_controller)
    return create_host_mcp_server(host, version=__version__, raw_python=raw_python,
                                  description='Alfred unified repository command host')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--workspace', required=True)
    parser.add_argument('--target')
    parser.add_argument('--profile', choices=('inspection', 'trusted-local'), default='inspection')
    parser.add_argument('--raw-python', action='store_true')
    parser.add_argument('--sse', action='store_true')
    args = parser.parse_args()
    server = create_server(args.workspace, args.target, profile=args.profile, raw_python=args.raw_python)
    server.run(transport='sse' if args.sse else 'stdio')


if __name__ == '__main__':
    main()
