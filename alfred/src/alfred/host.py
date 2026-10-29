"""Alfred's explicit, per-worktree command host (cooperative policy, not a sandbox)."""

from __future__ import annotations

import inspect
import json
import shutil
from contextvars import ContextVar
from pathlib import Path

from afd import error, success
from botcore import ExecutionContext, build_host
from botcore.context import current_context, use_context
from botcore.host import (
    CORE_POLICIES,
    CommandHost,
    CommandPolicy,
)

from alfred.commands.lint import alfred_lint
from alfred.commands.parity import alfred_parity
from alfred.commands.quality import alfred_quality

AFD_AREAS = (
    'packages/core', 'packages/server', 'packages/client', 'packages/auth',
    'packages/cli', 'packages/testing', 'packages/view-state', 'packages/adapters',
    'packages/local-db', 'packages/rust', 'packages/cpp', 'packages/examples',
    'python', 'alfred', 'integrations',
)
AFD_COMMANDS = {'alfred_lint': 'passed', 'alfred_parity': 'total_gaps', 'alfred_quality': 'issue_count'}
COMMON = tuple(name for name in CORE_POLICIES if not name.startswith('changeset_'))
ALIASES = {'info_targets': 'info-targets', 'alfred_check_plan': 'alfred-check-plan'}
_explicit_selection = ContextVar('alfred_explicit_selection', default=False)


def _afd_root(root: Path) -> bool:
    return (root / 'spec/VERSION').is_file() and (root / 'packages/core/src/index.ts').is_file()


def _packages(root: Path) -> dict[str, Path]:
    """Discover declared release distributions without loading their runtime dependencies."""
    result = {}
    inventory = root / 'scripts/release/inventory.json'
    if inventory.is_file():
        for unit in json.loads(inventory.read_text())['units']:
            for dist in unit.get('distributions', []):
                candidate = (root / dist['manifest']).resolve()
                if not candidate.is_relative_to(root):
                    raise ValueError('Release inventory manifest escapes the worktree')
                if candidate.is_file():
                    result[dist['name']] = candidate.parent
    return result


def _select(root: Path, selector: str | Path | None) -> Path:
    if selector is None or str(selector) in {'.', 'worktree'}:
        return root
    packages = _packages(root)
    candidate = packages.get(str(selector), root / selector).resolve(strict=True)
    if not candidate.is_dir() or not candidate.is_relative_to(root):
        raise ValueError('Select an existing package or area inside this worktree')
    return candidate


def _within(base: Path, relative: str | Path) -> Path:
    """Resolve a directory relative to the selected target without leaving it."""
    candidate = (base / relative).resolve(strict=True)
    if not candidate.is_dir() or not candidate.is_relative_to(base):
        raise ValueError('Select an existing directory inside the selected target')
    return candidate


def _native_area(root: Path, target: Path) -> bool:
    return _afd_root(root) and (target == root or any(
        target.is_relative_to(root / area) for area in AFD_AREAS
    ))


async def _native(command: str, path: str | None = None, **options):
    context = current_context()
    root, target = context.workspace, Path(path) if path else context.target
    if not target.is_dir():
        return error('INVALID_TARGET', 'AFD check paths must be existing directories',
                     suggestion='Select an existing AFD package or area directory')
    if not _native_area(root, target):
        return error('NOT_APPLICABLE', 'AFD architectural checks require an AFD native area or integration',
                     suggestion='Select an AFD area, or use dev_lint for native language tooling')
    handler = {'alfred_lint': alfred_lint, 'alfred_parity': alfred_parity,
               'alfred_quality': alfred_quality}[command]
    if command == 'alfred_parity':
        return await handler(str(root))
    targets = [root / area for area in AFD_AREAS if (root / area).is_dir()] if target == root else [target]
    results = [await handler(str(area), **options) for area in targets]
    for result in results:
        if not result.success:
            return result
    data = {}
    for result in results:
        for key, value in result.data.items():
            if isinstance(value, bool):
                data[key] = data.get(key, True) and value
            elif isinstance(value, int):
                data[key] = data.get(key, 0) + value
            elif isinstance(value, list):
                data.setdefault(key, []).extend(value)
            elif key == 'suppressed':
                combined = data.setdefault(key, {'total': 0, 'by_rule': {}, 'by_reason': {}})
                combined['total'] += value['total']
                for group in ('by_rule', 'by_reason'):
                    for name, count in value[group].items():
                        combined[group][name] = combined[group].get(name, 0) + count
    return success(data, reasoning=f'Checked {len(targets)} AFD native areas')


