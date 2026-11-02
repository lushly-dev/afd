/**
 * CSF compatibility, in the page: a retained story composed, rendered, played and checked in
 * the order Storybook 10.6.2's Vitest addon runs it (`composeStory`, `runStory`, the a11y
 * addon's `afterEach`), so the two runners' outcomes can be compared. Storybook itself is
 * never imported here; the story's own imports, such as `storybook/test`, are the consumer's.
 */
import type { ElementContext, RunOptions, Spec } from 'axe-core';
import type { SpecimenContext, StoryOutcome } from '../types.js';
import {
	type Annotations,
	type ComposedStory,
	combineParameters,
	composeStory,
	decorate,
	isPlainObject,
	prepareArgs,
	type Render,
	unsupportedFields,
	viewportFor,
} from './csf.js';

type Fields = Record<string, unknown>;
export interface StoryModule {
	default?: Annotations;
	[exportName: string]: unknown;
}
export interface StoryIdentity {
	id: string;
	title: string;
	name: string;
	exportName: string;
}

/**
 * What Storybook's web-components renderer and the a11y addon contribute in a Vitest run,
 * before the project's own preview: the default a11y policy and initial globals.
 */
const STORYBOOK_DEFAULTS: Annotations = {
	parameters: { renderer: 'web-components', a11y: { test: 'todo' } },
	initialGlobals: {
		a11y: { manual: false },
		viewport: { value: undefined, isRotated: false },
		backgrounds: { value: undefined, grid: false },
	},
};

/** `composeConfigs` over Storybook's defaults and the project's preview. */
export function projectAnnotations(preview: StoryModule | undefined): Annotations {
	const own = (preview?.default ?? {}) as Annotations;
	return {
		...own,
		parameters: combineParameters(STORYBOOK_DEFAULTS.parameters, own.parameters),
		initialGlobals: { ...STORYBOOK_DEFAULTS.initialGlobals, ...(own.initialGlobals ?? {}) },
	};
}

/** The web-components renderer's event argTypes from the custom elements manifest. */
function eventActions(component: string | undefined): string[] {
	const manifest = (globalThis as { __STORYBOOK_CUSTOM_ELEMENTS_MANIFEST__?: unknown })
		.__STORYBOOK_CUSTOM_ELEMENTS_MANIFEST__ as
		| { modules?: { declarations?: { tagName?: string; events?: { name?: string }[] }[] }[] }
		| undefined;
	if (!component || !Array.isArray(manifest?.modules)) return [];
	let declaration: { events?: { name?: string }[] } | undefined;
	for (const module of manifest.modules)
		for (const candidate of module.declarations ?? [])
			if (candidate.tagName === component) declaration = candidate;
	return (declaration?.events ?? [])
		.filter((event) => typeof event?.name === 'string' && event.name)
		.map((event) => {
			const name = (event.name as string)
				.replace(/(-|_|:|\.|\s)+(.)?/g, (_match, _separator, chr?: string) =>
					chr ? chr.toUpperCase() : ''
				)
				.replace(/^([A-Z])/, (match) => match.toLowerCase());
			return `on${name.charAt(0).toUpperCase()}${name.slice(1)}`;
		});
}

