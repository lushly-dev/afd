/**
 * @fileoverview The clock and ids a write takes from its context (#1324)
 */

import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { describe, expect, it } from 'vitest';
import { analyzeSnapshotCommand } from './analyze/snapshot.js';
import { setCommand as constraintsSetCommand } from './constraints/set.js';
import { contextId, contextMillis, contextNow } from './context-sources.js';
import { importJsonCommand } from './import/json.js';
import { nodeCreateCommand } from './node/create.js';
import { nodeDeleteCommand } from './node/delete.js';
import { nodeUpdateCommand } from './node/update.js';
import type { CommandContext } from './registry.js';
import { tokenAddCommand } from './token/add.js';
import { tokenCopyCommand } from './token/copy.js';
import { tokenOverrideCommand } from './token/override.js';
import { tokenResetCommand } from './token/reset.js';
import { tokenSubtractCommand } from './token/subtract.js';

/** A seeded generator (mulberry32), the kind a journaling host replays */
function seeded(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** A clock that steps one second per reading from a fixed start */
function steppingClock(start: number): () => number {
	let reading = start;
	return () => {
		const now = reading;
		reading += 1000;
		return now;
	};
}

const START = Date.UTC(2026, 0, 2, 3, 4, 5);

function replayContext(seed: number): CommandContext {
	return {
		db: createMemoryDatabase(),
		actor: 'replay',
		now: steppingClock(START),
		random: seeded(seed),
	};
}

/** Every write command that stamps a record, in one recorded run */
async function recordedRun(context: CommandContext): Promise<void> {
	const run = async (result: Promise<{ success: boolean; error?: unknown }>) => {
		const settled = await result;
		expect(settled.success, JSON.stringify(settled.error)).toBe(true);
	};
	await run(nodeCreateCommand.handler({ name: 'base', type: 'root', parentId: null }, context));
	await run(nodeCreateCommand.handler({ name: 'app', type: 'product', parentId: 'base' }, context));
	await run(nodeCreateCommand.handler({ name: 'old', type: 'theme', parentId: 'base' }, context));
	await run(
		tokenAddCommand.handler({ nodeId: 'base', tokenId: 'color.a', value: '#111111' }, context),
	);
	await run(
		tokenAddCommand.handler({ nodeId: 'base', tokenId: 'color.b', value: '#222222' }, context),
	);
	await run(
		tokenOverrideCommand.handler({ nodeId: 'app', tokenId: 'color.a', value: '#333333' }, context),
	);
	await run(tokenResetCommand.handler({ nodeId: 'app', tokenId: 'color.a' }, context));
	await run(
		tokenCopyCommand.handler(
			{ nodeId: 'app', fromNode: 'base', tokenId: 'color.b', asTokenId: 'color.c' },
			context,
		),
	);
	await run(tokenSubtractCommand.handler({ nodeId: 'app', tokenId: 'color.b' }, context));
	await run(nodeUpdateCommand.handler({ id: 'app', updates: { description: 'The app' } }, context));
	await run(nodeDeleteCommand.handler({ id: 'old' }, context));
	await run(
		importJsonCommand.handler(
			{ targetNode: 'app', content: JSON.stringify({ color: { d: { $value: '#444444' } } }) },
			context,
		),
	);
	await run(
		constraintsSetCommand.handler(
			{
				nodeId: 'base',
				constraints: [
					{
						id: 'hex-colors',
						name: 'Hex colors',
						config: { type: 'pattern', pattern: '^#[0-9a-fA-F]{6}$' },
						applyTo: 'color.*',
					},
				],
			},
			context,
		),
	);
	await run(
		constraintsSetCommand.handler(
			{
				nodeId: 'base',
				merge: true,
				constraints: [
					{
						id: 'text-contrast',
						name: 'Text contrast',
						config: { type: 'contrast', against: 'color.a', min: 4.5 },
						applyTo: 'color.b',
					},
				],
			},
			context,
		),
	);
	await run(analyzeSnapshotCommand.handler({ rootId: 'base' }, context));
}

/** Everything a run wrote, in a stable order */
async function written(context: CommandContext) {
	const { db } = context;
	const nodes = await db.listNodes();
	const operations = [];
	for (const node of nodes) operations.push(...(await db.getOperations(node.id)));
	return {
		nodes,
		operations,
		audit: await db.getAuditEvents({ limit: 1000 }),
		snapshots: await db.listCheckSnapshots(),
	};
}

describe('context clock and ids (#1324)', () => {
	it('stamps records with the context clock as ISO 8601', () => {
		expect(contextNow({ now: () => START })).toBe('2026-01-02T03:04:05.000Z');
		expect(contextMillis({ now: () => START })).toBe(START);
	});

	it('falls back to the wall clock without one', () => {
		const before = Date.now();
		const millis = Date.parse(contextNow({}));
		expect(millis).toBeGreaterThanOrEqual(before);
		expect(millis).toBeLessThanOrEqual(Date.now());
	});

	it('draws ids from the context random source, nanoid-shaped', () => {
		const first = contextId({ random: seeded(7) });
		expect(first).toMatch(/^[A-Za-z0-9_-]{21}$/);
		expect(contextId({ random: seeded(7) })).toBe(first);
		expect(contextId({ random: seeded(8) })).not.toBe(first);
		expect(contextId({ random: seeded(7) }, 16)).toHaveLength(16);
	});

	it('keeps an id valid when a source returns the ends of its range', () => {
		expect(contextId({ random: () => 0 })).toMatch(/^[A-Za-z0-9_-]{21}$/);
		expect(contextId({ random: () => 1 })).toMatch(/^[A-Za-z0-9_-]{21}$/);
	});

	it('falls back to nanoid without a random source', () => {
		expect(contextId({})).toMatch(/^[A-Za-z0-9_-]{21}$/);
		expect(contextId({})).not.toBe(contextId({}));
	});

	it('replays a recorded run exactly under the same clock and random source', async () => {
		const first = replayContext(42);
		const second = replayContext(42);
		await recordedRun(first);
		await recordedRun(second);

		const a = await written(first);
		const b = await written(second);
		expect(a.operations.length).toBeGreaterThan(5);
		expect(a.audit.length).toBeGreaterThan(5);
		expect(a.snapshots).toHaveLength(1);
		expect(b).toEqual(a);
	});

	it('takes every stamped time from the context clock', async () => {
		const context = replayContext(1);
		await recordedRun(context);
		const { nodes, operations, audit, snapshots } = await written(context);
		const stamps = [
			...nodes.flatMap((node) => [node.createdAt, node.updatedAt, node.deletedAt]),
			...operations.map((op) => op.createdAt),
			...audit.map((event) => event.timestamp),
			...snapshots.map((snapshot) => snapshot.takenAt),
		].filter((stamp): stamp is string => typeof stamp === 'string');
		expect(stamps.length).toBeGreaterThan(10);
		for (const stamp of stamps) {
			expect(stamp.startsWith('2026-01-02T03:')).toBe(true);
		}
	});

	it('writes different ids under a different random source', async () => {
		const first = replayContext(42);
		const second = replayContext(43);
		await recordedRun(first);
		await recordedRun(second);
		const a = (await written(first)).audit.map((event) => event.id);
		const b = (await written(second)).audit.map((event) => event.id);
		expect(a).not.toEqual(b);
	});

	it('gives two imports of one token at one clock reading different ids', async () => {
		const context: CommandContext = {
			db: createMemoryDatabase(),
			now: () => START,
			random: seeded(5),
		};
		await nodeCreateCommand.handler({ name: 'base', type: 'root', parentId: null }, context);
		const content = JSON.stringify({ color: { a: { $value: '#111111' } } });
		for (const merge of [false, true]) {
			const result = await importJsonCommand.handler(
				{ targetNode: 'base', content, merge },
				context,
			);
			expect(result.success, JSON.stringify(result.error)).toBe(true);
		}
		const ids = (await context.db.getOperations('base')).map((op) => op.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