async def _lint(path: str | None = None, exclude_story_test_files: bool | None = None,
                rule_path_excludes: dict[str, list[str]] | None = None,
                rule_severity_overrides: dict[str, str] | None = None):
    return await _native('alfred_lint', path, exclude_story_test_files=exclude_story_test_files,
                         rule_path_excludes=rule_path_excludes, rule_severity_overrides=rule_severity_overrides)


async def _parity(path: str | None = None):
    return await _native('alfred_parity', path)


async def _quality(path: str | None = None):
    return await _native('alfred_quality', path)


async def _info_env():
    import sys
    context = current_context()
    return success({'python_version': sys.version, 'platform': sys.platform,
                    'workspace': str(context.workspace), 'target': str(context.target)})


async def _skills_list(show_source: bool = False):
    from alfred.skill_profiles import profile_list, uses_profile
    if uses_profile(current_context()):
        return await profile_list(current_context().target, show_source)
    from botcore.commands.skill.list import skill_list
    return await skill_list(show_source, plugin_dirs=[])


async def _skills_status():
    from alfred.skill_profiles import profile_status, uses_profile
    if uses_profile(current_context()):
        return await profile_status(current_context().target)
    from botcore.commands.skill.status import skill_status
    return await skill_status(plugin_dirs=[])


async def _skills_lint(path: str | None = None, strict: bool = False):
    """Lint all skills, or one skill named relative to Botcore's configured skills directory."""
    if path is not None and (Path(path).is_absolute() or '..' in Path(path).parts):
        return error('INVALID_TARGET_OR_INPUT', 'Name a skill inside the skills directory',
                     suggestion='Pass a skill name such as "review", or omit path to lint every skill')
    from alfred.skill_profiles import profile_lint, uses_profile
    if uses_profile(current_context()):
        return await profile_lint(current_context().target, path, strict)
    from botcore.commands.skill.lint import skill_lint
    result = await skill_lint(path, strict)
    if result.success:
        result.data['verdict'] = 'passed' if result.data['success'] else 'failed'
    return result


def _build_failure(result):
    code = {'unavailable': 'TOOL_UNAVAILABLE', 'error': 'TOOL_EXECUTION_ERROR',
            'failed': 'BUILD_FAILED'}.get(result.get('failure_kind'), 'TOOL_EXECUTION_ERROR')
    return error(code, result.get('error') or result.get('output') or 'Build did not complete',
                 suggestion='Inspect the selected project build output and toolchain')


async def _dev_build(language: str | None = None, path: str | None = None):
    """Build the selected Python package directly, or use Botcore's native dispatcher."""
    context = current_context()
    target = context.target
    if language == 'python' or (language is None and (target / 'pyproject.toml').is_file()):
        from botcore.utils.runner import run_command
        if not shutil.which('uv'):
            return error('TOOL_NOT_FOUND', 'uv is required for a selected Python package build',
                         suggestion='Install the repository-pinned uv toolchain')
        result = await run_command(['uv', 'build', '--out-dir', str(target / 'dist')], cwd=target)
        if result.get('success'):
            return success(result)
        return _build_failure(result)
    if language in ('typescript', 'javascript', 'node') or (language is None and (target / 'package.json').is_file()):
        from botcore.utils.runner import run_command
        manifest = json.loads((target / 'package.json').read_text())
        script = manifest.get('scripts', {}).get('build')
        if not isinstance(script, str) or not script.strip():
            return error('UNAVAILABLE', 'Selected Node project has no build script',
                         suggestion='Declare a build script in the selected package manifest')
        manager = manifest.get('packageManager')
        if manager is None and (context.workspace / 'package.json').is_file():
            manager = json.loads((context.workspace / 'package.json').read_text()).get('packageManager')
        manager = manager.split('@', 1)[0] if isinstance(manager, str) else 'npm'
        if manager not in ('npm', 'pnpm', 'yarn'):
            return error('UNAVAILABLE', 'Unsupported declared package manager',
                         suggestion='Use an admitted npm, pnpm or yarn build route')
        if not shutil.which(manager):
            return error('TOOL_NOT_FOUND', f'{manager} is unavailable',
                         suggestion='Activate the declared package manager toolchain')
        result = await run_command([manager, 'run', 'build'], cwd=target)
        if result.get('success'):
            return success(result)
        return _build_failure(result)
    from botcore.commands.dev.core import dev_build
    return await dev_build(language=language, path=path)


