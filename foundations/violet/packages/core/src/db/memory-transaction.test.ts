import { describe, expect, it } from 'vitest';
import type { Constraint } from '../types/constraint.js';
import type { Node } from '../types/node.js';
import type { AuditEvent, OperationRecord } from '../types/operation.js';
import type { CheckSnapshot } from '../types/snapshot.js';
import type { SpecimenMapRecord } from '../types/specimen.js';
import type { Webhook, WebhookDelivery } from '../types/webhook.js';
import { createMemoryDatabase } from './memory.js';

const STAMP = '2026-01-01T00:00:00.000Z';

function makeNode(id: string, name = id): Node {
	return {
		id,
		name,
		type: 'theme',
		parentId: null,
		status: 'active',
		includes: [],
		includePolicy: 'merge',
		tags: [],
		createdAt: STAMP,
		updatedAt: STAMP,
		deletedAt: null,
	};
}

function makeOp(
	id: string,
	nodeId: string,
	sequence: number,
	tokenId = 'color.bg',
): OperationRecord {
	return {
		id,
		nodeId,
		sequence,
		type: 'add',
		tokenId,
		value: JSON.stringify('#ffffff'),
		metadata: null,
		fromNode: null,
		asTokenId: null,
		toAncestor: null,
		reason: null,
		author: 'test',
		createdAt: STAMP,
	};
}

function makeAudit(id: string, targetNode: string): AuditEvent {
	return {
		id,
		timestamp: STAMP,
		eventType: 'token_created',
		actor: 'test',
		targetNode,
		targetToken: 'color.bg',
		oldValue: null,
		newValue: JSON.stringify('#ffffff'),
		metadata: null,
	};
}

function makeConstraint(id: string): Constraint {
	return {
		id,
		name: id,
		config: { type: 'pattern', regex: '^#' },
		severity: 'error',
		applyTo: 'color.*',
		enabled: true,
	};
}

function makeWebhook(id: string): Webhook {
	return {
		id,
		url: 'https://example.com/hook',
		secret: 'sec',
		events: ['token_created'],
		active: true,
		createdAt: STAMP,
		updatedAt: STAMP,
	};
}

function makeDelivery(id: string, webhookId: string): WebhookDelivery {
	return {
		id,
		webhookId,
		eventType: 'token_created',
		payload: '{}',
		status: null,
		attempts: 0,
		createdAt: STAMP,
	};
}

function makeSnapshot(id: string, rootId: string): CheckSnapshot {
	return {
		id,
		rootId,
		takenAt: STAMP,
		nodes: 1,
		counts: { error: 0, warning: 0, info: 0 },
		issues: [],
		actor: 'test',
	};
}

function makeSpecimenMap(rootId: string): SpecimenMapRecord {
	return {
		rootId,
		map: { bg: 'color.bg' },
		updatedAt: STAMP,
		updatedBy: 'test',
	};
}

