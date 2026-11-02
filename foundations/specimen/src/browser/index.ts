import { RANDOM_SEED } from '../baseline.js';
import { normalizeDom } from '../normalize.js';
import type {
	BrowserObservation,
	EventDeclaration,
	InspectResult,
	MountHandle,
	NativeAccessibility,
	ScenarioStep,
	SpecimenContext,
	SpecimenEntry,
	SpecimenModule,
	Target,
} from '../types.js';
import { captureDocument, colorSchemeOf, contextMismatches, openElements } from './capture.js';
import { type EventRecorder, recordEvents } from './events.js';
import { installInstrumentation } from './instrumentation.js';
import { locate } from './locate.js';
import { describe, enrichSchema, type InstalledPlugins, installPlugins } from './plugins.js';
import type { MountedStory, PreparedStory, StoryModule } from './story-runtime.js';
import { validateSpecimen } from './validate.js';

/**
 * Let a component's pending promises settle, as the awaits in Storybook's render phases do before
 * a play. Microtask turns only: any task would let a frame that is already due run first, and a
 * component that renders on its next frame would be ahead of where Storybook's play finds it.
 */
async function afterMicrotasks(): Promise<void> {
	for (let turn = 0; turn < 32; turn++) await null;
}

/** The first contentful paint, waiting briefly for one; `null` when nothing painted. */
function firstContentfulPaint(): Promise<number | null> {
	const read = () => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null;
	const painted = read();
	if (painted !== null) return Promise.resolve(painted);
	return new Promise((resolve) => {
		const finish = () => {
			observer.disconnect();
			clearTimeout(limit);
			resolve(read());
		};
		// `first-paint` arrives first and says nothing about content, so wait for the one asked for.
		const observer = new PerformanceObserver(() => {
			if (read() !== null) finish();
		});
		observer.observe({ type: 'paint' });
		const limit = setTimeout(finish, 2000);
	});
}

/** How long a retained story waits for its custom elements to be defined before capture. */
const UNDEFINED_ELEMENT_GRACE_MS = 250;

export { installPage } from './page.js';

type Disposer = () => void | Promise<void>;

/** Retained stories' runtime, loaded on first use so native pages do not carry it. */
const storyRuntime = () => import('./story-runtime.js');

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isElement(value: unknown): value is HTMLElement {
	return value instanceof HTMLElement;
}

function toHandle(value: unknown): MountHandle {
	if (isElement(value)) return { element: value };
	if (isRecord(value) && isElement(value.element)) {
		for (const field of Object.keys(value)) {
			if (!['element', 'ready', 'dispose'].includes(field)) {
				throw new Error(`Unsupported mount handle field '${field}'.`);
			}
		}
		if (value.ready !== undefined && !(value.ready instanceof Promise)) {
			throw new Error('Mount handle ready must be a Promise.');
		}
		if (value.dispose !== undefined && typeof value.dispose !== 'function') {
			throw new Error('Mount handle dispose must be a function.');
		}
		return {
			element: value.element,
			ready: value.ready as Promise<void> | undefined,
			dispose: value.dispose as Disposer | undefined,
		};
	}
	throw new Error('A specimen renderer must return an HTMLElement or a mount handle.');
}

/**
 * Start `Math.random` from a fixed seed (mulberry32). A framework may draw a marker from it once
 * per page, as FAST does, and an unchanged component should serialize the same way twice.
 */
function seedRandom(seed: number): void {
	let state = seed;
	Math.random = () => {
		state = (state + 0x6d2b79f5) | 0;
		let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
		mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
		return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
	};
}

