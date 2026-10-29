"""Alfred consumes the shared profile checker without reimplementing projections."""

import json
import shutil
from pathlib import Path
from unittest.mock import patch

import pytest

from alfred.host import build_alfred_host

REPO_ROOT = Path(__file__).resolve().parents[2]


async def test_actual_profile_list_status_lint_recognize_owned_legacy_names():
    manifest = json.loads((REPO_ROOT / 'skills/exports.json').read_text())
    profile = manifest['profiles']['afd']
    expected = len(profile['projections']) + len(profile['overrides']) + len(profile['local'])
    host = build_alfred_host(REPO_ROOT, target='worktree', profile='trusted-local')
    listed = await host.execute('skill_list')
    assert listed.success, listed.error
    assert listed.data['installed_count'] == expected
    aliases = {entry['canonical'] for entry in profile['projections'] + profile['overrides']}
    assert all(entry['installed'] for entry in listed.data['available'] if entry['name'] in aliases)
    status = await host.direct_client().call('skill_status')
    assert status.success, status.error
    assert len(status.data['skills']) == expected
    assert all(entry['status'] in ('ok', 'owned-local') for entry in status.data['skills'])
    lint = await host.execute('skill_lint')
    assert lint.success, lint.error
    assert lint.metadata.quality['status'] == 'passed'
    assert lint.data['profile']['changed'] == []


async def test_profile_inspection_rejects_before_subprocess():
    host = build_alfred_host(REPO_ROOT, target='worktree')
    with patch('asyncio.create_subprocess_exec') as spawn:
        for command in ('skill_list', 'skill_status', 'skill_lint'):
            result = await host.execute(command)
            assert result.error.code == 'EFFECT_DENIED'
    spawn.assert_not_called()


async def test_external_skill_inspection_keeps_native_behavior(tmp_path):
    (tmp_path / 'pyproject.toml').write_text('[project]\nname="external"\nversion="0.1.0"')
    host = build_alfred_host(tmp_path)
    with patch('asyncio.create_subprocess_exec') as spawn:
        result = await host.execute('skill_list')
    assert result.success and 'profile' not in result.data
    spawn.assert_not_called()


@pytest.fixture
def drifted_profile(tmp_path):
    # Copy the shared checker inputs; all managed checks remain read-only.
    for relative in ('skills', '.claude/skills', 'endpoints/botcore/src/botcore/skills'):
        shutil.copytree(REPO_ROOT / relative, tmp_path / relative)
    for relative in ('scripts/skill-profiles.mjs', 'spec/VERSION', 'packages/core/src/index.ts'):
        target = tmp_path / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(REPO_ROOT / relative, target)
    (tmp_path / '.codex').mkdir()
    (tmp_path / '.codex/skills').symlink_to('../.claude/skills')
    manifest = json.loads((tmp_path / 'skills/exports.json').read_text())
    name = manifest['profiles']['afd']['projections'][0]['name']
    projection = tmp_path / '.claude/skills' / name / 'SKILL.md'
    projection.write_text(projection.read_text() + '\nDisposable drift\n')
    return tmp_path, projection


async def test_profile_drift_is_evidence_and_never_a_passing_lint(drifted_profile):
    root, projection = drifted_profile
    before = projection.read_bytes()
    host = build_alfred_host(root, target='worktree', profile='trusted-local')
    status = await host.execute('skill_status')
    assert status.success
    assert status.data['summary']['stale'] == 1
    lint = await host.execute('skill_lint')
    assert lint.success and lint.metadata.quality['status'] == 'failed'
    assert lint.data['profile']['changed'] == [str(projection.relative_to(root))]
    assert projection.read_bytes() == before
