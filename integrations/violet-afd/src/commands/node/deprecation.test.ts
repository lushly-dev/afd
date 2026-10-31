import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext } from '../registry.js';
import { nodeCreateCommand } from './create.js';
import { daysUntil } from './deprecation.js';
import { nodeUpdateCommand } from './update.js';

describe('deprecation plans on node.create and node.update (#117)', () => {
	let context: CommandContext;

	beforeEach(async () => {
		context = { db: createMemoryDatabase(), actor: 'test' };
		await nodeCreateCommand.handler({ name: 'root', parentId: null }, context);
		await nodeCreateCommand.handler({ name: 'next', parentId: 'root' }, context);
		await nodeCreateCommand.handler(
			{ name: 'retired', parentId: 'root', status: 'deprecated' },
			context,
		);
	});

	it('stores a sunset date and a replacement without warnings', async () => {
		const result = await nodeCreateCommand.handler(
			{
				name: 'old',
				parentId: 'root',
				status: 'deprecated',
				sunsetAt: '2027-03-31',
				replacedBy: 'next',
			},
			context,
		);
		expect(result.success).toBe(true);
		expect(result.data?.node).toMatchObject({ sunsetAt: '2027-03-31', replacedBy: 'next' });
		expect(result.warnings).toBeUndefined();
	});

	it('warns about a sunset date with no replacement', async () => {
		const result = await nodeCreateCommand.handler(
			{ name: 'old', parentId: 'root', status: 'deprecated', sunsetAt: '2027-03-31' },
			context,
		);
		expect(result.success).toBe(true);
		expect(result.warnings?.map((warning) => warning.code)).toEqual(['SUNSET_WITHOUT_REPLACEMENT']);
	});

	it('warns about a replacement that is itself deprecated', async () => {
		await nodeCreateCommand.handler({ name: 'old', parentId: 'root' }, context);
		const result = await nodeUpdateCommand.handler(
			{ id: 'old', updates: { status: 'deprecated', replacedBy: 'retired' } },
			context,
		);
		expect(result.success).toBe(true);
		expect(result.data?.changedFields).toEqual(['status', 'replacedBy']);
		expect(result.warnings?.map((warning) => warning.code)).toEqual(['REPLACEMENT_DEPRECATED']);
	});

	it('warns when a node other nodes are replaced by is deprecated', async () => {
		await nodeCreateCommand.handler(
			{ name: 'old', parentId: 'root', status: 'deprecated', replacedBy: 'next' },
			context,
		);
		const result = await nodeUpdateCommand.handler(
			{ id: 'next', updates: { status: 'deprecated' } },
			context,
		);
		expect(result.success).toBe(true);
		expect(result.warnings?.[0]).toMatchObject({
			code: 'REPLACEMENT_DEPRECATED',
			details: { replaces: ['old'] },
		});
	});

	it('rejects a missing replacement, a node replacing itself and a date that does not exist', async () => {
		const missing = await nodeCreateCommand.handler(
			{ name: 'old', parentId: 'root', replacedBy: 'nowhere' },
			context,
		);
		expect(missing.error?.code).toBe('NODE_NOT_FOUND');
		expect(await context.db.getNode('old')).toBeNull();

		const itself = await nodeUpdateCommand.handler(
			{ id: 'next', updates: { replacedBy: 'next' } },
			context,
		);
		expect(itself.error?.code).toBe('VALIDATION_ERROR');

		for (const sunsetAt of ['2027-02-30', '31/03/2027', '2027-3-1']) {
			await expect(
				nodeUpdateCommand.handler({ id: 'next', updates: { sunsetAt } }, context),
			).rejects.toThrow();
		}
	});

	it('clears a plan with null and records the change in the audit log', async () => {
		await nodeUpdateCommand.handler(
			{ id: 'retired', updates: { sunsetAt: '2027-01-01', replacedBy: 'next' } },
			context,
		);
		const cleared = await nodeUpdateCommand.handler(
			{ id: 'retired', updates: { sunsetAt: null, replacedBy: null } },
			context,
		);
		expect(cleared.data?.changedFields).toEqual(['sunsetAt', 'replacedBy']);
		expect(cleared.data?.node.sunsetAt).toBeUndefined();

		const events = await context.db.getAuditEvents({ targetNode: 'retired' });
		const updates = events.filter((event) => event.eventType === 'node_updated');
		expect(updates.map((event) => JSON.parse(event.metadata ?? '{}').changedFields)).toEqual([
			['sunsetAt', 'replacedBy'],
			['sunsetAt', 'replacedBy'],
		]);

		const again = await nodeUpdateCommand.handler(
			{ id: 'retired', updates: { sunsetAt: null } },
			context,
		);
		expect(again.data?.changedFields).toEqual([]);
	});

	it('counts whole days to a sunset, negative once passed', () => {
		const now = Date.parse('2026-10-28T23:30:00Z');
		expect(daysUntil('2026-10-28', now)).toBe(0);
		expect(daysUntil('2026-11-04', now)).toBe(7);
		expect(daysUntil('2026-10-01', now)).toBe(-27);
	});
});
