import { dirname, resolve } from 'node:path';
import { BenchWorkerClient } from './bench-worker-client.js';
import { type LoadedConfig, loadConfig, resolveContext } from './config.js';
import { migrateStories, validateDiscovery } from './stories.js';
import type {
	A11yRequest,
	A11yRun,
	BaselineRequest,
	BenchOptions,
	CaptureRequest,
	ContractRequest,
	ContractRun,
	CoverageRequest,
	CoverageRun,
	InspectRequest,
	InspectResult,
	MatrixRequest,
	MatrixRun,
	MigrateRequest,
	MigrationReport,
	Observation,
	ProfileRequest,
	ProfileRun,
	RunRequest,
	SpecimenEntry,
	StoryRun,
	SuggestRequest,
	SuggestRun,
	SuiteRequest,
	SuiteRun,
	ValidationReport,
	ValidationTarget,
} from './types.js';
import {
	parseA11yRequest,
	parseBaselineRequest,
	parseCaptureRequest,
	parseContractRequest,
	parseCoverageRequest,
	parseMatrixRequest,
	parseProfileRequest,
	parseSuggestRequest,
	parseSuiteRequest,
} from './validate.js';

/** Discovery found stories it cannot index; `validate()` reports each problem. */
export class DiscoveryError extends Error {
	readonly code = 'SPECIMEN_DISCOVERY_FAILED';
	constructor(readonly problems: string[]) {
		super(
			`Story discovery failed with ${problems.length} problem${problems.length === 1 ? '' : 's'}: ${problems.join('; ')}`
		);
	}
}

export interface SpecimenBench {
	/** Native specimens and discovered stories; throws a `DiscoveryError` if discovery failed. */
	list(): SpecimenEntry[];
	/**
	 * Static validation of discovered stories, optionally one story or file: identity, format
	 * and annotation support, and what only running the module can settle. Never throws for
	 * problems it finds.
	 */
	validate(target?: ValidationTarget): ValidationReport;
	render(request: CaptureRequest): Promise<Observation>;
	/**
	 * Run a retained story as Storybook's Vitest addon runs it: render, play, then the
	 * accessibility check under its effective policy. A story that fails to render fails its run.
	 */
	run(request: RunRequest): Promise<StoryRun>;
	/**
	 * Run a suite of retained stories against one snapshot of the sources, with worker limits and
	 * an optional once-only retry of failures.
	 */
	runSuite(request?: SuiteRequest): Promise<SuiteRun>;
	/**
	 * Run an accessibility check at a checkpoint, on one entry or those a filter selects: violations,
	 * what axe could not decide, and the exceptions that applied. A story keeps its effective policy.
	 */
	a11y(request?: A11yRequest): Promise<A11yRun>;
	/**
	 * Run the cases a filter selects and report each component's required partitions at the level
	 * those runs earn: represented, asserted, verified, missing or unknown. A schema alone proves
	 * nothing, and an obligation nothing could show stays unknown.
	 */
	coverage(request?: CoverageRequest): Promise<CoverageRun>;
	/**
	 * Run a story file's cases and report what FAST-AF's Fastbot would, on evidence from the run
	 * instead of source text: co-located stories, the accessibility policy, plays, baseline and
	 * state stories, and form evidence.
	 */
	contract(request?: ContractRequest): Promise<ContractRun>;
	/**
	 * Propose native specimens and claims for a component's gaps, always as unverified: run them
	 * and correct them. Generating these never changes what coverage reports.
	 */
	suggest(request: SuggestRequest): Promise<SuggestRun>;
	/**
	 * Measure entries at a checkpoint over a few fresh runs, one at a time: paint and load timings,
	 * ready and capture time, DOM size, requests, heap and console counts, flags and, when a
	 * baseline describes the same measurement, a comparison. Neither id nor filter profiles
	 * everything with a baseline. Chromium only.
	 */
	profile(request?: ProfileRequest): Promise<ProfileRun>;
	/**
	 * One isolated capture per combination of the context axes. Comparable cells diff against the
	 * first; a cell that could not be captured stays visible, with its reason.
	 */
	matrix(request: MatrixRequest): Promise<MatrixRun>;
	/** Profile and record the results in `profile.baselines`, keeping budgets a person set. */
	recordBaseline(request: BaselineRequest): Promise<ProfileRun>;
	/**
	 * Resolve one specimen or retained story without capturing it: its args, its context and
	 * its component's schema, from the manifest and the plugins' schema sources.
	 */
	inspect(request: InspectRequest): Promise<InspectResult>;
	/**
	 * The preview-first codemod over the configured story files: a file-by-file report of the
	 * component it can name, the metadata it keeps and the manual tasks left. Writes only with
	 * `apply: true`, and never removes metadata.
	 */
	migrate(request?: MigrateRequest): Promise<MigrationReport>;
	build(
		outDir: string
	): Promise<{ directory: string; shellBytes: number; budget: number; files: string[] }>;
	close(): Promise<void>;
}

