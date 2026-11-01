import type { ScenarioStep, SpecimenDefinition, SpecimenModule, Target } from '../types.js';

const specimenFields = new Set([
	'name',
	'args',
	'render',
	'ready',
	'dispose',
	'targets',
	'scenario',
]);
const metaFields = new Set(['title', 'description', 'component', 'args', 'render']);
// Playwright 1.64's getByRole contract; abstract/unknown roles are not accepted.
const roles = new Set([
	'alert',
	'alertdialog',
	'application',
	'article',
	'banner',
	'blockquote',
	'button',
	'caption',
	'cell',
	'checkbox',
	'code',
	'columnheader',
	'combobox',
	'complementary',
	'contentinfo',
	'definition',
	'deletion',
	'dialog',
	'directory',
	'document',
	'emphasis',
	'feed',
	'figure',
	'form',
	'generic',
	'grid',
	'gridcell',
	'group',
	'heading',
	'img',
	'insertion',
	'link',
	'list',
	'listbox',
	'listitem',
	'log',
	'main',
	'marquee',
	'math',
	'meter',
	'menu',
	'menubar',
	'menuitem',
	'menuitemcheckbox',
	'menuitemradio',
	'navigation',
	'none',
	'note',
	'option',
	'paragraph',
	'presentation',
	'progressbar',
	'radio',
	'radiogroup',
	'region',
	'row',
	'rowgroup',
	'rowheader',
	'scrollbar',
	'search',
	'searchbox',
	'separator',
	'slider',
	'spinbutton',
	'status',
	'strong',
	'subscript',
	'superscript',
	'switch',
	'tab',
	'table',
	'tablist',
	'tabpanel',
	'term',
	'textbox',
	'time',
	'timer',
	'toolbar',
	'tooltip',
	'tree',
	'treegrid',
	'treeitem',
]);

function record(value: unknown, path: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error(`${path} must be a plain object.`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new Error(`${path} must be a plain object.`);
	}
	return value as Record<string, unknown>;
}

function fields(value: Record<string, unknown>, allowed: Set<string>, path: string): void {
	for (const name of Object.keys(value)) {
		if (!allowed.has(name)) {
			throw new Error(
				`Unsupported ${path} field '${name}'. This feasibility milestone supports only ${[...allowed].join(', ')}.`
			);
		}
	}
}

function text(value: unknown, path: string): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new Error(`${path} must be a non-empty string.`);
	}
	return value;
}

function optionalText(value: unknown, path: string): string | undefined {
	return value === undefined ? undefined : text(value, path);
}

function args(value: unknown, path: string): Record<string, unknown> | undefined {
	if (value === undefined) return undefined;
	const result = record(value, path);
	for (const key of ['__proto__', 'prototype', 'constructor']) {
		if (Object.hasOwn(result, key)) throw new Error(`Reserved argument field '${path}.${key}'.`);
	}
	return result;
}

function render(value: unknown, path: string): SpecimenDefinition['render'] {
	if (value === undefined) return undefined;
	if (typeof value !== 'function') throw new Error(`${path} must be a function.`);
	return value as SpecimenDefinition['render'];
}

function hook(value: unknown, path: string): SpecimenDefinition['dispose'] {
	if (value === undefined) return undefined;
	if (typeof value !== 'function') throw new Error(`${path} must be a function.`);
	return value as SpecimenDefinition['dispose'];
}

function targets(value: unknown): Record<string, Target> {
	if (value === undefined) return {};
	const definitions = record(value, 'specimen.targets');
	const result: Record<string, Target> = Object.create(null);
	for (const [name, raw] of Object.entries(definitions)) {
		text(name, 'Target name');
		const path = `specimen.targets.${name}`;
		const target = record(raw, path);
		if (Object.hasOwn(target, 'selector')) {
			fields(target, new Set(['selector']), path);
			result[name] = { selector: text(target.selector, `${path}.selector`) };
		} else {
			fields(target, new Set(['role', 'name']), path);
			const role = text(target.role, `${path}.role`);
			if (!roles.has(role)) throw new Error(`Unsupported role '${role}' at ${path}.role.`);
			if (target.name !== undefined && typeof target.name !== 'string') {
				throw new Error(`${path}.name must be a string.`);
			}
			result[name] = {
				role,
				...(target.name === undefined ? {} : { name: target.name as string }),
			};
		}
	}
	return result;
}

