import { z } from 'zod';
import type { CommandResult } from '../../types/command-result.js';
import { validateCommand } from '../constraints/validate.js';
import type { CommandContext, CommandDefinition } from '../registry.js';

// =============================================================================
// Input/Output Schemas
// =============================================================================

const InputSchema = z.object({
	nodeId: z.string().min(1),
	filter: z.string().optional(), // Token pattern filter
	format: z.enum(['summary', 'detailed', 'json']).optional().default('summary'),
});

const ComplianceIssueSchema = z.object({
	tokenId: z.string(),
	value: z.unknown(),
	constraintId: z.string(),
	constraintName: z.string(),
	severity: z.enum(['error', 'warning', 'info']),
	message: z.string(),
	expected: z.string().optional(),
});

const OutputSchema = z.object({
	nodeId: z.string(),
	compliant: z.boolean(),
	score: z.number(), // 0-100 compliance score
	issues: z.array(ComplianceIssueSchema),
	summary: z.object({
		totalTokens: z.number(),
		totalConstraints: z.number(),
		errors: z.number(),
		warnings: z.number(),
		infos: z.number(),
	}),
	recommendations: z.array(z.string()),
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

	// Run validation
	const validationResult = await validateCommand.handler(
		{ nodeId: input.nodeId, filter: input.filter },
		context,
	);

	if (!validationResult.success || !validationResult.data) {
		return {
			success: false,
			error: {
				code: 'VALIDATION_FAILED',
				message: 'Failed to validate tokens',
			},
		};
	}

	const validation = validationResult.data;

	// Convert violations to compliance issues
	const issues: Array<{
		tokenId: string;
		value: unknown;
		constraintId: string;
		constraintName: string;
		severity: 'error' | 'warning' | 'info';
		message: string;
		expected?: string;
	}> = [];

	for (const result of validation.results) {
		for (const violation of result.violations) {
			issues.push({
				tokenId: result.tokenId,
				value: result.value,
				constraintId: violation.constraintId,
				constraintName: violation.constraintName,
				severity: violation.severity,
				message: violation.message,
				expected: violation.expected,
			});
		}
	}

	// Count constraints checked
	const constraintIds = new Set<string>();
	for (const result of validation.results) {
		for (const violation of result.violations) {
			constraintIds.add(violation.constraintId);
		}
	}

	// Get total constraints from node and ancestors
	const ancestryChain = await db.getAncestryChain(input.nodeId);
	let totalConstraints = 0;
	for (const ancestorId of [...ancestryChain, input.nodeId]) {
		const constraints = await db.getConstraints(ancestorId);
		totalConstraints += constraints.filter((c) => c.enabled).length;
	}

	// Calculate compliance score
	// Score = 100 - (weighted violation penalty)
	// Errors: -10 points, Warnings: -5 points, Infos: -1 point
	const errorPenalty = validation.summary.errors * 10;
	const warningPenalty = validation.summary.warnings * 5;
	const infoPenalty = validation.summary.infos * 1;
	const totalPenalty = errorPenalty + warningPenalty + infoPenalty;
	const score = Math.max(0, Math.min(100, 100 - totalPenalty));

	// Generate recommendations
	const recommendations: string[] = [];

	if (validation.summary.errors > 0) {
		recommendations.push(`Fix ${validation.summary.errors} error(s) to achieve compliance`);
	}

	if (validation.summary.warnings > 0) {
		recommendations.push(`Review ${validation.summary.warnings} warning(s) for potential issues`);
	}

	// Find common constraint violations
	const violationCounts = new Map<string, number>();
	for (const issue of issues) {
		const key = issue.constraintName;
		violationCounts.set(key, (violationCounts.get(key) || 0) + 1);
	}

	const topViolations = [...violationCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);

	for (const [constraintName, count] of topViolations) {
		if (count > 1) {
			recommendations.push(
				`"${constraintName}" constraint violated ${count} times - consider reviewing related tokens`,
			);
		}
	}

	if (score === 100) {
		recommendations.push('All tokens comply with defined constraints');
	}

	return {
		success: true,
		data: {
			nodeId: input.nodeId,
			compliant: validation.summary.errors === 0,
			score,
			issues,
			summary: {
				totalTokens: validation.summary.totalTokens,
				totalConstraints,
				errors: validation.summary.errors,
				warnings: validation.summary.warnings,
				infos: validation.summary.infos,
			},
			recommendations,
		},
		reasoning:
			score === 100
				? 'Full compliance - all tokens meet constraints'
				: `Compliance score: ${score}/100 with ${issues.length} issues found`,
	};
}

// =============================================================================
// Command Definition
// =============================================================================

export const analyzeComplianceCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'analyze.compliance',
	description: 'Generate compliance report for a node',
	category: 'analyze',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,
	handler,
	examples: [
		{
			description: 'Get compliance report',
			input: { nodeId: 'xbox-ios' },
		},
		{
			description: 'Get detailed color compliance',
			input: { nodeId: 'xbox-ios', filter: 'color.*', format: 'detailed' },
		},
	],
};
