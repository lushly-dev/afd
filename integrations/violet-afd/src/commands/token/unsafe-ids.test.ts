/**
 * @fileoverview Token ids that cannot become safe CSS names are refused where they
 * enter (token.add, token.override, token.copy, import.json, import.tree,
 * import.validate), and stores holding legacy ids still fail closed at CSS/SCSS
 * and export.tree while allowing removal or copy-rename (#1957)
 */

import { createMemoryDatabase, initializeExport } from '@lushly-dev/violet-core/engine';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { exportCommand } from '../export/export.js';
import { exportTreeCommand } from '../export/tree.js';
import { importJsonCommand } from '../import/json.js';
import { importTreeCommand } from '../import/tree.js';
import { importValidateCommand } from '../import/validate.js';
import { nodeCreateCommand } from '../node/create.js';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from './add.js';
import { tokenCopyCommand } from './copy.js';
import { tokenOverrideCommand } from './override.js';
import { tokenRemoveCommand } from './remove.js';
import { tokensResolveCommand } from './resolve.js';

const EVIL_ID = 'a;}body{background:red}x{--b';

describe('unsafe token ids (#1957)', () => {
	let context: CommandContext;

	beforeAll(() => {
		initializeExport();
	});

	beforeEach(async () => {
		context = { db: createMemoryDatabase(), actor: 'test' };
		await nodeCreateCommand.handler({ name: 'base', type: 'root', parentId: null }, context);
		await nodeCreateCommand.handler({ name: 'dark', type: 'theme', parentId: 'base' }, context);
		await tokenAddCommand.handler(
			{ nodeId: 'base', tokenId: 'color.page', value: '#ffffff', metadata: { type: 'color' } },
			context,
		);
	});

	describe('on write', () => {
		it.each([EVIL_ID, 'color bg', 'color.$bad', '.leading', 'trailing.', 'double..dot'])(
			'token.add refuses %j with VALIDATION_ERROR and a suggestion',
			async (tokenId) => {
				const result = await tokenAddCommand.handler(
					{ nodeId: 'base', tokenId, value: '#ffffff' },
					context,
				);
				expect(result.success).toBe(false);
				expect(result.error?.code).toBe('VALIDATION_ERROR');
				expect(result.error?.suggestion).toBeTruthy();
				expect((await context.db.getOperations('base')).map((op) => op.tokenId)).toEqual([
					'color.page',
				]);
			},
		);

		it('token.override refuses an unsafe token id with VALIDATION_ERROR and a suggestion', async () => {
			const result = await tokenOverrideCommand.handler(
				{ nodeId: 'dark', tokenId: EVIL_ID, value: '#000000' },
				context,
			);
			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('VALIDATION_ERROR');
			expect(result.error?.suggestion).toBeTruthy();
			expect(await context.db.getOperations('dark')).toEqual([]);
		});

		it('token.copy refuses an unsafe target id (tokenId or asTokenId)', async () => {
			const renamed = await tokenCopyCommand.handler(
				{ nodeId: 'dark', fromNode: 'base', tokenId: 'color.page', asTokenId: EVIL_ID },
				context,
			);
			expect(renamed.success).toBe(false);
			expect(renamed.error?.code).toBe('VALIDATION_ERROR');
			expect(renamed.error?.suggestion).toBeTruthy();

			const unrenamed = await tokenCopyCommand.handler(
				{ nodeId: 'dark', fromNode: 'base', tokenId: EVIL_ID },
				context,
			);
			expect(unrenamed.success).toBe(false);
			expect(unrenamed.error?.code).toBe('VALIDATION_ERROR');

			const emptyRename = await tokenCopyCommand.handler(
				{ nodeId: 'dark', fromNode: 'base', tokenId: 'color.page', asTokenId: '' },
				context,
			);
			expect(emptyRename.success).toBe(false);
			expect(emptyRename.error?.code).toBe('VALIDATION_ERROR');
			expect(emptyRename.error?.suggestion).toBeTruthy();
			expect(await context.db.getOperations('dark')).toEqual([]);
		});
	});

	describe('on import', () => {
		it('import.json refuses the whole file with VALIDATION_ERROR and writes nothing', async () => {
			const result = await importJsonCommand.handler(
				{
					targetNode: 'dark',
					content: JSON.stringify({
						color: { ok: { $value: '#000000' } },
						[EVIL_ID]: { $value: '#ffffff' },
					}),
				},
				context,
			);
			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('VALIDATION_ERROR');
			expect(result.error?.message).toContain(EVIL_ID);
			expect(result.error?.suggestion).toBeTruthy();
			expect(await context.db.getOperations('dark')).toEqual([]);
		});

		it('import.json with tiers: true refuses a top-level __proto__ group and writes nothing', async () => {
			const content =
				'{"__proto__": {"polluted": {"$value": "#ffffff"}}, "global": {"color": {"ok": {"$value": "#000000"}}}}';
			const result = await importJsonCommand.handler(
				{ targetNode: 'dark', content, tiers: true },
				context,
			);
			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('VALIDATION_ERROR');
			expect(result.error?.message).toContain('__proto__.polluted');
			expect(await context.db.getOperations('dark')).toEqual([]);
		});

		it('import.json fails closed when a legacy Database adapter lacks appendOperation', async () => {
			const baseDb = createMemoryDatabase();
			const legacyDb = Object.create(baseDb);
			legacyDb.appendOperation = undefined;
			const legacyCtx: CommandContext = { db: legacyDb, actor: 'test' };
			await nodeCreateCommand.handler({ name: 'base', type: 'root', parentId: null }, legacyCtx);

			const result = await importJsonCommand.handler(
				{
					targetNode: 'base',
					content: JSON.stringify({ color: { ok: { $value: '#000000' } } }),
				},
				legacyCtx,
			);
			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('INTERNAL_ERROR');
			expect(result.error?.message).toContain('appendOperation');
			expect(result.error?.suggestion).toContain('appendOperation');
		});

		it('import.tree refuses untrusted files before creating any node', async () => {
			const db = createMemoryDatabase();
			const result = await importTreeCommand.handler(
				{
					files: [
						{
							name: 'base.tokens.json',
							content: JSON.stringify({ color: { bg: { $value: '#ffffff' } } }),
						},
						{
							name: 'evil.tokens.json',
							content: JSON.stringify({
								$extensions: { 'dev.lushly.violet': { parent: 'base', type: 'theme' } },
								[EVIL_ID]: { $value: '#ffffff' },
							}),
						},
					],
				},
				{ db, actor: 'test' },
			);
			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('VALIDATION_ERROR');
			expect(result.error?.message).toContain('evil.tokens.json');
			expect(result.error?.suggestion).toBeTruthy();
			expect(await db.listNodes()).toEqual([]);
		});

		it('import.tree with tiers: true refuses a top-level __proto__ group before creating any node', async () => {
			const db = createMemoryDatabase();
			const result = await importTreeCommand.handler(
				{
					files: [
						{
							name: 'tiered.tokens.json',
							content:
								'{"$extensions": {"dev.lushly.violet": {"tiers": true}}, "__proto__": {"polluted": {"$value": "#ffffff"}}, "global": {"color": {"ok": {"$value": "#000000"}}}}',
						},
					],
				},
				{ db, actor: 'test' },
			);
			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('VALIDATION_ERROR');
			expect(result.error?.message).toContain('__proto__.polluted');
			expect(await db.listNodes()).toEqual([]);
		});

		it('import.validate reports unsafe token ids as errors', async () => {
			const result = await importValidateCommand.handler(
				{
					targetNode: 'dark',
					content: JSON.stringify({ [EVIL_ID]: { $value: '#ffffff' } }),
				},
				context,
			);
			expect(result.success).toBe(true);
			expect(result.data?.valid).toBe(false);
			expect(result.data?.errors.some((e) => e.tokenId === EVIL_ID)).toBe(true);
		});
	});

	describe('existing stores holding a legacy unsafe id', () => {
		beforeEach(async () => {
			await context.db.addOperation({
				id: 'legacy-evil',
				nodeId: 'dark',
				sequence: 1,
				type: 'add',
				tokenId: EVIL_ID,
				value: JSON.stringify('#ffffff'),
				metadata: null,
				fromNode: null,
				asTokenId: null,
				toAncestor: null,
				reason: null,
				author: null,
				createdAt: '2026-01-01T00:00:00.000Z',
			});
		});

		it.each(['css', 'scss'] as const)('still refuses %s export', async (format) => {
			const result = await exportCommand.handler({ nodeId: 'dark', format }, context);
			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('INVALID_TOKEN_VALUE');
			expect(result.error?.message).toContain('its id cannot be a CSS name');
		});

		it.each(['css', 'scss'] as const)(
			'refuses %s export for a legacy empty-segment id such as space..m',
			async (format) => {
				await nodeCreateCommand.handler({ name: 'gaps', type: 'root', parentId: null }, context);
				await context.db.addOperation({
					id: 'legacy-empty-seg',
					nodeId: 'gaps',
					sequence: 1,
					type: 'add',
					tokenId: 'space..m',
					value: JSON.stringify('8px'),
					metadata: null,
					fromNode: null,
					asTokenId: null,
					toAncestor: null,
					reason: null,
					author: null,
					createdAt: '2026-01-01T00:00:00.000Z',
				});
				const result = await exportCommand.handler({ nodeId: 'gaps', format }, context);
				expect(result.success).toBe(false);
				expect(result.error?.code).toBe('INVALID_TOKEN_VALUE');
				expect(result.error?.message).toContain('its id cannot be a CSS name');
			},
		);

		it('refuses export.tree so it never writes files import.tree would reject', async () => {
			const result = await exportTreeCommand.handler({}, context);
			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('OPERATION_NOT_ALLOWED');
			expect(result.error?.message).toContain(EVIL_ID);
			expect(result.error?.suggestion).toContain('token.copy');
			expect(result.error?.suggestion).toContain('token.remove');
		});

		it('allows inspecting, copying to a safe id, and removing the legacy operation', async () => {
			const resolved = await tokensResolveCommand.handler({ nodeId: 'dark' }, context);
			const legacy = resolved.data?.tokens.find((t) => t.id === EVIL_ID);
			expect(legacy?.resolvedValue).toBe('#ffffff');

			await nodeCreateCommand.handler({ name: 'clean', type: 'product', parentId: null }, context);
			const copied = await tokenCopyCommand.handler(
				{ nodeId: 'clean', fromNode: 'dark', tokenId: EVIL_ID, asTokenId: 'color.migrated' },
				context,
			);
			expect(copied.success).toBe(true);

			// Remove the dependent copy, then remove the legacy operation cleanly without force
			await tokenRemoveCommand.handler({ nodeId: 'clean', tokenId: 'color.migrated' }, context);
			const removed = await tokenRemoveCommand.handler(
				{ nodeId: 'dark', tokenId: EVIL_ID },
				context,
			);
			expect(removed.success).toBe(true);
			expect(await context.db.getOperations('dark')).toEqual([]);
		});
	});
});
