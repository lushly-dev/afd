/**
 * @fileoverview JTBD (Jobs-to-be-Done) scenario tests for command pipelines
 *
 * These tests implement the JTBD scenarios defined in the Command Pipeline spec:
 * docs/specs/command-pipeline/00-overview.md
 *
 * Scenarios:
 * 1. Variable resolution in pipeline ($prev references)
 * 2. Confidence aggregation (weakest link)
 * 3. Error with actionable suggestion
 * 4. Conditional step skipping
 * 5. Alias references
 */

import type { CommandResult, PipelineRequest } from '@lushly-dev/afd-core';
import { failure, success } from '@lushly-dev/afd-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createMcpServer, type McpServer } from './server.js';
import type { ZodCommandDefinition } from './schema.js';

// ═══════════════════════════════════════════════════════════════════════════════
// JTBD TEST FIXTURES & COMMANDS
// ═══════════════════════════════════════════════════════════════════════════════

// Simulates fixture: fixtures/basic-user.json
// { "app": "afd-test", "clearFirst": true, "users": [{ "id": 1, "name": "Alice", "tier": "standard" }] }
const fixtureUsers: Record<number, { id: number; name: string; tier: string }> = {
	1: { id: 1, name: 'Alice', tier: 'standard' },
};

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
		properties: { id: { type: 'number' } },
		required: ['id'],
	},
	handler: async (input: {
		id: number;
	}): Promise<CommandResult<{ id: number; name: string; tier: string }>> => {
		const user = fixtureUsers[input.id];
		if (!user) {
			return failure({
				code: 'NOT_FOUND',
				message: `User ${input.id} not found`,
				suggestion: 'Check if user ID is correct, or create user first via user-create',
			});
		}
		return success(user, { confidence: 0.95 });
	},
};

const userFormatCommand = {
	name: 'user-format',
	description: 'Format user information',
	category: 'user',
	version: '1.0.0',
	mutation: false,
	inputSchema: z.object({
		user: z.object({
			id: z.number(),
			name: z.string(),
			tier: z.string(),
		}),
	}),
	jsonSchema: {
		type: 'object' as const,
		properties: {
			user: {
				type: 'object',
				properties: {
					id: { type: 'number' },
					name: { type: 'string' },
					tier: { type: 'string' },
				},
			},
		},
		required: ['user'],
	},
	handler: async (input: {
		user: { id: number; name: string; tier: string };
	}): Promise<CommandResult<{ formatted: string }>> => {
		return success(
			{ formatted: `User: ${input.user.name} (${input.user.tier})` },
			{ confidence: 1.0 }
		);
	},
};

const dataFetchCommand = {
	name: 'data-fetch',
	description: 'Fetch data from a source',
	category: 'data',
	version: '1.0.0',
	mutation: false,
	inputSchema: z.object({
		source: z.string(),
	}),
	jsonSchema: {
		type: 'object' as const,
		properties: { source: { type: 'string' } },
		required: ['source'],
	},
	handler: async (input: { source: string }): Promise<CommandResult<{ data: string }>> => {
		const confidence = input.source === 'cache' ? 0.95 : 0.85;
		return success(
			{ data: `Data from ${input.source}` },
			{ confidence, reasoning: `Fetched from ${input.source} source` }
		);
	},
};

const dataValidateCommand = {
	name: 'data-validate',
	description: 'Validate data',
	category: 'data',
	version: '1.0.0',
	mutation: false,
	inputSchema: z.object({
		data: z.string(),
	}),
	jsonSchema: {
		type: 'object' as const,
		properties: { data: { type: 'string' } },
		required: ['data'],
	},
	handler: async (_input: { data: string }): Promise<CommandResult<{ valid: boolean }>> => {
		return success({ valid: true }, { confidence: 0.8, reasoning: 'Schema mismatch in 2 fields' });
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
		properties: { userId: { type: 'number' } },
		required: ['userId'],
	},
	handler: async (_input: {
		userId: number;
	}): Promise<CommandResult<{ orders: Array<{ id: string; total: number }> }>> => {
		return success({ orders: [{ id: 'order-1', total: 100 }] }, { confidence: 0.99 });
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
		properties: { userId: { type: 'number' } },
		required: ['userId'],
	},
	handler: async (_input: {
		userId: number;
	}): Promise<CommandResult<{ discountApplied: boolean }>> => {
		return success({ discountApplied: true });
	},
};

