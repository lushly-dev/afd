/**
 * @fileoverview A disabled rule says why it stays off (#1327)
 */

import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import type { Constraint } from '@lushly-dev/violet-core/types';
import { beforeEach, describe, expect, it } from 'vitest';
import { nodeCreateCommand } from '../node/create.js';
import { type CommandContext, CommandRegistry } from '../registry.js';
import { tokenAddCommand } from '../token/add.js';
import { listCommand } from './list.js';
import { setCommand } from './set.js';
import { validateCommand } from './validate.js';

const REASON = 'The brand purple is fixed by the logo guidelines; tracked in #42';

function contrastRule(overrides: Partial<Constraint> = {}) {
	return {
		id: 'muted-on-page',
		name: 'Muted text on the page',
		config: { type: 'contrast' as const, against: 'color.surface.page', min: 4.5 },
		applyTo: 'color.text.muted',
		...overrides,
	};
}

describe('constraints with a disabled reason', () => {
	let context: CommandContext;

	beforeEach(async () => {
		context = { db: createMemoryDatabase(), actor: 'test' };
		await nodeCreateCommand.handler({ name: 'root', type: 'root', parentId: null }, context);
		await nodeCreateCommand.handler({ name: 'dark', type: 'theme', parentId: 'root' }, context);
		await tokenAddCommand.handler(
			{ nodeId: 'root', tokenId: 'color.surface.page', value: '#ffffff' },
			context,
		);
		await tokenAddCommand.handler(
			{ nodeId: 'root', tokenId: 'color.text.muted', value: '#aaaaaa' },
			context,
		);
	});

	it('stores the reason beside enabled and lists it', async () => {
		const set = await setCommand.handler(
			{
				nodeId: 'root',
				constraints: [contrastRule({ enabled: false, disabledReason: REASON })],
			},
			context,
		);
		expect(set.success).toBe(true);

		const listed = await listCommand.handler({ nodeId: 'dark' }, context);
		expect(listed.data?.constraints).toEqual([
			expect.objectContaining({
				id: 'muted-on-page',
				enabled: false,
				disabledReason: REASON,
				source: 'root',
			}),
		]);
	});

	it('reports a disabled rule and its reason where the check runs', async () => {
		await setCommand.handler(
			{
				nodeId: 'root',
				constraints: [contrastRule({ enabled: false, disabledReason: REASON })],
			},
			context,
		);

		const result = await validateCommand.handler({ nodeId: 'dark' }, context);
		expect(result.success).toBe(true);
		// The failing pair is not counted, and the check says the rule is off and why
		expect(result.data?.summary.errors).toBe(0);
		expect(result.data?.disabled).toEqual([
			{
				constraintId: 'muted-on-page',
				name: 'Muted text on the page',
				source: 'root',
				reason: REASON,
			},
		]);
	});

	it('lists a disabled rule without a reason, and none when every rule runs', async () => {
		await setCommand.handler(
			{ nodeId: 'root', constraints: [contrastRule({ enabled: false })] },
			context,
		);
		const off = await validateCommand.handler({ nodeId: 'root' }, context);
		expect(off.data?.disabled).toEqual([
			{ constraintId: 'muted-on-page', name: 'Muted text on the page', source: 'root' },
		]);

		await setCommand.handler({ nodeId: 'root', constraints: [contrastRule()] }, context);
		const on = await validateCommand.handler({ nodeId: 'root' }, context);
		expect(on.data?.disabled).toEqual([]);
		expect(on.data?.summary.errors).toBe(1);
	});

	it('refuses a reason on a rule that still runs', async () => {
		const result = await setCommand.handler(
			{ nodeId: 'root', constraints: [contrastRule({ disabledReason: REASON })] },
			context,
		);
		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('VALIDATION_ERROR');
		expect(result.error?.message).toContain('muted-on-page');
		expect(result.error?.suggestion).toContain('enabled: false');
		expect(await context.db.getConstraints('root')).toEqual([]);
	});

	it('refuses an empty reason', async () => {
		const registry = new CommandRegistry();
		registry.register(setCommand);
		const result = await registry.execute(
			'constraints.set',
			{ nodeId: 'root', constraints: [contrastRule({ enabled: false, disabledReason: '' })] },
			context,
		);
		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('VALIDATION_ERROR');
	});
});
