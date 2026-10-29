"""Approved release controllers run only in disposable Git/npm fixtures."""

import json
import shutil
import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest

from alfred.host import build_alfred_host
from alfred.release_controller import ApprovedNpmController, approved_root

AFD_ROOT = Path(__file__).resolve().parents[2]


def write(root, path, value):
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(value if isinstance(value, str) else json.dumps(value))


@pytest.fixture
def repo(tmp_path):
    root = tmp_path / 'repo'
    root.mkdir()
    # Controller source is copied verbatim; no fixture edits to release algorithms.
    for relative in ('scripts/release', 'scripts/release-operations'):
        shutil.copytree(AFD_ROOT / relative, root / relative)
    shutil.copyfile(AFD_ROOT / 'scripts/release-control.mjs', root / 'scripts/release-control.mjs')
    (root / 'node_modules').symlink_to(AFD_ROOT / 'node_modules', target_is_directory=True)
    write(root, 'package.json', {'name': 'fixture', 'private': True, 'packageManager': 'pnpm@10.30.1',
                               'scripts': {'version-packages': 'node scripts/release-control.mjs version'}})
    write(root, 'pnpm-workspace.yaml', 'packages:\n  - packages/*\n')
    write(root, '.gitignore', 'node_modules\n')
    write(root, 'spec/VERSION', '1.0.0')
    write(root, 'packages/core/src/index.ts', '// AFD fixture marker\n')
    units = []
    for unit, state in (('a', 'admitted'), ('b', 'held')):
        write(root, f'packages/{unit}/package.json', {'name': f'@fixture/{unit}', 'version': '1.0.0', 'files': ['index.js']})
        write(root, f'packages/{unit}/index.js', 'export const fixture = true;\n')
        write(root, f'packages/{unit}/CHANGELOG.md', f'# @fixture/{unit}\n\n## 1.0.0\n\nOriginal\n')
        units.append({'id': unit, 'family': unit, 'protocol': 'npm-changesets', 'state': state,
                      'sourceRevision': 'fixture', 'authority': 'fixture', 'routes': ['npm-main'],
                      'gates': ['fixture'], 'fixed': True, 'distributions': [
                          {'name': f'@fixture/{unit}', 'registry': 'npm', 'format': 'npm',
                           'manifest': f'packages/{unit}/package.json', 'initialVersion': '1.0.0'}]})
    write(root, 'scripts/release/inventory.json', {'schemaVersion': 1, 'roots': ['packages'], 'units': units,
                                                'storages': [{'path': '.changeset', 'protocol': 'npm-changesets'}]})
    write(root, '.changeset/config.json', {'changelog': ['@changesets/cli/changelog', {}], 'commit': False, 'fixed': [['@fixture/a'], ['@fixture/b']],
                                         'linked': [], 'access': 'public', 'baseBranch': 'main',
                                         'updateInternalDependencies': 'patch', 'ignore': []})
    write(root, '.changeset/b.md', '---\n"@fixture/b": patch\n---\n\nHeld B\n')
    for args in (['init', '-b', 'main'], ['add', '.'],
                 ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c',
                  'commit.gpgsign=false', 'commit', '--no-verify', '-m', 'Fixture']):
        subprocess.run(['git', *args], cwd=root, check=True, capture_output=True)
    return root


async def test_real_fragment_create_status_delete_default_binding_preserves_held(repo):
    host = build_alfred_host(repo, profile='trusted-local')
    assert approved_root(repo)
    assert host.npm_controller is not None
    held = (repo / '.changeset/b.md').read_bytes()
    # Summary remains data, including shell/code-looking syntax.
    summary = 'Fix `literal` $(touch injected) "quoted"\nsecond line'
    result = await host.execute('changeset_create', {'unit': 'a', 'packages': {'@fixture/a': 'patch'}, 'summary': summary})
    assert result.success, result.error
    path = result.data['files'][0]
    assert summary in (repo / path).read_text()
    assert not (repo / 'injected').exists()
    status = await host.direct_client().call('changeset_status', {'unit': 'a'})
    assert status.success and status.data['files'] == [path]
    deleted = await host.execute('changeset_delete', {'unit': 'a', 'fragment': path})
    assert deleted.success and not (repo / path).exists()
    assert (repo / '.changeset/b.md').read_bytes() == held


async def test_real_consume_versions_manifest_changelog_and_only_selected_fragments(repo, tmp_path):
    evidence = tmp_path / 'registry.json'
    evidence.write_text(json.dumps([{'registry': 'npm', 'name': '@fixture/a', 'versions': ['1.0.0']},
                                    {'registry': 'npm', 'name': '@fixture/b', 'versions': ['1.0.0']}]))
    controller = ApprovedNpmController(repo, registry_evidence=evidence)
    host = build_alfred_host(repo, profile='trusted-local', npm_controller=controller)
    held = {file: (repo / file).read_bytes() for file in ('.changeset/b.md', 'packages/b/package.json', 'packages/b/CHANGELOG.md')}
    created = await host.execute('changeset_create', {'unit': 'a', 'packages': {'@fixture/a': 'patch'}, 'summary': 'Scoped A patch'})
    assert created.success, created.error
    result = await host.execute('changeset_consume', {'unit': 'a'})
    assert result.success, result.error
    assert json.loads((repo / 'packages/a/package.json').read_text())['version'] == '1.0.1'
    assert 'Scoped A patch' in (repo / 'packages/a/CHANGELOG.md').read_text()
    assert not (repo / created.data['files'][0]).exists()
    assert (repo / '.release/npm-intent.json').is_file()
    assert all((repo / file).read_bytes() == contents for file, contents in held.items())
    assert set(result.data['changed']) == {'packages/a/package.json', 'packages/a/CHANGELOG.md', created.data['files'][0]}


