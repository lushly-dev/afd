import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { setCommand as constraintsSetCommand } from '../constraints/set.js';
import { nodeCreateCommand } from '../node/create.js';
import { nodeUpdateCommand } from '../node/update.js';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from './add.js';
import { tokenCopyCommand } from './copy.js';
import { tokensMatrixCommand } from './matrix.js';
import { tokenOverrideCommand } from './override.js';
import { tokenResetCommand } from './reset.js';
import { tokenSubtractCommand } from './subtract.js';

describe('tokens.matrix command', () => {
	let db: ReturnType<typeof createMemoryDatabase>;
	let context: CommandContext;

	beforeEach(async () => {
		db = createMemoryDatabase();
		context = { db, actor: 'test', traceId: 'test-trace' };

		// global-base -> xbox -> { xbox-ios, xbox-dark }, global-base -> vscode
		await nodeCreateCommand.handler({ name: 'global-base', type: 'root', parentId: null }, context);
		await nodeCreateCommand.handler(
			{ name: 'xbox', type: 'product', parentId: 'global-base' },
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
		await nodeCreateCommand.handler(
			{ name: 'vscode', type: 'product', parentId: 'global-base' },
			context,
		);

		await tokenAddCommand.handler(
			{ nodeId: 'global-base', tokenId: 'color.accent.primary', value: '#0078D4' },
			context,
		);
		await tokenAddCommand.handler(
			{ nodeId: 'global-base', tokenId: 'spacing.md', value: '16px' },
			context,
		);
	});

	const run = async (input: Parameters<typeof tokensMatrixCommand.handler>[0] = {}) => {
		const result = await tokensMatrixCommand.handler(input, context);
		expect(result.success).toBe(true);
		if (!result.data) {
			throw new Error('expected data');
		}
		return result.data;
	};

	const row = (data: Awaited<ReturnType<typeof run>>, tokenId: string) => {
		const found = data.tokens.find((token) => token.id === tokenId);
		if (!found) {
			throw new Error(`row ${tokenId} missing`);
		}
		return found;
	};

	it('orders every live node depth-first with depth', async () => {
		const data = await run();

		expect(data.nodes.map((node) => node.id)).toEqual([
			'global-base',
			'vscode',
			'xbox',
			'xbox-dark',
			'xbox-ios',
		]);
		expect(data.nodes.map((node) => node.depth)).toEqual([0, 1, 1, 2, 2]);
	});

	it('reports add, inherited, and override states with their source', async () => {
		await tokenOverrideCommand.handler(
			{ nodeId: 'xbox', tokenId: 'color.accent.primary', value: '#107C10' },
			context,
		);

		const accent = row(await run(), 'color.accent.primary');

		expect(accent.cells['global-base']).toMatchObject({
			state: 'add',
			value: '#0078D4',
			source: 'global-base',
		});
		expect(accent.cells.vscode).toMatchObject({ state: 'inherited', source: 'global-base' });
		expect(accent.cells.xbox).toMatchObject({
			state: 'override',
			value: '#107C10',
			source: 'xbox',
		});
		expect(accent.cells['xbox-ios']).toMatchObject({
			state: 'inherited',
			value: '#107C10',
			source: 'xbox',
		});
		expect(accent.varies).toBe(true);
	});

	it('distinguishes a local subtraction from one inherited from an ancestor', async () => {
		await tokenSubtractCommand.handler({ nodeId: 'xbox', tokenId: 'spacing.md' }, context);

		const spacing = row(await run(), 'spacing.md');

		expect(spacing.cells.xbox).toEqual({ state: 'subtracted', source: 'xbox' });
		expect(spacing.cells['xbox-ios']).toEqual({ state: 'absent', source: 'xbox' });
		expect(spacing.cells.vscode).toMatchObject({ state: 'inherited', value: '16px' });
	});

	it('keeps a row for a token that only exists as a subtraction in the columns', async () => {
		await tokenSubtractCommand.handler({ nodeId: 'xbox', tokenId: 'spacing.md' }, context);

		const data = await run({ nodeIds: ['xbox', 'xbox-ios'] });

		expect(row(data, 'spacing.md').cells).toEqual({
			xbox: { state: 'subtracted', source: 'xbox' },
			'xbox-ios': { state: 'absent', source: 'xbox' },
		});
	});

	it('reports copy, reset, and include states', async () => {
		await tokenAddCommand.handler(
			{ nodeId: 'vscode', tokenId: 'color.focus', value: '#007ACC' },
			context,
		);
		await tokenCopyCommand.handler(
			{ nodeId: 'xbox', tokenId: 'color.focus', fromNode: 'vscode' },
			context,
		);
		await tokenOverrideCommand.handler(
			{ nodeId: 'xbox', tokenId: 'color.accent.primary', value: '#107C10' },
			context,
		);
		await tokenResetCommand.handler(
			{ nodeId: 'xbox-ios', tokenId: 'color.accent.primary', toAncestor: 'global-base' },
			context,
		);
		await nodeCreateCommand.handler(
			{ name: 'shared-a11y', type: 'shared', parentId: null },
			context,
		);
		await tokenAddCommand.handler(
			{ nodeId: 'shared-a11y', tokenId: 'a11y.focus.width', value: '3px' },
			context,
		);
		await nodeUpdateCommand.handler(
			{ id: 'xbox-dark', updates: { includes: ['shared-a11y'] } },
			context,
		);

		const data = await run({ rootId: 'global-base' });

		expect(row(data, 'color.focus').cells.xbox).toMatchObject({
			state: 'copy',
			value: '#007ACC',
			fromNode: 'vscode',
		});
		expect(row(data, 'color.focus').cells['xbox-ios'].fromNode).toBeUndefined();
		expect(row(data, 'color.accent.primary').cells['xbox-ios']).toMatchObject({
			state: 'reset',
			value: '#0078D4',
			source: 'global-base',
			fromNode: 'global-base',
		});
		expect(row(data, 'a11y.focus.width').cells['xbox-dark']).toMatchObject({
			state: 'include',
			value: '3px',
			fromNode: 'shared-a11y',
		});
		expect(row(data, 'a11y.focus.width').cells.xbox).toEqual({ state: 'absent', source: null });
	});

	it('scopes columns to a subtree with rootId', async () => {
		const data = await run({ rootId: 'xbox' });

		expect(data.nodes.map((node) => node.id)).toEqual(['xbox', 'xbox-dark', 'xbox-ios']);
		expect(data.nodes[0].depth).toBe(1);
	});

	it('keeps explicit nodeIds in the given order', async () => {
		const data = await run({ nodeIds: ['xbox-ios', 'vscode'] });

		expect(data.nodes.map((node) => node.id)).toEqual(['xbox-ios', 'vscode']);
		expect(Object.keys(row(data, 'spacing.md').cells)).toEqual(['xbox-ios', 'vscode']);
	});

	it('filters rows by token glob', async () => {
		const data = await run({ filter: 'color.*' });

		expect(data.tokens.map((token) => token.id)).toEqual(['color.accent.primary']);
	});

	it('filters rows by token category', async () => {
		await tokenAddCommand.handler(
			{
				nodeId: 'global-base',
				tokenId: 'radius.md',
				value: '4px',
				metadata: { category: 'radius' },
			},
			context,
		);

		const data = await run({ category: 'radius' });

		expect(data.tokens.map((token) => token.id)).toEqual(['radius.md']);
	});

	it('keeps only tokens that differ across nodes with onlyVarying', async () => {
		await tokenOverrideCommand.handler(
			{ nodeId: 'xbox', tokenId: 'color.accent.primary', value: '#107C10' },
			context,
		);

		const data = await run({ onlyVarying: true });

		expect(data.tokens.map((token) => token.id)).toEqual(['color.accent.primary']);
		expect(data.summary.varyingTokens).toBe(1);
	});

	describe('onlyVarying across separate trees', () => {
		beforeEach(async () => {
			// A shared set is its own root: it lacks every token of global-base's tree
			await nodeCreateCommand.handler(
				{ name: 'shared-a11y', type: 'shared', parentId: null },
				context,
			);
			await tokenAddCommand.handler(
				{ nodeId: 'shared-a11y', tokenId: 'a11y.focus.width', value: '3px' },
				context,
			);
		});

		it('ignores a root that never had the token', async () => {
			const data = await run({ onlyVarying: true });

			expect(data.tokens).toEqual([]);
			expect(row(await run(), 'spacing.md').cells['shared-a11y']).toEqual({
				state: 'absent',
				source: null,
			});
		});

		it('keeps a token that a shared set gives only some nodes of a tree', async () => {
			await nodeUpdateCommand.handler(
				{ id: 'xbox-dark', updates: { includes: ['shared-a11y'] } },
				context,
			);

			const data = await run({ onlyVarying: true });

			expect(data.tokens.map((token) => token.id)).toEqual(['a11y.focus.width']);
		});

		it('keeps a token the trees give different values', async () => {
			await tokenAddCommand.handler(
				{ nodeId: 'shared-a11y', tokenId: 'spacing.md', value: '20px' },
				context,
			);

			const data = await run({ onlyVarying: true });

			expect(data.tokens.map((token) => token.id)).toEqual(['spacing.md']);
		});

		it('keeps a subtracted token as a difference', async () => {
			await tokenSubtractCommand.handler({ nodeId: 'xbox', tokenId: 'spacing.md' }, context);

			const data = await run({ onlyVarying: true });

			expect(data.tokens.map((token) => token.id)).toEqual(['spacing.md']);
		});

		it('keeps a token only some nodes of a tree define', async () => {
			await tokenAddCommand.handler(
				{ nodeId: 'xbox-ios', tokenId: 'spacing.ios', value: '12px' },
				context,
			);

			const data = await run({ onlyVarying: true });

			expect(data.tokens.map((token) => token.id)).toEqual(['spacing.ios']);
		});
	});

	describe('references', () => {
		beforeEach(async () => {
			await tokenAddCommand.handler(
				{ nodeId: 'global-base', tokenId: 'color.link', value: { ref: 'color.accent.primary' } },
				context,
			);
		});

		it('shows the reference next to the value it resolves to', async () => {
			await tokenOverrideCommand.handler(
				{ nodeId: 'xbox', tokenId: 'color.accent.primary', value: '#107C10' },
				context,
			);

			const link = row(await run(), 'color.link');

			expect(link.cells['global-base']).toMatchObject({
				state: 'add',
				value: { ref: 'color.accent.primary' },
				resolvedValue: '#0078D4',
				aliasOf: 'color.accent.primary',
			});
			// Resolved against each node's own tokens, so the override flows through
			expect(link.cells['xbox-ios']).toMatchObject({
				state: 'inherited',
				resolvedValue: '#107C10',
				aliasOf: 'color.accent.primary',
			});
			expect(link.cells['xbox-ios'].referenceError).toBeUndefined();
		});

		it('compares referenced values, not the references', async () => {
			await tokenOverrideCommand.handler(
				{ nodeId: 'xbox', tokenId: 'color.accent.primary', value: '#107C10' },
				context,
			);

			const data = await run({ onlyVarying: true });

			expect(data.tokens.map((token) => token.id)).toEqual(['color.accent.primary', 'color.link']);
		});

		it('reports a reference that cannot be followed', async () => {
			await tokenSubtractCommand.handler(
				{ nodeId: 'vscode', tokenId: 'color.accent.primary' },
				context,
			);

			const link = row(await run(), 'color.link');

			expect(link.cells.vscode).toMatchObject({
				state: 'inherited',
				resolvedValue: '{color.accent.primary}',
				aliasOf: 'color.accent.primary',
				referenceError: {
					code: 'TOKEN_REFERENCE_NOT_FOUND',
					path: ['color.link', 'color.accent.primary'],
				},
			});
		});
	});

	it('attaches constraint violations when asked', async () => {
		await constraintsSetCommand.handler(
			{
				nodeId: 'global-base',
				constraints: [
					{
						id: 'brand-colors',
						name: 'Brand colors',
						config: { type: 'enum', values: ['#0078D4'] },
						severity: 'error',
						applyTo: 'color.*',
					},
				],
			},
			context,
		);
		await tokenOverrideCommand.handler(
			{ nodeId: 'xbox', tokenId: 'color.accent.primary', value: '#FF00FF' },
			context,
		);

		const without = await run();
		expect(row(without, 'color.accent.primary').cells.xbox.violations).toBeUndefined();

		const data = await run({ includeViolations: true });
		const accent = row(data, 'color.accent.primary');

		expect(accent.cells['global-base'].violations).toBeUndefined();
		expect(accent.cells.xbox.violations).toEqual([
			expect.objectContaining({ constraintId: 'brand-colors', severity: 'error' }),
		]);
		// xbox-ios and xbox-dark inherit the bad value
		expect(data.summary.violations).toBe(3);
	});

	it('keeps only tokens with a violation when asked', async () => {
		await constraintsSetCommand.handler(
			{
				nodeId: 'global-base',
				constraints: [
					{
						id: 'brand-colors',
						name: 'Brand colors',
						config: { type: 'enum', values: ['#0078D4'] },
						severity: 'error',
						applyTo: 'color.*',
					},
				],
			},
			context,
		);
		await tokenOverrideCommand.handler(
			{ nodeId: 'xbox', tokenId: 'color.accent.primary', value: '#FF00FF' },
			context,
		);

		// onlyViolating checks constraints even without includeViolations
		const data = await run({ onlyViolating: true });

		expect(data.tokens.map((token) => token.id)).toEqual(['color.accent.primary']);
		expect(data.summary.violations).toBe(3);
	});

	it('marks a node that cannot be resolved instead of failing the matrix', async () => {
		await nodeCreateCommand.handler({ name: 'loop-a', type: 'custom', parentId: null }, context);
		await nodeCreateCommand.handler({ name: 'loop-b', type: 'custom', parentId: null }, context);
		const now = new Date().toISOString();
		const copyOp = (id: string, nodeId: string, fromNode: string) => ({
			id,
			nodeId,
			sequence: 1,
			type: 'copy' as const,
			tokenId: 'x',
			value: null,
			metadata: null,
			fromNode,
			asTokenId: null,
			toAncestor: null,
			reason: null,
			author: null,
			createdAt: now,
		});
		await db.addOperation(copyOp('cycle-1', 'loop-a', 'loop-b'));
		await db.addOperation(copyOp('cycle-2', 'loop-b', 'loop-a'));

		const data = await run();
		const loopA = data.nodes.find((node) => node.id === 'loop-a');

		expect(loopA?.error).toMatch(/Circular reference/);
		expect(row(data, 'spacing.md').cells['loop-a']).toEqual({ state: 'unresolved', source: null });
		expect(row(data, 'spacing.md').cells.xbox).toMatchObject({ state: 'inherited' });
	});

	it('summarizes cell states', async () => {
		const data = await run({ rootId: 'xbox' });

		expect(data.summary).toEqual({
			nodes: 3,
			tokens: 2,
			varyingTokens: 0,
			states: { inherited: 6 },
			violations: 0,
		});
	});

	it('fails for an unknown node', async () => {
		const byRoot = await tokensMatrixCommand.handler({ rootId: 'nope' }, context);
		const byIds = await tokensMatrixCommand.handler({ nodeIds: ['xbox', 'nope'] }, context);

		expect(byRoot.success).toBe(false);
		expect(byRoot.error?.code).toBe('NODE_NOT_FOUND');
		expect(byIds.error?.code).toBe('NODE_NOT_FOUND');
	});

	it('rejects rootId and nodeIds together', async () => {
		const result = await tokensMatrixCommand.handler(
			{ rootId: 'xbox', nodeIds: ['vscode'] },
			context,
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('VALIDATION_ERROR');
	});

	describe('grouping and paging', () => {
		beforeEach(async () => {
			const tokens: Array<[string, string, 'color' | 'spacing']> = [
				['color.bg', '#FFFFFF', 'color'],
				['color.fg', '#000000', 'color'],
				['spacing.lg', '24px', 'spacing'],
			];
			for (const [tokenId, value, category] of tokens) {
				await tokenAddCommand.handler(
					{ nodeId: 'global-base', tokenId, value, metadata: { category } },
					context,
				);
			}
			await tokenAddCommand.handler(
				{
					nodeId: 'global-base',
					tokenId: 'color.accent.primary.legacy',
					value: '#005A9E',
					metadata: { category: 'color', tier: 'global' },
				},
				context,
			);
			await tokenOverrideCommand.handler(
				{ nodeId: 'xbox', tokenId: 'color.fg', value: '#111111' },
				context,
			);
		});

		/** Every page of a matrix, following nextCursor */
		const allPages = async (input: Parameters<typeof run>[0]) => {
			const pages: Array<Awaited<ReturnType<typeof run>>> = [];
			let cursor: string | undefined;
			do {
				const data = await run({ ...input, cursor });
				pages.push(data);
				cursor = data.page?.nextCursor ?? undefined;
			} while (cursor);
			return pages;
		};

		it('orders rows by group and counts each group', async () => {
			const data = await run({ groupBy: 'category' });

			expect(data.tokens.map((token) => [token.category, token.id])).toEqual([
				['color', 'color.accent.primary.legacy'],
				['color', 'color.bg'],
				['color', 'color.fg'],
				['custom', 'color.accent.primary'],
				['custom', 'spacing.md'],
				['spacing', 'spacing.lg'],
			]);
			expect(data.groups).toEqual([
				{ id: 'color', tokens: 3, varyingTokens: 1, violations: 0 },
				{ id: 'custom', tokens: 2, varyingTokens: 0, violations: 0 },
				{ id: 'spacing', tokens: 1, varyingTokens: 0, violations: 0 },
			]);
		});

		it('groups by tier', async () => {
			const data = await run({ groupBy: 'tier' });

			expect(data.groups?.map((group) => [group.id, group.tokens])).toEqual([
				['global', 1],
				['semantic', 5],
			]);
		});

		it('returns counts without rows in summary mode', async () => {
			const data = await run({ groupBy: 'category', summaryOnly: true });

			expect(data.tokens).toEqual([]);
			expect(data.nodes).toHaveLength(5);
			expect(data.summary.tokens).toBe(6);
			expect(data.groups?.map((group) => group.id)).toEqual(['color', 'custom', 'spacing']);
			expect(data.page).toBeUndefined();
		});

		it('pages through every row once, with counts for all of them', async () => {
			const whole = await run({ groupBy: 'category' });
			const pages = await allPages({ groupBy: 'category', limit: 4 });

			expect(pages.map((page) => page.tokens.length)).toEqual([4, 2]);
			expect(pages.flatMap((page) => page.tokens)).toEqual(whole.tokens);
			expect(pages[0].page).toMatchObject({ limit: 4, returned: 4 });
			expect(pages[0].page).toMatchObject({ offset: 0, prevCursor: null });
			expect(pages[1].page).toEqual({
				limit: 4,
				returned: 2,
				offset: 4,
				nextCursor: null,
				prevCursor: expect.any(String),
			});
			for (const page of pages) {
				expect(page.summary).toEqual(whole.summary);
				expect(page.groups).toEqual(whole.groups);
			}
		});

		it('pages without grouping in token id order', async () => {
			const pages = await allPages({ limit: 5 });

			expect(pages.flatMap((page) => page.tokens.map((token) => token.id))).toEqual([
				'color.accent.primary',
				'color.accent.primary.legacy',
				'color.bg',
				'color.fg',
				'spacing.lg',
				'spacing.md',
			]);
		});

		it('keeps its place when a token is added between pages', async () => {
			const first = await run({ limit: 2 });
			await tokenAddCommand.handler(
				{ nodeId: 'global-base', tokenId: 'color.aaa', value: '#AAAAAA' },
				context,
			);
			const second = await run({ limit: 2, cursor: first.page?.nextCursor ?? undefined });

			expect(first.tokens.map((token) => token.id)).toEqual([
				'color.accent.primary',
				'color.accent.primary.legacy',
			]);
			expect(second.tokens.map((token) => token.id)).toEqual(['color.bg', 'color.fg']);
		});

		it('loads one category at a time, paged', async () => {
			const pages = await allPages({ category: 'color', limit: 2 });

			expect(pages.flatMap((page) => page.tokens.map((token) => token.id))).toEqual([
				'color.accent.primary.legacy',
				'color.bg',
				'color.fg',
			]);
			expect(pages[0].summary.tokens).toBe(3);
		});

		it('rejects a cursor that is not one, or is for another groupBy', async () => {
			const first = await run({ groupBy: 'category', limit: 1 });
			const results = await Promise.all([
				tokensMatrixCommand.handler({ cursor: 'not-a-cursor', limit: 1 }, context),
				tokensMatrixCommand.handler(
					{ groupBy: 'tier', cursor: first.page?.nextCursor ?? undefined, limit: 1 },
					context,
				),
			]);

			for (const result of results) {
				expect(result.success).toBe(false);
				expect(result.error?.code).toBe('VALIDATION_ERROR');
			}
		});

		it('sorts token ids in reverse within each group, keeping the groups in order', async () => {
			const data = await run({ groupBy: 'category', sort: 'token-desc' });

			expect(data.tokens.map((token) => [token.category, token.id])).toEqual([
				['color', 'color.fg'],
				['color', 'color.bg'],
				['color', 'color.accent.primary.legacy'],
				['custom', 'spacing.md'],
				['custom', 'color.accent.primary'],
				['spacing', 'spacing.lg'],
			]);
			expect(data.groups?.map((group) => group.id)).toEqual(['color', 'custom', 'spacing']);
		});

		it('pages in reverse token id order without grouping', async () => {
			const pages = await allPages({ sort: 'token-desc', limit: 4 });

			expect(pages.map((page) => page.tokens.map((token) => token.id))).toEqual([
				['spacing.md', 'spacing.lg', 'color.fg', 'color.bg'],
				['color.accent.primary.legacy', 'color.accent.primary'],
			]);
		});

		it('rejects a cursor from a page in the other order', async () => {
			const first = await run({ sort: 'token-desc', limit: 1 });
			const result = await tokensMatrixCommand.handler(
				{ cursor: first.page?.nextCursor ?? undefined, limit: 1 },
				context,
			);

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('describes the same cells on a page as in the whole matrix (#114)', async () => {
			for (const input of [
				{ includeViolations: true },
				{ groupBy: 'category' as const, sort: 'token-desc' as const },
				{ onlyVarying: true },
			]) {
				const whole = await run(input);
				const pages = await allPages({ ...input, limit: 1 });
				expect(pages.flatMap((page) => page.tokens)).toEqual(whole.tokens);
			}
		});

		it('returns the page holding a token, from where paging from the start puts it', async () => {
			const input = { groupBy: 'category' as const, limit: 2 };
			const pages = await allPages(input);
			const data = await run({ ...input, around: 'color.accent.primary' });

			// Rows 3–4: color.fg, then custom's color.accent.primary
			expect(data.tokens).toEqual(pages[1].tokens);
			expect(data.page).toMatchObject({ limit: 2, returned: 2, offset: 2 });
			expect(data.page?.nextCursor).toBe(pages[1].page?.nextCursor);
			expect(data.summary).toEqual(pages[0].summary);
			expect(data.groups).toEqual(pages[0].groups);
		});

		it('pages back from a page reached with around, to the first page', async () => {
			const input = { category: 'color' as const, sort: 'token-desc' as const, limit: 1 };
			const last = await run({ ...input, around: 'color.accent.primary.legacy' });
			expect(last.tokens.map((token) => token.id)).toEqual(['color.accent.primary.legacy']);
			expect(last.page).toMatchObject({ offset: 2, nextCursor: null });

			const ids: string[][] = [];
			let cursor = last.page?.prevCursor ?? undefined;
			while (cursor) {
				const data = await run({ ...input, cursor });
				ids.push(data.tokens.map((token) => token.id));
				cursor = data.page?.prevCursor ?? undefined;
				expect(data.page?.nextCursor).toEqual(expect.any(String));
			}
			expect(ids).toEqual([['color.bg'], ['color.fg']]);
		});

		it('pages back a whole page before a cursor, then forward to the same rows', async () => {
			const pages = await allPages({ limit: 2 });
			const back = await run({ limit: 2, cursor: pages[2].page?.prevCursor ?? undefined });

			expect(back.tokens).toEqual(pages[1].tokens);
			expect(back.page?.offset).toBe(2);
			const forward = await run({ limit: 2, cursor: back.page?.nextCursor ?? undefined });
			expect(forward.tokens).toEqual(pages[2].tokens);
		});

		it('rejects around without limit or with a cursor, and a token that has no row', async () => {
			const first = await run({ limit: 1 });
			const invalid = await Promise.all([
				tokensMatrixCommand.handler({ around: 'color.bg' }, context),
				tokensMatrixCommand.handler(
					{ around: 'color.bg', limit: 1, cursor: first.page?.nextCursor ?? undefined },
					context,
				),
			]);
			for (const result of invalid) {
				expect(result.success).toBe(false);
				expect(result.error?.code).toBe('VALIDATION_ERROR');
			}

			const missing = await tokensMatrixCommand.handler(
				{ around: 'spacing.lg', category: 'color', limit: 1 },
				context,
			);
			expect(missing.success).toBe(false);
			expect(missing.error?.code).toBe('TOKEN_NOT_FOUND');
		});

		it('rejects a limit outside 1..MAX_MATRIX_PAGE_SIZE', async () => {
			await expect(tokensMatrixCommand.handler({ limit: 0 }, context)).rejects.toThrow();
		});
	});
});
