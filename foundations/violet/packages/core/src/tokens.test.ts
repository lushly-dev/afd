/**
 * Native resolution and export with no command registry or AFD envelope: nodes and operations
 * are written straight to the in-memory store.
 */
import { describe, expect, it } from 'vitest';
import { createMemoryDatabase } from './db/memory.js';
import type { Database } from './storage.js';
import { EXPORT_FORMATS, TokenDomainError, exportTokens, resolveTokens } from './tokens.js';
import { ErrorCodes } from './types/error-codes.js';
import { NodeSchema } from './types/node.js';
import type { OperationRecord } from './types/operation.js';

const NOW = '2026-10-29T00:00:00.000Z';

function store() {
	const db = createMemoryDatabase();
	let sequence = 0;
	const node = (id: string, parentId: string | null, extra: Record<string, unknown> = {}) =>
		db.createNode(
			NodeSchema.parse({
				id,
				name: id,
				parentId,
				type: parentId ? 'theme' : 'root',
				createdAt: NOW,
				updatedAt: NOW,
				...extra,
			}),
		);
	const op = (
		nodeId: string,
		type: OperationRecord['type'],
		tokenId: string,
		fields: Partial<OperationRecord> = {},
	) => {
		sequence++;
		return db.addOperation({
			id: `op-${sequence}`,
			nodeId,
			sequence,
			type,
			tokenId,
			value: null,
			metadata: null,
			fromNode: null,
			asTokenId: null,
			toAncestor: null,
			reason: null,
			author: 'native-test',
			createdAt: NOW,
			...fields,
		});
	};
	return { db, node, op };
}

async function brand(): Promise<Database> {
	const { db, node, op } = store();
	await node('base', null);
	await node('dark', 'base');
	const color = JSON.stringify({ category: 'color' });
	const spacing = JSON.stringify({ category: 'spacing' });
	await op('base', 'add', 'color.brand', { value: JSON.stringify('#352064'), metadata: color });
	await op('base', 'add', 'color.surface', { value: JSON.stringify('#ffffff'), metadata: color });
	await op('base', 'add', 'color.action', {
		value: JSON.stringify('{color.brand}'),
		metadata: color,
	});
	await op('base', 'add', 'spacing.md', { value: JSON.stringify('12px'), metadata: spacing });
	await op('base', 'add', 'legacy.gap', { value: JSON.stringify('4px'), metadata: spacing });
	await op('dark', 'override', 'color.surface', { value: JSON.stringify('#111111') });
	await op('dark', 'subtract', 'legacy.gap');
	return db;
}

describe('resolveTokens', () => {
	it('applies inheritance, overrides, subtractions and aliases', async () => {
		const db = await brand();
		const { ancestryChain, tokens } = await resolveTokens(db, 'dark');
		expect(ancestryChain).toEqual(['base']);
		const byId = Object.fromEntries(tokens.map((token) => [token.id, token]));
		expect(Object.keys(byId).sort()).toEqual([
			'color.action',
			'color.brand',
			'color.surface',
			'spacing.md',
		]);
		expect(byId['color.surface']?.resolvedValue).toBe('#111111');
		expect(byId['color.action']).toMatchObject({
			resolvedValue: '#352064',
			aliasOf: 'color.brand',
		});
		expect(byId['color.brand']?.resolvedAt).toBe('base');
	});

	it('filters by glob and keeps lineage on request', async () => {
		const db = await brand();
		const { tokens } = await resolveTokens(db, 'dark', { filter: 'color.*', includeLineage: true });
		expect(tokens.map((token) => token.id).sort()).toEqual([
			'color.action',
			'color.brand',
			'color.surface',
		]);
		expect(tokens.find((token) => token.id === 'color.surface')?.operationHistory?.length).toBe(2);
	});

	it('reports missing and deleted nodes with the command codes', async () => {
		const { db, node } = store();
		await expect(resolveTokens(db, 'nope')).rejects.toMatchObject({
			code: ErrorCodes.NODE_NOT_FOUND,
			message: "Node 'nope' not found",
			suggestion: "Use 'node.list' to see available nodes",
		});
		await node('gone', null, { deletedAt: NOW });
		const error = await resolveTokens(db, 'gone').catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(TokenDomainError);
		expect(error).toMatchObject({ code: 'NODE_NOT_FOUND', suggestion: undefined });
	});

	it('turns include cycles into CIRCULAR_REFERENCE', async () => {
		const { db, node } = store();
		await node('a', null, { includes: ['b'] });
		await node('b', null, { includes: ['a'] });
		await expect(resolveTokens(db, 'a')).rejects.toMatchObject({
			code: ErrorCodes.CIRCULAR_REFERENCE,
		});
	});
});

describe('exportTokens', () => {
	it.each(EXPORT_FORMATS.filter((format) => format !== 'lua'))(
		'renders %s without a command layer',
		async (format) => {
			const db = await brand();
			const result = await exportTokens(db, 'dark', { format });
			expect(result).toMatchObject({ format, nodeId: 'dark', tokenCount: 4 });
			expect(result.content.length).toBeGreaterThan(0);
			expect(result.content).not.toContain('legacy');
		},
	);

	it('emits CSS custom properties for plain HTML, with aliases as var() on request', async () => {
		const db = await brand();
		const { content } = await exportTokens(db, 'dark', { format: 'css', filter: 'color.*' });
		expect(content).toContain(':root');
		expect(content).toMatch(/--color-surface:\s*#111111/);
		expect(content).toMatch(/--color-action:\s*#352064/);
		const references = await exportTokens(db, 'dark', { format: 'css', outputReferences: true });
		expect(references.content).toMatch(/--color-action:\s*var\(--color-brand\)/);
	});

	it('rejects unknown formats, misplaced options and broken references', async () => {
		const db = await brand();
		await expect(exportTokens(db, 'dark', { format: 'yaml' })).rejects.toMatchObject({
			code: ErrorCodes.VALIDATION_ERROR,
		});
		await expect(
			exportTokens(db, 'dark', { format: 'json', outputReferences: true }),
		).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR });
		await expect(exportTokens(db, 'missing', { format: 'css' })).rejects.toMatchObject({
			code: ErrorCodes.NODE_NOT_FOUND,
		});
		const { db: broken, node, op } = store();
		await node('base', null);
		await op('base', 'add', 'color.action', { value: JSON.stringify('{color.nowhere}') });
		await expect(exportTokens(broken, 'base', { format: 'css' })).rejects.toMatchObject({
			code: 'TOKEN_REFERENCE_NOT_FOUND',
		});
		expect((await resolveTokens(broken, 'base')).tokens[0]?.referenceError?.code).toBe(
			'TOKEN_REFERENCE_NOT_FOUND',
		);
	});
});
