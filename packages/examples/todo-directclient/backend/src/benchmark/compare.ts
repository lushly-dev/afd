/**
 * @fileoverview Transport Benchmark - Compare direct vs MCP performance
 *
 * This benchmark validates the hypothesis that direct in-process execution
 * is 10-100x faster than MCP transport for co-located agents.
 *
 * Run with: pnpm benchmark
 */

import { registry } from '../registry.js';
import { store } from '../store/index.js';

// ANSI colors for output
const colors = {
	reset: '\x1b[0m',
	bright: '\x1b[1m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	cyan: '\x1b[36m',
	dim: '\x1b[2m',
};

interface BenchmarkResult {
	name: string;
	iterations: number;
	totalMs: number;
	avgMs: number;
	minMs: number;
	maxMs: number;
	opsPerSec: number;
}

/**
 * Run a benchmark for a given function.
 */
async function benchmark(
	name: string,
	fn: () => Promise<void>,
	iterations = 1000,
	warmupIterations = 100
): Promise<BenchmarkResult> {
	// Warmup
	for (let i = 0; i < warmupIterations; i++) {
		await fn();
	}

	// Benchmark
	const times: number[] = [];
	const start = performance.now();

	for (let i = 0; i < iterations; i++) {
		const iterStart = performance.now();
		await fn();
		times.push(performance.now() - iterStart);
	}

	const totalMs = performance.now() - start;
	const avgMs = totalMs / iterations;
	const minMs = Math.min(...times);
	const maxMs = Math.max(...times);
	const opsPerSec = 1000 / avgMs;

	return {
		name,
		iterations,
		totalMs,
		avgMs,
		minMs,
		maxMs,
		opsPerSec,
	};
}

/**
 * Format benchmark result for display.
 */
function formatResult(result: BenchmarkResult): string {
	return [
		`${colors.cyan}${result.name}${colors.reset}`,
		`  ${colors.bright}${result.avgMs.toFixed(3)}ms${colors.reset} avg`,
		`  ${colors.dim}(min: ${result.minMs.toFixed(3)}ms, max: ${result.maxMs.toFixed(3)}ms)${colors.reset}`,
		`  ${colors.green}${result.opsPerSec.toFixed(0)} ops/sec${colors.reset}`,
	].join('\n');
}

/**
 * Main benchmark runner.
 */
async function main() {
	console.log(
		`\n${colors.bright}═══════════════════════════════════════════════════════════════${colors.reset}`
	);
	console.log(`${colors.bright}  In-Process Binding Benchmark${colors.reset}`);
	console.log(
		`${colors.bright}═══════════════════════════════════════════════════════════════${colors.reset}\n`
	);

	// Clear store before benchmarks
	store.clear();

	const iterations = 1000;
	console.log(`Running ${iterations} iterations per test...\n`);

	// ─────────────────────────────────────────────────────────────────
	// Benchmark 1: Simple read (todo-list on empty store)
	// ─────────────────────────────────────────────────────────────────
	console.log(`${colors.yellow}▸ Benchmark: Empty List (read, no data)${colors.reset}\n`);

	const emptyListResult = await benchmark(
		'Direct: todo-list (empty)',
		async () => {
			await registry.execute('todo-list', {});
		},
		iterations
	);
	console.log(formatResult(emptyListResult));
	console.log('');

	// ─────────────────────────────────────────────────────────────────
	// Benchmark 2: Create operation
	// ─────────────────────────────────────────────────────────────────
	console.log(`${colors.yellow}▸ Benchmark: Create (write)${colors.reset}\n`);

	let createCounter = 0;
	const createResult = await benchmark(
		'Direct: todo-create',
		async () => {
			await registry.execute('todo-create', {
				title: `Benchmark todo ${++createCounter}`,
				priority: 'medium',
			});
		},
		iterations
	);
	console.log(formatResult(createResult));
	console.log(`  ${colors.dim}(Created ${createCounter} todos)${colors.reset}`);
	console.log('');

	// ─────────────────────────────────────────────────────────────────
	// Benchmark 3: List with data
	// ─────────────────────────────────────────────────────────────────
	console.log(`${colors.yellow}▸ Benchmark: List (read, ${store.count()} items)${colors.reset}\n`);

	const listWithDataResult = await benchmark(
		`Direct: todo-list (${store.count()} items)`,
		async () => {
			await registry.execute('todo-list', { limit: 100 });
		},
		iterations
	);
	console.log(formatResult(listWithDataResult));
	console.log('');

	// ─────────────────────────────────────────────────────────────────
	// Benchmark 4: Get by ID
	// ─────────────────────────────────────────────────────────────────
	// Create a specific todo to get
	const testTodo = await registry.execute<{ id: string }>('todo-create', {
		title: 'Get benchmark target',
	});
	const testId = testTodo.data?.id ?? 'unknown';

	console.log(`${colors.yellow}▸ Benchmark: Get by ID (read, single)${colors.reset}\n`);

	const getResult = await benchmark(
		'Direct: todo-get',
		async () => {
			await registry.execute('todo-get', { id: testId });
		},
		iterations
	);
	console.log(formatResult(getResult));
	console.log('');

	// ─────────────────────────────────────────────────────────────────
	// Benchmark 5: Toggle (read + write)
	// ─────────────────────────────────────────────────────────────────
	console.log(`${colors.yellow}▸ Benchmark: Toggle (read + write)${colors.reset}\n`);

	const toggleResult = await benchmark(
		'Direct: todo-toggle',
		async () => {
			await registry.execute('todo-toggle', { id: testId });
		},
		iterations
	);
	console.log(formatResult(toggleResult));
	console.log('');

	// ─────────────────────────────────────────────────────────────────
	// Benchmark 6: Stats (aggregation)
	// ─────────────────────────────────────────────────────────────────
	console.log(`${colors.yellow}▸ Benchmark: Stats (aggregation)${colors.reset}\n`);

	const statsResult = await benchmark(
		'Direct: todo-stats',
		async () => {
			await registry.execute('todo-stats', {});
		},
		iterations
	);
	console.log(formatResult(statsResult));
	console.log('');

	// ─────────────────────────────────────────────────────────────────
	// Summary
	// ─────────────────────────────────────────────────────────────────
	console.log(
		`${colors.bright}═══════════════════════════════════════════════════════════════${colors.reset}`
	);
	console.log(`${colors.bright}  Summary${colors.reset}`);
	console.log(
		`${colors.bright}═══════════════════════════════════════════════════════════════${colors.reset}\n`
	);

	const results = [
		emptyListResult,
		createResult,
		listWithDataResult,
		getResult,
		toggleResult,
		statsResult,
	];

	const avgOverall = results.reduce((sum, r) => sum + r.avgMs, 0) / results.length;

	console.log(`${colors.cyan}Direct Transport Results:${colors.reset}`);
	console.log(`  Average latency: ${colors.bright}${avgOverall.toFixed(3)}ms${colors.reset}`);
	console.log('');
	console.log(`${colors.dim}Expected MCP (HTTP/SSE) latency: ~20-100ms${colors.reset}`);
	console.log(`${colors.dim}Expected MCP (stdio) latency: ~10-50ms${colors.reset}`);
	console.log('');

	if (avgOverall < 1) {
		console.log(`${colors.green}✓ Direct transport is within target range (<1ms)${colors.reset}`);
		console.log(
			`${colors.green}✓ Expected speedup vs MCP: ${Math.round(30 / avgOverall)}x - ${Math.round(100 / avgOverall)}x${colors.reset}`
		);
	} else {
		console.log(
			`${colors.yellow}⚠ Direct transport is slower than expected (${avgOverall.toFixed(3)}ms)${colors.reset}`
		);
	}

	console.log('');
	console.log(`${colors.dim}Note: MCP comparison requires server running.${colors.reset}`);
	console.log(`${colors.dim}Run server with: pnpm start${colors.reset}`);
	console.log(`${colors.dim}Then compare with MCP client manually.${colors.reset}`);
	console.log('');

	// Cleanup
	store.clear();
}

main().catch(console.error);