class TargetRequiredError(ValueError):
    """A monorepo generic command needs an explicit target."""


class AlfredHost(CommandHost):
    """Resolve selections per invocation; never mutate a shared host context or cwd."""

    def __init__(self, context, *, explicit_target=False, npm_controller=None):
        super().__init__('alfred', context)
        self.explicit_target = explicit_target
        self.npm_controller = npm_controller

    def selection_is_explicit(self):
        return self.explicit_target or _explicit_selection.get()

    def resolve_command(self, name):
        return ALIASES.get(name, name)

    def has_command(self, name):
        return super().has_command(self.resolve_command(name))

    def catalog(self):
        rows = super().catalog()
        target = self.context.target
        for row in rows:
            native = row['name'] in AFD_COMMANDS
            row.update(target=str(target), applicability=(
                'applicable' if not native or _native_area(self.context.workspace, target)
                else 'not-applicable'), target_selection=['package-name', 'area-path', 'worktree'])
            if row['name'].startswith('dev_'):
                row['capabilities'] = ['native-toolchain']
                row['tool_availability'] = {name: bool(shutil.which(name)) for name in ('node', 'uv', 'cargo')}
            if row['name'].startswith('skill_'):
                from alfred.skill_profiles import uses_profile
                row['profile_validation'] = uses_profile(self.context)
                row['selected_effects'] = ['subprocess'] if row['profile_validation'] else ['inspect']
            if row['name'].startswith('changeset_'):
                row['release_controller'] = 'approved-root-npm' if self.npm_controller else 'unavailable'
        return rows

    def resolve_invocation(self, name, args):
        """Pure target/argument preparation shared by calls and complete plan preflight."""
        if not isinstance(args, dict):
            raise ValueError('Arguments must be an object')
        args = dict(args)
        if name == 'spec_create' and isinstance(args.get('path'), str):
            path = Path(args['path'])
            if not path.is_absolute() and not path.suffix:
                args['path'] = str(path.with_suffix('.md'))
        selector = args.pop('target', None)
        subpath = None
        if name.startswith('dev_'):
            # package selects like target; path narrows within the selected target.
            package, subpath = args.pop('package', None), args.pop('path', None)
            if selector is not None and package is not None:
                raise ValueError('Use one target selector')
            selector = package if package is not None else selector
        selected = _select(self.context.workspace, selector) if selector is not None else self.context.target
        if subpath is not None:
            selected = _within(selected, subpath)
        invocation = ExecutionContext(self.context.workspace, selected, self.context.profile)
        ambiguous = selected == self.context.workspace and not (
            self.explicit_target or selector is not None or subpath is not None) and (
            bool(_packages(self.context.workspace)) or (self.context.workspace / 'pnpm-workspace.yaml').exists()
        )
        if ambiguous and name.startswith(('dev_', 'docs_', 'spec_', 'skill_')):
            raise TargetRequiredError('This worktree has several areas; pass a package, area, or worktree target')
        return invocation, args

    async def execute(self, name, args=None, context=None):
        name = self.resolve_command(name)
        if args is not None and not isinstance(args, dict):
            return await super().execute(name, args, context)
        try:
            explicit = self.explicit_target or (args or {}).get('target') is not None
            invocation, args = self.resolve_invocation(name, args or {})
            child = CommandHost(self.name, invocation)
            child._commands = self._commands
            child._policies = self._policies
            child.middleware = self.middleware
            token = _explicit_selection.set(explicit)
            try:
                with use_context(invocation):
                    result = await child.execute(name, args, context)
            finally:
                _explicit_selection.reset(token)
        except TargetRequiredError as exc:
            return error('TARGET_REQUIRED', str(exc), suggestion='Select a package, area path, or worktree')
        except (ValueError, OSError, KeyError, TypeError) as exc:
            return error('INVALID_TARGET_OR_INPUT', str(exc),
                         suggestion='Select an existing package, area, or worktree within this host')
        return result


