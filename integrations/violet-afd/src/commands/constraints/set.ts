import { checkPattern } from '@lushly-dev/violet-core/engine';
import { type Constraint, ConstraintSchema } from '@lushly-dev/violet-core/types';
import { z } from 'zod';
import type { CommandResult } from '../../types/command-result.js';
import { contextId, contextNow } from '../context-sources.js';
import type { CommandContext, CommandDefinition } from '../registry.js';

/** Duplicate constraint IDs in a list, deduplicated in encounter order */
export function findDuplicateConstraintIds(constraints: readonly Constraint[]): string[] {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const constraint of constraints) {
		if (seen.has(constraint.id)) duplicates.add(constraint.id);
		seen.add(constraint.id);
	}
	return [...duplicates];
}

/** Semantic checks beyond ConstraintSchema shared by constraints.set, import.tree, and export.tree */
export function validateConstraintSemantics(
	constraints: readonly Constraint[],
): { message: string; suggestion: string } | null {
	// A reason says why a rule is switched off; on a rule that runs it would mislead (#1327)
	const reasonOnEnabled = constraints.filter((c) => c.enabled && c.disabledReason);
	if (reasonOnEnabled.length > 0) {
		return {
			message: `disabledReason is set on enabled constraint(s): ${reasonOnEnabled.map((c) => c.id).join(', ')}`,
			suggestion:
				'Set enabled: false beside disabledReason to switch the rule off, or drop disabledReason',
		};
	}

	// Reject pattern constraints whose regex is invalid or can backtrack catastrophically,
	// and validate ramp constraints with field-specific recovery suggestions.
	for (const constraint of constraints) {
		if (constraint.config.type === 'pattern') {
			const check = checkPattern(constraint.config.pattern, constraint.config.flags);
			if (!check.ok) {
				return {
					message: `Constraint '${constraint.id}' has an unusable pattern: ${check.reason}`,
					suggestion:
						'Use a valid, simple regular expression without nested quantifiers such as (a+)+',
				};
			}
			continue;
		}

		if (constraint.config.type === 'ramp') {
			if (constraint.config.ramp.trim().length === 0) {
				return {
					message: `Constraint '${constraint.id}' has an empty ramp glob`,
					suggestion:
						"Set 'ramp' to a non-empty glob matching Stage 1 ramp tokens, such as 'ref.space.*'",
				};
			}
			if (constraint.config.repeatThreshold < 2) {
				return {
					message: `Constraint '${constraint.id}' has repeatThreshold ${constraint.config.repeatThreshold}, which must be at least 2`,
					suggestion:
						"Set 'repeatThreshold' to an integer >= 2 (default: 2) so repeat warnings fire when two or more tokens share an off-ramp value",
				};
			}
			if (constraint.config.warnUneven !== undefined) {
				const { maxRatioSpread } = constraint.config.warnUneven;
				if (!Number.isFinite(maxRatioSpread) || maxRatioSpread <= 1) {
					return {
						message: `Constraint '${constraint.id}' has warnUneven.maxRatioSpread ${maxRatioSpread}, which must be greater than 1`,
						suggestion:
							"Set 'warnUneven.maxRatioSpread' to a number greater than 1 (for example, 1.5) so uneven ramp jumps are flagged relative to the smallest adjacent step ratio",
					};
				}
			}
		}
	}

	return null;
}

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
	const duplicateIds = findDuplicateConstraintIds(input.constraints);
	if (duplicateIds.length > 0) {
		return {
			success: false,
			error: {
				code: 'DUPLICATE_CONSTRAINT_ID',
				message: `Duplicate constraint IDs: ${duplicateIds.join(', ')}`,
				suggestion: 'Ensure each constraint has a unique ID',
			},
		};
	}

	const semanticError = validateConstraintSemantics(input.constraints);
	if (semanticError) {
		return {
			success: false,
			error: {
				code: 'VALIDATION_ERROR',
				message: semanticError.message,
				suggestion: semanticError.suggestion,
			},
		};
	}

	// Store constraints and record audit event atomically using context clock/random for replay determinism (#2329)
	let finalConstraints: Constraint[];
	try {
		finalConstraints = await db.transaction(async () => {
			const existing = await db.getConstraints(input.nodeId);
			let nextConstraints: Constraint[];
			if (input.merge) {
				// Create a map for easy lookup
				const constraintMap = new Map(existing.map((c) => [c.id, c]));
				// Override/add new constraints
				for (const constraint of input.constraints) {
					constraintMap.set(constraint.id, constraint);
				}
				nextConstraints = Array.from(constraintMap.values());
			} else {
				nextConstraints = input.constraints;
			}

			await db.setConstraints(input.nodeId, nextConstraints);
			await db.addAuditEvent({
				id: contextId(context),
				timestamp: contextNow(context),
				eventType: 'constraint_set',
				actor: context.actor || 'system',
				targetNode: input.nodeId,
				targetToken: null,
				oldValue: JSON.stringify(existing),
				newValue: JSON.stringify(nextConstraints),
				metadata: JSON.stringify({
					merge: input.merge,
					constraintsSet: input.constraints.length,
					totalConstraints: nextConstraints.length,
				}),
			});
			return nextConstraints;
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			success: false,
			error: {
				code: 'INTERNAL_ERROR',
				message: `Failed to save constraints and audit event on '${input.nodeId}': ${message}`,
				suggestion: "Check database availability with 'system.doctor' and retry 'constraints.set'",
			},
		};
	}

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