const userPrefsCommand = {
	name: 'user-prefs',
	description: 'Get user preferences',
	category: 'user',
	version: '1.0.0',
	mutation: false,
	inputSchema: z.object({
		id: z.number(),
	}),
	jsonSchema: {
		type: 'object' as const,
		properties: { id: { type: 'number' } },
		required: ['id'],
	},
	handler: async (_input: {
		id: number;
	}): Promise<CommandResult<{ theme: string; notifications: boolean }>> => {
		return success({ theme: 'dark', notifications: true }, { confidence: 0.98 });
	},
};

const userMergeCommand = {
	name: 'user-merge',
	description: 'Merge user profile with preferences',
	category: 'user',
	version: '1.0.0',
	mutation: false,
	inputSchema: z.object({
		user: z.object({
			id: z.number(),
			name: z.string(),
			tier: z.string(),
		}),
		preferences: z.object({
			theme: z.string(),
			notifications: z.boolean(),
		}),
	}),
	jsonSchema: {
		type: 'object' as const,
		properties: {
			user: { type: 'object' },
			preferences: { type: 'object' },
		},
		required: ['user', 'preferences'],
	},
	handler: async (input: {
		user: { id: number; name: string; tier: string };
		preferences: { theme: string; notifications: boolean };
	}): Promise<CommandResult<{ merged: boolean; result: unknown }>> => {
		return success({
			merged: true,
			result: { ...input.user, ...input.preferences },
		});
	},
};

const allCommands = [
	userGetCommand,
	userFormatCommand,
	dataFetchCommand,
	dataValidateCommand,
	orderListCommand,
	discountApplyCommand,
	userPrefsCommand,
	userMergeCommand,
];