export async function createSpecimenBench(options: BenchOptions): Promise<SpecimenBench> {
	// Validate once, before returning metadata. Either backend receives this exact snapshot,
	// including resolved module paths and digest, rather than rereading a changed config.
	let config: LoadedConfig | undefined = await loadConfig(options);
	for (const entry of config.entries) Object.freeze(entry);
	Object.freeze(config.entries);
	Object.freeze(config.config);
	Object.freeze(config.modules);
	Object.freeze(config);
	const executablePath = options.executablePath;
	const runtimeIsolation = options.runtimeIsolation ?? 'in-process';
	type Backend = Pick<
		SpecimenBench,
		| 'render'
		| 'run'
		| 'runSuite'
		| 'a11y'
		| 'coverage'
		| 'contract'
		| 'suggest'
		| 'profile'
		| 'matrix'
		| 'recordBaseline'
		| 'inspect'
		| 'build'
		| 'close'
	>;
	let backend: Backend | undefined;
	let closed = false;
	let closing: Promise<void> | undefined;
	let pending: Promise<unknown> = Promise.resolve();
	const ensureOpen = (): LoadedConfig => {
		if (closed || !config) throw new Error('Specimen bench is closed');
		return config;
	};
	/** Listing and rendering need a discovery without errors. */
	const ensureDiscovered = (): LoadedConfig => {
		const snapshot = ensureOpen();
		const errors = snapshot.stories?.discovery.errors ?? [];
		if (errors.length) throw new DiscoveryError(errors.map((problem) => problem.message));
		return snapshot;
	};
	const enqueue = <T>(operation: (runtime: Backend) => Promise<T>): Promise<T> => {
		const snapshot = ensureOpen();
		const result = pending.then(async () => {
			if (!backend) {
				backend =
					runtimeIsolation === 'process'
						? new BenchWorkerClient(snapshot, executablePath)
						: await (await import('./bench-runtime.js')).createInProcessBench(
								{ root: snapshot.root, executablePath },
								snapshot
							);
			}
			return operation(backend);
		});
		// An individual render error must not poison later work or close.
		pending = result.catch(() => {});
		return result;
	};
	return {
		list() {
			return ensureDiscovered().entries.map((entry) => ({ ...entry }));
		},
		validate(target) {
			const snapshot = ensureOpen();
			const discovery = snapshot.stories?.discovery;
			if (!discovery) {
				const known = !target?.id || snapshot.entries.some((entry) => entry.id === target.id);
				return {
					valid: known,
					scope: 'static',
					checked: 0,
					issues: known
						? []
						: [
								{
									severity: 'error',
									code: 'SPECIMEN_NOT_FOUND',
									message: `Specimen not found: ${target?.id}`,
									suggestion: 'Use specimen-list to check the id.',
								},
							],
				};
			}
			const tags = Object.keys(snapshot.schemas);
			const report = validateDiscovery(
				discovery,
				snapshot.root,
				target,
				tags.length ? new Set(tags) : undefined
			);
			if (target?.id && !snapshot.entries.some((entry) => entry.id === target.id))
				return {
					...report,
					valid: false,
					issues: [
						{
							severity: 'error',
							code: 'SPECIMEN_NOT_FOUND',
							message: `Specimen not found: ${target.id}`,
							suggestion:
								'Use specimen-list to check the id, or validate the file to see why it was not indexed.',
						},
						...report.issues,
					],
				};
			return report;
		},
		async render(rawRequest) {
			const snapshot = ensureDiscovered();
			const request = parseCaptureRequest(rawRequest);
			if (!snapshot.entries.some((entry) => entry.id === request.id))
				throw new Error(`Specimen not found: ${request.id}`);
			// Resolve context here too: invalid requests never start a runtime.
			resolveContext(request.context);
			return enqueue((client) => client.render(request));
		},
		async run(rawRequest) {
			const snapshot = ensureDiscovered();
			const request = parseCaptureRequest(rawRequest);
			if (request.checkpoint !== undefined)
				throw new Error('A run always ends at the after-run checkpoint; omit checkpoint.');
			if (!snapshot.entries.some((entry) => entry.id === request.id))
				throw new Error(`Specimen not found: ${request.id}`);
			resolveContext(request.context);
			return enqueue((client) => client.run(request));
		},
		async matrix(rawRequest) {
			ensureDiscovered();
			const request = parseMatrixRequest(rawRequest);
			return enqueue((client) => client.matrix(request));
		},
		async profile(rawRequest = {}) {
			ensureDiscovered();
			const request = parseProfileRequest(rawRequest);
			return enqueue((client) => client.profile(request));
		},
		async recordBaseline(rawRequest) {
			ensureDiscovered();
			const request = parseBaselineRequest(rawRequest);
			return enqueue((client) => client.recordBaseline(request));
		},
		async suggest(rawRequest) {
			ensureDiscovered();
			const request = parseSuggestRequest(rawRequest);
			return enqueue((client) => client.suggest(request));
		},
		async contract(rawRequest = {}) {
			ensureDiscovered();
			const request = parseContractRequest(rawRequest);
			return enqueue((client) => client.contract(request));
		},
		async coverage(rawRequest = {}) {
			ensureDiscovered();
			const request = parseCoverageRequest(rawRequest);
			return enqueue((client) => client.coverage(request));
		},
		async a11y(rawRequest = {}) {
			ensureDiscovered();
			const request = parseA11yRequest(rawRequest);
			return enqueue((client) => client.a11y(request));
		},
		async runSuite(rawRequest = {}) {
			ensureDiscovered();
			const request = parseSuiteRequest(rawRequest);
			return enqueue((client) => client.runSuite(request));
		},
		async inspect(rawRequest) {
			const snapshot = ensureDiscovered();
			const request = parseCaptureRequest(rawRequest);
			if (request.checkpoint !== undefined || request.screenshot !== undefined)
				throw new Error('Inspection takes an id, a context and a timeout only.');
			if (!snapshot.entries.some((entry) => entry.id === request.id))
				throw new Error(`Specimen not found: ${request.id}`);
			resolveContext(request.context);
			return enqueue((client) => client.inspect(request));
		},
		async migrate(request = {}) {
			const snapshot = ensureOpen();
			if (!snapshot.config.stories)
				throw new Error('The codemod migrates retained stories; this configuration names none.');
			return migrateStories(snapshot.root, dirname(snapshot.file), snapshot.config, request);
		},
		async build(outDir) {
			ensureDiscovered();
			const directory = resolve(outDir);
			return enqueue((client) => client.build(directory));
		},
		close() {
			closing ??= (async () => {
				closed = true;
				try {
					await pending;
					await backend?.close();
				} finally {
					backend = undefined;
					config = undefined;
					pending = Promise.resolve();
				}
			})();
			return closing;
		},
	};
}
