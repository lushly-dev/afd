/** AFD command definitions shared by the CLI and MCP hosts. */
import type { CommandResult } from '@lushly-dev/afd-core';
import {
	defineCommand,
	failure,
	success,
	type ZodCommandDefinition,
} from '@lushly-dev/afd-server/define';
import { z } from 'zod';
import { diffObservations } from './diff.js';
import { captureRequestSchema, contextSchema } from './schema.js';
import type { CaptureRequest, Observation, SpecimenEntry } from './types.js';

export { contextSchema } from './schema.js';

const completeness = z
	.object({
		status: z.enum(['complete', 'partial', 'unsupported', 'not-requested']),
		scope: z.string(),
		reasons: z.array(z.string()),
	})
	.strict();
const element = z
	.object({
		ref: z.string(),
		tag: z.string(),
		attributes: z.record(z.string(), z.string()),
		box: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).strict(),
		scroll: z
			.object({
				width: z.number(),
				height: z.number(),
				clientWidth: z.number(),
				clientHeight: z.number(),
			})
			.strict(),
		styles: z.record(z.string(), z.string()),
		state: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
	})
	.strict();
export const observationSchema = z
	.object({
		manifest: z
			.object({
				captureVersion: z.string().min(1),
				normalizationVersion: z.string().min(1),
				specimenId: z.string().min(1),
				checkpoint: z.string().min(1),
				source: z
					.object({
						revision: z.string().nullable(),
						digest: z.string().min(1),
						dirty: z.boolean().nullable(),
					})
					.strict(),
				dependencies: z.string().min(1),
				browser: z.object({ name: z.string().min(1), version: z.string().min(1) }).strict(),
				context: contextSchema,
			})
			.strict(),
		channels: z
			.object({
				dom: z.object({ raw: z.string(), normalized: z.string() }).strict(),
				a11y: z.object({ snapshot: z.string(), axe: z.literal('not-run') }).strict(),
				elements: z.array(element),
				console: z.object({ errors: z.array(z.string()), warnings: z.array(z.string()) }).strict(),
				visual: z.object({ path: z.string().nullable() }).strict(),
			})
			.strict(),
		completeness: z
			.object({
				dom: completeness,
				a11y: completeness,
				layout: completeness,
				styles: completeness,
				tokens: completeness,
				events: completeness,
				visual: completeness,
			})
			.strict(),
	})
	.strict();
const entrySchema = z
	.object({
		id: z.string(),
		title: z.string(),
		module: z.string(),
		exportName: z.string(),
		component: z.string().optional(),
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
export const buildOutputSchema = z
	.object({
		directory: z.string(),
		shellBytes: z.number().int().nonnegative(),
		budget: z.number().int().positive(),
		files: z.array(z.string()),
	})
	.strict();

/** The command layer requires only these bench operations, allowing transport tests without a browser. */
export interface SpecimenCommandBench {
	list(): SpecimenEntry[];
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
	return [list, render, diff, build] as const;
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
	const [list, render, diff, build] = createSpecimenCommands(bench);
	switch (name) {
		case 'specimen-list':
			return execute(list, input);
		case 'specimen-render':
			return execute(render, input);
		case 'specimen-diff':
			return execute(diff, input);
		case 'specimen-build':
			return execute(build, input);
		default:
			return failure({
				code: 'COMMAND_NOT_FOUND',
				message: `Unknown command: ${name}`,
				suggestion: 'Use specimen list, render, diff, or build.',
			});
	}
}

/** Compare captures through the shared AFD command without creating a browser bench. */
export async function executeSpecimenDiff(input: unknown): Promise<CommandResult<unknown>> {
	return execute(createDiffCommand(), input);
}
