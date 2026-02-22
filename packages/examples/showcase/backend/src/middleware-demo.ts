/**
 * Default Middleware Demo
 *
 * Exercises: defaultMiddleware, telemetry, logging, timing, trace IDs
 */

import { success } from '@lushly-dev/afd-core';
import {
	ConsoleTelemetrySink,
	createMcpServer,
	createTelemetryMiddleware,
	defaultMiddleware,
	defineCommand,
} from '@lushly-dev/afd-server';
import { z } from 'zod';

const divider = (label: string) =>
	console.log(`\n${'═'.repeat(60)}\n  ${label}\n${'═'.repeat(60)}`);

async function run() {
	console.log('\n⚙️  Middleware Demo\n');

	const slowWarnings: Array<{ name: string; ms: number }> = [];
	const logs: string[] = [];

	// ── 1. Define commands with varying speeds ──────────────────────────
	const fastCommand = defineCommand({
		name: 'data-fetch',
		description: 'Fetch data quickly',
		input: z.object({ key: z.string() }),
		async handler(input) {
			return success(
				{ key: input.key, value: 'fast-result' },
				{ confidence: 0.99, reasoning: 'Cache hit' },
			);
		},
	});

	const slowCommand = defineCommand({
		name: 'report-generate',
		description: 'Generate a complex report (slow)',
		input: z.object({ type: z.string() }),
		async handler(input) {
			await new Promise((resolve) => setTimeout(resolve, 150));
			return success(
				{ type: input.type, rows: 42 },
				{ confidence: 0.85, reasoning: 'Full computation' },
			);
		},
	});

	const failingCommand = defineCommand({
		name: 'item-get',
		description: 'Get an item that might not exist',
		input: z.object({ id: z.string() }),
		async handler() {
			const { failure } = await import('@lushly-dev/afd-core');
			return failure({
				code: 'NOT_FOUND',
				message: 'Item does not exist',
				suggestion: 'Check the ID and try again',
			});
		},
	});

	// ── 2. Build server with default middleware ──────────────────────────
	divider('Default Middleware Stack (logging + timing + traceId)');

	const server = createMcpServer({
		name: 'middleware-demo',
		version: '1.0.0',
		commands: [fastCommand, slowCommand, failingCommand],
		transport: 'stdio',
		middleware: defaultMiddleware({
			logging: { log: (msg) => logs.push(msg) },
			timing: {
				slowThreshold: 100,
				onSlow: (name, ms) => {
					slowWarnings.push({ name, ms });
					console.log(`  ⚠️  SLOW: ${name} took ${ms}ms`);
				},
			},
		}),
	});

	// ── 3. Execute commands and observe middleware output ────────────────
	divider('Fast command');
	const r1 = await server.execute('data-fetch', { key: 'hello' });
	console.log('  Result:', JSON.stringify(r1, null, 2));
	console.log('  TraceId:', r1.metadata?.traceId);

	divider('Slow command (should trigger warning)');
	const r2 = await server.execute('report-generate', { type: 'quarterly' });
	console.log('  Result:', JSON.stringify(r2, null, 2));
	console.log('  TraceId:', r2.metadata?.traceId);

	divider('Failing command');
	const r3 = await server.execute('item-get', { id: 'nonexistent' });
	console.log('  Result:', JSON.stringify(r3, null, 2));

	// ── 4. Show captured logs ───────────────────────────────────────────
	divider('Captured Log Output');
	for (const log of logs) {
		console.log(`  ${log}`);
	}

	// ── 5. Slow warnings summary ────────────────────────────────────────
	divider('Slow Command Warnings');
	if (slowWarnings.length === 0) {
		console.log('  (none)');
	} else {
		for (const w of slowWarnings) {
			console.log(`  ⚠ ${w.name}: ${w.ms}ms`);
		}
	}

	// ── 6. Telemetry sink demo ──────────────────────────────────────────
	divider('Telemetry Sink (ConsoleTelemetrySink)');

	const telemetryLogs: string[] = [];
	const sink = new ConsoleTelemetrySink({
		log: (msg) => telemetryLogs.push(msg),
	});

	const server2 = createMcpServer({
		name: 'telemetry-demo',
		version: '1.0.0',
		commands: [fastCommand],
		transport: 'stdio',
		middleware: [
			...defaultMiddleware({ logging: false, timing: false }),
			createTelemetryMiddleware({ sink }),
		],
	});

	await server2.execute('data-fetch', { key: 'telemetry-test' });
	console.log('  Telemetry output:');
	for (const log of telemetryLogs) {
		console.log(`    ${log}`);
	}

	await server.stop();
	await server2.stop();
	console.log('\n✅  Middleware demo complete\n');
}

run().catch(console.error);
