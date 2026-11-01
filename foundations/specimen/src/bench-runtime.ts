import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { SpecimenBench } from './bench.js';
import {
	bundled,
	defaultContext,
	digest,
	type LoadedConfig,
	loadConfig,
	resolveContext,
} from './config.js';
import { browserRuntimePath, chromiumExecutable, HostProcess } from './host.js';
import { dependencyIdentity, sourceState } from './provenance.js';
import { startTrace, traced } from './trace.js';
import {
	type BenchOptions,
	type BrowserObservation,
	CAPTURE_VERSION,
	type Completeness,
	type InspectRequest,
	type InspectResult,
	NORMALIZATION_VERSION,
	type Observation,
	type RunRequest,
	type SpecimenContext,
	type StoryOutcome,
	type StoryRun,
} from './types.js';
import { parseCaptureRequest } from './validate.js';

function coverage(
	status: Completeness['status'],
	scope: string,
	reasons: string[] = []
): Completeness {
	return { status, scope, reasons };
}
/** Bundling, Chromium's startup (bounded at 10 s) and two seconds of cleanup, beyond a deadline. */
const HOST_GRACE = 30_000;
/** What the native host returns for one render. */
interface HostRender {
	/** The page's capture, with its DOM normalized in the page by `normalizeDom`. */
	captured: BrowserObservation & { normalized: string };
	snapshot: string;
	screenshot: string | null;
	console: { errors: string[]; warnings: string[] };
	/** `file:digest` for every bundle file the page loaded, sorted. */
	loaded: string[];
	browser: string;
	/** The context the page rendered in; a retained story settles its own. */
	context: SpecimenContext;
	/** A retained story's run, at the after-run checkpoint. */
	outcome: StoryOutcome | null;
}
/**
 * The bench runtime. Rendering runs in the native host (`host/`): it bundles the bench with
 * Rolldown, serves it from memory and drives Chromium over CDP, so this process loads neither
 * Vite nor Playwright to render. Vite is imported only to build a static bench.
 */