// ═══════════════════════════════════════════════════════════════════════════════
// JTBD SCENARIO TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('JTBD Pipeline Scenarios', () => {
	let server: McpServer;

	beforeEach(async () => {
		server = createMcpServer({
			name: 'jtbd-test-server',
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
	// Scenario 1: Variable Resolution
	// From: scenarios/pipeline-variable-resolution.scenario.yaml
	// ═══════════════════════════════════════════════════════════════════════════

	describe('Scenario 1: Variable resolution in pipeline', () => {
		it('executes pipeline with $prev reference', async () => {
			// scenario:
			//   name: "Variable resolution in pipeline"
			//   tags: ["pipeline", "unit"]
			// steps:
			//   - name: "Execute pipeline with $prev reference"
			//     command: afd-pipe
			//     input:
			//       steps:
			//         - { command: "user-get", input: { id: 1 } }
			//         - { command: "user-format", input: { user: "$prev" } }
			//     expect:
			//       success: true
			//       data.formatted: /User: .+/

			const request: PipelineRequest = {
				steps: [
					{ command: 'user-get', input: { id: 1 } },
					{ command: 'user-format', input: { user: '$prev' } },
				],
			};

			const result = await server.executePipeline(request);

			// expect: success: true
			expect(result.steps.every((s) => s.status === 'success' || s.status === 'skipped')).toBe(
				true
			);
			expect(result.metadata.completedSteps).toBe(2);

			// expect: data.formatted: /User: .+/
			expect(result.data).toHaveProperty('formatted');
			expect((result.data as { formatted: string }).formatted).toMatch(/User: .+/);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// Scenario 2: Confidence Aggregation
	// ═══════════════════════════════════════════════════════════════════════════

	describe('Scenario 2: Pipeline returns minimum confidence', () => {
		it('aggregates confidence using weakest link', async () => {
			// scenario:
			//   name: "Pipeline returns minimum confidence"
			//   tags: ["pipeline", "metadata"]
			// steps:
			//   - name: "Execute multi-step pipeline"
			//     command: afd-pipe
			//     input:
			//       steps:
			//         - { command: "data-fetch", input: { source: "cache" } }   # 0.95
			//         - { command: "data-validate", input: { data: "$prev.data" } }  # 0.80
			//     expect:
			//       success: true
			//       metadata.confidence: 0.80
			//       metadata.confidenceBreakdown[1].reasoning: /.*mismatch.*/

			const request: PipelineRequest = {
				steps: [
					{ command: 'data-fetch', input: { source: 'cache' } }, // 0.95
					{ command: 'data-validate', input: { data: '$prev.data' } }, // 0.80
				],
			};

			const result = await server.executePipeline(request);

			// expect: success: true
			expect(result.metadata.completedSteps).toBe(2);

			// expect: metadata.confidence: 0.80
			expect(result.metadata.confidence).toBe(0.8);

			// expect: metadata.confidenceBreakdown[1].reasoning: /.*mismatch.*/
			expect(result.metadata.confidenceBreakdown[1]?.reasoning).toMatch(/.*mismatch.*/i);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// Scenario 3: Error with Suggestion
	// ═══════════════════════════════════════════════════════════════════════════

	describe('Scenario 3: Failed step includes actionable suggestion', () => {
		it('provides suggestion on failure and skips subsequent steps', async () => {
			// scenario:
			//   name: "Failed step includes actionable suggestion"
			//   tags: ["pipeline", "error-handling"]
			// steps:
			//   - name: "Execute pipeline with missing user"
			//     command: afd-pipe
			//     input:
			//       steps:
			//         - { command: "user-get", input: { id: 999 } }
			//         - { command: "order-list", input: { userId: "$prev.id" } }
			//     expect:
			//       success: false
			//       steps[0].status: "failure"
			//       steps[0].error.code: "NOT_FOUND"
			//       steps[0].error.suggestion: /.+/
			//       steps[1].status: "skipped"

			const request: PipelineRequest = {
				steps: [
					{ command: 'user-get', input: { id: 999 } },
					{ command: 'order-list', input: { userId: '$prev.id' } },
				],
			};

			const result = await server.executePipeline(request);

			// expect: success: false (partial success possible)
			expect(result.metadata.completedSteps).toBe(0);

			// expect: steps[0].status: "failure"
			expect(result.steps[0].status).toBe('failure');

			// expect: steps[0].error.code: "NOT_FOUND"
			expect(result.steps[0].error?.code).toBe('NOT_FOUND');

			// expect: steps[0].error.suggestion: /.+/
			expect(result.steps[0].error?.suggestion).toBeDefined();
			expect(result.steps[0].error?.suggestion).toMatch(/.+/);

			// expect: steps[1].status: "skipped"
			expect(result.steps[1].status).toBe('skipped');
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// Scenario 4: Conditional Step Skipping
	// Uses fixture: fixtures/basic-user.json
	// ═══════════════════════════════════════════════════════════════════════════

	describe('Scenario 4: Conditional step skipped when condition fails', () => {
		it('skips step when user is not premium', async () => {
			// scenario:
			//   name: "Conditional step skipped when condition fails"
			//   tags: ["pipeline", "conditional"]
			// setup:
			//   fixture:
			//     file: "fixtures/basic-user.json"
			// steps:
			//   - name: "Execute with condition"
			//     command: afd-pipe
			//     input:
			//       steps:
			//         - { command: "user-get", input: { id: 1 }, as: "user" }
			//         - command: "discount-apply"
			//           input: { userId: "$steps.user.id" }
			//           when: { $eq: ["$steps.user.tier", "premium"] }
			//     expect:
			//       success: true
			//       steps[1].status: "skipped"  # User is not premium

			// Note: fixture user 1 has tier: "standard" (not premium)
			const request: PipelineRequest = {
				steps: [
					{ command: 'user-get', input: { id: 1 }, as: 'user' },
					{
						command: 'discount-apply',
						input: { userId: '$steps.user.id' },
						when: { $eq: ['$steps.user.tier', 'premium'] },
					},
				],
			};

			const result = await server.executePipeline(request);

			// expect: success: true (first step succeeded)
			expect(result.steps[0].status).toBe('success');

			// expect: steps[1].status: "skipped" (User is not premium)
			expect(result.steps[1].status).toBe('skipped');
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// Scenario 5: Alias References
	// ═══════════════════════════════════════════════════════════════════════════

	describe('Scenario 5: Step alias references work correctly', () => {
		it('resolves $steps.alias references across pipeline', async () => {
			// scenario:
			//   name: "Step alias references work correctly"
			//   tags: ["pipeline", "unit"]
			// steps:
			//   - name: "Execute with named steps"
			//     command: afd-pipe
			//     input:
			//       steps:
			//         - { command: "user-get", input: { id: 1 }, as: "profile" }
			//         - { command: "user-prefs", input: { id: 1 }, as: "prefs" }
			//         - command: "user-merge"
			//           input:
			//             user: "$steps.profile"
			//             preferences: "$steps.prefs"
			//     expect:
			//       success: true
			//       data.merged: true

			const request: PipelineRequest = {
				steps: [
					{ command: 'user-get', input: { id: 1 }, as: 'profile' },
					{ command: 'user-prefs', input: { id: 1 }, as: 'prefs' },
					{
						command: 'user-merge',
						input: {
							user: '$steps.profile',
							preferences: '$steps.prefs',
						},
					},
				],
			};

			const result = await server.executePipeline(request);

			// expect: success: true
			expect(result.steps.every((s) => s.status === 'success')).toBe(true);

			// expect: data.merged: true
			expect(result.data).toHaveProperty('merged', true);
		});
	});
});
