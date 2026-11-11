/**
 * CSF compatibility, in the page: a retained story composed, rendered, played and checked in
 * the order Storybook 10.6.2's Vitest addon runs it (`composeStory`, `runStory`, the a11y
 * addon's `afterEach`), so the two runners' outcomes can be compared. Storybook itself is
 * never imported here; the story's own imports, such as `storybook/test`, are the consumer's.
 */
import type { ElementContext, RunOptions, Spec } from 'axe-core';
import type { AxeFinding, NativeAccessibility, SpecimenContext, StoryOutcome } from '../types.js';
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
import type { PageError } from './page-errors.js';

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
	/** What the project itself sets `a11y.test` to, if anything, whatever a story does. */
	projectPolicy: string | null;
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
		projectPolicy: projectPolicy(project),
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

function projectPolicy(project: Annotations): string | null {
	const a11y = project.parameters?.a11y;
	const test = isPlainObject(a11y) ? (a11y as Fields).test : undefined;
	return typeof test === 'string' ? test : null;
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
			incompleteChecks: [],
			exceptions: [],
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
	const violations = result.violations.map((rule) => finding(rule, rule.nodes));
	return {
		status: violations.length ? (policy === 'todo' ? 'warning' : 'failed') : 'passed',
		policy,
		violations,
		incomplete: result.incomplete.length,
		incompleteChecks: result.incomplete.map((rule) => finding(rule, rule.nodes)),
		exceptions: [],
		engine: result.testEngine.version,
	};
}

/** One axe rule's result over some of its nodes. */
function finding(
	rule: { id: string; impact?: string | null; help: string },
	nodes: { target: unknown[]; failureSummary?: string }[]
): AxeFinding {
	return {
		id: rule.id,
		impact: rule.impact ?? null,
		help: rule.help,
		targets: nodes.map((node) => node.target.map(String).join(' ')),
		details: nodes.map((node) => node.failureSummary ?? ''),
	};
}

/** Whether `element` is `selector`'s match or inside one, through shadow roots. */
function withinTarget(element: Element | undefined, selector: string): boolean {
	let current: Element | null | undefined = element;
	while (current) {
		if (current.closest(selector)) return true;
		const root = current.getRootNode();
		current = root instanceof ShadowRoot ? root.host : null;
	}
	return false;
}

/** The check `specimen-a11y` runs on what is mounted now. */
export async function checkMountedStory(mounted: MountedStory): Promise<AccessibilityResult> {
	const resume = pauseAnimations();
	try {
		return await checkAccessibility(mounted.prepared.composed);
	} finally {
		resume();
	}
}

/**
 * A native specimen's check, over its mount root. An exception excuses only its rule on its
 * target, so a violation elsewhere still fails, and each exception reports what it excused.
 */
export async function checkNativeSpecimen(
	root: HTMLElement,
	declared: NativeAccessibility | undefined
): Promise<AccessibilityResult> {
	if (declared?.disabled)
		return {
			status: 'not-run',
			policy: 'disabled',
			reason: declared.disabled.reason,
			violations: [],
			incomplete: 0,
			incompleteChecks: [],
			exceptions: [],
		};
	const axe = axeEngine ?? (await loadAxe());
	const resume = pauseAnimations();
	try {
		axe.reset();
		axe.configure({ rules: [{ id: 'region', enabled: false }] } as unknown as Spec);
		const result = await axe.run(
			{ include: root } as unknown as ElementContext,
			{ elementRef: true } as RunOptions
		);
		const exceptions = (declared?.exceptions ?? []).map((exception) => ({
			...exception,
			matched: [] as string[],
		}));
		const violations: AxeFinding[] = [];
		for (const rule of result.violations) {
			const remaining = rule.nodes.filter((node) => {
				const target = node.target.map(String).join(' ');
				const excuses = exceptions.filter(
					(exception) =>
						exception.rule === rule.id &&
						withinTarget(node.element as Element | undefined, exception.target)
				);
				for (const exception of excuses) exception.matched.push(target);
				return excuses.length === 0;
			});
			if (remaining.length) violations.push(finding(rule, remaining));
		}
		return {
			status: violations.length ? 'failed' : 'passed',
			policy: 'error',
			violations,
			incomplete: result.incomplete.length,
			incompleteChecks: result.incomplete.map((rule) => finding(rule, rule.nodes)),
			exceptions,
			engine: result.testEngine.version,
		};
	} finally {
		resume();
	}
}

/**
 * The settled check, once the story has settled, added to its run: under the same policy, with
 * animations paused at their end. A play that failed leaves nothing to check.
 */
export async function checkSettledStory(
	mounted: MountedStory,
	outcome: StoryOutcome
): Promise<StoryOutcome> {
	if (outcome.play === 'ran' && outcome.failures.some((failure) => failure.category === 'play'))
		return { ...outcome, settled: { ...outcome.a11y, reason: 'the play failed' } };
	const failures = [...outcome.failures];
	let settled: AccessibilityResult;
	try {
		settled = await checkMountedStory(mounted);
	} catch (error) {
		settled = {
			status: 'failed',
			policy: accessibilityPolicy(mounted.prepared.composed),
			reason: message(error),
			violations: [],
			incomplete: 0,
			incompleteChecks: [],
			exceptions: [],
		};
		failures.push({
			category: 'settled-a11y',
			message: `The settled accessibility check failed: ${message(error)}`,
		});
	}
	if (settled.status === 'failed' && settled.violations.length)
		failures.push({
			category: 'settled-a11y',
			message: `Once settled: ${violationList(settled.violations)}`,
		});
	return { ...outcome, status: failures.length ? 'failed' : outcome.status, failures, settled };
}

function violationList(violations: AxeFinding[]): string {
	return violations
		.map((violation) => `${violation.help} (${violation.id}) at ${violation.targets.join(', ')}`)
		.join('; ');
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
					incompleteChecks: [],
					exceptions: [],
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
				incompleteChecks: [],
				exceptions: [],
			};
			failures.push({
				category: 'a11y',
				message: `The accessibility check failed: ${message(error)}`,
			});
		}
		if (a11y.status === 'failed' && a11y.violations.length)
			failures.push({
				category: 'a11y',
				message: violationList(a11y.violations),
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

function describeRaised(value: unknown): string {
	try {
		const { name, message } = Object(value) as { name?: unknown; message?: unknown };
		if (typeof message !== 'string') return String(value);
		return typeof name === 'string' && name !== 'Error' ? `${name}: ${message}` : message;
	} catch {
		return 'a value that cannot be printed';
	}
}

/** The run, failed by each distinct uncaught error or unhandled rejection the page raised. */
export function failOnPageErrors(
	outcome: StoryOutcome,
	raised: readonly PageError[]
): StoryOutcome {
	const messages = new Set(raised.map(([label, value]) => `${label}: ${describeRaised(value)}`));
	if (!messages.size) return outcome;
	return {
		...outcome,
		status: 'failed',
		failures: [
			...outcome.failures,
			...[...messages].map((message) => ({ category: 'error' as const, message })),
		],
	};
}
