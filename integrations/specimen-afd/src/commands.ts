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
	buildOutputSchema,
	captureRequestSchema,
	observationSchema,
} from '@lushly-dev/specimen/schema';
import { z } from 'zod';

export { buildOutputSchema, contextSchema, observationSchema } from '@lushly-dev/specimen/schema';

import type {
	CaptureRequest,
	Observation,
	SpecimenEntry,
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
	build(outDir: string): Promise<z.infer<typeof buildOutputSchema>>;
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
	return [list, render, diff, build, validate] as const;
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
	const [list, render, diff, build, validate] = createSpecimenCommands(bench);
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
		default:
			return failure({
				code: 'COMMAND_NOT_FOUND',
				message: `Unknown command: ${name}`,
				suggestion: 'Use specimen list, validate, render, diff, or build.',
			});
	}
}

/** Compare captures through the shared AFD command without creating a browser bench. */
export async function executeSpecimenDiff(input: unknown): Promise<CommandResult<unknown>> {
	return execute(createDiffCommand(), input);
}
