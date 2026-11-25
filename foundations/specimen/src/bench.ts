import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { BenchWorkerClient } from './bench-worker-client.js';
import { selectCompareEntries } from './compare.js';
import { type LoadedConfig, loadConfig, resolveContext } from './config.js';
import { checkDecisions, getDecision, listDecisions, recordDecision } from './decisions.js';
import { withGuides } from './guides.js';
import type { SpecimenHostError } from './host.js';
import { JOBS_COVERAGE_OBLIGATIONS, readJobCoverageFromSet } from './job-coverage.js';
import { type JobSource, loadJobSourceModule, parseJobScenarioWithSources } from './job-source.js';
import {
	buildJobCaptures,
	readA11yFromSet,
	readObservationFromSet,
	resolveJobCapturePlan,
	resolvePinnedBaseline,
	withJobValidation,
} from './jobs.js';
import {
	listNotes,
	readAllNoteFiles,
	readNoteFile,
	reopenNote,
	requireNoteReason,
	requireNoteText,
	resolveNotes,
} from './note.js';
import {
	checkCommitted,
	exportPack,
	packConfig,
	readPackIndex,
	writePack,
	writePackIndex,
} from './pack-files.js';
import {
	checkImplementationContexts,
	effectiveGateContext,
	filterAndPaginateListEntries,
	listEntriesOf,
} from './pattern-gates.js';
import { withPatterns } from './patterns.js';
import {
	diffRecordedDigests,
	normalizePointContextInput,
	pointError,
	readPointFile,
	specimenNotFoundError,
} from './point.js';
import { parsePointer } from './pointer.js';
import {
	assertRealContained,
	diffCaptures,
	selectCaptureEntries,
	specimenDataDir,
	withFileLock,
	writeFileAtomic,
} from './sets.js';
import { migrateStories, validateDiscovery } from './stories.js';
import type {
	A11yRequest,
	A11yRun,
	BaselineRequest,
	BenchOptions,
	CaptureRequest,
	CaptureSetRequest,
	CaptureSetRun,
	CheckpointsRequest,
	CheckpointsRun,
	CompareRequest,
	CompareRun,
	ContractRequest,
	ContractRun,
	CoverageRequest,
	CoverageRun,
	DecisionCheckRequest,
	DecisionCheckResult,
	DecisionGetRequest,
	DecisionGetResult,
	DecisionListResult,
	DecisionRecordRequest,
	DecisionRecordResult,
	DiffRequest,
	GateRun,
	InspectRequest,
	InspectResult,
	JobCreateRequest,
	JobCreateResult,
	JobRun,
	JobRunRequest,
	MatrixRequest,
	MatrixRun,
	MigrateRequest,
	MigrationReport,
	NoteAddRequest,
	NoteCheckRequest,
	NoteCheckResult,
	NoteListRequest,
	NoteListResult,
	NoteMoveRequest,
	NoteReopenRequest,
	NoteResolveRequest,
	NoteResolveResult,
	NoteResult,
	Observation,
	ObservationDiff,
	PackBuildRequest,
	PackBuildRun,
	PackCheckRun,
	PackExportRequest,
	PackExportRun,
	PackRequest,
	PackRun,
	PointCheckRequest,
	PointCheckResult,
	PointMoveRequest,
	PointRequest,
	PointResult,
	ProfileRequest,
	ProfileRun,
	RecordDecisionOptions,
	RunRequest,
	SpecimenEntry,
	SpecimenListFilter,
	StoryRun,
	SuggestRequest,
	SuggestRun,
	SuiteRequest,
	SuiteRun,
	ThemesRequest,
	ThemesRun,
	ValidationReport,
	ValidationTarget,
} from './types.js';
import {
	parseA11yRequest,
	parseBaselineRequest,
	parseCaptureRequest,
	parseCaptureSetRequest,
	parseCheckpointsRequest,
	parseCompareRequest,
	parseConfig,
	parseContractRequest,
	parseCoverageRequest,
	parseJobCreateRequest,
	parseJobRunRequest,
	parseMatrixRequest,
	parseNoteAddRequest,
	parseNoteCheckRequest,
	parseNoteListRequest,
	parseNoteMoveRequest,
	parseNoteReopenRequest,
	parseNoteResolveRequest,
	parsePackExportRequest,
	parsePackRequest,
	parsePointCheckRequest,
	parsePointMoveRequest,
	parsePointRequest,
	parseProfileRequest,
	parseRunRequest,
	parseSuggestRequest,
	parseSuiteRequest,
	parseThemesRequest,
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
	list(filter?: SpecimenListFilter): SpecimenEntry[];
	/**
	 * Static validation of discovered stories, optionally one story or file: identity, format
	 * and annotation support, and what only running the module can settle. Never throws for
	 * problems it finds.
	 */
	validate(target?: ValidationTarget): ValidationReport;
	render(request: CaptureRequest): Promise<Observation>;
	/**
	 * Capture many specimens in one context and checkpoint into a content-addressed capture set
	 * under `.specimen/sets/`, returning ids and counts only.
	 */
	captureSet(request?: CaptureSetRequest): Promise<CaptureSetRun>;
	/**
	 * Capture 2 to 8 variant specimens with axe under one context and checkpoint into a `compare`
	 * capture set, diff each against the first, and return compact summaries plus `compare.html?set=`.
	 */
	compare(request: CompareRequest): Promise<CompareRun>;
	/**
	 * Capture multiple named checkpoints of one native specimen in a single fresh render,
	 * persisting a content-addressed capture set keyed `<id>/<step>` with axe and screenshots.
	 */
	captureCheckpoints(request: CheckpointsRequest): Promise<CheckpointsRun>;
	/**
	 * Scaffold or update a job specimen entry in `specimen.config.json` from a scenario file,
	 * copying exact step descriptions and refusing undescribed steps (`STEP_HAS_NO_DESCRIPTION`).
	 */
	createJob(request: JobCreateRequest): Promise<JobCreateResult>;
	/**
	 * Run a job specimen once in a fresh browser context via its registered `JobDriver` plugin,
	 * capturing marked steps into a content-addressed capture set keyed `<id>/<step>`.
	 */
	runJob(request: JobRunRequest): Promise<JobRun>;
	/** Compare two observations or `{ set, id }` set references against `.specimen/sets/`. */
	diff(request: DiffRequest): Promise<ObservationDiff>;
	/**
	 * Run a retained story (render, play, accessibility check) or a synthesized pattern gate case
	 * (setup mount + portable gate steps). A story or gate that fails its assertions still returns
	 * a structured outcome.
	 */
	run(request: RunRequest): Promise<StoryRun | GateRun>;
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
	 * Render each entry, or those a filter selects, in every theme and compare the frames: which
	 * follow the theme, which stay the same and declare it, and which stay the same with nothing
	 * declaring it (`undeclared`, which makes the run invalid). Not part of a run; ask for it.
	 */
	themes(request?: ThemesRequest): Promise<ThemesRun>;
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
	/**
	 * Build the configured library's component pack from two passes over every case, and write its
	 * committed form: one record per component and the library's rules. Nothing is written from a
	 * run with failed cases unless `allowFailed` names each of them.
	 */
	pack(request?: PackRequest): Promise<PackRun>;
	/** Build the pack as `pack()` does, write nothing, and report the committed files that differ. */
	packCheck(request?: PackRequest): Promise<PackCheckRun>;
	/**
	 * Write the exported form from the committed records, with no browser: the records, the rules
	 * and a catalog stamped with the package. Refuses, naming the records, when the manifest or a
	 * guide file says something they do not.
	 */
	packExport(request: PackExportRequest): Promise<PackExportRun>;
	/**
	 * Resolve a pointer URI or named target (`{ role, name? }` or `{ selector }`) through the
	 * shared two-step climb, store the bounded point in `.specimen/points/<id>.json`, and return it.
	 */
	point(request: PointRequest): Promise<PointResult>;
	/**
	 * Move a stored point to its `parent`, `child`, `next`, `previous`, or enclosing `component`
	 * after verifying staleness (`POINT_STALE`), storing and returning the new point.
	 */
	pointMove(request: PointMoveRequest): Promise<PointResult>;
	/** Re-render a stored point's specimen and report whether its source or identity is current or stale. */
	pointCheck(request: PointCheckRequest): Promise<PointCheckResult>;
	/** Pin a new note to a fresh point or pointer URI and write it under `specimens/notes/<id>.json`. */
	noteAdd(request: NoteAddRequest): Promise<NoteResult>;
	/** List committed notes from `specimens/notes/` with filtering and cursor paging (no browser). */
	noteList(request?: NoteListRequest): Promise<NoteListResult>;
	/** Re-resolve open notes against current renders, updating `orphaned` flags and reporting weakened/unchecked/restored notes. */
	noteCheck(request?: NoteCheckRequest): Promise<NoteCheckResult>;
	/** Re-pin a note to a fresh point or pointer URI with a reason, clearing `orphaned` and recording history. */
	noteMove(request: NoteMoveRequest): Promise<NoteResult>;
	/** Resolve one (`id`) or several (`ids`) notes with an outcome, required reason, and optional evidence (no browser). */
	noteResolve(request: NoteResolveRequest): Promise<NoteResolveResult>;
	/** Reopen a resolved note with a reason, preserving its prior resolution in history (no browser). */
	noteReopen(request: NoteReopenRequest): Promise<NoteResult>;
	/** Record a design decision (choice, supersession, or review answer) under `specimens/decisions/`. */
	recordDecision(
		request: DecisionRecordRequest,
		options?: RecordDecisionOptions
	): Promise<DecisionRecordResult>;
	/** Read a recorded design decision by id, including committed `evidence.captures` for choices. */
	getDecision(request: DecisionGetRequest): Promise<DecisionGetResult>;
	/** List current choice decisions sorted by id ascending (with stale globs) and undecided comparison sets. */
	listDecisions(): Promise<DecisionListResult>;
	/** Return current choice decisions covering any of the given `files`, `specimens`, or `tokens`. */
	checkDecisions(request?: DecisionCheckRequest): Promise<DecisionCheckResult>;
	build(
		outDir: string
	): Promise<{ directory: string; shellBytes: number; budget: number; files: string[] }>;
	close(): Promise<void>;
}

