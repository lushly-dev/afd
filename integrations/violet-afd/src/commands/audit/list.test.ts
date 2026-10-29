import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import type { AuditEvent } from '@lushly-dev/violet-core/types';
import { beforeEach, describe, expect, it } from 'vitest';
import { nodeCreateCommand } from '../node/create.js';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from '../token/add.js';
import { tokenOverrideCommand } from '../token/override.js';
import { auditListCommand, parseAuditTime } from './list.js';

async function list(context: CommandContext, input = {}) {
	const result = await auditListCommand.handler(input, context);
	if (!result.success || !result.data) throw new Error(result.error?.message);
	return result.data;
}

describe('parseAuditTime', () => {
	const now = Date.parse('2026-10-27T12:00:00.000Z');

	it('reads spans back from now', () => {
		expect(parseAuditTime('30d', now)).toBe('2026-09-27T12:00:00.000Z');
		expect(parseAuditTime('12h', now)).toBe('2026-10-27T00:00:00.000Z');
		expect(parseAuditTime('2W', now)).toBe('2026-10-13T12:00:00.000Z');
	});

	it('reads dates and times, and rejects anything else', () => {
		expect(parseAuditTime('2026-10-01', now)).toBe('2026-10-01T00:00:00.000Z');
		expect(parseAuditTime('2026-10-01T09:30:00+02:00', now)).toBe('2026-10-01T07:30:00.000Z');
		expect(parseAuditTime('last week', now)).toBeNull();
		expect(parseAuditTime('30x', now)).toBeNull();
	});
});

describe('audit.list command', () => {
	let context: CommandContext;

	beforeEach(async () => {
		context = { db: createMemoryDatabase(), actor: 'alice', traceId: 'test-trace' };
		await nodeCreateCommand.handler({ name: 'global', parentId: null, type: 'root' }, context);
		await nodeCreateCommand.handler({ name: 'xbox', parentId: 'global', type: 'product' }, context);
		await nodeCreateCommand.handler(
			{ name: 'xbox-dark', parentId: 'xbox', type: 'theme' },
			context,
		);
		await tokenAddCommand.handler(
			{ nodeId: 'global', tokenId: 'color.primary', value: '#0066CC' },
			context,
		);
		const bob = { ...context, actor: 'bob' };
		await tokenOverrideCommand.handler(
			{ nodeId: 'xbox', tokenId: 'color.primary', value: '#107C10', reason: 'brand' },
			bob,
		);
		await tokenOverrideCommand.handler(
			{ nodeId: 'xbox-dark', tokenId: 'color.primary', value: '#52B043' },
			bob,
		);
	});

	it('lists every event newest first with values parsed', async () => {
		const data = await list(context);

		expect(data.summary.total).toBe(6);
		expect(data.summary.byType).toEqual({ node_created: 3, token_created: 1, token_updated: 2 });
		// Events written in the same millisecond keep the order they were written in
		expect(data.events.map((event) => `${event.eventType} ${event.targetNode}`)).toEqual([
			'token_updated xbox-dark',
			'token_updated xbox',
			'token_created global',
			'node_created xbox-dark',
			'node_created xbox',
			'node_created global',
		]);
		expect(data.events[0]).toMatchObject({
			actor: 'bob',
			targetToken: 'color.primary',
			oldValue: '#107C10',
			newValue: '#52B043',
			metadata: { oldValueFrom: 'xbox', inherited: true },
		});
		// A first override records the value it replaced, inherited from global
		expect(data.events[1]).toMatchObject({
			oldValue: '#0066CC',
			newValue: '#107C10',
			metadata: { reason: 'brand', oldValueFrom: 'global', inherited: true },
		});
		expect(data.page).toEqual({ offset: 0, limit: 50, returned: 6, nextOffset: null });
	});

	it('filters by node, optionally with its subtree', async () => {
		const own = await list(context, { nodeId: 'xbox' });
		expect(own.events.map((event) => event.eventType).sort()).toEqual([
			'node_created',
			'token_updated',
		]);

		const subtree = await list(context, { nodeId: 'xbox', subtree: true });
		expect(subtree.summary.nodes).toEqual(['xbox', 'xbox-dark']);
		expect(subtree.summary.total).toBe(4);
	});

	it('filters by token, event type and actor', async () => {
		const data = await list(context, {
			tokenId: 'color.primary',
			eventTypes: ['token_updated'],
			actor: 'bob',
		});
		expect(data.events.map((event) => event.targetNode).sort()).toEqual(['xbox', 'xbox-dark']);
	});

	it('counts events per day across every page', async () => {
		const extra: AuditEvent = {
			id: 'old',
			timestamp: '2026-01-15T10:00:00.000Z',
			eventType: 'node_updated',
			actor: 'carol',
			targetNode: 'xbox',
			targetToken: null,
			oldValue: null,
			newValue: null,
			metadata: null,
		};
		await context.db.addAuditEvent(extra);

		const data = await list(context, { limit: 2 });
		const today = new Date().toISOString().slice(0, 10);
		expect(data.days).toEqual([
			{ date: '2026-01-15', count: 1, byType: { node_updated: 1 } },
			{ date: today, count: 6, byType: { node_created: 3, token_created: 1, token_updated: 2 } },
		]);
		expect(data.page).toEqual({ offset: 0, limit: 2, returned: 2, nextOffset: 2 });

		const last = await list(context, { limit: 2, offset: 6 });
		expect(last.events.map((event) => event.id)).toEqual(['old']);
		expect(last.page.nextOffset).toBeNull();
	});

	it('applies a time range given as spans or dates', async () => {
		await context.db.addAuditEvent({
			id: 'old',
			timestamp: '2026-01-15T10:00:00.000Z',
			eventType: 'node_updated',
			actor: 'carol',
			targetNode: 'xbox',
			targetToken: null,
			oldValue: null,
			newValue: null,
			metadata: null,
		});

		const recent = await list(context, { since: '30d' });
		expect(recent.summary.total).toBe(6);
		expect(recent.summary.since).toMatch(/^\d{4}-\d{2}-\d{2}T/);

		const january = await list(context, { since: '2026-01-01', until: '2026-02-01' });
		expect(january.events.map((event) => event.id)).toEqual(['old']);
		expect(january.summary).toMatchObject({
			since: '2026-01-01T00:00:00.000Z',
			until: '2026-02-01T00:00:00.000Z',
		});
	});

	it('rejects an unreadable time and an unknown subtree', async () => {
		const badTime = await auditListCommand.handler({ since: 'yesterday' }, context);
		expect(badTime.error?.code).toBe('VALIDATION_ERROR');
		expect(badTime.error?.message).toContain("since 'yesterday'");

		const badNode = await auditListCommand.handler({ nodeId: 'nope', subtree: true }, context);
		expect(badNode.error?.code).toBe('NODE_NOT_FOUND');

		// Without subtree, an unknown node is just one with no history
		expect((await list(context, { nodeId: 'nope' })).summary.total).toBe(0);
	});
});
