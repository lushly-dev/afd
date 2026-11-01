/**
 * CSF compatibility: Storybook's field-specific composition of project, meta and story
 * annotations, reproduced from Storybook 10.6.2 (`preparePartialAnnotations`, `prepareStory`,
 * `prepareContext`, `composeStory` and the Vitest addon's viewport). Pure functions: the page
 * runtime applies them to a story module's live annotations.
 */

type Fields = Record<string, unknown>;
export type Decorator = (story: (update?: Fields) => unknown, context: Fields) => unknown;
export type Render = (args: Fields, context: Fields) => unknown;
export type Play = (context: Fields) => unknown;

/** Storybook's `isPlainObject`. */
export function isPlainObject(value: unknown): value is Fields {
	if (value === null || typeof value !== 'object') return false;
	if (Object.prototype.toString.call(value) !== '[object Object]') return false;
	const prototype = Object.getPrototypeOf(value);
	return (
		prototype === null ||
		prototype === Object.prototype ||
		Object.getPrototypeOf(prototype) === null
	);
}

/**
 * Storybook's `combineParameters`: arrays replace, `undefined` never overrides, and a key merges
 * deeply only when every defined value for it is a plain object.
 */
export function combineParameters(...sets: (Fields | undefined)[]): Fields {
	const defined = sets.filter((set): set is Fields => Boolean(set));
	const merge = new Set<string>();
	const combined: Fields = {};
	for (const set of defined)
		for (const [key, value] of Object.entries(set)) {
			const existing = combined[key];
			if (Array.isArray(value) || existing === undefined) combined[key] = value;
			else if (isPlainObject(value) && isPlainObject(existing)) merge.add(key);
			else if (value !== undefined) combined[key] = value;
		}
	for (const key of merge) {
		const values = defined.map((set) => set[key]).filter((value) => value !== undefined);
		combined[key] = values.every(isPlainObject)
			? combineParameters(...(values as Fields[]))
			: values[values.length - 1];
	}
	return combined;
}

/** Storybook's `combineTags`. */
export function combineTags(...tags: string[]): string[] {
	const result = new Set<string>();
	for (const tag of tags) {
		if (tag.startsWith('!')) result.delete(tag.slice(1));
		else result.add(tag);
	}
	return [...result];
}

const array = <T>(value: T | T[] | undefined): T[] =>
	value === undefined ? [] : Array.isArray(value) ? value : [value];

/** One annotations level as a module exports it: project (preview), meta or story. */
export interface Annotations {
	args?: Fields;
	argTypes?: Fields;
	parameters?: Fields;
	globals?: Fields;
	initialGlobals?: Fields;
	globalTypes?: Fields;
	decorators?: Decorator | Decorator[];
	render?: Render;
	play?: Play;
	tags?: string[];
	component?: string;
	title?: string;
	id?: string;
	name?: string;
	storyName?: string;
	[field: string]: unknown;
}

/** Fields compatibility mode composes; anything else a level sets is reported. */
const KNOWN: Record<'project' | 'meta' | 'story', ReadonlySet<string>> = {
	project: new Set([
		'args',
		'argTypes',
		'parameters',
		'initialGlobals',
		'globals',
		'globalTypes',
		'decorators',
		'render',
		'tags',
	]),
	meta: new Set([
		'title',
		'id',
		'component',
		'subcomponents',
		'args',
		'argTypes',
		'parameters',
		'globals',
		'decorators',
		'render',
		'play',
		'tags',
		'includeStories',
		'excludeStories',
	]),
	story: new Set([
		'name',
		'storyName',
		'args',
		'argTypes',
		'parameters',
		'globals',
		'decorators',
		'render',
		'play',
		'tags',
	]),
};

/** Fields a level sets that compatibility mode does not compose. */
export function unsupportedFields(level: keyof typeof KNOWN, annotations: object): string[] {
	return Object.keys(annotations).filter(
		(field) => !KNOWN[level].has(field) && (annotations as Fields)[field] !== undefined
	);
}

