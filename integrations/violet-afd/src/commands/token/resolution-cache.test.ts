import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import {
	ResolutionCache,
	resolutionCacheFor,
	withResolutionCache,
} from '@lushly-dev/violet-core/engine';
import { InheritanceResolutionError, resolveInheritance } from '@lushly-dev/violet-core/engine';
import type { OperationRecord } from '@lushly-dev/violet-core/types';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedRealisticSystem } from '../../demo/realistic-system.js';
import { nodeCreateCommand } from '../node/create.js';
import type { CommandContext, Database } from '../registry.js';
import { tokenAddCommand } from './add.js';
import { tokensMatrixCommand } from './matrix.js';
import { tokenOverrideCommand } from './override.js';

const READS = ['getOperations', 'getNode', 'getAncestryChain'] as const;
type Read = (typeof READS)[number];

/** A store that counts the reads the resolver makes */
function countingStore(db: Database) {
	const counts: Record<Read, number> = { getOperations: 0, getNode: 0, getAncestryChain: 0 };
	const store = new Proxy(db, {
		get(target, property, receiver) {
			const value = Reflect.get(target, property, receiver);
			if (typeof value !== 'function') return value;
			if ((READS as readonly string[]).includes(property as string)) {
				return (...args: unknown[]) => {
					counts[property as Read] += 1;
					return value.apply(target, args);
				};
			}
			return value.bind(target);
		},
	});
	const total = () => READS.reduce((sum, read) => sum + counts[read], 0);
	const reset = () => {
		for (const read of READS) counts[read] = 0;
	};
	return { store, counts, total, reset };
}

/** Resolve every node with lineage, sharing one cache or none */
async function resolveAll(db: Database, nodeIds: string[], cache?: ResolutionCache) {
	const resolved: Record<string, unknown> = {};
	for (const nodeId of nodeIds) {
		const chain = await db.getAncestryChain(nodeId);
		resolved[nodeId] = await resolveInheritance(db, nodeId, chain, true, { cache });
	}
	return resolved;
}

describe('resolution cache on the realistic demo system', () => {
	let db: Database;
	let nodeIds: string[];

	beforeAll(async () => {
		db = createMemoryDatabase();
		await seedRealisticSystem({ db, actor: 'demo', traceId: 'demo' });
		nodeIds = (await db.listNodes()).map((node) => node.id);
	}, 60_000);

	it('resolves every node to the same tokens and lineage', async () => {
		const uncached = await resolveAll(db, nodeIds);
		const cached = await resolveAll(db, nodeIds, new ResolutionCache(db));

		expect(nodeIds).toHaveLength(37);
		expect(cached).toEqual(uncached);
	});

	it('reads each node from the store once instead of once per descendant', async () => {
		const spy = countingStore(db);
		await resolveAll(spy.store, nodeIds);
		const uncached = { ...spy.counts, total: spy.total() };

		spy.reset();
		await resolveAll(spy.store, nodeIds, new ResolutionCache(spy.store));
		const cached = { ...spy.counts, total: spy.total() };

		// Each node's operations and record are read at most once per run
		expect(cached.getOperations).toBeLessThanOrEqual(nodeIds.length);
		expect(cached.getNode).toBeLessThanOrEqual(nodeIds.length);
		expect(cached.getOperations).toBeLessThan(uncached.getOperations / 2);
		expect(cached.total).toBeLessThan(uncached.total / 2);
	});

	it('makes tokens.matrix read each node once', async () => {
		const spy = countingStore(db);
		const result = await tokensMatrixCommand.handler({}, { db: spy.store });

		expect(result.success).toBe(true);
		expect(spy.counts.getOperations).toBeLessThanOrEqual(nodeIds.length);
	});
});

