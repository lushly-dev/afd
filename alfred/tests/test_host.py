"""Unified Alfred integration fixtures, no hosted services or source-tree writes."""

import asyncio
import json
from pathlib import Path
from unittest.mock import patch

import pytest
from afd import success
from botcore import CommandPolicy, create_host_cli, create_host_mcp_server
from click.testing import CliRunner

from alfred.cli import main
from alfred.host import build_alfred_host


def content(result):
    blocks = result.content if hasattr(result, 'content') else (result[0] if isinstance(result, tuple) else result)
    return json.loads(blocks[0].text)


@pytest.fixture
def native(tmp_path):
    (tmp_path / 'packages/core/src').mkdir(parents=True)
    (tmp_path / 'packages/core/src/index.ts').write_text('export const value = 1;')
    (tmp_path / 'spec').mkdir()
    (tmp_path / 'spec/VERSION').write_text('1.0.0')
    return tmp_path


async def test_discovery_all_surfaces_and_no_heavy_tool_dependency(tmp_path):
    (tmp_path / 'package.json').write_text('{"name":"plain-app"}')
    host = build_alfred_host(tmp_path)
    with patch('shutil.which', return_value=None):
        rows = host.catalog()
        assert len(rows) == 23
        assert next(row for row in rows if row['name'] == 'alfred_lint')['applicability'] == 'not-applicable'
        assert next(row for row in rows if row['name'] == 'dev_test')['tool_availability']['node'] is False
        remote = content(await create_host_mcp_server(host).call_tool('alfred-start', {}))
        assert remote['commands'] == rows
        cli = CliRunner().invoke(main, ['--workspace', str(tmp_path), 'catalog'])
        assert cli.exit_code == 0, cli.output
        assert json.loads(cli.output) == rows
    assert set(host.direct_client().registry.list_command_names()) == {row['name'] for row in rows}
    assert (await host.execute('info_workspace')).success
    assert 'afd' not in (tmp_path / 'package.json').read_text()


@pytest.mark.parametrize('status', ['failed', 'skipped', 'unavailable', 'error'])
async def test_same_nonpass_verdict_all_routes(tmp_path, status):
    host = build_alfred_host(tmp_path)
    async def probe():
        return success({'verdict': status})
    host.register('probe', probe, CommandPolicy(quality='verdict'))
    direct = await host.direct_client().call('probe')
    remote = content(await create_host_mcp_server(host).call_tool('alfred-call', {'command': 'probe'}))
    cli = await asyncio.to_thread(CliRunner().invoke, create_host_cli(host), ['call', 'probe'])
    assert direct.success is remote['success'] is True
    assert direct.metadata.quality['status'] == remote['metadata']['quality']['status'] == status
    assert json.loads(cli.output)['metadata']['quality']['status'] == status
    assert cli.exit_code == 1
    plan = await host.execute('alfred_check_plan', {'checks': [{'command': 'probe'}]})
    assert plan.metadata.quality['status'] == status


async def test_inspection_writers_rejected_without_effects(tmp_path):
    host = build_alfred_host(tmp_path)
    target = tmp_path / 'new.md'
    args = {'path': str(target)}
    direct = await host.direct_client().call('spec_create', args)
    remote = content(await create_host_mcp_server(host).call_tool('alfred-call', {'command': 'spec_create', 'arguments': args}))
    cli = await asyncio.to_thread(CliRunner().invoke, create_host_cli(host), ['call', 'spec_create', json.dumps(args)])
    assert direct.error.code == remote['error']['code'] == json.loads(cli.output)['error']['code'] == 'EFFECT_DENIED'
    assert not target.exists()
    assert 'alfred-run' not in [tool.name for tool in await create_host_mcp_server(host).list_tools()]