/** What runs a bench's browser work, in this process or a worker: the bench without its file work. */
export type BenchRuntime = Omit<
	SpecimenBench,
	| 'validate'
	| 'migrate'
	| 'pack'
	| 'packCheck'
	| 'packExport'
	| 'diff'
	| 'createJob'
	| 'noteList'
	| 'noteResolve'
	| 'noteReopen'
	| 'recordDecision'
	| 'getDecision'
	| 'listDecisions'
	| 'checkDecisions'
> & {
	/** Build the configured pack from two passes over every case, and write nothing. */
	packBuild(request?: PackBuildRequest): Promise<PackBuildRun>;
};

/** What static validation says of the configured specimens and stories. */
function validateEntries(snapshot: LoadedConfig, target?: ValidationTarget): ValidationReport {
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
}

export async function createSpecimenBench(options: BenchOptions): Promise<SpecimenBench> {
	// Validate once, before returning metadata. Either backend receives this exact snapshot,
	// including resolved module paths and digest, rather than rereading a changed config.
	const freezeConfig = (loaded: LoadedConfig): LoadedConfig => {
		for (const entry of loaded.entries) Object.freeze(entry);
		Object.freeze(loaded.entries);
		Object.freeze(loaded.config);
		Object.freeze(loaded.modules);
		return Object.freeze(loaded);
	};
	let config: LoadedConfig | undefined = freezeConfig(await loadConfig(options));
	const executablePath = options.executablePath;
	const runtimeIsolation = options.runtimeIsolation ?? 'in-process';
	const inlineJobSources: JobSource[] = [...(options.jobSources ?? [])];
	let loadedJobSources: JobSource[] | undefined;
	const getJobSources = async (snapshot: LoadedConfig): Promise<JobSource[]> => {
		if (loadedJobSources) return loadedJobSources;
		const sources: JobSource[] = [...inlineJobSources];
		for (const modulePath of snapshot.jobSourceModules) {
			sources.push(...(await loadJobSourceModule(modulePath)));
		}
		loadedJobSources = sources;
		return sources;
	};
	type Backend = Pick<
		BenchRuntime,
		| 'packBuild'
		| 'render'
		| 'captureSet'
		| 'compare'
		| 'captureCheckpoints'
		| 'runJob'
		| 'run'
		| 'runSuite'
		| 'a11y'
		| 'themes'
		| 'coverage'
		| 'contract'
		| 'suggest'
		| 'profile'
		| 'matrix'
		| 'recordBaseline'
		| 'inspect'
		| 'point'
		| 'pointMove'
		| 'pointCheck'
		| 'noteAdd'
		| 'noteCheck'
		| 'noteMove'
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
	/**
	 * Reads the latest config snapshot for an operation accepted before close() started
	 * draining `pending`. `close()` clears `config` only after `pending` settles.
	 */
	const currentConfig = (): LoadedConfig => {
		if (!config) throw new Error('Specimen bench is closed');
		return config;
	};
	/** Listing and rendering need a discovery without errors. */
	const ensureDiscovered = (): LoadedConfig => {
		const snapshot = ensureOpen();
		const errors = snapshot.stories?.discovery.errors ?? [];
		if (errors.length) throw new DiscoveryError(errors.map((problem) => problem.message));
		return snapshot;
	};
	const ensureBackend = async (current: LoadedConfig): Promise<Backend> => {
		if (!backend) {
			backend =
				runtimeIsolation === 'process'
					? new BenchWorkerClient(current, executablePath)
					: await (await import('./bench-runtime.js')).createInProcessBench(
							{
								root: current.root,
								executablePath,
								...(inlineJobSources.length > 0 ? { jobSources: inlineJobSources } : {}),
							},
							current
						);
		}
		return backend;
	};
	const enqueue = <T>(operation: (runtime: Backend) => Promise<T>): Promise<T> => {
		ensureOpen();
		const result = pending.then(async () => operation(await ensureBackend(currentConfig())));
		// An individual render error must not poison later work or close.
		pending = result.catch(() => {});
		return result;
	};
	const enqueueLocal = <T>(operation: (current: LoadedConfig) => Promise<T>): Promise<T> => {
		ensureOpen();
		const result = pending.then(() => operation(currentConfig()));
		pending = result.catch(() => {});
		return result;
	};
	const refreshConfigIfChanged = async (current: LoadedConfig): Promise<LoadedConfig> => {
		const configText = await readFile(current.file, 'utf8').catch(() => null);
		const configDigest =
			configText === null ? null : createHash('sha256').update(configText).digest('hex');
		let manifestChanged = false;
		if (current.manifestFile) {
			const manifestText = await readFile(current.manifestFile, 'utf8').catch(() => null);
			const manifestDigest =
				manifestText === null ? null : createHash('sha256').update(manifestText).digest('hex');
			manifestChanged = manifestDigest !== (current.manifestDigest ?? null);
		}
		if (configDigest === current.digest && !manifestChanged) return current;
		const reloaded = freezeConfig(await loadConfig(options));
		if (reloaded.stories?.discovery.errors.length) {
			throw new Error(reloaded.stories.discovery.errors.join('\n'));
		}
		config = reloaded;
		loadedJobSources = undefined;
		if (backend) {
			const oldBackend = backend;
			backend = undefined;
			await oldBackend.close();
		}
		return reloaded;
	};
	/** Build with the last full build's index for one component, and keep a full build's index. */
	const packBuild = async (snapshot: LoadedConfig, rawRequest: PackRequest) => {
		packConfig(snapshot);
		const { allowFailed, ...request } = parsePackRequest(rawRequest);
		const index = request.component ? await readPackIndex(snapshot) : undefined;
		const build = await enqueue((client) =>
			client.packBuild({ ...request, ...(index ? { index } : {}) })
		);
		await writePackIndex(snapshot, build);
		return { build, allowFailed };
	};
	return {
		list(filter?: SpecimenListFilter) {
			const snapshot = ensureDiscovered();
			const localLibrary = snapshot.config.pack?.library;
			const entries = listEntriesOf(snapshot.entries, snapshot.gateCases, localLibrary);
			return filterAndPaginateListEntries(entries, filter, localLibrary).specimens;
		},
		validate(target) {
			const snapshot = ensureOpen();
			const withGuideIssues = withGuides(
				validateEntries(snapshot, target),
				snapshot.guides,
				snapshot.root,
				target
			);
			const withPatternIssues = withPatterns(
				withGuideIssues,
				snapshot.patterns,
				snapshot.root,
				target
			);
			return withJobValidation(withPatternIssues, snapshot.jobValidation, target, snapshot.root);
		},
		async render(rawRequest) {
			const snapshot = ensureDiscovered();
			const request = parseCaptureRequest(rawRequest);
			if (request.set !== undefined) {
				if (request.screenshot !== undefined) {
					throw new Error(
						'A saved capture set already keeps screenshots; omit screenshot when passing set.'
					);
				}
				return readObservationFromSet(snapshot.root, {
					id: request.id,
					set: request.set,
					...(request.checkpoint !== undefined ? { checkpoint: request.checkpoint } : {}),
				});
			}
			const entry = snapshot.entries.find((item) => item.id === request.id);
			if (!entry) throw new Error(`Specimen not found: ${request.id}`);
			if (entry.job) {
				const error: SpecimenHostError = new Error(
					`Specimen '${entry.id}' is a job specimen and cannot be rendered without a capture set.`
				);
				error.code = 'JOB_NEEDS_RUN';
				error.suggestion = `Run specimen-job-run for '${entry.id}', then call specimen-render with its set and capture checkpoint name.`;
				throw error;
			}
			// Resolve context here too: invalid requests never start a runtime.
			resolveContext(request.context);
			return enqueue((client) => client.render(request));
		},
		async captureSet(rawRequest = {}) {
			const snapshot = ensureDiscovered();
			const request = parseCaptureSetRequest(rawRequest);
			const includeJobs =
				(snapshot.jobSourceModules.length > 0 ||
					(runtimeIsolation !== 'process' && inlineJobSources.length > 0)) &&
				snapshot.plugins.length > 0;
			const allEntries = [
				...snapshot.entries,
				...(snapshot.gateCases ?? []).map((gateCase) => gateCase.entry),
			];
			selectCaptureEntries(allEntries, request, snapshot.root, {
				includeJobs,
				localLibrary: snapshot.config.pack?.library,
			});
			resolveContext(request.context);
			return enqueue((client) => client.captureSet(request));
		},
		async compare(rawRequest) {
			const snapshot = ensureDiscovered();
			const request = parseCompareRequest(rawRequest);
			const context = resolveContext(request.context);
			selectCompareEntries(snapshot.entries, request, context);
			return enqueue((client) => client.compare(request));
		},
		async captureCheckpoints(rawRequest) {
			const snapshot = ensureDiscovered();
			const request = parseCheckpointsRequest(rawRequest);
			if (!snapshot.entries.some((entry) => entry.id === request.id))
				throw new Error(`Specimen not found: ${request.id}`);
			resolveContext(request.context);
			resolvePinnedBaseline(request.pin);
			return enqueue((client) => client.captureCheckpoints(request));
		},
		async createJob(rawRequest) {
			ensureOpen();
			const operation = pending.then(async (): Promise<JobCreateResult> => {
				const snapshot = currentConfig();
				const request = parseJobCreateRequest(rawRequest);
				const base = dirname(snapshot.file);
				const candidateModule = resolve(base, request.module);
				const relFromRoot = relative(snapshot.root, candidateModule);
				if (relFromRoot === '..' || relFromRoot.startsWith(`..${sep}`) || isAbsolute(relFromRoot)) {
					const error: SpecimenHostError = new Error(
						`Specimen module escapes the configured root: ${request.module}`
					);
					error.code = 'JOB_SCENARIO_INVALID';
					error.suggestion = 'Keep specimen modules inside the configured Specimen project root.';
					throw error;
				}
				try {
					const resolvedModule = await realpath(candidateModule);
					const resolvedRel = relative(snapshot.root, resolvedModule);
					if (
						resolvedRel === '..' ||
						resolvedRel.startsWith(`..${sep}`) ||
						isAbsolute(resolvedRel)
					) {
						throw new Error(`Specimen module escapes the configured root: ${request.module}`);
					}
				} catch (error) {
					const wrapped: SpecimenHostError = new Error(
						`Cannot resolve specimen module '${request.module}': ${error instanceof Error ? error.message : String(error)}`
					);
					wrapped.code = 'JOB_SCENARIO_INVALID';
					wrapped.suggestion = `Verify that '${request.module}' exists inside the project root.`;
					throw wrapped;
				}
				resolvePinnedBaseline(request.pin);
				const provisionalEntry: SpecimenEntry = {
					id: request.id,
					title: request.title ?? request.id,
					module: request.module,
					exportName: request.exportName,
					job: {
						scenario: request.scenario,
						target: request.target,
						...(request.runner !== undefined ? { runner: request.runner } : {}),
						...(request.pin !== undefined && Object.keys(request.pin).length > 0
							? { pin: request.pin }
							: {}),
						captures: [],
					},
				};
				const scenario = await parseJobScenarioWithSources(await getJobSources(snapshot), {
					root: snapshot.root,
					base,
					entry: provisionalEntry,
				});
				const captures = buildJobCaptures(scenario, request.captures);
				const configEntry = {
					id: request.id,
					title: request.title ?? (scenario.name?.trim() || request.id),
					module: request.module,
					exportName: request.exportName,
					job: {
						scenario: request.scenario,
						target: request.target,
						...(request.runner !== undefined ? { runner: request.runner } : {}),
						...(request.pin !== undefined && Object.keys(request.pin).length > 0
							? { pin: request.pin }
							: {}),
						captures,
					},
				};
				const nonJobCollision = snapshot.entries.find(
					(item) => item.id === request.id && item.job === undefined
				);
				if (nonJobCollision) {
					const error: SpecimenHostError = new Error(
						`Specimen '${request.id}' already exists as a non-job specimen and cannot be overwritten as a job.`
					);
					error.code = 'NOT_A_JOB';
					error.suggestion =
						'Choose a distinct id for the job specimen, or use specimen-list with kind: job to see existing job specimens.';
					throw error;
				}
				const lockPath = join(specimenDataDir(snapshot.root), '.config.lock');
				await assertRealContained(
					snapshot.root,
					lockPath,
					`Configuration lock escapes root: ${lockPath}`
				);
				return withFileLock(lockPath, async () => {
					const rawConfig = JSON.parse(await readFile(snapshot.file, 'utf8')) as Record<
						string,
						unknown
					>;
					const currentSpecimens = Array.isArray(rawConfig.specimens)
						? [...(rawConfig.specimens as Record<string, unknown>[])]
						: [];
					const existingIndex = currentSpecimens.findIndex((item) => item.id === request.id);
					let mergedEntry: Record<string, unknown> = configEntry;
					if (existingIndex >= 0) {
						const existing = currentSpecimens[existingIndex];
						if (!existing || existing.job === undefined) {
							const error: SpecimenHostError = new Error(
								`Specimen '${request.id}' already exists as a component specimen and cannot be overwritten as a job.`
							);
							error.code = 'NOT_A_JOB';
							error.suggestion =
								'Choose a distinct id for the job specimen, or use specimen-list with kind: job to see existing job specimens.';
							throw error;
						}
						mergedEntry = {
							...existing,
							...configEntry,
							title:
								request.title ??
								(typeof existing.title === 'string' && existing.title.length > 0
									? existing.title
									: configEntry.title),
						};
						currentSpecimens[existingIndex] = mergedEntry;
					} else {
						currentSpecimens.push(configEntry);
					}
					const nextConfig = { ...rawConfig, specimens: currentSpecimens };
					parseConfig(nextConfig);
					await assertRealContained(
						snapshot.root,
						snapshot.file,
						`Configuration file escapes root: ${snapshot.file}`
					);
					await writeFileAtomic(snapshot.file, `${JSON.stringify(nextConfig, null, 2)}\n`);
					const reloaded = freezeConfig(await loadConfig(options));
					config = reloaded;
					loadedJobSources = undefined;
					if (backend) {
						const oldBackend = backend;
						backend = undefined;
						await oldBackend.close();
					}
					const written =
						relative(snapshot.root, snapshot.file).replaceAll('\\', '/') || basename(snapshot.file);
					const persisted = reloaded.entries.find((item) => item.id === request.id);
					return {
						written,
						entry: {
							...(persisted ?? configEntry),
							job: configEntry.job,
							kind: 'job' as const,
						},
					};
				});
			});
			pending = operation.catch(() => {});
			return operation;
		},
		async runJob(rawRequest) {
			const snapshot = ensureDiscovered();
			const request = parseJobRunRequest(rawRequest);
			const entry = snapshot.entries.find((item) => item.id === request.id);
			if (!entry) throw new Error(`Specimen not found: ${request.id}`);
			if (!entry.job) {
				const error = new Error(`Specimen '${entry.id}' is not a job specimen.`) as Error & {
					code?: string;
					suggestion?: string;
				};
				error.code = 'NOT_A_JOB';
				error.suggestion =
					'Use specimen-list with kind: job to find job specimens, or specimen-render for a component specimen.';
				throw error;
			}
			const scenario =
				request.scenario ??
				(await parseJobScenarioWithSources(await getJobSources(snapshot), {
					root: snapshot.root,
					base: dirname(snapshot.file),
					entry,
				}));
			// Validate capture step descriptions and runner presence before starting Chromium or a worker.
			resolveJobCapturePlan(entry, scenario);
			if (snapshot.plugins.length === 0) {
				const error: SpecimenHostError = new Error(
					`Job specimen '${entry.id}' requires a registered job driver plugin (such as '${entry.job.runner ?? 'afd'}'), but no plugins are configured.`
				);
				error.code = 'RUNNER_MISSING';
				error.suggestion =
					'Configure a Specimen plugin providing the job driver and command runner (such as @lushly-dev/specimen-afd-runner) in specimen.config.json plugins.';
				throw error;
			}
			resolveContext(request.context);
			resolvePinnedBaseline(request.pin ?? entry.job.pin);
			return enqueue((client) => client.runJob({ ...request, scenario }));
		},
		async diff(request) {
			const snapshot = ensureOpen();
			return diffCaptures(snapshot.root, request);
		},
		async run(rawRequest) {
			const snapshot = ensureDiscovered();
			const raw = rawRequest as Record<string, unknown> | undefined;
			if (raw && (raw.checkpoint !== undefined || raw.set !== undefined))
				throw new Error('A run always ends at the after-run checkpoint; omit checkpoint and set.');
			const request = parseRunRequest(rawRequest);
			const gateCase = snapshot.gateCases?.find((item) => item.id === request.id);
			if (gateCase) {
				const effective = effectiveGateContext(gateCase.gate, request.context);
				const reason = checkImplementationContexts(effective, gateCase.contexts);
				if (reason !== undefined) {
					return {
						id: gateCase.id,
						outcome: { status: 'out-of-context', reason, failures: [] },
						observation: null,
					};
				}
				return enqueue((client) => client.run(request));
			}
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
			const snapshot = ensureDiscovered();
			const request = parseCoverageRequest(rawRequest);
			if (request.obligations === JOBS_COVERAGE_OBLIGATIONS && request.captures !== undefined) {
				return readJobCoverageFromSet(snapshot, {
					...request,
					obligations: JOBS_COVERAGE_OBLIGATIONS,
					captures: request.captures,
				});
			}
			return enqueue((client) => client.coverage(request));
		},
		async pack(rawRequest = {}) {
			const snapshot = ensureDiscovered();
			const { build, allowFailed } = await packBuild(snapshot, rawRequest);
			return writePack(snapshot, build, allowFailed);
		},
		async packCheck(rawRequest = {}) {
			const snapshot = ensureDiscovered();
			const { build, allowFailed } = await packBuild(snapshot, rawRequest);
			return checkCommitted(snapshot, build, allowFailed);
		},
		async packExport(rawRequest) {
			const snapshot = ensureOpen();
			return exportPack(snapshot, parsePackExportRequest(rawRequest));
		},
		async a11y(rawRequest = {}) {
			const snapshot = ensureDiscovered();
			const request = parseA11yRequest(rawRequest);
			if (request.set !== undefined) {
				return readA11yFromSet(snapshot.root, { ...request, set: request.set });
			}
			return enqueue((client) => client.a11y(request));
		},
		async themes(rawRequest = {}) {
			ensureDiscovered();
			const request = parseThemesRequest(rawRequest);
			return enqueue((client) => client.themes(request));
		},
		async runSuite(rawRequest = {}) {
			ensureDiscovered();
			const request = parseSuiteRequest(rawRequest);
			return enqueue((client) => client.runSuite(request));
		},
		async inspect(rawRequest) {
			const snapshot = ensureDiscovered();
			const request = parseCaptureRequest(rawRequest);
			if (
				request.checkpoint !== undefined ||
				request.screenshot !== undefined ||
				request.set !== undefined
			)
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
		async point(rawRequest) {
			ensureDiscovered();
			const request = parsePointRequest(rawRequest);
			if ('pointer' in request) {
				const parsed = parsePointer(request.pointer);
				normalizePointContextInput(parsed.context, 'pointer');
			} else {
				normalizePointContextInput(request.context, 'request');
			}
			return enqueueLocal(async (initial) => {
				const current = await refreshConfigIfChanged(initial);
				const knownIds = current.entries.map((item) => item.id);
				if ('pointer' in request) {
					const parsed = parsePointer(request.pointer);
					if (!current.entries.some((item) => item.id === parsed.specimen)) {
						throw specimenNotFoundError(parsed.specimen, knownIds);
					}
				} else if (!current.entries.some((item) => item.id === request.id)) {
					throw specimenNotFoundError(request.id, knownIds);
				}
				return (await ensureBackend(current)).point(request);
			});
		},
		async pointMove(rawRequest) {
			const snapshot = ensureDiscovered();
			const request = parsePointMoveRequest(rawRequest);
			await readPointFile(snapshot.root, request.id);
			return enqueue((client) => client.pointMove(request));
		},
		async pointCheck(rawRequest) {
			const snapshot = ensureDiscovered();
			const request = parsePointCheckRequest(rawRequest);
			await readPointFile(snapshot.root, request.id);
			return enqueue((client) => client.pointCheck(request));
		},
		async noteAdd(rawRequest) {
			ensureDiscovered();
			const request = parseNoteAddRequest(rawRequest);
			requireNoteText(request.text);
			if ('pointer' in request) {
				const parsed = parsePointer(request.pointer);
				normalizePointContextInput(parsed.context, 'pointer');
			}
			return enqueueLocal(async (initial) => {
				const current = await refreshConfigIfChanged(initial);
				const knownIds = current.entries.map((item) => item.id);
				if ('pointer' in request) {
					const parsed = parsePointer(request.pointer);
					if (!current.entries.some((item) => item.id === parsed.specimen)) {
						throw specimenNotFoundError(parsed.specimen, knownIds);
					}
					return (await ensureBackend(current)).noteAdd(request);
				}
				const stored = await readPointFile(current.root, request.point);
				const changedFiles = await diffRecordedDigests(current.root, stored.source.digests);
				if (changedFiles.length > 0) {
					throw pointError(
						'POINT_STALE',
						`Point ${stored.id} is stale (${changedFiles.join(', ')}).`,
						'Run specimen-point to point again.',
						{ id: stored.id, changed: changedFiles }
					);
				}
				return (await ensureBackend(current)).noteAdd(request);
			});
		},
		async noteList(rawRequest = {}) {
			ensureOpen();
			const request = parseNoteListRequest(rawRequest);
			return enqueueLocal((current) => listNotes(current.root, request));
		},
		async noteCheck(rawRequest = {}) {
			ensureDiscovered();
			const request = parseNoteCheckRequest(rawRequest);
			return enqueueLocal(async (initial) => {
				const current = await refreshConfigIfChanged(initial);
				const allNotes = await readAllNoteFiles(current.root);
				const openNotes = allNotes.filter(
					(note) =>
						note.state === 'open' &&
						(request.specimen === undefined || note.subject.specimen === request.specimen)
				);
				const known = new Set(current.entries.map((entry) => entry.id));
				if (!openNotes.some((note) => known.has(note.subject.specimen))) {
					const uncheckedBySpecimen = new Map<string, string[]>();
					for (const note of openNotes) {
						const list = uncheckedBySpecimen.get(note.subject.specimen);
						if (list) list.push(note.id);
						else uncheckedBySpecimen.set(note.subject.specimen, [note.id]);
					}
					const unchecked = [...uncheckedBySpecimen.entries()]
						.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
						.map(([specimen, notes]) => ({
							specimen,
							reason: 'specimen-missing' as const,
							notes: [...notes].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
						}));
					return { checked: 0, orphaned: [], weakened: [], unchecked, restored: [] };
				}
				return (await ensureBackend(current)).noteCheck(request);
			});
		},
		async noteMove(rawRequest) {
			ensureDiscovered();
			const request = parseNoteMoveRequest(rawRequest);
			requireNoteReason(request.reason, 'moving a note');
			if ('pointer' in request) {
				const parsed = parsePointer(request.pointer);
				normalizePointContextInput(parsed.context, 'pointer');
			}
			return enqueueLocal(async (initial) => {
				const current = await refreshConfigIfChanged(initial);
				const knownIds = current.entries.map((item) => item.id);
				if ('pointer' in request) {
					const parsed = parsePointer(request.pointer);
					if (!current.entries.some((item) => item.id === parsed.specimen)) {
						throw specimenNotFoundError(parsed.specimen, knownIds);
					}
				}
				await readNoteFile(current.root, request.id);
				if ('point' in request) {
					const stored = await readPointFile(current.root, request.point);
					const changedFiles = await diffRecordedDigests(current.root, stored.source.digests);
					if (changedFiles.length > 0) {
						throw pointError(
							'POINT_STALE',
							`Point ${stored.id} is stale (${changedFiles.join(', ')}).`,
							'Run specimen-point to point again.',
							{ id: stored.id, changed: changedFiles }
						);
					}
				}
				return (await ensureBackend(current)).noteMove(request);
			});
		},
		async noteResolve(rawRequest) {
			ensureOpen();
			const request = parseNoteResolveRequest(rawRequest);
			requireNoteReason(request.reason, 'resolving a note');
			return enqueueLocal((current) => resolveNotes(current.root, request));
		},
		async noteReopen(rawRequest) {
			ensureOpen();
			const request = parseNoteReopenRequest(rawRequest);
			requireNoteReason(request.reason, 'reopening a note');
			return enqueueLocal((current) => reopenNote(current.root, request));
		},
		async recordDecision(rawRequest, decisionOptions) {
			const snapshot = ensureOpen();
			return recordDecision(snapshot.root, rawRequest, decisionOptions);
		},
		async getDecision(rawRequest) {
			const snapshot = ensureOpen();
			return getDecision(snapshot.root, rawRequest);
		},
		async listDecisions() {
			const snapshot = ensureOpen();
			return listDecisions(snapshot.root);
		},
		async checkDecisions(rawRequest = {}) {
			const snapshot = ensureOpen();
			return checkDecisions(snapshot.root, rawRequest);
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
