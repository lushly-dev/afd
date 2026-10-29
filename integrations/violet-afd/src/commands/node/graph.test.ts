import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from '../token/add.js';
import { tokenCopyCommand } from '../token/copy.js';
import { tokensMatrixCommand } from '../token/matrix.js';
import { tokenOverrideCommand } from '../token/override.js';
import { tokenSubtractCommand } from '../token/subtract.js';
import { nodeCreateCommand } from './create.js';
import { nodeGetCommand } from './get.js';
import { nodesGraphCommand } from './graph.js';
import { nodeUpdateCommand } from './update.js';

describe('nodes.graph command', () => {
	let db: ReturnType<typeof createMemoryDatabase>;
	let context: CommandContext;

	beforeEach(async () => {
		db = createMemoryDatabase();
		context = { db, actor: 'test', traceId: 'test-trace' };

		// global-base -> { vscode, xbox -> { xbox-dark, xbox-ios } }, plus a separate a11y mixin root
		await nodeCreateCommand.handler({ name: 'global-base', type: 'root', parentId: null }, context);
		await nodeCreateCommand.handler(
			{ name: 'vscode', type: 'product', parentId: 'global-base' },
			context,
		);
		await nodeCreateCommand.handler(
			{ name: 'xbox', type: 'product', parentId: 'global-base', owner: 'xbox-design' },
			context,
		);
		await nodeCreateCommand.handler(
			{ name: 'xbox-ios', type: 'platform', parentId: 'xbox' },
			context,
		);
		await nodeCreateCommand.handler(
			{ name: 'xbox-dark', type: 'theme', parentId: 'xbox' },
			context,
		);
		await nodeCreateCommand.handler({ name: 'a11y', type: 'shared', parentId: null }, context);

		await tokenAddCommand.handler(
			{
				nodeId: 'global-base',
				tokenId: 'color.accent.primary',
				value: '#0078D4',
				metadata: { category: 'color' },
			},
			context,
		);
		await tokenAddCommand.handler(
			{
				nodeId: 'global-base',
				tokenId: 'spacing.md',
				value: '16px',
				metadata: { category: 'spacing' },
			},
			context,
		);
		await tokenAddCommand.handler(
			{
				nodeId: 'vscode',
				tokenId: 'color.focus',
				value: '#007ACC',
				metadata: { category: 'color' },
			},
			context,
		);
		await tokenAddCommand.handler(
			{ nodeId: 'a11y', tokenId: 'focus.ring.width', value: '3px' },
			context,
		);
		await tokenOverrideCommand.handler(
			{ nodeId: 'xbox', tokenId: 'color.accent.primary', value: '#107C10' },
			context,
		);
		await tokenSubtractCommand.handler({ nodeId: 'xbox', tokenId: 'spacing.md' }, context);
		await tokenCopyCommand.handler(
			{ nodeId: 'xbox', tokenId: 'color.focus', fromNode: 'vscode' },
			context,
		);
		await tokenCopyCommand.handler(
			{ nodeId: 'xbox', tokenId: 'color.focus', fromNode: 'vscode', asTokenId: 'color.ring' },
			context,
		);
		await nodeUpdateCommand.handler({ id: 'xbox-dark', updates: { includes: ['a11y'] } }, context);
	});

	const run = async (input: Parameters<typeof nodesGraphCommand.handler>[0] = {}) => {
		const result = await nodesGraphCommand.handler(input, context);
		expect(result.success).toBe(true);
		if (!result.data) {
			throw new Error('expected data');
		}
		return result.data;
	};

	const node = (data: Awaited<ReturnType<typeof run>>, id: string) => {
		const found = data.nodes.find((entry) => entry.id === id);
		if (!found) {
			throw new Error(`node ${id} missing`);
		}
		return found;
	};

	it('returns every tree depth-first with depth and child counts', async () => {
		const data = await run();

		expect(data.roots).toEqual(['a11y', 'global-base']);
		expect(data.nodes.map((entry) => entry.id)).toEqual([
			'a11y',
			'global-base',
			'vscode',
			'xbox',
			'xbox-dark',
			'xbox-ios',
		]);
		expect(node(data, 'xbox-ios').depth).toBe(2);
		expect(node(data, 'global-base').childCount).toBe(2);
		expect(data.nodes.every((entry) => !entry.external)).toBe(true);
	});

	it('counts each node’s own operations by type', async () => {
		const data = await run();

		expect(node(data, 'global-base').changes).toMatchObject({ add: 2, total: 2 });
		expect(node(data, 'xbox').changes).toEqual({
			add: 0,
			override: 1,
			subtract: 1,
			reset: 0,
			copy: 2,
			total: 4,
			// The renamed copy (color.ring) takes its source's category
			byCategory: { color: { override: 1, copy: 2 }, spacing: { subtract: 1 } },
		});
		expect(node(data, 'xbox').owner).toBe('xbox-design');
		expect(node(data, 'vscode').owner).toBeUndefined();
		expect(node(data, 'xbox-ios').changes.total).toBe(0);
	});

	it('reports a deprecated node’s sunset date and replacement (#117)', async () => {
		await context.db.updateNode('vscode', {
			status: 'deprecated',
			sunsetAt: '2027-01-31',
			replacedBy: 'xbox',
		});
		const result = await nodesGraphCommand.handler({}, context);
		expect(result.data?.nodes.find((entry) => entry.id === 'vscode')).toMatchObject({
			status: 'deprecated',
			sunsetAt: '2027-01-31',
			replacedBy: 'xbox',
		});
		expect(result.data?.nodes.find((entry) => entry.id === 'xbox')).not.toHaveProperty('sunsetAt');
	});

	it('reports parent, include, and copy edges in the direction values flow', async () => {
		const data = await run();

		expect(data.edges.filter((edge) => edge.kind === 'parent')).toHaveLength(4);
		expect(data.edges).toContainEqual({ kind: 'parent', from: 'xbox', to: 'xbox-ios' });
		expect(data.edges).toContainEqual({ kind: 'include', from: 'a11y', to: 'xbox-dark' });
		expect(data.edges).toContainEqual({
			kind: 'copy',
			from: 'vscode',
			to: 'xbox',
			tokens: [{ tokenId: 'color.focus' }, { tokenId: 'color.focus', asTokenId: 'color.ring' }],
		});
		expect(data.summary.edges).toEqual({ parent: 4, include: 1, copy: 1 });
	});

	it('scopes to a subtree and adds outside sources as external nodes', async () => {
		const data = await run({ rootId: 'xbox' });

		// Categories still come from definitions above the subtree
		expect(node(data, 'xbox').changes.byCategory.spacing).toEqual({ subtract: 1 });

		expect(data.roots).toEqual(['xbox']);
		expect(data.nodes.map((entry) => [entry.id, entry.external])).toEqual([
			['xbox', false],
			['xbox-dark', false],
			['xbox-ios', false],
			['a11y', true],
			['vscode', true],
		]);
		// global-base is the parent of xbox but outside the scope, so no parent edge
		expect(data.edges.some((edge) => edge.from === 'global-base')).toBe(false);
		expect(data.summary.external).toBe(2);
	});

	it('includes each node’s operations only when asked', async () => {
		const without = await run();
		expect(node(without, 'xbox').operations).toBeUndefined();

		const data = await run({ includeOperations: true });
		const ops = node(data, 'xbox').operations ?? [];

		expect(ops.map((op) => op.type)).toEqual(['override', 'subtract', 'copy', 'copy']);
		expect(ops[0]).toMatchObject({ tokenId: 'color.accent.primary', value: '#107C10' });
		expect(ops[3]).toMatchObject({ fromNode: 'vscode', asTokenId: 'color.ring' });
	});

	it('lists the tokens each node subtracts without its operations (#115)', async () => {
		const data = await run();

		expect(node(data, 'xbox').subtractedTokens).toEqual(['spacing.md']);
		expect(node(data, 'xbox').operations).toBeUndefined();
		expect(node(data, 'vscode').subtractedTokens).toBeUndefined();
	});

	it('gives node.get the same operations as the graph lists (#115)', async () => {
		const data = await run({ includeOperations: true });
		for (const entry of data.nodes) {
			const result = await nodeGetCommand.handler(
				{ id: entry.id, includeOperations: true },
				context,
			);
			expect(result.data?.operations).toEqual(entry.operations);
		}
	});

	it('traces a token with the same cells as the matrix row (#116)', async () => {
		await tokenAddCommand.handler(
			{ nodeId: 'global-base', tokenId: 'color.link', value: '{color.accent.primary}' },
			context,
		);
		const matrix = await tokensMatrixCommand.handler({}, context);
		for (const tokenId of ['color.accent.primary', 'color.link', 'spacing.md', 'color.ring']) {
			const data = await run({ token: tokenId });
			const row = matrix.data?.tokens.find((entry) => entry.id === tokenId);
			expect(data.trace?.cells).toEqual(row?.cells);
			expect(data.trace?.varies).toBe(row?.varies);
		}
	});

	it('reads each node once for a trace, sharing the resolution cache (#116)', async () => {
		let reads = 0;
		const counting = new Proxy(db, {
			get(target, property, receiver) {
				const value = Reflect.get(target, property, receiver);
				if (property === 'getOperations' || property === 'getAncestryChain') {
					return (...args: unknown[]) => {
						reads += 1;
						return value.apply(target, args);
					};
				}
				return typeof value === 'function' ? value.bind(target) : value;
			},
		});
		const result = await nodesGraphCommand.handler(
			{ token: 'color.accent.primary' },
			{ ...context, db: counting },
		);

		expect(result.success).toBe(true);
		const nodes = result.data?.nodes.length ?? 0;
		// One getOperations and one getAncestryChain per node, at most
		expect(reads).toBeLessThanOrEqual(nodes * 2);
	});

	it('marks operations a later one on the same node replaced, and copies as live', async () => {
		await tokenOverrideCommand.handler(
			{ nodeId: 'xbox', tokenId: 'color.focus', value: '#FF0000' },
			context,
		);
		const ops = node(await run({ includeOperations: true }), 'xbox').operations ?? [];

		const copyFocus = ops.find((op) => op.type === 'copy' && !op.asTokenId);
		const overrideFocus = ops.find((op) => op.type === 'override' && op.tokenId === 'color.focus');
		expect(copyFocus?.supersededBy).toBe(overrideFocus?.sequence);
		expect(copyFocus?.tracksSource).toBe(true);
		expect(overrideFocus?.supersededBy).toBeUndefined();
		// A renamed copy targets a different token, so nothing replaces it
		expect(ops.find((op) => op.asTokenId === 'color.ring')?.supersededBy).toBeUndefined();
		expect(ops[0].supersededBy).toBeUndefined();
		expect(ops[0].tracksSource).toBeUndefined();
	});

	it('traces one token across every node', async () => {
		const data = await run({ token: 'color.accent.primary' });

		expect(data.trace).toMatchObject({
			tokenId: 'color.accent.primary',
			found: true,
			varies: true,
		});
		expect(data.trace?.cells['global-base']).toMatchObject({ state: 'add', value: '#0078D4' });
		expect(data.trace?.cells.xbox).toMatchObject({ state: 'override', value: '#107C10' });
		expect(data.trace?.cells['xbox-dark']).toMatchObject({ state: 'inherited', source: 'xbox' });
		expect(data.trace?.cells.a11y).toEqual({ state: 'absent', source: null });
	});

	it('traces a reference with the value it resolves to on each node', async () => {
		await tokenAddCommand.handler(
			{ nodeId: 'global-base', tokenId: 'color.link', value: '{color.accent.primary}' },
			context,
		);

		const data = await run({ token: 'color.link' });

		expect(data.trace?.cells['global-base']).toMatchObject({
			state: 'add',
			value: '{color.accent.primary}',
			resolvedValue: '#0078D4',
			aliasOf: 'color.accent.primary',
		});
		expect(data.trace?.cells['xbox-dark']).toMatchObject({
			state: 'inherited',
			resolvedValue: '#107C10',
			aliasOf: 'color.accent.primary',
		});
		expect(data.trace?.varies).toBe(true);
	});

	it('traces a subtracted token and flags an unknown one', async () => {
		const spacing = await run({ token: 'spacing.md' });
		expect(spacing.trace?.cells.xbox).toEqual({ state: 'subtracted', source: 'xbox' });
		expect(spacing.trace?.cells['xbox-ios']).toEqual({ state: 'absent', source: 'xbox' });

		const unknown = await run({ token: 'does.not.exist' });
		expect(unknown.trace?.found).toBe(false);
	});

	it('leaves out deleted nodes', async () => {
		await db.updateNode('xbox-ios', { deletedAt: new Date().toISOString() });

		const data = await run();

		expect(data.nodes.some((entry) => entry.id === 'xbox-ios')).toBe(false);
		expect(node(data, 'xbox').childCount).toBe(1);
	});

	it('fails for an unknown root', async () => {
		const result = await nodesGraphCommand.handler({ rootId: 'nope' }, context);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('NODE_NOT_FOUND');
	});
});