/** `includeConditionalArg`: an argType's `if` condition over args or globals. */
export function includeConditionalArg(argType: Fields, args: Fields, globals: Fields): boolean {
	const condition = argType.if;
	if (!isPlainObject(condition)) return true;
	const { arg, global } = condition as { arg?: string; global?: string };
	if ((arg === undefined) === (global === undefined))
		throw new Error(`Invalid conditional value ${JSON.stringify(condition)}`);
	const value = arg !== undefined ? args[arg] : globals[global as string];
	const tests = ['eq', 'neq', 'exists', 'truthy'].filter((key) => key in condition);
	if (tests.length > 1) throw new Error(`Invalid conditional test ${JSON.stringify(condition)}`);
	if ('eq' in condition) return isEqual(value, condition.eq);
	if ('neq' in condition) return !isEqual(value, condition.neq);
	if ('exists' in condition) return (value !== undefined) === condition.exists;
	return (condition.truthy ?? true) ? Boolean(value) : !value;
}

function isEqual(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true;
	if (Array.isArray(left) && Array.isArray(right))
		return left.length === right.length && left.every((item, index) => isEqual(item, right[index]));
	if (isPlainObject(left) && isPlainObject(right)) {
		const keys = Object.keys(left);
		return (
			keys.length === Object.keys(right).length &&
			keys.every((key) => Object.hasOwn(right, key) && isEqual(left[key], right[key]))
		);
	}
	return false;
}

/** `prepareContext`: argTypes `mapping` applied, then conditional args removed. */
export function prepareArgs(args: Fields, argTypes: Fields, globals: Fields): Fields {
	const mapped: Fields = {};
	for (const [key, value] of Object.entries(args)) {
		const mapping = (argTypes[key] as Fields | undefined)?.mapping as Fields | undefined;
		const map = (item: unknown) =>
			mapping && typeof item === 'string' && item in mapping ? mapping[item] : item;
		mapped[key] = mapping ? (Array.isArray(value) ? value.map(map) : map(value)) : value;
	}
	const included: Fields = {};
	for (const [key, value] of Object.entries(mapped))
		if (includeConditionalArg((argTypes[key] as Fields | undefined) ?? {}, mapped, globals))
			included[key] = value;
	return included;
}

/** The effective globals: `globalTypes` defaults, then initial globals, then story globals. */
export function composeGlobals(
	project: Annotations,
	storyGlobals: Fields,
	runnerGlobals: Fields = {}
): Fields {
	const defaults: Fields = {};
	for (const [key, type] of Object.entries(project.globalTypes ?? {}))
		if (isPlainObject(type) && type.defaultValue !== undefined) defaults[key] = type.defaultValue;
	return {
		...defaults,
		...(project.initialGlobals ?? project.globals ?? {}),
		...runnerGlobals,
		...storyGlobals,
	};
}

/** The Vitest addon's default viewport and Storybook's minimal viewports. */
export const DEFAULT_VIEWPORT = { width: 1200, height: 900 } as const;
const MINIMAL_VIEWPORTS: Fields = {
	mobile1: { styles: { height: '568px', width: '320px' } },
	mobile2: { styles: { height: '896px', width: '414px' } },
	tablet: { styles: { height: '1112px', width: '834px' } },
	desktop: { styles: { height: '1024px', width: '1280px' } },
};

function dimension(value: unknown, axis: 'width' | 'height'): number {
	const text = String(value);
	const base = DEFAULT_VIEWPORT[axis];
	let match = /^(\d+)(px)?$/.exec(text);
	if (match) return Number.parseInt(match[1] as string, 10);
	match = /^(\d+(\.\d+)?)%$/.exec(text);
	if (match) return Math.round((base * Number(match[1])) / 100);
	match = /^(\d+(\.\d+)?)vw$/.exec(text);
	if (match) return Math.round((DEFAULT_VIEWPORT.width * Number(match[1])) / 100);
	match = /^(\d+(\.\d+)?)vh$/.exec(text);
	if (match) return Math.round((DEFAULT_VIEWPORT.height * Number(match[1])) / 100);
	match = /^(\d+)(em|rem)$/.exec(text);
	if (match) return Number.parseInt(match[1] as string, 10) * 16;
	throw new Error(`Unsupported viewport ${axis}: ${text}`);
}

