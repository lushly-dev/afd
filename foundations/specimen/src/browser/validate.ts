import type {
	CoverageClaim,
	EventDeclaration,
	FormExpectation,
	NativeAccessibility,
	ScenarioStep,
	SpecimenDefinition,
	SpecimenModule,
	StateExpectation,
	Target,
	ValidityExpectation,
} from '../types.js';

const specimenFields = new Set([
	'name',
	'args',
	'render',
	'ready',
	'dispose',
	'targets',
	'scenario',
	'a11y',
	'events',
	'coverage',
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

export function record(value: unknown, path: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error(`${path} must be a plain object.`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new Error(`${path} must be a plain object.`);
	}
	return value as Record<string, unknown>;
}

export function fields(value: Record<string, unknown>, allowed: Set<string>, path: string): void {
	for (const name of Object.keys(value)) {
		if (!allowed.has(name)) {
			throw new Error(
				`Unsupported ${path} field '${name}'. This feasibility milestone supports only ${[...allowed].join(', ')}.`
			);
		}
	}
}

export function text(value: unknown, path: string): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new Error(`${path} must be a non-empty string.`);
	}
	return value;
}

export function optionalText(value: unknown, path: string): string | undefined {
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

function events(
	value: unknown,
	availableTargets: Record<string, Target>
): EventDeclaration[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) throw new Error('specimen.events must be an array.');
	return value.map((raw, index) => {
		const path = `specimen.events[${index}]`;
		const item = record(raw, path);
		fields(item, new Set(['type', 'target']), path);
		const target = optionalText(item.target, `${path}.target`);
		if (target !== undefined && !Object.hasOwn(availableTargets, target))
			throw new Error(`${path}.target refers to undeclared target '${target}'.`);
		return { type: text(item.type, `${path}.type`), ...(target ? { target } : {}) };
	});
}

function scenario(
	value: unknown,
	availableTargets: Record<string, Target>,
	declaredEvents: EventDeclaration[] = [],
	support?: ScenarioValidation
): ScenarioStep[] {
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
		if (Object.hasOwn(step, 'expect')) {
			fields(step, new Set(['id', 'expect']), path);
			const id = optionalText(step.id, `${path}.id`);
			if (id && ids.has(id)) throw new Error(`Duplicate scenario step id '${id}'.`);
			const expectation = record(step.expect, `${path}.expect`);
			if (!Object.hasOwn(expectation, 'event')) {
				if (!support) throw new Error(`${path}.expect needs scenario support, which did not load.`);
				if (id) ids.add(id);
				return {
					...(id === undefined ? {} : { id }),
					expect: {
						...support.elementExpectation(expectation, availableTargets, `${path}.expect`),
						...(id === undefined ? {} : { id }),
					},
				};
			}
			fields(
				expectation,
				new Set(['event', 'target', 'since', 'timeoutMs', 'absent']),
				`${path}.expect`
			);
			const event = text(expectation.event, `${path}.expect.event`);
			const target = optionalText(expectation.target, `${path}.expect.target`);
			const since = optionalText(expectation.since, `${path}.expect.since`);
			if (!since)
				throw new Error(`${path}.expect.since must name the step that begins its interval.`);
			if (!ids.has(since))
				throw new Error(`${path}.expect.since refers to '${since}', which no earlier step is.`);
			// An event nobody listens for could never be credited, so it fails before running.
			if (
				!declaredEvents.some(
					(item) =>
						item.type === event && (target === undefined || item.target === target || !item.target)
				)
			)
				throw new Error(
					`${path}.expect expects event '${event}'${target ? ` on '${target}'` : ''}, which specimen.events does not declare.`
				);
			const timeoutMs = expectation.timeoutMs;
			if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || timeoutMs < 0))
				throw new Error(`${path}.expect.timeoutMs must be a number of milliseconds.`);
			if (expectation.absent !== undefined && typeof expectation.absent !== 'boolean')
				throw new Error(`${path}.expect.absent must be a boolean.`);
			if (id) ids.add(id);
			return {
				...(id === undefined ? {} : { id }),
				expect: {
					event,
					since,
					...(target === undefined ? {} : { target }),
					...(timeoutMs === undefined ? {} : { timeoutMs }),
					...(expectation.absent === undefined ? {} : { absent: expectation.absent }),
					...(id === undefined ? {} : { id }),
				},
			};
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
function required(value: unknown, path: string): string {
	if (typeof value !== 'string' || !value.trim())
		throw new Error(`${path} is required: an exclusion must say why and where.`);
	return value;
}

/** Native exclusions always carry a reason and, for a rule, a target; reports list them. */
function accessibility(value: unknown): NativeAccessibility | undefined {
	if (value === undefined) return undefined;
	const raw = record(value, 'specimen.a11y');
	fields(raw, new Set(['disabled', 'exceptions']), 'specimen.a11y');
	if (raw.disabled !== undefined && raw.exceptions !== undefined)
		throw new Error('specimen.a11y disables its checks or excepts rules, not both.');
	if (raw.disabled !== undefined) {
		const disabled = record(raw.disabled, 'specimen.a11y.disabled');
		fields(disabled, new Set(['reason']), 'specimen.a11y.disabled');
		return { disabled: { reason: required(disabled.reason, 'specimen.a11y.disabled.reason') } };
	}
	if (raw.exceptions === undefined) return {};
	if (!Array.isArray(raw.exceptions)) throw new Error('specimen.a11y.exceptions must be an array.');
	return {
		exceptions: raw.exceptions.map((item, index) => {
			const path = `specimen.a11y.exceptions[${index}]`;
			const exception = record(item, path);
			fields(exception, new Set(['rule', 'target', 'reason']), path);
			return {
				rule: required(exception.rule, `${path}.rule`),
				target: required(exception.target, `${path}.target`),
				reason: required(exception.reason, `${path}.reason`),
			};
		}),
	};
}

/** What only a case with element expectations or claims needs: loaded for those alone. */
export interface ScenarioValidation {
	elementExpectation(
		expectation: Record<string, unknown>,
		availableTargets: Record<string, unknown>,
		path: string
	): StateExpectation | FormExpectation | ValidityExpectation;
	claims(
		value: unknown,
		availableTargets: Record<string, unknown>,
		declared: ScenarioStep[] | undefined
	): CoverageClaim[] | undefined;
}

/** Whether a specimen export needs that support, read without validating it. */
export function needsScenarioSupport(value: unknown): boolean {
	if (typeof value !== 'object' || value === null) return false;
	const { coverage, scenario } = value as { coverage?: unknown; scenario?: unknown };
	return (
		coverage !== undefined ||
		(Array.isArray(scenario) &&
			scenario.some((step) => {
				const expectation = (step as { expect?: unknown } | null)?.expect;
				return typeof expectation === 'object' && expectation !== null && !('event' in expectation);
			}))
	);
}

export function validateSpecimen(
	module: SpecimenModule,
	exportName: string,
	support?: ScenarioValidation
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
	const declaredEvents = events(raw.events, availableTargets);
	const declaredScenario = scenario(raw.scenario, availableTargets, declaredEvents, support);
	return {
		meta,
		specimen: {
			args: args(raw.args, 'specimen.args'),
			render: render(raw.render, 'specimen.render'),
			ready: hook(raw.ready, 'specimen.ready'),
			dispose: hook(raw.dispose, 'specimen.dispose'),
			targets: availableTargets,
			scenario: declaredScenario,
			a11y: accessibility(raw.a11y),
			events: declaredEvents,
			coverage: support?.claims(raw.coverage, availableTargets, declaredScenario),
		},
	};
}