function scenario(value: unknown, availableTargets: Record<string, Target>): ScenarioStep[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new Error('specimen.scenario must be an array.');
	const ids = new Set<string>();
	const captures = new Set<string>();
	return value.map((raw, index): ScenarioStep => {
		const path = `specimen.scenario[${index}]`;
		const step = record(raw, path);
		if (Object.hasOwn(step, 'capture')) {
			fields(step, new Set(['capture']), path);
			const capture = text(step.capture, `${path}.capture`);
			if (capture === 'mount' || capture === 'after-run') {
				throw new Error(`${path}.capture uses reserved checkpoint '${capture}'.`);
			}
			if (captures.has(capture)) throw new Error(`Duplicate scenario checkpoint '${capture}'.`);
			captures.add(capture);
			return { capture };
		}
		if (Object.hasOwn(step, 'command')) {
			fields(step, new Set(['id', 'command']), path);
			const id = optionalText(step.id, `${path}.id`);
			if (id && ids.has(id)) throw new Error(`Duplicate scenario step id '${id}'.`);
			if (id) ids.add(id);
			const command = record(step.command, `${path}.command`);
			fields(command, new Set(['runner', 'name', 'target', 'input']), `${path}.command`);
			const target = text(command.target, `${path}.command.target`);
			if (!Object.hasOwn(availableTargets, target))
				throw new Error(`${path}.command.target refers to undeclared target '${target}'.`);
			return {
				...(id === undefined ? {} : { id }),
				command: {
					runner: text(command.runner, `${path}.command.runner`),
					name: text(command.name, `${path}.command.name`),
					target,
					...(command.input === undefined ? {} : { input: command.input }),
				},
			};
		}
		fields(step, new Set(['id', 'action']), path);
		const id = optionalText(step.id, `${path}.id`);
		if (id && ids.has(id)) throw new Error(`Duplicate scenario step id '${id}'.`);
		if (id) ids.add(id);
		const action = record(step.action, `${path}.action`);
		const keys = Object.keys(action).filter((key) => key !== 'value');
		if (keys.length !== 1 || !['click', 'focus', 'hover', 'fill'].includes(keys[0] ?? '')) {
			throw new Error(
				`${path}.action must contain exactly one supported action: click, focus, hover or fill.`
			);
		}
		const kind = keys[0];
		if (!kind) throw new Error(`${path}.action is missing its action name.`);
		fields(action, new Set(kind === 'fill' ? ['fill', 'value'] : [kind]), `${path}.action`);
		const target = text(action[kind], `${path}.action.${kind}`);
		if (!Object.hasOwn(availableTargets, target)) {
			throw new Error(`${path}.action.${kind} refers to undeclared target '${target}'.`);
		}
		const identifier = id === undefined ? {} : { id };
		if (kind === 'fill') {
			if (typeof action.value !== 'string')
				throw new Error(`${path}.action.value must be a string.`);
			return { ...identifier, action: { fill: target, value: action.value } };
		}
		if (kind === 'click') return { ...identifier, action: { click: target } };
		if (kind === 'focus') return { ...identifier, action: { focus: target } };
		return { ...identifier, action: { hover: target } };
	});
}

/** Reject unsupported behavior before mounting or executing any scenario prefix. */
export function validateSpecimen(
	module: SpecimenModule,
	exportName: string
): { meta: NonNullable<SpecimenModule['default']>; specimen: SpecimenDefinition } {
	const rawMeta = module.default === undefined ? {} : record(module.default, 'Specimen meta');
	fields(rawMeta, metaFields, 'meta');
	optionalText(rawMeta.title, 'meta.title');
	optionalText(rawMeta.description, 'meta.description');
	const meta = {
		component: optionalText(rawMeta.component, 'meta.component'),
		args: args(rawMeta.args, 'meta.args'),
		render: render(rawMeta.render, 'meta.render'),
	};
	const raw = record(module[exportName], `Specimen export '${exportName}'`);
	fields(raw, specimenFields, 'specimen');
	optionalText(raw.name, 'specimen.name');
	const availableTargets = targets(raw.targets);
	return {
		meta,
		specimen: {
			args: args(raw.args, 'specimen.args'),
			render: render(raw.render, 'specimen.render'),
			ready: hook(raw.ready, 'specimen.ready'),
			dispose: hook(raw.dispose, 'specimen.dispose'),
			targets: availableTargets,
			scenario: scenario(raw.scenario, availableTargets),
		},
	};
}
