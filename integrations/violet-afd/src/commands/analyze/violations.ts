import { resolutionCacheFor, withResolutionCache } from '@lushly-dev/violet-core/engine';
import { InheritanceResolutionError, resolveNodeTokenMap } from '@lushly-dev/violet-core/engine';
import { ConstraintSeveritySchema } from '@lushly-dev/violet-core/types';
import { z } from 'zod';
import { ErrorCodes, failure, success } from '../../types/command-result.js';
import { validateCommand } from '../constraints/validate.js';
import { selectSubtree } from '../node/scope.js';
import type { CommandContext, CommandDefinition } from '../registry.js';

/**
 * Input schema for analyze.violations command
 */
const InputSchema = z.object({
	rootId: z.string().min(1).optional(), // Subtree to check; defaults to every tree
	severity: ConstraintSeveritySchema.optional(), // Only this severity
});

export const NodeViolationSchema = z.object({
	nodeId: z.string(),
	owner: z.string().optional(),
	tokenId: z.string(),
	value: z.union([z.string(), z.number()]),
	/** Node where the failing value is set */
	source: z.string(),
	/** True when the node inherits the failing value rather than setting it */
	inherited: z.boolean(),
	constraintId: z.string(),
	constraintName: z.string(),
	severity: ConstraintSeveritySchema,
	message: z.string(),
	expected: z.string().optional(),
	actual: z.string().optional(),
});

/**
 * Output schema for analyze.violations command
 */
const OutputSchema = z.object({
	violations: z.array(NodeViolationSchema),
	summary: z.object({
		total: z.number(),
		errors: z.number(),
		warnings: z.number(),
		infos: z.number(),
		/** Nodes with at least one violation */
		nodes: z.number(),
		byNode: z.record(z.string(), z.number()),
		/** Nodes that could not be checked (e.g. a copy/include cycle) */
		unresolved: z.array(z.string()),
	}),
});

type Output = z.infer<typeof OutputSchema>;
export type NodeViolation = Output['violations'][number];

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;

/**
 * Violations on one node, each with where its failing value is set; null when
 * the node can't be resolved or validated (e.g. a copy/include cycle).
 */
export async function nodeViolations(
	context: CommandContext,
	node: { id: string; owner?: string | null },
	severity: NodeViolation['severity'] | undefined,
): Promise<NodeViolation[] | null> {
	let resolved: Awaited<ReturnType<typeof resolveNodeTokenMap>>;
	try {
		resolved = await resolveNodeTokenMap(context.db, node.id, resolutionCacheFor(context));
	} catch (error) {
		if (!(error instanceof InheritanceResolutionError)) throw error;
		return null;
	}
	const result = await validateCommand.handler({ nodeId: node.id }, context);
	if (!result.success || !result.data) return null;

	return result.data.results.flatMap((tokenResult) => {
		const source = resolved.get(tokenResult.tokenId)?.resolvedAt ?? node.id;
		return tokenResult.violations
			.filter((violation) => !severity || violation.severity === severity)
			.map((violation) => ({
				nodeId: node.id,
				...(node.owner ? { owner: node.owner } : {}),
				tokenId: tokenResult.tokenId,
				value: tokenResult.value as string | number,
				source,
				inherited: source !== node.id,
				constraintId: violation.constraintId,
				constraintName: violation.constraintName,
				severity: violation.severity,
				message: violation.message,
				...(violation.expected ? { expected: violation.expected } : {}),
				...(violation.actual ? { actual: violation.actual } : {}),
			}));
	});
}

/**
 * analyze.violations command
 *
 * Every constraint violation across a subtree in one list: which node, which
 * token and rule, the measured vs. required value, where the failing value is
 * set, and who owns the node. Answers "where are the problems?" without
 * checking nodes one at a time.
 */
export const analyzeViolationsCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'analyze.violations',
	description:
		'List every constraint violation across a subtree, with the node, rule, values and owner',
	category: 'analyze',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,

	async handler(rawInput, context: CommandContext) {
		const { db } = context;

		// Parse input to apply defaults
		const input = InputSchema.parse(rawInput);

		const scope = await selectSubtree(db, input.rootId);
		if (!scope) {
			return failure({
				code: ErrorCodes.NODE_NOT_FOUND,
				message: `Node '${input.rootId}' not found`,
				suggestion: `Use 'node.list' to see available nodes`,
			});
		}

		const violations: NodeViolation[] = [];
		const unresolved: string[] = [];
		const order = new Map(scope.map((node, index) => [node.id, index]));

		// Read-only from here: share resolved chains between the nodes
		const scoped = withResolutionCache(context);
		for (const node of scope) {
			const found = await nodeViolations(scoped, node, input.severity);
			if (found) violations.push(...found);
			else unresolved.push(node.id);
		}

		violations.sort(
			(a, b) =>
				SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
				(order.get(a.nodeId) ?? 0) - (order.get(b.nodeId) ?? 0) ||
				a.tokenId.localeCompare(b.tokenId),
		);

		const byNode: Record<string, number> = {};
		for (const violation of violations) {
			byNode[violation.nodeId] = (byNode[violation.nodeId] ?? 0) + 1;
		}
		const count = (severity: NodeViolation['severity']) =>
			violations.filter((violation) => violation.severity === severity).length;
		const nodes = Object.keys(byNode).length;

		return success(
			{
				violations,
				summary: {
					total: violations.length,
					errors: count('error'),
					warnings: count('warning'),
					infos: count('info'),
					nodes,
					byNode,
					unresolved,
				},
			},
			{
				reasoning: `${violations.length} violation(s) on ${nodes} of ${scope.length} node(s)${unresolved.length > 0 ? `; ${unresolved.length} node(s) could not be checked` : ''}`,
			},
		);
	},

	examples: [
		{
			description: 'Every violation in the system',
			input: {},
		},
		{
			description: 'Errors only, within the office subtree',
			input: { rootId: 'office', severity: 'error' },
		},
	],
};
