/**
 * @fileoverview Pipeline integration tests for todo example
 *
 * Demonstrates command pipelines with the todo application:
 * - Create → Toggle → Get workflow
 * - List → Stats aggregation
 * - Error handling in pipelines
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMcpServer, type McpServer } from '@lushly-dev/afd-server';
import type { PipelineRequest } from '@lushly-dev/afd-core';
import { allCommands } from '../index.js';
import { store } from '../../store/memory.js';

describe('Todo Pipeline Integration', () => {
	let server: McpServer;

	beforeEach(async () => {
		store.clear();
		server = createMcpServer({
			name: 'todo-pipeline-test',
			version: '1.0.0',
			commands: allCommands,
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
	// WORKFLOW PIPELINES
	// ═══════════════════════════════════════════════════════════════════════════

	describe('Todo Workflows', () => {
		it('creates and toggles a todo in one pipeline', async () => {
			// Pipeline: Create todo → Toggle it to complete → Get final state
			const request: PipelineRequest = {
				steps: [
					{ command: 'todo-create', input: { title: 'Pipeline task', priority: 'high' }, as: 'created' },
					{ command: 'todo-toggle', input: { id: '$steps.created.id' } },
					{ command: 'todo-get', input: { id: '$steps.created.id' } },
				],
			};

			const result = await server.executePipeline(request);

			// All steps succeed
			expect(result.steps[0].status).toBe('success');
			expect(result.steps[1].status).toBe('success');
			expect(result.steps[2].status).toBe('success');

			// Final data is the completed todo
			expect(result.data).toMatchObject({
				title: 'Pipeline task',
				priority: 'high',
				completed: true,
			});

			// Confidence and reasoning flow through
			expect(result.metadata.confidence).toBe(1.0);
			expect(result.metadata.reasoning.length).toBeGreaterThanOrEqual(1);
		});

		it('creates multiple todos and gets stats', async () => {
			// Pipeline: Create 3 todos → Toggle one → Get stats
			const request: PipelineRequest = {
				steps: [
					{ command: 'todo-create', input: { title: 'Task 1', priority: 'high' }, as: 'todo1' },
					{ command: 'todo-create', input: { title: 'Task 2', priority: 'medium' } },
					{ command: 'todo-create', input: { title: 'Task 3', priority: 'low' } },
					{ command: 'todo-toggle', input: { id: '$steps.todo1.id' } },
					{ command: 'todo-stats', input: {} },
				],
			};

			const result = await server.executePipeline(request);

			expect(result.metadata.completedSteps).toBe(5);
			expect(result.data).toMatchObject({
				total: 3,
				completed: 1,
				pending: 2,
			});
		});

		it('lists and clears completed todos', async () => {
			// Pre-seed some todos
			await server.execute('todo-create', { title: 'Done 1', priority: 'high' });
			const t2 = await server.execute('todo-create', { title: 'Done 2', priority: 'medium' });
			await server.execute('todo-create', { title: 'Pending', priority: 'low' });

			// Complete one directly
			await server.execute('todo-toggle', { id: (t2.data as { id: string }).id });

			// Pipeline: List → Clear completed → Get new stats
			const request: PipelineRequest = {
				steps: [
					{ command: 'todo-list', input: { completed: true, sortBy: 'createdAt', sortOrder: 'desc', limit: 20, offset: 0 }, as: 'completed' },
					{ command: 'todo-clear', input: {} },
					{ command: 'todo-stats', input: {} },
				],
			};

			const result = await server.executePipeline(request);

			// Check completed list was found
			expect(result.steps[0].data).toMatchObject({
				total: 1, // One completed todo
			});

			// Check clear result
			expect(result.steps[1].data).toMatchObject({
				cleared: 1,
			});

			// Final stats show remaining todos
			expect(result.data).toMatchObject({
				total: 2, // Only pending remain
				completed: 0,
			});
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// VARIABLE RESOLUTION
	// ═══════════════════════════════════════════════════════════════════════════

	describe('Variable Resolution', () => {
		it('resolves $prev to pass todo between steps', async () => {
			const request: PipelineRequest = {
				steps: [
					{ command: 'todo-create', input: { title: 'Chained', priority: 'medium' } },
					{ command: 'todo-get', input: { id: '$prev.id' } },
				],
			};

			const result = await server.executePipeline(request);

			expect(result.steps[1].status).toBe('success');
			expect(result.data).toMatchObject({
				title: 'Chained',
			});
		});

		it('resolves $steps.alias for named references', async () => {
			const request: PipelineRequest = {
				steps: [
					{ command: 'todo-create', input: { title: 'Original', priority: 'low' }, as: 'original' },
					{ command: 'todo-update', input: { id: '$steps.original.id', title: 'Updated via alias', priority: 'high' } },
					{ command: 'todo-get', input: { id: '$steps.original.id' } },
				],
			};

			const result = await server.executePipeline(request);

			expect(result.data).toMatchObject({
				title: 'Updated via alias',
				priority: 'high',
			});
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// ERROR HANDLING
	// ═══════════════════════════════════════════════════════════════════════════

	describe('Error Handling', () => {
		it('stops pipeline on NOT_FOUND error', async () => {
			const request: PipelineRequest = {
				steps: [
					{ command: 'todo-get', input: { id: 'nonexistent' } }, // Fails
					{ command: 'todo-toggle', input: { id: '$prev.id' } }, // Skipped
				],
			};

			const result = await server.executePipeline(request);

			expect(result.steps[0].status).toBe('failure');
			expect(result.steps[0].error?.code).toBe('NOT_FOUND');
			expect(result.steps[0].error?.suggestion).toBeDefined();
			expect(result.steps[1].status).toBe('skipped');
		});

		it('continues on failure when option is set', async () => {
			const request: PipelineRequest = {
				steps: [
					{ command: 'todo-get', input: { id: 'missing' } }, // Fails
					{ command: 'todo-stats', input: {} }, // Should still run
				],
				options: { continueOnFailure: true },
			};

			const result = await server.executePipeline(request);

			expect(result.steps[0].status).toBe('failure');
			expect(result.steps[1].status).toBe('success');
			expect(result.data).toHaveProperty('total');
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// CONDITIONAL EXECUTION
	// ═══════════════════════════════════════════════════════════════════════════

	describe('Conditional Execution', () => {
		it('skips toggle when todo is already completed', async () => {
			const request: PipelineRequest = {
				steps: [
					{ command: 'todo-create', input: { title: 'Test', priority: 'medium' }, as: 'todo' },
					{ command: 'todo-toggle', input: { id: '$steps.todo.id' } }, // Complete it
					{
						command: 'todo-toggle',
						input: { id: '$prev.id' },
						when: { $eq: ['$prev.completed', false] }, // Skip if already completed
					},
				],
			};

			const result = await server.executePipeline(request);

			// First toggle succeeds
			expect(result.steps[1].status).toBe('success');
			expect(result.steps[1].data).toMatchObject({ completed: true });

			// Second toggle skipped because todo is completed
			expect(result.steps[2].status).toBe('skipped');
		});

		it('runs step only when condition is met', async () => {
			const request: PipelineRequest = {
				steps: [
					{ command: 'todo-create', input: { title: 'High priority', priority: 'high' }, as: 'todo' },
					{
						command: 'todo-update',
						input: { id: '$steps.todo.id', title: 'URGENT: High priority' },
						when: { $eq: ['$steps.todo.priority', 'high'] },
					},
				],
			};

			const result = await server.executePipeline(request);

			expect(result.steps[1].status).toBe('success');
			expect(result.data).toMatchObject({
				title: 'URGENT: High priority',
			});
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// METADATA AGGREGATION
	// ═══════════════════════════════════════════════════════════════════════════

	describe('Metadata Aggregation', () => {
		it('aggregates reasoning from all steps', async () => {
			const request: PipelineRequest = {
				steps: [
					{ command: 'todo-create', input: { title: 'Task', priority: 'high' } },
					{ command: 'todo-toggle', input: { id: '$prev.id' } },
					{ command: 'todo-stats', input: {} },
				],
			};

			const result = await server.executePipeline(request);

			// Each step should contribute reasoning
			expect(result.metadata.reasoning.length).toBeGreaterThanOrEqual(2);
			expect(result.metadata.reasoning.some((r) => r.command === 'todo-create')).toBe(true);
			expect(result.metadata.reasoning.some((r) => r.command === 'todo-toggle')).toBe(true);
		});

		it('tracks execution time for each step', async () => {
			const request: PipelineRequest = {
				steps: [
					{ command: 'todo-create', input: { title: 'Timed', priority: 'medium' } },
					{ command: 'todo-stats', input: {} },
				],
			};

			const result = await server.executePipeline(request);

			expect(result.metadata.executionTimeMs).toBeGreaterThan(0);
			expect(result.steps[0].executionTimeMs).toBeGreaterThanOrEqual(0);
			expect(result.steps[1].executionTimeMs).toBeGreaterThanOrEqual(0);
		});

		it('uses weakest link for confidence', async () => {
			// All todo commands return 1.0 confidence, so pipeline should also be 1.0
			const request: PipelineRequest = {
				steps: [
					{ command: 'todo-create', input: { title: 'Test', priority: 'medium' } },
					{ command: 'todo-stats', input: {} },
				],
			};

			const result = await server.executePipeline(request);

			expect(result.metadata.confidence).toBe(1.0);
			expect(result.metadata.confidenceBreakdown).toHaveLength(2);
		});
	});
});
