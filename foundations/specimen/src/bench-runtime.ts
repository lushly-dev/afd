import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
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
import {
	DEFAULT_FLAKE_CAP,
	DEFAULT_SUITE_WORKERS,
	executeSuite,
	pool,
	selectEntries,
	selectStories,
} from './suite.js';
import { startTrace, traced } from './trace.js';
import {
	type A11yReport,
	type A11yRequest,
	type A11yRun,
	type AxeOutcome,
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
	type SpecimenEntry,
	type StoryOutcome,
	type StoryRun,
	type SuiteCapture,
	type SuiteRequest,
	type SuiteRun,
} from './types.js';
import { parseA11yRequest, parseCaptureRequest, parseSuiteRequest } from './validate.js';

function coverage(
	status: Completeness['status'],
	scope: string,
	reasons: string[] = []
): Completeness {
	return { status, scope, reasons };
}
/** Bundling, Chromium's startup (bounded at 10 s) and two seconds of cleanup, beyond a deadline. */
const HOST_GRACE = 30_000;
/** A retained story's deadline: Vitest's `testTimeout` in browser mode, its incumbent's runner. */
const DEFAULT_STORY_TIMEOUT_MS = 15_000;
/** Bundling a whole suite's stories has no render's deadline; this covers a host that hangs. */
const BUNDLE_GRACE = 300_000;
/** What the native host returns for one render. */
interface HostRender {
	/** The page's capture, with its DOM normalized in the page by `normalizeDom`. */
	/** `null` when a suite's capture mode left this story without one. */
	captured: (BrowserObservation & { normalized: string }) | null;
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
	/** An accessibility check the request asked for. */
	accessibility?: AxeOutcome | null;
}
/**
 * The bench runtime. Rendering runs in the native host (`host/`): it bundles the bench with
 * Rolldown, serves it from memory and drives Chromium over CDP, so this process loads neither
 * Vite nor Playwright to render. Vite is imported only to build a static bench.
 */
