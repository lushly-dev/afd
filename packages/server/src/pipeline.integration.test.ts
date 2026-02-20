/**
 * @fileoverview Integration tests for command pipeline execution
 *
 * Tests verify end-to-end pipeline execution including:
 * - Variable resolution across steps ($prev, $first, $steps[n], $steps.alias)
 * - Multi-step chained execution
 * - Conditional step execution (when clauses)
 * - Error propagation and continueOnFailure behavior
 * - Metadata aggregation (confidence, reasoning, warnings, sources)
 * - Timeout handling
 */

import type { CommandResult, PipelineRequest } from '@lushly-dev/afd-core';
import { failure, success } from '@lushly-dev/afd-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ZodCommandDefinition } from './schema.js';
import { createMcpServer, type McpServer } from './server.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TEST COMMANDS
// ═══════════════════════════════════════════════════════════════════════════════

const userGetCommand = {
	name: 'user-get',
	description: 'Get a user by ID',
	category: 'user',
	version: '1.0.0',
	mutation: false,
	inputSchema: z.object({
		id: z.number(),
	}),
	jsonSchema: {
		type: 'object' as const,
		properties: {
			id: { type: 'number' },
		},
		required: ['id'],
	},
	handler: async (input: {
		id: number;
	}): Promise<CommandResult<{ id: number; name: string; tier: string }>> => {
		if (input.id === 999) {
			return failure({
				code: 'NOT_FOUND',
				message: 'User 999 not found',
				suggestion: 'Check if user ID is correct, or create user first via user-create',
			});
		}
		return success(
			{ id: input.id, name: 'Alice', tier: input.id === 1 ? 'premium' : 'standard' },
			{ confidence: 0.95, reasoning: 'User found in cache' }
		);
	},
};

const orderListCommand = {
	name: 'order-list',
	description: 'List orders for a user',
	category: 'order',
	version: '1.0.0',
	mutation: false,
	inputSchema: z.object({
		userId: z.number(),
	}),
	jsonSchema: {
		type: 'object' as const,
		properties: {
			userId: { type: 'number' },
		},
		required: ['userId'],
	},
	handler: async (_input: {
		userId: number;
	}): Promise<CommandResult<{ orders: Array<{ id: string; total: number }> }>> => {
		return success(
			{
				orders: [
					{ id: 'order-1', total: 100 },
					{ id: 'order-2', total: 250 },
				],
			},
			{
				confidence: 0.99,
				reasoning: 'Orders fetched from database',
				warnings: [
					{ code: 'STALE_DATA', message: 'Data may be up to 5 minutes old', severity: 'info' },
				],
			}
		);
	},
};

const orderSummarizeCommand = {
	name: 'order-summarize',
	description: 'Summarize orders with user info',
	category: 'order',
	version: '1.0.0',
	mutation: false,
	inputSchema: z.object({
		orders: z.array(z.object({ id: z.string(), total: z.number() })),
		userName: z.string(),
	}),
	jsonSchema: {
		type: 'object' as const,
		properties: {
			orders: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						id: { type: 'string' },
						total: { type: 'number' },
					},
				},
			},
			userName: { type: 'string' },
		},
		required: ['orders', 'userName'],
	},
	handler: async (input: {
		orders: Array<{ id: string; total: number }>;
		userName: string;
	}): Promise<CommandResult<{ summary: string; totalAmount: number }>> => {
		const totalAmount = input.orders.reduce((sum, o) => sum + o.total, 0);
		return success(
			{
				summary: `${input.userName} has ${input.orders.length} orders`,
				totalAmount,
			},
			{ confidence: 0.87, reasoning: 'Computed aggregate statistics' }
		);
	},
};

const discountApplyCommand = {
	name: 'discount-apply',
	description: 'Apply discount for premium users',
	category: 'order',
	version: '1.0.0',
	mutation: true,
	inputSchema: z.object({
		userId: z.number(),
	}),
	jsonSchema: {
		type: 'object' as const,
		properties: {
			userId: { type: 'number' },
		},
		required: ['userId'],
	},
	handler: async (_input: {
		userId: number;
	}): Promise<CommandResult<{ discountApplied: boolean; percentage: number }>> => {
		return success({ discountApplied: true, percentage: 10 }, { confidence: 1.0 });
	},
};

const dataFetchCommand = {
	name: 'data-fetch',
	description: 'Fetch data with configurable confidence',
	category: 'data',
	version: '1.0.0',
	mutation: false,
	inputSchema: z.object({
		source: z.string(),
	}),
	jsonSchema: {
		type: 'object' as const,
		properties: {
			source: { type: 'string' },
		},
		required: ['source'],
	},
	handler: async (input: { source: string }): Promise<CommandResult<{ data: string }>> => {
		const confidence = input.source === 'cache' ? 0.95 : 0.8;
		return success({ data: `Data from ${input.source}` }, { confidence });
	},
};