describe('MemoryDatabase.transaction (#1973)', () => {
	it('commits writes and returns the callback value on success', async () => {
		const db = createMemoryDatabase();
		const value = await db.transaction(async () => {
			await db.createNode(makeNode('n1'));
			await db.addOperation(makeOp('op1', 'n1', 1));
			return 'ok';
		});

		expect(value).toBe('ok');
		expect(await db.getNode('n1')).not.toBeNull();
		expect(await db.getOperations('n1')).toHaveLength(1);
	});

	it('rolls back all mutable collections when the callback throws or rejects', async () => {
		const db = createMemoryDatabase();

		// Seed pre-existing state across every collection
		await db.createNode(makeNode('seed', 'Original'));
		await db.addOperation(makeOp('op-seed', 'seed', 1));
		await db.addConstraint('seed', makeConstraint('c-seed'));
		await db.addAuditEvent(makeAudit('a-seed', 'seed'));
		await db.createWebhook(makeWebhook('w-seed'));
		await db.createDelivery(makeDelivery('d-seed', 'w-seed'));
		await db.addCheckSnapshot(makeSnapshot('s-seed', 'seed'));
		await db.setSpecimenMap('seed', makeSpecimenMap('seed'));

		await expect(
			db.transaction(async () => {
				await db.updateNode('seed', { name: 'Mutated' });
				await db.createNode(makeNode('new-node'));
				await db.removeOperation('op-seed');
				await db.addOperation(makeOp('op-new', 'seed', 2, 'color.fg'));
				await db.addConstraint('seed', makeConstraint('c-new'));
				await db.addAuditEvent(makeAudit('a-new', 'seed'));
				await db.updateWebhook('w-seed', { url: 'https://mutated.example/hook' });
				await db.createWebhook(makeWebhook('w-new'));
				await db.updateDelivery('d-seed', { attempts: 3, status: 500 });
				await db.createDelivery(makeDelivery('d-new', 'w-seed'));
				await db.addCheckSnapshot(makeSnapshot('s-new', 'seed'));
				await db.setSpecimenMap('seed', null);
				await db.setSpecimenMap('new-node', makeSpecimenMap('new-node'));
				throw new Error('mid-transaction failure');
			}),
		).rejects.toThrow('mid-transaction failure');

		expect((await db.getNode('seed'))?.name).toBe('Original');
		expect(await db.getNode('new-node')).toBeNull();
		expect((await db.getOperations('seed')).map((op) => op.id)).toEqual(['op-seed']);
		expect((await db.getConstraints('seed')).map((c) => c.id)).toEqual(['c-seed']);
		expect((await db.getAuditEvents({})).map((e) => e.id)).toEqual(['a-seed']);
		expect((await db.getWebhook('w-seed'))?.url).toBe('https://example.com/hook');
		expect(await db.getWebhook('w-new')).toBeNull();
		expect((await db.getDelivery('d-seed'))?.attempts).toBe(0);
		expect(await db.getDelivery('d-new')).toBeNull();
		expect((await db.listCheckSnapshots()).map((s) => s.id)).toEqual(['s-seed']);
		expect(await db.getSpecimenMap('seed')).toEqual(makeSpecimenMap('seed'));
		expect(await db.getSpecimenMap('new-node')).toBeNull();
	});

	it('rolls back on a synchronous throw inside the transaction callback', async () => {
		const db = createMemoryDatabase();
		await db.createNode(makeNode('base'));

		await expect(
			db.transaction(() => {
				void db.createNode(makeNode('sync-fail'));
				throw new Error('sync boom');
			}),
		).rejects.toThrow('sync boom');

		expect(await db.getNode('sync-fail')).toBeNull();
		expect(await db.getNode('base')).not.toBeNull();
	});

	it('supports nested transactions: inner rollback keeps outer writes, outer rollback reverts both', async () => {
		const db = createMemoryDatabase();

		await db.transaction(async () => {
			await db.createNode(makeNode('outer'));
			await expect(
				db.transaction(async () => {
					await db.createNode(makeNode('inner-failed'));
					throw new Error('inner-boom');
				}),
			).rejects.toThrow('inner-boom');
			await db.createNode(makeNode('outer-after'));
		});

		expect(await db.getNode('outer')).not.toBeNull();
		expect(await db.getNode('inner-failed')).toBeNull();
		expect(await db.getNode('outer-after')).not.toBeNull();

		await expect(
			db.transaction(async () => {
				await db.createNode(makeNode('outer-2'));
				await db.transaction(async () => {
					await db.createNode(makeNode('inner-2-ok'));
				});
				throw new Error('outer-2-boom');
			}),
		).rejects.toThrow('outer-2-boom');

		expect(await db.getNode('outer-2')).toBeNull();
		expect(await db.getNode('inner-2-ok')).toBeNull();
	});

	it('isolates concurrent top-level transactions and outside writes from rollback', async () => {
		const db = createMemoryDatabase();

		let tx1Ready!: () => void;
		const tx1Open = new Promise<void>((resolve) => {
			tx1Ready = resolve;
		});
		let releaseTx1!: () => void;
		const tx1Hold = new Promise<void>((resolve) => {
			releaseTx1 = resolve;
		});

		const tx1 = db.transaction(async () => {
			await db.createNode(makeNode('from-tx1'));
			tx1Ready();
			await tx1Hold;
			throw new Error('tx1-fail');
		});

		await tx1Open;
		const tx2 = db.transaction(async () => {
			await db.createNode(makeNode('from-tx2'));
			return 'tx2-ok';
		});
		const outsider = db.createNode(makeNode('from-outsider'));

		releaseTx1();

		await expect(tx1).rejects.toThrow('tx1-fail');
		expect(await tx2).toBe('tx2-ok');
		await outsider;

		expect(await db.getNode('from-tx1')).toBeNull();
		expect(await db.getNode('from-tx2')).not.toBeNull();
		expect(await db.getNode('from-outsider')).not.toBeNull();
	});

	it('rolls back per-node appendOperation sequence index on transaction failure', async () => {
		const db = createMemoryDatabase();
		await db.createNode(makeNode('n1'));
		const first = await db.appendOperation({
			id: 'op-1',
			nodeId: 'n1',
			type: 'add',
			tokenId: 'color.a',
			value: JSON.stringify('#111111'),
			metadata: null,
			fromNode: null,
			asTokenId: null,
			toAncestor: null,
			reason: null,
			author: 'test',
			createdAt: STAMP,
		});
		expect(first.sequence).toBe(1);

		await expect(
			db.transaction(async () => {
				await db.appendOperation({
					id: 'op-rolled-back',
					nodeId: 'n1',
					type: 'add',
					tokenId: 'color.b',
					value: JSON.stringify('#222222'),
					metadata: null,
					fromNode: null,
					asTokenId: null,
					toAncestor: null,
					reason: null,
					author: 'test',
					createdAt: STAMP,
				});
				throw new Error('rollback-seq');
			}),
		).rejects.toThrow('rollback-seq');

		const second = await db.appendOperation({
			id: 'op-2',
			nodeId: 'n1',
			type: 'add',
			tokenId: 'color.c',
			value: JSON.stringify('#333333'),
			metadata: null,
			fromNode: null,
			asTokenId: null,
			toAncestor: null,
			reason: null,
			author: 'test',
			createdAt: STAMP,
		});
		expect(second.sequence).toBe(2);
		expect((await db.getOperations('n1')).map((op) => [op.id, op.sequence])).toEqual([
			['op-1', 1],
			['op-2', 2],
		]);
	});
});
