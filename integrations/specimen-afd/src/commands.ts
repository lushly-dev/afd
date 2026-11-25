/** AFD command definitions shared by the CLI and MCP hosts. */
import type { CommandResult } from '@lushly-dev/afd-core';
import {
	defineCommand,
	failure,
	success,
	type ZodCommandDefinition,
} from '@lushly-dev/afd-server/define';
import { diffCaptures, filterAndPaginateListEntries } from '@lushly-dev/specimen';
import {
	a11yRequestSchema,
	a11yRunSchema,
	baselineRequestSchema,
	buildOutputSchema,
	captureRefSchema,
	captureRequestSchema,
	captureSetRequestSchema,
	captureSetRunSchema,
	compareRequestSchema,
	compareRunSchema,
	contractRequestSchema,
	contractRunSchema,
	coverageRequestSchema,
	coverageRunSchema,
	decisionCheckRequestSchema,
	decisionCheckResultSchema,
	decisionGetRequestSchema,
	decisionGetResultSchema,
	decisionListRequestSchema,
	decisionListResultSchema,
	decisionRecordRequestSchema,
	decisionRecordResultSchema,
	gateRunSchema,
	inspectRequestSchema,
	inspectResultSchema,
	jobConfigSchema,
	jobCreateRequestSchema,
	jobCreateResultSchema,
	jobRunRequestSchema,
	jobRunSchema,
	matrixRequestSchema,
	matrixRunSchema,
	migrateRequestSchema,
	migrationReportSchema,
	noteAddRequestSchema,
	noteCheckRequestSchema,
	noteCheckResultSchema,
	noteListRequestSchema,
	noteListResultSchema,
	noteMoveRequestSchema,
	noteReopenRequestSchema,
	noteResolveRequestSchema,
	noteResolveResultSchema,
	noteResultSchema,
	observationSchema,
	packCheckRunSchema,
	packExportRequestSchema,
	packExportRunSchema,
	packRequestSchema,
	packRunSchema,
	pointCheckRequestSchema,
	pointCheckResultSchema,
	pointMoveRequestSchema,
	pointRequestSchema,
	pointResultSchema,
	profileRequestSchema,
	profileRunSchema,
	runRequestSchema,
	storyRunSchema,
	suggestRequestSchema,
	suggestRunSchema,
	suiteRequestSchema,
	suiteRunSchema,
	themeSupportSchema,
	themesRequestSchema,
	themesRunSchema,
} from '@lushly-dev/specimen/schema';
import { z } from 'zod';

export {
	buildOutputSchema,
	contextSchema,
	gateRunSchema,
	inspectResultSchema,
	noteCheckResultSchema,
	noteListResultSchema,
	noteResolveResultSchema,
	noteResultSchema,
	noteSchema,
	observationSchema,
	pointCheckResultSchema,
	pointResultSchema,
	pointSchema,
	storyRunSchema,
} from '@lushly-dev/specimen/schema';

import type {
	A11yRequest,
	A11yRun,
	BaselineRequest,
	CaptureRequest,
	CaptureSetRequest,
	CaptureSetRun,
	ChannelDifference,
	CompareRequest,
	CompareRun,
	ContractRequest,
	ContractRun,
	CoverageRequest,
	CoverageRun,
	DecisionActor,
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
} from '@lushly-dev/specimen/types';

const storySchema = z
	.object({
		name: z.string(),
		tags: z.array(z.string()),
		play: z.enum(['present', 'absent', 'unknown']),
		unresolved: z.array(
			z.object({ level: z.enum(['meta', 'story']), field: z.string(), reason: z.string() }).strict()
		),
		annotations: z.object({ meta: z.array(z.string()), story: z.array(z.string()) }).strict(),
	})
	.strict();
const patternSetupSchema = z
	.object({
		library: z.string().min(1).optional(),
		pattern: z.string().min(1),
		setup: z.string().min(1),
	})
	.strict();
const implementationContextsSchema = z
	.object({
		viewport: z
			.object({
				minWidth: z.number().int().min(1).max(8192).optional(),
				maxWidth: z.number().int().min(1).max(8192).optional(),
				minHeight: z.number().int().min(1).max(8192).optional(),
				maxHeight: z.number().int().min(1).max(8192).optional(),
			})
			.strict()
			.optional(),
		themes: z
			.array(z.enum(['dark', 'high-contrast', 'light']))
			.min(1)
			.max(3)
			.optional(),
		reason: z.string().min(1),
	})
	.strict();
const listPatternMetaSchema = z
	.object({
		library: z.string().min(1),
		pattern: z.string().min(1),
		setup: z.string().min(1),
		gate: z.string().min(1).optional(),
	})
	.strict();
const listKindEnum = z.enum(['job', 'component', 'story', 'native', 'gate']);
const entrySchema = z
	.object({
		id: z.string(),
		title: z.string(),
		module: z.string(),
		exportName: z.string(),
		kind: listKindEnum,
		component: z.string().optional(),
		story: storySchema.optional(),
		job: jobConfigSchema.optional(),
		themes: themeSupportSchema.optional(),
		patternSetup: patternSetupSchema.optional(),
		pattern: listPatternMetaSchema.optional(),
		contexts: implementationContextsSchema.optional(),
	})
	.strict();
const listInput = z
	.object({
		kind: listKindEnum.optional(),
		component: z.string().min(1).optional(),
		pattern: z.string().min(1).optional(),
		match: z.string().min(1).optional(),
		limit: z.number().int().min(1).max(500).optional(),
		after: z.string().min(1).optional(),
	})
	.strict();
