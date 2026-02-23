/**
 * Pipeline Demo — Variable Resolution, Conditions, and Metadata Aggregation
 *
 * Demonstrates:
 * 1. Basic chaining with $prev variable
 * 2. Aliased steps with $steps.alias references
 * 3. Conditional execution with when clauses
 * 4. Aggregated metadata (confidence, reasoning, warnings)
 * 5. Error propagation and continueOnFailure
 * 6. Timeout handling
 */

import { createDirectClient, type DirectRegistry } from '@lushly-dev/afd-client';
import { type CommandResult, createCommandRegistry, success } from '@lushly-dev/afd-core';
import { defineCommand } from '@lushly-dev/afd-server';

const divider = (label: string) =>
	console.log(`\n${'═'.repeat(60)}\n  ${label}\n${'═'.repeat(60)}`);

// ═══════════════════════════════════════════════════════════
// COMMAND DEFINITIONS
// ═══════════════════════════════════════════════════════════

import { z } from 'zod';

const userGet = defineCommand({
	name: 'user-get',
	description: 'Get a user by ID',
	category: 'users',
	input: z.object({ id: z.number() }),
	async handler(input) {
		const users: Record<number, { id: number; name: string; tier: string; email: string }> = {
			1: { id: 1, name: 'Alice', tier: 'premium', email: 'alice@example.com' },
			2: { id: 2, name: 'Bob', tier: 'free', email: 'bob@example.com' },
		};
		const user = users[input.id];
		if (!user) {
			return {
				success: false,
				error: {
					code: 'NOT_FOUND',
					message: `User ${input.id} not found`,
					suggestion: 'Try id 1 or 2',
				},
			} as CommandResult<never>;
		}
		return success(user, { confidence: 1, reasoning: 'Matched by ID' });
	},
});

const orderList = defineCommand({
	name: 'order-list',
	description: 'List orders for a user',
	category: 'orders',
	input: z.object({ userId: z.number() }),
	async handler(input) {
		const orders = [
			{ id: 'ORD-1', userId: input.userId, total: 59.99, status: 'shipped' },
			{ id: 'ORD-2', userId: input.userId, total: 149.0, status: 'delivered' },
			{ id: 'ORD-3', userId: input.userId, total: 24.5, status: 'processing' },
		];
		return success(orders, {
			confidence: 0.95,
			reasoning: `Found ${orders.length} orders for user ${input.userId}`,
		});
	},
});

const orderSummarize = defineCommand({
	name: 'order-summarize',
	description: 'Summarize a list of orders',
	category: 'orders',
	input: z.object({
		orders: z.array(
			z.object({
				id: z.string(),
				total: z.number(),
				status: z.string(),
			})
		),
		userName: z.string(),
	}),
	async handler(input) {
		const total = input.orders.reduce((sum, o) => sum + o.total, 0);
		const shipped = input.orders.filter((o) => o.status === 'shipped').length;
		return success(
			{
				userName: input.userName,
				orderCount: input.orders.length,
				totalSpent: total,
				inTransit: shipped,
			},
			{
				confidence: 0.9,
				reasoning: 'Aggregated from order list',
				warnings: [{ code: 'ESTIMATE', message: 'Totals exclude taxes and shipping' }],
			}
		);
	},
});

const discountApply = defineCommand({
	name: 'discount-apply',
	description: 'Apply a loyalty discount for premium users',
	category: 'orders',
	input: z.object({ userId: z.number(), totalSpent: z.number() }),
	async handler(input) {
		const rate = input.totalSpent > 200 ? 0.15 : 0.1;
		return success(
			{
				userId: input.userId,
				discountRate: rate,
				discountAmount: input.totalSpent * rate,
			},
			{
				confidence: 0.85,
				reasoning: `Applied ${rate * 100}% loyalty discount`,
			}
		);
	},
});

const slowCommand = defineCommand({
	name: 'analytics-compute',
	description: 'Run a slow analytics computation',
	category: 'analytics',
	input: z.object({ userId: z.number() }),
	async handler(input) {
		await new Promise((resolve) => setTimeout(resolve, 300));
		return success({ userId: input.userId, score: 42 });
	},
});

