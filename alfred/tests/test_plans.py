"""Complete plan preflight precedes every handler and declared effect."""

import asyncio
import json
from unittest.mock import patch

import pytest
from afd import success
from botcore import CommandPolicy, create_host_cli, create_host_mcp_server
from click.testing import CliRunner

from alfred.host import build_alfred_host


@pytest.mark.parametrize('invalid', [
    {'command': 'not-a-command'},
    {'command': 'dev_lint', 'arguments': {'bogus': True}},
    {'command': 'dev_lint', 'arguments': {'fix': 'yes'}},
    {'command': 'dev_lint', 'arguments': {'language': 'not-a-language'}},
    {'command': 'dev_lint', 'arguments': {'target': '../'}},
    {'command': 'dev_lint', 'optional': 'true'},
    {'command': 'dev_lint', 'required': 1},
    {'command': 'dev_lint', 'required': True, 'optional': True},
    {'command': 'dev_lint', 'optional': True, 'undeclared': False},
    {'command': 'alfred_lint', 'arguments': {'rule_severity_overrides': {'unknown-rule': 'off'}}},
])
async def test_late_invalid_check_prevents_all_mutation_and_subprocesses(tmp_path, invalid):
    host = build_alfred_host(tmp_path, profile='trusted-local')
    effects = []
    async def writer():
        effects.append('writer')
        return success({'passed': True})
    host.register('writer', writer, CommandPolicy(('artifact-write',), quality='passed'))
    with patch('botcore.commands.dev.core.run_python_module') as run:
        result = await host.execute('alfred-check-plan', {'checks': [
            {'command': 'writer'}, {'command': 'dev_test', 'arguments': {'language': 'python'}}, invalid,
        ]})
    assert not result.success
    assert result.error.code == 'INVALID_TARGET_OR_INPUT'
    assert effects == []
    run.assert_not_called()


@pytest.mark.parametrize('status', ['passed', 'failed', 'skipped', 'unavailable', 'error'])
async def test_optional_results_remain_visible_with_explicit_exclusion(tmp_path, status):
    host = build_alfred_host(tmp_path)
    async def required_probe():
        return success({'verdict': 'passed'})
    async def optional_probe():
        return success({'verdict': status})
    host.register('required_probe', required_probe, CommandPolicy(quality='verdict'))
    host.register('optional_probe', optional_probe, CommandPolicy(quality='verdict'))
    result = await host.execute('alfred-check-plan', {'checks': [
        {'command': 'required_probe', 'required': True},
        {'command': 'optional_probe', 'optional': True},
    ]})
    assert result.metadata.quality['status'] == 'passed'
    first, second = result.data['checks']
    assert first['required'] is True and first['optional'] is False
    assert first['included_in_aggregate'] is True
    assert second['required'] is False and second['optional'] is True
    assert second['included_in_aggregate'] is False
    assert second['metadata']['quality']['status'] == status
    assert second['exclusion_reason'] == f'optional-{status}'


async def test_wholly_optional_or_inapplicable_plan_cannot_pass(tmp_path):
    host = build_alfred_host(tmp_path)
    async def probe():
        return success({'passed': True})
    host.register('probe', probe, CommandPolicy(quality='passed'))
    optional = await host.execute('alfred-check-plan', {'checks': [{'command': 'probe', 'required': False}]})
    assert optional.metadata.quality['status'] == 'error'
    missing = await host.execute('alfred-check-plan', {'checks': [{'command': 'alfred_lint'}]})
    assert missing.metadata.quality['status'] == 'skipped'
    assert missing.data['checks'][0]['error']['code'] == 'NOT_APPLICABLE'
    excluded = await host.execute('alfred-check-plan', {'checks': [
        {'command': 'probe'}, {'command': 'alfred_lint', 'optional': True},
    ]})
    assert excluded.metadata.quality['status'] == 'passed'
    assert excluded.data['checks'][1]['exclusion_reason'] == 'not-applicable'


async def test_new_canonical_names_and_legacy_aliases_share_routes(tmp_path):
    host = build_alfred_host(tmp_path)
    names = {entry['name'] for entry in host.catalog()}
    assert {'info-targets', 'alfred-check-plan'} <= names
    assert 'info_targets' not in names and 'alfred_check_plan' not in names
    direct = await host.direct_client().call('info-targets')
    legacy = await host.direct_client().call('info_targets')
    assert direct.data == legacy.data
    remote = await create_host_mcp_server(host).call_tool('alfred-call', {'command': 'info-targets'})
    blocks = remote.content if hasattr(remote, 'content') else (remote[0] if isinstance(remote, tuple) else remote)
    assert json.loads(blocks[0].text)['data'] == direct.data
    cli = await asyncio.to_thread(CliRunner().invoke, create_host_cli(host), ['call', 'info-targets'])
    assert cli.exit_code == 0
    assert json.loads(cli.output)['data'] == direct.data
    canonical_plan = await host.execute('alfred-check-plan', {'checks': []})
    legacy_plan = await host.execute('alfred_check_plan', {'checks': []})
    assert canonical_plan.data == legacy_plan.data


async def test_explicit_trusted_raw_python_keeps_underscore_compatibility(tmp_path):
    host = build_alfred_host(tmp_path, profile='trusted-local')
    server = create_host_mcp_server(host, raw_python=True)
    for code in ('return await info_targets()', 'return await alfred_check_plan(checks=[])'):
        response = await server.call_tool('alfred-run', {'code': code})
        blocks = response.content if hasattr(response, 'content') else (response[0] if isinstance(response, tuple) else response)
        assert json.loads(blocks[0].text)['success'] is True


async def test_plan_does_not_turn_ambiguous_default_into_implicit_worktree_selection(tmp_path):
    (tmp_path / 'pnpm-workspace.yaml').write_text('packages: []')
    host = build_alfred_host(tmp_path, profile='trusted-local')
    checks = [{'command': 'dev_lint', 'arguments': {'language': 'python'}}]
    with patch('botcore.commands.dev.core.run_python_module', return_value={'success': True}) as run:
        denied = await host.execute('alfred-check-plan', {'checks': checks})
        assert not denied.success
        run.assert_not_called()
        selected = await host.execute('alfred-check-plan', {'target': 'worktree', 'checks': checks})
    assert selected.metadata.quality['status'] == 'passed'
    assert run.call_args.kwargs['cwd'] == tmp_path