async def test_two_worktrees_and_targets_are_isolated(tmp_path):
    original = Path.cwd()
    roots = [tmp_path / 'one', tmp_path / 'two']
    for root in roots:
        (root / 'area').mkdir(parents=True)
    hosts = [build_alfred_host(root, 'area') for root in roots]
    results = await asyncio.gather(*(host.direct_client().call('info_workspace') for host in hosts))
    assert [result.data['workspace_root'] for result in results] == [str(root / 'area') for root in roots]
    assert Path.cwd() == original
    assert (await hosts[0].execute('info_env')).data['target'] == str(roots[0] / 'area')


async def test_native_checks_exclude_other_foundations(native):
    foundation = native / 'foundations/other'
    foundation.mkdir(parents=True)
    (foundation / 'bad.ts').write_text('defineCommand({name: "bad", description: "bad"})')
    host = build_alfred_host(native)
    result = await host.execute('alfred_quality')
    assert result.success and result.data['commands_scanned'] == 0
    denied = await host.execute('alfred_lint', {'target': 'foundations/other'})
    assert denied.error.code == 'NOT_APPLICABLE'
    endpoint = native / 'endpoints/botcore'
    endpoint.mkdir(parents=True)
    (endpoint / 'bad.ts').write_text('defineCommand({name: "bad", description: "bad"})')
    assert (await host.execute('alfred_lint', {'target': 'endpoints/botcore'})).error.code == 'NOT_APPLICABLE'
    assert (await host.execute('alfred_quality')).data['commands_scanned'] == 0


async def test_target_errors_and_ambiguous_generic_commands(native):
    (native / 'pnpm-workspace.yaml').write_text('packages: []')
    host = build_alfred_host(native, profile='trusted-local')
    assert (await host.execute('dev_lint')).error.code == 'TARGET_REQUIRED'
    for target in ('../', 'missing'):
        assert (await host.execute('info_workspace', {'target': target})).error.code == 'INVALID_TARGET_OR_INPUT'
    (native / 'escape').symlink_to(native.parent)
    assert (await host.execute('info_workspace', {'target': 'escape'})).error.code == 'INVALID_TARGET_OR_INPUT'
    with patch('botcore.commands.dev.core.run_python_module', return_value={'success': True}) as run:
        result = await host.execute('dev_lint', {'target': 'packages/core', 'language': 'python'})
        assert result.success
        assert run.call_args.kwargs['cwd'] == native / 'packages/core'


async def test_empty_plan_never_passes(tmp_path):
    result = await build_alfred_host(tmp_path).execute('alfred_check_plan', {'checks': []})
    assert result.metadata.quality['status'] == 'error'


async def test_release_only_approved_unit_bound_root_controller(tmp_path):
    inventory = tmp_path / 'scripts/release/inventory.json'
    inventory.parent.mkdir(parents=True)
    inventory.write_text(json.dumps({'units': [{'id': 'npm-one', 'protocol': 'npm-changesets', 'state': 'admitted'}]}))
    calls = []
    async def controller(root, operation, unit, arguments):
        calls.append((root, operation, unit, arguments))
        return success({'protocol': 'npm-changesets'})
    host = build_alfred_host(tmp_path, profile='trusted-local', npm_controller=controller)
    assert (await host.execute('changeset_consume', {'unit': 'npm-one'})).success
    assert calls == [(tmp_path, 'consume', 'npm-one', {})]
    result = await host.execute('changeset_consume', {'unit': 'unknown'})
    assert result.error.code == 'RELEASE_UNIT_NOT_ADMITTED'
    assert len(calls) == 1
    unbound = build_alfred_host(tmp_path, profile='trusted-local')
    assert (await unbound.execute('changeset_status', {'unit': 'npm-one'})).error.code == 'RELEASE_CONTROLLER_UNAVAILABLE'


def test_collision_rejected_before_serving(tmp_path):
    async def alfred_lint():
        return success({})
    class Plugin:
        host_context_safe = True
        def register(self, registry):
            registry.add_commands([alfred_lint])
    with (patch('botcore.plugin.discover_plugins', return_value={'collision': Plugin()}),
          pytest.raises(ValueError, match='Duplicate command')):
        build_alfred_host(tmp_path, plugins=('collision',), policies={'alfred_lint': CommandPolicy()})


