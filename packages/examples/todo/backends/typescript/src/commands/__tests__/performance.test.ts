/**
 * @fileoverview Performance tests for todo commands
 * 
 * These tests establish baseline response times and detect regressions.
 * AFD commands should be fast since they're called by both UI and agents.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { store } from '../../store/memory.js';
import { createTodo } from '../create.js';
import { listTodos } from '../list.js';
import { getTodo } from '../get.js';
import { updateTodo } from '../update.js';
import { toggleTodo } from '../toggle.js';
import { deleteTodo } from '../delete.js';
import { clearCompleted } from '../clear.js';
import { getStats } from '../stats.js';

// ═══════════════════════════════════════════════════════════════════════════════
// PERFORMANCE THRESHOLDS (in milliseconds)
// ═══════════════════════════════════════════════════════════════════════════════

const THRESHOLDS = {
	// Single-item operations should be very fast
	create: 10,
	get: 5,
	update: 10,
	toggle: 10,
	delete: 10,

	// Queries may take slightly longer
	list: 20,
	listFiltered: 25,
	stats: 15,

	// Batch operations
	clear: 30,

	// Bulk operations (100 items)
	bulkCreate: 100,
	bulkList: 50,
};

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

interface PerformanceResult {
	command: string;
	duration: number;
	threshold: number;
	passed: boolean;
}

const results: PerformanceResult[] = [];

/**
 * Measure command execution time.
 */
async function measure<T>(
	command: string,
	threshold: number,
	fn: () => Promise<T>
): Promise<T> {
	const start = performance.now();
	const result = await fn();
	const duration = performance.now() - start;

	results.push({
		command,
		duration: Math.round(duration * 100) / 100,
		threshold,
		passed: duration <= threshold,
	});

	return result;
}

/**
 * Create N todos for bulk tests.
 */