/** The destructured fields of a function's first parameter, as Storybook's `getUsedProps` reads them. */
export function destructuredFields(fn: unknown): string[] {
	if (typeof fn !== 'function') return [];
	const match = /[^(]*\(([^)]*)/.exec(fn.toString());
	const first = match?.[1]?.trim() ?? '';
	if (!first.startsWith('{')) return [];
	const end = first.lastIndexOf('}');
	return first
		.slice(1, end < 0 ? undefined : end)
		.replace(/\s/g, '')
		.split(',')
		.map((field) => field.replace(/:.*|=.*/g, '').replace(/^\.\.\./, ''))
		.filter(Boolean);
}

export interface PreparedStory {
	composed: ComposedStory;
	args: Fields;
	viewport: { width: number; height: number };
	/** Storybook features the story uses that this runtime does not reproduce. */
	unsupported: string[];
	/** Where the story's requested context and what Storybook gives it differ. */
	mismatches: string[];
	/** Calls made to action args, in order. */
	actions: { name: string; args: unknown[] }[];
}

const CONTEXT_THEMES = new Set(['light', 'dark', 'high-contrast']);

/** The viewport names a story's parameters define, with Storybook's minimal ones. */
function viewportNames(parameters: Fields): Set<string> {
	const options = (isPlainObject(parameters.viewport) ? parameters.viewport : {}) as Fields;
	return new Set([
		'mobile1',
		'mobile2',
		'tablet',
		'desktop',
		...Object.keys((options.viewports as Fields | undefined) ?? {}),
		...Object.keys((options.options as Fields | undefined) ?? {}),
	]);
}

/** The values a global's toolbar offers, when the project declares them. */
function globalValues(project: Annotations, name: string): Set<unknown> | undefined {
	const type = project.globalTypes?.[name];
	const items = isPlainObject(type) && isPlainObject(type.toolbar) ? type.toolbar.items : undefined;
	if (!Array.isArray(items)) return undefined;
	return new Set(items.map((item) => (isPlainObject(item) ? item.value : item)));
}

/** Compose one story and settle its args, globals and viewport before anything renders. */
export function prepareStory(
	identity: StoryIdentity,
	preview: StoryModule | undefined,
	module: StoryModule,
	requested: Partial<SpecimenContext>
): PreparedStory {
	const project = projectAnnotations(preview);
	const meta = (module.default ?? {}) as Annotations;
	const story = module[identity.exportName];
	if (story === undefined)
		throw new Error(`${identity.id}: the module has no export '${identity.exportName}'.`);
	if (typeof story !== 'function' && !isPlainObject(story))
		throw new Error(`${identity.id}: a story must be an object or a function.`);
	const unsupported = [
		...unsupportedFields('project', preview?.default ?? {}).map((field) => `project.${field}`),
		...unsupportedFields('meta', meta).map((field) => `meta.${field}`),
		...(typeof story === 'function'
			? []
			: unsupportedFields('story', story).map((field) => `story.${field}`)),
	];
	const composed = composeStory({
		...identity,
		project,
		meta,
		story: story as Annotations | Render,
	});
	const play = composed.play;
	for (const field of destructuredFields(play))
		if (['mount', 'canvas', 'userEvent'].includes(field))
			unsupported.push(`play context \`${field}\``);
	const mismatches: string[] = [];
	// A requested theme selects the project's theme global, as its toolbar would.
	if (requested.theme !== undefined && project.globalTypes?.theme !== undefined)
		composed.globals = { ...composed.globals, theme: requested.theme };
	const themes = globalValues(project, 'theme');
	if (themes && composed.globals.theme !== undefined && !themes.has(composed.globals.theme))
		mismatches.push(
			`Context mismatch: the theme global is ${JSON.stringify(composed.globals.theme)}, which the project's theme toolbar does not offer.`
		);
	const selected = isPlainObject(composed.globals.viewport)
		? composed.globals.viewport.value
		: undefined;
	if (typeof selected === 'string' && !viewportNames(composed.parameters).has(selected))
		mismatches.push(
			`Context mismatch: the story selects viewport '${selected}', which no viewport option defines; it renders at the default size, as Storybook does.`
		);
	const actions: PreparedStory['actions'] = [];
	const action =
		(name: string) =>
		(...args: unknown[]) => {
			actions.push({ name, args });
		};
	const initialArgs = { ...composed.initialArgs };
	const disabled =
		isPlainObject(composed.parameters.actions) && Boolean(composed.parameters.actions.disable);
	if (!disabled) {
		for (const [name, argType] of Object.entries(composed.argTypes))
			if (isPlainObject(argType) && argType.action && !(name in initialArgs))
				initialArgs[name] = action(typeof argType.action === 'string' ? argType.action : name);
		for (const name of eventActions(composed.component))
			if (!(name in initialArgs)) initialArgs[name] = action(name);
	}
	composed.initialArgs = initialArgs;
	return {
		composed,
		args: prepareArgs(initialArgs, composed.argTypes, composed.globals),
		viewport: viewportFor(composed.parameters, composed.globals),
		unsupported,
		mismatches,
		actions,
	};
}

/**
 * The compatibility context provider: what a retained story renders in. Viewport and theme
 * come from the story, as the Vitest addon and the project's decorators settle them, unless
 * the request names them; media keep the browser's defaults.
 */
export function storyRenderContext(
	prepared: PreparedStory,
	requested: Partial<SpecimenContext>,
	defaults: SpecimenContext
): SpecimenContext {
	const theme = prepared.composed.globals.theme;
	return {
		...defaults,
		...requested,
		viewport: requested.viewport ?? prepared.viewport,
		theme:
			typeof theme === 'string' && CONTEXT_THEMES.has(theme)
				? (theme as SpecimenContext['theme'])
				: (requested.theme ?? defaults.theme),
		themeMedia: 'browser-default',
	};
}

/** The web-components renderer's default render: args as properties of `component`. */
function defaultRender(args: Fields, context: Fields): unknown {
	const component = context.component;
	if (typeof component !== 'string')
		throw new Error(
			`Unable to render story ${String(context.id)} as the component annotation is missing from the default export`
		);
	const element = document.createElement(component);
	for (const [key, value] of Object.entries(args)) Reflect.set(element, key, value);
	return element;
}

/** `renderToCanvas` for web components: a node replaces the canvas content; a string is HTML. */
function renderToCanvas(result: unknown, canvas: HTMLElement, story: ComposedStory): void {
	if (result instanceof Node) {
		if (canvas.firstChild !== result) canvas.replaceChildren(result);
		document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true, cancelable: true }));
		return;
	}
	if (typeof result === 'string') {
		canvas.innerHTML = result;
		if (canvas.querySelector('script'))
			throw new Error(
				`${story.id}: the story's HTML contains a <script>; compatibility mode does not run story scripts.`
			);
		document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true, cancelable: true }));
		return;
	}
	if (isPlainObject(result) && '_$litType$' in result)
		throw new Error(
			`${story.id}: the story returns a lit template; compatibility mode renders stories that return a node or an HTML string.`
		);
	throw new Error(
		`Expecting an HTML snippet or DOM node from the story: "${story.name}" of "${story.title}".`
	);
}

