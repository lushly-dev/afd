"""Alfred CLI: one managed catalog plus the three established aliases."""

import asyncio
import json
from pathlib import Path

import click
from botcore import create_host_cli

from alfred import __version__
from alfred.host import build_alfred_host
from alfred.measures import build_measures_document, write_measures_file


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


def _write_cli_measures(host, destination, document):
    """Write a measures file, refusing writes inside the inspected workspace unless trusted-local."""
    if not str(destination).strip():
        raise ValueError('Measures output path must be non-empty.')
    target = Path(destination).resolve()
    workspace = host.context.workspace.resolve()
    if host.context.profile != 'trusted-local' and target.is_relative_to(workspace):
        raise ValueError(
            'Refusing to write measures inside the inspected workspace under the inspection profile; '
            'write outside the workspace or pass --profile trusted-local.'
        )
    return write_measures_file(target, document)


def _alias(name):
    @click.command(name=name)
    @click.option('--path', default=None, help='AFD area within the selected target')
    @click.option(
        '--measures-out',
        type=click.Path(dir_okay=False),
        default=None,
        help='Write Health 1.0 trend measures JSON to this file',
    )
    @click.option(
        '--measures-target',
        default=None,
        help='Optional Health target id recorded in the measures file',
    )
    @click.pass_obj
    def alias(host, path, measures_out, measures_target):
        result = asyncio.run(host.execute(f'alfred_{name}', {'path': path}))
        output = result.model_dump(mode='json', exclude_none=True)
        if measures_out is not None and result.success and isinstance(result.data, dict):
            try:
                doc = build_measures_document(**{name: result.data}, target=measures_target)
                _write_cli_measures(host, measures_out, doc)
            except (OSError, ValueError) as exc:
                raise click.ClickException(str(exc)) from exc
        click.echo(json.dumps(output, indent=2))
        quality = output.get('metadata', {}).get('quality', {})
        if not result.success or quality.get('status', 'error') != 'passed':
            raise click.exceptions.Exit(1)
    return alias


for _name in ('lint', 'parity', 'quality'):
    main.add_command(_alias(_name))


@main.command()
@click.option('--path', default=None, help='AFD area within the selected target')
@click.option(
    '--out',
    '--measures-out',
    'out',
    type=click.Path(dir_okay=False),
    default=None,
    help='Write Health 1.0 trend measures JSON to this file instead of stdout only',
)
@click.option(
    '--measures-target',
    default=None,
    help='Optional Health target id recorded in the measures file',
)
@click.option(
    '--only',
    'checks',
    multiple=True,
    type=click.Choice(['lint', 'parity', 'quality']),
    help='Checks to include (repeatable; defaults to lint, parity and quality)',
)
@click.pass_obj
def measures(host, path, out, measures_target, checks):
    """Run read-only Alfred checks and emit a Health 1.0 measures document."""
    selected = tuple(checks) if checks else ('lint', 'parity', 'quality')
    payloads = {}
    for name in selected:
        result = asyncio.run(host.execute(f'alfred_{name}', {'path': path}))
        if not result.success or not isinstance(result.data, dict):
            detail = result.error.message if result.error else f'alfred_{name} failed'
            raise click.ClickException(f'alfred_{name} failed: {detail}')
        payloads[name] = result.data
    try:
        doc = build_measures_document(**payloads, target=measures_target)
        if out is not None:
            _write_cli_measures(host, out, doc)
    except (OSError, ValueError) as exc:
        raise click.ClickException(str(exc)) from exc
    click.echo(json.dumps(doc, indent=2))


if __name__ == '__main__':
    main()
