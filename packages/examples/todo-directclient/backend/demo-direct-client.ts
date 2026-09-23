/**
 * @fileoverview Demo: Using DirectClient with the experiment's todo registry
 *
 * This demonstrates the zero-overhead in-process command binding
 * by using DirectClient to call commands directly without MCP transport.
 *
 * Run: npx tsx demo-direct-client.ts
 */

import { type CommandResult, DirectClient, type UnknownToolError } from '@lushly-dev/afd-client';
import { registry } from './src/registry.js';

/** True when a DirectClient call named a tool the registry does not have. */
function isUnknownToolError(value: unknown): value is UnknownToolError {
	return (
		typeof value === 'object' &&
		value !== null &&
		'error' in value &&
		value.error === 'UNKNOWN_TOOL'
	);
}

/** The command's data, or undefined when the call failed or named an unknown tool. */
function dataOf<T>(result: CommandResult<T> | CommandResult<UnknownToolError>): T | undefined {
	return isUnknownToolError(result.data) ? undefined : result.data;
}

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
	todos: Todo[];
	total: number;
	hasMore: boolean;
}

interface StatsResult {
	total: number;
	completed: number;
	pending: number;
	byPriority: Record<string, number>;
}

async function main() {
	console.log(
		`\n${c.bright}════════════════════════════════════════════════════════════════${c.reset}`
	);
	console.log(`${c.bright}  DirectClient Demo - Zero Transport Overhead${c.reset}`);
	console.log(
		`${c.bright}════════════════════════════════════════════════════════════════${c.reset}\n`
	);

	// Create DirectClient with the experiment's registry
	const client = new DirectClient(registry);

	console.log(`${c.cyan}Available commands:${c.reset}`);
	const commands = client.listCommandNames();
	console.log(`  ${commands.join(', ')}\n`);

	// ─────────────────────────────────────────────────────────────────
	// CREATE: Add some todos
	// ─────────────────────────────────────────────────────────────────
	console.log(`${c.yellow}▸ Creating todos...${c.reset}`);

	const todo1 = dataOf(
		await client.call<Todo>('todo-create', {
			title: 'Learn DirectClient',
			priority: 'high',
		})
	);
	console.log(`  ✓ Created: "${todo1?.title}" (${todo1?.id})`);

	const todo2 = dataOf(
		await client.call<Todo>('todo-create', {
			title: 'Benchmark performance',
			priority: 'medium',
		})
	);
	console.log(`  ✓ Created: "${todo2?.title}" (${todo2?.id})`);

	const todo3 = dataOf(
		await client.call<Todo>('todo-create', {
			title: 'Write documentation',
			priority: 'low',
		})
	);
	console.log(`  ✓ Created: "${todo3?.title}" (${todo3?.id})`);

	// ─────────────────────────────────────────────────────────────────
	// LIST: Show all todos
	// ─────────────────────────────────────────────────────────────────
	console.log(`\n${c.yellow}▸ Listing todos...${c.reset}`);
	const list = dataOf(await client.call<ListResult>('todo-list', {}));
	console.log(`  Found ${list?.total} todos:`);
	for (const todo of list?.todos ?? []) {
		const status = todo.completed ? '✓' : '○';
		console.log(`    ${status} [${todo.priority}] ${todo.title}`);
	}

	// ─────────────────────────────────────────────────────────────────
	// TOGGLE: Complete a todo
	// ─────────────────────────────────────────────────────────────────
	console.log(`\n${c.yellow}▸ Completing first todo...${c.reset}`);
	const toggled = dataOf(await client.call<Todo>('todo-toggle', { id: todo1?.id }));
	console.log(`  ✓ Toggled: "${toggled?.title}" -> completed: ${toggled?.completed}`);

	// ─────────────────────────────────────────────────────────────────
	// STATS: Get statistics
	// ─────────────────────────────────────────────────────────────────
	console.log(`\n${c.yellow}▸ Getting stats...${c.reset}`);
	const stats = dataOf(await client.call<StatsResult>('todo-stats', {}));
	console.log(`  Total: ${stats?.total}`);
	console.log(`  Completed: ${stats?.completed}`);
	console.log(`  Pending: ${stats?.pending}`);

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

	console.log(
		`\n${c.bright}════════════════════════════════════════════════════════════════${c.reset}`
	);
	console.log(
		`${c.green}  Demo complete! DirectClient works with zero transport overhead.${c.reset}`
	);
	console.log(
		`${c.bright}════════════════════════════════════════════════════════════════${c.reset}\n`
	);
}

main().catch(console.error);