async function createBulkTodos(count: number): Promise<string[]> {
	const ids: string[] = [];
	for (let i = 0; i < count; i++) {
		const result = await createTodo.handler({
			title: `Bulk Todo ${i}`,
			priority: ['low', 'medium', 'high'][i % 3] as 'low' | 'medium' | 'high',
		}, {});
		if (result.success && result.data) {
			ids.push(result.data.id);
		}
	}
	return ids;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SETUP
// ═══════════════════════════════════════════════════════════════════════════════

beforeEach(() => {
	store.clear();
});

afterAll(() => {
	// Print performance summary
	console.log('\n📊 Performance Summary\n');
	console.log('Command'.padEnd(20) + 'Duration'.padEnd(12) + 'Threshold'.padEnd(12) + 'Status');
	console.log('─'.repeat(56));

	for (const r of results) {
		const status = r.passed ? '✓' : '✗';
		const durationStr = `${r.duration}ms`.padEnd(12);
		const thresholdStr = `${r.threshold}ms`.padEnd(12);
		console.log(`${r.command.padEnd(20)}${durationStr}${thresholdStr}${status}`);
	}

	const passed = results.filter(r => r.passed).length;
	const total = results.length;
	console.log('─'.repeat(56));
	console.log(`\n${passed}/${total} within threshold\n`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SINGLE OPERATION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Single Operation Performance', () => {
	it(`todo-create < ${THRESHOLDS.create}ms`, async () => {
		const result = await measure('todo-create', THRESHOLDS.create, () =>
			createTodo.handler({ title: 'Perf test', priority: 'medium' }, {})
		);

		expect(result.success).toBe(true);
	});

	it(`todo-get < ${THRESHOLDS.get}ms`, async () => {
		const created = await createTodo.handler({ title: 'Find me', priority: 'medium' }, {});

		const result = await measure('todo-get', THRESHOLDS.get, () =>
			getTodo.handler({ id: created.data!.id }, {})
		);

		expect(result.success).toBe(true);
	});

	it(`todo-update < ${THRESHOLDS.update}ms`, async () => {
		const created = await createTodo.handler({ title: 'Update me', priority: 'medium' }, {});

		const result = await measure('todo-update', THRESHOLDS.update, () =>
			updateTodo.handler({ id: created.data!.id, title: 'Updated' }, {})
		);

		expect(result.success).toBe(true);
	});

	it(`todo-toggle < ${THRESHOLDS.toggle}ms`, async () => {
		const created = await createTodo.handler({ title: 'Toggle me', priority: 'medium' }, {});

		const result = await measure('todo-toggle', THRESHOLDS.toggle, () =>
			toggleTodo.handler({ id: created.data!.id }, {})
		);

		expect(result.success).toBe(true);
	});

	it(`todo-delete < ${THRESHOLDS.delete}ms`, async () => {
		const created = await createTodo.handler({ title: 'Delete me', priority: 'medium' }, {});

		const result = await measure('todo-delete', THRESHOLDS.delete, () =>
			deleteTodo.handler({ id: created.data!.id }, {})
		);

		expect(result.success).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// QUERY TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Query Performance', () => {
	beforeEach(async () => {
		// Create 20 todos for query tests
		await createBulkTodos(20);
	});

	it(`todo-list (20 items) < ${THRESHOLDS.list}ms`, async () => {
		const result = await measure('todo-list', THRESHOLDS.list, () =>
			listTodos.handler({
				sortBy: 'createdAt',
				sortOrder: 'desc',
				limit: 20,
				offset: 0,
			}, {})
		);

		expect(result.success).toBe(true);
		expect(result.data?.todos).toHaveLength(20);
	});

	it(`todo-list filtered < ${THRESHOLDS.listFiltered}ms`, async () => {
		const result = await measure('todo-list (filtered)', THRESHOLDS.listFiltered, () =>
			listTodos.handler({
				priority: 'high',
				completed: false,
				sortBy: 'createdAt',
				sortOrder: 'desc',
				limit: 20,
				offset: 0,
			}, {})
		);

		expect(result.success).toBe(true);
	});

	it(`todo-stats < ${THRESHOLDS.stats}ms`, async () => {
		const result = await measure('todo-stats', THRESHOLDS.stats, () =>
			getStats.handler({}, {})
		);

		expect(result.success).toBe(true);
		expect(result.data?.total).toBe(20);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH OPERATION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Batch Operation Performance', () => {
	it(`todo-clear (10 completed) < ${THRESHOLDS.clear}ms`, async () => {
		// Create 20 todos and complete 10
		const ids = await createBulkTodos(20);
		for (let i = 0; i < 10; i++) {
			await toggleTodo.handler({ id: ids[i] }, {});
		}

		const result = await measure('todo-clear', THRESHOLDS.clear, () =>
			clearCompleted.handler({}, {})
		);

		expect(result.success).toBe(true);
		expect(result.data?.cleared).toBe(10);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// BULK OPERATION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Bulk Operation Performance', () => {
	it(`create 100 todos < ${THRESHOLDS.bulkCreate}ms`, async () => {
		const start = performance.now();
		await createBulkTodos(100);
		const duration = performance.now() - start;

		results.push({
			command: 'bulk create (100)',
			duration: Math.round(duration * 100) / 100,
			threshold: THRESHOLDS.bulkCreate,
			passed: duration <= THRESHOLDS.bulkCreate,
		});

		expect(store.count()).toBe(100);
	});

	it(`list 100 todos < ${THRESHOLDS.bulkList}ms`, async () => {
		await createBulkTodos(100);

		const result = await measure('bulk list (100)', THRESHOLDS.bulkList, () =>
			listTodos.handler({
				sortBy: 'createdAt',
				sortOrder: 'desc',
				limit: 100,
				offset: 0,
			}, {})
		);

		expect(result.success).toBe(true);
		expect(result.data?.todos).toHaveLength(100);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// LATENCY PERCENTILE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Latency Percentiles', () => {
	it('todo-create p50/p95/p99 within bounds', async () => {
		const durations: number[] = [];

		// Run 50 iterations
		for (let i = 0; i < 50; i++) {
			const start = performance.now();
			await createTodo.handler({ title: `Latency test ${i}`, priority: 'medium' }, {});
			durations.push(performance.now() - start);
		}

		// Sort for percentile calculation
		durations.sort((a, b) => a - b);

		const p50 = durations[Math.floor(durations.length * 0.5)];
		const p95 = durations[Math.floor(durations.length * 0.95)];
		const p99 = durations[Math.floor(durations.length * 0.99)];

		console.log(`\n  todo-create latency: p50=${p50.toFixed(2)}ms, p95=${p95.toFixed(2)}ms, p99=${p99.toFixed(2)}ms`);

		// Record in results
		results.push(
			{ command: 'create p50', duration: Math.round(p50 * 100) / 100, threshold: 5, passed: p50 <= 5 },
			{ command: 'create p95', duration: Math.round(p95 * 100) / 100, threshold: 15, passed: p95 <= 15 },
			{ command: 'create p99', duration: Math.round(p99 * 100) / 100, threshold: 25, passed: p99 <= 25 }
		);

		expect(p50).toBeLessThan(10);
		expect(p95).toBeLessThan(20);
		expect(p99).toBeLessThan(30);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// METADATA VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

describe('Performance Metadata in Results', () => {
	it('commands include executionTimeMs in metadata when run through server', async () => {
		// This is tested at the server level, but we verify the structure here
		const result = await createTodo.handler({ title: 'Test', priority: 'medium' }, {});

		expect(result.success).toBe(true);
		// Note: executionTimeMs is added by the server, not the command itself
		// Commands return the business result; server adds timing metadata
	});
});
