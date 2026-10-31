import { transformerRegistry } from '@lushly-dev/violet-core/engine';
import { matchesGlob } from '@lushly-dev/violet-core/engine';
import { InheritanceResolutionError, resolveInheritance } from '@lushly-dev/violet-core/engine';
import type { ResolvedToken } from '@lushly-dev/violet-core/types';
import { z } from 'zod';
import { ErrorCodes, failure, success } from '../../types/command-result.js';
import type { CommandContext, CommandDefinition } from '../registry.js';

/**
 * Input schema for export command
 */
const InputSchema = z.object({
	nodeId: z.string().min(1),
	format: z.enum([
		'json',
		'css',
		'scss',
		'typescript',
		'swift',
		'kotlin',
		'dart',
		'tailwind',
		'lua',
	]),
	output: z.string().optional(), // File path (not used in handler, for CLI)
	filter: z.string().optional(), // Glob pattern
	prefix: z.string().optional(), // Variable prefix
	selector: z.string().optional(), // CSS selector (default: :root)
	pretty: z.boolean().default(true),
	includeComments: z.boolean().default(false),
	groupByCategory: z.boolean().default(false),
	exportStyle: z.enum(['flat', 'nested']).default('nested'),
	exportType: z.enum(['named', 'default', 'both']).default('both'),
	// Mobile-specific options
	className: z.string().optional(), // Swift/Kotlin/Dart class name
	accessLevel: z.enum(['public', 'internal', 'private']).optional(), // Swift access level
	packageName: z.string().optional(), // Kotlin package name
	// Tailwind-specific options
	esm: z.boolean().optional(), // Use ES modules for Tailwind config
	// Lua-specific options
	themeMap: z.record(z.string(), z.string()).optional(), // FenUI semantic name -> color token ID
	// CSS-specific options
	outputReferences: z.boolean().default(false), // Emit aliases as var(--target) instead of values
});

/**
 * Output schema for export command
 */
const OutputSchema = z.object({
	format: z.string(),
	content: z.string(),
	tokenCount: z.number(),
	nodeId: z.string(),
	outputPath: z.string().optional(),
});

type Output = z.infer<typeof OutputSchema>;

/**
 * Export command
 *
 * Export resolved tokens to various formats.
 */
export const exportCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'export',
	description:
		'Export tokens to various formats (json, css, scss, typescript, swift, kotlin, dart, tailwind, lua)',
	category: 'export',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,

	async handler(rawInput, context: CommandContext) {
		const input = InputSchema.parse(rawInput);
		const { db } = context;

		// Verify node exists
		const node = await db.getNode(input.nodeId);
		if (!node) {
			return failure({
				code: ErrorCodes.NODE_NOT_FOUND,
				message: `Node '${input.nodeId}' not found`,
				suggestion: `Use 'node.list' to see available nodes`,
			});
		}

		// Get transformer
		const transformer = transformerRegistry.get(input.format);
		if (!transformer) {
			return failure({
				code: ErrorCodes.VALIDATION_ERROR,
				message: `Unknown export format '${input.format}'`,
				suggestion:
					'Available formats: json, css, scss, typescript, swift, kotlin, dart, tailwind, lua',
			});
		}

		// Resolve tokens for node
		// Uses the same resolver as tokens.resolve so exports always match it
		// (overrides, resets, copies, includes and includePolicy).
		const ancestryChain = await db.getAncestryChain(input.nodeId);
		let tokens: ResolvedToken[];
		try {
			tokens = (await resolveInheritance(db, input.nodeId, ancestryChain, false)).sort((a, b) =>
				a.id.localeCompare(b.id),
			);
		} catch (error) {
			if (error instanceof InheritanceResolutionError) {
				return failure({
					code: ErrorCodes.CIRCULAR_REFERENCE,
					message: error.message,
					suggestion:
						'Remove the copy or include that creates the loop (see token.lineage / node.get) and export again',
				});
			}
			throw error;
		}

		if (input.outputReferences && input.format !== 'css') {
			return failure({
				code: ErrorCodes.VALIDATION_ERROR,
				message: `outputReferences is only supported for css exports, not ${input.format}`,
				suggestion: 'Drop outputReferences to export resolved values',
			});
		}

		// Apply filter if provided. References were already followed against the
		// whole node, so a filtered token can still point at one left out.
		let filteredTokens = tokens;
		if (input.filter) {
			const filter = input.filter;
			filteredTokens = tokens.filter((t) => matchesGlob(t.id, filter));
		}

		// Exports never emit unresolved aliases: fail on the first broken reference.
		const broken = filteredTokens.find((t) => t.referenceError);
		if (broken?.referenceError) {
			const { code, message } = broken.referenceError;
			return failure({
				code: ErrorCodes[code],
				message,
				suggestion:
					code === 'NOT_IMPLEMENTED'
						? `Replace the transform on '${broken.id}' with a literal value`
						: code === 'CIRCULAR_REFERENCE'
							? `Point one of the tokens in the loop at a literal value (see tokens.resolve for '${input.nodeId}')`
							: `Add the referenced token to '${input.nodeId}' or one of its ancestors, or fix the reference on '${broken.id}'`,
			});
		}

		// Transform. Transformers throw when options don't fit the tokens
		// (e.g. a Lua themeMap entry that names a missing color).
		let content: string;
		try {
			content = transformer.transform(filteredTokens, {
				prefix: input.prefix,
				selector: input.selector,
				pretty: input.pretty,
				includeComments: input.includeComments,
				groupByCategory: input.groupByCategory,
				exportStyle: input.exportStyle,
				exportType: input.exportType,
				// Mobile-specific options
				className: input.className,
				accessLevel: input.accessLevel,
				packageName: input.packageName,
				// Tailwind-specific options
				esm: input.esm,
				// Lua-specific options
				themeMap: input.themeMap,
				// CSS-specific options
				outputReferences: input.outputReferences,
			});
		} catch (error) {
			return failure({
				code: ErrorCodes.VALIDATION_ERROR,
				message: `Export to ${input.format} failed: ${error instanceof Error ? error.message : String(error)}`,
				suggestion: 'Check the export options against the tokens in this node',
			});
		}

		return success(
			{
				format: input.format,
				content,
				tokenCount: filteredTokens.length,
				nodeId: input.nodeId,
				outputPath: input.output,
			},
			{
				reasoning: `Exported ${filteredTokens.length} tokens from '${input.nodeId}' to ${input.format} format`,
			},
		);
	},

	examples: [
		{
			description: 'Export to CSS',
			input: { nodeId: 'global-base', format: 'css' },
		},
		{
			description: 'Export to CSS, keeping aliases as var() references',
			input: { nodeId: 'global-base', format: 'css', outputReferences: true },
		},
		{
			description: 'Export to JSON with filter',
			input: { nodeId: 'global-base', format: 'json', filter: 'color.*' },
		},
		{
			description: 'Export to TypeScript with prefix',
			input: {
				nodeId: 'global-base',
				format: 'typescript',
				prefix: 'vlt',
				exportStyle: 'flat',
			},
		},
	],
};