/** The Vitest addon's `setViewport`: the browser size a story's test runs at. */
export function viewportFor(
	parameters: Fields,
	globals: Fields
): { width: number; height: number } {
	const options = (isPlainObject(parameters.viewport) ? parameters.viewport : {}) as Fields;
	const selected = (isPlainObject(globals.viewport) ? globals.viewport : {}) as Fields;
	const disabled = Boolean(options.disable || options.disabled);
	const key = disabled
		? undefined
		: selected.value
			? String(selected.value)
			: (options.defaultViewport as string | undefined);
	const viewports: Fields = {
		...MINIMAL_VIEWPORTS,
		...((options.viewports as Fields | undefined) ?? {}),
		...((options.options as Fields | undefined) ?? {}),
	};
	const styles =
		key && isPlainObject(viewports[key]) ? (viewports[key] as Fields).styles : undefined;
	if (isPlainObject(styles) && styles.width && styles.height)
		return { width: dimension(styles.width, 'width'), height: dimension(styles.height, 'height') };
	return { ...DEFAULT_VIEWPORT };
}

export interface ComposedStory {
	id: string;
	name: string;
	title: string;
	component?: string;
	/** Runtime tags: no `play-fn` or `manifest`, which only the index and the Vitest filter add. */
	tags: string[];
	parameters: Fields;
	argTypes: Fields;
	initialArgs: Fields;
	globals: Fields;
	storyGlobals: Fields;
	/** Innermost first, as `prepareStory` orders them. */
	decorators: Decorator[];
	render?: Render;
	play?: Play;
}

/** `preparePartialAnnotations` and `prepareStory` for one story, without enhancers. */
export function composeStory(input: {
	id: string;
	title: string;
	name: string;
	exportName: string;
	project: Annotations;
	meta: Annotations;
	story: Annotations | Render;
	runnerGlobals?: Fields;
}): ComposedStory {
	const { project, meta } = input;
	const story: Annotations = typeof input.story === 'function' ? {} : input.story;
	const storyFn = typeof input.story === 'function' ? input.story : undefined;
	const storyGlobals = { ...(meta.globals ?? {}), ...(story.globals ?? {}) };
	return {
		id: input.id,
		// The runtime name: `name`, then `storyName`, then the start-cased export name.
		name: (story.name as string | undefined) ?? story.storyName ?? input.name,
		title: input.title,
		...(typeof meta.component === 'string' ? { component: meta.component } : {}),
		tags: combineTags(
			'dev',
			'test',
			...array(project.tags),
			...array(meta.tags),
			...array(story.tags)
		),
		parameters: combineParameters(project.parameters, meta.parameters, story.parameters),
		argTypes: combineParameters(project.argTypes, meta.argTypes, story.argTypes),
		initialArgs: { ...(project.args ?? {}), ...(meta.args ?? {}), ...(story.args ?? {}) },
		globals: composeGlobals(project, storyGlobals, input.runnerGlobals),
		storyGlobals,
		decorators: [
			...array(story.decorators),
			...array(meta.decorators),
			...array(project.decorators),
		],
		...((storyFn ?? story.render ?? meta.render ?? project.render)
			? { render: (storyFn ?? story.render ?? meta.render ?? project.render) as Render }
			: {}),
		...((story.play ?? meta.play) ? { play: (story.play ?? meta.play) as Play } : {}),
	};
}

/**
 * `defaultDecorateStory`: each decorator receives the next story function. Calling it with an
 * update merges the update shallowly into one shared context, except the story's identity and
 * definitions (`sanitizeStoryContextUpdate`).
 */
export function decorate(
	render: (context: Fields) => unknown,
	decorators: Decorator[]
): (context: Fields) => unknown {
	const fixed = new Set([
		'componentId',
		'title',
		'kind',
		'id',
		'name',
		'story',
		'parameters',
		'initialArgs',
		'argTypes',
	]);
	const store: { value?: Fields } = {};
	const bind =
		(next: (context: Fields) => unknown) =>
		(update?: Fields): unknown => {
			if (!store.value) throw new Error('Decorated function called without init');
			const allowed = Object.fromEntries(
				Object.entries(update ?? {}).filter(([key]) => !fixed.has(key))
			);
			store.value = { ...store.value, ...allowed };
			return next(store.value);
		};
	const decorated = decorators.reduce<(context: Fields) => unknown>((inner, decorator) => {
		const bound = bind(inner);
		return (context) => decorator(bound, context);
	}, render);
	return (context) => {
		store.value = context;
		return decorated(context);
	};
}