const dataValidateCommand = {
	name: 'data-validate',
	description: 'Validate data with low confidence',
	category: 'data',
	version: '1.0.0',
	mutation: false,
	inputSchema: z.object({
		data: z.string(),
	}),
	jsonSchema: {
		type: 'object' as const,
		properties: {
			data: { type: 'string' },
		},
		required: ['data'],
	},
	handler: async (_input: { data: string }): Promise<CommandResult<{ valid: boolean }>> => {
		return success({ valid: true }, { confidence: 0.75, reasoning: 'Schema mismatch in 2 fields' });
	},
};

const slowCommand = {
	name: 'slow-command',
	description: 'A slow command for timeout testing',
	category: 'test',
	version: '1.0.0',
	mutation: false,
	inputSchema: z.object({
		delayMs: z.number().optional(),
	}),
	jsonSchema: {
		type: 'object' as const,
		properties: {
			delayMs: { type: 'number' },
		},
	},
	handler: async (input: { delayMs?: number }): Promise<CommandResult<{ completed: boolean }>> => {
		const delay = input.delayMs ?? 100;
		await new Promise((resolve) => setTimeout(resolve, delay));
		return success({ completed: true });
	},
};

const allCommands = [
	userGetCommand,
	orderListCommand,
	orderSummarizeCommand,
	discountApplyCommand,
	dataFetchCommand,
	dataValidateCommand,
	slowCommand,
];

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SUITE
// ═══════════════════════════════════════════════════════════════════════════════