/** The context a render, decorator or play receives (`initializeContext`). */
function playContext(
	prepared: PreparedStory,
	canvasElement: HTMLElement,
	signal: AbortSignal
): Fields {
	const { composed } = prepared;
	const context: Fields = {
		id: composed.id,
		name: composed.name,
		story: composed.name,
		title: composed.title,
		kind: composed.title,
		componentId: composed.id.split('--')[0],
		component: composed.component,
		tags: composed.tags,
		parameters: composed.parameters,
		initialArgs: composed.initialArgs,
		args: prepared.args,
		unmappedArgs: { ...composed.initialArgs },
		argTypes: composed.argTypes,
		globals: composed.globals,
		storyGlobals: composed.storyGlobals,
		loaded: {},
		viewMode: 'story',
		abortSignal: signal,
		canvasElement,
	};
	context.step = (_label: string, play: (context: Fields) => unknown) => play(context);
	context.mount = async () => {
		throw new Error('The play function must destructure `mount` to call it.');
	};
	context.context = context;
	return context;
}

export interface MountedStory {
	prepared: PreparedStory;
	context: Fields;
}

/** Render the composed story into the canvas through its decorators. */
export function mountStory(
	prepared: PreparedStory,
	canvas: HTMLElement,
	signal: AbortSignal
): MountedStory {
	if (prepared.unsupported.length)
		throw new Error(
			`${prepared.composed.id} uses what compatibility mode does not run: ${prepared.unsupported.join(', ')}.`
		);
	const context = playContext(prepared, canvas, signal);
	const render = prepared.composed.render ?? defaultRender;
	const storyFn = decorate(
		(current) => render(current.args as Fields, current),
		prepared.composed.decorators
	);
	renderToCanvas(storyFn(context), canvas, prepared.composed);
	return { prepared, context };
}

/** `pauseAnimations`, applied between the play and the accessibility check in a test run. */
function pauseAnimations(): () => void {
	const stop = document.createElement('style');
	stop.textContent = '*,*:before,*:after{animation:none!important}';
	const pause = document.createElement('style');
	pause.textContent =
		'*,*:before,*:after{animation-delay:0s!important;animation-direction:reverse!important;animation-play-state:paused!important;transition:none!important}';
	document.head.append(stop, pause);
	void document.body.clientHeight;
	stop.remove();
	return () => pause.remove();
}

type AccessibilityResult = StoryOutcome['a11y'];

function message(error: unknown): string {
	if (error instanceof Error)
		return `${error.name === 'Error' ? '' : `${error.name}: `}${error.message}`;
	return String(error);
}

/** The a11y addon's effective policy for a story. */
function accessibilityPolicy(composed: ComposedStory): AccessibilityResult['policy'] {
	const parameter = (
		isPlainObject(composed.parameters.a11y) ? composed.parameters.a11y : {}
	) as Fields;
	const globals = (isPlainObject(composed.globals.a11y) ? composed.globals.a11y : {}) as Fields;
	if (parameter.disable === true) return 'disabled';
	if (globals.manual === true) return 'manual';
	if (parameter.test === 'off') return 'off';
	return parameter.test === 'todo' ? 'todo' : 'error';
}

/** The a11y addon's axe run: the whole body, `region` disabled, the story's config and options. */
const loadAxe = async () => (await import('axe-core')).default;
let axeEngine: Awaited<ReturnType<typeof loadAxe>> | undefined;

/**
 * Load axe before the story renders when its policy runs a check. A dynamic import always yields
 * a task, and a real fetch takes long enough for a frame, so importing it after the render would
 * let a component that renders on its next frame update before the check. Storybook's runner has
 * the module already loaded for all but a file's first story.
 */
