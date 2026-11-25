// One closure over the host process and its bundle: coverage, contracts and packs share its capture.
import { existsSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { RANDOM_SEED } from './baseline.js';
import type { BenchRuntime } from './bench.js';
import { runGateInRuntime, suggestInRuntime } from './bench-gates.js';
import { captureCheckpointsInRuntime, runJobForCaptureSet, runJobInRuntime } from './bench-jobs.js';
import { runCompare } from './compare.js';
import {
	bundled,
	defaultContext,
	digest,
	type LoadedConfig,
	loadConfig,
	resolveContext,
} from './config.js';
import { runContract } from './contract.js';
import { runCoverage } from './coverage-run.js';
import { diffObservations } from './diff.js';
import {
	browserRuntimePath,
	checkHostIsolation,
	chromiumExecutable,
	HostProcess,
	type SpecimenHostError,
} from './host.js';
import { JOBS_COVERAGE_OBLIGATIONS, readJobCoverageFromSet } from './job-coverage.js';
import { type JobSource, loadJobSourceModule } from './job-source.js';
import { readA11yFromSet, readObservationFromSet } from './jobs.js';
import * as noteRun from './note-run.js';
import { type PackHost, runPack } from './pack-run.js';
import {
	checkImplementationContexts,
	effectiveGateContext,
	filterAndPaginateListEntries,
	listEntriesOf,
	type SynthesizedGateCase,
} from './pattern-gates.js';
import type { JobDriverResult } from './plugin.js';
import * as pointRun from './point-run.js';
import {
	BASELINE_RUNNER,
	compareProfile,
	DEFAULT_BASELINE_RUNS,
	DEFAULT_PROFILE_RUNS,
	parseBaselines,
	profileFlags,
	summarizeProfile,
	withBaseline,
} from './profile.js';
import { dependencyIdentity, sourceState } from './provenance.js';
import { runCaptureSet } from './sets.js';
import {
	DEFAULT_FLAKE_CAP,
	DEFAULT_SUITE_WORKERS,
	executeSuite,
	isSynthesizedGateCase,
	matrixCells,
	pool,
	selectEntries,
	selectSuiteCases,
} from './suite.js';
import { runThemes } from './themes-run.js';
import { startTrace, traced } from './trace.js';
import {
	type A11yReport,
	type A11yRequest,
	type A11yRun,
	type AxeOutcome,
	type BaselineRequest,
	type BenchOptions,
	type BrowserObservation,
	CAPTURE_VERSION,
	type CaptureCheckpoint,
	type CaptureSetRequest,
	type CaptureSetRun,
	type CheckpointsRequest,
	type CheckpointsRun,
	type CompareRequest,
	type CompareRun,
	type Completeness,
	type ContractRequest,
	type ContractRun,
	type CoverageRequest,
	type CoverageRun,
	type EventDeclaration,
	type GateOutcome,
	type GateRun,
	type InspectRequest,
	type InspectResult,
	type JobRun,
	type JobRunRequest,
	type MatrixCell,
	type MatrixRequest,
	type MatrixRun,
	NORMALIZATION_VERSION,
	type Observation,
	type PackBuildRequest,
	type PackBuildRun,
	type PortableScenarioStep,
	type ProfileBaseline,
	type ProfileBaselines,
	type ProfileReport,
	type ProfileRequest,
	type ProfileRun,
	type ProfileSample,
	type RunRequest,
	type SpecimenContext,
	type SpecimenEntry,
	type StoryOutcome,
	type StoryRun,
	type SuggestRequest,
	type SuggestRun,
	type SuiteCapture,
	type SuiteRequest,
	type SuiteRun,
	type Target,
	type ThemesRequest,
	type ThemesRun,
} from './types.js';
import {
	parseA11yRequest,
	parseBaselineRequest,
	parseCaptureRequest,
	parseCaptureSetRequest,
	parseCompareRequest,
	parseContractRequest,
	parseCoverageRequest,
	parseMatrixRequest,
	parsePackRequest,
	parseProfileRequest,
	parseRunRequest,
	parseSuiteRequest,
	parseThemesRequest,
} from './validate.js';

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
/** The context axes the host emulates over CDP, so a story sees them as a real browser would. */
const HOST_EMULATES = [
	'viewport',
	'pixel-ratio',
	'color-scheme',
	'contrast',
	'reduced-motion',
	'locale',
];
const bench = createRequire(import.meta.url)('../package.json') as {
	name: string;
	version: string;
};
/** Bundling a whole suite's stories has no render's deadline; this covers a host that hangs. */
const BUNDLE_GRACE = 300_000;
/** What the native host returns for one render. */
/** A sample's measurements, as the page and host report them, before its console counts. */
type PageMeasurements = Omit<ProfileSample, 'consoleErrors' | 'consoleWarnings'>;

interface HostCheckpointCapture {
	key: string | null;
	name: string;
	step: number | null;
	captured: BrowserObservation & { normalized: string };
	snapshot: string;
	screenshot: string | null;
	accessibility?: AxeOutcome | null;
	console?: { errors: string[]; warnings: string[] };
}

interface HostRender extends pointRun.PointRenderFields {
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
	/** A retained story's or synthesized gate's run outcome, at the after-run checkpoint. */
	outcome: StoryOutcome | GateOutcome | null;
	/** An accessibility check the request asked for. */
	accessibility?: AxeOutcome | null;
	/** The page's measurements at the checkpoint, when the request asked for them. */
	profile?: PageMeasurements | null;
	/** Multiple kept checkpoints captured during a single fresh pass. */
	captures?: HostCheckpointCapture[] | null;
	/** Final step outcomes returned by an in-page job driver. */
	jobOutcome?: JobDriverResult | null;
}
/**
 * The bench runtime. Rendering runs in the native host (`host/`): it bundles the bench with
 * Rolldown, serves it from memory and drives Chromium over CDP, so this process loads neither
 * Vite nor Playwright to render. Vite is imported only to build a static bench.
 */
export async function createInProcessBench(
	options: BenchOptions,
	validatedConfig?: LoadedConfig
): Promise<BenchRuntime> {
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
	const inlineJobSources: JobSource[] = [...(options.jobSources ?? [])];
	let loadedJobSources: JobSource[] | undefined;
	const getJobSources = async (): Promise<JobSource[]> => {
		if (loadedJobSources) return loadedJobSources;
		const sources: JobSource[] = [...inlineJobSources];
		for (const modulePath of config.jobSourceModules) {
			sources.push(...(await loadJobSourceModule(modulePath)));
		}
		loadedJobSources = sources;
		return sources;
	};
	const hasJobRunner =
		(config.jobSourceModules.length > 0 || inlineJobSources.length > 0) &&
		config.plugins.length > 0;
	const browserBuild = options.executablePath ? digest(options.executablePath) : null;
	// Started by the first render; Chromium launches while the first bundle builds.
	const ensureHost = () =>
		(host ??= (async () => {
			if (options.executablePath && !existsSync(options.executablePath)) {
				const error: SpecimenHostError = new Error(
					`Chromium executable is missing at ${options.executablePath}.`
				);
				error.code = 'BROWSER_UNAVAILABLE';
				error.suggestion =
					'Install the browser Specimen uses or point executablePath to an installed Chromium binary.';
				throw error;
			}
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
						// Pages reach the bench's own origin and these, nothing else.
						network: { allow: config.config.network?.allow ?? [] },
					},
					HOST_GRACE
				)) as { browserPid: number; isolation?: unknown };
				process.browserGroup = opened.browserPid;
				checkHostIsolation(opened, process.binary);
				return process;
			} catch (error) {
				await process.close();
				const structured = error as SpecimenHostError;
				const msg = error instanceof Error ? error.message : String(error);
				if (
					!structured.code &&
					!/Specimen host failed to start|is not installed/i.test(msg) &&
					/(?:spawn|launch|chromium|chrome|browser|ENOENT|cannot find the file|No such file)/i.test(
						msg
					)
				) {
					structured.code = 'BROWSER_UNAVAILABLE';
					structured.suggestion =
						'Install the browser Specimen uses, or run the scenario headless without a browser.';
				}
				throw error;
			}
		})());
	function buildObservation(args: {
		entry: SpecimenEntry;
		context: SpecimenContext;
		checkpointName: string;
		actionMode: CaptureCheckpoint['actionMode'];
		timeoutMs: number;
		clockBaseline: CaptureCheckpoint['baseline']['clock'];
		captured: BrowserObservation & { normalized: string };
		snapshot: string;
		screenshot: string | null;
		axe: AxeOutcome | undefined;
		console: { errors: string[]; warnings: string[] };
		loaded: string[];
		browser: string;
		source: { revision: string | null; dirty: boolean | null };
		dependencies: string;
	}): Observation {
		const limitations = args.captured.limitations;
		const unstable = limitations.filter((value) => value.includes('time-dependent'));
		const contextual = [
			...unstable,
			...limitations.filter((value) => value.startsWith('Context mismatch')),
		];
		return {
			manifest: {
				captureVersion: CAPTURE_VERSION,
				normalizationVersion: NORMALIZATION_VERSION,
				specimenId: args.entry.id,
				capturedUtc: new Date().toISOString(),
				bench: { name: bench.name, version: bench.version, plugins: args.captured.plugins },
				driver: { name: 'host', emulates: HOST_EMULATES },
				checkpoint: {
					name: args.checkpointName,
					actionMode: args.actionMode,
					ready: { ...args.captured.ready, deadlineMs: args.timeoutMs },
					baseline: {
						clock: args.clockBaseline,
						random: { source: 'seeded', seed: RANDOM_SEED },
						storage: 'empty',
					},
				},
				source: {
					...args.source,
					digest: digest([config.digest, ...args.loaded].join('\n')),
				},
				dependencies: args.dependencies,
				browser: {
					name: 'chromium',
					version: args.browser,
					platform: `${process.platform}-${process.arch}`,
					build: browserBuild,
				},
				context: {
					...args.context,
					pixelRatio: 1,
					observed: args.captured.viewport,
					resources: args.captured.resources,
				},
			},
			channels: {
				dom: { raw: args.captured.dom, normalized: args.captured.normalized },
				a11y: {
					snapshot: args.snapshot,
					axe: args.axe && args.axe.status !== 'not-run' ? args.axe : 'not-run',
				},
				events: {
					declared: args.captured.events.declared,
					history: args.captured.events.history,
				},
				evidence: args.captured.evidence,
				elements: args.captured.elements,
				console: args.console,
				visual: { path: args.screenshot },
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
					args.axe && args.axe.status !== 'not-run'
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
				events: args.captured.events.declared.length
					? coverage(
							args.captured.events.unresolved.length ? 'partial' : 'complete',
							'declared events on their targets and roots',
							args.captured.events.unresolved.map(
								(target) => `Declared event target '${target}' did not resolve.`
							)
						)
					: coverage('not-requested', 'declared event history', ['NO_EVENTS_DECLARED']),
				visual: coverage(args.screenshot ? 'partial' : 'not-requested', 'appearance', [
					...limitations,
					...(args.screenshot
						? ['PIXEL_COMPARISON_NOT_IMPLEMENTED']
						: ['SCREENSHOT_NOT_REQUESTED']),
				]),
			},
		};
	}

	/** One capture through the host; a retained story's context comes back settled. */
	async function capture(
		parsed: ReturnType<typeof parseCaptureRequest>,
		options: {
			capture?: SuiteCapture;
			reuseBundle?: boolean;
			accessibility?: boolean;
			profile?: boolean;
			observe?: SpecimenEntry['observe'];
			/** Mount this markup, after loading the entry's module, in place of the entry. */
			remount?: string;
			/** Native portable gate execution payload (`spec.md` §4.3). */
			gate?: {
				id: string;
				targets: Record<string, Target>;
				scenario: PortableScenarioStep[];
				events: EventDeclaration[];
			};
		} & pointRun.PointCaptureOptions = {}
	): Promise<{
		observation: Observation | null;
		outcome: StoryOutcome | GateOutcome | null;
		accessibility: AxeOutcome | null;
		profile: PageMeasurements | null;
		pointMeta: pointRun.PointCaptureMeta;
	}> {
		const request = {
			...parsed,
			checkpoint: parsed.checkpoint ?? 'mount',
			timeoutMs: parsed.timeoutMs ?? 10_000,
		};
		const found = config.entries.find((item) => item.id === request.id);
		if (!found) throw new Error(`Specimen not found: ${request.id}`);
		// Markup mounted again is no longer the story: the page loads its module and mounts the markup.
		const entry: SpecimenEntry =
			options.remount === undefined
				? found
				: (({ story: _, ...rest }) => ({ ...rest, remount: options.remount }))(found);
		// A retained story settles its own context in the page, starting from the request.
		const provisional: SpecimenContext = entry.story
			? resolveContext({ ...request.context, themeMedia: 'browser-default' })
			: resolveContext(request.context);
		const trace = startTrace('render', {
			id: options.gate?.id ?? entry.id,
			checkpoint: request.checkpoint,
		});
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
								entry: options.observe ? { ...entry, observe: options.observe } : entry,
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
								...(options.profile ? { profile: true } : {}),
								...(options.gate
									? {
											gate: {
												targets: options.gate.targets,
												scenario: options.gate.scenario,
												events: options.gate.events,
											},
										}
									: {}),
								...pointRun.pointRequestFields(options),
								...(entry.story && !options.gate && config.config.test?.settledAccessibility
									? { settled: true }
									: {}),
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
			const profile = rendered.profile ?? null;
			const pointMeta = pointRun.extractPointMeta(rendered);
			if (!rendered.captured)
				return {
					observation: null,
					outcome: rendered.outcome ?? null,
					accessibility,
					profile,
					pointMeta,
				};
			const storyOutcome = rendered.outcome && 'a11y' in rendered.outcome ? rendered.outcome : null;
			// The capture is of the settled page, so it records the settled check when one ran.
			const axe =
				options.accessibility === false
					? undefined
					: (accessibility ?? storyOutcome?.settled ?? storyOutcome?.a11y);
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
					specimenId: options.gate?.id ?? entry.id,
					capturedUtc: new Date().toISOString(),
					bench: { name: bench.name, version: bench.version, plugins: captured.plugins },
					driver: { name: 'host' as const, emulates: HOST_EMULATES },
					checkpoint: {
						name: request.checkpoint,
						actionMode: (options.gate
							? 'real-input'
							: request.checkpoint === 'mount'
								? 'none'
								: entry.story
									? 'play'
									: 'real-input') as CaptureCheckpoint['actionMode'],
						ready: { ...captured.ready, deadlineMs: request.timeoutMs },
						baseline: {
							clock: 'real' as const,
							random: { source: 'seeded' as const, seed: RANDOM_SEED },
							storage: 'empty' as const,
						},
					},
					source: {
						...source,
						digest: digest([config.digest, ...loaded].join('\n')),
					},
					dependencies,
					browser: {
						name: 'chromium',
						version: rendered.browser,
						platform: `${process.platform}-${process.arch}`,
						build: browserBuild,
					},
					context: {
						...context,
						pixelRatio: 1,
						observed: captured.viewport,
						resources: captured.resources,
					},
				},
				channels: {
					dom: { raw: captured.dom, normalized: captured.normalized },
					a11y: { snapshot, axe: axe && axe.status !== 'not-run' ? axe : 'not-run' },
					events: {
						declared: captured.events.declared,
						history: captured.events.history,
					},
					evidence: captured.evidence,
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
					events: captured.events.declared.length
						? coverage(
								captured.events.unresolved.length ? 'partial' : 'complete',
								'declared events on their targets and roots',
								captured.events.unresolved.map(
									(target) => `Declared event target '${target}' did not resolve.`
								)
							)
						: coverage('not-requested', 'declared event history', ['NO_EVENTS_DECLARED']),
					visual: coverage(rendered.screenshot ? 'partial' : 'not-requested', 'appearance', [
						...limitations,
						...(rendered.screenshot
							? ['PIXEL_COMPARISON_NOT_IMPLEMENTED']
							: ['SCREENSHOT_NOT_REQUESTED']),
					]),
				},
			} satisfies Observation;
			return {
				observation,
				outcome: rendered.outcome ?? null,
				accessibility,
				profile,
				pointMeta,
			};
		} finally {
			await trace?.flush();
		}
	}

	async function readBaselines(): Promise<ProfileBaselines | null> {
		if (!config.baselines) return null;
		const text = await readFile(config.baselines, 'utf8').catch((error: NodeJS.ErrnoException) => {
			if (error.code === 'ENOENT') return null;
			throw error;
		});
		return text === null ? null : parseBaselines(text, config.baselines);
	}

	/** One entry's runs at its checkpoint, each a fresh browser context, one after another. */
	async function profileEntry(
		entry: SpecimenEntry,
		request: ProfileRequest,
		runs: number,
		baseline: ProfileBaseline | undefined
	): Promise<ProfileReport> {
		const checkpoint = request.checkpoint ?? 'mount';
		const samples: ProfileSample[] = [];
		const report = {
			id: entry.id,
			checkpoint,
			runs,
			provenance: {
				runner: BASELINE_RUNNER,
				capturedAt: new Date().toISOString(),
				source: null as { revision: string | null; dirty: boolean | null } | null,
			},
		};
		let viewport: string | null = null;
		let browser: string | null = null;
		try {
			for (let run = 0; run < runs; run++) {
				const { observation, profile } = await capture(
					{
						id: entry.id,
						checkpoint,
						...(request.context ? { context: request.context } : {}),
						timeoutMs:
							request.timeoutMs ??
							(entry.story ? (config.config.test?.timeoutMs ?? DEFAULT_STORY_TIMEOUT_MS) : 10_000),
					},
					{ reuseBundle: true, profile: true }
				);
				if (!observation || !profile) throw new Error('The host returned no measurements');
				const size = observation.manifest.context.viewport;
				viewport = `${size.width}x${size.height}`;
				browser = observation.manifest.browser.version;
				report.provenance.source = {
					revision: observation.manifest.source.revision,
					dirty: observation.manifest.source.dirty,
				};
				samples.push({
					...profile,
					consoleErrors: observation.channels.console.errors.length,
					consoleWarnings: observation.channels.console.warnings.length,
				});
			}
		} catch (error) {
			return {
				...report,
				viewport,
				browser,
				samples,
				summary: null,
				flags: [],
				comparison: null,
				error: error instanceof Error ? error.message : String(error),
			};
		}
		const summary = summarizeProfile(samples);
		return {
			...report,
			viewport,
			browser,
			samples,
			summary,
			flags: profileFlags(summary),
			comparison: baseline
				? compareProfile(baseline, summary, {
						viewport: viewport as string,
						checkpoint,
						browser: browser as string,
					})
				: null,
		};
	}

	function profileCounts(reports: readonly ProfileReport[]): ProfileRun['counts'] {
		const count = (status: NonNullable<ProfileReport['comparison']>['status']) =>
			reports.filter((report) => report.comparison?.status === status).length;
		return {
			total: reports.length,
			passed: count('passed'),
			warnings: count('warnings'),
			failed: count('failed'),
			notComparable: count('not-comparable'),
			noBaseline: reports.filter((report) => !report.comparison && !report.error).length,
			errored: reports.filter((report) => report.error !== undefined).length,
		};
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
			// A project that asks for the settled check is checked there; the earlier check stays in
			// the story's run.
			const storyOutcome = outcome && 'a11y' in outcome ? outcome : null;
			const axe = accessibility ?? storyOutcome?.settled ?? storyOutcome?.a11y;
			if (!axe) throw new Error('The host returned no accessibility check');
			return {
				...axe,
				id: entry.id,
				checkpoint,
				failures: (storyOutcome?.failures ?? []).flatMap((failure) =>
					failure.category === 'a11y' ||
					failure.category === 'settled-a11y' ||
					failure.category === 'error'
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
		options: {
			capture?: SuiteCapture;
			reuseBundle?: boolean;
			observe?: SpecimenEntry['observe'];
		} = {}
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
			if (!outcome || !('a11y' in outcome))
				throw new Error('The host returned no outcome for the run');
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

	const gateById = new Map((config.gateCases ?? []).map((gateCase) => [gateCase.id, gateCase]));

	/** Run one synthesized portable pattern gate case (`spec.md` §4.3). */
	const runGate = (
		gateCase: SynthesizedGateCase,
		parsed: RunRequest,
		options?: { capture?: SuiteCapture; reuseBundle?: boolean }
	): Promise<GateRun> =>
		runGateInRuntime(capture, DEFAULT_STORY_TIMEOUT_MS, gateCase, parsed, options);

	/** What coverage and a pack need: each case run or rendered on the shared bundle. */
	const caseHost = (accessibility = false): PackHost => {
		const render = async (
			id: string,
			checkpoint: string,
			timeoutMs: number | undefined,
			observe: SpecimenEntry['observe'],
			remount?: string
		) =>
			(
				await capture(
					parseCaptureRequest({ id, checkpoint, ...(timeoutMs ? { timeoutMs } : {}) }),
					{
						reuseBundle: true,
						observe,
						accessibility,
						...(remount === undefined ? {} : { remount }),
					}
				)
			).observation;
		let bundle: string | null = null;
		return {
			config,
			prepare: async () => {
				const runtime = await ensureHost();
				const prepared = (await runtime.request('prepare', {}, BUNDLE_GRACE)) as {
					bundle?: string;
				} | null;
				bundle = prepared?.bundle ?? null;
			},
			bundle: () => bundle,
			inspect: async (id) => (await api.inspect({ id })).schema,
			runStory: (id, timeoutMs, observe) =>
				runStory(
					{ id, ...(timeoutMs ? { timeoutMs } : {}) },
					{ capture: 'all', reuseBundle: true, observe }
				),
			runGate: (id, timeoutMs) => {
				const gateCase = gateById.get(id);
				if (!gateCase) throw new Error(`Gate case not found: ${id}`);
				return runGate(
					gateCase,
					{ id, ...(timeoutMs !== undefined ? { timeoutMs } : {}) },
					{ capture: 'none', reuseBundle: true }
				);
			},
			render: (id, checkpoint, timeoutMs, observe) => render(id, checkpoint, timeoutMs, observe),
			capture: (id, { timeoutMs, observe, remount }) =>
				render(
					id,
					'after-run',
					timeoutMs ?? config.config.test?.timeoutMs ?? DEFAULT_STORY_TIMEOUT_MS,
					observe,
					remount
				),
		};
	};
	const jobDeps = {
		config,
		hostGraceMs: HOST_GRACE,
		ensureOpen,
		ensureHost,
		getJobSources,
		buildObservation,
	};

	const captureSetHost = () => ({
		root: config.root,
		localLibrary: config.config.pack?.library,
		entries: [...config.entries, ...(config.gateCases ?? []).map((gateCase) => gateCase.entry)],
		workers: config.config.test?.workers ?? DEFAULT_SUITE_WORKERS,
		prepare: async () => {
			const runtime = await ensureHost();
			await runtime.request('prepare', {}, BUNDLE_GRACE);
		},
		sourceState: () => sourceState(config.root),
		render: async ({
			entry,
			context,
			checkpoint,
			axe,
			screenshot,
			timeoutMs,
		}: {
			entry: SpecimenEntry;
			context: SpecimenContext;
			checkpoint: string;
			axe: boolean;
			screenshot: string;
			timeoutMs?: number;
		}) => {
			const gateCase = gateById.get(entry.id);
			if (gateCase) {
				const effective = effectiveGateContext(gateCase.gate, context);
				const outOfContext = checkImplementationContexts(effective, gateCase.contexts);
				if (outOfContext !== undefined) throw new Error(outOfContext);
				const { observation } = await capture(
					{
						id: gateCase.setupEntry.id,
						checkpoint: 'after-run',
						context: effective,
						screenshot,
						timeoutMs: timeoutMs ?? DEFAULT_STORY_TIMEOUT_MS,
					},
					{
						reuseBundle: true,
						accessibility: axe,
						capture: 'all',
						gate: {
							id: gateCase.id,
							targets: gateCase.setup.targets,
							scenario: gateCase.gate.scenario,
							events: gateCase.events,
						},
					}
				);
				if (!observation) throw new Error('The gate render captured no observation.');
				return observation;
			}
			const { observation } = await capture(
				{
					id: entry.id,
					checkpoint,
					context,
					screenshot,
					...(timeoutMs !== undefined ? { timeoutMs } : {}),
				},
				{ reuseBundle: true, accessibility: axe }
			);
			if (!observation) throw new Error('The render captured no observation.');
			return observation;
		},
		...(hasJobRunner
			? {
					runJob: (args: {
						entry: SpecimenEntry;
						context: SpecimenContext;
						axe: boolean;
						stagingDir: string;
						timeoutMs?: number;
					}) => runJobForCaptureSet(jobDeps, args),
				}
			: {}),
	});
	const api: BenchRuntime = {
		list(filter) {
			ensureOpen();
			const localLibrary = config.config.pack?.library;
			const entries = listEntriesOf(config.entries, config.gateCases, localLibrary);
			return filterAndPaginateListEntries(entries, filter, localLibrary).specimens;
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
			const request = parseCaptureRequest(rawRequest);
			if (request.set !== undefined) {
				if (request.screenshot !== undefined) {
					throw new Error(
						'A saved capture set already keeps screenshots; omit screenshot when passing set.'
					);
				}
				return readObservationFromSet(config.root, {
					id: request.id,
					set: request.set,
					...(request.checkpoint !== undefined ? { checkpoint: request.checkpoint } : {}),
				});
			}
			const found = config.entries.find((item) => item.id === request.id);
			if (found?.job) {
				const error: SpecimenHostError = new Error(
					`Specimen '${found.id}' is a job specimen and cannot be rendered without a capture set.`
				);
				error.code = 'JOB_NEEDS_RUN';
				error.suggestion = `Run specimen-job-run for '${found.id}', then call specimen-render with its set and capture checkpoint name.`;
				throw error;
			}
			return (await capture(request)).observation as Observation;
		},
		...pointRun.createPointApi(ensureOpen, { config, capture }),
		...noteRun.createNoteApi(ensureOpen, { config, capture }),
		async captureSet(rawRequest: CaptureSetRequest = {}): Promise<CaptureSetRun> {
			ensureOpen();
			const request = parseCaptureSetRequest(rawRequest);
			return runCaptureSet(captureSetHost(), request);
		},
		async compare(rawRequest: CompareRequest): Promise<CompareRun> {
			ensureOpen();
			const request = parseCompareRequest(rawRequest);
			return runCompare(captureSetHost(), request);
		},
		captureCheckpoints(rawRequest: CheckpointsRequest): Promise<CheckpointsRun> {
			return captureCheckpointsInRuntime(jobDeps, rawRequest);
		},
		runJob(rawRequest: JobRunRequest): Promise<JobRun> {
			return runJobInRuntime(jobDeps, rawRequest);
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
		async run(rawRequest: RunRequest): Promise<StoryRun | GateRun> {
			ensureOpen();
			const request = parseRunRequest(rawRequest);
			const gateCase = gateById.get(request.id);
			if (gateCase) {
				return runGate(gateCase, request, { capture: request.capture ?? 'none' });
			}
			const { capture: captureMode, ...storyReq } = request;
			return runStory(storyReq, { ...(captureMode ? { capture: captureMode } : {}) });
		},
		async matrix(rawRequest: MatrixRequest): Promise<MatrixRun> {
			ensureOpen();
			const request = parseMatrixRequest(rawRequest);
			const entry = config.entries.find((item) => item.id === request.id);
			if (!entry) throw new Error(`Specimen not found: ${request.id}`);
			const cells = matrixCells(request.axes);
			const axes = Object.keys(request.axes) as (keyof SpecimenContext)[];
			const checkpoint = request.checkpoint ?? (entry.story ? 'mount' : 'after-run');
			const workers = request.workers ?? config.config.test?.workers ?? DEFAULT_SUITE_WORKERS;
			const started = performance.now();
			const runtime = await ensureHost();
			await runtime.request('prepare', {}, BUNDLE_GRACE);
			// Each cell is a capture of its own, in its own browser context.
			const captures = await pool(cells, workers, async (cell) => {
				try {
					const { observation } = await capture(
						{
							id: entry.id,
							checkpoint,
							context: { ...request.context, ...cell },
							...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {}),
						},
						{ reuseBundle: true }
					);
					return { observation: observation as Observation };
				} catch (error) {
					return { reason: error instanceof Error ? error.message : String(error) };
				}
			});
			const baseline = captures.find((item) => item.observation)?.observation;
			const results: MatrixCell[] = cells.map((context, index) => {
				const { observation, reason } = captures[index] as {
					observation?: Observation;
					reason?: string;
				};
				if (!observation)
					return { context, status: 'unavailable', reason: reason as string, diff: null };
				const kept = request.observations ? { observation } : {};
				if (observation === baseline) return { context, status: 'captured', diff: null, ...kept };
				try {
					const diff = diffObservations(baseline as Observation, observation, {
						allowContextDifferences: axes,
					});
					return {
						context,
						status: 'captured',
						diff: {
							status: diff.status,
							channels: [...new Set(diff.differences.map((item) => item.channel))],
							differences: diff.differences.length,
							limitations: diff.limitations,
						},
						...kept,
					};
				} catch (error) {
					// Captured, but not comparable with the first: a story may settle its own context.
					return {
						context,
						status: 'captured',
						diff: {
							status: 'insufficient-evidence',
							channels: [],
							differences: 0,
							limitations: [error instanceof Error ? error.message : String(error)],
						},
						...kept,
					};
				}
			});
			const count = (status: NonNullable<MatrixCell['diff']>['status']) =>
				results.filter((cell) => cell.diff?.status === status).length;
			return {
				id: entry.id,
				checkpoint,
				axes,
				cells: results,
				counts: {
					total: results.length,
					captured: results.filter((cell) => cell.status === 'captured').length,
					unavailable: results.filter((cell) => cell.status === 'unavailable').length,
					changed: count('changed'),
					unchanged: count('no-change-observed'),
					insufficient: count('insufficient-evidence'),
				},
				elapsedMs: performance.now() - started,
			};
		},
		async profile(rawRequest: ProfileRequest = {}): Promise<ProfileRun> {
			ensureOpen();
			const request = parseProfileRequest(rawRequest);
			const baselines = await readBaselines();
			const entries = request.id
				? config.entries.filter((entry) => entry.id === request.id)
				: request.filter
					? selectEntries(config.entries, request.filter, config.root, config.config.pack?.library)
					: config.entries.filter((entry) => baselines?.stories[entry.id]);
			const orphaned = Object.keys(baselines?.stories ?? {}).filter(
				(id) => !config.entries.some((entry) => entry.id === id)
			);
			if (request.id && !entries.length) throw new Error(`Specimen not found: ${request.id}`);
			if (!entries.length)
				throw new Error(
					request.filter
						? 'No specimen or retained story matches the filter.'
						: `No entry has a recorded baseline${orphaned.length ? `, and ${orphaned.length} name no current entry (${orphaned.join(', ')})` : ''}. Give an id or a filter, or record one with specimen-baseline.`
				);
			const started = performance.now();
			const runtime = await ensureHost();
			await runtime.request('prepare', {}, BUNDLE_GRACE);
			const reports: ProfileReport[] = [];
			// One at a time: a neighbour's work would be in every measurement.
			for (const entry of entries)
				reports.push(
					await profileEntry(
						entry,
						request,
						request.runs ?? DEFAULT_PROFILE_RUNS,
						baselines?.stories[entry.id]
					)
				);
			return {
				reports,
				counts: profileCounts(reports),
				orphanedBaselines: orphaned,
				elapsedMs: performance.now() - started,
			};
		},
		async recordBaseline(rawRequest: BaselineRequest): Promise<ProfileRun> {
			ensureOpen();
			const request = parseBaselineRequest(rawRequest);
			if (!config.baselines)
				throw new Error(
					'Set profile.baselines in the configuration to say where baselines are kept.'
				);
			if (!request.id && !request.filter)
				throw new Error('Give an id or a filter; recording replaces what is there.');
			const entries = request.id
				? config.entries.filter((entry) => entry.id === request.id)
				: selectEntries(config.entries, request.filter, config.root, config.config.pack?.library);
			if (request.id && !entries.length) throw new Error(`Specimen not found: ${request.id}`);
			if (!entries.length) throw new Error('No specimen or retained story matches the filter.');
			const started = performance.now();
			const runtime = await ensureHost();
			await runtime.request('prepare', {}, BUNDLE_GRACE);
			const runs = request.runs ?? DEFAULT_BASELINE_RUNS;
			const reports: ProfileReport[] = [];
			let text = await readFile(config.baselines, 'utf8').catch((error: NodeJS.ErrnoException) => {
				if (error.code === 'ENOENT') return null;
				throw error;
			});
			let changed = false;
			for (const entry of entries) {
				const report = await profileEntry(entry, request, runs, undefined);
				reports.push(report);
				// A failed run records nothing, so it cannot replace a good baseline.
				if (report.summary === null) continue;
				text = withBaseline(
					text,
					config.baselines,
					entry.id,
					{
						storyId: entry.id,
						runner: BASELINE_RUNNER,
						viewport: report.viewport as string,
						checkpoint: report.checkpoint,
						browser: report.browser as string,
						runs,
						capturedAt: report.provenance.capturedAt,
						...(report.provenance.source ? { source: report.provenance.source } : {}),
						summary: report.summary,
					},
					request.notes ?? []
				);
				changed = true;
			}
			if (changed && text !== null) {
				const temporary = `${config.baselines}.${process.pid}.tmp`;
				await writeFile(temporary, text);
				await rename(temporary, config.baselines);
			}
			return {
				reports,
				counts: profileCounts(reports),
				orphanedBaselines: [],
				elapsedMs: performance.now() - started,
			};
		},
		async suggest(rawRequest: SuggestRequest): Promise<SuggestRun> {
			ensureOpen();
			return suggestInRuntime(config, (request) => api.coverage(request), rawRequest);
		},
		async contract(rawRequest: ContractRequest = {}): Promise<ContractRun> {
			ensureOpen();
			return runContract(
				{
					config,
					prepare: async () => {
						const runtime = await ensureHost();
						await runtime.request('prepare', {}, BUNDLE_GRACE);
					},
					inspect: (id) => api.inspect({ id }),
					runStory: (id, timeoutMs, observe) =>
						runStory(
							{ id, ...(timeoutMs ? { timeoutMs } : {}) },
							{ capture: 'all', reuseBundle: true, observe }
						),
				},
				parseContractRequest(rawRequest)
			);
		},
		async coverage(rawRequest: CoverageRequest = {}): Promise<CoverageRun> {
			ensureOpen();
			const request = parseCoverageRequest(rawRequest);
			if (request.obligations === JOBS_COVERAGE_OBLIGATIONS && request.captures !== undefined) {
				return readJobCoverageFromSet(config, {
					...request,
					obligations: JOBS_COVERAGE_OBLIGATIONS,
					captures: request.captures,
				});
			}
			return runCoverage(caseHost(), request);
		},
		async packBuild(rawRequest: PackBuildRequest = {}): Promise<PackBuildRun> {
			ensureOpen();
			const { allowFailed: _, ...request } = parsePackRequest(rawRequest);
			// A pack records the accessibility check of the component a case is about.
			return runPack(caseHost(true), {
				...request,
				...(rawRequest.index ? { index: rawRequest.index } : {}),
			});
		},
		async a11y(rawRequest: A11yRequest = {}): Promise<A11yRun> {
			ensureOpen();
			const request = parseA11yRequest(rawRequest);
			if (request.set !== undefined) {
				return readA11yFromSet(config.root, { ...request, set: request.set });
			}
			const entries = request.id
				? config.entries.filter((entry) => entry.id === request.id)
				: selectEntries(config.entries, request.filter, config.root, config.config.pack?.library);
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
		async themes(rawRequest: ThemesRequest = {}): Promise<ThemesRun> {
			ensureOpen();
			const runtime = await ensureHost();
			return runThemes(
				{
					entries: config.entries,
					root: config.root,
					localLibrary: config.config.pack?.library,
					workers: config.config.test?.workers ?? DEFAULT_SUITE_WORKERS,
					prepare: async () => void (await runtime.request('prepare', {}, BUNDLE_GRACE)),
					render: async (id, checkpoint, context, screenshot, timeoutMs) => {
						const request = {
							id,
							checkpoint,
							context,
							screenshot,
							...(timeoutMs ? { timeoutMs } : {}),
						};
						const { observation } = await capture(request, { reuseBundle: true });
						if (!observation) throw new Error('The render captured no frame.');
						return observation.manifest.context.theme;
					},
				},
				parseThemesRequest(rawRequest)
			);
		},
		async runSuite(rawRequest: SuiteRequest = {}): Promise<SuiteRun> {
			ensureOpen();
			const request = parseSuiteRequest(rawRequest);
			const targets = selectSuiteCases(
				config.entries,
				config.gateCases ?? [],
				request.filter,
				config.root,
				config.config.pack?.library
			);
			if (!targets.length) {
				const mentionsGates =
					(config.gateCases?.length ?? 0) > 0 ||
					Boolean(request.filter?.kind?.includes('gate')) ||
					request.filter?.pattern !== undefined;
				throw new Error(
					mentionsGates
						? 'No retained story or gate case matches the filter.'
						: 'No retained story matches the filter.'
				);
			}
			const workers = request.workers ?? config.config.test?.workers ?? DEFAULT_SUITE_WORKERS;
			const started = performance.now();
			const needsHost = targets.some((item) => {
				if (!isSynthesizedGateCase(item)) return true;
				const effective = effectiveGateContext(item.gate, request.context);
				return checkImplementationContexts(effective, item.contexts) === undefined;
			});
			let runtime: HostProcess | undefined;
			if (needsHost) {
				runtime = await ensureHost();
				// One snapshot of the sources for the whole suite, so that a change during the run cannot
				// mix two generations; `sourcesChanged` reports one.
				await runtime.request('prepare', {}, BUNDLE_GRACE);
			}
			const suite = await executeSuite(
				config.root,
				targets,
				async (item) => {
					if (isSynthesizedGateCase(item)) {
						const { outcome, observation } = await runGate(
							item,
							{
								id: item.id,
								...(request.context ? { context: request.context } : {}),
								...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {}),
							},
							{ capture: request.capture ?? 'failed', reuseBundle: true }
						);
						return { outcome, observation };
					}
					const { outcome, observation } = await runStory(
						{
							id: item.id,
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
			const stale = runtime
				? ((await runtime.request('stale', {}, HOST_GRACE)) as { stale: boolean }).stale
				: false;
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
	return api;
}
