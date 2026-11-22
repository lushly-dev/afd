/**
 * @fileoverview token.remove: a node's own operation taken out, the undo of token.add (#1328)
 */

import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { auditListCommand } from '../audit/list.js';
import { nodeCreateCommand } from '../node/create.js';
import { type CommandContext, CommandRegistry } from '../registry.js';
import { tokenAddCommand } from './add.js';
import { tokenCopyCommand } from './copy.js';
import { tokenOverrideCommand } from './override.js';
import { tokenRemoveCommand } from './remove.js';
import { tokensResolveCommand } from './resolve.js';

describe('token.remove command', () => {
	let context: CommandContext;

	beforeEach(async () => {
		context = { db: createMemoryDatabase(), actor: 'test' };
		await nodeCreateCommand.handler({ name: 'base', type: 'root', parentId: null }, context);
		await nodeCreateCommand.handler({ name: 'app', type: 'product', parentId: 'base' }, context);
		await nodeCreateCommand.handler({ name: 'dark', type: 'theme', parentId: 'app' }, context);
		await tokenAddCommand.handler(
			{ nodeId: 'base', tokenId: 'color.page', value: '#ffffff' },
			context,
		);
	});

	const resolved = async (nodeId: string) => {
		const result = await tokensResolveCommand.handler({ nodeId }, context);
		return new Map(result.data?.tokens.map((token) => [token.id, token.resolvedValue]));
	};

	it('undoes a token.add by the operationId it returned', async () => {
		const before = await context.db.getOperations('app');
		const added = await tokenAddCommand.handler(
			{ nodeId: 'app', tokenId: 'color.brand', value: '#5b3fd1' },
			context,
		);
		expect((await resolved('dark')).get('color.brand')).toBe('#5b3fd1');

		const result = await tokenRemoveCommand.handler(
			{ nodeId: 'app', operationId: added.data?.operationId, reason: 'Added by mistake' },
			context,
		);
		expect(result.success).toBe(true);
		expect(result.data?.removed).toEqual([
			{
				operationId: added.data?.operationId,
				type: 'add',
				tokenId: 'color.brand',
				value: '#5b3fd1',
			},
		]);

		// As if never written: the node's operations and every resolution are as before
		expect(await context.db.getOperations('app')).toEqual(before);
		expect((await resolved('dark')).has('color.brand')).toBe(false);
		// The token can be added again
		const again = await tokenAddCommand.handler(
			{ nodeId: 'app', tokenId: 'color.brand', value: '#000000' },
			context,
		);
		expect(again.success).toBe(true);
	});

	it('records the removal in the audit log', async () => {
		const added = await tokenAddCommand.handler(
			{ nodeId: 'app', tokenId: 'color.brand', value: '#5b3fd1' },
			context,
		);
		await tokenRemoveCommand.handler(
			{ nodeId: 'app', operationId: added.data?.operationId, reason: 'Undo' },
			context,
		);
		const audit = await auditListCommand.handler({ nodeId: 'app' }, context);
		const event = audit.data?.events.find((e) => e.eventType === 'operation_removed');
		expect(event).toMatchObject({ targetNode: 'app', targetToken: 'color.brand', actor: 'test' });
		expect(event?.oldValue).toBe('#5b3fd1');
	});

	it("removes every one of a node's own operations on a token", async () => {
		await tokenOverrideCommand.handler(
			{ nodeId: 'app', tokenId: 'color.page', value: '#eeeeee' },
			context,
		);
		await tokenOverrideCommand.handler(
			{ nodeId: 'app', tokenId: 'color.page', value: '#dddddd' },
			context,
		);
		const result = await tokenRemoveCommand.handler(
			{ nodeId: 'app', tokenId: 'color.page' },
			context,
		);
		expect(result.data?.removed.map((op) => op.type)).toEqual(['override', 'override']);
		expect((await resolved('app')).get('color.page')).toBe('#ffffff');
	});

	it('keeps operation order after a removal from the middle', async () => {
		await tokenAddCommand.handler({ nodeId: 'app', tokenId: 'color.a', value: '#111111' }, context);
		const middle = await tokenAddCommand.handler(
			{ nodeId: 'app', tokenId: 'color.b', value: '#222222' },
			context,
		);
		await tokenAddCommand.handler({ nodeId: 'app', tokenId: 'color.c', value: '#333333' }, context);
		await tokenRemoveCommand.handler(
			{ nodeId: 'app', operationId: middle.data?.operationId },
			context,
		);
		await tokenOverrideCommand.handler(
			{ nodeId: 'app', tokenId: 'color.c', value: '#444444' },
			context,
		);

		const sequences = (await context.db.getOperations('app')).map((op) => op.sequence);
		expect(new Set(sequences).size).toBe(sequences.length);
		expect((await resolved('app')).get('color.c')).toBe('#444444');
	});

	it('refuses to remove an add that descendants still change, naming them', async () => {
		const added = await tokenAddCommand.handler(
			{ nodeId: 'app', tokenId: 'color.brand', value: '#5b3fd1' },
			context,
		);
		await tokenOverrideCommand.handler(
			{ nodeId: 'dark', tokenId: 'color.brand', value: '#8f7ae6' },
			context,
		);

		const refused = await tokenRemoveCommand.handler(
			{ nodeId: 'app', operationId: added.data?.operationId },
			context,
		);
		expect(refused.success).toBe(false);
		expect(refused.error?.code).toBe('OPERATION_NOT_ALLOWED');
		expect(refused.error?.message).toContain('dark');
		expect(refused.error?.suggestion).toContain("'token.remove' there");
		expect(await context.db.getOperations('app')).toHaveLength(1);

		const forced = await tokenRemoveCommand.handler(
			{ nodeId: 'app', operationId: added.data?.operationId, force: true },
			context,
		);
		expect(forced.success).toBe(true);
	});

	it('refuses an operation the node does not hold', async () => {
		const elsewhere = await context.db.getOperations('base');
		const result = await tokenRemoveCommand.handler(
			{ nodeId: 'app', operationId: elsewhere[0]?.id },
			context,
		);
		expect(result.error?.code).toBe('INVALID_OPERATION');
		expect(result.error?.suggestion).toContain('node.get');
		expect(await context.db.getOperations('base')).toHaveLength(1);
	});

	it('refuses a token the node has no operations on, and an unknown node', async () => {
		const token = await tokenRemoveCommand.handler(
			{ nodeId: 'app', tokenId: 'color.page' },
			context,
		);
		expect(token.error?.code).toBe('TOKEN_NOT_FOUND');

		const node = await tokenRemoveCommand.handler({ nodeId: 'nope', tokenId: 'x' }, context);
		expect(node.error?.code).toBe('NODE_NOT_FOUND');
	});

	it('takes exactly one of operationId and tokenId', async () => {
		const registry = new CommandRegistry();
		registry.register(tokenRemoveCommand);
		for (const input of [{ nodeId: 'app' }, { nodeId: 'app', operationId: 'a', tokenId: 'b' }]) {
			const result = await registry.execute('token.remove', input, context);
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		}
	});

	it('matches a renamed copy by the token it changes here, and leaves the source alone', async () => {
		await tokenAddCommand.handler(
			{ nodeId: 'app', tokenId: 'color.src', value: '#123456' },
			context,
		);
		await tokenCopyCommand.handler(
			{ nodeId: 'app', fromNode: 'base', tokenId: 'color.page', asTokenId: 'color.renamed' },
			context,
		);
		const removed = await tokenRemoveCommand.handler(
			{ nodeId: 'app', tokenId: 'color.renamed' },
			context,
		);
		expect(removed.data?.removed).toEqual([
			expect.objectContaining({ type: 'copy', tokenId: 'color.renamed' }),
		]);
		const left = await resolved('app');
		expect(left.has('color.renamed')).toBe(false);
		expect(left.get('color.src')).toBe('#123456');
	});

	it('refuses to remove an add that another node copies, includes or references', async () => {
		await nodeCreateCommand.handler({ name: 'other', type: 'product', parentId: null }, context);
		const added = await tokenAddCommand.handler(
			{ nodeId: 'app', tokenId: 'color.brand', value: '#5b3fd1' },
			context,
		);
		await tokenCopyCommand.handler(
			{ nodeId: 'other', fromNode: 'app', tokenId: 'color.brand' },
			context,
		);
		const copied = await tokenRemoveCommand.handler(
			{ nodeId: 'app', operationId: added.data?.operationId },
			context,
		);
		expect(copied.error?.code).toBe('OPERATION_NOT_ALLOWED');
		expect(copied.error?.message).toContain('other (copies it)');

		await tokenRemoveCommand.handler({ nodeId: 'other', tokenId: 'color.brand' }, context);
		await tokenAddCommand.handler(
			{ nodeId: 'dark', tokenId: 'color.link', value: '{color.brand}' },
			context,
		);
		const referenced = await tokenRemoveCommand.handler(
			{ nodeId: 'app', operationId: added.data?.operationId },
			context,
		);
		expect(referenced.error?.message).toContain('dark (references it)');
	});

	it("refuses to remove an add while the node's own later overrides of it stay", async () => {
		const added = await tokenAddCommand.handler(
			{ nodeId: 'app', tokenId: 'color.brand', value: '#5b3fd1' },
			context,
		);
		await tokenOverrideCommand.handler(
			{ nodeId: 'app', tokenId: 'color.brand', value: '#000000' },
			context,
		);
		const refused = await tokenRemoveCommand.handler(
			{ nodeId: 'app', operationId: added.data?.operationId },
			context,
		);
		expect(refused.error?.message).toContain('app (changes it)');
		// Removing every operation on the token at once is allowed
		const all = await tokenRemoveCommand.handler(
			{ nodeId: 'app', tokenId: 'color.brand' },
			context,
		);
		expect(all.data?.removed).toHaveLength(2);
	});

	it('refuses while a descendant of a node that includes this one still changes the token', async () => {
		await nodeCreateCommand.handler({ name: 'p', type: 'shared', parentId: null }, context);
		await nodeCreateCommand.handler(
			{ name: 'q', type: 'product', parentId: null, includes: ['p'] },
			context,
		);
		await nodeCreateCommand.handler(
			{ name: 'r', type: 'product', parentId: null, includes: ['q'] },
			context,
		);
		await nodeCreateCommand.handler({ name: 'd', type: 'theme', parentId: 'r' }, context);
		await tokenAddCommand.handler({ nodeId: 'p', tokenId: 'color.x', value: '#111111' }, context);
		await tokenOverrideCommand.handler(
			{ nodeId: 'd', tokenId: 'color.x', value: '#000000' },
			context,
		);
		const refused = await tokenRemoveCommand.handler({ nodeId: 'p', tokenId: 'color.x' }, context);
		expect(refused.error?.code).toBe('OPERATION_NOT_ALLOWED');
		expect(refused.error?.message).toContain('d (changes it)');
	});

	it('rolls back partial removals and audit events on MemoryDatabase if the transaction fails (#1973)', async () => {
		await tokenOverrideCommand.handler(
			{ nodeId: 'app', tokenId: 'color.page', value: '#eeeeee' },
			context,
		);
		await tokenOverrideCommand.handler(
			{ nodeId: 'app', tokenId: 'color.page', value: '#dddddd' },
			context,
		);
		const opsBefore = await context.db.getOperations('app');
		const auditsBefore = await context.db.getAuditEvents({ targetNode: 'app' });

		// Fail while generating the second audit event id inside db.transaction()
		let calls = 0;
		const failingContext: CommandContext = {
			...context,
			random: () => {
				calls += 1;
				if (calls > 21) throw new Error('mid-remove failure');
				return 0.5;
			},
		};

		await expect(
			tokenRemoveCommand.handler({ nodeId: 'app', tokenId: 'color.page' }, failingContext),
		).rejects.toThrow('mid-remove failure');

		expect(await context.db.getOperations('app')).toEqual(opsBefore);
		expect(await context.db.getAuditEvents({ targetNode: 'app' })).toEqual(auditsBefore);
		expect((await resolved('app')).get('color.page')).toBe('#dddddd');
	});

	it('gives concurrent writes distinct sequences after a removal on MemoryDatabase (#1958)', async () => {
		const first = await tokenAddCommand.handler(
			{ nodeId: 'app', tokenId: 'color.a', value: '#111111' },
			context,
		);
		await tokenAddCommand.handler({ nodeId: 'app', tokenId: 'color.b', value: '#222222' }, context);
		await tokenRemoveCommand.handler(
			{ nodeId: 'app', operationId: first.data?.operationId },
			context,
		);

		const [c, d] = await Promise.all([
			tokenAddCommand.handler({ nodeId: 'app', tokenId: 'color.c', value: '#333333' }, context),
			tokenAddCommand.handler({ nodeId: 'app', tokenId: 'color.d', value: '#444444' }, context),
		]);
		expect(c.success).toBe(true);
		expect(d.success).toBe(true);
		expect((await context.db.getOperations('app')).map((op) => op.sequence)).toEqual([2, 3, 4]);
	});
});
