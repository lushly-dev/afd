/**
 * The integration delegates resolution and export to the native foundation: for the realistic
 * demo system, `tokens.resolve` and `export` return what the native functions compute, and their
 * failures carry the native error's code, message and suggestion inside the AFD envelope.
 */
import {
	EXPORT_FORMATS,
	TokenDomainError,
	createMemoryDatabase,
	exportTokens,
	resolveTokens,
} from '@lushly-dev/violet-core';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CommandContext } from './commands/registry.js';
import { seedRealisticSystem } from './demo/realistic-system.js';
import { initializeCore, registry } from './index.js';

/** Swift, Kotlin, Dart and Tailwind headers stamp the generation time */
const stable = (result: unknown) => {
	const value = result as { content: string };
	return { ...value, content: value.content.replace(/Generated: \S+/g, 'Generated: <time>') };
};

// Seeding the demo system and exporting every node run long beside the other suites
const SLOW = 60_000;

describe('AFD commands agree with the native token API', () => {
	let context: CommandContext;
	let nodes: string[];

	beforeAll(async () => {
		initializeCore();
		context = { db: createMemoryDatabase(), actor: 'parity', traceId: 'parity' };
		await seedRealisticSystem(context, { checks: false, history: false });
		nodes = (await context.db.listNodes()).map((node) => node.id);
		expect(nodes.length).toBeGreaterThan(5);
	}, SLOW);

	it(
		'tokens.resolve returns the native resolution for every node',
		async () => {
			for (const nodeId of nodes) {
				const command = await registry.execute('tokens.resolve', { nodeId }, context);
				const native = await resolveTokens(context.db, nodeId);
				expect(command.success, nodeId).toBe(true);
				expect(command.data).toMatchObject({
					nodeId,
					ancestryChain: native.ancestryChain,
					total: native.tokens.length,
				});
				expect((command.data as { tokens: unknown }).tokens).toEqual(native.tokens);
			}
		},
		SLOW,
	);

	it.each(EXPORT_FORMATS)(
		'export %s content equals the native export',
		async (format) => {
			const options = format === 'lua' ? {} : { prefix: 'vlt' };
			for (const nodeId of nodes) {
				const command = await registry.execute('export', { nodeId, format, ...options }, context);
				const native = await exportTokens(context.db, nodeId, { format, ...options }).catch(
					(error: unknown) => error,
				);
				if (native instanceof TokenDomainError) {
					expect(command.success, `${format} ${nodeId}`).toBe(false);
					expect(command.error).toMatchObject({
						code: native.code,
						message: native.message,
						suggestion: native.suggestion,
					});
					continue;
				}
				expect(command.success, `${format} ${nodeId}`).toBe(true);
				expect(stable(command.data)).toMatchObject(stable(native));
			}
		},
		SLOW,
	);

	it('a missing node fails the same way through both surfaces', async () => {
		const command = await registry.execute('export', { nodeId: 'missing', format: 'css' }, context);
		const native = await exportTokens(context.db, 'missing', { format: 'css' }).catch(
			(error: TokenDomainError) => error,
		);
		expect(command.error).toMatchObject({
			code: native.code,
			message: native.message,
			suggestion: native.suggestion,
		});
	});
});