describe('resolution cache scope', () => {
	let db: ReturnType<typeof createMemoryDatabase>;
	let context: CommandContext;

	beforeEach(async () => {
		db = createMemoryDatabase();
		context = { db, actor: 'test', traceId: 'test-trace' };
		await nodeCreateCommand.handler({ name: 'root', type: 'root', parentId: null }, context);
		await nodeCreateCommand.handler({ name: 'child', type: 'product', parentId: 'root' }, context);
		await tokenAddCommand.handler(
			{ nodeId: 'root', tokenId: 'color.x', value: '#111111' },
			context,
		);
	});

	/** Store an operation directly, bypassing the commands' validation */
	const store = async (record: Partial<OperationRecord> & Pick<OperationRecord, 'nodeId'>) => {
		const ops = await db.getOperations(record.nodeId);
		await db.addOperation({
			id: `op-${record.nodeId}-${ops.length + 1}`,
			sequence: ops.length + 1,
			type: 'add',
			tokenId: 'color.x',
			value: null,
			metadata: null,
			fromNode: null,
			asTokenId: null,
			toAncestor: null,
			reason: null,
			author: 'test',
			createdAt: new Date().toISOString(),
			...record,
		});
	};

	const cell = async (nodeId: string) => {
		const result = await tokensMatrixCommand.handler({}, context);
		return result.data?.tokens.find((row) => row.id === 'color.x')?.cells[nodeId];
	};

	it('lasts one command run, so the next run sees a write', async () => {
		expect((await cell('child'))?.value).toBe('#111111');

		await tokenOverrideCommand.handler(
			{ nodeId: 'root', tokenId: 'color.x', value: '#222222' },
			context,
		);

		expect((await cell('child'))?.value).toBe('#222222');
		expect(context.resolutionCache).toBeUndefined();
	});

	it('is not shared with a context for another store', () => {
		const scoped = withResolutionCache(context);
		const other = { ...scoped, db: createMemoryDatabase() };

		expect(resolutionCacheFor(scoped)).toBe(scoped.resolutionCache);
		expect(resolutionCacheFor(other)).toBeUndefined();
		expect(withResolutionCache(other).resolutionCache).not.toBe(scoped.resolutionCache);
	});

	it('still reports a cycle, every time it is resolved', async () => {
		await store({ nodeId: 'child', type: 'copy', tokenId: 'color.x', fromNode: 'child' });
		const cache = new ResolutionCache(db);

		for (let attempt = 0; attempt < 2; attempt++) {
			await expect(resolveInheritance(db, 'child', ['root'], false, { cache })).rejects.toThrow(
				InheritanceResolutionError,
			);
		}
		expect((await cell('child'))?.state).toBe('unresolved');
	});

	it('gives a root and its child the same result for a reset stored on the root', async () => {
		// Regression check for #88: a reset with no target on a root, or one aimed
		// outside the chain, does nothing, whichever node is resolved through it
		await store({ nodeId: 'root', type: 'reset', tokenId: 'color.x' });
		await store({ nodeId: 'root', type: 'reset', tokenId: 'color.x', toAncestor: 'child' });
		await store({
			nodeId: 'root',
			type: 'override',
			tokenId: 'color.x',
			value: JSON.stringify('#333333'),
		});

		const uncached = await resolveAll(db, ['root', 'child']);
		const cached = await resolveAll(db, ['root', 'child'], new ResolutionCache(db));
		const lineage = (nodeId: string) =>
			(uncached[nodeId] as Array<{ id: string; operationHistory?: unknown }>).find(
				(token) => token.id === 'color.x',
			)?.operationHistory;

		expect(cached).toEqual(uncached);
		expect(lineage('child')).toEqual(lineage('root'));
		expect(lineage('root')).toEqual([
			{ nodeId: 'root', operation: 'add', value: '#111111' },
			{ nodeId: 'root', operation: 'override', value: '#333333' },
		]);
	});
});

describe('resolution cache depth cap (#116)', () => {
	const LINKS = 70;
	let db: ReturnType<typeof createMemoryDatabase>;
	let context: CommandContext;
	const link = (index: number) => `link-${index}`;

	beforeAll(async () => {
		db = createMemoryDatabase();
		context = { db, actor: 'test', traceId: 'test-trace' };
		// link-0 includes link-1, which includes link-2, … down to link-69
		for (let index = LINKS - 1; index >= 0; index--) {
			const includes = index < LINKS - 1 ? [link(index + 1)] : [];
			const created = await nodeCreateCommand.handler(
				{ name: link(index), type: 'root', parentId: null, includes },
				context,
			);
			expect(created.success).toBe(true);
		}
		await tokenAddCommand.handler(
			{ nodeId: link(LINKS - 1), tokenId: 'color.x', value: '#111111' },
			context,
		);
	});

	const resolve = (nodeId: string, cache?: ResolutionCache) =>
		resolveInheritance(db, nodeId, [], false, { cache });

	it('fails an include chain deeper than MAX_RESOLUTION_DEPTH, without a cache', async () => {
		// link-6 nests 63 more resolutions below it, the most the cap allows
		expect((await resolve(link(6))).map((token) => token.id)).toEqual(['color.x']);
		await expect(resolve(link(0))).rejects.toThrow(/depth exceeded 64/);
	});

	it('still fails it when a shallower resolution cached part of the chain', async () => {
		const cache = new ResolutionCache(db);
		await resolve(link(6), cache);

		await expect(resolve(link(0), cache)).rejects.toThrow(InheritanceResolutionError);
		await expect(resolve(link(0), cache)).rejects.toThrow(/depth exceeded 64/);
		// One level up is over the cap too; one down still resolves from the cache
		await expect(resolve(link(5), cache)).rejects.toThrow(/depth exceeded 64/);
		expect((await resolve(link(7), cache)).map((token) => token.id)).toEqual(['color.x']);
	});

	it('gives a matrix column the same result whichever columns come first', async () => {
		const alone = await tokensMatrixCommand.handler({ nodeIds: [link(0)] }, context);
		const after = await tokensMatrixCommand.handler({ nodeIds: [link(6), link(0)] }, context);

		expect(alone.data?.nodes[0].error).toMatch(/depth exceeded 64/);
		expect(after.data?.nodes[1].error).toMatch(/depth exceeded 64/);
		expect(after.data?.tokens[0].cells[link(0)]).toEqual({ state: 'unresolved', source: null });
		expect(after.data?.tokens[0].cells[link(6)]).toMatchObject({ state: 'include' });
	});
});
