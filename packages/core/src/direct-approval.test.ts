import { describe, expect, it } from 'vitest';
import { withContextDefaults } from './actor.js';
import {
	createDirectApprovalExchange,
	directApprovalExchange,
	holdDirectApproval,
	publicDirectContext,
	takeDirectApproval,
} from './direct-approval.js';

const hold = { approvalToken: 'secret', summary: 'Run command', expiresAt: 'later' };

describe('internal DirectClient approval exchange', () => {
	it('releases evidence once, only after approval, without serializing it', () => {
		const exchange = createDirectApprovalExchange();
		const context = withContextDefaults(exchange.bind({}));
		holdDirectApproval(context, hold);
		expect(takeDirectApproval(context)).toBeUndefined();
		expect(exchange.pending()).toEqual({ summary: hold.summary, expiresAt: hold.expiresAt });
		expect(JSON.stringify([context, exchange.pending()])).not.toContain(hold.approvalToken);
		exchange.approve();
		expect(exchange.pending()).toBeUndefined();
		expect(takeDirectApproval(context)).toBe(hold.approvalToken);
		expect(takeDirectApproval(context)).toBeUndefined();
	});

	it('discards held and approved evidence when disposed, including late holds', () => {
		for (const approved of [false, true]) {
			const exchange = createDirectApprovalExchange();
			const context = exchange.bind({});
			holdDirectApproval(context, hold);
			if (approved) exchange.approve();
			exchange.dispose();
			holdDirectApproval(context, hold);
			exchange.approve();
			expect(exchange.pending()).toBeUndefined();
			expect(directApprovalExchange(context)).toBe(exchange);
			expect(takeDirectApproval(context)).toBeUndefined();
		}
	});

	it('drops public approval authority while retaining other metadata', () => {
		const marker = Symbol('host metadata');
		const exchange = createDirectApprovalExchange();
		const context = exchange.bind({ approval: 'forged', tenant: 'test', [marker]: true });
		const clean = publicDirectContext(context);
		expect(clean).toEqual({ tenant: 'test', [marker]: true });
		expect(directApprovalExchange(clean)).toBeUndefined();
		expect(context.approval).toBe('forged');
	});

	it('ignores holds and evidence on ordinary contexts', () => {
		holdDirectApproval({}, hold);
		expect(takeDirectApproval({ approval: hold.approvalToken })).toBeUndefined();
	});
});
