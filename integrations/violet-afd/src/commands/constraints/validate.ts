import {
	TokenDomainError,
	resolutionCacheFor,
	validateConstraints,
} from '@lushly-dev/violet-core/engine';
import {
	TokenValidationResultSchema,
	ValidationSummarySchema,
} from '@lushly-dev/violet-core/types';
import { z } from 'zod';
import type { CommandResult } from '../../types/command-result.js';
import type { CommandContext, CommandDefinition } from '../registry.js';

// =============================================================================
// Input/Output Schemas
// =============================================================================

const InputSchema = z.object({
	nodeId: z.string().min(1),
	filter: z.string().optional(), // Token filter pattern
	onlyViolating: z.boolean().default(false), // Omit passing tokens (violations: [])
});

const OutputSchema = z.object({
	nodeId: z.string(),
	valid: z.boolean(),
	results: z.array(TokenValidationResultSchema),
	summary: ValidationSummarySchema,
	/** Rules in the node's chain that are switched off, each with why when it says (#1327) */
	disabled: z.array(
		z.object({
			constraintId: z.string(),
			name: z.string(),
			source: z.string(),
			reason: z.string().optional(),
		}),
	),
});

type Input = z.input<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

// =============================================================================
// Handler
// =============================================================================

async function handler(rawInput: Input, context: CommandContext): Promise<CommandResult<Output>> {
	const input = InputSchema.parse(rawInput);
	const { db } = context;

	try {
		const report = await validateConstraints(db, input.nodeId, {
			filter: input.filter,
			onlyViolating: input.onlyViolating,
			cache: resolutionCacheFor(context),
		});

		const { errors, warnings, totalTokens } = report.summary;
		return {
			success: true,
			data: report,
			reasoning:
				errors === 0
					? `All ${totalTokens} tokens pass validation`
					: `${errors} errors, ${warnings} warnings found in ${totalTokens} tokens`,
		};
	} catch (error) {
		if (error instanceof TokenDomainError) {
			return {
				success: false,
				error: {
					code: error.code,
					message: error.message,
					suggestion: error.suggestion ?? "Use 'node.list' to see available nodes",
				},
			};
		}
		throw error;
	}
}

// =============================================================================
// Command Definition
// =============================================================================

export const validateCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'constraints.validate',
	description: 'Validate tokens against constraints',
	category: 'constraint',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,
	handler,
	examples: [
		{
			description: 'Validate all tokens',
			input: { nodeId: 'xbox' },
		},
		{
			description: 'Validate only violating color tokens',
			input: { nodeId: 'xbox', filter: 'color.*', onlyViolating: true },
		},
	],
};
