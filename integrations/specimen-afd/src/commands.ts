/** AFD command definitions shared by the CLI and MCP hosts. */
import type { CommandResult } from '@lushly-dev/afd-core';
import {
	defineCommand,
	failure,
	success,
	type ZodCommandDefinition,
} from '@lushly-dev/afd-server/define';
import { diffObservations } from '@lushly-dev/specimen';
import {
	a11yRequestSchema,
	a11yRunSchema,
	baselineRequestSchema,
	buildOutputSchema,
	captureRequestSchema,
	contractRequestSchema,
	contractRunSchema,
	coverageRequestSchema,
	coverageRunSchema,
	inspectRequestSchema,
	inspectResultSchema,
	matrixRequestSchema,
	matrixRunSchema,
	migrateRequestSchema,
	migrationReportSchema,
	observationSchema,
	profileRequestSchema,
	profileRunSchema,
	runRequestSchema,
	storyRunSchema,
	suiteRequestSchema,
	suiteRunSchema,
} from '@lushly-dev/specimen/schema';
import { z } from 'zod';

export {
	buildOutputSchema,
	contextSchema,
	inspectResultSchema,
	observationSchema,
	storyRunSchema,
} from '@lushly-dev/specimen/schema';

import type {
	A11yRequest,
	A11yRun,
	BaselineRequest,
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
	SuiteRequest,
	SuiteRun,
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
const entrySchema = z
	.object({
		id: z.string(),
		title: z.string(),
		module: z.string(),
		exportName: z.string(),
		component: z.string().optional(),
		story: storySchema.optional(),
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
const diffInput = z
	.object({
		left: observationSchema,
		right: observationSchema,
		allowContextDifferences: z.array(contextAxis).optional(),
		requireVisual: z.boolean().optional(),
	})
	.strict();
const diffOutput = z
	.object({
		status: z.enum(['changed', 'no-change-observed', 'insufficient-evidence']),
		differences: z.array(
			z
				.object({
					channel: z.enum(['dom', 'a11y', 'layout', 'styles', 'state']),
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
	list(): SpecimenEntry[];
	validate(target?: ValidationTarget): ValidationReport;
	render(request: CaptureRequest): Promise<Observation>;
	run(request: RunRequest): Promise<StoryRun>;
	runSuite(request?: SuiteRequest): Promise<SuiteRun>;
	a11y(request?: A11yRequest): Promise<A11yRun>;
	profile(request?: ProfileRequest): Promise<ProfileRun>;
	contract(request: ContractRequest): Promise<ContractRun>;
	coverage(request: CoverageRequest): Promise<CoverageRun>;
	matrix(request: MatrixRequest): Promise<MatrixRun>;
	recordBaseline(request: BaselineRequest): Promise<ProfileRun>;
	inspect(request: InspectRequest): Promise<InspectResult>;
	migrate(request?: MigrateRequest): Promise<MigrationReport>;
	build(outDir: string): Promise<z.infer<typeof buildOutputSchema>>;
}

/** One story by id, or a suite by filter; the handler tells them apart. */
const runInputSchema = runRequestSchema.partial({ id: true }).extend(suiteRequestSchema.shape);
const runOutputSchema = z.union([storyRunSchema, suiteRunSchema]);

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
		const errorCode =
			error instanceof z.ZodError
				? 'SPECIMEN_OUTPUT_INVALID'
				: error instanceof Error && 'code' in error && typeof error.code === 'string'
					? error.code
					: code;
		return failure({ code: errorCode, message: detail, suggestion });
	}
}

function createDiffCommand() {
	return defineCommand({
		category: 'specimen',
		expose: { mcp: true, cli: true },
		version: '0.1.0',
		name: 'specimen-diff',
		description: 'Compare compatible structured specimen observations',
		mutation: false,
		input: diffInput,
		output: diffOutput,
		handler: async (input) =>
			result(
				() =>
					diffObservations(input.left, input.right, {
						allowContextDifferences: input.allowContextDifferences,
						requireVisual: input.requireVisual,
					}),
				diffOutput,
				'SPECIMEN_DIFF_FAILED',
				'Capture both sides with compatible browser, context, checkpoint, and observation versions, or declare the intended context axis.'
			),
	});
}

/** Create the same validated command definitions for CLI and MCP adapters. */
export function createSpecimenCommands(bench: SpecimenCommandBench) {
	const common = { category: 'specimen', expose: { mcp: true, cli: true }, version: '0.1.0' };
	const list = defineCommand({
		...common,
		name: 'specimen-list',
		description: 'List registered specimens without executing their modules',
		mutation: false,
		input: z.object({}).strict(),
		output: z.object({ specimens: z.array(entrySchema) }).strict(),
		handler: async () =>
			result(
				() => ({ specimens: bench.list() }),
				z.object({ specimens: z.array(entrySchema) }).strict(),
				'SPECIMEN_LIST_FAILED',
				'Check the specimen configuration and try specimen-list again.'
			),
	});
	const validate = defineCommand({
		...common,
		name: 'specimen-validate',
		description:
			'Validate retained stories statically: identity, format and annotation support, with what only running them can settle',
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
		description: 'Capture one specimen in an isolated browser context',
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
			'Run one retained story by id, or a suite of them by filter (no id and no filter runs them all), as their Storybook tests run: render, play, then the accessibility check under each policy. A suite has worker limits, an optional once-only retry and per-story flake ids. A failing story is a successful command: read data.outcome.status for one story and data.outcome for a suite.',
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
					if (filter || workers || retry !== undefined || flakeCap !== undefined || capture)
						throw new Error('Give an id for one story, or suite options, not both.');
					return bench.run({ id, ...single, ...(screenshot ? { screenshot } : {}) });
				},
				runOutputSchema,
				'SPECIMEN_RUN_FAILED',
				'Use specimen-list to check the id or filter names retained stories, then validate them and check the browser installation.'
			),
	});
	const a11y = defineCommand({
		...common,
		name: 'specimen-a11y',
		description:
			'Run an accessibility check at a checkpoint, on one entry by id or those a filter selects: violations, what axe could not decide, and the exceptions that applied, each with its reason and what it excused. A story keeps its effective policy. A failing check is a successful command: read data.counts and each report.',
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
			"Run the selected cases and report each component's required partitions, from its schema, at the level those runs earn: represented, asserted, verified, missing or unknown. Unknown never counts as covered, and only verified counts toward complete.",
		mutation: false,
		input: coverageRequestSchema,
		output: coverageRunSchema,
		handler: async (input) =>
			result(
				() => bench.coverage(input),
				coverageRunSchema,
				'SPECIMEN_COVERAGE_FAILED',
				'Configure a custom elements manifest that describes the component, and use specimen-list to check the filter.'
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
	const diff = createDiffCommand();
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
	return [
		list,
		render,
		diff,
		build,
		validate,
		runStory,
		a11y,
		profile,
		baseline,
		contract,
		coverage,
		matrix,
		inspect,
		migrate,
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
		diff,
		build,
		validate,
		runStory,
		a11y,
		profile,
		baseline,
		contract,
		coverage,
		matrix,
		inspect,
		migrate,
	] = createSpecimenCommands(bench);
	switch (name) {
		case 'specimen-list':
			return execute(list, input);
		case 'specimen-render':
			return execute(render, input);
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
		default:
			return failure({
				code: 'COMMAND_NOT_FOUND',
				message: `Unknown command: ${name}`,
				suggestion: 'Use specimen list, validate, inspect, render, run, migrate, diff, or build.',
			});
	}
}

/** Compare captures through the shared AFD command without creating a browser bench. */
export async function executeSpecimenDiff(input: unknown): Promise<CommandResult<unknown>> {
	return execute(createDiffCommand(), input);
}
