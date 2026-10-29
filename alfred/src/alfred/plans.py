"""Validate complete required/optional check plans before entering any handler."""

from __future__ import annotations

import inspect
from dataclasses import asdict
from pathlib import Path
from typing import get_type_hints

from afd import error, success
from afd.core.result import ResultMetadata
from botcore.context import current_context, use_context
from botcore.host import QualityVerdict, aggregate_quality
from pydantic import TypeAdapter


def prepare_plan(host, checks):
    if not isinstance(checks, list):
        raise ValueError('Check plan requires a list of checks')
    prepared = []
    parent = current_context() or host.context
    for index, check in enumerate(checks):
        try:
            if not isinstance(check, dict) or set(check) - {'command', 'arguments', 'required', 'optional'}:
                raise ValueError('Each check declares command, arguments and optional required/optional booleans')
            for field in ('required', 'optional'):
                if field in check and type(check[field]) is not bool:
                    raise ValueError(f'{field} must be a strict boolean')
            if 'required' in check and 'optional' in check and check['required'] == check['optional']:
                raise ValueError('required and optional declarations contradict each other')
            required = check.get('required', not check.get('optional', False))
            name = check.get('command')
            name = host.resolve_command(name) if isinstance(name, str) else name
            if (not isinstance(name, str) or name == 'alfred-check-plan'
                    or name not in host._policies or not host._policies[name].quality):
                raise ValueError('Use registered quality checks without nested plans')
            arguments = check.get('arguments', {})
            if not isinstance(arguments, dict):
                raise ValueError('Check arguments must be an object')
            arguments = dict(arguments)
            if host.selection_is_explicit() and not (name.startswith('dev_') and 'package' in arguments):
                arguments.setdefault('target', str(parent.target))
            invocation, kwargs = host.resolve_invocation(name, arguments)
            policy = host._policies[name]
            handler = host._commands[name]
            bound = inspect.signature(handler).bind(**kwargs)
            bound.apply_defaults()
            annotations = get_type_hints(handler)
            for key, value in bound.arguments.items():
                if key in annotations:
                    TypeAdapter(annotations[key]).validate_python(value, strict=True)
            if name in {'dev_lint', 'dev_test', 'dev_build'}:
                language = bound.arguments.get('language')
                allowed = {'python', 'typescript', 'rust'}
                if name == 'dev_build':
                    allowed |= {'javascript', 'node'}
                if language is not None and language not in allowed:
                    raise ValueError('Select a supported native tool language')
            for key in policy.paths:
                if kwargs.get(key) is not None:
                    resolved = invocation.resolve_path(kwargs[key])
                    if not Path(resolved).exists():
                        raise ValueError(f'Check path does not exist: {kwargs[key]}')
                    if name in {'alfred_lint', 'alfred_parity', 'alfred_quality'} and not Path(resolved).is_dir():
                        raise ValueError('AFD check paths must be directories')
                    kwargs[key] = resolved
            if name == 'alfred_lint':
                from afd.lushx_ext.linters import AFDLinter
                AFDLinter(**{key: value for key, value in kwargs.items() if key != 'path' and value is not None})
            applicable = True
            if name in {'alfred_lint', 'alfred_parity', 'alfred_quality'}:
                from alfred.host import _native_area
                applicable = _native_area(invocation.workspace, Path(kwargs.get('path') or invocation.target))
            with use_context(invocation):
                effects = policy.effects(dict(bound.arguments)) if callable(policy.effects) else policy.effects
            declared = policy.possible_effects if callable(policy.effects) else policy.effects
            if set(effects) - set(declared):
                raise ValueError('Check effects exceed declared policy')
            prepared.append({'command': name, 'arguments': {**kwargs, 'target': str(invocation.target)},
                             'required': required, 'optional': not required, 'applicable': applicable,
                             'effects': effects if applicable else (), 'target': str(invocation.target)})
        except (ValueError, TypeError, OSError, KeyError, NameError) as exc:
            raise ValueError(f'Invalid check at index {index}: {exc}') from exc
    return prepared


def plan_effects(host, checks):
    prepared = prepare_plan(host, checks)
    return tuple(sorted({'inspect', *(effect for check in prepared for effect in check['effects'])}))


async def execute_plan(host, checks):
    prepared = prepare_plan(host, checks)
    verdicts = []
    rows = []
    for check in prepared:
        if check['applicable']:
            result = await host.execute(check['command'], check['arguments'])
            metadata = result.metadata.model_dump() if result.metadata else {}
            quality = metadata.get('quality') or {
                'status': 'error', 'target': check['target'],
                'evidence': {'error': result.error.code if result.error else 'NO_VERDICT'},
            }
            verdict = QualityVerdict(**quality)
        else:
            result = error('NOT_APPLICABLE', 'Check does not apply to the selected target',
                           suggestion='Select an AFD native area or declare this check optional')
            verdict = QualityVerdict('skipped', check['target'], {'reason': 'not-applicable'})
            result = result.model_copy(update={'metadata': ResultMetadata(quality=asdict(verdict))})
        if check['required']:
            verdicts.append(verdict)
        exclusion = None if check['required'] else ('not-applicable' if not check['applicable'] else f'optional-{verdict.status}')
        rows.append({**result.model_dump(mode='json', exclude_none=True),
                     'command': check['command'], 'required': check['required'], 'optional': check['optional'],
                     'included_in_aggregate': check['required'], 'exclusion_reason': exclusion})
    return success({'verdict': aggregate_quality(verdicts), 'checks': rows,
                    'required_count': len(verdicts), 'optional_count': len(rows) - len(verdicts)})
