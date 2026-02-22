/**
 * Feature Playground — Full Run
 *
 * Exercises all 3 features together:
 * 1. Auth adapter (MockAuthAdapter + middleware + commands)
 * 2. Default middleware (traceId + logging + slow warnings)
 * 3. Surface validation (quality checks on the command set)
 */

import { MockAuthAdapter, createAuthCommands, createAuthMiddleware } from '@lushly-dev/afd-auth';
import { success } from '@lushly-dev/afd-core';
import { createMcpServer, defaultMiddleware, defineCommand } from '@lushly-dev/afd-server';
import { validateCommandSurface } from '@lushly-dev/afd-testing';
import { z } from 'zod';

const divider = (label: string) =>
	console.log(`\n${'═'.repeat(60)}\n  ${label}\n${'═'.repeat(60)}`);

async function run() {
	console.log('\n🎯  Feature Playground — Full Run\n');

	const logs: string[] = [];
	const slowWarnings: Array<{ name: string; ms: number }> = [];

	// ═══════════════════════════════════════════════════════════
	// 1. SETUP
	// ═══════════════════════════════════════════════════════════

	const auth = new MockAuthAdapter({ delay: 30 });
	const authMiddleware = createAuthMiddleware(auth, {
		exclude: ['auth-sign-in', 'auth-session-get'],
	});
	const authCommands = createAuthCommands(auth);

	const todoCreate = defineCommand({
		name: 'todo-create',
		description: 'Create a new todo item with title and optional category',
		category: 'todos',
		input: z.object({
			title: z.string().min(1),
			category: z.string().optional(),
		}),
		mutation: true,
		async handler(input, context) {
			const user = (context.auth as { user: { id: string } })?.user;
			return success(
				{ id: crypto.randomUUID().slice(0, 8), title: input.title, owner: user?.id },
				{ confidence: 1, reasoning: 'Created in-memory' },
			);
		},
	});

	const todoList = defineCommand({
		name: 'todo-list',
		description: 'List all todo items with optional status filter',
		category: 'todos',
		input: z.object({
			status: z.enum(['active', 'done', 'all']).optional().default('all'),
		}),
		async handler() {
			return success(
				[
					{ id: '1', title: 'Write tests', status: 'active' },
					{ id: '2', title: 'Ship feature', status: 'done' },
				],
				{ reasoning: 'Returned mock data' },
			);
		},
	});

	const reportGenerate = defineCommand({
		name: 'report-generate',
		description: 'Generate a summary report across all todos (slow operation)',
		category: 'reports',
		input: z.object({}),
		async handler() {
			await new Promise((resolve) => setTimeout(resolve, 120));
			return success({ totalTodos: 42, completionRate: 0.73 }, {
				confidence: 0.9,
				reasoning: 'Aggregated from all records',
			});
		},
	});

	const allCommands = [todoCreate, todoList, reportGenerate, ...authCommands];

	// ═══════════════════════════════════════════════════════════
	// 2. BUILD SERVER (auth + middleware stack)
	// ═══════════════════════════════════════════════════════════

	const server = createMcpServer({
		name: 'feature-playground',
		version: '1.0.0',
		commands: allCommands,
		transport: 'stdio',
		middleware: [
			...defaultMiddleware({
				logging: { log: (msg) => logs.push(msg) },
				timing: {
					slowThreshold: 100,
					onSlow: (name, ms) => slowWarnings.push({ name, ms }),
				},
			}),
			authMiddleware,
		],
	});

	// ═══════════════════════════════════════════════════════════
	// 3. AUTH FLOW
	// ═══════════════════════════════════════════════════════════

	divider('Auth: Unauthenticated → Denied');
	const denied = await server.execute('todo-create', { title: 'Should fail' });
	console.log(`  Success: ${denied.success}`);
	console.log(`  Error: ${denied.error?.code} — ${denied.error?.message}`);

	divider('Auth: Sign In');
	const signIn = await server.execute('auth-sign-in', {
		method: 'credentials',
		email: 'demo@lushly.dev',
	});
	console.log(`  Success: ${signIn.success}`);

	divider('Auth: Authenticated → Allowed');
	const created = await server.execute('todo-create', { title: 'My first todo' });
	console.log(`  Success: ${created.success}`);
	console.log(`  Data: ${JSON.stringify(created.data)}`);
	console.log(`  TraceId: ${created.metadata?.traceId}`);

	// ═══════════════════════════════════════════════════════════
	// 4. MIDDLEWARE IN ACTION
	// ═══════════════════════════════════════════════════════════

	divider('Middleware: Fast Command');
	const listResult = await server.execute('todo-list', {});
	console.log(`  Items: ${Array.isArray(listResult.data) ? listResult.data.length : 0}`);
	console.log(`  TraceId: ${listResult.metadata?.traceId}`);

	divider('Middleware: Slow Command (should trigger warning)');
	const reportResult = await server.execute('report-generate', {});
	console.log(`  Data: ${JSON.stringify(reportResult.data)}`);
	console.log(`  Confidence: ${reportResult.confidence}`);

	divider('Middleware: Captured Logs');
	for (const log of logs) {
		console.log(`    ${log}`);
	}

	divider('Middleware: Slow Warnings');
	for (const w of slowWarnings) {
		console.log(`  ⚠ ${w.name}: ${w.ms}ms`);
	}

	// ═══════════════════════════════════════════════════════════
	// 5. SURFACE VALIDATION
	// ═══════════════════════════════════════════════════════════

	divider('Surface Validation: This Server\'s Commands');

	// Validate the command surface we just built
	const surfaceResult = validateCommandSurface(allCommands);

	console.log(`  Valid: ${surfaceResult.valid ? '✅' : '❌'}`);
	console.log(`  Commands analyzed: ${surfaceResult.summary.commandCount}`);
	console.log(`  Errors: ${surfaceResult.summary.errorCount}  Warnings: ${surfaceResult.summary.warningCount}  Info: ${surfaceResult.summary.infoCount}`);
	console.log(`  Duration: ${surfaceResult.summary.durationMs}ms`);

	if (surfaceResult.findings.length > 0) {
		console.log('\n  Findings:');
		for (const f of surfaceResult.findings) {
			const icon = f.severity === 'error' ? '🔴' : f.severity === 'warning' ? '🟡' : '🔵';
			console.log(`    ${icon} [${f.rule}] ${f.message} → ${f.commands.join(', ')}`);
		}
	} else {
		console.log('  No findings — clean surface! 🎉');
	}

	await server.stop();
	console.log(`\n${'═'.repeat(60)}\n  ✅  All features exercised successfully\n${'═'.repeat(60)}\n`);
}

run().catch(console.error);