export async function createInProcessBench(
	options: BenchOptions,
	validatedConfig?: LoadedConfig
): Promise<Omit<SpecimenBench, 'validate' | 'migrate'>> {
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
						staticDirs: config.staticDirs,
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
		parsed: ReturnType<typeof parseCaptureRequest>,
		options: { capture?: SuiteCapture; reuseBundle?: boolean; accessibility?: boolean } = {}
	): Promise<{
		observation: Observation | null;
		outcome: StoryOutcome | null;
		accessibility: AxeOutcome | null;
	}> {
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
			const [rendered, identity] = await Promise.all([
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
								...(options.capture ? { capture: options.capture } : {}),
								...(options.reuseBundle ? { reuseBundle: true } : {}),
								...(options.accessibility ? { accessibility: true } : {}),
							},
							// The host bounds the render itself; this covers a host that stops answering.
							request.timeoutMs + HOST_GRACE
						) as Promise<HostRender>
				),
				// A suite reads this once for the stories it keeps a capture of, below.
				options.capture
					? null
					: traced(trace, 'provenance', () =>
							Promise.all([sourceState(config.root), dependencyIdentity(config.root)])
						),
			]);
			const accessibility = rendered.accessibility ?? null;
			if (!rendered.captured)
				return { observation: null, outcome: rendered.outcome ?? null, accessibility };
			const axe = accessibility ?? rendered.outcome?.a11y;
			const [source, dependencies] =
				identity ??
				(await Promise.all([sourceState(config.root), dependencyIdentity(config.root)]));
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
					a11y: { snapshot, axe: axe && axe.status !== 'not-run' ? axe : 'not-run' },
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
					a11y:
						axe && axe.status !== 'not-run'
							? coverage('complete', 'ARIA snapshot and axe', [])
							: coverage('partial', 'ARIA snapshot; axe not run', ['AXE_NOT_RUN']),
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
			return { observation, outcome: rendered.outcome ?? null, accessibility };
		} finally {
			await trace?.flush();
		}
	}

	/** One entry's check at a checkpoint: a story's play comes first, and its policy governs. */
	async function accessibilityReport(
		entry: SpecimenEntry,
		request: A11yRequest
	): Promise<A11yReport> {
		const checkpoint = request.checkpoint ?? 'after-run';
		try {
			const { outcome, accessibility } = await capture(
				{
					id: entry.id,
					checkpoint,
					...(request.context ? { context: request.context } : {}),
					timeoutMs:
						request.timeoutMs ??
						(entry.story ? (config.config.test?.timeoutMs ?? DEFAULT_STORY_TIMEOUT_MS) : 10_000),
				},
				{ capture: 'none', reuseBundle: true, accessibility: true }
			);
			const axe = accessibility ?? outcome?.a11y;
			if (!axe) throw new Error('The host returned no accessibility check');
			return {
				...axe,
				id: entry.id,
				checkpoint,
				failures: (outcome?.failures ?? []).flatMap((failure) =>
					failure.category === 'a11y'
						? []
						: [{ category: failure.category, message: failure.message }]
				),
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				status: 'not-run',
				policy: 'error',
				reason: 'it did not reach the check',
				violations: [],
				incomplete: 0,
				incompleteChecks: [],
				exceptions: [],
				id: entry.id,
				checkpoint,
				failures: [{ category: 'render', message }],
			};
		}
	}

	/** One retained story's run, or the outcome that says why it did not run. */
	async function runStory(
		parsed: ReturnType<typeof parseCaptureRequest>,
		options: { capture?: SuiteCapture; reuseBundle?: boolean } = {}
	): Promise<StoryRun> {
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
						incompleteChecks: [],
						exceptions: [],
					},
				},
				observation: null,
			};
		try {
			const { observation, outcome } = await capture(
				{
					...parsed,
					checkpoint: 'after-run',
					timeoutMs: parsed.timeoutMs ?? config.config.test?.timeoutMs ?? DEFAULT_STORY_TIMEOUT_MS,
				},
				options
			);
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
						incompleteChecks: [],
						exceptions: [],
					},
				},
				observation: null,
			};
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
			return (await capture(parseCaptureRequest(rawRequest))).observation as Observation;
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
			return runStory(parseCaptureRequest(rawRequest));
		},
		async a11y(rawRequest: A11yRequest = {}): Promise<A11yRun> {
			ensureOpen();
			const request = parseA11yRequest(rawRequest);
			const entries = request.id
				? config.entries.filter((entry) => entry.id === request.id)
				: selectEntries(config.entries, request.filter, config.root);
			if (request.id && !entries.length) throw new Error(`Specimen not found: ${request.id}`);
			if (!entries.length) throw new Error('No specimen or retained story matches the filter.');
			const workers = request.workers ?? config.config.test?.workers ?? DEFAULT_SUITE_WORKERS;
			const started = performance.now();
			const runtime = await ensureHost();
			await runtime.request('prepare', {}, BUNDLE_GRACE);
			const reports = await pool(entries, workers, (entry) => accessibilityReport(entry, request));
			const count = (status: A11yReport['status']) =>
				reports.filter((report) => report.status === status).length;
			return {
				reports,
				counts: {
					total: reports.length,
					passed: count('passed'),
					warning: count('warning'),
					failed: count('failed'),
					notRun: count('not-run'),
				},
				workers,
				elapsedMs: performance.now() - started,
			};
		},
		async runSuite(rawRequest: SuiteRequest = {}): Promise<SuiteRun> {
			ensureOpen();
			const request = parseSuiteRequest(rawRequest);
			const stories = selectStories(config.entries, request.filter, config.root);
			if (!stories.length) throw new Error('No retained story matches the filter.');
			const workers = request.workers ?? config.config.test?.workers ?? DEFAULT_SUITE_WORKERS;
			const started = performance.now();
			const runtime = await ensureHost();
			// One snapshot of the sources for the whole suite, so that a change during the run cannot
			// mix two generations; `sourcesChanged` reports one.
			await runtime.request('prepare', {}, BUNDLE_GRACE);
			const suite = await executeSuite(
				config.root,
				stories,
				async (entry) => {
					const { outcome, observation } = await runStory(
						{
							id: entry.id,
							...(request.context ? { context: request.context } : {}),
							...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {}),
						},
						{ capture: request.capture ?? 'failed', reuseBundle: true }
					);
					return { outcome, observation };
				},
				{
					workers,
					retry: request.retry ?? false,
					flakeCap: request.flakeCap ?? DEFAULT_FLAKE_CAP,
				}
			);
			const { stale } = (await runtime.request('stale', {}, HOST_GRACE)) as { stale: boolean };
			return {
				...suite,
				workers,
				elapsedMs: performance.now() - started,
				sourcesChanged: stale,
			};
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
