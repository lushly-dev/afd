"""Alfred CLI: one managed catalog plus the three established aliases."""

import asyncio
import json
from pathlib import Path

import click
from botcore import create_host_cli

from alfred import __version__
from alfred.host import build_alfred_host


@click.group()
@click.version_option(__version__, prog_name='alfred')
@click.option('--workspace', type=click.Path(exists=True, file_okay=False), required=True)
@click.option('--target', default=None, help='Package name, area path, or worktree')
@click.option('--profile', type=click.Choice(['inspection', 'trusted-local']), default='inspection')
@click.pass_context
def main(ctx, workspace, target, profile):
    """Inspect and operate on an explicitly selected worktree."""
    try:
        ctx.obj = build_alfred_host(Path(workspace), target, profile=profile)
    except (OSError, ValueError) as exc:
        raise click.BadParameter(str(exc)) from exc


@main.command()
@click.pass_obj
def catalog(host):
    """List admitted commands, effects, applicability and capabilities."""
    click.echo(json.dumps(host.catalog(), indent=2))


@main.command()
@click.argument('command')
@click.argument('arguments', default='{}')
@click.pass_obj
def call(host, command, arguments):
    """Call an admitted command with JSON arguments."""
    return create_host_cli(host).commands['call'].callback(command, arguments)


def _alias(name):
    @click.command(name=name)
    @click.option('--path', default=None, help='AFD area within the selected target')
    @click.pass_obj
    def alias(host, path):
        result = asyncio.run(host.execute(f'alfred_{name}', {'path': path}))
        output = result.model_dump(mode='json', exclude_none=True)
        click.echo(json.dumps(output, indent=2))
        quality = output.get('metadata', {}).get('quality', {})
        if not result.success or quality.get('status', 'error') != 'passed':
            raise click.exceptions.Exit(1)
    return alias


for _name in ('lint', 'parity', 'quality'):
    main.add_command(_alias(_name))


if __name__ == '__main__':
    main()
