"""Alfred CLI — command-line interface for AFD quality checks.

Usage:
    alfred lint [--path DIR]
    alfred parity [--path DIR]
    alfred quality [--path DIR]
"""

import asyncio
import json
import sys

import click

from alfred import __version__


def _run_async(coro):
    """Run an async coroutine synchronously."""
    return asyncio.run(coro)


def _print_result(result) -> None:
    """Print a CommandResult as formatted JSON."""
    output = result.model_dump(exclude_none=True)
    click.echo(json.dumps(output, indent=2, default=str))


@click.group()
@click.version_option(__version__, prog_name="alfred")
def main():
    """Alfred — AFD repo quality bot."""


@main.command()
@click.option("--path", default=None, help="Directory to lint (default: current dir)")
def lint(path: str | None):
    """Run AFD architecture compliance validation."""
    from alfred.commands.lint import alfred_lint

    result = _run_async(alfred_lint(path))
    _print_result(result)
    if not result.success or (result.data and not result.data.get("passed")):
        sys.exit(1)


@main.command()
@click.option("--path", default=None, help="AFD repo root (default: current dir)")
def parity(path: str | None):
    """Check cross-language API surface parity."""
    from alfred.commands.parity import alfred_parity

    result = _run_async(alfred_parity(path))
    _print_result(result)
    if not result.success or (result.data and result.data.get("total_gaps", 0) > 0):
        sys.exit(1)


@main.command()
@click.option("--path", default=None, help="Directory to scan (default: current dir)")
def quality(path: str | None):
    """Validate semantic quality of command descriptions."""
    from alfred.commands.quality import alfred_quality

    result = _run_async(alfred_quality(path))
    _print_result(result)
    if not result.success or (result.data and result.data.get("issue_count", 0) > 0):
        sys.exit(1)


if __name__ == "__main__":
    main()
