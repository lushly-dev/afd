import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { nodeCreateCommand } from '../node/create.js';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from './add.js';
import { tokensCatalogCommand } from './catalog.js';
import { tokenCopyCommand } from './copy.js';
import { tokenOverrideCommand } from './override.js';
import { tokenResetCommand } from './reset.js';
import { tokenSubtractCommand } from './subtract.js';

describe('tokens.catalog command', () => {
	let context: CommandContext;

	beforeEach(async () => {
		context = { db: createMemoryDatabase(), actor: 'test', traceId: 'test-trace' };
		const create = (name: string, parentId: string | null, extra = {}) =>
			nodeCreateCommand.handler({ name, parentId, type: 'custom', ...extra }, context);
		const add = (nodeId: string, tokenId: string, value: string, metadata = {}) =>
			tokenAddCommand.handler(
				{
					nodeId,
					tokenId,
					value,
					metadata: {
						category: 'custom',
						tier: 'semantic',
						status: 'stable',
						platforms: [],
						tags: [],
						...metadata,
					},
				},
				context,
			);

		// global -> { xbox -> xbox-dark, vscode }, plus an hc mixin root
		await create('global', null);
		await create('xbox', 'global');
		await create('vscode', 'global');
		await create('hc', null);
		await create('xbox-dark', 'xbox', { includes: ['hc'], includePolicy: 'override' });

		await add('global', 'color.accent.primary', '#0078D4', {
			category: 'color',
			description: 'Main interactive accent',
			owner: 'design-system',
		});
		await add('global', 'color.brand.tertiary', '#00A2AD', {
			category: 'color',
			status: 'deprecated',
			deprecatedBy: 'color.brand.secondary',
		});
		await add('global', 'spacing.md', '16px', { category: 'spacing', tier: 'global' });
		await add('hc', 'color.text.primary', '#000000', { category: 'color' });
		await add('vscode', 'color.focus', '#007ACC', { category: 'color' });

		await tokenOverrideCommand.handler(
			{ nodeId: 'xbox', tokenId: 'color.accent.primary', value: '#107C10' },
			context,
		);
		await tokenResetCommand.handler(
			{ nodeId: 'xbox-dark', tokenId: 'color.accent.primary', toAncestor: 'global' },
			context,
		);
		await tokenSubtractCommand.handler({ nodeId: 'vscode', tokenId: 'spacing.md' }, context);
		await tokenCopyCommand.handler(
			{ nodeId: 'xbox', tokenId: 'color.focus', fromNode: 'vscode', asTokenId: 'color.ring' },
			context,
		);
	});

	const run = async (input: Parameters<typeof tokensCatalogCommand.handler>[0] = {}) => {
		const result = await tokensCatalogCommand.handler(input, context);
		expect(result.success).toBe(true);
		if (!result.data) throw new Error('expected data');
		return result.data;
	};
	const token = (data: Awaited<ReturnType<typeof run>>, id: string) => {
		const found = data.tokens.find((entry) => entry.id === id);
		if (!found) throw new Error(`token ${id} missing`);
		return found;
	};

	it('lists every defined token with its metadata and definition', async () => {
		const data = await run();

		expect(data.tokens.map((entry) => entry.id)).toEqual([
			'color.accent.primary',
			'color.brand.tertiary',
			'color.focus',
			'color.ring',
			'color.text.primary',
			'spacing.md',
		]);
		expect(token(data, 'color.accent.primary')).toMatchObject({
			category: 'color',
			definedAt: 'global',
			description: 'Main interactive accent',
			owner: 'design-system',
		});
		expect(token(data, 'color.brand.tertiary')).toMatchObject({
			status: 'deprecated',
			deprecatedBy: 'color.brand.secondary',
		});
		// A token created by a copy takes the source's metadata
		expect(token(data, 'color.ring')).toMatchObject({ category: 'color', definedAt: 'xbox' });
	});

	it('records which nodes customize or remove each token', async () => {
		const data = await run();

		expect(token(data, 'color.accent.primary').customizedOn).toEqual(['xbox', 'xbox-dark']);
		expect(token(data, 'spacing.md').removedOn).toEqual(['vscode']);
		// The override-policy mixin customizes xbox-dark
		expect(token(data, 'color.text.primary').customizedOn).toEqual(['xbox-dark']);
		expect(data.summary).toMatchObject({ customized: 3, removed: 1 });
	});

	it('matches every query word against id, description and category', async () => {
		expect((await run({ query: 'accent' })).tokens.map((entry) => entry.id)).toEqual([
			'color.accent.primary',
		]);
		expect((await run({ query: 'MAIN interactive' })).tokens.map((entry) => entry.id)).toEqual([
			'color.accent.primary',
		]);
		expect((await run({ query: 'spacing md' })).tokens.map((entry) => entry.id)).toEqual([
			'spacing.md',
		]);
		expect((await run({ query: 'accent spacing' })).total).toBe(0);
	});

	it('filters by category, tier and status', async () => {
		expect((await run({ category: 'spacing' })).tokens.map((entry) => entry.id)).toEqual([
			'spacing.md',
		]);
		expect((await run({ tier: 'global' })).total).toBe(1);
		expect((await run({ status: 'deprecated' })).tokens[0].id).toBe('color.brand.tertiary');
	});

	it('sorts by how often tokens are customized and limits the list', async () => {
		const data = await run({ sort: 'customized', limit: 2 });

		expect(data.tokens.map((entry) => entry.id)).toEqual(['color.accent.primary', 'color.ring']);
		expect(data.total).toBe(6);
		expect(data.summary.categories).toEqual({ color: 5, spacing: 1 });
	});

	it('scopes customization counts to a subtree but keeps inherited definitions', async () => {
		const data = await run({ rootId: 'xbox' });

		expect(token(data, 'spacing.md')).toMatchObject({ definedAt: 'global', removedOn: [] });
		expect(token(data, 'color.accent.primary').customizedOn).toEqual(['xbox', 'xbox-dark']);
		expect(data.tokens.some((entry) => entry.id === 'color.text.primary')).toBe(true);
	});

	it('reports the main hierarchy, not a mixin, as where a token is defined', async () => {
		// "aaa" sorts before "global", so as a root it would be read first
		await nodeCreateCommand.handler({ name: 'aaa-mixin', parentId: null, type: 'shared' }, context);
		await tokenAddCommand.handler(
			{ nodeId: 'aaa-mixin', tokenId: 'spacing.md', value: '20px' },
			context,
		);
		await nodeCreateCommand.handler(
			{ name: 'vscode-hc', parentId: 'vscode', type: 'theme', includes: ['aaa-mixin'] },
			context,
		);

		const data = await run();

		expect(token(data, 'spacing.md').definedAt).toBe('global');
	});

	it('fails for an unknown root', async () => {
		const result = await tokensCatalogCommand.handler({ rootId: 'nope' }, context);
		expect(result.error?.code).toBe('NODE_NOT_FOUND');
	});
});
