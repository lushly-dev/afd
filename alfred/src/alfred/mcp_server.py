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


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--workspace', required=True)
    parser.add_argument('--target')
    parser.add_argument('--profile', choices=('inspection', 'trusted-local'), default='inspection')
    parser.add_argument('--raw-python', action='store_true')
    parser.add_argument('--sse', action='store_true',
                        help='Serve over SSE; only the inspection profile without --raw-python')
    args = parser.parse_args(argv)
    if args.sse and (args.raw_python or args.profile != 'inspection'):
        # An SSE port has no authentication, so it serves only the inspection profile.
        parser.error('--sse serves only the inspection profile without --raw-python: '
                     'the trusted-local profile and raw Python run over stdio, for the client '
                     'that started the server')
    server = create_server(args.workspace, args.target, profile=args.profile, raw_python=args.raw_python)
    server.run(transport='sse' if args.sse else 'stdio')


if __name__ == '__main__':
    main()