const listOutput = z
	.object({
		specimens: z.array(entrySchema),
		next: z.string().min(1).optional(),
	})
	.strict();
const validateInput = z
	.object({ id: z.string().min(1).optional(), file: z.string().min(1).optional() })
	.strict();
const validateOutput = z
	.object({
		valid: z.boolean(),
		scope: z.literal('static'),
		checked: z.number().int().nonnegative(),
		issues: z.array(
			z
				.object({
					severity: z.enum(['error', 'warning', 'deferred']),
					code: z.string(),
					message: z.string(),
					suggestion: z.string(),
					id: z.string().optional(),
					importPath: z.string().optional(),
					exportName: z.string().optional(),
					field: z.string().optional(),
				})
				.strict()
		),
	})
	.strict();
const renderInput = captureRequestSchema;
const contextAxis = z.enum(['viewport', 'container', 'theme', 'locale', 'reducedMotion', 'motion']);
const diffSide = z.union([observationSchema, captureRefSchema]);
const diffInput = z
	.object({
		left: diffSide,
		right: diffSide,
		allowContextDifferences: z.array(contextAxis).optional(),
		requireVisual: z.boolean().optional(),
	})
	.strict();
const DIFF_CHANNELS = {
	dom: 'dom',
	a11y: 'a11y',
	layout: 'layout',
	styles: 'styles',
	state: 'state',
	events: 'events',
} as const satisfies { [K in ChannelDifference['channel']]: K };
const diffOutput = z
	.object({
		status: z.enum(['changed', 'no-change-observed', 'insufficient-evidence']),
		differences: z.array(
			z
				.object({
					channel: z.enum(DIFF_CHANNELS),
					target: z.string().optional(),
					property: z.string().optional(),
					left: z.unknown(),
					right: z.unknown(),
				})
				.strict()
		),
		limitations: z.array(z.string()),
	})
	.strict();
/** The command layer requires only these bench operations, allowing transport tests without a browser. */
export interface SpecimenCommandBench {
	list(filter?: SpecimenListFilter): SpecimenEntry[];
	validate(target?: ValidationTarget): ValidationReport;
	render(request: CaptureRequest): Promise<Observation>;
	captureSet(request?: CaptureSetRequest): Promise<CaptureSetRun>;
	compare(request: CompareRequest): Promise<CompareRun>;
	diff(request: DiffRequest): Promise<ObservationDiff>;
	run(request: RunRequest): Promise<StoryRun | GateRun>;
	runSuite(request?: SuiteRequest): Promise<SuiteRun>;
	a11y(request?: A11yRequest): Promise<A11yRun>;
	themes(request?: ThemesRequest): Promise<ThemesRun>;
	profile(request?: ProfileRequest): Promise<ProfileRun>;
	contract(request: ContractRequest): Promise<ContractRun>;
	suggest(request: SuggestRequest): Promise<SuggestRun>;
	coverage(request: CoverageRequest): Promise<CoverageRun>;
	matrix(request: MatrixRequest): Promise<MatrixRun>;
	recordBaseline(request: BaselineRequest): Promise<ProfileRun>;
	inspect(request: InspectRequest): Promise<InspectResult>;
	migrate(request?: MigrateRequest): Promise<MigrationReport>;
	build(outDir: string): Promise<z.infer<typeof buildOutputSchema>>;
	pack(request?: PackRequest): Promise<PackRun>;
	packCheck(request?: PackRequest): Promise<PackCheckRun>;
	packExport(request: PackExportRequest): Promise<PackExportRun>;
	point(request: PointRequest): Promise<PointResult>;
	pointMove(request: PointMoveRequest): Promise<PointResult>;
	pointCheck(request: PointCheckRequest): Promise<PointCheckResult>;
	noteAdd(request: NoteAddRequest): Promise<NoteResult>;
	noteList(request?: NoteListRequest): Promise<NoteListResult>;
	noteCheck(request?: NoteCheckRequest): Promise<NoteCheckResult>;
	noteMove(request: NoteMoveRequest): Promise<NoteResult>;
	noteResolve(request: NoteResolveRequest): Promise<NoteResolveResult>;
	noteReopen(request: NoteReopenRequest): Promise<NoteResult>;
	createJob(request: JobCreateRequest): Promise<JobCreateResult>;
	runJob(request: JobRunRequest): Promise<JobRun>;
	recordDecision(
		request: DecisionRecordRequest,
		options?: RecordDecisionOptions
	): Promise<DecisionRecordResult>;
	getDecision(request: DecisionGetRequest): Promise<DecisionGetResult>;
	listDecisions(): Promise<DecisionListResult>;
	checkDecisions(request?: DecisionCheckRequest): Promise<DecisionCheckResult>;
}

/** One story or synthesized gate by id, or a suite by filter; the handler tells them apart. */
const runInputSchema = runRequestSchema.partial({ id: true }).extend(suiteRequestSchema.shape);
const runOutputSchema = z.union([storyRunSchema, gateRunSchema, suiteRunSchema]);