def test_plugin_command_named_like_an_alias_is_rejected(tmp_path):
    async def info_targets():
        return success({})
    class Plugin:
        host_context_safe = True
        def register(self, registry):
            registry.add_commands([info_targets])
    with (patch('botcore.plugin.discover_plugins', return_value={'shadow': Plugin()}),
          pytest.raises(ValueError, match='collides with the Alfred alias')):
        build_alfred_host(tmp_path, plugins=('shadow',), policies={'info_targets': CommandPolicy()})


async def test_dev_path_narrows_within_selected_target(native):
    (native / 'packages/server').mkdir()
    (native / 'pnpm-workspace.yaml').write_text('packages: []')
    host = build_alfred_host(native, 'packages/core', profile='trusted-local')
    with patch('botcore.commands.dev.core.run_python_module', return_value={'success': True}) as run:
        assert (await host.execute('dev_lint', {'path': 'src', 'language': 'python'})).success
        assert run.call_args.kwargs['cwd'] == native / 'packages/core/src'
        run.reset_mock()
        for path in ('packages/server', '../server', str(native / 'packages/server')):
            escaped = await host.execute('dev_lint', {'path': path, 'language': 'python'})
            assert escaped.error.code == 'INVALID_TARGET_OR_INPUT', path
        plan = await host.execute('alfred-check-plan', {'checks': [
            {'command': 'dev_lint', 'arguments': {'path': '../server', 'language': 'python'}}]})
        assert not plan.success
        assert run.call_count == 0
        assert (await host.execute('dev_lint', {'package': 'packages/server', 'language': 'python'})).success
        assert run.call_args.kwargs['cwd'] == native / 'packages/server'
    assert (await host.execute('dev_lint', {'target': 'packages/core', 'package': 'packages/server'})).error.code == 'INVALID_TARGET_OR_INPUT'


async def test_skill_lint_selects_skill_by_name(tmp_path):
    skill = tmp_path / '.claude/skills/review'
    skill.mkdir(parents=True)
    (skill / 'SKILL.md').write_text('---\nname: review\ndescription: Review code changes before merging them.\n---\n\nBody.\n')
    (tmp_path / '.git').mkdir()
    host = build_alfred_host(tmp_path, 'worktree')
    result = await host.execute('skill_lint', {'path': 'review'})
    assert result.success, result.error
    assert result.data['verdict'] in ('passed', 'failed')
    for path in ('../outside', str(skill)):
        assert (await host.execute('skill_lint', {'path': path})).error.code == 'INVALID_TARGET_OR_INPUT'


async def test_selected_python_build_uses_selected_package(tmp_path):
    area = tmp_path / 'python-lib'
    area.mkdir()
    (area / 'pyproject.toml').write_text('[project]\nname="plain"\nversion="0.1.0"')
    host = build_alfred_host(tmp_path, profile='trusted-local')
    with (patch('shutil.which', return_value='/tools/uv'),
          patch('botcore.utils.runner.run_command', return_value={'success': True}) as run):
        result = await host.execute('dev_build', {'target': 'python-lib'})
    assert result.success and result.metadata.quality['status'] == 'passed'
    assert run.call_args.args[0] == ['uv', 'build', '--out-dir', str(area / 'dist')]
    assert run.call_args.kwargs['cwd'] == area


async def test_actual_quality_failure_and_legacy_alias(native):
    source = native / 'packages/core/src/command.ts'
    source.write_text('defineCommand({ name: "bad", description: "bad", handler: () => 1 });')
    host = build_alfred_host(native)
    direct = await host.direct_client().call('alfred_quality')
    remote = content(await create_host_mcp_server(host).call_tool('alfred-call', {'command': 'alfred_quality'}))
    cli = await asyncio.to_thread(CliRunner().invoke, main, ['--workspace', str(native), 'quality'])
    assert direct.metadata.quality['status'] == remote['metadata']['quality']['status'] == 'failed'
    assert json.loads(cli.output)['metadata']['quality']['status'] == 'failed'
    assert cli.exit_code == 1


