/**
 * Audit log query contract: every Database adapter must filter, order, page
 * and count per day identically. Runs against MemoryDatabase,
 * SQLiteDatabase(':memory:'), Postgres when VIOLET_TEST_POSTGRES_URL is set and
 * Neon when VIOLET_NEON_DATABASE_URL is set (see store-adapters.test-support.ts
 * for running the Postgres leg locally). Ids are unique per run and every query
 * filters by them, so the Neon leg can share a database with other data.
 */
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../storage.js';
import type {
	AuditEvent,
	AuditEventFilter,
	AuditEventQuery,
	AuditEventType,
} from '../types/operation.js';
import { isolatedStoreAdapters, neonAdapter } from './store-adapters.test-support.js';

const adapters = [...isolatedStoreAdapters, neonAdapter];

describe.each(adapters)('audit query contract: $name', ({ create, skip }) => {
	const run = nanoid(8).toLowerCase();
	const node = (name: string) => `audit-${run}-${name}`;
	const nodes = [node('a'), node('b'), node('c')];
	const actor = `actor-${run}`;
	let db: Database;
	let close: () => Promise<void> = async () => {};

	const event = (
		id: string,
		timestamp: string,
		eventType: AuditEventType,
		targetNode: string,
		overrides: Partial<AuditEvent> = {},
	): AuditEvent => ({
		id: `${run}-${id}`,
		timestamp,
		eventType,
		actor,
		targetNode,
		targetToken: null,
		oldValue: null,
		newValue: null,
		metadata: null,
		...overrides,
	});

	const query = (overrides: Partial<AuditEventQuery> = {}) =>
		db.queryAuditEvents({ nodeIds: nodes, limit: 100, offset: 0, ...overrides });
	const ids = (events: AuditEvent[]) => events.map((entry) => entry.id.slice(run.length + 1));

	beforeAll(async () => {
		if (skip) return;
		({ db, close } = await create());
		const events = [
			event('e1', '2026-10-01T09:00:00.000Z', 'node_created', node('a')),
			event('e2', '2026-10-01T23:59:59.999Z', 'token_created', node('a'), {
				targetToken: 'color.primary',
				newValue: '"#0066CC"',
			}),
			event('e3', '2026-10-02T00:00:00.000Z', 'token_updated', node('a'), {
				targetToken: 'color.primary',
				oldValue: '"#0066CC"',
				newValue: '"#107C10"',
			}),
			event('e4', '2026-10-02T12:00:00.000Z', 'token_updated', node('b'), {
				targetToken: 'spacing.md',
			}),
			// Same timestamp as e4, written after it
			event('e5', '2026-10-02T12:00:00.000Z', 'token_deleted', node('b'), {
				targetToken: 'color.primary',
				actor: `other-${run}`,
			}),
			event('e6', '2026-10-05T08:30:00.000Z', 'node_updated', node('c')),
		];
		// One millisecond, written in this order; the ids sort the other way
		const batch = ['z1', 'm2', 'a3', 'k4'].map((id) =>
			event(id, '2026-10-06T10:00:00.000Z', 'token_updated', node('d')),
		);
		for (const entry of [...events, ...batch]) {
			await db.addAuditEvent(entry);
		}
	});

	afterAll(async () => {
		await close();
	});

	it.skipIf(skip)('returns matches newest first with a stable tie-break', async () => {
		const page = await query();
		expect(ids(page.events)).toEqual(['e6', 'e5', 'e4', 'e3', 'e2', 'e1']);
		expect(page.total).toBe(6);
		expect(page.events[2]).toEqual(
			event('e4', '2026-10-02T12:00:00.000Z', 'token_updated', node('b'), {
				targetToken: 'spacing.md',
			}),
		);
	});

	it.skipIf(skip)('orders same-millisecond events by when they were written', async () => {
		const batch = await query({ nodeIds: [node('d')] });
		expect(ids(batch.events)).toEqual(['k4', 'a3', 'm2', 'z1']);

		const pages = [];
		for (let offset = 0; offset < 4; offset++) {
			pages.push(...ids((await query({ nodeIds: [node('d')], limit: 1, offset })).events));
		}
		expect(pages).toEqual(['k4', 'a3', 'm2', 'z1']);
	});

	it.skipIf(skip)('filters by node, token, event type and actor', async () => {
		expect(ids((await query({ nodeIds: [node('b')] })).events)).toEqual(['e5', 'e4']);
		expect(ids((await query({ tokenId: 'color.primary' })).events)).toEqual(['e5', 'e3', 'e2']);
		expect(ids((await query({ eventTypes: ['token_updated', 'node_created'] })).events)).toEqual([
			'e4',
			'e3',
			'e1',
		]);
		expect(ids((await query({ actor: `other-${run}` })).events)).toEqual(['e5']);
		expect(
			ids((await query({ tokenId: 'color.primary', eventTypes: ['token_updated'] })).events),
		).toEqual(['e3']);
	});

	it.skipIf(skip)('treats an empty list as matching nothing', async () => {
		expect((await query({ nodeIds: [] })).total).toBe(0);
		expect((await query({ eventTypes: [] })).events).toEqual([]);
	});

	it.skipIf(skip)('applies since inclusively and until exclusively', async () => {
		const page = await query({
			since: '2026-10-02T00:00:00.000Z',
			until: '2026-10-05T08:30:00.000Z',
		});
		expect(ids(page.events)).toEqual(['e5', 'e4', 'e3']);
		expect(page.total).toBe(3);
	});

	it.skipIf(skip)('pages with limit and offset while total covers every match', async () => {
		const first = await query({ limit: 2, offset: 0 });
		const second = await query({ limit: 2, offset: 2 });
		const past = await query({ limit: 2, offset: 10 });
		expect(ids(first.events)).toEqual(['e6', 'e5']);
		expect(ids(second.events)).toEqual(['e4', 'e3']);
		expect(past.events).toEqual([]);
		expect([first.total, second.total, past.total]).toEqual([6, 6, 6]);
	});

	describe('getAuditEvents', () => {
		const get = (filter: AuditEventFilter) => db.getAuditEvents(filter).then(ids);

		it.skipIf(skip)('returns matches newest first, like queryAuditEvents (#111)', async () => {
			expect(await get({ targetNode: node('a') })).toEqual(['e3', 'e2', 'e1']);
			expect(await get({ targetNode: node('b') })).toEqual(['e5', 'e4']);
			expect(await get({ targetNode: node('d') })).toEqual(['k4', 'a3', 'm2', 'z1']);
		});

		it.skipIf(skip)('matches every given field and ignores undefined ones', async () => {
			expect(await get({ targetNode: node('a'), targetToken: 'color.primary' })).toEqual([
				'e3',
				'e2',
			]);
			expect(
				await get({
					targetNode: node('a'),
					targetToken: 'color.primary',
					eventType: 'token_created',
				}),
			).toEqual(['e2']);
			expect(await get({ targetNode: node('b'), actor: `other-${run}` })).toEqual(['e5']);
			expect(await get({ targetNode: node('b'), actor: actor })).toEqual(['e4']);
			expect(await get({ targetNode: node('c'), targetToken: undefined })).toEqual(['e6']);
			expect(await get({ targetNode: node('a'), eventType: 'node_deleted' })).toEqual([]);
		});

		it.skipIf(skip)('treats an empty string as a value to match, not as absent', async () => {
			expect(await get({ targetNode: node('a'), actor: '' })).toEqual([]);
		});
	});

	it.skipIf(skip)('counts every match per UTC day and event type', async () => {
		const page = await query({ limit: 1 });
		const days = [...page.days].sort(
			(a, b) => a.date.localeCompare(b.date) || a.eventType.localeCompare(b.eventType),
		);
		expect(days).toEqual([
			{ date: '2026-10-01', eventType: 'node_created', count: 1 },
			{ date: '2026-10-01', eventType: 'token_created', count: 1 },
			{ date: '2026-10-02', eventType: 'token_deleted', count: 1 },
			{ date: '2026-10-02', eventType: 'token_updated', count: 2 },
			{ date: '2026-10-05', eventType: 'node_updated', count: 1 },
		]);

		const filtered = await query({ since: '2026-10-02T00:00:00.000Z', nodeIds: [node('a')] });
		expect(filtered.days).toEqual([{ date: '2026-10-02', eventType: 'token_updated', count: 1 }]);
	});
});