const failingCommand = defineCommand({
	name: 'payment-charge',
	description: 'Charge a payment (will fail for demo)',
	category: 'payments',
	input: z.object({ amount: z.number() }),
	async handler() {
		return {
			success: false,
			error: {
				code: 'PAYMENT_DECLINED',
				message: 'Card declined',
				suggestion: 'Try a different payment method',
			},
		} as CommandResult<never>;
	},
});

// ═══════════════════════════════════════════════════════════
// REGISTRY + CLIENT
// ═══════════════════════════════════════════════════════════

const registry = createCommandRegistry();
const commands = [userGet, orderList, orderSummarize, discountApply, slowCommand, failingCommand];
for (const cmd of commands) {
	registry.register(cmd.toCommandDefinition());
}

// Adapt core CommandRegistry to DirectRegistry interface
const directRegistry: DirectRegistry = {
	execute: (name, input, context) => registry.execute(name, input, context),
	listCommandNames: () => registry.list().map((c) => c.name),
	listCommands: () => registry.list().map((c) => ({ name: c.name, description: c.description })),
	hasCommand: (name) => registry.has(name),
	getCommand: (name) => registry.get(name),
};

const client = createDirectClient(directRegistry);

async function run() {
	console.log('\n🔗  Pipeline Demo\n');

	// ═══════════════════════════════════════════════════════════
	// 1. BASIC CHAINING — $prev passes data forward
	// ═══════════════════════════════════════════════════════════

	divider('1. Basic Chaining ($prev)');

	const basic = await client.pipe([
		{ command: 'user-get', input: { id: 1 } },
		{ command: 'order-list', input: { userId: '$prev.id' } },
	]);

	console.log(
		'  Step 0 (user-get): Got user with id =',
		(basic.steps[0]?.data as { id: number })?.id
	);
	console.log(
		'  Step 1 (order-list): $prev.id resolved to user id, found',
		(basic.data as unknown[])?.length,
		'orders'
	);
	console.log('  Pipeline confidence:', basic.metadata.confidence, '(weakest link)');

	// ═══════════════════════════════════════════════════════════
	// 2. ALIASED STEPS — $steps.alias for named references
	// ═══════════════════════════════════════════════════════════

	divider('2. Aliased Steps ($steps.alias)');

	const aliased = await client.pipe([
		{ command: 'user-get', input: { id: 1 }, as: 'user' },
		{ command: 'order-list', input: { userId: '$prev.id' }, as: 'orders' },
		{
			command: 'order-summarize',
			input: {
				orders: '$steps.orders', // Reference by alias
				userName: '$steps.user.name', // Cross-reference earlier step
			},
		},
	]);

	const summary = aliased.data as {
		userName: string;
		orderCount: number;
		totalSpent: number;
		inTransit: number;
	};
	console.log(
		`  ${summary.userName}: ${summary.orderCount} orders, $${summary.totalSpent.toFixed(2)} total, ${summary.inTransit} in transit`
	);
	console.log('  Confidence breakdown:');
	for (const c of aliased.metadata.confidenceBreakdown) {
		console.log(
			`    Step ${c.step} (${c.command}${c.alias ? ` as "${c.alias}"` : ''}): ${c.confidence}`
		);
	}
	console.log('  Aggregated reasoning:');
	for (const r of aliased.metadata.reasoning) {
		console.log(`    Step ${r.stepIndex} (${r.command}): ${r.reasoning}`);
	}
	if (aliased.metadata.warnings.length > 0) {
		console.log('  Warnings:');
		for (const w of aliased.metadata.warnings) {
			console.log(`    ⚠ Step ${w.stepIndex}: [${w.code}] ${w.message}`);
		}
	}

	// ═══════════════════════════════════════════════════════════
	// 3. CONDITIONAL EXECUTION — when clause skips steps
	// ═══════════════════════════════════════════════════════════

	divider('3. Conditional Execution (when)');

	// Premium user (id=1, tier='premium') — discount step runs
	const premiumPipeline = await client.pipe([
		{ command: 'user-get', input: { id: 1 }, as: 'user' },
		{ command: 'order-list', input: { userId: '$prev.id' }, as: 'orders' },
		{
			command: 'order-summarize',
			input: { orders: '$steps.orders', userName: '$steps.user.name' },
			as: 'summary',
		},
		{
			command: 'discount-apply',
			input: { userId: '$steps.user.id', totalSpent: '$steps.summary.totalSpent' },
			when: { $eq: ['$steps.user.tier', 'premium'] },
		},
	]);

	const premiumDiscount = premiumPipeline.data as { discountRate: number; discountAmount: number };
	console.log('  Premium user (Alice):');
	console.log(
		`    Discount applied: ${premiumDiscount.discountRate * 100}% = -$${premiumDiscount.discountAmount.toFixed(2)}`
	);
	console.log(
		`    Steps: ${premiumPipeline.metadata.completedSteps}/${premiumPipeline.metadata.totalSteps} completed`
	);

	// Free user (id=2, tier='free') — discount step skipped
	const freePipeline = await client.pipe([
		{ command: 'user-get', input: { id: 2 }, as: 'user' },
		{ command: 'order-list', input: { userId: '$prev.id' }, as: 'orders' },
		{
			command: 'order-summarize',
			input: { orders: '$steps.orders', userName: '$steps.user.name' },
			as: 'summary',
		},
		{
			command: 'discount-apply',
			input: { userId: '$steps.user.id', totalSpent: '$steps.summary.totalSpent' },
			when: { $eq: ['$steps.user.tier', 'premium'] },
		},
	]);

	const skippedStep = freePipeline.steps[3];
	console.log('  Free user (Bob):');
	console.log(`    Discount step status: ${skippedStep?.status} (condition not met)`);
	console.log(`    Final data: order summary (last successful step)`);
	console.log(
		`    Steps: ${freePipeline.metadata.completedSteps}/${freePipeline.metadata.totalSteps} completed`
	);

	// ═══════════════════════════════════════════════════════════
	// 4. ERROR PROPAGATION — pipeline stops on failure
	// ═══════════════════════════════════════════════════════════

	divider('4. Error Propagation (stopOnError)');

	const errorPipeline = await client.pipe([
		{ command: 'user-get', input: { id: 1 }, as: 'user' },
		{ command: 'payment-charge', input: { amount: 100 } }, // This fails
		{ command: 'order-list', input: { userId: '$steps.user.id' } }, // Skipped
	]);

	for (const step of errorPipeline.steps) {
		const detail =
			step.status === 'failure'
				? ` — ${step.error?.code}: ${step.error?.message}`
				: step.status === 'skipped'
					? ' (skipped due to prior failure)'
					: '';
		console.log(`  Step ${step.index} (${step.command}): ${step.status}${detail}`);
	}
	console.log(
		`  Completed: ${errorPipeline.metadata.completedSteps}/${errorPipeline.metadata.totalSteps}`
	);

	// ═══════════════════════════════════════════════════════════
	// 5. CONTINUE ON FAILURE — collect all results
	// ═══════════════════════════════════════════════════════════

	divider('5. Continue On Failure');

	const resilientPipeline = await client.pipe({
		steps: [
			{ command: 'user-get', input: { id: 1 }, as: 'user' },
			{ command: 'payment-charge', input: { amount: 100 } }, // Fails but continues
			{ command: 'order-list', input: { userId: '$steps.user.id' } }, // Still runs
		],
		options: { continueOnFailure: true },
	});

	for (const step of resilientPipeline.steps) {
		console.log(`  Step ${step.index} (${step.command}): ${step.status}`);
	}
	console.log(
		`  Completed: ${resilientPipeline.metadata.completedSteps}/${resilientPipeline.metadata.totalSteps}`
	);
	console.log(`  Final data available: ${resilientPipeline.data != null}`);

	// ═══════════════════════════════════════════════════════════
	// 6. TIMEOUT — pipeline aborts slow steps
	// ═══════════════════════════════════════════════════════════

	divider('6. Timeout Handling');

	const timeoutPipeline = await client.pipe({
		steps: [
			{ command: 'user-get', input: { id: 1 } },
			{ command: 'analytics-compute', input: { userId: 1 } }, // 300ms — exceeds timeout
		],
		options: { timeoutMs: 50 },
	});

	for (const step of timeoutPipeline.steps) {
		const detail = step.error ? ` — ${step.error.code}` : '';
		console.log(`  Step ${step.index} (${step.command}): ${step.status}${detail}`);
	}
	console.log(`  Total time: ${timeoutPipeline.metadata.executionTimeMs.toFixed(1)}ms`);

	console.log(`\n${'═'.repeat(60)}\n  ✅  Pipeline demo complete\n${'═'.repeat(60)}\n`);
}

run().catch(console.error);
