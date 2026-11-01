import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { SpecimenBench } from './bench.js';
import { defaultContext, digest, type LoadedConfig, loadConfig, resolveContext } from './config.js';
import { browserRuntimePath, chromiumExecutable, HostProcess } from './host.js';
import { dependencyIdentity, sourceState } from './provenance.js';
import { startTrace, traced } from './trace.js';
import {
	type BenchOptions,
	type BrowserObservation,
	CAPTURE_VERSION,
	type Completeness,
	NORMALIZATION_VERSION,
	type Observation,
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
}
/**
 * The bench runtime. Rendering runs in the native host (`host/`): it bundles the bench with
 * Rolldown, serves it from memory and drives Chromium over CDP, so this process loads neither
 * Vite nor Playwright to render. Vite is imported only to build a static bench.
 */
export async function createInProcessBench(
	options: BenchOptions,
	validatedConfig?: LoadedConfig
): Promise<SpecimenBench> {
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
						modules: Object.entries(config.modules),
						entries: config.config.specimens,
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
	return {
		list() {
			ensureOpen();
			return config.config.specimens.map((entry) => ({ ...entry }));
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
			const parsed = parseCaptureRequest(rawRequest);
			const request = {
				...parsed,
				checkpoint: parsed.checkpoint ?? 'mount',
				timeoutMs: parsed.timeoutMs ?? 10_000,
			};
			const entry = config.config.specimens.find((item) => item.id === request.id);
			if (!entry) throw new Error(`Specimen not found: ${request.id}`);
			const context = resolveContext(request.context);
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
									context,
									checkpoint: request.checkpoint,
									timeoutMs: request.timeoutMs,
									screenshot,
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
				trace?.record({ resources: loaded.length });
				const limitations = captured.limitations;
				const unstable = limitations.filter((value) => value.includes('time-dependent'));
				// Layout and styles observed under a context other than the manifest's are not evidence for it.
				const contextual = [
					...unstable,
					...limitations.filter((value) => value.startsWith('Context mismatch')),
				];
				return {
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
						tokens: coverage('unsupported', 'token dependencies', [
							'TOKEN_DETECTOR_NOT_IMPLEMENTED',
						]),
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
			} finally {
				await trace?.flush();
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