async def test_inventory_includes_all_thirteen_units_and_package_selector(tmp_path):
    manifest = tmp_path / 'integrations/example/package.json'
    manifest.parent.mkdir(parents=True)
    manifest.write_text('{"name":"@example/native"}')
    inventory = tmp_path / 'scripts/release/inventory.json'
    inventory.parent.mkdir(parents=True)
    units = [{'id': f'unit-{index}', 'protocol': 'npm-changesets', 'state': 'quarantined',
              'distributions': []} for index in range(13)]
    units[0]['distributions'] = [{'name': '@example/native', 'manifest': 'integrations/example/package.json'}]
    inventory.write_text(json.dumps({'units': units}))
    host = build_alfred_host(tmp_path)
    assert len((await host.execute('info_targets')).data['units']) == 13
    result = await host.execute('info_workspace', {'target': '@example/native'})
    assert result.data['workspace_root'] == str(manifest.parent)
    assert (await host.execute('changeset_status', {'unit': 'unit-0'})).error.code == 'EFFECT_DENIED'


async def test_plan_inspection_rejects_subprocess_before_invocation(tmp_path):
    host = build_alfred_host(tmp_path)
    with patch('botcore.commands.dev.core.run_python_module') as run:
        result = await host.execute('alfred_check_plan', {'checks': [{'command': 'dev_lint', 'arguments': {'language': 'python'}}]})
    assert result.error.code == 'EFFECT_DENIED'
    run.assert_not_called()


async def test_missing_build_tool_is_unavailable_and_required_plan_does_not_pass(tmp_path):
    (tmp_path / 'pyproject.toml').write_text('[project]\nname="ordinary"\nversion="0.1.0"')
    host = build_alfred_host(tmp_path, profile='trusted-local')
    with patch('shutil.which', return_value=None):
        result = await host.execute('dev_build')
        plan = await host.execute('alfred_check_plan', {'checks': [{'command': 'dev_build'}]})
    assert not result.success and result.metadata.quality['status'] == 'unavailable'
    assert plan.metadata.quality['status'] == 'unavailable'


async def test_actual_worktree_host_discovery_with_retained_root_configuration():
    root = Path(__file__).resolve().parents[2]
    host = build_alfred_host(root)
    result = await host.direct_client().call('info_targets')
    assert result.success
    assert result.data['workspace'] == str(root)
    assert len(result.data['units']) == len(json.loads((root / 'scripts/release/inventory.json').read_text())['units'])
    assert host.context.target == root


async def test_managed_relative_spec_create_preserves_markdown_suffix(tmp_path):
    host = build_alfred_host(tmp_path, profile='trusted-local')
    result = await host.execute('spec_create', {'path': 'docs/feature'})
    assert result.success
    assert (tmp_path / 'docs/feature.md').is_file()
    assert not (tmp_path / 'docs/feature').exists()


@pytest.mark.parametrize('kind,status,code', [
    ('unavailable', 'unavailable', 'TOOL_UNAVAILABLE'),
    ('error', 'error', 'TOOL_EXECUTION_ERROR'),
    ('failed', 'failed', 'BUILD_FAILED'),
])
async def test_native_build_preserves_infrastructure_outcomes(tmp_path, kind, status, code):
    (tmp_path / 'pyproject.toml').write_text('[project]\nname="ordinary"\nversion="0.1.0"')
    host = build_alfred_host(tmp_path, profile='trusted-local')
    with (patch('shutil.which', return_value='/tools/uv'),
          patch('botcore.utils.runner.run_command', return_value={'success': False, 'failure_kind': kind, 'error': 'fixture'})):
        result = await host.execute('dev_build')
    assert result.error.code == code
    assert result.metadata.quality['status'] == status
