import type {
	InspectResult,
	MountHandle,
	ScenarioStep,
	SpecimenContext,
	SpecimenEntry,
	SpecimenModule,
	Target,
} from '../types.js';
import { captureDocument, colorSchemeOf, contextMismatches, openElements } from './capture.js';
import { installInstrumentation } from './instrumentation.js';
import { locate } from './locate.js';
import { describe, enrichSchema, type InstalledPlugins, installPlugins } from './plugins.js';
import type { MountedStory, PreparedStory, StoryModule } from './story-runtime.js';
import { validateSpecimen } from './validate.js';

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

/** Install before specimen imports so closed roots and motion have an explicit scope. */
export function installRuntime(loaders: Record<string, () => Promise<SpecimenModule>>): void {
	if (window.__specimen) throw new Error('The Specimens runtime is already installed.');
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
		installed ??= installPlugins(loaders);
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
	async function settle(): Promise<void> {
		for (const element of openElements(mountRoot)) {
			if (element.localName.includes('-')) await customElements.whenDefined(element.localName);
		}
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
	): Promise<{ targets: Record<string, Target>; scenario: ScenarioStep[] }> {
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
		return { targets: {}, scenario: [] };
	}

	window.__specimen = {
		async resolve(entry, requestedContext, defaults) {
			if (!entry.story) return null;
			const prepared = await prepareRetained(entry, requestedContext);
			const { storyRenderContext } = await storyRuntime();
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
		async run() {
			if (!story?.mounted) throw new Error('Mount a retained story before running it.');
			const { runStory } = await storyRuntime();
			const outcome = await runStory(story.mounted);
			await settle();
			return outcome;
		},
		async mount(entry, context, options = {}) {
			if (active)
				throw new Error('A specimen is already mounted; dispose it before mounting another.');
			const load = loaders[entry.id];
			if (!load) throw new Error(`No specimen module is registered for ${entry.id}.`);
			active = true;
			if (entry.story) {
				try {
					return await mountRetained(entry, context, options);
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
				await handle.ready;
				await specimen.ready?.();
				await settle();
				return { targets: specimen.targets ?? {}, scenario: specimen.scenario ?? [] };
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
			const observation = captureDocument(mountRoot, instrumentation.closedHosts);
			observation.limitations.push(...instrumentation.limitations);
			if (requested)
				observation.limitations.push(...contextMismatches(requested, observation.viewport));
			if (story) observation.limitations.push(...story.prepared.mismatches);
			return observation;
		},
		locate(selector) {
			return locate(mountRoot, selector);
		},
		async normalize(html) {
			// Loaded on first use, so the bench page's shell does not carry the HTML parser.
			const { normalizeDom } = await import('../normalize.js');
			return normalizeDom(html);
		},
		dispose,
	};
}
