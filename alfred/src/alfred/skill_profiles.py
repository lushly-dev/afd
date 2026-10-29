"""Read-only adapter to the repository-owned skill profile checker."""

from __future__ import annotations

import asyncio
import json
import shutil
from pathlib import Path

from afd import error, success


def uses_profile(context) -> bool:
    if context is None or context.target != context.workspace:
        return False
    root = context.workspace
    return all((root / file).is_file() for file in (
        'spec/VERSION', 'packages/core/src/index.ts', 'skills/exports.json', 'scripts/skill-profiles.mjs'
    ))


def effects(_arguments):
    from botcore.context import current_context
    return ('subprocess',) if uses_profile(current_context()) else ('inspect',)


async def check_profile(root: Path):
    """Use the canonical check algorithm; no projection or regeneration logic lives here."""
    try:
        for relative in ('skills/exports.json', 'scripts/skill-profiles.mjs'):
            path = root / relative
            if path.resolve() != path.absolute():
                raise ValueError('Profile manifest and checker must be owned local files')
        node = shutil.which('node')
        if not node:
            return error('TOOL_NOT_FOUND', 'Node is required for AFD profile validation',
                         suggestion='Activate the repository-pinned Node runtime')
        process = await asyncio.create_subprocess_exec(
            node, str(root / 'scripts/skill-profiles.mjs'), '--check', '--json', cwd=root,
            stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=120)
        except TimeoutError:
            process.kill()
            await process.communicate()
            return error('SKILL_PROFILE_TIMEOUT', 'Read-only profile check timed out',
                         suggestion='Run the repository skill profile check directly')
        data = json.loads(stdout) if stdout else None
        if (process.returncode not in (0, 1) or not isinstance(data, dict)
                or data.get('mode') != 'check' or not isinstance(data.get('changed'), list)
                or any(not isinstance(path, str) for path in data['changed'])
                or data.get('success') is not (not data['changed'])
                or process.returncode != (0 if data['success'] else 1)):
            return error('INVALID_SKILL_PROFILE', stderr.decode(errors='replace').strip() or 'Invalid profile checker evidence',
                         suggestion='Repair the declared skill profile using its canonical source and reviewed generator')
        manifest = json.loads((root / 'skills/exports.json').read_text())
        if manifest.get('version') != 1 or manifest.get('canonical', {}).get('owner') != 'botcore':
            raise ValueError('Unsupported skill profile manifest')
        profile = manifest['profiles']['afd']
        entries = []
        for kind in ('projections', 'overrides', 'local'):
            for item in profile[kind]:
                entry = {'name': item} if isinstance(item, str) else dict(item)
                entry.update(kind=kind, path=f"{profile['root']}/{entry['name']}")
                entries.append(entry)
        return success({'passed': data['success'], 'changed': data['changed'], 'entries': entries,
                        'scope': 'AFD profile freshness and ownership; overrides remain AFD-owned'})
    except (OSError, ValueError, KeyError, TypeError) as exc:
        return error('INVALID_SKILL_PROFILE', str(exc),
                     suggestion='Inspect skills/exports.json and the repository-owned profile checker')


async def profile_list(root: Path, show_source: bool):
    from botcore.commands.skill.list import skill_list
    checked = await check_profile(root)
    if not checked.success:
        return checked
    result = await skill_list(show_source, plugin_dirs=[])
    if not result.success:
        return result
    by_name = {entry['name']: entry for entry in checked.data['entries']}
    canonical = {entry['canonical'] for entry in by_name.values() if entry.get('canonical')}
    for entry in result.data['installed']:
        declared = by_name.get(entry['name'], {})
        entry.update(kind=declared.get('kind'), canonical=declared.get('canonical'))
    for entry in result.data['available']:
        if entry['name'] in canonical:
            entry['installed'] = True
    result.data['profile'] = checked.data
    return result


async def profile_status(root: Path):
    checked = await check_profile(root)
    if not checked.success:
        return checked
    rows = []
    for entry in checked.data['entries']:
        stale = any(path == entry['path'] or path.startswith(entry['path'] + '/') for path in checked.data['changed'])
        state = 'stale' if stale else ('ok' if entry['kind'] == 'projections' else 'owned-local')
        if not (root / entry['path'] / 'SKILL.md').is_file():
            state = 'missing'
        rows.append({**entry, 'status': state})
    return success({'skills': rows, 'profile': checked.data,
                    'summary': {state: sum(row['status'] == state for row in rows)
                                for state in ('ok', 'owned-local', 'stale', 'missing')}})


async def profile_lint(root: Path, path: str | None, strict: bool):
    from botcore.commands.skill.lint import skill_lint
    checked = await check_profile(root)
    if not checked.success:
        return checked
    result = await skill_lint(path, strict)
    if result.success:
        result.data['profile'] = checked.data
        result.data['verdict'] = 'passed' if result.data['success'] and checked.data['passed'] else 'failed'
    return result
