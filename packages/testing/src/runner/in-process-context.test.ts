/**
 * The context the in-process executor passes to scenario steps (#271, #274).
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import { fixedClock, seededRandom } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import type { Scenario } from '../types/scenario.js';
import { type CommandHandler, InProcessExecutor } from './executor.js';

const scenario: Scenario = {
	name: 'Context',
	description: 'Step context',
	job: 'context',
	tags: [],
	steps: [
		{ command: 'step-one', expect: { success: true } },
		{ command: 'step-two', expect: { success: true } },
	],
};

function recording() {
	const contexts: CommandContext[] = [];
	const handler: CommandHandler = async (_command, _input, context) => {
		contexts.push(context ?? {});
		return { success: true, data: {} } satisfies CommandResult<unknown>;
	};
	return { handler, contexts };
}

describe('InProcessExecutor step context', () => {
	it('calls every step as a test actor with the run signal', async () => {
		const { handler, contexts } = recording();
		await new InProcessExecutor({ handler }).execute(scenario);
		expect(contexts).toHaveLength(2);
		for (const context of contexts) {
			expect(context.actor).toEqual({ kind: 'test' });
			expect(context.signal).toBeInstanceOf(AbortSignal);
		}
	});

	it('passes the configured clock, random source and actor', async () => {
		const { handler, contexts } = recording();
		const clock = fixedClock('2026-01-01T00:00:00Z');
		const random = seededRandom('abc');
		await new InProcessExecutor({
			handler,
			context: { clock, random, actor: { kind: 'test', label: 'replay' } },
		}).execute(scenario);
		expect(contexts[1]).toMatchObject({ clock, random, actor: { kind: 'test', label: 'replay' } });
	});
});
