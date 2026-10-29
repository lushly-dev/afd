import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { nodeCreateCommand } from '../node/create.js';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from './add.js';
import { tokensCompareCommand } from './compare.js';
import { tokenOverrideCommand } from './override.js';
import { tokenSubtractCommand } from './subtract.js';

describe('tokens.compare command', () => {
	let context: CommandContext;

	beforeEach(async () => {
		context = { db: createMemoryDatabase(), actor: 'test', traceId: 'test-trace' };
		// global -> xbox -> xbox-dark, global -> vscode -> vscode-dark
		type NodeType = Parameters<typeof nodeCreateCommand.handler>[0]['type'];
		const create = (name: string, type: NodeType, parentId: string | null) =>
			nodeCreateCommand.handler({ name, type, parentId }, context);
		await create('global', 'root', null);
		await create('xbox', 'product', 'global');
		await create('xbox-dark', 'theme', 'xbox');
		await create('vscode', 'product', 'global');
		await create('vscode-dark', 'theme', 'vscode');

		type Category = 'color' | 'spacing' | 'radius';
		const add = (tokenId: string, value: string, category: Category) =>
			tokenAddCommand.handler(
				{ nodeId: 'global', tokenId, value, metadata: { category } },
				context,
			);
		await add('color.surface', '#FFFFFF', 'color');
		await add('color.brand', '#0078D4', 'color');
		await add('spacing.md', '16px', 'spacing');
		await add('radius.md', '6px', 'radius');

		const override = (nodeId: string, tokenId: string, value: string) =>
			tokenOverrideCommand.handler({ nodeId, tokenId, value }, context);
		await override('xbox-dark', 'color.surface', '#101010');
		await override('vscode-dark', 'color.surface', '#1E1E1E');
		await override('xbox', 'radius.md', '10px');
		await tokenSubtractCommand.handler({ nodeId: 'vscode', tokenId: 'spacing.md' }, context);
	});

	const run = async (input: Parameters<typeof tokensCompareCommand.handler>[0]) => {
		const result = await tokensCompareCommand.handler(input, context);
		expect(result.success, JSON.stringify(result.error)).toBe(true);
		if (!result.data) throw new Error('expected data');
		return result.data;
	};

	it('returns only the tokens that differ, with each node side by side', async () => {
		const data = await run({ nodeIds: ['xbox-dark', 'vscode-dark'] });
		expect(data.baseline).toBe('xbox-dark');
		expect(data.nodes.map((node) => node.id)).toEqual(['xbox-dark', 'vscode-dark']);
		expect(data.tokens.map((token) => token.id)).toEqual([
			'color.surface',
			'radius.md',
			'spacing.md',
		]);
		const surface = data.tokens[0];
		expect(surface.differs).toBe(true);
		expect(surface.cells['xbox-dark']).toMatchObject({
			resolvedValue: '#101010',
			state: 'override',
			differs: false,
		});
		expect(surface.cells['vscode-dark']).toMatchObject({ resolvedValue: '#1E1E1E', differs: true });
	});

	it('counts a token missing on one node as a difference', async () => {
		const data = await run({ nodeIds: ['xbox-dark', 'vscode-dark'], filter: 'spacing.*' });
		expect(data.tokens).toHaveLength(1);
		expect(data.tokens[0].cells['vscode-dark']).toMatchObject({
			state: 'absent',
			source: 'vscode',
			differs: true,
		});
	});

	it('keeps equal tokens with onlyDifferent false and summarizes every compared token', async () => {
		const data = await run({ nodeIds: ['xbox-dark', 'vscode-dark'], onlyDifferent: false });
		expect(data.tokens).toHaveLength(4);
		const brand = data.tokens.find((token) => token.id === 'color.brand');
		expect(brand?.differs).toBe(false);
		expect(data.summary).toMatchObject({ compared: 4, different: 3, identical: 1 });
		expect(data.summary.categories).toEqual([
			{ id: 'color', compared: 2, different: 1 },
			{ id: 'spacing', compared: 1, different: 1 },
			{ id: 'radius', compared: 1, different: 1 },
		]);
		expect(data.summary.pairs).toEqual([
			{ nodes: ['xbox-dark', 'vscode-dark'], different: 3, similarity: 25 },
		]);
	});

	it('compares up to four nodes and reports every pair', async () => {
		const data = await run({
			nodeIds: ['global', 'xbox', 'xbox-dark', 'vscode-dark'],
			category: 'color',
		});
		expect(data.tokens.map((token) => token.id)).toEqual(['color.surface']);
		const surface = data.tokens[0];
		expect(surface.cells.xbox.differs).toBe(false);
		expect(surface.cells['xbox-dark'].differs).toBe(true);
		expect(data.summary.pairs).toHaveLength(6);
		expect(data.summary.pairs.find((pair) => pair.nodes.join() === 'global,xbox')).toMatchObject({
			different: 0,
			similarity: 100,
		});
	});

	it('rejects too few, too many, repeated and unknown nodes', async () => {
		await expect(tokensCompareCommand.handler({ nodeIds: ['xbox'] }, context)).rejects.toThrow();
		await expect(
			tokensCompareCommand.handler({ nodeIds: ['a', 'b', 'c', 'd', 'e'] }, context),
		).rejects.toThrow();
		const repeated = await tokensCompareCommand.handler({ nodeIds: ['xbox', 'xbox'] }, context);
		expect(repeated.error?.code).toBe('VALIDATION_ERROR');
		const missing = await tokensCompareCommand.handler({ nodeIds: ['xbox', 'nope'] }, context);
		expect(missing.error?.code).toBe('NODE_NOT_FOUND');
	});
});