async def test_invalid_foreign_coordinated_and_named_delete_reject_before_mutation(repo):
    host = build_alfred_host(repo, profile='trusted-local')
    original = (repo / '.changeset/b.md').read_bytes()
    for arguments in ({'unit': 'a', 'packages': {'@fixture/b': 'patch'}, 'summary': 'wrong owner'},
                      {'unit': 'a', 'packages': {'@fixture/a': 'banana'}, 'summary': 'bad bump'},
                      {'unit': 'a', 'packages': {'@fixture/a': 'patch'}, 'summary': ''}):
        result = await host.execute('changeset_create', arguments)
        assert not result.success
    assert (repo / '.changeset/b.md').read_bytes() == original
    assert sorted(path.name for path in (repo / '.changeset').glob('*.md')) == ['b.md']
    write(repo, '.changeset/a-one.md', '---\n"@fixture/a": patch\n---\n\nOne\n')
    write(repo, '.changeset/a-two.md', '---\n"@fixture/a": patch\n---\n\nTwo\n')
    result = await host.execute('changeset_delete', {'unit': 'a', 'fragment': '.changeset/a-one.md'})
    assert not result.success and (repo / '.changeset/a-two.md').exists() and (repo / '.changeset/a-one.md').exists()
    write(repo, '.changeset/a-one.md', '---\n"@fixture/a": patch\n"@fixture/b": patch\n---\n\nCoordinated\n')
    result = await host.execute('changeset_delete', {'unit': 'a', 'fragment': '.changeset/a-one.md'})
    assert not result.success and (repo / '.changeset/a-one.md').exists()


async def test_inspection_real_binder_never_spawns(repo):
    host = build_alfred_host(repo)
    with patch('asyncio.create_subprocess_exec') as spawn:
        result = await host.execute('changeset_create', {'unit': 'a', 'packages': {'@fixture/a': 'patch'}, 'summary': 'No write'})
    assert result.error.code == 'EFFECT_DENIED'
    spawn.assert_not_called()


def test_external_app_not_auto_bound(tmp_path):
    write(tmp_path, 'package.json', {'name': 'external'})
    assert build_alfred_host(tmp_path).npm_controller is None
    with pytest.raises(ValueError, match='verified AFD'):
        ApprovedNpmController(tmp_path)


async def test_external_release_returns_clear_unsupported_result(tmp_path):
    write(tmp_path, 'package.json', {'name': 'external'})
    result = await build_alfred_host(tmp_path, profile='trusted-local').execute('changeset_status', {'unit': 'external'})
    assert result.error.code == 'RELEASE_CONTROLLER_UNAVAILABLE'
    assert 'project release protocol' in result.error.suggestion


async def test_selected_node_project_build_uses_its_declared_script(tmp_path):
    area = tmp_path / 'node-app'
    write(area, 'package.json', {'name': 'external-node', 'packageManager': 'npm@11.0.0',
                               'scripts': {'build': 'node build.mjs'}})
    write(area, 'build.mjs', 'import { writeFileSync } from "node:fs"; writeFileSync("built.txt", process.cwd());\n')
    host = build_alfred_host(tmp_path, target='node-app', profile='trusted-local')
    result = await host.execute('dev_build')
    assert result.success, result.error
    assert result.metadata.quality['status'] == 'passed'
    assert (area / 'built.txt').read_text() == str(area)
    assert not (tmp_path / 'built.txt').exists()


async def test_real_binding_mcp_create_cli_status_direct_delete(repo):
    import asyncio

    from botcore import create_host_mcp_server
    from click.testing import CliRunner

    from alfred.cli import main

    host = build_alfred_host(repo, profile='trusted-local')
    response = await create_host_mcp_server(host).call_tool('alfred-call', {
        'command': 'changeset_create',
        'arguments': {'unit': 'a', 'packages': {'@fixture/a': 'patch'}, 'summary': 'Cross-route fixture'},
    })
    blocks = response.content if hasattr(response, 'content') else (response[0] if isinstance(response, tuple) else response)
    created = json.loads(blocks[0].text)
    assert created['success'] is True
    fragment = created['data']['files'][0]
    cli = await asyncio.to_thread(CliRunner().invoke, main,
        ['--workspace', str(repo), '--profile', 'trusted-local', 'call', 'changeset_status', '{"unit":"a"}'])
    assert cli.exit_code == 0, cli.output
    assert json.loads(cli.output)['data']['files'] == [fragment]
    deleted = await host.direct_client().call('changeset_delete', {'unit': 'a', 'fragment': fragment})
    assert deleted.success and not (repo / fragment).exists()
    assert (repo / '.changeset/b.md').exists()