export async function prepareAccessibility(prepared: PreparedStory): Promise<void> {
	const policy = accessibilityPolicy(prepared.composed);
	if (policy === 'error' || policy === 'todo') axeEngine = await loadAxe();
}

async function checkAccessibility(composed: ComposedStory): Promise<AccessibilityResult> {
	const parameter = (
		isPlainObject(composed.parameters.a11y) ? composed.parameters.a11y : {}
	) as Fields;
	const policy = accessibilityPolicy(composed);
	if (policy === 'disabled' || policy === 'manual' || policy === 'off')
		return {
			status: 'not-run',
			policy,
			reason: `parameters.a11y ${policy}`,
			violations: [],
			incomplete: 0,
		};
	if (parameter.element !== undefined)
		throw new Error('parameters.a11y.element is not supported; use parameters.a11y.context.');
	const axe = axeEngine ?? (await loadAxe());
	const context: Fields = {
		include: document.body,
		exclude: ['.sb-wrapper', '#storybook-docs', '#storybook-highlights-root'],
	};
	const given = parameter.context;
	if (isPlainObject(given) && ('include' in given || 'exclude' in given)) {
		if ('include' in given) context.include = given.include;
		if ('exclude' in given)
			context.exclude = [...(context.exclude as string[]), ...[given.exclude].flat()];
	} else if (given !== undefined) context.include = given;
	const config = (isPlainObject(parameter.config) ? parameter.config : {}) as Fields;
	const rules = [
		{ id: 'region', enabled: false },
		...((config.rules as Fields[] | undefined) ?? []),
	];
	axe.reset();
	axe.configure({ ...config, rules } as unknown as Spec);
	const options = { ...((isPlainObject(parameter.options) ? parameter.options : {}) as Fields) };
	if (options.runOnly) {
		const disabled: Fields = {};
		for (const rule of rules)
			if (rule.enabled === false) disabled[rule.id as string] = { enabled: false };
			else delete disabled[rule.id as string];
		options.rules = { ...disabled, ...((options.rules as Fields | undefined) ?? {}) };
	}
	const result = await axe.run(context as unknown as ElementContext, options as RunOptions);
	const violations = result.violations.map((violation) => ({
		id: violation.id,
		impact: violation.impact ?? null,
		help: violation.help,
		targets: violation.nodes.map((node) => node.target.map(String).join(' ')),
		details: violation.nodes.map((node) => node.failureSummary ?? ''),
	}));
	return {
		status: violations.length ? (policy === 'todo' ? 'warning' : 'failed') : 'passed',
		policy,
		violations,
		incomplete: result.incomplete.length,
		engine: result.testEngine.version,
	};
}

/**
 * `runStory` after the mount: the play, then paused animations and the accessibility check.
 * A play that throws ends the run before the check, as an `afterEach` is skipped.
 */
export async function runStory(mounted: MountedStory): Promise<StoryOutcome> {
	const { prepared, context } = mounted;
	const play = prepared.composed.play;
	const failures: StoryOutcome['failures'] = [];
	const stage = (name: 'play' | 'accessibility') => {
		// Read by the host if this run reaches its deadline.
		(globalThis as { __specimenStage?: string }).__specimenStage = name;
	};
	stage('play');
	if (play) {
		try {
			await play(context);
		} catch (error) {
			failures.push({ category: 'play', message: message(error) });
			return {
				status: 'failed',
				play: 'ran',
				failures,
				a11y: {
					status: 'not-run',
					policy: accessibilityPolicy(prepared.composed),
					reason: 'the play failed',
					violations: [],
					incomplete: 0,
				},
			};
		}
	}
	stage('accessibility');
	const resume = pauseAnimations();
	try {
		let a11y: AccessibilityResult;
		try {
			a11y = await checkAccessibility(prepared.composed);
		} catch (error) {
			// The addon reports a failed check as a failed a11y result and fails the test.
			a11y = {
				status: 'failed',
				policy: accessibilityPolicy(prepared.composed),
				reason: message(error),
				violations: [],
				incomplete: 0,
			};
			failures.push({
				category: 'a11y',
				message: `The accessibility check failed: ${message(error)}`,
			});
		}
		if (a11y.status === 'failed' && a11y.violations.length)
			failures.push({
				category: 'a11y',
				message: a11y.violations
					.map(
						(violation) => `${violation.help} (${violation.id}) at ${violation.targets.join(', ')}`
					)
					.join('; '),
			});
		return {
			status: failures.length ? 'failed' : 'passed',
			play: play ? 'ran' : 'none',
			failures,
			a11y,
		};
	} finally {
		resume();
	}
}
