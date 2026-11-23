import { checkPattern } from '@lushly-dev/violet-core/engine';
import { type Constraint, ConstraintSchema } from '@lushly-dev/violet-core/types';
import { z } from 'zod';
import type { CommandResult } from '../../types/command-result.js';
import type { CommandContext, CommandDefinition } from '../registry.js';

// =============================================================================
// Input/Output Schemas
// =============================================================================

const InputSchema = z.object({
	nodeId: z.string().min(1),
	constraints: z.array(ConstraintSchema),
	merge: z.boolean().default(false), // If true, merge with existing; if false, replace
});

const OutputSchema = z.object({
	nodeId: z.string(),
	constraintsSet: z.number(),
	totalConstraints: z.number(),
});

type Input = z.input<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

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

	// Check for duplicate constraint IDs in input
	const ids = input.constraints.map((c) => c.id);
	const duplicateIds = ids.filter((id, i) => ids.indexOf(id) !== i);
	if (duplicateIds.length > 0) {
		return {
			success: false,
			error: {
				code: 'DUPLICATE_CONSTRAINT_ID',
				message: `Duplicate constraint IDs: ${[...new Set(duplicateIds)].join(', ')}`,
				suggestion: 'Ensure each constraint has a unique ID',
			},
		};
	}

	// A reason says why a rule is switched off; on a rule that runs it would mislead (#1327)
	const reasonOnEnabled = input.constraints.filter((c) => c.enabled && c.disabledReason);
	if (reasonOnEnabled.length > 0) {
		return {
			success: false,
			error: {
				code: 'VALIDATION_ERROR',
				message: `disabledReason is set on enabled constraint(s): ${reasonOnEnabled.map((c) => c.id).join(', ')}`,
				suggestion:
					'Set enabled: false beside disabledReason to switch the rule off, or drop disabledReason',
			},
		};
	}

	// Reject pattern constraints whose regex is invalid or can backtrack catastrophically,
	// and validate ramp constraints with field-specific recovery suggestions.
	for (const constraint of input.constraints) {
		if (constraint.config.type === 'pattern') {
			const check = checkPattern(constraint.config.pattern, constraint.config.flags);
			if (!check.ok) {
				return {
					success: false,
					error: {
						code: 'VALIDATION_ERROR',
						message: `Constraint '${constraint.id}' has an unusable pattern: ${check.reason}`,
						suggestion:
							'Use a valid, simple regular expression without nested quantifiers such as (a+)+',
					},
				};
			}
			continue;
		}

		if (constraint.config.type === 'ramp') {
			if (constraint.config.ramp.trim().length === 0) {
				return {
					success: false,
					error: {
						code: 'VALIDATION_ERROR',
						message: `Constraint '${constraint.id}' has an empty ramp glob`,
						suggestion:
							"Set 'ramp' to a non-empty glob matching Stage 1 ramp tokens, such as 'ref.space.*'",
					},
				};
			}
			if (constraint.config.repeatThreshold < 2) {
				return {
					success: false,
					error: {
						code: 'VALIDATION_ERROR',
						message: `Constraint '${constraint.id}' has repeatThreshold ${constraint.config.repeatThreshold}, which must be at least 2`,
						suggestion:
							"Set 'repeatThreshold' to an integer >= 2 (default: 2) so repeat warnings fire when two or more tokens share an off-ramp value",
					},
				};
			}
		}
	}

	// Get existing constraints if merging
	let finalConstraints: Constraint[];
	if (input.merge) {
		const existing = await db.getConstraints(input.nodeId);
		// Create a map for easy lookup
		const constraintMap = new Map(existing.map((c) => [c.id, c]));
		// Override/add new constraints
		for (const constraint of input.constraints) {
			constraintMap.set(constraint.id, constraint);
		}
		finalConstraints = Array.from(constraintMap.values());
	} else {
		finalConstraints = input.constraints;
	}

	// Store constraints
	await db.setConstraints(input.nodeId, finalConstraints);

	return {
		success: true,
		data: {
			nodeId: input.nodeId,
			constraintsSet: input.constraints.length,
			totalConstraints: finalConstraints.length,
		},
		reasoning: input.merge
			? `Merged ${input.constraints.length} constraints, total now ${finalConstraints.length}`
			: `Set ${finalConstraints.length} constraints on node '${input.nodeId}'`,
	};
}

// =============================================================================
// Command Definition
// =============================================================================

export const setCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'constraints.set',
	description: 'Define constraints for a node',
	category: 'constraint',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,
	handler,
	examples: [
		{
			description: 'Set color format constraint',
			input: {
				nodeId: 'global-base',
				constraints: [
					{
						id: 'color-hex',
						name: 'Colors must be hex format',
						config: { type: 'pattern', pattern: '^#[0-9A-Fa-f]{6}$' },
						applyTo: 'color.*',
						severity: 'error',
					},
				],
			},
		},
		{
			description: 'Set spacing scale constraint',
			input: {
				nodeId: 'global-base',
				constraints: [
					{
						id: 'spacing-8px',
						name: 'Spacing must be 8px multiples',
						config: { type: 'scale', base: 8 },
						applyTo: 'spacing.*',
						severity: 'error',
					},
				],
			},
		},
		{
			description: 'Merge a two-stage ramp constraint without replacing existing constraints',
			input: {
				nodeId: 'global-base',
				merge: true,
				constraints: [
					{
						id: 'space-ramp',
						name: 'Spacing tokens use ref.space.*',
						config: {
							type: 'ramp',
							ramp: 'ref.space.*',
							requireOffRampReason: true,
							repeatThreshold: 2,
						},
						applyTo: 'space.*',
						severity: 'error',
					},
				],
			},
		},
	],
};
