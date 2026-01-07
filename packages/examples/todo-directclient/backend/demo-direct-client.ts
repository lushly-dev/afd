/**
 * @fileoverview Demo: Using DirectClient with the experiment's todo registry
 *
 * This demonstrates the zero-overhead in-process command binding
 * by using DirectClient to call commands directly without MCP transport.
 *
 * Run: npx tsx demo-direct-client.ts
 */

import { DirectClient } from '@lushly-dev/afd-client';
import { registry } from './src/registry.js';

// ANSI colors
const c = {
	reset: '\x1b[0m',
	bright: '\x1b[1m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	cyan: '\x1b[36m',
	dim: '\x1b[2m',
};

interface Todo {
	id: string;
	title: string;
	completed: boolean;
	priority?: string;
	createdAt: string;
}

interface ListResult {
	items: Todo[];
	total: number;
}

interface StatsResult {
	total: number;
	completed: number;
	pending: number;
	byPriority: Record<string, number>;
}

async function main() {
	console.log(`\n${c.bright}════════════════════════════════════════════════════════════════${c.reset}`);
	console.log(`${c.bright}  DirectClient Demo - Zero Transport Overhead${c.reset}`);
	console.log(`${c.bright}════════════════════════════════════════════════════════════════${c.reset}\n`);

	// Create DirectClient with the experiment's registry
	const client = new DirectClient(registry);

	console.log(`${c.cyan}Available commands:${c.reset}`);
	const commands = client.listCommandNames();
	console.log(`  ${commands.join(', ')}\n`);

	// ─────────────────────────────────────────────────────────────────
	// CREATE: Add some todos
	// ─────────────────────────────────────────────────────────────────
	console.log(`${c.yellow}▸ Creating todos...${c.reset}`);

	const todo1 = await client.call<Todo>('todo-create', {
		title: 'Learn DirectClient',
		priority: 'high',
	});
	console.log(`  ✓ Created: "${todo1.data?.title}" (${todo1.data?.id})`);

	const todo2 = await client.call<Todo>('todo-create', {
		title: 'Benchmark performance',
		priority: 'medium',
	});
	console.log(`  ✓ Created: "${todo2.data?.title}" (${todo2.data?.id})`);

	const todo3 = await client.call<Todo>('todo-create', {
		title: 'Write documentation',
		priority: 'low',
	});
	console.log(`  ✓ Created: "${todo3.data?.title}" (${todo3.data?.id})`);

	// ─────────────────────────────────────────────────────────────────
	// LIST: Show all todos
	// ─────────────────────────────────────────────────────────────────
	console.log(`\n${c.yellow}▸ Listing todos...${c.reset}`);
	const list = await client.call<ListResult>('todo-list', {});
	console.log(`  Found ${list.data?.total} todos:`);
	for (const todo of list.data?.items ?? []) {
		const status = todo.completed ? '✓' : '○';
		console.log(`    ${status} [${todo.priority}] ${todo.title}`);
	}

	// ─────────────────────────────────────────────────────────────────
	// TOGGLE: Complete a todo
	// ─────────────────────────────────────────────────────────────────
	console.log(`\n${c.yellow}▸ Completing first todo...${c.reset}`);
	const toggled = await client.call<Todo>('todo-toggle', { id: todo1.data?.id });
	console.log(`  ✓ Toggled: "${toggled.data?.title}" -> completed: ${toggled.data?.completed}`);

	// ─────────────────────────────────────────────────────────────────
	// STATS: Get statistics
	// ─────────────────────────────────────────────────────────────────
	console.log(`\n${c.yellow}▸ Getting stats...${c.reset}`);
	const stats = await client.call<StatsResult>('todo-stats', {});
	console.log(`  Total: ${stats.data?.total}`);
	console.log(`  Completed: ${stats.data?.completed}`);
	console.log(`  Pending: ${stats.data?.pending}`);

	// ─────────────────────────────────────────────────────────────────
	// PERFORMANCE: Quick benchmark
	// ─────────────────────────────────────────────────────────────────
	console.log(`\n${c.yellow}▸ Performance test (100 iterations)...${c.reset}`);
	const iterations = 100;
	const start = performance.now();

	for (let i = 0; i < iterations; i++) {
		await client.call('todo-list', {});
	}

	const elapsed = performance.now() - start;
	const avgMs = elapsed / iterations;
	const opsPerSec = 1000 / avgMs;

	console.log(`  Total time: ${elapsed.toFixed(2)}ms`);
	console.log(`  Avg per call: ${c.green}${avgMs.toFixed(4)}ms${c.reset}`);
	console.log(`  Ops/sec: ${c.green}${opsPerSec.toFixed(0)}${c.reset}`);

	// ─────────────────────────────────────────────────────────────────
	// CLEANUP: Clear all
	// ─────────────────────────────────────────────────────────────────
	console.log(`\n${c.yellow}▸ Cleaning up...${c.reset}`);
	await client.call('todo-clear', {});
	console.log('  ✓ Cleared all todos');

	console.log(`\n${c.bright}════════════════════════════════════════════════════════════════${c.reset}`);
	console.log(`${c.green}  Demo complete! DirectClient works with zero transport overhead.${c.reset}`);
	console.log(`${c.bright}════════════════════════════════════════════════════════════════${c.reset}\n`);
}

main().catch(console.error);