def build_alfred_host(workspace: str | Path, target: str | Path | None = None, *,
                      profile='inspection', plugins=(), policies=None, npm_controller=None):
    """Create one Alfred catalog. Plugins require explicit Botcore admission and effects."""
    root = Path(workspace).resolve(strict=True)
    context = ExecutionContext(root, _select(root, target), profile)
    if npm_controller is None:
        from alfred.release_controller import bind_npm_controller
        npm_controller = bind_npm_controller(root)
    base = build_host('alfred', context, plugins=plugins, policies=policies, core_commands=COMMON)
    host = AlfredHost(context, explicit_target=target is not None, npm_controller=npm_controller)
    for name in base.list_command_names():
        if name in ALIASES:
            raise ValueError(f'Command {name} collides with the Alfred alias for {ALIASES[name]}')
        host.register(name, base._commands[name], base._policies[name])
    host.docs, host.middleware = base.docs, base.middleware
    # Override contextual environment reporting before construction-time collision checks.
    host._commands['info_env'] = _info_env
    host._commands['dev_build'] = _dev_build
    for name, handler in (('alfred_lint', _lint), ('alfred_parity', _parity), ('alfred_quality', _quality)):
        host.register(name, handler, CommandPolicy(paths=('path',), quality=AFD_COMMANDS[name]))
    from botcore.commands.docs import docs_lint
    host.register('docs_lint', docs_lint, CommandPolicy(paths=('path',), quality='passed'))
    from alfred.skill_profiles import effects as skill_effects
    for name, handler in (('skill_list', _skills_list), ('skill_status', _skills_status), ('skill_lint', _skills_lint)):
        host.register(name, handler, CommandPolicy(
            effects=skill_effects, possible_effects=('inspect', 'subprocess'),
            capabilities=('repository-profile-checker-if-present',),
            quality='verdict' if name == 'skill_lint' else None))

    async def info_targets():
        inventory = root / 'scripts/release/inventory.json'
        units = json.loads(inventory.read_text())['units'] if inventory.is_file() else []
        return success({'workspace': str(root), 'selected_target': str(current_context().target),
                        'packages': {name: str(path.relative_to(root)) for name, path in _packages(root).items()},
                        'units': [{'id': unit['id'], 'family': unit.get('family'),
                                   'state': unit.get('state'), 'protocol': unit.get('protocol'),
                                   'gates': unit.get('gates', []),
                                   'distributions': unit.get('distributions', [])} for unit in units],
                        'afd_areas': [area for area in AFD_AREAS if (root / area).is_dir()],
                        'extension_policy': 'Future foundation commands require explicit plugins and policies'})

    host.register('info-targets', info_targets, CommandPolicy())

    async def changeset_status(unit: str):
        return await release('status', unit, {})

    async def changeset_create(unit: str, packages: dict[str, str], summary: str):
        return await release('create', unit, {'packages': packages, 'summary': summary})

    async def changeset_consume(unit: str):
        return await release('consume', unit, {})

    async def changeset_delete(unit: str, fragment: str):
        return await release('delete', unit, {'fragment': fragment})

    async def release(operation, unit, arguments):
        if npm_controller is None:
            return error('RELEASE_CONTROLLER_UNAVAILABLE', 'This worktree has no approved AFD npm controller',
                         suggestion='Use the project release protocol, or bind a verified AFD root controller')
        inventory = root / 'scripts/release/inventory.json'
        units = json.loads(inventory.read_text())['units'] if inventory.is_file() else []
        selected = next((item for item in units if item['id'] == unit), None)
        if not selected or selected.get('protocol') != 'npm-changesets' or selected.get('state') != 'admitted':
            return error('RELEASE_UNIT_NOT_ADMITTED', unit, suggestion='Select an admitted npm unit from root release inventory')
        result = npm_controller(root, operation, unit, arguments)
        return await result if inspect.isawaitable(result) else result

    for handler in (changeset_status, changeset_create, changeset_consume, changeset_delete):
        effects = ('subprocess', 'service') if handler.__name__ == 'changeset_status' else ('subprocess', 'service', 'release-write')
        host.register(handler.__name__, handler, CommandPolicy(
            effects, capabilities=('approved-root-npm-controller', 'unit:npm-changesets'),
            output_scope='worktree-root-release-controller'))

    from alfred.plans import execute_plan, plan_effects

    async def alfred_check_plan(checks: list[dict]):
        return await execute_plan(host, checks)

    from botcore.host import EFFECTS
    host.register('alfred-check-plan', alfred_check_plan, CommandPolicy(
        effects=lambda arguments: plan_effects(host, arguments['checks']),
        possible_effects=tuple(sorted(EFFECTS)), quality='verdict'))
    host.docs['alfred-host'] = 'Use info-targets for release units and alfred-check-plan for fully preflighted required/optional checks. Select target by package name, area path, or worktree. AFD checks apply to AFD native areas. Managed profiles are cooperative policy, not a sandbox. npm requires the approved root controller.'
    return host