export async function createInProcessBench(
	options: BenchOptions,
	validatedConfig?: LoadedConfig
): Promise<Omit<SpecimenBench, 'validate'>> {
	const createTrace = startTrace('bench-create');
	const config =
		validatedConfig ?? (await traced(createTrace, 'load-config', () => loadConfig(options)));
	await createTrace?.flush();
	let host: Promise<HostProcess> | undefined;
	let closing: Promise<void> | undefined;
	let closed = false;
	const ensureOpen = () => {
		if (closed) throw new Error('Specimen bench is closed');
	};
	// Started by the first render; Chromium launches while the first bundle builds.
	const ensureHost = () =>
		(host ??= (async () => {
			const executable = options.executablePath ?? chromiumExecutable();
			const process = new HostProcess();
			try {
				const opened = (await process.request(
					'open',
					{
						root: config.root,
						runtime: browserRuntimePath(),
						modules: Object.entries(bundled(config).modules),
						entries: bundled(config).entries,
						defaults: defaultContext,
						executable,
						work: tmpdir(),
					},
					HOST_GRACE
				)) as { browserPid: number };
				process.browserGroup = opened.browserPid;
				return process;
			} catch (error) {
				await process.close();
				throw error;
			}
		})());
	/** One capture through the host; a retained story's context comes back settled. */
	async function capture(
		parsed: ReturnType<typeof parseCaptureRequest>
	): Promise<{ observation: Observation; outcome: StoryOutcome | null }> {
		const request = {
			...parsed,
			checkpoint: parsed.checkpoint ?? 'mount',
			timeoutMs: parsed.timeoutMs ?? 10_000,
		};
		const entry = config.entries.find((item) => item.id === request.id);
		if (!entry) throw new Error(`Specimen not found: ${request.id}`);
		// A retained story settles its own context in the page, starting from the request.
		const provisional: SpecimenContext = entry.story
			? resolveContext({ ...request.context, themeMedia: 'browser-default' })
			: resolveContext(request.context);
		const trace = startTrace('render', { id: entry.id, checkpoint: request.checkpoint });
		try {
			const runtime = await traced(trace, host ? 'host-ready' : 'host-start', ensureHost);
			const screenshot = request.screenshot ? resolve(config.root, request.screenshot) : null;
			// Source and lockfile identity are read while the page renders.
			const [rendered, [source, dependencies]] = await Promise.all([
				traced(
					trace,
					'host-render',
					() =>
						runtime.request(
							'render',
							{
								entry,
								context: provisional,
								checkpoint: request.checkpoint,
								timeoutMs: request.timeoutMs,
								screenshot,
								...(entry.story
									? { requested: request.context ?? {}, defaults: defaultContext }
									: {}),
							},
							// The host bounds the render itself; this covers a host that stops answering.
							request.timeoutMs + HOST_GRACE
						) as Promise<HostRender>
				),
				traced(trace, 'provenance', () =>
					Promise.all([sourceState(config.root), dependencyIdentity(config.root)])
				),
			]);
			const { captured, snapshot, loaded } = rendered;
			const context = entry.story ? rendered.context : provisional;
			trace?.record({ resources: loaded.length });
			const limitations = captured.limitations;
			const unstable = limitations.filter((value) => value.includes('time-dependent'));
			// Layout and styles observed under a context other than the manifest's are not evidence for it.
			const contextual = [
				...unstable,
				...limitations.filter((value) => value.startsWith('Context mismatch')),
			];
			const observation = {
				manifest: {
					captureVersion: CAPTURE_VERSION,
					normalizationVersion: NORMALIZATION_VERSION,
					specimenId: entry.id,
					checkpoint: request.checkpoint,
					source: {
						...source,
						digest: digest([config.digest, ...loaded].join('\n')),
					},
					dependencies,
					browser: { name: 'chromium', version: rendered.browser },
					context,
				},
				channels: {
					dom: { raw: captured.dom, normalized: captured.normalized },
					a11y: { snapshot, axe: 'not-run' },
					elements: captured.elements,
					console: rendered.console,
					visual: { path: rendered.screenshot },
				},
				completeness: {
					dom: coverage(
						limitations.some((value) => value.toLowerCase().includes('closed'))
							? 'partial'
							: 'complete',
						'light DOM and accessible open shadow roots',
						limitations.filter((value) => value.toLowerCase().includes('closed'))
					),
					a11y: coverage('partial', 'ARIA snapshot; axe not run', ['AXE_NOT_RUN']),
					layout: coverage(
						contextual.length ? 'partial' : 'complete',
						'boxes and scroll extents of accessible elements; pseudo-element geometry excluded',
						contextual
					),
					styles: coverage(
						contextual.length ? 'partial' : 'complete',
						'versioned selected computed CSS properties on accessible elements',
						contextual
					),
					tokens: coverage('unsupported', 'token dependencies', ['TOKEN_DETECTOR_NOT_IMPLEMENTED']),
					events: coverage('unsupported', 'declared event history', [
						'EVENT_CAPTURE_NOT_IMPLEMENTED',
					]),
					visual: coverage(rendered.screenshot ? 'partial' : 'not-requested', 'appearance', [
						...limitations,
						...(rendered.screenshot
							? ['PIXEL_COMPARISON_NOT_IMPLEMENTED']
							: ['SCREENSHOT_NOT_REQUESTED']),
					]),
				},
			} satisfies Observation;
			return { observation, outcome: rendered.outcome ?? null };
		} finally {
			await trace?.flush();
		}
	}

	return {
		list() {
			ensureOpen();
			return config.entries.map((entry) => ({ ...entry }));
		},
		async build(outDir) {
			ensureOpen();
			const { prepareBenchSite } = await import('./vite.js');
			const site = await prepareBenchSite(config);
			try {
				return await site.build(outDir);
			} finally {
				await site.dispose();
			}
		},
		async render(rawRequest) {
			ensureOpen();
			return (await capture(parseCaptureRequest(rawRequest))).observation;
		},
		async inspect(rawRequest: InspectRequest): Promise<InspectResult> {
			ensureOpen();
			const parsed = parseCaptureRequest(rawRequest);
			const entry = config.entries.find((item) => item.id === parsed.id);
			if (!entry) throw new Error(`Specimen not found: ${parsed.id}`);
			const timeoutMs = parsed.timeoutMs ?? 10_000;
			const provisional = entry.story
				? resolveContext({ ...parsed.context, themeMedia: 'browser-default' })
				: resolveContext(parsed.context);
			const runtime = await ensureHost();
			const inspected = (await runtime.request(
				'render',
				{
					entry,
					context: provisional,
					checkpoint: 'mount',
					timeoutMs,
					screenshot: null,
					requested: parsed.context ?? {},
					defaults: provisional,
					inspect: { schema: (entry.component && config.schemas[entry.component]) || null },
				},
				timeoutMs + HOST_GRACE
			)) as HostRender;
			return inspected.captured as unknown as InspectResult;
		},
		async run(rawRequest: RunRequest): Promise<StoryRun> {
			ensureOpen();
			const parsed = parseCaptureRequest(rawRequest);
			const entry = config.entries.find((item) => item.id === parsed.id);
			if (!entry) throw new Error(`Specimen not found: ${parsed.id}`);
			if (!entry.story)
				throw new Error(
					`${entry.id} is a native specimen; run applies to retained stories. Render its checkpoints instead.`
				);
			// The Vitest addon's selection: include and exclude test the index's tags (with `play-fn`,
			// without `manifest`), and skip tests the runtime's (without either).
			const tags = entry.story.tags.filter((tag) => tag !== 'manifest');
			const selection = config.config.test ?? {};
			const include = selection.include ?? ['test'];
			const unselected =
				(include.length > 0 && !include.some((tag) => tags.includes(tag))) ||
				(selection.exclude ?? []).some((tag) => tags.includes(tag));
			const skipped = (selection.skip ?? []).some((tag) => tag !== 'play-fn' && tags.includes(tag));
			if (unselected || skipped)
				return {
					id: entry.id,
					outcome: {
						status: unselected ? 'excluded' : 'skipped',
						play: 'none',
						failures: [],
						a11y: {
							status: 'not-run',
							policy: 'error',
							reason: unselected
								? 'the story is not a test under the include and exclude tags'
								: 'the story has a skip tag',
							violations: [],
							incomplete: 0,
						},
					},
					observation: null,
				};
			try {
				const { observation, outcome } = await capture({ ...parsed, checkpoint: 'after-run' });
				if (!outcome) throw new Error('The host returned no outcome for the run');
				return { id: entry.id, outcome, observation };
			} catch (error) {
				// A story that fails to compose or render fails its run, as its test does.
				const message = error instanceof Error ? error.message : String(error);
				return {
					id: entry.id,
					outcome: {
						status: 'failed',
						play: 'none',
						failures: [{ category: 'render', message }],
						a11y: {
							status: 'not-run',
							policy: 'error',
							reason: 'the story did not render',
							violations: [],
							incomplete: 0,
						},
					},
					observation: null,
				};
			}
		},
		close() {
			closing ??= (async () => {
				closed = true;
				const runtime = await host?.catch(() => undefined);
				await runtime?.close();
			})();
			return closing;
		},
	};
}