/** Install before specimen imports so closed roots and motion have an explicit scope. */
export function installRuntime(loaders: Record<string, () => Promise<SpecimenModule>>): void {
	if (window.__specimen) throw new Error('The Specimens runtime is already installed.');
	seedRandom(RANDOM_SEED);
	const instrumentation = installInstrumentation();
	const root = document.querySelector<HTMLElement>('#specimen-root');
	if (!root) throw new Error('The bench page must contain #specimen-root.');
	let mountRoot = root;
	let active = false;
	// A retained story, between resolve, mount and run.
	let story: { prepared: PreparedStory; mounted?: MountedStory } | undefined;
	const abort = new AbortController();
	// Installed once, before any specimen or story module loads.
	let installed: Promise<InstalledPlugins> | undefined;
	const plugins = () => {
		installed ??= installPlugins(loaders).then((registry) => {
			installedPlugins = registry.plugins.map(({ id, version }) => ({
				id,
				version: version ?? null,
			}));
			return registry;
		});
		return installed;
	};

	/** Load a retained story's module and preview after the plugins, and compose it. */
	async function prepareRetained(
		entry: SpecimenEntry,
		requestedContext: Partial<SpecimenContext>
	): Promise<PreparedStory> {
		await plugins();
		const load = loaders[entry.id];
		if (!load || !entry.story) throw new Error(`No specimen module is registered for ${entry.id}.`);
		const preview = loaders.$preview;
		const [module, project] = await Promise.all([load(), preview?.()]);
		const { prepareStory } = await storyRuntime();
		return prepareStory(
			{ id: entry.id, title: entry.title, name: entry.story.name, exportName: entry.exportName },
			project as StoryModule | undefined,
			module as StoryModule,
			requestedContext
		);
	}
	let motion: 'natural' | 'settled' = 'natural';
	let requested: SpecimenContext | undefined;
	const disposers: Disposer[] = [];

	async function dispose(): Promise<void> {
		const errors: unknown[] = [];
		for (const disposer of disposers.splice(0).reverse()) {
			try {
				await disposer();
			} catch (error) {
				errors.push(error);
			}
		}
		mountRoot.replaceChildren();
		instrumentation.setMotionMode('natural');
		requested = undefined;
		nativeAccessibility = undefined;
		eventRecorder = undefined;
		active = false;
		if (errors.length) {
			const details = errors
				.map((error) => (error instanceof Error ? error.message : String(error)))
				.join('; ');
			throw new AggregateError(errors, `Specimen disposal failed: ${details}`);
		}
	}

	function applyContext(context: SpecimenContext): void {
		const html = document.documentElement;
		const previousHtmlStyle = html.style.cssText;
		const previousLang = html.getAttribute('lang');
		const previousTheme = html.getAttribute('data-specimen-theme');
		const previousRootStyle = mountRoot.style.cssText;
		const headNodes = new Set(document.head.childNodes);
		const bodyNodes = new Set(document.body.childNodes);
		disposers.push(() => {
			html.style.cssText = previousHtmlStyle;
			if (previousLang === null) html.removeAttribute('lang');
			else html.lang = previousLang;
			if (previousTheme === null) html.removeAttribute('data-specimen-theme');
			else html.dataset.specimenTheme = previousTheme;
			mountRoot.style.cssText = previousRootStyle;
			for (const node of Array.from(document.head.childNodes))
				if (!headNodes.has(node)) node.remove();
			for (const node of Array.from(document.body.childNodes))
				if (!bodyNodes.has(node)) node.remove();
		});
		html.lang = context.locale;
		html.style.colorScheme = colorSchemeOf(context.theme);
		html.dataset.specimenTheme = context.theme;
		if (context.container) {
			mountRoot.style.width = `${context.container.width}px`;
			if (context.container.height !== undefined)
				mountRoot.style.height = `${context.container.height}px`;
		}
		motion = context.motion;
		requested = context;
		instrumentation.setMotionMode(motion);
	}

	/** Upgrade, fonts and a frame: the native readiness contract. */
	/** The mounted native specimen's declared events, when it has any. */
	let eventRecorder: EventRecorder | undefined;
	/** The mounted native specimen's accessibility policy. */
	let nativeAccessibility: NativeAccessibility | undefined;
	/** Tags a retained story still had undefined when it settled. */
	const undefinedTags = new Set<string>();
	/** Whether the mounted native specimen declared a ready hook. */
	let readyHook = false;
	/** The installed plugins, once something has asked for them. */
	let installedPlugins: BrowserObservation['plugins'] = [];

	async function settle(): Promise<void> {
		const tags = new Set<string>();
		for (const element of openElements(mountRoot)) {
			if (element.localName.includes('-')) tags.add(element.localName);
		}
		const defined = Promise.all([...tags].map((tag) => customElements.whenDefined(tag)));
		if (story) {
			// A component may define an element only on intent, such as opening a disclosure, so a
			// story can hold a tag that stays undefined. Storybook does not wait for one either.
			await Promise.race([
				defined,
				new Promise((resolve) => setTimeout(resolve, UNDEFINED_ELEMENT_GRACE_MS)),
			]);
			for (const tag of tags) if (!customElements.get(tag)) undefinedTags.add(tag);
		} else await defined;
		instrumentation.setMotionMode(motion);
		await document.fonts.ready;
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	}

	/**
	 * A retained story renders into a plain `div` in the body, as Storybook's runner gives it
	 * a canvas, and the page sets no theme, language or color scheme of its own: the
	 * project's decorators do that.
	 */
	async function mountRetained(
		entry: SpecimenEntry,
		context: SpecimenContext,
		options: { settle?: boolean }
	): Promise<{
		targets: Record<string, Target>;
		scenario: ScenarioStep[];
		events: EventDeclaration[];
	}> {
		if (!story) throw new Error(`Resolve ${entry.id} before mounting it.`);
		if (mountRoot.localName !== 'div') {
			const canvas = document.createElement('div');
			canvas.id = mountRoot.id;
			mountRoot.replaceWith(canvas);
			mountRoot = canvas;
		}
		requested = context;
		motion = context.motion;
		instrumentation.setMotionMode(motion);
		if (context.container) {
			mountRoot.style.width = `${context.container.width}px`;
			if (context.container.height !== undefined)
				mountRoot.style.height = `${context.container.height}px`;
		}
		const { mountStory } = await storyRuntime();
		story.mounted = mountStory(story.prepared, mountRoot, abort.signal);
		if (options.settle !== false) await settle();
		return { targets: {}, scenario: [], events: [] };
	}

	window.__specimen = {
		async resolve(entry, requestedContext, defaults, options = {}) {
			if (!entry.story) return null;
			const prepared = await prepareRetained(entry, requestedContext);
			const { prepareAccessibility, storyRenderContext } = await storyRuntime();
			// Only a run has a check to prepare for; a profile at mount should not count axe's bytes.
			if (options.check) await prepareAccessibility(prepared);
			story = { prepared };
			return {
				context: storyRenderContext(prepared, requestedContext, defaults),
				limitations: prepared.mismatches,
			};
		},
		async inspect(entry, requestedContext, defaults, manifestSchema) {
			const registry = await plugins();
			const limitations: string[] = [];
			let component: string | undefined;
			let args: Record<string, unknown>;
			let context: SpecimenContext;
			let composed: InspectResult['story'];
			if (entry.story) {
				const prepared = await prepareRetained(entry, requestedContext);
				const { storyRenderContext } = await storyRuntime();
				const { composed: annotations } = prepared;
				component = annotations.component;
				args = prepared.args;
				context = storyRenderContext(prepared, requestedContext, defaults);
				limitations.push(...prepared.mismatches);
				composed = {
					name: annotations.name,
					tags: annotations.tags,
					globals: describe(annotations.globals) as Record<string, unknown>,
					parameters: describe(annotations.parameters) as Record<string, unknown>,
					play: Boolean(annotations.play),
					decorators: annotations.decorators.length,
					render: annotations.renderSource,
					unsupported: prepared.unsupported,
				};
			} else {
				const load = loaders[entry.id];
				if (!load) throw new Error(`No specimen module is registered for ${entry.id}.`);
				const { meta, specimen } = validateSpecimen(await load(), entry.exportName);
				component = entry.component ?? meta.component;
				args = { ...meta.args, ...specimen.args };
				context = { ...defaults, ...requestedContext } as SpecimenContext;
			}
			// The module has loaded, so the component's definition is registered for schema sources.
			const schema = component
				? await enrichSchema(registry, component, manifestSchema ?? undefined)
				: undefined;
			if (component && !schema)
				limitations.push(
					`No schema source describes ${component}: its properties, slots and events are unknown.`
				);
			return {
				id: entry.id,
				component: component ?? null,
				schema: schema ?? null,
				args: describe(args) as Record<string, unknown>,
				context,
				...(composed ? { story: composed } : {}),
				limitations,
				plugins: registry.plugins.map((plugin) => ({
					id: plugin.id,
					runners: Object.keys(plugin.runners ?? {}),
					themes: Object.keys(plugin.themes ?? {}),
					tokens: plugin.tokens ? `${plugin.tokens.id}@${plugin.tokens.version}` : null,
				})),
			};
		},
		async command(element, runner, name, input) {
			const registered = (await plugins()).runners.get(runner);
			if (!registered) throw new Error(`No command runner '${runner}' is registered.`);
			return registered.runner.run(element, name, input);
		},
		bindEventTarget(name, element) {
			eventRecorder?.bind(name, element);
		},
		stepStarted(id) {
			eventRecorder?.stepStarted(id);
		},
		async expectEvent(expectation) {
			if (!eventRecorder) throw new Error('This specimen declares no events to expect.');
			await eventRecorder.expect(expectation);
		},
		async profileMetrics() {
			const readyMs = performance.now();
			const firstContentfulPaintMs = await firstContentfulPaint();
			const navigation = performance.getEntriesByType('navigation')[0] as
				| PerformanceNavigationTiming
				| undefined;
			const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
			const tree = { totalElements: 0, customElements: 0, shadowHosts: 0 };
			const roots: ParentNode[] = [document];
			for (const root of roots)
				for (const element of root.querySelectorAll('*')) {
					tree.totalElements += 1;
					if (element.localName.includes('-')) tree.customElements += 1;
					if (element.shadowRoot) {
						tree.shadowHosts += 1;
						roots.push(element.shadowRoot);
					}
				}
			return {
				readyMs,
				firstContentfulPaintMs,
				domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? 0,
				loadMs: navigation?.loadEventEnd ?? 0,
				...tree,
				requestCount: resources.length,
				transferSizeBytes: resources.reduce((sum, entry) => sum + entry.transferSize, 0),
			};
		},
		async checkAccessibility() {
			const runtime = await storyRuntime();
			if (story?.mounted) return runtime.checkMountedStory(story.mounted);
			if (!active) throw new Error('Mount a specimen before checking it.');
			return runtime.checkNativeSpecimen(mountRoot, nativeAccessibility);
		},
		async mountAndRun(entry, context) {
			// One chain with no frame between the render and the play and no import after the
			// render, as Storybook's runner has it: a play and an accessibility check see a
			// component that renders on its next frame as Storybook does. The frame comes after.
			if (active)
				throw new Error('A specimen is already mounted; dispose it before mounting another.');
			active = true;
			const { runStory } = await storyRuntime();
			await mountRetained(entry, context, { settle: false });
			if (!story?.mounted) throw new Error('A retained story did not mount.');
			await afterMicrotasks();
			const outcome = await runStory(story.mounted);
			await settle();
			return outcome;
		},
		async mount(entry, context) {
			if (active)
				throw new Error('A specimen is already mounted; dispose it before mounting another.');
			const load = loaders[entry.id];
			if (!load) throw new Error(`No specimen module is registered for ${entry.id}.`);
			active = true;
			if (entry.story) {
				try {
					return await mountRetained(entry, context, {});
				} catch (error) {
					active = false;
					throw error;
				}
			}
			applyContext(context);
			try {
				const registry = await plugins();
				const theme = registry.themes.get(context.theme);
				if (theme) {
					const undo = theme.preset({ document, root: mountRoot });
					if (typeof undo === 'function') disposers.push(undo as Disposer);
				}
				const module = await load();
				const { meta, specimen } = validateSpecimen(module, entry.exportName);
				nativeAccessibility = specimen.a11y;
				if (specimen.events?.length) {
					// Before the specimen exists, so that nothing it does while mounting is missed.
					const recorder = recordEvents(mountRoot, specimen.events);
					eventRecorder = recorder;
					disposers.push(() => recorder.dispose());
				}
				for (const step of specimen.scenario ?? [])
					if ('command' in step && !registry.runners.has(step.command.runner))
						throw new Error(
							`Scenario step${step.id ? ` '${step.id}'` : ''} names command runner '${step.command.runner}', which no plugin registers${registry.runners.size ? `; the plugins register ${[...registry.runners.keys()].join(', ')}` : ''}.`
						);
				const args = { ...meta.args, ...specimen.args };
				if (specimen.dispose) disposers.push(specimen.dispose);
				const render = specimen.render ?? meta.render;
				let handle: MountHandle;
				if (render) {
					handle = toHandle(await render(args));
				} else {
					const component = entry.component ?? meta.component;
					if (!component) throw new Error('A specimen needs a component tag or a render function.');
					const element = document.createElement(component);
					for (const [key, value] of Object.entries(args)) {
						if (['__proto__', 'prototype', 'constructor'].includes(key))
							throw new Error(`Reserved argument: ${key}.`);
						Reflect.set(element, key, value);
					}
					handle = { element };
				}
				if (handle.dispose) disposers.push(handle.dispose);
				if (handle.dispose && specimen.dispose)
					throw new Error('Declare disposal on the mount handle or specimen, not both.');
				if (handle.ready && specimen.ready)
					throw new Error('Declare readiness on the mount handle or specimen, not both.');
				mountRoot.append(handle.element);
				for (const element of openElements(mountRoot)) {
					if (element.localName.includes('-')) await customElements.whenDefined(element.localName);
				}
				readyHook = handle.ready !== undefined || specimen.ready !== undefined;
				await handle.ready;
				await specimen.ready?.();
				await settle();
				return {
					targets: specimen.targets ?? {},
					scenario: specimen.scenario ?? [],
					events: specimen.events ?? [],
				};
			} catch (error) {
				try {
					await dispose();
				} catch (cleanupError) {
					throw new AggregateError(
						[error, cleanupError],
						`Specimen mount and disposal failed: ${String(error)}; ${String(cleanupError)}`
					);
				}
				throw error;
			}
		},
		capture() {
			if (!active) throw new Error('Mount a specimen before capturing it.');
			instrumentation.setMotionMode(motion);
			const observation: BrowserObservation = {
				...captureDocument(mountRoot, instrumentation.closedHosts),
				ready: {
					steps: ['upgrade', ...(readyHook ? ['ready-hook'] : []), 'fonts', 'frame'],
					outcome: undefinedTags.size ? 'elements-undefined' : 'ready',
				},
				plugins: installedPlugins,
			};
			if (eventRecorder) observation.events = eventRecorder.read();
			observation.limitations.push(...instrumentation.limitations);
			for (const tag of undefinedTags)
				observation.limitations.push(`Custom element <${tag}> was still undefined when captured.`);
			if (requested)
				observation.limitations.push(...contextMismatches(requested, observation.viewport));
			if (story) observation.limitations.push(...story.prepared.mismatches);
			return observation;
		},
		locate(selector) {
			return locate(mountRoot, selector);
		},
		async normalize(html) {
			return normalizeDom(html);
		},
		dispose,
	};
}
