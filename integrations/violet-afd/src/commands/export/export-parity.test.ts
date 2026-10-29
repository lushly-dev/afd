/**
 * @fileoverview Export must agree with tokens.resolve (the source of truth for inheritance)
 */

import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { initializeExport } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { nodeCreateCommand } from '../node/create.js';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from '../token/add.js';
import { tokenCopyCommand } from '../token/copy.js';
import { tokenLineageCommand } from '../token/lineage.js';
import { tokenOverrideCommand } from '../token/override.js';
import { tokenResetCommand } from '../token/reset.js';
import { tokensResolveCommand } from '../token/resolve.js';
import { tokenSubtractCommand } from '../token/subtract.js';
import { exportCommand } from './export.js';

initializeExport();

describe('export parity with tokens.resolve', () => {
	let db: ReturnType<typeof createMemoryDatabase>;
	let context: CommandContext;

	beforeEach(() => {
		db = createMemoryDatabase();
		context = { db, actor: 'test', traceId: 'test-trace' };
	});

	const createNode = async (
		name: string,
		parentId: string | null,
		extra: Record<string, unknown> = {},
	) => {
		const result = await nodeCreateCommand.handler(
			{ name, type: parentId ? 'product' : 'root', parentId, ...extra } as never,
			context,
		);
		expect(result.success).toBe(true);
	};

	const add = async (nodeId: string, tokenId: string, value: string) => {
		const result = await tokenAddCommand.handler({ nodeId, tokenId, value }, context);
		expect(result.success).toBe(true);
	};

	/** Flatten the Style Dictionary JSON export to { 'a.b.c': value } */
	const exportFlat = async (nodeId: string): Promise<Record<string, unknown>> => {
		const result = await exportCommand.handler({ nodeId, format: 'json' } as never, context);
		expect(result.success).toBe(true);
		const flat: Record<string, unknown> = {};
		const walk = (obj: Record<string, unknown>, path: string[]) => {
			for (const [key, child] of Object.entries(obj)) {
				if (child && typeof child === 'object' && 'value' in (child as object)) {
					flat[[...path, key].join('.')] = (child as { value: unknown }).value;
				} else {
					walk(child as Record<string, unknown>, [...path, key]);
				}
			}
		};
		walk(JSON.parse(result.data?.content ?? '{}'), []);
		return flat;
	};

	const resolveFlat = async (nodeId: string): Promise<Record<string, unknown>> => {
		const result = await tokensResolveCommand.handler({ nodeId }, context);
		expect(result.success).toBe(true);
		return Object.fromEntries((result.data?.tokens ?? []).map((t) => [t.id, t.resolvedValue]));
	};

	it('matches after override followed by reset', async () => {
		await createNode('root', null);
		await createNode('child', 'root');
		await add('root', 'color.accent', '#ff0000');
		await tokenOverrideCommand.handler(
			{ nodeId: 'child', tokenId: 'color.accent', value: '#0000ff' },
			context,
		);
		await tokenResetCommand.handler({ nodeId: 'child', tokenId: 'color.accent' }, context);

		const resolved = await resolveFlat('child');
		expect(resolved['color.accent']).toBe('#ff0000');
		expect(await exportFlat('child')).toEqual(resolved);

		// token.lineage agrees about the current value too
		const lineage = await tokenLineageCommand.handler(
			{ nodeId: 'child', tokenId: 'color.accent' },
			context,
		);
		expect(lineage.success).toBe(true);
		expect(lineage.data?.currentValue).toBe('#ff0000');
	});

	it('includes copied tokens, including renamed copies', async () => {
		await createNode('root', null);
		await createNode('left', 'root');
		await createNode('right', 'root');
		await add('left', 'color.signature', '#123456');
		await tokenCopyCommand.handler(
			{ nodeId: 'right', tokenId: 'color.signature', fromNode: 'left' },
			context,
		);
		await tokenCopyCommand.handler(
			{
				nodeId: 'right',
				tokenId: 'color.signature',
				fromNode: 'left',
				asTokenId: 'color.alias',
			},
			context,
		);

		const resolved = await resolveFlat('right');
		expect(resolved['color.signature']).toBe('#123456');
		expect(resolved['color.alias']).toBe('#123456');
		expect(await exportFlat('right')).toEqual(resolved);

		const lineage = await tokenLineageCommand.handler(
			{ nodeId: 'right', tokenId: 'color.alias' },
			context,
		);
		expect(lineage.success).toBe(true);
		expect(lineage.data?.currentValue).toBe('#123456');
		expect(lineage.data?.chain.some((c) => c.operation === 'copy')).toBe(true);
	});

	it('applies overrides and nested includes from include nodes', async () => {
		await createNode('base', null);
		await add('base', 'size.base', '8px');
		// shared-inner: a root mixin with its own token
		await createNode('shared-inner', null);
		await add('shared-inner', 'size.inner', '2px');
		// shared-outer inherits from base, overrides base's token and includes shared-inner
		await createNode('shared-outer', 'base', { includes: ['shared-inner'] });
		await tokenOverrideCommand.handler(
			{ nodeId: 'shared-outer', tokenId: 'size.base', value: '16px' },
			context,
		);
		await createNode('consumer', null, { includes: ['shared-outer'] });

		const resolved = await resolveFlat('consumer');
		expect(resolved['size.base']).toBe('16px');
		expect(resolved['size.inner']).toBe('2px');
		expect(await exportFlat('consumer')).toEqual(resolved);

		// Include-only tokens can be traced
		const lineage = await tokenLineageCommand.handler(
			{ nodeId: 'consumer', tokenId: 'size.inner' },
			context,
		);
		expect(lineage.success).toBe(true);
		expect(lineage.data?.currentValue).toBe('2px');
	});

	it('honours includePolicy', async () => {
		await createNode('base', null);
		await add('base', 'color.brand', '#aaaaaa');
		await createNode('shared', null);
		await add('shared', 'color.brand', '#bbbbbb');
		await createNode('merge-node', 'base', { includes: ['shared'], includePolicy: 'merge' });
		await createNode('override-node', 'base', { includes: ['shared'], includePolicy: 'override' });

		const merged = await resolveFlat('merge-node');
		const overridden = await resolveFlat('override-node');
		expect(merged['color.brand']).toBe('#aaaaaa');
		expect(overridden['color.brand']).toBe('#bbbbbb');
		expect(await exportFlat('merge-node')).toEqual(merged);
		expect(await exportFlat('override-node')).toEqual(overridden);
	});

	it('matches after a subtract', async () => {
		await createNode('root', null);
		await createNode('child', 'root');
		await add('root', 'a', '1');
		await add('root', 'b', '2');
		await tokenSubtractCommand.handler({ nodeId: 'child', tokenId: 'a' }, context);

		const resolved = await resolveFlat('child');
		expect(Object.keys(resolved)).toEqual(['b']);
		expect(await exportFlat('child')).toEqual(resolved);
	});
});