describe('Pipeline Integration Tests', () => {
	let server: McpServer;

	beforeEach(async () => {
		server = createMcpServer({
			name: 'pipeline-test-server',
			version: '1.0.0',
			commands: allCommands as unknown as ZodCommandDefinition[],
			transport: 'stdio',
		});
		await server.start();
	});

	afterEach(async () => {
		if (server) {
			await server.stop();
		}
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// VARIABLE RESOLUTION SCENARIOS
	// ═══════════════════════════════════════════════════════════════════════════

	describe('Variable Resolution', () => {
		it('resolves $prev reference to previous step output', async () => {
			const request: PipelineRequest = {
				steps: [
					{ command: 'user-get', input: { id: 1 } },
					{ command: 'order-list', input: { userId: '$prev.id' } },
				],
			};

			const result = await server.executePipeline(request);

			expect(result.steps[0].status).toBe('success');
			expect(result.steps[1].status).toBe('success');
			expect(result.steps[1].data).toEqual({
				orders: [
					{ id: 'order-1', total: 100 },
					{ id: 'order-2', total: 250 },
				],
			});
			expect(result.metadata.completedSteps).toBe(2);
			expect(result.metadata.totalSteps).toBe(2);
		});

		it('resolves $first reference to first step output', async () => {
			const request: PipelineRequest = {
				steps: [
					{ command: 'user-get', input: { id: 1 } },
					{ command: 'order-list', input: { userId: '$prev.id' } },
					{
						command: 'order-summarize',
						input: {
							orders: '$prev.orders',
							userName: '$first.name',
						},
					},
				],
			};

			const result = await server.executePipeline(request);

			expect(result.steps[2].status).toBe('success');
			expect(result.steps[2].data).toMatchObject({
				summary: 'Alice has 2 orders',
				totalAmount: 350,
			});
		});

		it('resolves $steps[n] indexed reference', async () => {
			const request: PipelineRequest = {
				steps: [
					{ command: 'user-get', input: { id: 1 } },
					{ command: 'order-list', input: { userId: '$steps[0].id' } },
				],
			};

			const result = await server.executePipeline(request);

			expect(result.steps[1].status).toBe('success');
		});

		it('resolves $steps.alias named reference', async () => {
			const request: PipelineRequest = {
				steps: [
					{ command: 'user-get', input: { id: 1 }, as: 'user' },
					{ command: 'order-list', input: { userId: '$prev.id' }, as: 'orders' },
					{
						command: 'order-summarize',
						input: {
							orders: '$steps.orders.orders',
							userName: '$steps.user.name',
						},
					},
				],
			};

			const result = await server.executePipeline(request);

			expect(result.steps[2].status).toBe('success');
			expect(result.steps[2].data).toMatchObject({
				summary: 'Alice has 2 orders',
			});
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// CONFIDENCE AGGREGATION
	// ═══════════════════════════════════════════════════════════════════════════

	describe('Confidence Aggregation', () => {
		it('returns minimum confidence across all steps (weakest link)', async () => {
			const request: PipelineRequest = {
				steps: [
					{ command: 'data-fetch', input: { source: 'cache' } }, // 0.95 confidence
					{ command: 'data-validate', input: { data: '$prev.data' } }, // 0.75 confidence
				],
			};

			const result = await server.executePipeline(request);

			expect(result.metadata.confidence).toBe(0.75);
			expect(result.metadata.confidenceBreakdown).toHaveLength(2);
			expect(result.metadata.confidenceBreakdown[0].confidence).toBe(0.95);
			expect(result.metadata.confidenceBreakdown[1].confidence).toBe(0.75);
			expect(result.metadata.confidenceBreakdown[1].reasoning).toBe('Schema mismatch in 2 fields');
		});

		it('aggregates reasoning from all steps', async () => {
			const request: PipelineRequest = {
				steps: [
					{ command: 'user-get', input: { id: 1 } },
					{ command: 'order-list', input: { userId: '$prev.id' } },
				],
			};

			const result = await server.executePipeline(request);

			expect(result.metadata.reasoning).toHaveLength(2);
			expect(result.metadata.reasoning[0]).toMatchObject({
				stepIndex: 0,
				command: 'user-get',
				reasoning: 'User found in cache',
			});
			expect(result.metadata.reasoning[1]).toMatchObject({
				stepIndex: 1,
				command: 'order-list',
				reasoning: 'Orders fetched from database',
			});
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// ERROR HANDLING
	// ═══════════════════════════════════════════════════════════════════════════

	describe('Error Handling', () => {
		it('stops pipeline on first failure by default', async () => {
			const request: PipelineRequest = {
				steps: [
					{ command: 'user-get', input: { id: 999 } }, // Fails: NOT_FOUND
					{ command: 'order-list', input: { userId: '$prev.id' } }, // Should be skipped
				],
			};

			const result = await server.executePipeline(request);

			expect(result.steps[0].status).toBe('failure');
			expect(result.steps[0].error?.code).toBe('NOT_FOUND');
			expect(result.steps[0].error?.suggestion).toContain('user-create');
			expect(result.steps[1].status).toBe('skipped');
			expect(result.metadata.completedSteps).toBe(0);
		});

		it('continues on failure when continueOnFailure is true', async () => {
			const request: PipelineRequest = {
				steps: [
					{ command: 'user-get', input: { id: 999 } }, // Fails
					{ command: 'data-fetch', input: { source: 'api' } }, // Should still run
				],
				options: { continueOnFailure: true },
			};

			const result = await server.executePipeline(request);

			expect(result.steps[0].status).toBe('failure');
			expect(result.steps[1].status).toBe('success');
			expect(result.metadata.completedSteps).toBe(1);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// CONDITIONAL EXECUTION
	// ═══════════════════════════════════════════════════════════════════════════

	describe('Conditional Execution', () => {
		it('skips step when $exists condition fails', async () => {
			const request: PipelineRequest = {
				steps: [
					{ command: 'user-get', input: { id: 1 }, as: 'user' },
					{
						command: 'discount-apply',
						input: { userId: '$user.id' },
						when: { $exists: '$user.nonexistent' }, // Field doesn't exist
					},
				],
			};

			const result = await server.executePipeline(request);

			expect(result.steps[0].status).toBe('success');
			expect(result.steps[1].status).toBe('skipped');
		});

		it('runs step when $eq condition matches', async () => {
			const request: PipelineRequest = {
				steps: [
					{ command: 'user-get', input: { id: 1 }, as: 'user' }, // tier: 'premium'
					{
						command: 'discount-apply',
						input: { userId: '$steps.user.id' },
						when: { $eq: ['$steps.user.tier', 'premium'] },
					},
				],
			};

			const result = await server.executePipeline(request);

			expect(result.steps[0].status).toBe('success');
			expect(result.steps[1].status).toBe('success');
			expect(result.steps[1].data).toMatchObject({ discountApplied: true, percentage: 10 });
		});

		it('skips step when $eq condition does not match', async () => {
			const request: PipelineRequest = {
				steps: [
					{ command: 'user-get', input: { id: 2 }, as: 'user' }, // tier: 'standard'
					{
						command: 'discount-apply',
						input: { userId: '$steps.user.id' },
						when: { $eq: ['$steps.user.tier', 'premium'] },
					},
				],
			};

			const result = await server.executePipeline(request);

			expect(result.steps[0].status).toBe('success');
			expect(result.steps[1].status).toBe('skipped');
		});

		it('evaluates complex $and conditions', async () => {
			const request: PipelineRequest = {
				steps: [
					{ command: 'user-get', input: { id: 1 }, as: 'user' },
					{
						command: 'discount-apply',
						input: { userId: '$steps.user.id' },
						when: {
							$and: [{ $exists: '$steps.user.id' }, { $eq: ['$steps.user.tier', 'premium'] }],
						},
					},
				],
			};

			const result = await server.executePipeline(request);

			expect(result.steps[1].status).toBe('success');
		});

		it('evaluates $or conditions', async () => {
			const request: PipelineRequest = {
				steps: [
					{ command: 'user-get', input: { id: 2 }, as: 'user' }, // tier: 'standard'
					{
						command: 'discount-apply',
						input: { userId: '$steps.user.id' },
						when: {
							$or: [
								{ $eq: ['$steps.user.tier', 'premium'] },
								{ $eq: ['$steps.user.tier', 'standard'] }, // This matches
							],
						},
					},
				],
			};

			const result = await server.executePipeline(request);

			expect(result.steps[1].status).toBe('success');
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// METADATA AGGREGATION
	// ═══════════════════════════════════════════════════════════════════════════

	describe('Metadata Aggregation', () => {
		it('aggregates warnings from all steps with attribution', async () => {
			const request: PipelineRequest = {
				steps: [
					{ command: 'user-get', input: { id: 1 } },
					{ command: 'order-list', input: { userId: '$prev.id' } }, // Has STALE_DATA warning
				],
			};

			const result = await server.executePipeline(request);

			expect(result.metadata.warnings.length).toBeGreaterThanOrEqual(1);
			const staleWarning = result.metadata.warnings.find((w) => w.code === 'STALE_DATA');
			expect(staleWarning).toBeDefined();
			expect(staleWarning?.stepIndex).toBe(1);
		});

		it('tracks execution time for entire pipeline', async () => {
			const request: PipelineRequest = {
				steps: [
					{ command: 'user-get', input: { id: 1 } },
					{ command: 'order-list', input: { userId: '$prev.id' } },
				],
			};

			const result = await server.executePipeline(request);

			expect(result.metadata.executionTimeMs).toBeGreaterThan(0);
			expect(result.steps[0].executionTimeMs).toBeGreaterThan(0);
			expect(result.steps[1].executionTimeMs).toBeGreaterThan(0);
		});

		it('includes step aliases in results', async () => {
			const request: PipelineRequest = {
				steps: [
					{ command: 'user-get', input: { id: 1 }, as: 'userProfile' },
					{ command: 'order-list', input: { userId: '$prev.id' }, as: 'userOrders' },
				],
			};

			const result = await server.executePipeline(request);

			expect(result.steps[0].alias).toBe('userProfile');
			expect(result.steps[1].alias).toBe('userOrders');
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// TIMEOUT HANDLING
	// ═══════════════════════════════════════════════════════════════════════════

	describe('Timeout Handling', () => {
		it('skips remaining steps when pipeline timeout is exceeded', async () => {
			const request: PipelineRequest = {
				steps: [
					{ command: 'slow-command', input: { delayMs: 50 } },
					{ command: 'slow-command', input: { delayMs: 50 } },
					{ command: 'slow-command', input: { delayMs: 50 } },
				],
				options: { timeoutMs: 75 }, // Only enough for ~1-2 steps
			};

			const result = await server.executePipeline(request);

			// At least one step should succeed before timeout
			const successCount = result.steps.filter((s) => s.status === 'success').length;
			const skippedCount = result.steps.filter((s) => s.status === 'skipped').length;

			expect(successCount).toBeGreaterThanOrEqual(1);
			expect(skippedCount).toBeGreaterThanOrEqual(1);

			// Skipped steps should have timeout error
			const skippedWithTimeout = result.steps.find(
				(s) => s.status === 'skipped' && s.error?.code === 'PIPELINE_TIMEOUT'
			);
			expect(skippedWithTimeout).toBeDefined();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// EDGE CASES
	// ═══════════════════════════════════════════════════════════════════════════

	describe('Edge Cases', () => {
		it('handles empty pipeline gracefully', async () => {
			const request: PipelineRequest = {
				steps: [],
			};

			const result = await server.executePipeline(request);

			expect(result.data).toBeUndefined();
			expect(result.steps).toHaveLength(0);
			expect(result.metadata.completedSteps).toBe(0);
			expect(result.metadata.totalSteps).toBe(0);
		});

		it('handles single-step pipeline', async () => {
			const request: PipelineRequest = {
				steps: [{ command: 'user-get', input: { id: 1 } }],
			};

			const result = await server.executePipeline(request);

			expect(result.steps).toHaveLength(1);
			expect(result.steps[0].status).toBe('success');
			expect(result.data).toMatchObject({ id: 1, name: 'Alice' });
		});

		it('returns final successful step data as pipeline output', async () => {
			const request: PipelineRequest = {
				steps: [
					{ command: 'user-get', input: { id: 1 } },
					{ command: 'order-list', input: { userId: '$prev.id' } },
					{
						command: 'order-summarize',
						input: {
							orders: '$prev.orders',
							userName: '$first.name',
						},
					},
				],
			};

			const result = await server.executePipeline(request);

			// Final data should be from the last step
			expect(result.data).toMatchObject({
				summary: 'Alice has 2 orders',
				totalAmount: 350,
			});
		});
	});
});
