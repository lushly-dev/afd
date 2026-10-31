import {
	type ValidatorContext,
	matchesPattern,
	validateValue,
} from '@lushly-dev/violet-core/engine';
import {
	type ConstraintViolation,
	type ConstraintWithSource,
	TokenValidationResultSchema,
	ValidationSummarySchema,
} from '@lushly-dev/violet-core/types';
import { z } from 'zod';
import type { CommandResult } from '../../types/command-result.js';
import type { CommandContext, CommandDefinition } from '../registry.js';
import { tokensResolveCommand } from '../token/resolve.js';

// Type for resolved tokens from the resolve command output
interface ResolvedTokenOutput {
	id: string;
	value?: unknown;
	resolvedValue: string | number;
	metadata?: unknown;
	resolvedAt: string;
	inheritanceChain?: string[];
	operationHistory?: unknown[];
}

// =============================================================================
// Input/Output Schemas
// =============================================================================

const InputSchema = z.object({
	nodeId: z.string().min(1),
	filter: z.string().optional(), // Token filter pattern
});

const OutputSchema = z.object({
	nodeId: z.string(),
	valid: z.boolean(),
	results: z.array(TokenValidationResultSchema),
	summary: ValidationSummarySchema,
});

type Input = z.input<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

// =============================================================================
// Helper: Get all constraints including inherited
// =============================================================================

async function getAllConstraints(
	db: CommandContext['db'],
	nodeId: string,
): Promise<ConstraintWithSource[]> {
	const constraints: ConstraintWithSource[] = [];

	// Get ancestry from root to node
	const ancestryChain = await db.getAncestryChain(nodeId);

	// Collect constraints from ancestors (root first)
	for (const ancestorId of ancestryChain) {
		const ancestorConstraints = await db.getConstraints(ancestorId);
		for (const constraint of ancestorConstraints) {
			if (constraint.enabled) {
				constraints.push({ ...constraint, source: ancestorId });
			}
		}
	}

	// Add local constraints
	const localConstraints = await db.getConstraints(nodeId);
	for (const constraint of localConstraints) {
		if (constraint.enabled) {
			constraints.push({ ...constraint, source: nodeId });
		}
	}

	return constraints;
}

// =============================================================================
// Handler
// =============================================================================

async function handler(rawInput: Input, context: CommandContext): Promise<CommandResult<Output>> {
	const input = InputSchema.parse(rawInput);
	const { db } = context;

	// Validate node exists
	const node = await db.getNode(input.nodeId);
	if (!node) {
		return {
			success: false,
			error: {
				code: 'NODE_NOT_FOUND',
				message: `Node '${input.nodeId}' not found`,
				suggestion: "Use 'violet node list' to see available nodes",
			},
		};
	}

	// Resolve all tokens for the node
	const resolveResult = await tokensResolveCommand.handler({ nodeId: input.nodeId }, context);
	if (!resolveResult.success || !resolveResult.data) {
		return {
			success: false,
			error: {
				code: 'RESOLUTION_FAILED',
				message: 'Failed to resolve tokens for validation',
			},
		};
	}

	// The validator context (reference/contrast lookups) must see every resolved token:
	// a filter only narrows which tokens are checked, not which tokens exist.
	const allTokens: ResolvedTokenOutput[] = resolveResult.data.tokens;
	const tokenMap = new Map<string, ResolvedTokenOutput>(
		allTokens.map((t: ResolvedTokenOutput) => [t.id, t]),
	);
	const validatorContext: ValidatorContext = { allTokens: tokenMap };

	// Apply the filter only to the tokens that are checked
	let tokens: ResolvedTokenOutput[] = allTokens;
	if (input.filter) {
		const filter = input.filter;
		tokens = allTokens.filter((t: ResolvedTokenOutput) => matchesPattern(t.id, filter));
	}

	// Get all constraints
	const constraints = await getAllConstraints(db, input.nodeId);

	// Validate each token against matching constraints
	const results: Array<{
		tokenId: string;
		value: unknown;
		valid: boolean;
		violations: ConstraintViolation[];
	}> = [];

	let errors = 0;
	let warnings = 0;
	let infos = 0;

	for (const token of tokens) {
		const violations: ConstraintViolation[] = [];

		// Find constraints that apply to this token
		for (const constraint of constraints) {
			if (matchesPattern(token.id, constraint.applyTo)) {
				const violation = validateValue(
					token.resolvedValue,
					constraint.config,
					constraint.id,
					constraint.name,
					validatorContext,
				);

				if (violation) {
					// Apply the constraint's severity
					violations.push({
						...violation,
						severity: constraint.severity,
					});

					switch (constraint.severity) {
						case 'error':
							errors++;
							break;
						case 'warning':
							warnings++;
							break;
						case 'info':
							infos++;
							break;
					}
				}
			}
		}

		results.push({
			tokenId: token.id,
			value: token.resolvedValue,
			valid: violations.filter((v) => v.severity === 'error').length === 0,
			violations,
		});
	}

	const validTokens = results.filter((r) => r.valid).length;

	return {
		success: true,
		data: {
			nodeId: input.nodeId,
			valid: errors === 0,
			results,
			summary: {
				totalTokens: tokens.length,
				validTokens,
				errors,
				warnings,
				infos,
			},
		},
		reasoning:
			errors === 0
				? `All ${tokens.length} tokens pass validation`
				: `${errors} errors, ${warnings} warnings found in ${tokens.length} tokens`,
	};
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
			description: 'Validate only color tokens',
			input: { nodeId: 'xbox', filter: 'color.*' },
		},
	],
};