function safeErrorDetails(value: unknown): Record<string, unknown> | undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
	try {
		const encoded = JSON.stringify(value);
		if (encoded === undefined) return undefined;
		const parsed: unknown = JSON.parse(encoded);
		return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

async function result<T>(
	operation: () => T | Promise<T>,
	output: z.ZodType<T>,
	code: string,
	suggestion: string
): Promise<CommandResult<T>> {
	try {
		return success(output.parse(await operation()), {
			reasoning: 'Completed the requested specimen operation.',
		});
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		const structured =
			error instanceof Error && !(error instanceof z.ZodError)
				? (error as Error & {
						code?: unknown;
						suggestion?: unknown;
						details?: unknown;
					})
				: undefined;
		const errorCode =
			error instanceof z.ZodError
				? 'SPECIMEN_OUTPUT_INVALID'
				: typeof structured?.code === 'string' && structured.code.trim().length > 0
					? structured.code
					: code;
		const errorSuggestion =
			typeof structured?.suggestion === 'string' && structured.suggestion.trim().length > 0
				? structured.suggestion
				: suggestion;
		const errorDetails = safeErrorDetails(structured?.details);
		return failure({
			code: errorCode,
			message: detail,
			suggestion: errorSuggestion,
			...(errorDetails ? { details: errorDetails } : {}),
		});
	}
}

function createDiffCommand(runDiff: (request: DiffRequest) => Promise<ObservationDiff>) {
	return defineCommand({
		category: 'specimen',
		expose: { mcp: true, cli: true },
		version: '0.1.0',
		name: 'specimen-diff',
		description:
			'Compare compatible structured specimen observations or { set, id } references from saved capture sets. Refuses incompatible conditions with CAPTURES_INCOMPARABLE unless allowContextDifferences names the intended context axis.',
		mutation: false,
		input: diffInput,
		output: diffOutput,
		handler: async (input) =>
			result(
				() =>
					runDiff({
						left: input.left,
						right: input.right,
						allowContextDifferences: input.allowContextDifferences,
						requireVisual: input.requireVisual,
					}),
				diffOutput,
				'SPECIMEN_DIFF_FAILED',
				'Capture both sides with compatible browser, context, checkpoint, and observation versions, or pass allowContextDifferences for the intended context axis.'
			),
	});
}

/** Create the same validated command definitions for CLI and MCP adapters. */
export function createSpecimenCommands(bench: SpecimenCommandBench) {
	const common = { category: 'specimen', expose: { mcp: true, cli: true }, version: '0.1.0' };
	const list = defineCommand({
		...common,
		name: 'specimen-list',
		description:
			'List registered specimens and synthesized pattern gate cases without executing their modules, with optional kind, component, pattern, match filters and cursor pagination (limit/after)',
		mutation: false,
		input: listInput,
		output: listOutput,
		handler: async (input) =>
			result(
				() => {
					const hasFilter =
						input.kind !== undefined ||
						input.component !== undefined ||
						input.pattern !== undefined ||
						input.match !== undefined;
					const benchFilter = hasFilter
						? {
								...(input.kind !== undefined ? { kind: input.kind } : {}),
								...(input.component !== undefined ? { component: input.component } : {}),
								...(input.pattern !== undefined ? { pattern: input.pattern } : {}),
								...(input.match !== undefined ? { match: input.match } : {}),
							}
						: undefined;
					const raw = bench.list(benchFilter);
					const normalized = raw.map((entry) => ({
						...entry,
						kind: (entry.kind ?? (entry.job ? 'job' : 'component')) as z.infer<typeof listKindEnum>,
					}));
					return filterAndPaginateListEntries(normalized, input);
				},
				listOutput,
				'SPECIMEN_LIST_FAILED',
				'Check the specimen configuration and list filters, then try specimen-list again.'
			),
	});
	const validate = defineCommand({
		...common,
		name: 'specimen-validate',
		description:
			'Validate retained stories, job specimens, guides, and pattern files statically with no browser: identity, schema, portability, job scenario capture points, cross-references, and what only running story modules can settle',
		mutation: false,
		input: validateInput,
		output: validateOutput,
		handler: async (input) =>
			result(
				() => bench.validate(input),
				validateOutput,
				'SPECIMEN_VALIDATE_FAILED',
				'Check the specimen configuration and stories specifiers, then validate again.'
			),
	});
	const render = defineCommand({
		...common,
		name: 'specimen-render',
		description:
			'Capture one specimen in an isolated browser context, or read a saved capture from a capture set when set is provided. Refuses live rendering of a job specimen without set via JOB_NEEDS_RUN.',
		mutation: false,
		input: renderInput,
		output: observationSchema,
		handler: async (input) =>
			result(
				() => bench.render(input),
				observationSchema,
				'SPECIMEN_RENDER_FAILED',
				'Use specimen-list to check the id, then verify its module, checkpoint, and browser installation.'
			),
	});
	const runStory = defineCommand({
		...common,
		name: 'specimen-run',
		description:
			'Run one retained story or synthesized pattern gate case by id, or a suite of them by filter (no id and no filter runs them all). For gate cases, single-id runs default capture to none (pass capture: failed or all to keep observations) and report out-of-context when outside declared contexts. A failing story or gate is a successful command: read data.outcome.status for one run and data.outcome for a suite.',
		mutation: false,
		input: runInputSchema,
		output: runOutputSchema,
		handler: async (input) =>
			result(
				() => {
					const { id, screenshot, ...suite } = input;
					if (id === undefined) {
						if (screenshot !== undefined)
							throw new Error('A screenshot belongs to one story; give an id, or omit it.');
						return bench.runSuite(suite);
					}
					const { filter, workers, retry, flakeCap, capture, ...single } = suite;
					if (filter || workers || retry !== undefined || flakeCap !== undefined)
						throw new Error('Give an id for one story, or suite options, not both.');
					return bench.run({
						id,
						...single,
						...(capture !== undefined ? { capture } : {}),
						...(screenshot ? { screenshot } : {}),
					});
				},
				runOutputSchema,
				'SPECIMEN_RUN_FAILED',
				'Use specimen-list to check the id or filter names retained stories or gate cases, then validate them and check the browser installation.'
			),
	});
	const a11y = defineCommand({
		...common,
		name: 'specimen-a11y',
		description:
			'Run an accessibility check at a checkpoint, on one entry by id or those a filter selects, or read recorded axe results from a capture set (passing set) without launching a browser or replaying job steps. Untaken job captures report status not-run with their reason. A story keeps its effective policy. A failing check is a successful command: read data.counts and each report.',
		mutation: false,
		input: a11yRequestSchema,
		output: a11yRunSchema,
		handler: async (input) =>
			result(
				() => bench.a11y(input),
				a11yRunSchema,
				'SPECIMEN_A11Y_FAILED',
				'Use specimen-list to check the id or filter, specimen-inspect to check the checkpoint, then check the browser installation.'
			),
	});
	const themes = defineCommand({
		...common,
		name: 'specimen-themes',
		description:
			'Render one entry by id, or those a filter selects, in each theme and compare the frames, to find what does not follow the theme. Each report is follows, declared (the frame stays the same and a light-only, dark-only or high-contrast-only tag says so), pinned (the story sets its own theme global), undeclared (it stays the same and nothing says so), contradicted (it declares a limit but changes) or unavailable. data.valid is false when any entry is undeclared: gate on it.',
		mutation: false,
		input: themesRequestSchema,
		output: themesRunSchema,
		handler: async (input) =>
			result(
				() => bench.themes(input),
				themesRunSchema,
				'SPECIMEN_THEMES_FAILED',
				'Use specimen-list to check the id or filter, then check the browser installation.'
			),
	});
	const profile = defineCommand({
		...common,
		name: 'specimen-profile',
		description:
			'Measure entries at a checkpoint over a few fresh runs, one at a time: paint and load timings, ready and capture time, DOM size, requests, heap and console counts, with flags and a comparison when a recorded baseline describes the same measurement. No id or filter profiles everything with a baseline. Chromium only. Read each comparison, including not-comparable and its reason; a failed budget is a successful command.',
		mutation: false,
		input: profileRequestSchema,
		output: profileRunSchema,
		handler: async (input) =>
			result(
				() => bench.profile(input),
				profileRunSchema,
				'SPECIMEN_PROFILE_FAILED',
				'Use specimen-list to check the id or filter. To compare, record a baseline with specimen-baseline and set profile.baselines in the configuration.'
			),
	});
	const baseline = defineCommand({
		...common,
		name: 'specimen-baseline',
		description:
			'Profile entries and record the results in the baselines file the configuration names, dated and with their browser and source. Replaces what is recorded for those entries, keeping budgets a person set and noting a baseline from another page. A run that fails records nothing.',
		mutation: true,
		input: baselineRequestSchema,
		output: profileRunSchema,
		handler: async (input) =>
			result(
				() => bench.recordBaseline(input),
				profileRunSchema,
				'SPECIMEN_BASELINE_FAILED',
				'Set profile.baselines in the configuration, and give an id or a filter.'
			),
	});
	const suggest = defineCommand({
		...common,
		name: 'specimen-suggest',
		description:
			"Propose native specimens and claims for a component's gaps, or placeholder pattern gate setup stubs (for a component or a tagless consumer case via pattern + gaps), always as unverified: run them and correct them. Nothing it returns counts as coverage, and placeholders fail until replaced.",
		mutation: false,
		input: suggestRequestSchema,
		output: suggestRunSchema,
		handler: async (input) =>
			result(
				() => bench.suggest(input),
				suggestRunSchema,
				'SPECIMEN_SUGGEST_FAILED',
				'Configure a custom elements manifest describing the component, or pass pattern and gaps for tagless pattern setup stubs.'
			),
	});
	const contract = defineCommand({
		...common,
		name: 'specimen-contract',
		description:
			"Run story files' cases and report what FAST-AF's Fastbot story contract would, on evidence from the run instead of source text: co-located stories, the accessibility policy, plays, baseline and state stories, and form evidence. Each code is the rule it replaces.",
		mutation: false,
		input: contractRequestSchema,
		output: contractRunSchema,
		handler: async (input) =>
			result(
				() => bench.contract(input),
				contractRunSchema,
				'SPECIMEN_CONTRACT_FAILED',
				'Configure a custom elements manifest, and use specimen-list to check the filter.'
			),
	});
	const coverage = defineCommand({
		...common,
		name: 'specimen-coverage',
		description:
			"Run the selected cases and report each component's required partitions (`schema-partitions@1`), optional guide obligations (`guides@1`), and optional pattern gate coverage (`patterns@1`, narrowed via `pattern`). Unknown never counts as covered, and only verified counts toward complete. With obligations: 'jobs@1' and captures (a capture set id or label), read recorded job captures from that set without launching a browser and report components[].jobs (reachedBy, unreached, and reason when no job renders a component), applying unreached:<partition> waivers.",
		mutation: false,
		input: coverageRequestSchema,
		output: coverageRunSchema,
		handler: async (input) =>
			result(
				() => bench.coverage(input),
				coverageRunSchema,
				'SPECIMEN_COVERAGE_FAILED',
				'Configure a custom elements manifest that describes the component, and use specimen-list to check the filter or verify the capture set id/label.'
			),
	});
	const matrix = defineCommand({
		...common,
		name: 'specimen-matrix',
		description:
			'Capture one entry once per combination of explicit context axes, each in its own browser context. Comparable cells diff against the first captured cell, and a cell that could not be captured stays visible with its reason. Read data.counts and each cell; an unavailable cell is a successful command.',
		mutation: false,
		input: matrixRequestSchema,
		output: matrixRunSchema,
		handler: async (input) =>
			result(
				() => bench.matrix(input),
				matrixRunSchema,
				'SPECIMEN_MATRIX_FAILED',
				'Use specimen-list to check the id, and narrow an axis if there are too many cells.'
			),
	});
	const inspect = defineCommand({
		...common,
		name: 'specimen-inspect',
		description:
			"Resolve a specimen or retained story without capturing it: its args, context and its component's schema",
		mutation: false,
		input: inspectRequestSchema,
		output: inspectResultSchema,
		handler: async (input) =>
			result(
				() => bench.inspect(input),
				inspectResultSchema,
				'SPECIMEN_INSPECT_FAILED',
				'Use specimen-list to check the id, then validate it; a failing plugin or module load is reported here.'
			),
	});
	const migrate = defineCommand({
		...common,
		name: 'specimen-migrate',
		description:
			'Preview, or apply, the codemod over retained story files: the component each can name, the metadata kept and the manual tasks left',
		mutation: true,
		input: migrateRequestSchema,
		output: migrationReportSchema,
		handler: async (input) =>
			result(
				() => bench.migrate(input),
				migrationReportSchema,
				'SPECIMEN_MIGRATE_FAILED',
				'Preview without apply first; check the stories specifiers and the manifest path in the configuration.'
			),
	});
	const capture = defineCommand({
		...common,
		name: 'specimen-capture',
		description:
			'Capture specimens in one context and checkpoint into a content-addressed capture set under .specimen/sets/, with axe enabled by default. Runs job specimens through the configured job runner when available, skips synthesized pattern gate cases by default (reporting skipped.gates unless explicitly requested via ids or filter.kind: ["gate"]), and returns set id, revision, counts, unavailable ids and skipped counts only (never observations). A label is a local name for a set, not a git ref; capture main from a checkout of main.',
		mutation: true,
		input: captureSetRequestSchema,
		output: captureSetRunSchema,
		handler: async (input) =>
			result(
				() => bench.captureSet(input),
				captureSetRunSchema,
				'SPECIMEN_CAPTURE_FAILED',
				'Use specimen-list to check ids or filters, then verify the specimen modules and browser installation.'
			),
	});
	const compare = defineCommand({
		...common,
		name: 'specimen-compare',
		description:
			'Capture 2 to 8 variant specimens with axe under one context and checkpoint into a compare capture set, diff each against the first, and return compact capture summaries, structured difference channels, and compare.html?set= (never observations). Refuses unknown ids (SPECIMEN_NOT_FOUND) and variants excluding the requested theme (VARIANT_UNAVAILABLE) before capturing.',
		mutation: true,
		input: compareRequestSchema,
		output: compareRunSchema,
		handler: async (input) =>
			result(
				() => bench.compare(input),
				compareRunSchema,
				'SPECIMEN_COMPARE_FAILED',
				'Pass 2 to 8 known specimen ids compatible with the requested theme and verify the browser installation.'
			),
	});
	const diff = createDiffCommand((request) => bench.diff(request));
	const build = defineCommand({
		...common,
		name: 'specimen-build',
		description: 'Build the static specimen bench and check its shell budget',
		mutation: true,
		input: z.object({ outDir: z.string().min(1) }).strict(),
		output: buildOutputSchema,
		handler: async (input) =>
			result(
				() => bench.build(input.outDir),
				buildOutputSchema,
				'SPECIMEN_BUILD_FAILED',
				'Choose an empty output directory and inspect the build or budget failure before retrying.'
			),
	});
	const pack = defineCommand({
		...common,
		name: 'specimen-pack',
		description:
			"Build the configured library's component pack from two passes over every case and write its committed form: one record per component and the library's rules. A case that fails after one retry, or shows something different in each pass, contributes nothing, and nothing is written from a run with a failed case unless allowFailed names it. With component, rebuild that record alone from the cases the last full build indexed.",
		mutation: true,
		input: packRequestSchema,
		output: packRunSchema,
		handler: async (input) =>
			result(
				() => bench.pack(input),
				packRunSchema,
				'SPECIMEN_PACK_FAILED',
				'Add a pack key to the configuration, fix or name the failed cases in allowFailed, and run specimen-validate on the guide files.'
			),
	});
	const packCheck = defineCommand({
		...common,
		name: 'specimen-pack-check',
		description:
			'Build the pack as specimen-pack does, write nothing, and report the committed records that differ: changed, added and removed. valid is true only when none does and no case failed; this is the drift check CI runs.',
		mutation: false,
		input: packRequestSchema,
		output: packCheckRunSchema,
		handler: async (input) =>
			result(
				() => bench.packCheck(input),
				packCheckRunSchema,
				'SPECIMEN_PACK_CHECK_FAILED',
				'Add a pack key to the configuration; when records differ, run specimen-pack and commit what it writes.'
			),
	});
	const packExport = defineCommand({
		...common,
		name: 'specimen-pack-export',
		description:
			"Write the pack's exported form into directory from the committed records, with no browser: the records, the rules and a catalog stamped with the package and an optional Git revision. Refuses, naming the record, when the manifest or a guide file says something the committed records do not. Other libraries in directory and its pack.toml are kept.",
		mutation: true,
		input: packExportRequestSchema,
		output: packExportRunSchema,
		handler: async (input) =>
			result(
				() => bench.packExport(input),
				packExportRunSchema,
				'SPECIMEN_PACK_EXPORT_FAILED',
				'Run specimen-pack to rebuild the records it names, and export into a directory holding only data/, rules/ and pack.toml.'
			),
	});
	const point = defineCommand({
		...common,
		name: 'specimen-point',
		description:
			'Resolve a pointer URI or a named target ({ role, name? } or { selector }) into a bounded, source-tied point stored under .specimen/points/<id>.json. Run specimen-point-check before editing source for this point.',
		mutation: true,
		input: pointRequestSchema,
		output: pointResultSchema,
		handler: async (input) =>
			result(
				() => bench.point(input as PointRequest),
				pointResultSchema,
				'SPECIMEN_POINT_FAILED',
				'Copy the pointer again from the review page, or pass a valid specimen id and target.'
			),
	});
	const pointMove = defineCommand({
		...common,
		name: 'specimen-point-move',
		description:
			'Move a stored point to its parent, child (with optional 0-based index), next sibling, previous sibling, or enclosing custom element component. Checks staleness first (POINT_STALE) and refuses invalid levels (NO_SUCH_LEVEL), writing and returning a new point.',
		mutation: true,
		input: pointMoveRequestSchema,
		output: pointResultSchema,
		handler: async (input) =>
			result(
				() => bench.pointMove(input),
				pointResultSchema,
				'SPECIMEN_POINT_MOVE_FAILED',
				'Run specimen-point to create a fresh point, or choose one of the available moves.'
			),
	});
	const pointCheck = defineCommand({
		...common,
		name: 'specimen-point-check',
		description:
			'Re-render a stored point in its recorded context and report whether its source files and element identity are still current or stale. Run before editing source for a point.',
		mutation: false,
		input: pointCheckRequestSchema,
		output: pointCheckResultSchema,
		handler: async (input) =>
			result(
				() => bench.pointCheck(input),
				pointCheckResultSchema,
				'SPECIMEN_POINT_CHECK_FAILED',
				'Run specimen-point to create a fresh point if the stored point is missing or unreadable.'
			),
	});
	const noteAdd = defineCommand({
		...common,
		name: 'specimen-note-add',
		description:
			'Pin a note to a fresh point id or a specimen: pointer URI and store it under specimens/notes/<id>.json. Refuses empty text (NOTE_EMPTY) and stale points (POINT_STALE).',
		mutation: true,
		input: noteAddRequestSchema,
		output: noteResultSchema,
		handler: async (input) =>
			result(
				() => bench.noteAdd(input as NoteAddRequest),
				noteResultSchema,
				'SPECIMEN_NOTE_ADD_FAILED',
				'Pass a fresh point id or valid pointer URI with non-empty note text.'
			),
	});
	const noteList = defineCommand({
		...common,
		name: 'specimen-note-list',
		description:
			'List committed notes from specimens/notes/ without launching a browser. Defaults to open notes, filters by specimen, state, assignee, or orphaned, and pages with limit (default 20, max 100) and after/next.',
		mutation: false,
		input: noteListRequestSchema,
		output: noteListResultSchema,
		handler: async (input) =>
			result(
				() => bench.noteList(input),
				noteListResultSchema,
				'SPECIMEN_NOTE_LIST_FAILED',
				'Check the specimens/notes/ directory and filter options, then run specimen-note-list again.'
			),
	});
	const noteCheck = defineCommand({
		...common,
		name: 'specimen-note-check',
		description:
			'Re-resolve open notes against current specimen renders, updating orphaned flags without moving notes by guesswork. Reports checked count, orphaned, weakened, unchecked (render-failed or specimen-missing), and restored ids.',
		mutation: true,
		input: noteCheckRequestSchema,
		output: noteCheckResultSchema,
		handler: async (input) =>
			result(
				() => bench.noteCheck(input),
				noteCheckResultSchema,
				'SPECIMEN_NOTE_CHECK_FAILED',
				'Verify the specimen configuration and browser installation, then run specimen-note-check again.'
			),
	});
	const noteMove = defineCommand({
		...common,
		name: 'specimen-note-move',
		description:
			'Re-pin a note to a fresh point id or specimen: pointer URI with a required reason (REASON_REQUIRED), clearing orphaned and recording the move in history. Refuses stale points (POINT_STALE).',
		mutation: true,
		input: noteMoveRequestSchema,
		output: noteResultSchema,
		handler: async (input) =>
			result(
				() => bench.noteMove(input as NoteMoveRequest),
				noteResultSchema,
				'SPECIMEN_NOTE_MOVE_FAILED',
				'Run specimen-note-list to check the note id and specimen-point to create a fresh point.'
			),
	});
	const noteResolve = defineCommand({
		...common,
		name: 'specimen-note-resolve',
		description:
			'Resolve one note (id) or several (ids) with an outcome (fixed, declined, duplicate, obsolete, withdrawn), a required reason (REASON_REQUIRED), and optional evidence. Always returns { resolved, skipped }; single id fails with NOTE_NOT_FOUND or NOTE_ALREADY_RESOLVED, while bulk ids record them in skipped.',
		mutation: true,
		input: noteResolveRequestSchema,
		output: noteResolveResultSchema,
		handler: async (input) =>
			result(
				() => bench.noteResolve(input as NoteResolveRequest),
				noteResolveResultSchema,
				'SPECIMEN_NOTE_RESOLVE_FAILED',
				'Run specimen-note-list to check the note id and provide an outcome and reason.'
			),
	});
	const noteReopen = defineCommand({
		...common,
		name: 'specimen-note-reopen',
		description:
			'Reopen a resolved note with a required reason (REASON_REQUIRED), preserving its prior resolution in history. Refuses open notes with NOTE_NOT_RESOLVED.',
		mutation: true,
		input: noteReopenRequestSchema,
		output: noteResultSchema,
		handler: async (input) =>
			result(
				() => bench.noteReopen(input),
				noteResultSchema,
				'SPECIMEN_NOTE_REOPEN_FAILED',
				'Run specimen-note-list with state: resolved to check the note id, then pass a reason.'
			),
	});
	const jobCreate = defineCommand({
		...common,
		name: 'specimen-job-create',
		description:
			'Register or update a job specimen in specimen.config.json from a scenario file and step selections. Captures accept 1-based step numbers (defaulting name to a deterministic slug of the step description) or { step, name?, before? } objects; refuses undescribed steps with STEP_HAS_NO_DESCRIPTION and refuses overwriting a non-job specimen with NOT_A_JOB.',
		mutation: true,
		input: jobCreateRequestSchema,
		output: jobCreateResultSchema,
		handler: async (input) =>
			result(
				() => bench.createJob(input),
				jobCreateResultSchema,
				'SPECIMEN_JOB_CREATE_FAILED',
				'Check the scenario path, module path, exportName, target, and step numbers, then run specimen-job-create again.'
			),
	});
	const jobRun = defineCommand({
		...common,
		name: 'specimen-job-run',
		description:
			'Run a job specimen once in an isolated browser context, execute its scenario steps through the app command runner, and write taken captures to a content-addressed capture set keyed <id>/<step>. Capture points match exact scenario step descriptions. Returns set id, step outcomes, and capture references only (never raw observations); a failing scenario step is still a successful command—read data.status and each step capture. Inspect a capture with specimen-render (passing set and checkpoint) or check accessibility with specimen-a11y (passing set).',
		mutation: true,
		input: jobRunRequestSchema.omit({ scenario: true }),
		output: jobRunSchema,
		handler: async (input) => {
			const outcome = await result(
				() => bench.runJob(input),
				jobRunSchema,
				'SPECIMEN_JOB_RUN_FAILED',
				'Use specimen-list (kind: "job") and specimen-validate to verify the job specimen, runner plugin, and browser installation.'
			);
			if (!outcome.success && outcome.error?.code === 'BROWSER_UNAVAILABLE') {
				return failure({
					...outcome.error,
					suggestion:
						"Install the browser Specimen uses; or run the scenario headless with afd scenario run, or in the app's own test.",
				});
			}
			return outcome;
		},
	});
	const decisionRecord = defineCommand({
		...common,
		name: 'decision-record',
		description:
			'Record a design decision with its required reason and write its files under specimens/decisions/ and specimens/evidence/ (never running git commit). Supports three input modes: new choice from a capture/compare set (set, slug, question, chosen, reason, optional subjects); supersede one or more current choices (supersedes: id or id[], chosen, reason, optional set/items/slug/question/subjects — writes one successor choice per superseded id and swaps old->new chosen in subjects.specimens on variant reversal); or review answer (items, chosen accept|reject, reason, optional slug/question, no subjects).',
		mutation: true,
		confirmPrompt: 'Record this design decision and write its files under specimens/?',
		input: decisionRecordRequestSchema,
		output: decisionRecordResultSchema,
		handler: async (input, context) => {
			// Phase 5 (#2213) wires `confirmations: 'require-human'` so `person` provenance comes
			// exclusively from accepted human elicitation, never from unverified `context.actor.kind`.
			const decidedBy: DecisionActor =
				context.actor?.kind === 'test'
					? { kind: 'test', ...(context.actor?.id ? { id: context.actor.id } : {}) }
					: { kind: 'script', ...(context.actor?.id ? { id: context.actor.id } : {}) };
			return result(
				() => bench.recordDecision(input, { decidedBy }),
				decisionRecordResultSchema,
				'SPECIMEN_DECISION_RECORD_FAILED',
				'Check the set id, decision id(s), variant id, and non-empty reason, then run decision-record again.'
			);
		},
	});
	const decisionGet = defineCommand({
		...common,
		name: 'decision-get',
		description:
			'Read a recorded design decision by id, returning its reason, variants, subjects, and committed evidence captures. Use decision-list to find current decision ids.',
		mutation: false,
		input: decisionGetRequestSchema,
		output: decisionGetResultSchema,
		handler: async (input) =>
			result(
				() => bench.getDecision(input),
				decisionGetResultSchema,
				'SPECIMEN_DECISION_GET_FAILED',
				'Use decision-list to see current decision ids.'
			),
	});
	const decisionList = defineCommand({
		...common,
		name: 'decision-list',
		description:
			'List all current choice decisions sorted by decision id ascending (with stale subject globs that match no file) and undecided comparison sets.',
		mutation: false,
		input: decisionListRequestSchema,
		output: decisionListResultSchema,
		handler: async () =>
			result(
				() => bench.listDecisions(),
				decisionListResultSchema,
				'SPECIMEN_DECISION_LIST_FAILED',
				'Verify specimens/decisions/ and .specimen/sets/ are readable, then run decision-list again.'
			),
	});
	const decisionCheck = defineCommand({
		...common,
		name: 'decision-check',
		description:
			'Call decision-check with the files, specimens, or tokens you are about to change, before editing. Returns matching current choice decisions with their chosen variant, reason, and matched subjects; informs and does not block. Use decision-list to see every current decision id.',
		mutation: false,
		input: decisionCheckRequestSchema,
		output: decisionCheckResultSchema,
		handler: async (input) =>
			result(
				() => bench.checkDecisions(input),
				decisionCheckResultSchema,
				'SPECIMEN_DECISION_CHECK_FAILED',
				'Pass files, specimens, or tokens to check, or use decision-list to see every current decision id.'
			),
	});
	return [
		list,
		render,
		capture,
		compare,
		diff,
		build,
		validate,
		runStory,
		a11y,
		profile,
		baseline,
		contract,
		suggest,
		coverage,
		matrix,
		inspect,
		migrate,
		pack,
		packCheck,
		packExport,
		themes,
		point,
		pointMove,
		pointCheck,
		noteAdd,
		noteList,
		noteCheck,
		noteMove,
		noteResolve,
		noteReopen,
		jobCreate,
		jobRun,
		decisionRecord,
		decisionGet,
		decisionList,
		decisionCheck,
	] as const;
}

async function execute<TInput extends z.ZodType, TOutput>(
	command: ZodCommandDefinition<TInput, TOutput>,
	input: unknown
): Promise<CommandResult<TOutput>> {
	const parsed = command.inputSchema.safeParse(input);
	if (!parsed.success)
		return failure({
			code: 'VALIDATION_ERROR',
			message: parsed.error.message,
			suggestion: `Provide input matching the ${command.name} schema.`,
		});
	return command.handler(parsed.data, { actor: { kind: 'script' } });
}

/** Execute through the command schema; adapters must not call handlers with unvalidated data. */
export async function executeSpecimenCommand(
	bench: SpecimenCommandBench,
	name: string,
	input: unknown
): Promise<CommandResult<unknown>> {
	const [
		list,
		render,
		capture,
		compare,
		diff,
		build,
		validate,
		runStory,
		a11y,
		profile,
		baseline,
		contract,
		suggest,
		coverage,
		matrix,
		inspect,
		migrate,
		pack,
		packCheck,
		packExport,
		themes,
		point,
		pointMove,
		pointCheck,
		noteAdd,
		noteList,
		noteCheck,
		noteMove,
		noteResolve,
		noteReopen,
		jobCreate,
		jobRun,
		decisionRecord,
		decisionGet,
		decisionList,
		decisionCheck,
	] = createSpecimenCommands(bench);
	switch (name) {
		case 'specimen-list':
			return execute(list, input);
		case 'specimen-render':
			return execute(render, input);
		case 'specimen-capture':
			return execute(capture, input);
		case 'specimen-compare':
			return execute(compare, input);
		case 'specimen-diff':
			return execute(diff, input);
		case 'specimen-build':
			return execute(build, input);
		case 'specimen-validate':
			return execute(validate, input);
		case 'specimen-run':
			return execute(runStory, input);
		case 'specimen-a11y':
			return execute(a11y, input);
		case 'specimen-profile':
			return execute(profile, input);
		case 'specimen-baseline':
			return execute(baseline, input);
		case 'specimen-suggest':
			return execute(suggest, input);
		case 'specimen-contract':
			return execute(contract, input);
		case 'specimen-coverage':
			return execute(coverage, input);
		case 'specimen-matrix':
			return execute(matrix, input);
		case 'specimen-inspect':
			return execute(inspect, input);
		case 'specimen-migrate':
			return execute(migrate, input);
		case 'specimen-pack':
			return execute(pack, input);
		case 'specimen-pack-check':
			return execute(packCheck, input);
		case 'specimen-pack-export':
			return execute(packExport, input);
		case 'specimen-themes':
			return execute(themes, input);
		case 'specimen-point':
			return execute(point, input);
		case 'specimen-point-move':
			return execute(pointMove, input);
		case 'specimen-point-check':
			return execute(pointCheck, input);
		case 'specimen-note-add':
			return execute(noteAdd, input);
		case 'specimen-note-list':
			return execute(noteList, input);
		case 'specimen-note-check':
			return execute(noteCheck, input);
		case 'specimen-note-move':
			return execute(noteMove, input);
		case 'specimen-note-resolve':
			return execute(noteResolve, input);
		case 'specimen-note-reopen':
			return execute(noteReopen, input);
		case 'specimen-job-create':
			return execute(jobCreate, input);
		case 'specimen-job-run':
			return execute(jobRun, input);
		case 'decision-record':
			return execute(decisionRecord, input);
		case 'decision-get':
			return execute(decisionGet, input);
		case 'decision-list':
			return execute(decisionList, input);
		case 'decision-check':
			return execute(decisionCheck, input);
		default:
			return failure({
				code: 'COMMAND_NOT_FOUND',
				message: `Unknown command: ${name}`,
				suggestion:
					'Use specimen list, validate, inspect, render, capture, compare, run, themes, migrate, diff, build, point, point-move, point-check, note-add, note-list, note-check, note-move, note-resolve, note-reopen, job-create, job-run, decision-record, decision-get, decision-list, or decision-check.',
			});
	}
}

/** Compare captures through the shared AFD command without creating a browser bench. */
export async function executeSpecimenDiff(
	input: unknown,
	options: { root?: string } = {}
): Promise<CommandResult<unknown>> {
	return execute(
		createDiffCommand((request) => diffCaptures(options.root ?? process.cwd(), request)),
		input
	);
}
