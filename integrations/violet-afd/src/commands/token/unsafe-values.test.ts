/**
 * @fileoverview Values a token's type cannot hold safely are refused on write, on
 * import and in the CSS and SCSS exports (#1325)
 */

import { createMemoryDatabase, initializeExport } from '@lushly-dev/violet-core/engine';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { exportCommand } from '../export/export.js';
import { importJsonCommand } from '../import/json.js';
import { importTreeCommand } from '../import/tree.js';
import { nodeCreateCommand } from '../node/create.js';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from './add.js';
import { tokenOverrideCommand } from './override.js';

const INJECTION = '#121214; background: url(https://evil.example/x.png)';

describe('unsafe token values (#1325)', () => {
	let context: CommandContext;

	beforeAll(() => {
		initializeExport();
	});

	beforeEach(async () => {
		context = { db: createMemoryDatabase(), actor: 'test' };
		await nodeCreateCommand.handler({ name: 'base', type: 'root', parentId: null }, context);
		await nodeCreateCommand.handler({ name: 'dark', type: 'theme', parentId: 'base' }, context);
		await tokenAddCommand.handler(
			{
				nodeId: 'base',
				tokenId: 'color.page',
				value: '#ffffff',
				metadata: { type: 'color', category: 'color' },
			},
			context,
		);
	});

	/** Write an operation straight to the store, as a database made before #1325 holds one */
	const storeUnchecked = async (nodeId: string, tokenId: string, value: string) => {
		const ops = await context.db.getOperations(nodeId);
		await context.db.addOperation({
			id: `unchecked-${tokenId}`,
			nodeId,
			sequence: ops.length + 1,
			type: 'override',
			tokenId,
			value: JSON.stringify(value),
			metadata: null,
			fromNode: null,
			asTokenId: null,
			toAncestor: null,
			reason: null,
			author: null,
			createdAt: '2026-01-01T00:00:00.000Z',
		});
	};

	describe('on write', () => {
		it('token.add refuses a value that would leave its declaration', async () => {
			const result = await tokenAddCommand.handler(
				{ nodeId: 'base', tokenId: 'color.text', value: INJECTION },
				context,
			);
			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('INVALID_TOKEN_VALUE');
			expect(result.error?.message).toContain("'color.text'");
			expect(result.error?.suggestion).toBeTruthy();
			expect((await context.db.getOperations('base')).map((op) => op.tokenId)).toEqual([
				'color.page',
			]);
		});

		it.each([
			' {x</style><script>alert(1)</script>}',
			' {x;color:red}',
			{ ref: '</style><script>alert(2)</script>', note: 1 },
		])('token.add refuses %j, which the resolver would write out as it is', async (value) => {
			const result = await tokenAddCommand.handler(
				{ nodeId: 'base', tokenId: 'color.lead', value, metadata: { type: 'color' } },
				context,
			);
			expect(result.error?.code).toBe('INVALID_TOKEN_VALUE');
		});

		it('token.add holds a typed token to its kind', async () => {
			const refused = await tokenAddCommand.handler(
				{
					nodeId: 'base',
					tokenId: 'size.gap',
					value: 'wide',
					metadata: { type: 'dimension' },
				},
				context,
			);
			expect(refused.error?.code).toBe('INVALID_TOKEN_VALUE');
			expect(refused.error?.message).toContain('is not one length');

			const accepted = await tokenAddCommand.handler(
				{ nodeId: 'base', tokenId: 'size.gap', value: '8px', metadata: { type: 'dimension' } },
				context,
			);
			expect(accepted.success).toBe(true);
		});

		it('token.override holds the value to the type of the token it overrides', async () => {
			const refused = await tokenOverrideCommand.handler(
				{ nodeId: 'dark', tokenId: 'color.page', value: '12px' },
				context,
			);
			expect(refused.error?.code).toBe('INVALID_TOKEN_VALUE');
			expect(refused.error?.message).toContain('colour');

			const injection = await tokenOverrideCommand.handler(
				{ nodeId: 'dark', tokenId: 'color.page', value: INJECTION },
				context,
			);
			expect(injection.error?.code).toBe('INVALID_TOKEN_VALUE');
			expect(await context.db.getOperations('dark')).toEqual([]);

			const accepted = await tokenOverrideCommand.handler(
				{ nodeId: 'dark', tokenId: 'color.page', value: '#121214' },
				context,
			);
			expect(accepted.success).toBe(true);
		});
	});

	describe('on import', () => {
		it('import.json refuses the whole file, writing nothing', async () => {
			const result = await importJsonCommand.handler(
				{
					targetNode: 'dark',
					content: JSON.stringify({
						color: {
							$type: 'color',
							ok: { $value: '#000000' },
							bad: { $value: INJECTION },
						},
					}),
				},
				context,
			);
			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('INVALID_TOKEN_VALUE');
			expect(result.error?.message).toContain("'color.bad'");
			expect(await context.db.getOperations('dark')).toEqual([]);
		});

		it('import.json holds an untyped override to the inherited type', async () => {
			const result = await importJsonCommand.handler(
				{
					targetNode: 'dark',
					content: JSON.stringify({ color: { page: { $value: '4px' } } }),
				},
				context,
			);
			expect(result.error?.code).toBe('INVALID_TOKEN_VALUE');
			expect(result.error?.message).toContain('colour');
		});

		it('import.tree checks every file before it creates a node', async () => {
			const db = createMemoryDatabase();
			const result = await importTreeCommand.handler(
				{
					files: [
						{
							name: 'base.tokens.json',
							content: JSON.stringify({ color: { $type: 'color', bg: { $value: '#ffffff' } } }),
						},
						{
							name: 'dark.tokens.json',
							content: JSON.stringify({
								$extensions: { 'dev.lushly.violet': { parent: 'base', type: 'theme' } },
								// Untyped here; the base file types it as a colour
								color: { bg: { $value: '3px' } },
							}),
						},
					],
				},
				{ db, actor: 'test' },
			);
			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('INVALID_TOKEN_VALUE');
			expect(result.error?.message).toContain('dark.tokens.json');
			expect(result.error?.message).toContain('no node was created');
			expect(await db.listNodes()).toEqual([]);
		});

		it('import.tree takes the type of a stored parent for a file that names it', async () => {
			const result = await importTreeCommand.handler(
				{
					files: [
						{
							name: 'night.tokens.json',
							content: JSON.stringify({
								$extensions: { 'dev.lushly.violet': { parent: 'base', type: 'theme' } },
								color: { page: { $value: '4px' } },
							}),
						},
					],
				},
				context,
			);
			expect(result.error?.code).toBe('INVALID_TOKEN_VALUE');
			expect(await context.db.getNode('night')).toBeNull();
		});
	});

	describe('in the export, for values stored before the checks', () => {
		beforeEach(async () => {
			await storeUnchecked('dark', 'color.page', INJECTION);
		});

		it.each(['css', 'scss'] as const)('refuses a %s export, naming each token', async (format) => {
			const result = await exportCommand.handler({ nodeId: 'dark', format }, context);
			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('INVALID_TOKEN_VALUE');
			expect(result.error?.message).toContain("'color.page'");
			expect(result.error?.suggestion).toContain('token.override');
		});

		it('still exports formats that escape their strings', async () => {
			const result = await exportCommand.handler({ nodeId: 'dark', format: 'json' }, context);
			expect(result.success).toBe(true);
		});

		it('exports the CSS once the filter leaves the token out', async () => {
			await tokenAddCommand.handler({ nodeId: 'base', tokenId: 'size.gap', value: '8px' }, context);
			const result = await exportCommand.handler(
				{ nodeId: 'dark', format: 'css', filter: 'size.*' },
				context,
			);
			expect(result.success).toBe(true);
			expect(result.data?.content).toContain('--size-gap: 8px;');
		});
	});

	describe('the type an import holds a value to', () => {
		it('import.json holds a merge onto a local typed token to that type', async () => {
			const result = await importJsonCommand.handler(
				{
					targetNode: 'base',
					merge: true,
					content: JSON.stringify({ color: { page: { $type: 'dimension', $value: '8px' } } }),
				},
				context,
			);
			expect(result.error?.code).toBe('INVALID_TOKEN_VALUE');
			expect(result.error?.message).toContain('colour');
		});

		it('import.tree holds a child that retypes an inherited token to the parent type', async () => {
			const db = createMemoryDatabase();
			const result = await importTreeCommand.handler(
				{
					files: [
						{
							name: 'base.tokens.json',
							content: JSON.stringify({ color: { $type: 'color', bg: { $value: '#ffffff' } } }),
						},
						{
							name: 'dark.tokens.json',
							content: JSON.stringify({
								$extensions: { 'dev.lushly.violet': { parent: 'base' } },
								color: { bg: { $type: 'dimension', $value: '8px' } },
							}),
						},
					],
				},
				{ db, actor: 'test' },
			);
			expect(result.error?.code).toBe('INVALID_TOKEN_VALUE');
			expect(await db.listNodes()).toEqual([]);
		});

		it('import.tree refuses a node that already exists before it creates any', async () => {
			const result = await importTreeCommand.handler(
				{
					files: [
						{ name: 'fresh.tokens.json', content: '{}' },
						{ name: 'dark.tokens.json', content: '{}' },
					],
				},
				context,
			);
			expect(result.error?.code).toBe('NODE_ALREADY_EXISTS');
			expect(result.error?.suggestion).toContain('node.delete');
			expect(await context.db.getNode('fresh')).toBeNull();
		});
	});

	describe('in the CSS export', () => {
		it('writes a composite as JSON, as before, once its keys and leaves are safe', async () => {
			await tokenAddCommand.handler(
				{
					nodeId: 'base',
					tokenId: 'type.body',
					value: { fontFamily: 'Inter', fontSize: '16px', fontWeight: 600 },
					metadata: { type: 'typography' },
				},
				context,
			);
			const result = await exportCommand.handler({ nodeId: 'base', format: 'css' }, context);
			expect(result.success).toBe(true);
			expect(result.data?.content).toContain('--type-body: {"fontFamily":"Inter"');
		});

		it('refuses a token id that cannot be a CSS name', async () => {
			await importTreeCommand.handler(
				{
					files: [
						{
							name: 'evil.tokens.json',
							content: JSON.stringify({ 'a;}body{background:red}x{--b': { $value: '#ffffff' } }),
						},
					],
				},
				context,
			);
			const result = await exportCommand.handler({ nodeId: 'evil', format: 'css' }, context);
			expect(result.error?.code).toBe('INVALID_TOKEN_VALUE');
			expect(result.error?.message).toContain('its id cannot be a CSS name');
		});
	});
});
