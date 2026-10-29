"""Approved npm release controller binding; no shell or generated JavaScript."""

from __future__ import annotations

import asyncio
import json
import re
import shutil
from pathlib import Path
from uuid import uuid4

from afd import error, success

PROTOCOL = 'npm-changesets'
OPERATIONS = {'create', 'status', 'delete', 'consume'}


def _inside(root: Path, relative: str) -> Path:
    path = root / relative
    if (not isinstance(relative, str) or Path(relative).is_absolute()
            or not path.resolve().is_relative_to(root)
            or path.resolve() != path.absolute() or not path.is_file()):
        raise ValueError(f'Controller input must be a regular local file: {relative}')
    return path


def approved_root(root: Path) -> bool:
    """Verify the AFD root and controller layout; installed project code remains trusted."""
    try:
        for name in ('spec/VERSION', 'packages/core/src/index.ts',
                     'scripts/release/inventory.json', 'scripts/release/fragments.mjs',
                     'scripts/release-control.mjs', 'package.json'):
            _inside(root, name)
        inventory = json.loads((root / 'scripts/release/inventory.json').read_text())
        manifest = json.loads((root / 'package.json').read_text())
        return inventory.get('schemaVersion') == 1 and isinstance(inventory.get('units'), list) and (
            manifest.get('scripts', {}).get('version-packages') == 'node scripts/release-control.mjs version'
        )
    except (OSError, ValueError, TypeError):
        return False


class ApprovedNpmController:
    """Bind one worktree; optional offline registry evidence is trusted host configuration."""

    def __init__(self, root: Path, *, registry_evidence: Path | None = None, timeout=120):
        self.root = root.resolve(strict=True)
        if not approved_root(self.root):
            raise ValueError('Approved npm controller requires a verified AFD release root')
        self.registry_evidence = registry_evidence.resolve(strict=True) if registry_evidence else None
        if self.registry_evidence and not self.registry_evidence.is_file():
            raise ValueError('Registry evidence must be a JSON file')
        self.timeout = timeout

    def _validate(self, root, operation, unit, arguments):
        if root.resolve() != self.root or not approved_root(self.root):
            raise ValueError('Controller root changed or is not an approved AFD release root')
        if operation not in OPERATIONS or not isinstance(unit, str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]*', unit):
            raise ValueError('Select one release unit and a supported npm operation')
        if not isinstance(arguments, dict):
            raise ValueError('Release arguments must be an object')
        inventory = json.loads(_inside(root, 'scripts/release/inventory.json').read_text())
        selected = [item for item in inventory['units'] if item.get('id') == unit]
        if len(selected) != 1 or selected[0].get('state') != 'admitted' or selected[0].get('protocol') != PROTOCOL:
            raise ValueError('Select exactly one admitted npm-changesets unit')
        distributions = selected[0].get('distributions', [])
        if not distributions or any(item.get('registry') != 'npm' or item.get('format') != 'npm' for item in distributions):
            raise ValueError('Selected unit must contain npm distributions only')
        for item in distributions:
            _inside(root, item['manifest'])
        expected = {'create': {'packages', 'summary'}, 'delete': {'fragment'}, 'status': set(), 'consume': set()}[operation]
        if set(arguments) != expected:
            raise ValueError(f'Expected arguments: {sorted(expected)}')
        if operation == 'create':
            packages = arguments['packages']
            names = {item['name'] for item in distributions}
            if not isinstance(packages, dict) or not packages or any(
                name not in names or bump not in ('patch', 'minor', 'major') for name, bump in packages.items()
            ):
                raise ValueError('Create requires semver intents owned only by the selected npm unit')
            if not isinstance(arguments['summary'], str) or not arguments['summary'].strip():
                raise ValueError('Create requires a nonempty summary')
        if operation == 'delete':
            fragment = arguments['fragment']
            if not isinstance(fragment, str) or not re.fullmatch(r'\.changeset/[a-z0-9][a-z0-9-]*\.md', fragment):
                raise ValueError('Delete requires an owned .changeset/<id>.md path')
            _inside(root, fragment)

    async def __call__(self, root: Path, operation: str, unit: str, arguments: dict):
        try:
            self._validate(root, operation, unit, arguments)
            node = shutil.which('node')
            if not node:
                return error('TOOL_NOT_FOUND', 'Node is unavailable', suggestion='Activate the repository-pinned Node runtime')
            if operation == 'consume':
                command = [node, str(_inside(root, 'scripts/release-control.mjs')), 'version', '--units', unit]
                if self.registry_evidence:
                    command.extend(['--registry-evidence', str(self.registry_evidence)])
                payload = b''
            else:
                command = [node, str(Path(__file__).with_name('npm_fragments.mjs'))]
                request = {'root': str(root), 'operation': operation, 'unit': unit, **arguments}
                if operation == 'create':
                    request['intent'] = {'id': f'alfred-{uuid4().hex}', 'summary': arguments['summary'],
                                         'changes': [{'name': name, 'type': bump} for name, bump in arguments['packages'].items()]}
                payload = json.dumps(request).encode()
            process = await asyncio.create_subprocess_exec(*command, cwd=root,
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
            try:
                stdout, stderr = await asyncio.wait_for(process.communicate(payload), timeout=self.timeout)
            except TimeoutError:
                process.kill()
                await process.communicate()
                return error('NPM_RELEASE_TIMEOUT', 'Release controller timed out',
                             suggestion='Inspect selected-unit state before retrying; a timed out operation may have effects')
            if process.returncode:
                return error('NPM_RELEASE_REJECTED', stderr.decode(errors='replace').strip() or 'Release controller rejected the operation',
                             suggestion='Review selected-unit admission, coordinated fragments and controller prerequisites')
            data = json.loads(stdout)
            if not isinstance(data, dict) or data.get('selectedUnits') != [unit]:
                raise ValueError('Controller returned invalid selected-unit output')
            if operation == 'consume':
                if not isinstance(data.get('changed'), list) or any(not isinstance(file, str) for file in data['changed']):
                    raise ValueError('Version controller returned invalid changed-file evidence')
            elif (data.get('protocol') != PROTOCOL or data.get('operation') != operation
                  or not isinstance(data.get('files'), list) or any(not isinstance(file, str) for file in data['files'])
                  or data.get('executed') is not (operation != 'status')):
                raise ValueError('Fragment controller returned invalid operation evidence')
            return success({'operation': operation, 'protocol': PROTOCOL, 'controller': 'approved-root-npm', **data})
        except (OSError, ValueError, KeyError, TypeError) as exc:
            return error('INVALID_NPM_RELEASE_INPUT', str(exc),
                         suggestion='Use a verified AFD release root, an admitted npm unit and its declared arguments')


def bind_npm_controller(root: Path):
    """External projects do not acquire AFD release policy from having package.json."""
    return ApprovedNpmController(root) if approved_root(root) else None
